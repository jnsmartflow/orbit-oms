# code-update-2026-07-09-support-filter-search

Session: Support board — Filter rework + duplicate search removal
Date: 2026-07-09
Commit: `10db2023` (single commit, main)
Status: live and verified in browser

Consolidate into: `CLAUDE_SUPPORT.md` (new §4.18) and `CLAUDE_UI.md` (§58 Support visual spec).

---

## 1. What changed, in one line

The Support board's Filter control was half-dead and lied about its own state. It now has four working groups. The two search boxes became one, and that one now finds more than either did before.

---

## 2. What the Filter was doing before (diagnosis findings — keep for the record)

Defined in `support-page-content.tsx:484-488`, rendered by `UniversalHeader`.

| Group | Options offered | Reality |
|---|---|---|
| View | Hold Only | Worked. Flipped `mainTab`, triggered a real re-fetch with `section=hold`. |
| Status | Pending / Dispatch / Dispatched | Worked, but only for a single selection. Selecting 2+ silently collapsed to "all". |
| Delivery Type | Local / UPC / IGT | **Dead.** Wrote to `headerFilters.deliveryType`. Nothing ever read it. |
| Priority | — | **Ghost.** State key existed at `:81`. No UI ever offered it. |

All filtering was client-side, in-memory, over the already-loaded list. `fetchOrders` only ever sent `date`, `section`, `slotId` — never status or priority, even though the API supports both.

**The bug that killed trust in the control:** the date-change effect (`:104-107`) force-reset `mainTab` from `hold` → `all` when moving to a history date, but never cleared `headerFilters.view`. The Filter pill kept showing "Hold Only · 1" while the board silently rendered everything. Filter UI and board state desynced.

State was plain `useState` — reset on navigation, no URL or localStorage persistence.

---

## 3. What the Filter is now

Four groups, in this order:

1. **View** — single toggle: `Hold Only`. This is the **only route to the Hold tab** (the tabs row shows arrival slots, not Hold). Do not remove it.
2. **SMU** — multi-select. Options derived **live from the loaded orders** (distinct, sorted), so a zero-row SMU never appears. Never hardcode this list.
3. **Delivery Type** — multi-select: Local / UPC / IGT. Now actually wired.
4. **Priority** — multi-select, labels from `getPriLabel`. Now has UI.

**Status group deleted.** Status is already a visible column with three values, and the slot tabs plus Hold tab do the real splitting.

Semantics:
- Groups **AND** together. Options within a group **OR** together.
- Multi-select works. The old `length === 1` collapse at `:93-95` is gone.
- Filter pill badge = total selected options across all four groups.
- "Clear all" inside the popover, visible only when badge > 0.
- SMU / Delivery Type / Priority also narrow the **Hold tab** and the **"N pending from earlier"** carry-over list.
- Filtering runs at the **page level, before `groupOrders`**, so Group-by header counts always match visible rows.
- State still resets on navigation. Deliberate. Do not add URL or localStorage persistence.

**Desync bug fixed:** the date-change effect now does `setMainTab("all")` **and** `setHeaderFilters(prev => ({...prev, view: []}))` in the same beat. One source of truth.

---

## 4. Search — one box, wider reach

There were two. The header search (with the `/` shortcut) and a toolbar search beside Export. They were **not** duplicates: the toolbar one matched route name, the header one did not. The header one did not apply to the Hold tab at all.

**The toolbar search box is deleted.** The header search is now a strict superset.

Fields matched (case-insensitive, substring, trimmed, all null-guarded):

- `obdNumber`
- `customer.customerName`
- `shipToCustomerName`
- `shipToCustomerId` — **the code visible on screen**, in gray under the customer name
- `customer.customerCode` — the customer-master code, **not shown on screen**
- `customer.area.primaryRoute.name`

**The two-code trap — remember this.** The board displays `shipToCustomerId`, a top-level scalar on `orders`. The customer master has its own separate `customerCode` on `delivery_point_master`. They are usually the same value and sometimes are not — that is the entire reason ship-to override exists. Search matches **both**, so a code copied off the screen and a code copied out of SAP both land.

Placeholder: `Search OBD, customer, code, route...`. `/` shortcut kept.

Header search now applies to the **Hold tab** too (`SupportHoldTable` receives `displayOrders`, not raw `orders`).

Toolbar after the change: **Select All** (left) · **Group by + Export** (right). Nothing else.

Every consumer of the old toolbar search state was rewired to read the page-level filtered+searched list passed down as a prop: Select All / `selectableIds`, Group by → `groups`, Export CSV rows, the Done section, and the bulk bar's `selectedOrders` / qty / customer-count. **Export exports exactly what is visible.**

---

## 5. API change (the only one)

`app/api/support/orders/route.ts` — **one additive line**: `customerCode: true` added to `ORDER_INCLUDE.customer.select`.

Strictly additive. No query params changed, no where-clause arms touched, no response semantics changed. Filtering remains 100% client-side over the loaded list. The field simply now reaches the client so the search matcher can see it.

---

## 6. Type correction

`orders.shipToCustomerId` is `String?` in the schema (`schema.prisma:551`). The `SupportOrder` interface in `support-orders-table.tsx` typed it as non-null `string`. The interface was promising something the database does not guarantee. Widened, and the render at `table-cells.tsx:149-151` made null-safe.

`orders.smu` is also `String?` (`schema.prisma:539`) — matches the existing `order.smu || "Unknown SMU"` fallback in `getSmuGroup()`.

---

## 7. Things not to undo

- **The percentage GRID sizing model in `table-cells.tsx` was not touched and must not be.** See `code-update-2026-07-09-support-table-rework.md` §2 for why three other schemes failed.
- Filtering stays **client-side**. If a future session wants server-side filtering, that is an API contract change and needs an explicit go-ahead.
- `ship-to-override-cell.tsx` and `dispatch-slot-picker.tsx` untouched.
- The **View → Hold Only** filter group is load-bearing. Removing it strands the Hold tab.
- SMU options are **derived at runtime**. Never hardcode.

---

## 8. Verified

`npx tsc --noEmit` clean. Four checks confirmed live in the browser on `orbitoms.in/operations/support`:

1. Local + UPC selected → IGT rows hidden.
2. Two priorities selected → both show (proves the multi-select fix).
3. Customer code typed from screen → row matches.
4. Hold Only ON, date changed → Filter badge clears, board shows "all". No lie.

Remaining smoke tests (route search, Select All scoping, Export scoping, Group-by counts, empty-slot-tab) were verified by code trace only, not by browser. Low risk — all are pure client-side list plumbing over the same array.

---

## 9. Open

- The Hold tab's search behaviour was previously absent — unclear from code or docs whether that was deliberate or an oversight. Now it searches. If there was a reason it did not, nobody wrote it down.
- Whether a Priority filter was ever wired and later stripped, or never built. Vestigial state at `:81` suggests the former. Not investigated.
