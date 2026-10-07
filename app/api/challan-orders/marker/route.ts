import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { getChallanMarker } from "@/lib/challan-orders/board";

export const dynamic = "force-dynamic";

/**
 * GET /api/challan-orders/marker — the shared screen's cheap "has anything
 * changed?" probe: { count, latest, signature } (Challan orders slice 5,
 * 2026-10-07). Polled by usePickingMarker's `url` option. READ-ONLY — never add a
 * write here. Gate: challan_orders canView.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await challanOrdersGate("canView");
  if (!gate.ok) return gate.res;
  const marker = await getChallanMarker();
  return NextResponse.json(marker, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
