import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { pasteSo } from "@/lib/challan-orders/links";

export const dynamic = "force-dynamic";

/**
 * POST /api/challan-orders/links — paste one SAP SO against one challan order
 * (Challan orders slice 5, 2026-10-07). Body { orbOrderId, soNumber,
 * confirmDealerMismatch? }. Writes ONE 'waiting' row in challan_order_so_links, or
 * nothing. Every check is lib/challan-orders/links.ts pasteSo; this route is check
 * 1 — challan_orders canEdit.
 *
 * 200 { ok: true, linkId } · 409 { ok: false, warning: true, code: "DEALER_MISMATCH" }
 * (S5-2: the client asks "Link anyway?" and resends with confirmDealerMismatch) ·
 * 4xx { ok: false, code, error }.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const gate = await challanOrdersGate("canEdit");
  if (!gate.ok) return gate.res;
  const body = (await req.json().catch(() => null)) as
    | { orbOrderId?: unknown; soNumber?: unknown; confirmDealerMismatch?: unknown }
    | null;
  if (!body || typeof body.orbOrderId !== "number" || !Number.isInteger(body.orbOrderId) || typeof body.soNumber !== "string") {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "orbOrderId and soNumber are required" }, { status: 400 });
  }
  const r = await pasteSo({
    orbOrderId: body.orbOrderId,
    soNumber: body.soNumber,
    userId: gate.userId,
    confirmDealerMismatch: body.confirmDealerMismatch === true,
  });
  if (r.ok) return NextResponse.json(r);
  const { status, ...payload } = r;
  return NextResponse.json(payload, { status });
}
