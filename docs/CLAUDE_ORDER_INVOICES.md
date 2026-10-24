# CLAUDE_ORDER_INVOICES.md — Add invoices: one OBD, many SAP invoices (the invoice row is the dispatch unit)
# v1.0 · Schema v27.74 · October 2026 · updated 2026-10-24 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md — plus the domain file of the screen you touch

**Purpose.** SAP sometimes bills ONE OBD as SEVERAL invoices; Orbit imports only one. "Add invoices"
records the rest, and from then on the INVOICE ROW (`order_invoices`) — not the OBD — is what goes on a
trip, is held, is dispatched, gets a CI, is copied by billing and is re-delivered.

**This file owns:** the data model (Model A), the invoice-row columns and the DERIVED OBD rules, the single
writer of every row column, the unsplit mirrors and their drift repair, the hand-SQL rules, the Add invoices
save / undo and its lock rules and permission, and every file in `lib/order-invoices/`.

**Cross-referenced by** FLOOR, FLOOR_TRIPS, BILLING, CI, PICKING, IMPORT and CORE. Those files own the
SCREENS and FLOWS that use invoice rows (§1) and point here for the rules.

Written from the code at `a05769b7` (Add invoices P5-5, origin/main) and the live read-only check of
2026-10-24. Where a draft, a mockup or an older comment disagrees with the code, the code (and this file)
win. Plan this file was written from: `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md`.

---

## 1. Ownership boundary

One owner per behaviour. This file owns the RULE; the screen's file owns what a person sees and presses.

| Behaviour | Owner | Notes |
|---|---|---|
| Model A, row columns, derived OBD rules, single writers, mirrors, drift repair, hand-SQL rules | **this file** | CORE §7 holds the schema text (chain entries v27.63 – v27.74, the `order_invoices` / `order_invoice_lines` blocks); CORE §13 keeps one-line landmines pointing here |
| Add invoices: permission tick, save / undo API, edit in place, lock rules, `blockedReason` | **this file** | The dialog and the detail-panel Invoices section as UI → `CLAUDE_FLOOR.md` (detail panel) |
| Floor board: one row per invoice, "k/n", `inv:` ticks, amber split-across-places bar / chip, board arms 3 / 4 and the desk rule as screen behaviour, On hold and Cancel & CI per invoice, the panel scoped to an invoice, search by any invoice number | `CLAUDE_FLOOR.md` | The predicates' why → §3 and §8 here |
| Invoice PAIRS — one invoice on several OBDs (`orders.invoiceNo` shared; no schema) | `CLAUDE_FLOOR.md` | The OPPOSITE of a split; not modelled in `order_invoices` |
| The `pair` colour token, amber reuse, pair / split row drawing | `CLAUDE_UI.md` | |
| Trips: add / remove (strips only that trip's rows) / move with confirm, per-invoice litres and kg, re-delivery per invoice, a held invoice can't join | `CLAUDE_FLOOR_TRIPS.md` | The writer contract (`setRowsTrip`) → §4.3 here |
| Billing Print per invoice: copies, Copy inv, the pre-split whole-OBD copy | `CLAUDE_BILLING.md` (Print tab) | The copy rule → §4.7 here |
| CI per invoice from Floor, auto-CI still whole-OBD, a CI in the OBD done rule | `CLAUDE_CI.md` | The done rule → §3 here; the CI writer → §4.6 |
| The pick visibility gate "any invoice row of the OBD on a shown trip" | `CLAUDE_FLOOR_TRIPS.md` (gate definition) + `CLAUDE_PICKING.md` (where it applies) | Picking itself stays per OBD |
| Seq-1 row on every new order; SAP line kg used for learned kg per tin | `CLAUDE_IMPORT.md` | The mirror writer → §4.1 here |

**Stays per OBD, always (Model A):** picking, tint, `workflowStage` (except through the done rule),
Cancel, ship-to, Hand, the bill COUNT on a trip ("+n re-del" counts OBDs too). Any invoice of an OBD on a
trip refuses the per-OBD actions (Cancel / CI-of-the-whole-bill / ship-to / Hand) with a message naming how
many invoices and where (`lib/order-invoices/trip-refusal.ts`).

## 2. Model A

Owner decision 2026-10-09; schema v27.63 (`sql/2026-10-10-order-invoices-ddl.sql`).

- **Every order has `order_invoices` rows.** An UNSPLIT OBD has exactly ONE: seq 1, source `'sap'`, which
  MIRRORS `orders.invoiceNo` / `orders.invoiceDate`, and NO `order_invoice_lines` rows ("no line rows" = all
  lines of the OBD).
- **A SPLIT OBD** has n ≥ 2 rows (`MIN_INVOICES` 2, `MAX_INVOICES` 20, `lib/order-invoices/rules.ts`):
  seq 1 is SAP's invoice, unchanged; seq 2..n are typed by hand, source `'manual'`. EVERY row, seq 1
  included, then carries `order_invoice_lines` that place every ACTIVE raw line of the OBD exactly —
  Σ tins per line == the line's `unitQty`.
- **Identity is `UNIQUE (orderId, seq)` — never `(orderId, invoiceNo)`.** Lines are keyed by
  `rawLineItemId` (a real FK), never by SKU: one OBD can carry the same SKU on two lines (live: OBD
  9109951956, SKU 9296830 on two lines).
- **"Split OBD" in code** = the OBD has a row with `seq > 1`. Every split-only branch tests exactly that.
- **Kg per invoice** (owner rule 2026-10-13, `lib/floor/invoice-rows.ts`; first that applies):
  1. every line on the invoice has SAP line kg (`import_raw_line_items."totalWeight"` > 0) → Σ line kg ×
     tins / line tins. EXACT.
  2. SAP's kg per tin is known for every line's SKU → Σ tins × kg per tin. EXACT. Learned, never stored:
     the median of `totalWeight / unitQty` per SKU over every line that carries it
     (`lib/order-invoices/kg-per-unit.ts`). NOT `sku_master."grossWeightPerUnit"` — that holds pack litres.
  3. the OBD's header kg shared by litres (`lib/order-invoices/entry.ts` `kgShare`) — APPROXIMATE, shown
     with "~" (`kgExact: false`); null when there is no kg to share.
- **Litres per invoice** = Σ over its lines of line litres × tins / line tins (`lineLitres`).
- **A split OBD's load in a place** (a stop, a trip): the sum of ITS invoices there (`placeLoad`,
  `invoicesLoad` in `lib/floor/invoice-rows.ts`). They return null when the place holds every row or the
  OBD is unsplit — the caller then uses the OBD's own totals, so an unsplit OBD is byte-for-byte unchanged.

## 3. Row columns and the DERIVED OBD rules

Since v27.66 (`sql/2026-10-12-order-invoices-dispatch-unit.sql`) each row carries its own dispatch state:

| Column(s) | Meaning |
|---|---|
| `"tripDropId"` → `trip_drops` (ON DELETE SET NULL) | The stop this invoice is on; NULL = on no trip |
| `"isHeld"` / `"heldAt"` / `"heldById"` | Held. 🔴 `heldAt` is the WALL-CLOCK hold moment — NOT `orders."heldAt"`, which is the ARRIVAL date |
| `"isDispatched"` / `"dispatchedAt"` / `"dispatchedById"` | This invoice has left on a truck |
| CHECKs | `chk_order_invoices_hold_shape`, `chk_order_invoices_dispatch_shape`, `chk_order_invoices_held_not_dispatched` (a row is never both) |

Three tables point at a row ON DELETE RESTRICT: `trip_bill_copies."orderInvoiceId"` and
`trip_redeliveries."orderInvoiceId"` (both NOT NULL since v27.74, one row per (trip, invoice row)), and
`ci_returns."orderInvoiceId"` (nullable — NULL = a whole-OBD CI on a split OBD). `order_status_logs.
"orderInvoiceIds"` (v27.72) names the rows a log event is about; EMPTY = the whole OBD.

**The OBD columns are DERIVED from the rows and dual-written by the app — never by a trigger:**

| OBD column | Rule | Written by |
|---|---|---|
| `orders."tripDropId"` | The `tripDropId` of the LOWEST-seq row that has one; NULL when no row is on a trip | `setRowsTrip` (§4.3) |
| `orders."partlyOnTrip"` (v27.69) | TRUE ⇔ ≥ 1 row on a stop AND ≥ 1 row on none (only a split OBD can be) | `setRowsTrip`, in the same `orders.update` |
| `orders."dispatchStatus"` | `'hold'` ⇔ EVERY row `isHeld`. A partly-held OBD stays as it is (`'dispatch'`). Releasing any row of an all-held OBD applies the existing unhold rule (`'dispatch'` at `FLOOR_CLEAR_HOLD_STAGES`, else NULL) | `hold.ts` for split OBDs (§4.4); every OBD-level hold writer otherwise |
| `orders."workflowStage"` = `'dispatched'` | ⇔ EVERY row is `isDispatched` OR covered by a FULL, submitted (not draft, not voided) CI — its own or a whole-OBD one — **AND at least one row really is `isDispatched`**. An OBD whose every invoice came back on a CI shipped nothing and is never called dispatched | `dispatch.ts` (§4.5) |

**For an UNSPLIT OBD every rule is the identity:** row == OBD. The OBD columns are the truth for an unsplit
OBD; its row columns are a MIRROR kept by the OBD-level writers (§4.4, §4.5) and are never read for its
screens (§8).

Which reader to use (`lib/order-invoices/trip-read.ts`): "bills on these stops" → `onStopsWhere` (any row
there); "where is this OBD on THIS trip" → `placeOnTrips` / `obdStopOnTrip` (its lowest-seq row on that
trip); "which stop, no trip in hand" → `obdStopIds` (the derived rule; `deriveObdTripDropId` is its one
home); "on a shown trip" → `ON_SHOWN_TRIP_WHERE`; "has a row off any trip" → `HAS_ROW_OFF_TRIP_WHERE`
(= `"tripDropId" IS NULL OR "partlyOnTrip"`, §8). `orders."tripDropId"` is WRONG for "is this OBD on THIS
trip" once rows of one OBD sit on different trips — never answer that from it.

## 4. The single writers

Every writer: sequential awaits, never `prisma.$transaction` (CORE §3). With no transaction, the WRITE
ORDER is the safety: rows first, the OBD (the commit point every `orders` reader sees) after, the log last;
and a retry re-reads and converges.

### 4.1 `sap-row.ts` — the seq-1 mirror

`createSapInvoiceRows` (import upsert create path, challan create), `createSapInvoiceRowsForObds` (OBD
import route after `createMany` — manual template and auto-import), `syncSapInvoiceRow` (patch-headers,
`lib/import-upsert/header.ts` `applyHeaderPatch`, and `split.ts`).
- **Reads the value from `orders`, never from the caller** — runs AFTER the orders write and copies what
  the database holds.
- **NULL-only**, like `orders`: a field is filled only while the seq-1 copy is NULL; a `'manual'` row is
  never touched.
- **Never throws.** The order is already written; a failure is logged `[order-invoices]` and repaired by
  re-running PART 3 of `sql/2026-10-10-order-invoices-ddl.sql` (idempotent).

### 4.2 `split.ts` — Add invoices save / undo (edit in place)

Server half of `app/api/floor/orders/[orderId]/invoices`; the rules are `rules.ts` (`validateSplit`,
`addInvoicesRefusal`) and the diff is the pure `plan.ts` (`planSplitWrite`, `obdStateRefusal`). Behaviour:
§5.
- **RECORD ONLY.** Writes `order_invoices`, `order_invoice_lines` and ONE `order_status_logs` row — never
  `orders`, a trip, picking or CI.
- **Edit in place, by seq** (v27.66): the row at seq k becomes the k-th invoice, only rows past the new
  count are deleted (their lines cascade), only rows whose lines change are re-lined. Rows KEEP THEIR IDS
  because copies, re-deliveries and CIs point at them ON DELETE RESTRICT. 🔴 Never revert to
  delete + re-create.
- **The one state write save makes:** a CREATED row (seq 2..n) is written WITH seq 1's `tripDropId` /
  `isHeld` / `heldAt` / `heldById`. A kept row's state is never written; `isDispatched` never is.
- Write order: 0 read + plan (refuse → nothing written) · 1 delete manual rows past the count · 2 re-number
  / re-date kept manual rows · 3 create new rows · 4 read their ids · 5 delete lines of re-lined rows ·
  6 create all lines in ONE statement · 7 re-read and re-validate · 8 one status log.
- **Half-failure: press Save (or Undo) again.** The plan is always the diff from what the database holds
  NOW. In between the OBD is never silently wrong: GET reports `stale` and `validateSplit` fails until the
  re-run lands. Two saves racing collide on `UNIQUE (orderId, seq)`.
- No live refresh is sent and `orders.updatedAt` is not touched: the `order_invoices` (v27.65) and
  `order_invoice_lines` (v27.67) live triggers record the change themselves.

### 4.3 `trip-link.ts` `setRowsTrip` — the ONLY trip writer

Callers: `app/api/floor/trips/[id]/bills` (add / remove / move — whole OBD or chosen `invoiceRowIds`) and
`app/api/floor/trips/[id]/cancel` (detach every row on that trip). A new trip writer goes through here too.
The per-row decisions are the pure `trip-bills.ts` (`planAddRows` / `planRemoveRows`).
- Write order per OBD: 1 read ALL the OBD's rows · 2 ONE `order_invoices.updateMany` for the target rows
  not already there (`onlyFromTripId` limits it to rows on that trip — remove strips ONLY that trip's
  rows, never another trip's) · 3 ONE `orders.update` with the derived `tripDropId` AND `partlyOnTrip`,
  both recomputed from ALL rows after step 2.
- **Exactly one `orders.update` per OBD** (the Floor / Picking markers key on `MAX(orders.updatedAt)`).
- **Half-failure:** dying between 2 and 3 leaves rows moved and the OBD stale; a retry converges (step 2
  finds nothing to move, step 3 lands). The routes keep that reachable: a press that finds the rows
  already where it asked but `orders` disagreeing (`needsDerivedRepair`) still calls `setRowsTrip`.
- Add rules: every attached row of one OBD lands on the OBD's ONE stop of that trip (the customer's drop
  key); a row on another trip is refused FOR THAT INVOICE ONLY; a held invoice is refused (6.3). An unsplit
  OBD keeps the old refusal wording byte for byte; a split OBD's names the invoice.

### 4.4 `hold.ts` — hold per invoice, and the OBD hold mirror

- **`holdRows` / `releaseRows` — the only row-hold writer for SPLIT OBDs** (called from
  `app/api/floor/actions` hold / unhold with `invoiceRowIds`). Write order per OBD: 1 read the OBD and ALL
  rows · 2 ONE `updateMany` for the rows whose `isHeld` changes · 3 ONE `orders.update` ONLY when the
  derived `dispatchStatus` differs (no idle write) · 4 ONE status log with `orderInvoiceIds` = the rows
  step 2 changed. Half-failure: a retry converges (step 3 still compares and lands).
- Refused one by one (the rest of the press goes on): an invoice ON A TRIP ("remove it from the trip
  first"), a dispatched invoice. Release refuses the whole OBD while it carries a live CI.
- **Unsplit OBDs never come here.** Every OBD-level hold / release / cancel writer calls
  **`mirrorObdHoldSafe`** AFTER its own `orders.update`, so every row of that OBD carries the same
  `isHeld`. Callers today: Floor bill actions, release, raise-CI, Tint Manager status, Billing mail-order
  actions, Telephonic apply, pick-delete, picking cancel, challan reconcile, the OBD import route.
  🔴 **A NEW OBD-level hold writer must call it too.** It is ONE `updateMany` of only the rows that differ,
  skips dispatched rows (so one gone invoice cannot fail the mirror), and never throws — a missed mirror is
  drift, repaired by §6.

### 4.5 `dispatch.ts` — dispatched per invoice, the OBD done rule, the dispatched mirror

- **Split OBD:** `markRowsDispatched` (from the trip dispatch route via `lib/floor/dispatch.ts`) — only
  the invoices on the dispatched trip ship. Write order: 1 read OBD, ALL rows, live FULL CIs · 2 ONE
  `updateMany` (rows not yet dispatched; never a held row) · 3 ONE `orders.update` to `'dispatched'` ONLY
  when the done rule now holds · 4 one status log with `orderInvoiceIds`. Half-failure: a retry converges.
- **`settleObdDone`** re-applies the done rule after something else finished an invoice (a per-invoice CI,
  §4.6): writes only the OBD stage, one update, one log; never throws.
- **Unsplit OBD:** `markBillsDispatched` writes the OBD exactly as before, then **`mirrorObdDispatchedSafe`**
  copies it onto the seq-1 row. Never throws; a missed mirror is repaired by PART 2 of the hold-mirror file
  (§6).

### 4.6 `ci-plan.ts` + `raiseInvoiceCi` — CI per invoice

`lib/floor/raise-ci.ts` `raiseInvoiceCi` (Floor Raise CI on a split OBD's ticked invoices; route
`app/api/floor/ci`), rules in the pure `ci-plan.ts`. Behaviour: `CLAUDE_CI.md`.
- One CI per ticked invoice row: `orderInvoiceId` = the row, its lines = that invoice's
  `order_invoice_lines`, `returnType 'full'` (the whole INVOICE), number and date = the row's.
- Allowed while held; refused on a trip or dispatched. Duplicate guard per (orderId, orderInvoiceId): a
  live CI on that row, a whole-OBD CI (NULL), or a draft → skipped.
- **No `orders` write — the OBD is not cancelled** — unless the CI finishes the OBD under the done rule
  (`settleObdDone`). One status log naming the row.
- **Which CI covers a row** (`ciCoversRow`): its own CI, or a whole-OBD CI (`orderInvoiceId` NULL). A
  whole-OBD CI on a split OBD stays NULL for good.
- 🔴 **Auto-CI (`lib/ci/auto.ts`) is still WHOLE-OBD** — keyed orderId + `source 'auto_finding'`; its row
  is seq 1 on an unsplit OBD and NULL on a split one. Open item (§11).
- Retry after a press died between the CI and its log: the guard finds the CI and skips ("Already has
  CI-…"); only the log line is missing.

### 4.7 `copy-plan.ts` — billing copies per invoice

Applied by `lib/billing/print.ts` `copyTripBills` (route `app/api/billing/print/trip/[id]/copy`).
Behaviour: `CLAUDE_BILLING.md` (Print tab).
- UNSPLIT → one row on seq 1. SPLIT → one row per invoice of it ON THAT TRIP not copied there yet; a Copy
  inv press writes only the invoices whose numbers went on the clipboard (`badSentNo` refuses a number that
  isn't one of them).
- **An invoice is copied on a trip** when a copy row there names it, OR a copy row there names ANY row of
  the OBD and was taken BEFORE THE SPLIT (`copiedAt` earlier than the first seq ≥ 2 row's `createdAt`).
  That copy was of the whole bill and covers every invoice the OBD later became; it is never rewritten.
- A split OBD reads COPIED on a trip when all its invoices there are.
- Rows go in with `createMany skipDuplicates` over `trip_bill_copies_trip_invoice_key` — a second press is
  skipped, never double-recorded.

### 4.8 `redelivery-plan.ts` — re-deliveries per invoice

Applied by `lib/trips/redelivery.ts` `addRedeliveries` (route `app/api/floor/trips/[id]/redeliveries`).
Behaviour: `CLAUDE_FLOOR_TRIPS.md`.
- UNSPLIT → one row on seq 1 (`orderIds`). SPLIT → one row per ticked invoice (`invoiceRowIds`); a split
  OBD sent whole is refused ("tick the invoices one by one").
- Each invoice is its own attempt line: its attempts are its own trip plus every re-delivery naming it, so
  attempt no. and `prevTripId` are PER INVOICE.
- Refused: a held invoice (`MSG_INVOICE_HELD`), one that never went on a truck (`MSG_INVOICE_NOT_GONE`).
- Load = only that invoice's litres / kg (§2). COUNT stays per OBD: two invoices of one OBD re-delivered on
  one trip are ONE in "+n re-del" (`redeliveryCountsByTrip`). No `orders` write.

### 4.9 `links.ts` — which row a whole-OBD record points at

`linkRowFor`: UNSPLIT → its seq-1 row; SPLIT → NULL for every kind (a split OBD has no "whole" row — the
copy / re-delivery writers name each invoice themselves, §4.7 / §4.8). The P5-4 stopgap "the lowest-seq
row on the trip stands for the OBD" is GONE since v27.74 — do not bring it back. Readers find a record's OBD
THROUGH its row (`recordsOfObds`, `recordObdOf`); `"orderId"` on copies / re-deliveries is a denormalised
read key only.

## 5. Add invoices — the flow

**Permission.** Page key `floor_add_invoices` (`lib/permissions.ts`; label "Floor · Add invoices",
admin screen under `floor`). Save and Undo need **`floor` canEdit AND `floor_add_invoices` canEdit**
(the route's gate; the 403 reads "You do not have the Add invoices tick"); GET needs `floor` canView.
Granted per user in `user_page_access` (no `role_permissions` row). **Holders, read live 2026-10-24:**
Ajay Vansiya (#29), Dhanraj Shah (#30), Priya Chaudhari (#31) — view + edit. The grant script is
`docs/prompts/drafts/code-update-2026-10-10-floor-add-invoices-grant.sql` (OR-merge, never revoke).

**Where it opens.** The Floor bar's ··· More with exactly one OBD ticked (every invoice of it ticked, on a
split OBD), or the detail panel's Invoices section. UI → `CLAUDE_FLOOR.md`. Approved mockup:
`docs/mockups/add-invoices/add-invoices-flow.html`.

**Paper by paper** (`components/floor/add-invoices-dialog.tsx`, arithmetic in `entry.ts`):
1. Paper 1 is SAP's invoice — its number is read-only.
2. Each later paper gets its number typed; a short number is expanded against SAP's (`expandInvoiceNo`);
   only the full `I` + 9 digits is ever sent (`normaliseInvoiceNo`, shared with CI search).
3. On each paper, tick the items printed on it: a tick puts ALL that line's tins still LEFT; "change" takes
   fewer (a line may be split across papers).
4. When nothing is left: a summary per invoice (tins, litres, kg ~) and **Save invoices**. Save is enabled
   only when `validateSplit` — the server's own rule — passes; the server still decides and its errors
   show word for word.
5. **Undo** merges every invoice back into seq 1 (manual rows and seq 1's lines deleted).

**Refusals — whole bill** (`rules.ts` `addInvoicesRefusal`): "This bill has been removed" · "This bill is
cancelled" · "This bill has already been dispatched" · "This bill is closed" · "Wait for the SAP invoice —
this bill has no invoice number from SAP yet".

**Lock rules — "split inside the trip"** (owner 2026-10-12; `plan.ts` `obdStateRefusal`):
- A FIRST split is ALLOWED on a bill on a trip and / or held. The new rows inherit seq 1's stop and hold,
  so the trip and the OBD do not change.
- EDIT and UNDO are allowed only while EVERY row is in the same state — the same stop (or all off a trip)
  and all held or none. Otherwise: "Invoices of {OBD} are on different trips / holds — move them back
  together first."
- ALWAYS refused: any row dispatched — "Already dispatched — invoices can't be changed." — or ANY
  `ci_returns` row on the OBD, void and draft included — "Has a CI (CI-…) — invoices can't be changed."
- A copy or re-delivery does NOT block and stays on its row; but a plan that would DELETE a row one points
  at is refused in plain English ("{invoice} cannot be removed — …, and that record stays on it").
- GET's `blockedReason` (the More menu's hint) is the same message.
- 🔴 History: the first v27.66 code refused splitting any row on a trip / held / copied — 3,679 of 3,728
  splittable bills blocked. The owner replaced it with this rule. Do not revert.

## 6. Hand-SQL rules and drift repair

Every derived column and every unsplit mirror is APP-maintained. A hand SQL write skips the app, so:

- 🔴 **Never hand-sweep a SPLIT OBD.** Its rows are the truth; no repair script touches split OBDs. Move,
  hold, release, dispatch or CI one through the app. If a hand fix is unavoidable, write the rows AND
  re-derive the OBD (`tripDropId` = lowest-seq row's stop; `partlyOnTrip`; `dispatchStatus` all-held rule;
  done rule), then read both back.
- 🔴 **After any SQL sweep of `orders` hold / dispatched** (e.g. a bulk stage or status fix), run the
  unsplit mirror: `sql/2026-10-19-part3b-hold-mirror-rerun.sql`, each PART on its own, **in order
  PART 1 → 1b → 2 → 3 → 4**. Unsplit OBDs only; every write is an `IS DISTINCT FROM` mirror, so a re-run is
  a no-op.
  - PART 1: read-only pre-check · **1b (step A): clear STALE holds** · 2: the dispatched mirror (the
    dispatch-unit file's PART 3c, verbatim) · 3: the hold mirror (its PART 3b + one guard) · 4: verify.
  - **Why 1b exists:** on 19 Oct PART 2 as first written FAILED `chk_order_invoices_held_not_dispatched` —
    row 12932 / order 14607 still said `isHeld` (a stale hold; the OBD was no longer `'hold'`) while its OBD
    was now dispatched, so marking it dispatched broke the CHECK. Clearing stale holds first makes PART 2
    safe. Read back that day: PART 1 73 · 121 · 39 · 123 · 2 → PART 4 0 · 0 · 0 · 0 · 2 (the 2 = 18648's
    716 + 714, held on purpose then).
- **After a hand edit of `order_invoices."tripDropId"`**, or a hand DELETE of a `trip_drops` row that
  still holds invoice rows (FK ON DELETE SET NULL): run PART 3 of
  `sql/2026-10-15-v27.69-orders-partly-on-trip.sql` (re-derives `partlyOnTrip`) and re-check the derived
  `orders."tripDropId"`.
- Never run a data fix with `session_replication_role = replica` — the live-feed triggers on
  `order_invoices` / `order_invoice_lines` must fire (CORE §13).

**History:** 2026-10-19 11:44 — the owner hand-set order 18648's rows **36798 (I536230713)** and **36800
(I536230715)** onto **stop 2478** (trip 605, L-261006-05) in SQL, matching where those two invoices
actually went (§7).

## 7. Live numbers (read-only, 2026-10-24) and the one split OBD

| Fact | Live 2026-10-24 |
|---|---|
| Orders (not removed) | 20,463 — 0 without an invoice row |
| `order_invoices` rows | 20,518 (`sap` 20,515 · `manual` 3) |
| `order_invoice_lines` rows | 4 |
| Split OBDs | **1** — order 18648 |
| Rows held / on a trip / dispatched (all) | 193 / 6,019 / 7,361 |
| `orders."partlyOnTrip"` true | 0 |
| CIs | 231, every one with `orderInvoiceId`; 0 on the split OBD |
| `trip_bill_copies` | 857 (none on a seq > 1 row) |
| `trip_redeliveries` | 74 (2 on seq > 1 rows); 0 NULL `orderInvoiceId` on either table |
| Invoice pairs (for contrast — FLOOR) | 22 invoices shared by 2 OBDs each |

**Order 18648 — OBD 9109951956, the story so far.** SAP billed it as four invoices; Orbit imported only
I536230716 (seq 1, row 17010). Split on 2026-10-12 19:28 IST into seq 2 I536230713 (row 36798), seq 3
I536230714 (row 36799), seq 4 I536230715 (row 36800).
- 6 Oct, before the split: the bill was planned on **L-261006-05** (trip 605) and billing copied it —
  copy 276 (bulk, 11:03 IST, on row 17010). Because it predates the split it covers every invoice there (§4.7).
- Only **713 + 715** were actually on that truck. By 12 Oct all four rows were off any trip (PART 8
  read-back); the 19 Oct hand-set (§6) put 713 + 715 back on that trip's stop 2478 as history. They came back and went again on **L-261007-20** (trip 668)
  as re-deliveries **28** (→ 713; linked by PART 6b, run between 12 and 23 Oct — the date isn't in the
  repo) and **86** (→ 715; added by PART 6c on 23 Oct). Both attempt 2, `prevTripId` 605; trip 668 counts
  them as ONE re-delivery of 460 L / 626.63 kg.
- **716 + 714** were held on 19 Oct while the OBD stayed `'dispatch'`; today they are released and on stop
  5062, **L-261020-05** (trip 1140).
- Today: `pick_checked` / `'dispatch'`, rows on two trips (605, 1140), none held or dispatched,
  `partlyOnTrip` false (every row is on a stop).

## 8. Landmines

- 🔴 **An unsplit row's `isHeld` / `isDispatched` is never read for its screens.** `orders.dispatchStatus` /
  `orders.workflowStage` are the truth for an unsplit OBD; the row is a mirror (§4.4, §4.5). Split-only
  branches test `seq > 1`.
- 🔴 **`HAS_ROW_OFF_TRIP_WHERE` (`"tripDropId" IS NULL OR "partlyOnTrip"`) and the second `seq > 1` row
  branch beside the old orders term (board arm 4 `floorTripBillsWhere`, the desk rule `tripsOnDeskWhere`)
  are kept that way for query speed.** Reading every row there measured 60 ms vs 34 ms on the 15-second
  Floor marker, with a new Seq Scan on `order_invoices` (EXPLAIN ANALYZE, 2026-10-15). Never "simplify" one
  to a bare `invoices: { some: … }` filter without an EXPLAIN before and after. `partlyOnTrip` exists
  ONLY for this plan. Detail → `CLAUDE_FLOOR.md` (board predicate).
- 🔴 **Never hardcode 2.** A split has 2..20 invoices; an invoice pair is a group of any size ("k of n" is
  derived from the group). Live data being all-2 is a coincidence.
- **No transaction anywhere** — the write orders in §4 are the safety; keep them when editing a writer.
- **Edit in place** — never delete + re-create invoice rows (RESTRICT FKs, §4.2).
- **`orders."tripDropId"` is derived** — fine for "on any trip" and labels, wrong for "on THIS trip" (§3).
- **Counts stay per OBD; litres / kg are per invoice** (owner 2026-10-13). A trip's "N bills" and
  "+n re-del" count OBDs.
- **`heldAt` on a row is the wall clock**; `orders."heldAt"` is the arrival date. Never copy one into the
  other.
- **A held invoice can't join a trip; an invoice on a trip can't be held.** Both refused per invoice.
- **A whole-OBD CI on a split OBD has `orderInvoiceId` NULL and covers every row** — not "unlinked".
- **Add invoices is blocked for good by ANY CI on the OBD, void included** — voiding the CI does not
  unblock it.
- **Seq 1 is always `'sap'`** and only `sap-row.ts` fills its number / date; save never renumbers seq 1.
- **`order_invoice_lines` has no `"orderId"`** — its live triggers are join-based (v27.67).

## 9. Key files

**`lib/order-invoices/`** (17 files + 12 tests, run with `npx tsx --test lib/order-invoices/<name>.test.ts`):

| File | Role | Test |
|---|---|---|
| `sap-row.ts` | Seq-1 mirror writer (§4.1) | — |
| `rules.ts` | Split validation, whole-bill refusal, invoice-number shape | `rules.test.ts` |
| `entry.ts` | The dialog's arithmetic (browser-safe) | `entry.test.ts` |
| `plan.ts` | Save / undo diff + lock rule (pure) | `plan.test.ts` |
| `split.ts` | Save / undo writes (§4.2) | — |
| `trip-link.ts` | `setRowsTrip`, the only trip writer (§4.3) | `trip-link.test.ts` |
| `trip-bills.ts` | Which rows a trip press moves (pure) | `trip-bills.test.ts` |
| `trip-read.ts` | Trip readers + the derived stop rule | `trip-read.test.ts` |
| `trip-refusal.ts` | "On a trip" refusal text from the rows (browser-safe) | `trip-refusal.test.ts` |
| `invoice-load.ts` | One read of a split OBD's invoices, load and stops | — |
| `kg-per-unit.ts` | Learned SAP kg per tin | — |
| `hold.ts` | Hold per invoice + `mirrorObdHoldSafe` (§4.4) | `hold.test.ts` |
| `dispatch.ts` | Dispatched per invoice, done rule, `mirrorObdDispatchedSafe` (§4.5) | `dispatch.test.ts` |
| `ci-plan.ts` | CI per invoice rules (§4.6) | `ci-plan.test.ts` |
| `copy-plan.ts` | Copies per invoice (§4.7) | `copy-plan.test.ts` |
| `redelivery-plan.ts` | Re-deliveries per invoice (§4.8) | `redelivery-plan.test.ts` |
| `links.ts` | Which row a whole-OBD record points at (§4.9) | (in `trip-link.test.ts`) |

**Elsewhere:** `lib/floor/invoice-rows.ts` (drawing rows, kg rule, `placeLoad` / `invoicesLoad`; test) ·
`lib/floor/detail-scope.ts` (panel scoped to an invoice; test) · `lib/floor/raise-ci.ts` (`raiseInvoiceCi`)
· `lib/floor/dispatch.ts` (`markBillsDispatched`) · `lib/trips/redelivery.ts` · `lib/billing/print.ts`
(`copyTripBills`) · `lib/floor/queries.ts` (board arms, `floorHoldWhere`) · `lib/trips/live-trips.ts`
(`tripsOnDeskWhere`).

**Routes:** `app/api/floor/orders/[orderId]/invoices` (GET / POST save / DELETE undo) ·
`app/api/floor/trips/[id]/bills` · `…/cancel` · `…/dispatch` · `…/redeliveries` · `app/api/floor/actions`
(hold / unhold with `invoiceRowIds`) · `app/api/floor/ci` · `app/api/billing/print/trip/[id]/copy`.

**UI:** `components/floor/add-invoices-dialog.tsx`, `components/floor/detail-invoices.tsx` — owned by
`CLAUDE_FLOOR.md`.

## 10. SQL files run (all by the owner in the Supabase SQL Editor)

| File | Schema | Run |
|---|---|---|
| `sql/2026-10-10-order-invoices-ddl.sql` | v27.63 — the two tables, seq-1 back-fill | 2026-10-10, PARTS 1–4 |
| `sql/2026-10-10-order-invoices-live.sql` | v27.65 — `order_invoices` live triggers | 2026-10-10 |
| `docs/prompts/drafts/code-update-2026-10-10-floor-add-invoices-grant.sql` | data — the `floor_add_invoices` grants | Live (3 holders read 2026-10-24); the draft's header still says "NOT RUN" |
| `sql/2026-10-12-order-invoices-dispatch-unit.sql` | v27.66 — row state columns, per-row keys, trip live triggers, back-fill | PARTS 1, 2, 5, 3, 4, 6a, 8 on 2026-10-12 · 6b between 12 and 23 Oct · **7 + 6c on 2026-10-23 = v27.74** (per-OBD uniques dropped, `orderInvoiceId` NOT NULL, re-delivery 86). Nothing pending — do not re-run 6c |
| `sql/2026-10-13-order-invoice-lines-live.sql` | v27.67 — `order_invoice_lines` live triggers | 2026-10-13 |
| `sql/2026-10-15-v27.69-orders-partly-on-trip.sql` | v27.69 — `orders."partlyOnTrip"` + partial index | 2026-10-15, PARTS 1–4 (PART 3 = the re-runnable repair) |
| `sql/2026-10-17-part7-gate-checks.sql` | read-only gate | 2026-10-23: k 1–6 all 0 · copies 857 · re-deliveries 73 — CLOSED |
| `sql/2026-10-19-v27.72-status-log-invoice-ids.sql` | v27.72 — `order_status_logs."orderInvoiceIds"` | 2026-10-19, PARTS 1–3 |
| `sql/2026-10-19-part3b-hold-mirror-rerun.sql` | data repair, no version | 2026-10-19, 1 → 1b → 2 → 3 → 4 (§6) |

Earlier, same tables: `sql/2026-10-07-print-copy-invoices.sql` (v27.61, Copy inv kind on
`trip_bill_copies` — `CLAUDE_BILLING.md`). Full chain text: CORE §7, entries v27.63 – v27.74.

## 11. Open items

Tracked in `docs/ROADMAP.md` (Add invoices section, from canon batch B8): auto-CI per invoice · loading
screen dispatch · Floor board speed on busy afternoons · whether Floor History should go per invoice ·
invoice-pair leftovers (tint warning, partner line in the panel — not built) · the
`code-update-2026-10-10-floor-add-invoices-grant.sql` header still saying NOT RUN.

## Change log

- **v1.0 — 2026-10-24.** New owner file (canon batch B1, plan
  `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md`). Written from the code at
  `a05769b7` and the live read-only check of 2026-10-24; covers commits `6ac1d51e` → `a05769b7` (Add
  invoices phases 1–6, P5-1 – P5-5) and schema v27.63 – v27.74.

---

*CLAUDE_ORDER_INVOICES.md v1.0 · Schema v27.74 · OrbitOMS · updated 2026-10-24 — new owner file for Add
invoices: Model A, derived OBD rules, single writers + mirrors, hand-SQL rules, the Add invoices lock rules.
Written from the code at `a05769b7` and the live read-only check of 2026-10-24.*
