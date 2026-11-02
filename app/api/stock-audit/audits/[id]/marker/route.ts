import { NextResponse } from "next/server";
import { parseId, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { getAuditMarker } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

// GET /api/stock-audit/audits/[id]/marker — the cheap { count, latest } the
// desk polls (usePickingMarker with its own url, 15 s — the Freight Trips
// pattern). Why polling: the stock_audit_* tables carry NO live_changes
// trigger on purpose (CORE §13, the second exception). READ-ONLY.
// Gate: stock_audit_manage canView.
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canView");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const marker = await getAuditMarker(auditId);
  if (!marker) return saError(404, "NOT_FOUND", "Audit not found");
  return NextResponse.json(marker, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
