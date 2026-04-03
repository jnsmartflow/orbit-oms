# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v44.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v23 · Context v44 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v44)

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

## 43. Queued Features (UPDATED v44)

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
- ~~**Mail Order backend (DB + APIs + enrichment engine)**~~ — **DONE v42.**
- ~~**Mail Order frontend page**~~ — **DONE v43.**
- ~~**Mail Order role**~~ — **DONE v43.**
- ~~**soNumber import mapping**~~ — **DONE v44.** SAP SONum → orders.soNumber. Mapped in both manual and auto-import paths.
- ~~**Dispatch enrichment from FW: email**~~ — **DONE v44.** PS v3 extracts dispatch data → mo_orders. SAP import auto-applies via enrichment hook. SO Number UI field on /mail-orders auto-punches.
- **Cascade badge** — When `originalSlotId !== slotId`, show `⏩ from {originalSlot.name}` badge on order rows. Data already in API response (v39). Purely UI work — detail panel only for TM.
- **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need same neutral palette as TM v39. Use CLAUDE_UI.md as style guide.
- **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click)
- **Audit history in detail panel** — order_status_logs exists, not yet fetched/rendered
- **CustomerMissingSheet styling** — not matching admin customer form
- **Smart slot assignment** — orders arriving at/after slot cutoff auto-escalate
- **Visual "carried over" indicator for overdue orders in slot tabs**
- **MIS Override Layer** — Admin-only field-level overrides per OBD
- **Barcode/QR label generation** — post-TI submission
- **Customer data enrichment** — remaining area batches
- **Operations password change** — operations@orbitoms.com temp password 'operations123' must be changed in prod
- **Mail Order — OD/CI persistence** — flag is currently local state only (lost on refresh). Add `isOdCi` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
- **Mail Order — customer matching** — `mo_customer_keywords` table exists (667 rows) but not wired into ingest API. Wire customer name/code enrichment into ingest flow. Also: operator needs customer code visible on /mail-orders to copy alongside SKUs for SAP punching.
- **Mail Order — SAP operator role page** — consider adding read-only ops view or admin visibility into mail orders.
- **Watch-OrderEmails-v2.ps1 retirement** — RE: email script no longer needed. Dispatch data now captured from FW: email by v3 script. Stop running Watch script on Windows PC.

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

## 56. Email Monitor Pipeline — RE: Emails (DEPRECATED v44)

**DEPRECATED.** The RE: email pipeline (Watch-OrderEmails-v2.ps1 → order_database.xlsx) is no longer needed. All dispatch data is now captured from the FW: email by Parse-MailOrders-v3.ps1. The SO Number (previously only available via RE: email) is now entered manually by the billing operator on the /mail-orders page after SAP punching.

Refer to v41 for historical reference only.

---

## 57. Mail Order Pipeline — FW: Email Parsing + SKU Enrichment + Dispatch (UPDATED v44 — April 4, 2026)

### Overview
System to parse FW: order emails from Sales Officers, enrich product lines with SAP material codes, extract dispatch data (status, priority, overrides), display for SAP operator, and auto-enrich SAP-imported orders via soNumber linking.

**Replaces:** PAD flow + Mail_Order_Query.xlsx (Power Query) + Python script + Google Sheets + Watch-OrderEmails-v2.ps1 (RE: email pipeline).

### Current State (v44)
- **Full pipeline LIVE end-to-end including dispatch enrichment.**
- **PowerShell v3 script** → HMAC API → server-side enrichment → DB → Mail Order page → SAP import auto-enrichment.
- **Frontend:** 11-column table with dispatch badges, SO Number input (auto-punch), urgent sort-to-top, sticky urgent/hold banner.
- **Users:** Deepanshu Thakur + Bankim (billing_operator). Tint Manager also has sidebar access.

### Architecture
```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v3.ps1 (parses body, extracts product lines + dispatch data)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts (try-and-verify against DB keyword tables)
  → mo_orders + mo_order_lines (stored with match status + dispatch fields)
  → /mail-orders page (operator views, copies SKU+Qty, types SO Number)
  → SO Number saved → auto-punches order

SAP Import (Auto-Import.ps1) creates orders with soNumber:
  → applyMailOrderEnrichment() checks mo_orders for matching soNumber
  → If found: applies dispatchStatus, priorityLevel, remarks, shipToOverride, slotToOverride to orders table
  → One soNumber can map to multiple OBDs (1:N) — enrichment uses updateMany
```

### DB Schema Changes (v44 — Schema v23)

**New columns on `orders` table:**
- `soNumber` TEXT — SAP SO Number, mapped from SAP XLS "SONum" column. Indexed.
- `remarks` TEXT — dispatch remarks from mail order
- `shipToOverride` BOOLEAN DEFAULT FALSE — ship-to override flag
- `slotToOverride` BOOLEAN DEFAULT FALSE — slot-to override flag
- (dispatchStatus and priorityLevel already existed)

**New columns on `mo_orders` table:**
- `soNumber` TEXT — entered by billing operator after SAP punch
- `dispatchStatus` TEXT DEFAULT 'Dispatch' — derived from email keywords (Dispatch|Hold)
- `dispatchPriority` TEXT DEFAULT 'Normal' — derived from email keywords (Normal|Urgent)
- `shipToOverride` BOOLEAN DEFAULT FALSE — from shipto_keywords.txt matching
- `slotToOverride` BOOLEAN DEFAULT FALSE — from slotto_keywords.txt matching

### DB Tables (Schema v23 — 6 `mo_*` tables)

All tables use `mo_` prefix. The mail order keyword engine is a separate fuzzy matching system.

**Transactional:**
- **`mo_orders`** — one row per parsed email. Fields: id, soName, soEmail, receivedAt, subject, customerName, customerCode, deliveryRemarks, remarks, billRemarks, status (pending|punched), punchedById (FK→users), punchedAt, emailEntryId (UNIQUE), totalLines, matchedLines, soNumber, dispatchStatus, dispatchPriority, shipToOverride, slotToOverride, createdAt.
- **`mo_order_lines`** — one row per product line. Fields: id, moOrderId (FK→mo_orders, CASCADE), lineNumber, rawText, packCode, quantity, productName, baseColour, skuCode, skuDescription, refSkuCode, matchStatus (matched|partial|unmatched), createdAt.

**Reference (seeded from CSV, maintained via UI):**
- **`mo_product_keywords`** — 705 rows. keyword (NOT unique), category, product.
- **`mo_base_keywords`** — 190 rows. keyword (NOT unique), category, baseColour.
- **`mo_sku_lookup`** — 1,051 rows. material (UNIQUE), description, category, product, baseColour, packCode, unit, refMaterial.
- **`mo_customer_keywords`** — 667 rows. customerCode, customerName, area, deliveryType, route, keyword. Not yet wired into ingest API.

### API Endpoints (UPDATED v44)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mail-orders/ingest` | HMAC | Receives parsed email from PowerShell, enriches, stores. Now accepts dispatchStatus, dispatchPriority, shipToOverride, slotToOverride. |
| GET | `/api/mail-orders` | Session | Fetches orders by date (IST) + status filter. Returns all fields including dispatch and soNumber. |
| PATCH | `/api/mail-orders/[id]/punch` | Session | Marks order as punched. (Kept for backward compat, but UI no longer calls it — SO Number auto-punches.) |
| PATCH | `/api/mail-orders/[id]/so-number` | Session | **NEW v44.** Saves soNumber (validates 10-digit format), auto-sets status=punched + punchedAt + punchedById. |
| POST | `/api/mail-orders/lines/[lineId]/resolve` | Session | Resolves unmatched line + optional keyword save. |
| GET | `/api/mail-orders/skus` | Session | Searches mo_sku_lookup for resolve dropdown. |

### SAP Import Enrichment Hook (NEW v44)

**Function:** `applyMailOrderEnrichment(soNumber)` in `app/api/import/obd/route.ts`

**Logic:**
1. Collects unique non-null soNumbers from the import batch
2. For each, finds the latest `mo_orders` row with matching soNumber
3. Applies to orders table via `updateMany` (1 SO → multiple OBDs):
   - `dispatchStatus` → lowercase (Dispatch→dispatch, Hold→hold)
   - `priorityLevel` → integer (Urgent→1, Normal→3)
   - `remarks` → combined: deliveryRemarks | remarks | billRemarks
   - `shipToOverride` → boolean
   - `slotToOverride` → boolean
4. Logs each match, silently skips non-matches
5. Called after order createMany in BOTH manual and auto-import paths

### Dispatch Data Extraction (NEW v44)

Dispatch data is extracted from the FW: email body by Parse-MailOrders-v3.ps1 using keyword matching — the same logic previously used by Watch-OrderEmails-v2.ps1 on RE: emails.

**Dispatch Status derivation:**
- Email body/subject contains "hold", "call to so", "call to dealer" → **Hold**
- Everything else → **Dispatch**

**Priority derivation:**
- Email body/subject contains "urgent" → **Urgent**
- Everything else → **Normal**

**Override derivation:**
- Ship To: matches keywords from `shipto_keywords.txt` → true
- Slot To: matches keywords from `slotto_keywords.txt` → true

### PowerShell v3 Script — Parse-MailOrders-v3.ps1 (UPDATED v44)

**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\`
**Version:** 3.0.0

**Changes from v2:**
- Added `Load-Keywords` + `Check-KeywordMatch` functions (ported from Watch-OrderEmails-v2)
- Added `Get-DispatchStatus` + `Get-DispatchPriority` functions
- Loads `shipto_keywords.txt` and `slotto_keywords.txt` at startup
- Derives dispatch data after Parse-EmailBody in main loop
- Sends 4 new fields in API payload: dispatchStatus, dispatchPriority, shipToOverride, slotToOverride
- Console shows [HOLD] or [URGENT] tags on processed emails

**Config:** Reads from `config.txt`:
```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
ShipToKeywordsFile=C:\Users\HP\OneDrive\VS Code\mail-orders\shipto_keywords.txt
SlotToKeywordsFile=C:\Users\HP\OneDrive\VS Code\mail-orders\slotto_keywords.txt
```

**Supporting files:**
- `accepted_senders.txt` — sender filter
- `Remarks.xlsx` — ignore list for non-product lines
- `shipto_keywords.txt` — ship-to override keywords (copied from Watch script folder)
- `slotto_keywords.txt` — slot-to override keywords (copied from Watch script folder)
- `processed_ids_fw.json` — auto-created, dedup tracking
- `mail_order.log` — auto-created, script log

**Key learnings from v43 still apply:**
- UTC→IST: `AssumeUniversal` + `ConvertTimeFromUtc`
- Outlook profile: "Always use this profile"
- Power Automate: Sent: header is UTC

### Mail Order Frontend — /mail-orders (UPDATED v44)

**Route:** `/mail-orders`
**Role:** `billing_operator` (also accessible by `tint_manager`)

**Files:**
- `app/(mail-orders)/mail-orders/page.tsx` — bare wrapper
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — main client component
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — 11-column table
- `app/(mail-orders)/mail-orders/resolve-line-panel.tsx` — inline unmatched line resolver
- `lib/mail-orders/types.ts` — TypeScript interfaces (includes dispatch + soNumber fields)
- `lib/mail-orders/api.ts` — client-side fetch helpers (includes saveSoNumber)
- `lib/mail-orders/utils.ts` — slot assignment, clipboard, grouping, dispatch sort weight

**Table columns (11):**
`Time(68) | SO Name(120) | Customer(220) | Lines(54) | Dispatch(80) | Remarks(140) | Copy(60) | SO No.(110) | OD/CI(70) | Status(100) | Punched By(120)`

**Dispatch column (NEW v44):**
Single combined badge per row:
- Hold + Urgent → red badge "Hold · Urgent"
- Hold + Normal → red badge "Hold"
- Dispatch + Urgent → amber badge "Urgent"
- Dispatch + Normal → green badge "Dispatch"
- null/null → green badge "Dispatch" (default)

**SO Number column (NEW v44):**
- Empty: inline input field (font-mono, 10-digit validation)
- On Enter/blur with valid 10 digits: saves via PATCH, auto-marks as "punched"
- Saved: monospace display with pencil edit icon on hover

**Urgent/Hold sort (NEW v44):**
Within each slot section, orders sorted by dispatch priority:
Hold+Urgent (0) > Urgent (1) > Hold (2) > Normal (3). Stable sort preserves time order within same weight.

**Sticky urgent banner (NEW v44):**
Red banner at top of content area when unpunched urgent/hold orders exist. Shows counts ("2 Urgent · 1 Hold") with "Jump to first ↓" button. Respects slot filter. Disappears when all urgent/hold orders are punched.

**Row states:**
- Normal pending: white bg
- Focused (keyboard): amber left border + bg-amber-50/40 wash
- OD/CI flagged: red left border + OD/CI badge
- Punched (via SO Number): teal left border + bg-teal-50/40 wash + opacity-75

**Status column (UPDATED v44):**
- Punched: ✓ Done badge (green)
- Pending: dash "—" (no Punch button — SO Number entry auto-punches)

**Keyboard shortcuts:** C=copy, D=punch (legacy), ↓/↑=navigate, Enter=expand.

### Users (billing_operator)

| Name | Email | ID | Password |
|---|---|---|---|
| Deepanshu Thakur | deepanshu@orbitoms.in | 25 | Billing@123 |
| Bankim | bankim@orbitoms.in | 26 | Billing@123 |

Role: `billing_operator` (role_master id=13)
Permission: `role_permissions` row — roleSlug=billing_operator, pageKey=mail_orders, canView=true, canEdit=true

---

## 55. Session Start Checklist (UPDATED v44)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v23** (orders: soNumber, remarks, shipToOverride, slotToOverride added. mo_orders: soNumber, dispatchStatus, dispatchPriority, shipToOverride, slotToOverride added.)
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v4:** Load alongside this file for ALL UI work — teal brand system, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 11-column table, dispatch badges, SO Number auto-punch, urgent banner. Files in `app/(mail-orders)/mail-orders/` and `lib/mail-orders/`.
13. **Mail Order enrichment:** Try-and-verify engine — don't pick longest keyword, try all candidates and verify against SKU table.
14. **Mail Order PowerShell:** `Parse-MailOrders-v3.ps1` — extracts product lines + dispatch data. Config includes ShipToKeywordsFile and SlotToKeywordsFile.
15. **Mail Order OD/CI flag:** Local state only — not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` in import route auto-applies dispatch data from mo_orders to orders when soNumber matches. Uses updateMany (1 SO → N OBDs).
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Watch-OrderEmails-v2.ps1:** DEPRECATED. RE: email pipeline replaced by FW: email dispatch extraction in v3 script.
20. **Mail Order customer matching:** mo_customer_keywords (667 rows) exists but NOT wired into ingest. Next priority.
21. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v23 · Context v44 · April 2026*
