// lib/stock-audit/gate.ts — the one gate every /api/stock-count and
// /api/stock-audit route uses (the freightGate pattern).
//
// Two keys, never mixed:
//   stock_audit_count  — the counter's phone. canView is its ONLY meaning.
//                        OPEN COUNTING (2026-11-02): no per-audit counter list —
//                        anyone holding it counts in THE open audit; to write,
//                        the audit must be open (loadAuditForCount).
//   stock_audit_manage — the desk. canView reads, canEdit writes, canExport XLS.
// checkAnyPermission carries the admin / superuser arms and the per-user ticks
// (CORE §5). The user id comes from the session, never from a body.
//
// Every refusal is { error, code } — the screens branch on `code`:
//   401 UNAUTHORIZED · 403 FORBIDDEN (no key) · 404 NOT_FOUND (unknown audit)
//   409 AUDIT_CLOSED · (routes add NOT_OWNER, INVALID, AUDIT_ALREADY_OPEN, …)
//
// (No SKU is read here. Every stock-audit line stores the SAP `material` and
// never a sku_master / sku_master_v2 row id — CORE §13, the id-space landmine.)

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkAnyPermission, type ActionKey } from "@/lib/permissions";
import { STOCK_AUDIT_STATUS, type StockAuditStatus } from "./status";
import type { StockAuditErrorBody, StockAuditErrorCode } from "./types";

export function saError(
  status: number,
  code: StockAuditErrorCode,
  error: string,
  extra?: Pick<StockAuditErrorBody, "fields">,
): NextResponse {
  const body: StockAuditErrorBody = { error, code, ...extra };
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type Gate = { ok: true; userId: number } | { ok: false; response: NextResponse };

async function gateOn(pageKey: "stock_audit_count" | "stock_audit_manage", action: ActionKey): Promise<Gate> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: saError(401, "UNAUTHORIZED", "Unauthorized") };
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, pageKey, action))) {
    return { ok: false, response: saError(403, "FORBIDDEN", "Forbidden") };
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, response: saError(500, "FORBIDDEN", "Invalid session user id") };
  }
  return { ok: true, userId };
}

/** The phone's gate — stock_audit_count canView, on every counter route. */
export function stockCountGate(): Promise<Gate> {
  return gateOn("stock_audit_count", "canView");
}

/** The desk's gate — stock_audit_manage with the given action. */
export function stockAuditGate(action: Extract<ActionKey, "canView" | "canEdit" | "canExport">): Promise<Gate> {
  return gateOn("stock_audit_manage", action);
}

/** A positive integer route param, or null. */
export function parseId(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export interface AuditRow {
  id: number;
  auditNumber: string;
  status: StockAuditStatus;
}

export type AuditLoad = { ok: true; audit: AuditRow } | { ok: false; response: NextResponse };

async function findAudit(auditId: number): Promise<AuditRow | null> {
  const a = await prisma.stockAudit.findUnique({
    where: { id: auditId },
    select: { id: true, auditNumber: true, status: true },
  });
  if (!a) return null;
  return { id: a.id, auditNumber: a.auditNumber, status: a.status as StockAuditStatus };
}

/**
 * 404 if the audit is unknown; 409 AUDIT_CLOSED when `requireOpen` and it is
 * closed. The counter's routes (open counting — no assignment check; the
 * session's stock_audit_count canView is the whole admission) and the desk's
 * share it.
 */
export async function loadAuditForCount(auditId: number, opts: { requireOpen: boolean }): Promise<AuditLoad> {
  const audit = await findAudit(auditId);
  if (!audit) return { ok: false, response: saError(404, "NOT_FOUND", "Audit not found") };
  if (opts.requireOpen && audit.status !== STOCK_AUDIT_STATUS.open) {
    return { ok: false, response: saError(409, "AUDIT_CLOSED", "This audit is closed") };
  }
  return { ok: true, audit };
}

/** For the DESK — the same check as loadAuditForCount. */
export const loadAuditForManager = loadAuditForCount;

/** Read a JSON body; null on a malformed one (the route answers 400 INVALID). */
export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
