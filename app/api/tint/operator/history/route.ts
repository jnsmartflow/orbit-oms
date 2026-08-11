import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Tint Operator — History
//
// "What did I tint on ONE IST calendar day." Read-only. Grouped by JOB (a
// whole-OBD tint_assignments row, or one order_splits row), each job carrying
// the TI lines this operator submitted against it.
//
// THE FOUR LOCKED DECISIONS THIS ROUTE IMPLEMENTS — do not quietly change one:
//
//   1. Grouped by JOB, not by TI line.
//   2. Only jobs that reached tinting-done. Both branches use the literal the
//      write routes actually use — `"tinting_done"` on tint_assignments
//      (done/route.ts) AND on order_splits (split/done/route.ts). Because the
//      filter is equality on that value, a `cancelled` split can never match.
//   3. Operator identity comes from `tinter_issue_entries.submittedById` — the
//      person who TYPED the TI — NOT `assignedToId`. The two disagree on a
//      small number of live rows (the tint manager submits on an operator's
//      assignment); submittedById is the right answer for "my history".
//   4. Last 7 days only, default today, IST day boundaries via istDayBounds().
//
// ⚠ THE IST BUG NOT TO COPY. `my-orders/route.ts` builds its "today" with
// `new Date(); setUTCHours(0,0,0,0)` — that is UTC midnight, i.e. 05:30 IST, so
// anything between 00:00 and 05:30 IST lands in the wrong day. Harmless there
// only because nobody tints at 03:00. This route uses the correct boundary
// helper, copied from lib/reports/tint-summary-data.ts (CORE §3).
//
// ⚠ SPLIT JOBS CARRY NO tint_assignments ROW. `tint/manager/assign` only ever
// creates tint_assignments with `orderId` — never `splitId` — so live has 0 of
// 773 assignments with a non-null splitId, and every split TI row has
// `tintAssignmentId = null`. Any query that reaches the job through
// tintAssignmentId therefore drops split work silently. That is exactly why the
// where-clause below is an OR across BOTH relations, and why the grouping key
// falls back to splitId. Do not "simplify" it to one branch.
//
// CORE §3: sequential awaits, no $transaction.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 7; // today + the 6 days before it

/** UTC [start, end) instants bounding one IST calendar day. Copied from
 *  lib/reports/tint-summary-data.ts — the one correct implementation. */
function istDayBounds(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Today's IST wall-clock date as YYYY-MM-DD. */
function todayIstStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Shift a YYYY-MM-DD IST date string by whole days, staying in IST. */
function shiftIstDateStr(dateStr: string, days: number): string {
  const anchor = new Date(`${dateStr}T00:00:00.000+05:30`);
  return new Date(anchor.getTime() + days * DAY_MS)
    .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Prisma Decimal → number. Same shape as the TI report route's `n()`. */
function dec(v: { toString(): string } | null | undefined): number {
  if (v == null) return 0;
  const parsed = parseFloat(v.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface HistoryLine {
  id:             number;
  table:          "TINTER" | "ACOTONE";
  skuCode:        string | null;
  skuDescription: string | null;
  baseSku:        string;
  packCode:       string | null;
  shadeName:      string | null;
  samplingNo:     string | null;
  tinQty:         number;
  createdAt:      string;
}

export interface HistoryJob {
  key:                string;              // "assignment:<id>" | "split:<id>"
  kind:               "order" | "split";
  jobId:              number;              // tint_assignments.id | order_splits.id
  orderId:            number;
  obdNumber:          string;
  splitNumber:        number | null;
  completedAt:        string | null;       // ISO UTC — convert at render
  siteName:           string | null;
  shipToCustomerId:   string | null;
  dealerName:         string | null;
  billToCustomerId:   string | null;
  areaName:           string | null;
  routeName:          string | null;
  deliveryTypeName:   string;              // "Unknown" when unresolvable
  totalVolume:        number | null;
  lines:              HistoryLine[];
  totalTins:          number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_OPERATOR, ROLES.OPERATIONS]);
  const userRoles = session!.user.roles ?? [session!.user.role];
  const isAdminOrOps = userRoles.includes("admin") || userRoles.includes(ROLES.OPERATIONS);
  if (!isAdminOrOps) {
    const allowed = await checkAnyPermission(userRoles, "tint_operator", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const userId = parseInt(session!.user.id, 10);

  // ── Date: validate shape (400), then CLAMP to the 7-day window ─────────────
  const maxDate = todayIstStr();
  const minDate = shiftIstDateStr(maxDate, -(HISTORY_DAYS - 1));
  const requested = req.nextUrl.searchParams.get("date");

  if (requested !== null && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return NextResponse.json({ error: "Invalid date — expected YYYY-MM-DD" }, { status: 400 });
  }
  // Clamp rather than reject: a stale client tab left open past midnight would
  // otherwise start erroring instead of quietly showing the nearest valid day.
  // `date` in the response is the EFFECTIVE day, so the client can resync.
  let date = requested ?? maxDate;
  if (date > maxDate) date = maxDate;
  if (date < minDate) date = minDate;

  const { start, end } = istDayBounds(date);

  try {
    const hideExclusion = await getHideExclusion();

    // The order relation must be visible: not soft-removed, not hidden.
    // Matches the Tint Operator my-orders feed (CORE §13's consumer list).
    const orderVisible = { AND: [{ isRemoved: false }, hideExclusion] };

    // The job filter. BOTH arms are required — see the split-job note in the
    // header block. `completedAt` is the day anchor (the moment the job was
    // finished), NOT the TI row's createdAt: an overnight job would otherwise
    // have its lines split across two days.
    const doneOnThisDay = {
      OR: [
        { tintAssignment: { status: "tinting_done", completedAt: { gte: start, lt: end } } },
        { split:          { status: "tinting_done", completedAt: { gte: start, lt: end } } },
      ],
    };

    // Relations shared by both TI tables. `order.customer` is NULLABLE
    // (customerMissing OBDs), which is why deliveryType degrades to "Unknown".
    const jobInclude = {
      order: {
        select: {
          id: true,
          obdNumber: true,
          shipToCustomerId: true,
          shipToCustomerName: true,
          customer: {
            select: {
              customerName: true,
              area: {
                select: {
                  name: true,
                  deliveryType: { select: { name: true } },
                  primaryRoute: { select: { name: true } },
                },
              },
            },
          },
          querySnapshot: { select: { totalVolume: true } },
        },
      },
      tintAssignment: { select: { id: true, completedAt: true } },
      split: { select: { id: true, splitNumber: true, totalVolume: true, completedAt: true } },
      rawLineItem: { select: { skuCodeRaw: true, skuDescriptionRaw: true } },
    } as const;

    const [tinterRows, acotoneRows] = await Promise.all([
      prisma.tinter_issue_entries.findMany({
        where:   { submittedById: userId, ...doneOnThisDay, order: orderVisible },
        include: jobInclude,
        orderBy: { createdAt: "asc" },
      }),
      prisma.tinter_issue_entries_b.findMany({
        where:   { submittedById: userId, ...doneOnThisDay, order: orderVisible },
        include: jobInclude,
        orderBy: { createdAt: "asc" },
      }),
    ]);

    type Row =
      | (typeof tinterRows)[number]
      | (typeof acotoneRows)[number];

    const tagged: Array<{ table: "TINTER" | "ACOTONE"; row: Row }> = [
      ...tinterRows.map((row)  => ({ table: "TINTER"  as const, row: row as Row })),
      ...acotoneRows.map((row) => ({ table: "ACOTONE" as const, row: row as Row })),
    ];

    // ── import_raw_summary overlay — authoritative ship-to / bill-to names.
    // Same treatment my-orders gives them: overlay the order's own copy.
    const obdNumbers = Array.from(new Set(tagged.map((t) => t.row.order.obdNumber)));
    const rawSummaries = obdNumbers.length > 0
      ? await prisma.import_raw_summary.findMany({
          where:  { obdNumber: { in: obdNumbers } },
          select: {
            obdNumber: true,
            shipToCustomerId: true, shipToCustomerName: true,
            billToCustomerId: true, billToCustomerName: true,
          },
        })
      : [];
    const shipToIdByObd   = new Map(rawSummaries.map((r) => [r.obdNumber, r.shipToCustomerId ?? null]));
    const shipToNameByObd = new Map(rawSummaries.map((r) => [r.obdNumber, r.shipToCustomerName ?? null]));
    const billToIdByObd   = new Map(rawSummaries.map((r) => [r.obdNumber, r.billToCustomerId ?? null]));
    const billToNameByObd = new Map(rawSummaries.map((r) => [r.obdNumber, r.billToCustomerName ?? null]));

    // ── Group by job ─────────────────────────────────────────────────────────
    const jobsByKey = new Map<string, HistoryJob>();

    for (const { table, row } of tagged) {
      const isSplit = row.split != null;
      // Defensive: the WHERE guarantees one of the two relations matched, so
      // one of these is always non-null. Skip rather than throw if not.
      const jobId = isSplit ? row.split!.id : row.tintAssignment?.id ?? null;
      if (jobId == null) continue;
      const key = isSplit ? `split:${jobId}` : `assignment:${jobId}`;

      let job = jobsByKey.get(key);
      if (!job) {
        const o = row.order;
        const area = o.customer?.area ?? null;
        job = {
          key,
          kind:             isSplit ? "split" : "order",
          jobId,
          orderId:          o.id,
          obdNumber:        o.obdNumber,
          splitNumber:      isSplit ? row.split!.splitNumber : null,
          completedAt:      (isSplit ? row.split!.completedAt : row.tintAssignment?.completedAt ?? null)?.toISOString() ?? null,
          siteName:         shipToNameByObd.get(o.obdNumber) ?? o.shipToCustomerName ?? o.customer?.customerName ?? null,
          shipToCustomerId: shipToIdByObd.get(o.obdNumber) || o.shipToCustomerId || null,
          dealerName:       billToNameByObd.get(o.obdNumber) ?? null,
          billToCustomerId: billToIdByObd.get(o.obdNumber) ?? null,
          areaName:         area?.name ?? null,
          routeName:        area?.primaryRoute?.name ?? null,
          // Degrade to "Unknown" — orders.customerId is nullable, so an
          // unresolved ship-to has no area→deliveryType chain at all.
          deliveryTypeName: area?.deliveryType?.name ?? "Unknown",
          totalVolume:      isSplit ? row.split!.totalVolume ?? null : o.querySnapshot?.totalVolume ?? null,
          lines:            [],
          totalTins:        0,
        };
        jobsByKey.set(key, job);
      }

      const tinQty = dec(row.tinQty);
      job.lines.push({
        id:             row.id,
        table,
        skuCode:        row.rawLineItem?.skuCodeRaw ?? row.baseSku,
        skuDescription: row.rawLineItem?.skuDescriptionRaw ?? null,
        baseSku:        row.baseSku,
        packCode:       row.packCode ?? null,
        shadeName:      row.shadeName ?? null,
        samplingNo:     row.samplingNo ?? null,
        tinQty,
        createdAt:      row.createdAt.toISOString(),
      });
      job.totalTins += tinQty;
    }

    // Newest job first; lines within a job in submission order.
    const jobs = Array.from(jobsByKey.values()).sort((a, b) => {
      const at = a.completedAt ?? "";
      const bt = b.completedAt ?? "";
      if (at !== bt) return at < bt ? 1 : -1;
      return a.key < b.key ? 1 : -1;
    });
    for (const j of jobs) {
      j.lines.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
      j.totalTins = Math.round(j.totalTins * 100) / 100;
    }

    return NextResponse.json({
      date,
      minDate,
      maxDate,
      totals: {
        jobs:  jobs.length,
        lines: jobs.reduce((s, j) => s + j.lines.length, 0),
        tins:  Math.round(jobs.reduce((s, j) => s + j.totalTins, 0) * 100) / 100,
      },
      jobs,
    });
  } catch (err) {
    console.error("[tint/operator/history]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
