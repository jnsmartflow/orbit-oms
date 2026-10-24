# Split load — Phase 2 writer design · 2026-10-24

Status: **DESIGN ONLY — not built.** No code, no SQL. Schema it builds on: **v27.76** (live 2026-10-24,
`sql/2026-10-24-split-load-schema.sql`): `source` ∈ `'sap' | 'manual' | 'load'`, `"loadParentId"` with a
composite FK `("loadParentId","orderId") → (id,"orderId")` ON DELETE RESTRICT (same OBD is a DATABASE rule),
`chk_order_invoices_load_parent` (`'load'` ⇔ parent set), `chk_order_invoices_load_not_self`, partial index.
Owner decisions: `docs/prompts/drafts/web-update-2026-10-24-split-load-plan.md` §2–§5 (accepted 2026-10-24).
Breaks list: `docs/prompts/drafts/code-discovery-2026-10-24-split-load.md` §4.

Every claim below names the file and line it was read from (2026-10-24, HEAD `0413e4b6`).

---

## 0. Vocabulary used here

- **Group** — one SAP paper and its truck parts: the ROOT row (`source` `'sap'` or `'manual'`) plus every
  `'load'` row whose `loadParentId` is the root's id. Flat: a part's parent is never a part.
- **Part k of n** — position in the group by `seq`, root first. Derived, never stored.
- **Waiting** — `tripDropId IS NULL` and `isDispatched = false`.
- New pure helper (§A) `loadGroupsOf(rows)` → `Map<rowId, { rootId, k, n }>` is the ONE home of "which group,
  which part". Every label and refusal reads it.

---

## A. SPLIT — first split of a bill, or split again of a waiting part

### A.1 Files and signatures

New file **`lib/order-invoices/load-plan.ts`** — PURE (no Prisma, no clock), tests `load-plan.test.ts`:

```ts
export interface LoadRow {            // one order_invoices row as the plan reads it
  id: number; seq: number; source: InvoiceSource;     // 'sap' | 'manual' | 'load'
  loadParentId: number | null;
  invoiceNo: string | null; invoiceDate: Date | null;
  tripDropId: number | null; isHeld: boolean; heldAt: Date | null; heldById: number | null;
  isDispatched: boolean;
  lines: { rawLineItemId: number; qty: number }[];   // [] on an unsplit seq 1 = "all lines"
}
export interface TruckInput { lines: { rawLineItemId: number; qty: number }[] }  // tins per raw line

export function loadGroupsOf(rows: readonly LoadRow[]): Map<number, { rootId: number; k: number; n: number }>;
export function rootOf(rows: readonly LoadRow[], row: LoadRow): LoadRow;   // row.loadParentId ? parent : row
/** The source row's tins per active raw line: its lines, or — unsplit seq 1 with no lines — every active line's unitQty. */
export function tinsOfRow(row: LoadRow, all: readonly LoadRow[], active: readonly ActiveLine[]): Map<number, number>;

export function planLoadSplit(input: {
  rows: readonly LoadRow[];          // ALL rows of the OBD, seq order
  sourceRowId: number;
  trucks: readonly TruckInput[];     // trucks[0] = what the SOURCE row keeps; trucks[1..] = new parts
  active: readonly ActiveLine[];     // the OBD's active raw lines (lineStatus 'active')
  obdHeld: boolean;                  // orders.dispatchStatus = 'hold' (truth for an UNSPLIT bill, §E.6)
}): { ok: true; plan: LoadSplitPlan } | { ok: false; errors: string[] };

export interface LoadSplitPlan {
  sourceRowId: number;
  sourceLines: { rawLineItemId: number; qty: number }[];      // truck 1's share, qty > 0 only
  creates: Array<{
    seq: number;
    loadParentId: number;              // the ROOT's id (flat group)
    invoiceNo: string | null;          // copied from the ROOT (may be NULL — SAP not billed yet)
    invoiceDate: Date | null;          // copied from the ROOT
    isHeld: boolean; heldAt: Date | null; heldById: number | null;   // copied from the SOURCE row
    lines: { rawLineItemId: number; qty: number }[];               // qty > 0 only
  }>;
  /** true = the source had no lines (unsplit seq 1) — it GAINS line rows (Model A). */
  sourceGainsLines: boolean;
}
```

### A.2 Validation inside `planLoadSplit` (plain-English errors, all collected)

1. Source row exists on this OBD, is **not dispatched** (`isDispatched`), and — if it is a `'load'` row —
   is **waiting** (plan §3 case 5: only a waiting part is split again; the root may be on a trip, case 2).
2. `trucks.length ≥ 2`; the OBD's total row count after the split ≤ `MAX_INVOICES` (20, `rules.ts:36`,
   the existing fuse — reused, not a new number).
3. Every `rawLineItemId` is one the SOURCE row carries (`tinsOfRow`), listed at most once per truck.
4. Every qty is a whole number ≥ 0 (0 = "not on this truck"; dropped from the plan — no line row,
   `chk_order_invoice_lines_qty_positive`).
5. **Sums exact per raw line:** Σ over trucks = the source's tins of that line. Errors name the line as
   `rules.ts` `lineName` does: `line 900003 (9296830): 3 of 12 tins not placed`.
6. **Every truck ≥ 1 tin** in total (case 11); hence the source must carry ≥ 2 tins (case 11). A 1-tin line
   goes whole on one truck automatically (case 10) — rule 4/5 already allow it.
7. A source line whose raw line is no longer active → refused "Lines changed in SAP — re-check first"
   (the stale guard, §E.4, catches it earlier; repeated here so the pure function is safe alone).

### A.3 The rows it plans

- **Source row keeps its id, seq, number, trip, hold, copies, re-deliveries** — only its lines change to
  truck 1's share. Nothing on a trip moves; truck 1 is the row that is already wherever it is (case 2).
- **New rows**: `source 'load'`, `loadParentId = rootOf(source).id` (if the source is itself a part, its
  `loadParentId`), `invoiceNo` / `invoiceDate` = **the root's** (a copy; NULL stays NULL), `isHeld` /
  `heldAt` / `heldById` = **the source row's** (case 3), `tripDropId` **NULL** (case 1–2), `isDispatched`
  false, `createdById` = the actor.
- **First split of an UNSPLIT bill** (one row, seq 1, no lines): seq 1 GAINS line rows for truck 1's share
  (`sourceGainsLines`), so Model A's "on a split OBD every row carries lines" holds and every existing
  `seq > 1` / `rows.length ≥ 2` branch switches on by itself (`invoice-load.ts:37`, `invoice-rows.ts:121`,
  `hold.ts:173`, `dispatch.ts:193`, `links.ts:71`).

### A.4 Seq allocation and the unique clash

- New seqs = `max(seq of the OBD) + 1 … + (trucks − 1)`. Never reuse a gap (a merged-away part leaves one);
  a gap is harmless because Add invoices is locked while any `'load'` row exists (§D) and its
  `planSplitWrite` (`plan.ts:162-184`) is the only code that assumes seq 1..n is dense.
- **The `(orderId, seq)` unique is the concurrency lock**, as in Add invoices (`split.ts:49-50`): two presses
  on one OBD compute the same next seq; the second `createMany` fails with Prisma P2002. That write is
  **step 1 below — before anything else is written**, so the loser has changed nothing. The route maps P2002
  to 409 `"Someone changed this bill at the same moment — reopen Split load."`

### A.5 Server-only writer — new file **`lib/order-invoices/load-split.ts`**

```ts
export async function loadLoadView(orderId: number): Promise<LoadView | null>;          // GET
export async function saveLoadSplit(orderId: number, req: {
  sourceRowId: number; trucks: TruckInput[]; expectKey: string; actorId: number;
}): Promise<LoadResult>;
export async function mergeLoadParts(orderId: number, req: {
  rowIds: number[]; expectKey: string; actorId: number;
}): Promise<LoadResult>;
export async function repairLoadWrite(orderId: number, actorId: number): Promise<LoadResult>;   // §E.8
export type LoadResult =
  | { ok: true; changed: boolean; rowIds: number[] }
  | { ok: false; status: number; error: string; errors?: string[] };
```

**Write order — `saveLoadSplit`. No transaction (CORE §3); each step is ONE statement:**

| # | Statement | If the press dies right after it |
|---|---|---|
| 0 | Reads: order, ALL rows (+ `loadParentId`, lines, copies, re-deliveries), CIs, active lines. Guards (§E). `planLoadSplit` (pure). Any refusal → **nothing written**. | — |
| 1 | `order_invoices.createMany` — the new `'load'` rows, **no lines yet**. (P2002 = lost the race → 409.) | New rows with no lines. GET reports **stale** (`split.ts:295` `halfWritten` — "a row with no lines inside a split"); the board marks every row of the OBD stale (`invoice-rows.ts:130`). Repair (§E.8) deletes them → bill exactly as before. |
| 2 | `order_invoices.findMany` — the new rows' ids by seq. | Same as 1. |
| 3 | `order_invoice_lines.deleteMany` — the SOURCE row's old lines. **Skipped** when the source had none (unsplit seq 1). | Source + new rows all lineless. Stale. Repair deletes the lineless parts; the source is then the ONE lineless row → it gets the remainder (§E.8) = its old share exactly. Unsplit seq 1 left alone = unsplit again = correct. |
| 4 | `order_invoice_lines.createMany` — **every** line row: the source's new share AND every new part's, in ONE statement. | Nothing half: one statement. Done except steps 5–7. |
| 5 | `orders.update` — **only if** the derived `tripDropId` / `partlyOnTrip` changed (recomputed from ALL rows with `deriveObdTripDropId` / `derivePartlyOnTrip`, `trip-read.ts:48,62`). In practice: the source is on a trip and the new parts are not → `partlyOnTrip` turns TRUE. Never a second `orders.update`. Hold never changes (new rows copy the source's hold, so "all held" is unchanged). | Rows right, `orders."partlyOnTrip"` stale. The existing repair path lands it: `needsDerivedRepair` → `setRowsTrip(orderId, [], null)` on the next trip press (`trip-bills route:420-425`), and `scripts/parity-oi-trips-20261012.ts` counts it. |
| 6 | Re-read the rows; re-validate (`detectStale` false, no lineless row, the group's tins = the source's old tins); `console.error('[order-invoices] …')` and 500 "did not save completely — press Repair" if not. | — |
| 7 | `order_status_logs.create` — ONE row (§H). | The split stands without its log line. |

Why this order: **step 1 claims the seqs before any existing row is touched** (a lost race writes nothing),
and **lines go in one statement after every row exists** (the `split.ts:46-47` rule), so the only half
states are "parts with no lines" and "source with no lines" — both are already reported stale, and both
are exactly repairable (§E.8).

---

## B. MERGE BACK

### B.1 Which parts can merge (plan §3 case 16)

`planLoadMerge(rows, rowIds, active)` in `load-plan.ts` (pure). The chosen rows must:

- all be rows of **one group** (same root), ≥ 2 of them;
- all be **waiting** (`tripDropId` NULL, not dispatched);
- all have the **same hold state** (`isHeld` equal) — no silent hold or release;
- every one that will be DELETED (all but the survivor) have **no** `trip_bill_copies`, `trip_redeliveries`
  or `ci_returns` row naming it — **void CIs included**: the FK is RESTRICT whatever the status
  (`plan.ts:129-135` `linkReasons` is the same guard, worded the same way:
  `"Part 2 of I536230716 cannot be merged — billing copied it for trip L-…, and that record stays on it."`).

### B.2 Into which row

The **survivor** = the ROOT if the root is among the chosen rows, else the **lowest-seq chosen part**. The
others are deleted (`source 'load'` only — the `deleteMany` filters `source: 'load'`, the `split.ts:199`
pattern, so a bug can never delete a SAP or Add-invoices row). The survivor's lines = the active lines'
unitQty − Σ every OTHER remaining row's lines (the remainder rule, §E.8) — which is also what makes a merge
the fix for a re-import that changed a qty (plan §3 case 17): the survivor absorbs SAP's new numbers.

### B.3 Back to "seq 1, no lines"?

**Only when, after the merge, the OBD has exactly ONE row and it is seq 1.** Then the survivor's lines are
deleted and not re-created — Model A's unsplit shape. If the bill also has Add-invoices rows (seq 2..m
`'manual'`), the survivor keeps its lines: the OBD is still split by Add invoices.

### B.4 Write order — `mergeLoadParts`

| # | Statement | If it dies right after |
|---|---|---|
| 0 | Reads, guards, `planLoadMerge`. Refusal → nothing written. | — |
| 1 | `order_invoice_lines.deleteMany` — the survivor's lines. | Survivor lineless, parts intact → stale; Repair gives the survivor its OLD share back (remainder) — the bill as before the press. |
| 2 | `order_invoices.deleteMany({ id in parts, source: 'load' })` — their lines CASCADE. If a link appeared since step 0, the RESTRICT FK fails the WHOLE statement (nothing deleted). | Survivor lineless, parts gone → Repair gives it the remainder = the merged total. |
| 3 | `order_invoice_lines.createMany` — the survivor's new lines. **Skipped** when going back to unsplit (B.3). | Done except 4–6. |
| 4 | `orders.update` only if derived `tripDropId` / `partlyOnTrip` changed (merged rows are all waiting and the survivor is waiting, so normally nothing changes and nothing is written). | As A step 5. |
| 5 | Re-read + re-validate; log `[order-invoices]` if wrong. | — |
| 6 | One `order_status_logs` row (§H). | — |

---

## C. NUMBER COPY — where SAP's number reaches load parts

**Where:** `lib/order-invoices/sap-row.ts` `syncSapInvoiceRow` — the ONE writer of the seq-1 mirror, already
called after every place `orders.invoiceNo` / `invoiceDate` is filled (patch-headers, `applyHeaderPatch`,
`split.ts` prepare — header `sap-row.ts:8-15`). Only seq-1 roots can have a NULL number: an Add-invoices
root is `'manual'` and always carries one (`chk_order_invoices_manual_has_no`), and its parts copy it at
split time.

**The exact change** (inside the existing `try`, after the two seq-1 `updateMany`s at `:104-114`):

```ts
// v27.76 — SPLIT LOAD: the parts of seq 1 copy its number / date, NULL-only,
// the same rule as seq 1 itself. Reads what seq 1 now HOLDS, never `order`.
const seq1 = await prisma.order_invoices.findFirst({
  where: { orderId, seq: SAP_SEQ, source: SOURCE_SAP },
  select: { id: true, invoiceNo: true, invoiceDate: true },
});
if (seq1 && seq1.invoiceNo !== null) {
  await prisma.order_invoices.updateMany({
    where: { orderId, source: SOURCE_LOAD, loadParentId: seq1.id, invoiceNo: null },
    data: { invoiceNo: seq1.invoiceNo },
  });
}
if (seq1 && seq1.invoiceDate !== null) {
  await prisma.order_invoices.updateMany({
    where: { orderId, source: SOURCE_LOAD, loadParentId: seq1.id, invoiceDate: null },
    data: { invoiceDate: seq1.invoiceDate },
  });
}
```

**Proof it is NULL-only and never throws, and that unsplit bills are untouched:**
- Every `where` carries `invoiceNo: null` / `invoiceDate: null` → a non-null value is never overwritten
  (the `:105` / `:111` rule).
- Every `where` carries `source: 'load'` AND `loadParentId: seq1.id` → a `'sap'` or `'manual'` row can never
  match; an **unsplit bill has no `'load'` row, so both `updateMany`s match 0 rows and write nothing** (an
  UPDATE that changes no row fires no live line either: `live_changes_child_upd` diffs old vs new rows).
- It sits inside the existing `try { … } catch → console.error` (`:95`, `:115-117`): never throws.
- Cost: 1 `findFirst` (on `order_invoices_orderId_seq_key`) + at most 2 `updateMany`s served by the partial
  `order_invoices_loadParentId_idx`, only on the invoice-fill paths. Acceptable; measure in the parity run.
- `createSapInvoiceRows` is NOT changed (a new order has no parts).

The source string goes in a new shared constant (§0.1 of "files that will change"): `SOURCE_LOAD`.

---

## D. ADD INVOICES LOCK

**Where:** `lib/order-invoices/split.ts` `prepare()` — the shared front of `saveSplit` and `undoSplit`, after
the `addInvoicesRefusal` check (`:355-356`) and **before any write** (the first write of either path is
`applyPlan`, `:412` / `:457`). `prepare` already loads `rows` with `source` (`:125-137`).

```ts
if (rows.some((r) => r.source === SOURCE_LOAD)) {
  return { error: { ok: false as const, status: 409, error: ADD_INVOICES_LOAD_LOCK } };
}
```

**Message** (one exported constant in `rules.ts`, so GET and POST say the same thing):
`"This bill is split across trucks — merge its parts back first, then change its invoices."`

**Also in `loadSplitView`** (`:314-316`): `blockedReason` = the same constant when a `'load'` row exists, so
the ··· More hint never lies (the rule `split.ts:312-313` already states).

**`validateSplit` is not touched** — byte-for-byte unchanged (`rules.ts:74-155`). The lock is a refusal in
front of it, exactly as `addInvoicesRefusal` is.

⚠ Why the lock is needed, not just tidy (read from the code): `planSplitWrite` maps target index i → seq
i + 1 and deletes every row past the target count (`plan.ts:162-184`) — a load part at seq 3 would be
"updated" into the 3rd typed paper. And `applyPlan` step 1 deletes with `source: SOURCE_MANUAL`
(`split.ts:199`), so a `'load'` id in `deleteRowIds` would be **silently skipped** — the save would then
fail its re-check with "did not save completely" every time.

---

## E. GUARDS — all before any write, in this order

Pure part: `loadSplitRefusal(bill, rows, cis, …)` / `loadMergeRefusal(…)` in `load-plan.ts`; the reads in
`load-split.ts` step 0. First refusal wins; the same text is GET's `blockedReason` per row.

1. **Bill** — `orders.isRemoved` → "This bill has been removed"; stage `cancelled` / `dispatched` / `closed`
   → the `addInvoicesRefusal` wording (`rules.ts:200-207`). **No SAP-number rule** (decision 1: split
   before billing is allowed) — so `addInvoicesRefusal` itself is NOT called; a new function reuses its
   three stage messages.
2. **Concurrency token** — `expectKey` = a fingerprint the GET returns and the dialog sends back:
   `rowsKey(rows) = rows.map(r => `${r.id}:${r.seq}:${r.tripDropId ?? "-"}:${r.isHeld ? 1 : 0}:${r.isDispatched ? 1 : 0}:` + sortedLines(r)).join("|")`
   (pure, `load-plan.ts`). Re-computed from the step-0 read; different → 409 `"This bill changed since you
   opened it — reopen Split load."` Why not `updatedAt`: a lines-only change never touches
   `order_invoices."updatedAt"` (`split.ts:61-63`). The token covers "opened, then someone else moved / held
   / re-split"; the seq unique (§A.4) covers two presses inside the same second.
3. **Half-written bill** (any row of a split OBD with no lines) → `"The last split did not finish — press
   Repair first."` (§E.8). Checked before stale so the person is sent to the button that fixes it.
4. **Stale** (`detectStale(active, savedLines)`, `rules.ts:170`) → `"Lines changed in SAP — merge the
   waiting parts back to re-check, then split again."` A split is refused; a **merge is allowed** on a stale
   bill (it is the fix, §B.2) as long as its remainder per line is ≥ 0.
5. **CI on the source row** — any **non-voided** `ci_returns` row covering it (its own `orderInvoiceId`, or a
   whole-OBD one, `orderInvoiceId` NULL — `ci-plan.ts:42` `ciCoversRow`), **draft included** (a draft holds
   the row's tins as picks): `"I536230716 has CI-2026-00412 — it cannot be split."` A FULL CI also already
   finishes the row; a PART CI's lines were taken from the row's tins and would no longer match.
6. **Hold truth on an UNSPLIT bill** — the row's `isHeld` "drifted and is never read" for unsplit bills
   (`hold.ts:37-41`, ORDER_INVOICES §8). So for a first split the source's hold is taken from
   `orders.dispatchStatus = 'hold'`; if seq 1's mirror disagrees, the split is refused with `"Hold record
   out of step — press Repair"` and Repair runs the existing `mirrorObdHold(orderId, held)` (`hold.ts:249`).
   (A refusal, not a silent write, keeps "guards before writes".) Split OBDs read the row's own hold.
7. **Billing copy on the source row's trip** — a `trip_bill_copies` row covering the source on the trip it
   is on now (`coveringCopy(…, tid === source's trip)`, `copy-plan.ts:53`) → **refused** in v1:
   `"Billing already copied I536230716 for L-261024-04 — split it before billing copies it, or ask billing
   to take the trip back."` (Answer 1 below says why.)
8. **Repair** (`repairLoadWrite`, its own press — the only write that is not a split or merge). It acts ONLY on
   the two shapes a dead press can leave, and refuses anything else:
   - (a) delete `'load'` rows with **no lines**, not on a trip, not dispatched, no copy / re-delivery / CI
     (never used — a part gets its lines in the same press that made it);
   - (b) then, if **exactly one** row of the OBD has no lines and the OBD still has ≥ 2 rows, give it the
     remainder: unitQty − Σ other rows, per active line — refused unless every remainder is ≥ 0 and at
     least one > 0;
   - (c) if seq 1 is the only row left, leave it with no lines (unsplit).
   Same write discipline: (a) one `deleteMany`, (b) one `createMany`; re-read; one log row.
9. **Held parts (plan §3)** — a new part copies the source's hold (case 3); a held part cannot join a trip
   (existing, `trip-bills.ts:92-93`); a dispatched part is locked from split / merge (rules A.2-1, B.1);
   merge never mixes held and not-held (B.1).
10. **Tint bill** (case 25) — no extra guard: split is a row operation; picking and tint stay per OBD.
11. **Freight paper trip** (decision 7) — a bill on an ACTIVE `freight_trip_bills` row (partial unique
    `freight_trip_bills_order_active_key`, CLAUDE_FREIGHT_TRIPS.md:101) → refused `"On freight trip F-… —
    remove it there first"`; the reverse block (a split-load bill cannot join a freight trip) is phase 4.

---

## F. "Two parts of one invoice on one trip" — refused in `planAddRows`

**Writer:** `lib/order-invoices/trip-bills.ts` `planAddRows` (`:78-119`), the one per-row decision behind
`POST /api/floor/trips/[id]/bills` (call site `route.ts:418`). It already refuses per invoice and lets the
rest attach.

**Change:** `TripBillRow` gains optional `loadRootId?: number | null` (the group's root id; absent/null on
every row not in a load group — so every existing caller and test is unchanged). The route's one read
(`route.ts:239-251`) adds `loadParentId` to its select and fills `loadRootId = loadParentId ?? (has parts ?
id : null)`. In `planAddRows`, before the existing `r.tripDropId === null → attach` branch:

- a row whose group already has ANOTHER row on **this trip** (`tripId === tripId`), or
- a second row of the same group in **this press's** attach list

→ refused for that row only:
`` `${partLabel} — part ${k} of the same invoice is already on this trip` `` — e.g.
`"I536230716 part 2 of 2 — part 1 of the same invoice is already on this trip"`.
`partLabel` / `k` come from `loadGroupsOf` (§0). The unsplit wording (`trip-bills.ts:19-22`, byte for byte)
cannot change: an unsplit row never has `loadRootId`.

⚠ Phase 4, not here: every OTHER label (`invoiceLabel` in `trip-bills.ts:48`, `hold.ts:87`,
`ci-plan.ts:37`, `dispatch.ts:94,178`) still prints the bare number, identical for every part.

---

## G. API

Both new files `export const dynamic = "force-dynamic"`; the `gate()` pattern of
`app/api/floor/orders/[orderId]/invoices/route.ts:27-43`, with the second tick swapped.

### `app/api/floor/orders/[orderId]/load-split/route.ts`

- **GET** (floor canView) → `LoadView`:
  ```ts
  { orderId, obdNumber, expectKey: string, stale: boolean, halfWritten: boolean,
    blockedReason: string | null,                      // the bill-level refusal (E.1)
    activeLines: SplitActiveLine[],                    // split.ts:84 shape
    rows: Array<{ id, seq, source, invoiceNo, invoiceDate, rootId, k, n,
                  tripDropId, tripNumber, isHeld, isDispatched,
                  lines: { rawLineItemId, qty }[],     // resolved: unsplit seq 1 → every active line
                  canSplit: string | null,             // null = may be split; else the refusal (E.2–E.11)
                  canMergeAway: string | null }>,
    canEdit: boolean }
  ```
- **POST** (floor canEdit **AND** `floor_split_load` canEdit; 403 `"You do not have the Split load tick"`)
  body `{ mode?: "split" | "repair", sourceRowId: number, expectKey: string, trucks: [{ lines: [{ rawLineItemId, qty }] }] }`
  → `200 { ok: true, changed, rowIds }` | `400/404/409/500 { ok: false, error, errors? }`. P2002 → 409 (§A.4).
  `mode: "repair"` ignores `trucks` and runs `repairLoadWrite`.

### `app/api/floor/orders/[orderId]/load-merge/route.ts`

- **POST** (same two ticks) body `{ rowIds: number[], expectKey: string }` → same response shape.

### `lib/permissions.ts` — every edit for the new key `floor_split_load`

1. `PageKey` union (`:230-245`): `| "floor_split_load"` beside `floor_add_invoices`, with a comment of the
   same shape (canEdit is its only meaning, on top of floor canEdit; route paths above).
2. `ALL_PAGE_KEYS` (`:485-490`): add after `"floor_add_invoices"`.
3. `ACTION_PAGES.canEdit` (`:609-611`): add after `"floor_add_invoices"`, comment naming the two routes.
4. `PAGE_LABEL_OVERRIDES` (`:740`): `floor_split_load: "Floor · Split load",` (not in `PAGE_NAV_MAP`).
5. `ACCESS_SECTIONS` "Operations" (`:774`): after `"floor_add_invoices"` — the access page asserts every
   ALL_PAGE_KEYS key appears exactly once here.
6. Count comments: `:664` "THIRTY-TWO of the 55" and `:768` "The 55 keys" — ⚠ already stale: ALL_PAGE_KEYS
   holds **59** keys today (counted from the file 2026-10-24). Fix to the real count (60 after this key).

Outside `lib/permissions.ts`, same commit: `components/admin/permissions-manager.tsx:118` (its own key list —
add the row), `app/(floor)/floor/page.tsx:21` (resolve `canSplitLoad` beside `canAddInvoices`), and the
props down to `floor-page.tsx` / bottom bar / detail panel (phase 3 draws the button). **No grant SQL**
(phase 6): until then only admin / superuser (all-true over ALL_PAGE_KEYS) can press it.

---

## H. Logging

**Today:** Add invoices writes ONE `order_status_logs` row per save / undo, `fromStage = toStage =` the
stage, `changedById`, a `note` ("Invoices added: … (n invoices)" / "Invoices edited" / "Invoices undone"),
**no `orderInvoiceIds`** (`split.ts:426-434`, `:465-473`). The per-invoice Activity (`lib/floor/
detail-scope.ts:110` `activityForInvoice`) shows a log with EMPTY ids on every invoice of the OBD.

**Split load mirrors it, plus the v27.72 ids** (so the panel scoped to a part shows only its own events):
- split: `note: "Split load: I536230716 → 2 trucks (part 1: 12 tins · part 2: 8 tins)"` (number or
  "no invoice yet"), `orderInvoiceIds: [source, ...new]`.
- merge: `note: "Split load merged: parts 2, 3 of I536230716 into part 1 (20 tins)"`,
  `orderInvoiceIds: [survivor]` (the deleted ids are gone — §owner Q6).
- repair: `note: "Split load repaired: …"`, ids of the rows it touched.
The note strings are constants in `lib/floor/hold-log.ts`'s style (`INVOICE_HOLD_NOTE`) — one place, never
retyped. No `trip_activity` line (its CHECK has no action for it; owner Q5).

---

## The three questions — answered from the code

**1. A row billing already COPIED on its trip is split — what does Print show?**
The copy row names the SOURCE row's id (`planCopyRows`, `copy-plan.ts:86-89`), and the source keeps its id, so
`coveringCopy` (`:53-61`) still finds it: Print (`lib/billing/print.ts:463-481`) shows truck 1's line
**"copied"**, with the OLD paper behind it. Worse, the first split of an unsplit bill sets `splitAtOf` (the
earliest `seq > 1` `createdAt`, `copy-plan.ts:33-37`) to the split moment, so a copy taken earlier now reads
`isWholeObdCopy` → `copiedWhole: true` ("whole OBD, before the split", `print.ts:480`) — and, through
`copiedOnOtherTrip` (`:470,482-484`), part 2 on another trip shows "copied on L-…" too. Nothing says the tins
changed: Print has no "changed since copy" state. **Recommendation: refuse in v1** (guard E.7). "Allow +
changed since copy" needs a new Print state and wording (phase 5's Print work) — revisit there.

**2. Does `detectStale` handle `'load'` rows?** **Yes, no change needed.** It sums `savedLines` over every
row of the OBD per raw line and compares with each active line's unitQty (`rules.ts:170-183`); it never reads
`source` or `seq`. Root + parts + any Add-invoices rows together must place every tin exactly — which is
Model A with more rows. Half-writes are caught beside it by "a row with no lines" (`split.ts:295`,
`invoice-rows.ts:130`). Two limits, both by design today: it is OBD-wide (it cannot say WHICH part is off),
and **it blocks nothing** — plan §3 case 17 says "dispatch blocked until fixed", but `markRowsDispatched`
(`dispatch.ts:138-183`) and `lib/floor/dispatch.ts` never read `stale` (grep 2026-10-24). That block does
not exist yet; adding it is phase 4 (owner Q2).

**3. Any reader that treats `source !== 'sap'` as `'manual'`?** No reader branches on `source` that way
(grep of `lib`, `app`, `components` for every `source ===/!==` form, 2026-10-24). The four uses are
`split.ts:199,216,357,453` (writer side, `'manual'` / `'sap'` by name) and `sap-row.ts:65,105,111`
(`'sap'` by name) — both stay correct. The one display use, `components/floor/detail-invoices.tsx:109`
(`inv.source === "sap"` → an "SAP" chip), is **not mounted** since Phase 4 (`detail-panel.tsx:35`). **But
readers that treat `seq > 1` as "a typed invoice" WILL mislabel a part:** `addedInvoiceNosOf`
(`invoice-rows.ts:358-360`, the "+n" chip fed by `lib/floor/queries.ts:1572`) would list the part's number —
the SAME as seq 1's — as an added invoice; `splitAtOf` (`copy-plan.ts:33`) treats a load split as the
Add-invoices split moment (Answer 1). Both are phase 4 fixes (filter `source !== 'load'` / use the group).

---

## Files that will change (phase 2 only — UI is phase 3, the breaks are phase 4)

| File | Change |
|---|---|
| `lib/order-invoices/source.ts` **(new)** | `export const INVOICE_SOURCE = { SAP: "sap", MANUAL: "manual", LOAD: "load" } as const` + type. The one vocabulary (CORE §3 "a status string is not an enum"). |
| `lib/order-invoices/load-plan.ts` **(new, pure)** + `load-plan.test.ts` | `loadGroupsOf`, `rootOf`, `tinsOfRow`, `planLoadSplit`, `planLoadMerge`, `loadSplitRefusal`, `loadMergeRefusal`, `rowsKey`, `remainderLines`. |
| `lib/order-invoices/load-split.ts` **(new, server)** | `loadLoadView`, `saveLoadSplit`, `mergeLoadParts`, `repairLoadWrite`. |
| `app/api/floor/orders/[orderId]/load-split/route.ts` **(new)** | GET / POST (split, repair). |
| `app/api/floor/orders/[orderId]/load-merge/route.ts` **(new)** | POST. |
| `lib/order-invoices/split.ts` | Import the constants instead of the two local literals (`:81-82`, no behaviour change); the §D lock in `prepare()` and `loadSplitView.blockedReason`. |
| `lib/order-invoices/rules.ts` | One exported message constant `ADD_INVOICES_LOAD_LOCK`. `validateSplit` untouched. |
| `lib/order-invoices/sap-row.ts` | §C: two `updateMany`s + one `findFirst`; `SOURCE_SAP` from the constants file. |
| `lib/order-invoices/trip-bills.ts` + test | §F: optional `loadRootId`, the one-part-per-trip refusal. |
| `app/api/floor/trips/[id]/bills/route.ts` | §F: select `loadParentId`, fill `loadRootId`. |
| `lib/floor/hold-log.ts` | §H note constants. |
| `prisma/schema.prisma` | None (v27.76 already modelled `loadParentId` / `loadParent` / `loadParts`). |
| `lib/permissions.ts`, `components/admin/permissions-manager.tsx`, `app/(floor)/floor/page.tsx` | §G new key `floor_split_load`. |

---

## Proving unsplit bills are unchanged (the parity check)

1. **Pure tests** (run with `npx tsx --test`): every existing test file of `lib/order-invoices/*` and
   `lib/floor/invoice-rows.test.ts` passes **unchanged**; new cases in `trip-bills.test.ts` assert the three
   unsplit wordings are byte-identical with and without `loadRootId` absent; `load-plan.test.ts` asserts
   `planLoadSplit` on 18648-shaped fixtures and on an unsplit 1-row fixture.
2. **Read-only parity script** `scripts/_parity-split-load-<date>.ts` (scratch, never committed, SELECT-only,
   the `scripts/parity-oi-trips-20261012.ts` pattern), run against production **before and after the deploy**
   on the same bill set (all live board bills + 200 recent unsplit ones):
   - the Floor board payload (`getFloorBoard`) per unsplit OBD — `JSON.stringify` equal, field by field;
   - `loadSplitView` (Add invoices GET) per unsplit OBD — equal, `blockedReason` included;
   - trip totals (`lib/trips/queries.ts`) and the Print rows (`lib/billing/print.ts`) of every trip of today
     and yesterday — equal;
   - counts: `order_invoices` rows per source (expect `'load'` 0 until the owner splits a bill), OBDs with
     `partlyOnTrip` true, "derived stop check" = 0.
3. **The sap-row change**: before/after an import cycle, `SELECT count(*) … WHERE source='load'` stays 0 and
   `n_tup_upd` on `order_invoices` moves only by the seq-1 fills it moved before (pg_stat_user_tables,
   read-only).
4. **Live markers**: `MAX(orders.updatedAt)` over the board set does not move on a GET of the new route (no
   write on read), and moves exactly once on a split of a bill on a trip (partlyOnTrip), never on a split of
   a waiting bill.
5. `npx tsc --noEmit` + `next build` clean. The owner's hand smoke test is phase 3 (UI); no login is used by
   Claude Code to smoke-test (the dev server points at production).

---

## Owner questions (one line each)

1. A billing copy already made for the truck: refuse the split (recommended), or allow and mark the copy "changed"?
2. Plan §3 case 17 says dispatch is blocked while a split is stale — that block does not exist today; add it in phase 4 (yes/no)?
3. A part whose tins all come back: decision 6 makes a part's CI PARTIAL, but the done rule only counts a FULL CI (`dispatch.ts:56`, `live-ci.ts:15-22`) — should a returned part still let the bill reach "dispatched"?
4. Can the root be split while it is on a trip whose billing copy is not made yet (case 2 says yes) — confirm?
5. Should a split or merge also write a line in the trip's own activity log (needs a new trip_activity action)?
6. After a merge, the merged parts' rows are deleted, so old Activity lines that named them show on no invoice — acceptable?
7. Maximum trucks for one invoice: reuse the 20-rows-per-bill fuse, or a smaller number (e.g. 5)?
8. A CI draft open on the invoice blocks a split — confirm (recommended), or only a submitted CI?
9. Merge while SAP changed a quantity (stale): allow it as the fix (recommended), or block everything until an admin looks?

---

## Owner answers 2026-10-24 ("all ok")

1. Billing copy on the source row's trip → REFUSE (guard E.7 as written).
2. Stale split blocks dispatch → YES — **PHASE 4 TODO** (not built in phase 2).
3. A part fully returned by CI counts as finished (the part's CI returns ALL of that part's tins); the register still says PARTIAL → **PHASE 4 TODO** (not built in phase 2).
4. Splitting the root while on a trip (no copy yet) → ALLOWED (as designed).
5. No trip_activity line in v1.
6. Merged-away parts' old Activity lines showing on no invoice → acceptable.
7. Max rows → reuse MAX_INVOICES (20).
8. A CI DRAFT on the source row blocks the split → YES (guard E.5 as written).
9. Merge allowed on a stale bill as the fix → YES (as designed).
