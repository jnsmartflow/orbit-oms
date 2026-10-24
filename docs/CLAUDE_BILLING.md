# CLAUDE_BILLING.md — Billing desk (/mail-orders, billing face)
# v1.1 · Schema v27.74 · October 2026 · updated 2026-10-24 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_MAIL_ORDERS.md

Reconciled against CORE v150 (Schema v27.74) on 2026-10-24; columns and tables this file relies on are in §10 with their versions.

---

## 1. What it is, and the ownership boundary

The Billing desk is the face `/mail-orders` shows to everyone who can open it. The sidebar
labels the route **Billing** (`lib/permissions.ts:65`); the route, the page key `mail_orders`
and the folder `app/(mail-orders)/` keep their old names. It has six tabs: **Orders**
(punch mail orders into SAP), **Picking** (bills the floor has checked, waiting to be marked
invoiced), **Print** (trips Floor sent to billing, whose OBD — or invoice — numbers billing copies
into SAP), **Telephonic** (SO numbers billing tags Hold or CI before the OBD lands), **Pick delete**
(history of the same-SO decisions the blocking pick-delete popup takes) and **Challan orders** (the
shared challan screen). *(This said "three tabs" until 2026-10-24.)*

**This file replaces the router's old rule.** Was "no billing file while pilot-gated" (router
`CLAUDE.md §3`, `CLAUDE_MAIL_ORDERS.md §23`) until 2026-09-19; now both point here (MAIL_ORDERS
v1.14 `915f46f2`, router v1.13 `349c6929`). Do not revert. The pilot is over: the live `billing_settings` row reads `rolloutStage = ALL_USERS`,
`updatedAt 2026-08-06 10:41` (live 2026-09-18, Q01).

### What this file owns

| Owned here | Where it lives |
|---|---|
| The rollout flag and what it switches | `lib/billing/flag.ts`, `components/billing/billing-v2-provider.tsx` — §2 |
| The tab bar and the six tabs' gates | `components/billing/billing-tab-bar.tsx`, `app/(mail-orders)/mail-orders/layout.tsx` — §3, §4 |
| The six action ticks and the actions route (+ the ship-to modal route) | `app/api/billing/mail-order/actions/route.ts`, `…/mail-order/ship-to/route.ts`, `components/billing/billing-action-ribbon.tsx` — §5 |
| The Picking tab | `lib/billing/picking-where.ts`, `app/api/billing/picking/**`, `components/billing/billing-picking-tab.tsx`, `billing-order-detail-panel.tsx`, `lib/billing/order-detail.ts` — §6 |
| The Print tab — Billing Print v2, Copy inv, per-invoice copies, Done | `lib/billing/print.ts`, `app/api/billing/print/**`, `components/billing/billing-print-tab.tsx` — §7 (the per-invoice copy rule's code is `lib/order-invoices/copy-plan.ts`, owned by `CLAUDE_ORDER_INVOICES.md §4.7`) |
| The Telephonic tab and the pick-delete popup / tab | `components/billing/billing-telephonic-tab.tsx`, `billing-pick-delete-*.tsx`, `app/api/billing/telephonic/**`, `…/pick-delete/**` — §5b |
| Billing live sync — the live feed root and the marker providers | `components/billing/billing-live.tsx`, `billing-marker-provider.tsx`, `lib/billing/live-rule.ts`, `app/api/billing/sync` — §8 |
| Notes-band font size | `users.notesFontSize`, `app/api/user/notes-font-size/route.ts`, `lib/mail-orders/notes-font-size.ts` — §9 |

### What it does not own — cross-referenced, never restated

| Billing uses | Owner |
|---|---|
| Parser, enrichment, customer matching, ship-to matching | `CLAUDE_MAIL_ORDERS.md §3–§6` |
| The Review view and Orders-list internals (`review-view.tsx` cards, signals, split, punch, smart copy, keyboard map) | `CLAUDE_MAIL_ORDERS.md §8–§12` |
| Tag gating (`app_tag_settings`, `getOrderSignals`) | `CLAUDE_MAIL_ORDERS.md §21` + `CLAUDE_CORE.md §7.10` |
| `mail_orders` grants and the mail-orders write routes | `CLAUDE_MAIL_ORDERS.md §22` + `CLAUDE_CORE.md §5` |
| `GET /api/mail-orders/marker` (the Orders tab's poll) | `CLAUDE_MAIL_ORDERS.md` |
| Trips, `trips.sentToBillingAt`, Send to billing, take-back | `CLAUDE_FLOOR_TRIPS.md` §12 |
| Invoice rows (`order_invoices`), split OBDs, the per-invoice copy rule's model | `CLAUDE_ORDER_INVOICES.md` (§2, §4.7) |
| What a pick finding is, and how it is confirmed | `CLAUDE_PICKING.md §11` |
| The marker hook `usePickingMarker`; the live feed itself (`lib/live/*`, `live_changes`) | `CLAUDE_PICKING.md §10`; CORE §13 |
| `checkAnyPermission`, the admin/superuser bypass, `user_page_access` | `CLAUDE_CORE.md §5` + `§7.14` |
| The challan orders screen (its tab and exclusions) | no domain file yet; schema CORE §7 (v27.60) |
| `UniversalHeader` props; the general button rules (grey when disabled) | `CLAUDE_UI.md §6`; `CLAUDE_UI.md` §10 *Action-surface rules*. **"Hide, never disable" is BILLING's own rule** (§11 here) — UI §10 does not hold it, though code comments cite "CLAUDE_UI §10". *(This row said "UI §10 hide-don't-disable" until 2026-10-24.)* |

---

## 2. The rollout flag

`isBillingV2Enabled(userId)` (`lib/billing/flag.ts:76-102`) decides whether the viewer gets the
billing face.

| `billing_settings.rolloutStage` | Result | Code |
|---|---|---|
| `OFF` | false for everyone | `flag.ts:85` |
| `TEST_USERS_ONLY` | `users.billingV2TestUser` decides | `flag.ts:92-97` |
| `ALL_USERS` | true for everyone who passes the layout gate; the per-user column is not read | `flag.ts:86` |

- **Live stage: `ALL_USERS`**, one row, `scope = GLOBAL`, `updatedById = null` (live 2026-09-18, Q01).
- **Fails closed.** A missing row reads `OFF` (`flag.ts:55`); a P2021 (no table) reads `OFF`
  silently, any other error is logged and reads `OFF` (`flag.ts:56-66`); a non-finite user id
  reads false (`flag.ts:82`); a failed user lookup reads false (`flag.ts:98-101`).
- **Read fresh on every page load**, never cached on the JWT (`flag.ts:25-33`). The layout reads
  it once (`layout.tsx:109`) and `BillingV2Provider` couriers it; the context default is `false`
  (`billing-v2-provider.tsx:17`).
- Do not move the helper into `lib/auth.ts` or `auth.config.ts` (`flag.ts:35-38`; router §1 auth split).

### The flag-OFF face is dormant, not deleted

With the stage at `ALL_USERS`, every viewer is on the billing face, so these branches cannot
be reached. They are still in the code:

| Dormant branch | Where the branch is |
|---|---|
| Table/Focus toggle (the only writer of `viewMode`; default `"focus"`) | `mail-orders-page.tsx:237`, `:1356` (`title={billingV2 ? undefined : …}`) |
| Slot sections (1–9 jumps, "Jump to slot") | `mail-orders-page.tsx:1402` (`segments={billingV2 ? undefined : …}`) |
| Auto-select first slot | `mail-orders-page.tsx:420` (`if (billingV2) return;`) |
| Header stats, clock, shortcuts button, header filter bar | `mail-orders-page.tsx:1394`, `:1431`, `:1437`, `:1416` |
| Table view, ColumnPicker, urgent/hold banner, non-billing empty state | `mail-orders-page.tsx:1552-1606` |

The OFF stage is still the kill switch: one `UPDATE billing_settings` (via Smart Flow) puts
every user back on that face on their next page load (`flag.ts:16-17`).

---

## 3. The route, the layout gate and the tab bar

**Route gate.** `app/(mail-orders)/mail-orders/layout.tsx:32-33` requires page key
`mail_orders` canView, else redirect `/unauthorized`. Nothing below renders without it.

**Known limit.** A person holding `billing_picking` or `billing_print` but not `mail_orders`
cannot open the page at all, so a tab-only grant has nowhere to render (`layout.tsx:65-69`,
`:75-76`).

**Provider stack** (all server-resolved once in the layout, then couriered; no client fetch):
`BillingV2Provider` → `BillingPickingAccessProvider` → `BillingActionsAccessProvider` (hold, slot,
urgent, shipTo, hand, ci) → `BillingPrintAccessProvider` → `BillingTelephonicAccessProvider` →
`BillingPickDeleteAccessProvider` → `ChallanOrdersAccessProvider` (isAdmin = superuser) →
`NotesFontSizeProvider` (`layout.tsx`). The access
booleans come off the same `allPerms` map the layout built for the sidebar
(`layout.tsx:35`, `:70-99`); admin/superuser is already resolved to all-true inside
`getAllPermissionsForRoles` (`lib/permissions.ts:889-894`). All providers default to false.

**The tab bar** (`components/billing/billing-tab-bar.tsx`) sits at the top of the right pane
(`review-view.tsx`). `BillingTab = "orders" | "picking" | "print" | "telephonic" | "pick_delete" | "challan_orders"`.

| Tab | Pill shown when | Badge |
|---|---|---|
| Orders | always | mail orders still needing action (`ordersCount`) |
| Picking | `billing_picking` canView | pending count (§6), live dot |
| Print | `billing_print` canView | trips with copy work outstanding (§7), live dot |
| Telephonic | `billing_telephonic` canView | waiting SO tags; hidden at 0 (§5b) |
| Pick delete | `billing_pick_delete` canView | none — the tab is HISTORY only since 2026-09-28 (§5b) |
| Challan orders | `challan_orders` canView | "Not billed" (`ChallanCountProbe`); hidden at 0 |

A body mounts only on the billing face (`billingV2`), with its own canView, on its own tab. While the live
feed is live the counts come from the feed's sync answers (`useBillingLiveCounts`, §8) and the bar fetches
no marker.

- The page holds `billingTab`; it is not persisted, so a reload lands on Orders
  (`mail-orders-page.tsx:260`, `:269`). The rendered tab is derived: a viewer without the key
  is forced to Orders (`mail-orders-page.tsx:275-278`).
- The date stepper, Filter and ⌨ shortcuts sit on the tab row, not the header
  (`mail-orders-page.tsx:1268-1309`). On Print, Filter and ⌨ are rendered invisible to hold
  their width (`mail-orders-page.tsx:1302-1306`).
- On Print, the order inbox column is CSS-hidden (not unmounted) and a same-width left column
  takes its place, into which the Print tab portals its trip list (`review-view.tsx:2792-2799`,
  `:2910-2918`; `billing-print-tab.tsx:331`).
- Orders-tab keyboard shortcuts (Ctrl+C / Ctrl+V and the single keys) do nothing while
  Picking or Print is open (`mail-orders-page.tsx:939`, `:1041`; `5ec6d65c`).

---

## 4. Access: the billing page keys

All **ten** are **page keys** in the `PageKey` union (`lib/permissions.ts`), not role slugs. None is in
`PAGE_NAV_MAP`: they are tabs and buttons inside `/mail-orders`. All ten are listed in
`ACTION_PAGES.canEdit`, so `/admin/access` draws an Edit switch for each. Labels use a `Billing ·` prefix.
Live access mode is `user` (`user_page_access`). *(This section listed six keys until 2026-10-24.)*

| Page key | Meaning | Server gate | Client gate | Live view / edit (2026-10-24) |
|---|---|---|---|---|
| `mail_orders` | open `/mail-orders` | layout canView | — | see `CLAUDE_MAIL_ORDERS.md §22` |
| `billing_picking` | Picking tab | canView: list, marker, order; canEdit: mark-done, undo (§6) | pill + body on canView; Mark done / Undo hidden without canEdit | 5 / 5 |
| `billing_print` | Print tab | canView: list, marker, order; canEdit: copy, done (§7) | pill + body on canView; without canEdit every Copy is clipboard-only and Done is not drawn | 5 / 5 — Deepanshu Thakur #25, Prakash #32, Bankim #26, Chandresh Kolgha #21, Operations User #20 |
| `billing_telephonic` | Telephonic tab | canView: list, marker; canEdit: add / remove a tag (§5b) | entry rail hidden without canEdit | 5 / 5 |
| `billing_pick_delete` | Pick-delete popup + history tab | canView: list, marker, bill lines; canEdit: All OK / Pick delete / Undo (§5b) | the blocking popup mounts only for canEdit | 5 / 5 |
| `billing_hold` | ⚑ Hold button | canEdit in actions route (§5) | button hidden | 5 / 5 |
| `billing_slot` | 🕑 Slot button | canEdit in actions route | button hidden | 5 / 5 |
| `billing_urgent` | ⚡ Urgent button | canEdit in actions route | button hidden | 5 / 5 |
| `billing_ship_to` | ✎ ship-to (pencil + modal) | canEdit in actions route and the ship-to route (`canEditBillingShipTo` = `mail_orders` AND `billing_ship_to` canEdit) | hidden | 5 / 5 |
| `billing_hand` | Hand (the dealer collects) | canEdit in actions route (2026-09-24, v27.41) | hidden | 5 / 5 |
| `billing_ci` | CI = bill-only (a full-bill CI + cancel at import) | canEdit in actions route (2026-09-24, v27.41) | hidden | 5 / 5 |

- **canView on the six action ticks gates nothing** and must never be read. `/admin/access` still draws
  a View box for them.
- **Seed is not live.** `prisma/seed.ts` writes `role_permissions` template rows for `billing_picking`
  and `billing_print`. It writes no `user_page_access` row, which is the live source.
- **`challan_orders` canView** draws the Challan orders tab (not a billing key).

---|---|---|---|---|
| `mail_orders` | open `/mail-orders` | layout canView (`layout.tsx:32`) | — | not queried; see `CLAUDE_MAIL_ORDERS.md §22` |
| `billing_picking` | Picking tab | canView: list, marker, order; canEdit: mark-done, undo (§6) | pill + body on canView; Mark done / Undo hidden without canEdit | rows=5 · view=5 · edit=5 |
| `billing_print` | Print tab | canView: list, marker; canEdit: copy (§7) | pill + body on canView; without canEdit the button is a plain Copy that records nothing | rows=40 · view=5 · edit=5 |
| `billing_hold` | ⚑ Hold button | canEdit in actions route (§5) | button hidden | rows=40 · view=5 · edit=5 |
| `billing_slot` | 🕑 Slot button | canEdit in actions route | button hidden | rows=40 · view=5 · edit=5 |
| `billing_urgent` | ⚡ Urgent button | canEdit in actions route | button hidden | rows=40 · view=5 · edit=5 |
| `billing_ship_to` | ✎ ship-to pencil | canEdit in actions route | pencil hidden | rows=40 · view=5 · edit=5 |

- **canView on the four action ticks gates nothing** and must never be read
  (`layout.tsx:91-92`; `lib/permissions.ts:471-481`). `/admin/access` still draws a View box
  for them.
- **Seed is not live.** `prisma/seed.ts:189-201` writes `role_permissions` template rows for
  `billing_picking` and `billing_print` (billing_operator, operations, operation_manager,
  tint_manager). It writes no `user_page_access` row, which is the live source.
- The holders' names are not in the 2026-09-18 results (Q03b covers other keys) — see §12.

---

## 5. Orders tab: action ticks and the actions route

### The six ticks — dual gate on the server, hidden on the client

`POST /api/billing/mail-order/actions` serves **Hold, Slot, Urgent, Ship-to, Hand and CI**
(`ACTIONS = ["slot","shipTo","hold","urgent","hand","ci"]`; Hand and CI since 2026-09-24, v27.41).
*(This section said "four ticks" until 2026-10-24.)* **Both gates must pass:**

1. `mail_orders` canEdit.
2. The per-action key, canEdit — the `ACTION_KEY` map (hold → `billing_hold`, slot → `billing_slot`,
   urgent → `billing_urgent`, shipTo → `billing_ship_to`, hand → `billing_hand`, ci → `billing_ci`). The
   403 names the action, and `lib/billing/mo-actions.ts` passes that text to the ribbon. Set and clear
   share one key so nobody can create a state they cannot undo. Wired by `a991a1c4` (2026-09-12).

Admin and superuser pass both inside `checkAnyPermission`. A refusal writes no audit row.

**Client: hidden, never disabled.** The layout reads the six canEdit values into
`BillingActionsAccessProvider` (`components/billing/billing-actions-access-provider.tsx`; default
all-false). The ribbon renders each button only if its tick is held, wraps the whole Slot picker so no
invisible trigger survives, and returns `null` when none is held. The provider is for drawing only; the
route is the lock. Hiding a button never changes data: a held bill stays held.

**Filter chips follow the ticks** (`f1dcfa58`): on the billing face the Dispatch chips (Hold/Dispatch)
need `billing_hold`, the Priority chips need `billing_urgent`, and the Key dealer chip follows the
`keyCustomer` tag (`mail-orders-page.tsx`). Filters whose chip is hidden are dropped from the effective
set.

### What the route writes

Two writes, sequential, never `$transaction` (the route header is the spec):

1. **`mo_orders` — the INTENT, always first and always saved**, carried to the OBD by enrichment at
   import (`applyMailOrderEnrichment`). CI's intent is `mo_orders.billOnlyAt` PLUS an `so_tags` `'ci'`
   row (`lib/billing/mo-ci-tag.ts`).
2. **`orders` — PER BILL** (2026-09-24): read every live bill on the SO (challan-linked bills excluded),
   apply `billingRefusal` (`lib/billing/refusal.ts`), skip a repeat press, then **ONE `orders.update` +
   ONE `order_status_logs` row per bill** — the Floor actions contract. **Skipped entirely for a blank
   SO** (`where: { soNumber: null }` would match every un-punched order — load-bearing). *(Was one
   `updateMany` by SO with no stage filter, which rewrote picked, dispatched and cancelled bills alike and
   held without `heldAt` or a log. Replaced 2026-09-24. Do not revert.)*

| Action | `mo_orders` | `orders` (per bill) |
|---|---|---|
| hold | `dispatchStatus` `"Hold"` / `"Dispatch"` (capitalised), `heldAt` / `heldById` on a Hold | `"hold"` + `heldAt` (`obdEmailDate ?? now`) + `BILLING_HOLD_NOTE`; release → `FLOOR_CLEAR_HOLD_STAGES` rule + `BILLING_CLEAR_HOLD_NOTE`, refused on a bill with a live FULL CI. Then **`mirrorObdHoldSafe`** keeps the bill's invoice rows in step (`CLAUDE_ORDER_INVOICES.md §4.4`) |
| urgent | `dispatchPriority` `"Urgent"` / `"Normal"` | `priorityLevel` 1 / 3 |
| slot set / clear | `dispatchTargetDate`, `dispatchWindowId` | same + `dispatchSlotSource: "manual"` (null on clear) |
| shipTo | dealer / reset — both writes in `lib/billing/ship-to-write.ts` (`applyBillingShipTo`, shared with the modal route) | same |
| hand | `handAt` / `handById`, `dispatchStatus "Dispatch"` | `handAt` / `handById` (+ clear); newly marked bills → `notifyHandSet` |
| ci | `billOnlyAt` + the `so_tags` `'ci'` row (`markMoOrderCi` / `unmarkMoOrderCi`) | nothing here — the tag hook does the CI + cancel at import |

- **One of three.** Hold, Hand and CI exclude each other: setting one clears the other two (on the mail
  order, and on the bills for Hold / Hand), and clearing the OTHER mark on a bill follows that mark's
  refusals (a Hand bill on a trip cannot be put on Hold here). Setting Hold or Hand on a CI-marked mail
  order first un-marks the CI, which is REFUSED once the CI tag has matched a bill — nothing saved, 409.
- **Response:** 200 `{ ok, moOrder, updated, skipped, failed, ordersUpdated }` whenever write 1 landed —
  even if every bill was refused; 4xx only when nothing was saved (bad input, no permission, 409
  `LOCKED` "This order is locked.", a CI refusal).
- **The ship-to MODAL** (typed ship-to, 2026-10-19 / 20) posts to its own route, `POST
  /api/billing/mail-order/ship-to` (multipart, `lib/ship-to/parse-form.ts`; gate `canEditBillingShipTo` =
  `mail_orders` AND `billing_ship_to` canEdit) — the shared `components/shared/ship-to-modal.tsx`; Floor's
  side → `CLAUDE_FLOOR.md §4.4`. The actions route's `shipTo` keeps the dealer / reset JSON path.

**Billing's own read routes**, gated on `mail_orders` canView so billing staff never need `floor`: `GET
/api/billing/ship-to-search` and `GET /api/billing/dispatch-windows`.

### 5b. Telephonic and Pick delete (the other two tabs — one paragraph each)

- **Telephonic** (2026-09-22, Schema v27.39; `components/billing/billing-telephonic-tab.tsx`). A telephonic
  order has no mail order, so billing pastes its SO number tagged **Hold** or **CI**, and the import applies
  the tag when the OBD lands (`lib/billing/telephonic-apply.ts`; the hold note `Held on import (Telephonic
  tag)` — `CLAUDE_FLOOR.md §4.5`). Two lists: Waiting, and the month's table. Key `billing_telephonic`;
  routes `/api/billing/telephonic/{add,list,marker,remove}`. The entry rail is hidden without canEdit. CI is
  solid `ink-900` (`CLAUDE_UI.md §2.1`).
- **Pick delete** (2026-09-27, v27.42; popup / history split 2026-09-28). Same-SO bill groups are decided one
  group at a time — **All OK**, or cancel one bill as a duplicate — in the BLOCKING
  `billing-pick-delete-popup.tsx` (it renders `billing-pick-delete-queue.tsx`) on every tab; it cannot be
  dismissed and mounts only for `billing_pick_delete` canEdit. `billing-pick-delete-tab.tsx` is history
  only, with Undo. Decisions in `pick_delete_decisions`. Routes
  `/api/billing/pick-delete/{list,marker,bill/[orderId],all-ok,delete,undo}`; off the live feed its marker polls every 10 s (§8).

---|---|---|
| hold | `dispatchStatus` `"Hold"` / `"Dispatch"` (capitalised) | `"hold"` / `"dispatch"` (lowercase) — `actions/route.ts:248-251` |
| urgent | `dispatchPriority` `"Urgent"` / `"Normal"` | `priorityLevel` 1 / 3 — `:259-260` |
| slot set | `dispatchTargetDate`, `dispatchWindowId` | same + `dispatchSlotSource: "manual"` — `:208-210` |
| slot clear | both null | both null + `dispatchSlotSource: null` — `:175-179` |
| shipTo set / clear | `shipToOverride` + `shipToOverrideCustomerId` | same — `:212-236` |

A locked mail order is refused with 409 `LOCKED` (`actions/route.ts:153-158`). `heldAt` is not
written (`actions/route.ts:249-250`). Response carries `ordersUpdated` (0 before import, >1 on a
split bill) (`actions/route.ts:298-300`).

**Billing's own read routes**, gated on `mail_orders` canView so billing staff never need
`floor`: `GET /api/billing/ship-to-search` (`ship-to-search/route.ts:33`, called by
`billing-ship-to-pencil.tsx`) and `GET /api/billing/dispatch-windows`
(`dispatch-windows/route.ts:27`, called by `review-view.tsx`).

---

## 6. Picking tab

Bills the floor has checked (`workflowStage = pick_checked`) that billing has still to mark
invoiced. Both predicates live in `lib/billing/picking-where.ts`, shared by the list and the
marker.

| Arm | Predicate | Scope |
|---|---|---|
| **Pending** (actionable) — `buildBillingPendingWhere` | `workflowStage: "pick_checked"`, `invoiceNo: null`, `invoicedAt: null`, `isRemoved: false`, `dispatchStatus: "dispatch"`, **`isChallanOrder: false`** (2026-10-06, `f59a7f17`), AND hide-exclusion | **all dates** — no date fence |
| **Info** ("Already invoiced", read-only) — `buildBillingInvoicedInfoWhere` | `workflowStage IN (pick_checked, dispatched)`, `invoiceNo` not null, `invoicedAt: null`, `isRemoved: false`, and **checked OR direct-loaded in the IST day** (`pickAssignment.checkedAt` or `directLoadedAt`, the latter since 2026-10-03, `b1b56688`), AND hide-exclusion; `dispatchStatus` not pinned | the header's day |
| Marker `latest` — `buildBillingMarkerWhere` | `OR(pending, info)` | — |

The info arm includes `dispatched` since `551069aa` (2026-09-11); the pending arm stays on
`pick_checked` only. The Done area also lists bills marked done that day, keyed on `invoicedAt`
(`app/api/billing/picking/list/route.ts`; no hide filter on that arm). Since 2026-10-20 the list
carries the typed ship-to (`shipToText`, `isRedirected`).

**Split OBDs (Add invoices) — checked 2026-10-24, nothing to change.** The tab is PER OBD and reads only
`orders.invoiceNo` / `orders.invoicedAt`; nothing in it reads `order_invoices`, and there is **no
per-invoice "invoiced" concept** anywhere (only mark-done and undo write `invoicedAt`, plus the
direct-load undo clearing it). That stays right because a split OBD always has SAP's number: Add invoices
refuses a bill with none ("Wait for the SAP invoice — this bill has no invoice number from SAP yet",
`lib/order-invoices/rules.ts`), the seq-1 row mirrors `orders.invoiceNo`, and a split never writes
`orders`. So a split OBD is **never in Pending**; it shows in Info (checked / direct-loaded that day,
not yet marked) or in Done, under SAP's FIRST invoice number only — the hand-typed seq 2..n numbers are
not shown on this tab (they are on Floor and Print). Live 2026-10-24: the one split OBD, 18648, is
`pick_checked` with `invoiceNo` I536230716 and `invoicedAt` null.

### Routes

| Route | Method | Gate (`billing_picking`) | Write |
|---|---|---|---|
| `/api/billing/picking/list` | GET | canView | none |
| `/api/billing/picking/marker` | GET | canView | none |
| `/api/billing/picking/order/[orderId]` | GET | canView | none |
| `/api/billing/picking/mark-done` | POST `{ orderIds }` | canEdit | one `orders.updateMany` stamping `invoicedAt` + `invoicedById`, WHERE = pending predicate AND ids; max 200 ids; idempotent |
| `/api/billing/picking/undo` | POST `{ orderIds }` | canEdit | one `orders.updateMany` clearing both, WHERE `invoicedAt` in IST today AND `invoiceNo: null` AND `isRemoved: false` |

- Neither write adds an `order_status_logs` row (the mark-done route header).
- The client hides Undo unless canEdit, the row is not an info row, the day is today, and
  `invoiceNo` is null (`billing-picking-tab.tsx`).
- The marker's `count` is pending-only; `latest` is over the union.

### Confirmed findings and the detail panel

- The list computes `hasConfirmedShortage` and `hasFinding` from one batched
  `pick_findings` read with `recordedById: { not: null }` (`list/route.ts`;
  `lib/billing/types.ts`). Confirmed only — never inferred from `qtyFound` or `reason`.
- **A bill with a confirmed finding has no checkbox** and can never enter a bulk
  Mark done (`selectableRows` in `billing-picking-tab.tsx`; `93291cbc`). The selection helper
  refuses its id as well.
- Clicking a Pending row opens `components/billing/billing-order-detail-panel.tsx`, fed by
  `GET /api/billing/picking/order/[orderId]`. The read is `loadBillingOrderDetail`
  (`lib/billing/order-detail.ts`, moved there in Print v2 `6638782f` and shared with the Print panel),
  with **no stage or invoice fence**, plus an `isPending` fact built from `buildBillingPendingWhere()`
  itself.
- The panel's **Mark done** posts a one-element `orderIds` to the same mark-done route, shown only when
  `canEdit && detail.isPending`. It is shown for every pending bill; for a flagged bill it is the only way.
- The panel does not reuse `components/floor/detail-panel.tsx` or `/api/floor/order/[orderId]`,
  which is gated on `floor` (`billing-order-detail-panel.tsx` header).

---

## 7. Print tab — Billing Print v2

Trips Floor has **sent to billing**. Billing copies each trip's **OBD numbers** (or, with Copy inv, its
SAP **invoice numbers**) and pastes them into SAP, which prints; Orbit prints nothing. Billing Print v2,
2026-10-05 (Schema v27.56, `6638782f` server); Copy inv 2026-10-07 (v27.61, `d51e7671`); copies per
invoice row 2026-10-17 / 23 (P5-4 `68f10b94`, P5-5 `a05769b7`, v27.74). The rules live in
`lib/billing/print.ts` (its header, rules 1–7) and `lib/order-invoices/copy-plan.ts`, and nowhere else.

🔴 *History: slice 9 (2026-09-15, `22ced2d8` + `6d008f8e`) copied a trip's INVOICE numbers as one set —
"invoice numbers are distinct; N counts numbers", "never a partial set" (copyable only once every non-held
bill had a number), one `invoices_copied` activity row per press holding the numbers, `copyTripInvoices`,
states `uncopied` / `reopened` / `copied`. Print v2 replaced all of it on 2026-10-05 (the 39 `backfill`
copy rows carried the old copies over). Do not restore it.*

**Fed by Floor.** The planner's Send to billing (`POST /api/floor/trips/[id]/billing`, gated `floor`
canEdit) stamps `trips.sentToBillingAt`. The trip side — sending, taking back (ALWAYS allowed since
2026-10-05; the "refused once billing copied" lock is gone), the challan-only refusal — is
`CLAUDE_FLOOR_TRIPS.md` §12.

### The rules (`lib/billing/print.ts` header — owner decisions of 2026-10-05 / 06 / 07)

1. **Held bills are out.** `orders.dispatchStatus = 'hold'` — shown, marked, never copied by an OBD press,
   never counted.
2. **The clipboard carries OBD numbers**, one per bill. An invoice number is NOT needed for a bill to be
   copyable; it is shown when SAP has stamped it.
3. **A bill is READY when its picking is Done**, exactly as Floor's status pill says Done: `workflowStage ∈
   {pick_checked, dispatched}`. A ready bill with a CONFIRMED pick finding (`pick_findings.recordedById`
   not null) is in **REVIEW** instead: never in the bulk Copy; billing opens it, reads the finding and marks
   it done from the panel.
4. **Copies are per bill and may be partial.** Every press writes one `trip_bill_copies` row per bill —
   per INVOICE ROW since v27.74 (below); a second press on the same row is skipped; the next press copies
   only what became ready since.
5. **Done is a press.** When every non-held bill is copied, billing presses **Done — all copied**
   (`trips.billingDoneAt`). A done trip whose bills change (a bill joins, a hold lifts) **REOPENS** until
   those are copied — except a DISPATCHED done trip, which never reopens.
6. **Challan orders are never on Print** (2026-10-06). An ORB order (`orders.isChallanOrder`) is the challan
   itself: not shown, not counted, never copyable, never makes a trip ready or not; a trip carrying ONLY
   ORB orders is not on the tab at all (`challanOnly`) and Send to billing refuses it. One owner:
   `BILLABLE_BILL_WHERE` (`lib/challan-orders/where.ts`).
7. **Copy inv — an invoiced bill needs no checks** (2026-10-07, v27.61). OBD copy waits for picking Done
   because a finding can force a revision; once SAP has stamped an invoice number the bill is final. Copy
   inv copies every bill that HAS an invoice number and NO copy row on this trip yet — **any picking state,
   held included** — as kind `invoice`, an ordinary copy row (counts for Done / reopen / pending exactly
   like an OBD copy). The clipboard carries each DISTINCT invoice number once; every bill carrying it is
   recorded (an invoice PAIR — one invoice on two OBDs — is one number, two rows).

**Copied state is keyed on THIS trip.** A bill copied on an earlier trip reads uncopied here and carries a
quiet `copiedOnOtherTrip` note (that trip's number and time). A bill MOVED between trips keeps its copy row
on the source (owner 2026-10-17 — `CLAUDE_FLOOR_TRIPS.md` §7.1).

### States

| Bill (`PrintBillState`) | Meaning |
|---|---|
| `held` | On hold — outranks everything |
| `copied` | Has a copy row on THIS trip (a split bill: every invoice of it here is covered) |
| `ready` | Picking Done, no confirmed finding, not copied — goes in the bulk Copy |
| `review` | Picking Done WITH a confirmed finding — opened and marked one by one |
| `waiting` | Picking not Done — nothing to copy by OBD |

| Trip (`PrintTripState`) | Meaning |
|---|---|
| `open` | Done not pressed |
| `reopened` | Done pressed, and since then a non-held bill arrived uncopied — never on a dispatched trip |
| `done` | Done pressed and nothing outstanding (or the trip is dispatched) |

`canDone` = Done not pressed, ≥ 1 non-held bill, every non-held bill copied. A trip is on the tab when
`sentToBillingAt` is set, `status <> 'cancelled'` and it is not challan-only.

### A SPLIT OBD on Print (Add invoices P5-5) — one line per invoice

A split OBD (one OBD that SAP billed as several invoices — `CLAUDE_ORDER_INVOICES.md`) comes back ONCE
per trip (`placeOnTrips`, its lowest-seq row's stop there) with `invoices` = **its invoices ON THIS TRIP**,
seq order, each a `PrintInvoiceLine`: number + date, **"k/n"** (k and n count ALL the OBD's invoices),
litres and kg of that invoice (`loadSplitInvoiceRows`; kg exact or shared), and **its own copy state**
(`copiedAt`, by, kind, `copiedWhole`, `copiedOnOtherTrip`). The bill's own litres are those invoices'
(`placeLoad`) when only some are on the trip. The bill reads `copied` only when EVERY line is; partly
copied → its picking state decides, and the next press writes only the rest.

**The copy rules** (`copy-plan.ts`, pure; tests `copy-plan.test.ts`):
- **UNSPLIT → one row, on seq 1** — the whole OBD, exactly as before.
- **SPLIT → one row per invoice of it ON THAT TRIP not copied there yet.** A bulk / single / review press
  (OBD number on the clipboard) writes every such invoice; a Copy inv press only the invoices whose
  numbers went on the clipboard (`planCopyRows`). Copy inv sends a split bill once PER INVOICE (its id
  repeated, each with that invoice's number); every number sent must be one of its uncopied invoices here
  (`badSentNo`), else 409 "Invoice {no} of OBD {obd} was already copied or is no longer on {trip} —
  nothing was recorded. Refresh."
- **A copy taken BEFORE THE SPLIT covers every invoice** of that OBD on its trip: an invoice is copied on a
  trip when a copy row there names it, OR names ANY row of the OBD and was taken before the first seq ≥ 2
  row's `createdAt` (`isWholeObdCopy`, `coveringCopy`; the line's `copiedWhole`). That copy was of the
  whole bill; it is **never rewritten**. Live: **copy 276** (trip 605 L-261006-05, `bulk`, 2026-10-06
  11:03 IST, on row 17010 = I536230716) predates order 18648's split (2026-10-12), so 713 + 715 on that
  trip read copied, "whole OBD, before the split".
- **"Work outstanding" uses the same rule** (`getPrintWorkTripIds`, one SQL statement): a trip is pending
  while Done is not pressed, or (not dispatched and) some non-held, billable invoice row on it has no copy
  naming it and no whole-OBD copy older than its split.

### What a press writes — `copyTripBills` (`lib/billing/print.ts`)

`POST /api/billing/print/trip/[id]/copy`, `{ orderIds, kind, invoiceNos? }`; kinds (`PRINT_COPY_KINDS`):
- `bulk` — "Copy N OBDs": every READY bill of the trip.
- `single` — "Copy this one" on a ready bill's panel (exactly one bill).
- `review` — "Mark done" on a REVIEW bill (exactly one bill).
- `invoice` — "Copy inv" (rule 7): `invoiceNos` REQUIRED, parallel to `orderIds` — the number the screen
  showed per bill; a split bill repeated once per invoice.
- (`backfill` is the v27.56 one-off; no press writes it.)

🔴 **The client puts the numbers on the clipboard FIRST, then posts exactly those bills.** The server
re-derives every bill (`loadPrintTrips`) and records ONLY if each is still what the kind needs — bulk /
single → `ready`, review → `review`, invoice → no copy row here and the same live number — else **409 and
nothing is written** ("OBD {obd} was already copied — …", "… changed since your screen loaded (now {state})
— …", "OBD {obd}'s invoice number changed since your screen loaded — …", "A bill is no longer on {trip} —
…"; 400 "A {kind} copy takes exactly one bill.", "An invoice copy needs one invoice number per bill.").
Then: the rows go in with `createMany skipDuplicates` over `trip_bill_copies_trip_invoice_key` (a bill
none of whose rows landed was copied by someone else first — counted in `alreadyCopied`); then, only when
something landed, `trips.billingCopiedAt / ById` and ONE `bills_copied` activity row (`detail.kind`, and
`detail.invoiceNos` for Copy inv). Answer `{ tripNumber, recorded, alreadyCopied, obdNumbers, invoiceNos,
billingCopiedAt }`.

**Done** — `POST /api/billing/print/trip/[id]/done`, no body → `markTripBillingDone`: only when `canDone`
(else 409 "{trip}: N bills are not copied yet." / "{trip} has no bills to copy."); a conditional update on
`billingDoneAt IS NULL` (two presses record once), one `billing_done` activity row; an already-done trip
answers `changed: false`. Done is manual — nothing stamps it automatically.

🔴 **Every Print write is to `trips`, `trip_bill_copies` and one activity row — NEVER an order row.**

### Routes

| Route | Method | Gate (`billing_print`) | Does |
|---|---|---|---|
| `/api/billing/print/list` | GET `?date=` | canView | `{ pending, copied }` — pending = every trip with work outstanding, ALL DATES, oldest sent first; `copied` = trips Done on one IST day (keyed `billingDoneAt`, newest first; the screen calls it "Done today") |
| `/api/billing/print/marker` | GET | canView | `count` = `getPrintCount` (`lib/billing/marker-counts.ts`) = the length of `getPrintWorkTripIds`, the same pending set; `latest` = `getPrintMarkerLatest` — MAX over trips, sent trips' activity, their bills' `orders.updatedAt` (through invoice rows), confirmed findings, and copy rows |
| `/api/billing/print/order/[orderId]?tripId=` | GET | canView | The bill's panel: `{ detail, bill, trip }` (`lib/billing/order-detail.ts`, the Picking panel's read). **Fenced**: the bill must be on `tripId` and that trip on Print, else 404 "This bill is not on that trip, or the trip is not on Print" |
| `/api/billing/print/trip/[id]/copy` | POST | **canEdit** | `copyTripBills` (above) |
| `/api/billing/print/trip/[id]/done` | POST | **canEdit** | `markTripBillingDone` (above) |

### The screen (`components/billing/billing-print-tab.tsx`)

- **Left (portalled into the page's 320px rail slot):** "N trips to copy · any date", trips with work
  outstanding grouped by trip type (Local · UPC · IGT / Cross · Other), each group by trip number; a card is
  the trip number only (never the vehicle), "copied / eligible", chips ("N copied", "N ready", "N to check",
  Floor's not-picked pills, "all on hold" / "no bills") and a 3px bar. Below, **Done today** (collapsed by
  default; "Done · DD Mon" on another date): trip number · "✓ HH:MM · first name". Empty: "No trip is
  waiting to be copied."
- **Right — the selected trip:** number, summary ("N copied · N ready · N to check · … · N on hold, not
  copied", or "✓ Done HH:MM · Name · all N copied"), a progress bar, ONE action button plus the plain Copy
  inv, a legend, and the bill table — **# · OBD · Invoice no ("— not yet") · Ship to · Vol · Picking (Floor's
  own `StatusPill`) · Copy**. The Copy cell: copied "✓ HH:MM" (+ "inv" for a Copy inv), ready "next copy",
  review "open to copy →", waiting "not picked yet", held "on hold · OBD not copied". Nothing truncates.
- **A split OBD draws one line per invoice on the trip** — #, OBD, ship-to and the pill on the first line
  only; each line its own invoice number + "k/n" ("Invoice k of n of this OBD"), litres and kg ("~" when
  not exact), and its own copy cell: "✓ HH:MM" / "inv" / **"✓ … · whole OBD, before split"** / "copied on
  {trip} · HH:MM" / held "on hold · not copied"; an uncopied line falls back to the bill's state.
- **The buttons:** "Copy N OBDs" (clipboard = `readyObds`, one per line → `bulk`), "Copy · nothing ready"
  disabled with its reason ("N with a pick finding — open it to copy." / "N still being picked." / "Every
  bill is copied." …); "Done — all copied" when `canEdit && canDone`; **"Copy inv"** whenever invoices are
  pending, on open, reopened and done trips alike (clipboard = `invoicePendingNos`, each distinct number
  once → `invoice` with `invoicePendingBillNos`; captioned "N inv — any picking state, held included.").
  **Ctrl+C** runs the bulk Copy only (never Copy inv), ignored while typing, selecting text or with a panel
  open. A done trip has no main button; a reopened trip shows the normal ones (Done comes back only when it
  is copied again).
- **The bill panel** (`BillingOrderDetailPanel mode="print"`, from `/api/billing/print/order/…`): ready →
  **Copy this one** (`single`); review → "⚠ Pick finding confirmed by X at HH:MM — check the red line before
  copying.", **Copy OBD** (clipboard only) and **Mark done** (`review`); copied → "✓ Copied HH:MM by Name" and
  Copy again (clipboard only); waiting / held explain why not; "Copied before on {trip} at HH:MM". It copies
  the OBD number — no per-invoice copy in the panel.
- **Without `billing_print` canEdit** every Copy is a plain clipboard copy that records nothing ("Copies to
  the clipboard only — records nothing."), and Done is not drawn.
- Messages are an inline notice bar ("Couldn't reach the clipboard — … Nothing was recorded.", "N bills
  had already been copied by someone else — not recorded again.", "Copied, but could not reach the server —
  NOT recorded. Press Copy again."); the only toast is "{trip} moved to Done today".
- Re-delivery rows are not on Print: Print reaches bills through their invoice rows' own `tripDropId`,
  and a re-delivered bill keeps its first trip's (`CLAUDE_FLOOR_TRIPS.md` §12b).

---

## 8. Live sync — the live feed, and the marker providers as fallback

**Two paths, one switch** (live feed 2b-ii, 2026-09-30). `components/billing/billing-live.tsx`
(`BillingLiveRoot`) is gated on `app_settings` **`live.feed` AND `live.feed.billing`** (absent = OFF) —
**both ON live** (read 2026-10-24). *(This section described only the marker polls until 2026-10-24.)*

- **On the feed (the live path):** ONE `useLiveFeed` for the whole face, topics `BILLING_TOPICS =
  "order,trip,config,mail_order,so_tag"` (`lib/billing/live-rule.ts`). Each glance that saw changes makes
  ONE `POST /api/billing/sync` (`mail_orders` canView + each arm's own canView) and fires only the touched,
  permitted arms' subscribers — `BILLING_ARMS = ["picking","print","telephonic","pickDelete"]`
  (`armsToFire`); too many ids → a full refresh (`tooManyForSync`). A `mail_order` change reloads the
  Orders list at most once per glance, held while the operator is mid-action (`ordersPaused`). Pill counts
  come from the sync answers (`useBillingLiveCounts`), so no marker is fetched. Tabs report the ids they
  show (`useBillingShownIds` — Print: trips under `print`, bills under `printOrders`). Never
  `router.refresh()` (CORE §3).
- **Off the feed (fallback — off, unknown on a browser that never saw it on, or after repeated errors):**
  `components/billing/billing-marker-provider.tsx` mounts one `MarkerPoll` per arm exactly as before —
  `/api/billing/picking/marker`, `/print/marker`, `/telephonic/marker` every 30 s
  (`BILLING_MARKER_POLL_MS`), `/pick-delete/marker` every 10 s (`BILLING_PICK_DELETE_POLL_MS`), all through
  `usePickingMarker` (`CLAUDE_PICKING.md §10`). The providers register a handle with the live root, so a
  tab subscribes the same way on either path.
- Disabled (no key), a provider is a pass-through: no timer, no fetch.
- **Pause:** the Picking tab pauses while rows are selected or a write is in flight; the Print tab while a
  write is in flight (`print-tab-write`) or a panel is open (`print-tab-panel`; the panel's own write is
  `print-detail-write`).
- **The Orders tab's own marker** (`GET /api/mail-orders/marker`, 30 s via `usePickingMarker`, `mail_orders`
  canView) runs only off the feed. Its internals belong to `CLAUDE_MAIL_ORDERS.md`.

---|---|---|---|
| `BillingMarkerProvider` — one shared poll for the Picking pill and the Picking tab (`billing-marker-provider.tsx:150-163`; `abcf9fdd`) | `/api/billing/picking/marker` (`:33`) | `billingV2 && canViewPicking` | tab bar count (`billing-tab-bar.tsx:141`), Picking tab refetch (`billing-picking-tab.tsx:182`) |
| `BillingPrintMarkerProvider` — a separate poll (`billing-marker-provider.tsx:175-216`) | `/api/billing/print/marker` (`:175`) | `billingV2 && canViewPrint` | tab bar count (`billing-tab-bar.tsx:103`), Print tab refetch (`billing-print-tab.tsx:192`) |

- Cadence 30s, `BILLING_MARKER_POLL_MS` (`billing-marker-provider.tsx:47`). Both run through
  `usePickingMarker` (`:129-140`); mechanics in `CLAUDE_PICKING.md §10`.
- Disabled, a provider is a pass-through with an inert context: no timer, no fetch
  (`:159-161`, `:208-210`). A viewer without the key makes no marker requests.
- The tab bar also fetches each count once on mount, gated separately on `showPicking` /
  `showPrint` (`billing-tab-bar.tsx:85-130`). Both gates are needed.
- Pause: the Picking tab pauses the shared poll while rows are selected or a write is in flight
  (`billing-picking-tab.tsx:190`); the Print tab while a copy is in flight
  (`billing-print-tab.tsx:194`).
- **The Orders tab does not use these.** It polls `GET /api/mail-orders/marker` at 30s via
  `usePickingMarker` (`mail-orders-page.tsx:366-372`, `:90`; `0cbe73ef`), gated on
  `mail_orders` canView (`app/api/mail-orders/marker/route.ts:87`). Its internals belong to
  `CLAUDE_MAIL_ORDERS.md`.

---

## 9. Notes-band font size

A per-user size, in px, for the remark text in the Orders tab's notes band.

- **Column:** `users.notesFontSize Int @default(11)` (`prisma/schema.prisma:164`). Live:
  `integer`, NOT NULL, default 11 (live 2026-09-18, Q10a). The schema comment records a
  CHECK `chk_users_notes_font_size` (11–20) (`schema.prisma:152-154`); the CHECK itself was
  not in the 2026-09-18 query set — see §12.
- **Read:** `getNotesFontSize(userId)` (`lib/mail-orders/notes-font-size.ts:52-81`), called
  once in the layout (`layout.tsx:115`), fresh per load, not on the JWT. **Fails soft to 11**:
  non-finite id, null value, P2022 (silent) or any other error (logged). Values are clamped
  to 11–20 (`notes-font-size.ts:39-42`).
- **Courier:** `NotesFontSizeProvider` (`components/mail-orders/notes-font-size-provider.tsx`),
  default 11; it seeds page state only (`:37-42`). The page owns the live value
  (`mail-orders-page.tsx:284-285`).
- **Write:** `POST /api/user/notes-font-size`, body `{ size }`
  (`app/api/user/notes-font-size/route.ts`). Session-only, no page key; user id from the
  session, never the body (`:19-32`); integer 11–20 or 400, no clamping (`:45-59`); one
  primary-key update (`:63-66`). There is no GET (`:14-17`).
- **Client:** the −/+ stepper renders on the billing face only (`review-view.tsx:2158`);
  ends are disabled at 11 and 20 (`review-view.tsx:2108-2127`). A save is optimistic and
  reverts with a toast on failure (`mail-orders-page.tsx:639-652`). The old localStorage key
  `mo-review-notes-font-size` is removed once per browser (`review-view.tsx:253`, `:713-722`).

---

## 10. Schema this file relies on

Full column text and constraints: CORE §7 (the blocks named below) and its chain. This table says only
what Billing reads or writes.

| Table.column | Type | Written by | Notes |
|---|---|---|---|
| `billing_settings` (`id`, `scope` default `"GLOBAL"` unique, `rolloutStage` default `"OFF"`, `updatedAt`, `updatedById`) | — | Smart Flow, by hand | One live row: `ALL_USERS`, updated 2026-08-06 10:41 (re-read 2026-10-24) |
| `users.billingV2TestUser` | Boolean default false | Smart Flow | read only on `TEST_USERS_ONLY` |
| `users.notesFontSize` | Int default 11 (v27.25) | `POST /api/user/notes-font-size` | §9 |
| `orders.invoicedAt` / `invoicedById` | Timestamptz / Int, named relation `OrderInvoicedBy` | Picking mark-done, undo | Per OBD — there is no per-invoice "invoiced" (§6) |
| `trips.sentToBillingAt` / `sentToBillingById` | Timestamptz / Int, FK `ON DELETE SET NULL` (v27.35) | `lib/trips/billing.ts` — owned by `CLAUDE_FLOOR_TRIPS.md` §12 | |
| `trips.billingCopiedAt` / `billingCopiedById` | Timestamptz / Int, FK `ON DELETE SET NULL` (v27.35) | `copyTripBills` | Since v27.56 means only "the latest copy press" |
| `trips.billingDoneAt` / `billingDoneById` | Timestamptz / Int, FK stored lowercase `trips_billingdonebyid_fkey` `ON DELETE SET NULL` (v27.56) | `markTripBillingDone` only | The manual Done (§7). Live 2026-10-24: 119 of 121 sent trips done |
| **`trip_bill_copies`** (v27.56; `kind` `'invoice'` v27.61; `orderInvoiceId` v27.66, NOT NULL v27.74) | 10 columns — `id`, `tripId`, `orderId` (denormalised read key), `orderInvoiceId` → `order_invoices` RESTRICT, `obdNumber` + `invoiceNo` (snapshots; on a split bill's row, that invoice's number), `kind`, `copiedAt`, `copiedById` (NULL only for `backfill`), `createdAt` | `copyTripBills` only (+ the one-off v27.56 PART C backfill) | **UNIQUE `trip_bill_copies_trip_invoice_key` (`tripId`, `orderInvoiceId`)** = the race guard — ONE ROW PER INVOICE ROW PER TRIP. `chk_trip_bill_copies_kind`: `bulk` · `single` · `review` · `backfill` · `invoice`; `chk_trip_bill_copies_actor`. FKs trips / orders RESTRICT. Live trigger (trip child). Live 2026-10-24: 857 rows — bulk 582 · invoice 210 · backfill 39 · review 21 · single 5. Never writes `orders`. CORE §7.16 |
| `trip_activity.action` `bills_copied` / `billing_done` (v27.56); `invoices_copied` (slice 9, historical) | text, in `chk_trip_activity_action` (18 values) | `logTripBillsCopied` / `logTripBillingDone`; nothing writes `invoices_copied` since 2026-10-05 | Table owned by `CLAUDE_FLOOR_TRIPS.md` §3.3 |
| `order_invoices` (v27.63 / v27.66) | read only | — | A split OBD's invoices on a trip (§7). Owner `CLAUDE_ORDER_INVOICES.md` |

---

## 11. Landmines and known defects

**Known defects — recorded, not fixed.**

- ~~🔴 **Dead shortcut label "E · Slot email"**~~ — **FIXED 2026-09-24**: removed from `MO_SHORTCUTS`; only a
  comment in `mail-orders-page.tsx` records it.
- 🔴 **`@page mo-landscape` is still nested inside `@media print`** (`app/globals.css`), applied to
  `#mo-print-area`, the billing right pane. This breaks router rule §1 (`@page` rules top-level). The
  file's own MRN comment calls it a pre-existing violation. Whether the print still comes out A4 landscape
  needs a real print test before anyone moves it.
- **Print — copied bills move freely** (owner 2026-10-17): a bill moved to another trip keeps its copy row
  on the source and reads uncopied on the target, so billing could copy it twice. Deferred to the
  billing-workflow redesign (ROADMAP; `CLAUDE_FLOOR_TRIPS.md` §17 item 16).
- **Print — an unsplit bill's `copiedOnOtherTrip`** is shown only in the panel, not in the table (a split
  line shows "copied on {trip} · HH:MM" in its cell).

**Landmines.**

- **Hide, never disable** the action buttons and tab controls — Billing's own rule (code comments cite
  "CLAUDE_UI §10"; that section holds only "Disabled buttons are grey, never faded primary"). The server
  re-checks every key; the providers only decide what is drawn.
- **`billing_picking` is not `picking`.** `picking` is the floor board key; reading it here would show the
  tab to pickers.
- **Never add a date fence to the Picking pending arm**, and never widen it to `dispatched`
  (`picking-where.ts`).
- **Undo's `invoiceNo: null` is load-bearing.** **The info arm's `invoicedAt: null` is load-bearing** —
  without it a row renders twice.
- **The `soNumber` guard in the actions route is load-bearing.**
- **Hold case differs per table** — capitalised on `mo_orders`, lowercase on `orders`.
- **An OBD-level hold write must call `mirrorObdHoldSafe`** (the actions route does) — `CLAUDE_ORDER_INVOICES.md §4.4`.
- **Print: never restore slice 9's "never a partial set", "invoice numbers distinct" or one-row-per-OBD
  copies** (§7 history line). Copies are per INVOICE ROW per trip; a whole-OBD copy older than a split
  covers every invoice and is never rewritten.
- **Print never writes an order row** — only `trips`, `trip_bill_copies` and one activity row.
- **The clipboard is filled BEFORE the copy is recorded**, and the server records only what the screen
  showed (409 otherwise). Never record first.
- **Four copies of the 11–20 notes bound.** The lib constants (`notes-font-size.ts`), the POST route (which
  imports them), the DB CHECK (per schema comment), and a second literal pair in `review-view.tsx`.
  Widening the range means changing all of them, constraint first.
- **Stale code comments — claims, not facts** (re-checked 2026-10-24): `lib/permissions.ts` "REGISTERED
  ONLY — NOTHING READS IT YET" (the `billing_picking` union comment) and the `ACTION_PAGES` `billing_picking`
  entry ("not yet backed by a check … against `mail_orders`") are false — §4–§6 are the reading sites. (The
  "Nothing reads these yet" and "THE CHECKS THESE ANTICIPATE DO NOT EXIST YET" comments are gone.)
  `lib/billing/flag.ts` describes `TEST_USERS_ONLY`; live is `ALL_USERS` (§2). `picking-where.ts` still
  cites mark-done `:96` and undo `:85` — find them by name. `lib/billing/print.ts` "Counts, litres and
  copies stay PER OBD until Phase 5" — already per invoice (canon plan step 4c, B6).
- **Orphan.** `components/billing/billing-order-info.tsx` has no importer (only comments mention it). Kept
  per the no-delete rule.

---

## 12. Open items (pointers only)

- Real print test of the billing print path (§11).
- ~~Fix the dead "E · Slot email" label~~ — DONE 2026-09-24.
- ~~Who the five holders of each billing key are~~ — read 2026-10-24: every billing key has 5 view + 5 edit
  holders; `billing_print` = Deepanshu Thakur #25, Prakash #32, Bankim #26, Chandresh Kolgha #21,
  Operations User #20 (§4). Whether they match the `mail_orders` editors is not checked.
- Whether `chk_users_notes_font_size` and a CHECK on `billing_settings.rolloutStage` exist live — both
  are code/schema-comment claims.
- Retiring the dormant flag-OFF face (§2) is an owner decision; method in `archive/RETIREMENT-PLAYBOOK.md`.
- Stale code comments (§11) belong to the code-comment pass (canon plan step 4c, B6).
- Billing workflow redesign: copies on a moved bill (§11).
- The Print panel copies the OBD number only — no per-invoice copy from the panel on a split bill (the
  table's Copy inv does it). Recorded, not asked for.
- ~~`CLAUDE_MAIL_ORDERS.md §23` and the router's billing row need pointing here~~ — DONE: MAIL_ORDERS v1.14 (`915f46f2`), router v1.13 (`349c6929`).

## Change log

- **v1.1 — 2026-10-24 (canon batch B4: Print v2 + per-invoice copies, and a reconciliation to Schema
  v27.74).** Evidence: the code at `f6b39886` (`lib/billing/print.ts`, `lib/order-invoices/copy-plan.ts`,
  `app/api/billing/print/**`, `billing-print-tab.tsx`, `billing-live.tsx`, the actions route, the tab bar,
  `lib/permissions.ts`), `git show --stat` of `d51e7671` / `68f10b94` / `a05769b7`, CORE's v27.56 / v27.61 /
  v27.74 entries, and read-only SELECTs on 2026-10-24. Plan: `docs/prompts/drafts/code-discovery-2026-10-24-canon-add-invoices.md`
  (step 4a, BILLING rows).
  - §1: six tabs (Telephonic, Pick delete, Challan orders added); ownership rows for live sync, §5b, the
    copy rule's code; **fixed** the "UI §10 hide-don't-disable" cross-reference (the rule is Billing's own).
  - §3: provider stack and the tab table (six tabs, badges, live counts). §4: **ten** keys, not six, with
    live holder counts. §5: **six** ticks (Hand, CI); writes PER BILL with `mirrorObdHoldSafe` (was one
    `updateMany` by SO — history line); one of three; the ship-to modal route. New §5b Telephonic + Pick
    delete.
  - §6: the two missing predicate terms (`isChallanOrder: false`, `directLoadedAt`); **split OBDs checked —
    the per-OBD `invoiceNo` / `invoicedAt` reads stay right** (a split OBD always has SAP's number, so it is
    never Pending); line numbers dropped.
  - §7: **rewritten from code** — Print v2 (OBD numbers, ready / review / waiting / held / copied, Done and
    reopen, `billingDoneAt`, the order and done routes), Copy inv (v27.61), `trip_bill_copies` one row per
    INVOICE ROW per trip (v27.74), the split-OBD lines and their own copy state, the whole-OBD-before-split
    rule (copy 276), work outstanding, the screen. **Removed** slice 9's "invoice numbers distinct", "never
    a partial set", `invoices_copied` / `copyTripInvoices` — one dated history line kept.
  - §8: **rewritten** — the live feed (`live.feed` + `live.feed.billing`, ON) is the path; marker polls are
    the fallback. §10: rebuilt (billingDoneAt, `trip_bill_copies`, the activity actions). §11 / §12: the
    E-shortcut defect closed, Print landmines, stale comments re-checked, holders read.
  - Schema stamp **v27.24 → v27.74**: reconciled against CORE v150's chain for every version Billing reads
    (v27.25, v27.35, v27.39, v27.41, v27.42, v27.45 – v27.47, v27.56, v27.60, v27.61, v27.66, v27.73,
    v27.74). Version v1.0 → v1.1.

---

*CLAUDE_BILLING.md v1.1 · Schema v27.74 · OrbitOMS · updated 2026-10-24 — Print v2 + Copy inv + per-invoice copies (one `trip_bill_copies` row per invoice row per trip; split OBDs one line per invoice; the whole-OBD-before-split copy), the live feed path, six tabs and ten billing ticks. Prior, v1.0 (2026-09-18) — first canonical file for the Billing desk (the billing face of /mail-orders: rollout flag, tab bar, Picking tab, Print tab, action ticks, marker providers, notes font size). Written from the code at ec6343ba and the live results of 2026-09-18; drafts are history.*
