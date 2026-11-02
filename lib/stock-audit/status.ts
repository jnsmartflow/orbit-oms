// lib/stock-audit/status.ts
//
// The ONE vocabulary for stock_audits.status and stock_audit_lines.mode
// (CORE §3: a status STRING is not an enum — never retype the literal, import
// it from here). Both columns are plain Prisma Strings; the live CHECKs
// (chk_stock_audits_status, chk_stock_audit_lines_mode) reject anything else,
// but a wrong literal in a WHERE would silently match nothing.
//
// Pure — no Prisma, no server imports. The phone screen imports this.
//
// Write sites:
//   'open'    — POST /api/stock-audit/audits (the column default as well)
//   'closed'  — POST /api/stock-audit/audits/[id]/close. NEVER reopened
//               (Smart Flow, 2026-11-02): nothing writes 'closed' → 'open'.
//   'pieces' / 'cartons' — the counter's line POST / PATCH
//               (app/api/stock-count/*), chosen on the phone's calculator.

export const STOCK_AUDIT_STATUS = {
  open: "open",
  closed: "closed",
} as const;

export type StockAuditStatus = (typeof STOCK_AUDIT_STATUS)[keyof typeof STOCK_AUDIT_STATUS];

export const STOCK_AUDIT_STATUSES: readonly StockAuditStatus[] = [
  STOCK_AUDIT_STATUS.open,
  STOCK_AUDIT_STATUS.closed,
];

export function isStockAuditStatus(value: unknown): value is StockAuditStatus {
  return typeof value === "string" && (STOCK_AUDIT_STATUSES as readonly string[]).includes(value);
}

export const COUNT_MODE = {
  pieces: "pieces",
  cartons: "cartons",
} as const;

export type CountMode = (typeof COUNT_MODE)[keyof typeof COUNT_MODE];

export const COUNT_MODES: readonly CountMode[] = [COUNT_MODE.pieces, COUNT_MODE.cartons];

export function isCountMode(value: unknown): value is CountMode {
  return typeof value === "string" && (COUNT_MODES as readonly string[]).includes(value);
}
