import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { unlinkSo } from "@/lib/challan-orders/links";

export const dynamic = "force-dynamic";

/**
 * POST /api/challan-orders/links/[id]/unlink — unlink a pasted SO while it is
 * still 'waiting' (M5; Challan orders slice 5, 2026-10-07). Writes status
 * 'unlinked' + unlinkedById + unlinkedAt — never deletes. Idempotent.
 * Gate: challan_orders canEdit.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await challanOrdersGate("canEdit");
  if (!gate.ok) return gate.res;
  const linkId = Number(params.id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid link id" }, { status: 400 });
  }
  const r = await unlinkSo({ linkId, userId: gate.userId });
  if (r.ok) return NextResponse.json(r);
  return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
}
