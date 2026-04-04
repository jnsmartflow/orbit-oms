# CLAUDE_CONTEXT.md — Orbit OMS
# Load this file at the start of every Claude Code session.
# Command: claude "Read CLAUDE_CONTEXT_v45.md fully before doing anything else."
# Version: Phase 1 Go-Live · Schema v24 · Context v45 · April 2026

---

## 1-41. [Unchanged from v38]

(All sections 1 through 41 remain unchanged — refer to v38 for full content)

---

## 42. Known Issues / Pending Fixes (UPDATED v45)

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
13. **Mail Order — Lock persistence** — Lock flag (formerly OD/CI) is currently local state only (lost on refresh). Add `isLocked` boolean field to `mo_orders` table + PATCH API endpoint to persist flag.

---

## 43. Queued Features (UPDATED v45)

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
- ~~**Mail Order — customer matching**~~ — **DONE v45.** Customer code auto-matching from email subject via mo_customer_keywords. Code column on /mail-orders with copy, pick, search states. Keyboard shortcuts updated.
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
- **Mail Order — Lock persistence** — flag is currently local state only (lost on refresh). Need DB persistence.
- **Mail Order — SAP operator role page** — consider adding read-only ops view or admin visibility into mail orders.
- **Watch-OrderEmails-v2.ps1 retirement** — RE: email script no longer needed. Dispatch data now captured from FW: email by v3 script. Stop running Watch script on Windows PC.
- **Mail Order — backfill endpoint cleanup** — `app/api/mail-orders/backfill-customers/route.ts` is a temporary endpoint, delete after confirming customer matching works in production.

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

## 57. Mail Order Pipeline — FW: Email Parsing + SKU Enrichment + Dispatch + Customer Matching (UPDATED v45 — April 4, 2026)

### Overview
System to parse FW: order emails from Sales Officers, enrich product lines with SAP material codes, extract dispatch data (status, priority, overrides), auto-match customers from email subjects, display for SAP operator, and auto-enrich SAP-imported orders via soNumber linking.

**Replaces:** PAD flow + Mail_Order_Query.xlsx (Power Query) + Python script + Google Sheets + Watch-OrderEmails-v2.ps1 (RE: email pipeline).

### Current State (v45)
- **Full pipeline LIVE end-to-end including dispatch enrichment + customer matching.**
- **PowerShell v3 script** → HMAC API → server-side enrichment + customer matching → DB → Mail Order page → SAP import auto-enrichment.
- **Frontend:** 12-column table with customer code (copy/pick/search), delivery type dots, smart title case, dispatch badges, SO Number input (auto-punch), Lock column, urgent sort-to-top, sticky urgent/hold banner.
- **Users:** Deepanshu Thakur + Bankim (billing_operator). Tint Manager also has sidebar access.

### Architecture
```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v3.ps1 (parses body, extracts product lines + dispatch data)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts (try-and-verify against DB keyword tables)
  → customer-match.ts (extract customer from subject, match against mo_customer_keywords)
  → mo_orders + mo_order_lines (stored with match status + dispatch + customer fields)
  → /mail-orders page (operator views, copies Code+SKU, types SO Number)
  → SO Number saved → auto-punches order

SAP Import (Auto-Import.ps1) creates orders with soNumber:
  → applyMailOrderEnrichment() checks mo_orders for matching soNumber
  → If found: applies dispatchStatus, priorityLevel, remarks, shipToOverride, slotToOverride to orders table
  → One soNumber can map to multiple OBDs (1:N) — enrichment uses updateMany
```

### DB Schema Changes (v45 — Schema v24)

**New columns on `mo_orders` table (v45):**
- `customerMatchStatus` TEXT DEFAULT 'unmatched' — values: exact, multiple, unmatched
- `customerCandidates` TEXT — JSON array of {code,name,area,deliveryType,route} when status=multiple. Cleared on manual pick.

**Existing columns now populated by customer matching:**
- `customerCode` TEXT — auto-filled on exact match, or manually selected by operator
- `customerName` TEXT — auto-filled on exact match, or manually selected by operator

**Columns from v44 (unchanged):**
- `soNumber`, `dispatchStatus`, `dispatchPriority`, `shipToOverride`, `slotToOverride` on mo_orders
- `soNumber`, `remarks`, `shipToOverride`, `slotToOverride` on orders

### DB Tables (Schema v24 — 6 `mo_*` tables)

All tables use `mo_` prefix. The mail order keyword engine is a separate fuzzy matching system.

**Transactional:**
- **`mo_orders`** — one row per parsed email. Fields: id, soName, soEmail, receivedAt, subject, customerName, customerCode, customerMatchStatus, customerCandidates, deliveryRemarks, remarks, billRemarks, status (pending|punched), punchedById (FK→users), punchedAt, emailEntryId (UNIQUE), totalLines, matchedLines, soNumber, dispatchStatus, dispatchPriority, shipToOverride, slotToOverride, createdAt.
- **`mo_order_lines`** — one row per product line. Fields: id, moOrderId (FK→mo_orders, CASCADE), lineNumber, rawText, packCode, quantity, productName, baseColour, skuCode, skuDescription, refSkuCode, matchStatus (matched|partial|unmatched), createdAt.

**Reference (seeded from CSV, maintained via UI):**
- **`mo_product_keywords`** — 705 rows. keyword (NOT unique), category, product.
- **`mo_base_keywords`** — 190 rows. keyword (NOT unique), category, baseColour.
- **`mo_sku_lookup`** — 1,051 rows. material (UNIQUE), description, category, product, baseColour, packCode, unit, refMaterial.
- **`mo_customer_keywords`** — 667+ rows. customerCode, customerName, area, deliveryType, route, keyword. **Wired into ingest API (v45).** New keywords auto-saved when operator manually picks unmatched customers.

### Customer Matching System (NEW v45)

**Files:**
- `lib/mail-orders/customer-match.ts` — extractCustomerFromSubject() + matchCustomer()

**extractCustomerFromSubject(subject):**
1. Strips FW:/Fwd:/RE:/Re: prefixes (case-insensitive, nested)
2. Strips Order prefix patterns: "Order :", "Order:", "Order for ", "Order-NNNNN "
3. Strips trailing noise: periods, " -order", "-order"
4. Returns cleaned customer name string

**matchCustomer(extractedName):**
1. **Code prefix detection:** If extracted name starts with 4+ digits, tries exact customerCode lookup first. If found → immediate exact return. If not → falls through to keyword matching using the name part after the code.
2. **Keyword/name matching:** Queries all mo_customer_keywords rows. Checks substring match (case-insensitive) against both keyword and customerName fields. Scores matches: exact equality (100/90) > substring containment (length-based). Sorts by score DESC.
3. **Deduplication:** Collapses multiple keyword rows for same customerCode into one candidate.
4. **Result:** 1 unique code → exact. 2+ codes → multiple (top 10 candidates as JSON). 0 → unmatched.
5. **Decisive winner:** If top-scored candidate has score ≥ 90 and second-best < 50, treats as exact even with 2+ codes.
6. **Try/catch safety:** Any error returns unmatched fallback, never breaks ingest.

**Coverage on first backfill (87 orders):** 62 exact (71%), 9 multiple (10%), 16 unmatched (18%), 0 errors.

### API Endpoints (UPDATED v45)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mail-orders/ingest` | HMAC | Receives parsed email from PowerShell, enriches SKUs, matches customer, stores. |
| GET | `/api/mail-orders` | Session | Fetches orders by date (IST) + status filter. Batch lookup for area/deliveryType/route on exact-matched orders. Returns customerArea, customerDeliveryType, customerRoute. |
| PATCH | `/api/mail-orders/[id]/punch` | Session | Marks order as punched. (Legacy, kept for compat.) |
| PATCH | `/api/mail-orders/[id]/so-number` | Session | Saves soNumber, auto-sets status=punched. |
| PATCH | `/api/mail-orders/[id]/customer` | Session | **NEW v45.** Saves manual customer selection (customerCode, customerName). Sets customerMatchStatus=exact, clears candidates. Optional: saveKeyword=true creates new mo_customer_keywords row for future auto-matching. |
| GET | `/api/mail-orders/customers/search` | Session | **NEW v45.** Searches mo_customer_keywords by keyword/customerName/customerCode. Returns max 20 unique customers with area/deliveryType/route. |
| POST | `/api/mail-orders/lines/[lineId]/resolve` | Session | Resolves unmatched line + optional keyword save. |
| GET | `/api/mail-orders/skus` | Session | Searches mo_sku_lookup for resolve dropdown. |
| POST | `/api/mail-orders/backfill-customers` | Session | **TEMPORARY v45.** One-time backfill — runs customer matching on all existing unmatched orders. Delete after confirming production works. |

### Mail Order Frontend — /mail-orders (UPDATED v45)

**Route:** `/mail-orders`
**Role:** `billing_operator` (also accessible by `tint_manager`)

**Files:**
- `app/(mail-orders)/mail-orders/page.tsx` — bare wrapper
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — main client component
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — 12-column table with CodeCell component
- `app/(mail-orders)/mail-orders/resolve-line-panel.tsx` — inline unmatched line resolver
- `lib/mail-orders/types.ts` — TypeScript interfaces (includes customer match + dispatch + soNumber fields)
- `lib/mail-orders/api.ts` — client-side fetch helpers (includes searchCustomers, saveCustomer, saveSoNumber)
- `lib/mail-orders/utils.ts` — slot assignment, clipboard, grouping, dispatch sort weight, smartTitleCase
- `lib/mail-orders/customer-match.ts` — server-side customer matching engine

**Table columns (12):**
`Time(68) | SO Name(120) | Customer(220) | Lines(54) | Dispatch(80) | Remarks(140) | Code(90) | SKU(60) | SO No.(110) | Lock(70) | Status(100) | Punched By(120)`

**Customer column (UPDATED v45):**
- Line 1: [delivery type dot 5px] Customer Name (smart title case, bold)
- Line 2: {subjectCode font-mono} · {Area title case} · {Route title case}
- Shows matched customerName for exact matches, cleaned subject for others
- Delivery type dot colors: blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross)
- Dot appears immediately after manual customer pick too
- SO Name column: strips "(JSW)" prefix, applies smart title case

**Code column (NEW v45):**
Three states based on customerMatchStatus:
- **Exact:** Monospace code badge (text-gray-800 bg-gray-50 border-gray-200). Click copies to clipboard with teal flash (bg-teal-50 border-teal-200, 1.5s). Pencil icon on hover → opens search popover for re-pick.
- **Multiple:** Amber "N found" badge. Click opens candidate picker popover (280px, max 10 candidates with code/name/area/route). Pick saves via PATCH, updates to exact state.
- **Unmatched:** "Search" link. Click opens search popover (320px, debounced typeahead 300ms, min 2 chars). Pick saves via PATCH + auto-saves keyword (if query ≥3 chars, non-numeric).
- Only one popover open at a time across all rows.

**SKU column (RENAMED v45):**
Formerly "Copy". Same behavior — copies SKU lines to clipboard.

**Lock column (RENAMED v45):**
Formerly "OD/CI". Uses lucide-react Lock/LockOpen icons:
- Unlocked: LockOpen 14px text-gray-300, hover:text-gray-400
- Locked: Lock 14px text-red-500 bg-red-50 rounded p-1
- Click toggles state. Currently local state only (not persisted).

**Dispatch column (unchanged from v44):**
Single combined badge per row.

**SO Number column (unchanged from v44):**
Inline input, 10-digit validation, auto-punch on save.

**Row states (UPDATED v45):**
- Normal pending: white bg
- Focused (keyboard): amber left border + bg-amber-50/40 wash
- Locked: red left border + Lock icon (red)
- Punched (via SO Number): teal left border + bg-teal-50/40 wash + opacity-75

**Keyboard shortcuts (UPDATED v45):**
| Key | Action |
|---|---|
| ↑/↓ | Navigate rows |
| Enter | Expand order lines |
| C | Copy customer code to clipboard (teal flash) |
| S | Copy SKU lines to clipboard |
| P | Open Code column popover (pick/search/re-pick) |
| Esc | Close any open popover |

**Smart Title Case (NEW v45):**
All text fields displayed with smartTitleCase() from lib/mail-orders/utils.ts:
- Customer name, SO name, remarks, candidate names in popovers
- Preserves abbreviations: CO., LLP, PVT, LTD, H/W, JSW
- Lowercases: and, of, the, for, in, at, to, by
- NOT applied to: area (title cased separately), customer codes, subject codes

### Users (billing_operator)

| Name | Email | ID | Password |
|---|---|---|---|
| Deepanshu Thakur | deepanshu@orbitoms.in | 25 | Billing@123 |
| Bankim | bankim@orbitoms.in | 26 | Billing@123 |

Role: `billing_operator` (role_master id=13)
Permission: `role_permissions` row — roleSlug=billing_operator, pageKey=mail_orders, canView=true, canEdit=true

---

## 55. Session Start Checklist (UPDATED v45)

Before generating any code, confirm:
1. You have read this file fully
2. Schema is **v24** (v23 + mo_orders: customerMatchStatus, customerCandidates added)
3. **TM redesign (v39):** Neutral palette, 2-row header, slot strip, filter dropdown, 10-column table, order detail panel
4. **CLAUDE_UI.md v4.2:** Load alongside this file for ALL UI work — teal brand system, IosToggle, DateRangePicker, smartTitleCase, Lock icons
5. **Planning is ORDER level** (v28 correction still applies)
6. **Tint Manager uses OrderDetailPanel** not SkuDetailsSheet (v39)
7. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase() before matching.
8. **Filter state:** slotFilter is `"all" | number`, delTypeFilter is `Set<string>`, dispatchFilter removed
9. **Shade Master:** 2-row header, IosToggle, column sequence `# · Name · CustID · Type · SKU · Pack · Status · Active · By · At`
10. **TI Report:** DateRangePicker, no Summary tab, inline shade expand, Base and Pack separate columns
11. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
12. **Mail Order frontend:** LIVE. 12-column table, customer code matching (copy/pick/search), delivery type dots, smart title case, dispatch badges, SO Number auto-punch, Lock column, urgent banner. Files in `app/(mail-orders)/mail-orders/` and `lib/mail-orders/`.
13. **Mail Order enrichment:** Try-and-verify engine — don't pick longest keyword, try all candidates and verify against SKU table.
14. **Mail Order PowerShell:** `Parse-MailOrders-v3.ps1` — extracts product lines + dispatch data. Config includes ShipToKeywordsFile and SlotToKeywordsFile.
15. **Mail Order Lock flag:** Local state only — not persisted to DB yet. Uses Lock/LockOpen icons from lucide-react.
16. **billing_operator role:** id=13, pageKey=mail_orders. Users: Deepanshu (id 25), Bankim (id 26). Password: Billing@123.
17. **SAP import enrichment:** `applyMailOrderEnrichment()` in import route auto-applies dispatch data from mo_orders to orders when soNumber matches. Uses updateMany (1 SO → N OBDs).
18. **soNumber on orders:** Mapped from SAP XLS "SONum" column in both manual and auto-import. Indexed.
19. **Watch-OrderEmails-v2.ps1:** DEPRECATED. RE: email pipeline replaced by FW: email dispatch extraction in v3 script.
20. **Mail Order customer matching:** LIVE (v45). customer-match.ts extracts name from subject, matches against mo_customer_keywords (code prefix → keyword/name substring). Three states: exact/multiple/unmatched. Manual picks auto-save keywords.
21. **Mail Order keyboard shortcuts:** C=copy code, S=copy SKU, P=open picker, Esc=close popover, ↑↓=navigate, Enter=expand. D key removed.
22. **Smart title case:** smartTitleCase() in lib/mail-orders/utils.ts. Applied to customer name, SO name, remarks, area, route. Preserves abbreviations (CO., LLP, PVT). NOT applied to codes.
23. **Backfill endpoint:** `/api/mail-orders/backfill-customers` — temporary, delete after production verification.
24. All existing checklist items from v38 #36 still apply

---

*Version: Phase 1 Go-Live · Schema v24 · Context v45 · April 2026*
