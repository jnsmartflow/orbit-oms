# Code discovery — the billing desk, as source material for Part 2 of the client deck
# 2026-09-14 · read-only · no code changed, nothing committed
# Companion to: docs/presentation/orbit-order-walkthrough.html (Part 1, the sales officer's phone)
# Method: read from the call site. An import is not a call; a capability is not reachability.
# The code is the only source of truth here. Where a doc disagrees, the code wins and the
# disagreement is recorded in §H.

**What Part 2 has to show:** the order Part 1 sends as a plain-text email arrives on a desk
screen with every line already resolved to a SAP material code; the operator presses **Copy**,
pastes the block into SAP, gets a sales-order number back, types it in, and the order closes.

I have no login, so nothing below was observed on a running screen. Every statement is read out
of the source, and each one names the file and line it came from.

---

## A. THE SCREEN

| | |
|---|---|
| **Route** | `/mail-orders` |
| **Entry** | `app/(mail-orders)/mail-orders/page.tsx` — four lines, `export const dynamic = "force-dynamic"`, renders `<MailOrdersPage />` |
| **Guard** | `app/(mail-orders)/mail-orders/layout.tsx` — `auth()` → no session redirects `/login`; `checkAnyPermission(roles, "mail_orders", "canView")` → false redirects `/unauthorized` |
| **Nav label** | **"Billing"** (`lib/permissions.ts:65` — `{ pageKey: "mail_orders", label: "Billing", href: "/mail-orders" }`). The word "Mail Orders" appears nowhere a user can see it. |
| **Sidebar icon** | `Mail` (lucide) — `components/shared/role-sidebar.tsx:74`, `mail_orders: Mail` |

### Who can see it

Permission-driven, not role-driven: any role holding `mail_orders.canView`. Two facts from the
code rather than a doc:

- `lib/rbac.ts:39` — `billing_operator: "/mail-orders"` in `ROLE_REDIRECTS`. Billing operators
  land here at login; it is their home screen.
- `lib/permissions.ts` — `admin` / `superuser` are short-circuited to all-true inside
  `getAllPermissionsForRoles`, so an admin always sees it.

**UNVERIFIED —** the full live list of roles holding `mail_orders.canView`. The grants live in
`role_permissions` / `user_page_access`, not in the repo. A read-only
`SELECT role, canView FROM role_permissions WHERE pageKey='mail_orders'` would settle it. Nothing
in Part 2 depends on the answer — the deck shows one operator.

### The two faces, and which one this report describes

`mail-orders-page.tsx` renders **two** view modes and **two** designs on top of them:

- `viewMode` — `"table"` (`mail-orders-table.tsx`) or `"focus"` (`review-view.tsx`).
- `billingV2` — a rollout flag, read fresh per request in the layout by
  `isBillingV2Enabled(Number(session.user.id))` (`lib/billing/flag.ts`), never cached onto the JWT,
  and couriered down through `<BillingV2Provider>`.

**The redesigned screen the brief describes is `review-view.tsx` with `billingV2` ON.** The
narrow icon rail, the INBOX head with its punched count, the Bill To / Ship To cards, the meta
row and the ten-column line table are all in that file.

### When it shipped

The billing v2 face was built **2026-07-30 → 2026-08-02** and documented 2026-08-04
(`CLAUDE_MAIL_ORDERS.md §23`). Commits that made the screen what it is today:

| date | commit | what |
|---|---|---|
| 2026-07-30 | `a0dd8bc2` | Billing Phase 2: floor actions on the Orders detail, flag-gated |
| 2026-07-31 | `0cf27cb2` | redesign order ribbon — Urgent·Hold·Slot, Punch right, ⓘ metadata, readiness→SKU caption |
| 2026-08-01 | `0a8582e3` | ribbon — one green SO pill, inline provenance, drop the ⓘ; rail % coloured |
| 2026-08-01 | `06a5c904` | rail head gains an Inbox label, % goes blue, detail cards get a height floor |
| 2026-08-06 | `44813cf9`, `63a323db` | **the Copy button re-added to the ribbon, next to Notes**, wired to the smart-copy toast |
| 2026-08-07 | `2f642c9c` → `2916b5f8` | Notes band size becomes a per-user 11–20px stepper; violet Ship-To override card |
| 2026-09-09 | `c96157ea`, `8fac2a67` | **the rebrand: teal becomes Orbit violet; the product is called Orbit** |
| 2026-09-11 | `9bc027a9`, `a991a1c4` | Picking tab gates on `billing_picking`; the four action buttons gate on their own ticks |

---

## B. EVERY ELEMENT, IN THE ORDER THE EYE MEETS IT

Walked for the **billingV2 face**, left to right. Each heading says which file owns it and
whether the flag is what turns it on.

### B.0 The shell — `components/shared/role-sidebar.tsx`, via `role-layout-client.tsx`

Not flag-gated; every screen in the app has it.

- **Width** `72px` collapsed, `220px` expanded (`role-sidebar.tsx:195`,
  `width: isExpanded ? "220px" : "72px"`). It expands on hover through `RoleSidebarProvider`.
- **Top: the wordmark, alone.** `<OrbitWordmark height={isExpanded ? 19 : 14}
  className="text-brand-800 flex-shrink-0" />` — the word *Orbit*, no symbol, in `#5B21B6`.
  The source comment is explicit: *"NOTHING SITS BESIDE THE WORDMARK. Not the name — the wordmark
  is the name."*
- **The icons**, in `NAV_ITEMS` order, filtered to what the viewer holds
  (`lib/permissions.ts:40-90`). Icons from `ICON_MAP` (`role-sidebar.tsx:39-76`):

  | key | label | icon |
  |---|---|---|
  | `operations_tinting` | Tinting | `Layers` |
  | `operations_tint_operator` | Tint Operator | `Zap` |
  | `floor` | Floor Control | `LayoutGrid` |
  | `import_obd` | Import | `Upload` |
  | `customers` | Customers | `Users` |
  | `skus` | SKUs | `Package` |
  | `routes_areas` | Routes | `MapPin` |
  | `vehicles` | Vehicles | `Truck` |
  | `trip_report` | Trip Report | `Route` |
  | `place_order` | Purchase Order (PO) | *(default `User`)* |
  | **`mail_orders`** | **Billing** | **`Mail`** |
  | `mrn` | MRN | `Container` |
  | `ci` | CI | `Undo2` |
  | `delivery_challans` | Delivery Challans | `FileText` |
  | `sampling_library` | Sampling Library | `FlaskConical` |
  | `shade_master` | Shade Master | `Palette` |
  | `ti_report` | TI Report | `BarChart2` |

  `picking` is in `DESKTOP_HIDDEN_PAGE_KEYS` and never renders in this rail.
- **Active row:** `bg-brand-50 text-brand-700 font-semibold pl-[10px] border-l-2 border-brand-600`
  — a violet left bar, violet text, pale violet ground. Inactive: `font-medium text-gray-500`.
  Icons `h-[15px] w-[15px]` expanded, `h-[17px] w-[17px]` collapsed; rows `text-[12.5px]`.
- **Foot:** the user block — initials, name, and the role label from `ROLE_LABELS`
  (`billing_operator: "Billing Operator"`), plus sign-out.

### B.1 The top header — `components/universal-header.tsx`, called from `mail-orders-page.tsx:1225`

The flag empties most of it. What the billing face actually gets:

- `title={undefined}` — **no title at all.** The Table/Focus toggle, the divider and the
  "`{n}% punched`" chip are all in the OFF branch only. Hiding the toggle is what pins this face
  to Focus: `viewMode` defaults to `"focus"` and those two buttons are its only writers.
- `stats={undefined}` — the "`{n} orders`" stat is gone.
- `segments={undefined}` — the whole slot row (slots 1–9 and the "Jump to slot" shortcut) falls
  away with it.
- `suppressFilterBar={billingV2 && viewMode === "focus"}` — Row 2 is suppressed entirely.
- `searchLayout="wide-right"` — Import and the search box sit in the far right corner,
  placeholder **"Search orders..."**; `importVariant="primary"`; `showClock={false}`.

### B.2 The INBOX rail — `review-view.tsx:2782-2872`. **Flag-gated.**

With the flag OFF this same block is a text input, `placeholder="Filter orders..."`. With it ON:

- **Rail head**, a 28px row, `text-[10px] text-gray-400`:
  - left — the `Mail` glyph at `size={14}` (deliberately the same lucide icon the sidebar maps to
    this module) then `<span className="uppercase tracking-wide">Inbox</span>`
  - right — `{railTotal} orders`, and when `railTotal > 0` a coloured suffix
    `· {railPunchPct}% punched`, `text-green-600` at 100 and `text-blue-600` below.
    `railPunchPct = Math.round(railPunched / railTotal * 100)` (`:862`).
- **The order list**, one row per order (`renderOrderRow`, `:1093`):
  `px-3.5 py-2.5 border-b border-gray-100 cursor-pointer border-l-[3px]`, with a 3px left bar
  that carries the state — focused `bg-brand-50 border-l-brand-600`; flagged (locked, or OD/CI)
  `border-l-amber-600`; punched `border-l-transparent opacity-40`.
  Inside: a 5px delivery-type dot, the customer name at `text-[13px] font-semibold` through
  `smartTitleCase(...)` and falling back to `cleanSubject(order.subject)` when there is no
  customer, a ★ for a key dealer, and the order's signal badges.
- **Pending empty state** — `○` at `text-[28px] text-gray-300`, then **"No new orders"**
  (`text-[13px] font-semibold`) and **"New orders appear here on their own."**
  Filtered-to-nothing gets a quieter single line: **"No orders match."**
- **The punched divider**, only when `punchedOrders.length > 0`:
  `{punchedVisible ? "▾" : "▸"} {punchedOrders.length} punched`, `text-[10px] text-gray-400`
  on `bg-gray-50`, clickable, and the done rows render under it when open.

### B.3 The Orders | Picking tab bar — `components/billing/billing-tab-bar.tsx`. **Flag-gated.**

Top of the right pane, same position as Floor Control's tab row. `Orders` carries a badge of
orders *still needing action* (not the rail's total). `Picking` renders **only** when the viewer
holds `billing_picking.canView` — two gates, the pill and the body, both reading the same prop.

### B.4 The order header — `review-view.tsx`, `renderDetailHeader`

- **Bill To card** — `components/mail-orders/bill-to-card.tsx`.
  `bg-white border border-gray-200 rounded-lg px-3 py-2.5`. Caption **"Bill to"** at
  `text-[9.5px] font-semibold tracking-[0.06em] uppercase text-gray-400`. Then a 6px delivery
  dot + the customer name at `text-[14.5px] font-bold text-gray-900`, or **"—"** when there is
  none. A key dealer adds a `★ Key` pill (amber). Under it a detail line at `text-[11.5px]`:
  the customer code as a mono chip, `·`, the area, `·`, the delivery type.
  The code chip changes colour with the match: exact `bg-gray-100 text-gray-700`,
  multiple `bg-amber-50 text-amber-700`, unmatched `bg-red-50 text-red-700`.
  Delivery dot: `LOCAL` blue-600, `UPCOUNTRY`/`UPC` orange-600, `IGT` data-teal,
  `CROSS` rose-600, unknown gray-300.
- **Ship To card** — `components/mail-orders/ship-to-card.tsx`, caption **"Ship to"**. Renders
  only when the order carries a ship-to override.
- **Signal pills** — `components/mail-orders/signal-pill.tsx`, fed by `getOrderSignals`
  (`lib/mail-orders/utils.ts:730-775`). The full label set, verbatim: `OD`, `CI`, `Bounce`,
  `Bill Tomorrow`, `Cross {DEPOT}`, `Urgent`, `7 Days`, `Extension`, `Bill {n}`, `DPL`,
  `Challan`, `Truck Order`. Each is tag-gated by `MO_TAG.*` through `disabledTagKeys`.
- **Instructions strip** — `components/mail-orders/instructions-strip.tsx`, up to three rows
  (delivery / bill / notes) with a coloured dot each: delivery `bg-amber-600`, bill
  `bg-blue-700`, notes `bg-gray-600` (or `bg-brand-600` in the violet tone). The remark text
  size is the per-user `users.notesFontSize`, 11–20px; the row caption stays at a fixed 10px.

### B.5 The meta row — `components/mail-orders/meta-ribbon.tsx` + `billing-action-ribbon.tsx`

`flex items-center justify-between gap-3 px-5 pt-2 pb-2.5 border-t border-gray-100`.
On the billing face the whole row *content* is replaced through the component's one escape hatch,
`contentOverride`; the outer container is untouched.

- **Left — the summary segments**, `text-[11.5px] text-gray-500`, joined by a `·` in
  `text-gray-300`: the SO (sales officer) name, the received time, the volume, the readiness
  chip, and — once punched — `punched by {name} · {time}` in `text-gray-400`.
- **The readiness chip** (`getMatchChip`, exported so the SKU caption cannot re-derive it
  differently): `✓ {matched}/{total}` green, `⚠ {matched}/{total}` amber, `✗ 0/{total}` red.
- **Right — the actions.** From `billing-action-ribbon.tsx`: `⚡ Urgent`, `⚑ Hold`, and a
  `Slot` button that overlays Floor's own `DispatchSlotPicker`. Each gates on its own per-user
  tick (`billing_urgent`, `billing_hold`, `billing_slot`) read in the layout.
  Then, in `review-view.tsx`: the **Notes** button (`StickyNote`, violet when the order has
  notes) and the **Copy** button — `title="Copy · Ctrl+C"`, a `Copy` icon at `size={12}` and the
  word `Copy`. A `w-px h-4 bg-gray-200` divider, then the SO controls.

### B.6 The line table — `review-view.tsx:2433-2520+`

`table-layout: fixed`, in a `flex-1 overflow-y-auto` box with `padding: 0 6px`. Header is
`sticky top-0`, `height: 32`, `fontSize: 10`, `fontWeight: 500`, uppercase,
`letterSpacing: "0.05em"`, `color: "#9ca3af"`, `background: "#f9fafb"`,
`borderBottom: "1px solid #ebebeb"`.

**Ten columns — the exact set and the exact widths from `<colgroup>`:**

| # | header | width | align |
|---|---|---|---|
| 1 | `#` | **4%** | left |
| 2 | `Raw Text` | **20%** | left |
| 3 | `SKU Code` | **11%** | left |
| 4 | `ALT SKU` | **8%** | center |
| 5 | `Description` | **22%** | left |
| 6 | `Pk` | **5.5%** | center |
| 7 | `Qty` | **5.5%** | right |
| 8 | `Vol` | **5.5%** | right |
| 9 | `Status` | **12%** | center |
| 10 | *(unnamed — the row's action cell)* | **6.5%** | — |

The header renders those labels in mixed case (`Raw Text`, `SKU Code`, `Description`, `Pk`,
`Qty`, `Vol`, `Status`) and CSS uppercases them, so on screen they read
`# · RAW TEXT · SKU CODE · ALT SKU · DESCRIPTION · PK · QTY · VOL · STATUS`.

The **Description** header carries a small toggle button beside it — `long` / `short`,
`fontSize: 9`, uppercase, printing its own current value as its label — which switches
`descMode` for the whole table.

Row colouring by state (`getRowState`, `:1193`): `not-found` → SKU text `#d1d5db`,
`partial` → `#d97706` (amber), otherwise `#6b7280`. The active line gets `background: "#fefce8"`.
The `Pk` cell prints `line.packCode` verbatim, or `—`. `Vol` is
`getPackVolumeLiters(line.packCode) * line.quantity`.

### B.7 The footer

There is no footer bar on this screen. The right pane is header → meta row → table, and the
keyboard hints live in `HeaderShortcuts` behind the header's keyboard button (suppressed on the
billing face — every shortcut still fires).

### B.8 Would Table view ever be reachable for a billing operator?

**No, not by any control on the screen.** `viewMode` initialises to `"focus"`
(`mail-orders-page.tsx:169`) and its only writers are the two buttons inside the header `title`
slot, which the flag sets to `undefined`. With the flag ON there is no way back to the table.
Table view is *not* archived — `MailOrdersTable`, the `ColumnPicker` and every `viewMode` branch
stay live and reachable for a non-billing user with `mail_orders.canView` and the flag off.

**UNVERIFIED —** whether a keyboard shortcut can flip `viewMode`. I traced the two `keydown`
listeners in `mail-orders-page.tsx` (:850 Ctrl-combos, :951 single keys) and neither writes
`viewMode`; a fourth listener could exist in a component I did not open. Reading every
`setViewMode` call site would settle it — there are two, both in the header title block.

---

## C. THE COPY BUTTON — what actually goes to SAP

Three copy paths exist. All three build the same payload from the same one-line formatter; they
differ only in *how much* of it they send and *what else* they send first.

### C.1 `buildClipboardText` — the Copy button (`lib/mail-orders/utils.ts:504`)

```ts
export function buildClipboardText(lines: MoOrderLine[]): string {
  return lines
    .filter((l) => l.matchStatus === "matched" && l.skuCode != null)
    .map((l) => `${l.skuCode}\t${l.quantity}`)
    .join("\n");
}
```

| question | answer |
|---|---|
| fields | exactly two: `skuCode`, `quantity` |
| order | SKU code first, quantity second |
| separator **between the two fields** | a **TAB** (`\t`) |
| separator **between lines** | a **NEWLINE** (`\n`) — no trailing newline |
| header row | **none** |
| unmatched lines | **silently dropped.** The filter keeps only `matchStatus === "matched"` *and* a non-null `skuCode`. A partial or unmatched line contributes nothing and leaves no gap, no placeholder and no blank row |
| line order | the array order as rendered, i.e. `lineNumber ASC` — parser order. `SAP_PASTE_SORT = "email"` (`utils.ts:130`) is the single switch; `"picker"` would re-sort into warehouse walk order and is not the live value |
| does quantity travel? | **yes**, as the second column |
| does pack travel? | **no.** The pack is already inside the material code — `IN28012272` *is* Gloss Black 1L. `packCode` never reaches the clipboard |
| anything else? | no customer code, no description, no raw text, no volume, no order number |

**Call site:** the button at `review-view.tsx:1912` calls `handleCopyClick` (`:1008`), which calls
`onCopy(selectedOrder.id, selectedOrder.lines)` with **no** `batchIndex` — so the button is
always the unbatched path, every matched line in one go — then raises the toast
`` `${matchedLines.length} SKUs copied` ``. `onCopy` is `handleCopy` in
`mail-orders-page.tsx:652`, which writes `navigator.clipboard.writeText(text)`, sets `copiedId`
for a 2-second tick on the button, and returns early on empty text (nothing matched → nothing
copied, and no toast contradiction because the count in the toast is computed separately).

### C.2 `buildBatchClipboardText` — what `BATCH_COPY_LIMIT = 14` limits (`utils.ts:511`)

`BATCH_COPY_LIMIT` is **14 order LINES per clipboard write** — not characters, not bytes, not
orders. It slices the *matched* lines into consecutive batches of 14 and returns one batch plus
its bookkeeping:

```ts
{ text, totalBatches, batchStart, batchEnd }
```

The payload format inside a batch is byte-identical to C.1 — `${skuCode}\t${quantity}` joined by
`\n`, no header. When `totalBatches <= 1` it returns the whole thing and reports batch 1 of 1, so
a short order never takes a different path.

`handleAdvanceBatch` (`mail-orders-page.tsx:662`) rotates the per-order pointer
`(current + 1) % totalBatches`, so repeated presses walk 1 → 2 → … → n → 1.

**UNVERIFIED —** *why* 14. Nothing in the source states the reason, and the Ctrl+C comment at
`mail-orders-page.tsx:911` still says "batch of 20" while the constant is 14 — a stale comment
(recorded in §H). The plausible reading is a SAP paste-grid page size, but the code does not say
so. Asking the operator how many rows his SAP entry grid takes would settle it.

### C.3 The Ctrl+C smart copy — where it differs from the button (`mail-orders-page.tsx:881-941`)

This is a **two-state machine keyed to the focused order**, and it is the one place the *customer
code* reaches the clipboard.

- **Press 1 — the customer.** If the smart-copy pointer is not already on this order, it copies
  `order.customerCode` alone, sets the pointer, and toasts `` `Customer: ${code} copied` ``. If
  the order has no customer, or `customerMatchStatus !== "exact"`, it refuses with
  **"No customer — resolve first"** and copies nothing.
- **Press 2 — the SKUs.** Same order focused, so it copies the SKU block. With **14 or fewer**
  matched lines it calls the unbatched path, toasts `` `${n} SKUs copied` `` and resets the
  pointer. With **more than 14** it copies batch *k*, toasts
  `` `SKUs batch ${k}/${total} copied` `` (and `… — done` on the last one), and advances.
- Guards: ignored inside `INPUT` / `TEXTAREA` / `SELECT`; ignored when the user has a text
  selection (so a normal Ctrl+C still works); requires a focused order. Registered on the
  document in the **capture** phase with `stopImmediatePropagation()` so no other listener can
  swallow it.
- A cell flash accompanies each press — `smart-copy-flash-green` for the customer code,
  `smart-copy-flash-blue` for the SKU block (`:592`, `:1221`).

**So the difference is exactly this:** the Copy *button* gives you the SKU block and only the SKU
block, every matched line, in one press. Ctrl+C gives you the customer code first and the SKU
block second, and it is the only path that batches at 14.

### C.4 What does the operator actually paste into SAP?

**A two-column, tab-separated block of material code and quantity — one row per matched line,
with no header — which is exactly the shape a spreadsheet-style grid accepts.** A tab moves one
cell right, a newline moves one row down, so pasting into the first cell of SAP's item grid fills
`Material` and `Order Quantity` down the page in one action. Nothing else is in the payload: no
description, no pack, no customer, no order number. The customer is pasted separately, before the
lines, and only by the Ctrl+C path.

### C.5 The real payload for the Part-1 order

The six-product order Part 1 builds arrives on the board as **nine lines** (the parser's comma
split gives each pack its own line — see §F for the caveat). Every one of the nine matches, so
every one of the nine travels. The clipboard, with separators made visible
(`→` = TAB `\t`, `⏎` = NEWLINE `\n`):

```
IN28012272→12⏎
IN28209071→8⏎
IN30600023→6⏎
IN30600081→1⏎
5579815→4⏎
5579817→1⏎
IN65010698→20⏎
IN65010674→10⏎
5908366→2
```

And the same thing as it actually lands — 9 rows, 2 columns, no header, no trailing newline:

```
IN28012272	12
IN28209071	8
IN30600023	6
IN30600081	1
5579815	4
5579817	1
IN65010698	20
IN65010674	10
5908366	2
```

Nine lines is under the 14-line limit, so this order is a single press and a single paste. The
Ctrl+C path would put `447636` on the clipboard first.

---

## D. CLOSING AN ORDER

### D.1 The field

`review-view.tsx:1654-1690`. A `text` input, `maxLength={10}`, `font-mono text-[14px]
font-medium`, `w-[120px] h-[30px]`, with the caption **"Order No."** at `text-[10px] text-gray-400`
inside the same bordered shell and the placeholder **"Enter number"**. Non-digits are stripped as
you type — `onChange` is `e.target.value.replace(/\D/g, "").slice(0, 10)` — so the field can only
ever hold 0–10 digits.

Beside it, the **Punch** button: `h-[32px] px-3.5 rounded-md text-[12px] font-semibold`,
`bg-brand-600 text-white hover:bg-brand-700` when ready, `bg-gray-100 text-gray-300` and inert
when not. `punchReady` is the 10-digit test. Enter fires it too (`handleSoKeyDown`).

### D.2 What validates it

Twice, with the same rule:

- **Client** — `mail-orders-page.tsx:700`: `if (!/^\d{10}$/.test(value)) return false;`
- **Server** — `app/api/mail-orders/[id]/so-number/route.ts`: the same
  `/^\d{10}$/` on the trimmed body, returning `400 { error: "SO Number must be exactly 10 digits" }`.

Exactly ten digits. No prefix, no letters, no spaces, no check digit.

### D.3 What "punched" means in the data

`PATCH /api/mail-orders/[id]/so-number` writes, in one `mo_orders.update`:

```
soNumber:    <the ten digits>
status:      "punched"
punchedAt:   new Date()
punchedById: <session user id>
```

So **saving the number is the punch** — they are not two steps. There is also a bare
`PATCH /api/mail-orders/[id]/punch` which sets `status`/`punchedAt`/`punchedById` *without* a
number and refuses with `400 "Already punched"` if the order is already done; that is the path
that can leave an order punched with no SO number, which is why the screen's own "is punched"
test is the stricter `status === "punched" && !!soNumber` (`review-view.tsx:1109`).

Both routes require `mail_orders.canEdit`; `checkAnyPermission` carries the admin bypass.

### D.4 What changes on screen

1. **The field becomes a green pill** (`:1703`):
   `inline-flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2 py-0.5`
   holding a `Check` at `size={14}` in `text-green-600` and the number itself in
   `font-mono text-[14px] font-medium text-green-700`. The separate word "Punched" was removed —
   the green says it.
2. **A pencil appears beside the pill** — an 18×18 button, `title="Edit SO number"`, which
   reopens a compact inline editor **prefilled with the current number** (✓ to save, ✕ to
   cancel). Same ten-digit gate.
3. **The meta row gains provenance** — `punched by {name} · {time}` in `text-gray-400`, from
   `punchedBy.name` and `punchedAt`.
4. **The rail row fades and moves.** The row's left bar goes `border-l-transparent opacity-40`,
   and the order leaves `pendingOrders` for `punchedOrders` — but not immediately: a recently
   punched id is held in `recentlyPunchedIds` for **8 seconds** (`mail-orders-page.tsx:640`) so
   the row does not vanish from under the operator.
5. **The counts move together.** The divider under the pending list reads
   `▸ {n} punched`, and the rail head's `· {pct}% punched` recomputes —
   `Math.round(railPunched / railTotal * 100)` — turning **`text-blue-600` into `text-green-600`
   the moment it reaches 100**. So a finished day reads `12 orders · 100% punched` in green.
6. **The right pane empties** when nothing is left: a green `✓` at `text-[28px] text-[#22c55e]`,
   **"All caught up"**, on a day that actually received orders. A day that received none gets the
   neutral `○` and **"No orders yet today"** instead — the code is explicit that crediting an
   operator with finishing work that never existed would be a lie.

### D.5 Who is recorded, and can it be undone

`punchedById` is the session user id, resolved server-side; the operator cannot attribute a punch
to anyone else. The name shown comes from the `punchedBy` relation selected by the list route.

**Undo:** there is **no un-punch control on this screen.** What exists is *correction* — the
pencil rewrites `soNumber` through the same route, and `opts.isEdit` tells the page to skip the
punch-time restamp (so the provenance keeps saying when the work was actually done) and to skip
the 8-second grace (so the row does not bounce back into the pending list and out again — that
bounce was a reported bug, fixed 2026-08-01 in `a64c7935`). Nothing in the UI writes
`status` back to anything but `"punched"`.

**UNVERIFIED —** whether an admin path elsewhere can reverse a punch. I found no route that
writes `status: "pending"`; a `grep` for every write to `mo_orders.status` across `app/api/`
would settle it conclusively.

### D.6 Ctrl+V — the return trip

`mail-orders-page.tsx:858-879`. It does **not** paste. It **aims** the paste:

- Ignored inside `INPUT` / `TEXTAREA` / `SELECT`, and when no order is focused.
- `stopImmediatePropagation()`, then it finds the SO input — first the table-mode selector
  `tr[data-order-id="${focusedId}"] input[placeholder="SO Number"]`, falling back to the focus-mode
  one, `input[placeholder="Enter number"]`.
- `input.focus(); input.select();` — and then it deliberately does **not** call
  `preventDefault()`, so the browser's own paste lands in the now-focused, fully-selected field
  and replaces whatever was there.

The value then goes through the same two gates as typing: the `replace(/\D/g, "")` strip on
change (so pasting `SO 4512890077` or `4512890077 ` still yields ten clean digits, and pasting
something longer is truncated at ten), and `/^\d{10}$/` before the write.

So the loop closes without the operator's hands leaving the keyboard: **Ctrl+C** puts the
customer on the clipboard, **Ctrl+C** again puts the nine SKU lines on it, both paste into SAP,
SAP returns a sales-order number, **Ctrl+V** aims it at the field, **Enter** punches it, and the
rail's percentage moves.

---

## E. THE LINE STATUS

### E.1 What the toggle does

The `STATUS` cell holds a toggle wired to `handleToggle` (`review-view.tsx:1212`):

- If the row is currently **not-found**, the toggle **clears** it: an optimistic local override
  `{ found: true, reason: null }`, then `saveLineStatus(line.id, { found: true })`, reverting the
  override if the call fails.
- Otherwise it **opens a reason dropdown** rather than writing anything — the operator must say
  *why*. Picking a reason writes `{ found: false, reason }` the same optimistic way.

### E.2 The states

Two independent axes, resolved into one row state by `getRowState` (`:1193`), the operator's
verdict taking precedence:

**The operator's line status** (`mo_line_status`, via
`PATCH /api/mail-orders/lines/[lineId]/status`) — `found: boolean` plus, when false, one of five
reasons, validated server-side against `VALID_REASONS`:

```
out_of_stock · wrong_pack · discontinued · other_depot · other
```

plus optional `altSkuCode`, `altSkuDescription` and a free `note`. Setting `found: true` clears
all four detail fields in the same write, so a cleared line carries no stale reason.

**The enrichment's match status** (`matchStatus` on the line): `matched` · `partial` ·
`unmatched`.

Combined:

| row state | when | how it looks |
|---|---|---|
| `not-found` | the operator marked it not found | SKU text `#d1d5db` (nearly white) — the row is visibly struck out of the order |
| `partial` | `matchStatus === "partial"` | SKU text `#d97706` — amber |
| `unmatched` | `matchStatus === "unmatched"` | no SKU code to show; the `ALT SKU` and resolve paths are what fill it |
| `normal` | everything else | SKU text `#6b7280` |

### E.3 What an unmatched or partial line looks like, and what it costs

A partial or unmatched line **is not copied** — `buildClipboardText` filters on
`matchStatus === "matched" && skuCode != null`, so it never reaches SAP. The readiness chip in
the meta row is the warning: `⚠ 7/9` in amber, or `✗ 0/9` in red, against `✓ 9/9` in green.

The operator's way out is `resolve-line-panel.tsx` → `POST /api/mail-orders/lines/[lineId]/resolve`
with a SKU chosen from `searchSkus`; the resolved line is merged into the render through
`resolvedLineOverrides` and behaves as `matched` from that moment, including for the clipboard.

---

## F. REAL EXAMPLE ORDERS

Every SKU code, description, pack and carton below is read from
`docs/SKU/mo_sku_lookup_v2_rows.csv` (1,708 rows — the `mo_sku_lookup_v2` export), taking the
`isPrimary = true` row where a product has more than one. `VOL` is
`getPackVolumeLiters(packCode) × quantity`, the screen's own formula.

**Dealer names are invented.** Areas are real Surat areas the app uses throughout
(Katargam, Adajan, Varachha, Udhna, Pal).
**UNVERIFIED —** the six-digit customer codes. They were invented for Part 1's deck and carried
forward here so the two halves name the same dealer; they are not from any export. A read-only
`SELECT customerCode, name, area, deliveryType FROM customers LIMIT 20` would give real ones.

### ⚠ One caveat that changes the line count

Part 1's email sends **six product lines**, two of which carry two packs:

```
3. VT Pearl Glo Brilliant White - 1L*6, 20L*1
4. Promise Smartchoice Exterior - 4L*4, 20L*1
5. Universal Stainer Fast Violet - 100ML*20, 200ML*10
```

The parser's architecture is **Normalize → comma **split** → Extract**
(`CLAUDE_MAIL_ORDERS.md §3`, step 2), and `carryProduct` carries the product name onto a
segment that has only a pack and a quantity. So each pack becomes its own `mo_order_line`, and
the board shows **nine** lines for this order, not six — which is also why the clipboard in §C.5
has nine rows.

**UNVERIFIED —** the exact `rawText` stored per split segment. The parser is a PowerShell script
on the mail PC, outside this repo (`docs/Parser/Parse-MailOrders-V7.ps1` is the repo copy), and I
cannot run it. The `RAW TEXT` column below is my reconstruction of what the split would store.
One real `/po2` order in `mo_order_lines` would settle both the count and the strings — and it is
worth settling before the deck is built, because it is the one number a viewer can count.

---

### Order 1 — the order Part 1 builds

| | |
|---|---|
| **Dealer** | Ambika Paints · `447636` |
| **Area** | Katargam |
| **Delivery** | LOCAL |
| **SO** | Jignesh Patel |
| **Lines** | 9 (from 6 product lines) |
| **Volume** | 150 L |
| **Readiness** | `✓ 9/9` |

| # | RAW TEXT | SKU CODE | DESCRIPTION | PK | QTY | VOL |
|---|---|---|---|---|---|---|
| 1 | Gloss Black 1L*12 | `IN28012272` | DN GLOSS BLACK 1L | 1 | 12 | 12 L |
| 2 | Gloss 90 Base 4L*8 | `IN28209071` | DN GLOSS WHITE BASE NEW 4L | 4 | 8 | 32 L |
| 3 | VT Pearl Glo Brilliant White 1L*6 | `IN30600023` | DN VT PEARL GLO NEW BRILLIANT WHITE 1L | 1 | 6 | 6 L |
| 4 | 20L*1 | `IN30600081` | DN VT PEARL GLO NEW BRILLIANT WHITE 20L | 20 | 1 | 20 L |
| 5 | Promise Smartchoice Exterior 4L*4 | `5579815` | PROMISE SMARTCH EXT BR WHT/WHT BAS 4L | 4 | 4 | 16 L |
| 6 | 20L*1 | `5579817` | PROMISE SMARTCH EXT BR WHT/WHT BAS 20L | 20 | 1 | 20 L |
| 7 | Universal Stainer Fast Violet 100ML*20 | `IN65010698` | DN Stainer Fast Violet 100ML | 100ML | 20 | 2 L |
| 8 | 200ML*10 | `IN65010674` | DN Stainer Fast Violet 200ML | 200ML | 10 | 2 L |
| 9 | Damp Protect 2in1 20L*2 | `5908366` | DN AQUATECH DAMP PROTECT 2IN1 20L | 20 | 2 | 40 L |

Cartons, for reference (`piecesPerCarton`): Gloss 1L 6 · Gloss 4L 4 · Pearl Glo 1L 6 ·
SmartChoice 4L 4 · Stainer 100ML 20 · Stainer 200ML 20. The 20L drums have no carton value — they
ship as single units, which is what Part 1's "one for a drum" line is about.

### Order 2 — Shreeji Paint House

| | |
|---|---|
| **Dealer** | Shreeji Paint House · `512804` · Adajan · LOCAL · SO Jignesh Patel · 2 lines · 22 L · `✓ 2/2` |

| # | RAW TEXT | SKU CODE | DESCRIPTION | PK | QTY | VOL |
|---|---|---|---|---|---|---|
| 1 | Super Satin White 4L*4 | `IN28080071` | DN SAT FIN WHITE 4L | 4 | 4 | 16 L |
| 2 | Promise Enamel White 1L*6 | `IN29320272` | DN PROMISE ENML WHITE 1L | 1 | 6 | 6 L |

### Order 3 — Navrang Colour Centre

| | |
|---|---|
| **Dealer** | Navrang Colour Centre · `438117` · Varachha · LOCAL · SO Mehul Desai · 3 lines · 100 L · `✓ 3/3` |

| # | RAW TEXT | SKU CODE | DESCRIPTION | PK | QTY | VOL |
|---|---|---|---|---|---|---|
| 1 | WS Max Brilliant White 20L*2 | `5948207` | DN WS MAX 10YR BR WHITE 20L | 20 | 2 | 40 L |
| 2 | Supercover Ultra Br White 20L*2 | `5853011` | DPP-SUPERCOVER ULTRA BR.WHITE 20L | 20 | 2 | 40 L |
| 3 | WS Protect Dustproof Br White 20L*1 | `5880380` | DN WS  PROTECT DUSTPROOF BR.WHITE 20L | 20 | 1 | 20 L |

### Order 4 — Maruti Hardware & Paints

| | |
|---|---|
| **Dealer** | Maruti Hardware & Paints · `466390` · Udhna · UPCOUNTRY · SO Mehul Desai · 1 line · 20 L · `✓ 1/1` |

| # | RAW TEXT | SKU CODE | DESCRIPTION | PK | QTY | VOL |
|---|---|---|---|---|---|---|
| 1 | Red Oxide Metal Primer 20L*1 | `IN34210081` | DN ROM PRIMER 20L | 20 | 1 | 20 L |

### Order 5 — Krishna Paint Depot

| | |
|---|---|
| **Dealer** | Krishna Paint Depot · `471255` · Pal · LOCAL · SO Jignesh Patel · 4 lines · 88 L · `✓ 4/4` |

| # | RAW TEXT | SKU CODE | DESCRIPTION | PK | QTY | VOL |
|---|---|---|---|---|---|---|
| 1 | Gloss Brilliant White 4L*4 | `IN28301071` | DN GLOSS BRILLIANT WHITE 4L | 4 | 4 | 16 L |
| 2 | VT Platinum Glo White 4L*3 | `IN30900071` | DN VT PLATINUM GLO WHITE  4L | 4 | 3 | 12 L |
| 3 | Promise Interior White 20L*2 | `5838855` | DN PROMISE INTERIOR WHITE 20L | 20 | 2 | 40 L |
| 4 | Damp Protect 2in1 4L*5 | `5908364` | DN AQUATECH DAMP PROTECT 2IN1 4L | 4 | 5 | 20 L |

None of orders 2–5 carries a remark, a dispatch flag, a split or a note — they are ordinary days'
work, and they need nothing the client version hides.

---

## G. THE BRAND ON THIS SCREEN

### Palette (`tailwind.config.ts`, and the literals in the components)

| token | hex | where |
|---|---|---|
| `brand-50` | `#F5F3FF` | active nav row ground, focused rail row |
| `brand-100` | `#EDE9FE` | |
| `brand-200` | `#DDD6FE` | |
| `brand-300` | `#C4B5FD` | |
| `brand-400` | `#A78BFA` | |
| `brand-500` | `#8B5CF6` | input focus border (non-billing) |
| **`brand-600`** | **`#7C3AED`** | **the brand violet** — Punch button, active nav bar, focus ring, notes dot |
| `brand-700` | `#6D28D9` | Punch hover, active nav text |
| `brand-800` | `#5B21B6` | **the wordmark** |
| `brand-900` | `#43168B` | |

Semantic colours actually used on this screen: green `border-green-200 / bg-green-50 /
text-green-700` with the tick at `text-green-600` and the caught-up tick at `#22c55e`; amber
`bg-amber-50 / border-amber-200 / text-amber-700` for a partial match, a key dealer and a flagged
row; red `bg-red-50 / border-red-200 / text-red-700` for an unmatched customer; `#d97706` for a
partial SKU and `#d1d5db` for a struck-out one; the active line row `#fefce8`.
Greys: table header `#f9fafb` on `#ebebeb`, header text `#9ca3af`, body text `#6b7280`, ink
`#111827` / `#1f2937`, the pearl field fill `#f7f7f5`.

### Type

| element | size | weight |
|---|---|---|
| table header | 10px | 500, uppercase, `letter-spacing: 0.05em` |
| description-mode toggle | 9px | 500, uppercase |
| rail head ("Inbox", "N orders") | 10px | normal |
| punched divider | 10px | normal |
| rail order name | 13px | 600 |
| Bill To caption | 9.5px | 600, uppercase, `tracking-[0.06em]` |
| Bill To name | 14.5px | 700 |
| Bill To detail line | 11.5px | normal (code chip 11px, mono) |
| meta row segments | 11.5px | normal |
| readiness chip | 10px | 600 |
| SO field + green pill | 14px | 500, **mono** |
| "Order No." caption | 10px | 500 |
| Punch button | 12px | 600 |
| action buttons (Urgent/Hold/Slot/Notes/Copy) | 11px | 500 |
| sidebar nav row | 12.5px | 500, 600 when active |
| instructions strip remark | 11–20px, per user | normal |

### Metrics

- Sidebar **72px** collapsed / **220px** expanded; nav icons 15px expanded, 17px collapsed.
- Rail head row **28px**; rail order row `px-3.5 py-2.5` with a **3px** left state bar and a
  `border-b border-gray-100`.
- Table header row **32px**; header cells `padding: 0 14px`; first and last rows get a
  `4px solid transparent` edge so the block breathes inside its scroller.
- Cards: `border border-gray-200 rounded-lg px-3 py-2.5`.
- SO field `w-[120px] h-[30px]`, radius 10px, focus `border-brand-600` + `ring-2
  ring-brand-600/15`; Punch `h-[32px] px-3.5`, radius 6px; the ✓/✕ editor buttons 26×26.
- Action buttons ~26px tall, radius 6px, `border-gray-200 bg-white text-gray-600`.

### The wordmark

One treatment, one place: the top of the sidebar, the word *Orbit* alone in `text-brand-800`,
19px tall expanded and 14px collapsed. No symbol, no product name beside it, no role label.

---

## H. DOC-VS-CODE DRIFT

Nothing fixed. Each row is a place a doc would mislead somebody building Part 2.

| # | doc | says | the code | evidence |
|---|---|---|---|---|
| 1 | `CLAUDE_UI.md` §2 | **"Teal brand system"** | The brand is **Orbit violet** `#7C3AED`. The teal was reassigned wholesale on 2026-09-09 | commits `5daa58fc` "reassign 57 non-brand teals", `c96157ea` "teal brand colour becomes Orbit violet"; `tailwind.config.ts` `brand.600 = #7C3AED` |
| 2 | `CLAUDE_UI.md` §19 | "Mail Orders — table column widths" | Those are `mail-orders-table.tsx`'s columns. The screen a billing operator sees has a **different ten-column set** with its own `<colgroup>` percentages (§B.6) | `review-view.tsx:2435-2446` |
| 3 | `CLAUDE_UI.md` §6 | the universal header system, with title, stats and segments | On this screen the flag passes `title`, `stats` and `segments` as `undefined` and suppresses the filter bar — **most of the header is not there** | `mail-orders-page.tsx:1243-1299` |
| 4 | `CLAUDE_MAIL_ORDERS.md` §9 | "View modes — Table \| Review", presented as a choice | With `billingV2` ON the toggle is not rendered, so `viewMode` can never leave `"focus"`. Not a choice — a fixed face | `mail-orders-page.tsx:169, 1243` |
| 5 | `CLAUDE_MAIL_ORDERS.md` header | "Enrichment v3", and §4 is titled "enrichment engine — lib/mail-orders/enrich.ts v3" | `enrich-v2.ts` exists beside `enrich.ts` and carries its own generate → verify → rank engine. **UNVERIFIED —** which one the live ingest path calls; reading the import in `app/api/mail-orders/ingest/route.ts` would settle it | `lib/mail-orders/enrich-v2.ts:1-12` |
| 6 | `CLAUDE_MAIL_ORDERS.md` §23 | the billing v2 face is a **PILOT, flag-gated, operations id 20 only** | Still true as a gate, but the face has since grown per-user access ticks for Picking and for all four action buttons — a richer permission surface than "one pilot user" | `layout.tsx:56-92`; commits `9bc027a9`, `a991a1c4` |
| 7 | `CLAUDE_MAIL_ORDERS.md` §23 | describes the rail head as carrying an **"Inbox" label** | Both are in the file: a comment at `:2784` says the label *"was dropped 2026-08-01"*, and the live block at `:2809` renders `<span className="uppercase tracking-wide">Inbox</span>`. The label is **on**; the comment above it is stale | `review-view.tsx:2784` vs `:2809` |
| 8 | in-code comment | "State 2: copy all SKU codes (**batch of 20**)" | `BATCH_COPY_LIMIT = 14` | `mail-orders-page.tsx:911` vs `utils.ts:122` |
| 9 | `CLAUDE_MAIL_ORDERS.md` §3 | parser "v7.3.0 (repo copy)" with the live PC at "≥v7.2" | Unchanged and still honest, but worth carrying into Part 2: **the parser is not in this repo**, so no line-level claim about what a `/po2` order looks like on the board can be verified from here | §3, and the absence of the live script |
| 10 | `CLAUDE_MAIL_ORDERS.md` §1 | Primary user named, with a staff id | A real person's name and id sit in a doc that feeds prompts. Not a screen leak, but it is the kind of thing that must not travel into a client deck | §1 |

---

## I. WHAT PART 2 MUST NOT SHOW

The client version is **one nav item and two controls — Copy and Notes.** Everything below is
named by its component so a build prompt can switch it off precisely.

### I.1 Cut from the shell

| what | component / prop | why |
|---|---|---|
| every sidebar icon except Billing | `components/shared/role-sidebar.tsx` — render a one-item `navItems` array | Tinting, Floor Control, Import, Customers, SKUs, Routes, Vehicles, Trip Report, PO, MRN, CI, Challans, Sampling, Shade Master, TI Report are all other people's work |
| the role label and user block | `role-sidebar.tsx` `ROLE_LABELS`, the foot block | names a staff member |
| the whole top header | `components/universal-header.tsx` | takes Import, search, the clock and the keyboard button with it |
| Import | `universal-header.tsx` `showImport` / `importVariant` | internal SAP OBD ingestion |
| search | `universal-header.tsx` `searchValue` / `searchPlaceholder="Search orders..."` | |
| filters | `components/header-filter.tsx`, `MO_FILTER_GROUPS` | |
| the date stepper | `components/header-date-stepper.tsx` | |
| keyboard shortcuts panel | `components/header-shortcuts.tsx` | already suppressed on the billing face; keep it out |
| Table / Focus toggle and the `{n}% punched` header chip | the `title` slot in `mail-orders-page.tsx:1243` | the client sees one face |
| slot segments 1–9 | `segments` / `headerSegments` | |

### I.2 Cut from the screen

| what | component | why |
|---|---|---|
| the Orders \| Picking tab bar | `components/billing/billing-tab-bar.tsx` | a second module |
| the Picking tab body | `components/billing/billing-picking-tab.tsx` | |
| the action ribbon — `⚡ Urgent`, `⚑ Hold`, `Slot` | `components/billing/billing-action-ribbon.tsx` | internal dispatch decisions |
| the dispatch slot picker behind Slot | `components/floor/dispatch-slot-picker.tsx` | |
| the ship-to pencil | `components/billing/billing-ship-to-pencil.tsx` | an override control |
| every signal pill | `components/mail-orders/signal-pill.tsx` + `getOrderSignals` | `OD`, `CI`, `Bounce`, `Bill Tomorrow`, `Cross {DEPOT}`, `Urgent`, `7 Days`, `Extension`, `Bill {n}`, `DPL`, `Challan`, `Truck Order` — every one of these is a credit, a dispute or an internal instruction |
| the remark / dispatch strip | `components/mail-orders/instructions-strip.tsx` | delivery and billing instructions in a dealer's own words |
| **notes content** | the Notes modal body in `review-view.tsx` | the Notes **button** stays; what is inside it never opens on screen |
| the notes size stepper | `components/mail-orders/notes-font-size-provider.tsx` | internal preference |
| the tutorial overlay | `app/(mail-orders)/mail-orders/tutorial-overlay.tsx` | |
| split, lock and flag controls | `slot-completion-modal.tsx`, `toggleLock`, `onFlag` | |
| the SO email panel | `components/mail-orders/so-email-panel.tsx` | contains addresses |
| the customer resolver popover and SKU resolver | `resolve-line-panel.tsx`, `line-status-panel.tsx`, `searchCustomers` | shows the live customer master |
| the `long`/`short` description toggle | `review-view.tsx:2455` | a working control, not part of the story |
| Print | the printer button in `renderDetailHeader` | |

### I.3 Keep

- One sidebar item: **Billing**, the `Mail` icon, active.
- The INBOX rail with its `{n} orders · {pct}% punched` head and its rows.
- The Bill To card (invented dealer, real area, real delivery type).
- The line table, all ten columns.
- **Copy** and **Notes** in the meta row, the readiness chip, the SO field, the Punch button and
  the green SO pill.
- The counter under the rail and the "All caught up" end state.

### I.4 Anything that reveals a real person — flag list

| where | what | verdict |
|---|---|---|
| **Bill To card** | `customerName` + `customerCode` + area | **Real dealers.** Use the invented names in §F |
| **Rail rows** | the same customer name on every row, or `cleanSubject(order.subject)` when unmatched — i.e. **the raw email subject line** | the subject can carry a sender's name or address. Never show an unmatched row |
| **Ship To card** | a second real customer, sometimes a site address | cut |
| **Instructions strip** | free-text delivery remarks — routinely name a person or a site | cut |
| **Notes** | free text, operator-written | button only, never the content |
| **Meta row** | the **sales officer's name** (`soName`) and `punched by {name}` | both are real staff. Replace with the deck's own invented SO, or drop |
| **SO email panel** | `surat.order@outlook.com` (the parser inbox) and `surat.depot@akzonobel.com` | never render either address |
| **Sidebar foot** | user name + initials + "Billing Operator" | cut |
| **Customer resolver** | searches the live customer master — a list of real dealers with codes | cut |
| **`CLAUDE_MAIL_ORDERS.md` §1** | names the primary user and a staff id | keep out of the deck and out of any prompt quoted in it |

No phone numbers render on this screen — `components/admin/customers-*.tsx` carry them, and that
screen is not part of Part 2.

---

*Read-only discovery. No file outside this one was written, no dev server was started, and
nothing was committed.*
