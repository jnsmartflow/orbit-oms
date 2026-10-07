import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { prisma } from "@/lib/prisma";
import { reconcileSo } from "@/lib/challan-orders/reconcile";

export const dynamic = "force-dynamic";

/**
 * POST /api/challan-orders/links/[id]/retry — run the challan rule again for this link's
 * SO (Challan orders slice 6, 2026-10-07):
 *   Retry        (S6-6) — a catch whose first write failed;
 *   Link anyway  (S6-1) — body { linkAnyway: true }: billing has looked at a dealer
 *                mismatch and decided it IS this challan's bill — the held OBD is
 *                pulled back and linked (the dealer check is skipped, nothing else).
 * A touched OBD is still never moved. Gate: challan_orders canEdit.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await challanOrdersGate("canEdit");
  if (!gate.ok) return gate.res;
  const linkId = Number(params.id);
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid link id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { linkAnyway?: unknown };
  const link = await prisma.challan_order_so_links.findUnique({ where: { id: linkId }, select: { soNumber: true, status: true } });
  if (!link || link.status === "unlinked") {
    return NextResponse.json({ ok: false, error: "This SO is no longer linked." }, { status: 409 });
  }
  const result = await reconcileSo(link.soNumber, gate.userId, { source: "retry", ignoreDealer: body.linkAnyway === true });
  return NextResponse.json({ ok: true, result });
}
