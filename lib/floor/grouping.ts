// Floor Control — the By-group pick-bundling engine.
//
// PURE. No Prisma, no fetch, no Date.now(), no clock of any kind, no I/O.
// Everything it needs arrives in `candidates`. Nothing it produces is stored:
// there is no table, no column, no cache — the board recomputes this on every
// load (CLAUDE_FLOOR.md §3's feeds are the only reads involved).
//
// THE RULE, locked from a 60-day data study. It is deliberately small:
//   - Bills are compared on `skuCodeRaw` ONLY — the SAP code, the stable
//     natural key. NEVER a `skuId`, never a `sku_master` row (CORE §13's
//     id-space landmine: the two catalog tables share no id space, so an id
//     comparison here would silently bundle unrelated products).
//   - A bill may ride another only if it adds ZERO new SKUs — every one of its
//     codes is already on the main bill. Not "mostly overlapping", not a
//     percentage: zero.
//   - At most 4 bills per group (1 main + 3 riders).
//
// NOT in the rule, and not to be added here:
//   no dispatch-slot or date filter (groups deliberately SPAN slots and days)
//   · no route filter (route is displayed by the caller, never enforced)
//   · no volume or quantity ceiling (litres are shown; the human decides)
//   · no partial overlap, no percentage, no threshold, no weighting.
//
// ⚠ DETERMINISM IS A REQUIREMENT, NOT A NICETY. The floor board runs a full
// load() on every 15s marker change and the By-group view has no pause rule of
// its own (CLAUDE_FLOOR.md §5 — the marker is paused only on history/detail-
// open; an untouched board simply refetches). Identical input MUST produce
// byte-identical output or the groups reshuffle under the operator's hand
// mid-decision. Every sort below therefore ends on a TOTAL order: `obdNumber`
// is `@unique` on `orders`, and the locale is pinned exactly as
// lib/picking/sort.ts pins it, so the depot PC and Vercel cannot disagree.

import type { PickGroup, PickGroupCandidate } from "./types";

/** Pinned for the same reason lib/picking/sort.ts pins it: an OS-locale
 *  difference between the depot PC and Vercel must not reorder anything. */
const LOCALE = "en";

/** 1 main + 3 riders. No exceptions. */
const MAX_RIDERS = 3;

/**
 * Step 2's ordering key, reused verbatim for the rider ordering in step 3 so
 * the two can never drift: distinct-SKU count DESC, then obdNumber ASC.
 *
 * Count-descending is what makes the greedy walk sensible — the widest bill
 * gets first refusal on being a main, and among riders the widest ones are
 * taken first, which is also what maximises savedTrips within the cap of 3.
 */
function compareCandidates(a: PickGroupCandidate, b: PickGroupCandidate): number {
  if (a.skus.length !== b.skus.length) return b.skus.length - a.skus.length;
  return a.obdNumber.localeCompare(b.obdNumber, LOCALE);
}

/** True when every one of `skus` is already in `mainSkus` — i.e. this bill adds
 *  NOTHING new. The whole rule is this one line. */
function addsNothingNew(skus: string[], mainSkus: Set<string>): boolean {
  for (const code of skus) {
    if (!mainSkus.has(code)) return false;
  }
  return true;
}

/**
 * Bundle waiting bills so one picker fetches shared material once.
 *
 * Returns the groups (sorted best-first) plus every candidate that ended up in
 * no group, in the CALLER'S original order — so an ungrouped list can be
 * rendered underneath without a second sort deciding something on its own.
 *
 * `candidates[].skus` must already be distinct; this function does not
 * re-dedupe, and a duplicated code would inflate `savedTrips`. The producer
 * (getFloorBoard's `waitingSkus`, lib/floor/queries.ts) guarantees it.
 */
export function buildPickGroups(candidates: PickGroupCandidate[]): {
  groups: PickGroup[];
  ungrouped: number[];
} {
  // ── 1. Drop zero-SKU bills BEFORE anything else ──────────────────────────
  //
  // ⚠ THE ONE LANDMINE IN THIS FILE. The empty set is a subset of every set,
  // so a bill with no active line items satisfies "adds zero new SKUs" against
  // EVERY main bill on the board — it would ride free with the first main it
  // met, every load, and read to the operator as "fetch this one too, it's on
  // the way" when there is nothing to fetch at all. Roughly 9 such bills
  // appeared in the last 60 days, so this is not hypothetical.
  //
  // They are not an error and are not hidden: they fall straight through to
  // `ungrouped` below, like any other bill that found no bundle.
  const eligible = candidates.filter((c) => c.skus.length > 0);

  // ── 2. Deterministic walk order ──────────────────────────────────────────
  const ordered = [...eligible].sort(compareCandidates);

  // ── 3. Greedy walk — widest bill first gets to be a main ─────────────────
  const used = new Set<number>();
  const groups: PickGroup[] = [];

  for (const main of ordered) {
    if (used.has(main.orderId)) continue;

    const mainSkus = new Set(main.skus);
    const riders: PickGroupCandidate[] = [];

    // `ordered` is already in step 2's order, so walking it collects riders in
    // that same order and the first MAX_RIDERS are exactly the ones to keep.
    for (const cand of ordered) {
      if (cand.orderId === main.orderId) continue;
      if (used.has(cand.orderId)) continue;
      if (!addsNothingNew(cand.skus, mainSkus)) continue;
      riders.push(cand);
      if (riders.length === MAX_RIDERS) break;
    }

    // No riders — do NOT burn this bill. It stays unused and may still be
    // picked up as a rider by a wider main later in the walk.
    if (riders.length === 0) continue;

    used.add(main.orderId);
    for (const rider of riders) used.add(rider.orderId);

    groups.push({
      id: main.orderId,
      main,
      riders,
      // ── 4. Every rider SKU is a shelf the picker was visiting anyway ──────
      savedTrips: riders.reduce((sum, rider) => sum + rider.skus.length, 0),
    });
  }

  // ── 5. Best bundles first ────────────────────────────────────────────────
  groups.sort((a, b) => {
    if (a.savedTrips !== b.savedTrips) return b.savedTrips - a.savedTrips;
    return a.main.obdNumber.localeCompare(b.main.obdNumber, LOCALE);
  });

  // ── 6. Everything else, in the caller's original order ───────────────────
  // Built from `candidates`, not `eligible`, so the zero-SKU bills dropped in
  // step 1 are accounted for here rather than vanishing from the answer.
  const grouped = new Set<number>();
  for (const group of groups) {
    grouped.add(group.main.orderId);
    for (const rider of group.riders) grouped.add(rider.orderId);
  }
  const ungrouped = candidates.filter((c) => !grouped.has(c.orderId)).map((c) => c.orderId);

  return { groups, ungrouped };
}
