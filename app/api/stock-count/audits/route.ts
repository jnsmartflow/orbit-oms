import { NextResponse } from "next/server";
import { stockCountGate } from "@/lib/stock-audit/gate";
import { getOpenAudit } from "@/lib/stock-audit/queries";
import type { MyAudit } from "@/lib/stock-audit/types";

export const dynamic = "force-dynamic";

// GET /api/stock-count/audits — THE open audit, or null. Open counting
// (2026-11-02): at most one audit is open and everyone holding
// stock_audit_count canView counts in it, so the phone opens it straight away —
// no picker. Carries MY live line count only (blind count).
export async function GET(): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const audit: MyAudit | null = await getOpenAudit(gate.userId);
  return NextResponse.json({ audit }, { headers: { "Cache-Control": "no-store" } });
}
