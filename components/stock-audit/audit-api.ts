// components/stock-audit/audit-api.ts — the desk's calls to /api/stock-audit/*
// and its plain-English errors. Client-only; reuses count-api.ts's fetch
// wrapper (same { error, code } reading, same signed-out detection).

import type { AssignableUser, AuditDetail, AuditListItem, SkuLedger } from "@/lib/stock-audit/types";
import { call, type CountError, type CountResult } from "./count-api";

export function deskError(e: CountError): string {
  switch (e.code) {
    case "NOT_ASSIGNABLE":
      return "Someone you picked can't be a counter — they need an active login with Stock count access.";
    case "TRY_AGAIN":
      return "Another audit was created at the same moment — please try again.";
    case "INVALID":
      return e.message || "Check what you entered and try again.";
    case "AUDIT_CLOSED":
      return "This audit is closed — nothing can change.";
    case "NOT_FOUND":
      return "That audit no longer exists.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    case "UNAUTHORIZED":
      return "You've been signed out — please sign in again.";
    case "NETWORK":
      return "Couldn't reach the server — check the connection and try again.";
    default:
      return e.message || "Something went wrong — please try again.";
  }
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function fetchAudits(): Promise<CountResult<{ audits: AuditListItem[] }>> {
  return call("/api/stock-audit/audits");
}

export function fetchAuditDetail(id: number): Promise<CountResult<AuditDetail>> {
  return call(`/api/stock-audit/audits/${id}`);
}

export function fetchLedger(id: number, material: string): Promise<CountResult<SkuLedger>> {
  return call(`/api/stock-audit/audits/${id}/ledger?material=${encodeURIComponent(material)}`);
}

export function fetchAssignableUsers(): Promise<CountResult<{ users: AssignableUser[] }>> {
  return call("/api/stock-audit/users");
}

export function createAudit(counterIds: number[]): Promise<CountResult<{ audit: { id: number; auditNumber: string } }>> {
  return call("/api/stock-audit/audits", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ counterIds }),
  });
}

export function saveCounters(
  id: number,
  counterIds: number[],
): Promise<CountResult<{ counters: { userId: number; name: string }[] }>> {
  return call(`/api/stock-audit/audits/${id}/counters`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ counterIds }),
  });
}

export function closeAudit(id: number): Promise<CountResult<{ ok: true; closedAt: string }>> {
  return call(`/api/stock-audit/audits/${id}/close`, { method: "POST" });
}

/** The XLS is a file, not JSON — a plain navigation to the route downloads it
 *  (Content-Disposition: attachment), with the browser's own progress. */
export function exportUrl(id: number): string {
  return `/api/stock-audit/audits/${id}/export`;
}

const IST = "Asia/Kolkata";

/** "1 Nov 2026, 9:00 am" in IST. */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
}
