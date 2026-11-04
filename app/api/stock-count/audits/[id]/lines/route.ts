import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadAuditForCount, parseId, readJson, saError, stockCountGate } from "@/lib/stock-audit/gate";
import { prepareLineWrite } from "@/lib/stock-audit/line-write";
import { LINE_SELECT, getMyLines, toCountLine } from "@/lib/stock-audit/queries";
import { normaliseClientId } from "@/lib/stock-audit/client-id";
import { decideReplay, parseCountedAt, userAssertionOk } from "@/lib/stock-audit/replay";

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

/** A P2002 on stock_audit_lines_clientId_key (two sends of one entry racing). */
function isClientIdCollision(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("clientId");
}

/**
 * POST — add one line. Body: { material, qty, notInCatalog?, clientId?,
 * userId?, countedAt? } — qty is ONE whole number of pieces, 1…int4 max
 * (lib/stock-audit/calc.ts validateQty; v27.79).
 *
 * OFFLINE QUEUE (v27.80, Smart Flow 2026-11-04) — the phone saves each entry
 * locally first and may send it more than once (a reply lost on weak signal):
 *   · clientId — optional (an old open tab sends none); when present it must
 *     be a UUID (400 INVALID otherwise), stored lower-cased.
 *   · userId — an ASSERTION only, never the actor: it must equal the session
 *     user or 409 WRONG_USER (a tab that queued user A's entries must not post
 *     them on user B's cookie).
 *   · REPLAY, checked BEFORE the audit-open check: a line already holding this
 *     clientId that is MINE in THIS audit → 200 { line, replayed: true } — even
 *     if the audit closed since, even if the line was removed since. Someone
 *     else's / another audit's → 409 CLIENT_ID_CONFLICT.
 *   · countedAt — the phone's clock at Submit, stored for display (the desk
 *     ledger's Time); missing / not an ISO date-time with an offset → NULL.
 * Then today's path: audit open (409 AUDIT_CLOSED) → 400 INVALID on a bad code
 * or qty → 400 NOT_IN_CATALOG unless confirmed → 201 { line }. A P2002 on the
 * clientId (two sends racing) is answered as the replay.
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;
  const auditId = parseId(params.id);
  if (auditId === null) return saError(400, "INVALID", "Invalid audit id");

  const body = await readJson(req);
  if (body === null) return saError(400, "INVALID", "Invalid JSON body");

  let clientId: string | null = null;
  if (body.clientId !== undefined && body.clientId !== null) {
    clientId = normaliseClientId(body.clientId);
    if (clientId === null) return saError(400, "INVALID", "clientId must be a UUID");
  }

  if (!userAssertionOk(body.userId, gate.userId)) {
    return saError(409, "WRONG_USER", "These counts belong to a different signed-in user");
  }

  if (clientId !== null) {
    const existing = await prisma.stockAuditLine.findUnique({
      where: { clientId },
      select: { ...LINE_SELECT, countedById: true },
    });
    const decision = decideReplay(existing, auditId, gate.userId);
    if (decision === "replay" && existing) {
      return NextResponse.json({ line: toCountLine(existing), replayed: true });
    }
    if (decision === "conflict") {
      return saError(409, "CLIENT_ID_CONFLICT", "This entry id is already used by another count");
    }
  }

  const load = await loadAuditForCount(auditId, { requireOpen: true });
  if (!load.ok) return load.response;

  const prepared = await prepareLineWrite(body);
  if (!prepared.ok) return prepared.response;

  try {
    const row = await prisma.stockAuditLine.create({
      data: {
        auditId,
        countedById: gate.userId,
        ...prepared.data,
        clientId,
        countedAt: parseCountedAt(body.countedAt),
      },
      select: LINE_SELECT,
    });
    return NextResponse.json({ line: toCountLine(row) }, { status: 201 });
  } catch (err) {
    if (clientId === null || !isClientIdCollision(err)) throw err;
    // Another send of the same entry won the race — answer as its replay.
    const existing = await prisma.stockAuditLine.findUnique({
      where: { clientId },
      select: { ...LINE_SELECT, countedById: true },
    });
    const decision = decideReplay(existing, auditId, gate.userId);
    if (decision === "replay" && existing) {
      return NextResponse.json({ line: toCountLine(existing), replayed: true });
    }
    return saError(409, "CLIENT_ID_CONFLICT", "This entry id is already used by another count");
  }
}
