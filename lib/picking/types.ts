// Picking queue row shape — all fields already resolved upstream (route/area/
// key-customer/dealer come from the effective ship-to dealer, per step 1
// discovery). This module does no joining and no DB access.
export interface PickingQueueRow {
  orderId: number;
  obdNumber: string;
  /**
   * The dealer to show, in this order: the `delivery_point_master` name, then
   * `orders.shipToCustomerName` (SAP's own name for the bill), then the literal
   * `"(Unmatched)"` (2026-08-31). STILL NON-NULLABLE — do not widen it; every
   * consumer may keep printing it bare.
   *
   * ⚠ A name alone no longer tells you whether the dealer is on file. Before
   * this change `dealerName === "(Unmatched)"` was a usable (if ugly) test for
   * that; now an unmastered bill carries a real SAP name and that test silently
   * returns false. Read `dealerInMaster` instead — never string-compare this.
   */
  dealerName: string;
  /**
   * Did the effective dealer FK actually resolve against
   * `delivery_point_master`? False ⇒ the bill's ship-to code is not in the
   * master, so `dealerName` came from SAP and `route`/`area`/`deliveryType`/
   * `bayNumber` are all null together — they hang off the same relation and
   * SAP supplies no equivalent for any of them.
   *
   * ⚠ NOT `orders.customerMissing`. That column is stamped at import and can go
   * stale after a master backfill; this is computed at render time from whether
   * the lookup found a row, which is the only truthful answer.
   *
   * 🔴 EXACTLY ONE CONSUMER, AND IT IS NOT VISUAL (2026-09-01):
   * lib/picking/search.ts, where it drives the synthetic "unmatched" search
   * term. It briefly fed a card/header chip too (47791643); that chip was
   * REMOVED after phone review — owner decision, not a bug. Nothing on screen
   * marks these bills any more, which is exactly why the search clause is now
   * load-bearing rather than a nicety. Keep the field; do not re-derive a badge
   * from it. See docs/prompts/drafts/code-update-2026-08-31-picking-sap-name-fallback.md §9.
   */
  dealerInMaster: boolean;
  isShipToOverride: boolean;
  windowId: number | null;
  windowTime: string | null;
  windowSortOrder: number | null;
  deliveryType: string | null;
  route: string | null;
  area: string | null;
  // The loading bay this bill's material is stacked at (2026-08-21) —
  // `route_master.bayNumber`, reached through the effective dealer's AREA, i.e.
  // the SAME route that fills `route` above. Null when the route has no bay
  // (HAND, No Route) or the bill resolves to no route at all.
  //
  // ⚠ NOT PER DELIVERY TYPE and NOT UNIQUE. Bay 1 serves Adajan (Local) and
  // Navsari (Upcountry) both, so the number alone does not identify a lane —
  // it identifies a physical stack. Do not sort, group or filter on it without
  // deciding what that would mean.
  //
  // ⚠ MUST come from `area.primaryRoute`, never `delivery_point_master
  // .primaryRouteId` (stale, never read — lib/picking/queue.ts's DEALER_SELECT
  // comment). A bay read off a different route than the one on screen would
  // send a picker to the wrong stack, and nothing would look wrong.
  bayNumber: number | null;
  priorityLevel: number | null;
  isKeyCustomer: boolean;
  articleTag: string | null;
  volumeLitres: number | null;
  weightKg: number | null;
  // SAP SMU code as a STRING ("70" | "74" | "76" | "77" | "10"), or null when
  // the order has no SMU / carries a name outside the map. Added 2026-08-19 for
  // the card + detail SmuBadge.
  //
  // ⚠ DERIVED, NOT FETCHED — there is no `orders.smuCode` column and this
  // change added none. It is `orders.smu` (the NAME, already on the row for
  // free — queue.ts uses `include`, which returns every base scalar) run
  // through SMU_CODE_BY_NAME in lib/import-upsert/types.ts. Sound because the
  // name↔code relationship is a bijection verified against all 11,238
  // import_raw_summary rows; the reasoning and the "Deco"/"10" caveat live on
  // that constant, not repeated here.
  //
  // A string, not a number: it is an SAP identifier that happens to look
  // numeric, never arithmetic, and the leading-zero risk is not worth the
  // parse. Consumers compare it literally ("74" === code).
  smuCode: string | null;
  // True when TWO OR MORE live orders carry this row's soNumber. Computed in
  // one bounded groupBy per fetch by lib/picking/duplicate-so.ts — that module
  // owns the rule (which stages count, why blanks never do); it is not restated
  // here. Filled by BOTH boards: lib/picking/queue.ts and, because
  // FloorBoardRow extends this interface, lib/floor/queries.ts.
  //
  // ⚠ A BOOLEAN, AND ONLY A BOOLEAN — `soNumber` itself is deliberately NOT on
  // this row and must not be added. The card's job is to say "same SO, go
  // check"; the number is read on the detail panel, which fetches it itself
  // (FloorDetail.soNumber). Shipping the value to every card would put a
  // matching key on a client payload that has no use for one.
  //
  // ⚠ A GENUINE SAP SPLIT BILL IS ALSO FLAGGED, and that is accepted: one SO
  // legitimately fans out to several OBDs (CORE §9's applyMailOrderEnrichment
  // updateMany; app/api/billing/mail-order/actions/route.ts says the same).
  // Nothing on `orders` distinguishes a split from a re-punch, so the signal is
  // "worth a look", never "this is wrong". Do not add a suppression heuristic
  // without a decision.
  hasDuplicateSo: boolean;
  // ── Product-family fields (Picking card redesign, 2026-07-21) ──────────────
  // True when the whole OBD is a tint order. Sourced from orders.orderType
  // === 'tint' (the canonical order-type set at import) — NOT from any tint
  // skuId, which aliases rawLineItemId and is a known false positive
  // (CLAUDE_CORE.md §13). Order-level, so it is the same value on every tab.
  isTint: boolean;
  // Distinct product families on the bill, display-resolved and stable
  // alpha-sorted (locale "en") so chip order never shuffles across refreshes.
  // Each family is COALESCE(sku_master_v2.displayCategory, category), matched
  // import_raw_line_items.skuCodeRaw -> sku_master_v2.material (the natural
  // key, never the skuId FK — CLAUDE_CORE.md §13 id-space landmine). Empty
  // array when no active line resolved to a family; never null.
  families: string[];
  // Raw count of ACTIVE + VALID lines whose skuCodeRaw matched no family
  // (unmastered code, or a resolved-blank family) — a LINE count, not a
  // distinct-code count (2 unmatched tins on one OBD = 2). Powers the
  // mockup's "+N unlisted" honesty chip. 0 when every active line resolved.
  unresolvedLineCount: number;
  obdDateTime: Date | string | null;
  isAssigned: boolean;
  // True at exactly PICK_DONE. Added 2026-07-17 for the picker "My Picks"
  // Done tab — NOT part of the byAssigned sort signal (isAssigned above is
  // unchanged, still strictly PICK_ASSIGNED-only). See queue.ts's WHERE
  // clause comment for the known gap this leaves in the desktop board,
  // the mobile Assign/Check tabs, and lib/picking/sort.ts once PICK_DONE
  // starts being written.
  isDone: boolean;
  // True at exactly PICK_CHECKED. Added 2026-07-18 for the supervisor
  // board's Checked tab. Same strict-per-stage shape as isDone above — a
  // consumer that filters "waiting" on !isAssigned && !isDone must ALSO
  // exclude !isChecked, or a checked bill reappears as if untouched (the
  // same leak class isDone caused before every "waiting" filter was
  // patched — see lib/picking/queue.ts's doc comment).
  isChecked: boolean;
  assignedAt: Date | string | null;
  // pick_assignments.pickedAt — set by POST /api/picking/done. Added
  // 2026-07-17 for the "Needs check" pill ("Picked Xm ago") and the picker
  // "My Picks" Done card's timestamp. null until PICK_DONE is written.
  pickedAt: Date | string | null;
  // pick_assignments.checkedAt / checkedBy.name — set by POST
  // /api/picking/approve. Added 2026-07-18 for the Checked tab's "checked
  // {time}" line and its newest-first ordering. Both null until
  // PICK_CHECKED is written.
  checkedAt: Date | string | null;
  checkedByName: string | null;
  // Numeric FK, added 2026-07-17 for server-side "my bills only" scoping
  // (picker "My Picks") — a display-name match is not a scope boundary.
  // null when the row has no pick_assignments row at all.
  pickerId: number | null;
  assignedToName: string | null;
  assignedByName: string | null;
  // ── Date-zone fields (2026-07-20) ─────────────────────────────────────────
  // Added for the mobile board's locked/unlocked zone split. Computed
  // server-side in lib/picking/queue.ts against today in IST, and populated
  // in BOTH scopes (they are non-optional) — but only MEANINGFUL in the
  // all-dates 'openPending' scope, which is the one every live board uses. In
  // the single-date scope every row shares one dispatchTargetDate, so
  // zone/ageDays are constant across the payload and carry no information.
  //
  // 'due'      = dispatchTargetDate <= today (IST), OR the date is null
  // 'upcoming' = dispatchTargetDate  > today (IST) — the LOCKED zone, which
  //              auto-unlocks when the IST day rolls over into its date
  zone: "due" | "upcoming";
  // True when dispatchTargetDate IS NULL. Locked rule: a null date sorts to
  // 'due', never 'upcoming' — unscheduled work must never hide behind a lock.
  // This flag exists so the UI can still mark it ("no date" chip) rather than
  // silently presenting it as due today. Zero such rows existed in production
  // on 2026-07-20; this is future-proofing for imports that omit the date.
  noDispatchDate: boolean;
  // Whole days between dispatchTargetDate and today (IST), floored at 0 — so
  // a future-dated ('upcoming') row is 0, not negative. null when there is no
  // dispatch date (noDispatchDate: true), because "how stale" is unanswerable
  // without one — never 0, which would read as "fresh".
  ageDays: number | null;
  // The raw dispatch-target day as an ISO date-only string ("2026-07-23"),
  // or null when there is none. Added 2026-07-20 for the Assign tab's
  // Upcoming zone, whose badge reads "for Thu 23 Jul" — a label that is
  // NOT derivable from ageDays above, because ageDays is floored at 0 and
  // therefore reads 0 for EVERY future row regardless of distance.
  //
  // Deliberately a string, not a Date: this crosses a JSON boundary to a
  // client component, where a Date would arrive as a string anyway but with
  // a misleading type. Date-only (no time), so the consumer must parse it
  // the Date.UTC(y, m-1, d) way — never new Date(str). See
  // formatDispatchDay() in components/picking/picking-board-mobile.tsx.
  dispatchTargetDate: string | null;
  // Manual early release (5b, 2026-07-20) — true when a supervisor unlocked
  // this future-dated bill for picking today (orders.pickEarlyReleasedAt is
  // set). Such a row reports zone "due", NOT "upcoming": it behaves as
  // ordinary assignable work everywhere. This flag exists only so the UI can
  // still SHOW that it arrived there by override rather than by its date —
  // do not re-derive lock state from it, `zone` is the single authority.
  isEarlyReleased: boolean;
  // Who released it. Cross-supervisor provenance is the entire reason the
  // release is persisted rather than session-local: any of the three
  // supervisors may find a bill in Due now that its own date says is not due
  // yet, and needs to see whose call that was. null when never released.
  earlyReleasedByName: string | null;
}

export type SortRule = {
  key: string;
  label: string;
  compare: (a: PickingQueueRow, b: PickingQueueRow) => number;
};

// ── Detail-screen line items (shared by BOTH boards, 2026-08-07) ───────────
// The GET /api/picking/order/[orderId] response shape. Declared here, not
// duplicated in each board, because both faces now render findings and a drift
// between their two copies would be silent. (Each board carried its own private
// copy of this interface until the findings work; that was fine while the shape
// was four scalars and stopped being fine the moment it grew a nested object.)

/**
 * The pick_findings row for one line, or null when nothing is recorded.
 *
 * ⚠ `recordedById` IS THE STATE DISCRIMINATOR and the whole ladder hangs off it:
 *   null     → reported by the picker, awaiting a supervisor   (PENDING, amber)
 *   non-null → a supervisor confirmed it                       (CONFIRMED, red)
 * Never infer state from qtyFound or reason — a supervisor may legitimately
 * confirm a line at the full ordered quantity.
 */
export interface PickingLineFinding {
  qtyFound:     number;
  reason:       string;
  remarks:      string | null;
  /**
   * Manufacturing month (1-12) and year — populated ONLY when
   * `reason === "old_mfg"`, null on every short-quantity row (the write routes
   * force them null on that branch).
   *
   * Two consumers: the popup prefills them when an old-MFG line is re-opened,
   * and (since 2026-08-09) the compact note renders them as a "· Mar 2024"
   * tail on all three screens — both picking boards and the billing panel.
   * Format via `mfgLabel()`, never by interpolating the two numbers directly:
   * a legacy old_mfg row recorded before the columns existed carries null for
   * both, and the shared formatter is what turns that into "no segment"
   * rather than "undefined NaN".
   */
  mfgMonth:     number | null;
  mfgYear:      number | null;
  reportedById: number | null;
  reportedAt:   string | null;
  recordedById: number | null;
  recordedAt:   string | null;
}

/**
 * ONE ROW ON THE DETAIL SCREEN — which since 2026-08-10 may stand for SEVERAL
 * raw line items.
 *
 * SAP emits one line per batch/lot, so a single ordered quantity routinely
 * arrives as 2-8 `import_raw_line_items` rows that are identical in every
 * product-identifying field. The route now groups them by (skuCodeRaw, resolved
 * pack) — the same natural-key rule CombinedSkuRow uses for its cross-bill merge
 * — and sums the measures. Most rows are still a group of one and behave exactly
 * as they always did.
 *
 * ⚠ `id` IS NO LONGER THE WHOLE STORY. Use `lineIds` for anything that must
 * cover every line the row represents (ticks, checks, counters); `id` is the
 * FIRST contributing line and is only correct for single-line rows.
 */
export interface PickingDetailLine {
  /**
   * `import_raw_line_items.id` of the FIRST contributing line — a real PK, the
   * findings FK target, and the React key. Always equal to `lineIds[0]`.
   *
   * Safe as a findings target ONLY because a row carrying a finding is never
   * merged (the route splits such a group back out) and both boards block
   * recording a new finding on a merged row.
   */
  id:      number;
  /**
   * EVERY raw line id this row stands for, in `lineId` order. Never empty;
   * length 1 on an ordinary row.
   *
   * Mirrors what CombinedSkuRow.contributions[] does for the cross-bill
   * Combined view, and exists for the same reason: a tick on a merged row is a
   * note about all of the underlying lines, so it has to fan out to every one
   * of them rather than land on an arbitrary representative.
   */
  lineIds: number[];
  name:    string | null;
  sku:     string;
  pack:    string | null;
  /** Qty ORDERED — `import_raw_line_items.unitQty`, SUMMED across `lineIds`. */
  qty:     number;
  /**
   * Summed `volumeLine` / `netWeight` / `totalWeight` across `lineIds`.
   *
   * null when ANY contributing line is missing the value — a partial sum would
   * read as the whole row's figure while silently omitting lines. Not rendered
   * by either board today; carried so a consumer that wants them gets the
   * merged-correct number rather than one line's share.
   */
  litres:      number | null;
  netWeight:   number | null;
  totalWeight: number | null;
  /**
   * `import_raw_line_items.articleTag` — and NULL on any merged row.
   *
   * Deliberately not inherited from a contributing line: schema.prisma's own
   * comment on the column states the per-line value "is not authoritative for
   * duplicate-SKU orders", and live data bears it out (one SKU on OBD
   * 9107917606 carries "1 Drum", "2 Drum", "3 Drum" and "5 Drum" across its
   * seven lines). Only the order-level rollup is authoritative — the detail
   * header already reads that one, off PickingQueueRow.articleTag.
   */
  articleTag: string | null;
  /**
   * Product family — COALESCE(displayCategory, category) from `sku_master_v2`,
   * resolved by the SHARED rule in lib/picking/family-groups.ts. The picker's
   * detail screen groups its line list by this; the picking CARD's family chips
   * come from the same helper, so a bill's chips and its own group strips cannot
   * disagree.
   *
   * null means NO FAMILY — the code matched no catalog row (the ~27% gap,
   * CLAUDE_CORE.md §13) or resolved blank. Those lines render under the "Other"
   * bucket, last, and are the same population the card counts into
   * `unresolvedLineCount`. Safe to take from the merged row's head: family
   * resolves FROM the SAP code the merge is keyed on, so it is identical across
   * every contributing line by construction.
   */
  family: string | null;
  finding: PickingLineFinding | null;
  /**
   * The hardener this line's product ships with, or null when it ships with
   * none — which is almost every line.
   *
   * ⚠ A FIELD ON THE PARENT LINE, NEVER A ROW OF ITS OWN. The hardener is not
   * on the bill (lib/picking/hardener-skus.ts explains why) and it must not
   * become an extra element of the `lines` array: `totalRawLineCount`,
   * `tickedCount`, `resolvedLineCount`, the picker's family-group counts and
   * `distinctPackKeys` all iterate that array, and a synthetic row would need a
   * fake numeric id sharing a key space with `pick_findings.rawLineItemId` — a
   * real UNIQUE FK. A field can collide with nothing. Both boards render the
   * HARDENER sub-row from HERE, inside the parent row.
   *
   * NULL on every merged row's parent? No — the opposite: `qty` is the MERGED
   * quantity, because the field is set after the merge. See group-lines.ts.
   */
  hardener: PickingLineHardener | null;
}

/**
 * The hardener a 2K PU line ships with.
 *
 * An OBJECT rather than a bare boolean deliberately: `qty` is already a
 * computed number the boards render without arithmetic of their own, and a
 * future per-SKU ratio or a hardener pack label lands here as one more field
 * instead of rippling a type change through both board components.
 *
 * `qty` today is a straight mirror of the parent line's own qty — one hardener
 * per one unit, the only rule (lib/picking/hardener-skus.ts).
 */
export interface PickingLineHardener {
  qty: number;
}

// ── Combined view (picker "My Picks" third tab, 2026-08-07) ─────────────────
// The GET /api/picking/combined payload. Declared HERE, next to
// PickingQueueRow, because this module is pure types with no imports — the
// route and the client board both import from it, so the wire shape has one
// definition instead of the duplicated-interface convention the single-bill
// detail shape still follows.

/**
 * ONE raw line's contribution to a merged SKU row.
 *
 * The `(orderId, lineItemId)` pair is the whole reason this array crosses the
 * wire: the picker's private line ticks are stored per BILL, keyed by the
 * line's stable `import_raw_line_items.id`, so ticking a merged row has to be
 * written back into each contributing bill's own entry
 * (docs/CLAUDE_PICKING.md §5.4.1). Per-contribution `qty`/`litres` let the
 * client re-total when a bill is toggled off WITHOUT a refetch.
 */
export interface CombinedContribution {
  orderId: number;
  /** `import_raw_line_items.id` — a global PK, unique across bills. */
  lineItemId: number;
  qty: number;
  litres: number;
}

/**
 * One DISTINCT SAP code across all of this picker's pending bills.
 *
 * ⚠ MERGED BY `skuCodeRaw` / `sku_master_v2.material` — the SAP code, ALWAYS.
 * Never by description text: two bills can carry different raw text for the
 * same unmastered code, and text matching would silently merge or split real
 * products. `name`/`pack` resolve through lib/picking/resolve-lines.ts; when a
 * code is in neither catalog table (~27%, §7's blank-pack landmine) `name`
 * falls back to the raw SAP text of the FIRST contributing bill (cosmetic only)
 * and `pack` stays null.
 */
export interface CombinedSkuRow {
  sku: string;
  name: string | null;
  pack: string | null;
  /** Summed across EVERY contributing bill (server-side, all bills enabled). */
  qty: number;
  /** Summed `import_raw_line_items.volumeLine`, 2dp. */
  litres: number;
  contributions: CombinedContribution[];
}

/** A bill feeding the Combined list — one pill in the client's bill row. */
export interface CombinedBill {
  orderId: number;
  obdNumber: string;
  dealerName: string;
}

/**
 * GET /api/picking/combined response.
 *
 * `bills` is exactly the picker's Pending tab (same getPickingQueue +
 * splitPickerRows rule), resolved SERVER-SIDE from his own pickerId — the
 * client never sends an order-id list, so Combined can never show another
 * picker's bills and can never drift from Pending.
 */
export interface CombinedPickResult {
  pickerId: number;
  bills: CombinedBill[];
  rows: CombinedSkuRow[];
}

// ── Pick bundling (the grouping engine's own shapes) ─────────────────────────
//
// MOVED HERE FROM lib/floor/types.ts on 2026-08-18, with the engine itself
// (lib/floor/grouping.ts -> lib/picking/grouping.ts). Zero behaviour change —
// the interfaces are byte-identical to what Floor carried, only their address
// changed.
//
// WHY PICKING OWNS THEM. The rules answer a PICKING question ("can one man
// fetch these together?"), and the Picking phone board is about to ask it too.
// This repo already fixed the shape of that relationship: Picking owns the
// shared picking logic and Floor imports it — lib/picking/sort.ts is exactly
// this, with lib/floor/sort.ts composing FLOOR_SPINE out of it and never
// copying a rule object. Two copies of a rule drift; ONE OWNER PER BEHAVIOUR.
//
// ⚠ WHAT DID NOT MOVE, and the line between them: these are the ENGINE'S OWN
// shapes — what it is handed and what it returns. Floor's WIRE FORMAT stayed in
// lib/floor/types.ts (FloorBoardResult, FloorWaitingSkus, FloorOilSkus and the
// `waitingSkus` / `oilSkus` keys), because those describe what /api/floor/board
// ships to Floor's client, which is Floor's business and no engine's.
//
// Nothing here is stored. There is no table and no column behind any of it —
// the board recomputes the groups on every load.

/** One candidate bill as the grouping engine sees it. The engine knows nothing
 *  else about a bill — no route, no slot, no litres, no clock. */
export interface PickGroupCandidate {
  orderId: number;
  obdNumber: string;
  /** Distinct `skuCodeRaw`. The engine does not re-dedupe; the producer must. */
  skus: string[];
}

/** One RULE 1 bundle: a main bill plus 1-3 riders, each of which adds ZERO new
 *  SKUs to the main. Max 4 bills, no exceptions.
 *
 *  `totalVolume` is deliberately absent — the engine never sees litres. The
 *  caller sums them from its own board rows, which is where volume lives. */
export interface PickGroup {
  /** Derived from the main bill: `id === main.orderId`. Stable across loads for
   *  as long as the same bill leads the same bundle. */
  id: number;
  main: PickGroupCandidate;
  riders: PickGroupCandidate[];
  /** Sum of the riders' distinct-SKU counts — every rider SKU is a shelf the
   *  picker was walking to for the main bill anyway. */
  savedTrips: number;
}

/** One RULE 2 bundle: 2-4 bills that all live in the oil-paint end of the
 *  warehouse. **There is NO main bill and there are no riders — every member is
 *  a peer.**
 *
 *  ⚠ THIS SHAPE CHANGED ON 2026-08-18 AND THE OLD FIELDS ARE GONE ON PURPOSE.
 *  It first carried `main` / `riders` / `savedTrips` / `addedSteps`, because
 *  Rule 2 was first specified as "each rider shares ≥1 SKU with the main". That
 *  condition was Rule 1's test wearing Rule 2's name: Rule 1 saves a repeated
 *  SHELF, so a shared code is exactly its unit of saving; Rule 2 saves a
 *  repeated JOURNEY to a family of racks, and a journey is saved whether or not
 *  the two bills want the same tin. Live proof (18 Aug): 9108973203 (Gloss Sky
 *  Blue 1L + Gloss Bus Green 1L) and 9108973205 (Gloss Intermediate Base 0.9L +
 *  Gloss Dark Brown 500ML) — both 100% Gloss, both 2 items, plainly one walk to
 *  the Gloss racks, and the shared-SKU rule refused them because no code
 *  matched. `savedTrips` and `addedSteps` were arithmetic about riders relative
 *  to a main; with no main they measure nothing, so they were removed rather
 *  than redefined into something plausible-looking.
 *
 *  ⚠ `PickGroup` above is UNRELATED and unchanged — Rule 1 still has a main and
 *  riders, because for Rule 1 that is a true description. */
export interface OilGroup {
  /** The FIRST member's orderId. Not a "main" — purely a stable identity for
   *  React keys and the board's expand-persistence set. Stable because the
   *  member order is a total order (see buildOilGroups). */
  id: number;
  /** 2-4 bills, in the engine's packing order. Peers. */
  members: PickGroupCandidate[];
  /** Distinct SKUs across the whole bundle. Capped at 10 by the engine. */
  totalSkus: number;
  /** True when any member carries a SKU outside the oil-paint set. The UI says
   *  so quietly; the engine only reports it. */
  hasNonOil: boolean;
  /** True when EVERY member is 100% oil paint. False when at least one member
   *  sits between 50% and 99% — still qualifying, but the group is no longer a
   *  clean single-area walk.
   *
   *  ⚠ DIAGNOSTIC ONLY — IT DRIVES NO COPY. It briefly split the group label into
   *  "ALL OIL PAINT" / "MOSTLY OIL PAINT"; that split was dropped on 2026-08-18
   *  because a group kind needs ONE name (see the label note in
   *  components/floor/group-row.tsx). Its only reader today is
   *  scripts/_rule2-preview.ts, which reports the 53/47 split as a measurement.
   *  Do NOT resurrect a label from it — if a purity distinction is ever wanted on
   *  screen it is a fresh design decision, not a field waiting to be re-used.
   *
   *  Kept rather than deleted, unlike the `totalArticle` precedent on
   *  FloorBoardRow (lib/floor/types.ts): that was a PAYLOAD field crossing the
   *  wire with no reader, this is a pure-function return value computed
   *  client-side from data already in hand, so it costs nothing to carry. */
  allPure: boolean;
}
