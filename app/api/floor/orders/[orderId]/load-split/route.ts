import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { loadLoadView, repairLoadWrite, saveLoadSplit } from "@/lib/order-invoices/load-split";
import type { TruckInput } from "@/lib/order-invoices/load-plan";

export const dynamic = "force-dynamic";

// /api/floor/orders/[orderId]/load-split — SPLIT LOAD (2026-10-24, phase 2,
// Schema v27.76): ONE SAP invoice row whose tins go on several trucks.
//
//   GET  → the bill's rows as groups (root + parts, part k of n), what each
//          carries, why each cannot be split / merged away, and the expectKey
//          a press must send back (floor canView)
//   POST → { mode?: "split", sourceRowId, expectKey, trucks: [{ lines: [{ rawLineItemId, qty }] }] }
//          trucks[0] = what the source row keeps; trucks[1..] = new 'load' rows
//        → { mode: "repair" } — finish / undo a press that died half-way
// POST needs floor canEdit AND floor_split_load canEdit. Merge is …/load-merge.
// Reads, guards, write order and the half-failure answer:
// lib/order-invoices/load-split.ts; the rules: lib/order-invoices/load-plan.ts.

type Params = { params: { orderId: string } };

async function gate(edit: boolean) {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const roles = session.user.roles ?? [session.user.role];
  const canView = await checkAnyPermission(roles, "floor", "canView");
  if (!canView) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  // Both ticks, the Add invoices pattern: the screen's Edit, then the action's.
  const canEdit =
    (await checkAnyPermission(roles, "floor", "canEdit")) &&
    (await checkAnyPermission(roles, "floor_split_load", "canEdit"));
  if (edit && !canEdit) return { res: NextResponse.json({ error: "You do not have the Split load tick" }, { status: 403 }) };
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

  const view = await loadLoadView(orderId);
  if (!view) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ ...view, canEdit: g.canEdit });
}

/** Body → TruckInput[], or a plain-English error. */
function parseTrucks(raw: unknown): TruckInput[] | string {
  if (!Array.isArray(raw)) return "trucks must be a list";
  const out: TruckInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] as Record<string, unknown> | null;
    if (!t || typeof t !== "object" || !Array.isArray(t.lines)) return `Truck ${i + 1}: lines must be a list`;
    const lines: TruckInput["lines"] = [];
    for (const l of t.lines) {
      const line = l as Record<string, unknown> | null;
      if (!line || typeof line.rawLineItemId !== "number" || typeof line.qty !== "number") {
        return `Truck ${i + 1}: every line needs rawLineItemId and qty`;
      }
      lines.push({ rawLineItemId: line.rawLineItemId, qty: line.qty });
    }
    out.push({ lines });
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
  const mode = body?.mode ?? "split";
  if (mode !== "split" && mode !== "repair") {
    return NextResponse.json({ error: 'mode must be "split" or "repair"' }, { status: 400 });
  }

  try {
    if (mode === "repair") {
      const r = await repairLoadWrite(orderId, g.actorId);
      return NextResponse.json(r, { status: r.ok ? 200 : r.status });
    }
    const sourceRowId = Number(body.sourceRowId);
    if (!Number.isInteger(sourceRowId) || sourceRowId <= 0) {
      return NextResponse.json({ error: "sourceRowId is required" }, { status: 400 });
    }
    if (typeof body.expectKey !== "string") {
      return NextResponse.json({ error: "expectKey is required — reopen Split load" }, { status: 400 });
    }
    const trucks = parseTrucks(body.trucks);
    if (typeof trucks === "string") return NextResponse.json({ error: trucks }, { status: 400 });
    const r = await saveLoadSplit(orderId, { sourceRowId, trucks, expectKey: body.expectKey, actorId: g.actorId });
    return NextResponse.json(r, { status: r.ok ? 200 : r.status });
  } catch (err) {
    console.error(`[order-invoices] split load ${mode} failed for order ${orderId}`, err);
    return NextResponse.json(
      { ok: false, error: "The split did not finish — reopen Split load and press Repair" },
      { status: 500 },
    );
  }
}
