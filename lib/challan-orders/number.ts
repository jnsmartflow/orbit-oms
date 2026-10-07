// lib/challan-orders/number.ts
//
// ORB NUMBERS — GAPLESS (Challan orders slice 3, 2026-10-07; owner decision S3-4,
// web-update-2026-10-06-challan-orders.md §4c; plan code-plan-2026-10-07-challan-slice3.md §2, Option B).
//
// 🔴 THE LOWEST FREE NUMBER, NOT MAX+1 — the trip-number rule (lib/trips/number.ts).
// A create that fails gives its number back, and the next press takes it, so the
// year's numbers stay a gapless run. The accepted cost (owner, 7 Oct): numbers can
// be handed out OUT OF ORDER — 06, 08, then 07 — exactly as trip numbers are.
//
// 🔴 THE CLAIM IS ONE orders.update, AND orders_obdNumber_key IS THE LOCK. No
// $transaction (CORE §3), no counter table. Two presses that read the same free
// number both try the update; Postgres lets one win and the other gets P2002 and
// re-reads (lib/challan-orders/create.ts retries ONCE). chk_orders_orb_number
// (live) rejects a malformed number and an ORB number on a non-challan row.
//
// 🔴 A NUMBER HELD BY A DARK ROW IS NOT FREE. The read below sees every orders row
// whose obdNumber starts ORB-{YYYY}-, visible or not, so a create in flight keeps
// its number. A dark row left holding one by a failure that could not even undo
// itself is released by releaseStaleClaims() — which every create runs first.

import { prisma } from "@/lib/prisma";
import { formatOrbNumber, orbYearPrefix } from "./orb-number";

/**
 * removalReason on a challan order still being built (dark, isRemoved = true).
 * ONE constant: create.ts writes it, releaseStaleClaims() and the admin
 * removed-orders guard read it.
 */
export const CHALLAN_STAGING = "challan order — being created";

/**
 * The rows the admin removed-orders list and its Restore must never offer: a
 * challan order (only ever "removed" while being built) and any dark row a
 * challan create left behind, claimed or not. A restore would put a half-built
 * bill on every board. removalReason is NULLABLE — the NOT is written as a
 * NULL-safe keep (CORE §13: a bare `NOT { removalReason }` would drop every
 * removed order whose reason is null).
 */
export const NOT_CHALLAN_STAGING_WHERE = {
  isChallanOrder: false,
  OR: [{ removalReason: null }, { removalReason: { not: CHALLAN_STAGING } }],
};

/**
 * How old a dark CLAIMED row must be before the next create releases its number.
 * Far past the create route's maxDuration (60 s), so a create still running is
 * never touched.
 */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** The obdNumber a released row is parked under — never starts ORB-, unique by id. */
export function deadKey(orderId: number): string {
  return `CO-DEAD-${orderId}`;
}

/** The IST calendar year of an instant (lib/ci/number.ts's rule). */
export function istYear(at: Date): number {
  return new Date(at.getTime() + 5.5 * 60 * 60 * 1000).getUTCFullYear();
}

/**
 * The lowest free ORB number for the IST year of `at`. Reads every ORB number of
 * that year (a few thousand at most) and walks for the first missing seq ≥ 1.
 */
export async function lowestFreeOrbNumber(at: Date): Promise<string> {
  const year = istYear(at);
  const prefix = orbYearPrefix(year);
  const rows = await prisma.orders.findMany({
    where: { obdNumber: { startsWith: prefix } },
    select: { obdNumber: true },
  });
  const taken = new Set<number>();
  for (const r of rows) {
    const seq = Number.parseInt(r.obdNumber.slice(prefix.length), 10);
    if (Number.isFinite(seq) && seq > 0) taken.add(seq);
  }
  let seq = 1;
  while (taken.has(seq)) seq += 1;
  return formatOrbNumber(year, seq);
}

/**
 * Move a dark claimed row (and its children) off its ORB number, freeing it.
 * Children are re-keyed BY ID (rawSummaryId / orderId), never by the number.
 * isChallanOrder goes false in the SAME write as the number — the CHECK forbids
 * a challan row without an ORB number. The row stays dark (isRemoved = true).
 */
export async function releaseClaim(order: { id: number; batchId: number }): Promise<void> {
  const parked = deadKey(order.id);
  await prisma.orders.update({
    where: { id: order.id },
    data: { obdNumber: parked, isChallanOrder: false },
  });
  const summaries = await prisma.import_raw_summary.findMany({
    where: { batchId: order.batchId },
    select: { id: true },
  });
  for (const s of summaries) {
    await prisma.import_raw_summary.update({ where: { id: s.id }, data: { obdNumber: parked } });
    await prisma.import_raw_line_items.updateMany({ where: { rawSummaryId: s.id }, data: { obdNumber: parked } });
  }
  await prisma.import_obd_query_summary.updateMany({ where: { orderId: order.id }, data: { obdNumber: parked } });
}

/**
 * Release every dark CLAIMED row older than STALE_CLAIM_MS. Run by every create
 * before it allocates, so a number stranded by a failure is the one it gets.
 * Each release is best-effort: one that fails is logged and retried next time.
 */
export async function releaseStaleClaims(now: Date): Promise<number> {
  const stale = await prisma.orders.findMany({
    where: {
      isChallanOrder: true,
      isRemoved: true,
      removalReason: CHALLAN_STAGING,
      createdAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) },
    },
    select: { id: true, batchId: true, obdNumber: true },
  });
  let released = 0;
  for (const o of stale) {
    try {
      await releaseClaim(o);
      released += 1;
      console.warn(`[challan-orders] released stale claim ${o.obdNumber} (order ${o.id})`);
    } catch (err) {
      console.error(`[challan-orders] could not release stale claim ${o.obdNumber} (order ${o.id})`, err);
    }
  }
  return released;
}
