# CLAUDE_MAIL_ORDERS.md — Mail Orders Module (parser → enrichment → matching → the Orders tab; Billing desk → CLAUDE_BILLING.md)
# v1.14 · Schema v27.24 · Parser v7.3.0 (repo copy; live PC ≥v7.2, exact deployed version unverifiable — §3) · Enrichment v3 · September 2026 · updated 2026-09-18
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md (+ docs/CLAUDE_BILLING.md for the Billing desk)

Primary user: Deepanshu Thakur (billing_operator id=25). Secondary: Bankim (id=26). Every viewer of `/mail-orders` gets the Billing desk face: `billing_settings.rolloutStage = ALL_USERS` since 2026-08-06 (live 2026-09-18, Q01; `lib/billing/flag.ts:86`). That face is owned by `docs/CLAUDE_BILLING.md`; §23 here keeps only the Orders-tab internals.

---

## 1. Architecture

**Parser inbox unchanged:** the parser watches `surat.order@outlook.com`. Place-Order surfaces (`/po`, `/place-order`) now send to `surat.depot@akzonobel.com`, which **auto-forwards into** the Outlook parser inbox — so `OutlookAccount` config + parser are untouched (`CLAUDE_CORE.md §8`, `CLAUDE_PLACE_ORDER.md §11`).

```
FW: email → Outlook (surat.order@outlook.com)  ← AkzoNobel front-door forwards in
  → Parse-MailOrders (V7 line — §3; repo copy v7.3.0)
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
  shipToOverride BOOLEAN, shipToOverrideCustomerId INT? (FK, v27.9 — §6),
  slotToOverride BOOLEAN, notes TEXT?,
  dispatchTargetDate DATE?, dispatchWindowId INT? (slot INTENT, 2026-07-30
    v27.13 addition — CORE §7.6; written by the Billing actions route,
    CLAUDE_BILLING.md §5),
  isLocked BOOLEAN DEFAULT false,
  splitFromId INT, splitLabel TEXT,
  createdAt,
  updatedAt TIMESTAMPTZ NOT NULL DEFAULT now() — owned by the DATABASE:
    trigger trg_mo_orders_updated_at, BEFORE UPDATE → set_updated_at_mo_orders()
    (live 2026-09-18, Q10a + Q11). Mirrored in Prisma as plain
    @default(now()), deliberately NOT @updatedAt (71e7b53a;
    prisma/schema.prisma model mo_orders) — the trigger is the single writer,
    so add neither the directive nor manual writes. GET /api/mail-orders/marker
    keys on it (§7).

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
mo_order_form_index        Legacy. ⚠ READ BY THE PARSER + ENRICHMENT ONLY — no frontend
                           reads it. Do NOT delete (see §20). Corrected 2026-07-27: this
                           said "Used by public /order", which had been wrong since
                           2026-05-29 when /order moved to the v2 tables — two months
                           before /order itself retired.
```

Index: `idx_mo_sku_lookup_ref_material` on `mo_sku_lookup.refMaterial`. Coverage: ~26.5%.

---

## 3. Parser — Parse-MailOrders (V7 line)

**Live copy:** `C:\Users\HP\OneDrive\VS Code\mail-orders\` on the mail PC (outside git). UTF-8 with BOM.
**Repo copy:** `docs/Parser/Parse-MailOrders-V7.ps1` — file header **Version: 7.3.0**.

**Version ruling (2026-08-04, three-way drift settled):** the repo copy is **v7.3.0** (v7.3 =
app-only piece-pack peel in `Parse-AppBody` STEP C — `/po` emits piece packs as `"1 pc*12"`, which
the shared pack detectors reject; the peel strips `pcs|pic|pics|pieces|piece|nos|tin|tins|bag|bags`
on the app path ONLY, since human mail places units freely. v7.1 = `"800"` → BRILLIANT WHITE, not
90 BASE — going-forward only, historical `rawText` keeps the corrupted value). The **live PC runs at
least v7.2** (the 2026-07-15 `Dispatch:`-tag evidence, §3.1); whether v7.3 is deployed is
**unverifiable from this PC** — the parser stamps no version into the ingest payload or any DB row,
so there is no runtime marker to read. ⚠ **The script's internal `$ScriptVersion = "6.5.0"` (line
136) is STALE** — the file header is the real version; the variable is a one-line script fix for an
owner decision (not edited here). This header's old "Parser v6.5" stamp came from that variable's
era and survived two major versions.

**Architecture: Normalize → Split → Extract** (unchanged across the v6.5→v7.x line — everything below §3.1 describes the shared human path)

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

**Script:** `docs/Parser/Parse-MailOrders-V7.ps1` (now v7.3.0 — §3's version ruling) — editing/repo copy. **Live on the mail PC as of at least v7.2, 2026-07-15** (confirmed above); v7.3's deploy state is unverifiable from here. Deploy is manual: back up live file → paste the repo copy over it (UTF-8 BOM) — kept here as the redeploy procedure.

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

**New remark types from app-format:** `Bounce` and `DTS` (from `Remark:` / `Note:` fields). `Bounce` already raises the red **Bounce** blocker badge on the bill card — `getOrderSignals()` matches `\bbounce\b` over the remark text (`lib/mail-orders/utils.ts:739-740`, since `761eec06`; §9.3). `DTS` has no badge — no `getOrderSignals()` arm matches it; its wiring needs meaning clarification first. `Truck Order` already handled by existing signal catalog.

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

Shipped alongside the desk-side inline picker (then Support's; the live equivalent is Floor's, `CLAUDE_FLOOR.md §4.4`) — this is the mail-order-side half of the same feature, mirroring how `dispatchStatus` already flows from `mo_orders` into `orders` via enrichment (§4 above).

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

**Flag can be `true` with no id.** `shipToOverride = true` can still occur with NO resolvable `customerId` — free-text redirects that don't match a real `delivery_point_master` row (e.g. "as per challan", "Delivery on Challan copy"). "Flag true" does not imply "id present." Any consumer (Floor's detail panel, future screens) must handle both states.

**Verification — CONFIRMED 2026-08-04 (this closed the "2b pending" item).** Live SELECT: since the
2026-07-07 deploy, **34 of 83** `shipToOverride=true` mail orders carry a resolved
`shipToOverrideCustomerId` (the null remainder are free-text redirects — flag-true/id-null is the
documented valid state, not a failure), and **34 `orders` rows** carry the id through enrichment.
All 277 pre-deploy flagged rows are null, as expected — no backfill was run.

**Backfill of historical overrides — DEFERRED, maybe never.** Old `mo_orders` rows only carry the redirect as `[→ Name (Code)]` text inside `deliveryRemarks`; recovering the id needs a parse-then-resolve one-off script (parse the suffix via `splitDeliveryRemarks()`, then resolve the recovered code against `delivery_point_master`). Not needed to proceed.

**Ship-to override on other screens — where it stands (2026-08-04):** the desk surface is Floor's detail panel (`CLAUDE_FLOOR.md §4.4`); the Billing desk resolves the override via the FK relation (§23.2) and can SET it via the ✎ pencil, shown only to holders of the `billing_ship_to` tick (`CLAUDE_BILLING.md §5`). The challan document does not render it. *(This line used to defer to "Support only" and name Planning/Warehouse as future screens — all three boards retired 2026-07-27/28.)*

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
| GET | /api/mail-orders | Session | Fetches by date (IST) + status filter. Two-batch ship-to lookup against `mo_customer_keywords`. Response includes `shipToArea`, `shipToDeliveryType`, `isKeyCustomer` per order (from `delivery_point_master.isKeyCustomer`, `route.ts:225-260`) and `disabledTags` for the viewer (§21). Each line includes `altSkus: string[]` from `mo_sku_lookup_v2` combo siblings (display-time, additive; `[]` on miss, ~99.7% v2 coverage). The sibling maps come from a 5-minute in-process cache, per warm instance, with a single-flight guard (`getComboSiblings()`, `COMBO_CACHE_TTL_MS` at `route.ts:58`; `00cfac02`) — a catalog edit shows within 5 minutes, not instantly. |
| GET | /api/mail-orders/marker | `mail_orders` canView (`marker/route.ts:87`) | The Orders tab's change probe (`0cbe73ef`): `count` = `mo_orders` in the IST day; `latest` = MAX(`mo_orders.updatedAt`) in that day OR MAX(`app_tag_settings.updatedAt`), not day-scoped. Two aggregates, read-only. Its header lists the accepted blind spots: `mo_line_status`, `isKeyCustomer`, `mo_customer_keywords`, `mo_sku_lookup_v2`. |
| PATCH | /api/mail-orders/[id]/punch | `mail_orders` canEdit | Mark punched. |
| PATCH | /api/mail-orders/[id]/so-number | `mail_orders` canEdit | Save soNumber, auto-punch. |
| PATCH | /api/mail-orders/[id]/customer | `mail_orders` canEdit | Manual customer pick. |
| PATCH | /api/mail-orders/[id]/lock | `mail_orders` canEdit | Toggle `isLocked`. |
| PATCH | /api/mail-orders/[id]/note | `mail_orders` canEdit (`note/route.ts:28`) | Save `mo_orders.notes` (string or null, ≤5000 chars). |
| POST | /api/mail-orders/[id]/split | `mail_orders` canEdit | Manual split. |
| GET | /api/mail-orders/[id]/original-lines | Session | Fetch both halves for original view. |
| POST | /api/mail-orders/lines/[lineId]/resolve | `mail_orders` canEdit | Resolve unmatched line. |
| PATCH | /api/mail-orders/lines/[lineId]/status | `mail_orders` canEdit | Set found/not-found + reason. snake_case reasons. |
| GET | /api/mail-orders/skus | Session | Search `mo_sku_lookup`. |
| GET | /api/mail-orders/customers/search | Session | Search `mo_customer_keywords`. |
| GET | /api/mail-orders/keywords | **Public** | Parser consumes at startup. |
| POST | /api/mail-orders/re-enrich | `mail_orders` canEdit | Re-enrich last 2 days. Idempotent. |
| POST | /api/mail-orders/backfill-customers | `mail_orders` canEdit (`backfill-customers/route.ts:18`) | Re-runs subject customer matching on every `mo_orders` row whose `customerMatchStatus` is null or `unmatched`. |
| GET / POST | /api/mail-orders/backfill-enrich | GET: `requireRole(session, [ROLES.ADMIN])` (`backfill-enrich/route.ts:169`). POST: HMAC (`x-hmac-signature`, `:147-150`) — but middleware still demands a session first (§18) | `runBackfill()` bulk re-enrichment. Source still says `TEMPORARY — delete after backfill` (§18). |
| GET | /api/mail-orders/debug-enrich | Session | Debug enrichment. |
| POST | /api/mail-orders/learn-customer | `mail_orders` canEdit | Upsert into `mo_learned_customers`. Fire-and-forget. |

**Middleware bypass:** `/api/mail-orders/ingest` bypasses session auth when `x-hmac-signature` header present. `/api/mail-orders/keywords` excluded entirely (`middleware.ts:59-67`). No other mail-orders path is bypassed.

**Audit.** The customer, lock, note, split, line-resolve, re-enrich and backfill-customers routes each write an `entity: "mail_orders"` row through `logAdminAction()` (`c3cf726b`). The table and its rules are `CLAUDE_CORE.md §7.13`.

---

## 8. Frontend files

```
app/(mail-orders)/mail-orders/
  layout.tsx                   server: mail_orders canView gate + the provider stack (CLAUDE_BILLING.md §3)
  page.tsx                     bare wrapper, force-dynamic
  mail-orders-page.tsx         main client, viewMode switch (Table | Review), marker poll
  mail-orders-table.tsx        12-column table with CodeCell + SignalPill (dormant face — §9)
  line-status-panel.tsx        per-line found/not-found panel (imported by mail-orders-table.tsx)
  review-view.tsx              master-detail split. Primary punching view.
  resolve-line-panel.tsx       unmatched line resolver
  tutorial-overlay.tsx         step-by-step spotlight tutorial (rendered by mail-orders-page.tsx)
  slot-completion-modal.tsx    ON DISK, NO IMPORTER — slot modal retired 2026-08-10 (§13)

components/mail-orders/
  signal-pill.tsx              shared SignalPill component
  bill-to-card.tsx             BillToCard with optional code-click + popover slot + "Key" pill
  ship-to-card.tsx             ShipToCard — override bar: brand/violet on the billing face, amber on the dormant face (§9.5)
  meta-ribbon.tsx              SO/time/vol/match/punched + action buttons + Punch slot
  instructions-strip.tsx       3-dot category strip (returns null when all empty)
  notes-font-size-provider.tsx couriers the per-user notes size (CLAUDE_BILLING.md §9)
  so-email-panel.tsx           ON DISK, NO IMPORTER

lib/mail-orders/
  types.ts              MoOrderLine (isCarton, cartonCount), OrderSignal (with card field)
  api.ts                client fetch helpers (learnCustomer fire-and-forget);
                        fetchSlotCutoffs() still exported, no caller (§9.1)
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
  notes-font-size.ts    getNotesFontSize() + the 11–20 bounds (CLAUDE_BILLING.md §9)
  email-template.ts     slot summary HTML builder — ORPHANED: its only importers are the two
                        no-importer files above (§14)
  enrich-v2.ts          ON DISK, NO IMPORTER anywhere in the repo
  taxonomy-mapping.ts   no app importer; imported only by four one-off scripts under scripts/
                        (v2-sku-seed-from-legacy.ts, preview-new-taxonomy*.ts, tmp/step1-missing-135.ts)
```

Orphans verified 2026-09-18 two ways: an import grep over `app/ components/ lib/ scripts/`, then a
name grep (`SlotCompletionModal`, `SoEmailPanel`, `enrich-v2`, `buildSlotSummaryHTML`) — every
remaining hit is a comment or the file itself. Kept per the no-delete rule; removal needs an owner
instruction.

**`focus-mode-view.tsx` is deleted** (was orphan, removed 2026-05-20 in Review View redesign commit `6dafad8e`).

---

## 9. View modes — Table | Review

Visual spec in `CLAUDE_UI.md §21, §28-32`.

**Only Review is reachable.** With the rollout stage at `ALL_USERS` every viewer is on the billing face, which hides the Table/Focus toggle (the only writer of `viewMode`, default `"focus"`) and the slot sections — §9.1 is dormant code, listed in `CLAUDE_BILLING.md §2`.

**Refresh is marker-gated** (`0cbe73ef`): the page polls `GET /api/mail-orders/marker` every 30s through `usePickingMarker` (`MAIL_ORDERS_MARKER_POLL_MS`, `mail-orders-page.tsx:90`, `:366-372`) and refetches `GET /api/mail-orders` only when `{count, latest}` moves. The hook does the tab-focus check; the page has no `visibilitychange` listener of its own.

### 9.1 Table View [DORMANT — unreachable while ALL_USERS]

12 parent columns. Column toggle via `ALL_COLUMNS` config, `localStorage "mo-column-visibility"`. Dispatch `defaultVisible: false`. 4 always-visible: Time, Customer, SKU, SO No.

**Slot sections (5, by `receivedAt` IST — cutoff time belongs to the NEXT slot):**

| Received | Slot |
|---|---|
| before 10:30 | Morning |
| 10:30 – before 12:30 | Afternoon |
| 12:30 – before 17:00 | Evening |
| 17:00 – before 20:00 | **Late Evening** (added 2026-06-18) |
| 20:00 – 23:59 | Night |

No data migration — slots are computed at render from `receivedAt`, so existing orders re-bucket automatically. This page uses the hardcoded cutoffs in `getSlotFromTime()` only: 630/750/1020/1200. `slotCutoffs` is declared and never populated (`mail-orders-page.tsx:238-245`), so an admin edit to the `system_config` keys (`slot_morning_cutoff` 10:30 · `slot_afternoon_cutoff` 12:30 · `slot_evening_cutoff` 17:00 · `slot_late_evening_cutoff` 20:00) no longer reaches this page. Was fetched from `system_config` via `fetchSlotCutoffs()` until 2026-08-10; now never fetched (`c103d5f4`). Do not revert. `GET /api/system-config/slot-cutoffs` is still on disk with 0 callers, and `fetchSlotCutoffs()` in `lib/mail-orders/api.ts:132` has no caller either.

> **Separate system:** this mail-orders bucketing is NOT the depot-wide `slot_master` (CORE §9) — different boundaries, no stored slot column on `mo_orders` (`slotToOverride` is dead/write-only, no reader). The two never share numbers.
>
> ⚠ **Corrected 2026-07-28:** this used to say `slot_master` was "used by Support/Planning/Warehouse". **All three of those boards are now retired** (`archive/2026-07-support/`, `archive/2026-07-planning-board/`, `archive/2026-07-warehouse-board/`). `slot_master` itself is still live — its readers today are the admin Slots and Slot-Rules screens (`app/api/admin/slots/*`), the operations summary, Tint Manager's order list, and `lib/slots/slot-ruler.ts`, which stamps `arrivalSlotId` at import. The point of this note is unchanged: that table is not this bucketing.

Punched orders: separated to bottom per slot. Collapsible divider. `T` toggles globally.

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

**ALT SKU column [Focus/Review mode only · LIVE 2026-06-19]:** In the SKU table, a rightmost "ALT SKU" column shows alternates for each line sourced from `mo_sku_lookup_v2` combo siblings. Operator clicks the chip to open a modal listing the billed (primary) SKU + all alternates, with per-row copy-to-clipboard. Chip recoloured to neutral grey (no teal/amber status colour). Data is display-time only — nothing is written back; the API attaches `altSkus: string[]` per line via `buildComboSiblings()` in `table-c.ts`, from maps cached 5 minutes per warm instance (§7, `00cfac02`). Mockup: `docs/mockups/mail-order/alt-sku-modal-mockup.html`. **Not available in Table mode** — see §18 landmine.

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
- `isOverride=true`, billing face (`tone="notes"`, passed at `review-view.tsx:2266`) → brand/violet card: `bg-brand-50` + 3px `before:bg-brand-600` left bar + a solid brand `changed` pill, no ⚑ (that glyph means Hold on this face) (`ship-to-card.tsx:107-111`, `:129-139`). Identity comes from the FK relation (§23.2).
- `isOverride=true`, dormant flag-OFF face (`tone="default"`) → 3px amber left bar via `before:` pseudo + amber `⚑ captured` pill + identity from `splitDeliveryRemarks(...)` (`ship-to-card.tsx:112`, `:141-146`).

### 9.5.1 Inbox-row and Bill-To extras [LIVE]

- **Key dealer.** `GET /api/mail-orders` returns `isKeyCustomer` per order from `delivery_point_master.isKeyCustomer` (`route.ts:225-260`). The inbox row shows an amber ★ (`review-view.tsx:1166`) and `BillToCard` a "Key" pill (`bill-to-card.tsx:90-95`, prop at `review-view.tsx:2219`). Both are switched off by the `MO_TAG.keyCustomer` tag (§21), and so is the "Key" filter chip on the billing face (`mail-orders-page.tsx` `billingFilterGroups()`). A change to `isKeyCustomer` does not move the marker; it shows on the next full refetch.
- **Truck icon.** A Truck Order bill gets a truck glyph beside the dealer name on the inbox row (`aded19ed`; `TruckGlyph`, `review-view.tsx:196-197`, `:1126`, `:1167`). It is derived from the same tag-filtered signals, so the `truck_order` tag hides it too.

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

- The Table-only rows and the 1-5 slot jumps belong to the dormant face (§9.1).
- On the billing face these shortcuts act only while the Orders tab is open: both handlers return early on Picking/Print (`mail-orders-page.tsx:939`, `:1041`; `5ec6d65c`) — `CLAUDE_BILLING.md §3`.
- The `E` key opened the slot-email modal until 2026-08-10; now there is no E handler (`c103d5f4`). Do not revert. ⚠ Known defect: `MO_SHORTCUTS` still lists `{ key: "E", label: "Slot email" }` (`mail-orders-page.tsx:99`), and the ⌨ popover renders it — recorded in `CLAUDE_BILLING.md §11`.

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

## 13. Slot completion + SO email [RETIRED 2026-08-10]

Was a slot-completion modal (auto-detect, a 15-minute post-cutoff auto-trigger, and the `E` shortcut) until 2026-08-10; now all three are removed from the page (`c103d5f4`; `mail-orders-page.tsx:391-412`). Do not revert. It never sent mail — "Send" copied HTML and opened an empty-To `mailto:` — so no outgoing email stopped. Leftovers: `slot-completion-modal.tsx` and the §14 builder stay on disk with no live importer (§8); `mo-slot-email-sent-*` localStorage keys in browsers have no reader.

---

## 14. Slot summary email — email-template.ts [ORPHANED CODE, kept on disk]

⚠ Nothing live calls this. `buildSlotSummaryHTML` is imported only by `slot-completion-modal.tsx:8` and `components/mail-orders/so-email-panel.tsx:7`, and neither file has an importer (§8, §13). The spec below describes the file as it sits on disk.

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
- Brand bar: 3px solid #7C3AED top (violet since the rebrand, `c96157ea`; `email-template.ts:144`)
- Header two-column: slot title/date left, violet (#7C3AED) order count panel right (110px) (`:156-158`)
- Section headers: Processed (#7C3AED, `:175`), Not Available (#b45309), Pending (#334155)
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
- **DTS signal badge deferred.** Parser v7.2 delivers `Bounce` and `DTS` remark text from app-format emails. `Bounce` is wired (red blocker, bill card — `lib/mail-orders/utils.ts:739-740`, §9.3); `DTS` badge wiring (meaning, colour, card routing) is not built — no arm in `getOrderSignals()` matches it. `Truck Order` is already in the signal catalog.
- **`shipToOverrideCustomerId` can be null even when `shipToOverride` is true** (§6) — free-text redirects that never resolved to a real `delivery_point_master` row. Any code path reading the override must handle flag-true/id-null as valid, not treat it as a data-integrity error.
- **~~Most `app/api/mail-orders/**` routes check session only, never role/permission~~ — FIXED 2026-08-30 (`0f56eede`)** (surfaced 2026-07-10; open for seven weeks). **The ELEVEN write routes now gate on `checkAnyPermission(roles, "mail_orders", "canEdit")`**, the same block as `app/api/billing/mail-order/actions/route.ts:72-76`: `[id]/customer`, `[id]/lock`, `[id]/note`, `[id]/punch`, `[id]/so-number`, `[id]/split`, `lines/[lineId]/resolve`, `lines/[lineId]/status`, `re-enrich`, `backfill-customers`, `learn-customer`. **`checkAnyPermission`, never `checkPermission`** — the latter reads only the primary role and would deny a grant held on a secondary one. The READ routes were deliberately left as they were (`route.ts` GET list, `[id]/original-lines`, `skus`, `customers/search`, `debug-enrich`) — the fix gated writes, not reads. (Still intentionally exempt: `ingest` = HMAC-authenticated; `keywords` = deliberately public for the parser.) ⚠ The gap was **no check at all**, not `canView` — `CORE §13` mis-stated it as `canView` the whole time it was open.
- **~~`GET /api/mail-orders/backfill-enrich` is fully unauthenticated~~ — FIXED 2026-08-30 (`0f56eede`)** (surfaced 2026-07-10). The GET now runs `requireRole(session, [ROLES.ADMIN])` before `runBackfill()` (`backfill-enrich/route.ts:169`). That is the ROLE only: `requireRole` (`lib/rbac.ts:58-66`) has no `isSuperuser` flag arm, so a flag-only superuser is redirected to `/unauthorized`. **The POST's HMAC path was left untouched.** ⚠ It is not reachable without a session: `middleware.ts` bypasses only `/api/mail-orders/ingest` and `/keywords` (`:59-67`), so a sessionless machine POST is redirected to `/login` (`:77-79`) before the route's own HMAC check (`:147-150`) runs. The `TEMPORARY — delete after backfill` comment is still in its own source; retire-or-keep is a ROADMAP item.

---

## 19. Missing customer resolver (multi-SO aware)

Component: `components/shared/customer-missing-sheet.tsx`. Opens on Tint Manager from the header's amber "N missing" badge (`components/tint/tint-manager-content.tsx:846-866`), and as the interceptor when Assign or "Base — No Tint" is tried on a `customerMissing` bill (`:488-495`; `CLAUDE_TINT.md §1.12`). The header badge dates from `081b0a63` (2026-04-13) and survived the 2026-09-06 retirement of the Kanban (`CLAUDE_TINT.md §1`). ⚠ It also opened from the Support board until that board was retired 2026-07-27 — **Floor has no equivalent entry point**, so an unmatched customer can currently only be resolved from Tint Manager. Gap, not a decision → ROADMAP.

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

The mail order parser + enrichment still read the LEGACY `mo_order_form_index` + `mo_sku_lookup` tables. The frontend order entry surfaces (`/po` and `/place-order`) read v2 tables — a switch made on 2026-05-29, when the then-live `/order` moved across too (`/order` retired 2026-07-27, `archive/2026-07-order/`).

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

Admin "Settings → Hide → Tags" can switch any Mail Order badge off for **everyone, one role, or one person** — the "Who sees it" picker (`abd495f4`; `components/admin/hide-settings-content.tsx`). Data stays; only the render is suppressed. Feature/schema: `CLAUDE_CORE.md §7.10`; UI: `CLAUDE_UI.md §57`.

**`getOrderSignals()` is the SINGLE MO badge emitter** (`lib/mail-orders/utils.ts`) — each emitted signal carries a `tagKey`; the function accepts `opts.disabledTagKeys: Set<string>` and filters out disabled signals. **Default-ON** (no row that applies to the viewer = badge shows). Stable keys + the catalog live in `lib/hide/tag-catalog.ts` (`MO_TAG.*` + `TAG_CATALOG`): **22 entries** — 19 in group "Mail Orders" (incl. `keyCustomer`, `matchChip`, `punchedBy`, added by `abd495f4`) and 3 in "Violet band (Billing)" (`notesBand`, `deliveryLine`, `billLine`). Important tags (Hold, OD, CI, Ship-to captured) confirm before disabling. Some switches gate a render outside `getOrderSignals` (the ★/Key pill, the match chip, the punched-by line, the band rows) — each at its call site in `review-view.tsx`.

**Resolution — `getTagSettings(userId, roleSlugs)`** (`lib/hide/tag-settings.ts`), one query with three OR arms (everyone / the viewer's roles / the viewer), folded in memory:
1. a **user** row for this viewer decides;
2. else per held role, that role's row or the everyone value — **show wins**: a role-level hide bites only when every role the viewer holds hides it;
3. a viewer with no roles falls to the everyone value;
4. no row → shown. A failed read logs and shows every badge.

**No admin / superuser bypass** — the switches apply to the admin exactly as written (file header of `tag-settings.ts`).

**Schema (live 2026-09-18, Q05a/Q05b/Q10a):** `app_tag_settings.scope` (text NOT NULL default `'everyone'`), `roleSlug` (text), `userId` (int, FK → `users` ON DELETE CASCADE). `chk_app_tag_settings_scope` forces exactly one audience shape. `tagKey` is **no longer UNIQUE**: uniqueness is three partial unique indexes — `app_tag_settings_everyone_key (tagKey) WHERE scope='everyone'`, `_role_key (tagKey, roleSlug) WHERE scope='role'`, `_user_key (tagKey, userId) WHERE scope='user'`. Prisma cannot express partial indexes, so the model has no `@unique` (`prisma/schema.prisma` model `app_tag_settings`).

**Writes — `PUT /api/admin/tag-settings`**, gated `isSuperuser(session)` (`lib/rbac.ts:104-111`: the flag OR the admin role). It reads the tag's rows, then per audience `findFirst` → `update` by id or `create`, and `deleteMany` for dropped exceptions — sequential awaits, never `upsert`, because the uniqueness lives in partial indexes (`tag-settings/route.ts:31-35`, `:205-300`). Each change is audited after the write via `logAdminAction` (`CLAUDE_CORE.md §7.13`). **`GET /api/admin/tag-audience`** (same gate) feeds the picker: the active people who can open Mail Orders under the live access source, and the roles they hold (`tag-audience/route.ts`).

**Flow:** `/api/mail-orders` calls `getTagSettings()` with the session's id and roles and returns `disabledTags` → payload → `mail-orders-page.tsx` stores a `Set` → drills into `review-view.tsx` (2 `getOrderSignals` calls + ShipToCard) and `mail-orders-table.tsx` → `SlotGroup` → `OrderRow`. A tag write moves `GET /api/mail-orders/marker` (its `app_tag_settings.updatedAt` arm), so open boards refetch within one poll.

**Filter chips.** On the billing face the "Key" dealer chip follows the `keyCustomer` tag; the Hold/Dispatch and Urgent/Normal chips follow the action ticks, not tags (`f1dcfa58`; `billingFilterGroups()`, `mail-orders-page.tsx:68`) — `CLAUDE_BILLING.md §5`.

⚠ **Hold and Urgent tags do nothing on the billing face.** The Ship To card drops `type === "status"` signals and the urgent signal at the call site (`review-view.tsx:1505-1507`), and the inbox row shows only Bill/Split mini-badges (`:1172-1174`). The ⚑ Hold button is the only place a hold shows — and it is hidden without the `billing_hold` tick (`CLAUDE_BILLING.md §5`), so such a viewer sees no hold signal at all on this face.

**Ship-to fallback:** `useBillToFallback = isOverride && disabledTagKeys.has(MO_TAG.captured)` → `ShipToCard` renders the **bill-to identity** (name/code/area/delivery type), dropping the amber bar + captured pill (bill-to fields threaded from review-view). Dispatch-status badges (Challan / Dispatch / Hold) are untouched. (Hiding MO *rows* — separate `mo_orders`, no hide column — is out of v1 scope; ROADMAP.)

---

## 22. Access — per-user ticks (page key `mail_orders`)

Access to `/mail-orders` is **entirely DB-driven** — not hardcoded to `billing_operator` anywhere. No
code, no deploy needed to grant or revoke. The live authority is **per-user ticks** on page key
`mail_orders` (`ACCESS_SOURCE = "user"`, live 2026-09-18, Q02); the resolver, the role-mode fallback
and `role_permissions` as baseline are owned by `CLAUDE_CORE.md §5` + `§7.14`.

| Layer | File | Mechanism |
|---|---|---|
| Sidebar | `lib/permissions.ts` — `PAGE_NAV_MAP` + `buildNavItems()` | filters nav entries by `allPerms[pageKey]?.canView === true`; the entry is labelled **Billing** (`lib/permissions.ts:65`, `bf218da8`) |
| Page guard | `app/(mail-orders)/mail-orders/layout.tsx:31-32` | `checkAnyPermission(roles, "mail_orders", "canView")` → redirect `/unauthorized` |
| `middleware.ts` | — | **no role check at all** for `/mail-orders`; only "has a session" |
| API routes — WRITES | the eleven in §18 | `checkAnyPermission(roles, "mail_orders", "canEdit")` → 403 (`0f56eede`, 2026-08-30) |
| API routes — READS | `route.ts` GET, `[id]/original-lines`, `skus`, `customers/search`, `debug-enrich` | **no role check** — only "has a session". Deliberately left; the 2026-08-30 fix gated writes, not reads. `marker` is the exception: `mail_orders` canView (§7) |

The billing tabs and buttons inside the page have their own page keys (`billing_picking`,
`billing_print`, `billing_hold`, `billing_slot`, `billing_urgent`, `billing_ship_to`) — `CLAUDE_BILLING.md §4`.

**Bypass = admin role OR the superuser flag.** `checkAnyPermission` returns true first for a held
`admin` role (`lib/permissions.ts:795`), then for `users.isSuperuser` (`:799`), before any table is
read (`CLAUDE_CORE.md §7.15`). **Testing access while logged in as admin or a superuser proves
nothing** — always test as the actual person being granted.

### `mail_orders` rows in `role_permissions` [role-mode baseline — SELECT recorded in the 2026-09-01 gate draft, committed 2026-08-30; CORE §5 owns the table]

| roleSlug | canView | canEdit |
|---|---|---|
| `billing_operator` | true | true |
| `operations` | true | true — **granted 2026-07-10**, one additive `role_permissions` row, applied directly to production DB (no code deploy) |
| `operation_manager` | true | true |
| `tint_manager` | true | **true** (*corrected 2026-08-30, `158f64b2` — this row read `false` (view-only); the SELECT showed `canEdit=true`*) |

**All four rows are View+Edit.** There is no view-only grant on this page key, so the
`canView`-without-`canEdit` population was empty — which is why gating the eleven write routes
(§18) blocked nobody. At that reading the six people who reach this screen all held `canEdit`: Harsh (admin
bypass), Operations User, Chandresh Kolgha, Deepanshu Thakur, Bankim, Prakash. Evidence:
`docs/prompts/drafts/code-discovery-2026-09-01-mail-orders-gate.md §1-2`. ⚠ That was a role-mode
reading. Who holds `mail_orders` in `user_page_access` today was not in the 2026-09-18 query set.

**Facts this grant surfaced (both since settled):**
- **`operation_manager` — RESOLVED 2026-08-04:** a real role, `role_master` id 15, one active user
  (Prakash, id 32) — `CORE §5` now owns it. The "legacy slug?" question is closed.
- **`tint_manager` — CORRECTED 2026-08-30 (`158f64b2`).** This bullet said he holds a **view-only** grant, and
  `CORE §5` said the same. **Live said `canEdit=true`.** Both were stamped against a SELECT of
  2026-08-04, so either the row was flipped after that date or the 08-04 reading was wrong —
  unrecoverable, and `admin/permissions` POST records no actor (`code-discovery-2026-08-31-role-census.md
  §6c`). ⚠ Under user mode this role row no longer decides what Chandresh can do — his own
  `user_page_access` row does. **Do not flip either without deciding out loud whether Chandresh keeps
  editing Mail Orders** — the routes enforce `canEdit`, so a flip genuinely revokes his writes.

### Two authorization systems coexist

- `lib/rbac.ts` — `requireRole()` / `hasRole()` / `isSuperuser()`.
- `lib/permissions.ts` — `checkAnyPermission()` / `getAllPermissionsForRole(s)`, DB-backed.

Mail Orders routes use the second, with one exception: `GET /api/mail-orders/backfill-enrich` uses
`requireRole(session, [ROLES.ADMIN])` (§18). The admin tag routes (§21) use `isSuperuser()`. Which
system is canonical for future modules is an open decision, not made here.

### Seed-is-source-of-truth gap [LANDMINE]

`prisma/seed.ts` contains **zero** rows for `pageKey='mail_orders'` and writes no `user_page_access`
rows at all — every grant lives **only in the live DB**. A wipe-and-reseed silently removes
Mail Orders access for everyone except `admin` and superusers. The seed does write `role_permissions`
template rows for all six `billing_*` keys (four roles each, `prisma/seed.ts:189-242`), which open no
page without `mail_orders`.
The four `role_permissions` rows above should be added to `prisma/seed.ts` (ROADMAP).

---

## 23. The Billing desk — owned by `CLAUDE_BILLING.md`; the Orders-tab internals stay here

**Billing is the face `/mail-orders` shows every viewer.** `billing_settings.rolloutStage = ALL_USERS`
(live 2026-09-18, Q01), and on that stage `isBillingV2Enabled()` returns true for everyone who passes
the layout gate (`lib/billing/flag.ts:86`). Was a pilot limited to Operations User (id 20) under
`TEST_USERS_ONLY` until 2026-08-06; now `ALL_USERS` (Q01 `updatedAt 2026-08-06 10:41`). Do not revert
by accident — `OFF` is the kill switch and puts every viewer back on the dormant face
(`CLAUDE_BILLING.md §2`).

**Read `docs/CLAUDE_BILLING.md` for:** the rollout flag, its fail-closed read and the dormant flag-OFF
face (§2); the route gate, provider stack and tab bar (§3); the six `billing_*` page keys (§4); the
four action ticks and the dual-write actions route — the `soNumber`-blank guard, the per-table Hold
case, Urgent 1/3, slot set/clear and `dispatchSlotSource`, `heldAt` not written, 409 `LOCKED`, and
billing's own read routes (§5); the Picking tab — pending and info predicates, no date fence, mark
done / undo, the confirmed-findings predicate, the detail panel and its `billing_picking` gate (§6);
the Print tab (§7); the marker providers (§8); the notes font size (§9); schema (§10); landmines and
known defects (§11); open items (§12). None of that is restated here.

**What stays here:** the Orders-tab face of `review-view.tsx` (`CLAUDE_BILLING.md §1` hands the Review
view internals to this file), plus facts no other canon file holds. Subsection numbers are kept
because code comments cite them.

### 23.1 Building on the billing face [coding rules]

- **`UniversalHeader` takes only NEUTRAL props** and never imports from `components/billing/` or calls
  `useBillingV2()` — `CLAUDE_UI.md §6`.
- New nodes are siblings gated `{billingV2 && …}` — **no wrapper divs**; optional slot props use
  `undefined`, never `null`/`<></>`; no existing className/grid edited. The OFF path this protects is
  dormant (`CLAUDE_BILLING.md §2`), but it is still where the kill switch lands, so keep it
  byte-identical.
- `meta-ribbon.tsx` takes `contentOverride?: ReactNode` (undefined → original; `meta-ribbon.tsx:30`,
  `:123`). The tab row reuses `components/header-filter.tsx` / `header-date-stepper.tsx` /
  `header-shortcuts.tsx`, extracted from UniversalHeader so the tab row can reuse them.

### 23.2 The Orders tab face (`review-view.tsx`, `billingV2` on) [LIVE]

Built across `8b2d9553`→`3b678ad3` (07-31 batch) then `d08f3870`→`06a5c904` + `ce1212d3` (08-01/02):

- **Flat order list** — the slot filter and auto-select-first-slot are bypassed, and the Orders tab
  badge counts PENDING (`CLAUDE_BILLING.md §2`, `§3`).
- **Header:** no title node (`title={billingV2 ? undefined : …}`, `mail-orders-page.tsx:1356`) ·
  Import as the brand-filled primary (`importVariant="primary"`, `:1342`) + pearl `w-[240px]` search
  at the far right (`searchLayout="wide-right"`, `:1430`); clock, header stats and the header
  shortcuts button are off (`:1431`, `:1437`). The date stepper, Filter and ⌨ sit on the tab row
  (`CLAUDE_BILLING.md §3`).
- **Inbox rail:** mail icon + "Inbox" label (left), `N orders · X% punched` (right — % blue <100,
  green at 100; `review-view.tsx:2834-2846`); rail's own search box hidden.
- **Ribbon row** (`review-view.tsx:1886-1960`): sales officer name + received + `punched by {op}
  {time}` on the LEFT (the punched-by half has its own tag, §21); all actions RIGHT —
  `Urgent · Hold · Slot · Notes · Copy │ [Order No + Punch]` pre-punch, or `│ [✓ green SO pill] ✎`
  post-punch. Urgent, Hold and Slot each render only for a holder of its tick — hidden, never
  disabled (`CLAUDE_BILLING.md §5`). **Copy** was re-added 2026-08-06 (`44813cf9`, `63a323db`): one
  click copies every matched SKU line, unbatched — not the two-state Ctrl+C machine. Punch is
  rightmost; future buttons insert left of the punch group. Editing a punched SO number uses a compact
  inline editor and does NOT re-punch (keeps `punchedAt`, no pending-bounce — `a64c7935`). ⚠
  Auto-punch sets `status:"punched"` with NO soNumber — any "is-edit?" detector must include
  `&& !!soNumber` (§23.6).
- **Notes:** violet band (`instructions-strip` `tone="notes"`, `review-view.tsx:2302`) + violet
  left-accent; the Notes button tints violet when a note exists. Its three rows each have a tag (§21).
  Urgent/Hold/Dispatch chips removed from the ship card (call-site filter, `review-view.tsx:1505-1507`
  — the CTA buttons carry the state); Challan chip kept.
- **Empty states (copy locked, keep verbatim):** rail empty → "**No new orders**" / "New orders
  appear here on their own."; rail filtered → "No orders match."; right pane empty → green ✓
  "**All caught up**" / "Every order is punched. New ones show up here as they come in."; filtered →
  "No orders match your filter." A just-punched row lingers ~8s (`recentlyPunchedIds` grace).
  Clicking a punched order reopens it on the right even when caught up (`reopenedPunchedId` + ✕
  back to "All caught up"); a zero-order day keeps the shell (`ce1212d3`).
- **Ship-to via FK (`e545af29`):** the billing face resolves the override dealer through the
  `shipToOverrideCustomer` relation (like Floor), not by parsing `deliveryRemarks` text —
  name/code/area/deliveryType all from master data. The dormant Table view still reads the
  `mo_customer_keywords` cache (can disagree per dealer).

### 23.3 Billing actions — owned by `CLAUDE_BILLING.md §5`

Kept here because no other file holds it: the `orders` write is ONE update on a NEW path, so markers
see a genuine change (CORE §3 rule respected). The slot-intent columns on `mo_orders` are in §2 above
and `CLAUDE_CORE.md §7.6` (v27.13; lowercase FK name `mo_orders_dispatchwindowid_fkey`).

### 23.4 The Billing Picking tab — owned by `CLAUDE_BILLING.md §6`

Kept here because no other file holds them:

- **Why the info ("Already invoiced") arm exists — the vanishing bill** (2026-08-02,
  `b99a925d`/`71be9ff2`/`e7a2d6e5`): SAP same-day invoicing often lands BEFORE the supervisor checks,
  which failed Pending (invoiceNo set) AND Done (invoicedAt null).
- **"Awaiting SAP" is a real state, not a spinner.** invoiceNo arrives in sub-hourly batches through
  the day (measured), not live — never render it as a spinner (`billing-picking-tab.tsx:803-809`).
- The "Already invoiced" badge is neutral ink (`border-ink-200 bg-ink-100 text-ink-700`,
  `billing-picking-tab.tsx:795`; `b585240f`), not violet.
- The sibling Picking-board fix (`e37cbe74` — the supervisor Checked band now keys on `checkedAt`
  IST, not `dispatchTargetDate`) is **CLAUDE_PICKING territory** — flagged there, not documented here.

#### 23.4.1 Confirmed shortages reach Billing — predicate, read and detail panel in `CLAUDE_BILLING.md §6`

The floor's findings flow is `CLAUDE_PICKING.md §11`. Kept here — the UI decisions no other file holds:

- A flagged Pending row takes a light red wash **on every `<td>`, not the `<tr>`** — each cell carries
  its own `border-b`, so a row-level fill renders banded on this `table-fixed` table — plus a 3px red
  left edge (`billing-picking-tab.tsx:624`, `:646`). A flagged row has no checkbox
  (`CLAUDE_BILLING.md §6`), so it is never also selected.
- In FLAGS it is a **⚠ glyph, never a text pill**, rendered ALONGSIDE any TINT / STOCK TFR. That
  column is 11% of a fixed table and already holds up to two pills; a third would push one out
  through the cell's ellipsis and silently lose a flag.
- ⚠ **Pending rows only.** Both Done arms are untouched and their wire shape is unchanged.
- In the detail panel, **qty shown stays qty ORDERED on a short line**, and the total counts every
  active line. What was found is stated in the note — **"Found 9 · Old MFG · Mar 2024 · <confirmer>"**,
  the confirmer's name added because this reader did NOT confirm it
  (`billing-order-detail-panel.tsx:370`, `:419`). Netting a short line out here would quietly disagree
  with the SAP invoice the operator is about to raise.
- **The checkbox cell stops the row click on a selectable row** (`billing-picking-tab.tsx:630`) —
  ticking leads to a write (Copy OBDs → Mark done), opening does not.

### 23.5 Deferred / open

- **Done:** rollout widened to `ALL_USERS` (Q01). Sidebar label renamed to **Billing** (`bf218da8`,
  `lib/permissions.ts:65`) — the route, the page key `mail_orders` and the folder keep their names.
  Ungating the ship-to FK fix is moot: every viewer is on the billing face (`flag.ts:86`).
- **Pointed elsewhere:** Table-view / flag-OFF retirement and flag cleanup → `CLAUDE_BILLING.md §12`;
  the `billing-order-info.tsx` orphan → `CLAUDE_BILLING.md §11`.
- **Still open, held here:** data-audit + plumbing session (dual-write end-to-end vs Floor) · clear
  the test-marked done bills from the pilot (not re-checked since rollout) · UI polish of the info
  row (its badge is neutral ink since `b585240f`) · billing edge case parked: bills invoiced days
  before checking show on the check day (Smart Flow will flag if that needs more) · human
  hand-checks outstanding (operations Import end-to-end; punch/edit/reopen in situ — Claude Code
  cannot log in) · **notes plumbing open question** (from the FINDINGS diagnosis §3.5):
  `mo_orders.notes` has NO enrichment carry line and Floor reads no `orders.remarks` at all — whether
  billing notes should reach Floor is a product decision, not a gap to plug blindly.

### 23.6 Landmines on the Orders tab face

- **A `*Slot` prop renders in BOTH MetaRibbon branches** (`contentOverride ?? fallback` — slots
  appear in the fallback too). Slots are never automatically billing-only; gate INSIDE the slot
  with `billingV2 ? … : …`. Leaked twice in `0a8582e3`, fixed in `d5a896b3`.
- **Shared cards render on both faces** (`ShipToCard`/`BillToCard` via review-view) — filter/gate
  at the CALL SITE, never restyle the card.
- **`grid-cols-2` cards share a row height** (align-items: stretch) — floor BOTH children
  (`[&>div]:min-h-[…]`, `review-view.tsx:2207`); a `min-h` on one card alone does nothing.
- **Auto-punch sets `status:"punched"` with NO `soNumber`** — an is-edit detector without
  `&& !!soNumber` mis-flags a first punch as an edit and drops its grace (row vanishes).
- **Local `tsc`/build validate the WORKING TREE, not the commit** — after committing, confirm
  `git diff HEAD --stat` is empty before pushing (an uncommitted `BTN_BASE` export once passed
  locally and broke the Vercel build — `1f589d51`).

---

## Change log — v1.11 (2026-08-04 reconciliation pass, method v1.1)

Evidence: git (18 commits verified), code call-sites, read-only SELECTs (ship-to carry, pilot state), the parser repo copy. Claim IDs from the session report.

- MO-1 (header/§1/§3): parser three-way version drift settled — repo copy v7.3.0; live PC ≥v7.2 (2026-07-15 evidence); no runtime version marker exists; stale `$ScriptVersion="6.5.0"` flagged for an owner script fix.
- MO-2 (§2): mo_orders listing gains `shipToOverrideCustomerId`, `notes`, and the slot-intent columns.
- MO-3 (§6): the "verification pending (2b)" ship-to id carry CONFIRMED by SELECT (34/83 post-deploy resolved; 34 OBDs carry it); the "Support only / Planning / Warehouse" deferral line replaced with the live surface map.
- MO-4 (§22): grants re-cited to CORE §5 (2026-08-04); operation_manager question closed (role id 15, Prakash).
- MO-5 (NEW §23): Billing v2 documented from the five drafts — pilot scope + flag mechanics, the billing face, dual-write actions + slot intent, the Picking tab with the 08-02 "done = check date" rule and owner decisions, deferred list, six landmines.
- MO-6: resume §3 Import-permission question closed — `canImportOBDs` allow-list includes operations/operation_manager (code) + live `import_obd` grant (`c8f8d020`, CORE §5).
- MO-7: resume §2 items verified SHIPPED in the 08-01 batch (header v7 → `d08f3870`/`f76b4c86`/`471e6808`; keyboard → `15e87e2b`/`f76b4c86`; Inbox+stats → `f91b94c8`/`471e6808`/`06a5c904`); only the human hand-checks remain open (§23.5).

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05; the "(+ unnumbered billing additions)" qualifier is retired — that IS v27.13 now).

---

## Change log — v1.12 (2026-08-09)

Evidence: `42f14de4` + `bfff2400` confirmed on `main` by `git log` before either was called LIVE; route, component and type files read at the call sites.

- MO-8 (NEW §23.4.1): confirmed shortages reaching Billing documented — the FLAGS ⚠ glyph + row highlight fed by ONE batched `pick_findings` read over the visible ids, and the read-only detail panel on `GET /api/billing/picking/order/[orderId]`. The `recordedById IS NOT NULL` predicate is recorded as shared-and-must-stay-shared across both surfaces. The `mail_orders`/canView gate is written up with its reason (Floor's route would 403 for Deepanshu and Bankim on rollout) as the third instance of the §23.3 carve-out pattern.
- Schema stamp -> **v27.15** (was v27.13; `pick_findings` minted v27.14 on 08-07, its `mfgMonth`/`mfgYear` v27.15 on 08-08 — `CLAUDE_CORE.md §7.4` owns both).

---

## Change log — v1.14 (2026-09-18, canon sweep batch B1)

Evidence: code at HEAD `5ab9ee40` (no code commits since `ec6343ba`), git log for every cited hash, and the live results of 2026-09-18 (`docs/prompts/drafts/sql-2026-09-18-canon-sweep-live-results.csv`, Q01/Q02/Q05a/Q05b/Q10a/Q11). Drafts read as history only.

- MO-9 (header, line 6, §23): "pilot" / `TEST_USERS_ONLY` language removed — the stage is `ALL_USERS` since 2026-08-06 (Q01). §23 gated fact by fact against `CLAUDE_BILLING.md` v1.0: what that file owns became pointers (§2–§12 there); the Orders-tab face internals and the facts no other file holds stay, corrected (ribbon Copy + per-tick buttons, no header title, brand Import, `tone="notes"`, moot ship-to caveat, neutral "Already invoiced" badge, flagged rows unselectable). Subsection numbers 23.1–23.6 kept because code comments cite them.
- MO-10 (§2): `mo_orders.updatedAt` added — DB-trigger owned (`trg_mo_orders_updated_at`, Q11), deliberately not `@updatedAt` (`71e7b53a`).
- MO-11 (§7): write-route Auth column corrected to `mail_orders` canEdit; rows added for `PATCH [id]/note`, `GET marker`, `POST backfill-customers`, `backfill-enrich` (GET admin role / POST HMAC); alt-SKU 5-minute cache (`00cfac02`); audit pointer to CORE §7.13 (`c3cf726b`).
- MO-12 (§8): missing live files added; orphans marked "on disk, no importer" after a two-way check (`slot-completion-modal.tsx`, `so-email-panel.tsx`, `enrich-v2.ts`, `email-template.ts`; `taxonomy-mapping.ts` is imported only by scripts).
- MO-13 (§9, §9.1, §9.2, §9.5, new §9.5.1): Table view + slot sections marked dormant; refresh is marker-gated (`0cbe73ef`); slot cutoffs no longer fetched (`c103d5f4`); ship-to override tone is brand/violet on the billing face; key-dealer ★ / Key pill and the truck icon (`aded19ed`) documented.
- MO-14 (§10, §13, §14): the `E` shortcut and the slot-completion modal retired (`c103d5f4`); the dead "E · Slot email" label pointed to `CLAUDE_BILLING.md §11`; Orders-tab-only shortcuts (`5ec6d65c`); §14 marked orphaned and its colours corrected to #7C3AED (`c96157ea`).
- MO-15 (§18): gate-fix dates corrected to 2026-08-30 (`0f56eede`); `backfill-enrich` GET is admin-role only, and the POST HMAC path is blocked by middleware for a sessionless caller.
- MO-16 (§21): scoped tags — everyone / role / user (`abd495f4`), 22 catalog entries, the user > role > everyone rule with show-wins across roles, no admin bypass, live partial unique indexes + `chk_app_tag_settings_scope`, `findFirst`-based writes, `tag-audience`, filter chips (`f1dcfa58`), and the no-hold-signal gap on the billing face.
- MO-17 (§22): access is per-user ticks (`ACCESS_SOURCE = user`, Q02); bypass is admin role OR `isSuperuser`; `role_permissions` is the role-mode fallback and baseline.
- v1.13's header said "updated 2026-09-01", but its only commit (`158f64b2`) and the code fix it described (`0f56eede`) are both dated 2026-08-30 — the file was forward-dated by two days.
- Schema stamp -> **v27.24** (was v27.15; reconciled against `CLAUDE_CORE.md` v104 · Schema v27.24).

---

*Mail Orders v1.14 · Schema v27.24 · Parser v7.3.0 (repo copy; live ≥v7.2) · Enrichment v3 · updated 2026-09-18 — Billing desk handed to CLAUDE_BILLING.md (§23 now pointers + Orders-tab internals); pilot language removed (ALL_USERS since 2026-08-06); scoped tags (§21) and per-user access (§22); slot modal, E shortcut and slot-cutoff fetch recorded as retired*
