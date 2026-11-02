import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { counterIdList, loadAuditForManager, parseId, readJson, saError, stockAuditGate } from "@/lib/stock-audit/gate";
import { getAssignableUsers } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

/**
 * PUT /api/stock-audit/audits/[id]/counters — { counterIds: number[] } (at
 * least one) is the WHOLE new list. Gate: stock_audit_manage canEdit + audit
 * open (409 AUDIT_CLOSED). People ADDED must be assignable (400
 * NOT_ASSIGNABLE); people kept may stay even if their tick has since gone.
 * Removed counters' rows are deleted — their lines survive (lines point at
 * users) and they can no longer add or edit. Sequential awaits, no
 * $transaction. Returns { counters: { userId, name }[] }.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockAuditGate("canEdit");
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const load = await loadAuditForManager(auditId, { requireOpen: true });
  if (!load.ok) return load.response;

  const body = await readJson(req);
  if (body === null) return saError(400, "INVALID", "Invalid JSON body");
  const wanted = counterIdList(body.counterIds, { allowEmpty: false });
  if (wanted === null) return saError(400, "INVALID", "Keep at least one counter");

  const current = (await prisma.stockAuditCounter.findMany({ where: { auditId }, select: { userId: true } })).map(
    (c) => c.userId,
  );
  const currentSet = new Set(current);
  const wantedSet = new Set(wanted);
  const toAdd = wanted.filter((id) => !currentSet.has(id));
  const toRemove = current.filter((id) => !wantedSet.has(id));

  if (toAdd.length > 0) {
    const assignable = new Set((await getAssignableUsers()).map((u) => u.id));
    const bad = toAdd.filter((id) => !assignable.has(id));
    if (bad.length > 0) {
      return saError(400, "NOT_ASSIGNABLE", `Not assignable as a counter (needs an active user with Stock count): ${bad.join(", ")}`);
    }
  }

  if (toRemove.length > 0) {
    await prisma.stockAuditCounter.deleteMany({ where: { auditId, userId: { in: toRemove } } });
  }
  for (const userId of toAdd) {
    await prisma.stockAuditCounter.create({ data: { auditId, userId, addedById: gate.userId } });
  }
  // Moves the desk marker even when only a removal happened.
  await prisma.stockAudit.update({ where: { id: auditId }, data: { updatedAt: new Date() } });

  const counters = await prisma.stockAuditCounter.findMany({
    where: { auditId },
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return NextResponse.json({ counters: counters.map((c) => ({ userId: c.userId, name: c.user.name })) });
}
