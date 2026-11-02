import { NextResponse } from "next/server";
import { loadAuditForManager, parseId, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { getRegisterRows } from "@/lib/stock-audit/queries";
import { buildStockAuditWorkbook } from "@/lib/stock-audit/workbook";

export const dynamic = "force-dynamic";

/**
 * GET /api/stock-audit/audits/[id]/export — SA-0001.xlsx, one row per SKU:
 * SKU, Description, Pack, Total pcs, Lines. Live lines only. Gate:
 * stock_audit_manage **canExport** (the MRN/CI split — the report is its own
 * grant, not canView). An audit with no lines is a 200 with a header-only
 * workbook, never an error. Copied from app/api/ci/export/route.ts.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canExport");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const load = await loadAuditForManager(auditId, { requireOpen: false });
  if (!load.ok) return load.response;

  const rows = await getRegisterRows(auditId);
  const body = buildStockAuditWorkbook(rows);

  // auditNumber is SA-NNNN by a DB CHECK; the sanitiser is belt and braces.
  const filename = `${load.audit.auditNumber.replace(/[^A-Za-z0-9-]+/g, "-")}.xlsx`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
