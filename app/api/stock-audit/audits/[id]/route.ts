import { NextResponse } from "next/server";
import { parseId, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { getAuditDetail } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

// GET /api/stock-audit/audits/[id]?q= — header + stat cards + SKU summary
// (filtered by ?q= on material or description; stats never filtered) +
// per-counter progress. Live lines only. Gate: stock_audit_manage canView.
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canView");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const q = new URL(req.url).searchParams.get("q");
  if (q !== null && q.length > 80) return saError(400, "INVALID", "Search is too long");

  const detail = await getAuditDetail(auditId, q);
  if (!detail) return saError(404, "NOT_FOUND", "Audit not found");
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
