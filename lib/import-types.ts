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
  rowStatus: 'valid' | 'duplicate' | 'error' | 'warning'
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
