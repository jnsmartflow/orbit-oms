# CLAUDE_MAIL_ORDERS.md — Mail Orders Module
# v1.7 · Schema v27.10 · Parser v6.5 · Enrichment v3 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

Primary user: Deepanshu Thakur (billing_operator id=25). Secondary: Bankim (id=26).

---

## 1. Architecture

**Parser inbox unchanged:** the parser watches `surat.order@outlook.com`. Place-Order surfaces (`/po`, `/place-order`) now send to `surat.depot@akzonobel.com`, which **auto-forwards into** the Outlook parser inbox — so `OutlookAccount` config + parser are untouched (`CLAUDE_CORE.md §8`, `CLAUDE_PLACE_ORDER.md §11`).

```
FW: email → Outlook (surat.order@outlook.com)  ← AkzoNobel front-door forwards in
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

### 3.1 Parser v7.2 — App-format extension [LIVE]

**CORRECTED 2026-07-15 — this was wrongly documented as "DEPLOY PENDING."** The depot PC is
confirmed running v7.2: a real test app-order (Ambika Enterprise 3296171, 2026-07-15) came back with
a `Dispatch:` tag in its parsed output — that tag is **app-format-only**, the human parser path
cannot produce it. Deploy already happened; treat this feature as live, not pending.

The depot PC (Windows, PS 5.1) has a second class of inbound email: orders placed via the OrbitOMS app (`/place-order`) that arrive as structured app-format emails. These have a `Bill To:` header as the first content line — distinct from human-written order emails.

**Script:** `docs/Parser/Parse-MailOrders-V7.ps1` (v7.2) — editing/repo copy. **Live on the depot PC as of at least 2026-07-15** (confirmed above). Deploy is manual: back up live file → paste v7.2 over it — kept here as the redeploy procedure, not as a pending step.

**Sorter — `Test-IsAppFormat`:**
- Strips blank lines from body top
- Checks if first real content line starts with `"Bill To:"` (case-insensitive)
- Returns `$true` → routed to `Parse-AppBody`; else falls through to existing `Parse-EmailBody` (human path untouched)

**App email template (required `Bill To:` first, rest optional):**
```
Bill To: {CustomerName} ({CustomerCode})
Ship To: {ShipToName} ({ShipToCode})     ← optional
Dispatch: {Dispatch|Hold}                ← optional
Priority: {Normal|Urgent}               ← optional
Remark: {free text}                     ← optional
Note: {free text}                       ← optional
{blank line}
{product lines — same format as human emails}
```

**`Parse-AppBody` label→field mapping:**

| Label | Extracted field |
|---|---|
| `Bill To:` | `customerName` + `customerCode` (pattern: `Name (Code)`) |
| `Ship To:` | sets `bodyShipToOverride`, extracted as separate delivery remark |
| `Dispatch:` | `AppDispatchStatus` (→ `dispatchStatus` via mapping) |
| `Priority:` | `AppDispatchPriority` (→ `dispatchPriority`) |
| `Remark:` | appended to remarks |
| `Note:` | appended to remarks |

**Return keys (Parse-AppBody):** all keys that `Parse-EmailBody` returns, PLUS `AppDispatchStatus`, `AppDispatchPriority`, `AppShipToOverride`. The ingest server already handles these extra keys; no server-side change needed.

**Main-loop changes (2 edits only):**
1. `$isApp = Test-IsAppFormat $mail.Body` call after body extraction
2. `if ($isApp) { $parsed = Parse-AppBody $mail.Body } else { $parsed = Parse-EmailBody ... }`

**Engineering notes:** byte-for-byte additive — human path (`Parse-EmailBody`) is NOT modified. UTF-8 BOM required on the live file (PS 5.1 quirk — CORE §3). 

**Test harness:** `docs/Parser/test-app-parser.ps1` — 21/21 assertions pass. Re-run after any edit to the parser.

**New remark types from app-format:** `Bounce` and `DTS` (from `Remark:` / `Note:` fields). Signal badges for these are deferred — parser delivers the text; badge wiring needs meaning clarification first. `Truck Order` already handled by existing signal catalog.

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
  options?, carryProduct?,
  tableC?: Map<string,string>, tableCResolver?: Map<string,SkuEntry>
)
```

11th param `carryProduct`. 12th/13th `tableC`/`tableCResolver` — optional, injected by ingest route for the Table C fast-path (see §4.1). `enrichLineCore()` is private. Wrapper retries core with `${carryProduct} ${rawText}` when core returns unmatched/partial.

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

### 4.1 Table C exact-name fast-path [LIVE]

**Deployed:** commit `da219238` (5 files, +282/−6). Table C only fires on exact `productName`
matches, which only come from structured app-format emails — its precondition (the app-format
parser, §3.1) is now confirmed deployed, but a live Table-C-hit verification in the ingest logs
has not been separately re-confirmed since that deploy. Check `mail_order.log` for `[APP]` lines
+ Table C hits before treating this as fully proven in production.

**Architecture — stacked:**
```
enrichLine called:
  1. tableCKey(nameUpper, cleanPackCode) → lookup in tableC Map
     HIT  → exact SKU returned immediately (skips keyword scoring)
     MISS → keyword scoring proceeds as before (unchanged)
```

**Key construction:** `tableCKey(productName.toUpperCase(), cleanPackCode(packCode))` — matches the key format used when the map was built from `mo_sku_lookup_v2` in `buildTableC()`.

**Coverage:** 1,343 distinct keys built from V2 catalogue. 15 keys had collisions (same key, 2+ SKUs) — excluded from the map for safety. 1,328 usable keys. Coverage: ~99.7% on matched app-format lines.

**Files:**
- `lib/mail-orders/table-c.ts` — `buildTableC()` (returns the `Map<string,string>` of tableCKey→skuCode), `tableCKey()`, `cleanPackCode()`. Also exports `buildComboSiblings()` (feeds the Alt-SKU column — §9.2).
- `lib/mail-orders/table-c-context.ts` (NEW) — `buildTableCContext()`. Called ONCE per `POST /api/mail-orders/ingest` request; builds and returns `{ tableC, tableCResolver }` for threading into each `enrichLine` call.
- `lib/mail-orders/enrich.ts` — `enrichLine` + `enrichLineCore` accept the optional `tableC`/`tableCResolver` params; Table C check runs before PACK_ROUND inside `enrichLineCore` at step 2c.
- `app/api/mail-orders/ingest/route.ts` — calls `buildTableCContext()` once, threads maps into `enrichLine`.

**Deferred items:**
- Re-enrich path (`POST /api/mail-orders/re-enrich`) does NOT yet call `buildTableCContext`. Deferred until app orders are flowing and re-enrich is needed.
- 13 double-primary fix: 13 SKUs in `mo_sku_lookup_v2` have `isPrimary=true` on both the Fini row AND the Generic row, causing conflicts. Audit + fix needed before full Table C go-live.
- Live verification: once the app-format parser is deployed, smoke-test that Table C hits appear in the ingest logs.

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

**Customer onboarding runbook:** `docs/runbooks/customer-intake.sql` — step-by-step SQL template for adding one new customer to BOTH `mo_customer_keywords` (search) and `delivery_point_master` (master record); a customer added to only one half-works.

---

## 6. Ship-to override — delivery-match.ts

`matchDeliveryCustomer()`: searches `delivery_point_master` from `deliveryRemarks`. Override if different customer code found. Appends `[→ CustomerName (Code)]` to `deliveryRemarks`.

**Cross billing ≠ shipToOverride.**

### Resolved id now carried through, alongside the existing text encoding (2026-07-07) [LIVE]

Shipped alongside the Support-side inline picker (`CLAUDE_SUPPORT.md §4.18`) — this is the mail-order-side half of the same feature, mirroring how `dispatchStatus` already flows from `mo_orders` into `orders` via enrichment (§4 above).

- **`matchDeliveryCustomer()` widened:** the `findMany` on `delivery_point_master` now also selects `id: true` (previously fetched only `customerCode` + `customerName` — the id was queried but never returned). Return type widened to include `customerId: number`; an override-hit result now includes `customerId: match.id`. Null-return paths (not-found / same-customer) unchanged. **The `[→ Name (Code)]` suffix text encoding into `deliveryRemarks` is UNCHANGED** — the id is stored ALONGSIDE it, not instead of it.
- **`app/api/mail-orders/ingest/route.ts` — the `mo_orders.create`:** on an override hit (`deliveryMatch && deliveryMatch.isOverride`), sets `shipToOverrideCustomerId: deliveryMatch.customerId`. Existing `shipToOverride` flag + `deliveryRemarks` suffix write unchanged.
- **`applyMailOrderEnrichment()` (§4, `app/api/import/obd/route.ts`):** beside the existing `shipToOverride` flag copy (already present, unchanged), now also copies the id:
  ```ts
  if (mailOrder.shipToOverrideCustomerId != null) {
    updateData.shipToOverrideCustomerId = mailOrder.shipToOverrideCustomerId;
  }
  ```
  Uses `!= null` (not truthiness) so a valid id is never dropped. Copies onto `orders` via the existing `orders.updateMany({ where: { soNumber }, data: updateData })` — the same path `dispatchStatus` already uses. No `mo_orders` `findFirst` select change was needed (the whole row is already fetched).
- **`orders.shipToOverrideCustomerId` / `mo_orders.shipToOverrideCustomerId` are new FK columns** — now documented in `CLAUDE_CORE.md` §7.3 / §7.6 (schema v27.9).

**Flag can be `true` with no id.** `shipToOverride = true` can still occur with NO resolvable `customerId` — free-text redirects that don't match a real `delivery_point_master` row (e.g. "as per challan", "Delivery on Challan copy"). "Flag true" does not imply "id present." Any consumer (Support board, future screens) must handle both states.

**Verification pending (2b, not yet confirmed):** a real post-deploy mail order with a resolved redirect should fill `mo_orders.shipToOverrideCustomerId`, then flow to `orders.shipToOverrideCustomerId` via enrichment. Check via:
```sql
SELECT id, "createdAt", "customerCode", "shipToOverride", "shipToOverrideCustomerId", "deliveryRemarks"
FROM mo_orders
WHERE "shipToOverride" = true
ORDER BY "createdAt" DESC
LIMIT 15;
```
Older rows are expected `null` (no backfill was run).

**Backfill of historical overrides — DEFERRED, maybe never.** Old `mo_orders` rows only carry the redirect as `[→ Name (Code)]` text inside `deliveryRemarks`; recovering the id needs a parse-then-resolve one-off script (parse the suffix via `splitDeliveryRemarks()`, then resolve the recovered code against `delivery_point_master`). Not needed to proceed.

**Ship-to override on other screens (Planning, Warehouse, challan, etc.) — DEFERRED.** Support only, one screen at a time, per Smart Flow's sequencing.

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
| POST | /api/mail-orders/ingest | HMAC | Receives from PowerShell. Accepts `carryProduct?`, `bodyCustomerName?`, `bodyCustomerCode?`. No server-side auto-split. Calls `buildTableCContext()` once per request for Table C fast-path. |
| GET | /api/mail-orders | Session | Fetches by date (IST) + status filter. Two-batch ship-to lookup against `mo_customer_keywords`. Response includes `shipToArea`, `shipToDeliveryType`. Each line includes `altSkus: string[]` from `mo_sku_lookup_v2` combo siblings (display-time, additive; `[]` on miss, ~99.7% v2 coverage). |
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
  table-c.ts            buildTableC() exact-name map; tableCKey(); cleanPackCode(); buildComboSiblings() (→ altSkus)
  table-c-context.ts    buildTableCContext() — builds tableC + tableCResolver per ingest request (NEW, commit da219238)
  email-template.ts     slot summary HTML builder
```

**`focus-mode-view.tsx` is deleted** (was orphan, removed 2026-05-20 in Review View redesign commit `6dafad8e`).

---

## 9. View modes — Table | Review

Toggle in UniversalHeader title. Visual spec in `CLAUDE_UI.md §21, §28-32`.

### 9.1 Table View

12 parent columns. Column toggle via `ALL_COLUMNS` config, `localStorage "mo-column-visibility"`. Dispatch `defaultVisible: false`. 4 always-visible: Time, Customer, SKU, SO No.

**Slot sections (5, by `receivedAt` IST — cutoff time belongs to the NEXT slot):**

| Received | Slot |
|---|---|
| before 10:30 | Morning |
| 10:30 – before 12:30 | Afternoon |
| 12:30 – before 17:00 | Evening |
| 17:00 – before 20:00 | **Late Evening** (added 2026-06-18) |
| 20:00 – 23:59 | Night |

No data migration — slots are computed at render from `receivedAt`, so existing orders re-bucket automatically. Cutoffs are DB-configurable in `system_config` (`"HH:MM"` strings parsed by `parseHHMM()`): `slot_morning_cutoff` 10:30 · `slot_afternoon_cutoff` 12:30 · `slot_evening_cutoff` 17:00 (was 15:30) · `slot_late_evening_cutoff` 20:00 (new). Hardcoded fallbacks in `getSlotFromTime()`: 630/750/1020/1200.

> **Separate system:** this mail-orders bucketing is NOT the depot-wide `slot_master` (CORE §9) used by Support/Planning/Warehouse — different boundaries, no stored slot column on `mo_orders` (`slotToOverride` is dead/write-only, no reader). The two never share numbers.

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

**ALT SKU column [Focus/Review mode only · LIVE 2026-06-19]:** In the SKU table, a rightmost "ALT SKU" column shows alternates for each line sourced from `mo_sku_lookup_v2` combo siblings. Operator clicks the chip to open a modal listing the billed (primary) SKU + all alternates, with per-row copy-to-clipboard. Chip recoloured to neutral grey (no teal/amber status colour). Data is display-time only — nothing is written back; the API attaches `altSkus: string[]` per line via `buildComboSiblings()` in `table-c.ts`. Mockup: `docs/mockups/mail-order/alt-sku-modal-mockup.html`. **Not available in Table mode** — see §18 landmine.

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
| 1-5 | Jump to slot segment (descriptive; the handler is segment-count driven and scaled to 5 automatically) |
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

> **Known gap (owner-deferred):** the `slotDefs` slot-email trigger array in `mail-orders-page.tsx` (~lines 269-273) has only 3 entries — Morning / Afternoon / Evening. It omits Night and now also **Late Evening**, so slot-summary emails do NOT auto-fire for those two slots. Fix tracked in ROADMAP.

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
- **Table-mode parity gap.** `mail-orders-table.tsx` (§9.1) does NOT show the ALT SKU column. Only the Review View (§9.2) has it. Small/deferred per 2026-06-19 handoff.
- **Bounce / DTS signal badges deferred.** Parser v7.2 delivers `Bounce` and `DTS` remark text from app-format emails, but badge wiring (meaning, colour, card routing) is not yet built. `Truck Order` is already in the signal catalog.
- **`shipToOverrideCustomerId` can be null even when `shipToOverride` is true** (§6) — free-text redirects that never resolved to a real `delivery_point_master` row. Any code path reading the override must handle flag-true/id-null as valid, not treat it as a data-integrity error.
- **Most `app/api/mail-orders/**` routes check session only, never role/permission** [LANDMINE — security gap, surfaced 2026-07-10, not fixed]: `route.ts` (GET list), `[id]/punch`, `[id]/so-number`, `[id]/customer`, `[id]/lock`, `[id]/split`, `[id]/original-lines`, `[id]/note`, `lines/[lineId]/resolve`, `lines/[lineId]/status`, `skus`, `customers/search`, `re-enrich`, `debug-enrich`, `learn-customer`, `backfill-customers`. Any logged-in user of ANY role can PATCH/POST Mail Orders data by calling these directly, bypassing the layout guard (§22). Consequence: `tint_manager`'s view-only (`canEdit=false`) grant is a **UI illusion only** — nothing server-side enforces it. (Intentionally exempt, not part of this gap: `ingest` = HMAC-authenticated; `keywords` = deliberately public for the parser.)
- **`GET /api/mail-orders/backfill-enrich` is fully unauthenticated** [LANDMINE — security gap, surfaced 2026-07-10, not fixed] — no session check, no HMAC. Marked `TEMPORARY — delete after backfill` in its own source but still live. Performs a bulk write across `mo_order_lines`. Reachable by anyone with the URL.

---

## 19. Missing customer resolver (multi-SO aware)

Component: `components/shared/customer-missing-sheet.tsx`. Opens from the missing-customer badge on Tint Manager Kanban and Support board.

### What it does

When a mail order or OBD arrives for a customer not yet in `delivery_point_master`, the resolver opens a slide-out sheet with the inferred customer details, asks the operator to fill in the gaps (route, area, SO, contacts), and creates the master record + matching `delivery_point_contacts` on submit.

### Multi-SO list (shared with admin form)

Same component as `components/admin/sales-officers-list.tsx`. Operator picks 1+ SOs and tags each PRIMARY/BACKUP/JUNIOR. Adding an SO immediately materialises an auto-contact in the Contacts tab via the shared `SoSync` backend (eager mode).

### Eager sync semantics

Unlike the admin form (which sync's on Save), the missing-customer resolver runs `SoSync` immediately on every SO pick. Reasons:
- Operator working in a tighter loop, not building a record over multiple sessions
- Auto-contacts must be visible in the Contacts tab while the operator is still in the sheet
- "Save and exit" should leave a fully-coherent record, not pending sync

### Disabled × on auto-contacts

The Contacts tab shows the same `ContactCard` (`CLAUDE_UI.md §53`) as the admin form. Auto-contacts here have their × button DISABLED with tooltip "Remove via Sales Officers tab". Reason: in the create-only flow there's no audit log for the dismissal — operator should remove the SO instead, which cleans up its auto-contact.

### Basic Info strip

Top of the sheet: read-only strip showing inferred name/code, SAP-derived address (when present from OBD), source (mail order / SAP OBD), first-seen timestamp. Operator cannot edit these — they came from the source.

### Persistence

Submit POSTs to `/api/admin/customers` with the multi-SO payload (`salesOfficers: [{ salesOfficerId, role }]`). Server runs the full SoSync cascade (Stages B/F/C/D/E from `lib/customers/so-sync.ts`) — same path as the admin form. On success, sheet closes and parent re-fetches the missing-customer count.

---

## 20. Pending — parser migration to v2 tables

The mail order parser + enrichment still read the LEGACY `mo_order_form_index` + `mo_sku_lookup` tables. The frontend order entry surfaces (`/order` and `/place-order`) read v2 tables since 2026-05-29.

This split is intentional during the migration window. Full plan in `CLAUDE_PLACE_ORDER.md §19` (v2 single-source-of-truth — 3-stage plan). Until Stage 3 ships, do NOT delete the legacy tables.

For mail-order sessions specifically: any new product keyword work (e.g. fixing the SmartChoice/Distemper search misroute) should be done in **both** legacy tables AND the v2 `searchTokens` column to keep the two paths in sync until the parser migrates.

### Parser v7.2 deferred items (as of 2026-07-15)

- ~~Deploy to depot PC~~ **DONE** — confirmed live 2026-07-15 (§3.1).
- **Live verification still open.** Confirm app-format emails hit `Parse-AppBody` path (check `mail_order.log` for `[APP]` lines), confirm Table C hits appear in the ingest response (§4.1).
- **Keyword health scan.** A structured keyword-vs-SKU analysis to catch ghost keywords (keyword present, zero SKU matches) and missing keywords (product has SKUs, no keyword). Deferred from 2026-06-19 session.

### Table C deferred items (as of 2026-06-19)

- **Re-enrich wiring.** `POST /api/mail-orders/re-enrich` does not call `buildTableCContext`. Deferred until app orders flow and re-enrich needs to benefit from Table C.
- **13 double-primary fix.** 13 SKUs in `mo_sku_lookup_v2` have `isPrimary=true` on both the Fini and Generic rows simultaneously. Causes key collisions → excluded from Table C map. Fix by auditing and de-flagging the incorrect primary.
- **Table-mode ALT SKU.** Add `altSkus` column to `mail-orders-table.tsx` for parity with Review View. Small, deferred.

---

## 21. Tag gating + ship-to fallback (Settings → Hide, v27.6)

Admin "Settings → Hide → Tags" can switch any Mail Order badge off app-wide (data stays; only the badge render is suppressed). Feature/schema: `CLAUDE_CORE.md §7.10`; UI: `CLAUDE_UI.md §57`.

**`getOrderSignals()` is the SINGLE MO badge emitter** (`lib/mail-orders/utils.ts`) — each emitted signal carries a `tagKey`; the function accepts `opts.disabledTagKeys: Set<string>` and filters out disabled signals. **Default-ON** (no settings row = badge shows). Stable keys + the 16-entry catalog live in `lib/hide/tag-catalog.ts` (`MO_TAG.*` + `TAG_CATALOG`; important tags Hold/OD/CI confirm before disabling).

**Flow:** `/api/mail-orders` computes `disabledTags` (keys where `isEnabled === false`) via `getTagSettings()` → payload → `mail-orders-page.tsx` stores a `Set` → drills into `review-view.tsx` (2 `getOrderSignals` calls + ShipToCard) and `mail-orders-table.tsx` → `SlotGroup` → `OrderRow`.

**Ship-to fallback:** `useBillToFallback = isOverride && disabledTagKeys.has(MO_TAG.captured)` → `ShipToCard` renders the **bill-to identity** (name/code/area/delivery type), dropping the amber bar + captured pill (bill-to fields threaded from review-view). Dispatch-status badges (Challan / Dispatch / Hold) are untouched. (Hiding MO *rows* — separate `mo_orders`, no hide column — is out of v1 scope; ROADMAP.)

---

## 22. Access — role permission grants

Access to `/mail-orders` is **entirely DB-driven** via `role_permissions` — not hardcoded to
`billing_operator` anywhere. No code, no deploy needed to grant or revoke a role.

| Layer | File | Mechanism |
|---|---|---|
| Sidebar | `lib/permissions.ts` — `PAGE_NAV_MAP` + `buildNavItems()` | filters nav entries by `allPerms[pageKey]?.canView === true` |
| Page guard | `app/(mail-orders)/mail-orders/layout.tsx` | `checkAnyPermission(roles, "mail_orders", "canView")` → redirect `/unauthorized` |
| `middleware.ts` | — | **no role check at all** for `/mail-orders`; only "has a session" |
| API routes | `app/api/mail-orders/**` | **no role check at all** on most routes (see §18 landmine below); only "has a session" |

`admin` bypasses the permission table entirely (hard-coded bypass in `lib/permissions.ts`). **Testing
access while logged in as admin proves nothing** — always test as the actual role being granted.

### Current `mail_orders` grants (as of 2026-07-10) [LIVE]

| roleSlug | canView | canEdit |
|---|---|---|
| `billing_operator` | true | true |
| `operations` | true | true — **granted 2026-07-10**, one additive `role_permissions` row, applied directly to production DB (no code deploy) |
| `operation_manager` | true | true |
| `tint_manager` | true | **false** (view-only) |

**Undocumented facts this grant surfaced:**
- A role slug **`operation_manager`** exists live in `role_permissions` and is **not** listed in
  `CORE §5`'s `role_master` table — flagged for the CORE pass (identify: legacy slug, or a real role
  missing from the docs).
- `tint_manager` holds a **view-only** `mail_orders` grant that was previously undocumented anywhere.

### Two authorization systems coexist

- `lib/rbac.ts` — `requireRole()` / `hasRole()`.
- `lib/permissions.ts` — `checkAnyPermission()` / `getAllPermissionsForRole(s)`, DB-backed.

Mail Orders uses **only** the second. `requireRole`/`hasRole` are unused by this module. Which one is
canonical for future modules is an open decision, not made here.

### Seed-is-source-of-truth gap [LANDMINE]

`prisma/seed.ts` contains **zero** rows for `pageKey='mail_orders'` — every grant above, including
`billing_operator`'s original one, lives **only in the live DB**. A wipe-and-reseed silently removes
Mail Orders access for everyone except `admin`. All four rows above should be added to
`prisma/seed.ts` (ROADMAP).

---

*Mail Orders v1.7 · Schema v27.10 · Parser v6.5 · Enrichment v3*
