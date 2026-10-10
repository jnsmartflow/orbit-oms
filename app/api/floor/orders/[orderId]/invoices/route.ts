import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { normaliseInvoiceNo } from "@/lib/order-invoices/rules";
import { loadSplitView, saveSplit, undoSplit, type SaveInvoiceInput } from "@/lib/order-invoices/split";

export const dynamic = "force-dynamic";

// /api/floor/orders/[orderId]/invoices — ADD INVOICES (2026-10-10, Phase 2,
// RECORD ONLY). SAP sometimes bills ONE OBD as several invoices; import brings
// one (the seq-1 'sap' row). This records the rest, paper by paper.
//
//   GET    → the split as it stands + the OBD's active lines (floor canView)
//   POST   → save / edit: a FULL replace of the split
//   DELETE → Undo: back to unsplit
// POST and DELETE need floor canEdit AND floor_add_invoices canEdit.
//
// Trips, hold, picking and CI still act on the WHOLE OBD — nothing here touches
// them, and being on a trip is allowed. Rules: lib/order-invoices/rules.ts;
// reads, writes, write order and the live-refresh decision:
// lib/order-invoices/split.ts.

type Params = { params: { orderId: string } };

async function gate(edit: boolean) {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const roles = session.user.roles ?? [session.user.role];
  const canView = await checkAnyPermission(roles, "floor", "canView");
  if (!canView) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  // Both ticks, the billing_* / tint_* pattern: the screen's Edit, then the action's.
  const canEdit =
    (await checkAnyPermission(roles, "floor", "canEdit")) &&
    (await checkAnyPermission(roles, "floor_add_invoices", "canEdit"));
  if (edit && !canEdit) return { res: NextResponse.json({ error: "You do not have the Add invoices tick" }, { status: 403 }) };
  const actorId = Number(session.user.id);
  if (edit && (!Number.isInteger(actorId) || actorId <= 0)) {
    return { res: NextResponse.json({ error: "Invalid session user id" }, { status: 500 }) };
  }
  return { canEdit, actorId };
}

function parseOrderId(params: Params["params"]): number | null {
  const id = Number(params.orderId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: Request, { params }: Params): Promise<NextResponse> {
  const g = await gate(false);
  if ("res" in g) return g.res!;
  const orderId = parseOrderId(params);
  if (orderId === null) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });

  const view = await loadSplitView(orderId);
  if (!view) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ ...view, canEdit: g.canEdit });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Body → SaveInvoiceInput[], or a plain-English error. */
function parseInvoices(raw: unknown): SaveInvoiceInput[] | string {
  if (!Array.isArray(raw)) return "invoices must be a list";
  const out: SaveInvoiceInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i];
    if (!item || typeof item !== "object") return `Invoice ${i + 1} is not valid`;
    const r = item as Record<string, unknown>;
    if (typeof r.invoiceNo !== "string") return `Invoice ${i + 1} has no invoice number`;
    let invoiceDate: Date | null = null;
    if (r.invoiceDate !== undefined && r.invoiceDate !== null && r.invoiceDate !== "") {
      // A calendar day, stored at 00:00 UTC — the shape SAP's dates already
      // have on orders.invoiceDate (e.g. 2026-10-05T00:00:00.000Z).
      if (typeof r.invoiceDate !== "string" || !ISO_DAY.test(r.invoiceDate)) {
        return `Invoice ${i + 1}: date must be YYYY-MM-DD`;
      }
      invoiceDate = new Date(`${r.invoiceDate}T00:00:00.000Z`);
      if (Number.isNaN(invoiceDate.getTime())) return `Invoice ${i + 1}: date is not a real day`;
    }
    if (!Array.isArray(r.lines)) return `Invoice ${i + 1}: lines must be a list`;
    const lines: SaveInvoiceInput["lines"] = [];
    for (const l of r.lines) {
      const line = l as Record<string, unknown> | null;
      if (!line || typeof line.rawLineItemId !== "number" || typeof line.qty !== "number") {
        return `Invoice ${i + 1}: every line needs rawLineItemId and qty`;
      }
      lines.push({ rawLineItemId: line.rawLineItemId, qty: line.qty });
    }
    out.push({ invoiceNo: normaliseInvoiceNo(r.invoiceNo), invoiceDate, lines });
  }
  return out;
}

export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const g = await gate(true);
  if ("res" in g) return g.res!;
  const orderId = parseOrderId(params);
  if (orderId === null) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const invoices = parseInvoices(body?.invoices);
  if (typeof invoices === "string") return NextResponse.json({ error: invoices }, { status: 400 });

  try {
    const r = await saveSplit(orderId, invoices, g.actorId, body.confirmOtherObd === true);
    if (!r.ok) return NextResponse.json(r, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error(`[order-invoices] save failed for order ${orderId}`, err);
    return NextResponse.json(
      { ok: false, error: "The invoices could not be saved — please press Save again" },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params): Promise<NextResponse> {
  const g = await gate(true);
  if ("res" in g) return g.res!;
  const orderId = parseOrderId(params);
  if (orderId === null) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });

  try {
    const r = await undoSplit(orderId, g.actorId);
    if (!r.ok) return NextResponse.json(r, { status: r.status });
    return NextResponse.json(r);
  } catch (err) {
    console.error(`[order-invoices] undo failed for order ${orderId}`, err);
    return NextResponse.json({ ok: false, error: "Undo did not finish — please press Undo again" }, { status: 500 });
  }
}
