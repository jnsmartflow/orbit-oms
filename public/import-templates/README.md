# Blank import templates

The Import modal in the universal header has a **Download blank template**
link that points to one of two files in this directory, picked by the
modal's `Source format` toggle:

- `sap-blank.xlsx`             — when format = `SAP file`
- `manual-template-blank.xlsx` — when format = `Manual template`

Both files need to be dropped into this directory by hand. The codebase does
not generate them — they are content, not code.

If the files are missing the browser will 404 silently. The modal does not
show an error UI for this case, by design — operators in the field rarely
need a fresh blank.

---

## `sap-blank.xlsx` — column requirements

A SAP OBT export. The file is consumed by `lib/sap-parser/` (entry point
`parseSapFile` in `lib/sap-parser/index.ts`). The parser uses position-based
column lookup with header-row validation — column ORDER and SPELLING must
match a real export.

Source the column header row from any recent production OBT export. The
parser-relevant columns are read from the first sheet (any sheet name —
`parseOptions.sheetName` defaults to the first sheet). Required headers
include at minimum:

- `Delivery`
- `Item`
- `Item Category` — values `TAN`, `ZKL3`, `ZINR` (normal), `Z007` (tinting),
  `ZZRE` (return — drops the line, may skip whole delivery)
- `Material`
- `Description`
- `Delivery quantity`
- `Volume`
- `Gross weight`
- `Division` — values `70` / `74` / `76` / `77` (Deco Retail / Decorative
  Projects / Distributor / Retail Offtake)
- `Bill-To`, `Ship-To`, `Ship-To Name`
- `SO Number`, `Invoice Number`, `Invoice Date`
- `Length` — used by the non-LF return skip rule

Drop a real recent export, delete the data rows, keep the header row. Save
as `.xlsx` (not `.xls`). Max 10 MB enforced server-side; a blank workbook is
under 50 KB.

---

## `manual-template-blank.xlsx` — column requirements

A combined-format manual template (`combined_v2`). Two sheets in one
workbook. Consumed by `handlePreview` in `app/api/import/obd/route.ts` via
`XLSX.utils.sheet_to_json` — column NAMES (not positions) must match.

### Sheet `LogisticsTrackerWareHouse`

Header row containing at minimum:

- `OBD Number`            (string, required)
- `Status`                (string)
- `SMU`, `SMU Code`       (string)
- `MaterialType`, `NatureOfTransaction`, `Warehouse`
- `OBD Email Date`        (date)
- `OBD Email Time`        (time, IST)
- `UnitQty`, `GrossWeight`, `Volume`
- `Bill To Customer Id`, `Bill To Customer Name`
- `ShipToCustomerId`, `Ship To Customer Name`
- `InvoiceNo`, `InvoiceDate`, `SONum`

Column names are case-sensitive and must match the constants in `RawHeaderRow`
at `app/api/import/obd/route.ts:32-53`.

### Sheet `LineItems`

Header row containing at minimum:

- `obd_number`      (string, joins to `OBD Number`)
- `sku_codes`       (string, must exist in `sku_master.skuCode`)
- `sku_description` (string)
- `unit_qty`        (number)
- `volume_line`     (number)
- `Tinting`         (boolean — accepts `true`/`false`/`1`/`0`)

Column names (mostly snake_case) match `RawLineRow` at `app/api/import/obd/route.ts:55-63`.

---

## Testing the blanks

1. Drop the file in this directory.
2. Reload `/mail-orders` (or any board) as an admin.
3. Click the Import button in the header.
4. Click "Download blank template" in the modal — file should download.
5. Open it, fill in one OBD with one line, save, upload back through the
   modal with preview ON. Confirm the preview shows 1 OBD valid.

If the parser rejects with `Cannot parse file. Check sheet names.` the
sheet name doesn't match. If it rejects with a header-validation error,
column names don't match.

---

*April 2026 · Phase 4 of import-to-header migration.*
