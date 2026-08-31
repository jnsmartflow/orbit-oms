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
 */
export function normaliseCiSearchTerm(raw: string): string {
  const q = raw.trim().toUpperCase();
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
 * 🔴 ALWAYS RETURNS A LIST, NEVER findFirst (spec §4). 11 live invoice numbers
 * map to TWO OBDs each — a split bill fanning out, always sharing one soNumber.
 * Picking the first would silently file returned goods against the wrong half.
 * With exactly one hit the UI opens the bill directly; that is a UI shortcut,
 * not a query shortcut.
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

  const orders = await prisma.orders.findMany({
    where: {
      isRemoved: false,
      OR: [{ invoiceNo: query }, { obdNumber: query }],
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
 * `date` fences on `submittedAt`, which is when the CI reached billing, NOT
 * `materialReceivedDate` (when goods physically arrived) and NOT `createdAt`
 * (when a draft was opened). Billing's rail answers "what landed on my desk
 * today", and those three dates genuinely differ: material can arrive on the
 * 24th against a bill dated the 22nd and be submitted on the 25th.
 */
export function buildCiBillingWhere(range: { start: Date; end: Date }): Prisma.ci_returnsWhereInput {
  return {
    isVoided: false,
    // Both bands of the rail: pending (submitted) and closed. Never 'draft'.
    status: { in: ["submitted", "closed", "returned_to_floor"] },
    submittedAt: { gte: range.start, lt: range.end },
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
 * Date fencing mirrors MRN's supervisor board for the same reason: the
 * outstanding band spans ALL dates (work handed to billing yesterday is still
 * his to see), and only the finished band is fenced to today — a receipt, not a
 * task.
 */
export function buildCiSupervisorWhere(
  band: "withBilling" | "finished",
  supervisorId: number,
  todayRange: { start: Date; end: Date },
): Prisma.ci_returnsWhereInput {
  const base: Prisma.ci_returnsWhereInput = { isVoided: false, supervisorId };
  if (band === "withBilling") {
    return { ...base, status: { in: ["submitted", "returned_to_floor"] } };
  }
  return { ...base, status: "closed", closedAt: { gte: todayRange.start, lt: todayRange.end } };
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
    returnType: r.returnType as CiReturnType,
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
  // A partition, not a second query — the rail is one fetch (design §8: "one
  // panel, no second tab to switch to").
  const pending = mapped.filter((r) => r.status !== "closed");
  const closed = mapped.filter((r) => r.status === "closed");

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
      customerId: true,
      customerCode: true,
      customerName: true,
      returnType: true,
      materialMoved: true,
      materialReceivedDate: true,
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

  // ⚠ THE LIVE ORDER, for two fields the CI deliberately does NOT snapshot.
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
  const order = await prisma.orders.findFirst({
    where: { id: row.orderId },
    select: {
      invoiceNo: true,
      invoiceDate: true,
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
    skuCode: l.skuCode,
    skuDescription: l.skuDescription,
    packCode: l.packCode,
    deliveryQty: l.deliveryQty,
    returnedQty: l.returnedQty,
    litresPerTin: l.litresPerTin === null ? null : Number(l.litresPerTin),
    returnedQtyLitres: l.returnedQtyLitres === null ? null : Number(l.returnedQtyLitres),
  }));

  const totals = ciTotals(lines);

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

    returnType: row.returnType as CiReturnType,
    materialMoved: row.materialMoved as CiMaterialMoved,
    materialReceivedDate: isoDate(row.materialReceivedDate),
    reasonLabel: row.reasonLabel,
    reasonRemark: row.reasonRemark,
    supervisorName: row.supervisor?.name ?? null,
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
