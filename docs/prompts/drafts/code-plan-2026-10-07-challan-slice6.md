# code-plan-2026-10-07 — Challan Orders slice 6: the import catch + late-paste safety net

> **Revision 1 (7 Oct, same day).** Adds: **F** — admin-only cancel of a linked OBD from the Challan orders screen, and the
> rule for a linked OBD whose ORB order is cancelled after linking (§11); the owner's pre-slice-6 test data, read live
> (§0); a full, exact safe-test method covering every path (§9, replaces the first draft's sketch). §1–§8, B and E are
> unchanged.

**Status:** PLAN ONLY. No code, no DDL. Read-only SELECTs against production, 2026-10-07.
Builds on slices 1–5 (`e9143c1f` … `fe33eeab`, all pushed). Design: web-update-2026-10-06-challan-orders.md D4, D9,
D10, D11, F1b, F5, M6, S5-2, S5-3.

**What was read.** In full this session or earlier ones: `app/api/import/obd/route.ts` — the helpers + both release
functions (`applyMailOrderEnrichment` :246–607, `applyNoMailOrderFallback` :667–780, `createChallanForOrder`,
`rebuildQuerySummaryForOrder`), all FOUR create paths (`handleConfirm` :1332, `handleManualSapConfirm` :1926,
`handleSapPasteConfirm` :2478 (its loop + effect + release lines), `processAutoImportRows` :3379), the POST router
(:4712) and `handleAutoImportPatchHeaders` (:4301); `lib/import-upsert/effects.ts` (whole) and the `upsertObd`
create/patch lines that touch stage / SO; `lib/billing/telephonic-apply.ts` (planner + apply); the design draft, the
slice-1 plan, slice-2/3/5 updates and slice-5 plan, discovery 2. **NOT read end to end:** `CLAUDE.md`,
`CLAUDE_CORE.md`, `CLAUDE_IMPORT.md`, `CLAUDE_MAIL_ORDERS.md`, `CLAUDE_BILLING.md`, `CLAUDE_PICKING.md`,
`CLAUDE_FLOOR.md`, `CLAUDE_FLOOR_TRIPS.md`, `CLAUDE_TINT.md` (sections only, cited where used), discovery report 1,
the import route's preview handlers and shadow runners, `lib/ci/bill-only.ts`. Line numbers as of `fe33eeab`.

**Live (read-only, 2026-10-07):** 0 SOs carry both a live Telephonic tag and a live challan link · links: 1
`unlinked` · import batches, 90 days: auto-import **2,678**, manual-sap **240**, sap-paste **162**, manual template
**0**, challan-order 2 · every OBD of the last 90 days has a raw-summary `billToCustomerId` (10,288 / 10,288);
bill-to = ship-to code on 8,775 of 10,290 · **221** SOs had more than one live OBD in 90 days · 0 orders with an
OBD starting `9999`.

---

## 0. The owner's test of 7 Oct (before slice 6) — live state, read-only, nothing changed

| Item | Live state |
|---|---|
| ORB-2026-00001 / -00002 (Mohan Colour Co) / **-00003 (Shree Colour House)** | all `cancelled`, not removed, on no trip |
| Link 1 — SO `7567796327` → ORB-00002 | `unlinked` 07:18:14 by user 1 (the auto-unlink on cancel — the ✕ unlink + re-paste is still unproven, see slice 5) |
| Link 2 — SO **`7567796325`** → ORB-00003 | `unlinked` 09:01:10.14 by user 1 — 0.2 s before ORB-00003's cancel log (09:01:10.33): the S5-3 auto-unlink. 0 live links remain |
| Dummy OBD **`7567796327`** (id 18985), SO `7567796325` | `cancelled`, `dispatchStatus` null, `challanOrderId` null, no trip, no pick assignment (cleared), no CHN, no CI. Came in through **manual-SAP xlsx** (`BATCH-20261007-024`, "challan test.XLSX"), released by the no-mail fallback 08:57, picked + checked, cancelled "Other · test" |
| `so_tags` / `mo_orders` on `756779632x` | 0 / 0 — neither number is a real SO in Orbit |
| Orders with OBD or SO starting `9999` | 0 — the §9 fake range is clean |

**Leftovers:** none that need action — every row is in a terminal state (cancelled / unlinked). Rows are never deleted,
so ORB-00001…00003, link rows 1–2 and OBD 7567796327 stay as history. ⚠ **Observation, not a challan issue:** the dummy
OBD's picking logs (assign 09:03:47, done 09:03:54, check 09:04:04) carry timestamps AFTER its cancel (09:01:11) although
the cancel's `fromStage` is `pick_checked` — the picking test-mode logs are stamped later than they happened.
(`order_status_logs.createdAt` is `timestamp without time zone`.) Worth a look in Picking, separately.

---

## 1. A — the import catch: one function, four call sites

**Owner:** new `lib/challan-orders/import-catch.ts` → `catchChallanObds(obdNumbers: string[], actorId: number)`
returning `{ caught: Set<string>, skippedSos: Set<string>, failedObds: Set<string> }`. It runs the shared
**`reconcileSo`** (§6) for every distinct SO among those OBDs that has a live link (`status IN ('waiting','linked')`).

**Insertion points — after the order rows exist, BEFORE the first release:**

| Source (live caller) | Handler | Insert after | Release that follows (must not see a caught OBD) |
|---|---|---|---|
| JSON Auto-Import (depot PC, `?action=auto-json`, 2,678 batches/90 d) and v1 `?action=auto` | `processAutoImportRows` | `CONFIRM D1` `orders.createMany` (:3974) | D1b `applyMailOrderEnrichment` (R1) → D1c `applySoTagHolds` → `applyNoMailOrderFallback` (R2) → D2b CHN |
| Manual template (`?action=confirm`, import modal) | `handleConfirm` | `STEP D1` `orders.createMany` (:1513) | D1b R1 → D1c tags → R2 → D2b CHN |
| SAP xlsx (`?action=manual-sap-confirm`) | `handleManualSapConfirm` | the per-OBD `upsertObd` loop (:2050–2070) | the effect loop — `mail-order-enrichment` (R1) and `challan-create` (:2093) → tags → R2 (:2141–2142) |
| Clipboard paste (`?action=sap-paste-confirm`) | `handleSapPasteConfirm` | its `upsertObd` loop | same effect loop → tags → R2 (:+179/+182/+210/+211 in the handler) |

Proof by caller, not handler: every R1 call is `applyMailOrderEnrichment(...)` inside these four handlers (template
:1528, auto :3987, effect loops :2099 and paste's); every R2 call likewise (:1542, :2142, :3997, paste's). Nothing
else in `app/` or `lib/` calls either (they are file-private). `patch-headers` (:4301) writes no stage, status or SO,
and its engine call declines on a non-`dispatch` status — it needs no catch.

**The caller then removes the catch's results from every release list:** the SO list it hands R1, the OBD list for
`applySoTagHolds` + R2, and the CHN list (template / auto D2b filter; SAP / paste: `createChallanForOrder` also
re-reads the stage and skips `challan_linked` — D4, belt and braces for the effect loop).

**Also caught: an EXISTING OBD that gets its SO late.** `upsertObd`'s patch path fills a null `soNumber`
(`lib/import-upsert/header.ts:76`) and then emits `mail-order-enrichment`. On the SAP / paste paths the catch runs over
patched OBDs too, through the same `reconcileSo` — which applies the touched / not-touched rule (§6) because such an OBD
may already be on the floor.

## 2. The writes for a caught OBD, and failure

Per OBD, sequential awaits, never `$transaction`:

1. **`orders.updateMany`** — compare-and-swap `WHERE id = ? AND workflowStage = <the stage just read> AND isRemoved =
   false AND tripDropId IS NULL` → `{ workflowStage: 'challan_linked', challanOrderId: <ORB id>, dispatchStatus: null }`.
   ONE write (markers key on `updatedAt`). `count 0` → someone moved it; re-read and fall to §6's table.
2. **`order_status_logs.create`** — `fromStage → 'challan_linked'`, `changedById` = importer (1 = system on
   Auto-Import), note `"Linked to challan ORB-… (SO …) — not released"`.
3. **Link flip, FIRST OBD only** — `challan_order_so_links.updateMany WHERE id = ? AND status = 'waiting'` →
   `{ status: 'linked', linkedOrderId, obdLinkedAt: now }`. A later OBD on a `linked` SO skips this (M6 part-billing).

**Order is deliberate:** the OBD is made unreleasable FIRST; the link last. Failure states:
- **1 fails** → the OBD stays `pending_support` / null status and is added to `failedObds`; the caller drops its OBD
  and its SO from R1 / tags / R2 / CHN, so this import does NOT release it. It sits on Floor's undecided arm (arm 2) —
  the residual risk: a person could release it by hand. The Challan screen shows it under the D11 banner ("OBD … not yet
  pulled back — Retry") and **Retry** (canEdit) runs `reconcileSo` again. Logged loudly.
- **2 fails** → the OBD is already `challan_linked` (safe); the log is missing; logged, not rolled back.
- **3 fails** → OBD safe; the link still says `waiting` → the next `reconcileSo` for that SO (any import, paste or Retry)
  sees the `challan_linked` OBD with this `challanOrderId` and flips the link. Idempotent.

## 3. Telephonic conflict

**The challan wins.** The catch runs before `applySoTagHolds`; a caught OBD is `challan_linked`, and the planner skips
that stage first (`lib/billing/telephonic-apply.ts` `planSoTagApplications`, slice 2 — no claim, no hold, no CI). The
tag stays `waiting` until it expires and would apply to a later non-challan OBD on that SO — but a later OBD on a linked
SO is also caught (M6), so in practice it expires. **Live today: 0 SOs carry both.** No owner decision needed unless you
want the paste to warn when a live Telephonic tag exists on the SO (Q3).

## 4. Part-billing (M6, F5)

- **A second OBD on the same SO** — the link is already `linked`, so `reconcileSo` treats `linked` like `waiting` for the
  stage write (step 1, 2) and skips step 3. The OBD gets `challanOrderId` = the ORB; Billing's Billed tab lists every OBD
  of the ORB via `orders.challanOrderId` (slice 7's line match sums them). Live: 221 SOs had > 1 OBD in 90 days, so this
  is a normal case, not an edge.
- **A second SO on the same ORB** — its own link row, caught independently. The ORB stays in **Waiting for OBD** while
  any of its links is `waiting` (slice 5's filter), moves to **Billed** when all are `linked`.

## 5. C — the dealer check at import (authoritative, S5-2)

Compare `import_raw_summary.billToCustomerId` of the OBD (present on 100% of 90-day OBDs) with the ORB order's bill-to
`customer.customerCode`. Match → catch as §2.

On a **mismatch** — options:
| | What happens | Double-dispatch risk | Other risk |
|---|---|---|---|
| a. Link anyway + ⚠ for billing | caught (hidden), link `linked`, a "dealer differs" ⚠ on the Challan screen | none | if it really is ANOTHER dealer's bill, that dealer's goods never ship until someone notices the ⚠ |
| **b. Hold, do not link + red alert (recommended)** | OBD gets `dispatchStatus 'hold'` + a hold log (note "Held on import — challan dealer mismatch"); link stays `waiting`; red alert on the Challan screen naming both dealers; billing then Unlinks (→ Floor releases the hold) or confirms (a **Link anyway** that runs the catch with the check skipped) | none — nothing ships until a person decides | one manual decision per mismatch (expected rare; the mail-order-based paste warning already flags most) |
| c. Release normally | ignored | **HIGH** — if it was the challan's bill, the goods ship twice | — |

Recommendation **b**: it is the only option where a wrong guess costs a phone call instead of a truck. Needs one new
hold note constant in `lib/floor/hold-log.ts` (`HOLD_LOG_NOTES`) so Floor's Hold tab shows "Held from: Billing ·
challan". Owner decides (Q1).

## 6. D — the late-paste safety net (`reconcileSo`)

One function, three callers: the import catch (§1), **paste SO** (replaces slice 5's flat refusal) and a **Retry**
button on the Challan screen's banner. For each live (non-removed, non-cancelled, non-challan) OBD on the SO:

| OBD state (from code) | Action | Why |
|---|---|---|
| `pending_support` (status null or `hold`) | **pull back** | nobody has touched it; a hold is cleared to null by the pull-back |
| `pending_tint_assignment`, no tint job | **pull back** | waiting for an operator; nothing mixed |
| `pending_picking`, no `pick_assignments` row, `tripDropId` null | **pull back** | on the Assign list, no picker yet |
| `tint_assigned`, `tinting_in_progress` | **refuse + warn** | an operator holds it (`offFloorRefusal`'s tint-room rule) |
| `pick_assigned` | **refuse + warn** | a picker has it (owner question in discovery 2 Q6 — refuse, no push) |
| `pick_done`, `pick_checked` | **refuse + warn** | goods off the shelf |
| any stage with `tripDropId` set | **refuse + warn** | on a truck plan (`offFloorRefusal`) |
| `handAt` set | **refuse + warn** | the dealer is collecting it |
| a live CI (`findLiveCi`) | **refuse + warn** | its return is with billing |
| `dispatched` | **refuse + warn** | already left — the double dispatch has happened |
| `challan_linked` to THIS ORB | no-op (flip a stale `waiting` link — §2 recovery) | idempotent |
| `cancelled` / `isRemoved` | ignored | ships nothing |

**Pull-back writes** = §2 steps 1–3 exactly (the CAS `WHERE workflowStage = <read stage> AND tripDropId IS NULL` closes
the race with an assign). No push (no picker held it).

**Refuse + warn:** no stage write. **Recommended:** the paste STILL inserts the link as `waiting` (so the fact is stored
and visible) and returns the red message; the warning is then **computed live** wherever needed — "a live link whose SO
has a touched, non-challan OBD" — on the Challan screen (all tabs, the mockup banner, with **Got it** hidden: it clears
only when resolved) and on **Floor** (a red strip above the board for the OBD, and a ⚠ on that bill's row). It clears
when the OBD is cancelled / CI'd off the floor, or billing Unlinks the SO. No DDL. Alternative: keep slice 5's refusal
(nothing stored) — then Floor can never show it. Q2.

## 7. The slice-5 refusal

**Replaced** by `reconcileSo`: untouched → pull back (link `linked`), touched → insert `waiting` + warning (Q2's
recommendation). The "cancelled OBD ignored" rule from slice 5 stays. `pasteSo`'s other checks (shape, ORB, F5, the
mail-order dealer warning) are unchanged.

## 8. Re-import of an OBD already caught

Idempotent. Auto-Import and the template skip an existing `obdNumber` before writing anything (`existingObdSet`).
SAP xlsx / paste take the patch path: `upsertObd` never writes `workflowStage` on a patch (`header.ts:6`, locked), the
effects can re-fire `mail-order-enrichment` only if the SO changed — and R1 is locked (§B below); `reconcileSo` sees
`challan_linked` to this ORB → no-op. No second log, no second link flip.

## B — enrichment lock (moved from slice 2)

Add `NOT_CHALLAN_LINKED` (`lib/workflow-stages.ts`) to every by-SO read / write in `applyMailOrderEnrichment`, re-located
by symbol: the `priorStatus` read, the main `updateMany`, the ship-to-carry `updateMany`, the bill-only `toHold` read,
the engine's `ordersForEngine` read, the `ordersToHold` read, and the auto-done `ordersToAdvance` read (already pinned to
`pending_support`, added for clarity). With §1's list filtering this is belt and braces — but it also covers a LATER
import of a different OBD on the same SO calling R1 for that SO.

## E — one owner for the slot rule

`lib/dispatch/legacy-slot.ts` → `resolveLegacySlot(istHhMm | null)` (the Morning / Afternoon / Evening / Night cut-offs
and the Night fallback, `route.ts:153`). The import's `resolveSlot` becomes a call to it; `lib/challan-orders/create.ts`
drops its `legacySlot` copy and imports it. Behaviour byte-identical.

## 9. SAFE TEST METHOD (rev 1 — exact)

**Why it cannot touch a real bill:** every number is fake and out of range. Live: 0 orders have an OBD or SO starting
`9999`; real OBDs are `910…` and real SOs `104…` / `451…` (the SO rule's own census). Auto-Import only ever creates
OBDs it got from SAP, so it can never re-offer a fake number. Fake OBDs `99999990NN`, fake SOs `99990000NN`.

**Path: Template 2 — Combined File** (`/admin/import` → Import → "Template 2 — Combined File (Two Sheets)" → Preview →
Confirm; needs `import_obd` canImport). Same create code as Template 1 and the same release order as Auto-Import (§1).
(Manual-SAP xlsx — the path the owner's own test used — goes through `upsertObd`; run test T1 once on it too, by editing
the OBD / SO / bill-to cells of the owner's "challan test.XLSX".)

**The file — one `.xlsx`, two sheets, exact names, row 1 = these headers:**

Sheet `LogisticsTrackerWareHouse` (one row per OBD):

| OBD Number | Status | SMU | MaterialType | OBD Email Date | OBD Email Time | UnitQty | GrossWeight | Volume | Bill To Customer Id | Bill To Customer Name | ShipToCustomerId | Ship To Customer Name | SONum |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9999999001 | Open | Deco Retail | FERT | today's date | 10:15 | 4 | 4 | 4 | *the test ORB's dealer code* | *its name* | *same code* | *same name* | 9999000001 |

Sheet `LineItems` (one row per line):

| obd_number | line_id | sku_codes | sku_description | unit_qty | volume_line | Tinting |
|---|---|---|---|---|---|---|
| 9999999001 | 10 | IN28140071 | (any) | 4 | 4 | FALSE |

(`IN28140071` is the SKU the owner's own dummy used. `SMU` and `MaterialType` are not GIFTS / not required; leave
`InvoiceNo` out — a challan's SAP bill arrives un-invoiced.)

**Before each test:** create ONE fresh test ORB order (admin, `/place-order` challan mode, a test dealer) and note its
number. Read-only pre-check: `SELECT count(*)::text FROM orders WHERE "obdNumber" LIKE '9999%' OR "soNumber" LIKE '9999%';`

| # | Test | Steps (owner clicks) | Must show |
|---|---|---|---|
| T0 | **✕ unlink + re-paste (left over from slice 5)** | Challan orders → Not billed → paste `9999000001` → Link → Waiting → **✕** → (back in Not billed) → paste `9999000001` again | History shows the first link **struck through / unlinked**, a second link **waiting**. SELECT: 2 link rows for the SO, one `unlinked` (by you), one `waiting` |
| T1 | **Main catch** | SO `9999000001` is waiting on ORB-A → import the file above (OBD `9999999001`) | Import says 1 created. The OBD is on **no** board — not Picking, not Floor (any tab), not Hold, not Tint. Challan orders → ORB-A moves to **Billed**, OBD `9999999001` ✓. SELECT: OBD `challan_linked`, `challanOrderId` = ORB-A id, `dispatchStatus` null, 0 CHN, one log "Linked to challan …"; link `linked`, `linkedOrderId` = the OBD |
| T2 | **Part-billing — 2nd OBD, same SO** | Import a second file: OBD `9999999002`, same SO `9999000001` | Also hidden; also `challan_linked` → ORB-A; the link is unchanged (still points at `9999999001`); ORB-A's Billed row lists both OBDs |
| T3 | **Part-billing — 2nd SO, same ORB** | ORB-B: paste `9999000002` and `9999000003`. Import OBD `9999999003` with SO `9999000002` only | ORB-B stays in **Waiting for OBD** ("part-billed — 1 of 2"); then import `9999999004` with SO `9999000003` → ORB-B moves to Billed |
| T4 | **An SO with no link flows normally** | Import OBD `9999999005`, SO `9999000005` (no paste anywhere) | It appears on Floor / Picking as an ordinary bill (`pending_picking`, `dispatch`). Clean-up: Floor-cancel it |
| T5 | **Late paste, NOT touched → pull-back** | Import OBD `9999999006`, SO `9999000006` (no link) → it reaches Picking's Assign list → on ORB-C paste `9999000006` | Paste succeeds; the OBD **vanishes** from Picking/Floor; ORB-C → Billed. SELECT: OBD `challan_linked`, log "pulled back …" |
| T6 | **Late paste, TOUCHED → refuse + warn** | Import OBD `9999999007`, SO `9999000007` → **assign it to a picker** → on ORB-D paste `9999000007` | Red **"DOUBLE DISPATCH RISK — OBD 9999999007 is with a picker"** on the paste; the red banner on the Challan screen and a red strip on Floor stay until the OBD is cancelled (or the SO unlinked). Clean-up: Floor-cancel the OBD → both warnings clear |
| T7 | **Dealer mismatch at import** | ORB-E: paste `9999000008`. Import OBD `9999999008`, SO `9999000008`, with a DIFFERENT `Bill To Customer Id` | Per Q1 — recommended: the OBD is **held** (Floor → Hold tab, "Held from: Billing · challan"), NOT linked; red alert on the Challan screen naming both dealers |
| T8 | **Re-import** | Import the T1 file again | "1 skipped (duplicate)"; nothing changes |
| T9 | **Clean-up (F, §11)** | As admin: Challan orders → each linked test OBD → **Cancel OBD**; then cancel each test ORB order | Every `9999…` OBD `cancelled`; every test link `unlinked`; nothing on any board. A non-admin sees no Cancel OBD button and the route refuses them |

**Verify after each test (read-only):**
```sql
SELECT 'obd'::text AS a, o."obdNumber"::text AS b, o."workflowStage"::text AS c, coalesce(o."dispatchStatus",'(null)')::text AS d,
       coalesce(o."challanOrderId"::text,'(null)') AS e, coalesce(o."soNumber",'(null)')::text AS f
  FROM orders o WHERE o."obdNumber" LIKE '9999999%'
UNION ALL
SELECT 'link', l.id::text, l."soNumber", l.status, coalesce(l."linkedOrderId"::text,'(null)'), coalesce(l."unlinkedAt"::text,'')
  FROM challan_order_so_links l WHERE l."soNumber" LIKE '99990000%'
UNION ALL
SELECT 'chn', c."challanNumber"::text, o."obdNumber", c."isVoided"::text, '', ''
  FROM delivery_challans c JOIN orders o ON o.id = c."orderId" WHERE o."obdNumber" LIKE '9999999%'
UNION ALL
SELECT 'log', o."obdNumber", g."toStage"::text, coalesce(g."fromStage",'(null)')::text, g.note::text, g."createdAt"::text
  FROM order_status_logs g JOIN orders o ON o.id = g."orderId" WHERE o."obdNumber" LIKE '9999999%'
ORDER BY 1, 2;
```
Expect 0 `chn` rows, ever.

## 10. Risks + owner questions

**Risks**
1. A catch failure at step 1 leaves the OBD on Floor's undecided arm, releasable by hand, until **Retry** (§2).
2. The paste-time rule depends on "touched" being read correctly; the CAS write closes the race with an assign.
3. 221 SOs / 90 days have several OBDs — part-billing is common; the Billed tab must list OBDs by `challanOrderId`, not
   by the one `linkedOrderId` (slice 5's loader reads `linkedOrder` — slice 6 widens it).
4. The manual template has had 0 batches in 90 days — the test path is real but little used (T1 is repeated on manual-SAP).
5. Picking test-mode log timestamps run late (§0) — not a challan risk, but it makes log-based checks on test bills
   misleading.

**Owner questions**
1. **Dealer mismatch at import:** (b) hold + red alert, billing decides (recommended) — or (a) link anyway with ⚠?
2. **Late paste on a TOUCHED OBD:** store the link as `waiting` and show a persistent red warning on the Challan screen and
   Floor until resolved (recommended) — or keep refusing the paste (nothing stored, no Floor warning)?
3. **Cancelling a linked OBD (F):** the challan becomes unbilled again — put its link back to **waiting**, so the next OBD
   SAP issues on that SO is caught (recommended) — or **unlink** it, so a re-issued OBD on the same SO flows to picking?
4. **An ORB order cancelled AFTER an OBD was linked to it:** return each linked OBD to the floor (`pending_support`,
   status null — a person releases it) and unlink (recommended, §11) — or refuse the ORB cancel while it has linked OBDs?
5. Paste when the SO carries a live **Telephonic** tag (0 today): warn, or ignore (the challan wins at import anyway)?

## 11. F — cancelling a linked OBD (admin only) + an ORB cancelled after linking

**Where:** the Challan orders screen — the Billed tab and the History row of an ORB order list its linked OBDs
(`orders WHERE challanOrderId = <ORB>`); each gets a **Cancel OBD** action, rendered only for admin (the screen gets an
`isAdmin` flag from each mount's server side, `lib/rbac.ts isSuperuser`). A linked OBD is on no other screen, so this is
the only door.

**Route:** `POST /api/challan-orders/linked-obds/[orderId]/cancel` (`force-dynamic`). Body `{ reason, remark }` (the
desk cancel reasons, `lib/floor/desk-cancel-reasons.ts`). Checks: session; `challan_orders` canView; then the ONE guard
`lib/challan-orders/cancel-guard.ts` — extended with `linkedObdCancelRefusal(actorIsAdmin)` → "Only admin can cancel a
challan-linked bill." (same text family, same owner); the order exists, not removed, `workflowStage = 'challan_linked'`
(anything else → 409 "This bill is not linked to a challan").

**Writes** (sequential, no `$transaction`):
1. `orders.updateMany` CAS `WHERE id AND workflowStage = 'challan_linked'` → `{ workflowStage: 'cancelled',
   dispatchStatus: null }`. **`challanOrderId` is KEPT** — the history of which challan it belonged to.
2. `order_status_logs` — `challan_linked → cancelled`, admin's id, the desk cancel note.
3. The link row: if this OBD is the link's `linkedOrderId` AND no other live `challan_linked` OBD carries this
   `challanOrderId` + SO → per Q3, recommended: the link goes back to **`waiting`** (`linkedOrderId` / `obdLinkedAt`
   null — the `chk_challan_order_so_links_shape` waiting shape) via a CAS updateMany; otherwise it stays `linked` and
   re-points `linkedOrderId` to the oldest remaining linked OBD.
**Line match (slice 7):** counts only OBDs at `challan_linked` — a cancelled OBD drops out of the sum automatically.

**An ORB order cancelled AFTER linking** (recommended rule for real life, Q4). An ORB order can only be cancelled before
it is on a trip or dispatched (`offFloorRefusal`, admin-only since S5-4) — so its goods have NOT left. Its linked SAP
OBD(s) are therefore the real bill for goods that must now ship as a normal order. The ORB cancel (every path in the
slice-5 guard table) also: for each `orders WHERE challanOrderId = <ORB> AND workflowStage = 'challan_linked'` →
CAS update to **`pending_support`, `dispatchStatus` null** (Floor's undecided arm — a person releases it with a slot;
nothing auto-releases a bill on cancel), one log "Challan ORB-… cancelled — bill returned to the floor"; and every link
→ `unlinked` (extends S5-3's `unlinkWaitingOnCancel` to `linked` rows too). `challanOrderId` is kept as history.
**Test-data clean-up (T9)** = cancel the linked test OBDs first (F), then the test ORB orders.
