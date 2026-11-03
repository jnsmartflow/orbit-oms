import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadAuditForCount, parseId, readJson, saError, stockCountGate } from "@/lib/stock-audit/gate";
import { prepareLineWrite } from "@/lib/stock-audit/line-write";
import { LINE_SELECT, getMyLines, toCountLine } from "@/lib/stock-audit/queries";

export const dynamic = "force-dynamic";

// /api/stock-count/audits/[id]/lines — the counter's own lines in one audit.
// Gate: stock_audit_count canView (open counting — no per-audit counter list).
// Blind: only the session user's lines, never anyone else's or a total.

/** GET — MY live lines, newest first. Works on a closed audit too (read-only). */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const load = await loadAuditForCount(auditId, { requireOpen: false });
  if (!load.ok) return load.response;

  const lines = await getMyLines(auditId, gate.userId);
  return NextResponse.json({ audit: load.audit, lines }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST — add one line. Audit open. Body: { material, qty, notInCatalog? } —
 * qty is ONE whole number of pieces, 1…int4 max (lib/stock-audit/calc.ts
 * validateQty; v27.79). 400 INVALID on a bad code or qty; 400 NOT_IN_CATALOG
 * unless confirmed.
 * Returns 201 { line }.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const load = await loadAuditForCount(auditId, { requireOpen: true });
  if (!load.ok) return load.response;

  const body = await readJson(req);
  if (body === null) return saError(400, "INVALID", "Invalid JSON body");

  const prepared = await prepareLineWrite(body);
  if (!prepared.ok) return prepared.response;

  const row = await prisma.stockAuditLine.create({
    data: { auditId, countedById: gate.userId, ...prepared.data },
    select: LINE_SELECT,
  });
  return NextResponse.json({ line: toCountLine(row) }, { status: 201 });
}
