// lib/import-upsert/types.ts
//
// Public types + module-wide constants for the OBD upsert utility. Imported
// by every other file in this folder and re-exported from lib/import-upsert.ts.

import type { Prisma } from "@prisma/client";

// ─── Public types ─────────────────────────────────────────────────────────

export type ImportSource = "auto-import" | "manual-template" | "manual-sap";

export interface ObdLineInput {
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  batchCode:         string | null;
  unitQty:           number;
  volumeLine:        number | null;
  isTinting:         boolean;
  article:           number | null;
  articleTag:        string | null;
}

export interface ObdInput {
  obdNumber:           string;
  /** SAP Division code; resolveSmuFromDivision() converts to {smu,smuCode}. */
  division:            string | null;
  sapStatus:           string | null;
  materialType:        string | null;
  natureOfTransaction: string | null;
  warehouse:           string | null;
  obdEmailDate:        Date | null;
  /** "HH:mm" IST. */
  obdEmailTime:        string | null;
  totalUnitQty:        number | null;
  grossWeight:         number | null;
  volume:              number | null;
  billToCustomerId:    string | null;
  billToCustomerName:  string | null;
  shipToCustomerId:    string | null;
  shipToCustomerName:  string | null;
  invoiceNo:           string | null;
  invoiceDate:         Date | null;
  soNumber:            string | null;
  lines:               ObdLineInput[];
}

export type AppliedChangeType =
  | "obd_created"
  | "header_patched"
  | "header_overwritten"
  | "line_added"
  | "line_patched"
  | "line_removed"
  | "line_restored";

export interface AppliedChange {
  type:      AppliedChangeType;
  field?:    string;
  lineId?:   number;
  oldValue?: unknown;
  newValue?: unknown;
  note:      string;
}

export type EffectType =
  | "mail-order-enrichment"
  | "challan-create"
  | "query-summary-rebuild"
  | "customer-resolved"
  | "order-type-mismatch";

export interface DownstreamEffect {
  type:    EffectType;
  orderId: number;
  payload: Record<string, unknown>;
}

export type UpsertOutcome = "created" | "patched" | "unchanged" | "errored";

export interface UpsertResult {
  obdNumber: string;
  outcome:   UpsertOutcome;
  orderId:   number | null;
  applied:   AppliedChange[];
  effects:   DownstreamEffect[];
  errors:    string[];
}

// ─── Internal types (re-exported within the subfolder, not from the barrel) ─

export interface ExistingOrder {
  id:                 number;
  customerId:         number | null;
  shipToCustomerName: string | null;
  customerMissing:    boolean;
  orderType:          string;
  workflowStage:      string;
  slotId:             number | null;
  invoiceNo:          string | null;
  invoiceDate:        Date | null;
  soNumber:           string | null;
  obdEmailDate:       Date | null;
  orderDateTime:      Date | null;
  smu:                string | null;
  sapStatus:          string | null;
  materialType:       string | null;
  natureOfTransaction:string | null;
  warehouse:          string | null;
  totalUnitQty:       number | null;
  grossWeight:        number | null;
  volume:             number | null;
}

export interface ExistingLine {
  id:           number;
  rawSummaryId: number;
  lineId:       number;
  skuCodeRaw:   string;
  unitQty:      number;
  volumeLine:   number | null;
  isTinting:    boolean;
  lineStatus:   string;
}

export interface ExistingSummary {
  id:           number;
  obdEmailTime: string | null;
  smuCode:      string | null;
}

export interface HeaderPatchEntry {
  field:    string;
  oldValue: unknown;
  newValue: unknown;
  type:     "header_patched" | "header_overwritten";
}

export interface HeaderPatchPlan {
  orderUpdate:      Prisma.ordersUpdateInput;
  summaryUpdate:    Prisma.import_raw_summaryUpdateInput;
  entries:          HeaderPatchEntry[];
  customerResolved: boolean;
}

export interface LinePatchEntry {
  existingId:    number;
  lineId:        number;
  updates:       Prisma.import_raw_line_itemsUpdateInput;
  fieldChanges:  Array<{ field: string; oldValue: unknown; newValue: unknown }>;
}

export interface SplitLineCascade {
  rawLineItemId:     number;
  lineStatus?:       string;
  removedAt?:        Date | null;
  removedReason?:    string | null;
  lastSeenInBatchId?: number;
}

export interface LinePatchPlan {
  adds:          ObdLineInput[];
  patches:       LinePatchEntry[];
  restores:      Array<{ existingId: number; lineId: number }>;
  removes:       Array<{ existingId: number; lineId: number; sku: string }>;
  splitCascades: SplitLineCascade[];
}

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * SAP "Division" code → human-readable SMU label & code stored on the order.
 * Unknown divisions yield { smu: null, smuCode: null }.
 */
export const DIVISION_TO_SMU: Record<string, { smu: string; smuCode: string }> = {
  "70": { smu: "Deco Retail",         smuCode: "70" },
  "74": { smu: "Decorative Projects", smuCode: "74" },
  "76": { smu: "Distributor",         smuCode: "76" },
  "77": { smu: "Retail Offtake",      smuCode: "77" },
};

/**
 * Per-source authority over line items. Authoritative sources may overwrite
 * qty/volume on existing lines and soft-remove lines absent from the incoming
 * set. Non-authoritative sources may only fill NULL fields and add new lines.
 */
export const LINE_AUTHORITY: Record<ImportSource, boolean> = {
  "auto-import":     false,
  "manual-template": false,
  "manual-sap":      true,
};

/**
 * SMU labels eligible for auto delivery-challan creation. Mirrors the value
 * used in app/api/import/obd/route.ts and app/api/admin/fix-challans/route.ts.
 */
export const CHALLAN_ELIGIBLE_SMU: ReadonlyArray<string> = [
  "Retail Offtake",
  "Decorative Projects",
];
