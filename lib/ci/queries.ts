// lib/ci/queries.ts
//
// The CI read feeds — stage-1 bill search, one bill's lines, the two board
// faces, and one CI's detail.
//
// SELECT ONLY. There is not a single write in this file and none may be added;
// the write paths (submit / close / create) are their own routes, step 3c.
//
// ⚠ THE WHERE BUILDERS ARE EXPORTED, AND THE MARKER MUST USE THEM.
// app/api/ci/marker/route.ts counts and aggregates over the SAME predicate the
// billing board renders. Re-declaring a WHERE in the marker is precisely the
// drift the Picking §10, Floor §10 and MRN marker landmines all warn about: a
// marker watching a NARROWER set than the board silently misses updates on the
// desk. Wider is harmless (a few extra refetches); narrower is a bug nobody
// sees until a CI is missed. Never re-type these predicates — import them.
//
// 🔴 EVERY FEED IN THIS FILE FILTERS `status <> 'draft'` AND `isVoided = false`.
// A draft is an in-flight write, not a record: it exists only between the header
// insert and the number allocation (spec §6's write order), and it is the reason
// ci_returns.ciNumber is nullable. If a null-numbered row is ever visible on a
// screen, the filter is missing — the number is not.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
// The division number, derived from `orders.smu`'s NAME. ONE map, kept beside
// its inverse in lib/import-upsert/types.ts — never re-typed locally, and never
// resolved by joining import_raw_summary, which CI has no other use for.
// Third caller of the same rule (lib/picking/queue.ts, lib/floor/queries.ts:779).
import { SMU_CODE_BY_NAME } from "@/lib/import-upsert/types";
import { applyCiCatalog, resolveCiSkus } from "./resolve-lines";
import { billTotals, ciTotals, litresPerTin, resolveCiDealer, round3 } from "./derive";
import { asCiStatus } from "./types";
import type {
  CiBillLine,
  CiBillResult,
  CiBillingBoard,
  CiBoardRow,
  CiDetail,
  CiDetailLine,
  CiSearchHit,
  CiSearchResult,
  CiSupervisorBoard,
  CiReturnType,
  CiMaterialMoved,
} from "./types";

// ── Search-term normalisation (spec §4) ──────────────────────────────────────

const BARE_INVOICE_DIGITS = /^\d{9}$/;

/** The last-4 shortcut: exactly four digits and nothing else. */
const LAST_FOUR_DIGITS = /^\d{4}$/;

/**
 * 🔴 HOW FAR BACK A BILL IS SEARCHABLE (owner ruling 2026-09-01, step 9).
 *
 * A return comes back within days, not months, so nothing older than a month
 * is worth offering — and the fence is also what makes the last-4 SUFFIX match
 * affordable. A suffix cannot use `orders_invoiceNo_idx` (a b-tree indexes
 * prefixes, so `LIKE '%1234'` is a scan by definition); fencing the scan to
 * one calendar month is what keeps it small instead of growing with the table
 * forever.
 */
export const CI_SEARCH_WINDOW_DAYS = 31;

/**
 * Normalise what the supervisor typed into what we query.
 *
 * Measured over all 6,950 live invoice numbers (2026-08-31): EVERY one is `I`
 * plus 9 digits, length 10, uppercase, no spaces, no padding — a single shape
 * with zero exceptions. So normalising is `trim().toUpperCase()` and nothing
 * more elaborate.
 *
 * ⚠ THE BARE-9-DIGITS RULE IS DELIBERATE (spec §4). A supervisor reading a
 * paper invoice will type the digits and leave the `I` off; without this he
 * gets an empty result for a number he read correctly, which looks like a
 * broken search rather than a typo. 9 digits is unambiguous — an OBD number is
 * 10 — so the two cannot collide.
 *
 * Returns the term to match against BOTH `invoiceNo` and `obdNumber`; the caller
 * does not need to know which one it will hit.
 *
 * ⚠ FOUR DIGITS ARE LEFT ALONE. The last-4 shortcut is a SUFFIX, not a whole
 * number, so it must not be prefixed with `I` — `I2577` is not the start of
 * anything. searchCiBills below decides what to do with it; this function's job
 * is only to canonicalise a WHOLE term.
 */
export function normaliseCiSearchTerm(raw: string): string {
  const q = raw.trim().toUpperCase();
  if (LAST_FOUR_DIGITS.test(q)) return q;
  return BARE_INVOICE_DIGITS.test(q) ? `I${q}` : q;
}

// ── Stage 1: find the bill ───────────────────────────────────────────────────

/** Only these two relations, only these fields — the dealer rule needs exactly
 *  this shape (lib/ci/derive.ts resolveCiDealer). */
const ORDER_DEALER_SELECT = {
  shipToOverrideCustomer: { select: { customerName: true } },
  customer: { select: { customerName: true } },
} as const;

/**
 * Search for the bill a return belongs to, by invoice number OR OBD number.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THREE WAYS TO MATCH (owner ruling 2026-09-01, step 9)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   1. the FULL invoice number   — `I536225770`, or bare `536225770`
 *   2. the FULL OBD number       — `9109145575`
 *   3. THE LAST FOUR DIGITS of the invoice number — `5770`
 *
 * (3) is what he can read off a crumpled delivery copy without squinting at ten
 * digits. It is deliberately invoice-ONLY: applying it to the OBD as well would
 * roughly double the hits for no gain, because he is reading a paper invoice.
 *
 * 🔴 ALWAYS RETURNS A LIST, NEVER findFirst (spec §4). 11 live invoice numbers
 * map to TWO OBDs each — a split bill fanning out, always sharing one soNumber.
 * Picking the first would silently file returned goods against the wrong half.
 *
 * ⚠ AND THE UI NO LONGER SHORTCUTS A SINGLE HIT EITHER. That is not a UI note
 * misfiled here: it is the direct consequence of (3), and the reason is written
 * at the call site in components/ci/new-return.tsx. A four-digit suffix is not
 * unique, so "exactly one hit" stopped meaning "he finished typing".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 FENCED TO THE LAST MONTH — AND THE FENCE IS LATCHED TO THE INDEX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A suffix match cannot use `orders_invoiceNo_idx`: a b-tree indexes prefixes,
 * so `endsWith` is a scan whatever exists. The date window is what bounds that
 * scan — without it the cost grows with the orders table forever. Nothing older
 * than CI_SEARCH_WINDOW_DAYS is searchable, and that is a product rule too: a
 * dealer does not return goods off a three-month-old bill through this screen.
 *
 * ⚠ THE WINDOW IS ON `orderDateTime`, NOT `invoiceDate`. Measured 2026-09-01:
 * `invoiceDate` is NULL on 5,546 of 12,569 live orders (44%), because an invoice
 * number arrives after dispatch (spec §4) — fencing on it would make the NEWEST
 * bills, the ones most likely to come back, the only ones not findable.
 * `orderDateTime` is non-null on all 12,569 and is the same column
 * CiBillResult.obdDateTime already reports.
 *
 * SCAN SIZE: 3,217 of 12,569 orders fall inside 31 days (26%). That is what the
 * suffix arm walks — a bounded few thousand rows, not the whole table, and it
 * does not grow as the table does.
 *
 * Both columns are indexed: `orders_obdNumber_key`/`_idx` were always there and
 * `orders_invoiceNo_idx` was added 2026-08-31 — before it, half of every search
 * was a sequential scan.
 *
 * Sequential awaits, never prisma.$transaction (CORE §3).
 */
export async function searchCiBills(rawQuery: string): Promise<CiSearchResult> {
  const query = normaliseCiSearchTerm(rawQuery);
  if (query === "") return { query, hits: [] };

  // The window's floor, in IST. `getISTDayRange()` gives today's IST midnight;
  // stepping back from it keeps the fence on a calendar boundary rather than on
  // "now minus 31 × 86400s", which would drift the cut through the working day.
  const windowStart = new Date(
    getISTDayRange().start.getTime() - CI_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  // The suffix arm is added ONLY for a bare 4-digit term. On a full number it is
  // absent, so those searches stay pure equality and keep using the index.
  const suffix = LAST_FOUR_DIGITS.test(query);

  const orders = await prisma.orders.findMany({
    where: {
      isRemoved: false,
      // ⚠ orderDateTime, not invoiceDate — see the header. 44% of live orders
      // have no invoiceDate, and they are the recent ones.
      orderDateTime: { gte: windowStart },
      OR: suffix
        ? // 🔴 INVOICE ONLY on the suffix arm, deliberately (see the header).
          [{ invoiceNo: { endsWith: query } }]
        : [{ invoiceNo: query }, { obdNumber: query }],
    },
    select: {
      id: true,
      obdNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      orderDateTime: true,
      obdEmailDate: true,
      shipToCustomerName: true,
      ...ORDER_DEALER_SELECT,
    },
    orderBy: { obdNumber: "asc" },
  });
  if (orders.length === 0) return { query, hits: [] };

  // The card needs "12 lines · 212 L", so the lines have to be counted and
  // summed. ONE query for every hit's OBD, never one per hit — the batch-and-
  // match shape lib/picking/queue.ts uses throughout.
  //
  // ⚠ ACTIVE LINES ONLY. 113 rows across 100 OBDs are `removed_by_import`;
  // counting them would advertise lines SAP has withdrawn.
  const lines = await prisma.import_raw_line_items.findMany({
    where: {
      obdNumber: { in: orders.map((o) => o.obdNumber) },
      lineStatus: "active",
    },
    select: { obdNumber: true, volumeLine: true },
  });

  const agg = new Map<string, { n: number; litres: number }>();
  for (const l of lines) {
    if (l.obdNumber === null) continue;
    const cur = agg.get(l.obdNumber) ?? { n: 0, litres: 0 };
    cur.n += 1;
    cur.litres += l.volumeLine ?? 0;
    agg.set(l.obdNumber, cur);
  }

  const hits: CiSearchHit[] = orders.map((o) => {
    const a = agg.get(o.obdNumber) ?? { n: 0, litres: 0 };
    return {
      orderId: o.id,
      obdNumber: o.obdNumber,
      customerName: resolveCiDealer(o),
      invoiceNo: o.invoiceNo,
      invoiceDate: o.invoiceDate ? isoDate(o.invoiceDate) : null,
      obdDateTime: (o.orderDateTime ?? o.obdEmailDate)?.toISOString() ?? null,
      lineCount: a.n,
      totalLitres: round3(a.litres),
    };
  });

  return { query, hits };
}

// ── Stage 1: the bill's lines ────────────────────────────────────────────────

/**
 * One bill, with the lines the supervisor ticks against.
 *
 * ⚠ These are SOURCE lines from `import_raw_line_items`, not ci_return_lines.
 * The submit route (3c) SNAPSHOTS them onto the CI, because a re-import PATCHES
 * a matched line in place and a closed CI must not silently change what it
 * claims was delivered.
 *
 * 🔴 THREE RULES, ALL MEASURED, NONE OPTIONAL:
 *   • join on the `obdNumber` TEXT column — there is NO FK from `orders` to its
 *     line items; Picking and Floor both join on the string;
 *   • `lineStatus: 'active'` only;
 *   • SKUs via `sku_master_v2.material` (lib/ci/resolve-lines.ts).
 *
 * Returns null when the order does not exist or is soft-removed — the two are
 * deliberately not distinguished, the same rule getMrnDetail() follows.
 *
 * Three sequential awaits: the order, its lines, the catalog. Never
 * prisma.$transaction (CORE §3).
 */
export async function getCiBill(orderId: number): Promise<CiBillResult | null> {
  const order = await prisma.orders.findFirst({
    where: { id: orderId, isRemoved: false },
    select: {
      id: true,
      obdNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      orderDateTime: true,
      obdEmailDate: true,
      soNumber: true,
      customerId: true,
      shipToCustomerId: true,
      shipToCustomerName: true,
      ...ORDER_DEALER_SELECT,
    },
  });
  if (!order) return null;

  const raw = await prisma.import_raw_line_items.findMany({
    where: { obdNumber: order.obdNumber, lineStatus: "active" },
    select: {
      id: true,
      lineId: true,
      skuCodeRaw: true,
      unitQty: true,
      volumeLine: true,
    },
    orderBy: { lineId: "asc" },
  });

  const catalog = await resolveCiSkus(raw.map((l) => l.skuCodeRaw));

  const lines: CiBillLine[] = raw.map((l) => {
    const code = l.skuCodeRaw ?? "";
    return {
      rawLineItemId: l.id,
      lineId: l.lineId,
      skuCode: code,
      ...applyCiCatalog(code, catalog),
      deliveryQty: l.unitQty ?? 0,
      // 🔴 Guarded on unitQty ONLY. volumeLine = 0 is a REAL value (346 active
      // lines are brushes and rollers) and must survive as 0, not become null.
      litresPerTin: litresPerTin(l.volumeLine, l.unitQty),
      lineLitres: round3(l.volumeLine ?? 0),
    };
  });

  const totals = billTotals(lines);

  return {
    orderId: order.id,
    obdNumber: order.obdNumber,
    customerName: resolveCiDealer(order),
    invoiceNo: order.invoiceNo,
    invoiceDate: order.invoiceDate ? isoDate(order.invoiceDate) : null,
    obdDateTime: (order.orderDateTime ?? order.obdEmailDate)?.toISOString() ?? null,
    totalLitres: totals.totalLitres,
    soNumber: order.soNumber,
    customerId: order.customerId,
    customerCode: order.shipToCustomerId,
    lines,
  };
}

// ── The shared predicates ────────────────────────────────────────────────────

/**
 * 🔴 THE ONE PREDICATE. The billing board renders it and the marker aggregates
 * over it — never two copies. See this file's header.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 PENDING IS NEVER DATE-FENCED. THE STEPPER DRIVES THE CLOSED SECTION ONLY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pending is the WHOLE BACKLOG — every CI the floor has handed over and billing
 * has not closed, however old. A CI raised on Friday and still open on Monday is
 * exactly the row billing most needs to see, and a today-fence would hide it.
 *
 * The billing Picking tab learned this the hard way: a today-fence there
 * rendered an EMPTY TAB over a real backlog of older bills — a screen
 * confidently reporting "nothing to do" while work sat behind it. Do not
 * reintroduce a date fence on the pending arm for symmetry with the closed one.
 *
 * CLOSED fences on `closedAt` — the day billing FINISHED it, which is the
 * question a date stepper on this screen asks ("what did I close on the 31st").
 * Not `submittedAt`: a CI submitted Friday and closed Monday belongs to
 * Monday's closed list, and the two dates genuinely differ.
 *
 * ⚠ ONE `OR`, NOT TWO CALLS. The marker aggregates COUNT + MAX(updatedAt) over
 * a single WHERE, so the two arms have to compose into one predicate or the
 * marker could only ever watch half the rail.
 */
export function buildCiBillingWhere(range: { start: Date; end: Date }): Prisma.ci_returnsWhereInput {
  return {
    isVoided: false,
    OR: [
      // Pending — the whole backlog, no date at all. `returned_to_floor` rides
      // with it: if that flow is ever built, such a CI is still billing's
      // outstanding work, not a closed one.
      { status: { in: ["submitted", "returned_to_floor"] } },
      // Closed — only the day the stepper is on.
      { status: "closed", closedAt: { gte: range.start, lt: range.end } },
    ],
    // Never 'draft'. A draft is an in-flight write, not a record — and both arms
    // above name their statuses explicitly, so a draft cannot match either.
  };
}

/**
 * The supervisor's Submitted tab.
 *
 * ⚠ SCOPED TO HIS OWN CIs, as the mockup draws it — spec §11.5 is an OPEN
 * DECISION ("does Submitted show other supervisors' CIs, or only his own?").
 * The scope lives HERE and nowhere else, so answering §11.5 the other way is
 * deleting one line.
 *
 * Date fencing: the outstanding band spans ALL dates (work handed to billing
 * yesterday is still his to see), and only the finished band is fenced — a
 * receipt, not a task.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE FINISHED BAND IS SEVEN DAYS, NOT TODAY (2026-09-01, step 7e).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It was `closedAt` within TODAY, which meant a CI he raised on Friday and
 * billing closed on Monday was on his phone for a few hours and then vanished —
 * and there is no other screen where a floor supervisor can find it. The
 * supervisor face has no date stepper (billing's has one; his is a phone), so
 * "today" was not a filter he could change, it was a cliff.
 *
 * Seven days INCLUSIVE OF TODAY: six IST midnights back, up to the end of the
 * current IST day. That covers "last week some time", which is how the depot
 * actually talks about a recent return.
 *
 * ⚠ THE PENDING BAND IS UNTOUCHED AND MUST STAY UNTOUCHED. It has no date at
 * all, deliberately: work still sitting with billing is outstanding however old
 * it is, and fencing it would hide a backlog rather than shorten it.
 */
export const CI_SUPERVISOR_FINISHED_DAYS = 7;

export function buildCiSupervisorWhere(
  band: "withBilling" | "finished",
  supervisorId: number,
  todayRange: { start: Date; end: Date },
): Prisma.ci_returnsWhereInput {
  const base: Prisma.ci_returnsWhereInput = { isVoided: false, supervisorId };
  if (band === "withBilling") {
    return { ...base, status: { in: ["submitted", "returned_to_floor"] } };
  }
  // Built off todayRange.start — the IST midnight the caller already resolved —
  // so the window steps on IST day boundaries and never on UTC ones. Deriving it
  // from `new Date()` here would put the cut 5h30m out for half of every day.
  const windowStart = new Date(
    todayRange.start.getTime() - (CI_SUPERVISOR_FINISHED_DAYS - 1) * 24 * 60 * 60 * 1000,
  );
  return { ...base, status: "closed", closedAt: { gte: windowStart, lt: todayRange.end } };
}

// ── Boards ───────────────────────────────────────────────────────────────────

const BOARD_SELECT = {
  id: true,
  ciNumber: true,
  status: true,
  obdNumber: true,
  customerName: true,
  returnType: true,
  submittedAt: true,
  closedAt: true,
  // The snapshots — the FALLBACK half of the invoice rule below.
  source: true,
  invoiceNo: true,
  invoiceDate: true,
  // 🔴 THE LIVE HALF. ci_returns.invoiceNo's own comment states the rule: any
  // screen reads the invoice number THROUGH THE ORDER at render time and falls
  // back to the snapshot, never the reverse, so a number SAP sends after the CI
  // was raised simply appears. This relation is what makes the card obey it.
  //
  // ⚠ A JOIN, NOT A SECOND QUERY. Adding `order` to the select costs one join
  // on an indexed FK across a board that holds a day's work; a per-row lookup
  // would be the N+1 the batch-and-match shape everywhere else exists to avoid.
  order: { select: { invoiceNo: true, invoiceDate: true } },
  lines: { select: { returnedQty: true, returnedQtyLitres: true } },
} as const;

type BoardRow = Prisma.ci_returnsGetPayload<{ select: typeof BOARD_SELECT }>;

function toBoardRow(r: BoardRow): CiBoardRow {
  return {
    id: r.id,
    // Non-null by construction: every board filters `status <> 'draft'`, and a
    // number is allocated at the moment a CI leaves draft. The `?? ""` is a type
    // narrowing, not a fallback anyone should ever see.
    ciNumber: r.ciNumber ?? "",
    status: asCiStatus(r.status),
    customerName: r.customerName ?? "(Unmatched)",
    obdNumber: r.obdNumber,
    // Live first, snapshot second. Never the reverse.
    invoiceNo: r.order?.invoiceNo ?? r.invoiceNo,
    invoiceDate: (r.order?.invoiceDate ?? r.invoiceDate)
      // ⚠ NO IST SHIFT. `invoiceDate` is `@db.Date` — a calendar day stored at
      // UTC midnight, not an instant — so shifting it would move some dates a
      // day forward. getCiDetail formats the SAME column the same way (its
      // `isoDate(...)` call takes no shift either), and the card and the detail
      // screen must never disagree about what day a bill is from.
      ? isoDate((r.order?.invoiceDate ?? r.invoiceDate) as Date)
      : null,
    returnType: r.returnType as CiReturnType,
    // Narrowed, not defaulted: chk_ci_returns_source permits exactly these two,
    // so anything else is a constraint that has been dropped — and 'manual' is
    // the honest read of an unrecognised value, since it is what every row
    // predating the findings trigger carries.
    source: r.source === "auto_finding" ? "auto_finding" : "manual",
    lineCount: r.lines.length,
    totalTins: r.lines.reduce((s, l) => s + l.returnedQty, 0),
    totalLitres: round3(
      r.lines.reduce((s, l) => s + (l.returnedQtyLitres ? Number(l.returnedQtyLitres) : 0), 0),
    ),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a `YYYY-MM-DD` param. THROWS on a malformed or impossible date —
 *  chosen over falling back to today, so a typo surfaces as a clean 400 rather
 *  than quietly answering for a different day. Same stance as picking's
 *  resolveTargetDate and floor's parseFloorDate. */
export function assertCiDate(dateStr: string): string {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.toISOString().slice(0, 10) !== dateStr) {
    throw new Error(`Invalid calendar date "${dateStr}"`);
  }
  return dateStr;
}

/** Billing's rail: one IST day, pending above closed. */
export async function getCiBillingBoard(dateStr?: string): Promise<CiBillingBoard> {
  const iso = dateStr === undefined ? undefined : assertCiDate(dateStr);
  const range = getISTDayRange(iso);

  const rows = await prisma.ci_returns.findMany({
    where: buildCiBillingWhere(range),
    select: BOARD_SELECT,
    orderBy: { submittedAt: "desc" },
  });

  const mapped = rows.map(toBoardRow);
  // A partition, not a second query — the rail is ONE fetch and ONE list
  // (design §8: "one panel, no second tab to switch to"). Closing a CI moves the
  // card from the top section to the bottom one in front of the operator, and
  // that visible movement is the point; a second tab would destroy it.
  const pending = mapped.filter((r) => r.status !== "closed");
  // Newest-closed first, so the one he just finished lands at the top of the
  // closed section where he is looking. `submittedAt` order is right for
  // pending — oldest work is the most urgent — but wrong here.
  const closed = mapped
    .filter((r) => r.status === "closed")
    .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));

  return {
    face: "billing",
    date: iso ?? isoDate(range.start, true),
    pending,
    closed,
    pendingCount: pending.length,
    closedCount: closed.length,
    totalCount: mapped.length,
  };
}

/** The supervisor's Submitted tab: "With billing" over "Finished". */
export async function getCiSupervisorBoard(supervisorId: number): Promise<CiSupervisorBoard> {
  const todayRange = getISTDayRange();

  // Two sequential awaits — never $transaction, and never one query with an OR
  // that would make the two bands share a predicate the marker cannot reuse.
  const withBillingRows = await prisma.ci_returns.findMany({
    where: buildCiSupervisorWhere("withBilling", supervisorId, todayRange),
    select: BOARD_SELECT,
    orderBy: { submittedAt: "desc" },
  });
  const finishedRows = await prisma.ci_returns.findMany({
    where: buildCiSupervisorWhere("finished", supervisorId, todayRange),
    select: BOARD_SELECT,
    orderBy: { closedAt: "desc" },
  });

  return {
    face: "supervisor",
    withBilling: withBillingRows.map(toBoardRow),
    finished: finishedRows.map(toBoardRow),
  };
}

// ── One CI's detail (billing's right pane) ───────────────────────────────────

/**
 * Everything billing.html's right pane shows.
 *
 * Returns null for "no such id", "voided" and "still a draft" alike — the three
 * are deliberately not distinguished, because telling a caller that an id it
 * cannot see does exist leaks the row (getMrnDetail's rule).
 *
 * Three sequential awaits: the CI, the live order, the bill's line count.
 */
export async function getCiDetail(ciId: number): Promise<CiDetail | null> {
  const row = await prisma.ci_returns.findFirst({
    where: {
      id: ciId,
      isVoided: false,
      // 🔴 A draft is an in-flight write, not a record.
      status: { not: "draft" },
    },
    select: {
      id: true,
      ciNumber: true,
      status: true,
      orderId: true,
      obdNumber: true,
      invoiceNo: true,
      invoiceDate: true,
      soNumber: true,
      source: true,
      customerId: true,
      customerCode: true,
      customerName: true,
      // ⚠ THE ROUTE, DERIVED AT READ TIME — one nested include off the CI's own
      // customer relation, no extra query and no route column on ci_returns.
      // customerId → delivery_point_master → area_master → route_master.name,
      // the SAME chain lib/picking/queue.ts:729 walks. ⚠ NOT
      // delivery_point_master.primaryRouteId: that column is stale and is never
      // read (locked decision, picking step 1) — only area.primaryRoute counts.
      // Verified live 2026-09-01: all 23 ci_returns rows resolve to a name.
      customer: { select: { area: { select: { primaryRoute: { select: { name: true } } } } } },
      returnType: true,
      materialMoved: true,
      materialReceivedDate: true,
      reasonId: true,
      reasonLabel: true,
      reasonRemark: true,
      submittedAt: true,
      ciDate: true,
      sapCiNumber: true,
      ciValue: true,
      closedAt: true,
      supervisor: { select: { name: true } },
      billingOperator: { select: { name: true } },
      lines: {
        select: {
          id: true,
          lineNumber: true,
          // The bill-line key the edit path posts back — see CiDetailLine.
          rawLineItemId: true,
          skuCode: true,
          skuDescription: true,
          packCode: true,
          deliveryQty: true,
          returnedQty: true,
          litresPerTin: true,
          returnedQtyLitres: true,
        },
        orderBy: { lineNumber: "asc" },
      },
    },
  });
  if (!row) return null;

  // ⚠ THE LIVE ORDER, for three fields the CI deliberately does NOT snapshot.
  //
  //   invoiceNo — 5% of bills have none when the CI is raised and SAP sends it
  //   later (spec §4). The live value is the fresher one, so it WINS and the
  //   snapshot is the fallback — never the reverse. There is no back-fill job
  //   and there must not be one: it would rewrite a closed document.
  //
  //   area — NOT A COLUMN ON ci_returns AT ALL. The mockup's
  //   "102492 · OBD 9109145575 · Ghod Dod" reads it through
  //   customerId → delivery_point_master.area, live. Blank for an unmastered
  //   dealer (customerId null), which is a normal state and not an error.
  //
  //   smu — THE DIVISION, and it is a WIDER COLUMN LIST ON THIS SAME QUERY, not
  //   a new one. No second lookup, no join to import_raw_summary (which holds
  //   the numeric `smuCode` but is not otherwise reachable from a CI and would
  //   cost a query for a fact the name already determines). The code itself is
  //   derived below through SMU_CODE_BY_NAME.
  const order = await prisma.orders.findFirst({
    where: { id: row.orderId },
    select: {
      invoiceNo: true,
      invoiceDate: true,
      smu: true,
      customer: { select: { area: { select: { name: true } } } },
    },
  });

  // The mockup's "3 of 12 on the bill" — the denominator is the BILL's active
  // line count, which is not stored on the CI and must not be: a re-import can
  // change it, and the sentence is about the bill as it stands now.
  const billLineCount = await prisma.import_raw_line_items.count({
    where: { obdNumber: row.obdNumber, lineStatus: "active" },
  });

  const lines: CiDetailLine[] = row.lines.map((l) => ({
    id: l.id,
    lineNumber: l.lineNumber,
    rawLineItemId: l.rawLineItemId,
    skuCode: l.skuCode,
    skuDescription: l.skuDescription,
    packCode: l.packCode,
    deliveryQty: l.deliveryQty,
    returnedQty: l.returnedQty,
    litresPerTin: l.litresPerTin === null ? null : Number(l.litresPerTin),
    returnedQtyLitres: l.returnedQtyLitres === null ? null : Number(l.returnedQtyLitres),
  }));

  const totals = ciTotals(lines);

  // ⚠ NARROWING THE FOUR NULLABLE STAGE-1 COLUMNS, NOT DEFAULTING THEM.
  //
  // They are nullable so a DRAFT can exist before the details step is answered
  // (owner ruling 2026-09-01 — a draft carries NULL, never a placeholder). This
  // query already excludes drafts (`status: { not: "draft" }` above), and
  // chk_ci_returns_complete_when_not_draft guarantees that a non-draft row has
  // all four. So on every row that reaches here they ARE present, and CiDetail
  // types them non-null.
  //
  // 🔴 IF ONE IS NULL ANYWAY, THAT IS A DATA-INTEGRITY VIOLATION — the CHECK was
  // dropped or bypassed — and the honest response is "not found", not a
  // fabricated default. Substituting "not_moved" or today's date here would put
  // an invented fact on billing's screen and, from there, onto a signed
  // document. Logged loudly because nothing else would notice.
  if (
    row.materialMoved === null ||
    row.materialReceivedDate === null ||
    // `reasonId` joins this guard because CiDetail now types it non-null for the
    // edit path. The CHECK names it alongside the other three, so a row missing
    // it is the same integrity violation and gets the same answer.
    row.reasonId === null ||
    row.reasonLabel === null
  ) {
    console.error(
      `[ci/detail] ci #${row.id} is ${row.status} but is missing a stage-1 answer ` +
        `(materialMoved=${row.materialMoved}, materialReceivedDate=${row.materialReceivedDate}, ` +
        `reasonId=${row.reasonId}, reasonLabel=${row.reasonLabel}). ` +
        `chk_ci_returns_complete_when_not_draft should have made this impossible — ` +
        `check the constraint still exists.`,
    );
    return null;
  }

  return {
    id: row.id,
    ciNumber: row.ciNumber,
    status: asCiStatus(row.status),

    orderId: row.orderId,
    obdNumber: row.obdNumber,
    invoiceNo: order?.invoiceNo ?? row.invoiceNo,
    invoiceDate: (order?.invoiceDate ?? row.invoiceDate)
      ? isoDate((order?.invoiceDate ?? row.invoiceDate) as Date)
      : null,
    soNumber: row.soNumber,
    customerCode: row.customerCode,
    customerName: row.customerName,
    area: order?.customer?.area?.name ?? null,
    // The division NUMBER, derived from the name in memory — one line, the same
    // one lib/floor/queries.ts:779 runs. `?? null` covers a name the map does
    // not carry (only the five live ones are in it): a null renders as the
    // neighbouring cells' own empty treatment, which is the honest answer.
    // 🔴 NEVER fall back to `order.smu` itself — see CiDetail.division.
    division: order?.smu != null ? (SMU_CODE_BY_NAME[order.smu] ?? null) : null,

    returnType: row.returnType as CiReturnType,
    materialMoved: row.materialMoved as CiMaterialMoved,
    materialReceivedDate: isoDate(row.materialReceivedDate),
    reasonId: row.reasonId,
    reasonLabel: row.reasonLabel,
    reasonRemark: row.reasonRemark,
    supervisorName: row.supervisor?.name ?? null,
    source: row.source === "auto_finding" ? "auto_finding" : "manual",
    // Null is a NORMAL state — an unmastered dealer has no area and therefore no
    // route. The badge drops the segment rather than printing a dash.
    routeName: row.customer?.area?.primaryRoute?.name ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,

    ciDate: row.ciDate ? isoDate(row.ciDate) : null,
    sapCiNumber: row.sapCiNumber,
    // Decimal → string, never Number: the value is money on a signed form and
    // must keep the scale the column stores it at.
    ciValue: row.ciValue === null ? null : row.ciValue.toFixed(2),
    billingOperatorName: row.billingOperator?.name ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,

    lines,
    ...totals,
    billLineCount,
  };
}

/** A @db.Date comes back UTC-midnight anchored, so slicing the ISO string
 *  yields the right calendar day with no timezone maths. `shiftIst` is for the
 *  one caller that hands in a real instant (the IST day-range start). */
function isoDate(d: Date, shiftIst = false): string {
  const t = shiftIst ? new Date(d.getTime() + 5.5 * 60 * 60 * 1000) : d;
  return t.toISOString().slice(0, 10);
}
