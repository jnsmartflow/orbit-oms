# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v42.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v22 · Context v42 · April 2026

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

## 43. Queued Features (UPDATED v42)

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
- ~~**Mail Order email parsing + SKU enrichment (PowerShell)**~~ — **DONE v41.**
- ~~**Mail Order backend (DB + APIs + enrichment engine)**~~ — **DONE v42.** 6 DB tables, 5 API endpoints, TypeScript enrichment engine, PowerShell v2 script. Live: 86 orders, 318 lines, 95.9% match rate.
- **Mail Order frontend page** — `/mail-orders` route with order cards, line items table, copy to SAP, punch flow, resolve unmatched lines with keyword learning. Next to build.
- **Mail Order role** — new `sap_operator` or `billing_operator` role for the SAP operator. Add to role_master, role_permissions, sidebar nav.
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

(unchanged — refer to v41)

---

## 57. Mail Order Pipeline — FW: Email Parsing + SKU Enrichment (UPDATED v42 — April 3, 2026)

### Overview
System to parse FW: order emails from Sales Officers, enrich product lines with SAP material codes, and display enriched orders for the SAP operator to copy and punch.

**Replaces:** PAD flow + Mail_Order_Query.xlsx (Power Query) + Python script + Google Sheets.

### Current State (v42)
- **Full backend LIVE.** PowerShell v2 script → HMAC API → server-side enrichment → DB storage.
- **Production test:** 86 orders, 318 product lines, 305 matched (95.9%). 13 unmatched lines are genuine keyword gaps (to be resolved via keyword learning UI).
- **PowerShell v2 script:** Parsing only + POST to API. No local enrichment. Reads config from `config.txt`.
- **Enrichment engine:** TypeScript (`lib/mail-orders/enrich.ts`), try-and-verify algorithm ported from PowerShell.
- **Pending:** Frontend page (view/copy/punch/resolve), new SAP operator role.

### Architecture
```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v2.ps1 (parses body, extracts product lines)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts (try-and-verify against DB keyword tables)
  → mo_orders + mo_order_lines (stored with match status)
  → Mail Order page (operator views, copies SKU+Qty, punches in SAP)
```

### DB Tables (Schema v22 — 6 `mo_*` tables)

All tables use `mo_` prefix to avoid collision with existing SKU hierarchy tables (`sku_master`, `product_name`, `base_colour`). The mail order keyword engine is a separate fuzzy matching system — not connected to the normalized SAP catalog.

**Transactional:**
- **`mo_orders`** — one row per parsed email. Fields: id, soName, soEmail, receivedAt, subject, customerName, customerCode, deliveryRemarks, remarks, billRemarks, status (pending|punched), punchedById (FK→users), punchedAt, emailEntryId (UNIQUE), totalLines, matchedLines, createdAt.
- **`mo_order_lines`** — one row per product line. Fields: id, moOrderId (FK→mo_orders, CASCADE), lineNumber, rawText, packCode, quantity, productName, baseColour, skuCode, skuDescription, refSkuCode, matchStatus (matched|partial|unmatched), createdAt.

**Reference (seeded from CSV, maintained via UI):**
- **`mo_product_keywords`** — 705 rows. keyword (NOT unique — duplicates allowed), category, product. Sorted by keyword length DESC for matching.
- **`mo_base_keywords`** — 190 rows. keyword (NOT unique — same keyword can map to different base colours, e.g., "RED" → "FAST RED" and "RED"). category, baseColour.
- **`mo_sku_lookup`** — 1,051 rows (deduped from 1,216 — dual SKU entries collapsed, row with baseColour kept). material (UNIQUE), description, category, product, baseColour, packCode, unit, refMaterial. Composite index on (product, baseColour, packCode).
- **`mo_customer_keywords`** — 667 rows. customerCode, customerName, area, deliveryType, route, keyword. Not yet wired into ingest API (customer matching deferred).

**Prisma models:** 6 models added to schema.prisma with back-relation `mailOrdersPunched` on users model. No @map directives.

### API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mail-orders/ingest` | HMAC (`x-hmac-signature` header) | Receives parsed email from PowerShell, enriches, stores |
| GET | `/api/mail-orders` | Session | Fetches orders by date (IST) + status filter |
| PATCH | `/api/mail-orders/[id]/punch` | Session | Marks order as punched |
| POST | `/api/mail-orders/lines/[lineId]/resolve` | Session | Resolves unmatched line + optional keyword save |
| GET | `/api/mail-orders/skus` | Session | Searches mo_sku_lookup for resolve dropdown |

**Middleware bypass:** `/api/mail-orders/ingest` bypasses session auth when `x-hmac-signature` header is present (same pattern as auto-import). HMAC verified inside route handler.

**Env var:** `MAIL_ORDER_HMAC_SECRET` — shared between Vercel and PowerShell config.txt.

### Enrichment Engine — lib/mail-orders/enrich.ts

Pure TypeScript module, no DB calls (data passed in as arguments).

**Functions:**
- `buildSkuMaps(skus)` → `{ byCombo: Map<"PROD|BASE|PACK", SkuEntry>, byMaterial: Map<material, SkuEntry> }`
- `findAllBases(text, baseKeywords)` → `string[]` (all matching base colours, deduped)
- `enrichLine(rawText, packCode, productKeywords, baseKeywords, skuByCombo, skuByMaterial)` → `EnrichResult`

**Algorithm (unchanged from v41 — try-and-verify):**
1. Direct material code lookup (`/^(IN)?\d{5,10}$/`)
2. Strip unit suffix from pack, default to "1" if empty
3. Find ALL matching product keywords (substring match, sorted by length DESC)
4. For each candidate × each base (from remaining text, then from product name, then empty) × each pack → check SKU map
5. First real SKU wins → matched
6. Candidates exist but no SKU → partial
7. No candidates → unmatched

### PowerShell v2 Script — Parse-MailOrders-v2.ps1

**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\`

**Config:** Reads from `config.txt` in same folder (no hardcoded values):
```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
```

**What it does:**
1. Connects to Outlook, reads from `surat.order@outlook.com` Inbox (secondary account, not default)
2. Filters FW: order emails (same classification as v1)
3. Parses product lines (identical regex engine from v1 — all 8+ format variations preserved)
4. POSTs raw parsed data to ingest API with HMAC signature
5. Logs results: green OK with match counts, red FAIL on errors
6. Dedup via `processed_ids_fw.json`

**Key differences from v1:**
- No enrichment functions (removed: Load-ProductKeywords, Load-BaseKeywords, Load-SkuLookup, Load-SkuByMaterial, Find-AllBases, Enrich-ProductLine)
- No CSV output (removed: Initialize-OutputCsv, Escape-CsvField, Append-OutputCsv)
- Added: config.txt reader, Compute-Hmac (BitConverter method for old PowerShell), Send-ToApi (Invoke-WebRequest -UseBasicParsing)
- 844 lines (down from 1,068)

**Supporting files in same folder:**
- `accepted_senders.txt` — sender filter (one email per line)
- `Remarks.xlsx` — ignore list for non-product lines (optional)
- `processed_ids_fw.json` — auto-created, dedup tracking
- `mail_order.log` — auto-created, script log

### Key Learnings from v42 Implementation
- **`[Convert]::ToHexString()` doesn't exist in older PowerShell** — use `[BitConverter]::ToString($hash).Replace("-","").ToLower()` instead. This caused silent HMAC failures (empty signature → 401 on every request).
- **`[System.Security.Cryptography.RandomNumberGenerator]::Fill()` doesn't exist** — use `[RNGCryptoServiceProvider]::new().GetBytes()` instead.
- **`Invoke-RestMethod` silently follows redirects** — if middleware returns 307 to login page, RestMethod follows and returns HTML without error. Use `Invoke-WebRequest -UseBasicParsing` instead and parse JSON manually.
- **Middleware bypass requires the header to be present** — the PowerShell script must send `x-hmac-signature` header for the middleware to skip session auth. Without it, requests get 307 → login page.
- **SkuLookup.csv had 153 duplicate material codes** — same SKU appeared with and without baseColour (dual SKU entries). Deduped to 1,051 unique materials, keeping the row with non-empty baseColour.
- **`mo_*` table prefix** chosen to avoid collision with existing `sku_master`, `product_name`, `base_colour` tables. The mail order keyword engine is a separate fuzzy matching system.
- **Outlook secondary account:** Script targets `surat.order@outlook.com` by matching `$store.DisplayName` in `$ns.Stores` loop. Not the default account.

### Mail Order Page (to be built — v43)

**Route:** `/mail-orders`
**Role:** New `sap_operator` or `billing_operator` role (TBD)

**Layout (CLAUDE_UI.md neutral theme):**
```
Row 1: Mail Orders · N orders · N lines · N unmatched    [🔍 Search]
Row 2: [All] [Pending] [Punched] status pills    [Today ▾] [Filter ▾]
```

**Order cards:** SO name, time, status badge, subject, delivery/body/bill remarks. Line items table: #, Raw Text, Product, Base, Pack, Qty, SKU status (✓ matched / ⚠ Fix). Match count. [📋 Copy to SAP] [✓ Punch] buttons.

**Copy to SAP format:** Material code + quantity, tab-separated, one line per matched product line. Operator pastes into SAP transaction.

**Resolve unmatched flow:** Click ⚠ Fix → inline panel → searchable SKU dropdown (`GET /api/mail-orders/skus?q=...`) → select SKU → optional "Save keyword" checkbox → resolves line + optionally creates keyword for future auto-matching.

**Status flow:** `pending` → `punched`. punchedById + punchedAt recorded.

---

## 55. Session Start Checklist (UPDATED v42)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v22** (added 6 `mo_*` tables)
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v3:** Load alongside this file for ALL UI work — defines neutral theme, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order backend:** 6 `mo_*` tables (Schema v22), 5 API endpoints, enrichment in `lib/mail-orders/enrich.ts`. Middleware bypasses session auth for `/api/mail-orders/ingest` when `x-hmac-signature` header present.
13. **Mail Order enrichment:** Try-and-verify engine — don't pick longest keyword, try all candidates and verify against SKU table.
14. **Mail Order PowerShell:** `Parse-MailOrders-v2.ps1` reads from `config.txt`, uses `Invoke-WebRequest -UseBasicParsing`, HMAC via `[BitConverter]::ToString()`.
15. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v22 · Context v42 · April 2026*
