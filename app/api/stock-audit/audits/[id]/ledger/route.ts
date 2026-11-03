import { NextResponse } from "next/server";
import { loadAuditForManager, parseId, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { getSkuLedger, normaliseMaterial } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

// GET /api/stock-audit/audits/[id]/ledger?material= — every live line of one
// SKU: who counted it, the qty (pieces), time, + the total.
// Gate: stock_audit_manage canView. Keyed on `material` only (CORE §13).
export async function GET(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canView");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const material = normaliseMaterial(new URL(req.url).searchParams.get("material"));
  if (material === null) return saError(400, "INVALID", "material is required");

  const load = await loadAuditForManager(auditId, { requireOpen: false });
  if (!load.ok) return load.response;

  const ledger = await getSkuLedger(auditId, material);
  return NextResponse.json(ledger, { headers: { "Cache-Control": "no-store" } });
}
