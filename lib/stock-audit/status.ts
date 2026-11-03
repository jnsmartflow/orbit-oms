// lib/stock-audit/status.ts
//
// The ONE vocabulary for stock_audits.status (CORE §3: a status STRING is not
// an enum — never retype the literal, import it from here). The column is a
// plain Prisma String; the live CHECK chk_stock_audits_status rejects anything
// else, but a wrong literal in a WHERE would silently match nothing.
//
// v27.79 (2026-11-03): stock_audit_lines.mode is DROPPED — one qty, always
// pieces — and the pieces/cartons vocabulary went with it.
//
// Pure — no Prisma, no server imports. The phone screen imports this.
//
// Write sites:
//   'open'    — POST /api/stock-audit/audits (the column default as well)
//   'closed'  — POST /api/stock-audit/audits/[id]/close. NEVER reopened
//               (Smart Flow, 2026-11-02): nothing writes 'closed' → 'open'.
//   At most ONE audit is 'open' — stock_audits_one_open_key (v27.79).

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
