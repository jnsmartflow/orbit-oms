// lib/mrn/queries.ts
//
// The MRN read feeds — billing's date-fenced rail, the supervisor's three phone
// tabs, and one MRN's detail.
//
// SELECT ONLY. There is not a single write in this file and none may be added;
// the write paths are their own routes (step 5/6 of the build).
//
// ⚠ THE WHERE BUILDERS ARE EXPORTED, AND THE MARKER MUST USE THEM. Step 4's
// change-marker endpoint counts/aggregates over the SAME predicate the board
// renders. Re-declaring a WHERE in the marker is precisely the drift the
// Picking §10 and Floor §10 landmines both warn about: a marker watching a
// NARROWER set than the board silently misses updates on the floor. Wider is
// harmless (a few extra refetches); narrower is a bug nobody sees until a truck
// is missed. Never re-type these predicates — import them.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import { deriveLine, summariseMrn } from "./derive";
import { applyCatalog, resolveMrnSkus } from "./resolve-lines";
import { asMrnStatus } from "./types";
import type {
  MrnBillingBoard,
  MrnBoardRow,
  MrnDetail,
  MrnDetailLine,
  MrnSupervisorBoard,
  MrnSupervisorTab,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ── Date anchors ─────────────────────────────────────────────────────────────
//
// Two DIFFERENT date shapes are needed here and they are not interchangeable:
//
//   • a UTC-midnight DATE-ONLY value, to compare against @db.Date columns
//     (`mrnDate`, `truckReportingDate`) by equality;
//   • a half-open INSTANT window [start, end), to fence a timestamptz column
//     (`unloadingEndAt`) to a calendar day.
//
// The instant window comes from getISTDayRange() in lib/dates.ts — the shared
// helper lib/floor/queries.ts, lib/picking/queue.ts, lib/picking/picker-split.ts
// and lib/billing/picking-where.ts all use. It is NOT reimplemented here.
//
// The date-only anchors below are local because that is the established
// convention: picking (resolveTargetDate) and floor (parseFloorDate) each carry
// their own, deliberately, since each module wants its own error behaviour.
// ⚠ Nothing here parses an offset-less date-TIME string, so CORE §3's
// Date.parse() host-timezone trap does not arise: Prisma hands back real Date
// objects and they stay that way.

const DATE_STR_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's IST calendar date as a UTC-midnight Date — the @db.Date shape.
 *  Shifts by the fixed IST offset FIRST, then reads UTC parts; never local
 *  getters, which would pick the wrong day near the IST/UTC boundary. */
function istTodayDateOnly(): Date {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
}

/**
 * Parse "YYYY-MM-DD" to a UTC-midnight Date.
 *
 * THROWS on a malformed or impossible calendar date rather than falling back to
 * today, so the route surfaces a clean 400 instead of silently answering for a
 * different day than the operator asked about. Round-trips the constructed date
 * back to a string to catch shape-valid-but-impossible input ("2026-02-30",
 * which Date.UTC would quietly roll into March). Mirrors picking's
 * resolveTargetDate and floor's parseFloorDate.
 */
export function parseMrnDate(dateStr: string): Date {
  if (!DATE_STR_RE.test(dateStr)) {
    throw new Error(`Invalid date "${dateStr}" — expected YYYY-MM-DD`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateOnly = new Date(Date.UTC(y, m - 1, d));
  if (dateOnly.toISOString().slice(0, 10) !== dateStr) {
    throw new Error(`Invalid calendar date "${dateStr}"`);
  }
  return dateOnly;
}

/** Whole IST days between a @db.Date value and today, floored at 0.
 *  Both operands are UTC-midnight date-only values, so this is plain
 *  subtraction with no timezone reasoning involved. */
function ageDaysFrom(date: Date, todayMs: number): number {
  return Math.max(0, Math.floor((todayMs - date.getTime()) / MS_PER_DAY));
}

// ── Shared WHERE builders ────────────────────────────────────────────────────

/**
 * Billing's rail: ONE mrnDate.
 *
 * Fenced on `mrnDate` — the day the MRN was RAISED, which is what `srNo` counts
 * against and therefore what the header's date stepper steps through. NOT
 * `truckReportingDate`: a truck that reported on the 17th and was entered on the
 * 20th is truck N *of the 20th*, and must appear under the day its Sr no
 * belongs to or the rail's numbering would read as broken (design §11 OQ-5).
 */
export function buildMrnBillingWhere(dateOnly: Date): Prisma.mrnWhereInput {
  return { isRemoved: false, mrnDate: dateOnly };
}

/**
 * One of the supervisor's three phone tabs (design §11 OQ-6).
 *
 * `todayRange` is passed IN — from getISTDayRange() — so this stays pure and the
 * marker can build the identical predicate. Same shape as floor's
 * floorLiveBaseWhere(todayRange).
 *
 *   toCheck  — ALL DATES, status 'open', AND AT LEAST ONE LINE. Not date-fenced
 *              on purpose: a truck left unchecked overnight must still be
 *              waiting next morning, which is what the card's age tag then
 *              reports.
 *
 *              🔴 `lines: { some: {} }` is on THIS BRANCH ONLY. Design §5 says
 *              the MRN reaches the phone the moment the header AND the lines
 *              exist; this feed used to enforce only the header half, so a
 *              header billing had not finished pasting into showed up as a
 *              truck to check. The phone shows a truck only when there is
 *              something to check.
 *
 *              That gap was not cosmetic — it could strand an MRN. Tapping
 *              Start on a line-less MRN moves it to 'checking', which 409s
 *              billing out of the lines route, and there is no un-start in v1
 *              (§11 OQ-7). Closing it at the door is the fix; an un-start route
 *              is a real decision about takeover semantics and is not being
 *              made as a side effect.
 *
 *              ⚠ Do NOT copy this clause to `checking` or `done`. An MRN
 *              already in flight is found by its status, and the clause there
 *              would risk HIDING a live truck if its lines were ever cleared
 *              mid-flight — the opposite of what this fixes. Billing's rail
 *              (buildMrnBillingWhere) is likewise untouched: a line-less MRN is
 *              a normal in-progress draft and must stay visible there, because
 *              billing's rail is where it gets its lines.
 *   checking — ALL DATES, status 'checking', EVERY supervisor's, deliberately
 *              NOT scoped to the viewer. The mockup shows one worked by
 *              "Ramesh K." beside one marked "you": three supervisors share a
 *              floor and need to see what the others have open. This is a real
 *              divergence from the picker face, which IS scoped by pickerId —
 *              do not "align" the two.
 *   done     — status 'done', fenced on `unloadingEndAt` within TODAY IST, and
 *              🔴 never on `mrnDate`. "Done" is the date the WORK FINISHED, the
 *              same convention already implemented three times (Floor §6c, the
 *              Billing Picking tab, the Picking supervisor board). Fencing on
 *              mrnDate would file a truck raised yesterday and finished this
 *              morning under yesterday — and drop it out of the receipt of the
 *              man who actually unloaded it.
 */
export function buildMrnSupervisorWhere(
  tab: MrnSupervisorTab,
  todayRange: { start: Date; end: Date },
): Prisma.mrnWhereInput {
  switch (tab) {
    case "toCheck":
      // `some: {}` = "has at least one mrn_lines row". See the doc comment —
      // toCheck ONLY, never checking/done, never billing's rail.
      return { isRemoved: false, status: "open", lines: { some: {} } };
    case "checking":
      return { isRemoved: false, status: "checking" };
    case "done":
      return {
        isRemoved: false,
        status: "done",
        unloadingEndAt: { gte: todayRange.start, lt: todayRange.end },
      };
  }
}

// ── Row selection ────────────────────────────────────────────────────────────

/**
 * The header columns every board row and the detail payload share.
 *
 * ⚠ `receivedFrom` and `status` come back as plain strings (both are TEXT with
 * a CHECK Prisma cannot see). `status` is narrowed by asMrnStatus() in the
 * mapper, which THROWS on an unknown value — see lib/mrn/types.ts for why loud
 * beats a silent default there.
 */
const MRN_HEADER_SELECT = {
  id: true,
  mrnNumber: true,
  mrnDate: true,
  srNo: true,
  truckReportingDate: true,
  receivedFrom: true,
  receivingWarehouse: true,
  stiRefNo: true,
  deliveryNo: true,
  otrNo: true,
  status: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  unloadingStartAt: true,
  unloadingStartById: true,
  unloadingStartBy: { select: { name: true } },
  unloadingEndAt: true,
  unloadingEndBy: { select: { name: true } },
} as const;

/**
 * The per-line columns a BOARD row's aggregates need — quantities and condition
 * counts, no batches, no SKU text.
 *
 * The lines ride the board query rather than a separate groupBy because the
 * issue roll-up is not a SQL aggregate: it counts LINES WITH A PROBLEM, and
 * "a problem" is derive.ts's rule (short OR excess OR a bad condition count),
 * which lives in TypeScript so the cards, the table and the export all read the
 * same definition. Re-expressing it as SQL would be a second owner for that
 * rule — the drift this module is otherwise careful to avoid.
 *
 * Volume is small by construction: a depot day is a handful of trucks at ~40
 * lines each, and the two all-dates tabs only ever hold trucks that are not
 * finished yet.
 */
const MRN_AGGREGATE_LINE_SELECT = {
  qtySti: true,
  physicalQty: true,
  isChecked: true,
  sndQty: true,
  leakyQty: true,
  damageQty: true,
  emptyQty: true,
  qtdQty: true,
  rejQty: true,
} as const;

type MrnHeaderPayload = Prisma.mrnGetPayload<{ select: typeof MRN_HEADER_SELECT }>;
type MrnAggregateLine = Prisma.mrn_linesGetPayload<{ select: typeof MRN_AGGREGATE_LINE_SELECT }>;

/** Header columns → the shared field block. One mapper, so a board row and the
 *  detail payload can never disagree about a field they both carry. */
function toHeaderFields(row: MrnHeaderPayload) {
  return {
    id: row.id,
    mrnNumber: row.mrnNumber,
    mrnDate: row.mrnDate,
    srNo: row.srNo,
    truckReportingDate: row.truckReportingDate,
    receivedFrom: row.receivedFrom,
    receivingWarehouse: row.receivingWarehouse,
    stiRefNo: row.stiRefNo,
    deliveryNo: row.deliveryNo,
    otrNo: row.otrNo,
    status: asMrnStatus(row.status),
    createdAt: row.createdAt,
    createdByName: row.createdBy?.name ?? null,
    unloadingStartAt: row.unloadingStartAt,
    unloadingStartById: row.unloadingStartById,
    unloadingStartByName: row.unloadingStartBy?.name ?? null,
    unloadingEndAt: row.unloadingEndAt,
    unloadingEndByName: row.unloadingEndBy?.name ?? null,
  };
}

/** Line-level totals a board row carries. Derivations come from derive.ts —
 *  computed once, here, so no consumer recomputes them. */
function toBoardRow(
  row: MrnHeaderPayload & { lines: MrnAggregateLine[] },
  todayMs: number,
): MrnBoardRow {
  const summary = summariseMrn(row.lines);
  return {
    ...toHeaderFields(row),
    ...summary,
    lineCount: row.lines.length,
    checkedLineCount: row.lines.filter((l) => l.isChecked).length,
    totalQtySti: row.lines.reduce((s, l) => s + l.qtySti, 0),
    totalPhysicalQty: row.lines.reduce((s, l) => s + (l.physicalQty ?? 0), 0),
    // Keyed off truckReportingDate — how long has this TRUCK gone unchecked.
    // Never mrnDate (when the paperwork was raised) or createdAt (a wall clock).
    ageDays: ageDaysFrom(row.truckReportingDate, todayMs),
  };
}

// ── Feeds ────────────────────────────────────────────────────────────────────

/**
 * Billing's rail for one day.
 *
 * 🔴 ORDERED `srNo` ASC — TRUCK 1 FIRST, THEN 2, THEN 3. REVERSED 2026-08-26 ON
 * SMART FLOW'S DIRECT INSTRUCTION: "seq by which truck come first which second
 * — so seq 1 first then second."
 *
 * The old rule and its reasoning, kept because a reversal nobody recorded is a
 * reversal somebody undoes: this sorted `srNo` DESC, on the argument that the
 * newest truck belongs on top because that is where the operator's attention
 * is. The owner overruled it. `srNo` counts arrival order within the day, so
 * reading the rail top-to-bottom now matches the order the trucks actually
 * showed up — and matches the numbers printed on the cards themselves. Do not
 * flip this back without a new decision from the owner.
 *
 * The rail is one flat list with no Open/Done/All tabs (design §3.1, simplified
 * on owner instruction); status is a per-card treatment, not a filter.
 *
 * `dateStr` omitted → today IST.
 */
export async function getMrnBillingBoard(dateStr?: string): Promise<MrnBillingBoard> {
  const dateOnly = dateStr === undefined ? istTodayDateOnly() : parseMrnDate(dateStr);
  const todayMs = istTodayDateOnly().getTime();

  const rows = await prisma.mrn.findMany({
    where: buildMrnBillingWhere(dateOnly),
    select: { ...MRN_HEADER_SELECT, lines: { select: MRN_AGGREGATE_LINE_SELECT } },
    orderBy: { srNo: "asc" },
  });

  return {
    date: dateOnly.toISOString().slice(0, 10),
    rows: rows.map((r) => toBoardRow(r, todayMs)),
  };
}

/**
 * The supervisor's three phone tabs, in ONE payload.
 *
 * One call rather than three so the cards and the bottom-bar tab counts are
 * derived from the same read — the "one fetch, no drift" invariant the picking
 * supervisor board is built on (CLAUDE_PICKING.md §5.1).
 *
 * Three sequential awaits, never prisma.$transaction (CORE §3). All three share
 * ONE `todayRange`, so a call spanning IST midnight cannot fence two tabs to
 * two different days.
 */
export async function getMrnSupervisorBoard(): Promise<MrnSupervisorBoard> {
  const todayRange = getISTDayRange();
  const todayMs = istTodayDateOnly().getTime();

  const select = { ...MRN_HEADER_SELECT, lines: { select: MRN_AGGREGATE_LINE_SELECT } };

  // Oldest truck first on the two open tabs — the one that has waited longest
  // is the one to deal with next, and it is also the one wearing the age tag.
  const toCheck = await prisma.mrn.findMany({
    where: buildMrnSupervisorWhere("toCheck", todayRange),
    select,
    orderBy: [{ truckReportingDate: "asc" }, { srNo: "asc" }],
  });

  const checking = await prisma.mrn.findMany({
    where: buildMrnSupervisorWhere("checking", todayRange),
    select,
    orderBy: { unloadingStartAt: "asc" },
  });

  // Most recently finished first — a receipt reads newest-first.
  const done = await prisma.mrn.findMany({
    where: buildMrnSupervisorWhere("done", todayRange),
    select,
    orderBy: { unloadingEndAt: "desc" },
  });

  return {
    toCheck: toCheck.map((r) => toBoardRow(r, todayMs)),
    checking: checking.map((r) => toBoardRow(r, todayMs)),
    done: done.map((r) => toBoardRow(r, todayMs)),
  };
}

const MRN_DETAIL_LINE_SELECT = {
  id: true,
  lineNo: true,
  skuCode: true,
  qtySti: true,
  cartonQty: true,
  physicalQty: true,
  isChecked: true,
  checkedAt: true,
  checkedBy: { select: { name: true } },
  sndQty: true,
  leakyQty: true,
  damageQty: true,
  emptyQty: true,
  qtdQty: true,
  rejQty: true,
  batches: {
    select: {
      id: true,
      batchNo: true,
      qty: true,
      mfgMonth: true,
      mfgYear: true,
      bestBeforeMonth: true,
      bestBeforeYear: true,
    },
    orderBy: { batchNo: "asc" },
  },
} as const;

/**
 * One MRN with its lines, each line with its batches.
 *
 * Lines ordered by `lineNo`, batches by `batchNo` — batch 1 is the report's
 * "6a", batch 2 its "6b", so the order IS the sub-row order and must be stable.
 *
 * Returns null when the id does not exist or the MRN is soft-removed. A removed
 * MRN disappears from BOTH faces (design §11 OQ-8); the only reads that
 * deliberately see removed rows are the two allocators in lib/mrn/number.ts.
 *
 * Two sequential awaits — the MRN, then the catalog for its codes. Never
 * prisma.$transaction (CORE §3).
 */
export async function getMrnDetail(mrnId: number): Promise<MrnDetail | null> {
  const row = await prisma.mrn.findFirst({
    where: { id: mrnId, isRemoved: false },
    select: {
      ...MRN_HEADER_SELECT,
      lines: { select: MRN_DETAIL_LINE_SELECT, orderBy: { lineNo: "asc" } },
    },
  });
  if (!row) return null;

  // ⚠ Resolved by `material`, never by any id — lib/mrn/resolve-lines.ts owns
  // that rule and carries the id-space warning. One batched query for every
  // code on the MRN.
  const catalog = await resolveMrnSkus(row.lines.map((l) => l.skuCode));

  const lines: MrnDetailLine[] = row.lines.map((l) => ({
    id: l.id,
    lineNo: l.lineNo,
    skuCode: l.skuCode,
    ...applyCatalog(l.skuCode, catalog),
    qtySti: l.qtySti,
    cartonQty: l.cartonQty,
    physicalQty: l.physicalQty,
    isChecked: l.isChecked,
    checkedAt: l.checkedAt,
    checkedByName: l.checkedBy?.name ?? null,
    sndQty: l.sndQty,
    leakyQty: l.leakyQty,
    damageQty: l.damageQty,
    emptyQty: l.emptyQty,
    qtdQty: l.qtdQty,
    rejQty: l.rejQty,
    batches: l.batches,
    // Derived once, on the way out. No consumer recomputes these.
    ...deriveLine(l),
  }));

  return {
    ...toHeaderFields(row),
    ...summariseMrn(row.lines),
    lineCount: lines.length,
    checkedLineCount: lines.filter((l) => l.isChecked).length,
    totalQtySti: lines.reduce((s, l) => s + l.qtySti, 0),
    totalPhysicalQty: lines.reduce((s, l) => s + (l.physicalQty ?? 0), 0),
    lines,
  };
}
