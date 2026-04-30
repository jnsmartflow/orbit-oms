export type ImportTemplateId = "two_file_v1" | "combined_v2" | "manual-sap";

export interface ImportTemplate {
  id: ImportTemplateId;
  label: string;
  description: string;
  files: {
    combined?:  { fieldName: string; label: string };
    header?:    { fieldName: string; label: string };
    lineItems?: { fieldName: string; label: string; required: boolean };
    /** Single SAP OBT export file. Distinct from `combined` (which expects
     *  two named sheets) — SAP files have one sheet of any name. */
    singleSap?: { fieldName: string; label: string };
  };
  sheets: {
    header:      string;
    lineItems?:  string;
  };
  /** When true, the upload UI shows a date picker; the chosen date is
   *  passed to the parser as `fallbackObdEmailDate`. */
  requiresObdEmailDate?: boolean;
}

export const IMPORT_TEMPLATES: Record<ImportTemplateId, ImportTemplate> = {
  two_file_v1: {
    id: "two_file_v1",
    label: "Template 1 — Two File (Header + Lines)",
    description: "Upload separate Header XLS and Line Items XLS files",
    files: {
      header: { fieldName: "headerFile", label: "OBD Header File" },
      lineItems: { fieldName: "lineFile", label: "Line Items File (Optional)", required: false },
    },
    sheets: {
      header: "LogisticsTrackerWareHouse",
      lineItems: "Sheet1",
    },
  },
  combined_v2: {
    id: "combined_v2",
    label: "Template 2 — Combined File (Two Sheets)",
    description: "Upload one Excel file with sheets: LogisticsTrackerWareHouse + LineItems",
    files: {
      combined: { fieldName: "combinedFile", label: "Combined OBD File" },
    },
    sheets: {
      header: "LogisticsTrackerWareHouse",
      lineItems: "LineItems",
    },
  },
  "manual-sap": {
    id: "manual-sap",
    label: "SAP File — Direct OBT Export",
    description: "Upload a SAP OBT export XLSX. Picks current order state per OBD; existing rows are patched, new rows are created.",
    files: {
      singleSap: { fieldName: "file", label: "SAP OBT Export File" },
    },
    sheets: {
      header: "Sheet1",
    },
    requiresObdEmailDate: true,
  },
};

export const DEFAULT_TEMPLATE_ID: ImportTemplateId = "combined_v2";
