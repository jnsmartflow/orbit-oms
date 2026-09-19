# code-update-2026-09-14-sap-paste-import

**Classification:** `code-update-*` — **SHIPPED.** Commit `37ceb57a` ("feat(import): paste the SAP OBD list
from the clipboard, and run it from the header"), confirmed on `origin/main` (`c539aae4..37ceb57a`). One
follow-up in the working tree at the time of writing, NOT yet committed: the dead "View Audit" button
removed from the Manual template result screen (`components/import/import-modal.tsx`).

**Target canonical file (a later consolidation pass, not this one):** `CLAUDE_IMPORT.md` — §1/§2 (a third
source), §3 (the screen-list layout), §4 (the `[sap-paste]` marker — already added in v1.10), §5, §9 (two
actions), §11 (the modal + pill), §14 (the landmines below), §15 (the orphan-policy note). No new canonical
file, so the router (`CLAUDE.md`) does not change.

**Mockups:** `docs/mockups/import/paste-import.html` (the modal, 4 states) and
`docs/mockups/import/import-pill.html` (the header pill, 5 states).

**Fixtures:** `docs/fixtures/12.09.2026.txt` (the real clipboard sample) and `docs/fixtures/EXPORT 12.09.XLSX`
(the same day as an .xlsx).

⚠ Line numbers below are as of commit `37ceb57a`. `route.ts` is ~4,600 lines and moves; re-grep the named
function before trusting a number.

---

## 1. The source

The operator copies SAP's on-screen OBD list and pastes it, instead of exporting an .xlsx and uploading it.
**Paste is the default tab** of the Import window; the .xlsx and Manual template tabs are unchanged.

### 1.1 Routes — `app/api/import/obd/route.ts`

| Action | Handler | Notes |
|---|---|---|
| `sap-paste-preview` | `handleSapPastePreview` (`:2203`) | Read-only. Same `SapPreviewResponse` as the .xlsx preview, `filename: "Clipboard paste (N rows)"`, plus `unresolvedCustomers` |
| `sap-paste-confirm` | `handleSapPasteConfirm` (`:2356`) | The write. A copy of `handleManualSapConfirm` with three differences, each marked in the code |

- Both dispatch AFTER the session auth + `import_obd canImport` gate (`:4614-4615`). No HMAC path.
- Both gated by `SAP_IMPORT_ENABLED`, exactly as the .xlsx handlers — paste is off wherever the file path is.
- Body: JSON `{ block, obdEmailDate }`, parsed by `parseSapPasteBody` (`:2161`). `obdEmailDate` is validated
  exactly as `parseManualSapForm` does. **The SAP list has no date column** (19 columns, same as the .xlsx),
  so the date defaults to today in the UI, as for the file.
- **`SAP_PASTE_MAX_CHARS = 4_000_000`** (`:2139`) → a **413 as JSON** (`:2180`). This exists because Vercel's
  own 4.5 MB body limit returns a NON-JSON 413, which a client calling `res.json()` would surface as a parse
  error. A full day is ~370 KB, so the cap is ~12× headroom. The client checks the same number before posting.
- A paste that cannot be read returns **400 `{ ok: false, error, errors: PasteRowError[] }`**
  (`SapPasteBlockedResponse`, `lib/import-types.ts`) and writes nothing.

### 1.2 The library — `lib/sap-paste/`

| File | What | Pure? |
|---|---|---|
| `read-paste.ts` | `readPaste(block)` → `ReadPasteResult` — the pipe-ruled screen list → `RawSapRow[]`. Never throws; every problem is a per-line error, ANY error blocks the paste | **Pure, sync** — client-importable (the modal runs it for its live summary) |
| `index.ts` | `parseSapPaste(block, { fallbackObdEmailDate })` → `{ kind: "ok", result: ParseResult } \| { kind: "blocked", error, errors }` (`:42`) | **Async** — calls `buildObds`, which reads the catalog. Never import this from a client component (it pulls in prisma) |
| `resolve-names.ts` | `resolvePasteCustomerNames(obds, createObdNumbers)` — one `delivery_point_master.findMany` (`:90`) | **DB read** — deliberately outside the pure modules |

**The reuse point is `RawSapRow[]`.** `index.ts` imports `groupRows` (`:60`), `applyRules` and `buildObds`
(`:62`) from `lib/sap-parser/` **UNCHANGED** and mirrors `parseSapFile` step for step, including the
`createdObds + skippedDeliveries === uniqueDeliveries` invariant. No file in `lib/sap-parser/` or
`lib/import-upsert/` was edited by this build.

The accepted shape (verified against the fixture): every line starts and ends with `|`; the header appears
once; three ruler lines of `-`; 19 columns in the .xlsx order; `.` decimal, `,` thousands (`1,290.500`); no
pipe ever inside a name or description (0 in 90 days of names and descriptions, SELECT 2026-09-14). Header
detection is a real test (`looksLikeHeader`, `read-paste.ts:113`): 19 cells, cell 1 starts "Deliv", cell 12
is "Item", cell 13 starts "Mater".

### 1.3 Source value and marker

- **`ImportSource` stays `"manual-sap"`** (`route.ts:2496`) — deliberately. The paste is the same SAP report,
  so it must carry the same `LINE_AUTHORITY` (`true`: can overwrite qty/volume/isTinting, restore and
  soft-remove lines). Adding a fourth source was rejected (CLAUDE_IMPORT §14).
- **Batches are told apart ONLY by `headerFile`:** `[sap-paste] clipboard N rows (obdEmailDate: YYYY-MM-DD)`
  (`route.ts:2390`). `import_batches` has no source column (CLAUDE_IMPORT §4, corrected v1.10). Per-OBD
  audit notes still read `via manual-sap batch BATCH-…`.

---

## 2. 🔴 The line-number conversion — the landmine this build exists for

### 2.1 The fact

A picked batch sub-row is **`"001"` on the SAP screen** and **`900001` in the .xlsx and from auto-import**.
The screen drops the `900` and zero-pads the rest to three digits. Main items (`10`, `20` … `630`) never
carry a leading zero.

**Verified against live data 2026-09-14 (read-only SELECTs):**
- Last 14 days: auto-json stored 5,746 sub-item lines at `900001–900057` and 936 main lines at `10–420`;
  manual-sap stored 475 at `900001–900032` and 95 at `10–210`.
- **No live writer has ever stored a 1/2/3-style lineId:** zero small non-multiple-of-10 lineIds in 60
  days, and zero main-item lineIds that are not a multiple of 10 across the whole table (earliest row
  2026-05-14). Highest sub-item ever: `900061`; highest main item: `630`; zero OBDs at `≥ 900100`.

### 2.2 Why it runs on the RAW TEXT

`toInt("010")` is `10` — which is also real main item `10`. **The leading zero is the only thing that tells
a picked row from a main item**, so the token must be classified before anything turns it into a number.
Measured (60 days to 2026-09-14): 566 sub-item lines end in `0`, and **38 of them share their integer lineId
with a main item on the same OBD** (none with the same SKU — so no composite-key drop today, but lineId
would stop identifying a line).

`read-paste.ts:258-283` (PASS 3):

```
/^0\d{2}$/ and value > 0        → item = 900000 + value     (SUB_ITEM_BASE, :88)
starts "0" but not that shape   → error "leading zero but not 3 digits - SAP's format has changed"
/^[1-9]\d*$/:
    value % 10 !== 0                              → AMBIGUOUS error
    value >= 100 && highSub[delivery]             → AMBIGUOUS error
    else                                          → item = value
anything else                   → error "Item \"T\" is not a number."
```

`highSub[delivery]` (PASS 2, `:239`) = the delivery has any picked token `≥ 090` (`HIGH_SUB_THRESHOLD`, `:96`):
close enough to 100 that a later un-padded `100`, `110` … could be either.

**Ambiguity is ALWAYS a hard error, never a guess.** The message tells the operator to import that day from
the .xlsx instead. Neither threshold has ever been met by live data (above).

### 2.3 Why it runs BEFORE applyRules

`BATCH_SUB_ITEM_FLOOR = 900000` (`lib/sap-parser/apply-rules.ts:47`, used at `:134` and `:217`) drives rule P —
the parent-item double-count fix. A parent row is dropped only when the same delivery carries a SURVIVING
sub-item row (`item ≥ 900000`) for the same SKU. **Unconverted, `"028"` is 28, never qualifies, and the
2026-09-07 bug returns:** OBD `9109269668` stored `54 + 26 + 26` against a true `80` (parent item 10 still
carried the 26 units sub-item 900028 also carried).

### 2.4 What it would have broken on the patch path

`makeKey` is `${lineId}|${skuCodeRaw.trim()}` (`lib/import-upsert/lines.ts:28`). About 96% of manual-SAP hits
land on the PATCH path (7 days to 2026-09-14: 2,734 of 2,834; 967 of the week's 1,067 OBDs were created by
auto-import first). Unconverted, `1|SKU` never matches the stored `900001|SKU`, so the authoritative branch
(`lines.ts:152`) **soft-removes every picked line of the OBD and re-adds it under a new id** — detaching
`pick_findings`, `split_line_items`, `delivery_challan_formulas` and `tinter_issue_entries` from their line.
The exposure: **18,250 sub-item lines across 5,202 OBDs in 60 days.** A later .xlsx upload would then
restore the `900001` rows and remove the `1` rows — a flip-flop on every alternation.

---

## 3. 🔴 Customer names — the width trap

### 3.1 The fact

The screen list prints the two name columns at fixed widths: **22 (sold-to) and 25 (ship-to)** — measured
from the fixture's header cells, `"Name of sold-to party "` (22) and `"Name of the ship-to party"` (25).
`PASTE_NAME_WIDTHS` (`read-paste.ts:35`), `WIDTH` (`resolve-names.ts:28`).

- A name that FITS prints whole — including one exactly 22 / 25 long. The fixture has 23 sold-to names
  trimmed to exactly 22 and 38 ship-to names trimmed to exactly 25: **those are COMPLETE.**
- A name that does not fit prints `width − 1` characters, with the last position left blank; the cell is
  trimmed, and if the last kept character was itself a space it trims one further. **So a cut name arrives
  at 20 OR 21 (sold-to) and 23 OR 24 (ship-to).** Fixture examples: `"Vimal Plywood & Rang"` (20) for
  "Vimal Plywood & Rang Bhandar."; `"LAXMI HARDWARE PLYWOO"` (21).
- On the 12.09 fixture: 70 bill-to and 43 ship-to names differ from the .xlsx, and in all 113 the pasted text
  is a clean prefix of the full name.

### 3.2 The rule — length decides whether to LOOK, starts-with decides whether to REPLACE

**NEVER test "was this cut?" by exact length.** An earlier draft of the design gave the widths as 21/24; any
exact-length gate built on it misses the cuts that land a character short and stores them permanently.

`resolve-names.ts`, per name field, create path only:

| Rule | Condition | Result |
|---|---|---|
| (a) | pasted text or its code blank | keep, record nothing |
| (b) | `text.length < WIDTH − 2` (`:69`) — i.e. under 20 / 23 | keep, **no lookup** |
| (c) | code not in `delivery_point_master` (`:109`) | keep, record `not-in-master` |
| (d) | master name, case-insensitive + whitespace-collapsed, **starts with** the pasted text AND is longer (`:123`) | **use the master's name**, its own spelling and casing |
| (d2) | master name EQUALS the pasted text (same normalisation) (`:133`) | keep, **record nothing** — never cut, it just sits at the limit |
| (e) | otherwise (`:137`) | keep, record `no-match` |

- **Create path only.** The patch path is already safe: `header.ts:74` only fills a NULL `shipToCustomerName`,
  and bill-to is never patched at all. Names are written only by `createPath` (`lib/import-upsert.ts:171`,
  `:228`, `:230`). In the confirm handler the resolution runs after the existing-orders preload and before
  the upsert loop, scoped to OBDs with no order (`route.ts:2470`).
- **Only `not-in-master` reaches the operator**, de-duplicated by customer CODE, as `unresolvedCustomers`
  (`unresolvedPasteCustomers`, `route.ts:2148`) — shown on the result as one line listing every code. The
  `no-match` entries appear only in the preview's per-OBD issues.

### 3.3 🔴 Why the starts-with guard exists — code 899199

**Customer code `899199` is the depot's own counter code:** one code, many walk-in buyers' names in SAP, a
single institutional label (`"Q53D Institution"`) in `delivery_point_master` — 55 distinct SAP ship-to names
on that one code in 90 days. **Without the starts-with test every counter sale would be renamed to that
label.** The same guard stops a stale or mistyped master row silently renaming a real customer.

**The code is NOT hardcoded anywhere.** The rule covers 899199, and any future bucket code, by itself. Do
not add a special case — it would be redundant today and wrong for the next bucket code.

### 3.4 Measured on the 12.09 fixture (all 229 treated as new, `scripts/_test-paste-names.ts`)

- Repaired: 109 (66 bill-to, 43 ship-to). Of those, 37 are identical to the .xlsx, 71 differ **only in
  casing** (the master is Title Case where SAP is capitals — a known, accepted consequence), 1 differs in
  text (code 3495259: the master is LONGER than SAP).
- Kept `not-in-master`: 5 fields across 3 codes (637316, 498453, 826379).
- Kept `no-match`: 2, both code 899199 — **0 counter-code names renamed.**
- Names still shorter than the .xlsx after repair: 4.
- Before (d2) existed, `no-match` was 36, and 35 of those were complete names at the width limit.

---

## 4. The header pill

The import WRITE no longer runs inside the Import window.

| Piece | Where |
|---|---|
| `ImportProgressProvider` — owns the in-flight request and one state `idle \| running \| done \| failed` plus the result | `components/import/import-progress-provider.tsx` (`:88`), mounted in the ROOT layout `app/layout.tsx:90` |
| `ImportProgressPill` + its panel | `components/import/import-progress-pill.tsx`, rendered by `components/universal-header.tsx` immediately left of the Import button (`:480`, `:505`, `:519`) |
| The hand-off | `handOffSapWrite` (`import-modal.tsx:454`) builds the request, gives it to the provider, and closes the window at once |

- **🔴 The fetch lives in the provider, not the modal** (`provider:108`). The modal is mounted by
  `UniversalHeader`, which each board renders for itself, so it unmounts on every client-side navigation;
  the root layout is the only layout that survives navigation between every screen.
- **Preview stays inside the modal.** It is a quick read the operator looks at on purpose; only the write
  moved.
- **Same pill for both SAP sources.** The pill never names the source; the panel does
  (`BATCH-… · Clipboard paste` / `BATCH-… · SAP file · <name>`). The Manual template flow is unchanged and
  keeps its in-window result.
- **No progress percentage.** The server answers once, at the end. The bar shows movement only.
- **Import is blocked while a run is in flight OR a failure is unread** (`provider:100`, and the header's
  `importBlockedReason`, `universal-header.tsx:416`). Starting another import must not wipe an unseen
  failure.
- **Neither green nor red auto-hides.** Green clears on ✕, on Dismiss, or when the next import starts. Red
  has no ✕ and clears only on the panel's Dismiss.
- **Idle renders nothing** (`pill:55`); every header's DOM is unchanged when nothing is running.
- Content-type is checked before `res.json()` (`provider:116`) so a platform 413/502 reads as what happened.
- Per-tab and in-memory by design (no localStorage). A hard refresh loses the RESULT; the import itself still
  finishes on the server.
- The modal's modal-level Ctrl+V listener (`import-modal.tsx:283-284`) exists only while the modal is open. A
  window-capture keydown stops Ctrl+V reaching `/mail-orders`' own document-capture SO-paste handler
  (`mail-orders-page.tsx:945`) while the modal is open (`:262`), so a paste cannot land in an order's SO box
  behind it.

### 4.1 Known gaps

- **`/floor` and `/picking` show no pill.** Floor has a hand-rolled header and Picking uses no
  `UniversalHeader`. The import survives visiting them; the pill reappears on the next shared-header screen.
- **`/admin/import` and `/import` still run in-page** (`components/import/import-page-content.tsx`) and
  bypass the one-at-a-time block.
- The pill ALSO renders on shared-header screens that hide the Import button (MRN, CI, Trip Report,
  Sampling Library) while a result is showing; there its panel omits "Import another".

---

## 5. Evidence

- **Fixture 12.09** (`scripts/_compare-paste-vs-xlsx.ts`): 229 OBDs, 1,556 rows read, 733 conversions,
  0 errors. Raw totals qty 9,340 / volume 44,976.2 / net 53,066.991 / total 56,712.080. **Every line field,
  every other line field (description, article, articleTag), every header field, every raw row, the
  skipped list and the warning list are identical to the .xlsx for the same day** — the only differences are
  the two customer-name fields.
- **Live 2026-09-14, twice** (verified by read-only SELECT): `BATCH-20260914-037` (18:02 IST) and
  `BATCH-20260914-038` (18:28 IST), each `[sap-paste] clipboard 546 rows`, `totalObds 98`, `skippedObds 5`,
  `failedObds 0`, **0 created, 0 OBDs patched** — i.e. 93 unchanged. The paste changed nothing auto-import had
  already written. **That null result is the proof the conversion is correct:** had any picked line keyed as
  `1|SKU`, every OBD carrying one would have come back patched with removes and adds.

---

## 6. Notes for the consolidation pass

- **§15 "cross-source orphan policy" is now partly answered.** A third authoritative source proved safe
  SPECIFICALLY because its keys match what auto-import stores (§2, §5). That is evidence about key
  compatibility, not a policy: it does **not** settle the v1-vs-v2 lineId question (v1 ordinal 10/20/30 vs v2
  real item numbers), which stays open.
- **CLAUDE_IMPORT §9's `POST` snippet still lags the code** (flagged in v1.10, not rewritten): role list
  includes `OPERATION_MANAGER` and `OPERATIONS`, there is no admin short-circuit before `checkPermission`, and
  the two paste actions are absent.
- **Further false claims found in CLAUDE_IMPORT while doing v1.10, NOT fixed there** (each checked in code
  2026-09-14):
  - §5: `cells.ts` exports `toStr` / `toNum` / `toInt` / `toStrOrNull`, not `readInt` / `readFloat` /
    `readString`; `read-sheet.ts`'s `COL` is a NON-exported, **1-based** map (`const COL`, `read-sheet.ts:21`),
    not the exported 0-based one shown.
  - §6 file list: `upsertObd(input, source, batchId, batchRef, userId, now, options)` → `UpsertResult`, not
    `(input, ctx) → { outcome, effects }`; there is no `UpsertContext`; `UpsertOutcome` is
    `'created'|'patched'|'unchanged'|'errored'`; `state.ts` exports `loadExistingObd`, not
    `loadExistingState`; `effects.ts` exports `buildEffects` with kinds `mail-order-enrichment` /
    `challan-create` / `query-summary-rebuild` / `customer-resolved` / `order-type-mismatch`, not
    `dispatchEffects` / `apply-mail-order-enrichment` / `create-challan-for-order`; `audit.ts` exports
    `formatAuditNote` + `writeAuditLogs` and writes **`order_status_logs`**, not `recordAuditEntry` →
    `import_shadow_log`; `makeKey` trims `skuCodeRaw`.
- **The "no pure parser" correction reaches the paste too:** `readPaste` is pure and client-safe;
  `parseSapPaste` is not. A client component must import `@/lib/sap-paste/read-paste` directly, never
  `@/lib/sap-paste` (that barrel pulls in `buildObds` → prisma).
