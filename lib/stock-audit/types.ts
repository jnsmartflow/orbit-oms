// lib/stock-audit/types.ts
//
// WIRE shapes — what the /api/stock-count/* and /api/stock-audit/* routes send
// as JSON, and what the two screens import. Dates are ISO strings here, never
// Date objects. Pure: no Prisma, no server imports (the phone imports this).
//
// The workbook's row shape is NOT here — it never crosses the wire (the CI
// split: lib/ci/workbook.ts keeps CiRegisterRow beside its only consumer).

import type { StockAuditStatus } from "./status";
import type { CatalogRow } from "./sku-search";

/** Machine-readable error codes every stock-audit route may answer with. */
export type StockAuditErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID"
  | "NOT_FOUND"
  | "AUDIT_CLOSED"
  | "AUDIT_ALREADY_OPEN"
  | "NOT_OWNER"
  | "NOT_IN_CATALOG"
  | "TRY_AGAIN"
  /** v27.80: a clientId already used by someone else's line / another audit. */
  | "CLIENT_ID_CONFLICT"
  /** v27.80: the body's userId is not the session user (an old tab). */
  | "WRONG_USER";

/** Every non-2xx body: a human message + the code the screen branches on. */
export interface StockAuditErrorBody {
  error: string;
  code: StockAuditErrorCode;
  /** INVALID: one entry per bad field (material, qty). */
  fields?: { field: string; message: string }[];
}

// ── Counter (phone) ──────────────────────────────────────────────────────────

/** GET /api/stock-count/audits — THE open audit (open counting: at most one
 *  is open, and everyone holding stock_audit_count counts in it). */
export interface MyAudit {
  id: number;
  auditNumber: string;
  createdAt: string;
  /** My live (not removed) lines in it. */
  myLines: number;
}

/** GET /api/stock-count/catalog — the phone's whole searchable list
 *  (rows: lib/stock-audit/sku-search.ts CatalogRow). */
export type CatalogResponse =
  | { version: string; unchanged: true }
  | { version: string; skus: CatalogRow[] };

/** One of MY lines. qty is always pieces (v27.79 — one number, no working). */
export interface CountLine {
  id: number;
  auditId: number;
  material: string;
  inCatalog: boolean;
  skuDescription: string | null;
  skuPack: string | null;
  qty: number;
  /** v27.80 — the phone's per-entry id; null on lines saved before v27.80. */
  clientId: string | null;
  /** v27.80 — the phone's clock at Submit (display only); null on old lines. */
  countedAt: string | null;
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
  /** People with at least one live line in it. */
  counted: number;
  /** Live lines only. */
  lines: number;
}

/** GET /api/stock-audit/audits. */
export interface AuditListResponse {
  audits: AuditListItem[];
  /** What "New audit" would create next (the confirm text) — a preview, not a reservation. */
  nextAuditNumber: string;
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
  /** People with at least one live line. */
  countersActive: number;
}

/** SKU summary row (all counters merged). */
export interface SkuSummaryRow {
  material: string;
  description: string | null;
  pack: string | null;
  inCatalog: boolean;
  /** Sum of the live lines' qty. The desk labels it "Total pcs". */
  qty: number;
  lines: number;
}

/** Progress row — one per person with live lines (open counting: no list). */
export interface CounterProgress {
  userId: number;
  name: string;
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
  qty: number;
  /** v27.80 — the phone's clock at Submit; null on old lines. The ledger's
   *  Time column shows countedAt ?? createdAt. */
  countedAt: string | null;
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
  /** Sum of the rows' qty. */
  qty: number;
}

/** GET /api/stock-audit/audits/[id]/marker. */
export interface AuditMarker {
  count: number;
  latest: string | null;
}
