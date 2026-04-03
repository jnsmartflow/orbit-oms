# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v43.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v22 · Context v43 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v43)

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

## 43. Queued Features (UPDATED v43)

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
- ~~**Mail Order frontend page**~~ — **DONE v43.** `/mail-orders` route, 9-column table, slot sections, date picker, copy/punch/flag/resolve, keyboard nav. Live on production.
- ~~**Mail Order role**~~ — **DONE v43.** `billing_operator` role (id 13). Deepanshu Thakur (id 25) + Bankim (id 26). Tint Manager also has access.
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
- **Mail Order — OD/CI persistence** — flag is currently local state only (lost on refresh). Add `isOdCi` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.
- **Mail Order — customer matching** — `mo_customer_keywords` table exists (667 rows) but not wired into ingest API. Wire customer name/code enrichment.
- **Mail Order — SAP operator role page** — consider adding read-only ops view or admin visibility into mail orders.

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

## 57. Mail Order Pipeline — FW: Email Parsing + SKU Enrichment (UPDATED v43 — April 4, 2026)

### Overview
System to parse FW: order emails from Sales Officers, enrich product lines with SAP material codes, and display enriched orders for the SAP operator to copy and punch.

**Replaces:** PAD flow + Mail_Order_Query.xlsx (Power Query) + Python script + Google Sheets.

### Current State (v43)
- **Full pipeline LIVE end-to-end.**
- **PowerShell v2 script** → HMAC API → server-side enrichment → DB → Mail Order page.
- **Production:** 87 orders, 319 product lines, 306 matched (95.9%).
- **Frontend:** 9-column table, slot sections, date picker, copy/punch/flag/resolve unmatched, keyboard nav.
- **Users:** Deepanshu Thakur + Bankim (billing_operator). Tint Manager also has sidebar access.

### Architecture
```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v2.ps1 (parses body, extracts product lines)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts (try-and-verify against DB keyword tables)
  → mo_orders + mo_order_lines (stored with match status)
  → /mail-orders page (operator views, copies SKU+Qty, punches in SAP)
```

### DB Tables (Schema v22 — 6 `mo_*` tables)

All tables use `mo_` prefix to avoid collision with existing SKU hierarchy tables. The mail order keyword engine is a separate fuzzy matching system — not connected to the normalized SAP catalog.

**Transactional:**
- **`mo_orders`** — one row per parsed email. Fields: id, soName, soEmail, receivedAt, subject, customerName, customerCode, deliveryRemarks, remarks, billRemarks, status (pending|punched), punchedById (FK→users), punchedAt, emailEntryId (UNIQUE), totalLines, matchedLines, createdAt.
- **`mo_order_lines`** — one row per product line. Fields: id, moOrderId (FK→mo_orders, CASCADE), lineNumber, rawText, packCode, quantity, productName, baseColour, skuCode, skuDescription, refSkuCode, matchStatus (matched|partial|unmatched), createdAt.

**Reference (seeded from CSV, maintained via UI):**
- **`mo_product_keywords`** — 705 rows. keyword (NOT unique), category, product. Sorted by keyword length DESC for matching.
- **`mo_base_keywords`** — 190 rows. keyword (NOT unique), category, baseColour.
- **`mo_sku_lookup`** — 1,051 rows. material (UNIQUE), description, category, product, baseColour, packCode, unit, refMaterial. Composite index on (product, baseColour, packCode).
- **`mo_customer_keywords`** — 667 rows. customerCode, customerName, area, deliveryType, route, keyword. Not yet wired into ingest API.

**Prisma models:** 6 models in schema.prisma with back-relation `mailOrdersPunched` on users model. No @map directives.

### API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mail-orders/ingest` | HMAC (`x-hmac-signature` header) | Receives parsed email from PowerShell, enriches, stores |
| GET | `/api/mail-orders` | Session | Fetches orders by date (IST) + status filter |
| PATCH | `/api/mail-orders/[id]/punch` | Session | Marks order as punched |
| POST | `/api/mail-orders/lines/[lineId]/resolve` | Session | Resolves unmatched line + optional keyword save |
| GET | `/api/mail-orders/skus` | Session | Searches mo_sku_lookup for resolve dropdown |

**Middleware bypass:** `/api/mail-orders/ingest` bypasses session auth when `x-hmac-signature` header is present. HMAC verified inside route handler.

**Env var:** `MAIL_ORDER_HMAC_SECRET` — shared between Vercel and PowerShell config.txt.

### Enrichment Engine — lib/mail-orders/enrich.ts

Pure TypeScript module, no DB calls (data passed in as arguments).

**Algorithm (try-and-verify):**
1. Direct material code lookup (`/^(IN)?\d{5,10}$/`)
2. Strip unit suffix from pack, default to "1" if empty
3. Find ALL matching product keywords (substring match, sorted by length DESC)
4. For each candidate × each base × each pack → check SKU map
5. First real SKU wins → matched. Candidates exist but no SKU → partial. No candidates → unmatched.

### PowerShell v2 Script — Parse-MailOrders-v2.ps1

**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\`

**Config:** Reads from `config.txt` (no hardcoded values):
```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
```

**Key learnings from v43:**
- **UTC→IST conversion:** `Sent:` header in forwarded emails is always UTC (Gmail + Power Automate both send UTC). Fix: `[DateTime]::Parse($OriginalSent, $null, [System.Globalization.DateTimeStyles]::AssumeUniversal)` then `ConvertTimeFromUtc` to IST. Do NOT use `.ToUniversalTime()` — it double-converts since PowerShell's `Get-Date` already treats parsed strings as local.
- **Outlook profile popup:** Set "Always use this profile" in Control Panel → Mail → Show Profiles to suppress the profile chooser dialog on Outlook launch.
- **Power Automate forwards:** FW: emails are auto-forwarded by a Power Automate workflow from `surat.depot@akzonobel.com` — not manual forwards. The `Date:` header of the FW: email itself is UTC+0000. The `Sent:` header inside the body (from original SO email) is also UTC.

**Supporting files:**
- `accepted_senders.txt` — sender filter
- `Remarks.xlsx` — ignore list for non-product lines
- `processed_ids_fw.json` — auto-created, dedup tracking
- `mail_order.log` — auto-created, script log

### Mail Order Frontend — /mail-orders (DONE v43)

**Route:** `/mail-orders`
**Role:** `billing_operator` (also accessible by `tint_manager`)

**Files:**
- `app/(mail-orders)/mail-orders/page.tsx` — bare wrapper, `export const dynamic = 'force-dynamic'`
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — main client component
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — 9-column table
- `app/(mail-orders)/mail-orders/resolve-line-panel.tsx` — inline unmatched line resolver
- `lib/mail-orders/types.ts` — TypeScript interfaces
- `lib/mail-orders/api.ts` — client-side fetch helpers
- `lib/mail-orders/utils.ts` — slot assignment, clipboard, grouping utilities

**Table columns (9):**
`Time (68px) | SO Name (120px) | Customer (260px) | Lines (64px) | Remarks (160px) | OD/CI (90px) | Copy (70px) | Status (110px) | Punched By (140px)`

**Row states:**
- Normal pending: white bg
- Focused (keyboard): amber left border `#f59e0b` + `bg-amber-50/40` wash
- OD/CI flagged: red left border `border-red-400` + OD/CI badge in customer cell
- Punched: teal left border `#0d9488` + `bg-teal-50/40` wash + `opacity-75`

**Slot sections:** Morning (before 10:30) / Afternoon (10:30–13:30) / Evening (13:30–16:30) / Night (after 16:30) — based on `receivedAt` IST time.

**Date picker:** Single-day ‹ [Today] › navigation in Row 2. Operator can view + punch any past date. No future dates.

**Copy format:** Tab-separated `skuCode\tquantity` per matched line, joined by `\n`. Operator pastes directly into SAP transaction.

**OD/CI flag:** Local state only (lost on refresh) — persistence deferred to future.

**Keyboard shortcuts:** C=copy, D=punch, ↓/↑=navigate, Enter=expand.

### Users (billing_operator)

| Name | Email | ID | Password |
|---|---|---|---|
| Deepanshu Thakur | deepanshu@orbitoms.in | 25 | Billing@123 |
| Bankim | bankim@orbitoms.in | 26 | Billing@123 |

Role: `billing_operator` (role_master id=13)
Permission: `role_permissions` row — roleSlug=billing_operator, pageKey=mail_orders, canView=true, canEdit=true

---

## 55. Session Start Checklist (UPDATED v43)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v22** (6 `mo_*` tables live, no changes in v43)
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v4:** Load alongside this file for ALL UI work — teal brand system, IosToggle, DateRangePicker
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 9-column table, date picker, resolve panel. Files in `app/(mail-orders)/mail-orders/` and `lib/mail-orders/`.
13. **Mail Order enrichment:** Try-and-verify engine — don't pick longest keyword, try all candidates and verify against SKU table.
14. **Mail Order PowerShell:** `Parse-MailOrders-v2.ps1` — `Sent:` header is UTC, use `AssumeUniversal` + `ConvertTimeFromUtc` for IST conversion.
15. **Mail Order OD/CI flag:** Local state only — not persisted to DB yet.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v22 · Context v43 · April 2026*
