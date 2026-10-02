import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";
import { resolveFloorDisplayDate } from "@/lib/floor/format";
import { getISTDayRange } from "@/lib/dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// "Tinter Issue pending" — the bills a Base — No Tint bypass closed that still
// owe their Tinter Issue paperwork.
//
// A bypass (POST /api/tint/manager/base-bypass) moves a bill off the tint rail
// immediately, because the depot needs it to travel. The TI entry that records
// WHAT was in the tin is a separate, later obligation — and until now nothing
// tracked it: the bypassed assignment is `tinting_done`, so no screen asked for
// its TI, and the bill quietly left with the paperwork missing.
//
// This route is that list. It returns one entry per bypassed assignment whose
// active tinting lines are NOT yet fully covered by TI rows, with the per-line
// covered/pending state the UI needs to render a worklist.
//
// ⚠ COVERAGE IS KEYED ON tintAssignmentId, NOT orderId. This mirrors
// app/api/tint/operator/done/route.ts:75-104 exactly, and it deliberately does
// NOT copy the orderId-keyed version in operator/my-orders/route.ts:256-262.
// That one builds `order:${e.orderId}` keys, which is fine for a screen showing
// one live assignment per order but WRONG here: an order can carry several
// assignment rows over its life (order 14833 has four), so an orderId key would
// count TI written against a superseded assignment and show a bypassed bill as
// already covered when its own assignment has nothing.
//
// Read-only. No writes anywhere in this file.
// ─────────────────────────────────────────────────────────────────────────────

interface PendingLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  packCode:          string | null;
  /** True when a TI row exists against THIS assignment for this line. */
  hasTiEntry:        boolean;
}

/** History only (?date=): who wrote the TI on that day, when (the latest), the
 *  sampling numbers used and how many lines were written that day. */
interface TiWritten {
  tiWrittenBy:     string | null;
  tiWrittenAt:     string;
  tiSamplingNos:   string[];
  tiLinesOnDay:    number;
}

interface PendingOrder extends Partial<TiWritten> {
  /** LIVE only (2026-10-02): every line covered today — when the last TI was
   *  written. Present only on those "TI done" rows; they list after the pending ones. */
  tiDoneAt?: string;
  orderId:            number;
  obdNumber:          string;
  siteName:           string;
  /**
   * orders.customerId — the numeric delivery_point_master FK. Required by
   * /api/sampling-library/suggest, which does not accept the SAP-code
   * shipToCustomerId string. Null when the customer never resolved; the TI
   * panel then skips the this-site suggestion fetch and falls back to search.
   */
  siteId:             number | null;
  billToName:         string | null;
  /** DISPLAY ONLY (2026-10-01, step 7): the site the board names — the
   *  ship-to redirect when one is set, else siteName. */
  shipToName:        string;
  /** siteName when a redirect is in force (left half of the pair), else null. */
  originalSiteName:  string | null;
  /** import_obd_query_summary.totalVolume — the TI tab's Vol column. */
  totalVolume:       number | null;
  // ── Board cells (2026-10-02, owner — the TI tab uses the Tint / Base table's
  // columns). DISPLAY ONLY, read-only additions: Floor's OBD date line
  // (resolveFloorDisplayDate), SAP's invoice, the SMU name + short code, the
  // area route, and the bill's typed article tag.
  obdDateTime:       string | null;
  isEmailTime:       boolean;
  invoiceNo:         string | null;
  invoiceDate:       string | null;
  smu:               string | null;
  smuCode:           string | null;
  route:             string | null;
  articleTag:        string | null;
  /** Header search (2026-10-02) — SAP's ship-to and bill-to customer CODES. */
  shipToCode:        string | null;
  billToCode:        string | null;
  /** Header filters (2026-10-02) — delivery_type_master.name via the AREA, and the priority. */
  deliveryTypeName:  string | null;
  priorityLevel:     number;
  tintAssignmentId:   number;
  /** When the bypass closed the bill — tint_assignments.completedAt. */
  bypassedAt:         string | null;
  totalTintingLines:  number;
  coveredLines:       number;
  lines:              PendingLine[];
}

/**
 * Pack label from the raw line, the same derivation the operator screen uses
 * (`derivePackCode` in tint-operator-content.tsx): litres per tin = the line's
 * total volume divided by its unit quantity. Display only — never a PackCode
 * enum value, and never used to key anything.
 */
function derivePack(volumeLine: number | null, unitQty: number): string | null {
  if (volumeLine == null || unitQty <= 0) return null;
  const per = volumeLine / unitQty;
  if (!Number.isFinite(per) || per <= 0) return null;
  return Number.isInteger(per) ? `${per} L` : `${per.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} L`;
}

// ?date=YYYY-MM-DD (2026-10-02, history) — the TI tab for a PAST IST day: the
// "Base — No Tint" bills that had a TI row WRITTEN on that day (either TI
// table), whether or not they still owe lines, with who wrote it, when, the
// sampling numbers and the line count (TiWritten). Without the param the
// response is exactly what it was (the TiWritten fields are never added).
export async function GET(req: Request): Promise<NextResponse> {
  const dateParam = new URL(req.url).searchParams.get("date");
  const history = dateParam !== null && DATE_RE.test(dateParam) ? dateParam : null;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Per-user tick, not a job title. This is a manager-board read, so it gates on
  // tint_manager/canView like the board's own feeds — NOT on tint_operator,
  // even though the rows it lists are written through the operator TI routes.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  // Sequential awaits throughout, never $transaction (CORE §3).
  const baseOperatorId = await getBaseOperatorId();
  if (baseOperatorId === null) {
    // Fail SOFT on a read: an empty list is honest ("nothing is pending") only
    // if the placeholder genuinely has no rows, and with no placeholder there
    // are none by definition. Logged so a missing row is still visible.
    console.error("[tint/manager/base-pending] placeholder worker missing — returning empty list");
    return NextResponse.json({ orders: [], placeholderMissing: true });
  }

  // 1. Every bypassed assignment, newest first. No date fence: an unpaid TI
  //    obligation does not expire at midnight, and a bill bypassed on Friday
  //    still owes its paperwork on Monday. (Same reasoning as the picker's
  //    Pending tab and /api/warehouse/pickers, both deliberately un-fenced.)
  //    History: only the assignments that got a TI row on day D (both tables).
  const writtenOnDay = new Map<number, Array<{ by: string | null; at: Date; samplingNo: string | null }>>();
  if (history) {
    const day = getISTDayRange(history);
    // Typed, so a wrong relation name fails tsc instead of at runtime.
    const dayWhere: Prisma.tinter_issue_entriesWhereInput & Prisma.tinter_issue_entries_bWhereInput = {
      createdAt:      { gte: day.start, lt: day.end },
      tintAssignment: { assignedToId: baseOperatorId },
    };
    const sel = { tintAssignmentId: true, createdAt: true, samplingNo: true, submittedBy: { select: { name: true } } } as const;
    const a = await prisma.tinter_issue_entries.findMany({ where: dayWhere, select: sel });
    const b = await prisma.tinter_issue_entries_b.findMany({ where: dayWhere, select: sel });
    for (const e of [...a, ...b]) {
      if (e.tintAssignmentId == null) continue;
      const list = writtenOnDay.get(e.tintAssignmentId) ?? [];
      list.push({ by: e.submittedBy?.name ?? null, at: e.createdAt, samplingNo: e.samplingNo });
      writtenOnDay.set(e.tintAssignmentId, list);
    }
  }

  const assignments = await prisma.tint_assignments.findMany({
    where: {
      assignedToId: baseOperatorId,
      status:       TINT_STATUS_DONE,
      order:        { isRemoved: false },
      ...(history ? { id: { in: Array.from(writtenOnDay.keys()) } } : {}),
    },
    select: {
      id:          true,
      completedAt: true,
      order: {
        select: {
          id:                 true,
          obdNumber:          true,
          shipToCustomerName: true,
          shipToCustomerId:   true,
          customerId:         true,
          // Display only (step 7): the redirect name and the bill volume.
          shipToOverrideCustomer: { select: { customerName: true } },
          querySnapshot:          { select: { totalVolume: true, articleTag: true } },
          // Board cells (2026-10-02) — display only.
          orderDateTime: true,
          obdEmailDate:  true,
          invoiceNo:     true,
          invoiceDate:   true,
          smu:           true,
          priorityLevel: true,
          // The AREA route, matching FLOOR_DEALER_SELECT / the board's Route column.
          customer:      { select: { customerName: true, area: { select: { primaryRoute: { select: { name: true } }, deliveryType: { select: { name: true } } } } } },
        },
      },
    },
    orderBy: { completedAt: "desc" },
  });

  if (assignments.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  // 2. The active tinting lines for every OBD in play, in one query.
  //    The three filters are done/route.ts:75-78's, verbatim: isTinting
  //    excludes non-tint lines on a tint OBD, and lineStatus="active" excludes
  //    lines a re-import soft-removed (lineStatus="removed_by_import"). Dropping
  //    either would demand TI for a line nobody has to tint.
  const obdNumbers = Array.from(new Set(assignments.map((a) => a.order.obdNumber)));
  const rawLines = await prisma.import_raw_line_items.findMany({
    where: {
      obdNumber:  { in: obdNumbers },
      isTinting:  true,
      lineStatus: "active",
    },
    select: {
      id:                true,
      obdNumber:         true,
      skuCodeRaw:        true,
      skuDescriptionRaw: true,
      unitQty:           true,
      volumeLine:        true,
    },
    orderBy: { id: "asc" },
  });
  const linesByObd = new Map<string, typeof rawLines>();
  for (const l of rawLines) {
    const list = linesByObd.get(l.obdNumber) ?? [];
    list.push(l);
    linesByObd.set(l.obdNumber, list);
  }

  // 3. TI coverage, from BOTH tables, keyed on tintAssignmentId (see the header
  //    note). `rawLineItemId: { not: null }` mirrors done/route.ts:82,86 — a
  //    legacy TI row with no line pointer cannot cover a specific line.
  const assignmentIds = assignments.map((a) => a.id);
  const [entriesA, entriesB] = await Promise.all([
    prisma.tinter_issue_entries.findMany({
      where:  { tintAssignmentId: { in: assignmentIds }, rawLineItemId: { not: null } },
      select: { tintAssignmentId: true, rawLineItemId: true, createdAt: true },
    }),
    prisma.tinter_issue_entries_b.findMany({
      where:  { tintAssignmentId: { in: assignmentIds }, rawLineItemId: { not: null } },
      select: { tintAssignmentId: true, rawLineItemId: true, createdAt: true },
    }),
  ]);
  const coveredByAssignment = new Map<number, Set<number>>();
  // The LATEST TI write per assignment — when a fully covered bill was finished.
  const lastTiAt = new Map<number, Date>();
  for (const e of [...entriesA, ...entriesB]) {
    if (e.tintAssignmentId == null || e.rawLineItemId == null) continue;
    const set = coveredByAssignment.get(e.tintAssignmentId) ?? new Set<number>();
    set.add(e.rawLineItemId);
    coveredByAssignment.set(e.tintAssignmentId, set);
    const prev = lastTiAt.get(e.tintAssignmentId);
    if (!prev || e.createdAt > prev) lastTiAt.set(e.tintAssignmentId, e.createdAt);
  }
  // "TI done" stays on the live list for the rest of the IST day it finished
  // (owner, 2026-10-02) — getISTDayRange(), the repo's one IST day helper.
  const todayStart = getISTDayRange().start;

  // 4. Keep only the assignments that still owe something.
  //    An assignment with ZERO active tinting lines is DONE, not pending —
  //    done/route.ts skips its whole gate on `isTintingRawLines.length > 0`, so
  //    a bill with nothing to tint owes no TI and must never appear here.
  const out: PendingOrder[] = [];
  for (const a of assignments) {
    const lines   = linesByObd.get(a.order.obdNumber) ?? [];
    if (lines.length === 0) continue;

    const covered = coveredByAssignment.get(a.id) ?? new Set<number>();
    const missing = lines.filter((l) => !covered.has(l.id));
    // Fully covered: a history day keeps it (the record of what was written that
    // day). The LIVE list keeps it only for the rest of the IST day its last TI
    // was written, as a read-only "TI done" row (`tiDoneAt`); the next day it
    // drops off. A bill still owing lines is unchanged.
    let tiDoneAt: string | null = null;
    if (!history && missing.length === 0) {
      const at = lastTiAt.get(a.id);
      if (!at || at < todayStart) continue;
      tiDoneAt = at.toISOString();
    }

    const ownSite = a.order.customer?.customerName ?? a.order.shipToCustomerName ?? "—";
    const redirect = a.order.shipToOverrideCustomer?.customerName ?? null;
    out.push({
      orderId:           a.order.id,
      obdNumber:         a.order.obdNumber,
      siteName:          ownSite,
      siteId:            a.order.customerId,
      shipToName:        redirect ?? ownSite,
      originalSiteName:  redirect ? ownSite : null,
      totalVolume:       a.order.querySnapshot?.totalVolume ?? null,
      obdDateTime:       resolveFloorDisplayDate(a.order.orderDateTime, a.order.obdEmailDate).obdDateTime?.toISOString() ?? null,
      isEmailTime:       resolveFloorDisplayDate(a.order.orderDateTime, a.order.obdEmailDate).isEmailTime,
      invoiceNo:         a.order.invoiceNo ?? null,
      invoiceDate:       a.order.invoiceDate ? a.order.invoiceDate.toISOString() : null,
      smu:               a.order.smu ?? null,
      smuCode:           null, // filled below with the dealer name, same query
      route:             a.order.customer?.area?.primaryRoute?.name ?? null,
      articleTag:        a.order.querySnapshot?.articleTag ?? null,
      shipToCode:        a.order.shipToCustomerId ?? null,
      billToCode:        null, // filled below with the dealer name, same query
      deliveryTypeName:  a.order.customer?.area?.deliveryType?.name ?? null,
      priorityLevel:     a.order.priorityLevel,
      billToName:        null, // filled below, one query for the whole page
      tintAssignmentId:  a.id,
      bypassedAt:        a.completedAt ? a.completedAt.toISOString() : null,
      totalTintingLines: lines.length,
      coveredLines:      lines.length - missing.length,
      lines: lines.map((l) => ({
        rawLineItemId:     l.id,
        skuCodeRaw:        l.skuCodeRaw,
        skuDescriptionRaw: l.skuDescriptionRaw,
        unitQty:           l.unitQty,
        volumeLine:        l.volumeLine,
        packCode:          derivePack(l.volumeLine, l.unitQty),
        hasTiEntry:        covered.has(l.id),
      })),
      ...(history ? tiWrittenOf(writtenOnDay.get(a.id) ?? []) : {}),
      ...(tiDoneAt !== null ? { tiDoneAt } : {}),
    });
  }

  // 5. Dealer names — one bounded query for the page, never one per row. Same
  //    source the board's Bill To column uses (import_raw_summary), so the two
  //    surfaces name the same party the same way.
  if (out.length > 0) {
    const summaries = await prisma.import_raw_summary.findMany({
      where:   { obdNumber: { in: out.map((o) => o.obdNumber) } },
      select:  { obdNumber: true, billToCustomerName: true, billToCustomerId: true, smuCode: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const dealerByObd = new Map<string, string | null>();
    const smuCodeByObd = new Map<string, string | null>();
    const billToCodeByObd = new Map<string, string | null>();
    for (const s of summaries) {
      dealerByObd.set(s.obdNumber, s.billToCustomerName); // newer wins
      smuCodeByObd.set(s.obdNumber, s.smuCode);
      billToCodeByObd.set(s.obdNumber, s.billToCustomerId);
    }
    for (const o of out) {
      o.billToName = dealerByObd.get(o.obdNumber) ?? null;
      o.smuCode    = smuCodeByObd.get(o.obdNumber) ?? null;
      o.billToCode = billToCodeByObd.get(o.obdNumber) ?? null;
    }
  }

  // Pending rows first, then today's "TI done" rows (stable — each block keeps
  // its own newest-first order).
  out.sort((x, y) => (x.tiDoneAt ? 1 : 0) - (y.tiDoneAt ? 1 : 0));
  return NextResponse.json({ orders: out });
}

/** The history fields for one assignment's TI rows written on the day. */
function tiWrittenOf(rows: Array<{ by: string | null; at: Date; samplingNo: string | null }>): TiWritten {
  const latest = rows.reduce<{ by: string | null; at: Date } | null>((m, r) => (!m || r.at > m.at ? r : m), null);
  return {
    tiWrittenBy:   latest?.by ?? null,
    tiWrittenAt:   (latest?.at ?? new Date(0)).toISOString(),
    tiSamplingNos: Array.from(new Set(rows.map((r) => r.samplingNo).filter((s): s is string => !!s))),
    tiLinesOnDay:  rows.length,
  };
}
