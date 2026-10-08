# code-plan-2026-10-08 — Challan Orders slice 7: line match (✅ / ⚠)

**Status:** PLAN — no code, no DDL. Read-only SELECTs against live only (shown in §7).
Design: `web-update-2026-10-06-challan-orders.md` D12, F2, F5, M6, S6-3, S6-4. Builds on slices 3, 5, 6 (+6c), all live.
Schema unchanged (v27.61). Where this plan and the code disagree, the CODE wins — re-read every file:line before building.

**Read for this plan:** `CLAUDE.md`; `docs/CLAUDE_CORE.md` §1–§4, §13 (incl. the id-space landmine) and the v27.60
entry — **not** §5–§12 in full; `docs/CLAUDE_CI.md` §6 + CI-8 / CI-14 (the unitQty rule lives there — §12 is Live sync,
not read); the web-update in full; slice 3 / 5 / 6 (+6c) code-updates in full; the mockup's Billed + History sections;
`components/challan-orders/challan-orders-screen.tsx` in full; every file in `lib/challan-orders/` except the test file;
`app/api/challan-orders/{list,history}/route.ts`.

---

## 1. The match — exactly what is read and how it is summed

### The two sides

| | Challan side | SAP side |
|---|---|---|
| Rows | `import_raw_line_items` WHERE `obdNumber` = the ORB number | `import_raw_line_items` WHERE `obdNumber` IN every bill with `orders.challanOrderId` = the ORB order's id **AND `workflowStage = 'challan_linked'`** AND `isRemoved = false` |
| Filter | `lineStatus = 'active'` | `lineStatus = 'active'` |
| Key | `skuCodeRaw` (the SAP material code create.ts wrote, `create.ts:377`) | `skuCodeRaw` |
| Tins | `unitQty` (create.ts writes the cart's tins, `create.ts:379`) | `unitQty` = SAP's delivery quantity in units (CI §6: `volumeLine ÷ unitQty` = the pack size on 99.70 % of lines — it is tins, not litres; CI-14: it is the DELIVERY qty, there is no invoiced-qty column) |
| Label | `skuDescriptionRaw` (= `sku_master_v2.description` at create) | `skuDescriptionRaw` (SAP's) — used only when the material is not on the challan |

- **Join is by text, never by id** — `import_raw_line_items` has no FK to `orders` (Picking, Floor and CI all join on
  `obdNumber`), and the material is compared code-to-code. **No catalog join at all** (CORE §13: `sku_master` and
  `sku_master_v2` share no id space; the description already sits on the line).
- **`rowStatus` is not filtered.** Live: every active line is `valid` (57,894 / 57,894) — the floor precedent
  (`lib/floor/queries.ts:635`) is "a parse-rejected row is still a tin". Adding it would change nothing today and hide
  goods tomorrow.
- **`removed_by_import` lines are excluded** (249 live) — a line SAP withdrew is not on the bill (CI `full-bill.ts:64`).
  A re-import PATCHES lines in place (CI §6), so the active set is always SAP's current bill.

### Summing

`Map<material, { challan: number, sap: number, label }>`:
- add every challan line's `unitQty` to `challan`, every SAP line's `unitQty` to `sap` — **SUM, never dedupe by lineId**.
  Live: 1,975 OBDs carry the same material on more than one active line (batch splits, line numbers 900001+), and one
  OBD (`9107512389`) even carries the same `lineId` twice with different quantities. Every active line is real goods.
- `diff = sap − challan` per material.
- **✅** iff every material's `diff === 0`. **⚠** otherwise — chip text `⚠ N line(s) differ`, N = materials with diff ≠ 0.
- Table rows: every material where either side > 0 (a 0 / 0 row — live has one `unitQty 0` SAP line — is dropped from the
  table and never counts as a difference). Order: challan line order first (by `lineId`), then SAP-only materials by
  first appearance. Footer: totals of both sides and their diff (mockup).

### Where it is computed — ONE query per load, never per row

New server module **`lib/challan-orders/line-match.ts`**:
- `computeLineMatch(challanLines, sapLines): ChallanLineMatch` — **pure**, no Prisma, so it can be unit-tested.
- `attachLineMatches(rows: ChallanRow[]): Promise<void>` — for the rows that qualify (§2), collects
  `orbNumber` + every `linkedObds[].obdNumber` whose `workflowStage === 'challan_linked'` (already loaded by
  `includeFor`'s `challanLinkedOrders`, `board.ts:48`), runs **one** `import_raw_line_items.findMany({ where:
  { obdNumber: { in }, lineStatus: "active" }, select: { obdNumber, lineId, skuCodeRaw, skuDescriptionRaw, unitQty } })`
  (index `(obdNumber, lineStatus)` exists), groups in memory, sets `row.match`.

Wire shape, added to `board-types.ts` (types only — client-safe):
```ts
export interface ChallanMatchLine { material: string; product: string; challanTins: number; sapTins: number; diff: number }
export interface ChallanLineMatch { ok: boolean; differing: number; challanTins: number; sapTins: number; obdNumbers: string[]; lines: ChallanMatchLine[] }
// ChallanRow gains: match: ChallanLineMatch | null   (null = no chip)
```
Lines travel with the row (an ORB order is a handful of lines), so expanding a row needs no second fetch.

## 2. Edge cases — one rule each

| Case | Rule |
|---|---|
| Linked OBD cancelled by admin (S6-3) | It is `cancelled`, not `challan_linked` → **out of the SAP sum**, no extra write (`linked-cancel.ts:15` already promises this). If it was the SO's only OBD its link goes back to `waiting` → the ORB leaves Billed → no chip until the re-issued OBD is caught. If another live OBD on that SO remains, the link re-points and the ORB stays Billed, matched against the bills still live. |
| Part-billed ORB (one SO linked, one waiting — M6) | Status `waiting` → `match = null` → **no chip** (Waiting tab has no Match column; History shows "Waiting"). |
| Material on one side only | Shown with 0 on the other side and a non-zero diff → ⚠ (incl. a wrong pick on the 10 double-mapped cells — F2, intended). |
| Cancelled ORB order | Status `cancelled` → **no chip**, History's red "Cancelled" only (S6-4 has already unlinked every link and returned its bills). |
| Billed ORB with no live `challan_linked` bill (should not happen — a `linked` link needs a live `linkedOrderId`) | `match = null`, cell shows "—". Defensive only. |
| ORB lines all `removed_by_import` | Cannot happen (an import never writes an `ORB-` number — `chk_orders_orb_number`); the rule above still gives an honest ⚠ (SAP-only lines). |
| A `0 / 0` material | Dropped from the table, never a difference. |

**Qualifying rows:** `row.status === 'billed'` only — on the board that is the Billed tab (7 days); in History, a
billed row on the current page.

## 3. Where ✅ / ⚠ shows

| Place | What |
|---|---|
| **Billed tab — Match column** (`challan-orders-screen.tsx:616`, now "—") | `✅ Match` (ok green) / `⚠ N lines differ` (warn amber) — mockup `.match.ok` / `.match.bad`. Tins cell: `36` when equal, `36 / 34` (SAP muted) when not. |
| **Billed tab — expanded row** | Click a row (or ▸ chevron, new last column, mockup) → a detail row: caption "Challan ORB-… vs SAP OBD … — matched by material code, tins summed over every linked OBD", table Material code · Product · Challan tins · SAP tins · Diff (diff ≠ 0 rows tinted, negative red), totals footer. ⚠ rows are NOT auto-opened in the build (the mockup shows one open only to illustrate). The admin "Cancel OBD" control in the OBD(s) cell must keep working — clicks inside it must not toggle the row. |
| **History — Status chip** | A billed row's chip becomes `Billed ✅` / `Billed ⚠` with the sub-line `36 / 34 tins` on ⚠ (mockup lines 436/445). Same click-to-expand detail as Billed (lines are already in the payload). |
| **Floor mount** | **Shows it, by default, with no extra code.** All three mounts render the same component; `mount` changes only the Place Order header (`challan-orders-screen.tsx:730`). D8 says "same lists everywhere", and the match is read-only information, so nothing to gate. Same for Place Order. |

Fixed-table rule (UI §40): the Billed width array gains one column (chevron); widths re-balanced to sum 100.

## 4. Performance

- **Board** (`loadChallanBoard`): today 1 query (all non-cancelled ORB orders + includes). Slice 7 adds **1** lines query,
  only when the Billed set is non-empty, covering every billed row of the last 7 days at once.
- **History** (`loadChallanHistory`): today `count` + one page of 50. Adds **1** lines query per page, only when the page
  holds a billed row.
- No per-row query, no N+1, no new index (the `(obdNumber, lineStatus)` index serves `IN (…)`).
- **Live refresh limit:** the marker (`getChallanMarker`) moves on ORB orders, links and ORB trips. A SAP re-import that
  only patches a linked OBD's LINES may not move it, so an open screen can show a stale chip until the next 30 s change or
  reload — every load recomputes from the live lines, nothing is stored (D12). Accepted; not worth a marker change now.

## 5. LEFTOVER POINTER — `orders.challanOrderId` after a cancel

**Every reader of `challanOrderId`** (grep of `app lib components prisma`, plus live `pg_views` / `pg_proc`: none in the DB):

| Reader | What it does with it | Affected by a pointer on a non-`challan_linked` bill? |
|---|---|---|
| `lib/challan-orders/board.ts:48-52` `challanLinkedOrders` | lists the ORB's bills with stage IN (`challan_linked`, `cancelled`) | **YES** — a returned bill that is later cancelled shows under the old ORB as a struck-through "cancelled" linked OBD. |
| `lib/challan-orders/reconcile.ts:56, :178` | select; compares `=== orb.id` only when the bill is `challan_linked` | No |
| `lib/challan-orders/reconcile.ts:232` | the WRITER (catch) — overwrites the pointer on a new link | No |
| `lib/challan-orders/linked-cancel.ts:37, :62-69` | refuses unless `challan_linked` (`:40`) before using it | No |
| `lib/challan-orders/cancel-guard.ts:67` | `releaseChallanOnCancel` — filters `workflowStage: challan_linked` | No |
| `lib/challan-orders/alerts.ts:69` | selected into the `touchedReason` row shape, never read | No |
| **slice 7 `line-match.ts`** (new) | filters `challan_linked` | No |

**S6-4 (ORB cancelled after linking) — RECOMMEND: clear it.** `releaseChallanOnCancel` (`cancel-guard.ts:72-75`) sets
`challanOrderId: null` in the SAME compare-and-swap update that moves the bill to `pending_support` (one write, no extra
statement, the CHECKs allow null). Why: from that moment the bill is an ordinary live bill that was **never billed
against a surviving challan** — a pointer to a cancelled ORB is a false fact, and its only effect is the History artefact
above (exactly what order 19110 shows today). History is not lost: the status log names the ORB
(`"Challan ORB-… cancelled — bill returned to the floor"`) and the `unlinked` link row keeps SO + `orbOrderId` (the
shape CHECK forces `linkedOrderId` null, so the SO is the join). Update the comment at `cancel-guard.ts:56` ("KEPT as
history") in the same edit.

**S6-3 (admin cancels a linked OBD) — RECOMMEND: KEEP it.** That bill WAS billed against the challan and ends there
(`cancelled`, terminal). Showing it struck-through under its ORB is the slice-6 design (`board-types.ts:29-30`
"a cancelled one stays as history"), and every reader excludes it by stage. Not a leftover.

**One-off read-only check of every row in the S6-4 state** (run 2026-10-08 → exactly one row, order 19110):
```sql
-- READ-ONLY
SELECT o.id, o."obdNumber", o."soNumber", o."workflowStage", o."dispatchStatus",
       o."challanOrderId", orb."obdNumber" AS orb, orb."workflowStage" AS orb_stage
  FROM orders o JOIN orders orb ON orb.id = o."challanOrderId"
 WHERE o."challanOrderId" IS NOT NULL AND o."workflowStage" <> 'challan_linked'
 ORDER BY o.id;
-- 2026-10-08: 19110 | 7567796328 | 7567796326 | cancelled | null | 19098 | ORB-2026-00004 | cancelled
```
⚠ This SELECT also returns legitimate S6-3 rows (linked OBD cancelled) once real ones exist — tell them apart by the
status log: S6-4 rows carry a `challan_linked → pending_support` "bill returned to the floor" entry. 19110 does (it was
returned, then cancelled on Floor on 8 Oct). Clearing it is a data write → Smart Flow, owner's call (§6 Q1).

## 6. Risks and owner questions

**Risks**
1. **Alternate SAP codes.** If SAP bills a different material code for the same goods (an alternate SKU), the match shows
   ⚠ though the goods are right — same mechanism as the F2 double-mapped cells, and accepted by F2. Not solvable without a
   code-equivalence table; not in this slice.
2. **Stale chip on a line-only re-import** (§4) — cosmetic, self-heals on the next change or reload.
3. **Click target in the Billed row** — the admin "Cancel OBD" form lives in the same row; the expand toggle must sit on
   the row minus that cell (or the chevron only). Hand-test it.

**Owner questions**
- **Q1.** Order 19110 (test OBD 7567796328, cancelled) still points at cancelled ORB-2026-00004. After the S6-4 fix, clear
  it with a one-line Smart Flow UPDATE (`SET "challanOrderId" = NULL WHERE id = 19110 AND "workflowStage" = 'cancelled'`),
  or leave it as a test-data artefact? (Leaving it: ORB-2026-00004's History row keeps listing 7567796328 struck through.)
- **Q2.** Alternate SAP codes (risk 1): accept ⚠ for now and park "material equivalence" on the ROADMAP — yes / no?

## 7. Live facts behind this plan (read-only, 2026-10-08)

| Check | Result |
|---|---|
| Active raw lines by `rowStatus` | 57,894 `valid`, 0 other |
| `lineStatus` values | `active` 57,894 · `removed_by_import` 249 |
| OBDs with active lines under > 1 raw summary | 0 |
| Same material on > 1 active line of one OBD | 1,975 OBDs → sum, never dedupe |
| Duplicate active (OBD, lineId) | 1 (`9107512389`, lineId 10 ×2, 4 + 10 tins) |
| Active lines with `unitQty ≤ 0` | 1 (`9109889820`, `unitQty 0`) |
| `skuCodeRaw` with spaces / lower case | 0 → plain string equality is safe |
| ORB materials never seen on any SAP line | 0 (all 4 ORB orders) |
| DB views / functions naming `challanOrderId` | none |
| `challanOrderId` set on a non-`challan_linked` bill | 1 — order 19110 (§5) |

**Dry run on the one real pair** (ORB-2026-00004 vs its test OBD 7567796328, both cancelled now, so not displayed):
challan `IN28080071` "DN SAT FIN WHITE 4L" × 4 vs SAP `IN28140071` "DN SATIN STAY BRIGHT WHITE 4L" × 4 →
**⚠ 2 lines differ** (−4 / +4), totals 4 / 4. A good hand-test shape: equal totals, different goods — the chip must
still be ⚠.

## 8. Build list (for the code prompt)

1. `lib/challan-orders/board-types.ts` — `ChallanMatchLine`, `ChallanLineMatch`, `ChallanRow.match`.
2. `lib/challan-orders/line-match.ts` (new) — pure `computeLineMatch` + `attachLineMatches` (one query). Header comment:
   the natural-key rule and why there is no catalog join (CORE §13 — copy the warning, as the three resolvers do).
3. `lib/challan-orders/board.ts` — `toRow` sets `match: null`; `loadChallanBoard` calls `attachLineMatches(billed)`;
   `loadChallanHistory` calls it on the page's billed rows.
4. `components/challan-orders/challan-orders-screen.tsx` — Match chip, `36 / 34` tins, chevron column, expandable detail
   row (Billed + History), History `Billed ✅ / ⚠` chip.
5. `lib/challan-orders/cancel-guard.ts` — S6-4: `challanOrderId: null` in the CAS update + comment fix.
6. `lib/challan-orders/line-match.test.ts` — equal; part-billed sum over 2 OBDs (20 + 16 = 36 ✅); one-side-only; same
   material on two lines; 0 / 0 dropped; the 19110 dry-run shape (equal totals, ⚠).
7. No route, no DDL, no grant, no marker change. `tsc --noEmit` + build + the test.

**Hand test (owner, admin, local):** create ORB A with 2 lines; paste SO; import a fake OBD whose lines match → Billed
`✅ Match`, expand shows both lines diff 0. ORB B: import an OBD with one tin short and one extra material → `⚠ 2 lines
differ`, `n / m` tins, History chip `Billed ⚠`. ORB C part-billed (2 SOs, 1 imported) → Waiting, no chip; import the
second → Billed, sum of both. Admin "Cancel OBD" on C's second OBD → C back to Waiting, no chip. Cancel ORB A as admin →
its OBD returns to Floor with `challanOrderId` null (SELECT §5 returns no new row). Clean up all fakes as in slice 6 T9.
