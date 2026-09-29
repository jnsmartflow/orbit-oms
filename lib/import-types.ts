import type { PasteRowError } from "@/lib/sap-paste/read-paste"

export interface ImportLinePreview {
  rawLineItemId: number
  lineId: number
  skuCodeRaw: string
  skuDescriptionRaw: string | null
  unitQty: number
  isTinting: boolean
  rowStatus: 'valid' | 'error'
  rowError: string | null
}

export interface ImportObdPreview {
  rawSummaryId: number
  obdNumber: string
  shipToCustomerId: string | null
  shipToCustomerName: string | null
  obdEmailDate: string | null
  totalUnitQty: number | null
  grossWeight: number | null
  // 'previously_removed' — OBD exists in DB but was soft-removed by TM/Admin.
  // Skipped on re-import (no auto-restore — admin must explicitly restore).
  rowStatus: 'valid' | 'duplicate' | 'previously_removed' | 'error' | 'warning'
  rowError: string | null
  lineCount: number
  tintLineCount: number
  orderType: 'tint' | 'non_tint'
  lines: ImportLinePreview[]
}

export interface ImportPreviewResponse {
  batchId: number
  batchRef: string
  summary: {
    totalObds: number
    validObds: number
    duplicateObds: number
    previouslyRemovedObds: number
    errorObds: number
    warningObds: number
    totalLines: number
    validLines: number
    errorLines: number
  }
  obds: ImportObdPreview[]
}

export interface ImportConfirmBody {
  batchId: number
  confirmedObdIds: number[]
}

export interface ImportConfirmResponse {
  success: boolean
  batchId: number
  batchRef: string
  ordersCreated: number
  linesEnriched: number
}

// ─── Manual-SAP response shapes (Step 7 endpoint) ─────────────────────────

export interface SapPreviewObd {
  obdNumber:    string
  outcome:      'new' | 'patch' | 'skipped' | 'error'
  lineCount:    number
  totalUnitQty: number
  issues:       string[]
}

export interface SapPreviewWarning {
  delivery?:  string
  kind:       string
  message:    string
  rowNumbers: number[]
}

export interface SapPreviewResponse {
  ok:        true
  filename:  string
  fileStats: {
    totalRows:         number
    uniqueDeliveries:  number
    createdObds:       number
    skippedDeliveries: number
  }
  summary: {
    newOBDs:     number
    patchOBDs:   number
    skippedOBDs: number
    errorOBDs:   number
  }
  obds:     SapPreviewObd[]
  warnings: SapPreviewWarning[]
}

export interface SapConfirmResponse {
  ok:       true
  batchId:  number
  batchRef: string
  summary: {
    created:   number
    patched:   number
    unchanged: number
    errored:   number
  }
  errors:   Array<{ obdNumber: string; message: string }>
}

// ─── SAP paste response shapes (?action=sap-paste-preview / -confirm) ─────
//
// A successful paste preview/confirm returns SapPreviewResponse /
// SapConfirmResponse unchanged. A paste that could not be read returns this,
// with every unreadable line — nothing is previewed or written.

export interface SapPasteBlockedResponse {
  ok:     false
  error:  string
  errors: PasteRowError[]
}

/**
 * A customer code on a newly-created OBD that is missing from
 * delivery_point_master, so its screen-shortened name could not be completed.
 * One entry per CODE. `text` is the name as pasted.
 */
export interface PasteUnresolvedCustomer {
  code: string
  text: string
}

export type SapPastePreviewResponse = SapPreviewResponse & { unresolvedCustomers: PasteUnresolvedCustomer[] }
export type SapPasteConfirmResponse = SapConfirmResponse & { unresolvedCustomers: PasteUnresolvedCustomer[] }

// ─── Today's import log (GET /api/import/log) ──────────────────────────────
//
// TODAY's (IST) MANUAL imports only — auto-import batches are excluded. Every
// count comes from import_batches + orders.batchId; nothing per-OBD is stored,
// so there is no skip REASON and no patched/unchanged split.

export type ImportLogHow = "sap-paste" | "sap-file" | "template"

export interface ImportLogRow {
  id:       number
  batchRef: string
  /** import_batches.createdAt as ISO (UTC). The panel renders it in IST. */
  at:       string
  who:      string
  how:      ImportLogHow
  /** "completed" or "failed" — a failed SAP batch may still have written bills. */
  status:   string
  /** Bills this batch CREATED — orders.batchId = batch.id (removed ones included). */
  new:      number
  /** Bills already in Orbit. SAP: patched + unchanged. Template: its duplicates. */
  existing: number
  /** skippedObds on SAP paths — counts skipped ROWS as well as bills. 0 for template. */
  skipped:  number
  failed:   number
}

export interface ImportLogResponse {
  rows:   ImportLogRow[]
  totals: {
    imports:  number
    new:      number
    existing: number
  }
}
