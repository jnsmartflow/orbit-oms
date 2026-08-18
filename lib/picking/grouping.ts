// Picking — the pick-bundling engine. Two rules, both pure.
//
// ⚠ MOVED HERE FROM lib/floor/grouping.ts on 2026-08-18 (`git mv`, so
// `git log --follow` keeps its history). ZERO behaviour change in that move —
// not a rule, not a threshold, not a label. Only the address changed.
//
// WHY PICKING OWNS THIS. The rules answer a PICKING question — "can one man
// fetch these bills together?" — and the Picking phone board is about to ask it
// as well as Floor's By-group view. Two copies of a rule drift; this repo has
// ONE OWNER PER BEHAVIOUR, and it already fixed the direction for exactly this
// case: Picking owns the shared picking logic, Floor imports it. lib/picking/
// sort.ts is the precedent — lib/floor/sort.ts composes FLOOR_SPINE out of its
// rule objects and never copies one. Its FIRST consumer being Floor does not
// make it Floor's, any more than sortPickingQueue belongs to Floor.
//
// OWNED BY `docs/CLAUDE_PICKING.md`. Floor is a CALLER (CLAUDE_FLOOR.md's
// ownership table — "Floor Control reuses Picking as a CALLER").
//
// PURE. No Prisma, no fetch, no Date.now(), no clock of any kind, no I/O.
// Everything it needs arrives in `candidates`. Nothing it produces is stored:
// there is no table, no column, no cache — the board recomputes this on every
// load (CLAUDE_FLOOR.md §3's feeds are the only reads involved on Floor's side).
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

import type { OilGroup, PickGroup, PickGroupCandidate } from "./types";

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
 * (getFloorBoard's `waitingSkus`, lib/floor/queries.ts) guarantees it — each
 * caller is responsible for its own producer.
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

// ═════════════════════════════════════════════════════════════════════════════
// RULE 2 — the oil-paint (10K warehouse) bundler. A TRIAL, flag-gated at
// each CALLER's own flag — Floor's is RULE2_ENABLED in lib/floor/queries.ts,
// which gates Floor's catalog fetch and therefore Floor's groups. The flag
// deliberately did NOT move with the engine: it gates a FETCH, not a rule, and a
// second surface will want its own rollout switch rather than sharing Floor's.
// Rule 2 lives ALONGSIDE Rule 1 and never
// inside it: buildPickGroups above is untouched and its output is unchanged
// whether this half runs or not.
//
// ⚠️ ORDER OF PLAY, non-negotiable. Rule 1 runs FIRST over the whole waiting
// pool; Rule 2 is handed only the bills Rule 1 left behind (`ungrouped`). A
// bill can never appear in both, and Rule 1 always wins.
//
// WHY A SECOND RULE AT ALL, AND WHY IT IS NOT A VARIANT OF THE FIRST.
// Rule 1 saves a repeated SHELF: two bills want the same tin, so one man picks
// it once. Its unit of saving is a shared SKU code, which is why "adds zero new
// SKUs" is exactly the right test for it.
// Rule 2 saves a repeated JOURNEY: several bills all want material from the same
// end of the depot, so one man walks there once instead of three men walking
// there three times. A journey is saved whether or not the bills want the same
// tin — and that is the whole point.
//
// ⚠️ THE SHARED-SKU CONDITION WAS HERE AND WAS WRONG. DO NOT REINTRODUCE IT.
// Rule 2 was first written as "each rider shares ≥ 1 SKU with the main, at least
// one of them oil" — Rule 1's test wearing Rule 2's name. Live counter-example,
// 18 Aug, two bills waiting at the same moment:
//     9108973203  Gloss Sky Blue 1L          + Gloss Bus Green 1L
//     9108973205  Gloss Intermediate Base .9L + Gloss Dark Brown 500ML
// Both 100% Gloss, both two items, plainly ONE man's trip to the Gloss racks —
// and the rule refused them, because not one code matched. Any future "but they
// should have something in common" instinct is this bug returning; the thing
// they have in common is the AREA, and the qualifier already tests for it.
//
// STABILITY — this replaced a real weakness, it did not inherit one.
// The old shared-SKU version was deterministic per load but NOT stable across
// loads: a rider needing one shared code could legitimately attach to several
// different mains, so which main won depended on the pool's exact composition
// at that instant, and a bill arriving could reshuffle unrelated bundles. The
// 30-day read caught the same main offering a 2-bill group at one moment and a
// 3-bill group at another. THAT IS GONE. Membership is now a straight walk down
// one total order, filling groups until they are full — no bill "attaches" to
// any other, so nothing competes for a partner. An arriving bill can still shift
// the packing boundaries downstream of where it lands (any packing has that),
// but it cannot make two settled bills change their minds about each other.
// Deterministic per load AND materially steadier across loads than the version
// this replaced.

/** The 10K warehouse's four product families, expressed as a RULE over the
 *  catalog's OWN columns. Deliberately NOT a database column and NOT a new
 *  table: there is no warehouse/zone/area field anywhere in the schema, adding
 *  one would mean hand-tagging 1,743 SKUs and keeping them tagged, and a 30-day
 *  read showed these four rules already place ~95% of live pick lines.
 *
 *  `paintType: null` means "category alone decides"; a string means BOTH must
 *  match — `SATIN`/`PRIMER` genuinely straddle (SATIN is 27 oil vs 14 water,
 *  PRIMER 16 oil / 15 water / 5 wood), so category alone would be wrong there. */
const OIL_PAINT_RULES: ReadonlyArray<{ category: string; paintType: string | null }> = [
  { category: "GLOSS", paintType: null },
  { category: "PROMISE ENAMEL", paintType: null },
  { category: "SATIN", paintType: "oil" },
  { category: "PRIMER", paintType: "oil" },
];

/** A bill's SKUs must be at least HALF oil paint to qualify. Half, not more
 *  than half: a 2-SKU bill of 1 oil + 1 other qualifies, and that is deliberate
 *  — the 30-day read found 13 of 69 groups existed ONLY because of that case. */
const OIL_QUALIFY_SHARE = 0.5;

/** Cap on a finished group's TOTAL distinct SKUs. There is no separate per-bill
 *  cap any more: with no main bill there is no bill whose width matters on its
 *  own, and a single bill wider than this simply never fits with anything. */
const OIL_MAX_SKUS = 10;

/** 4 bills per group, same ceiling as Rule 1's 1 main + 3 riders. */
const OIL_MAX_BILLS = 4;

/**
 * Is this catalog row an oil-paint (10K warehouse) SKU?
 *
 * ⚠ UNKNOWN IS NEVER INSIDE. A code with no `sku_master_v2` row never reaches
 * this function at all (buildOilSkuSet only sees rows that matched), and a row
 * with a null/blank category or a null paintType where the rule needs "oil"
 * returns false. That is the same safe direction as the zero-SKU guard in
 * buildPickGroups step 1: when in doubt, stay OUT of the bundle. ~24% of live
 * SKU codes are uncatalogued, so this is the common case, not the corner.
 */
export function isOilPaint(category: string | null, paintType: string | null): boolean {
  if (category === null || category === "") return false;
  for (const rule of OIL_PAINT_RULES) {
    if (rule.category !== category) continue;
    if (rule.paintType === null) return true;
    if (rule.paintType === paintType) return true;
  }
  return false;
}

/**
 * Turn matched catalog rows into the set of oil-paint SAP codes.
 *
 * ⚠ The `material` values here are `sku_master_v2.material`, matched by the
 * caller against `import_raw_line_items.skuCodeRaw` — the SAP code, the stable
 * natural key. NEVER a `skuId` and never anything off old `sku_master`
 * (CORE §13: the two catalog tables share no id space, so an id comparison
 * would put unrelated products in the same warehouse area with total
 * confidence).
 */
export function buildOilSkuSet(
  rows: ReadonlyArray<{ material: string; category: string | null; paintType: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (isOilPaint(row.category, row.paintType)) set.add(row.material);
  }
  return set;
}

/** How much of a bill is oil paint, as a fraction of its distinct SKUs.
 *
 *  ⚠ THE STEP-1 LANDMINE IN ITS RATIO FORM — the zero guard is load-bearing.
 *  "All of this bill's SKUs are oil paint" is VACUOUSLY TRUE of a bill with no
 *  SKUs, exactly as "adds zero new SKUs" is (see buildPickGroups step 1). Such a
 *  bill would qualify at a perfect 100%, be packed into a group, and read to the
 *  operator as a real bill to fetch when there is nothing on it at all. Guard
 *  first, divide second — 0/0 is not 100%, and it is not a NaN we can afford to
 *  let loose in a comparison either (every `NaN >= x` is false, so it would
 *  behave correctly here by accident and wrongly the first time someone sorts
 *  on it).
 */
function oilShare(candidate: PickGroupCandidate, oilSkus: ReadonlySet<string>): number {
  if (candidate.skus.length === 0) return 0;
  let oil = 0;
  for (const code of candidate.skus) {
    if (oilSkus.has(code)) oil++;
  }
  return oil / candidate.skus.length;
}

/**
 * Pack waiting bills that live in the oil-paint end of the warehouse into
 * shared trips.
 *
 * Takes the FULL leftover list from Rule 1 (qualifying or not) and returns, like
 * buildPickGroups, the groups plus every candidate that ended in none — in the
 * CALLER'S original order, so an ungrouped list renders without a second sort
 * deciding something on its own. A bill that does not qualify is never eligible
 * and falls straight through to `ungrouped`.
 *
 * QUALIFY: at least half of a bill's distinct SKUs are oil paint. Nothing else.
 * Bills need NOTHING in common with each other — see the shared-SKU note above.
 *
 * PACK, in one deterministic walk:
 *   1. sort the qualifiers: oil share DESC (purest bills first, so the cleanest
 *      single-area trips form before anything gets diluted), then distinct-SKU
 *      count DESC, then obdNumber ASC. obdNumber is `@unique` on `orders`, so
 *      that last key makes this a TOTAL order — no ties survive it, which is
 *      what the determinism contract rests on.
 *   2. walk it, adding each bill to the open group while BOTH hold:
 *        - the group has fewer than 4 bills
 *        - the group's TOTAL distinct SKUs would stay at 10 or under
 *      when a bill fits neither, close the open group and start a new one with
 *      that bill.
 *   3. a group of one is not a group — its bill goes to `ungrouped`.
 *
 * ⚠ THERE IS NO MAIN BILL. Every member is a peer, which is the honest
 * description: the saving is one walk to a family of racks, not one man's walk
 * that others happen to ride. Do not reintroduce a main to make the UI easier —
 * the UI was stripped to match this, not the other way round.
 *
 * `candidates[].skus` must already be distinct; this does not re-dedupe.
 * `oilSkus` is the output of buildOilSkuSet — an EMPTY set is a valid input and
 * yields zero groups, which is exactly what RULE2_ENABLED=false produces.
 */
export function buildOilGroups(
  candidates: PickGroupCandidate[],
  oilSkus: ReadonlySet<string>,
): { groups: OilGroup[]; ungrouped: number[] } {
  // ── 1. Only bills that are at least half oil paint ────────────────────────
  const shareOf = new Map<number, number>();
  const eligible: PickGroupCandidate[] = [];
  for (const c of candidates) {
    const share = oilShare(c, oilSkus);
    shareOf.set(c.orderId, share);
    if (c.skus.length > 0 && share >= OIL_QUALIFY_SHARE) eligible.push(c);
  }

  // ── 2. The packing order — a TOTAL order, obdNumber last ──────────────────
  const ordered = [...eligible].sort((a, b) => {
    const sa = shareOf.get(a.orderId) ?? 0;
    const sb = shareOf.get(b.orderId) ?? 0;
    if (sa !== sb) return sb - sa;
    if (a.skus.length !== b.skus.length) return b.skus.length - a.skus.length;
    return a.obdNumber.localeCompare(b.obdNumber, LOCALE);
  });

  // ── 3. One straight walk, filling a group until it cannot take the next ───
  // No bill chooses a partner and none competes for one, so nothing here can
  // reshuffle settled pairs when the pool changes — see the STABILITY note
  // above the oil-paint rules.
  const packed: PickGroupCandidate[][] = [];
  let open: PickGroupCandidate[] = [];
  let openSkus = new Set<string>();

  for (const cand of ordered) {
    if (open.length > 0) {
      const merged = new Set(Array.from(openSkus));
      for (const code of cand.skus) merged.add(code);
      const fits = open.length < OIL_MAX_BILLS && merged.size <= OIL_MAX_SKUS;
      if (fits) {
        open.push(cand);
        openSkus = merged;
        continue;
      }
      // Cannot be extended — close it and start again with this bill.
      packed.push(open);
    }
    open = [cand];
    openSkus = new Set(cand.skus);
  }
  if (open.length > 0) packed.push(open);

  // ── 4. A group of one is not a group ──────────────────────────────────────
  const groups: OilGroup[] = [];
  for (const members of packed) {
    if (members.length < 2) continue;

    const all = new Set<string>();
    let hasNonOil = false;
    let allPure = true;
    for (const m of members) {
      for (const code of m.skus) {
        all.add(code);
        if (!oilSkus.has(code)) hasNonOil = true;
      }
      if ((shareOf.get(m.orderId) ?? 0) < 1) allPure = false;
    }

    groups.push({
      // Identity, NOT a main: the first member in the packing order. Stable
      // because that order is total.
      id: members[0].orderId,
      members,
      totalSkus: all.size,
      hasNonOil,
      allPure,
    });
  }

  // ── 5. Everything else, in the caller's original order ────────────────────
  // Built from `candidates`, not `eligible`, so bills that never qualified and
  // bills left alone by the packing are both accounted for here rather than
  // vanishing from the answer.
  const grouped = new Set<number>();
  for (const group of groups) {
    for (const m of group.members) grouped.add(m.orderId);
  }
  const ungrouped = candidates.filter((c) => !grouped.has(c.orderId)).map((c) => c.orderId);

  return { groups, ungrouped };
}
