// lib/billing/telephonic-apply.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE IMPORT HOOK FOR SO TAGS — HOLD, AND THE BILL-ONLY CI + CANCEL
// ═══════════════════════════════════════════════════════════════════════════
//
// A telephonic order has no mail order, so the no-mail-order fallback
// (app/api/import/obd/route.ts, applyNoMailOrderFallback) would release it to
// picking the moment its OBD lands. Billing types the SO number on the
// Telephonic tab with a tag — 'hold' or 'ci' (so_tags). Billing can also press
// CI on a MAIL order (mo_orders.billOnlyAt), which writes a 'ci' tag with
// fromMailOrder = true (lib/billing/mo-ci-tag.ts). This hook runs at every
// fallback call site, AFTER applyMailOrderEnrichment and immediately BEFORE the
// fallback.
//
// 🔴 THE ORDER IS LOAD-BEARING. The fallback only releases bills whose
// dispatchStatus is null; a bill this hook has held or cancelled is invisible
// to it — no second write, no false "Auto-dispatched on import" log line.
//
// Designs: docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md §5
//          docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §3.3–§3.5
//
// TWO HALVES:
//   planSoTagApplications — PURE. No Prisma, no clock (`now` is passed in).
//                           Decides per order; testable with no database.
//   applySoTagHolds       — the executor. Three batched reads, then the
//                           decisions in order. NEVER THROWS into the import.
//
// Per acting bill, IN THIS ORDER, sequential awaits, never $transaction:
//
//   'hold' tag:   CLAIM → HOLD → TAG
//   'ci'   tag:   CLAIM → CI → (a) CANCEL / (b) HOLD / (c) split → TAG
//
//   1. CLAIM — insert the so_tag_matches row. Its UNIQUE (soTagId, orderId)
//      is the lock: a P2002 means another import run (auto-import fires every
//      minute; a manual paste can overlap it) got there first → skip.
//   2. HOLD  — ONE orders.update + ONE order_status_logs row (TELEPHONIC_HOLD_NOTE).
//   2'. CI tags (design §3.3, gate G4 / re-gate R1):
//      raiseBillOnlyCi FIRST, then
//      (a) raised       → Floor Raise CI's three writes (app/api/floor/ci/route.ts):
//                         orders.update {cancelled, dispatchStatus null},
//                         pick_assignments.deleteMany, ONE log
//                         "CI raised — {ciNumber} · {reason}".
//      (b) skipped/failed → today's HOLD; the reason goes in ciSkipReason and
//                         a person looks at it. Never a cancelled bill with no CI.
//      (c) raised, cancel went wrong — WHICH write failed decides it:
//           • the orders.update itself threw → try the HOLD, record "cancel failed"
//             (and "cancel failed; hold failed" if the hold throws too — the
//             fallback in this same run may then release the CI'd bill; the
//             Telephonic tab shows it and Floor cancels by hand)
//           • the update landed, the deleteMany or the log threw → record
//             "cancel incomplete" and DO NOT hold: the bill is already cancelled.
//   3. TAG   — 'waiting' → 'matched' with matchedAt = now. An already-matched
//      tag keeps its matchedAt (it records the FIRST match).
//
// record_only (removed / dispatched / cancelled bill; for 'ci' tags also a bill
// on a trip or in the tint room — billingRefusal, lib/billing/refusal.ts):
// step 1 with the reason in ciSkipReason, then step 3. No hold, no CI.
//
// ⚠ A bill that already has a match row for this tag is skipped ENTIRELY. A
// re-import must never re-hold a bill Floor has deliberately released, and
// never re-raise a CI.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { raiseBillOnlyCi } from "@/lib/ci/bill-only";
import { TELEPHONIC_HOLD_NOTE } from "@/lib/floor/hold-log";
import { billingRefusal } from "@/lib/billing/refusal";

// ── Types ────────────────────────────────────────────────────────────────────

/** The order fields the planner needs. */
export interface TagPlanOrder {
  id: number;
  obdNumber: string;
  soNumber: string | null;
  workflowStage: string;
  isRemoved: boolean;
  /** For billingRefusal('ci', …) — a CI'd bill cannot be cancelled off a trip. */
  tripDropId: number | null;
  tripNumber: string | null;
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
  /** true = written because a mail order is marked CI (so_tags.fromMailOrder). */
  fromMailOrder: boolean;
}

export interface TagPlanMatch {
  soTagId: number;
  orderId: number;
}

export type SoTagDecision<O extends TagPlanOrder = TagPlanOrder, T extends TagPlanTag = TagPlanTag> =
  | { action: "skip"; order: O; reason: "no SO number" | "no live tag" | "already matched" }
  | { action: "record_only"; order: O; tag: T; reason: string }
  | { action: "hold"; order: O; tag: T }
  | { action: "ci_cancel"; order: O; tag: T };

export interface SoTagApplySummary {
  held: number;
  /** CI raised AND the bill cancelled (path a). */
  ciRaised: number;
  /** CI refused or failed — the bill was held instead (path b). */
  ciSkipped: number;
  /** CI raised but the cancel did not complete (path c). */
  cancelFailed: number;
  recordOnly: number;
  skipped: number;
  errors: number;
}

// ── The ciSkipReason vocabulary for path (c) ─────────────────────────────────
// Written on the match row; the Telephonic tab reads them (status pills).

export const CI_CANCEL_FAILED = "cancel failed";
export const CI_CANCEL_FAILED_HOLD_FAILED = "cancel failed; hold failed";
export const CI_CANCEL_INCOMPLETE = "cancel incomplete";
export const HOLD_FAILED = "hold failed";

// ── The pure planner ─────────────────────────────────────────────────────────

/**
 * 🔴 A LIVE TAG: not removed, not expired, status 'waiting' OR 'matched'.
 * NOT 'waiting' only — the first OBD flips a tag to 'matched', and a second OBD
 * on the same SO arriving in a later import must still find it.
 * "Expired" is never stored; it is `expiresAt <= now` read here. Mail-order
 * tags carry a far-future expiresAt, so they never expire.
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
 *   removed / dispatched / cancelled  → record_only (the reason names which —
 *                                       these exact strings are what the
 *                                       Telephonic tab's status pill matches)
 *   'ci' tag + billingRefusal('ci')   → record_only (on a trip, tint room)
 *   otherwise                         → hold ('hold' tag) or ci_cancel ('ci' tag)
 *
 * Cancelled joins dispatched and removed because Floor refuses to hold a
 * cancelled bill (app/api/floor/actions/route.ts) and a "material not moved"
 * CI on a dead bill would be false. A 'ci' tag cannot cancel a bill that is on
 * a trip (the trip would never read READY) or in the tint room (an operator's
 * live assignment would be orphaned) — design §3.5.
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

    // Kept FIRST, with their exact strings — the Telephonic tab's pill matches them.
    if (order.isRemoved) return { action: "record_only", order, tag, reason: "bill removed" };
    if (order.workflowStage === "dispatched") {
      return { action: "record_only", order, tag, reason: "already dispatched" };
    }
    if (order.workflowStage === "cancelled") {
      return { action: "record_only", order, tag, reason: "bill cancelled" };
    }

    if (tag.tag === "ci") {
      const refusal = billingRefusal("ci", {
        workflowStage: order.workflowStage,
        isRemoved: order.isRemoved,
        tripDropId: order.tripDropId,
        tripNumber: order.tripNumber,
      });
      if (refusal !== null) return { action: "record_only", order, tag, reason: refusal };
      return { action: "ci_cancel", order, tag };
    }

    return { action: "hold", order, tag };
  });
}

// ── The executor ─────────────────────────────────────────────────────────────

/** The executor's view of one order (Read 1). */
interface HookOrder extends TagPlanOrder {
  dispatchStatus: string | null;
  obdEmailDate: Date | null;
}

/** ONE orders.update + ONE log row. Throws on failure — callers decide. */
async function writeHold(order: HookOrder, byId: number, now: Date): Promise<void> {
  // heldAt = the arrival date, the same rule enrichment and Floor's hold action
  // use — the read side derives "held since" from the log row below.
  await prisma.orders.update({
    where: { id: order.id },
    data: { dispatchStatus: "hold", heldAt: order.obdEmailDate ?? now },
  });
  // toStage stays the unchanged workflowStage — a hold does not advance a bill;
  // the NOTE identifies the hold event (lib/floor/hold-log.ts).
  await prisma.order_status_logs.create({
    data: {
      orderId: order.id,
      fromStage: order.workflowStage,
      toStage: order.workflowStage,
      changedById: byId,
      note: TELEPHONIC_HOLD_NOTE,
    },
  });
}

/** Best-effort write of the match row's reason — never throws. */
async function setSkipReason(matchId: number, obd: string, reason: string): Promise<void> {
  try {
    await prisma.so_tag_matches.update({ where: { id: matchId }, data: { ciSkipReason: reason } });
  } catch (err) {
    console.error(`[telephonic] OBD ${obd}: could not record "${reason}" on match #${matchId}:`, err);
  }
}

/**
 * Apply live SO tags to the bills of one import batch.
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
    held: 0, ciRaised: 0, ciSkipped: 0, cancelFailed: 0, recordOnly: 0, skipped: 0, errors: 0,
  };

  try {
    const unique = Array.from(new Set(obdNumbers.filter((o): o is string => Boolean(o))));
    if (unique.length === 0) return summary;

    // ── Read 1: the batch's orders (removed included — the planner records them).
    const rows = await prisma.orders.findMany({
      where: { obdNumber: { in: unique } },
      select: {
        id: true, obdNumber: true, soNumber: true, workflowStage: true,
        isRemoved: true, dispatchStatus: true, obdEmailDate: true,
        tripDropId: true,
        tripDrop: { select: { trip: { select: { tripNumber: true } } } },
      },
    });
    const orders: HookOrder[] = rows.map((r) => ({
      id: r.id,
      obdNumber: r.obdNumber,
      soNumber: r.soNumber,
      workflowStage: r.workflowStage,
      isRemoved: r.isRemoved,
      dispatchStatus: r.dispatchStatus,
      obdEmailDate: r.obdEmailDate,
      tripDropId: r.tripDropId,
      tripNumber: r.tripDrop?.trip.tripNumber ?? null,
    }));
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
        isRemoved: true, expiresAt: true, addedById: true, fromMailOrder: true,
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

        // A mail order already set a status (enrichment). For a Telephonic tag
        // that is a clash worth a warning — the tag wins. For a mail-order tag
        // it is expected: enrichment holds a CI-marked bill as a safety net
        // (design §3.4), so no warning.
        if (d.action !== "record_only" && order.dispatchStatus !== null && !tag.fromMailOrder) {
          console.warn(
            `[telephonic] CLASH OBD ${order.obdNumber} / SO ${order.soNumber}: mail order set ` +
              `dispatchStatus '${order.dispatchStatus}', ${tag.tag} tag overrides it`,
          );
        }

        if (d.action === "record_only") {
          summary.recordOnly += 1;
          console.warn(
            `[telephonic] OBD ${order.obdNumber} / SO ${order.soNumber}: ${tag.tag} tag not applied — ${d.reason}`,
          );
        } else if (d.action === "hold") {
          // ── 2. HOLD ───────────────────────────────────────────────────────
          try {
            await writeHold(order, tag.addedById, now);
          } catch (holdErr) {
            // 🔴 SHOWN, NOT RETRIED. The claim stands (imports never revisit an
            // existing bill, so a retry would almost never fire); the match row
            // says "hold failed" and the tab shows the bill's LIVE dispatchStatus.
            await setSkipReason(matchId, order.obdNumber, HOLD_FAILED);
            throw holdErr;
          }
          summary.held += 1;
        } else {
          // ── 2'. CI → CANCEL (a) / HOLD (b) / split (c) ────────────────────
          const ci = await raiseBillOnlyCi({ orderId: order.id, raisedById: tag.addedById });

          if (ci.status !== "raised") {
            // (b) No CI — hold for a person, and say why. Never cancel here.
            summary.ciSkipped += 1;
            await setSkipReason(
              matchId,
              order.obdNumber,
              ci.status === "skipped" ? ci.reason : `failed: ${ci.error}`,
            );
            try {
              await writeHold(order, tag.addedById, now);
            } catch (holdErr) {
              await setSkipReason(matchId, order.obdNumber, HOLD_FAILED);
              throw holdErr;
            }
            summary.held += 1;
          } else {
            // (a) CI raised → Floor Raise CI's three writes.
            let updateLanded = false;
            try {
              // ONE orders.update per bill (the live-sync markers key on
              // MAX(orders.updatedAt) — CORE §3). Clears the safety-net hold too.
              await prisma.orders.update({
                where: { id: order.id },
                data: { workflowStage: "cancelled", dispatchStatus: null },
              });
              updateLanded = true;
              // AFTER the stage write, never before (the floor cancel's orphan
              // fix). A late tag can meet a bill already with a picker.
              await prisma.pick_assignments.deleteMany({ where: { orderId: order.id } });
              await prisma.order_status_logs.create({
                data: {
                  orderId: order.id,
                  fromStage: order.workflowStage,
                  toStage: "cancelled",
                  changedById: tag.addedById,
                  note: `CI raised — ${ci.ciNumber} · ${ci.reasonLabel}`,
                },
              });
              summary.ciRaised += 1;
            } catch (cancelErr) {
              summary.cancelFailed += 1;
              if (updateLanded) {
                // (c-2) The bill IS cancelled — do not hold it.
                console.error(
                  `[telephonic] OBD ${order.obdNumber}: ${ci.ciNumber} raised and bill cancelled, ` +
                    `but the assignment delete or log failed:`,
                  cancelErr,
                );
                await setSkipReason(matchId, order.obdNumber, CI_CANCEL_INCOMPLETE);
              } else {
                // (c-1) The cancel never landed — hold the CI'd bill instead.
                console.error(
                  `[telephonic] OBD ${order.obdNumber}: ${ci.ciNumber} raised but the cancel failed — holding:`,
                  cancelErr,
                );
                try {
                  await writeHold(order, tag.addedById, now);
                  await setSkipReason(matchId, order.obdNumber, CI_CANCEL_FAILED);
                  summary.held += 1;
                } catch (holdErr) {
                  // 🔴 A CI'd bill left at its old status. If that status is null
                  // the fallback in THIS run releases it — nothing here can stop
                  // that; the tab shows "Cancel failed" and Floor cancels by hand.
                  console.error(
                    `[telephonic] OBD ${order.obdNumber}: ${ci.ciNumber} raised, cancel AND hold failed:`,
                    holdErr,
                  );
                  await setSkipReason(matchId, order.obdNumber, CI_CANCEL_FAILED_HOLD_FAILED);
                }
              }
            }
          }
        }

        // ── 3. TAG ──────────────────────────────────────────────────────────
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

  if (summary.held + summary.ciRaised + summary.cancelFailed + summary.recordOnly + summary.errors > 0) {
    console.log("[telephonic] applied", summary);
  }
  return summary;
}
