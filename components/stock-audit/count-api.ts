// components/stock-audit/count-api.ts — the phone's calls to /api/stock-count/*
// and the one place their error codes become plain English.
//
// Client-only and pure fetch: never imports Prisma, the workbook or any
// server module.
//
// OFFLINE QUEUE (v27.80, Smart Flow 2026-11-04): a NEW count is no longer
// posted from Submit — it is saved on the phone and sent by the queue's sender
// (use-count-queue.ts), with a clientId, the userId assertion and the phone's
// countedAt. So the Submitted (n) badge is now, ON PURPOSE, a LOCAL number:
// server lines + queued entries the server does not hold yet
// (lib/stock-audit/queue-core.ts submittedCount). Edit / Remove of a SENT line
// still go straight to PATCH / DELETE and need signal.

import type {
  CatalogResponse,
  CountLine,
  MyAudit,
  StockAuditErrorBody,
  StockAuditErrorCode,
} from "@/lib/stock-audit/types";

/** API codes plus the two the browser itself can produce. */
export type CountErrorCode = StockAuditErrorCode | "NETWORK" | "UNKNOWN";

export interface CountError {
  code: CountErrorCode;
  message: string;
  fields?: { field: string; message: string }[];
}

export type CountResult<T> = { ok: true; data: T } | { ok: false; error: CountError };

/** Plain English for every code the screen can meet (brief §6). */
export function friendlyError(e: CountError): string {
  switch (e.code) {
    case "AUDIT_CLOSED":
      return "This audit is closed — counts are locked";
    case "NOT_IN_CATALOG":
      return "That code is not in the SKU catalog";
    case "INVALID":
      return e.message || "Check the numbers and try again";
    case "NETWORK":
      return "Not saved — check signal and try again";
    case "NOT_FOUND":
      return "That count no longer exists";
    case "NOT_OWNER":
      return "Only the person who counted this can change it";
    case "UNAUTHORIZED":
      return "You've been signed out — please sign in again";
    case "FORBIDDEN":
      return "You don't have access to Stock count";
    case "TRY_AGAIN":
      return "Please try again";
    case "CLIENT_ID_CONFLICT":
      return "This count clashes with another saved count — remove it and count again";
    case "WRONG_USER":
      return "These counts belong to someone else — sign in as the person who counted them";
    default:
      return e.message || "Something went wrong — please try again";
  }
}

/** The shared fetch + error-code reader; the desk's audit-api.ts reuses it. */
export async function call<T>(url: string, init?: RequestInit, timeoutMs?: number): Promise<CountResult<T>> {
  let res: Response;
  // A timeout is a NETWORK failure: on one bar of signal (or a captive portal)
  // a fetch can hang for a minute. Safe for the queue — its POST carries a
  // clientId, so a send that did land is answered as a replay on the retry.
  const ctl = timeoutMs !== undefined && typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    res = await fetch(url, { cache: "no-store", ...init, ...(ctl ? { signal: ctl.signal } : {}) });
  } catch {
    if (timer) clearTimeout(timer);
    return { ok: false, error: { code: "NETWORK", message: "" } };
  }
  if (timer) clearTimeout(timer);
  // Middleware sends a signed-out request to /login (a 307 fetch follows),
  // so the answer is an HTML page, not our JSON.
  if (res.redirected && new URL(res.url).pathname.startsWith("/login")) {
    return { ok: false, error: { code: "UNAUTHORIZED", message: "" } };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body !== null) return { ok: true, data: body as T };
  const b = (body ?? {}) as Partial<StockAuditErrorBody>;
  return {
    ok: false,
    error: { code: b.code ?? "UNKNOWN", message: typeof b.error === "string" ? b.error : "", fields: b.fields },
  };
}

/** THE open audit, or null (open counting — at most one is open). */
export function fetchOpenAudit(): Promise<CountResult<{ audit: MyAudit | null }>> {
  return call("/api/stock-count/audits");
}

export function fetchMyLines(
  auditId: number,
): Promise<CountResult<{ audit: { id: number; auditNumber: string; status: string }; lines: CountLine[] }>> {
  return call(`/api/stock-count/audits/${auditId}/lines`);
}

/** The whole searchable SKU list — or "unchanged" when `have` is current. */
export function fetchCatalog(have: string | null): Promise<CountResult<CatalogResponse>> {
  return call(`/api/stock-count/catalog${have ? `?have=${encodeURIComponent(have)}` : ""}`);
}

/** What the qty entry sends (v27.79). qty as typed — a string of digits,
 *  always pieces; the server validates it again (calc.ts validateQty). */
export interface LineBody {
  material: string;
  qty: string;
  notInCatalog?: boolean;
}

/** A NEW line (v27.80): plus the phone's per-entry id, the signed-in user's id
 *  (an assertion the server checks, never the actor) and the Submit time. */
export interface NewLineBody extends LineBody {
  clientId: string;
  userId: number;
  countedAt: string;
}

/** The queue's send timeout. */
export const SEND_TIMEOUT_MS = 15_000;

const JSON_HEADERS = { "Content-Type": "application/json" };

/** 201 for a new line, 200 { replayed: true } when the server already held
 *  this clientId — the same success to the phone. */
export function createLine(
  auditId: number,
  body: NewLineBody,
): Promise<CountResult<{ line: CountLine; replayed?: boolean }>> {
  return call(
    `/api/stock-count/audits/${auditId}/lines`,
    { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) },
    SEND_TIMEOUT_MS,
  );
}

export function updateLine(lineId: number, body: LineBody): Promise<CountResult<{ line: CountLine }>> {
  return call(
    `/api/stock-count/lines/${lineId}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) },
    SEND_TIMEOUT_MS,
  );
}

export function removeLine(lineId: number): Promise<CountResult<{ ok: true; lineId: number }>> {
  return call(`/api/stock-count/lines/${lineId}`, { method: "DELETE" }, SEND_TIMEOUT_MS);
}

// ── Formatting shared by the three panes ─────────────────────────────────────

const IST = "Asia/Kolkata";

export function fmtPcs(n: number): string {
  return n.toLocaleString("en-IN");
}

/** "9:05 am" in IST. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
}

/** "Started 2 Nov, 9:05 am" in IST. */
export function fmtStarted(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short" });
  return `Started ${day}, ${fmtTime(iso)}`;
}
