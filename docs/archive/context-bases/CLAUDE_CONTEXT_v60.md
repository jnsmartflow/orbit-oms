# CLAUDE_CONTEXT_v60.md — Orbit OMS
# Consolidated from v38 + all context updates through v58
# Schema: v26.3
# April 2026

---

## 1. PROJECT OVERVIEW

Orbit OMS is a depot-level order management system for a paint distribution company operating out of Surat, India (Akzo Nobel / JSW Dulux products). It manages two parallel workflows:

**OBD Pipeline:** XLS import from SAP → tinting → support review → dispatch planning → warehouse picking → vehicle dispatch.

**Mail Order Pipeline:** FW: email parsing → SKU enrichment → operator punching in SAP → SO number capture → dispatch data auto-enrichment back to OBD pipeline.

This is an internal business tool — not public-facing. Users are depot staff with role-based access. Scale: ~25-35 dispatch plans per day, ~100-200 OBDs per day, ~150+ mail orders per day, single depot.

**Live URL:** https://orbitoms.in (SSL, www redirect)

---

## 2. TECH STACK — LOCKED, DO NOT DEVIATE

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + shadcn/ui |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js v5 |
| Deployment | Vercel + GitHub |
| Package manager | npm |
| XLS parsing | `xlsx` npm package |

**Never introduce a new library without being explicitly asked.**

---

## 3. DATABASE SCHEMA — COMPLETE (Schema v26.3)

Schema evolution: v21 (base) → v22 (6 mo_* tables) → v23 (orders dispatch columns) → v24 (customer match columns) → v25 (split columns) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton columns + piecesPerCarton)

### Group 1: Setup / Master Tables (23 tables)

```
status_master              — UNIFIED status table. Domains: dispatch | tinting | pick_list | import | workflow | priority
system_config              — Key-value store. Keys: day_boundary_time ('00:00'), last_cleanup_date,
                             history_days_visible ('30'), slot_cascade_grace_minutes ('15'), last_cascade_check
role_master                — Roles: admin, dispatcher, support, tint_manager, tint_operator,
                             floor_supervisor, picker, operations (id=12), billing_operator (id=13)

product_category           — Emulsion, Primer, Tinter, Enamel, Texture, Putty
product_name               — WS, Aquatech, Weathercoat... FK → product_category
base_colour                — White Base, Deep Base, Clear, N/A...
sku_master                 — Each row = one SKU code + colour combo.
                             FKs: productCategoryId, productNameId, baseColourId
                             NOTE: grossWeightPerUnit does NOT exist

transporter_master         — Transporter companies
vehicle_master             — capacityKg, vehicleType, isActive, driverName, driverPhone

delivery_type_master       — Local | Upcountry | IGT | Cross
slot_master                — Morning (10:30), Afternoon (12:30), Evening (15:30),
                             Night (18:00), Next Day Morning (10:30 next day)
                             sortOrder INT, isNextDay BOOLEAN
delivery_type_slot_config  — Per-delivery-type slot rules
route_master               — Named routes: Varachha, Bharuch, Adajan, Surat City...
area_master                — Areas. delivery_type AND primaryRoute live here.
area_route_map             — Many-to-many area ↔ route
sub_area_master            — Sub-areas for stop clustering

sales_officer_master       — Sales officers
sales_officer_group        — Named customer portfolios

contact_role_master        — Owner | Contractor | Manager | Site Engineer
delivery_point_master      — Ship-to customers. primaryRouteId, deliveryTypeOverride,
                             salesOfficerGroupId, customerRating (A/B/C)
delivery_point_contacts    — Contacts with contactRoleId FK

users                      — Depot staff. id, email, password (bcryptjs 10 rounds),
                             name, roleId (FK → role_master.id), isActive
```

### Group 2: Import Tables (5 tables)

```
import_batches             — One row per import session
import_raw_summary         — One row per OBD from header XLS. 18 mapped columns +
                             smuNumber (v14), soNumber (v35)
                             obdEmailDate + obdEmailTime stored here
import_raw_line_items      — One row per line item. lineId = row index (not source line_id).
                             batchCode always NULL.
import_enriched_line_items — Lines enriched with sku_master join
import_obd_query_summary   — Per-OBD totals: weight, qty, volume, hasTinting, totalArticle

VOLUME: All values in LITRES (L). Never display as m³.
```

### Group 3: Orders + Tinting + Support (9 tables)

```
orders                     — Parent container. One per OBD post-import.
                             workflowStage tracks overall status.
                             Fields added over time:
                               slotId (FK → slot_master), originalSlotId (set once, never changed)
                               smu TEXT, customerMissing BOOLEAN
                               isPicked, pickedAt, pickedById
                               soNumber TEXT (indexed, from SAP XLS "SONum")
                               remarks TEXT, shipToOverride BOOLEAN, slotToOverride BOOLEAN
order_splits               — One row per tint batch/split. dispatchStatus drives planning board.
                             isPicked, pickedAt, pickedById for warehouse picking.
split_line_items           — One row per line assigned to a split
split_status_logs          — INSERT-ONLY audit trail per split
tint_assignments           — One row per whole-OBD assignment (non-split flow)
tint_logs                  — INSERT-ONLY. orderId + optional splitId.
order_status_logs          — INSERT-ONLY. changeType values: 'slot_cascade', 'day_boundary_slot_reset'
tinter_issue_entries       — INSERT-ONLY. One row per base batch TI entry.
```

### Group 4: Dispatch + Warehouse (7 tables)

```
dispatch_plans             — One plan = one vehicle + one slot + one trip.
                             Unique: (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       — Orders in a plan. ORDER-LEVEL (not split-level).
                             clearedAt TIMESTAMPTZ for day boundary soft delete.
                             IMPORTANT: Live DB has dispatch_plan_orders, NOT dispatch_plan_splits.
pick_assignments           — Picker assignments. orderId FK (unique per active).
                             clearedAt TIMESTAMPTZ for day boundary.
                             Assignment at ORDER level.
pick_lists                 — One pick list per plan
pick_list_items            — Line items to pick
dispatch_change_queue      — Notifications when support holds/cancels order in a plan

NOTE: dispatch_plan_vehicles was DROPPED (redundant).
```

### Group 5: Delivery Challan (2 tables)

```
delivery_challans          — One per order. Auto-created on first challan open.
delivery_challan_formulas  — Per-line tinting formula
```

### Group 6: Mail Orders (9 tables — mo_* prefix)

All use `mo_` prefix. Separate fuzzy matching system — not connected to normalized SAP catalog.

**Transactional:**
```
mo_orders                  — One per parsed email.
                             id, soName, soEmail, receivedAt, subject,
                             customerName, customerCode, customerMatchStatus (exact|multiple|unmatched),
                             customerCandidates (JSON), deliveryRemarks, remarks, billRemarks,
                             status (pending|punched), punchedById (FK→users), punchedAt,
                             emailEntryId (UNIQUE), totalLines, matchedLines,
                             soNumber, dispatchStatus (Dispatch|Hold), dispatchPriority (Normal|Urgent),
                             shipToOverride BOOLEAN, slotToOverride BOOLEAN,
                             isLocked BOOLEAN DEFAULT false,
                             splitFromId INT, splitLabel TEXT,
                             createdAt

mo_order_lines             — One per product line.
                             id, moOrderId (FK CASCADE), lineNumber,
                             rawText, packCode, quantity, productName, baseColour,
                             skuCode, skuDescription, refSkuCode,
                             matchStatus (matched|partial|unmatched),
                             originalLineNumber INT,
                             isCarton BOOLEAN DEFAULT FALSE,
                             cartonCount INTEGER,
                             createdAt

mo_order_remarks           — Remark lines from parser (v26).
                             id, moOrderId (FK CASCADE), lineNumber, rawText,
                             remarkType (billing|delivery|contact|instruction|cross|customer|area|unknown),
                             detectedBy (pattern|keyword|unknown|subject), createdAt

mo_line_status             — SKU line found/not-found tracking (v26.2).
                             id, lineId (UNIQUE FK → mo_order_lines CASCADE),
                             found BOOLEAN, reason TEXT, altSkuCode TEXT,
                             altSkuDescription TEXT, note TEXT,
                             updatedBy (FK → users), updatedAt
```

**Reference (seeded from CSV, maintained via UI + auto-save):**
```
mo_product_keywords        — ~809 rows. keyword (NOT unique), category, product.
                             Sorted by keyword length DESC for matching.
                             RULE: Must NOT include base colour words.
mo_base_keywords           — ~215 rows. keyword (NOT unique), category, baseColour.
mo_sku_lookup              — ~1,400+ rows. material (UNIQUE), description, category,
                             product, baseColour, packCode, unit, refMaterial,
                             piecesPerCarton INTEGER (v26.3).
                             Composite index on (product, baseColour, packCode).
mo_customer_keywords       — 667+ rows. customerCode, customerName, area,
                             deliveryType, route, keyword.
                             Auto-grows when operator manually picks unmatched customers.
```

---

## 4. ROLES AND USERS

| Role | ID | Access | Key Users |
|---|---|---|---|
| admin | 1 | All routes, admin panel | admin@orbitoms.com (pw: Admin@2026) |
| tint_manager | — | /tint/manager, TI Report, Shades, Mail Orders | Chandresh Kolgha (chandresh@orbitoms.in) |
| tint_operator | — | /tint/operator | Deepak Vasava, Chandrasing Valvi |
| dispatcher | — | /planning | — |
| support | — | /support | Rahul |
| floor_supervisor | — | /warehouse | — |
| picker | — | /warehouse | 10 seeded picker users |
| operations | 12 | /operations/* (all boards read-only) | operations@orbitoms.com (pw: operations123 — CHANGE IN PROD) |
| billing_operator | 13 | /mail-orders | Deepanshu Thakur (id=25), Bankim (id=26) (pw: Billing@123) |

**Post-login redirects:** admin→/admin, dispatcher→/planning, support→/support, tint_manager→/tint/manager, tint_operator→/tint/operator, floor_supervisor→/warehouse, picker→/warehouse, operations→/operations/support, billing_operator→/mail-orders

**Phase 1 route guard:** PHASE1_BLOCKED in middleware.ts blocks non-admin from /support, /planning, /warehouse, /operations, /dispatcher. Remove from array to unlock.

---

## 5. SCREENS AND MODULES — COMPLETE

### 5.1 Admin Panel
- **Route:** /admin
- **Auth:** admin only
- **Status:** LIVE
- **Screens:** Customer management, SKU management, route/area management, user management, system config, import

### 5.2 Support Board
- **Route:** /support
- **Auth:** support, admin, operations
- **Status:** Built, blocked by Phase 1 guard
- **Key:** History view, slot sections, bulk actions, group checkboxes, date picker, OrderDetailPanel integration
- **Columns:** checkbox | OBD/DATE | CUSTOMER | ROUTE/TYPE | VOL(L) | AGE | DISPATCH | PRIORITY | SLOT

### 5.3 Tint Manager Board
- **Route:** /tint/manager
- **Auth:** tint_manager, admin, operations
- **Status:** LIVE (Phase 1 active users)
- **Key components:** tint-manager-content.tsx, tint-table-view.tsx
- **Features:** 2-row header (v39), slot strip with tint counts, filter dropdown (delivery type, priority, type, operator), workload dropdown, card + table views, OrderDetailPanel (eye icon), 10-column table grid
- **API:** /api/tint/manager/orders (slot/deliveryType data, slotSummary)

### 5.4 Tint Operator Board
- **Route:** /tint/operator
- **Auth:** tint_operator, admin, operations
- **Status:** LIVE

### 5.5 Shade Master
- **Route:** /tint/manager/shades, /tint/shades
- **Auth:** tint_manager, admin
- **Status:** LIVE (redesigned v40)
- **Key:** 2-row header, IosToggle, type filter (TINTER/ACOTONE), pack filter, pagination
- **Columns:** # | Shade Name | Customer ID | Type | SKU Code | Pack | Status | Active | Added By | Added At

### 5.6 TI Report
- **Route:** /ti-report, /tint/manager/ti-report
- **Auth:** tint_manager, admin
- **Status:** LIVE (redesigned v40)
- **Key:** DateRangePicker with presets, no Summary tab, inline shade expand, Download Excel, filter dropdown (operator + type)
- **Columns:** chevron | Date | OBD No. | Dealer | Site | Base | Pack | Tins | Operator | Time

### 5.7 Dispatch Planning Board
- **Route:** /planning
- **Auth:** dispatcher, admin, operations
- **Status:** Built, blocked by Phase 1 guard
- **Key:** Planning at ORDER level (not split level). All splits of one OBD go to same vehicle.

### 5.8 Warehouse Board
- **Route:** /warehouse
- **Auth:** floor_supervisor, picker, admin, operations
- **Status:** Built, blocked by Phase 1 guard
- **Key:** Split view 300px left (unassigned) / flex right (pickers). Assignment at order level.

### 5.9 Operations View
- **Route:** /operations/support|tinting|tint-operator|dispatch|warehouse
- **Auth:** operations, admin
- **Status:** Built (v36), blocked by Phase 1 guard
- **Key:** Each sub-route renders existing board component

### 5.10 Mail Orders
- **Route:** /mail-orders
- **Auth:** billing_operator, tint_manager, admin
- **Status:** LIVE (primary active development area)
- **Full detail:** See §6

### 5.11 Login / Not Ready
- **Route:** /login, /not-ready
- **Status:** LIVE
- **Key:** /not-ready auto-signs out, shown for Phase 1 blocked routes

---

## 6. MAIL ORDER MODULE — FULL DETAIL

### 6.1 Architecture

```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v6.ps1 (parses body, extracts lines + dispatch data)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts v3 (generate → verify → rank against DB keyword tables)
  → customer-match.ts (extract customer from subject, match against mo_customer_keywords)
  → delivery-match.ts (ship-to override from delivery remarks)
  → mo_orders + mo_order_lines + mo_order_remarks (stored)
  → /mail-orders page (operator views, copies Code+SKU, types SO Number)
  → SO Number saved → auto-punches order

SAP Import (Auto-Import.ps1) creates orders with soNumber:
  → applyMailOrderEnrichment() checks mo_orders for matching soNumber
  → If found: applies dispatchStatus, priorityLevel, remarks, overrides to orders table
  → One soNumber can map to multiple OBDs (1:N) via updateMany
```

### 6.2 Parser — Parse-MailOrders-v6.ps1

**Version:** 6.0.0 (replaces v5.1.0)
**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\` (NOT in git repo)

**Architecture: Normalize → Comma Split → Extract**
- Phase 1 (Normalize-Line): carton suffix detection, piece suffix stripping, divider normalization (&→*, ×→*), unit normalization (gm/ml/ltr→stripped), noise word stripping, equals separator
- Phase 2: Comma split AFTER normalization
- Phase 3 (Extract-ProductLines): P0-P10 priority patterns per segment

**Key extraction patterns:** P1 bill marker, P2 material code, P3 explicit separator (NUM*NUM), P4 space-separated with text, P5 number-only with base code, P6/P6b number-only pairs, P7 product text + trailing number, P8 signal/remark, P9 product name only, P10 fallback

**Key features:** Fetches keywords from API at startup (GET /api/mail-orders/keywords). Line Classification Engine. Bill splitting (emailEntryId = {original}__Bill{N}). Carry-forward via $script:CarryProduct/$script:CarryBase. Word-boundary keyword matching (Test-KeywordWB). Carton flag (isCarton=true). Area keyword classification.

**Config (config.txt):**
```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
ShipToKeywordsFile=...shipto_keywords.txt
SlotToKeywordsFile=...slotto_keywords.txt
```

**Encoding:** Must be UTF-8 with BOM for PowerShell 5.1.

### 6.3 Enrichment Engine — lib/mail-orders/enrich.ts (v3)

**Algorithm: Generate → Verify → Rank (6 phases)**

Phase 1 — Material code check: direct lookup /^(IN)?\d{5,10}$/
Phase 2 — Product keyword search: ALL matching keywords in FULL text (word-boundary regex, pre-compiled). No stripping.
Phase 3 — Base keyword search: ALL matching bases in FULL text simultaneously. Also detect numbered bases via `\b(9[0-8])\b`.
Phase 4 — Product-aware base resolution (4 strategies):

| Strategy | Products | Behavior | Bonus |
|---|---|---|---|
| DIRECT | 82 (primers, thinners, clears, putty, tinters) | No base needed. Ignore colour words. | +3 |
| FIXED | 16 (SmartChoice, OPQ, IBC Advance, etc.) | Single predetermined base. | +2 |
| NUMBERED | 26 (Promise, WS Max/Protect/Powerflexx, etc.) | 90-98 BASE + BW. Handles mixed bases too. | +1 match, -1 fallback |
| COLOUR | 14 (Gloss, Super Satin, Promise Enamel, etc.) | Named colour bases + BW/ADVANCE fallback. | 0 match, -1 fallback |

Phase 5 — Candidate generation + SKU verification against skuByCombo map.
Phase 6 — Scoring: productKeywordLength + baseKeywordLength + strategyBonus. Category keyword penalty: -2 (STAINER/TINTER/FAST). Colour-as-product no-double-count. isPrimaryPack preference. Cross-product tie guard. Base-presence tie guard. Tie→partial for manual resolution.

**BW-fallback with unrecognized base:** If winner is fallback and text has ≥3 unrecognized alphabetic chars after product keyword → partial with "Unrecognized base: {TEXT}" instead of silent wrong match.

**Pack handling:** PACK_ROUND (fractional→standard), PACK_EXPAND (bidirectional: 1↔2 Sadolin, 1→0.925/0.9, etc.). Pack rounding before candidate generation.

**Carton multiplication:** When isCarton=true and SKU matched: finalQty = qty × sku.piecesPerCarton. Stored as isCarton + cartonCount on mo_order_lines.

**Word-boundary matching:** All keyword matching uses pre-compiled `\b...\b` regexes via buildKeywordRegexes(). escapeRegex() helper. No length threshold — 2-char keywords like "VT" match safely.

**Exports:** enrichLine(), buildSkuMaps() (returns byCombo, byComboAlt, byMaterial), buildProductProfiles(), buildKeywordRegexes()

**Current match rate:** ~98.2% on 2,366 real lines (2,323 matched).

### 6.4 Customer Matching — lib/mail-orders/customer-match.ts

**parseSubject():** Strips FW/RE prefixes, "Urgent", "Order" prefix, extracts customer code (4+ digits), scans for remark signals (cross, timing, blocker, instruction, context), returns { customerCode, customerName, remarks[] }.

**matchCustomer():** Code prefix → exact lookup. Keyword/name substring matching. Score: exact equality (100/90) > substring (length-based). Decisive winner if top ≥90 and second <50. Returns: exact (1 code), multiple (2+ with top 10 candidates), unmatched (0).

### 6.5 Ship-To Override — lib/mail-orders/delivery-match.ts

matchDeliveryCustomer(): Searches delivery_point_master from deliveryRemarks. Override if different customer code found. Appends [→ CustomerName (Code)] to deliveryRemarks.

### 6.6 API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/mail-orders/ingest | HMAC | Receives from PowerShell, enriches, matches customer, stores |
| GET | /api/mail-orders | Session | Fetches by date (IST) + status filter. Includes remarks_list, lineStatus |
| PATCH | /api/mail-orders/[id]/punch | Session | Marks punched (legacy, kept for compat) |
| PATCH | /api/mail-orders/[id]/so-number | Session | Saves soNumber, auto-punches |
| PATCH | /api/mail-orders/[id]/customer | Session | Manual customer pick, optional keyword save |
| PATCH | /api/mail-orders/[id]/lock | Session | Toggle isLocked |
| POST | /api/mail-orders/[id]/split | Session | Manual split after resolve threshold |
| GET | /api/mail-orders/[id]/original-lines | Session | Fetch both halves for original view |
| POST | /api/mail-orders/lines/[lineId]/resolve | Session | Resolve unmatched line + keyword save |
| PATCH | /api/mail-orders/lines/[lineId]/status | Session | Set found/not-found + reason |
| GET | /api/mail-orders/skus | Session | Search mo_sku_lookup for resolve dropdown |
| GET | /api/mail-orders/customers/search | Session | Search mo_customer_keywords |
| GET | /api/mail-orders/keywords | Public (no auth) | Returns productKeywords, baseKeywords, customerKeywords |
| POST | /api/mail-orders/re-enrich | Session | Re-enrich last 2 days with v3 engine. Idempotent. |
| GET | /api/mail-orders/debug-enrich | Session | ?text=...&pack=... Returns debug info |
| POST | /api/mail-orders/backfill-customers | Session | TEMPORARY — delete after verification |

**Middleware bypass:** /api/mail-orders/ingest bypasses session auth when x-hmac-signature header present. /api/mail-orders/keywords excluded from auth entirely.

### 6.7 Frontend — /mail-orders

**Files:**
- `app/(mail-orders)/mail-orders/page.tsx` — bare wrapper, force-dynamic
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — main client component
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — 12-column table with CodeCell
- `app/(mail-orders)/mail-orders/focus-mode-view.tsx` — single card speed punching view
- `app/(mail-orders)/mail-orders/resolve-line-panel.tsx` — unmatched line resolver
- `app/(mail-orders)/mail-orders/slot-completion-modal.tsx` — slot completion + SO email grouping
- `lib/mail-orders/types.ts` — TypeScript interfaces
- `lib/mail-orders/api.ts` — client-side fetch helpers
- `lib/mail-orders/utils.ts` — slot assignment, clipboard, grouping, smartTitleCase, volume
- `lib/mail-orders/customer-match.ts` — server-side customer matching
- `lib/mail-orders/delivery-match.ts` — server-side ship-to override
- `lib/mail-orders/enrich.ts` — enrichment engine v3
- `lib/mail-orders/email-template.ts` — slot summary HTML email builder (v60)

**Table columns (12):**
`Time(68) | SO Name(120) | Customer(208) | Lines(68) | Dispatch(80) | Remarks(120) | Code(90) | SKU(82) | SO No.(110) | Lock(46) | Status(80) | Punched By(100)`

**Column toggle:** ALL_COLUMNS config, localStorage "mo-column-visibility". Dispatch defaultVisible:false. 4 always-visible: Time, Customer, SKU, SO No.

**Row states:** Normal pending (white), focused (amber left border + bg-amber-50/70), locked (red left border), punched (teal left border + bg-teal-50/40 + opacity-75).

**Slot sections:** Morning (<10:30), Afternoon (10:30-13:30), Evening (13:30-16:30), Night (>16:30) — based on receivedAt IST.

**Punched orders:** Separated to bottom per slot when slot selected. Collapsible "N punched ▸/▾" divider. T key toggles globally.

**Customer column:** Delivery type dot (5px) + name (smart title case, bold) + area·route subtext + volume (green/amber).

**Code column:** Three states — Exact (mono badge, click copies), Multiple (amber "N found" badge → picker), Unmatched ("Search" → typeahead).

**Dispatch column:** Combined badge: Hold+Urgent→red, Hold→red, Urgent→amber, Dispatch→green. DefaultVisible: false.

**Remarks column: Signal badges (4-tier):**
- Blocker (red): OD, CI, Bounce
- Attention (amber): Bill Tomorrow, Cross, Ship-to, Urgent, ⚠ Split
- Info (gray): Truck, Challan, DPL, Bill N, 7 Days, Extension
- Split (purple): ✂ A/B

**Lock column:** Lock/LockOpen icons (lucide-react). Auto-locks on OD, CI, Bill Tomorrow. Persisted to DB (isLocked on mo_orders).

**SO Number column:** Inline input, 10-digit validation, auto-punch on save.

**Auto-refresh:** 30s polling + tab focus refresh via visibilitychange.

**Search:** 19 fields — soName, soEmail, customerName, customerCode, subject, soNumber, remarks, billRemarks, deliveryRemarks, and more.

### 6.8 Focus Mode (v54)

**Component:** focus-mode-view.tsx — single card per order for speed punching.

**Toggle:** Table/Focus in header title (gray-800 dark, not teal). Stats show N% badge.

**Card layout:** Identity → Customer name → Meta (code, area, delivery type, volume, lines) → Signal badges → Q/W copy buttons → SO input (h-44) → Action button → SKU summary row.

**Card states:** Active (pending), Flagged (amber border), Just Done (8s grace, teal border, countdown), Punched (browsing back).

**SKU Panel:** Right side panel. activeLineId: null=closed, -1=list, >0=detail. Toggle found/not-found per line with reason selection.

**Progress bar:** Single smart bar. Green fill (punched %) + teal dot (current position with clamp).

**Navigation:** Inline below card. ←→ or ↑↓ navigate. N=next unmatched. L=order list popover. Auto-advance 8s after punch.

**Grace period fix:** justDoneIdRef pins currentIndex when queue re-sorts after punch.

### 6.9 Keyboard Shortcuts (v60 Final)

| Key | Action |
|---|---|
| Ctrl+C | Smart copy state machine: 1st press=customer code, 2nd=matched SKUs (batch of 20), 3rd=next batch or reset. Cell flash via `data-cell` attribute. |
| Ctrl+V | Auto-paste into SO Number input |
| Ctrl+M | Open Slot Email modal — **BROKEN v60**, handler not firing. Fix priority v61. |
| R | Copy reply template (punched orders with SO number) |
| F | Toggle lock/flag |
| S | Open SKU panel (Focus Mode) |
| N | Jump to next unmatched |
| P | Open customer picker |
| T | Toggle punched visibility |
| / | Focus search |
| ? | Toggle shortcuts panel |
| 1-4 | Jump to slot segment |
| ↑↓ | Navigate orders (filters out hidden punched orders, scrollIntoView in requestAnimationFrame) |
| ←→ | Navigate orders (Focus Mode) |
| L | Open order list (Focus Mode) |
| Enter | Expand order (Table) |
| Esc | Cascading close (modal→panel→popover→blur→collapse) |

**Removed in v60:** Q, W, A shortcuts (replaced by Ctrl+C smart copy and slot email modal).

### 6.10 Auto-Split System (v47)

**Thresholds:** >1500L OR >20 lines (AND >1 line)
**Algorithm:** Category-first split (splitLinesByCategory). Group by productName → sub-split dominant blocks by packCode → greedy bin-pack with weighted score (0.5×vol + 0.5×count). Guard rails for min 8 lines per group.

**Data model:** Original→Group A (splitLabel="A", splitFromId=null). New→Group B (splitLabel="B", splitFromId=orderA.id). Both status="pending".

**Manual split:** POST /api/mail-orders/[id]/split after resolve threshold crossing. Shows amber suggestion banner in expanded view.

**View Original toggle:** Fetches all lines from both halves via /api/mail-orders/[id]/original-lines.

### 6.11 Volume System (v49)

**Pack volume map:** getPackVolumeLiters() — 20 known values. Values ≥100 are milliliters (100→0.1L, 500→0.5L).
**ML unit stainers:** enrich.ts appends "ML" suffix when sku.unit="ML". Stored as "50ML"→0.05L.
**Display:** Per-line in expanded view, per-order in customer subtext (green/amber), per-slot in section header.

### 6.12 Slot Completion + SO Email (v53, updated v60)

Auto-detects when all orders in slot are punched. Also auto-triggers 15min after slot cutoff. Modal: green check, slot stats, SO list grouped by soName (punched + unpunched). Per-SO "Send" button copies HTML email + opens mailto. Sent SOs collapse to green ✓. "Copy All SAP" footer. Auto/Manual toggle. localStorage `mo-slot-email-sent-{date}-{slotName}` prevents re-trigger per slot per date.

### 6.13 SO Summary Panel — DELETED v60

so-summary-panel.tsx deleted. SO grouping now handled by slot-completion-modal.tsx. A key shortcut removed.

### 6.15 Slot Summary Email (v60)

**New file:** `lib/mail-orders/email-template.ts`
**Function:** `buildSlotSummaryHTML(soName, orders, slotName, date, senderName, senderPhone?) → string`

**Trigger:** Auto-trigger 15min after slot cutoff. Manual via Ctrl+M (BROKEN v60). localStorage key `mo-slot-email-sent-{date}-{slotName}` prevents re-trigger. Auto-trigger guard: `triggered` flag ensures only one slot fires at a time.

**Modified:** slot-completion-modal.tsx — groups ALL orders by soName (punched + unpunched). Per-SO "Send" button copies HTML via ClipboardItem + opens mailto. Sent SO cards collapse to green ✓.

**Deleted:** so-summary-panel.tsx — replaced by slot completion modal SO grouping.

**Email template design (locked v60):**
- 560px centered table, Outlook/OWA safe
- Brand bar: 3px solid #0d9488 top border
- Header: two-column — slot title/date left, teal order count panel right (110px flush)
- Section headers: Processed (#0d9488 border), Not Available (#b45309), Pending (#334155)
- Three-column table: serial (24px) | content (name, code) | right data (120px, SO number/time)
- Processed: sorted by punchedAt DESC. Hold orders: name #cbd5e1 + " *". Always shown.
- Not Available: only if flaggedLines > 0. Serial per order group. Product·pack + reason.
- Pending: only if pending.length > 0. Customer name + "Will process tomorrow" note.
- Total row: "N orders · N processed · N pending · N not available"

**Outlook safety (non-negotiable):** Zero `<div>`, zero `<p>`, zero margin. background-color on `<td>` only. font-family on every `<td>`. No border-radius. Nested `<table>` for layout. Meta format-detection + x-apple-disable-message-reformatting.

**Helpers:** zwsp(n) breaks iOS number detection, fmtTime(iso), getFirstName(), getPendingNote(), getReasonLabel(), splitPartLabel().

---

## 7. ENRICHMENT ENGINE — CURRENT STATE (v3, deployed v58)

See §6.3 for full algorithm. Summary:

- **Strategy types:** DIRECT (82 products, no base), FIXED (16, predetermined base), NUMBERED (26, 90-98 + BW), COLOUR (14, named colours)
- **Scoring:** keyword lengths + strategy bonus + penalties. Category keywords get -2.
- **Tie detection:** Same score, different SKU, same product → partial. Guards: isPrimaryPack, cross-product, base-presence.
- **Pack handling:** Rounding (fractional→standard) + expansion (bidirectional fallback)
- **Word-boundary matching:** Pre-compiled regex maps via buildKeywordRegexes()
- **BW-fallback partial:** Unrecognized base text → partial instead of silent wrong match
- **Carton multiplication:** isCarton + piecesPerCarton from SKU
- **Current rate:** ~98.2% on 2,366 lines

---

## 8. KEY ENGINEERING RULES — NON-NEGOTIABLE

1. **Never use `prisma db push`** — all schema changes via Supabase SQL Editor with raw SQL, then `npx prisma generate`
2. **Never use `prisma.$transaction`** — Vercel serverless + Supabase pooler causes timeouts. Use sequential awaits.
3. **Supabase uses camelCase column names** — `@map("snake_case")` causes P2022 errors. Column names must match exactly.
4. **DB passwords must not contain special characters** (@, #, $) — breaks PostgreSQL URL parsing
5. **Vercel function region must be `bom1`** (Mumbai) — default `iad1` adds 200-300ms latency
6. **All API routes need `export const dynamic = 'force-dynamic'`**
7. **Auth is split:** `lib/auth.ts` (Node only) vs `auth.config.ts` (Edge/middleware only)
8. **`@page` CSS rules** must be top-level in `globals.css`, cannot be nested in `@media print`
9. **PowerShell on depot PC:** `[BitConverter]::ToString($hash).Replace("-","").ToLower()` (not `[Convert]::ToHexString()`), `Invoke-WebRequest -UseBasicParsing` (not `Invoke-RestMethod`), sequential git commands (not `&&`-chained)
10. **Google Maps hyperlinks:** Use `https://www.google.com/maps?q=LAT,LONG` format (not `place_id:`)
11. **Keyword length sorting is critical** for enrichment — shorter generic keywords override longer specific ones without DESC sort
12. **Product keywords must NOT include base colour words** — base colours detected separately by findAllBases()
13. **UTC→IST for mail order timestamps:** `AssumeUniversal` + `ConvertTimeFromUtc`. Never `.ToUniversalTime()`.
14. **Parser encoding:** UTF-8 with BOM for PowerShell 5.1. No non-ASCII chars except × in regexes.
15. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div, no title
16. **Cross billing ≠ shipToOverride.** Cross billing = another depot (informational). Ship-to = different delivery address.

---

## 9. DEPLOYMENT AND INFRASTRUCTURE

### Domain & Hosting
- **Domain:** orbitoms.in (Namecheap, auto-renew ON, expires April 2027)
- **DNS:** A Record `@` → Vercel IP, CNAME `www` → Vercel DNS
- **Hosting:** Vercel (Hobby plan, production branch = main, region = bom1 Mumbai)
- **SSL:** Auto-provisioned by Vercel. orbitoms.in redirects to www.orbitoms.in.

### Database
- **Supabase Pro** ($25/month, never pauses)
- **Region:** ap-south-1
- **Pooler:** Shared, Transaction mode, port 6543
- **Pool size:** 15 (Nano compute), max clients 200
- **DIRECT_URL:** Port 5432 for Prisma generate only

### Environment Variables (Vercel)
DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, NEXTAUTH_URL (https://www.orbitoms.in), IMPORT_HMAC_SECRET, MAIL_ORDER_HMAC_SECRET

### PowerShell Pipelines (Windows PC at depot)

**Parse-MailOrders-v6.ps1:** FW: email parser. Reads from surat.order@outlook.com Inbox. Config from config.txt. Dedup via processed_ids_fw.json.

**Auto-Import.ps1:** Runs every 10 minutes via Task Scheduler (8AM-8PM). Uses daily-state.txt and last-page1.txt for smart incremental fetch.

**Watch-OrderEmails-v2.ps1:** DEPRECATED (v44). RE: email pipeline replaced by FW: email dispatch extraction.

### Dev Workflow
- Production branch: main (auto-deploys)
- Development branch: dev
- Deploy: `tsc --noEmit` → git add → commit → push
- Verify zero TypeScript errors between each prompt

### Monitoring
- Sentry: deferred (OneDrive/Windows npm conflict)
- UptimeRobot: not yet set up (use /api/health)

---

## 10. UNIVERSAL HEADER SYSTEM (v46)

**Component:** `components/universal-header.tsx` — used by ALL 8 boards. Never create new header patterns.

**Row 1 (52px sticky):** Title (accepts ReactNode for toggles) · Stats · Clock (IST HH:MM) · ⌨ Shortcuts · Download · Search (180→260px)

**Row 2 (40px sticky):** Segmented control (slot pills or status tabs) · rightExtra · Filter ▾ · Date stepper (‹ Today · 04 Apr ›)

**Color rule:** ONE teal element (active slot segment). Everything else gray. No teal on filter, date, search.

**Slot segments:** 4 only — Morning, Afternoon, Evening, Night. Filter out Next Day Morning (isNextDay). No "All" button — deselected = show all.

**Per-board wiring:**

| Board | Segments | Filters | Date | Extras |
|---|---|---|---|---|
| Support | Slots (4) | View, Status, Del Type, Priority | Stepper | Search |
| Tint Manager | Slots (4) | Del Type, Priority, Type, Operator | Stepper | View toggle |
| Planning | Slots (4) | Del Type, Dispatch Status | Stepper | — |
| Warehouse | Slots (4) | Del Type, Pick Status | Stepper | — |
| Mail Orders | Slots (4) | Status, Match, Dispatch, Lock | Stepper | Column toggle |
| Tint Operator | Status tabs | — | None | — |
| TI Report | Date presets | Tinter Type, Operator | None | Date range (leftExtra), Download |
| Shade Master | — | Tinter Type, Status | None | — |

---

## 11. PENDING ITEMS — CONSOLIDATED

### Mail Orders Module
1. **Area keywords in keywords API** — extend GET /api/mail-orders/keywords to return areaKeywords. Parser v6 already handles them.
2. **Switch depot PC to parser v6** — update Task Scheduler. Keep v5 as backup.
3. **Confirm carton sizes from Prakashbhai** — update piecesPerCarton if corrections.
4. **UI: Carton display** — show carton icon/badge, "3 CTN × 20 = 60" breakdown.
5. **types.ts verify** — isCarton and cartonCount may need re-adding to MoOrderLine interface.
6. **Fuzzy matching (Level B)** — edit-distance 1-2 fallback after exact match produces 0 candidates. Design ready.
7. **Learning from corrections (Level C)** — resolve panel corrections feed back into lookup.
8. **Audit system** — confidence scoring, batch stats, admin view, keyword management UI.
9. **Run enrichment-fix-v57.sql** — product keywords, crackfiller 300G SKU, M900 base keywords. Then re-enrich.
10. **M900 SKU entries** — need SAP material codes. 13 SKUs (BW + 90/92/93 BASE × 4 packs).
11. **BW → 90 BASE fallback** — for products that have 90 BASE but no BW SKU (2KPU MATT/GLOSS).
12. **PU PRIME WHITE SEALER** — keyword maps to nonexistent product. Investigate or remap.
13. **CATEGORY_KEYWORDS cleanup** — dead code set in enrich.ts. Can be removed.
14. **Stainer pack extraction from rawText** — partially addressed by v6 gm normalization.
15. **DIY Spray products** — not in SKU table. Low priority.
16. **Truncated material codes** — "320768" prefix matching.
17. **Historical carton backfill** — existing orders have wrong qty (raw carton count).
18. **buildReplyTemplate update** — move inline template from focus-mode to shared utils.ts.
19. **Slot completion in Focus Mode** — wire slot-completion-modal to Focus Mode view.
20. **Focus Mode search/filter integration** — make header filters apply to queue.
21. **Next Slot button** — wire onSlotChange prop in slot complete card.
22. **Mail Order backfill-customers endpoint** — TEMPORARY, delete after verification.
23. **Mail Order auto-refresh** — currently 30s polling. Consider WebSocket or SSE for real-time.
24. **paintType column on mo_sku_lookup** — classify ~130 products as oil/water/stainer for warehouse-zone splitting.
25. **Ctrl+M broken** — handler not firing. Debug in v61. Check FocusModeView keyboard handlers for stopPropagation.
26. **Order detail link in email** — SO number in slot email → orbitoms.in/orders/{soNumber}. Needs public order detail page.
27. **senderPhone hardcoded placeholder** — in email-template.ts.
28. **Day summary email** — Ctrl+D trigger, exception-only format. Not built.

### OBD Pipeline / Other Modules
25. **OBD date parsing** — DD-MM-YYYY causes null obdEmailDate. Fix prompt ready.
26. **CustomerMissingSheet styling** — not matching admin customer form.
27. **CustomerMissingSheet area/route dropdown 403** — fix pushed but not verified in production.
28. **Cascade badge** — when originalSlotId !== slotId, show ⏩ from {originalSlot.name}. Data available in API. UI-only work.
29. **Apply neutral theme to all screens** — Support, Planning, Warehouse, Tint Operator need TM v39 palette.
30. **Order detail panel** — wire into Planning board (customer pill click) and Warehouse board (pick card click).
31. **Audit history in detail panel** — order_status_logs exists, not yet rendered.
32. **Smart slot assignment** — orders at/after slot cutoff auto-escalate.
33. **MIS Override Layer** — mis_dispatch_overrides table approach approved. Admin-only.
34. **Barcode/QR label generation** — post-TI submission. 6-step plan documented.
35. **Sentry error monitoring** — blocked by OneDrive/Windows npm conflict.
36. **Customer master coordinate enrichment** — for route optimization.
37. **WhatsApp notification** — Option C design.
38. **Operations password change** — operations@orbitoms.com temp password must be changed.

### Cleanup
39. **Universal header old code** — TM has display:none wrapper. Old PlanningHeader/WarehouseHeader files exist but unused. Delete.
40. **Universal header production verification** — Support, Planning, Warehouse, TI Report, Shade Master need verification after user login.
41. **Duplicate pick columns** — orders and order_splits have both camelCase and snake_case pick columns. Use camelCase via Prisma.
42. **Slot cascade cascades pending_support orders** — consider adding workflowStage filter.
43. **Shade Master isActive filter** — verify /api/admin/shades handles param.

---

## 12. SESSION START CHECKLIST

Before generating any code, confirm:

1. You have read CLAUDE_CONTEXT_v60.md fully
2. You have read the latest CLAUDE_UI.md (v4.7 or later) for ALL UI work
3. Schema is **v26.3** — verify against §3
4. Planning is at **ORDER level** (not split level). dispatch_plan_orders, not dispatch_plan_splits.
5. **Tint Manager uses OrderDetailPanel** (not SkuDetailsSheet)
6. **Universal header:** `<UniversalHeader />` is mandatory for all boards. No custom headers.
7. **page.tsx pattern:** All board pages are bare `<ComponentName />` — no wrapper div
8. **Delivery type dot colors:** blue-600 (Local), orange-600 (UPC), teal-600 (IGT), rose-600 (Cross). Normalize with .toUpperCase().
9. **Slot segments:** 4 only (filter out Next Day Morning). No "All" button.
10. **Mail Order enrichment:** v3 engine with word-boundary regex, product-aware base (DIRECT/FIXED/NUMBERED/COLOUR), BW-fallback partial logic, carton multiplication.
11. **Mail Order parser:** v6.0.0 — Normalize → Split → Extract. Carton detection. Word-boundary keywords.
12. **Mail Order keyboard (v60):** Ctrl+C=smart copy, Ctrl+V=paste SO, Ctrl+M=slot email (BROKEN), R=reply, F=flag, S=SKU panel, N=next unmatched, P=pick, T=toggle punched, L=order list, /=search, Esc=cascade. Q/W/A removed.
13. **Re-enrich endpoint:** POST /api/mail-orders/re-enrich (v3). Do NOT use /api/mail-orders/backfill-enrich (v1).
14. **Lock persistence:** isLocked on mo_orders. PATCH /api/mail-orders/[id]/lock.
15. **billing_operator:** id=13. Deepanshu (25), Bankim (26). Password: Billing@123.
16. **Focus Mode:** focus-mode-view.tsx. Toggle in header title. activeLineId: null/−1/>0 for panel state.
17. **SKU Line Status:** mo_line_status table. PATCH /api/mail-orders/lines/[lineId]/status.
18. Never use prisma db push, prisma.$transaction. Schema changes via Supabase SQL Editor.
19. All API routes: `export const dynamic = 'force-dynamic'`
20. Vercel region: bom1. Auth split: lib/auth.ts (Node) vs auth.config.ts (Edge).

---

## 13. UI DESIGN SYSTEM REFERENCE

The complete UI design system is maintained in **CLAUDE_UI_v4_7.md** (separate file). Load alongside this context file for all UI work.

Key principles: Neutral-first, teal brand accent only, gray structure, semantic status colors only. UniversalHeader on all boards. IosToggle, DateRangePicker, smartTitleCase as standard components.

---

## 14. DEPRECATED / REMOVED ITEMS

- **Watch-OrderEmails-v2.ps1** (RE: email pipeline) — deprecated v44. All dispatch data captured from FW: email.
- **Old indigo theme** (#1a237e) — fully deprecated. Use teal-600 + gray palette.
- **SkuDetailsSheet** — replaced by OrderDetailPanel on TM (v39).
- **dispatchFilter on TM** — removed v39. Most pre-completion orders have null dispatchStatus.
- **dispatch_plan_vehicles table** — dropped (redundant, vehicleId on dispatch_plans).
- **StockMaster.xlsx (52K rows)** — replaced by separate keyword + SKU tables (~2,100 rows).
- **Parse-MailOrders v1-v5** — superseded by v6.0.0. v5 kept as backup on depot PC.
- **Enrichment v1/v2** — superseded by v3 in enrich.ts. /api/mail-orders/backfill-enrich uses v1 (deprecated for re-enrichment).
- **so-summary-panel.tsx** — deleted v60. SO grouping now lives in slot-completion-modal.tsx.
- **Q, W, A keyboard shortcuts** — removed v60. Replaced by Ctrl+C smart copy and slot email modal.

---

*Version: Phase 1 Go-Live · Schema v26.3 · Context v60 · April 2026*
