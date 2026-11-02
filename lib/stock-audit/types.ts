// lib/stock-audit/types.ts
//
// WIRE shapes — what the /api/stock-count/* and /api/stock-audit/* routes send
// as JSON, and what the two screens import. Dates are ISO strings here, never
// Date objects. Pure: no Prisma, no server imports (the phone imports this).
//
// The workbook's row shape is NOT here — it never crosses the wire (the CI
// split: lib/ci/workbook.ts keeps CiRegisterRow beside its only consumer).

import type { CountMode, StockAuditStatus } from "./status";

/** Machine-readable error codes every stock-audit route may answer with. */
export type StockAuditErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID"
  | "NOT_FOUND"
  | "NOT_ASSIGNED"
  | "AUDIT_CLOSED"
  | "NOT_OWNER"
  | "NOT_IN_CATALOG"
  | "NOT_ASSIGNABLE"
  | "TRY_AGAIN";

/** Every non-2xx body: a human message + the code the screen branches on. */
export interface StockAuditErrorBody {
  error: string;
  code: StockAuditErrorCode;
  /** INVALID from validateLineInput: one entry per bad field. */
  fields?: { field: string; message: string }[];
}

// ── Counter (phone) ──────────────────────────────────────────────────────────

/** GET /api/stock-count/audits — an open audit I am assigned to. */
export interface MyAudit {
  id: number;
  auditNumber: string;
  createdAt: string;
  /** My live (not removed) lines in it. */
  myLines: number;
}

/** GET /api/stock-count/skus — one catalog match. */
export interface SkuHit {
  material: string;
  description: string;
  pack: string;
  /** null unless the catalog's piecesPerCarton > 0. */
  piecesPerCarton: number | null;
  /** 'cartons' when piecesPerCarton > 0, else 'pieces' (Smart Flow carton rule). */
  defaultMode: CountMode;
}

/** One of MY lines — every working field, plus the formatted working. */
export interface CountLine {
  id: number;
  auditId: number;
  material: string;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  mode: CountMode;
  stack: number;
  rows: number;
  depth: number;
  pcsPerCarton: number | null;
  loose: number;
  totalPcs: number;
  /** formatWorking() — "4 × 10 × 2 × 12 + 5". */
  working: string;
  createdAt: string;
  updatedAt: string;
}

// ── Manager (desk) ───────────────────────────────────────────────────────────

/** GET /api/stock-audit/audits — the rail. */
export interface AuditListItem {
  id: number;
  auditNumber: string;
  status: StockAuditStatus;
  createdAt: string;
  closedAt: string | null;
  createdByName: string;
  counters: number;
  /** Live lines only. */
  lines: number;
}

export interface AuditHeader {
  id: number;
  auditNumber: string;
  status: StockAuditStatus;
  createdAt: string;
  createdByName: string;
  closedAt: string | null;
  closedByName: string | null;
}

/** The stat cards. Live lines only. */
export interface AuditStats {
  skus: number;
  pieces: number;
  lines: number;
  /** Assigned counters with at least one live line … */
  countersActive: number;
  /** … out of all assigned counters. */
  counters: number;
}

/** SKU summary row (all counters merged). */
export interface SkuSummaryRow {
  material: string;
  description: string | null;
  pack: string | null;
  inCatalog: boolean;
  totalPcs: number;
  lines: number;
}

/** Progress row — one per assigned counter, plus anyone taken off the audit
 *  who still has live lines (assigned: false). */
export interface CounterProgress {
  userId: number;
  name: string;
  assigned: boolean;
  lines: number;
  pieces: number;
  lastEntryAt: string | null;
}

/** GET /api/stock-audit/audits/[id]. */
export interface AuditDetail {
  audit: AuditHeader;
  stats: AuditStats;
  /** Filtered by ?q= when given; stats are never filtered. */
  skus: SkuSummaryRow[];
  progress: CounterProgress[];
}

/** One ledger line for a SKU. */
export interface LedgerRow {
  lineId: number;
  countedById: number;
  countedByName: string;
  mode: CountMode;
  working: string;
  totalPcs: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/stock-audit/audits/[id]/ledger?material=. */
export interface SkuLedger {
  material: string;
  description: string | null;
  pack: string | null;
  inCatalog: boolean;
  rows: LedgerRow[];
  totalPcs: number;
}

/** GET /api/stock-audit/audits/[id]/marker. */
export interface AuditMarker {
  count: number;
  latest: string | null;
}

/** GET /api/stock-audit/users — someone who may be made a counter. */
export interface AssignableUser {
  id: number;
  name: string;
}
