# web-update-2026-06-20 — Auto-Import v2 (pure JSON)

> **Source of truth for the v2 build.** Rebuilt 2026-06-20 because the original
> `web-update-2026-05-03-auto-import-v2-pure-json.md` was delivered as a download
> but never committed to the repo. This version merges the proven Breakwalls
> DevTools findings (Mar–May 2026) with the current code-state audit
> (route.ts 3018 lines, schema v27.6) and the locked decisions below.
>
> Save to: `docs/prompts/drafts/web-update-2026-06-20-auto-import-v2-pure-json.md`
> Claude Code reads this at the start of every v2 build prompt.

---

## 1. Goal

Replace Auto-Import's per-OBD Excel-download pipeline with a **pure JSON** pipeline.

Today (v1, currently PAUSED per IMPORT.md §10):
- Per OBD: `/formdata` (`FormSubmitData` + `button:"Download"`) → `{ downloadFile }` → GET `.xlsx`
- Once/day: `/export` → header `.xlsx` (LogisticsTrackerWareHouse)
- Merge into `Combined_OBD_<date>.xlsx` → POST multipart to `?action=auto`
- Result: ~100–200 file downloads/day + a header file. Heavy, slow, loud in Breakwalls audit logs.

v2:
- Per OBD: `/formdata` with **`action:"FormGetData"`** → header + line data as **inline JSON**. No file.
- Header data: already present in the `/data` listing JSON (all 19 fields OrbitOMS needs). No header file.
- A pre-check call to OrbitOMS skips OBDs already imported, so we don't even *open* them.
- POST a JSON body to a new `?action=auto-json` handler.
- Result: **zero file downloads.** To Breakwalls it looks like a person browsing OBD detail views — indistinguishable from human use.

Estimated Breakwalls audit-log reduction: ~220 file-export events/day → 0, replaced by
~100–150 quiet JSON form-view calls (and far fewer once the pre-check skips known OBDs).

---

## 2. Proven Breakwalls findings (DO NOT re-investigate — captured via DevTools)

| Endpoint | Method | v2 use | Returns |
|---|---|---|---|
| `/deco-tracker/LoginV2/Login.aspx` | GET/POST | Auth (unchanged from v1) | HTML + `.BWU` cookie |
| `/deco-tracker/data` | POST | OBD listing **+ all 19 header fields** | JSON header rows |
| `/deco-tracker/formdata` (`FormGetData`) | POST | **Per-OBD header + line items as JSON** | JSON, no file |
| `/deco-tracker/formdata` (`FormSubmitData`,`Download`) | POST | v1 only — being retired | `{ downloadFile }` → xlsx |
| `/deco-tracker/export` | POST | v1 only — being retired | `{ downloadFile }` → xlsx |

### 2.1 The `FormGetData` payload (proven working)

```json
{
  "action": "FormGetData",
  "reportId": "Reports/105VCsI1rQ6u1QSEyGJ7I3Lc",
  "columnClicked": "PickListId",
  "componentId": "c01105VCsI1rQ6u1QSEyGJ7I3Lc",
  "formName": "View OBD Details",
  "uniqueKVP": { "PickListId": "<obdNumber>" }
}
```

Response: inline JSON containing the OBD's header fields **and** its line items
(SKU, description, pack, qty, volume per line) — the same data v1 currently
gets from the downloaded per-OBD `.xlsx`.

### 2.2 Hard limit (proven)

**No bulk line-item endpoint exists.** `FormGetData` is per-OBD — one call per OBD,
exactly like v1. We cannot fetch all lines in one shot. The pre-check (§4.3) is what
keeps the per-OBD call count down: we only `FormGetData` OBDs that are genuinely new.

---

## 3. Locked decisions (2026-06-20)

1. **v2 is the plan.** Build it; do not unpause v1 first.
2. **JSON line items: proven** (`FormGetData`). No further investigation needed.
3. **`processAutoImportRows()` accepts normalised arrays** — the same header-rows +
   line-rows shape v1 builds from the XLSX. Both entry points feed it.
4. **netWeight / totalWeight:** map from JSON if present; else null (v1 leaves them
   null for auto-import → still parity).
5. **HMAC:** separate secret `IMPORT_HMAC_SECRET_JSON`, key id `auto-import-json-v1`,
   HMAC of the literal string `"auto-import-json-v1"` (timestamp-free, mirrors v1).
6. **Cutover:** build v2 → smoke-test → enable v2 in Task Scheduler. v1 stays on disk,
   disabled, as fallback. No long parallel run.
7. **removedObdSet dead-code:** v2 matches v1 behaviour exactly (removed OBDs skipped
   silently like duplicates). Distinct `previously_removed` tagging is a **separate**
   cleanup ticket — NOT part of this build.

### 3.1 Local PC enrichment v2 MUST replicate (audited 2026-06-20 from Auto-Import.ps1)

OrbitOMS passes these through untouched, so the PC must produce them identically:

- **`isTinting`** (T1): SMU-gated keyword match. Gate: SMU must be in
  {Decorative Projects, Retail Offtake}, else FALSE. Then TRUE if `skuDescription.ToUpper()`
  contains any keyword from `Master\tinting-keywords.txt`. **v2 keeps this PC-side, unchanged.**
- **`article`** (T2): `packSize = round(volume/qty, 4)` → look up in `Master\pack-sizes.txt`
  ([DRUM]/[BAG]/[CARTON] sections). Drum/Bag → article = unitQty. Carton →
  floor(qty/unitsPerCarton) + (qty % unitsPerCarton). No match → null.
- **`article_tag`** (T3): same lookup → Drum "{qty} Drum", Bag "{qty} Bag",
  Carton "{fullCartons} Carton {looseTins} Tin" (omit zero parts; both zero → "0 Tin").
  No match → null.
- **Config files stay on disk** in `Master\` — v2 reads them at runtime (NOT committed to repo),
  so pack sizes / keywords can be edited without redeploying the script.
- **Numeric cleaning** (T6): strip non-digit/non-period before casting qty & volume.
- **Date fields**: emit ISO `yyyy-MM-dd` strings (parseDateCell handles them).
- **Text IDs** (obdNumber, customer ids, soNumber, smuCode): keep as strings (no number coercion).

### 3.2 Fields absent in v1 (handled per decisions)

- `lineId`: v1 = 0 always. v2 = real SAP line number (decision, §4.4).
- `netWeight`/`totalWeight`: absent in v1. v2 maps from FormGetData if present, else null.
- `batchCode`: Breakwalls never provides it. Stays null.

### 3.3 RESOLVED — FormGetData line-level field map (from DevTools capture, 2026-05-03)

`/formdata` with `action:"FormGetData"` returns: `data.value` (header) + `data.data` (line array).
Header is taken from `/data` listing instead (all 19 fields), so only the line array is used.

Line array fields → OrbitOMS mapping:

| FormGetData field | OrbitOMS field | Notes |
|---|---|---|
| `Lineid` | `lineId` | **v2 fix** — real SAP line number (v1 always sent 0) |
| `SKUCode` | `skuCodeRaw` | |
| `SKUDesc` | `skuDescriptionRaw` | also feeds the tinting keyword match |
| `UnitQty` | `unitQty` | arrives as a number — no string cleanup |
| `Volume` | `volumeLine` | arrives as a number |
| `BatchNo` | `batchCode` | **available**, but kept null in v2 for clean parity (easy future add) |
| `UoM` | — | discarded (not used by OrbitOMS line schema) |

NOT in FormGetData: `netWeight`, `totalWeight`, item category. Therefore:
- weights stay null (matches v1, decision #4 fallback)
- tinting stays the PC keyword-file method (cannot switch to Z007 — no category field)

Per-OBD SMU (for the tinting SMU-gate, §3.1 T1) comes from the `/data` listing header for that OBD.

Bulk line fetch confirmed impossible — `FormGetData` per-OBD is the floor.

### 3.4 RESOLVED — `/data` header contract + full field-key map (from 2026-05-03 capture)

`/data` returns per row (header source — `/export` eliminated):
`PickListId, SONum, SMU, SMUCode, MaterialType, NatureOfTransaction, SiteId,
PickListEmailDate, PickListEmailTime, PendingStatus, UnitQty, Volume, GrossWeight,
SoldToCustomerId, SoldCustomerName, ShipToCustomerId, ShipCustomerName, ShipToPincode,
InvoiceNo, InvoiceDate` (+ bonus: ShipToDestination, ShipToState, TagNum, ModeOfTransport,
TransporterType, CustomerMobileNo, SiteIdCode — all discarded).

FormGetData response: `data.value` (header, used only as fallback) + `data.data` (lines).

**headerRows[] — emit these EXACT keys (route.ts reads hr["…"] with spaces/caps):**

| route.ts key | ← /data field | notes |
|---|---|---|
| `"OBD Number"` | `PickListId` | |
| `"SONum"` | `SONum` | |
| `"SMU"` | `SMU` | also drives Get-Tinting SMU gate |
| `"SMU Code"` | `SMUCode` | |
| `"MaterialType"` | `MaterialType` | |
| `"NatureOfTransaction"` | `NatureOfTransaction` | |
| `"Warehouse"` | `SiteId` | |
| `"OBD Email Date"` | `PickListEmailDate` | emit `yyyy-MM-dd` string |
| `"OBD Email Time"` | `PickListEmailTime` | |
| `"Status"` | `PendingStatus` | ⚠ verify vs v1 in step 8 (likely same; informational) |
| `"UnitQty"` | `UnitQty` | |
| `"Volume"` | `Volume` | |
| `"GrossWeight"` | `GrossWeight` | |
| `"Bill To Customer Id"` | `SoldToCustomerId` | sold-to = bill-to at this depot |
| `"Bill To Customer Name"` | `SoldCustomerName` | |
| `"ShipToCustomerId"` | `ShipToCustomerId` | |
| `"Ship To Customer Name"` | `ShipCustomerName` | |
| `"InvoiceNo"` | `InvoiceNo` | |
| `"InvoiceDate"` | `InvoiceDate` | emit `yyyy-MM-dd` string |

**lineRows[] — emit these EXACT keys (route.ts reads lr["…"]):**

| route.ts key | source |
|---|---|
| `"obd_number"` | the OBD being fetched (set by script) |
| `"sku_codes"` | FormGetData `SKUCode` |
| `"sku_description"` | FormGetData `SKUDesc` |
| `"line_id"` | FormGetData `Lineid` (**real number — v1 sent 0**) |
| `"unit_qty"` | FormGetData `UnitQty` |
| `"volume_line"` | FormGetData `Volume` |
| `"Tinting"` | derived: Get-Tinting(SKUDesc, header.SMU) → "TRUE"/"FALSE" |
| `"article"` | derived: Get-ArticleInfo(Volume, UnitQty).Article |
| `"article_tag"` | derived: Get-ArticleInfo(Volume, UnitQty).Tag |
| `"batch_code"` | null (BatchNo available but kept null for parity) |

netWeight/totalWeight: route never reads them from lineRows — omit. They stay null in DB.

### 3.5 Header-patch for existing OBDs (NEW requirement — 2026-06-20, expanded)

**Why:** Two fields go stale on existing OBDs and need a per-cycle refresh:
1. `invoiceNo` / `invoiceDate` — assigned in Breakwalls *after* first import; absent from SAP file + line form.
2. `orderDateTime` / `slotId` — when SAP imports an OBD *first*, the SAP file has no email time
   (`obdEmailTime` always null) → `orderDateTime` = midnight, `slotId` = Night. Auto-import has the
   real `PickListEmailTime` but, being create-only, currently skips the existing order and never
   supplies it. Site orders that never get an SO→mail-order match are stuck on the weak time forever.

**Precedence for `orderDateTime` / `slotId` (derived live — NO stored marker, NO schema change):**

> mail-order `receivedAt` (SO matches a `mo_orders` row) **>** auto-import `obdEmailDate`+`obdEmailTime` **>** SAP fallback (midnight / Night)

**The patch (server-side, per existing OBD):**
1. `invoiceNo` / `invoiceDate` → fill if currently null (never overwrite — these are stable once set).
2. `orderDateTime` → **if the OBD's `soNumber` has NO matching `mo_orders` row**: overwrite
   `orderDateTime` from the incoming `obdEmailDate` + `obdEmailTime` (via `mergeEmailDateTime`), and
   recompute `slotId` + `originalSlotId` from that time. **If the SO matches a mail order → leave
   `orderDateTime` + slot untouched** (mail-order enrichment, route.ts ~263–282, owns them, rank 1).

**Slot-override guard (RESOLVED 2026-06-20):**
- The human re-slot signal is `orders.slotToOverride`. **Diagnosis found it is NOT currently set by
  the manual re-slot path** (`app/api/support/orders/[id]/assign-slot/route.ts` writes only `slotId` +
  `originalSlotId`, no flag). So it must first be made meaningful → **step 8b.0**.
- `orders.slotToOverride` has **ZERO readers** anywhere in the repo today (verified grep). It is a
  dormant field; this patch is its first consumer. So writing it in assign-slot is **zero-risk**.
- It is **only ever written** via mail-order enrichment (route.ts 259–260, mail-owned orders only).
  Our patch skips mail-owned orders → so on the non-mail-owned orders we touch, `slotToOverride` is
  reliably false unless a human reassigned. Clean guard.
- **Rule:** when fixing the time on a non-mail-owned order, recompute `slotId`/`originalSlotId`/
  `dispatchSlot` ONLY IF `slotToOverride === false` AND `orderType !== "tint"`. If `slotToOverride`
  is true → fix the time, **keep the human's slot**. Tint orders keep `slotId = null`.
- Write `orderDateTime`/`slot` only when the value actually changes (avoid every-cycle audit noise).
- `obdEmailDate` is auto-import-authoritative (header.ts ~89–108) — safe for auto-import to set.

**Loose end (not blocking):** `app/api/admin/fix-slots/route.ts` (bulk slot-recompute) also ignores
`slotToOverride` → it would still clobber manual slots. Add the same guard there someday.

**Why this is safe & self-correcting:**
- No stored source column to drift; ownership is re-derived each cycle from `mo_orders`.
- No backfill needed — existing mail-matched orders are detected live and left alone.
- Race-safe: if auto sets the time before a mail order arrives, enrichment (rank 1) overrides later.

**Confirmed code facts (diagnosis 2026-06-20):**
- Create: `orderDateTime = mergeEmailDateTime(obdEmailDate, obdEmailTime)`; slot from `resolveSlotFromTime(obdEmailTime)`.
- SAP: `obdEmailTime` always null → midnight UTC + Night slot.
- Mail-order enrichment: unconditional `orderDateTime = receivedAt` + slot recompute (non-tint); no marker written.
- Current patchHeader: `orderDateTime` + `slotId` are null-fill-only → no-op on SAP-first orders. The 8b
  patch must bypass these guards with the precedence logic above.

**Flow:** robot already has `obdEmailDate`/`obdEmailTime` + `soNumber` per OBD from `/data` — zero extra
Breakwalls calls. It sends existing OBDs' headers; the **server** decides per the precedence (it has `mo_orders`).

**Sequence:** build AFTER the create path is signed off. Build as sub-steps with its own dry-run + verify.

---

### 3.6 Smart yesterday-completeness pass (NEW — 2026-06-21, post 8b dry-run)

**Why:** The patch only ever runs on the date Phase 6 lists (today). But invoices finalise the
**next day** — the OBD is created today, the invoice is generated late tomorrow. So each day we must
revisit yesterday to catch (a) any orders that never imported, and (b) invoices/times that arrived late.
The 8b.4 dry-run proved the scale: 137/148 Saturday orders were still missing invoices a day later.

**CONFIRMED Breakwalls capability (DevTools capture 2026-06-21):** `/data` accepts a **`sonum`** param.
Sending `params: [{field:"sonum", value:"<OBD number>"}]` returns **just that one record** (`total 1
records`, `last_page:1`) **including `InvoiceNo` + `InvoiceDate`**. So a single OBD's invoice can be
fetched directly — NO paging. (Feed the OBD number / PickListId, not the SO number — an SO maps to many
OBDs. The search box is labelled "Search OBD/SO"; the field name is `sonum` but it matches the OBD id.)

**Design (each day):**
1. **Morning (first run of the day):** ONE full pass on yesterday — page the full listing, pre-check,
   **create any missing orders** + **patch all existing** (invoices + times). Catches missing orders
   AND the morning wave of late invoices.
2. **Every cycle after:** OrbitOMS returns yesterday's **still-pending-invoice OBDs** (orders with null
   `invoiceNo` for that date). Robot fetches each via `/data` with the `sonum` filter → builds a patch
   row → sends to `patch-headers`. The pending list **shrinks each cycle**; once empty, stop chasing
   yesterday for the rest of the day. Light + quiet on Breakwalls.

**New pieces required:**
- OrbitOMS: a small read-only action `?action=pending-invoices` taking a **date range**
  `{ fromDate, toDate }` → returns OBD numbers in that span with `invoiceNo IS NULL` (and not
  soft-removed). Safety cap (~31 days max range).
- Robot: the morning full-pass on yesterday (reuse the `-TargetDate`/Phase-6 machinery automatically for
  the previous day) + the per-cycle `sonum` chase driven by the pending list. Track "yesterday clean for
  today" so the chase rests once the list is empty.

**Chase window (decided 2026-06-21):** rolling **3 days** back up to yesterday (most invoices land
next-day; 3 days covers stragglers). **Floored at the go-live date** so it never reaches Saturday or
earlier (honours "don't fix Saturday"). Orders that never get an invoice simply **age out** of the
3-day window and stop being chased — the list self-limits.

**Window note:** strict one-day look-back; on Monday "yesterday" = Sunday (empty), so Fri/Sat late
invoices landing Monday are out of scope (user accepted — not fixing Saturday). Widen to 2 days only if
weekend straddle becomes a problem.

**Sequence:** this is a NEW increment AFTER the core 8b patch is live. Build + test separately.

**Known recovery gaps (verified 2026-06-21, pre-existing — accepted for launch, manual SAP is backstop):**
- Phase 3 recovery creates only MISSING orders for the rolled-over date, with correct times, and retries
  on upload/page failures. ✓ Covers the common partial-day-downtime case.
- Gap 1: if a single OBD's FormGetData fails mid-recovery, state goes "partial" and that OBD is NOT
  re-attempted → stays missing. Rare (needs a Breakwalls hiccup on that exact OBD during recovery).
- Gap 2: if the robot is off a WHOLE calendar day, $rolledOverFrom = two-days-ago, so Phase 3 recovers
  the skipped day but misses TRUE yesterday's never-created orders. The 3-day chase compensates on the
  invoice side only. Rare (full-day depot-PC outage on a business day).
- Backstop for both: manual SAP import remains available. Future hardening optional (e.g. retry the
  partial case; multi-day recovery look-back).

---

## 4. OrbitOMS server changes (`app/api/import/obd/route.ts`)

### 4.1 Refactor — extract `processAutoImportRows()`

Current per-OBD create logic is inline in `handleAutoImport()` (audit: lines ~2670–2982),
including the 3 guards (GUARD 1 ~2530, GUARD 2 ~2606–2637, GUARD 3 ~2787–2795),
challan auto-creation, query-summary build, and mail-order enrichment hook.

Extract into:

```ts
async function processAutoImportRows(
  headerRows: AutoHeaderRow[],
  lineRows: AutoLineRow[],
  ctx: { batchId: number; existingObdSet: Set<string>; /* ...same ctx v1 uses */ }
): Promise<AutoImportResult>
```

- `AutoHeaderRow` / `AutoLineRow` = the normalised shapes v1 already builds from the XLSX
  (do NOT invent a new shape — match what handleAutoImport currently constructs).
- All guards, dedup-skip, challan, enrichment, shadow signalling move inside unchanged.
- `handleAutoImport()` (multipart/xlsx path) now: parse xlsx → build the arrays →
  `processAutoImportRows(...)`. **Behaviour must be byte-for-byte identical to today.**

### 4.2 New handler — `?action=auto-json`

```ts
if (action === "auto-json") return handleAutoImportJson(req);
```

- HMAC-verify with key id `auto-import-json-v1` + `IMPORT_HMAC_SECRET_JSON`
  (extend `verifyHmacSignature()` or add a sibling — keep v1's check intact).
- Body: `{ headerRows: [...], lineRows: [...] }` (already normalised by the PS tool).
- Build the arrays from the JSON body → `processAutoImportRows(...)`.
- Same response shape as `?action=auto`: `{ batchRef, ordersCreated, skippedDuplicates, errors }`.
- `export const dynamic = "force-dynamic"` already present (line 28) — keep.

### 4.3 New handler — `?action=check` (pre-check, read-only)

```ts
if (action === "check") return handleAutoImportCheck(req);
```

- HMAC-verified with the same v2 key (read-only, but still signed).
- Body: `{ obdNumbers: ["...", "..."] }`.
- Returns: `{ existing: ["..."] }` — OBDs already in OrbitOMS (treat removed as existing,
  matching v1's `existingObdSet` which includes removed — see decision #7).
- The PS tool calls this **first**, then only `FormGetData`-fetches the OBDs NOT in `existing`.

### 4.4 Parity rules — what NOT to change

- CREATE-ONLY. v2 never patches existing OBDs (same as v1).
- The 3 guards, challan auto-creation (Retail Offtake / Decorative Projects only),
  `applyMailOrderEnrichment()` hook, shadow runner — all preserved.
- `lineId`: **v1 does NOT send line numbers — every auto-import row lands as `lineId = 0`**
  (audited 2026-06-20; this is the orphan risk in IMPORT.md §15). v2 INTENTIONALLY fixes this
  by sending the real SAP line number from FormGetData. This is the ONE approved deviation from
  strict v1 parity. Harmless today (create-only) and corrects the composite key. Step-8 compare
  must expect lineId to differ (0 in v1 → real number in v2) as an approved difference.
- No `prisma.$transaction` (sequential awaits). No `prisma db push`. camelCase, no `@map`.
- `tsc --noEmit` must pass before commit. Commit to main.

### 4.5 Current-state deltas to honour (since v26.5)

- `import_raw_line_items.netWeight` / `.totalWeight` (schema ~lines 558/559) exist; null
  for auto-import today. v2 follows decision #4.
- `import_shadow_log` + `runAutoImportShadow()` (~line 2030, `IMPORT_SHADOW_MODE` gated)
  exist. v2's path should route through the same shadow runner where v1 does.
- No `ObdSource` enum in schema — source is a plain `String` in `import_shadow_log`. Don't add one.

---

## 5. PowerShell — `Auto-Import-v2.ps1` (new file, parallel to v1)

Reuse v1's login + cookie-cache + retry helpers verbatim. Changed phases only:

| v1 phase | v2 |
|---|---|
| Login | unchanged (reuse cached `.BWU` cookie) |
| Spec prime | unchanged |
| List fetch (`/data`) | unchanged — now also the **header source** (19 fields) |
| **Pre-check** | NEW: POST OBD numbers to OrbitOMS `?action=check`, keep only new ones |
| **Per-OBD file download** | REPLACED: `/formdata` `FormGetData` → JSON, in memory |
| **Save files / merge** | REMOVED |
| Upload | POST JSON body to `?action=auto-json` (HMAC `auto-import-json-v1`) |

Error handling:
- `FormGetData` fail → retry, then add OBD to `failed-obds.txt` (don't fail whole run).
- Auth expired (login redirect detected) → re-login once, retry.
- OrbitOMS POST fail → save payload locally for next-cycle retry (mirror v1's `pending-upload.txt`).

PowerShell 5.1 quirks (CORE §3): `[BitConverter]` not `[Convert]::ToHexString`;
`Invoke-WebRequest -UseBasicParsing`; `;` not `&&`.

---

## 6. Build sequence

```
[x] 1. Rebuild + save design doc (source of truth)
[x] 2. Verify against current code state (v27.6)
[x] 3. Audit v1 PS local enrichment (done 2026-06-20 — see §3.1)
[ ] 4. OrbitOMS: refactor inline logic → processAutoImportRows()  (no behaviour change)
[ ] 5. OrbitOMS: add ?action=auto-json + ?action=check handlers
[x] 6. Provision v2 HMAC secret (Vercel env IMPORT_HMAC_SECRET_JSON + key file on depot PC)
[x] -- GATE: FormGetData line-level fields confirmed (§3.3, from 2026-05-03 capture)
[ ] 7. Build Auto-Import-v2.ps1 (pre-check → FormGetData JSON → replicate §3.1 → auto-json POST)
[ ] 8. Smoke test: run v2 on a small known batch, compare row-for-row vs v1 (expect lineId diff)
[ ] 8b. Build + test header-patch for existing OBDs (invoiceNo + invoiceDate only — §3.5)
[ ] 9. Cutover: disable v1 task in Scheduler, enable v2 task
[ ] 10. Monitor 2–3 days, then retire v1
```

Each step: diagnosis separate from implementation; `tsc --noEmit` passes before commit;
explicit `git add`; commit to main; smoke-test before push.

---

## 7. Rollback

- Steps 3–4 are additive (new handlers, behaviour-preserving refactor). If `?action=auto-json`
  misbehaves, v1's `?action=auto` is untouched — re-enable v1 task, disable v2 task.
- v2 PowerShell is a separate file; v1 `Auto-Import.ps1` stays on disk.
- v2 HMAC key is separate; revoking `IMPORT_HMAC_SECRET_JSON` kills only v2.

---

*Planning doc · OrbitOMS · 2026-06-20 · schema v27.6*
