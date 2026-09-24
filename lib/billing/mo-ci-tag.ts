// lib/billing/mo-ci-tag.ts
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 BILLING "CI" ON A MAIL ORDER — THE ONE-TAG-PER-SO RULES
// ═══════════════════════════════════════════════════════════════════════════
//
// Design: docs/prompts/drafts/web-update-2026-09-24-billing-mo-actions.md §3.2,
// §3.6 (gate G5, re-gate R4).
//
// Billing presses CI on a mail order. The MARK lives on the mail order
// (mo_orders.billOnlyAt/ById). Once the mail order has an SO number, the mark is
// expressed as an so_tags row, tag 'ci', fromMailOrder = true — the SAME engine
// the Billing · Telephonic tab uses (lib/billing/telephonic-apply.ts raises the
// CI and cancels the bill when the OBD imports).
//
// THE RULES (§3.6):
//   • One live tag per SO — the partial unique so_tags_soNumber_live_key
//     (soNumber WHERE isRemoved = false) covers waiting, matched AND expired tags.
//   • "Matched" = at least one so_tag_matches row. Never "status = waiting": a
//     tag can still read waiting after a bill matched (a failed hold).
//   • CI vs an existing Telephonic HOLD tag: no match rows → soft-remove the hold
//     (removedById = the presser) and insert 'ci'; match rows → refused.
//   • CI vs an existing 'ci' tag: no new tag — JOIN it (fromMailOrder = true,
//     far-future expiry).
//   • Two mail orders on one SO share ONE tag. Un-pressing on one removes the
//     tag only when no other marked mail order holds that SO.
//   • Mail-order tags never expire: expiresAt = 2099-12-31. The existing expiry
//     checks stay as they are.
//   • Un-press is refused once the tag has match rows (no undo from billing; a
//     CI void is ROADMAP).
//   • Re-punch (the SO number changes on a marked mail order) moves the tag while
//     it has no match rows; once matched, changing the SO is refused.
//
// "Already imported" — marking a mail order whose SO already has OBDs applies
// the tag AT ONCE through applySoTagHolds, exactly as the Telephonic late-tag
// path does (lib/billing/telephonic.ts addTelephonicTags). Which bills the CI
// may touch is decided there, by billingRefusal (on a trip / tint room →
// record-only, with the reason on the Telephonic tab).
//
// ⚠ NOT WIRED TO ANY BUTTON YET. The only live caller is the so-number route
// (re-punch). markMoOrderCi / unmarkMoOrderCi are for the billing actions route
// (build step 9). Sequential awaits, never prisma.$transaction (CORE §3).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applySoTagHolds, type SoTagApplySummary } from "@/lib/billing/telephonic-apply";

/** Mail-order tags never expire (design §3.6). One place. */
export const MAIL_ORDER_TAG_EXPIRES_AT = new Date("2099-12-31T00:00:00Z");

export type EnsureCiTagOutcome = "created" | "joined" | "replaced_hold" | "already";

export type MoCiResult =
  | {
      ok: true;
      /** What happened to the SO's tag — null when the mail order has no SO yet. */
      tag: EnsureCiTagOutcome | "removed" | "kept_shared" | null;
      /** Bills already imported on the SO that the tag was applied to now. */
      applied: SoTagApplySummary | null;
      /** true = nothing to do (already marked / already unmarked). */
      noop?: boolean;
    }
  | { ok: false; status: 404 | 409; error: string };

function soOf(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  return t === "" ? null : t;
}

/** The ONE non-removed tag on an SO, if any (the partial unique allows one). */
async function tagOnSo(soNumber: string) {
  return prisma.so_tags.findFirst({
    where: { soNumber, isRemoved: false },
    select: { id: true, tag: true, fromMailOrder: true, expiresAt: true },
  });
}

/** "Matched" = at least one so_tag_matches row (never the status). */
async function hasMatches(soTagId: number): Promise<boolean> {
  return (await prisma.so_tag_matches.count({ where: { soTagId } })) > 0;
}

/**
 * Read-only: would ensureCiTag refuse on this SO? Returns the reason, or null.
 * The only refusal is a Telephonic HOLD tag that has already matched a bill.
 */
async function ensureCiTagRefusal(soNumber: string): Promise<string | null> {
  const existing = await tagOnSo(soNumber);
  if (existing === null || existing.tag === "ci") return null;
  if (await hasMatches(existing.id)) {
    return `SO ${soNumber} already has a Telephonic Hold that was applied to a bill — CI refused. Hold the bill on Floor, or raise the CI there.`;
  }
  return null;
}

/**
 * Make sure the SO carries ONE live 'ci' tag marked fromMailOrder.
 * Returns what happened, or a refusal. Never removes a matched tag.
 */
async function ensureCiTag(
  soNumber: string,
  userId: number,
  now: Date,
): Promise<{ ok: true; outcome: EnsureCiTagOutcome } | { ok: false; error: string }> {
  const existing = await tagOnSo(soNumber);

  if (existing !== null && existing.tag === "ci") {
    // JOIN — a Telephonic ci tag, or another mail order's. Flag it and lift its
    // expiry so it never lapses under a marked mail order.
    if (existing.fromMailOrder && existing.expiresAt.getTime() >= MAIL_ORDER_TAG_EXPIRES_AT.getTime()) {
      return { ok: true, outcome: "already" };
    }
    await prisma.so_tags.update({
      where: { id: existing.id },
      data: { fromMailOrder: true, expiresAt: MAIL_ORDER_TAG_EXPIRES_AT },
    });
    return { ok: true, outcome: "joined" };
  }

  let outcome: EnsureCiTagOutcome = "created";
  if (existing !== null) {
    // A Telephonic HOLD tag. CI beats it only while it has matched nothing.
    if (await hasMatches(existing.id)) {
      return {
        ok: false,
        error: `SO ${soNumber} already has a Telephonic Hold that was applied to a bill — CI refused. Hold the bill on Floor, or raise the CI there.`,
      };
    }
    await prisma.so_tags.updateMany({
      where: { id: existing.id, isRemoved: false },
      data: { isRemoved: true, removedAt: now, removedById: userId },
    });
    outcome = "replaced_hold";
  }

  try {
    await prisma.so_tags.create({
      data: {
        soNumber,
        tag: "ci",
        fromMailOrder: true,
        addedById: userId,
        addedAt: now,
        expiresAt: MAIL_ORDER_TAG_EXPIRES_AT,
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Someone added a tag on this SO in the same second (partial unique).
      return {
        ok: false,
        error: `Another tag was added on SO ${soNumber} at the same moment — press CI again.`,
      };
    }
    throw err;
  }
  return { ok: true, outcome };
}

/** Apply the SO's tag to bills already imported on it (the late-tag case). */
async function applyToExistingBills(soNumber: string, now: Date): Promise<SoTagApplySummary | null> {
  const existing = await prisma.orders.findMany({
    where: { soNumber, isRemoved: false },
    select: { obdNumber: true },
  });
  if (existing.length === 0) return null;
  return applySoTagHolds(existing.map((o) => o.obdNumber), now);
}

/** Soft-remove the SO's mail-order ci tag when no OTHER marked mail order holds
 *  that SO and it has matched nothing. Returns what happened. */
async function releaseSharedTag(
  soNumber: string,
  excludeMoOrderId: number,
  userId: number,
  now: Date,
): Promise<"removed" | "kept_shared" | null> {
  const tag = await tagOnSo(soNumber);
  if (tag === null || tag.tag !== "ci" || !tag.fromMailOrder) return null;
  const others = await prisma.mo_orders.count({
    where: { soNumber, billOnlyAt: { not: null }, id: { not: excludeMoOrderId } },
  });
  if (others > 0) return "kept_shared";
  if (await hasMatches(tag.id)) return null; // callers refuse before this point
  await prisma.so_tags.updateMany({
    where: { id: tag.id, isRemoved: false },
    data: { isRemoved: true, removedAt: now, removedById: userId },
  });
  return "removed";
}

// ── Press CI ─────────────────────────────────────────────────────────────────

/**
 * Billing presses CI on a mail order. The tag is written FIRST (so a refusal
 * leaves the mail order unmarked), then the mark. If the SO's bills are
 * already here, the tag is applied to them at once.
 *
 * ⚠ Mutual exclusion with Hold / Hand (design §2 "One of three") is the
 * caller's job — the actions route clears the other two in the same press.
 */
export async function markMoOrderCi(args: {
  moOrderId: number;
  userId: number;
  now: Date;
}): Promise<MoCiResult> {
  const mo = await prisma.mo_orders.findUnique({
    where: { id: args.moOrderId },
    select: { id: true, soNumber: true, billOnlyAt: true },
  });
  if (mo === null) return { ok: false, status: 404, error: "Mail order not found." };
  if (mo.billOnlyAt !== null) return { ok: true, tag: null, applied: null, noop: true };

  const so = soOf(mo.soNumber);
  let tag: EnsureCiTagOutcome | null = null;
  if (so !== null) {
    const r = await ensureCiTag(so, args.userId, args.now);
    if (!r.ok) return { ok: false, status: 409, error: r.error };
    tag = r.outcome;
  }

  await prisma.mo_orders.update({
    where: { id: mo.id },
    data: { billOnlyAt: args.now, billOnlyById: args.userId },
  });

  const applied = so !== null ? await applyToExistingBills(so, args.now) : null;
  return { ok: true, tag, applied };
}

// ── Un-press CI ──────────────────────────────────────────────────────────────

/**
 * Billing un-presses CI. Refused once the SO's tag has matched a bill. The tag
 * is removed only when no other marked mail order holds the SO. Tag first,
 * then the mark: a failure in between leaves the mark (→ the import's
 * safety-net hold), never a live tag with no mark.
 */
export async function unmarkMoOrderCi(args: {
  moOrderId: number;
  userId: number;
  now: Date;
}): Promise<MoCiResult> {
  const mo = await prisma.mo_orders.findUnique({
    where: { id: args.moOrderId },
    select: { id: true, soNumber: true, billOnlyAt: true },
  });
  if (mo === null) return { ok: false, status: 404, error: "Mail order not found." };
  if (mo.billOnlyAt === null) return { ok: true, tag: null, applied: null, noop: true };

  const so = soOf(mo.soNumber);
  let tag: "removed" | "kept_shared" | null = null;
  if (so !== null) {
    const live = await tagOnSo(so);
    if (live !== null && live.tag === "ci" && (await hasMatches(live.id))) {
      return {
        ok: false,
        status: 409,
        error: "The CI has already been applied to a bill on this SO — it can't be undone from billing.",
      };
    }
    tag = await releaseSharedTag(so, mo.id, args.userId, args.now);
  }

  await prisma.mo_orders.update({
    where: { id: mo.id },
    data: { billOnlyAt: null, billOnlyById: null },
  });
  return { ok: true, tag, applied: null };
}

// ── Re-punch ─────────────────────────────────────────────────────────────────

/**
 * Read-only, BEFORE the SO number is written: may this mail order's SO change?
 * Returns the refusal reason (the route answers 409), or null.
 * Only a CI-marked mail order can be refused.
 */
export async function precheckSoNumberChange(args: {
  moOrderId: number;
  newSoNumber: string;
}): Promise<string | null> {
  const mo = await prisma.mo_orders.findUnique({
    where: { id: args.moOrderId },
    select: { soNumber: true, billOnlyAt: true },
  });
  if (mo === null || mo.billOnlyAt === null) return null;

  const oldSo = soOf(mo.soNumber);
  const newSo = soOf(args.newSoNumber);
  if (newSo === null || oldSo === newSo) return null;

  if (oldSo !== null) {
    const live = await tagOnSo(oldSo);
    if (live !== null && live.tag === "ci" && (await hasMatches(live.id))) {
      return `This mail order is marked CI and its CI has already been applied to a bill on SO ${oldSo} — the SO number can't be changed.`;
    }
  }
  return ensureCiTagRefusal(newSo);
}

/**
 * AFTER the SO number is written on a CI-marked mail order: move the tag —
 * release the old SO's tag (unless another marked mail order still holds it),
 * ensure one on the new SO, and apply it to bills already there.
 *
 * 🔴 NEVER THROWS — the SO number is already saved. A failure is logged and
 * returned as `warning`; the mark stays, so the import's safety-net hold still
 * protects the bill (design §3.4).
 */
export async function onSoNumberChange(args: {
  moOrderId: number;
  oldSoNumber: string | null;
  newSoNumber: string;
  userId: number;
  now: Date;
}): Promise<{ moved: boolean; applied: SoTagApplySummary | null; warning: string | null }> {
  try {
    const mo = await prisma.mo_orders.findUnique({
      where: { id: args.moOrderId },
      select: { billOnlyAt: true },
    });
    if (mo === null || mo.billOnlyAt === null) return { moved: false, applied: null, warning: null };

    const oldSo = soOf(args.oldSoNumber);
    const newSo = soOf(args.newSoNumber);
    if (newSo === null || oldSo === newSo) return { moved: false, applied: null, warning: null };

    if (oldSo !== null) {
      await releaseSharedTag(oldSo, args.moOrderId, args.userId, args.now);
    }
    const r = await ensureCiTag(newSo, args.userId, args.now);
    if (!r.ok) {
      console.error(`[mo-ci-tag] mail order #${args.moOrderId}: CI tag not written on SO ${newSo}: ${r.error}`);
      return { moved: false, applied: null, warning: r.error };
    }
    const applied = await applyToExistingBills(newSo, args.now);
    return { moved: true, applied, warning: null };
  } catch (err) {
    console.error(`[mo-ci-tag] mail order #${args.moOrderId}: moving the CI tag failed:`, err);
    return {
      moved: false,
      applied: null,
      warning: "The SO number was saved, but its CI tag could not be moved — the bill will be held on import.",
    };
  }
}
