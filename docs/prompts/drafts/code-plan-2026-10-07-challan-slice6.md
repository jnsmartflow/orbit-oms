# code-plan-2026-10-07 — Challan Orders slice 6: the import catch + late-paste safety net

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

## 9. Safe hand test (one fresh ORB order + a fake OBD)

The **manual template** path (`/admin/import` → Template 1, `?action=preview` → `?action=confirm`) creates exactly the
OBDs in the file; Auto-Import never re-offers a number it did not get from SAP. A fake OBD **`9999000001`** (live: 0
orders start `9999`; real OBDs are `910…`) cannot collide with a real bill.
1. Create test ORB order (admin) → paste a fake SO `9999100001` (Waiting).
2. Template header file: one row — OBD `9999000001`, `SONum 9999100001`, `Bill To Customer Id` = the ORB's dealer code,
   `ShipToCustomerId` = same, `OBD Email Date/Time` = now; line file: one line, a real SKU, 1 unit.
   Import → **expect:** the OBD appears NOWHERE (not Picking, not Floor, not Hold); Challan screen → Billed, OBD
   `9999000001` ✓; the verify SELECT shows `challan_linked`, `challanOrderId` = ORB id, `dispatchStatus` null, no CHN.
3. Mismatch test: second ORB + SO `9999100002`, OBD `9999000002` with a DIFFERENT `Bill To Customer Id` → per Q1.
4. Late paste: import OBD `9999000003` with SO `9999100003` and NO link → it releases to Picking (briefly visible on
   Assign); paste `9999100003` on a third ORB → pulled back, gone from Picking. (Assign it first instead → refused +
   red warning on the Challan screen and Floor.)
5. Clean-up: cancel the ORB orders as admin; the fake OBDs stay as `challan_linked` / cancelled rows (never deleted),
   invisible everywhere.

## 10. Risks + owner questions

**Risks**
1. A catch failure at step 1 leaves the OBD on Floor's undecided arm, releasable by hand, until **Retry** (§2).
2. The paste-time rule depends on "touched" being read correctly; the CAS write closes the race with an assign.
3. 221 SOs / 90 days have several OBDs — part-billing is common; the Billed tab must list OBDs by `challanOrderId`, not
   by the one `linkedOrderId` (slice 5's loader reads `linkedOrder` — slice 6 widens it).
4. The manual template has had 0 batches in 90 days — the test path is real but little used.

**Owner questions**
1. **Dealer mismatch at import:** (b) hold + red alert, billing decides (recommended) — or (a) link anyway with ⚠?
2. **Late paste on a TOUCHED OBD:** store the link as `waiting` and show a persistent red warning on the Challan screen and
   Floor until resolved (recommended) — or keep refusing the paste (nothing stored, no Floor warning)?
3. Paste when the SO carries a live **Telephonic** tag (0 today): warn, or ignore (the challan wins at import anyway)?
