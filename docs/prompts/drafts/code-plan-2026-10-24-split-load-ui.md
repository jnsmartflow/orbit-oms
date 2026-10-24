# Split load — Phase 3 UI plan · 2026-10-24

Status: **PLAN ONLY — no code.** Builds on phase 2 (`4797bc21`: `lib/order-invoices/load-plan.ts`,
`load-split.ts`, `GET/POST /api/floor/orders/[orderId]/load-split`, `POST …/load-merge`, the
`floor_split_load` key resolved as `canSplitLoad` in `app/(floor)/floor/page.tsx` and declared — not
destructured — on `FloorPage`). The look is `docs/mockups/split-load/split-load-mockup.html`. Every claim
below names the file it was read from (HEAD `4797bc21`).

---

## A. Each piece — component, file, new or edited, props and data

| Piece | File | New / edited | Props / data it needs |
|---|---|---|---|
| **"Split load" item in ··· More**, directly under Add invoices, same item shape (icon + label + one-line hint, grey with reason) | `components/floor/floor-bottom-bar.tsx` (the `MoreMenu items` array, `:243-281`; the menu shell is `floor-action-bar.tsx` `MoreMenu`) | edited | new optional props `splitLoad?: { hint: string; disabled: boolean } \| null`, `onSplitLoad?`, `mergeBack?: {…} \| null`, `onMergeBack?`, `repairSplit?: {…} \| null`, `onRepairSplit?` — the same shape as `addInvoices` (`:143`). null = not drawn. Icons: lucide `Split`, `Merge`, `Wrench` (present in lucide-react 0.577.0, checked in node_modules). Order: Hold · Add invoices · **Split load** · **Merge back** · **Repair split** (only when half-written) · divider · Cancel / Raise CI. |
| **The menu state** (which item is grey, with what words) | `components/floor/floor-page.tsx` beside `addInvMenuItem` (`:2666-2706`) | edited | `canSplitLoad` destructured at last (`:530-545`). ONE fetch of `GET …/load-split` when the menu opens with exactly one unit ticked — the `addInvCheck` pattern (`:2667-2691`), its own state `loadCheck: { orderId; view: LoadView } \| null`. "Exactly one" = `selectedUnits.length === 1` and that unit is either a WHOLE unsplit OBD (`invoiceRows.length < 2`) or ONE invoice row (`invoiceRowIds.length === 1`) — `lib/floor/selection.ts` `selectionUnits` (`:207-221`) already gives both. Hints: no unit / more than one → "Tick one bill or one part to split"; a whole split OBD ticked → "Tick one part to split"; else the GET row's `canSplit` text (null → "Divide this invoice across trucks"). Merge back: drawn when the ticked row is in a load group (`n ≥ 2`); enabled when the group has ≥ 2 rows with `canMergeAway === null` or the root, all waiting and same hold (the rowIds it sends: owner question 1); grey with the API's own refusal text otherwise (dry-checked with the pure `planLoadMerge` / `loadMergeRefusal` over the GET rows, so the hint is the server's sentence). Repair split: drawn ONLY when `view.halfWritten`. |
| **Split load dialog** | `components/floor/split-load-dialog.tsx` | **new** | `{ orderId, obdNumber, sourceRowId, escSignal, onBusyChange, onClose, onSaved(nTrucks) }` — the `AddInvoicesDialog` contract (`add-invoices-dialog.tsx:58-81`), z-[120] over the panel, NO key listener (floor-page is the Esc owner, `escSignal`). Reads `GET …/load-split` itself on open (the dialog never trusts the menu's copy — `expectKey` must be fresh). Layout per mockup: one row per product line of the SOURCE row (`view.rows[source].lines`, resolved — unsplit seq 1 = every active line); columns Product (name + "x kg per tin") · Tins here · Truck A … Truck {last} "(rest)". Truck A..n-1 typed (`inputmode="numeric"`), LAST = rest (auto, red when < 0). "+ Add truck" inserts a typed column BEFORE the last; ✕ on trucks 3+ only; "Split evenly" = `floor(tins / trucks)` on every typed truck, rest to the last (mockup `evenBtn`). Footer per truck: tins · litres · kg. Save disabled with the reason shown beside it — the reason is the FIRST error of the pure **`planLoadSplit`** (`load-plan.ts`) run on the GET rows, so Save is enabled only when the server will accept (the Add invoices / `validateSplit` pattern); the server's 400/409 text is still shown word for word. POST body `{ sourceRowId, expectKey, trucks: [{ lines }] }`; 409 "changed since you opened it" → a "Reopen" step that re-reads. Commit button `BAR_PRIMARY`, Cancel `BAR_SECONDARY` (CLAUDE_UI §13). |
| **Dialog kg — the board's ladder** | `lib/order-invoices/load-split.ts` `loadLoadView` + the dialog | edited (GET only) + new | 🔴 NOT `kgShare` (the Add invoices dialog uses only rule 3, `add-invoices-dialog.tsx:702`). Per truck: **`invoiceKg`** (`lib/floor/invoice-rows.ts:162`, pure, already exported) over that truck's lines — rule 1 SAP line kg, rule 2 learned kg per tin, rule 3 "~" share. It needs per active line `totalWeight` and `unitKg` (learned, `lib/order-invoices/kg-per-unit.ts learnedKgPerUnit`) and the OBD's header kg (`querySnapshot.totalWeight`). **`LoadView` gains `kg: { obdKg: number \| null; lines: { rawLineItemId; totalWeight: number \| null; unitKg: number \| null }[] }`**, read in `loadLoadView` only (two extra SELECTs). `loadActiveLines` / `SplitActiveLine` are NOT touched — they are the Add invoices GET's shape. Litres per truck: `lineLitres` (`lib/order-invoices/entry.ts`). |
| **Merge back** | floor-page handler → `POST …/load-merge` | edited | no dialog: a one-step confirm toast-free press like Hold? → owner question 2 (recommended: a small confirm "Merge parts 2, 3 of I536230716 back into part 1? 25 tins" inside a centred dialog, the `AddToTripConfirm` pattern, because it deletes rows). `expectKey` from the menu's GET. After: `load()` + `invoicesRefreshKey`. |
| **Repair split** | floor-page handler → `POST …/load-split { mode: "repair" }`; banner in `detail-panel.tsx` | edited | menu item (above) + a warn banner at the top of the panel's Items tab "The last split did not finish — Repair" with a button (the `scopedStale` banner slot, `detail-panel.tsx:1083-1087`). The panel learns `halfWritten` from the board row (C below). |
| **"part k of n" TAG** next to the invoice number | `components/floor/bill-ref-cells.tsx` | edited: new `LoadPartChip` + `InvoiceLines` gains optional `load?: { k: number; n: number }` | `InvoiceLines` (`:71-96`) draws it after the number (and after `InvoicePartChip` when the bill also has Add-invoices papers). **No SAP number yet** (`invoiceNo` null → `InvoiceLines` draws nothing): the tag rides the OBD cell's `trailing` slot in `floor-table.tsx:1688-1700` instead. Callers: `floor-table.tsx:1769`, `hold-table.tsx:120`, `cancelled-tab.tsx:316`. |
| **Amber "part 1 gone"** on a waiting part | `bill-ref-cells.tsx` (`PairPlaceChip` warn tokens, `pair-cells.tsx:252`) via a new pure helper | edited | `goneChipOf(invoiceRowsAll, row)` in `lib/floor/invoice-rows.ts`: a part not dispatched whose group has a dispatched row → `{ text: "part 1 gone", title: "Part 1 of I536230716 left on L-261024-04" }`. Drawn on that row's Invoice cell under the tag (the `away` chip slot, `floor-table.tsx:1776-1780`). |
| **Detail panel, a part** | `components/floor/detail-panel.tsx` + a new `components/floor/detail-load-items.tsx` | edited + new | Header (`:678-690`): `"<OBD> · part k of n"` + `LoadPartChip`, and a **Part 1 \| Part 2** segmented switch calling the existing `onScopeInvoice(seq)` (`:249`) for the group's rows. Items tab: `DetailLoadItems` replaces `DetailItems` when the scoped row is in a load group — ALL the bill's lines (`d.lines`), this part's tins normal, a line with 0 tins in this part greyed whole, under each line a grey note per OTHER part carrying it: `"2× part 2 · L-261024-04"` (trip number only) / `"· waiting"` / `"· on hold"`; footer: this part's lines · tins · L · kg (kg = the board row's `scope.kg` / `kgExact` — the same ladder), then "Bill total: N tins · L · kg" (`d.totalLitres`, the board row's `weightKg`). Data: `GET …/load-split` (rows with lines, k/n, tripNumber, isHeld) instead of the Add invoices GET for a load-group scope (E). |
| **Gating** | everything above | — | every item / handler checks `canSplitLoad`; the dialog is never mounted without it; the routes re-check (403 "You do not have the Split load tick"). Past day (`billActions` false, `floor-bottom-bar.tsx:166`) hides it with the rest of ··· More. |

---

## B. "k/n" today vs the part tag — ONE helper decides

**Today, three chips already mean three things** (CLAUDE_UI §27 "Floor row drawing"):
- `KOfNChip` "1 of 2" (`pair-cells.tsx:240`) — two OBDs on ONE invoice (pairs).
- `InvoicePartChip` "2/4" (`bill-ref-cells.tsx:103`) — Add invoices: the 2nd of the OBD's 4 SAP papers.
  Drawn from `drawRowsOf` k/n (`invoice-rows.ts:397-414`), where **k = position among ALL rows by seq**.
- `InvoiceCountChip` "4 invoices" (`bill-ref-cells.tsx:121`) on the OBD cell, counting ROWS.

**The break if nothing changes:** a load part is a row, so today the bill 18648-shaped "…716 split into 2
trucks" draws `I536230716 1/2` and `I536230716 2/2` — read as TWO SAP papers, and the OBD cell says
"2 invoices". Wrong on both.

**The new tag:** `LoadPartChip` — the WORDS "part 1 of 2" (not a slash), so it can never be read as
Add invoices' "1/2". Colour: owner question 3 (the mockup's brand tint clashes with CLAUDE_UI's "on Floor
violet means selected" — `pair` token note §2.1).

**The ONE helper:** `loadGroupsOf` (`load-plan.ts`, pure — already the only home of "which group, which
part"). Wrapped once in `lib/floor/invoice-rows.ts`:
- `FloorInvoiceRow` gains optional `loadRootId?: number` (C).
- `drawRowsOf` gains `load: { k; n } | null` per draw row from `loadGroupsOf`, AND its existing `k / n`
  becomes **paper position** — counted over group ROOTS only. For every bill with no load row the paper
  count equals the row count, so `k / n` are byte-identical (test-pinned on the 18648 fixture). A pure
  load split (seq 1 + parts) has ONE paper → no "1/1" chip at all, only "part k of n".
- `InvoiceCountChip` on the OBD cell counts papers (`paperCountOf`) — "2 invoices" only when there are 2.
- Draw ORDER: a group's parts drawn right after their root (root, part 2, part 3, next paper) — owner
  question 4; with no load row the order is seq order, unchanged.

Every caller (floor-table, hold-table, cancelled-tab, detail-panel header) reads these fields; none
computes k/n itself.

---

## C. Does the board payload carry `source` + `loadParentId`? — No

`lib/order-invoices/invoice-load.ts` `loadSplitInvoiceRows` (`:44-67`) selects id, seq, invoiceNo, date,
stop, hold, dispatched, CI, lines — **not `source`, not `loadParentId`**; `FloorInvoiceRow`
(`invoice-rows.ts:32-70`) has neither. The board never sends lines to the browser (only tins / litres /
kg per row).

**Smallest read change:** add `loadParentId: true` to that one select (step 2), and in `buildInvoiceRows`
set **`loadRootId` only on rows of a load group** (a part: its parent; a root with parts: its own id) —
the key is OMITTED otherwise. Also optional **`halfWritten: true`** only when a row of the OBD has no
lines (today folded into `stale`, `:130`), for the Repair chip / banner.

**Unsplit bills are untouched by construction:** an unsplit OBD has no `seq > 1` row, so the read's step 1
(`:36-41`) never selects it and it never reaches step 2 — its payload carries `invoiceRows: []` as before.
**Add-invoices bills are untouched too:** omitted keys are absent from `JSON.stringify`. Proof: re-run the
phase-2 parity script (`scripts/_parity-split-load-20261024.ts`), extended to snapshot every SPLIT OBD's
board row as well, before / after commit 1 — identical. The same read feeds trip totals, Print, the trip
sheet and the load plan (`invoice-load.ts` header): an extra optional key, read by none of them.

---

## D. Live sync after a split / merge / repair

- **This browser:** exactly what Add invoices does on save (`floor-page.tsx:4590-4598`) — `void load()`
  (full board refetch), `setInvoicesRefreshKey(k + 1)` (the open panel re-reads), toast. Merge / repair the
  same. No new mechanism.
- **Every other open Floor:** the existing live feed. A split writes `order_invoices` INSERT (triggers
  `trg_live_changes_order_invoices_ins` + `_trip_ins`, v27.65 / v27.66) and `order_invoice_lines`
  (v27.67 join-based triggers); a merge / repair DELETEs `order_invoices` rows (`_del`, v27.65). All record
  entity `order` for the parent OBD → `useLiveFeed` collects the id → `POST /api/floor/rows` →
  `getFloorBoard({ onlyIds })` → the SAME `loadSplitInvoiceRows`, so the patched row carries the new
  `loadRootId` with no extra work (CLAUDE_FLOOR §5). A split of a bill on a trip also flips
  `orders."partlyOnTrip"` (one `orders.update`), which the orders trigger records. The pause rules apply
  unchanged (a ticked row is reconciled, not moved).

---

## E. What the detail panel needs that it does not have

Today a scoped split OBD reads the **Add invoices GET** (`detail-panel.tsx:338-355`) — rows + lines by seq,
and scopes Items to that row's lines only (`scopeItems`, `detail-scope.ts:86`). For a part it needs:
1. **Every OTHER part's lines** (to write "2× part 2 …" under each line) — the Add invoices GET has them
   (`invoices[].lines`), but not the group (no `loadParentId`), k/n or hold.
2. **Each other part's trip number / waiting / on hold** — on the board row (`invoiceRowsAll[].tripNumber`,
   `isHeld`) but not linked to a group without `loadRootId`.

**Choice:** for a scoped row whose board entry has `loadRootId`, the panel reads **`GET …/load-split`**
instead (rows with resolved lines, rootId / k / n, tripNumber, isHeld, isDispatched — design §G shape, all
present today). One read, same trigger keys as now (`orderId`, scoped, `invoicesRefreshKey`,
`changeSignal`). Non-load scopes keep the Add invoices GET — unchanged. The Details tab's
`otherInvoices` (`detail-scope.ts:63`, labels by the number's last 3 digits) would list "716 · 716" for
parts → it gets "part 2" labels for group members (same helper as B).

---

## F. Phone / narrow width

`/floor` is a desk screen (the detail panel is a fixed `w-[472px]`, `detail-panel.tsx:396`), but the dialog
must not break if opened narrow. Plan: panel `w-[760px] max-w-full`, `max-h-[calc(100vh-40px)]` (the Add
invoices shell, `add-invoices-dialog.tsx:318`); the table inside a body with `overflow-x-auto`, so ONLY the
table scrolls sideways, never the page. Product column `min-w-[140px]`, name truncated with a title; truck
inputs 56 px. At 360 px: Product 140 + Tins here 44 + 2 trucks × 64 ≈ 330 px — **two trucks fit**; a third
truck scrolls inside the dialog. Footer wraps (`flex-wrap`, as the mockup's `.dlg-foot`); the error line
sits above the buttons on wrap. Inputs `inputmode="numeric"` so a phone shows digits.

---

## G. Risks — where Floor assumes one row per invoice number (discovery §4)

| Place | Risk with parts | Plan |
|---|---|---|
| `floor-table.tsx:1060` tbody key `…-inv-${invoiceNo}` | Pair blocks only (≥ 2 OBDs); a split OBD is never a pair (`invoice-pairs.ts`) | SAFE — unchanged |
| `drawRowsOf` keys `inv:<id>`, selection keys `inv:<id>` (`selection.ts:96-117`) | keyed on row id | SAFE |
| `drawRowsOf` k/n = rows; `InvoiceCountChip` counts rows | parts read as papers; "2 invoices" | FIXED in commit 1 (B) |
| `selectionCountLabel` (`selection.ts:433-475`) — numbers in a `Set` | two parts ticked → "1 invoice" (MERGES SILENTLY) | commit 1: count parts ("1 invoice · 2 parts") |
| `matchedInvoiceIdsOf` (`lib/floor/search.ts:136`, `floor-page.tsx:2273`) | pasting I536230716 ticks EVERY part | accept: Split load then greys "Tick one part to split"; owner question 5 |
| `addInvMenuItem` "Edit invoices" from `addedInvoiceNos` (`floor-page.tsx:2696`, `invoice-rows.ts:358`) | a load-only split reads "Edit invoices"; the item is grey anyway (ADD_INVOICES_LOAD_LOCK from the GET) | label only — fix `addedInvoiceNosOf` to skip load rows in commit 1 (pure, test) |
| Detail header `InvoicePartChip k={scopeK} n={invoiceRows.length}` (`detail-panel.tsx:687`) | "2/2" on a part | commit 3 |
| `otherInvoices` labels by last 3 digits (`detail-scope.ts:63-70`) | "716, 716" | commit 3 |
| `awayChipOf` (`invoice-rows.ts:323-355`) | "1 on L-05" — counts rows, title says "invoices" | words only; title → "parts" when every away row is in the row's group (commit 1) |
| Raise CI per ticked invoice (`off-floor-dialog`, `raise-ci.ts:473` returnType "full") | a part's CI is marked FULL (discovery BREAKS row) — phase 4 per owner answer 3 | owner question 6: grey Raise CI on a part until phase 4? |
| `walkIndex` / `detailWalk` (`floor-page.tsx:2524`) | walks draw rows — must follow the new draw order | uses `drawRows`, so it follows automatically; test it |
| Hold table (`hold-table.tsx:298`) also used by **Freight Trips** (`CLAUDE_FLOOR §3`) | same chips | gets the tag through `InvoiceLines`; freight join is refused for load bills only in phase 4 |

Pair blocks, live-merge (by orderId), sort (by OBD) and trip CTAs are unaffected: they key on the OBD or
the row id.

---

## H. Commits — each shippable alone; owner smoke tests by hand

**Commit 1 — read side + the tag (nothing new can be pressed).**
`invoice-load.ts` select `loadParentId`; `FloorInvoiceRow.loadRootId?` / `halfWritten?`;
`invoice-rows.ts` paper k/n + `load` + group order + `goneChipOf` + `paperCountOf` +
`addedInvoiceNosOf` skips load rows; `LoadPartChip`; `InvoiceLines load`; floor-table / hold-table /
cancelled-tab callers; `selectionCountLabel` parts; tests in `invoice-rows.test.ts` / `selection.test.ts`
(18648 fixture byte-identical). Claude runs the parity snapshot before / after (unsplit AND Add-invoices
board rows identical; `'load'` rows 0).
Owner smoke (no load rows exist yet, so the screen must look exactly as today):
1. Floor → any unsplit bill: no tag, same numbers.
2. OBD 9109951956 (Add invoices, 4 papers): still "1/4 … 4/4", OBD cell "4 invoices".
3. Tick two of its invoices: the bar still says "1 OBD · 2 of 4 invoices".
4. On hold and Cancel & CI tabs: unchanged.

**Commit 2 — ··· More items + the Split load dialog + Merge back + Repair (menu only).**
`floor-bottom-bar.tsx` items; `floor-page.tsx` menu state, handlers, dialog mount; `split-load-dialog.tsx`;
`load-split.ts` GET `kg` facts. The panel still shows a part's own lines (the existing scoped view works:
the Add invoices GET returns load rows with lines).
Owner smoke (with the Split load tick — admin / superuser until phase 6 grants):
1. Tick nothing → ··· More → "Split load" grey "Tick one bill or one part to split".
2. Tick one unsplit waiting bill → Split load → dialog lists its lines; type truck A, B fills itself;
   litres / kg per truck move as you type; kg matches the board's kg for the whole bill when all tins
   are on one truck.
3. "+ Add truck", ✕ on truck C, "Split evenly"; type too many → red rest, Save grey with the reason.
4. Save → two rows "I… part 1 of 2", "part 2 of 2"; no "1/2" chip; OBD cell has no "2 invoices".
5. Put part 1 on a trip; try to put part 2 on the SAME trip → refused "… part 2 of 2 — part 1 of the
   same invoice is already on this trip".
6. Tick part 2 (waiting) → Split load again → "part 3 of 3" appears.
7. Tick part 3 → Merge back → back to 2 parts; merge the last → the bill shows as unsplit, no tag.
8. Add invoices on a split-load bill → grey "This bill is split across trucks — merge its parts back first…".
9. Second browser open on Floor: its rows change within ~15 s without a reload.
(Repair cannot be smoke-tested by hand — it needs a press that died half-way; covered by phase-2 tests.)

**Commit 3 — detail panel for a part + Repair banner.**
`detail-panel.tsx` header + Part switch + GET choice; `detail-load-items.tsx`; `otherInvoices` labels;
Repair banner; the amber "part 1 gone" (if not already in commit 1).
Owner smoke:
1. Open a part from the board → header "9109… · part 1 of 2", switch Part 1 | Part 2 works.
2. Every line of the bill listed; this part's tins black; a line not on this part greyed; under a line
   "2× part 2 · L-261024-04" or "· waiting" / "· on hold".
3. Footer: this part's lines · tins · L · kg, then the bill total.
4. Dispatch part 1's trip → part 2 (waiting) shows amber "part 1 gone".
5. Activity tab on a part shows only its own split / merge lines plus OBD-wide ones.

---

## Owner questions (one line each)

1. Merge back with ONE part ticked: merge every waiting same-hold part of that invoice into the oldest, or only the parts you ticked (tick 2+)?
2. Merge back deletes the merged parts — ask "Merge parts 2, 3 back into part 1?" first (recommended), or merge on press with an Undo?
3. The "part 1 of 2" tag colour: grey ink with the word "part" (recommended — violet means "selected" on Floor), or the mockup's violet?
4. On a bill that ALSO has Add-invoices papers, draw each paper's parts right under it (recommended), or keep strict seq order?
5. Pasting an invoice number in Floor search ticks every part of it — fine, or tick only the first?
6. Raise CI on a single part marks it FULL today (fixed in phase 4) — grey Raise CI on parts until then?
7. Repair: also show an amber "split not finished" chip on the board row, or only the banner inside the detail panel?

---

## Owner answers 2026-10-24

1. Merge with ONE part ticked = every waiting same-hold part of that invoice into the oldest; with 2+ ticked = only the ticked ones. (commit 2)
2. Merge asks first: "Merge parts 2, 3 back into part 1?" (commit 2)
3. Tag = grey ink, word "part" ("part 1 of 2"). NOT violet.
4. Bill with Add-invoices papers: each paper's parts drawn directly under that paper.
5. Search paste ticks every part (the one-part-per-trip refusal protects it).
6. Raise CI greyed on a load part until phase 4: "CI on split parts comes in the next update". (commit 2)
7. Repair: amber "split not finished" chip on the board row AND the detail-panel banner. The plan puts only the `halfWritten` flag in commit 1, so the chip is drawn in commit 3 with the banner.
