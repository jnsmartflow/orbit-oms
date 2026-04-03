# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v41.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v21 · Context v41 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v40)

1. **Warehouse header stats mismatch** — header shows different count than unassigned panel in history view
2. **Cleanup Prisma field mapping** — pick_assignments.clearedAt had @map("cleared_at") mismatch, fixed by removing @map. Verify cleanup runs correctly on next day boundary.
3. ~~**Slot cascade (NOT YET BUILT)**~~ — **DONE v33.**
4. **Duplicate pick columns** — orders and order_splits both have camelCase (isPicked, pickedAt, pickedById) AND snake_case (is_picked, picked_at, picked_by_id) columns. Use camelCase ones via Prisma.
5. ~~**Tint manager filter crash**~~ — **FIXED v36.** All array assignments in tint-manager-content.tsx and tint-operator-content.tsx have ?? [] fallbacks.
6. **Slot cascade changedById** — uses hardcoded userId=1 (admin) for system-generated audit logs.
7. ~~**Import not working**~~ — **FIXED v34.**
8. **Slot cascade cascades pending_support orders** — cascade moves ALL orders including those not yet submitted by Support. Consider adding workflowStage filter to cascade eligibility.
9. **Support board default slot on refresh** — intermittent issue, deprioritised.
10. ~~**TM slot filter broken**~~ — **FIXED v39.** Was using hardcoded times on legacy dispatchSlot text field. Replaced with real slotId from slot_master.
11. ~~**TM dispatch filter misleading**~~ — **FIXED v39.** Removed entirely — most pre-completion orders have null dispatchStatus.
12. **Shade Master isActive filter** — UI sends `isActive=true/false` param but `/api/admin/shades` may not handle it yet. Verify and add if missing.

---

## 43. Queued Features (UPDATED v41)

- ~~**Slot cascade**~~ — **DONE v33**
- ~~**Import debugging**~~ — **DONE v34**
- ~~**OBD date parsing fix**~~ — **DONE v34**
- ~~**Support history view**~~ — **DONE v35**
- ~~**Order detail panel**~~ — **DONE v35** (Support only → now also TM v39)
- ~~**Role-based navigation + redirects**~~ — **DONE v36**
- ~~**Operations role + unified ops view**~~ — **DONE v36**
- ~~**TM filter fix + slot awareness**~~ — **DONE v39**
- ~~**TM neutral palette redesign**~~ — **DONE v39**
- ~~**TM order detail panel integration**~~ — **DONE v39**
- ~~**Shade Master neutral redesign**~~ — **DONE v40**
- ~~**TI Report neutral redesign**~~ — **DONE v40**
- ~~**Mail Order email parsing + SKU enrichment (PowerShell)**~~ — **DONE v41.** Parser tested 82 emails, 305/310 lines matched (98.4%).
- **Mail Order page in OrbitOMS** — DB tables, enrichment API, operator UI (view/copy/punch/approve keywords). Next to build.
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows. Data already in API response (v39). Purely UI work — detail panel only for TM.
- **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need same neutral palette as TM v39. Use CLAUDE_UI.md as style guide.
- **soNumber import mapping** — column exists in DB + Prisma, need to map from SAP XLS column
- **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click)
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod

---

## 52. Tint Manager Redesign (NEW v39 — April 2, 2026)

(unchanged — refer to v39)

---

## 53. Shade Master Redesign (NEW v40 — April 2, 2026)

(unchanged — refer to v40)

---

## 54. TI Report Redesign (NEW v40 — April 2, 2026)

(unchanged — refer to v40)

---

## 56. Email Monitor Pipeline — RE: Emails (NEW v41 — April 3, 2026)

### Overview
PowerShell script monitoring the Outlook "Order" folder for RE: emails (depot reply with OBD number after SAP punching). Runs on the same Windows PC as Auto-Import.ps1.

### Location
`F:\VS Code\OrbitOMS-EmailMonitor\`

### Files
- `Watch-OrderEmails-v2.ps1` — main script, polls Outlook every 5s
- `accepted_senders.txt` — sender email filter (one per line, `surat.depot@akzonobel.com`)
- `shipto_keywords.txt` — keywords triggering Ship To Override = True
- `slotto_keywords.txt` — keywords triggering Slot To Override = True
- `order_database.xlsx` — primary output (confirmed orders only)
- `order_backup.csv` — full audit trail including pending orders
- `order_monitor_v2.log` — script log
- `processed_ids.json` — duplicate prevention via Outlook EntryID

### Output Columns (13)
Order No. | Subject | SO Name | SO Email DateTime | Reply DateTime | Dispatch Status | Dispatch Priority | Remarks | Ship To Override | Slot To Override | Status | SO Email | Sender

### Email Parsing Logic
- Only processes RE: emails from accepted senders containing "order" in subject
- Splits email body at `From:/Sent:` header block into Reply zone (OBD number) and Original zone (SO timestamp, remarks)
- OBD regex: `1045[0-9]+` (not `10451` — 5th digit varies)
- SO timestamp parsed from `Sent: DayName, Month D, YYYY H:MM AM/PM` using `DateTime.Parse()`
- Dispatch Status: `Hold` (call to SO/dealer/hold keywords) or `Dispatch` (default)
- Dispatch Priority: `Urgent` or `Normal` — independent of Hold status
- Ship To / Slot To Override: keyword match from config files against remarks + subject

### Key Constraints
- Requires Outlook desktop app running (COM object)
- Date filter: only processes today's emails
- Excel must be closed when script writes (COM lock)
- PowerShell `break` inside `try` inside `foreach` escapes the outer `while` loop — use flag variable
- `DateTime.Parse()` works on this PC; `ParseExact` fails (locale issue)

### Pending
Merge with Auto-Import pipeline (order_database.xlsx matched by Order No. to import file). Phase 2: challan attachment download.

---

## 57. Mail Order Pipeline — FW: Email Parsing + SKU Enrichment (NEW v41 — April 3, 2026)

### Overview
System to parse FW: order emails from Sales Officers, enrich product lines with SAP material codes, and display enriched orders for the SAP operator to copy and punch.

**Replaces:** PAD flow + Mail_Order_Query.xlsx (Power Query) + Python script + Google Sheets.

### Current State (v41)
- **PowerShell parser:** Built and tested. Reads FW: emails from Inbox, extracts product lines using regex engine (ported from PAD flow), enriches locally against CSV reference files, outputs to daily CSV.
- **Test results:** 82 emails, 310 product lines, 305 matched (98.4%). 5 partials are genuine catalog gaps.
- **Decision (v41):** Enrichment will move to OrbitOMS server-side. PowerShell will simplify to parsing + raw POST only. Keyword learning (auto-add new aliases) will happen on the Mail Order web page.

### Email Flow (current → target)
```
CURRENT (what's been tested):
  FW: email → PowerShell parses → enriches locally (CSV) → writes daily CSV

TARGET (next to build):
  FW: email → PowerShell parses → POSTs raw lines to OrbitOMS API
  → OrbitOMS enriches (DB keyword tables) → stores in mail_orders tables
  → SAP operator views Mail Order page → copies SKU data → punches in SAP
  → Marks order as "punched" → unmatched lines: operator picks SKU → keyword auto-saved
```

### PowerShell Parser — Parse-MailOrders.ps1
**Location:** `F:\VS Code\mail-orders\`

**What it does:**
1. Monitors Outlook Inbox (default folder, not "Order" subfolder) for FW: emails
2. Filters: subject contains "order", excludes "Site Order", "Cross Billing Order", and RE: prefix
3. Extracts original sender (From), timestamp (Sent), subject from forwarded email headers
4. Cleans body: strips BEWARE warning, strips after REGARDS
5. Parses product lines using regex engine handling 8+ email format variations

**Email format variations handled:**

| SO writes... | Parser extracts |
|---|---|
| `Aquatech 2in1 - 4*4` | Product: Aquatech 2in1, Pack: 4, Qty: 4 |
| `Max 90 - 1*9` | Product: Max 90, Pack: 1, Qty: 9 |
| `Gloss:90:1*6,dark brown:500*1c` | 2 lines: Gloss 90 pk 1 qty 6, Gloss dark brown pk 500 qty 1 |
| `Promise Exterior 94 - 1*6` then `92 - 1*6` | Variant carry-forward: both use "Promise Exterior" |
| `Product 500ml: 12` | Standalone unit format |
| `NO1*6` | Tinter code recombination: product=NO1, pack=1, qty=6 |
| Product on one line, `1*12,4*8,10*5,20*25` on separate line | Multi-pack carry-forward from LastProductFullName |
| `5599498 -1ltr` | SAP material code: direct lookup by material number |

**Key parsing features:**
- Tinter code recombination: when product is 2-3 letters + single digit (like NO1, XR1, BU2), merges them back instead of splitting
- `2in1` / `3in1` protection: trailing number regex skips when text ends with `\din\d`
- Variant carry-forward: `LastProductFullName` / `LastProductBaseName` track context across lines
- SAP material code detection: lines starting with 5-10 digit codes bypass keyword matching, do direct SKU lookup

### SKU Enrichment Engine — Try-and-Verify

**Algorithm (currently in PowerShell, moving to TypeScript on server):**

```
Input: rawText="Max Brilliant White", packCode="4"

1. Find ALL product keywords matching the text (sorted by length DESC)
   "WHITE" → WHT, "MAX" → MAX, etc.

2. For EACH product candidate:
   a. Remove keyword from text → remaining
   b. Find ALL base keywords in remaining text
   c. For each (product, base, pack) combo → look up in SKU table
   d. If SKU found → RETURN (verified match)

3. Fallbacks tried in order:
   a. Base keywords from remaining text
   b. Base keywords from product name itself (handles "Fast Red" → base RED)
   c. Empty base (products with no base variant)
   d. Pack default "1" when pack is empty (tinters always 1L)

4. First combo that finds a real SKU wins — no guessing.
```

**Why not longest-keyword-first:** "WHITE" (5 chars) is longer than "MAX" (3 chars) but matching WHITE first gives wrong product (TINTER WHT instead of WS MAX). The try-and-verify approach tries ALL candidates and picks the one that resolves to a real SKU.

### Reference Data Files (CSV)
Generated from existing Excel reference files. Will become DB tables.

| File | Rows | Source | Purpose |
|---|---|---|---|
| ProductKeywords.csv | 705 | KeywordMap.xlsx → Product sheet | Maps SO spelling variations → canonical product name |
| BaseKeywords.csv | 190 | KeywordMap.xlsx → Base sheet | Maps colour/base aliases → canonical base name |
| SkuLookup.csv | 1,216 | StockData.xlsx + Dual SKU merged | Product + Base + Pack → SAP Material Code |
| CustomerKeywords.csv | 667 | Mail_Order_Query.xlsx → CustomerMaster | Customer name → code + area + delivery type |

**StockMaster.xlsx (52K rows) is NOT used.** It was a Cartesian product of keywords × SKUs. The new system keeps keywords and SKUs separate — 705 + 190 + 1,216 = ~2,100 rows instead of 52,000.

### DB Tables (to be created)

**`mail_orders`** — one row per email

```
id, soName, soEmail, receivedAt, subject, customerName, customerCode,
deliveryRemarks, remarks, billRemarks,
status (pending|punched), punchedById, punchedAt,
emailEntryId (UNIQUE — Outlook dedup), createdAt
```

**`mail_order_lines`** — one row per product line

```
id, mailOrderId (FK), lineNumber,
rawText, productName, baseColour, packCode, quantity,
skuCode, skuDescription, refSkuCode,
matchStatus (matched|partial|unmatched), createdAt
```

**`product_keywords`** — seeded from ProductKeywords.csv

```
id, keyword (UNIQUE), category, product
```

**`base_keywords`** — seeded from BaseKeywords.csv

```
id, keyword (UNIQUE), category, baseColour
```

**`sku_lookup`** — seeded from SkuLookup.csv

```
id, material (UNIQUE), description, category, product, baseColour,
packCode, unit, refMaterial
```

### Mail Order Page (to be built)

**Route:** `/mail-orders`

**Purpose:** SAP operator views enriched orders, copies SKU data to paste into SAP, marks orders as punched. For unmatched lines: operator picks correct SKU → system auto-saves the keyword for future matching.

**Layout (CLAUDE_UI.md neutral theme):**
```
Row 1: Mail Orders · N orders · N lines · N unmatched    [Today ▾]
Row 2: [All] [Pending] [Punched] status pills    [Search…]
```

**Order cards:** grouped by email, showing SO name, customer, time, subject. Line items table with: raw text, product, base, pack, qty, SKU code, description, match status. Footer: [Copy to SAP] [✓ Punched].

**Status flow:** `pending` → `punched`. punchedById + punchedAt recorded.

**Keyword learning:** Unmatched line → operator picks SKU from searchable dropdown → system creates new product_keywords or base_keywords row → auto-matches next time.

### Key Learnings from v41 Testing
- `"RE:"` substring appears inside `"ORDER:"` — bad keyword contains-check was blocking all emails. Fix: only check RE: at start of subject with regex `^RE\s*:`.
- PowerShell `-replace` only takes 2 arguments — `, 1` (limit to first occurrence) is not valid, causes `-ireplace` error.
- PowerShell `.Count` on single-item `Where-Object` result returns `$null` — wrap in `@()` to force array.
- `[:\-\.=-]` regex character class: `=-]` creates invalid range. Fix: put hyphen last `[:.=\-]`.
- `×` (multiplication sign) and `–` (en-dash) corrupt to multi-byte garbage in PowerShell. Replace with ASCII `x` and `-`.
- FW: emails land in Inbox (default folder 6), not the "Order" subfolder. RE: emails are in "Order" subfolder.
- Sender for FW: emails is `surat.depot@akzonobel.com` (depot forwards via Power Automate to the Orbit inbox).

---

## 55. Session Start Checklist (UPDATED v41)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v21**
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v3:** Load alongside this file for ALL UI work — defines neutral theme, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order pipeline:** Enrichment moves to server-side (§57). PowerShell does parsing only. DB tables: mail_orders, mail_order_lines, product_keywords, base_keywords, sku_lookup.
13. **Mail Order enrichment:** Try-and-verify engine — don't pick longest keyword, try all candidates and verify against SKU table.
14. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v21 · Context v41 · April 2026*
