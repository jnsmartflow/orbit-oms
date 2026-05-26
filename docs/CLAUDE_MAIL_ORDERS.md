# CLAUDE_MAIL_ORDERS.md — Mail Orders Module
# v1.2 · Schema v27.4 · Parser v6.5 · Enrichment v3
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Primary user: Deepanshu Thakur (billing_operator id=25). Secondary: Bankim (id=26).

---

## 1. Architecture

```
FW: email → Outlook (surat.order@outlook.com)
  → Parse-MailOrders-v6_5.ps1
  → POST /api/mail-orders/ingest (HMAC auth)
  → enrich.ts v3 (generate → verify → rank) with carryProduct fallback
  → customer-match.ts v2 (token scoring + learned auto-match)
  → delivery-match.ts (ship-to override)
  → mo_orders + mo_order_lines + mo_order_remarks
  → /mail-orders page (Table or Review view)
  → SO Number saved → auto-punches

SAP import creates orders with soNumber:
  → applyMailOrderEnrichment() matches mo_orders by soNumber
  → Applies dispatchStatus, priorityLevel, remarks, overrides, orderDateTime
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

### Reference

```
mo_product_keywords        ~1,076 rows. Must NOT contain base colour words.
mo_base_keywords           ~267 rows.
mo_sku_lookup              ~1,599 rows. material UNIQUE. piecesPerCarton.
                           refMaterial (Generic/master), refDescription.
mo_customer_keywords       Auto-grows on operator picks
mo_learned_customers       Operator correction log
mo_order_form_index        Legacy. Used by public /order. NOT used by /place-order.
```

Index: `idx_mo_sku_lookup_ref_material` on `mo_sku_lookup.refMaterial`. Coverage: ~26.5%.

---

## 3. Parser — Parse-MailOrders-v6_5.ps1

**Location:** `C:\Users\HP\OneDrive\VS Code\mail-orders\` (outside git). UTF-8 with BOM.

**Architecture: Normalize → Split → Extract**

1. **Normalize-Line** — carton suffix detection, piece suffix stripping, divider normalization, unit normalization, noise word stripping, equals separator. Digit-dash guard: skip when preceded by stainer code (23 hardcoded: NO, BU, RE, OR, XR, MA, GR, YE, XY, BLK, WHT, COB, COG, HEY, HER, FFR, OXR, WH, YOX, TBL, MAG, LFY, GRN).
2. **Comma split.**
3. **Extract-ProductLines** — P0-P10 priority patterns per segment.

### Parser features

- Fetches keywords from API at startup (`GET /api/mail-orders/keywords`)
- Bill splitting: `emailEntryId = {original}__Bill{N}`
- Section splitting: `emailEntryId = {original}__Sec{N}` (multi-customer)
- Carry-forward via `$script:CarryProduct`, `$script:CarryBase`
- Word-boundary keyword matching via `Test-KeywordWB`
- Carton flag per-segment
- Multi-customer split (Pass 1): customer headers (`N.Customer Name`). If 2+ → each section POSTed separately with `bodyCustomerName`/`bodyCustomerCode`.
- Multi-delivery split (Pass 2, only if <2 customer headers): delivery headers. Each section POSTed as separate bill.
- **Priority:** customer split > delivery split.

### carryProduct hint

Send-ToApi compares longest product keyword length vs longest base keyword length per line. If colour-only line detected, sets `carryProduct` to last line with dominant product keyword. Server retries enrichment with `${carryProduct} ${rawText}` when normal match returns unmatched/partial.

### Zero-skip guarantee

When `$parsed.ProductRows.Count -eq 0`, parser POSTs `$mail.Body` as single raw-text line. Terminal shows `[RAW]` in dark yellow. Every FW: email reaches OrbitOMS.

### P7 $Matches rule (critical)

In any `-and` chain with multiple `-match` operations: regex WITHOUT capture groups FIRST, regex WITH capture groups LAST. Second match overwrites `$Matches`.

### Diagnostic logging (mail_order.log)

- `SCAN`, `CLASSIFY-SKIP`, `CRASH-TRACE`, `PARSED`, `DELIVERY-BLOCK`, `RAW`

### Config (config.txt)

```
ApiBaseUrl=https://orbitoms.in/api/mail-orders/ingest
HmacSecret=<secret>
BaseDir=C:\Users\HP\OneDrive\VS Code\mail-orders
OutlookAccount=surat.order@outlook.com
CheckInterval=10
```

---

## 4. Enrichment engine — lib/mail-orders/enrich.ts v3

### Algorithm: Generate → Verify → Rank (6 phases)

1. **Material code check** — direct lookup against `/^(IN)?\d{5,10}$/`.
2. **Product keyword search** — ALL matching keywords in FULL text (word-boundary regex, pre-compiled).
3. **Base keyword search** — ALL matching bases. Also numbered bases via `\b(9[0-8])\b`.
4. **Product-aware base resolution (4 strategies):**

| Strategy | Products | Behaviour | Bonus |
|---|---|---|---|
| DIRECT | 82 (primers, thinners, clears, putty, tinters) | No base needed | +3 |
| FIXED | 16 (SmartChoice, OPQ, IBC Advance, etc.) | Single predetermined base | +2 |
| NUMBERED | 26 (Promise, WS Max/Protect/Powerflexx) | 90-98 BASE + BW | +1 match, -1 fallback |
| COLOUR | 14 (Gloss, Super Satin, Promise Enamel) | Named colour bases + BW/ADVANCE fallback | 0 match, -1 fallback |

5. **Candidate generation + SKU verification** against `skuByCombo` map.
6. **Scoring:** `productKeywordLength + baseKeywordLength + strategyBonus`. Category keyword penalty: -2. Cross-product tie guard. Base-presence tie guard. Tie → `partial`.

### BW-fallback with unrecognized base

If winner is fallback and text has ≥3 unrecognized alphabetic chars after product keyword → `partial` with "Unrecognized base: {TEXT}".

### Pack handling

- `PACK_ROUND` — fractional → standard
- `PACK_EXPAND` — bidirectional (1↔2 Sadolin, 1→0.925/0.9, etc.)
- Pack rounding before candidate generation
- Normalize SKU pack codes: float to int

### Carton multiplication

When `isCarton=true` and SKU matched: `finalQty = qty × sku.piecesPerCarton`.

### enrichLine signature

```ts
enrichLine(
  rawText, packCode, skuMaps, productProfiles, keywordRegexes,
  productKeywords, baseKeywords, productByKeyword, baseByKeyword,
  options?, carryProduct?
)
```

11th param `carryProduct`. `enrichLineCore()` is private. Wrapper retries core with `${carryProduct} ${rawText}` when core returns unmatched/partial.

### Debug endpoint

`GET /api/mail-orders/debug-enrich?text=...&pack=...&carryProduct=...`
Response includes `matchedProductKeywords`, `productProfile`.

### Re-enrich endpoint

`POST /api/mail-orders/re-enrich` — re-enriches last 2 days. Idempotent. Only upgrades match status. Must be called from logged-in browser:
```js
fetch('/api/mail-orders/re-enrich', { method: 'POST' }).then(r => r.json()).then(console.log)
```

### Current match rate

~98.2% on 2,366 real lines.

---

## 5. Customer matching — customer-match.ts v2

### parseSubject()

Strips FW/RE prefixes, "Urgent", "Order" prefix. Extracts customer code (4+ digits). Scans for remark signals. Returns `{ customerCode, customerName, remarks[] }`.

### matchCustomer()

Code prefix → exact lookup. Keyword/name substring matching.
Score: exact equality (100/90) > substring (length-based).
Decisive winner if `top ≥ 90` and `second < 50`.
Returns: `exact` (1), `multiple` (2+ with top 10), `unmatched` (0).

### matchByKeywords() — token-based scoring

Rarity-weighted token overlap.

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

Parser extracts customer name/code from email body. Body overrides subject only when:
- subject returned non-exact AND body returns exact, OR
- body returns multiple when subject was unmatched

### Learned auto-match guards

Operator picks → saved to `mo_learned_customers`. Auto-match triggers ONLY when ALL four guards pass:
1. `hitCount >= 3`
2. `uniqueOperators >= 2`
3. No conflict
4. `customerCode` still exists in `mo_customer_keywords`

If guards fail but learned candidate exists → `unmatched` upgraded to `multiple`.

---

## 6. Ship-to override — delivery-match.ts

`matchDeliveryCustomer()`: searches `delivery_point_master` from `deliveryRemarks`. Override if different customer code found. Appends `[→ CustomerName (Code)]` to `deliveryRemarks`.

**Cross billing ≠ shipToOverride.**

### splitDeliveryRemarks helper (in lib/mail-orders/utils.ts)

```ts
splitDeliveryRemarks(
  deliveryRemarks: string | null,
  shipToOverride: boolean
): {
  shipToName: string | null;
  shipToCode: string | null;
  deliveryInstruction: string | null;
}
```

Parses the `[→ Name (Code)]` suffix. Returns parsed identity + leftover instruction text. Consumed by Review View loader to build `ShipToCard` props.

Example: `"Shree Rang Bhandar — leave at gate by 6pm [→ Shree Rang Bhandar (447636)]"` splits into:
- shipToName = "Shree Rang Bhandar"
- shipToCode = "447636"
- deliveryInstruction = "leave at gate by 6pm" → goes into InstructionsStrip

### Ship-to extraction rule

```
if (shipToOverride && deliveryRemarks has "[→ Name (Code)]" suffix) {
  shipToName / shipToCode parsed from suffix
} else if (shipToOverride && no suffix) {
  shipToName = raw text before any "—" or "/"
} else {
  // shipToOverride === false → ShipToCard mirrors Bill-to
}
```

---

## 7. API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | /api/mail-orders/ingest | HMAC | Receives from PowerShell. Accepts `carryProduct?`, `bodyCustomerName?`, `bodyCustomerCode?`. No server-side auto-split. |
| GET | /api/mail-orders | Session | Fetches by date (IST) + status filter. Two-batch ship-to lookup against `mo_customer_keywords`. Response includes `shipToArea`, `shipToDeliveryType`. |
| PATCH | /api/mail-orders/[id]/punch | Session | Mark punched. |
| PATCH | /api/mail-orders/[id]/so-number | Session | Save soNumber, auto-punch. |
| PATCH | /api/mail-orders/[id]/customer | Session | Manual customer pick. |
| PATCH | /api/mail-orders/[id]/lock | Session | Toggle `isLocked`. |
| POST | /api/mail-orders/[id]/split | Session | Manual split. |
| GET | /api/mail-orders/[id]/original-lines | Session | Fetch both halves for original view. |
| POST | /api/mail-orders/lines/[lineId]/resolve | Session | Resolve unmatched line. |
| PATCH | /api/mail-orders/lines/[lineId]/status | Session | Set found/not-found + reason. snake_case reasons. |
| GET | /api/mail-orders/skus | Session | Search `mo_sku_lookup`. |
| GET | /api/mail-orders/customers/search | Session | Search `mo_customer_keywords`. |
| GET | /api/mail-orders/keywords | **Public** | Parser consumes at startup. |
| POST | /api/mail-orders/re-enrich | Session | Re-enrich last 2 days. Idempotent. |
| GET | /api/mail-orders/debug-enrich | Session | Debug enrichment. |
| POST | /api/mail-orders/learn-customer | Session | Upsert into `mo_learned_customers`. Fire-and-forget. |

**Middleware bypass:** `/api/mail-orders/ingest` bypasses session auth when `x-hmac-signature` header present. `/api/mail-orders/keywords` excluded entirely.

---

## 8. Frontend files

```
app/(mail-orders)/mail-orders/
  page.tsx                     bare wrapper, force-dynamic
  mail-orders-page.tsx         main client, viewMode switch (Table | Review)
  mail-orders-table.tsx        12-column table with CodeCell + SignalPill
  review-view.tsx              master-detail split. Primary punching view.
  resolve-line-panel.tsx       unmatched line resolver
  slot-completion-modal.tsx    slot completion + SO email grouping

components/mail-orders/
  signal-pill.tsx              shared SignalPill component
  bill-to-card.tsx             BillToCard with optional code-click + popover slot
  ship-to-card.tsx             ShipToCard with isOverride amber-bar pattern
  meta-ribbon.tsx              SO/time/vol/match/punched + action buttons + Punch slot
  instructions-strip.tsx       3-dot category strip (returns null when all empty)

lib/mail-orders/
  types.ts              MoOrderLine (isCarton, cartonCount), OrderSignal (with card field)
  api.ts                client fetch helpers (learnCustomer fire-and-forget)
  utils.ts              slot, clipboard, grouping, smartTitleCase, volume,
                        getOrderSignals(), getBillLabel(), getOrderFlags(),
                        getSplitDisplayLabel(), splitDeliveryRemarks()
                        BATCH_COPY_LIMIT = 14
                        SAP_PASTE_SORT = "email"
  customer-match.ts     server-side matching (v2)
  delivery-match.ts     server-side ship-to override
  enrich.ts             enrichment engine v3 + carryProduct
  email-template.ts     slot summary HTML builder
```

**`focus-mode-view.tsx` is deleted** (was orphan, removed 2026-05-20 in Review View redesign commit `6dafad8e`).

---

## 9. View modes — Table | Review

Toggle in UniversalHeader title. Visual spec in `CLAUDE_UI.md §21, §28-32`.

### 9.1 Table View

12 parent columns. Column toggle via `ALL_COLUMNS` config, `localStorage "mo-column-visibility"`. Dispatch `defaultVisible: false`. 4 always-visible: Time, Customer, SKU, SO No.

Slot sections based on `receivedAt` IST: Morning (<10:30), Afternoon (10:30-13:30), Evening (13:30-16:30), Night (>16:30).

Punched orders: separated to bottom per slot. Collapsible divider. `T` toggles globally.

Auto-refresh: 30s polling + `visibilitychange`.

Search: 19 fields.

### 9.2 Review View — two-card model

Master-detail. 320px left + flex-1 right.

Page background: `bg-gray-50`. Cards + SKU table sit as white islands.

**Right-panel structure:**

```
┌─────────────────────────────────────────────────────────────────┐
│  BillToCard          │   ShipToCard                              │
├─────────────────────────────────────────────────────────────────┤
│  MetaRibbon (SO · time · vol · match · punched · actions · #)  │
├─────────────────────────────────────────────────────────────────┤
│  InstructionsStrip (delivery · bill · notes — dot-prefixed)     │
├─────────────────────────────────────────────────────────────────┤
│  Manual split banner (when applicable)                          │
├─────────────────────────────────────────────────────────────────┤
│  SKU TABLE (inside white wrapper, scrollable)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Left panel sort:** `receivedAt ASC → bill number ASC → split label ASC`. Punched section sort DESC.

**Active line highlight:** yellow-50 bg + yellow-500 left border. Resets on order change.

**Line status overrides:** local `Map<lineId, {found, reason}>` for optimistic UI. Resolved line overrides: `Map<lineId, {skuCode, ..., matchStatus}>`. Both reset on order change.

**Resolve popover:** fixed-position 480px modal. Search input (debounced 300ms) + pack filter chips + results list.

**Auto-advance disabled.** Operators can navigate to punched orders.

**Punched-by attribution:** `✓ {Name} {HH:MM}` prepended as first meta item on punched orders, and as third line in left panel.

**Print button:** 4th icon-only button in MetaRibbon (`CLAUDE_UI.md §28`).

**Description toggle:** `localStorage` key `mo-review-desc-mode`. Default long.

**Manual split banner:** amber when `!splitLabel && (totalVol > 1500 || lines > 20)`. Pooler retry-poll loop (5 × 400ms).

### 9.3 OrderSignal.card routing

`OrderSignal` interface has mandatory `card: "bill" | "ship"` field. Classification at emit site (one place: `getOrderSignals()` in utils.ts), consumers stay dumb.

| Signal | Type | Card |
|---|---|---|
| OD, CI, Bounce | blocker | bill |
| Bill N | bill | bill |
| Bill Tomorrow, Cross XYZ | attention | bill |
| ✂ Bill X-Y, ⚠ Split | split | bill |
| 7 Days, Extension, DPL | info | bill |
| Truck Order (renamed from "Truck") | truck-order | bill |
| Urgent | attention | ship |
| Challan | info | ship |
| Hold / Dispatch / dispatchStatus | status | ship |

**Removed:** `→ Ship-to` signal — replaced by ShipToCard amber-bar + captured pill.

`getOrderSignals` does NOT emit parent Bill N blue badge when `splitLabel` is set (purple ✂ badge already carries it).

### 9.4 Bill-to picker preservation (BillToCard props)

```ts
interface BillToCardProps {
  customerName, customerCode, customerArea, customerMatchStatus, deliveryType,
  signals: OrderSignal[],
  onCodeClick?: () => void,
  popoverSlot?: React.ReactNode,
  chipFallbackLabel?: string,
}
```

- `customerMatchStatus === "exact"` → chip read-only, no props passed
- `customerMatchStatus === "multiple"` → `chipFallbackLabel = "N found ▾"`, `onCodeClick` toggles popover
- `customerMatchStatus === "unmatched"` → `chipFallbackLabel = "Search…"`, popover with search input

The popover content lives in `review-view.tsx` and is passed verbatim as `popoverSlot`. Only the positioning wrapper moved into BillToCard.

### 9.5 ShipToCard polish

- `isOverride=false` → mirrors Bill-to fully (code chip gray default, NOT match-modulated). No italic tagline.
- `isOverride=true` → 3px amber left bar via `before:` pseudo + amber `⚑ captured` pill + identity from `splitDeliveryRemarks(...)`

### 9.6 Loader extension

`GET /api/mail-orders` does two sequential Prisma queries (NOT `$transaction`):
1. Existing bill-to batch against `mo_customer_keywords`
2. NEW ship-to batch against `mo_customer_keywords` by ship-to codes parsed from `deliveryRemarks` of orders where `shipToOverride === true`

Response: `shipToArea: string | null`, `shipToDeliveryType: string | null`. Always attached (null when not applicable).

### 9.7 Known small regression (acceptable)

**Unmatched picker: one extra click.** Pre-redesign, "unmatched" rendered an amber-bordered search INPUT directly. Post-redesign, shows red "Search…" chip; click opens popover with autofocus input. Discussed during planning, accepted.

### 9.8 Split labels

DB column `splitLabel` stays `A`/`B`. UI via `getSplitDisplayLabel(order)`:
- `A` → "Bill 1"
- `B` → "Bill 2"
- Compound: parent `Bill 2` + splitLabel `A` → `Bill 2-1`

Customer name suffix `(Bill X)` stripped from UI display. Email reply + slot summary preserve suffix.

---

## 10. Keyboard shortcuts

Ctrl+ shortcuts MUST be in a separate `useEffect` from single-key. Ctrl+ uses `document` capture + `stopImmediatePropagation`. Single-key early-returns on `e.ctrlKey || e.metaKey`.

| Key | Action |
|---|---|
| Ctrl+C | Smart copy (1st=customer code, 2nd+=batch SKUs, `BATCH_COPY_LIMIT=14`) |
| Ctrl+V | Auto-focus SO Number input |
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
| Esc | Cascading close |

Review mode key ownership: ↑↓ handled by review-view.tsx. Ctrl+C/V handled by parent. Tab/Space/1-5 handled by review-view.tsx.

---

## 11. Manual split (user-initiated)

Server-side auto-split on ingest is removed.

**Thresholds (banner trigger):** `> 1500L` OR `> 20 lines` (AND `> 1 line`).

**Algorithm:** Category-first split via `splitLinesByCategory`. Group by productName → sub-split dominant blocks by packCode → greedy bin-pack with weighted score (`0.5×vol + 0.5×count`). Guard rails for min 8 lines per group.

**Data model:** Original → Group A (`splitLabel="A"`, `splitFromId=null`). New → Group B (`splitLabel="B"`, `splitFromId=orderA.id`). Both `status="pending"`.

**View Original:** fetches all lines from both halves via `/api/mail-orders/[id]/original-lines`.

---

## 12. Volume system

- `getPackVolumeLiters()` — 20 known values. Values ≥100 are millilitres.
- ML unit stainers: `enrich.ts` appends "ML" suffix when `sku.unit="ML"`.
- Display: per-line, per-order (customer subtext green/amber), per-slot (section header).

---

## 13. Slot completion + SO email

Auto-detect when all orders in slot are punched. Also auto-trigger 15min after slot cutoff. Guard: `triggered` flag. `localStorage` key `mo-slot-email-sent-{date}-{slotName}`.

Modal: green check, slot stats, SO list grouped by soName. Per-SO "Send" copies HTML email via `ClipboardItem` + opens mailto. Auto/Manual toggle.

---

## 14. Slot summary email — email-template.ts

`buildSlotSummaryHTML(soName, orders, slotName, date, senderName, senderPhone?) → string`

### Subject

`${slotName} Orders — ${date} | JSW Dulux Surat`

### Header title

`${slotName} Order Summary`

### Body wording (locked)

- Opening: `Please find your ${slotName} slot order summary below.`
- Pending: `These orders will be processed in tomorrow's first slot. We will keep you updated.`
- Footer 1: `Kindly note the order numbers for any future communication regarding these orders.`
- Footer 2: `For any order-related queries, feel free to reach out to us.`
- Sign-off: `Thanks & regards,` (encoded `&amp;`)
- Designation: `Billing Team`
- Phone: hardcoded `+91 7435065023`
- Bottom: `JSW Dulux Ltd — Surat Depot · Do not reply to this email`

### Template design

- 560px centred table, Outlook/OWA safe
- Brand bar: 3px solid #0d9488 top
- Header two-column: slot title/date left, teal order count panel right (110px)
- Section headers: Processed (#0d9488), Not Available (#b45309), Pending (#334155)
- Three-column table: serial (24px) | content | right data (120px)
- Processed: sorted `punchedAt DESC`. Hold orders: name `#cbd5e1` + " *". Always shown.
- Not Available: only if `flaggedLines > 0`. Product·pack + reason.
- Pending: only if `pending.length > 0`. "Will process tomorrow".
- Total row: "N orders · N processed · N pending · N not available"

### Bill N suffix

Plain text `· Bill N` after customer name. No HTML styling (OWA strips spans). `splitPartLabel()` returns "Bill 1"/"Bill 2".

### Outlook safety

See `CLAUDE_UI.md §52`.

---

## 15. Reply template

R key reply handler includes Bill N suffix in customer name via `getBillLabel()`.

---

## 16. Fini / Generic display toggle

TM and Tint Operator screens default to Fini SKU codes. Toggle (in-memory only) flips to Generic. Resets to Fini on page load. Delivery Challan document is Fini-always with no toggle.

**Files:**
- `lib/fini-resolver.ts` — `resolveFiniMap(genericCodes[]) → Map`. Dedupes, skips DB on empty, `orderBy: material asc`.
- `types/sku-display.ts` — `SkuDisplay` type, `buildSkuDisplay()`, `pickSkuDisplay()`.
- `lib/hooks/use-sku-display-mode.ts` — React hook. Default `"fini"` on every mount. Same-page fan-out via custom event.
- `components/tint/sku-display-toggle.tsx`.

API routes return `skuDisplay: { sap, fini | null }` payload per line.

---

## 17. Keyword management — SQL rules

- Never add colour names as product keywords. Use `carryProduct` hint.
- **Removed from GLOSS product:** GOLDEN BROWN, GOLDEN YELLOW, PHIROZA, DA GREY, SMOKE GREY, OXFORD BLUE, SAND STONE, SANDSTONE, SINGLE RED, SIGNAL RED, DARK BROWN.
- **Removed:** GOLDEN YELLOW→FAST YELLOW, LEMON YELLOW→FAST YELLOW.
- Run SQL keyword inserts SEPARATELY from SKU inserts.

### GEN SKU deletion rule

Eight deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.

### Generic-as-Fini cleanup pattern

If "X" emails return Generic codes instead of Fini, root cause is Generic codes inserted as standalone `material` rows instead of stored as `refMaterial` against the Fini row. Fix: delete the standalone Generic row, populate `refMaterial` + `refDescription` on the matching Fini row.

---

## 18. Landmines

- **Auto-split rawText preservation** — historical data only. Server-side auto-split removed.
- **SO name "(jsw)" prefix** — `cleanSubject` should strip but cosmetic instances persist.
- **SKU code "IN" prefix inconsistency** — some show without prefix.
- **Email Hold dimming** — `color:#cbd5e1` stripped by OWA paste. Only `*` suffix distinguishes.
- **Email sort** — Processed sorts by `punchedAt DESC`. Bill 1 and Bill 10 from same customer can scatter.
- **Products missing from `mo_sku_lookup`:**
  - VT Velvetino — not in table
  - WS Metallic Silver/Gold — not in table
  - SR Spray Paint — pack=400ML mismatch
  - PU Interior Glossy — product doesn't exist
  - DIY Spray — not in table
  - M900 — 13 SKUs needed, no SAP codes yet
- **PU PRIME WHITE SEALER keyword** maps to nonexistent product.
- **Truncated material codes** — "320768" prefix matching ambiguity.
- **`CATEGORY_KEYWORDS`** in `enrich.ts` — dead code.
- **`mo_sku_lookup` GLOSS Brilliant White state:** 3 IN28301xxx Fini rows still have null `refMaterial` (10L IN28301082, 100ML IN28301098, 200ML IN28301074) — Generic codes not yet supplied.

---

*Mail Orders v1.2 · Schema v27.4 · Parser v6.5 · Enrichment v3*
