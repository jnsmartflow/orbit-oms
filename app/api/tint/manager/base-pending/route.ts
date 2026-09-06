import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { TINT_STATUS_DONE } from "@/lib/tint/assignment-status";
import { getBaseOperatorId } from "@/lib/tint/base-operator";

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

interface PendingOrder {
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

export async function GET(): Promise<NextResponse> {
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
  const assignments = await prisma.tint_assignments.findMany({
    where: {
      assignedToId: baseOperatorId,
      status:       TINT_STATUS_DONE,
      order:        { isRemoved: false },
    },
    select: {
      id:          true,
      completedAt: true,
      order: {
        select: {
          id:                 true,
          obdNumber:          true,
          shipToCustomerName: true,
          customerId:         true,
          customer:           { select: { customerName: true } },
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
      select: { tintAssignmentId: true, rawLineItemId: true },
    }),
    prisma.tinter_issue_entries_b.findMany({
      where:  { tintAssignmentId: { in: assignmentIds }, rawLineItemId: { not: null } },
      select: { tintAssignmentId: true, rawLineItemId: true },
    }),
  ]);
  const coveredByAssignment = new Map<number, Set<number>>();
  for (const e of [...entriesA, ...entriesB]) {
    if (e.tintAssignmentId == null || e.rawLineItemId == null) continue;
    const set = coveredByAssignment.get(e.tintAssignmentId) ?? new Set<number>();
    set.add(e.rawLineItemId);
    coveredByAssignment.set(e.tintAssignmentId, set);
  }

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
    if (missing.length === 0) continue; // fully covered — drops off the list

    out.push({
      orderId:           a.order.id,
      obdNumber:         a.order.obdNumber,
      siteName:          a.order.customer?.customerName ?? a.order.shipToCustomerName ?? "—",
      siteId:            a.order.customerId,
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
    });
  }

  // 5. Dealer names — one bounded query for the page, never one per row. Same
  //    source the board's Bill To column uses (import_raw_summary), so the two
  //    surfaces name the same party the same way.
  if (out.length > 0) {
    const summaries = await prisma.import_raw_summary.findMany({
      where:   { obdNumber: { in: out.map((o) => o.obdNumber) } },
      select:  { obdNumber: true, billToCustomerName: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const dealerByObd = new Map<string, string | null>();
    for (const s of summaries) dealerByObd.set(s.obdNumber, s.billToCustomerName); // newer wins
    for (const o of out) o.billToName = dealerByObd.get(o.obdNumber) ?? null;
  }

  return NextResponse.json({ orders: out });
}
