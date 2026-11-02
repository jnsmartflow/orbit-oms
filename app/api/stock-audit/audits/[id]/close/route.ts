import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadAuditForManager, parseId, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { STOCK_AUDIT_STATUS } from "@/lib/stock-audit/status";

export const dynamic = "force-dynamic";

/**
 * POST /api/stock-audit/audits/[id]/close — ONE-WAY. Gate: stock_audit_manage
 * canEdit + audit open. The write is conditional (updateMany WHERE status =
 * 'open'), so a double click or two desks closing at once records one close;
 * the loser gets 409 AUDIT_CLOSED. Nothing ever writes 'closed' → 'open'
 * (Smart Flow: no reopen). Returns { ok, closedAt }.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canEdit");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const load = await loadAuditForManager(auditId, { requireOpen: true });
  if (!load.ok) return load.response;

  const closedAt = new Date();
  const result = await prisma.stockAudit.updateMany({
    where: { id: auditId, status: STOCK_AUDIT_STATUS.open },
    data: { status: STOCK_AUDIT_STATUS.closed, closedAt, closedById: gate.userId, updatedAt: closedAt },
  });
  if (result.count === 0) return saError(409, "AUDIT_CLOSED", "This audit is already closed");
  return NextResponse.json({ ok: true, closedAt: closedAt.toISOString() });
}
