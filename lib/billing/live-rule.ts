// lib/billing/live-rule.ts — PURE pieces of the Billing desk on the live feed (2b-ii, 2026-09-30).
// No React, no fetch. Tested in live-rule.test.ts. The React side: components/billing/billing-live.tsx.

import { SYNC_MAX_IDS, SYNC_MAX_SHOWN, type SyncBody } from "@/lib/billing/sync-rule";

/** The four arms with a pill count and a subscriber context (the Orders tab is separate). */
export type BillingArm = "picking" | "print" | "telephonic" | "pickDelete";
export const BILLING_ARMS: readonly BillingArm[] = ["picking", "print", "telephonic", "pickDelete"];

export type BillingCounts = Partial<Record<BillingArm, number>>;

/** The feed's topics for Billing (plan §D). */
export const BILLING_TOPICS = "order,trip,config,mail_order,so_tag";

/** The work a glance handed out (lib/live/feed-core.ts Work, patch kind). */
export interface BillingPatch {
  orderIds: number[];
  tripIds: number[];
  extra?: Record<string, (number | string)[]>;
}

const nums = (xs: readonly (number | string)[] | undefined): number[] =>
  (xs ?? []).map((x) => (typeof x === "number" ? x : Number(x))).filter((n) => Number.isInteger(n) && n > 0);

/**
 * The POST /api/billing/sync body for one patch: the changed ids, whether any so_tag changed, the
 * changed mail-order ids, and the ids each arm currently shows (capped at the route's limits).
 * Order / trip ids beyond the route's cap are the caller's cue for a full refresh (see
 * `tooManyForSync`), never silently cut.
 */
export function syncBodyFromPatch(patch: BillingPatch, shown: Partial<Record<BillingArm, readonly number[]>>): SyncBody {
  const cap = (xs: readonly number[] | undefined) => Array.from(new Set(xs ?? [])).slice(0, SYNC_MAX_SHOWN);
  return {
    orderIds: patch.orderIds,
    tripIds: patch.tripIds,
    soTagChanged: nums(patch.extra?.so_tag).length > 0,
    mailOrderIds: nums(patch.extra?.mail_order).slice(0, SYNC_MAX_IDS),
    shown: {
      pickingIds: cap(shown.picking),
      printTripIds: cap(shown.print),
      telephonicOrderIds: cap(shown.telephonic),
      pickDeleteIds: cap(shown.pickDelete),
    },
  };
}

/** More ids than one sync call takes → refresh everything instead (counts + every open tab). */
export function tooManyForSync(patch: BillingPatch): boolean {
  return patch.orderIds.length > SYNC_MAX_IDS || patch.tripIds.length > SYNC_MAX_IDS;
}

/** Did this patch carry a mail-order change? (The Orders tab reloads its day list.) */
export function hasMailOrderChange(patch: BillingPatch): boolean {
  return nums(patch.extra?.mail_order).length > 0;
}

/** The arms a sync answer says to refresh — touched AND permitted, in a fixed order. */
export function armsToFire(
  touched: Partial<Record<BillingArm, boolean>>,
  permitted: Readonly<Record<BillingArm, boolean>>,
): BillingArm[] {
  return BILLING_ARMS.filter((a) => touched[a] === true && permitted[a]);
}

/** Merge a sync (or initial read) answer's counts into the pills' counts; untouched arms keep theirs. */
export function mergeCounts(prev: BillingCounts, next: BillingCounts): BillingCounts {
  const out: BillingCounts = { ...prev };
  for (const a of BILLING_ARMS) {
    const v = next[a];
    if (typeof v === "number" && Number.isFinite(v)) out[a] = v;
  }
  return out;
}

/**
 * The four markers to read ONCE at start (and on a full refresh) — only the arms the viewer holds.
 * The Picking marker takes the header's day (its `latest` is day-scoped; its count is all-dates).
 */
export function initialCountRequests(
  permitted: Readonly<Record<BillingArm, boolean>>,
  date: string,
): { arm: BillingArm; url: string }[] {
  const urls: Record<BillingArm, string> = {
    picking: `/api/billing/picking/marker?date=${encodeURIComponent(date)}`,
    print: "/api/billing/print/marker",
    telephonic: "/api/billing/telephonic/marker",
    pickDelete: "/api/billing/pick-delete/marker",
  };
  return BILLING_ARMS.filter((a) => permitted[a]).map((arm) => ({ arm, url: urls[arm] }));
}

/** A marker body's count, or null. */
export function markerCount(body: unknown): number | null {
  const c = (body as { count?: unknown } | null)?.count;
  return typeof c === "number" && Number.isFinite(c) ? c : null;
}

/**
 * One subscriber context's "fire, unless someone holds it paused — then fire ONCE on release" —
 * the contract usePickingMarker's `paused` gives the legacy path, kept for the live path.
 */
export class PausedFire {
  private pending = false;
  /** A change arrived. true → fire now; false → held until release. */
  request(paused: boolean): boolean {
    if (paused) {
      this.pending = true;
      return false;
    }
    return true;
  }
  /** The last pause was released. true → fire exactly once now. */
  release(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    return true;
  }
  isPending(): boolean {
    return this.pending;
  }
}
