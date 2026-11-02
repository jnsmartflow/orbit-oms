import { NextResponse } from "next/server";
import { stockCountGate } from "@/lib/stock-audit/gate";
import { getMyOpenAudits } from "@/lib/stock-audit/queries";
import type { MyAudit } from "@/lib/stock-audit/types";

export const dynamic = "force-dynamic";

// GET /api/stock-count/audits — the OPEN audits the session user is an assigned
// counter on, newest first, each with MY live line count. Gate:
// stock_audit_count canView. Blind: nothing about other counters.
export async function GET(): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const audits: MyAudit[] = await getMyOpenAudits(gate.userId);
  return NextResponse.json({ audits }, { headers: { "Cache-Control": "no-store" } });
}
