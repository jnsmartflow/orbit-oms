# CLAUDE_MAIL_ORDERS.md — Mail Orders Module
# v1.1 · Schema v27.2 · Parser v6.5 · Enrichment v3
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Primary user: Deepanshu Thakur (billing_operator id=25). Secondary: Bankim (id=26). Also used by Chandresh (tint_manager) and admin.

---

## 1. Architecture

```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v6_5.ps1 (parse body, extract lines + dispatch)
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts v3 (generate → verify → rank) with carryProduct fallback
  → customer-match.ts v2 (token scoring + learned auto-match)
  → delivery-match.ts (ship-to override)
  → mo_orders + mo_order_lines + mo_order_remarks
  → /mail-orders page (operator views, copies Code+SKU, types SO Number)
  → SO Number saved → auto-punches

SAP import (Auto-Import.ps1 v2.0) creates orders with soNumber:
  → applyMailOrderEnrichment() checks mo_orders by soNumber
  → If match: applies dispatchStatus, priorityLevel, remarks, overrides, orderDateTime
  → Skips slot recalc for tint orders
  → One soNumber can map to N OBDs (updateMany)
```

---

## 2. Database tables

### Transactional

```
mo_orders
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

mo_order_lines
  id, moOrderId (FK CASCADE), lineNumber,
  rawText, packCode, quantity, productName, baseColour,
  skuCode, skuDescription, refSkuCode,
  matchStatus (matched|partial|unmatched),
  originalLineNumber INT,
  isCarton BOOLEAN DEFAULT FALSE,
  cartonCount INTEGER,
  createdAt

mo_order_remarks
  id, moOrderId (FK CASCADE), lineNumber, rawText,
  remarkType (billing|delivery|contact|instruction|cross|customer|area|unknown),
  detectedBy (pattern|keyword|unknown|subject), createdAt

mo_line_status
  id, lineId (UNIQUE FK → mo_order_lines CASCADE),
  found BOOLEAN, reason TEXT, altSkuCode TEXT,
  altSkuDescription TEXT, note TEXT,
  updatedBy (FK → users), updatedAt
```

### Reference (seeded from CSV + auto-grows via UI)

```
mo_product_keywords        ~1,076 rows. keyword NOT unique. category, product.
                           Sorted by length DESC. Must NOT contain base colour words.
mo_base_keywords           ~267 rows. keyword NOT unique. category, baseColour.
mo_sku_lookup              ~1,599 rows. material UNIQUE. description, category,
                           product, baseColour, packCode, unit, refMaterial,
                           refDescription, piecesPerCarton INT.
                           Composite index (product, baseColour, packCode).
mo_customer_keywords       Auto-grows on operator picks. customerCode, customerName,
                           area, deliveryType, route, keyword.
mo_learned_customers       (normalizedText, customerCode) UNIQUE. hitCount, operators (JSON), lastConfirmedAt.
mo_order_form_index        Legacy 481 rows. Used by public /order mobile page.
                           Not used by /place-order (see CLAUDE_PLACE_ORDER.md for v2 tables).
```

### Fini vs Generic terminology

- `material` = Fini code (the actual shipping SKU) — UNIQUE, NOT NULL
- `description` = Fini description
- `refMaterial` = Generic/master code (SAP's tinted umbrella) — nullable
- `refDescription` = Generic description — nullable

Coverage: 425 rows have `refMaterial` populated (26.5%). Index: `idx_mo_sku_lookup_ref_material` on `refMaterial`.

---

## 3. Parser — Parse-MailOrders-v6_5.ps1

**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\` (outside git). Save as UTF-8 with BOM.

**Architecture: Normalize → Split → Extract**

1. **Normalize-Line** — carton suffix detection, piece suffix stripping (bag/bags/pcs), divider normalization (&→*, ×→*, lowercase x between digits), unit normalization (gm/ml/ltr stripped), noise word stripping (retail, order), equals separator. Digit-dash guard: `(\d{1,3})-(\d{1,4})\s*$` → `$1*$2`, **skip when preceded by stainer code** (23 hardcoded: NO, BU, RE, OR, XR, MA, GR, YE, XY, BLK, WHT, COB, COG, HEY, HER, FFR, OXR, WH, YOX, TBL, MAG, LFY, GRN).

2. **Comma split** — after normalization.

3. **Extract-ProductLines** — P0-P10 priority patterns per segment:
   - P1 bill marker
   - P2 material code
   - P3 explicit separator (NUM*NUM) with **comma loop** (`do/while`, max 10 iterations) for 3+ adjacent pack*qty groups
   - P4 space-separated with text
   - P5 number-only with base code
   - P6/P6b number-only pairs
   - P7 product text + trailing number
   - P8 signal/remark
   - P9 product name only
   - P10 fallback

### Parser features

- Fetches keywords from API at startup (`GET /api/mail-orders/keywords`)
- Line Classification Engine
- Bill splitting: `emailEntryId = {original}__Bill{N}`
- Section splitting: `emailEntryId = {original}__Sec{N}` (multi-customer)
- Carry-forward via `$script:CarryProduct`, `$script:CarryBase`
- Script-scope: `$script:ProdKW`, `$script:BaseKW` set in Parse-EmailBody, used in Send-ToApi
- Word-boundary keyword matching via `Test-KeywordWB`
- Carton flag per-segment (`isCarton`) — only the segment with carton word gets flag, uses `$segIsCarton` inside foreach
- Area keyword classification
- Multi-customer split (Pass 1): `Detect-SectionHeaders` scans for numbered customer headers (`N.Customer Name`). If 2+ found → split mode. Each section POSTed as separate order with `bodyCustomerName`/`bodyCustomerCode`.
- Multi-delivery split (Pass 2, only if <2 customer headers): scans for delivery headers (line ends with "delivery"). If 2+ → each section POSTed as separate bill with `deliveryRemarks`.
- **Priority:** customer split > delivery split. Email is EITHER multi-customer OR multi-delivery at top level, never both.
- **Detection safety:** minimum 2 headers. Product keyword in line → NOT a header. Pack*qty in line → NOT a header. Numbered prefix always = customer type. Fallback = single order mode.

### Base injection (Send-ToApi)

Before appending `_Base` to `rawText`: check if `ProductName` already contains a text-based base keyword (from `$script:BaseKW` via word-boundary). If found (e.g. WHITE, BR WHITE, BW, BRILLIANT WHITE) → skip injection. Enrichment reads text-based bases from rawText directly.

### carryProduct hint

Send-ToApi compares `longestProdKwLen` vs `longestBaseKwLen` per line. `isColourOnly = (baseLen > prodLen) OR (prodLen == 0 AND baseLen > 0)`. If colour-only (e.g. "Golden yellow" where GOLDEN YELLOW base kw is 13 chars > YELLOW prod kw 6 chars), sets `carryProduct` = last line that had dominant product keyword. Parser sends `carryProduct` field per line. Server retries enrichment with `${carryProduct} ${rawText}` when normal match returns unmatched/partial.

### Zero-skip guarantee

When `$parsed.ProductRows.Count -eq 0`, parser POSTs `$mail.Body` as single raw-text line (qty=0, no pack). Terminal shows `[RAW]` in dark yellow. Every FW: order email reaches OrbitOMS. No silent SKIPs. Worst case = 1 raw-text unmatched line.

### Parse-EmailBody resilience

Wrapped in `try/catch`. On crash, minimal `$parsed` built with empty ProductRows, triggering zero-skip fallback. Null guards on `$mail.Body`, `$mail.Subject`, `$mail.ReceivedTime`, `$mail.SenderName` using PS 5.1 compatible statement-form try/catch.

### P7 $Matches rule (critical)

In any `-and` chain with multiple `-match` operations: regex WITHOUT capture groups FIRST, regex WITH capture groups LAST. The second match overwrites `$Matches`.

### Diagnostic logging (mail_order.log)

- `SCAN` — every email seen before classification
- `CLASSIFY-SKIP` — every skip with reason
- `CRASH-TRACE` — parse crash stack trace
- `PARSED` — per-email summary (body length, bodyLines, products, remarks, joins, deliveryBlocks, cartons, bills, carry-forward state, body customer)
- `DELIVERY-BLOCK` — delivery guard activated
- `RAW` — zero-skip fallback fired

### Config (config.txt)

```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
ShipToKeywordsFile=...shipto_keywords.txt
SlotToKeywordsFile=...slotto_keywords.txt
```

---

## 4. Enrichment engine — lib/mail-orders/enrich.ts v3

### Algorithm: Generate → Verify → Rank (6 phases)

**Phase 1 — Material code check:** direct lookup against `/^(IN)?\d{5,10}$/`.

**Phase 2 — Product keyword search:** ALL matching keywords in FULL text (word-boundary regex, pre-compiled via `buildKeywordRegexes()`). No stripping.

**Phase 3 — Base keyword search:** ALL matching bases in FULL text simultaneously. Also detect numbered bases via `\b(9[0-8])\b`.

**Phase 4 — Product-aware base resolution (4 strategies):**

| Strategy | Products | Behaviour | Bonus |
|---|---|---|---|
| DIRECT | 82 (primers, thinners, clears, putty, tinters) | No base needed. Ignore colour words. | +3 |
| FIXED | 16 (SmartChoice, OPQ, IBC Advance, etc.) | Single predetermined base. | +2 |
| NUMBERED | 26 (Promise, WS Max/Protect/Powerflexx) | 90-98 BASE + BW. Handles mixed bases. | +1 match, -1 fallback |
| COLOUR | 14 (Gloss, Super Satin, Promise Enamel) | Named colour bases + BW/ADVANCE fallback. | 0 match, -1 fallback |

**Phase 5** — Candidate generation + SKU verification against `skuByCombo` map.

**Phase 6 — Scoring:** `productKeywordLength + baseKeywordLength + strategyBonus`. Category keyword penalty: -2 (STAINER/TINTER/FAST). Colour-as-product no-double-count. `isPrimaryPack` preference. Cross-product tie guard. Base-presence tie guard. Tie → `partial` for manual resolution.

### BW-fallback with unrecognized base

If winner is fallback and text has ≥3 unrecognized alphabetic chars after product keyword → `partial` with "Unrecognized base: {TEXT}" instead of silent wrong match.

### Pack handling

- `PACK_ROUND` — fractional → standard
- `PACK_EXPAND` — bidirectional (1↔2 Sadolin, 1→0.925/0.9, etc.)
- Pack rounding runs before candidate generation
- Normalize SKU pack codes: float to int (`str(int(f)) if f==int(f) else str(f)`). "1" never matches "1.0".

### Carton multiplication

When `isCarton=true` and SKU matched: `finalQty = qty × sku.piecesPerCarton`. Stored as `isCarton` + `cartonCount` on `mo_order_lines`.

### Word-boundary matching

All keyword matching uses pre-compiled `\b...\b` regexes via `buildKeywordRegexes()`. `escapeRegex()` helper. No length threshold — 2-char keywords like "VT" match safely.

**Critical rule:** Product keywords must NEVER include base colour words. Base colours detected separately by `findAllBases()`. Greedy.

### Regex boundary gotcha

`\b(9[0-8])\b` fails on "90BASE" — no space between digit and letter, both word chars. Use detected base keywords from Phase 2 as authoritative; regex as backup only.

### enrichLine signature

```
enrichLine(
  rawText, packCode, skuMaps, productProfiles, keywordRegexes,
  productKeywords, baseKeywords, productByKeyword, baseByKeyword,
  options?, carryProduct?
)
```

`carryProduct` is 11th param. `enrichLineCore()` is the private implementation. Wrapper retries core with `${carryProduct} ${rawText}` when core returns unmatched/partial and carryProduct is set.

### Debug endpoint

`GET /api/mail-orders/debug-enrich?text=...&pack=...&carryProduct=...`
Response includes `matchedProductKeywords`, `productProfile`, plus everything in enrichLine output.

### Re-enrich endpoint

`POST /api/mail-orders/re-enrich` — re-enriches last 2 days with v3. Idempotent. Only upgrades match status (`newRank > oldRank`). Must be called from logged-in browser:
```js
fetch('/api/mail-orders/re-enrich', { method: 'POST' }).then(r => r.json()).then(console.log)
```
Middleware blocks unauthenticated POST.

To fix wrong "matched" lines: SQL reset to "unmatched" → re-enrich → count sync.

### Exports

`enrichLine()`, `buildSkuMaps()` (returns `byCombo`, `byComboAlt`, `byMaterial`), `buildProductProfiles()`, `buildKeywordRegexes()`.

### Current match rate

~98.2% on 2,366 real lines.

---

## 5. Customer matching — customer-match.ts v2

### parseSubject()

Strips FW/RE prefixes, "Urgent", "Order" prefix, extracts customer code (4+ digits), scans for remark signals (cross, timing, blocker, instruction, context). Returns `{ customerCode, customerName, remarks[] }`.

### matchCustomer()

Code prefix → exact lookup. Keyword/name substring matching.
Score: exact equality (100/90) > substring (length-based).
Decisive winner if `top ≥ 90` and `second < 50`.
Returns: `exact` (1 code), `multiple` (2+ with top 10 candidates), `unmatched` (0).

### matchByKeywords() — token-based scoring (v2)

Rarity-weighted token overlap instead of substring matching.

| Token rarity | Customers seen | Weight |
|---|---|---|
| Unique | ≤2 | 10 |
| Rare | ≤5 | 5 |
| Moderate | ≤15 | 3 |
| Common | >15 | 1 |

- Noise words stripped
- Area fuzzy match (Levenshtein ≤1) gives +8 bonus
- Consecutive-token bonus
- Exact string match = 200 fast path

### Body fallback

Parser extracts customer name/code from email body (patterns: "Customer:", "Dealer:", "Code:", standalone 5-7 digit codes in first 5 lines). Body sent as `bodyCustomerName`/`bodyCustomerCode` in IngestRequest.

Body overrides subject only when:
- subject returned non-exact AND body returns exact, OR
- body returns multiple when subject was unmatched

### Learned auto-match guards

Operator picks from Code column picker → saved to `mo_learned_customers`. Auto-match triggers ONLY when ALL four guards pass:
1. `hitCount >= 3`
2. `uniqueOperators >= 2` (parsed from JSON `operators` field)
3. No conflict (no other learned row with `hitCount >= 2` for same text → different customer)
4. `customerCode` still exists in `mo_customer_keywords`

If guards fail but learned candidate exists → `unmatched` upgraded to `multiple` (candidate shown in picker).

---

## 6. Ship-to override — delivery-match.ts

`matchDeliveryCustomer()`: searches `delivery_point_master` from `deliveryRemarks`. Override if different customer code found. Appends `[→ CustomerName (Code)]` to `deliveryRemarks`.

**Cross billing ≠ shipToOverride.** Cross billing is informational (another depot). Ship-to is different delivery address.

---

## 7. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/mail-orders/ingest | HMAC | Receives from PowerShell, enriches, matches customer, stores. Accepts `carryProduct?`, `bodyCustomerName?`, `bodyCustomerCode?`. No server-side auto-split. |
| GET | /api/mail-orders | Session | Fetches by date (IST) + status filter. Includes `remarks_list`, `lineStatus`. |
| PATCH | /api/mail-orders/[id]/punch | Session | Mark punched (legacy compat). |
| PATCH | /api/mail-orders/[id]/so-number | Session | Save soNumber, auto-punch. |
| PATCH | /api/mail-orders/[id]/customer | Session | Manual customer pick, optional keyword save. |
| PATCH | /api/mail-orders/[id]/lock | Session | Toggle `isLocked`. |
| POST | /api/mail-orders/[id]/split | Session | Manual split. |
| GET | /api/mail-orders/[id]/original-lines | Session | Fetch both halves for original view. |
| POST | /api/mail-orders/lines/[lineId]/resolve | Session | Resolve unmatched line + keyword save. |
| PATCH | /api/mail-orders/lines/[lineId]/status | Session | Set found/not-found + reason. API expects snake_case reasons. |
| GET | /api/mail-orders/skus | Session | Search `mo_sku_lookup` for resolve dropdown. |
| GET | /api/mail-orders/customers/search | Session | Search `mo_customer_keywords`. |
| GET | /api/mail-orders/keywords | **Public** | Returns `productKeywords`, `baseKeywords`, `customerKeywords`. Parser consumes at startup. |
| POST | /api/mail-orders/re-enrich | Session | Re-enrich last 2 days. Idempotent. |
| GET | /api/mail-orders/debug-enrich | Session | Debug enrichment. |
| POST | /api/mail-orders/learn-customer | Session | Upsert operator correction into `mo_learned_customers`. Fire-and-forget. |
| POST | /api/mail-orders/backfill-customers | Session | TEMPORARY. |

**Middleware bypass:** `/api/mail-orders/ingest` bypasses session auth when `x-hmac-signature` header present. `/api/mail-orders/keywords` excluded from auth entirely.

---

## 8. Frontend files

```
app/(mail-orders)/mail-orders/
  page.tsx                     bare wrapper, force-dynamic
  mail-orders-page.tsx         main client component, viewMode switch (Table | Review)
  mail-orders-table.tsx        12-column table with CodeCell
  review-view.tsx              master-detail split. Primary punching view.
  resolve-line-panel.tsx       unmatched line resolver
  slot-completion-modal.tsx    slot completion + SO email grouping

lib/mail-orders/
  types.ts              TypeScript interfaces (MoOrderLine includes isCarton, cartonCount)
  api.ts                client fetch helpers (includes learnCustomer() fire-and-forget)
  utils.ts              slot assignment, clipboard, grouping, smartTitleCase, volume,
                        getOrderSignals(), getBillLabel(), getOrderFlags(),
                        getSplitDisplayLabel()
                        BATCH_COPY_LIMIT = 14
                        SAP_PASTE_SORT: "email" | "picker" (currently "email")
  customer-match.ts     server-side matching (v2 token scoring)
  delivery-match.ts     server-side ship-to override
  enrich.ts             enrichment engine v3 + carryProduct
  email-template.ts     slot summary HTML builder
```

---

## 9. View modes — Table | Review

Toggle in UniversalHeader title. Visual spec in `CLAUDE_UI.md §25, §29-32`.

### 9.1 Table View

12 parent columns (see `CLAUDE_UI.md §19`). Column toggle with `ALL_COLUMNS` config, `localStorage "mo-column-visibility"`. Dispatch `defaultVisible: false`. 4 always-visible: Time, Customer, SKU, SO No.

Slot sections based on `receivedAt` IST: Morning (<10:30), Afternoon (10:30-13:30), Evening (13:30-16:30), Night (>16:30).

Punched orders: separated to bottom per slot when slot selected. Collapsible "N punched ▸/▾" divider. `T` toggles globally.

Auto-refresh: 30s polling + tab focus refresh via `visibilitychange`.

Search: 19 fields — soName, soEmail, customerName, customerCode, subject, soNumber, remarks, billRemarks, deliveryRemarks, and more.

Default SKU line ordering: email order (controlled by `SAP_PASTE_SORT` constant). Toggle button → picker view. Constant controls clipboard (SAP) sort across both views.

### 9.2 Review View

Master-detail for Deepanshu's SKU confirmation workflow.

**Split:** 320px left (order list) + flex-1 right (detail header 2 rows, SKU table, remarks footer, nav footer).

**Left panel sort:** `receivedAt ASC → bill number ASC → split label ASC`. Punched section sort DESC (most recent first). Badges: Bill N (blue) + split (purple) only. Punched rows show third line `✓ {Name} {HH:MM}`.

**Active line highlight:** yellow-50 bg + yellow-500 left border on first cell.

**Line status overrides:** local `Map<lineId, {found, reason}>` for optimistic UI. Resolved line overrides: `Map<lineId, {skuCode, skuDescription, productName, baseColour, packCode, matchStatus}>`. Both reset on order change.

**Resolve popover:** fixed-position 480px modal. Search input (debounced 300ms) + pack filter chips (1L/4L/10L/20L) + results list. Calls `searchSkus()` + `resolveLine()`. Updates local resolved overrides.

**Auto-advance disabled.** Operators can navigate to punched orders. Clicking a punched order in the left panel stays focused on it.

**Punched-by attribution:** `✓ {Name} {HH:MM}` prepended as first meta item in Row 2 on punched orders, and as third line in left panel rows. Uses `MoOrder.punchedBy`, `punchedAt`. Colour `text-gray-400`. Name via `smartTitleCase()`.

**Print button:** 4th icon-only button in Row 2 action cluster (`CLAUDE_UI.md §32`).

**Description toggle:** Long (skuDescription from SAP) vs Short (productName · baseColour). `localStorage` key `mo-review-desc-mode`. Default long.

**Manual split banner:** amber banner shows when `!splitLabel && (totalVol > 1500 || lines > 20)`. Calls `/api/mail-orders/[id]/split`. Pooler retry-poll loop (5 × 400ms) in `handleSplitComplete` handles Supabase transaction-pooler read-after-write lag.

### 9.3 Split labels

DB column `splitLabel` stays `A`/`B`. UI shows via `getSplitDisplayLabel(order)`:
- splitLabel `A` → "Bill 1"
- splitLabel `B` → "Bill 2"
- Compound (sub-split of parser-level bill): parent `Bill 2` + splitLabel `A` → `Bill 2-1`

`getOrderSignals` does NOT emit parent Bill N blue badge when `splitLabel` is set (purple `✂ Bill X-Y` carries the info). Customer name suffix `(Bill X)` stripped from all UI display sites. Email reply template + slot summary preserve suffix for external communication.

---

## 10. Keyboard shortcuts

Architecture rule: Ctrl+ shortcuts MUST be in a separate `useEffect` from single-key shortcuts. Ctrl+ handler uses `document` capture + `stopImmediatePropagation`. Single-key handler early-returns on `e.ctrlKey || e.metaKey`.

| Key | Action |
|---|---|
| Ctrl+C | Smart copy state machine (1st=customer code, 2nd+=batch SKUs, `BATCH_COPY_LIMIT=14`) |
| Ctrl+V | Auto-focus SO Number input (Review: falls back to `input[placeholder="Enter number"]`) |
| E | Open Slot Email modal |
| R | Copy reply template |
| F | Toggle lock/flag |
| N | Jump to next unmatched |
| P | Open customer picker |
| T | Toggle punched visibility |
| / | Focus search |
| ? | Toggle shortcuts panel |
| 1-4 | Jump to slot segment |
| ↑↓ | Navigate orders (Table) / Navigate SKU lines (Review) |
| Tab / Shift+Tab | Next / previous order (Review) |
| Space | Toggle found/not-found on active line (Review) |
| 1-5 | Quick-pick reason when dropdown open (Review) |
| Enter | Expand order (Table) |
| Esc | Cascading close (modal → panel → popover → blur → collapse) |

Review mode key ownership: ↑↓ handled by review-view.tsx (parent skips). Ctrl+C/V handled by parent. Tab/Space/1-5 handled by review-view.tsx.

---

## 11. Manual split (user-initiated)

Server-side auto-split on ingest is removed. Large orders arrive as a single `mo_orders` row.

**Thresholds (banner trigger):** `> 1500L` OR `> 20 lines` (AND `> 1 line`).

**Algorithm (when triggered):** Category-first split via `splitLinesByCategory`. Group by productName → sub-split dominant blocks by packCode → greedy bin-pack with weighted score (`0.5×vol + 0.5×count`). Guard rails for min 8 lines per group.

**Data model:** Original → Group A (`splitLabel="A"`, `splitFromId=null`). New → Group B (`splitLabel="B"`, `splitFromId=orderA.id`). Both `status="pending"`.

**Trigger UI:** amber banner in Review View. Mouse-driven only.

**View Original toggle:** fetches all lines from both halves via `/api/mail-orders/[id]/original-lines`.

---

## 12. Volume system

- `getPackVolumeLiters()` — 20 known values. Values ≥100 are millilitres (100→0.1L, 500→0.5L).
- ML unit stainers: `enrich.ts` appends "ML" suffix when `sku.unit="ML"`. Stored as "50ML" → 0.05L.
- Display: per-line (expanded view), per-order (customer subtext green/amber), per-slot (section header).

---

## 13. Slot completion + SO email

Auto-detect when all orders in slot are punched. Also auto-trigger 15min after slot cutoff. Guard: `triggered` flag ensures only one slot fires at a time. `localStorage` key `mo-slot-email-sent-{date}-{slotName}` prevents re-trigger per slot per date.

Modal: green check, slot stats, SO list grouped by soName (punched + unpunched). Per-SO "Send" button copies HTML email via `ClipboardItem` + opens mailto. Sent SO cards collapse to green ✓. "Copy All SAP" footer. Auto/Manual toggle.

---

## 14. Slot summary email — email-template.ts

`buildSlotSummaryHTML(soName, orders, slotName, date, senderName, senderPhone?) → string`

### Subject

`${slotName} Orders — ${date} | JSW Dulux Surat` (constructed in `slot-completion-modal.tsx`).
e.g. "Morning Orders — 11 Apr 2026 | JSW Dulux Surat".

### Header title

`${slotName} Order Summary` (not "Slot Summary").

### Body wording (locked)

- Opening: `Please find your ${slotName} slot order summary below.`
- Pending note: `These orders will be processed in tomorrow's first slot. We will keep you updated.`
- Footer 1: `Kindly note the order numbers for any future communication regarding these orders.`
- Footer 2: `For any order-related queries, feel free to reach out to us.`
- Sign-off: `Thanks & regards,` (encoded `&amp;`) with 14px top padding.
- Designation: `Billing Team`.
- Phone: hardcoded `+91 7435065023`. `senderPhone` param kept for backward compat but ignored.
- Bottom: `JSW Dulux Ltd — Surat Depot · Do not reply to this email`

### Template design

- 560px centred table, Outlook/OWA safe
- Brand bar: 3px solid #0d9488 top border
- Header two-column: slot title/date left, teal order count panel right (110px flush)
- Section headers: Processed (#0d9488 border), Not Available (#b45309), Pending (#334155)
- Three-column table: serial (24px) | content (name, code) | right data (120px, SO number/time)
- Processed: sorted by `punchedAt DESC`. Hold orders: name `#cbd5e1` + " *". Always shown.
- Not Available: only if `flaggedLines > 0`. Serial per order group. Product·pack + reason.
- Pending: only if `pending.length > 0`. Customer name + "Will process tomorrow" note.
- Total row: "N orders · N processed · N pending · N not available"

### Bill N suffix

Appends `· Bill N` plain text after customer name in processed, pending, not-available sections. No HTML styling (OWA paste strips spans). Normal orders (no bill number) show no suffix. `splitPartLabel()` returns "Bill 1"/"Bill 2".

### Helpers

`zwsp(n)` breaks iOS number detection, `fmtTime(iso)`, `getFirstName()`, `getPendingNote()`, `getReasonLabel()`, `splitPartLabel()`.

### Outlook safety

See `CLAUDE_UI.md §45`.

---

## 15. Reply template

Customer name suffix with Bill N via `getBillLabel()`:
R key reply handler includes Bill N suffix in customer name.

---

## 16. Fini / Generic display toggle

TM and Tint Operator screens default to Fini SKU codes. Toggle (in-memory only) flips to Generic (SAP-sent master code). Resets to Fini on every page load. Delivery Challan document is Fini-always with no toggle. Fallback: when Generic code has no Fini mapping, display stays on SAP regardless of toggle.

**Files:**
- `lib/fini-resolver.ts` — `resolveFiniMap(genericCodes[]) → Map<generic, { material, description }>`. Dedupes, skips DB on empty, `orderBy: material asc` (deterministic first-wins for 1:N).
- `types/sku-display.ts` — `SkuDisplay` type (with `sap` always present + `fini` nullable), `buildSkuDisplay()` for API route construction, `pickSkuDisplay(skuDisplay, mode)` for component render.
- `lib/hooks/use-sku-display-mode.ts` — React hook. Default `"fini"` on every mount. Same-page fan-out via custom `orbitoms:sku-display-mode` event.
- `components/tint/sku-display-toggle.tsx` — toggle component.

API routes return `skuDisplay: { sap, fini | null }` payload per line. Index: `idx_mo_sku_lookup_ref_material` on `mo_sku_lookup.refMaterial`.

---

## 17. Terminology

"SO number" / "order number" in email context = SAP sale order number. Used for SO ↔ depot communication only. Dealers receive invoices, not order numbers.

---

## 18. Keyword management — SQL batch rules

- Never add colour names as product keywords. Use `carryProduct` hint instead.
- **Removed from GLOSS product:** GOLDEN BROWN, GOLDEN YELLOW, PHIROZA, DA GREY, SMOKE GREY, OXFORD BLUE, SAND STONE, SANDSTONE, SINGLE RED, SIGNAL RED, DARK BROWN.
- **Removed from mo_product_keywords:** GOLDEN YELLOW→FAST YELLOW, LEMON YELLOW→FAST YELLOW.
- Run SQL keyword inserts SEPARATELY from SKU inserts (separate transaction batches). Combined runs cause rollback on duplicate key error.

### GEN SKU deletion rule

Non-retail "GEN" tinting machine SKUs cause non-deterministic matches when they share combo keys with retail SKUs. Eight deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.

### Generic-as-Fini cleanup pattern

If "X" emails return Generic codes (e.g. IN284xxxxx) instead of Fini codes (IN283xxxxx), root cause is Generic codes inserted as standalone `material` rows instead of stored as `refMaterial` against the Fini row. Fix: delete the standalone Generic row, populate `refMaterial` + `refDescription` on the matching Fini row.

---

## 19. Landmines

- **`focus-mode-view.tsx`** — file should be deleted; Focus Mode view is discarded. If you see `viewMode === "focus"` branches, the cleanup is incomplete.
- **`buildReplyTemplate`** — if still located inside `focus-mode-view.tsx`, move to `lib/mail-orders/utils.ts` as a shared helper before deleting the file.
- **viewMode type** — narrow to `"table" | "review"` only.
- **Auto-split rawText preservation** — when auto-split historically divided order A/B, lines from same `originalLineNumber` lost rawText. ~2 lines affected per large order historically. Server-side auto-split is now removed, so this only affects historical data.
- **SO name "(jsw)" prefix** — `cleanSubject` should strip but still shows in review view left panel and meta row (cosmetic).
- **SKU code "IN" prefix inconsistency** — some show without prefix (data issue).
- **Email Hold order dimming** — `color:#cbd5e1` stripped by OWA paste. Only `*` suffix distinguishes.
- **Email sort order** — Processed section sorts by `punchedAt DESC`. Bill 1 and Bill 10 from same customer can scatter.
- **Products missing from `mo_sku_lookup`:**
  - VT Velvetino — not in table
  - WS Metallic Silver/Gold — not in table
  - SR Spray Paint — SKUs exist but pack=400ML mismatch
  - PU Interior Glossy — product doesn't exist
  - DIY Spray products — not in table
  - M900 — 13 SKUs needed (BW + 90/92/93 BASE × 4 packs), no SAP material codes yet
- **PU PRIME WHITE SEALER keyword** maps to nonexistent product.
- **Truncated material codes** — "320768" prefix matching ambiguity.
- **`CATEGORY_KEYWORDS`** in `enrich.ts` — dead code, can be removed.
- **`mo_sku_lookup` GLOSS Brilliant White state:** 7 IN28301xxx Fini rows survive. 4 have `refMaterial` populated. 3 still null (10L IN28301082, 100ML IN28301098, 200ML IN28301074) — Generic codes not yet supplied by depot.

---

*Mail Orders v1.1 · Schema v27.2 · Parser v6.5 · Enrichment v3*
