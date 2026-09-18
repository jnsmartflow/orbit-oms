# CLAUDE_BILLING.md — Billing desk (/mail-orders, billing face)
# v1.0 · Schema v27.24 · September 2026 · updated 2026-09-18 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md + docs/CLAUDE_MAIL_ORDERS.md

New columns/tables this file relies on are live-verified 2026-09-18; their schema version numbers are assigned in the CORE pass (batch C2).

---

## 1. What it is, and the ownership boundary

The Billing desk is the face `/mail-orders` shows to everyone who can open it. The sidebar
labels the route **Billing** (`lib/permissions.ts:65`); the route, the page key `mail_orders`
and the folder `app/(mail-orders)/` keep their old names. It has three tabs: **Orders**
(punch mail orders into SAP), **Picking** (bills the floor has checked, waiting to be marked
invoiced) and **Print** (trips Floor sent to billing, whose invoice numbers billing copies
into SAP).

**This file replaces the router's old rule.** The router (`CLAUDE.md §3`) and
`CLAUDE_MAIL_ORDERS.md §23` say no billing file exists "while pilot-gated". That rule no
longer applies: the live `billing_settings` row reads `rolloutStage = ALL_USERS`,
`updatedAt 2026-08-06 10:41` (live 2026-09-18, Q01).

### What this file owns

| Owned here | Where it lives |
|---|---|
| The rollout flag and what it switches | `lib/billing/flag.ts`, `components/billing/billing-v2-provider.tsx` — §2 |
| The tab bar and the three tabs' gates | `components/billing/billing-tab-bar.tsx`, `app/(mail-orders)/mail-orders/layout.tsx` — §3, §4 |
| The four action ticks and the actions route | `app/api/billing/mail-order/actions/route.ts`, `components/billing/billing-action-ribbon.tsx` — §5 |
| The Picking tab | `lib/billing/picking-where.ts`, `app/api/billing/picking/**`, `components/billing/billing-picking-tab.tsx`, `billing-order-detail-panel.tsx` — §6 |
| The Print tab | `lib/billing/print.ts`, `app/api/billing/print/**`, `components/billing/billing-print-tab.tsx` — §7 |
| The billing marker providers | `components/billing/billing-marker-provider.tsx` — §8 |
| Notes-band font size | `users.notesFontSize`, `app/api/user/notes-font-size/route.ts`, `lib/mail-orders/notes-font-size.ts` — §9 |

### What it does not own — cross-referenced, never restated

| Billing uses | Owner |
|---|---|
| Parser, enrichment, customer matching, ship-to matching | `CLAUDE_MAIL_ORDERS.md §3–§6` |
| The Review view and Orders-list internals (`review-view.tsx` cards, signals, split, punch, smart copy, keyboard map) | `CLAUDE_MAIL_ORDERS.md §8–§12` |
| Tag gating (`app_tag_settings`, `getOrderSignals`) | `CLAUDE_MAIL_ORDERS.md §21` + `CLAUDE_CORE.md §7.10` |
| `mail_orders` grants and the mail-orders write routes | `CLAUDE_MAIL_ORDERS.md §22` + `CLAUDE_CORE.md §5` |
| `GET /api/mail-orders/marker` (the Orders tab's poll) | `CLAUDE_MAIL_ORDERS.md` |
| Trips, `trips.sentToBillingAt`, Send to billing, take-back | `CLAUDE_FLOOR_TRIPS.md` (Send to billing) |
| What a pick finding is, and how it is confirmed | `CLAUDE_PICKING.md §11` |
| The marker hook `usePickingMarker` | `CLAUDE_PICKING.md §10` |
| `checkAnyPermission`, the admin/superuser bypass, `user_page_access` | `CLAUDE_CORE.md §5` + `§7.14` |
| `UniversalHeader` props, UI §10 hide-don't-disable | `CLAUDE_UI.md §6`, `§10` |

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
`BillingV2Provider` → `BillingPickingAccessProvider` → `BillingActionsAccessProvider` →
`BillingPrintAccessProvider` → `NotesFontSizeProvider` (`layout.tsx:130-158`). The access
booleans come off the same `allPerms` map the layout built for the sidebar
(`layout.tsx:35`, `:70-99`); admin/superuser is already resolved to all-true inside
`getAllPermissionsForRoles` (`lib/permissions.ts:889-894`). All providers default to false.

**The tab bar** (`components/billing/billing-tab-bar.tsx`) sits at the top of the right pane
(`review-view.tsx:2929-2945`). `BillingTab = "orders" | "picking" | "print"` (`billing-tab-bar.tsx:20`).

| Tab | Pill shown when | Body mounted when | Badge |
|---|---|---|---|
| Orders | always (`billing-tab-bar.tsx:175`) | default | mail orders still unpunched (`review-view.tsx:810-813`) |
| Picking | `billing_picking` canView (`billing-tab-bar.tsx:181`) | `billingV2 && billingPickingCanView && billingTab === "picking"` (`review-view.tsx:2948`) | `count` from `/api/billing/picking/marker` |
| Print | `billing_print` canView (`billing-tab-bar.tsx:184`) | `billingV2 && billingPrintCanView && billingTab === "print"` (`review-view.tsx:2955`) | `count` from `/api/billing/print/marker` |

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

All six are **page keys** in the `PageKey` union (`lib/permissions.ts:205`, `:269-295`), not
role slugs. None is in `PAGE_NAV_MAP`: they are tabs and buttons inside `/mail-orders`
(`lib/permissions.ts:264-267`, `:274-275`). All six are listed in `ACTION_PAGES.canEdit`
(`lib/permissions.ts:419-432`), so `/admin/access` draws an Edit switch for each. Labels use a
`Billing ·` prefix (`lib/permissions.ts:511-524`). Live access mode is `user`
(`user_page_access`) (live 2026-09-18, Q02).

| Page key | Meaning | Server gate | Client gate | Live `user_page_access` (live 2026-09-18, Q03a) |
|---|---|---|---|---|
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

### The four ticks — dual gate on the server, hidden on the client

`POST /api/billing/mail-order/actions` serves Hold, Slot, Urgent and Ship-to. **Both gates must pass:**

1. `mail_orders` canEdit — `actions/route.ts:72-76`.
2. The per-action key, canEdit — `ACTION_KEY` map `actions/route.ts:122-127`, check
   `actions/route.ts:136-139`. The 403 names the action (`actions/route.ts:129-134`), and
   `lib/billing/mo-actions.ts` passes that text to the ribbon. Set and clear share one key
   (slot set/clear → `billing_slot`, ship-to set/clear → `billing_ship_to`) so nobody can
   create a state they cannot undo (`actions/route.ts:115-118`). Wired by `a991a1c4` (2026-09-12).

Admin and superuser pass both inside `checkAnyPermission` (`lib/permissions.ts:795`, `:799`).
A refusal writes no audit row (`actions/route.ts:120-121`).

**Client: hidden, never disabled.** The layout reads the four canEdit values
(`layout.tsx:96-99`) into `BillingActionsAccessProvider` (`components/billing/billing-actions-access-provider.tsx`;
default all-false, `:52-56`). The ribbon renders each button only if its tick is held
(`billing-action-ribbon.tsx:106`, `:118`, `:139`), wraps the whole Slot picker so no invisible
trigger survives (`:135-139`), and returns `null` when none of the three is held
(`:98`). The ship-to pencil resolves to `undefined` without `billing_ship_to`
(`review-view.tsx:2249-2256`). The provider is for drawing only; the route is the lock
(`billing-actions-access-provider.tsx:29-33`). Hiding a button never changes data: a held bill
stays held (`:35-37`).

**Filter chips follow the ticks** (`f1dcfa58`): on the billing face the Dispatch chips
(Hold/Dispatch) need `billing_hold`, the Priority chips need `billing_urgent`, and the Key
dealer chip follows the `keyCustomer` tag (`mail-orders-page.tsx:44-78`). Filters whose chip
is hidden are dropped from the effective set (`mail-orders-page.tsx:481-489`).

### What the route writes

Two sequential writes, never `$transaction` (`actions/route.ts:263-296`):

1. `mo_orders.update` — the intent, carried to the OBD by enrichment at import.
2. `orders.updateMany WHERE soNumber, isRemoved:false` — the OBD(s) that already exist.
   **Skipped when `soNumber` is blank** (`actions/route.ts:284-296`): `where: { soNumber: null }`
   would rewrite every un-punched order.

| Action | `mo_orders` | `orders` |
|---|---|---|
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
| **Pending** (actionable) | `workflowStage: "pick_checked"`, `invoiceNo: null`, `invoicedAt: null`, `isRemoved: false`, `dispatchStatus: "dispatch"`, AND hide-exclusion (`picking-where.ts:66-82`) | **all dates** — no date fence (`picking-where.ts:27-44`) |
| **Info** ("Already invoiced", read-only) | `workflowStage IN (pick_checked, dispatched)`, `invoiceNo` not null, `invoicedAt: null`, `isRemoved: false`, `pickAssignment.checkedAt` in the IST day, AND hide-exclusion; `dispatchStatus` not pinned (`picking-where.ts:131-172`) | the header's day |
| Marker `latest` | `OR(pending, info)` (`picking-where.ts:192-202`) | — |

The info arm includes `dispatched` since `551069aa` (2026-09-11); the pending arm stays on
`pick_checked` only (`picking-where.ts:134-149`). The Done area also lists bills marked done
that day (keyed on `invoicedAt`) — `app/api/billing/picking/list/route.ts:217-225`.

### Routes

| Route | Method | Gate (`billing_picking`) | Write |
|---|---|---|---|
| `/api/billing/picking/list` | GET | canView (`list/route.ts:92`) | none |
| `/api/billing/picking/marker` | GET | canView (`marker/route.ts:70`) | none |
| `/api/billing/picking/order/[orderId]` | GET | canView (`order/[orderId]/route.ts:64`) | none |
| `/api/billing/picking/mark-done` | POST `{ orderIds }` | canEdit (`mark-done/route.ts:69`) | one `orders.updateMany` stamping `invoicedAt` + `invoicedById`, WHERE = pending predicate AND ids (`mark-done/route.ts:104-109`); max 200 ids; idempotent |
| `/api/billing/picking/undo` | POST `{ orderIds }` | canEdit (`undo/route.ts:55`) | one `orders.updateMany` clearing both, WHERE `invoicedAt` in IST today AND `invoiceNo: null` AND `isRemoved: false` (`undo/route.ts:83-94`) |

- Neither write adds an `order_status_logs` row (`mark-done/route.ts:23-29`).
- The client hides Undo unless canEdit, the row is not an info row, the day is today, and
  `invoiceNo` is null (`billing-picking-tab.tsx:838`).
- The marker's `count` is pending-only; `latest` is over the union (`marker/route.ts:23-46`).

### Confirmed findings and the detail panel

- The list computes `hasConfirmedShortage` and `hasFinding` from one batched
  `pick_findings` read with `recordedById: { not: null }` (`list/route.ts:165-206`;
  `lib/billing/types.ts:47-67`). Confirmed only — never inferred from `qtyFound` or `reason`.
- **A bill with a confirmed finding has no checkbox** and can never enter a bulk
  Mark done (`billing-picking-tab.tsx:195-209`, `:649-665`; `93291cbc`). The selection helper
  refuses its id as well (`billing-picking-tab.tsx:231-235`).
- Clicking a Pending row opens `components/billing/billing-order-detail-panel.tsx`, fed by
  `GET /api/billing/picking/order/[orderId]`. The route has **no stage or invoice fence**
  (`order/[orderId]/route.ts:77-83`) and returns an `isPending` fact built from
  `buildBillingPendingWhere()` itself (`:108-120`).
- The panel's **Mark done** posts a one-element `orderIds` to the same mark-done route
  (`billing-order-detail-panel.tsx:59-64`), shown only when `canEdit && detail.isPending`
  (`:334-353`). It is shown for every pending bill; for a flagged bill it is the only way.
- The panel does not reuse `components/floor/detail-panel.tsx` or `/api/floor/order/[orderId]`,
  which is gated on `floor` (`billing-order-detail-panel.tsx:23-35`).

---

## 7. Print tab

Trips Floor has **sent to billing**. Billing copies each trip's invoice numbers and pastes
them into SAP, which prints; Orbit prints nothing (`billing-print-tab.tsx:3-6`). Shipped in
slice 9, `22ced2d8` + `6d008f8e` (2026-09-15).

**Fed by Floor.** The planner's Send to billing (`POST /api/floor/trips/[id]/billing`, gated
`floor` canEdit, called from `components/floor/floor-page.tsx:959`) stamps
`trips.sentToBillingAt`. The trip side — sending, taking back, and the rule that take-back is
refused once billing has copied (`lib/trips/billing.ts:77-82`) — is owned by
`CLAUDE_FLOOR_TRIPS.md` (Send to billing).

### The rules (all in `lib/billing/print.ts:7-21`)

1. Held bills (`orders.dispatchStatus = "hold"`) are shown, never counted, never copied.
2. Invoice numbers are distinct; N counts numbers, not bills.
3. Never a partial set: copyable only when every non-held bill has an invoice number.
4. New since copy: a copied trip whose numbers are not all in its earlier `invoices_copied`
   rows **reopens**, and its next copy carries only the new numbers.
5. Trips with copy work outstanding list from every date; finished trips list on the day
   they were copied.

A trip is on the tab when `sentToBillingAt` is not null and `status <> 'cancelled'`
(`print.ts:272`). States: `uncopied` / `reopened` / `copied` (`print.ts:58`).

### Routes

| Route | Method | Gate (`billing_print`) | Does |
|---|---|---|---|
| `/api/billing/print/list` | GET `?date=` | canView (`print/list/route.ts:39`) | `{ pending, copied }` — pending all dates oldest-sent first; copied for one IST day, newest copy first (`:48-64`) |
| `/api/billing/print/marker` | GET | canView (`print/marker/route.ts:30`) | `count` = trips with copy work outstanding; `latest` = `getPrintMarkerLatest()` (`print.ts:348-362`) |
| `/api/billing/print/trip/[id]/copy` | POST `{ invoiceNos }` | canEdit (`copy/route.ts:34`) | `copyTripInvoices()` (`print.ts:381-450`) |

**Copy.** The client puts the numbers on the clipboard first, then posts exactly those
numbers (`billing-print-tab.tsx:206-223`). The server recomputes the copy set and records only
if they match, else 409 (`print.ts:408-416`). It stamps `trips.billingCopiedAt` /
`billingCopiedById` with a conditional update on the value it read, so two presses cannot both
record (`print.ts:418-432`), and writes one `invoices_copied` activity row holding the numbers
(`print.ts:434-441`). A trip already `copied` returns `changed: false` and writes nothing
(`print.ts:394-396`). **It never writes an order row** (`print.ts:23-25`; `copy/route.ts:17-19`).

Without `billing_print` canEdit, or on a copied trip, the button is a plain Copy of the whole
set that records nothing (`billing-print-tab.tsx:85-102`). Ctrl+C does what the button does
(`billing-print-tab.tsx:17-18`).

---

## 8. Live sync — the marker providers

`components/billing/billing-marker-provider.tsx` runs the tab polls. Both are mounted in
`mail-orders-page.tsx:1486-1489`, around `ReviewView`.

| Poll | Endpoint | Enabled when | Subscribers |
|---|---|---|---|
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

| Table.column | Type | Written by | Notes |
|---|---|---|---|
| `billing_settings` (`id`, `scope` default `"GLOBAL"` unique, `rolloutStage` default `"OFF"`, `updatedAt`, `updatedById`) | — | Smart Flow, by hand | `schema.prisma:1151-1160`. One live row (live 2026-09-18, Q01) |
| `users.billingV2TestUser` | Boolean default false | Smart Flow | `schema.prisma:147`; read only on `TEST_USERS_ONLY` |
| `users.notesFontSize` | Int default 11 | `POST /api/user/notes-font-size` | §9 |
| `orders.invoicedAt` / `invoicedById` | Timestamptz / Int, named relation `OrderInvoicedBy` | mark-done, undo | `schema.prisma:1040-1050` |
| `trips.sentToBillingAt` / `sentToBillingById` | Timestamptz / Int, FK `ON DELETE SET NULL` | `lib/trips/billing.ts` — owned by `CLAUDE_FLOOR_TRIPS.md` | `schema.prisma:3283-3289`; FK live 2026-09-18, Q05a |
| `trips.billingCopiedAt` / `billingCopiedById` | Timestamptz / Int, FK `ON DELETE SET NULL` | `copyTripInvoices()` only | `schema.prisma:3290-3296`; FK live 2026-09-18, Q05a |
| `trip_activity.action = 'invoices_copied'` | text, in `chk_trip_activity_action` | `logTripInvoicesCopied` | live 2026-09-18, Q05a; table owned by `CLAUDE_FLOOR_TRIPS.md` |

---

## 11. Landmines and known defects

**Known defects — recorded, not fixed.**

- 🔴 **Dead shortcut label.** `MO_SHORTCUTS` still lists `{ key: "E", label: "Slot email" }`
  (`mail-orders-page.tsx:99`), and the ⌨ popover on the billing tab row renders it
  (`mail-orders-page.tsx:1290`). No key handler for E exists (handlers at
  `mail-orders-page.tsx:945-1204` cover v, c, Escape, arrows, Enter, R, F, ?, /, N, P, T, S).
  The slot-email modal was removed by `c103d5f4` (2026-08-10).
- 🔴 **`@page mo-landscape` is nested inside `@media print`** (`app/globals.css:630-633`, inside
  the block opened at `:422`), applied to `#mo-print-area` (`:634-636`), which is the billing
  right pane (`review-view.tsx:2921`). This breaks router rule §1 (`@page` rules top-level). The
  file's own MRN comment calls it a pre-existing violation (`globals.css:33-36`). Whether the
  print still comes out A4 landscape needs a real print test before anyone moves it.

**Landmines.**

- **Hide, never disable** the action buttons and tab controls. The server re-checks every key;
  the providers only decide what is drawn (`billing-actions-access-provider.tsx:29-33`,
  `billing-print-access-provider.tsx:11-13`).
- **`billing_picking` is not `picking`.** `picking` is the floor board key; reading it here
  would show the tab to pickers (`layout.tsx:58-60`).
- **Never add a date fence to the pending arm** (`picking-where.ts:27-44`), and never widen the
  pending arm to `dispatched` (`picking-where.ts:134-146`).
- **Undo's `invoiceNo: null` is load-bearing** (`undo/route.ts:19-27`). **The info arm's
  `invoicedAt: null` is load-bearing** — without it a row renders twice (`picking-where.ts:153-160`).
- **The `soNumber` guard in the actions route is load-bearing** (`actions/route.ts:284-288`).
- **Hold case differs per table** — capitalised on `mo_orders`, lowercase on `orders`
  (`actions/route.ts:241-251`).
- **Four copies of the 11–20 notes bound.** The lib constants (`notes-font-size.ts:34-35`), the
  POST route (which imports them), the DB CHECK (per schema comment), and a second literal pair
  in `review-view.tsx:246-247`. Widening the range means changing all of them, constraint first
  (`notes-font-size.ts:24-33`).
- **Stale code comments — claims, not facts.** `lib/permissions.ts:258-263` ("REGISTERED ONLY —
  NOTHING READS IT YET"), `:284-287` ("Nothing reads these yet"), `:412-418` and `:428-431`
  ("THE CHECKS THESE ANTICIPATE DO NOT EXIST YET") are all false: see §4–§6 for the reading
  sites. `lib/billing/flag.ts:18-20` describes `TEST_USERS_ONLY` as the live starting state;
  live is `ALL_USERS` (§2). `picking-where.ts:107-109` cites mark-done `:96` and undo `:85`;
  the lines are now `mark-done/route.ts:104-109` and `undo/route.ts:85-94`.
- **Orphan.** `components/billing/billing-order-info.tsx` has no importer (only comments in
  `review-view.tsx:1890-1904` mention it). Kept per the no-delete rule.

---

## 12. Open items (pointers only)

- Real print test of the billing print path (§11) — sweep report §8 Q12.
- Fix the dead "E · Slot email" label (§11) — sweep report §4 "Live code defects".
- Who the five holders of each billing key are, and whether they match the `mail_orders`
  editors — needs a SELECT on `user_page_access` (Q03b did not cover billing keys).
- Whether `chk_users_notes_font_size` and a CHECK on `billing_settings.rolloutStage` exist
  live — both are code/schema-comment claims (`schema.prisma:152-154`, `flag.ts:88-91`).
- Retiring the dormant flag-OFF face (§2) is an owner decision; method in
  `archive/RETIREMENT-PLAYBOOK.md`.
- Stale code comments (§11) belong to the code-comment pass in sweep report §4.
- `CLAUDE_MAIL_ORDERS.md §23` and the router's billing row need pointing here — batches B and C.

---

*CLAUDE_BILLING.md v1.0 · Schema v27.24 · OrbitOMS · updated 2026-09-18 — first canonical file for the Billing desk (the billing face of /mail-orders: rollout flag, tab bar, Picking tab, Print tab, action ticks, marker providers, notes font size). Written from the code at ec6343ba and the live results of 2026-09-18; drafts are history.*
