import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { counterIdList, readJson, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { allocateAuditNumberWithRetry, isAuditNumberCollision } from "@/lib/stock-audit/number";
import { getAssignableUsers, getAuditList } from "@/lib/stock-audit/queries";
import { STOCK_AUDIT_STATUS } from "@/lib/stock-audit/status";

export const dynamic = "force-dynamic";

// /api/stock-audit/audits — the desk's audit list and "New audit".

/** GET — every audit, open first then newest. Gate: stock_audit_manage canView. */
export async function GET(): Promise<NextResponse> {
  const gate = await stockAuditGate("canView");
  if (!gate.ok) return gate.response;
  const audits = await getAuditList();
  return NextResponse.json({ audits }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — { counterIds: number[] } (at least one). Gate: stock_audit_manage
 * canEdit. Every counter must be assignable (active + would pass
 * stock_audit_count canView) → else 400 NOT_ASSIGNABLE. Allocates SA-number
 * (lib/stock-audit/number.ts, retry once), inserts the audit, then the
 * counters ONE BY ONE — sequential awaits, never $transaction (CORE §3).
 * Returns 201 { audit: { id, auditNumber } }.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const gate = await stockAuditGate("canEdit");
  if (!gate.ok) return gate.response;

  const body = await readJson(req);
  if (body === null) return saError(400, "INVALID", "Invalid JSON body");
  const counterIds = counterIdList(body.counterIds, { allowEmpty: false });
  if (counterIds === null) return saError(400, "INVALID", "Pick at least one counter");

  const assignable = new Set((await getAssignableUsers()).map((u) => u.id));
  const bad = counterIds.filter((id) => !assignable.has(id));
  if (bad.length > 0) {
    return saError(400, "NOT_ASSIGNABLE", `Not assignable as a counter (needs an active user with Stock count): ${bad.join(", ")}`);
  }

  let audit: { id: number; auditNumber: string };
  try {
    audit = await allocateAuditNumberWithRetry((identity) =>
      prisma.stockAudit.create({
        data: {
          seq: identity.seq,
          auditNumber: identity.auditNumber,
          status: STOCK_AUDIT_STATUS.open,
          createdById: gate.userId,
        },
        select: { id: true, auditNumber: true },
      }),
    );
  } catch (err) {
    if (isAuditNumberCollision(err)) return saError(409, "TRY_AGAIN", "Another audit was created at the same moment — please try again");
    throw err;
  }

  // One by one. A failure part-way leaves an open audit with fewer counters,
  // which the desk can fix with Edit counters — never a half-numbered audit.
  for (const userId of counterIds) {
    await prisma.stockAuditCounter.create({ data: { auditId: audit.id, userId, addedById: gate.userId } });
  }

  return NextResponse.json({ audit }, { status: 201 });
}
