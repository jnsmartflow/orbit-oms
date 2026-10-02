import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";
import { parseSearch } from "@/lib/floor/search";
import { BASE_BILL_WHERE } from "@/lib/tint/manager-bill";
import { matchesViews, searchViews, type TintFindRow } from "@/lib/tint/search";
import { STAGE_LADDER } from "@/lib/workflow-stages";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/find?q= — the header search's SERVER FALLBACK
 * (2026-10-02): bills the Tint Manager could own but is not showing right now —
 * dispatched, cancelled earlier, finished on another day, on another screen.
 * The dropdown shows these as its LAST group, "Not on Tint Manager", minus any
 * OBD already listed by a client group.
 *
 * Gate: tint_manager canView. READ-ONLY, sequential awaits (CORE §3).
 * Scope: not removed, AND (a tint bill OR a Base bill — lib/tint/manager-bill.ts
 * BASE_BILL_WHERE), AND the admin hide rules (getHideExclusion).
 *
 * Matching: a BROAD database read on OBD / invoice / ship-to name + code /
 * redirect name / bill-to name + code (via import_raw_summary), then every
 * candidate is re-checked with the SAME views the dropdown uses
 * (lib/tint/search.ts → lib/floor/search.ts), so the client and the server agree
 * on what "matches" means. Newest first (orders.updatedAt), 10.
 *
 * Returns { rows: [{ orderId, obdNumber, invoiceNo, billTo, shipTo, smu,
 * stage, dateLabel, date }] } — stage in plain words (STAGE_LADDER labels).
 */
const MAX = 10;
const CANDIDATES = 60;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("q") ?? "";
  const parsed = parseSearch(raw);
  // Too short to be worth a query: text under 3 characters, or nothing parsed.
  if (parsed.mode === "none" || (parsed.mode === "text" && parsed.text.length < 3)) {
    return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  // The terms the broad read looks for — the text, or each number token (plus
  // an invoice's "I" form for a 10-digit "1…" token, Floor's I→1 rule).
  const terms = parsed.mode === "text" ? [parsed.text] : parsed.tokens;
  const invoiceTerms = parsed.mode === "text"
    ? [parsed.text]
    : parsed.tokens.flatMap((t) => (/^1\d{9}$/.test(t) ? [t, `I${t.slice(1)}`] : [t]));

  // Bill-to lives only on the import summary — find its OBDs first (bounded).
  const billToHits = await prisma.import_raw_summary.findMany({
    where: {
      OR: terms.flatMap((t) => [
        { billToCustomerName: { contains: t, mode: "insensitive" as const } },
        { billToCustomerId:   { contains: t } },
      ]),
    },
    select:  { obdNumber: true },
    orderBy: { createdAt: "desc" },
    take:    CANDIDATES,
  });

  const hide = await getHideExclusion();
  const textOr: Prisma.ordersWhereInput[] = [
    ...terms.flatMap((t): Prisma.ordersWhereInput[] => [
      { obdNumber:          { contains: t } },
      { shipToCustomerId:   { contains: t } },
      { shipToCustomerName: { contains: t, mode: "insensitive" } },
      { customer:               { customerName: { contains: t, mode: "insensitive" } } },
      { customer:               { customerCode: { contains: t } } },
      { shipToOverrideCustomer: { customerName: { contains: t, mode: "insensitive" } } },
    ]),
    ...invoiceTerms.map((t): Prisma.ordersWhereInput => ({ invoiceNo: { contains: t, mode: "insensitive" } })),
  ];
  if (billToHits.length > 0) textOr.push({ obdNumber: { in: Array.from(new Set(billToHits.map((b) => b.obdNumber))) } });

  const candidates = await prisma.orders.findMany({
    where: {
      AND: [
        { isRemoved: false },
        { OR: [{ orderType: "tint" }, BASE_BILL_WHERE] },
        hide,
        { OR: textOr },
      ],
    },
    select: {
      id: true, obdNumber: true, invoiceNo: true, soNumber: true, smu: true,
      workflowStage: true, updatedAt: true,
      shipToCustomerId: true, shipToCustomerName: true,
      customer:               { select: { customerName: true, customerCode: true, area: { select: { primaryRoute: { select: { name: true } } } } } },
      shipToOverrideCustomer: { select: { customerName: true } },
    },
    orderBy: { updatedAt: "desc" },
    take:    CANDIDATES,
  });

  // Bill-to names + codes for the candidates — one bounded read, latest row wins.
  const summaries = candidates.length > 0
    ? await prisma.import_raw_summary.findMany({
        where:   { obdNumber: { in: candidates.map((c) => c.obdNumber) } },
        select:  { obdNumber: true, billToCustomerName: true, billToCustomerId: true },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const billTo = new Map<string, { name: string | null; code: string | null }>();
  for (const s of summaries) billTo.set(s.obdNumber, { name: s.billToCustomerName, code: s.billToCustomerId });

  const rows: TintFindRow[] = [];
  for (const c of candidates) {
    const own = c.customer?.customerName ?? c.shipToCustomerName ?? null;
    const shipTo = c.shipToOverrideCustomer?.customerName ?? own;
    const bt = billTo.get(c.obdNumber) ?? { name: null, code: null };
    const views = searchViews({
      obdNumber: c.obdNumber,
      invoiceNo: c.invoiceNo,
      soNumber:  c.soNumber,
      shipTo,
      route:     c.customer?.area?.primaryRoute?.name ?? null,
      names:     [bt.name, own],
      codes:     [c.shipToCustomerId, c.customer?.customerCode ?? null, bt.code],
    });
    if (!matchesViews(views, parsed)) continue;
    rows.push({
      orderId:   c.id,
      obdNumber: c.obdNumber,
      invoiceNo: c.invoiceNo,
      billTo:    bt.name,
      shipTo,
      smu:       c.smu,
      stage:     STAGE_LADDER.find((s) => s.stage === c.workflowStage)?.label ?? c.workflowStage,
      dateLabel: c.workflowStage === "dispatched" ? "Dispatched" : c.workflowStage === "cancelled" ? "Cancelled" : "Updated",
      date:      c.updatedAt.toISOString(),
    });
    if (rows.length >= MAX) break;
  }

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
