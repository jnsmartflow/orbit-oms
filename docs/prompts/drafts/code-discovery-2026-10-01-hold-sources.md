# Code discovery — HOLD SOURCES + one shared held-bills table (Floor On hold ⇄ Freight pool)
# 2026-10-01 · DISCOVERY ONLY · no code, no SQL run, nothing staged · HEAD `301eb265`

Files read: CLAUDE.md, docs/CLAUDE_CORE.md (v120 · Schema v27.49), docs/CLAUDE_FLOOR.md (v1.8 · Schema
v27.24), docs/CLAUDE_IMPORT.md (v1.11 · Schema v27.24), docs/CLAUDE_MAIL_ORDERS.md (v1.14 · Schema v27.24),
docs/CLAUDE_BILLING.md (v1.0 · Schema v27.24), docs/prompts/drafts/code-discovery-2026-10-01-freight-trips.md §A.

⚠ **HEAD moved during this session** (`ed95227d` → `301eb265`, another session's "tint manager tabs
6-9" + reports commits). Line numbers below are at `301eb265`. Notably `getFloorHold` gained a 4th
parameter `extraWhere` (`lib/floor/queries.ts:1222-1229`) and the Tint Manager now consumes it — see §5/§6.
The freight-trips draft's line numbers for `getFloorHold` are therefore ~+6 stale; its conclusions hold.

The person column on every hold log is **`order_status_logs.changedById` — `Int`, NOT NULL, FK → users**
(`prisma/schema.prisma` model `order_status_logs`: `changedById Int`, `changedBy users @relation(...)`).
It can never be null. "No person" is written as **`changedById: 1`**, the code's "system" convention
(e.g. `app/api/import/obd/route.ts:548`, `:564` `// System action`) — and user 1 is also the real
superuser/admin account (CORE §5/§7.15: "u1, who also still holds the admin role"). **So `1` is ambiguous:
it means "system" on some paths and "the owner pressed it" on others.** That drives Q2.

---

## 1. EVERY HOLD WRITER

Sweep: `dispatchStatus\s*[:=]\s*"hold"` + `SET "dispatchStatus" = 'hold'` + every `dispatchStatus:` write
with a non-literal value, over `app/ lib/ scripts/ sql/ db/ components/`, read at each call site.
`scripts/` holds only reads (`COUNT … FILTER (WHERE "dispatchStatus"='hold')`); `sql/` and `db/` hold no
`SET "dispatchStatus"`; the Support writers are archived (`archive/2026-07-support/`, not compiled).
Writers that set `'hold'` on `orders` at HEAD — **five live paths**:

| # | Writer (file:line) | Owner label | Log row? · note | Person (`changedById`) | `heldAt` |
|---|---|---|---|---|---|
| W1 | `lib/floor/bill-actions.ts:178` `applyBillAction("hold")`, surface `floor` — called by `app/api/floor/actions/route.ts:129` | **Floor** | yes, `:371-373` · `"Held from floor"` (`FLOOR_HOLD_NOTE`, `lib/floor/hold-log.ts:25`) | session user (`actions/route.ts:59-61`, `:133`) — filled | `obdEmailDate ?? now` |
| W2 | same function, surface `tint` — called by `app/api/tint/manager/actions/route.ts:100` | **Tint Manager** | yes · `"Held from Tint Manager"` (`TINT_HOLD_NOTE`, `hold-log.ts:88`), chosen at `bill-actions.ts:183` | session user (`tint/manager/actions/route.ts:55-57`) — filled | `obdEmailDate ?? now` |
| W3 | `app/api/billing/mail-order/actions/route.ts:323` (action `hold`, on, per EXISTING bill of the SO) | **Billing** | yes, `:403-411` · `"Held from billing"` (`BILLING_HOLD_NOTE`, `hold-log.ts:75`) | `userId` (session) — filled | `bill.obdEmailDate ?? now` |
| W4 | `lib/billing/telephonic-apply.ts:236-239` `writeHold`, called at `:388` (hold tag), `:410` (CI tag, CI skipped/failed), `:457` (CI tag, cancel failed) | **Billing · telephonic** (`:388`) — but `:410`/`:457` are **CI-tag** fallbacks (see §3) | yes, `:242-250` · `"Held on import (Telephonic tag)"` (`TELEPHONIC_HOLD_NOTE`, `hold-log.ts:61`) **on all three call sites** | `so_tags.addedById` (`tag.addedById`) — filled, the billing user who added the tag | `obdEmailDate ?? now` |
| W5 | `app/api/import/obd/route.ts:410-425` — enrichment safety-net hold for a CI-marked SO (`billOnly`) | **Billing · CI** | yes, `:415-424` · `"Held on import (CI marked in billing)"` (`BILLING_CI_HOLD_NOTE`, `hold-log.ts:70`) | `mo_orders.billOnlyById ?? 1` (`:421`) — the billing user who pressed CI; **1 when that stamp is gone** | `obdEmailDate ?? now` |
| **W6** | **`app/api/import/obd/route.ts:283-287` + `:369-372`** — enrichment: `updateData.dispatchStatus = mailOrder.dispatchStatus.toLowerCase()` written by `orders.updateMany({ where: { soNumber, isRemoved:false, workflowStage:{not:"cancelled"} } })`; heldAt per bill at `:510-521` | **Auto (mail order)** — see §2 for why the label is not always true | **NO log row** | **none** | `obdEmailDate ?? now` (`:519`, a SECOND `orders.update` per bill after the `updateMany`) |

W6 is not in the four the brief started from as a separate writer — the brief's `:413` is W5 (the CI
safety net), not the mail-order hold. The mail-order hold is the generic `updateMany` at `:369`.

Not hold writers (checked): `app/api/operations/summary/route.ts:30` and `app/api/tint/manager/marker/route.ts:147`
are `where` clauses; `app/api/import/obd/route.ts:4430` passes `existing.dispatchStatus` into the slot
engine (read); `lib/floor/queries.ts:1209`, `lib/hide/visibility.ts:48` are predicates;
`app/api/billing/mail-order/actions/route.ts:221` writes `"Hold"` to **`mo_orders`**, not `orders`
(it reaches `orders` only through W3 now, or W6 at a later import).

---

## 2. MAIL-ORDER AUTO HOLD — the path, and the gap

Path:
1. **Parser** emits `Dispatch: {Dispatch|Hold}` from the email (MAIL_ORDERS §2 format, `docs/CLAUDE_MAIL_ORDERS.md:183`);
   ingest stores it: `dispatchStatus: dispatchStatus || "Dispatch"` (`app/api/mail-orders/ingest/route.ts:87`, `:340`).
   **OR a billing user presses ⚑ Hold on the mail order** — `mo_orders.dispatchStatus = "Hold"`
   (`app/api/billing/mail-order/actions/route.ts:221`, write `:268`). If no OBD exists yet, W3's per-bill
   loop finds nothing and **no log is written anywhere** (`:282-296` only runs over existing bills).
   `mo_orders` has **no `heldAt`/`heldById` column** (model `mo_orders`: only `punchedBy`, `billOnlyBy`,
   `handBy` carry a person) and the route writes no audit for the mo-level write.
2. **Import** → `applyMailOrderEnrichment(soNumbers)` (call sites `route.ts:1494`, `:2065`, `:2622`, `:3953`):
   newest mail order per SO (`:259-262`), `updateData.dispatchStatus = "hold"` (`:283-285`),
   `orders.updateMany` on **every non-removed, non-cancelled bill of that SO** (`:369-372`), then
   `heldAt` per bill (`:510-521`).
3. **No `order_status_logs` row** on this path (the only log writes in the function are the CI safety net
   `:415` and "Auto-dispatched by enrichment" `:559-567`, which is the `dispatch` branch).

Confirmed:
- `HOLD_LOG_NOTES` (`lib/floor/hold-log.ts:97-104`) = Floor, 2× Support, Telephonic, Billing-CI, Billing,
  Tint Manager. **No mail-order entry** — there is no note to match.
- So a mail-order-held bill reaches `getFloorHold`'s ladder with no hold log → `heldSinceSource = "approx"`
  (heldAt is always set by `:519`) — `lib/floor/queries.ts:1279-1280` (`logAt ? "log" : heldAt ? "approx" : "unknown"`).
  `"unknown"` happens only if `heldAt` is null, which W6 never leaves.

⚠ **"Auto (mail order)" is NOT always auto.** From the OBD side, a parser hold and a billing user's
pre-import ⚑ Hold are the same bytes (`mo_orders.dispatchStatus = 'Hold'`, no person, no time). Today
they cannot be told apart. The owner's label would call a billing user's hold "Auto". (Fix: §7 F2.)

⚠ **W6 also UN-holds and RE-holds without a log** (answers part of §4). The `updateMany` at `:369` writes
the mail order's status (default `"Dispatch"`, schema `mo_orders.dispatchStatus @default("Dispatch")`) onto
**every** sibling bill of the SO, whatever its current status — guarded only by `isRemoved` / `cancelled`
(`:364-372`). Enrichment runs whenever a batch carries any OBD of that SO, or an OBD's SO turns non-null
(`lib/import-upsert/effects.ts:36`, `:54`). So, by reading (frequency not measured):
- a bill **Floor/Billing/Tint held** gets `dispatchStatus = "dispatch"` when a later sibling OBD lands on a
  `Dispatch` mail order — **hold cleared, no log**;
- a bill **Floor released** gets re-held when a later sibling lands on a `Hold` mail order — **hold set, no
  log**, and its latest hold log is the OLD hold → wrong held-from and wrong held-since (§4).
Compare the telephonic hook, which deliberately refuses exactly this ("A re-import must never re-hold a
bill Floor has deliberately released", `telephonic-apply.ts:56-58`), and the CI safety net, which holds
`dispatchStatus: null` bills only (`route.ts:395-406`).

---

## 3. TELEPHONIC and CI — where the billing user lives, and the join

**Telephonic (`so_tags`)**: `so_tags.addedById` → users (`@relation("SoTagAddedBy")`, NOT NULL), plus
`tag` (`'hold'|'ci'`), `fromMailOrder` (bool), `addedAt`. A held bill joins back by
**`so_tag_matches.orderId` → `so_tag_matches.soTagId` → `so_tags`** (`@@unique([soTagId, orderId])`,
`@@index([orderId])`; the CLAIM row is written before the hold, `telephonic-apply.ts:31-36`). Reliable:
keyed on `orders.id`, never on the SO text.
**And the same person IS on the log row:** `writeHold(order, tag.addedById, now)` → `changedById: byId`
(`:233-250`). So for W4 the log row alone gives the person; the tag join is needed only to tell a
**`hold` tag** (→ "Billing · telephonic") from a **`ci` tag that fell back to a hold** (`:410`, `:457`,
same note) — and `fromMailOrder = true` means billing pressed CI on a MAIL order (`lib/billing/mo-ci-tag.ts`,
per the file header `:10-12`). Proposed label: hold tag → "Billing · telephonic"; ci tag → "Billing · CI".

**CI marked on a mail order (W5)**: the person is `mo_orders.billOnlyById` (`@relation("MoOrderBillOnlyBy")`,
nullable, SetNull) with `billOnlyAt`. W5 copies it onto the log's `changedById` (`route.ts:421`), falling
back to **1** when null. Join back: `orders.soNumber` → `mo_orders.soNumber WHERE billOnlyAt IS NOT NULL`
(the same lookup W5 does, `:275-278`) — SO-text keyed, so prefer the log row's `changedById`.

---

## 4. HOLD → CLEAR → HOLD AGAIN

- **The rule picks the latest hold.** `getFloorHold` reads all logs with `note IN HOLD_LOG_NOTES`,
  `orderBy: { createdAt: "desc" }`, keeps the first per order (`lib/floor/queries.ts:1246-1257`).
  Clear notes are **excluded by construction**: `FLOOR_CLEAR_HOLD_NOTE` (`hold-log.ts:34`),
  `BILLING_CLEAR_HOLD_NOTE` (`:82`), `TINT_CLEAR_HOLD_NOTE` (`:95`) are not in the list, with comments
  saying they must never be (`:92-93`, `bill-actions.ts:350-352`). Release logs carry their own notes
  (`lib/floor/release.ts:203`, `:225` = `FLOOR_CLEAR_HOLD_NOTE`, `:259`). So held → released (any logged
  path) → held (any logged path) gives the second hold. ✔
- ⚠ Tie: two hold logs in the same instant are ordered by `createdAt` only (no `id` tiebreak). Cosmetic.
- **Writers that clear a hold WITHOUT a log:**
  1. **W6, the enrichment `updateMany`** (`route.ts:369-372`) — §2. The only one found.
  - Every other path that moves `dispatchStatus` off `'hold'` logs: Floor/Tint unhold (`bill-actions.ts:347-353`
    → log `:371`), Billing clear (`actions/route.ts:335` → `:403`), Floor release (`release.ts:192/217/246` →
    `:197/:219/:253`), cancels (`bill-actions.ts:241`, `lib/floor/raise-ci.ts:269`, `app/api/picking/cancel/route.ts:200`,
    `lib/billing/pick-delete.ts:733`, `telephonic-apply.ts:424` — each with its own log), restore
    (`bill-actions.ts:315/319`). Tint completion never clears a hold — it branches on `isHeld`
    (`app/api/tint/operator/done/route.ts:209-226`, `app/api/tint/manager/base-bypass/route.ts:220-235`).
- Consequence: a bill re-held by W6 after an earlier logged hold shows the **earlier** hold's source,
  person and time. Detectable only partly on the read side (a logged release/clear AFTER the latest hold log
  proves that log is stale — SELECT row S7 measures it).

---

## 5. THE FLOOR "ON HOLD" TABLE TODAY

- Component: **`components/floor/hold-tab.tsx`** (`HoldTab`, `:146-293`; inner `HoldRows`, `:48-144`),
  mounted from `floor-page.tsx` with `rows={filteredHold}` (`:3167`).
- Columns, exactly five (`:45-46`, `:72-86`): ☐ · **OBD** (+ `obdDateTime` as dd Mon HH:mm, `:105-108`) ·
  **Ship to** (name + ★ key / ⚡ urgent / site icon / TINT·BASE / HAND / "billed to …" / "→ ship-to changed",
  `:109-129`) · **Route** (`:130`) · **Held since** (age label, `~` when approx, `:131-137`).
  Rows are banded by hold age (`groupByHoldBand`, `:183`), Recent/Oldest toggle (`:220-227`).
- Row type `FloorHoldRow` (`lib/floor/types.ts:467-485` + `FloorPartyFields` `:54-80`). Wanted vs present:

| Wanted | In the row today? |
|---|---|
| OBD no + date | yes — `obdNumber`, `obdDateTime` (= `obdEmailDate ?? orderDateTime`) |
| Invoice no | yes — `invoiceNo`, but marked **search-only, not rendered** (`types.ts:478-480`) |
| Invoice date | **missing** |
| Customer | yes — `dealerName` (+ `billToName`) |
| Route | yes — `route` (and `area`) |
| Delivery type | yes — `deliveryType` (not rendered) |
| Litres | yes — `volumeLitres` (not rendered) |
| Kg | **missing** — `totalWeight` not selected (`queries.ts:1235`); `hold-bar.tsx:22` says so ("NO LITRES OR KG") |
| Article | yes — `articleTag` (not rendered; the bar counts it) |
| Gift flag (for L/kg totals) | **missing** — `materialType` not mapped |
| Held since | yes — `heldSince` + `heldSinceSource` |
| **Held from** | **missing** |
| **Held by** | **missing** |

- **Actions that must keep working** (all live in `HoldTab`, not in `HoldRows`):
  per-band + per-row tick (`:73-80`, `:96-103`) → **HoldBar** (`components/floor/hold-bar.tsx`) with
  **Release** (slot popup → `onRelease` → `POST /api/floor/release`, `:197-206`, `:282`) and **··· More →
  Cancel / Raise CI** (`onOpenOffFloor`, `:286`); row click → detail panel (`onOpenDetail`, `:95`);
  **Export PDF** (`PdfPreview rows={list}`, `:228-236`, `:290`; doc built by `buildHoldPdf`,
  `lib/floor/hold-pdf.ts:53`, columns OBD · Ship to · Route · Order date · Held since,
  `pdf-preview.tsx:81-85`); tab badge from `lib/floor/counts.ts:53` (`floorHoldWhere` + hide only).
- **Other consumers of the same loader/row** (a shared change must not break them):
  `app/api/tint/manager/hold/route.ts:34` (`getFloorHold("All", undefined, undefined, { orderType: "tint" })`,
  row `TintHoldRow extends FloorHoldRow`, `components/tint/manager/types.ts:390`, rendered by its OWN
  `components/tint/manager/board-hold-tab.tsx`), the live feed's row reload (`lib/floor/rows.ts:70`),
  `lib/floor/live-merge.ts:81` (+ its test `live-merge.test.ts:38`), search (`lib/floor/search.ts`),
  sort (`compareHoldRows`, `lib/floor/sort.ts`), and `floor-page.tsx:318` (`holdRowToOffFloorBill`).

---

## 6. SHARED TABLE PROPOSAL (one loader, one table)

**Precedent already in the tree:** the Tint Manager's Hold tab reuses Floor's loader through
`extraWhere` (`queries.ts:1222-1229`, `tint/manager/hold/route.ts:34`). Freight should do the same — no
second loader.

**Loader — stays `getFloorHold` in `lib/floor/queries.ts` (Floor-owned).** Additive changes only:
- select `querySnapshot.totalWeight`, `materialType`, `invoiceDate`;
- the hold-log read (`:1246-1252`) adds `note`, `changedById` and `changedBy: { select: { name } }` —
  same single query, same "latest wins" loop;
- two batched reads, only for the rows that need them (sequential awaits): `so_tag_matches` + `so_tags`
  for rows whose latest note is `TELEPHONIC_HOLD_NOTE` (to split hold-tag vs ci-tag); newest `mo_orders`
  per `soNumber` for rows with **no** hold log (to say "Auto (mail order)" vs "Unknown").
- New row fields on `FloorHoldRow`: `invoiceDate`, `weightKg`, `isGift`, `heldFrom: HoldSourceLabel`,
  `heldById: number | null`, `heldByName: string | null`. `heldSince`/`heldSinceSource` unchanged.
- The note → label map lives beside the notes in **`lib/floor/hold-log.ts`** (`HOLD_SOURCE_BY_NOTE`, pure),
  so writer constants and labels cannot drift. `changedById = 1` on the CI safety-net path is reported as
  "no person" (Q2 decides the general rule).
- Freight calls `getFloorHold("All", hide, undefined, { freightTripBills: { none: { removedAt: null } } })`.

**Table — `components/floor/hold-table.tsx` (new, Floor-owned), extracted from `HoldRows`.**
- Props: `rows`, `now`, `selection?: FloorSelection`, `onToggleRow?`, `onToggleAll?`, `onOpenRow?`,
  `columns?: HoldColumn[]` (default = the full new set), `selectable?: boolean` (default true).
  Freight passes its own selection + toggles and no `onOpenRow`; nothing Floor-only is inside the table —
  Release, ··· More, Export PDF, bands and the toolbar stay in `HoldTab`, so they simply are not rendered
  on the freight screen. Freight can band or not (`groupByHoldBand` is exported from `hold-log.ts`).
- `HoldTab` renders `<HoldTable>` per band in place of `<HoldRows>`; its props, `HoldBar`, `PdfPreview`
  and `onOpenOffFloor` do not change.
- Widths: 5 → 13 columns. Re-plan against the fixed table standard (CLAUDE_UI §27) — the current
  `WIDTHS = [4, 20, 39, 22, 15]` (`hold-tab.tsx:45-46`) goes.

**What changes for existing callers, and what stays byte-identical:**
| Caller | Effect |
|---|---|
| `app/api/floor/hold/route.ts`, `lib/floor/rows.ts` | same call; rows gain fields (payload grows) |
| `app/api/tint/manager/hold/route.ts` | same call; `TintHoldRow` inherits the new fields — additive, its tab ignores them |
| `lib/floor/counts.ts` | **unchanged** — counts `floorHoldWhere()` + hide, never the row |
| `buildHoldPdf` / `PdfPreview` | **unchanged** — read only `obdNumber, dealerName, route, obdDateTime, heldSince` |
| `live-merge`, search, `compareHoldRows` | unchanged (fields added, none removed); the test's cast row still compiles |
| `floor-page.tsx` | none, unless Hold-tab search should learn "held from" (optional) |
Cost: +1 batched `so_tag_matches/so_tags` read and +1 `mo_orders` read per hold load, each skipped when
its id list is empty. No write anywhere.

---

## 7. FIXES FOR MISSING LOGS (proposal only)

**F1 — W6 enrichment hold writes a log.** In `applyMailOrderEnrichment`, read each SO bill's prior
`dispatchStatus` before the `updateMany`; in the existing per-bill loop (`route.ts:516-521`) write one
`order_status_logs` row for each bill that went non-hold → hold, note `MAIL_ORDER_HOLD_NOTE = "Held on
import (mail order)"` (new constant in `hold-log.ts`, added to `HOLD_LOG_NOTES`), `changedById` per F2 or 1.
Back-fill: old bills cannot get a real event time; the read side can still label them "Auto (mail order)"
from the `mo_orders` join (§6) — no back-fill needed, held-since stays `~approx`.
*Blast radius:* import path only; +1 log row per newly held bill; no new `orders` write, so no marker
change; Floor/Tint "held since" becomes exact for new mail-order holds.

**F2 — record WHO held a mail order.** ALTER `mo_orders` ADD `heldAt timestamptz(6)`, `heldById int FK users
ON DELETE SET NULL` (named relation `MoOrderHeldBy`); the billing actions route sets/clears them with
`dispatchStatus` (`actions/route.ts:221`); F1 then labels a bill **"Billing"** with that person when
`heldById` is set, and **"Auto (mail order)"** only when it is null (= the parser). Back-fill: impossible
— no record of past mo-level presses exists; old ones stay "Auto (mail order)".
*Blast radius:* one ALTER + two files (billing actions, enrichment); Smart Flow SQL; no screen changes.

**F3 — stop W6 overwriting siblings' status (fill-only).** Add `dispatchStatus: null` to the enrichment
`updateMany` where-clause for the status field (split status out of `updateData` into its own fill-only
`updateMany`), the same rule the CI safety net (`:405`) and the telephonic hook (`:56-58`) already follow.
This removes the no-log clear and the no-log re-hold (§2, §4). *Blast radius:* **behaviour change on
import** — a later sibling OBD would no longer re-apply a changed mail-order Hold/Dispatch to bills that
already have a status; needs an owner decision (Q1).

**F4 — W4 CI-tag fallback holds.** No write change needed; the read side splits them via the tag join (§3).
Optional: a distinct note for `:410`/`:457` ("Held on import (CI tag — not raised)") so the log alone tells.
*Blast radius:* one constant + three call sites in one file; existing rows keep the telephonic note.

**F5 — the `changedById: 1` ambiguity** (W5 fallback, plus "Auto-dispatched …" logs). Q2.

---

## Live SELECT block (read-only, Supabase SQL Editor)

Same held-set predicate as freight-trips §K (`floorHoldWhere` + `getHideExclusion`). The latest hold log is
the newest row whose note is in `HOLD_LOG_NOTES` (the seven strings). The mail order is the **newest
`mo_orders` row for the SO**, which is what enrichment reads (`route.ts:259-262`).

```sql
-- READ-ONLY · hold-sources discovery · 2026-10-01 · SELECT only, no BEGIN/COMMIT, no writes.
WITH held AS (
  SELECT o.id, o."soNumber", o."heldAt"
    FROM orders o
   WHERE o."dispatchStatus" = 'hold'
     AND o."isRemoved" = false
     AND o."isHidden" = false
     AND NOT EXISTS (SELECT 1 FROM obd_visibility_rules r
                      WHERE r."isActive" AND r."conditionType" = 'tag' AND r."conditionTag" = 'HOLD')
     AND NOT EXISTS (SELECT 1 FROM obd_visibility_rules r
                      WHERE r."isActive" AND r."conditionType" = 'daysOld' AND r."conditionDaysGt" IS NOT NULL
                        AND o."orderDateTime" IS NOT NULL
                        AND o."orderDateTime" < now() - make_interval(days => r."conditionDaysGt"))
),
hl AS (   -- latest hold log per held bill
  SELECT DISTINCT ON (l."orderId") l."orderId", l.note, l."changedById", l."createdAt"
    FROM order_status_logs l
    JOIN held h ON h.id = l."orderId"
   WHERE l.note IN ('Held from floor', 'Placed on hold by support', 'Placed on hold by support (bulk)',
                    'Held on import (Telephonic tag)', 'Held on import (CI marked in billing)',
                    'Held from billing', 'Held from Tint Manager')
   ORDER BY l."orderId", l."createdAt" DESC, l.id DESC
),
mo AS (   -- newest mail order per SO (enrichment's own pick)
  SELECT DISTINCT ON (m."soNumber") m."soNumber", m."dispatchStatus"
    FROM mo_orders m
   WHERE m."soNumber" IN (SELECT "soNumber" FROM held WHERE "soNumber" IS NOT NULL)
   ORDER BY m."soNumber", m."createdAt" DESC, m.id DESC
),
src AS (
  SELECT h.id, hl.note, hl."changedById", hl."createdAt" AS "holdLogAt",
         (lower(COALESCE(mo."dispatchStatus", '')) = 'hold') AS "moHold",
         CASE hl.note
           WHEN 'Held from floor'                       THEN 'Floor'
           WHEN 'Held from Tint Manager'                THEN 'Tint Manager'
           WHEN 'Held from billing'                     THEN 'Billing'
           WHEN 'Held on import (CI marked in billing)' THEN 'Billing · CI'
           WHEN 'Held on import (Telephonic tag)'       THEN 'Billing · telephonic (note)'
           WHEN 'Placed on hold by support'             THEN 'Support'
           WHEN 'Placed on hold by support (bulk)'      THEN 'Support'
           ELSE CASE WHEN lower(COALESCE(mo."dispatchStatus", '')) = 'hold'
                     THEN 'NO LOG · mail order is Hold' ELSE 'NO LOG · unknown' END
         END AS source
    FROM held h
    LEFT JOIN hl ON hl."orderId" = h.id
    LEFT JOIN mo ON mo."soNumber" = h."soNumber"
),
grid AS (
  -- S1: count per held-from source (latest hold log note), incl. the two no-log buckets
  SELECT '10' AS sort, 'S1 source · ' || source AS label,
         count(*)::text AS v1,
         ('changedById=1: ' || count(*) FILTER (WHERE "changedById" = 1))::text AS v2,
         ('changedById other: ' || count(*) FILTER (WHERE "changedById" IS NOT NULL AND "changedById" <> 1))::text AS v3,
         ('no log row: ' || count(*) FILTER (WHERE note IS NULL))::text AS v4
    FROM src GROUP BY source
  UNION ALL
  SELECT '11', 'S1 total held', count(*)::text,
         ('with a hold log: ' || count(*) FILTER (WHERE note IS NOT NULL))::text,
         ('NO hold log: ' || count(*) FILTER (WHERE note IS NULL))::text, NULL::text
    FROM src
  UNION ALL
  -- S2: who is user 1 (the "system" id that is also a real account)
  SELECT '20', 'S2 users.id = 1', u.name::text, u.email::text,
         ('isSuperuser=' || u."isSuperuser"::text)::text, ('isActive=' || u."isActive"::text)::text
    FROM users u WHERE u.id = 1
  UNION ALL
  -- S3: held bills whose newest mail order says Hold, and how many have no hold log
  SELECT '30', 'S3 newest mail order = Hold',
         count(*) FILTER (WHERE "moHold")::text,
         ('of which NO hold log: ' || count(*) FILTER (WHERE "moHold" AND note IS NULL))::text,
         ('of which a logged source: ' || count(*) FILTER (WHERE "moHold" AND note IS NOT NULL))::text,
         ('held, mail order NOT Hold, no log: ' || count(*) FILTER (WHERE NOT "moHold" AND note IS NULL))::text
    FROM src
  UNION ALL
  -- S4: telephonic-note holds split by the tag that caused them (hold vs ci, mail-order CI)
  SELECT '40', 'S4 telephonic note · tag=' || COALESCE(t.tag, '(no match row)') ||
               ' · fromMailOrder=' || COALESCE(t."fromMailOrder"::text, '—'),
         count(DISTINCT s.id)::text,
         ('tag adder = log person: ' || count(DISTINCT s.id) FILTER (WHERE t."addedById" = s."changedById"))::text,
         NULL::text, NULL::text
    FROM src s
    LEFT JOIN so_tag_matches stm ON stm."orderId" = s.id
    LEFT JOIN so_tags t ON t.id = stm."soTagId"
   WHERE s.note = 'Held on import (Telephonic tag)'
   GROUP BY t.tag, t."fromMailOrder"
  UNION ALL
  -- S5: CI safety-net holds whose person fell back to 1
  SELECT '50', 'S5 Billing·CI holds with changedById=1 (billOnlyById was null)',
         count(*)::text, NULL::text, NULL::text, NULL::text
    FROM src WHERE note = 'Held on import (CI marked in billing)' AND "changedById" = 1
  UNION ALL
  -- S7: stale-log signal — a logged release/clear AFTER the latest hold log, yet the bill is held again
  SELECT '70', 'S7 held, but a release/clear log is newer than the latest hold log',
         count(*)::text, NULL::text, NULL::text, NULL::text
    FROM src s
   WHERE s.note IS NOT NULL
     AND EXISTS (SELECT 1 FROM order_status_logs l2
                  WHERE l2."orderId" = s.id AND l2."createdAt" > s."holdLogAt"
                    AND (l2.note IN ('Hold cleared on floor', 'Hold cleared from billing', 'Hold cleared from Tint Manager')
                         OR l2.note LIKE 'Released to floor%'
                         OR l2.note LIKE 'Auto-dispatched%'))
  UNION ALL
  -- S8: the 10 most common log notes on currently-held bills (catch unknown note texts)
  SELECT '80', 'S8 note #' || lpad(x.rn::text, 2, '0') || ' · ' || COALESCE(x.note, '(null)'),
         x.n::text, ('bills: ' || x.bills)::text, NULL::text, NULL::text
    FROM (SELECT l.note, count(*) AS n, count(DISTINCT l."orderId") AS bills,
                 row_number() OVER (ORDER BY count(*) DESC) AS rn
            FROM order_status_logs l JOIN held h ON h.id = l."orderId"
           GROUP BY l.note
           ORDER BY count(*) DESC
           LIMIT 10) x
)
SELECT label, v1, v2, v3, v4 FROM grid ORDER BY sort, label;
```

Reading it: S1's two `NO LOG` rows are today's "Auto (mail order)" and "Unknown"; S1 v2 shows how much
"person" is really user 1; S4 shows how many "telephonic" holds were actually CI tags; S7 sizes the
stale-log problem W6 causes; S8 shows any note string the label map does not know.

---

## Docs vs code (code wins)

| Canon | Code |
|---|---|
| BILLING §5: hold writes "`orders.updateMany WHERE soNumber`"; "`heldAt` is not written (`actions/route.ts:249-250`)" | per-bill `orders.update` + one log each (`actions/route.ts:402-411`); `heldAt = obdEmailDate ?? now` (`:323`) |
| FLOOR §4.5: hold notes = Floor + two Support | seven notes (`hold-log.ts:97-104`) |
| freight-trips draft §A: `getFloorHold` has 3 params | 4 — `extraWhere` (`queries.ts:1222-1229`), used by the Tint Manager |

---

## Questions for Smart Flow (max 3)

1. **Fill-only enrichment (F3)?** Today a later sibling OBD on the same SO re-writes Hold/Dispatch from the
   mail order onto bills that already have a status — clearing or re-applying a hold with no log. Make the
   status carry fill-only (like the CI and telephonic paths), yes or no?
2. **`changedById = 1`.** It means "system" on import paths but is also the owner's own account. For
   "Held by", show user 1 as **"System"** on import-path notes (Billing · CI fallback, mail order) and as the
   person everywhere else — OK?
3. **"Auto (mail order)" vs a billing user's pre-import ⚑ Hold** cannot be told apart today. Approve F2
   (`mo_orders.heldAt/heldById`) so future ones read "Billing · {name}", accepting that existing ones stay
   "Auto (mail order)"?

*Discovery only. Nothing edited except this file; nothing staged or committed; no SQL run.*
