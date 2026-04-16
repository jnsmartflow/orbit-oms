Now the **two Claude Code prompts**:

---

### PROMPT 1 — Sonnet — Create template registry
```
Read CLAUDE_CONTEXT_v20.md fully before doing anything else.

Create a new file: lib/import-templates.ts

This file defines the template registry for the OBD import system.
No other files should be touched in this step.

The file should export:
1. A type: ImportTemplateId = "two_file_v1" | "combined_v2"
2. An interface: ImportTemplate with these fields:
   - id: ImportTemplateId
   - label: string  (shown in dropdown)
   - description: string  (helper text below dropdown)
   - files object with optional keys:
       combined?:  { fieldName: string; label: string }
       header?:    { fieldName: string; label: string }
       lineItems?: { fieldName: string; label: string; required: boolean }
   - sheets object:
       header:     string  (sheet name for OBD header data)
       lineItems?: string  (sheet name for line items)

3. A const: IMPORT_TEMPLATES as Record<ImportTemplateId, ImportTemplate>
   with two entries:

   two_file_v1:
   - label: "Template 1 — Two File (Header + Lines)"
   - description: "Upload separate Header XLS and Line Items XLS files"
   - files.header:    { fieldName: "headerFile",  label: "OBD Header File" }
   - files.lineItems: { fieldName: "lineFile",     label: "Line Items File (Optional)", required: false }
   - sheets.header:    "LogisticsTrackerWareHouse"
   - sheets.lineItems: "Sheet1"

   combined_v2:
   - label: "Template 2 — Combined File (Two Sheets)"
   - description: "Upload one Excel file with sheets: LogisticsTrackerWareHouse + LineItems"
   - files.combined: { fieldName: "combinedFile", label: "Combined OBD File" }
   - sheets.header:    "LogisticsTrackerWareHouse"
   - sheets.lineItems: "LineItems"

4. A helper const: DEFAULT_TEMPLATE_ID: ImportTemplateId = "two_file_v1"

After creating the file, confirm it compiles with no TypeScript errors by running:
npx tsc --noEmit
```

---

### PROMPT 2 — Sonnet — Update route.ts + import-page-content.tsx
```
Read CLAUDE_CONTEXT_v20.md fully before doing anything else.
Then read these files in full before making any changes:
  lib/import-templates.ts          (just created)
  app/api/import/obd/route.ts
  components/import/import-page-content.tsx

── CHANGE 1: app/api/import/obd/route.ts ──────────────────────

In handlePreview:
1. Import IMPORT_TEMPLATES and ImportTemplateId from "@/lib/import-templates"
2. Read templateId from FormData: formData.get("templateId") as ImportTemplateId
   - If missing or not a valid key in IMPORT_TEMPLATES, default to "two_file_v1"
3. Look up: const template = IMPORT_TEMPLATES[templateId]
4. Replace the current hardcoded two-file parsing block with template-aware logic:

   IF template.files.combined exists (combined_v2):
     - Read combinedFile from FormData (required — return 400 if missing)
     - Parse one workbook
     - headerRows = parseSheet(workbook, template.sheets.header)
     - lineRows   = parseSheet(workbook, template.sheets.lineItems!) if sheet exists, else []

   IF template.files.header exists (two_file_v1):
     - Read headerFile from FormData (required — return 400 if missing)
     - Read lineFile from FormData (optional)
     - Parse headerFile workbook → headerRows from template.sheets.header
     - Parse lineFile workbook → lineRows from template.sheets.lineItems if provided

5. All logic after parsing (validation, DB inserts) remains 100% unchanged.

6. In import_batches.create, store templateId in the headerFile field as a prefix:
   headerFile: `[${templateId}] ${fileName}`
   This is backward compatible — no schema change needed.

── CHANGE 2: components/import/import-page-content.tsx ────────

1. Import IMPORT_TEMPLATES, DEFAULT_TEMPLATE_ID, ImportTemplateId from "@/lib/import-templates"

2. Add state: const [templateId, setTemplateId] = useState<ImportTemplateId>(DEFAULT_TEMPLATE_ID)

3. In Stage 1 (upload), ABOVE the file zones, add a template selector:
   - A clean styled dropdown (use a native <select> or shadcn Select)
   - Label: "Import Template"
   - Options: map over Object.values(IMPORT_TEMPLATES) → { value: id, label: template.label }
   - Below the dropdown show template.description as helper text in slate-400
   - On change: setTemplateId(value) AND reset headerFile/lineFile state to null

4. Render file zones DYNAMICALLY from the selected template:
   const tmpl = IMPORT_TEMPLATES[templateId]
   - If tmpl.files.combined exists: render ONE FileZone for combinedFile
   - If tmpl.files.header exists: render FileZone for headerFile
   - If tmpl.files.lineItems exists: render FileZone for lineFile (label from template)
   
   Use a single combinedFile state | headerFile state | lineFile state
   Clear whichever states are not relevant when template changes.

5. In handlePreviewSubmit:
   - Append templateId to FormData: fd.append("templateId", templateId)
   - For combined template: append combinedFile as "combinedFile"
   - For two-file template: append headerFile as "headerFile", lineFile as "lineFile" (if present)
   - Disable button logic: combined template → require combinedFile; two-file → require headerFile

6. resetAll() should also reset templateId to DEFAULT_TEMPLATE_ID

── CONSTRAINTS ─────────────────────────────────────────────────
- No new libraries
- No schema changes
- All existing import logic (validation, DB writes, preview, confirm) untouched
- two_file_v1 must work identically to today for existing users
- Run npx tsc --noEmit after changes and fix any type errors before finishing