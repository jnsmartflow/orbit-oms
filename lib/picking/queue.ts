import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { sortPickingQueue } from "./sort";
import {
  // SUPPORT_DONE_OUTPUT was imported here for the 'rolling' arm's carry-over
  // clause only, and went with it (2026-07-28). PICKING_OPEN_STAGES already
  // contains that stage, so nothing here needs the bare constant.
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
  PICKING_ACTIVE_STAGES,
  PICKING_OPEN_STAGES,
} from "@/lib/workflow-stages";
import type { PickingQueueRow } from "./types";
import { FAMILY_CATALOG_SELECT, buildFamilyByCode } from "./family-groups";
// Name → SAP code, the inverse of the importer's own DIVISION_TO_SMU. Imported
// rather than re-declared so the picking board can never disagree with the
// importer about which code a name means (the ONE OWNER PER BEHAVIOUR rule this
// module already follows for sort.ts and grouping.ts).
import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
// The oil-paint rule lives in the ENGINE, not here and not in the database.
// Same import Floor makes (lib/floor/queries.ts) — one definition, two callers.
import { buildOilSkuSet } from "./grouping";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today's calendar date in IST, as a UTC-midnight Date — the shape Postgres
 * expects for a @db.Date column (date only, no time-of-day). Built by
 * shifting the current instant by the IST offset FIRST, then reading the
 * Y/M/D off that shifted instant and re-anchoring at UTC midnight. This is
 * the same Date.UTC(y, m-1, d) pattern used elsewhere in Support (release
 * route) to avoid the server's own UTC clock silently picking the wrong
 * calendar day near the IST/UTC day boundary.
 */
function getISTTodayDate(): { isoDate: string; dateOnly: Date } {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const day = istNow.getUTCDate();
  const dateOnly = new Date(Date.UTC(year, month, day));
  const isoDate = dateOnly.toISOString().slice(0, 10);
  return { isoDate, dateOnly };
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the target date for the queue. No dateStr → today in IST
 * (unchanged getISTTodayDate() behaviour). With dateStr, parses it as
 * UTC-midnight via Date.UTC(y, m-1, d) — the same anchoring getISTTodayDate()
 * already uses — NEVER `new Date(dateStr)` directly, which parses as UTC
 * midnight for a bare "YYYY-MM-DD" in spec but is a documented footgun (some
 * engines/older behaviour treat it as local time), so we build it explicitly.
 *
 * Malformed input THROWS (chosen over falling back to today): this is a
 * derived read the caller may script against, and returning "today" for a
 * typo'd date would look like a working response while quietly answering a
 * different question than asked. Throwing lets the API route surface a clear
 * 400 instead of a silently-wrong day. Also rejects shape-valid-but-impossible
 * calendar dates (e.g. "2026-02-30", which Date.UTC would silently roll into
 * March) by round-tripping the constructed date back to a string and
 * comparing it to the input.
 */
function resolveTargetDate(dateStr?: string): { isoDate: string; dateOnly: Date } {
  if (dateStr === undefined) {
    return getISTTodayDate();
  }
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(year, month - 1, day));
  const isoDate = dateOnly.toISOString().slice(0, 10);
  if (isoDate !== dateStr) {
    throw new Error(`Invalid calendar date "${dateStr}"`);
  }
  return { isoDate, dateOnly };
}

/**
 * Which slice of the picking pipeline a caller wants.
 *
 * 'single'      — DEFAULT and unchanged since this module was written: every
 *                 stage in PICKING_ACTIVE_STAGES, fenced to ONE dispatch-target
 *                 date by equality.
 *                 ⚠ NO APP CODE SELECTS IT. Every live caller names its scope
 *                 explicitly: picking-mobile-shell.tsx:150 and
 *                 app/picking/page.tsx:143 send openPending, and the marker
 *                 hook ALWAYS appends ?scope= (a required prop,
 *                 lib/hooks/use-picking-marker.ts). So nothing reaches this
 *                 default by omission. (The one caller that did name a
 *                 different scope was the desktop board, archived 2026-07-28.)
 *                 It is CALLER-LESS, NOT UNREACHABLE, and is KEPT for that
 *                 reason (owner decision 2026-07-28): both public routes accept
 *                 scope=single by name (app/api/picking/queue/route.ts:38,
 *                 app/api/picking/marker/route.ts:66) and it is what a request
 *                 with no ?scope= resolves to, so removing it would change a
 *                 live API contract. Do not delete it as "dead".
 *
 * 'openPending' — the mobile boards (2026-07-20 date-zones redesign). Pending
 *                 and in-progress work across ALL dates (no dispatchTargetDate
 *                 fence), PLUS the bills CHECKED today — fenced on
 *                 pick_assignments.checkedAt, not on the dispatch date
 *                 (2026-08-02; see the arm itself). Both arms keep
 *                 dispatchStatus='dispatch' and isRemoved=false.
 *
 * ⚠ NAME CAVEAT — 'openPending' is slightly narrower than what it returns: it
 * also carries the today-fenced PICK_CHECKED band. Kept as-is deliberately
 * (the locked design's vocabulary; renaming costs churn across the design doc
 * and the board). Read this contract, not the name. Precedent for the trap in
 * this module: CLAUDE_PICKING.md §5.1's "Done" tab, whose LABEL, KEY and DB
 * STAGE are three different strings.
 *
 * Why checked rides along in the same query rather than a second today-scoped
 * call: components/picking/picking-mobile-shell.tsx owns ONE fetch whose
 * result feeds both the cards and the bottom-bar tab counts ("one fetch, no
 * drift", CLAUDE_PICKING.md §5.1). A second fetch would reintroduce exactly
 * the drift that invariant exists to prevent.
 */
// A third scope, 'rolling', existed from 2026-07-21 to 2026-07-28. It served the
// desktop day-board and nothing else, and was removed with it — the board is at
// archive/2026-07-picking-desktop/. Do not re-add it speculatively: it was an
// all-dates, per-stage-date-bounded arm, and Floor already covers that shape with
// its own predicate (lib/floor/queries.ts floorLiveBaseWhere).
export type PickingQueueScope = "single" | "openPending";

export interface PickingQueueOptions {
  /** YYYY-MM-DD. Meaningful in 'single' scope only; omitted → today in IST. */
  date?: string;
  /** Defaults to 'single'. NOTHING relies on that default — every app caller
   *  names its scope explicitly (see PickingQueueScope above). */
  scope?: PickingQueueScope;
  /**
   * Optional per-picker narrowing (2026-07-29) — returns ONLY the bills
   * assigned to this picker. Added for the picker "My Picks" face, which
   * fetches its own list client-side: unnarrowed the response is ~202 KB of
   * whole-board rows for a phone that renders about ten of them, and it would
   * put every other picker's bills on his device. Narrowed it is ~8 KB.
   *
   * Applied the SAME way app/api/picking/marker/route.ts applies its own
   * pickerId — AND-merged onto buildPickingWhere()'s result inside
   * getPickingQueue(), never into buildPickingWhere() itself, so the shared
   * scope filter the marker and the supervisor board rely on stays untouched.
   * Omitted → board-wide, byte-identical to before this option existed.
   */
  pickerId?: number;
}

// This payload carried four aggregate counters until 2026-07-28 — `windows[]`
// (a PickingWindowSummary[] of per-dispatch-window "still waiting" totals),
// `totalCount`, `unmatchedCount` and `assignedCount`. All four existed for the
// desktop board's header segments and stats line; that board is archived
// (archive/2026-07-picking-desktop/) and every surviving surface derives its own
// counts from `rows` instead. Removed with the board.
//
// ⚠ If a future consumer needs "how many still need a picker", the rule was:
//     !isAssigned && !isDone && !isChecked && zone !== "upcoming"
// applied to the sorted rows. Kept here verbatim because it is a real decision
// (it excludes future-dated rows, which is NOT obvious) and because
// CLAUDE_NOTIFICATIONS.md §7 points a future supervisor-reminder timer at it.
// Derive it from `rows`; do not modify buildPickingWhere() to serve a count.
// Pick bundling on the SUPERVISOR'S ASSIGN TAB — the kill switch.
//
// Gates BOTH rules here, not just Rule 2: the whole grouping display is new on
// the phone, so `false` must mean the board it has always been, not a board
// missing half a feature it never had.
//
// ⚠ DELIBERATELY SEPARATE FROM FLOOR'S `RULE2_ENABLED` (lib/floor/queries.ts).
// The two surfaces share the ENGINE (lib/picking/grouping.ts) but not their
// rollout: the phone is used by three supervisors on the floor and Floor by the
// operations desk, and either has to be switchable off alone without taking the
// other with it. One shared flag would make the first bad reaction on either
// screen cost both.
//
// FALSE means: neither query below is issued, both sibling arrays ship EMPTY,
// and the client renders exactly today's flat list — no stripe, no heading, no
// SINGLE PICKS. The FIELDS are always present, so no caller's type moves with
// the flag.
const PICKING_GROUPING_ENABLED = true;

/** One bill's distinct SAP codes, as they ride the queue payload.
 *
 *  ⚠ `import_raw_line_items.skuCodeRaw` values — the SAP code, the stable
 *  natural key. NEVER a `skuId` and never anything off old `sku_master`
 *  (CORE §13 id-space landmine).
 *
 *  Used for BOTH sibling arrays below: `waitingSkus` carries every distinct
 *  code on the bill, `oilSkus` the subset that resolves to an oil-paint family.
 *  One shape rather than two named ones because the field name already carries
 *  the meaning and a second identical interface is a thing to keep in step for
 *  no gain. */
export interface PickingBillSkus {
  orderId: number;
  skus: string[];
}

export interface PickingQueueResult {
  // 'single': the date the payload is fenced to. 'openPending': the IST day
  // used as the zone/ageDays anchor (rows themselves span many dates).
  date: string;
  rows: PickingQueueRow[];
  // ── Pick-bundling siblings (2026-08-18) ─────────────────────────────────
  // SIBLINGS of `rows`, deliberately not fields on PickingQueueRow: only a
  // WAITING due-zone row can be bundled, so hanging these off every row would
  // ship an empty array on every Picking/Done/upcoming row for no reader —
  // exactly the shape Floor's removed `totalArticle` field had.
  //
  // EMPTY ARRAYS when PICKING_GROUPING_ENABLED is false, which yields no groups
  // by construction (the engine drops zero-SKU candidates, and no bill reaches a
  // 50% oil share against an empty oil set).
  waitingSkus: PickingBillSkus[];
  oilSkus: PickingBillSkus[];
}

// Shared shape for both dealer FKs (customer / shipToOverrideCustomer) —
// route + delivery type + key-customer flag all come from here, via the
// dealer's area. delivery_point_master.primaryRouteId is stale and is never
// read (locked decision, step 1) — only area.primaryRoute is used.
const DEALER_SELECT = {
  id: true,
  customerName: true,
  isKeyCustomer: true,
  area: {
    select: {
      name: true,
      primaryRoute: { select: { name: true } },
      deliveryType: { select: { name: true } },
    },
  },
} as const;

/**
 * Builds the exact Prisma `where` the picking queue filters on, plus the
 * resolved `isoDate`/`dateOnly` anchors, for a given scope+date.
 *
 * Extracted from getPickingQueue() (2026-07-22) as the SINGLE source of the
 * picking scope filter, so the lightweight change-marker endpoint
 * (app/api/picking/marker/route.ts) can count/aggregate over the IDENTICAL row
 * set the queue renders — the two cannot drift into watching different sets,
 * which would miss updates on the floor. getPickingQueue() now calls this and
 * is otherwise byte-identical to its pre-extraction form: the same scope/date
 * semantics, the same `where`, the same comments — only relocated here.
 */
export function buildPickingWhere(
  options: PickingQueueOptions = {},
): { where: Prisma.ordersWhereInput; isoDate: string; dateOnly: Date } {
  const { date: dateStr, scope = "single" } = options;
  const { isoDate, dateOnly } = resolveTargetDate(dateStr);

  // Today in IST as a half-open INSTANT window [start, end) — the fence for
  // 'openPending''s checked arm below. Independent of `dateOnly`, which in
  // 'single' scope is whatever day the caller asked for.
  //
  // An INSTANT window, not the date-only anchor this line used to build
  // (`getISTTodayDate().dateOnly`, for the old dispatchTargetDate fence),
  // because `pick_assignments.checkedAt` is a timestamp and cannot be compared
  // to a @db.Date value. Same helper and same pairing lib/floor/queries.ts:154
  // and lib/picking/picker-split.ts:80 already use. Half-open, so a bill
  // checked exactly at IST midnight lands in the new day only — never twice.
  //
  // ⚠ The zone / lock / ageDays maths below is NOT anchored here and must not
  // be repointed at it: it anchors on `dateOnly` (`anchorMs`, :463), which is
  // the PROMISE date — a genuinely different question ("when was this bill
  // due?" vs "when was it checked?"). getISTTodayDate() itself stays; it is
  // what resolveTargetDate falls back to (:59).
  //
  // Pure and synchronous, so this function keeps its signature and both
  // callers are untouched.
  const { start: checkedStart, end: checkedEnd } = getISTDayRange();

  // Two shapes, one stage universe. PICKING_OPEN_STAGES ⊂ PICKING_ACTIVE_STAGES
  // by construction (lib/workflow-stages.ts), so the scopes cannot drift into
  // showing different bills on desktop vs. mobile. Neither admits 'closed' —
  // see that file for the 572-row evidence behind that exclusion.
  const where: Prisma.ordersWhereInput =
    scope === "openPending"
      ? {
          dispatchStatus: "dispatch",
          isRemoved: false,
          // NO dispatchTargetDate fence on the open arm — that is the whole
          // point of this scope. The checked arm keeps its own today-fence,
          // per the locked design ("only the Checked band stays on today") —
          // but on the CHECK date, not the promise date. See below.
          OR: [
            { workflowStage: { in: PICKING_OPEN_STAGES } },
            // Everything the floor CHECKED TODAY, whatever day it was due.
            //
            // 🔴 FENCED ON `pick_assignments.checkedAt`, NOT `dispatchTargetDate`
            // (fixed 2026-08-02). This is character-for-character the arm
            // lib/floor/queries.ts:140-143 already carries, and it is here for
            // the same reason Floor put it there: keying the checked band on
            // the PROMISE day makes a carried-over bill — due earlier, checked
            // today — fail BOTH arms and vanish at the instant of completion.
            //
            // The old predicate was `dispatchTargetDate: todayDateOnly`. A bill
            // dispatch-dated last week and approved today matched arm 1 while
            // it was pick_done (that arm has no date fence), then matched
            // NOTHING the moment POST /api/picking/approve advanced it to
            // pick_checked — so it disappeared from the supervisor's Checked
            // band AND, because the row left the payload entirely, from the
            // picker's own Done tab, whose rule (lib/picking/picker-split.ts:127)
            // deliberately admits isChecked precisely so that would not happen.
            // The mirror case was wrong too: a bill checked days ago but
            // dispatch-dated today was filed under a day nothing happened on it.
            //
            // A bill must never disappear when it is finished.
            //
            // ⚠ `pickAssignment` stays INSIDE this OR branch and must not be
            // lifted to a top-level key. Both callers AND-merge their own
            // top-level `pickAssignment: { pickerId }` onto this result by
            // spread (app/api/picking/marker/route.ts:107-108 and
            // getPickingQueue below) — a top-level relation filter here would
            // be silently overwritten by that spread, widening every picker's
            // board to the whole depot.
            {
              workflowStage: PICK_CHECKED,
              pickAssignment: { checkedAt: { gte: checkedStart, lt: checkedEnd } },
            },
          ],
        }
      : {
          dispatchStatus: "dispatch",
          // ⚠ DELIBERATELY UNCHANGED by the 2026-08-02 checked-arm fix above.
          // This fence applies to EVERY stage including PICK_CHECKED, so this
          // scope still files a checked bill under its dispatch date — the same
          // attribution the openPending arm just stopped using. Left alone on
          // purpose: no app code selects 'single' (see the scope doc above),
          // but both public routes accept it BY NAME, so changing what it
          // returns is a live API contract change and belongs in its own step,
          // not smuggled into this one.
          dispatchTargetDate: dateOnly,
          // Unassigned, assigned, AND picked current stages. Assigned
          // (PICK_ASSIGNED) rows are sunk to the bottom by sort.ts's
          // byAssigned rule; picked (PICK_DONE) rows are NOT (isAssigned is
          // false for them too — see the doc comment above this function) —
          // harmless, since the board consumer filters PICK_DONE rows out of
          // its rendered lists entirely rather than relying on sort position.
          // Never the historical 'closed' union — see lib/workflow-stages.ts and
          // CLAUDE_SUPPORT.md §3 (parking-stage flip).
          workflowStage: { in: PICKING_ACTIVE_STAGES },
          isRemoved: false,
        };

  return { where, isoDate, dateOnly };
}

/**
 * Live derived read — SELECT only. Fetches dispatch-stamped OBDs —
 * unassigned (SUPPORT_DONE_OUTPUT), assigned (PICK_ASSIGNED), picked
 * (PICK_DONE), and checked (PICK_CHECKED, added 2026-07-18 for the
 * supervisor board's Checked tab) — resolves the effective dealer per row,
 * and hands the result to the pure sort module. No writes. No orderBy in
 * the Prisma query — sorting is entirely sortPickingQueue()'s job
 * (byAssigned sinks assigned rows to the bottom). The scope filter itself is
 * built by buildPickingWhere() (above) — the marker endpoint reuses it.
 *
 * DATE SCOPE is chosen by `options.scope` (see PickingQueueScope above).
 * 'single' is the DEFAULT but no app caller selects it. Rows carry
 * `zone`/`noDispatchDate`/`ageDays` in both scopes, but they only vary
 * meaningfully under 'openPending'.
 *
 * SORTING IS UNTOUCHED by the scope. lib/picking/sort.ts's PICKING_SPINE has
 * no zone rule and must not gain one — zone is a GROUPING the UI applies, and
 * inside each zone the existing spine order holds unchanged.
 *
 * `isAssigned` below is strictly `workflowStage === PICK_ASSIGNED` — a
 * PICK_DONE or PICK_CHECKED row gets `isAssigned: false`, on purpose, and
 * stays that way. That is NOT a bug on its own: it only breaks something
 * for a consumer that treats "!isAssigned" as "waiting/unassigned" without
 * ALSO excluding `isDone` AND `isChecked`. Every "waiting" filter across
 * both boards guards for this:
 *   - components/picking/picking-queue.tsx (desktop): `unassignedRows`
 *     inside `PickingTable`, plus the parent's `availableRoutes` and
 *     `selectableIdsInTab` — all `!r.isAssigned && !r.isDone && !r.isChecked`.
 *   - components/picking/picking-board-mobile.tsx (mobile Assign tab):
 *     `waitingRows` and the detail screen's Assign-CTA gate — same guard.
 *   - app/picking/page.tsx (picker "My Picks" split): `pending` excludes
 *     both `isDone` and `isChecked`; `done` now includes either (an
 *     approved bill stays in the picker's own Done tab, it doesn't
 *     disappear from his history just because a supervisor later checked it).
 * The "assigned"/Check-tab side (`r.isAssigned`) never needed a matching
 * fix — it was already correctly excluding PICK_DONE/PICK_CHECKED rows,
 * since `isAssigned` is false for them on that side too. `isDone` is
 * likewise strict-per-stage (`=== PICK_DONE`), so a PICK_CHECKED row does
 * NOT reappear in the Check tab's "Needs check" section — it has its own
 * home now (the Checked tab, `isChecked`). lib/picking/sort.ts's
 * `byAssigned` rule itself was never touched — only what feeds it (the
 * filtered row sets above) changed.
 *
 * COUNTS: this function returns none. It hands back `date` + `rows`, and each
 * consumer counts what it needs off `rows` (the mobile shell's three tab badges
 * are computed in components/picking/picking-mobile-shell.tsx). The four
 * aggregate counters this payload used to carry are described, with the
 * "still waiting" rule they used, above PickingQueueResult.
 */
export async function getPickingQueue(
  options: PickingQueueOptions = {},
): Promise<PickingQueueResult> {
  // Scope filter + date anchors come from the shared builder (see above) — the
  // marker endpoint reuses the SAME `where`, so the two never drift.
  const { where, isoDate, dateOnly } = buildPickingWhere(options);

  // Optional per-picker narrowing (see PickingQueueOptions.pickerId). Merged
  // HERE, not inside buildPickingWhere, so the shared scope filter stays
  // byte-identical for the marker and every board-wide caller. A to-one
  // relation filter: only orders whose pick_assignments row carries this
  // pickerId — an unassigned bill, or one assigned to somebody else, is out.
  const scopedWhere: Prisma.ordersWhereInput =
    options.pickerId !== undefined
      ? { ...where, pickAssignment: { pickerId: options.pickerId } }
      : where;

  // Sequential awaits only — never prisma.$transaction (CORE §3).
  const orders = await prisma.orders.findMany({
    where: scopedWhere,
    include: {
      // ⚠ `customer` / `shipToOverrideCustomer` / `pickEarlyReleasedBy` and the
      // three user relations under pickAssignment were REMOVED from this
      // include on 2026-08-10 and are now resolved by the two batched lookups
      // below. Reason, measured with Prisma query logging against production
      // (72-row board): this include tree issued 18 SQL statements, of which
      //   2 x delivery_point_master + 2 x area_master + 2 x route_master
      //   + 2 x delivery_type_master   (the dealer chain, run TWICE)
      //   3 x users                    (picker / assignedBy / checkedBy)
      // Prisma does NOT dedupe the two dealer chains even though both target
      // delivery_point_master, and does NOT skip the override chain for the 69
      // of 72 rows whose shipToOverrideCustomerId is NULL — it paid four round
      // trips to resolve three rows. Nor does it collapse the three user
      // relations into one query.
      //
      // Everything those relations produced is still produced, from the same
      // tables, with the same SELECTs — just fetched once per distinct id
      // instead of once per relation. Batch-and-match is the pattern this file
      // already uses for sku_master_v2 (below) and CORE §7.1.c describes.
      dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
      // 1:1, optional — an order may have no snapshot row. Source: CLAUDE_SUPPORT.md §4.19.
      querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
      // 1:1, optional — present only once the order is PICK_ASSIGNED (or later).
      // SCALARS ONLY now. pickerId added 2026-07-17 for server-side "my bills
      // only" scoping on the picker "My Picks" face — a real FK, not a
      // display-name match. pickedAt added same day (step 5) for the Check
      // tab's "Needs check" pill and the picker Done card's timestamp — null
      // until PICK_DONE. assignedById/checkedById are the FKs the batched user
      // lookup below resolves to names; checkedAt added 2026-07-18 for the
      // Checked tab's "checked {time}" line.
      pickAssignment: {
        select: {
          pickerId: true,
          assignedById: true,
          checkedById: true,
          assignedAt: true,
          pickedAt: true,
          checkedAt: true,
        },
      },
    },
  });

  // ── Dealer resolution — ONE batched lookup for BOTH dealer FKs ─────────────
  // Collects customerId ∪ shipToOverrideCustomerId across every loaded row and
  // fetches each distinct dealer once. Replaces the two parallel relation
  // chains (8 round trips) with one (4), and the override chain is no longer
  // paid for at all when no row carries an override.
  //
  // 🔴 THE EFFECTIVE-DEALER RULE IS UNCHANGED and is the highest-risk part of
  // this change: override first, plain customer second. The old expression was
  // `order.shipToOverrideCustomer ?? order.customer` — a null RELATION fell
  // through to the customer. The id form below behaves identically, including
  // the pathological case: a shipToOverrideCustomerId pointing at a row that
  // did not come back yields `undefined` from the Map and falls through to the
  // customer, exactly as a null relation would have.
  const dealerIds = Array.from(
    new Set(
      orders
        .flatMap((o) => [o.customerId, o.shipToOverrideCustomerId])
        .filter((id): id is number => id !== null),
    ),
  );
  const dealerRows =
    dealerIds.length > 0
      ? await prisma.delivery_point_master.findMany({
          where: { id: { in: dealerIds } },
          select: DEALER_SELECT,
        })
      : [];
  const dealerById = new Map(dealerRows.map((d) => [d.id, d]));

  // ── Actor names — ONE batched lookup for all FOUR user FKs ────────────────
  // picker / assignedBy / checkedBy (all on pick_assignments) plus the
  // early-release actor on the order itself. Prisma issued a separate query per
  // relation; one `id IN (…)` covers the lot, and the same user appearing in
  // several roles (routinely — a supervisor assigns AND checks) is fetched once.
  const userIds = Array.from(
    new Set(
      orders
        .flatMap((o) => [
          o.pickAssignment?.pickerId ?? null,
          o.pickAssignment?.assignedById ?? null,
          o.pickAssignment?.checkedById ?? null,
          o.pickEarlyReleasedById,
        ])
        .filter((id): id is number => id !== null && id !== undefined),
    ),
  );
  const userRows =
    userIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
  // users.name is NOT NULL in the schema, so a hit always yields a real string;
  // a MISS yields undefined and every read below coalesces it to null — the
  // same value the old `?.name ?? null` produced for a null relation.
  const userNameById = new Map(userRows.map((u) => [u.id, u.name]));

  // (A dispatch_slot_master read used to sit here, purely to build the removed
  // `windows[]` counters. It went with them 2026-07-28 — one fewer round trip
  // per fetch. Each row still carries its own windowId/windowTime/windowSortOrder
  // from the `dispatchWindow` include above, so nothing lost the slot data.)

  // ── Product-family aggregation (Picking card redesign, 2026-07-21) ─────────
  // TWO bulk reads for the WHOLE page (never per-order — no N+1), then group
  // in memory. Sequential awaits only, never prisma.$transaction (CORE §3).
  //
  // There is no FK from orders to its line items — matched on the plain
  // obdNumber string, the same key the detail screen route uses. Family
  // resolves via sku_master_v2.material (the SAP natural key), NOT the
  // enrichedLineItem.skuId FK — that shares no id space with v2 and would
  // mispoint every line (CLAUDE_CORE.md §13 id-space landmine).
  const obdNumbers = Array.from(new Set(orders.map((o) => o.obdNumber)));

  // 1. Active + valid raw lines for every loaded OBD, one query. lineStatus
  //    'active' drops import-removed lines; rowStatus 'valid' drops parse-
  //    rejected rows — only lines a picker would actually handle.
  const rawLines =
    obdNumbers.length > 0
      ? await prisma.import_raw_line_items.findMany({
          where: {
            obdNumber: { in: obdNumbers },
            lineStatus: "active",
            rowStatus: "valid",
          },
          select: { obdNumber: true, skuCodeRaw: true },
        })
      : [];

  // 2. Catalog rows for the distinct codes seen above, one query.
  const codes = Array.from(
    new Set(rawLines.map((l) => l.skuCodeRaw).filter((c): c is string => Boolean(c))),
  );
  const catalogRows =
    codes.length > 0
      ? await prisma.sku_master_v2.findMany({
          where: { material: { in: codes } },
          select: { material: true, ...FAMILY_CATALOG_SELECT },
        })
      : [];

  // family = COALESCE(displayCategory, category), trim-guarded so a blank counts
  // as "no family". THE RULE MOVED to lib/picking/family-groups.ts on 2026-08-10
  // — extraction, not a behaviour change: same COALESCE, same trim, same
  // blank-is-unresolved outcome, byte for byte what this loop did inline.
  //
  // It moved because the picker's DETAIL screen now groups its line list by the
  // same family, and two copies of this rule is how the card's chips and the
  // detail's group strips would come to disagree — one of them learning about
  // displayCategory when the friendly-name swap lands, and the other not.
  const familyByCode = buildFamilyByCode(catalogRows);

  // Group per OBD in one pass: distinct families (Set) + a raw count of active
  // lines that matched no family. unresolvedLineCount counts LINES, not
  // distinct codes — 2 unmatched tins on one OBD = 2.
  const familiesByObd = new Map<string, Set<string>>();
  const unresolvedByObd = new Map<string, number>();
  for (const l of rawLines) {
    const family = l.skuCodeRaw ? familyByCode.get(l.skuCodeRaw) : undefined;
    if (family !== undefined) {
      let set = familiesByObd.get(l.obdNumber);
      if (!set) {
        set = new Set<string>();
        familiesByObd.set(l.obdNumber, set);
      }
      set.add(family);
    } else {
      unresolvedByObd.set(l.obdNumber, (unresolvedByObd.get(l.obdNumber) ?? 0) + 1);
    }
  }

  // Zone/age anchor = the REQUESTED date D (not literal today), so on the rolling
  // desktop board a bill dated for D reads as due, later as upcoming, and ageDays
  // is days-overdue relative to D. For 'openPending'/'single' the resolved
  // dateOnly IS today (they never carry a date param), so this is a no-op for
  // them — their zone/ageDays are unchanged. Deliberately NOT the checked arm's
  // IST instant window (`checkedStart`/`checkedEnd`, above): that answers "when
  // was it checked", this answers "when was it due".
  const anchorMs = dateOnly.getTime();

  const rows: PickingQueueRow[] = orders.map((order) => {
    // Override first, plain customer second — byte-for-byte the old
    // `order.shipToOverrideCustomer ?? order.customer`, resolved through the
    // batched Map instead of two hydrated relations. See the block comment on
    // dealerById above for why the fallback semantics are identical.
    const overrideDealer =
      order.shipToOverrideCustomerId !== null
        ? dealerById.get(order.shipToOverrideCustomerId)
        : undefined;
    const plainDealer =
      order.customerId !== null ? dealerById.get(order.customerId) : undefined;
    const effectiveDealer = overrideDealer ?? plainDealer ?? null;

    // Zone / age. Both dispatchTargetDate (@db.Date) and the `anchorMs` date
    // above are UTC-midnight anchored, so the millisecond delta is an exact
    // whole number of days — no rounding drift, no timezone arithmetic here.
    // Never new Date(str) and never a string compare (see resolveTargetDate).
    const targetDate = order.dispatchTargetDate;
    const noDispatchDate = targetDate === null;
    // Manual early release (5b) — a supervisor unlocked this future-dated
    // bill so it can be picked TODAY. Persisted on the order, so the
    // unlock survives refresh and every supervisor sees the same board.
    const isEarlyReleased = order.pickEarlyReleasedAt !== null;
    // Locked rule: a null date is 'due', never 'upcoming' — unscheduled work
    // must never hide behind the lock. noDispatchDate lets the UI say so.
    //
    // `!isEarlyReleased` is the ONLY thing 5b added here. Everything else is
    // unchanged, and the automatic midnight unlock still works exactly as
    // before: zone is recomputed from scratch on every fetch, so once
    // dispatchTargetDate <= today the bill graduates on its own with no job,
    // no write, and no dependence on this flag.
    const zone: "due" | "upcoming" =
      !noDispatchDate && targetDate.getTime() > anchorMs && !isEarlyReleased ? "upcoming" : "due";
    const ageDays = noDispatchDate
      ? null
      : Math.max(0, Math.floor((anchorMs - targetDate.getTime()) / MS_PER_DAY));

    return {
      zone,
      noDispatchDate,
      ageDays,
      // Pass-through of the existing column, not a derived value: @db.Date is
      // UTC-midnight anchored, so slicing the ISO string yields the correct
      // calendar day with no timezone maths (same basis as `isoDate` above).
      dispatchTargetDate: targetDate === null ? null : targetDate.toISOString().slice(0, 10),
      isEarlyReleased,
      earlyReleasedByName:
        order.pickEarlyReleasedById !== null
          ? (userNameById.get(order.pickEarlyReleasedById) ?? null)
          : null,
      orderId: order.id,
      obdNumber: order.obdNumber,
      dealerName: effectiveDealer?.customerName ?? "(Unmatched)",
      isShipToOverride: order.shipToOverrideCustomerId !== null,
      windowId: order.dispatchWindow?.id ?? null,
      windowTime: order.dispatchWindow?.windowTime ?? null,
      windowSortOrder: order.dispatchWindow?.sortOrder ?? null,
      deliveryType: effectiveDealer?.area?.deliveryType?.name ?? null,
      route: effectiveDealer?.area?.primaryRoute?.name ?? null,
      area: effectiveDealer?.area?.name ?? null,
      priorityLevel: order.priorityLevel,
      isKeyCustomer: effectiveDealer?.isKeyCustomer ?? false,
      articleTag: order.querySnapshot?.articleTag ?? null,
      volumeLitres: order.querySnapshot?.totalVolume ?? null,
      weightKg: order.querySnapshot?.totalWeight ?? null,
      // Pure in-memory reverse lookup — NO new query, no new column, no join.
      // `order.smu` is already here: the findMany above uses `include`, which
      // returns every base-model scalar (the same reason obdDateTime/orderType
      // need no select entry). An unmapped or blank name yields null, which the
      // UI treats exactly as "no SMU" — never a guess.
      smuCode: order.smu !== null ? (SMU_CODE_BY_NAME[order.smu] ?? null) : null,
      // Tint is order-level — orders.orderType is the canonical source (set at
      // import), already present via `include`. Never a tint skuId (§13).
      isTint: order.orderType === "tint",
      // Distinct families, display-resolved, stable alpha-sorted (locale "en"
      // — same depot-PC-vs-Vercel determinism basis as the sort spine). Empty
      // array when nothing resolved; never null.
      families: Array.from(familiesByObd.get(order.obdNumber) ?? []).sort((a, b) =>
        a.localeCompare(b, "en", { sensitivity: "base" }),
      ),
      unresolvedLineCount: unresolvedByObd.get(order.obdNumber) ?? 0,
      // CLAUDE_SUPPORT.md §4.5 — orderDateTime is never null in practice (set
      // at SAP import, overwritten by enrichment on a mail match); the
      // obdEmailDate fallback is a seatbelt, not a common path. Both scalars
      // are already present on `order` — no select change needed, `include`
      // returns all base-model scalars alongside the named relations.
      obdDateTime: order.orderDateTime ?? order.obdEmailDate ?? null,
      isAssigned: order.workflowStage === PICK_ASSIGNED,
      isDone: order.workflowStage === PICK_DONE,
      isChecked: order.workflowStage === PICK_CHECKED,
      assignedAt: order.pickAssignment?.assignedAt ?? null,
      pickedAt: order.pickAssignment?.pickedAt ?? null,
      checkedAt: order.pickAssignment?.checkedAt ?? null,
      // The three actor names, resolved off the batched user Map. Each guards
      // its own FK exactly as the old optional-chained relation did: no
      // pick_assignments row → null; a null checkedById → null.
      checkedByName:
        order.pickAssignment?.checkedById != null
          ? (userNameById.get(order.pickAssignment.checkedById) ?? null)
          : null,
      pickerId: order.pickAssignment?.pickerId ?? null,
      assignedToName:
        order.pickAssignment?.pickerId != null
          ? (userNameById.get(order.pickAssignment.pickerId) ?? null)
          : null,
      assignedByName:
        order.pickAssignment?.assignedById != null
          ? (userNameById.get(order.pickAssignment.assignedById) ?? null)
          : null,
    };
  });

  const sortedRows = sortPickingQueue(rows);

  // ── Pick-bundling raw material (2026-08-18) ───────────────────────────────
  //
  // WAITING DUE-ZONE ROWS ONLY — the exact predicate this file's own §153
  // comment preserved: !isAssigned && !isDone && !isChecked && zone !== 'upcoming'.
  // Only such a row can be handed to a picker as part of a bundle; fetching for
  // the Picking/Done tabs or Zone 2 would be a payload with no reader.
  //
  // ⚠ WHY THESE ARE TWO NEW QUERIES AND NOT THE FAMILY ONES ABOVE. The family
  // aggregation already reads both tables — but its line query filters
  // `rowStatus: 'valid'`, and Floor's skusByObd deliberately does NOT ("a
  // parse-rejected row is still a tin the picker will be holding"). Reusing it
  // would give the phone a DIFFERENT SKU set than Floor for any OBD carrying a
  // parse-rejected line, so the same two bills could bundle on one screen and
  // not the other — one rule, two answers, which is the defect that moving the
  // engine into lib/picking existed to prevent. Its `rowStatus` filter is also
  // load-bearing for the card's family chips, so it cannot simply be relaxed.
  // The cost is two extra SELECTs on one tab's rows; the alternative is a
  // silent desync between two screens one supervisor uses in the same shift.
  //
  // Sequential awaits, never prisma.$transaction (CORE §3). SELECT-only — no
  // `orders.update` anywhere near this (a second write would fire a false
  // "changed" on every board, the marker landmine).
  //
  // ⚠ Matched on `sku_master_v2.material` === `import_raw_line_items.skuCodeRaw`
  // ONLY — never `skuId`, never old `sku_master` (CORE §13: the two catalog
  // tables share no id space, so an id join would bundle unrelated products).
  let waitingSkus: PickingBillSkus[] = [];
  let oilSkus: PickingBillSkus[] = [];

  if (PICKING_GROUPING_ENABLED) {
    const bundleRows = sortedRows.filter(
      (r) => !r.isAssigned && !r.isDone && !r.isChecked && r.zone !== "upcoming",
    );
    const bundleObds = Array.from(new Set(bundleRows.map((r) => r.obdNumber)));

    // 1. Distinct active codes per OBD. No `rowStatus` filter — see above.
    const bundleLines =
      bundleObds.length > 0
        ? await prisma.import_raw_line_items.findMany({
            where: { obdNumber: { in: bundleObds }, lineStatus: "active" },
            select: { obdNumber: true, skuCodeRaw: true },
          })
        : [];

    const setByObd = new Map<string, Set<string>>();
    for (const l of bundleLines) {
      if (!l.skuCodeRaw) continue;
      let set = setByObd.get(l.obdNumber);
      if (!set) {
        set = new Set<string>();
        setByObd.set(l.obdNumber, set);
      }
      set.add(l.skuCodeRaw);
    }

    // Emitted in `sortedRows` order (spine-sorted, obdNumber tie-broken), and
    // each list distinct + locale-"en" sorted — so the payload is byte-stable
    // between loads, which is what the engine's determinism contract rests on.
    // A bill with no active lines gets an EMPTY array, never a missing entry:
    // the engine drops those candidates explicitly and can only do so if it is
    // told they exist.
    waitingSkus = bundleRows.map((r) => ({
      orderId: r.orderId,
      skus: Array.from(setByObd.get(r.obdNumber) ?? []).sort((a, b) => a.localeCompare(b, "en")),
    }));

    // 2. Catalog rows for those codes, for the oil-paint classification. An
    //    UNMATCHED code simply never comes back, so it can never be classified
    //    oil — unknown stays OUTSIDE, the safe direction.
    const bundleCodes = new Set<string>();
    for (const entry of waitingSkus) {
      for (const code of entry.skus) bundleCodes.add(code);
    }

    if (bundleCodes.size > 0) {
      const catalog = await prisma.sku_master_v2.findMany({
        where: { material: { in: Array.from(bundleCodes) } },
        select: { material: true, category: true, paintType: true },
      });
      const oil = buildOilSkuSet(catalog);
      oilSkus = waitingSkus.map((entry) => ({
        orderId: entry.orderId,
        skus: entry.skus.filter((code) => oil.has(code)),
      }));
    }
  }

  return {
    date: isoDate,
    rows: sortedRows,
    waitingSkus,
    oilSkus,
  };
}
