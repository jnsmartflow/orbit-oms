// lib/billing/telephonic-apply.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE IMPORT HOOK FOR BILLING · TELEPHONIC TAGS — HOLD, AND THE BILL-ONLY CI
// ═══════════════════════════════════════════════════════════════════════════
//
// A telephonic order has no mail order, so the no-mail-order fallback
// (app/api/import/obd/route.ts, applyNoMailOrderFallback) would release it to
// picking the moment its OBD lands. Billing types the SO number on the
// Telephonic tab with a tag — 'hold' or 'ci' (so_tags). This hook runs at every
// fallback call site, AFTER applyMailOrderEnrichment and immediately BEFORE the
// fallback, and holds the tagged bills first.
//
// 🔴 THE ORDER IS LOAD-BEARING. The fallback only releases bills whose
// dispatchStatus is null; a bill this hook has held is invisible to it — no
// second write, no false "Auto-dispatched on import" log line.
//
// Design: docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md
// §5, "Import hook rules".
//
// TWO HALVES:
//   planSoTagApplications — PURE. No Prisma, no clock (`now` is passed in).
//                           Decides per order; testable with no database.
//   applySoTagHolds       — the executor. Three batched reads, then the
//                           decisions in order. NEVER THROWS into the import.
//
// Per acting bill, IN THIS ORDER, sequential awaits, never $transaction:
//   1. CLAIM — insert the so_tag_matches row. Its UNIQUE (soTagId, orderId)
//      is the lock: a P2002 means another import run (auto-import fires every
//      minute; a manual paste can overlap it) got there first → skip.
//   2. HOLD  — ONE orders.update + ONE order_status_logs row.
//   3. CI    — 'ci' tags only: raiseBillOnlyCi, which never throws. A refusal
//      or failure is written to the match row's ciSkipReason.
//   4. TAG   — 'waiting' → 'matched' with matchedAt = now. An already-matched
//      tag keeps its matchedAt (it records the FIRST match).
// record_only (dispatched / removed / cancelled bill): step 1 with the reason
// in ciSkipReason, then step 4. No hold, no CI.
//
// ⚠ A bill that already has a match row for this tag is skipped ENTIRELY. A
// re-import must never re-hold a bill Floor has deliberately released, and
// never re-raise a CI.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { raiseBillOnlyCi } from "@/lib/ci/bill-only";
import { TELEPHONIC_HOLD_NOTE } from "@/lib/floor/hold-log";

// ── Types ────────────────────────────────────────────────────────────────────

/** The order fields the planner needs. */
export interface TagPlanOrder {
  id: number;
  obdNumber: string;
  soNumber: string | null;
  workflowStage: string;
  isRemoved: boolean;
}

/** The tag fields the planner needs. */
export interface TagPlanTag {
  id: number;
  soNumber: string;
  /** 'hold' | 'ci' — chk_so_tags_tag. */
  tag: string;
  /** 'waiting' | 'matched' — chk_so_tags_status. */
  status: string;
  isRemoved: boolean;
  expiresAt: Date;
  addedById: number;
}

export interface TagPlanMatch {
  soTagId: number;
  orderId: number;
}

export type SoTagDecision<O extends TagPlanOrder = TagPlanOrder, T extends TagPlanTag = TagPlanTag> =
  | { action: "skip"; order: O; reason: "no SO number" | "no live tag" | "already matched" }
  | { action: "record_only"; order: O; tag: T; reason: string }
  | { action: "hold"; order: O; tag: T }
  | { action: "hold_and_ci"; order: O; tag: T };

export interface SoTagApplySummary {
  held: number;
  ciRaised: number;
  ciSkipped: number;
  recordOnly: number;
  skipped: number;
  errors: number;
}

// ── The pure planner ─────────────────────────────────────────────────────────

/**
 * 🔴 A LIVE TAG: not removed, not expired, status 'waiting' OR 'matched'.
 * NOT 'waiting' only — the first OBD flips a tag to 'matched', and a second OBD
 * on the same SO arriving in a later import must still find it.
 * "Expired" is never stored; it is `expiresAt <= now` read here.
 */
export function isLiveTag(tag: TagPlanTag, now: Date): boolean {
  return (
    !tag.isRemoved &&
    tag.expiresAt.getTime() > now.getTime() &&
    (tag.status === "waiting" || tag.status === "matched")
  );
}

function normaliseSo(so: string | null): string | null {
  const t = so?.trim() ?? "";
  return t === "" ? null : t;
}

/**
 * Decide, per order, what the hook does. PURE: no database, no clock.
 *
 *   blank / null soNumber             → skip ("no SO number")
 *   no live tag for its SO            → skip ("no live tag")
 *   a match row exists for the pair   → skip ("already matched")
 *   removed / dispatched / cancelled  → record_only (reason names which)
 *   otherwise                         → hold ('hold' tag) or hold_and_ci ('ci' tag)
 *
 * Cancelled joins dispatched and removed because Floor refuses to hold a
 * cancelled bill (app/api/floor/actions/route.ts) and a "material not moved"
 * CI on a dead bill would be false.
 */
export function planSoTagApplications<O extends TagPlanOrder, T extends TagPlanTag>(
  orders: readonly O[],
  tags: readonly T[],
  existingMatches: readonly TagPlanMatch[],
  now: Date,
): SoTagDecision<O, T>[] {
  // At most one non-removed tag per SO (the partial unique index), so the first
  // live one found is the one.
  const liveBySo = new Map<string, T>();
  for (const t of tags) {
    const so = normaliseSo(t.soNumber);
    if (so !== null && isLiveTag(t, now) && !liveBySo.has(so)) liveBySo.set(so, t);
  }
  const matched = new Set(existingMatches.map((m) => `${m.soTagId}:${m.orderId}`));

  return orders.map((order): SoTagDecision<O, T> => {
    const so = normaliseSo(order.soNumber);
    if (so === null) return { action: "skip", order, reason: "no SO number" };

    const tag = liveBySo.get(so);
    if (tag === undefined) return { action: "skip", order, reason: "no live tag" };

    if (matched.has(`${tag.id}:${order.id}`)) {
      return { action: "skip", order, reason: "already matched" };
    }

    if (order.isRemoved) return { action: "record_only", order, tag, reason: "bill removed" };
    if (order.workflowStage === "dispatched") {
      return { action: "record_only", order, tag, reason: "already dispatched" };
    }
    if (order.workflowStage === "cancelled") {
      return { action: "record_only", order, tag, reason: "bill cancelled" };
    }

    return { action: tag.tag === "ci" ? "hold_and_ci" : "hold", order, tag };
  });
}

// ── The executor ─────────────────────────────────────────────────────────────

/**
 * Apply live Telephonic tags to the bills of one import batch.
 *
 * Pass the SAME OBD list the no-mail-order fallback receives, and call it
 * immediately before that fallback. Three batched reads — orders, so_tags,
 * so_tag_matches — never a query per bill.
 *
 * 🔴 NEVER THROWS. It runs inside an import; an error on one bill is logged
 * with its OBD and the next bill proceeds. The summary is returned (and
 * logged) for the caller's diagnostics only.
 */
export async function applySoTagHolds(
  obdNumbers: readonly (string | null)[],
  now: Date,
): Promise<SoTagApplySummary> {
  const summary: SoTagApplySummary = {
    held: 0, ciRaised: 0, ciSkipped: 0, recordOnly: 0, skipped: 0, errors: 0,
  };

  try {
    const unique = Array.from(new Set(obdNumbers.filter((o): o is string => Boolean(o))));
    if (unique.length === 0) return summary;

    // ── Read 1: the batch's orders (removed included — the planner records them).
    const orders = await prisma.orders.findMany({
      where: { obdNumber: { in: unique } },
      select: {
        id: true, obdNumber: true, soNumber: true, workflowStage: true,
        isRemoved: true, dispatchStatus: true, obdEmailDate: true,
      },
    });
    const soNumbers = Array.from(
      new Set(orders.map((o) => normaliseSo(o.soNumber)).filter((s): s is string => s !== null)),
    );
    // Never query soNumber null — a blank SO cannot match a tag.
    if (soNumbers.length === 0) return summary;

    // ── Read 2: live tags for those SOs.
    const tags = await prisma.so_tags.findMany({
      where: {
        soNumber: { in: soNumbers },
        isRemoved: false,
        status: { in: ["waiting", "matched"] },
        expiresAt: { gt: now },
      },
      select: {
        id: true, soNumber: true, tag: true, status: true,
        isRemoved: true, expiresAt: true, addedById: true,
      },
    });
    if (tags.length === 0) return summary;

    // ── Read 3: matches already recorded for these tags × these orders.
    const matches = await prisma.so_tag_matches.findMany({
      where: { soTagId: { in: tags.map((t) => t.id) }, orderId: { in: orders.map((o) => o.id) } },
      select: { soTagId: true, orderId: true },
    });

    const decisions = planSoTagApplications(orders, tags, matches, now);
    // Local copy of each tag's status, so the second bill of one tag in the
    // same batch does not re-flip it.
    const tagStatus = new Map(tags.map((t) => [t.id, t.status]));

    for (const d of decisions) {
      if (d.action === "skip") {
        summary.skipped += 1;
        continue;
      }
      const { order, tag } = d;
      try {
        // ── 1. CLAIM ────────────────────────────────────────────────────────
        let matchId: number;
        try {
          const claim = await prisma.so_tag_matches.create({
            data: {
              soTagId: tag.id,
              orderId: order.id,
              obdNumber: order.obdNumber,
              ciSkipReason: d.action === "record_only" ? d.reason : null,
            },
            select: { id: true },
          });
          matchId = claim.id;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            console.debug(
              `[telephonic] OBD ${order.obdNumber}: tag #${tag.id} already claimed by another run — skipped`,
            );
            summary.skipped += 1;
            continue;
          }
          throw err;
        }

        if (d.action === "record_only") {
          summary.recordOnly += 1;
          console.warn(
            `[telephonic] OBD ${order.obdNumber} / SO ${order.soNumber}: ${tag.tag} tag not applied — ${d.reason}`,
          );
        } else {
          // ── 2. HOLD ───────────────────────────────────────────────────────
          if (order.dispatchStatus !== null) {
            // Enrichment already set a status from a mail order. The tag wins:
            // a wrong hold costs one Release click; a wrong dispatch puts goods
            // in front of a picker.
            console.warn(
              `[telephonic] CLASH OBD ${order.obdNumber} / SO ${order.soNumber}: mail order set ` +
                `dispatchStatus '${order.dispatchStatus}', ${tag.tag} tag holds it`,
            );
          }
          // ONE orders.update per bill. heldAt = the arrival date, the same
          // rule enrichment (applyMailOrderEnrichment) and Floor's hold action
          // use — the read side derives "held since" from the log row below.
          try {
            await prisma.orders.update({
              where: { id: order.id },
              data: { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? now },
            });
            // ONE log row. toStage stays the unchanged workflowStage — a hold does
            // not advance a bill; the NOTE is what identifies the hold event
            // (lib/floor/hold-log.ts). changedById = the operator who typed the tag.
            await prisma.order_status_logs.create({
              data: {
                orderId: order.id,
                fromStage: order.workflowStage,
                toStage: order.workflowStage,
                changedById: tag.addedById,
                note: TELEPHONIC_HOLD_NOTE,
              },
            });
          } catch (holdErr) {
            // 🔴 SHOWN, NOT RETRIED. The claim stands (imports never revisit an
            // existing bill, so a retry would almost never fire); the match row
            // says "hold failed" and the tab shows the bill's LIVE dispatchStatus,
            // so a bill that is not actually held is visible and Floor can hold it
            // by hand. Best effort — its own try/catch. No CI for this bill: the
            // rethrow below lands in the per-bill catch, which skips steps 3-4.
            try {
              await prisma.so_tag_matches.update({
                where: { id: matchId },
                data: { ciSkipReason: "hold failed" },
              });
            } catch (reasonErr) {
              console.error(
                `[telephonic] OBD ${order.obdNumber}: could not record "hold failed" on match #${matchId}:`,
                reasonErr,
              );
            }
            throw holdErr;
          }
          summary.held += 1;

          // ── 3. CI ─────────────────────────────────────────────────────────
          if (d.action === "hold_and_ci") {
            const ci = await raiseBillOnlyCi({ orderId: order.id, raisedById: tag.addedById });
            if (ci.status === "raised") {
              summary.ciRaised += 1;
            } else {
              summary.ciSkipped += 1;
              await prisma.so_tag_matches.update({
                where: { id: matchId },
                data: { ciSkipReason: ci.status === "skipped" ? ci.reason : `failed: ${ci.error}` },
              });
            }
          }
        }

        // ── 4. TAG ──────────────────────────────────────────────────────────
        if (tagStatus.get(tag.id) === "waiting") {
          // Guarded on status so a concurrent run cannot overwrite the FIRST
          // match's matchedAt.
          await prisma.so_tags.updateMany({
            where: { id: tag.id, status: "waiting" },
            data: { status: "matched", matchedAt: now },
          });
          tagStatus.set(tag.id, "matched");
        }
      } catch (err) {
        summary.errors += 1;
        console.error(`[telephonic] FAILED on OBD ${order.obdNumber} (tag #${tag.id}):`, err);
      }
    }
  } catch (err) {
    summary.errors += 1;
    console.error("[telephonic] FAILED before applying any tag:", err);
  }

  if (summary.held + summary.recordOnly + summary.errors > 0) {
    console.log("[telephonic] applied", summary);
  }
  return summary;
}
