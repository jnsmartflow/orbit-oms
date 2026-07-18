import { prisma } from "@/lib/prisma";
import { sortPickingQueue } from "./sort";
import { SUPPORT_DONE_OUTPUT, PICK_ASSIGNED, PICK_DONE, PICK_CHECKED } from "@/lib/workflow-stages";
import type { PickingQueueRow } from "./types";

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

export interface PickingWindowSummary {
  id: number;
  windowTime: string;
  sortOrder: number;
  count: number;
}

export interface PickingQueueResult {
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
 * Live derived read — SELECT only. Fetches today's dispatch-stamped OBDs —
 * unassigned (SUPPORT_DONE_OUTPUT), assigned (PICK_ASSIGNED), picked
 * (PICK_DONE), and checked (PICK_CHECKED, added 2026-07-18 for the
 * supervisor board's Checked tab) — resolves the effective dealer per row,
 * and hands the result to the pure sort module. No writes. No orderBy in
 * the Prisma query — sorting is entirely sortPickingQueue()'s job
 * (byAssigned sinks assigned rows to the bottom).
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
 */
export async function getPickingQueue(dateStr?: string): Promise<PickingQueueResult> {
  const { isoDate, dateOnly } = resolveTargetDate(dateStr);

  // Sequential awaits only — never prisma.$transaction (CORE §3).
  const orders = await prisma.orders.findMany({
    where: {
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
      workflowStage: { in: [SUPPORT_DONE_OUTPUT, PICK_ASSIGNED, PICK_DONE, PICK_CHECKED] },
      isRemoved: false,
    },
    include: {
      customer: { select: DEALER_SELECT },
      shipToOverrideCustomer: { select: DEALER_SELECT },
      dispatchWindow: { select: { id: true, windowTime: true, sortOrder: true } },
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

  let unmatchedCount = 0;

  const rows: PickingQueueRow[] = orders.map((order) => {
    const effectiveDealer = order.shipToOverrideCustomer ?? order.customer;
    if (!effectiveDealer) unmatchedCount++;

    return {
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

  // Tab badges and totalCount show work REMAINING — assigned rows are still
  // in `rows` (rendered, sunk to the bottom by byAssigned) but excluded here.
  const windows: PickingWindowSummary[] = activeWindows.map((w) => ({
    id: w.id,
    windowTime: w.windowTime,
    sortOrder: w.sortOrder,
    count: sortedRows.filter((r) => r.windowId === w.id && !r.isAssigned).length,
  }));

  const assignedCount = sortedRows.filter((r) => r.isAssigned).length;

  return {
    date: isoDate,
    rows: sortedRows,
    windows,
    unmatchedCount,
    totalCount: sortedRows.length - assignedCount,
    assignedCount,
  };
}
