# code-discovery-2026-10-01 — Tint Manager tabs: BUILD PLAN

**Status:** PLAN ONLY. No code, no SQL run (one read-only SELECT batch, below), no commits.
Code read at `48a3f5f2` (main, 2026-10-01). Follows `code-discovery-2026-10-01-tint-manager-tabs.md`
(the diagnosis) and the 15 locked owner decisions in the brief.

**Files read:** CLAUDE.md (router v1.13), docs/CLAUDE_CORE.md (v119 · Schema v27.48), docs/CLAUDE_UI.md
(v5.35), docs/CLAUDE_TINT.md (v2.2 · v27.24), docs/CLAUDE_FLOOR.md (v1.8 · v27.24),
docs/CLAUDE_BILLING.md (v1.0 · v27.24), docs/CLAUDE_CI.md (v1.3 · v27.24), the 2026-10-01 diagnosis draft.
No domain file is ahead of CORE, so there is no stop condition.

🔴 **The locked mockup is not in the repo.** `docs/mockups/tint-manager-tabs/tint-manager-tabs-mockup.html`
does not exist. The only file under `docs/mockups/tint-manager/` is `tint-manager-FINAL_2.html`
(2026-09-05, the old rebuild). This plan is built from the 15 locked decisions, which are specific enough to
plan against. **Before step 5 starts, drop the v7 file at that path.** Every UI step names the mockup as its
reference (§I-1).

**Read-only SELECT batch, run 2026-10-01** against production (the batch was deleted afterwards):
- `orders.smu` ↔ `import_raw_summary.smuCode` on every live bill that is not cancelled, dispatched or closed:
  **always 1:1.** Deco Retail↔70 = 1,535 · Decorative Projects↔74 = 216 · Retail Offtake↔77 = 135 ·
  Distributor↔76 = 22 · Deco↔10 = 5 · null↔null = 23. So the pick-delete SMU predicate can read `orders.smu`
  directly. No join is needed (§E).
- `user_page_access` unique constraint: **`user_page_access_user_page_key` UNIQUE ("userId","pageKey")**.
  Columns: id, userId, pageKey, canView, canImport, canExport, canEdit, canDelete, createdAt, updatedAt.
- Chandresh Kolgha = **user 21**. Prakash = **user 32**. Both already hold rows for `tint_manager`, `floor`
  and `billing_pick_delete`.

---

## A. Reuse map

| Piece | Reuse | Why / gap |
|---|---|---|
| Tab bar (Tinting · TI · Hold · CI · Pick delete) | **NEW** `components/tint/manager/board-tabs.tsx` | Floor's tab strip is inline JSX in `floor-page.tsx`, not a component. Copy its classes and name the source in a comment, the way `board-bits.tsx` already does for the pill washes. |
| Rail ("Needs assignment") | **EDIT** `components/tint/manager/board-rail.tsx` (`BoardRail`) | Card redesign per decision 2. Click selects; ⋯ calls `onOpenPanel`. The "Tinter Issue pending" second list **moves out** to the TI tab. The rail stays on the left across all five tabs. |
| Rail data | `components/tint/manager/rows.ts` `buildRail` | Add: exclude `dispatchStatus === "hold"` (a held waiting bill lives on the Hold tab; Release returns it here, per decision 9). Ship-to = override first. All other card fields already exist: `billToName`, `smuCode`, `route`, `querySnapshot.totalVolume`, `articleTag`, `obdEmailDate/Time`, and `ageDays` (`board-bits.tsx:38`). |
| TI tab | `GET /api/tint/manager/base-pending` (existing) + `components/tint/manager/base-ti-panel.tsx` `BaseTiPanel` (existing) | **NEW** `board-ti-tab.tsx`: the base-pending list plus the line drill, moved from `board-rail.tsx:255-317` into the table pane. The panel is unchanged. |
| Tinting tab table | **EDIT** `components/tint/manager/board-table.tsx` (`BoardTable`) | Row click = select (decision 5). Drop the ☐ column. Add a ⋯ at the row end and a **Slot** column. |
| Slot cell / bar Slot | **REUSE** `components/floor/dispatch-slot-picker.tsx` `DispatchSlotPicker` (`DispatchWindow`, `DispatchSlotValue`), opened through Floor's `SlotPickerButton` pattern | `SlotPickerButton` is a **private** function in `detail-panel.tsx:41-82`. Extract it to **NEW** `components/floor/slot-picker-button.tsx` (step 7). Step 6 needs it first, so step 6 does the extraction (see §H). |
| Dispatch windows | **NEW** `lib/dispatch/windows.ts` `getActiveDispatchWindows()` | The same 4-line `dispatch_slot_master.findMany` now sits inline in `app/api/billing/dispatch-windows/route.ts:32-36`. Extract it, repoint Billing, and add a TM route. |
| Bottom bar | **NEW** `components/tint/manager/board-bottom-bar.tsx` | `FloorBottomBar` (`components/floor/floor-bottom-bar.tsx:36`) is trip-specific (New trip / Remove from trip / weight). Copy its shell geometry and summary line (`formatLitres`, `components/floor/status-pill.tsx:493`), but not the component. `board-assign-bar.tsx` is **retired, not deleted** (CORE §3). |
| Assign ▾ menu | `components/tint/manager/board-bits.tsx` `OperatorMenu` (with `extraAction` = "Base — No Tint") | Unchanged; the trigger moves from the card to the bar. The customer-missing interceptor (`handleAssign` / `handleBaseBypass`) must stay in front of it (TINT §1.5). |
| Re-assign | the existing `handleBulkReassign` (`tint-manager-content.tsx:762`) → `POST /api/tint/manager/assign`; splits use `/splits/reassign` | Unchanged server. The 400 for running or paused jobs is already the route's rule (TINT §1.6). |
| Send back | the existing `handleSendBack` → `cancel-assignment` / `splits/cancel` | Unchanged except the parent-stage guard (§D). |
| Cancel / Raise CI form | **REUSE** `components/floor/off-floor-dialog.tsx` `OffFloorDialog` | Its two endpoints are hardcoded (`:126` `/api/floor/ci`, `:154` `/api/floor/actions`). Add an optional `endpoints` prop that defaults to Floor's. TM passes its own routes. |
| Stop & cancel confirm | **NEW** `components/tint/manager/board-stop-cancel-dialog.tsx` | Two-step confirm (UI §13 pattern, as Remove OBD uses), with a mandatory reason. Nothing in the tree has this shape with a running job. |
| Change ship-to | **REUSE** `ShipToEditor` (private, `components/floor/detail-panel.tsx:851`) | Extract to **NEW** `components/floor/ship-to-editor.tsx` with a `searchUrl` prop (step 7). |
| Detail panel | **NOT** Floor's `DetailPanel` as a component (see the blockers below). **REUSE** its bodies: `DetailItems` / `DetailDetails` / `DetailActivity` (`components/floor/detail-*.tsx`, typed on `FloorDetail`), plus `SlotPickerButton` and `ShipToEditor` | **REWRITE** `components/tint/manager/board-detail-panel.tsx` into Floor's frame: 472px, Prev/Next, slot chip on the identity line, one brand button per state, ship-to, ⋯, and the three tabs. |
| Detail payload | **NEW** `lib/floor/order-detail.ts` `getOrderDetail(orderId)` | Extracted from `app/api/floor/order/[orderId]/route.ts`. Floor's route and a **NEW** `/api/tint/manager/order/[orderId]` both call it. |
| Hold tab rows | `lib/floor/queries.ts` `getFloorHold` (+ `floorHoldWhere`) | Add an optional `extraWhere` argument (`{ orderType: "tint" }`). Ship-to override, held-since and bill-to come free (`queries.ts:1212-1240`). |
| CI tab rows | `lib/floor/queries.ts` `getFloorCancelled` | Same `extraWhere`. Today-only, like Floor's Cancel & CI tab. Restore and CI number come from the existing row shape. |
| Hold tab UI | **NEW** `components/tint/manager/board-hold-tab.tsx` | Floor's `HoldTab` / `HoldBar` (`components/floor/hold-tab.tsx:146`, `hold-bar.tsx:32`) are wired to Release = `/api/floor/release` with a slot. That action **refuses every tint stage** (diagnosis §C), and TM Release means unhold. Reuse only the band helpers from `lib/floor/hold-log.ts` (`groupByHoldBand`, `heldSinceLabel`). |
| CI tab UI | **NEW** `components/tint/manager/board-ci-tab.tsx` | Floor's `cancelled-tab.tsx` calls Floor's restore. Copy its row layout. |
| Pick delete popup | **REUSE** `components/billing/billing-pick-delete-popup.tsx` `BillingPickDeletePopup` + `billing-pick-delete-queue.tsx` `PickDeleteQueue` | `PICK_DELETE_BASE` is hardcoded (`queue.tsx:56`). Add a `base` prop (default unchanged) to both. Outside its provider, `useBillingPickDeleteMarkerValue()` returns null (`billing-marker-provider.tsx:407`), so the popup falls back to its own marker fetch. `useBillingLiveApi()` must be confirmed null-safe outside Billing (step 8 check). |
| Pick delete history tab | **REUSE** `components/billing/billing-pick-delete-tab.tsx` `BillingPickDeleteTab` | Same `base` prop. It already renders the decided list with Undo. Check its columns against decision 13 (when, SO, site, decision, OBD removed, by); add a site column if it is missing. |
| Remove OBD | the existing `RemoveObdModal` + `/api/tint/manager/orders/[id]/remove` | Button gated on the `tint_cancel` tick instead of the job title (`canRemoveObd`, `tint-manager-content.tsx:95-100`). The route gains the tick check. |
| Hold-tab live refresh | `/api/tint/manager/marker` | §F. |

### Why Floor's `DetailPanel` cannot be reused as a component (decision 6)

1. It fetches `/api/floor/order/${orderId}` itself (`detail-panel.tsx:254`). That route is gated on
   **`floor` canView** (`route.ts:31`), so a TM user without `floor` gets a 403.
2. `DetailActions` (`:111-122`) is Floor's contract: picker Reassign/Unassign through `/api/picking/*`,
   and Release through `/api/floor/release`, which refuses tint stages. TM needs operator Assign,
   Base — No Tint, Re-assign, Send back, Remove OBD, unhold-as-Release and Stop & cancel instead.
3. `headerStatus` and every action gate key on `FloorDetailSource` (`floor | hold | cancelled | history`,
   `lib/floor/types.ts:422`). Adding a `tint` member would touch a default-closed union that FLOOR §4.7
   relies on.
4. TM's tabs are **per-user ticks** (`tint_panel_items/_details/_activity`, never mounted without the tick,
   TINT §1.2), with tint-only content: pause/skip history, `OrderAuditHistory`, split rows and the
   customer-missing interceptor.

The layout, bodies, slot chip and ship-to editor are reused. Only the shell is rebuilt.

---

## B. Page keys

Seven new `PageKey` members: `tint_hold`, `tint_hand`, `tint_slot`, `tint_ship_to`, `tint_cancel`, `tint_ci`,
`tint_pick_delete`.

**Meaning, following the `billing_*` pattern (BILLING §4/§5):**
- **Writes:** host `tint_manager` **canEdit** AND the action key **canEdit**. This mirrors
  `mail_orders` canEdit + `billing_*` canEdit. Set and clear share one key (hold/unhold = `tint_hold`,
  cancel/stop/restore = `tint_cancel`), so nobody can create a state they cannot undo.
- **Tab reads:** host `tint_manager` canView AND the key canView. The Hold tab uses `tint_hold`. The CI tab
  uses `tint_ci` OR `tint_cancel`. Pick delete uses `tint_pick_delete`. The TI tab and the Tinting tab need
  no new key.
- `tint_hand`, `tint_slot` and `tint_ship_to` are canEdit-only, so their View box on `/admin/access` is inert
  (the known `isActionAvailable` limit, `lib/permissions.ts:483`).
- **Never** read off `canSeeAllOperatorRows` (TINT §13.4). Nothing here touches the nine operator handlers.

**Every registration site:**

| # | File | What |
|---|---|---|
| 1 | `lib/permissions.ts` `PageKey` union (`:205-330`) | 7 members, after `tint_panel_activity`, with a comment block in the `billing_*` style: canEdit-only meaning, not in `PAGE_NAV_MAP`/`ICON_MAP`, grants are `user_page_access` data. |
| 2 | `lib/permissions.ts` `ALL_PAGE_KEYS` (`:378-399`) | Beside the `tint_panel_*` trio. |
| 3 | `lib/permissions.ts` `ACTION_PAGES.canEdit` (`:443-470`) | All 7, or `/admin/access` draws a dash (an ungrantable switch). |
| 4 | `lib/permissions.ts` `PAGE_LABEL_OVERRIDES` (`:525-570`) | `"Tint Manager · Hold"`, `· Hand`, `· Slot`, `· Ship-to`, `· Cancel`, `· CI`, `· Pick delete`. The prefix keeps them apart from the `Billing ·` rows. |
| 5 | `lib/permissions.ts` `ACCESS_SECTIONS` "Tinting" (`:607-613`) | After `tint_panel_activity`. `app/(admin)/admin/access/page.tsx:42-47` asserts every key is sectioned and shows a banner if not. **No edit to the access page itself.** |
| 6 | `lib/permissions.ts` header counts | "43 keys" → 50 in the comments at `:518` and `:589`. CORE §5 says 39 and is already stale; canon follow-up only. |
| 7 | `components/admin/permissions-manager.tsx` (`:64-93` array) | 7 rows, section "Tinting", path `/tint/manager`, with the existing ROLLBACK-editor caveat. |
| 8 | `app/(tint)/tint/manager/layout.tsx` | Read them off the existing `allPerms` (no new query). |
| 9 | `components/tint/manager/tint-manager-access-provider.tsx` | Widen the shape below. Default stays all-false. |
| — | `lib/access/role-baseline.ts` | **No edit.** It densifies over `ALL_PAGE_KEYS` automatically (`:68-90`). |
| — | `prisma/seed.ts` | **No edit**, following `billing_pick_delete` ("grants are user_page_access data, never seed"). The optional `role_permissions` fallback rows are in §G Part 2. |

**Provider shape** (the layout computes each value from `allPerms`; admin/superuser come out all-true inside
`getAllPermissionsForRoles`):

```ts
interface TintManagerAccess {
  // existing
  canPanelItems: boolean; canPanelDetails: boolean; canPanelActivity: boolean; canReports: boolean;
  // NEW — host
  canEdit: boolean;            // tint_manager.canEdit — Assign / Re-assign / Send back / Base bypass
  // NEW — actions (each = tint_manager.canEdit && <key>.canEdit)
  canHold: boolean;            // tint_hold   — Hold + Release (unhold)
  canHand: boolean;            // tint_hand
  canSlot: boolean;            // tint_slot   — bar Slot, table Slot cell, panel slot chip
  canShipTo: boolean;          // tint_ship_to
  canCancel: boolean;          // tint_cancel — Cancel, Stop & cancel, Restore, Remove OBD
  canCi: boolean;              // tint_ci
  canPickDelete: boolean;      // tint_pick_delete canEdit — popup + Undo
  // NEW — tabs (each = <key>.canView)
  canViewHoldTab: boolean;     // tint_hold.canView
  canViewCiTab: boolean;       // tint_ci.canView || tint_cancel.canView
  canViewPickDelete: boolean;  // tint_pick_delete.canView
}
```

The popup mounts only when `canViewPickDelete && canPickDelete`, the same rule as
`mail-orders-page.tsx:1663`. `/admin/tint-manager` renders without the provider, so it gets all-false, the
pre-existing behaviour (TINT §1).

---

## C. Server plan per action

**Shared tint guard — NEW `lib/tint/manager-bill.ts`:**
- `TINT_ACTION_KEY: Record<TintAction, PageKey>`, plus `checkTintAction(roles, action)`: `tint_manager`
  canEdit AND the key canEdit. The 403 names the action, as `billing/mail-order/actions/route.ts:129-134`
  does.
- `tintBillRefusal(order)`: `"Not a tint bill"` unless `order.orderType === "tint"` (and not removed). Every
  TM route calls it **before** the shared function. The per-action stage rules below are the shared
  function's own. The TM route never re-implements them.

**Floor logic is inline in its routes, so extract first (step 2/3). One owner per behaviour.**

| Extraction | From | To | Callers after |
|---|---|---|---|
| per-bill action branch (mark-urgent, change-slot, hold, unhold, hand, unhand, cancel, restore) + the one-update/one-log write block | `app/api/floor/actions/route.ts:129-341` | **`lib/floor/bill-actions.ts`** `applyBillAction(order, action, opts, changedById, surface: "floor" \| "tint") → { kind: "done" \| "failed" \| "skipped", error? }` + `BILL_ACTION_ORDER_SELECT` | Floor actions route (loop + body validation stay) · TM actions/cancel/restore routes |
| ship-to write | `app/api/floor/ship-to/route.ts:64-117` | **`lib/floor/ship-to.ts`** `setShipToOverride({ orderId, customerId, changedById })` + `searchShipTo(q)` (from `ship-to-search/route.ts`) | Floor ship-to + search routes · TM ship-to + search routes |
| full-bill CI + cancel, per bill | `app/api/floor/ci/route.ts:169-352` (+ the GET reason list `:85-89`) | **`lib/floor/raise-ci.ts`** `raiseFullBillCi({ orderId, reason, remark, userId, allowTintRoom })` + `listActiveCiReasons()` | Floor CI route · TM CI route |
| dispatch windows | `app/api/billing/dispatch-windows/route.ts:32-36` | **`lib/dispatch/windows.ts`** `getActiveDispatchWindows()` | Billing route · TM route |
| order detail payload | `app/api/floor/order/[orderId]/route.ts` (body) | **`lib/floor/order-detail.ts`** `getOrderDetail(orderId)` | Floor route · TM detail route |

`surface` only chooses the log notes. Floor keeps `FLOOR_HOLD_NOTE` / `FLOOR_CLEAR_HOLD_NOTE`. Tint gets the
**NEW** `TINT_HOLD_NOTE = "Held from Tint Manager"`, which **must be added to `HOLD_LOG_NOTES`**
(`lib/floor/hold-log.ts:85`) so Floor's "held since" reads it, and `TINT_CLEAR_HOLD_NOTE`, kept **out** of
that list (same rule as `:34`). Floor's response shape (`done` / `failed` / `skipped`, 422 when nothing
landed) is unchanged. Parity: `scripts/parity-floor-rows.ts` is not affected, because no read changes.

### Per route (every route: `export const dynamic = "force-dynamic"`, sequential awaits, no `$transaction`)

| Action | Route (all NEW unless noted) | Gate | Accepted (tint bills only) | Shared fn | Writes, in order |
|---|---|---|---|---|---|
| Hold | `POST /api/tint/manager/actions` `{action:"hold", orderIds}` | tint_manager canEdit + `tint_hold` canEdit | any stage except cancelled (Floor's rule, `actions/route.ts:170`) | `applyBillAction` | 1 `orders.update {dispatchStatus:"hold", heldAt: obdEmailDate ?? now}` → 1 log `TINT_HOLD_NOTE` |
| Release (= unhold, decision 9) | same, `action:"unhold"` | `tint_hold` canEdit | held; refused on a live CI (`:304-308`) | `applyBillAction` | 1 update `dispatchStatus` = `"dispatch"` for picking stages, else NULL (`:310`) → 1 log. Stage untouched: a waiting bill returns to the rail and a mid-tint bill keeps tinting; completion then dispatches normally (diagnosis §C). |
| Hand / unhand | same, `hand` \| `unhand` | `tint_hand` | `billingRefusal("hand")`: refused when removed, cancelled, dispatched or on a trip; the tint room is allowed | `applyBillAction` | 1 update `handAt/handById` → 1 log → `notifyHandSet` (after the loop, as at `:348`) |
| Slot | same, `change-slot` + `dispatchTargetDate`, `dispatchWindowId` | `tint_slot` | any non-removed | `applyBillAction` | 1 update `{dispatchTargetDate, dispatchWindowId, dispatchSlotSource:"manual"}` → 1 log. ⚠ Blocks base-bypass Undo (TINT §1.12, known). Completion keeps the slot (`hasPresetSlot`). |
| Windows | `GET /api/tint/manager/dispatch-windows` | tint_manager canView | — | `getActiveDispatchWindows` | read |
| Ship-to set/clear | `POST /api/tint/manager/ship-to` `{orderId, customerId \| null}` | `tint_ship_to` | any non-removed. ⚠ **No trip guard**, inherited from Floor (diagnosis §E). Recommend adding the Billing refusal (`lib/billing/refusal.ts:68`) **inside** `setShipToOverride` so all three desks refuse a bill on a trip. Owner call, §I-6. | `setShipToOverride` | no-op skip when unchanged → 1 update `{shipToOverrideCustomerId, shipToOverride}` → 1 log |
| Ship-to search | `GET /api/tint/manager/ship-to-search?q=` | `tint_ship_to` **canEdit**, never narrower than the write it feeds (TINT §13.2 lesson) | — | `searchShipTo` | read |
| Cancel (waiting bill) | `POST /api/tint/manager/cancel` `{orderIds, reasonKey, remark}` | `tint_cancel` | `pending_tint_assignment` (plus any non-tint-room stage `offFloorRefusal` accepts) | `stopTintWork` (splits only) → `applyBillAction("cancel")` | §D |
| Stop & cancel | same route, `{ stop: true, orderId, reason, remark }` (one bill) | `tint_cancel` | `tint_assigned`, `tinting_in_progress` (incl. paused) | `stopTintWork` → `applyBillAction("cancel", { allowTintRoom: true })` | §D |
| Restore | `POST /api/tint/manager/restore` `{orderIds}` | `tint_cancel` | `cancelled`, no live CI (`:269-280`) | `applyBillAction("restore")`, which is now tint-aware (§D) | 1 update → 1 log |
| Raise CI | `POST /api/tint/manager/ci` `{orderIds, reasonId, remark}` + `GET` reasons | `tint_ci` (GET: `tint_ci` canEdit, mirroring `floor/ci:82`) | pending: as Floor. Tint room: **stop first** (§D) | `stopTintWork` (when needed) → `raiseFullBillCi({ allowTintRoom })` | stop → CI create (number, P2002 retry once) → 1 update `cancelled` → `pick_assignments.deleteMany` → 1 log `CI raised — …` |
| Remove OBD | **EDIT** `app/api/tint/manager/orders/[id]/remove/route.ts` | add `tint_cancel` canEdit beside the existing `tint_manager` canEdit (`:38-42`) | `pending_tint_assignment` (unchanged) | — | unchanged |
| Detail | `GET /api/tint/manager/order/[orderId]` | tint_manager canView | tint bills | `getOrderDetail` | read |
| Hold list | `GET /api/tint/manager/hold` | tint_manager canView + `tint_hold` canView | `orderType:"tint"` | `getFloorHold("All", undefined, undefined, { orderType: "tint" })` | read |
| CI/cancelled list | `GET /api/tint/manager/cancelled` | tint_manager canView + (`tint_ci` \| `tint_cancel`) canView | `orderType:"tint"` | `getFloorCancelled(..., { orderType: "tint" })` | read |
| Assign / Re-assign / Send back | existing routes | tint_manager canEdit (decision 7) | unchanged | — | unchanged |
| Pick delete | §E | | | | |

---

## D. Stop & cancel and restore-to-rail

### NEW `lib/tint/stop-work.ts` — `stopTintWork({ orderId, managerId, note })`

One owner for "end every live tint job on this bill". Used by Stop & cancel, by the TM cancel of a
waiting bill (splits only), and by TM Raise CI mid-tint. Sequential awaits. Each step is idempotent, so a
retry heals a partial failure.

1. **End the live whole-OBD assignment.** Read `tint_assignments` where `orderId`, `splitId: null`,
   `status in TINT_ASSIGNMENT_ACTIVE_STATUSES`. For each row, write `tint_assignments.update`:
   `status: TINT_STATUS_CANCELLED`, and freeze the timer.
   - **Running:** `accumulatedMinutes += elapsed`, with `elapsed` from the **same arithmetic** as
     `operator/pause/route.ts:197-203`. Extract it to `lib/tint/elapsed-time.ts`
     `minutesSinceRunStart(asg, now)` and repoint pause to it, so there is one owner.
   - **Paused:** already frozen; status only. `currentProgress` is kept as the record of what was mixed.
   - Then 1 `tint_logs` row `action: "assignment_stopped"`.
2. **Cancel live splits.** Read `order_splits` where `orderId`, `status in ["tint_assigned","tinting_in_progress"]`.
   For each: `order_splits.update {status:"cancelled", sequenceOrder:0}` → `split_status_logs` → `tint_logs`
   `split_cancelled`. **Do not** delete `split_line_items` here, unlike `splits/cancel`: the bill is dying,
   so no qty needs freeing, and keeping the rows keeps the record. **Do not** touch the parent stage here.
3. Returns `{ assignmentsEnded, splitsCancelled }`.

Note: none of these writes touch `orders`. Step 3 of the caller is the bill's **one** `orders.update`. The
marker still moves on steps 1-2 through `MAX(tint_assignments/order_splits.updatedAt)` (`marker/route.ts:147-152`).

### Stop & cancel (`/api/tint/manager/cancel` with `stop: true`), in this exact order

| Step | Write | If it fails here, the bill is… |
|---|---|---|
| 0 | read: order (`orderType tint`, stage ∈ {tint_assigned, tinting_in_progress}, not removed, not on a trip / dispatched, via `offFloorRefusal` with `allowTintRoom`). Reason mandatory (400). | untouched |
| 1 | `stopTintWork` step 1: end the assignment | at its tint stage with the job still live → **retry** |
| 2 | `stopTintWork` step 2: cancel splits | at its tint stage with **no live job**. Safe: operator `done` needs an active assignment (`done/route.ts:64-72` → 403), `resume` needs an active status (`resume/route.ts:59`), and the bill cannot reach picking because only completion advances it. The board shows a **"Stopped — finish cancel"** state. **The route accepts this state on retry:** a tint-stage bill with zero live jobs skips 1-2. |
| 3 | `applyBillAction("cancel", { allowTintRoom: true })`: **1** `orders.update {workflowStage:"cancelled", dispatchStatus:null}` → `pick_assignments.deleteMany` (normally none) → **1** `order_status_logs` (`buildCancelNote(reasonKey, remark)`, `fromStage` = real stage) | cancelled. Done. A failed log is the same leftover Floor already tolerates. |

The reason and remark are mandatory, using Floor's vocabulary (`FLOOR_CANCEL_REASONS`, `lib/floor/off-floor.ts:23`).
If the owner wants a tint-specific reason key, it goes in `lib/picking/cancel-reasons.ts`, never as a
label here. The two-step confirm is UI-only; the route does not depend on it.

**Why this order and not orders-first:** if the bill were cancelled first and the assignment write then
failed, the operator would still have a live assignment on a cancelled bill. `pause` checks only the
assignment row (`pause/route.ts:84-99`), so that would leave an assignment row nobody can clean up through
the UI. The decision-10 order leaves at worst a stuck-but-harmless bill, which the same button finishes.

### Cancel of a waiting bill (`pending_tint_assignment`) from TM

`stopTintWork` (step 2 only matters: legacy live splits, the orphan hole in diagnosis §B), then
`applyBillAction("cancel")`.

**Recommended: move the split step into `applyBillAction`'s cancel arm for `orderType === "tint"`**, so
**Floor's** cancel and Floor/TM Raise CI also stop orphaning splits. This is a one-owner fix that costs
nothing extra.

### Restore of a cancelled tint bill (decision 11) — **EDIT the restore arm in `lib/floor/bill-actions.ts`** (Floor and TM both)

- `orderType === "tint"` **and the bill never finished tinting** → `workflowStage: "pending_tint_assignment"`,
  `dispatchStatus: null`, `sequenceOrder: 0`. The log note is "Restored to tint queue".
- "Never finished" = **no `tint_assignments` row with `status = TINT_STATUS_DONE`** (any assignee,
  including the Base placeholder) and no done split. A tint bill cancelled **after** completion (e.g. from
  `pending_picking`) keeps today's `pending_support`. **Owner to confirm, §I-3.**
- This matches Pick-delete Undo (`lib/billing/pick-delete.ts:777-779`), so the two un-cancel paths stop
  disagreeing.
- The old cancelled assignment rows stay dead. The next Assign mints a new row (TINT §1.4, skipped/cancelled
  are never revived).

### Existing routes that change

| File | Change |
|---|---|
| `lib/floor/off-floor.ts:65-75` | `offFloorRefusal(bill, opts?: { allowTintRoom?: boolean })`. Tint-room text `"In the tint room — cancel from Tint Manager"` → **`"In the tint room — use Stop & cancel on Tint Manager"`** (the action now exists). Pick delete's short label `"In tint room"` (`pick-delete.ts:221`) is unchanged. |
| `components/floor/detail-panel.tsx:413-434` | Inert tint-lock reason text ("… cancel from Tint Manager") → the same wording. Done in **step 7** (that file's owner step). |
| `app/api/floor/actions/route.ts` | Becomes loop + validation calling `applyBillAction` (step 2). Restore behaviour for tint bills changes through the lib (step 3). |
| `app/api/floor/ci/route.ts` | Calls `raiseFullBillCi({ allowTintRoom: false })`. Behaviour unchanged. |
| `app/api/tint/manager/splits/cancel/route.ts:81-84` | **Guard the parent reset:** only write `pending_tint_assignment` when the parent is at a tint stage (`pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`). This stops it resurrecting a cancelled bill with no log (diagnosis §B). It stays on `$transaction` (TINT §1.8, deferred; not this build). |
| `app/api/tint/operator/pause/route.ts` | Uses `minutesSinceRunStart`. Arithmetic is byte-identical. |
| `cancel-assignment/route.ts` | **No change** (Send back). Its `$transaction` stays deferred. |

---

## E. Pick delete split

**Rule (decision 13).** A group is **TM-owned iff EVERY live twin has SMU 74 or 77**. A mixed group, or one
with any null-SMU twin, stays with Billing.

**Constant:** add to `lib/billing/pick-delete-rule.ts` (pure, already unit-tested):
```ts
export const PROJECT_SMU_NAMES = Object.entries(SMU_CODE_BY_NAME)
  .filter(([, code]) => isProjectSmu(code)).map(([name]) => name);   // ["Decorative Projects","Retail Offtake"]
export type PickDeleteOwner = "billing" | "tint";
export function ownerOfSmus(smus: readonly (string | null)[]): PickDeleteOwner  // every ∈ names → "tint"
```
It derives from `SMU_CODE_BY_NAME` (`lib/import-upsert/types.ts:243`) and `PROJECT_SMU_CODES`
(`lib/picking/colour-work.ts:50`), so nothing is retyped. Unit test: mixed → billing, null → billing,
74+77 → tint.

**SQL — `openGroupsCte()` (`lib/billing/pick-delete.ts:112-147`):** one new column in `grp`, carried through `open_groups`:
```sql
bool_and(coalesce("smu" = ANY (${PROJECT_SMU_NAMES}::text[]), false)) AS tm_owned
```
🔴 The `coalesce` is load-bearing. `bool_and` **ignores NULLs**, so without it a group of (null-SMU bill,
74 bill) would read as TM-owned and vanish from Billing. `orders.smu` is 1:1 with `smuCode` on live data
(SELECT above), so no `import_raw_summary` join is needed.

**Function changes (same file). Every reader and writer takes `owner`. No copies:**

| Function | Change |
|---|---|
| `readOpenGroupRows(owner)` / `getOpenGroups(owner)` / `getActionableGroups(owner)` | `WHERE tm_owned = ${owner === "tint"}` |
| `getPickDeleteMarker(owner)` | count over `actionable AND tm_owned = …`; `latest` over the same owner's groups (`decisions` max may stay global: a false fire costs one reload) |
| `listPickDelete(month, owner)` | groups filtered. **Decided list** filtered by `ownerOfSmus(smu of d.orderIds)`, read from the `readBills` already done (`BillRow` gains `smu`). No schema change: ownership is derived, and `orders.smu` does not change after import. |
| `markAllOk({…, owner})` / `pickDelete({…, owner})` | After `getTwinIdsBySo`, read the twins' `smu`. If `ownerOfSmus ≠ owner` → **409 "This SO is decided on Tint Manager" / "… in Billing"**. This closes a stale-tab race in both directions. |
| `undoDecision({…, owner})` | Same check on `d.orderIds`. |
| `getPickDeleteBillLines` | unchanged (read-only; each gate guards its own route) |

**Billing changes (owner `"billing"`, behaviour identical for non-74/77):** the 6 routes
`app/api/billing/pick-delete/{list,marker,bill/[orderId],all-ok,delete,undo}/route.ts` pass `"billing"`.
`lib/billing/sync.ts:126` passes `"billing"`, and that count is what feeds the popup and pill. The popup
count = the marker count, so TM-owned groups **stop blocking Billing in the same deploy**. Deploy the lib and
the Billing routes in **one commit** (step 4), so no window exists where Billing still counts a group TM owns
(diagnosis risk 8). `lib/billing/live-rule.ts` needs no change: a TM decision wakes Billing's feed, which
costs one harmless reload.

**TM routes (NEW, `app/api/tint/manager/pick-delete/…`, same 6 shapes):** `list`, `marker`,
`bill/[orderId]` gated on tint_manager canView + `tint_pick_delete` canView; `all-ok`, `delete`, `undo` gated
on tint_manager canEdit + `tint_pick_delete` canEdit. Each calls the same lib function with `"tint"`.
`bill/[orderId]` also refuses a bill that is not a tint bill.

⚠ **Mid-tint twins stay undeletable.** `NOT_DELETABLE_STAGES` includes `tint_assigned` /
`tinting_in_progress` (`:110`). A TM-owned group whose only deletable twin is being mixed is not
`actionable`, so the popup does not block. TM can Stop & cancel instead (§I-5).

**Parity scripts to update:**
- `scripts/parity-pick-delete.ts`: compare `legacy` against `billing ∪ tint` (group maps, open ids, marker
  count = sum), plus a disjointness check (no SO in both). Add a per-owner write pre-check pass.
- `scripts/parity-pick-delete-legacy.ts`: **frozen, no edit.** The OLD side stays the old rule, which is
  what proves the split loses nothing.
- `scripts/parity-billing-sync.ts:87`: the expected pickDelete count becomes the legacy count minus TM-owned
  actionable groups. Simplest: compare against `getPickDeleteMarker("billing")` and assert
  `billing + tint = legacy`.
- Scratch `scripts/_pick-delete-*-readonly.ts` call the old signatures. Add `"billing"` so `tsc` passes
  (they are type-checked).

---

## F. Marker widening — `app/api/tint/manager/marker/route.ts`

Add to the existing `orders.aggregate` `OR` (`:91-135`), still AND hide-exclusion and `isRemoved:false`. All
arms have `orderType:"tint"` except where noted.

| Arm | Predicate | Covers |
|---|---|---|
| 4 (new) | `dispatchStatus: "hold"` (any stage) | Hold tab, including a bill held then finished (`pending_support` + hold), which arm 1 drops |
| 5 (new) | `workflowStage: "cancelled", updatedAt: { gte: startOfToday }` | CI tab: today's cancels/restores and edits. The tab is today-only, like Floor's. |

Fold into the existing `GREATEST(...)` statement (`:147-152`). It stays one `$queryRaw`, read-only:

```sql
SELECT GREATEST(
  (SELECT max("updatedAt") FROM tint_assignments),
  (SELECT max("updatedAt") FROM order_splits),
  (SELECT max("updatedAt") FROM delivery_challans),
  (SELECT max(c."updatedAt") FROM ci_returns c
     JOIN orders o ON o.id = c."orderId" AND o."orderType" = 'tint'),        -- CI tab (filtered: billing's CI churn must not reload TM)
  (SELECT max("updatedAt") FROM pick_delete_decisions),                       -- Pick delete history (low volume, unfiltered)
  (SELECT max(e."createdAt") FROM tinter_issue_entries   e
     WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId})),
  (SELECT max(e."createdAt") FROM tinter_issue_entries_b e
     WHERE e."tintAssignmentId" IN (SELECT id FROM tint_assignments WHERE "assignedToId" = ${baseOperatorId}))
) AS m
```
- TI tables have **no `updatedAt`** (schema), so `createdAt` is used. A TI insert is the only event that
  changes base-pending coverage; a PATCH does not change coverage. They are filtered to placeholder
  assignments so ordinary operator TIs do not fire. If `baseOperatorId` is null, skip both terms.
- The response shape is unchanged (`{count, latest}`), so `use-picking-marker` is untouched. No DB trigger.
- **Consumers to refetch on a marker move:** the base-pending list (today fetched only on mount and after own
  actions, `tint-manager-content.tsx:442,454,504`), the Hold list, the CI list and the history tab. Each runs
  only while its tab is open. The TM pick-delete **popup** polls its own `/api/tint/manager/pick-delete/marker`,
  like Billing's.
- **Update:** `lib/tint/marker-coverage.test.ts` (`STAMP_TABLES` gains `ci_returns`, `pick_delete_decisions`,
  `tinter_issue_entries`, `tinter_issue_entries_b`; the new TM write routes must stamp one of them, and they
  all write `orders`) and `scripts/parity-tint-marker.ts` (NEW signature + fingerprint include the two arms
  and the four tables).
- ⚠ The live feed (`live.feed.tint`, default off) **unmounts this marker** and narrows ids to onBoard ∪ held
  (`lib/tint/live-feed.ts:39-54`). It would miss the new tabs. Do not turn the flag on until
  `classifyTintManager` gains the same arms (§I-7).

---

## G. Grants SQL — DRAFT, NOT RUN

```sql
-- sql/2026-10-0X-tint-manager-action-ticks.sql — DRAFT. Smart Flow, Supabase SQL Editor, ONE paste.
-- NO BEGIN/COMMIT (fails silently in the editor, CORE §3). Idempotent; the conflict arm only RAISES
-- flags, so a re-run never undoes a revocation made on /admin/access.
-- ON CONFLICT target confirmed by read-only SELECT on pg_constraint 2026-10-01:
--   user_page_access → user_page_access_user_page_key  UNIQUE ("userId","pageKey")
-- 🔴 Run BEFORE the step-2 commit deploys if any existing button moves behind a new tick (Remove OBD
--    moves to tint_cancel in step 2). An absent row reads as false.

-- PART 0 — what is there now (read-only; run first, on its own)
SELECT u.id, u.name, upa."pageKey", upa."canView", upa."canEdit"
  FROM users u
  LEFT JOIN user_page_access upa
         ON upa."userId" = u.id
        AND upa."pageKey" IN ('tint_manager','tint_hold','tint_hand','tint_slot','tint_ship_to',
                              'tint_cancel','tint_ci','tint_pick_delete')
 WHERE u.id IN (21, 32)            -- 21 Chandresh Kolgha, 32 Prakash
 ORDER BY u.id, upa."pageKey";

-- PART 1 — 2 users × 7 keys = 14 rows, canView + canEdit
INSERT INTO user_page_access
  ("userId", "pageKey", "canView", "canImport", "canExport", "canEdit", "canDelete")
SELECT u.id, k."pageKey", true, false, false, true, false
  FROM users u
 CROSS JOIN (VALUES
   ('tint_hold'), ('tint_hand'), ('tint_slot'), ('tint_ship_to'),
   ('tint_cancel'), ('tint_ci'), ('tint_pick_delete')
 ) AS k("pageKey")
 WHERE u.id IN (21, 32)
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET
  "canView"   = user_page_access."canView" OR excluded."canView",
  "canEdit"   = user_page_access."canEdit" OR excluded."canEdit",
  "updatedAt" = now();

-- PART 2 — OPTIONAL role_permissions fallback (ACCESS_SOURCE='role' rollback shows the same buttons).
-- Constraint per sql/2026-09-17-tint-panel-tabs.sql: role_permissions_roleslug_pagekey_key — re-confirm
-- with a pg_constraint SELECT before running. Leave out if the billing_* precedent (no role rows) is kept.
-- INSERT INTO role_permissions ("roleSlug","pageKey","canView","canImport","canExport","canEdit","canDelete")
-- SELECT r."roleSlug", k."pageKey", true, false, false, true, false
--   FROM (VALUES ('tint_manager'),('operation_manager')) r("roleSlug")
--  CROSS JOIN (VALUES ('tint_hold'),('tint_hand'),('tint_slot'),('tint_ship_to'),
--                     ('tint_cancel'),('tint_ci'),('tint_pick_delete')) k("pageKey")
-- ON CONFLICT ON CONSTRAINT role_permissions_roleslug_pagekey_key
-- DO UPDATE SET "canView" = role_permissions."canView" OR excluded."canView",
--               "canEdit" = role_permissions."canEdit" OR excluded."canEdit", "updatedAt" = now();

-- PART 3 — verify (one SELECT; expect 14 rows, all view=true edit=true, source=user)
SELECT 1 AS s, u.name AS who, a."pageKey", (a."canView" AND a."canEdit")::text AS chk
  FROM user_page_access a JOIN users u ON u.id = a."userId"
 WHERE a."userId" IN (21, 32)
   AND a."pageKey" IN ('tint_hold','tint_hand','tint_slot','tint_ship_to','tint_cancel','tint_ci','tint_pick_delete')
UNION ALL
SELECT 2, 'ACCESS_SOURCE', '', value FROM system_config WHERE key = 'ACCESS_SOURCE'
ORDER BY s, who, "pageKey";
```

Harsh is a superuser (all-true) and needs no row. Everyone else shows "missing rows" on `/admin/access`
for these keys; an absent row and an all-false row mean the same thing to every resolver.

---

## H. Build split — steps 2–9

Rule: each file is edited by one step, **except the named shared files**:
- `components/tint/tint-manager-content.tsx`, the composition root, is edited in **5, 6, 7, 8**, in sequence.
- `lib/floor/bill-actions.ts` is created in **2** and edited in **3** (restore, split cleanup, allowTintRoom).

Every step ends with `npx tsc --noEmit` clean, the step's tests where they exist, and a **local** commit
(no push; list unpushed commits before any push, per memory). The dev server is stopped before git.

### Step 2 — ticks + reused-action routes (server + access, no UI change)
Files: `lib/permissions.ts` · `components/admin/permissions-manager.tsx` · `app/(tint)/tint/manager/layout.tsx` ·
`components/tint/manager/tint-manager-access-provider.tsx` · `lib/floor/hold-log.ts` · **NEW** `lib/floor/bill-actions.ts` ·
`app/api/floor/actions/route.ts` · **NEW** `lib/floor/ship-to.ts` · `app/api/floor/ship-to/route.ts` ·
`app/api/floor/ship-to-search/route.ts` · **NEW** `lib/dispatch/windows.ts` · `app/api/billing/dispatch-windows/route.ts` ·
**NEW** `lib/tint/manager-bill.ts` · **NEW** `app/api/tint/manager/actions/route.ts` (hold/unhold/hand/unhand/change-slot) ·
**NEW** `app/api/tint/manager/ship-to/route.ts` · **NEW** `app/api/tint/manager/ship-to-search/route.ts` ·
**NEW** `app/api/tint/manager/dispatch-windows/route.ts` · `app/api/tint/manager/orders/[id]/remove/route.ts` (+`tint_cancel`).
Gate: tsc. Run the §G SQL **before** deploying (Remove OBD moves behind `tint_cancel`; the button change
itself lands in step 6).
Commit: `tint manager tabs 2: seven tint_* action ticks + tint-gated hold/hand/slot/ship-to routes over extracted floor libs`

### Step 3 — Stop & cancel + restore-to-rail + Raise CI
Files: `lib/floor/off-floor.ts` · `lib/floor/bill-actions.ts` (named) · **NEW** `lib/tint/stop-work.ts` ·
`lib/tint/elapsed-time.ts` · `app/api/tint/operator/pause/route.ts` · **NEW** `lib/floor/raise-ci.ts` ·
`app/api/floor/ci/route.ts` · **NEW** `app/api/tint/manager/cancel/route.ts` · **NEW** `app/api/tint/manager/restore/route.ts` ·
**NEW** `app/api/tint/manager/ci/route.ts` · `app/api/tint/manager/splits/cancel/route.ts`.
Gate: tsc. Plus a read-only check that `minutesSinceRunStart` equals pause's old arithmetic on 3 live paused
rows.
Commit: `tint manager tabs 3: Stop & cancel (assignment → splits → cancel), tint-aware restore, TM raise CI; splits/cancel no longer un-cancels`

### Step 4 — pick-delete ownership split (server, Billing + TM in ONE commit)
Files: `lib/billing/pick-delete-rule.ts` (+ `pick-delete-rule.test.ts`) · `lib/billing/pick-delete.ts` · `lib/billing/sync.ts` ·
`app/api/billing/pick-delete/{list,marker,all-ok,delete,undo}/route.ts` + `bill/[orderId]/route.ts` ·
**NEW** `app/api/tint/manager/pick-delete/{list,marker,all-ok,delete,undo}/route.ts` + `bill/[orderId]/route.ts` ·
`scripts/parity-pick-delete.ts` · `scripts/parity-billing-sync.ts` · `scripts/_pick-delete-*-readonly.ts` (signature only).
Gate: tsc + `npx tsx --test lib/billing/pick-delete-rule.test.ts` + `npx tsx scripts/parity-pick-delete.ts`
(exit 0) + `scripts/parity-billing-sync.ts`.
Commit: `tint manager tabs 4: pick delete — all-74/77 SO groups belong to Tint Manager; Billing list/marker/popup exclude them`

### Step 5 — tab bar + rail + TI tab (+ ship-to visibility, decision 12)
Files: `app/api/tint/manager/orders/route.ts` (payload adds `shipToOverrideCustomer` name, `dispatchStatus`,
`dispatchTargetDate`, `dispatchWindowId` + window time on Set A and the row sets) · `components/tint/manager/types.ts` ·
`components/tint/manager/rows.ts` (override-first `siteNameOf`, rail excludes held) · `components/tint/manager/board-rail.tsx` ·
**NEW** `components/tint/manager/board-tabs.tsx` · **NEW** `components/tint/manager/board-ti-tab.tsx` ·
`app/api/tint/manager/challans/[orderId]/route.ts` (ship-to block resolves `orders.shipToOverrideCustomerId`
first: name, address, code, route, area, site contact from that point) · `components/tint/tint-manager-content.tsx` (named).
⚠ `tint-table-view.tsx` imports the payload types. Any new field on `TintOrder` must also go into its
synthetic `assignmentAsOrder()` (TINT §1), or tsc breaks. That is a one-line add in the same step, so it is
named here.
Gate: tsc + `npm run test:tint-sync`.
Commit: `tint manager tabs 5: tab bar, select-on-click rail cards, TI tab; board + challan honour ship-to override`

### Step 6 — bottom bar + slot + row select
Files: **NEW** `components/tint/manager/board-bottom-bar.tsx` · **NEW** `components/tint/manager/board-stop-cancel-dialog.tsx` ·
**NEW** `components/floor/slot-picker-button.tsx` (extracted from `detail-panel.tsx:41-82`. The **import swap
inside `detail-panel.tsx` waits for step 7**, so for one step Floor keeps its private copy and the new file
is a byte copy with the source named) · `components/tint/manager/board-table.tsx` (row click, ⋯, Slot column) ·
`components/floor/off-floor-dialog.tsx` (`endpoints` prop) · `components/tint/tint-manager-content.tsx` (named):
three disjoint selections (rail / table / hold), Esc guard adds `[data-slot-popover="open"]` first (FLOOR §4.6),
`holdLive` adds the bar's menus and dialogs, and `canRemoveObd` → `access.canCancel`.
Gate: tsc.
Commit: `tint manager tabs 6: bottom bar (Slot · Assign ▾ · More), slot column on Floor's picker, click-to-select rows`

### Step 7 — detail panel + Hold tab + CI tab
Files: **NEW** `lib/floor/order-detail.ts` · `app/api/floor/order/[orderId]/route.ts` · **NEW** `app/api/tint/manager/order/[orderId]/route.ts` ·
**NEW** `components/floor/ship-to-editor.tsx` · `components/floor/detail-panel.tsx` (import `SlotPickerButton` +
`ShipToEditor`, delete the private copies, tint-lock text per §D) · `components/tint/manager/board-detail-panel.tsx` (rewrite) ·
`lib/floor/queries.ts` (`getFloorHold` / `getFloorCancelled` gain optional `extraWhere`) ·
**NEW** `app/api/tint/manager/hold/route.ts` · **NEW** `app/api/tint/manager/cancelled/route.ts` ·
**NEW** `components/tint/manager/board-hold-tab.tsx` · **NEW** `components/tint/manager/board-ci-tab.tsx` ·
`components/tint/tint-manager-content.tsx` (named).
Gate: tsc + `npx tsx scripts/parity-floor-rows.ts`, which must not move because `extraWhere` is undefined
for Floor.
Commit: `tint manager tabs 7: Floor-layout detail panel on a shared detail payload; Hold (Release = unhold) and CI tabs`

### Step 8 — pick-delete popup + history
Files: `components/billing/billing-pick-delete-popup.tsx` · `components/billing/billing-pick-delete-queue.tsx` ·
`components/billing/billing-pick-delete-tab.tsx` (each gains `base`, default unchanged) ·
**NEW** `components/tint/manager/board-pick-delete-tab.tsx` · `components/tint/tint-manager-content.tsx` (named).
First, confirm `useBillingLiveApi()` is null-safe outside `BillingLive`. If it is not, guard it in the popup
in this step.
Gate: tsc + a Billing regression check (popup still opens on Billing's own marker).
Commit: `tint manager tabs 8: Tint Manager pick-delete blocking popup + decision history (reuses Billing's components)`

### Step 9 — marker widening
Files: `app/api/tint/manager/marker/route.ts` · `lib/tint/marker-coverage.test.ts` · `scripts/parity-tint-marker.ts`.
Tab refetch-on-marker hooks belong to the step-7/8 content edits, keyed on the existing `onChange`.
Gate: tsc + `npm run test:tint-sync` + a 30-minute `npx tsx scripts/parity-tint-marker.ts 30` with **MISSED = 0**.
Commit: `tint manager tabs 9: marker covers held/cancelled tint bills, tint CIs, pick-delete decisions, base TI entries`

**Canon follow-up (not a code step):** TINT §1/§8/§13, FLOOR §4.1/§4.7, BILLING (pick delete is absent
entirely), CORE §5 key table.

---

## I. Blockers and things the code cannot do cleanly

1. **The v7 mockup file is missing** (path above). Steps 5–8 need it for pixel decisions: card strip order,
   bar position, tab counts. Nothing in the server steps (2–4, 9) depends on it.
2. **Floor's `DetailPanel` is not reusable as a component** (§A, four blockers). The plan reuses its layout,
   bodies, slot chip and ship-to editor, and rebuilds the shell. This is the "else" branch of decision 6.
3. **Restore of a tint bill cancelled AFTER tinting finished.** Decision 11 says → rail. Read literally, a
   finished bill would be re-tinted. The plan sends only **never-finished** tint bills (no `tinting_done`
   assignment or split) to `pending_tint_assignment` and keeps `pending_support` for the rest. Owner: confirm.
4. **Release in the bottom bar vs the More menu.** Decision 3 lists Hold/Release in More *and* "Hold tab
   selection → Release (primary)". The plan does both: Release is the primary on the Hold tab, and
   Hold/Release sits in More elsewhere. One brand button per surface holds.
5. **Pick delete cannot cancel a twin that is mid-tint** (`NOT_DELETABLE_STAGES`). A TM-owned group with
   only mixing twins is not actionable and does not block. If the owner wants the popup to force a
   decision, it needs "Stop & pick delete", which is not in this build.
6. **Ship-to has no trip guard on Floor's route** (diagnosis §E). TM inherits that. Recommend putting
   Billing's on-a-trip refusal inside `setShipToOverride` (changes Floor too). Owner call; not assumed.
7. **The live feed would regress the new tabs.** With `live.feed.tint` on, the marker is unmounted and
   `classifyTintManager` keeps only onBoard ∪ held ids. The new arms must be mirrored there before the flag
   is turned on (ROADMAP).
8. **TI rows have no `updatedAt`,** so a TI **edit** never moves the marker. That is harmless for base-pending
   coverage. It is not covered if a future TI tab shows edit fields.
9. **Stop & cancel discards half-mixed paint state.** `currentProgress` is kept on the cancelled
   assignment, but a restored bill starts a fresh assignment. Nothing re-uses the old progress. That is
   intended per decision 10 ("timer frozen"); stated so nobody expects a resume.
10. **Mail-matched tint bills hidden from Floor mid-tint** remain hidden (decision 15, ROADMAP). A TM
    slot/ship-to/hold on them shows on Floor only after completion.

---

## J. Owner decisions (2026-10-01)

Recorded before step 2 was built. These close §I-3, §I-5, §I-6 and §I-7.

1. **Restore (§I-3).** Only tint bills that **never finished tinting** go back to
   `pending_tint_assignment`. A tint bill that had finished keeps `pending_support`. This is §D as written.
2. **Ship-to on a trip (§I-6).** A ship-to change is **refused when the bill is on a trip, on ALL desks.**
   The refusal lives inside the shared `setShipToOverride` (`lib/floor/ship-to.ts`) and reuses Billing's
   on-a-trip rule (`billingRefusal("shipTo", …)`, `lib/billing/refusal.ts`), with the same wording:
   "On trip {n} — remove it from the trip first". Floor and Tint Manager both call it. Billing's own actions
   route keeps its existing call to `billingRefusal`. It writes per SO and does not call
   `setShipToOverride`, and it already refuses with the same text. This is the ONE intended Floor behaviour
   change in step 2.
3. **Mid-tint pick-delete twins (§I-5)** stay undeletable, and the popup does not block on them. Accepted.
4. **`live.feed.tint` stays OFF (§I-7).** Mirroring the new marker arms into `classifyTintManager` goes on
   ROADMAP.
