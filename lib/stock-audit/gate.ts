// lib/stock-audit/gate.ts — the one gate every /api/stock-count and
// /api/stock-audit route uses (the freightGate pattern).
//
// Two keys, never mixed:
//   stock_audit_count  — the counter's phone. canView is its ONLY meaning, and
//                        it is NOT enough on its own: the person must also be an
//                        assigned counter on the audit, and to write, the audit
//                        must be open (loadAuditForCounter).
//   stock_audit_manage — the desk. canView reads, canEdit writes, canExport XLS.
// checkAnyPermission carries the admin / superuser arms and the per-user ticks
// (CORE §5). The user id comes from the session, never from a body.
//
// Every refusal is { error, code } — the screens branch on `code`:
//   401 UNAUTHORIZED · 403 FORBIDDEN (no key) · 404 NOT_FOUND (unknown audit)
//   403 NOT_ASSIGNED · 409 AUDIT_CLOSED · (routes add NOT_OWNER, INVALID, …)
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
 * For a COUNTER: the audit must exist (404), the user must be one of its
 * counters (403 NOT_ASSIGNED), and — when `requireOpen` — it must be open
 * (409 AUDIT_CLOSED). Not-assigned is checked BEFORE closed, so a stranger
 * learns nothing about an audit's state.
 */
export async function loadAuditForCounter(
  auditId: number,
  userId: number,
  opts: { requireOpen: boolean },
): Promise<AuditLoad> {
  const audit = await findAudit(auditId);
  if (!audit) return { ok: false, response: saError(404, "NOT_FOUND", "Audit not found") };
  const counter = await prisma.stockAuditCounter.findUnique({
    where: { auditId_userId: { auditId, userId } },
    select: { id: true },
  });
  if (!counter) {
    return { ok: false, response: saError(403, "NOT_ASSIGNED", "You are not a counter on this audit") };
  }
  if (opts.requireOpen && audit.status !== STOCK_AUDIT_STATUS.open) {
    return { ok: false, response: saError(409, "AUDIT_CLOSED", "This audit is closed") };
  }
  return { ok: true, audit };
}

/** For the DESK: 404 if unknown; 409 AUDIT_CLOSED when `requireOpen` and closed. */
export async function loadAuditForManager(auditId: number, opts: { requireOpen: boolean }): Promise<AuditLoad> {
  const audit = await findAudit(auditId);
  if (!audit) return { ok: false, response: saError(404, "NOT_FOUND", "Audit not found") };
  if (opts.requireOpen && audit.status !== STOCK_AUDIT_STATUS.open) {
    return { ok: false, response: saError(409, "AUDIT_CLOSED", "This audit is closed") };
  }
  return { ok: true, audit };
}

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

/** A non-empty list of distinct positive integer ids, or null. */
export function counterIdList(value: unknown, opts: { allowEmpty: boolean }): number[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0)) return null;
  const ids = Array.from(new Set(value as number[]));
  if (ids.length === 0 && !opts.allowEmpty) return null;
  if (ids.length > 200) return null;
  return ids;
}
