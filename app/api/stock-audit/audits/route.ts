import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { allocateAuditNumber, allocateAuditNumberWithRetry, isAuditNumberCollision } from "@/lib/stock-audit/number";
import { getAuditList } from "@/lib/stock-audit/queries";
import { STOCK_AUDIT_STATUS } from "@/lib/stock-audit/status";
import type { AuditListResponse } from "@/lib/stock-audit/types";

export const dynamic = "force-dynamic";

// /api/stock-audit/audits — the desk's audit list and "New audit".
//
// OPEN COUNTING (Smart Flow, 2026-11-02): no counter list, and at most ONE
// audit is open at a time — everyone holding stock_audit_count counts in it.

/** GET — every audit, open first then newest, plus the number "New audit"
 *  would take next (the confirm text). Gate: stock_audit_manage canView. */
export async function GET(): Promise<NextResponse> {
  const gate = await stockAuditGate("canView");
  if (!gate.ok) return gate.response;
  const audits = await getAuditList();
  const next = await allocateAuditNumber(); // a preview only — nothing is reserved
  const body: AuditListResponse = { audits, nextAuditNumber: next.auditNumber };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — no body. Gate: stock_audit_manage canEdit. While any audit is open →
 * 409 AUDIT_ALREADY_OPEN. Otherwise allocates the SA-number
 * (lib/stock-audit/number.ts, retry once) and inserts the audit — nothing else.
 * Returns 201 { audit: { id, auditNumber } }.
 *
 * ⚠ The open check here is an app check: two clicks in the same instant can
 * both pass it. The database rule allowing only one open audit (a partial
 * unique index) comes with the v27.79 SQL; once it exists, the losing insert
 * fails with P2002 on THAT index — not a number collision — and is answered
 * with the same 409 below.
 */
export async function POST(): Promise<NextResponse> {
  const gate = await stockAuditGate("canEdit");
  if (!gate.ok) return gate.response;

  const open = await prisma.stockAudit.findFirst({
    where: { status: STOCK_AUDIT_STATUS.open },
    select: { auditNumber: true },
  });
  if (open) {
    return saError(409, "AUDIT_ALREADY_OPEN", `${open.auditNumber} is still open — close it before starting a new audit`);
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
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return saError(409, "AUDIT_ALREADY_OPEN", "Another audit was just started — only one can be open at a time");
    }
    throw err;
  }

  return NextResponse.json({ audit }, { status: 201 });
}
