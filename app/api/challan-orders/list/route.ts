import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { loadChallanBoard } from "@/lib/challan-orders/board";

export const dynamic = "force-dynamic";

/**
 * GET /api/challan-orders/list — the shared Challan orders screen's three working
 * tabs (Not billed · Waiting for OBD · Billed 7 days) + their counts (Challan
 * orders slice 5, 2026-10-07). READ-ONLY. Gate: challan_orders canView.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await challanOrdersGate("canView");
  if (!gate.ok) return gate.res;
  const board = await loadChallanBoard(new Date());
  return NextResponse.json(board, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
