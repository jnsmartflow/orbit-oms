import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadAuditForCount, parseId, readJson, saError, stockCountGate } from "@/lib/stock-audit/gate";
import { prepareLineWrite } from "@/lib/stock-audit/line-write";
import { LINE_SELECT, toCountLine } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

// /api/stock-count/lines/[lineId] — edit or remove ONE of my lines.
// Checked in order: stock_audit_count canView · the line exists and is not
// removed (404 NOT_FOUND) · it is MINE (403 NOT_OWNER) · the audit is open
// (409 AUDIT_CLOSED).

type Owned = { ok: true; lineId: number } | { ok: false; response: NextResponse };

async function loadOwnedLine(raw: string, userId: number): Promise<Owned> {
  const lineId = parseId(raw);
  if (lineId === null) return { ok: false, response: saError(400, "INVALID", "Invalid line id") };
  const line = await prisma.stockAuditLine.findUnique({
    where: { id: lineId },
    select: { auditId: true, countedById: true, isRemoved: true },
  });
  if (!line || line.isRemoved) return { ok: false, response: saError(404, "NOT_FOUND", "Line not found") };
  if (line.countedById !== userId) {
    return { ok: false, response: saError(403, "NOT_OWNER", "Only the person who counted this line can change it") };
  }
  const load = await loadAuditForCount(line.auditId, { requireOpen: true });
  if (!load.ok) return { ok: false, response: load.response };
  return { ok: true, lineId };
}

/** PATCH — replace the line's SKU and qty (same body { material, qty,
 *  notInCatalog? } and rules as POST). The phone sends the line's own
 *  material, so its Edit changes the qty only. Returns { line }. */
export async function PATCH(req: Request, { params }: { params: { lineId: string } }): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const owned = await loadOwnedLine(params.lineId, gate.userId);
  if (!owned.ok) return owned.response;

  const body = await readJson(req);
  if (body === null) return saError(400, "INVALID", "Invalid JSON body");
  const prepared = await prepareLineWrite(body);
  if (!prepared.ok) return prepared.response;

  // Conditional on still-live and still-mine, so a removal racing this edit
  // cannot be silently undone.
  const result = await prisma.stockAuditLine.updateMany({
    where: { id: owned.lineId, countedById: gate.userId, isRemoved: false },
    data: { ...prepared.data, updatedAt: new Date() },
  });
  if (result.count === 0) return saError(404, "NOT_FOUND", "Line not found");

  const row = await prisma.stockAuditLine.findUniqueOrThrow({ where: { id: owned.lineId }, select: LINE_SELECT });
  return NextResponse.json({ line: toCountLine(row) });
}

/** DELETE — SOFT delete: isRemoved = true, removedAt = now(). Never a hard delete. Returns { ok, lineId }. */
export async function DELETE(_req: Request, { params }: { params: { lineId: string } }): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const owned = await loadOwnedLine(params.lineId, gate.userId);
  if (!owned.ok) return owned.response;

  const now = new Date();
  const result = await prisma.stockAuditLine.updateMany({
    where: { id: owned.lineId, countedById: gate.userId, isRemoved: false },
    // updatedAt set explicitly so the desk marker moves on a removal.
    data: { isRemoved: true, removedAt: now, updatedAt: now },
  });
  if (result.count === 0) return saError(404, "NOT_FOUND", "Line not found");
  return NextResponse.json({ ok: true, lineId: owned.lineId });
}
