import { prisma } from "@/lib/prisma";
import { sortPickingQueue } from "./sort";
import {
  SUPPORT_DONE_OUTPUT,
  PICK_ASSIGNED,
  PICK_DONE,
  PICK_CHECKED,
  PICKING_ACTIVE_STAGES,
  PICKING_OPEN_STAGES,
} from "@/lib/workflow-stages";
import type { PickingQueueRow } from "./types";

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
 *                 date by equality. The desktop board (components/picking/
 *                 picking-queue.tsx) depends on this exactly as-is: its date
 *                 stepper, its per-window header segments and its "All"/"OBDs"
 *                 counts are all built on a single-date slice.
 *
 * 'openPending' — the mobile boards (2026-07-20 date-zones redesign). Pending
 *                 and in-progress work across ALL dates (no dispatchTargetDate
 *                 fence), PLUS today's checked bills only. Both arms keep
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
// 'rolling' — the desktop day-board (step 5, 2026-07-21). Active picking-stage
// rows across ALL dates (NO date fence), split by `zone` (computed vs the
// requested date D): due = dispatchTargetDate <= D or null; upcoming = > D.
// Overdue leftovers from earlier days are included, unbounded. Distinct from
// 'single' (strict one-day equality, kept for backward-compat) — do NOT conflate.
export type PickingQueueScope = "single" | "openPending" | "rolling";

export interface PickingQueueOptions {
  /** YYYY-MM-DD. Meaningful in 'single' scope only; omitted → today in IST. */
  date?: string;
  /** Defaults to 'single' — today's behaviour for every pre-existing caller. */
  scope?: PickingQueueScope;
}

export interface PickingWindowSummary {
  id: number;
  windowTime: string;
  sortOrder: number;
  count: number;
}

export interface PickingQueueResult {
  // 'single': the date the payload is fenced to. 'openPending': the IST day
  // used as the zone/ageDays anchor (rows themselves span many dates).
  date: string;
  rows: PickingQueueRow[];
  windows: PickingWindowSummary[];
  unmatchedCount: number;
  // Unassigned count only — the tab badge shows work remaining, not work
  // done. Assigned rows are still present in `rows` (sunk to the bottom by
  // byAssigned) but excluded from this and from windows[].count.
  totalCount: number;
  assignedCount: number;
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
 * Live derived read — SELECT only. Fetches dispatch-stamped OBDs —
 * unassigned (SUPPORT_DONE_OUTPUT), assigned (PICK_ASSIGNED), picked
 * (PICK_DONE), and checked (PICK_CHECKED, added 2026-07-18 for the
 * supervisor board's Checked tab) — resolves the effective dealer per row,
 * and hands the result to the pure sort module. No writes. No orderBy in
 * the Prisma query — sorting is entirely sortPickingQueue()'s job
 * (byAssigned sinks assigned rows to the bottom).
 *
 * DATE SCOPE is chosen by `options.scope` (see PickingQueueScope above);
 * 'single' is the default and is behaviourally identical to this function's
 * pre-2026-07-20 form. Rows carry `zone`/`noDispatchDate`/`ageDays` in both
 * scopes, but they only vary meaningfully under 'openPending'.
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
 * KNOWN GAP (not fixed here — would change desktop's displayed numbers,
 * out of scope for this addition): `windows[].count` below (line ~`!r.isAssigned`)
 * and `totalCount`'s `sortedRows.length - assignedCount` do NOT exclude
 * `isDone`/`isChecked` rows, so both desktop stats over-count "still
 * queued" bills by however many are done or checked today. Pre-existing
 * for `isDone`; `isChecked` just compounds it. See CLAUDE_PICKING.md §7.
 * Scope of the damage, verified by grep 2026-07-20: `windows`/`totalCount`/
 * `unmatchedCount` are read ONLY by components/picking/picking-queue.tsx
 * (:539, :608, :613, :615, :715). No mobile file reads them — the bottom-bar
 * tab counts are computed independently and correctly in
 * picking-mobile-shell.tsx. So this over-count is desktop-only, and the
 * 'openPending' scope cannot worsen it (desktop never uses that scope).
 */
export async function getPickingQueue(
  options: PickingQueueOptions = {},
): Promise<PickingQueueResult> {
  const { date: dateStr, scope = "single" } = options;
  const { isoDate, dateOnly } = resolveTargetDate(dateStr);

  // Today in IST, always — the anchor for zone/ageDays in BOTH scopes, and
  // the fence for 'openPending''s checked arm. Independent of `dateOnly`,
  // which in 'single' scope may be any day the desktop stepper landed on.
  const { dateOnly: todayDateOnly } = getISTTodayDate();

  // Two shapes, one stage universe. PICKING_OPEN_STAGES ⊂ PICKING_ACTIVE_STAGES
  // by construction (lib/workflow-stages.ts), so the scopes cannot drift into
  // showing different bills on desktop vs. mobile. Neither admits 'closed' —
  // see that file for the 572-row evidence behind that exclusion.
  const where =
    scope === "openPending"
      ? {
          dispatchStatus: "dispatch",
          isRemoved: false,
          // NO dispatchTargetDate fence on the open arm — that is the whole
          // point of this scope. The checked arm keeps its own today-fence,
          // per the locked design ("only the Checked band stays on today").
          OR: [
            { workflowStage: { in: PICKING_OPEN_STAGES } },
            { workflowStage: PICK_CHECKED, dispatchTargetDate: todayDateOnly },
          ],
        }
      : scope === "rolling"
        ? {
            // Desktop day-board (step 5b — date-bounded PER STAGE). Carry-over is
            // status-aware so finished work from earlier days does NOT flood the
            // board: a Ready/Picked order never leaves an active stage (no
            // 'dispatched' stage drains it yet), so an unbounded fetch pours every
            // historical done/checked row onto today. zone/ageDays stay anchored on
            // D below. Never the historical 'closed' union (PICKING_ACTIVE_STAGES).
            dispatchStatus: "dispatch",
            isRemoved: false,
            OR: [
              // (a) exactly D → all four active statuses; today shows the full
              //     Waiting/Assigned/Picked/Ready spread.
              { dispatchTargetDate: dateOnly, workflowStage: { in: PICKING_ACTIVE_STAGES } },
              // (b) before D → ONLY still-unfinished (pending_picking, pick_assigned).
              //     Older Picked/Checked rows are finished work from a previous day
              //     and are deliberately excluded — this is the step-5b fix.
              { dispatchTargetDate: { lt: dateOnly }, workflowStage: { in: [SUPPORT_DONE_OUTPUT, PICK_ASSIGNED] } },
              // (c) after D → active stages, for the (step-6) upcoming zone; rendered
              //     nowhere until then, but fetched so that section has its data.
              { dispatchTargetDate: { gt: dateOnly }, workflowStage: { in: PICKING_ACTIVE_STAGES } },
              // Null date → keep current behaviour: included, zoned "due" (a date
              // comparison never matches NULL, so this needs its own explicit arm).
              { dispatchTargetDate: null, workflowStage: { in: PICKING_ACTIVE_STAGES } },
            ],
          }
        : {
            dispatchStatus: "dispatch",
            dispatchTargetDate: dateOnly,
            // Unassigned, assigned, AND picked current stages. Assigned
            // (PICK_ASSIGNED) rows are sunk to the bottom by sort.ts's
            // byAssigned rule; picked (PICK_DONE) rows are NOT (isAssigned is
            // false for them too — see the doc comment above this function) —
            // harmless, since both board consumers filter PICK_DONE rows out of
            // their rendered lists entirely rather than relying on sort position.
            // Never the historical 'closed' union — see lib/workflow-stages.ts and
            // CLAUDE_SUPPORT.md §3 (parking-stage flip).
            workflowStage: { in: PICKING_ACTIVE_STAGES },
            isRemoved: false,
          };

  // Sequential awaits only — never prisma.$transaction (CORE §3).
  const orders = await prisma.orders.findMany({
    where,
    include: {
      customer: { select: DEALER_SELECT },
      shipToOverrideCustomer: { select: DEALER_SELECT },
      dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
      // Early-release actor (5b) — name only, for the "released" chip's
      // provenance. The timestamp itself is a base scalar and arrives via
      // `include` without being named here.
      pickEarlyReleasedBy: { select: { name: true } },
      // 1:1, optional — an order may have no snapshot row. Source: CLAUDE_SUPPORT.md §4.19.
      querySnapshot: { select: { articleTag: true, totalVolume: true, totalWeight: true } },
      // 1:1, optional — present only once the order is PICK_ASSIGNED (or later).
      // pickerId added 2026-07-17 for server-side "my bills only" scoping on
      // the picker "My Picks" face — a real FK, not a display-name match.
      // pickedAt added same day (step 5) for the Check tab's "Needs check"
      // pill and the picker Done card's timestamp — null until PICK_DONE.
      pickAssignment: {
        select: {
          pickerId: true,
          assignedAt: true,
          pickedAt: true,
          // checkedAt/checkedBy added 2026-07-18 for the Checked tab's
          // "checked {time}" line and the checker-name traceability segment.
          checkedAt: true,
          checkedBy: { select: { name: true } },
          picker: { select: { name: true } },
          assignedBy: { select: { name: true } },
        },
      },
    },
  });

  const activeWindows = await prisma.dispatch_slot_master.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, windowTime: true, sortOrder: true },
  });

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
          select: { material: true, category: true, displayCategory: true },
        })
      : [];

  // family = COALESCE(displayCategory, category) — the SINGLE resolution point,
  // so the deferred friendly-name swap is data-only later (displayCategory is
  // empty today, so family === category for now). Trim-guarded: a resolved-but-
  // blank family is treated as "no family" downstream (COALESCE only falls back
  // on NULL, and category is NOT NULL, so this is belt-and-braces — a blank
  // chip is worse than counting the line as unlisted).
  const familyByCode = new Map<string, string>();
  for (const c of catalogRows) {
    const resolved = (c.displayCategory ?? c.category ?? "").trim();
    if (resolved !== "") familyByCode.set(c.material, resolved);
  }

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

  let unmatchedCount = 0;

  // Zone/age anchor = the REQUESTED date D (not literal today), so on the rolling
  // desktop board a bill dated for D reads as due, later as upcoming, and ageDays
  // is days-overdue relative to D. For 'openPending'/'single' the resolved
  // dateOnly IS today (they never carry a date param), so this is a no-op for
  // them — their zone/ageDays are unchanged. `todayDateOnly` is still used, above,
  // ONLY for openPending's checked-arm today-fence.
  const anchorMs = dateOnly.getTime();

  const rows: PickingQueueRow[] = orders.map((order) => {
    const effectiveDealer = order.shipToOverrideCustomer ?? order.customer;
    if (!effectiveDealer) unmatchedCount++;

    // Zone / age. Both dispatchTargetDate (@db.Date) and todayDateOnly are
    // UTC-midnight anchored, so the millisecond delta is an exact whole
    // number of days — no rounding drift, no timezone arithmetic here.
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
      earlyReleasedByName: order.pickEarlyReleasedBy?.name ?? null,
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
      checkedByName: order.pickAssignment?.checkedBy?.name ?? null,
      pickerId: order.pickAssignment?.pickerId ?? null,
      assignedToName: order.pickAssignment?.picker?.name ?? null,
      assignedByName: order.pickAssignment?.assignedBy?.name ?? null,
    };
  });

  const sortedRows = sortPickingQueue(rows);

  // Count landmine fix (step 5B) — a slot badge and the total must mean "still
  // needs a picker in this slot today," so exclude assigned/done/checked AND
  // upcoming (future-dated) rows from BOTH formulas. Done/checked rows and the
  // assigned pile still ride in `rows` (rendered inline on desktop) — just not
  // counted. Desktop-only in effect: mobile computes its own counts and never
  // reads windows[].count / totalCount (see this function's doc comment).
  const isStillWaiting = (r: PickingQueueRow): boolean =>
    !r.isAssigned && !r.isDone && !r.isChecked && r.zone !== "upcoming";

  const windows: PickingWindowSummary[] = activeWindows.map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    sortOrder: w.sortOrder,
    count: sortedRows.filter((r) => r.windowId === w.id && isStillWaiting(r)).length,
  }));

  const assignedCount = sortedRows.filter((r) => r.isAssigned).length;

  return {
    date: isoDate,
    rows: sortedRows,
    windows,
    unmatchedCount,
    totalCount: sortedRows.filter(isStillWaiting).length,
    assignedCount,
  };
}
