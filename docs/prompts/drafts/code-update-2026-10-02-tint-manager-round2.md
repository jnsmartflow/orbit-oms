# code-update-2026-10-02 — Tint Manager round 2 (SHIPPED)

> Draft for the consolidation job. **Not canon.** Builds on round 1
> (`code-update-2026-10-01-tint-manager-tabs.md`). Read against `CLAUDE_CORE.md` v121 · Schema v27.50.
> **No schema change.** One DATA change (§9). Every commit listed was confirmed on `origin/main`
> on 2026-10-02. Discovery: `code-discovery-2026-10-02-tint-manager-round2.md`.
> Mockups: `docs/mockups/tint-manager/` — `tint-manager-site-missing-mockup.html`,
> `tint-manager-add-shipto-form-mockup.html`, `tint-manager-missing-card-mockup.html`.

---

## 1. Commits

| Commit | What |
|---|---|
| `83205fcf` | Tint tab uses the full page width |
| `5c8efc2c` | header like Billing, tab-row tools, filter cleanup, done-today IST fix |
| `8898ce08` | search across the rail and all tabs + server fallback |
| `805e9b60` | history — date stepper, read-only past days for Tint, Base, TI, CI |
| `8a9cc388` | uniform tab-row buttons; search placeholder "Search orders…" like Billing |
| `8b448344` | "Base — No Tint" is a base order: Base tab + "No tint" tag, TI done stays the day, Floor shows TINT/BASE like Picking |
| `265606a3` | missing-customer chip, "+ Add Ship to" tags, jump to Base (and the 8-second nudge — removed in `15f5072e`) |
| `b76d39a3` | missing-customer rule covers picked bills and checks the master, not only the flag |
| `12b609a0` | one-page Add ship-to form, shared customer-create, order-entry keyword |
| `1e5d7f06` | Add ship-to: every field mandatory; challan master name, Receiver first, contacts oldest first |
| `15f5072e` | missing-customer card — one per customer, FIFO, 2 min each |
| `ec22c0ca` | the card sits above the bottom bar; timer shows m:ss only |

⚠ **Not shipped, despite appearing in the round-2 brief:** "tint-only counts / tint-only litres" and
"per-operator pace". Checked in code on 2026-10-02: the Tint tab's litres are the bill's whole
volume (`volumeLitres`) and Pace is board-wide only (`board-tint-tab.tsx:266-273`). What DID ship:
the "Base — No Tint" placeholder is excluded from the done set (round 1 §9) and articles read
"Drum · Tin". Do not document the other two as live.

---

## 2. Layout, header, filters

- **Full width** — the Tint tab dropped its `max-w-[1500px]`.
- **Header like Billing** — `UniversalHeader` with `importVariant="primary"`, `suppressFilterBar`,
  `searchLayout="wide-right"`, `showClock={false}`, `showShortcutsButton={false}`; search placeholder
  "Search orders…".
- **Tab-row tools** (the tab bar's `rightSlot`): missing-customer chip · date stepper │ Filter ·
  ⌨ shortcuts │ **+ Add to Tint**. One control set (`8a9cc388`): 24px high, 5px radius, the gray-200
  border, 10px text, 11px icons — Billing's Filter button is the reference. + Add to Tint is the black
  primary (ink-900). The shared components are sized from outside by wrappers; Floor and Billing
  are unchanged.
- **Filters** — Delivery Type with the master's real names (**Local · Upcountry (UPC) · IGT ·
  Cross**; the old "Cross Depot" matched nothing), **Urgent only**, and (round 2b) **Missing
  customer**. Split / Whole removed. ONE predicate (`passesFilters`) for the rail and every tab.
- **Done-today IST fix** — the orders and marker routes use `getISTDayRange().start` (it was
  server-local midnight = 05:30 IST on Vercel). `base-pending` gained `deliveryTypeName` and
  `priorityLevel`.
- `ConnectionStrip` renders only when disconnected.

---

## 3. Search (`8898ce08`)

- **One matcher** — `lib/floor/search.ts`, imported, never edited.
- **TM adapters** — `lib/tint/search.ts` turns each row into `Searchable` views (OBD, invoice, SO,
  ship-to name and code, bill-to name and code, original ship-to). Since round 2b a missing-customer
  bill also matches the words "missing customer".
- **Dropdown** — `components/tint/manager/search-sources.tsx` + `search-dropdown.tsx`, grouped by
  place, the "Not on Tint Manager" group last.
- **Server fallback** — `GET /api/tint/manager/find` for bills on no tab.

---

## 4. History (`805e9b60`)

- `HeaderDateStepper` in the tab row, with two defaulted props: `pastLabel="weekday"` ("Wed · 30 Sep")
  and `tone="warn"`. Floor and Billing are unchanged. The next arrow is capped at today; picking today
  returns to live.
- Routes take an optional `?date=YYYY-MM-DD` (IST via `getISTDayRange`); without it the response is
  unchanged.
  - **Tint** `orders?date=` — jobs completed that day.
  - **Base** `base?date=` — Floor history ∩ the Base set + the trip cut-off dated to that day.
  - **TI** `base-pending?date=` — Base — No Tint bills with a TI written that day (who, when, sampling numbers).
  - **CI** `cancelled?date=` — `getFloorCancelled` gained an optional `date` (Floor passes none).
- **Read-only** — amber bar "Viewing {day} — read only." + Back to today. Hidden: rail, + Add to Tint,
  the bottom bar, ▲▼, ⋯, every action. Detail panel read-only; marker paused.
- **Hold** has no history (greyed); **Delete** keeps its own month picker.

---

## 5. "Base — No Tint" is a base order (`8b448344`)

- **`lib/tint/base-bills.ts`** — `tintManagerBaseWhere()` is a SUPERSET filter for the read: non-tint
  74/77 OR 74/77 tint bills with a placeholder-owned finished assignment (`getBaseOperatorId()`, never
  a fixed id). `isTintManagerBaseRow()` is the DECISION: Picking's rule says base
  (`colourWork === "base"`, `lib/picking/colour-work.ts` `resolveColourWork`). No second rule.
- **Base tab** — these bills join it, with a small grey **"No tint"** tag by the OBD. All Base actions
  work the same. The Tint tab still excludes them.
- **TI tab** — a fully written bill stays for the rest of the IST day as a read-only row with a green
  **"TI done HH:MM"** pill, after the pending rows; the tab count is pending only. History still shows
  that day's TIs.
- **Floor** — the status pill no longer reads "Tint done" for such a bill (`tintPhase` null when
  `colourWork` is base, `lib/floor/queries.ts`), and Floor's "Tint" filter flag skips it
  (`lib/floor/filter.ts`). The TINT/BASE badge was already right. Picking unchanged.
- **Marker** — arm 6 uses the superset (it catches the bypass); the TI-entry stamp catches a TI write.

---

## 6. Missing customer

- **The rule — `lib/tint/customer-missing.ts`**, ONE helper for the chip, tab dots, filter, row marks,
  tags, card, search word and `GET /api/tint/manager/missing-customers`:
  SMU 74/77 · open (not removed, cancelled or dispatched — **any** other stage, picked and checked
  included) · no ship-to override set · AND (the SAP ship-to code has no `delivery_point_master` row
  OR `orders.customerMissing` is true). Run as ONE SQL statement (`CUSTOMER_MISSING_IDS_SQL`), then
  the hide rules. Only bills the board shows count (rail, Tint, Base, TI, Hold); never CI, Delete or
  history. "Urgent today" = dispatch target day or trip day is today (IST).
- **Chip** — tab row, left of the stepper: "⚠ N missing customer", solid orange, red with
  "N urgent ·". Click = Missing customer filter on + jump to Base (else Hold, TI, Tint); again = off.
- **Tab dots, rows, tags** — orange dot on a tab holding one; amber row + 4px orange bar; under the
  ship-to name the SAP code + an orange **"+ Add Ship to"** tag (greyed without `customers` canEdit,
  "No permission to add customers"). Shared through `components/tint/manager/missing-customer.tsx`.
- **The card** (`components/tint/manager/missing-card.tsx`) — ONE customer per card; this user's
  undismissed bills, **oldest first** (FIFO by `orders.createdAt`), later arrivals join the end.
  2 minutes each from when that card appears, then dismissed for today and the next shows. Pauses
  while the Add ship-to form is open; Cancel resumes. A save shows "✓ Added" ~1s. When the queue
  empties the card shrinks into the chip, which pulses once. Sits 12px above an open bottom bar
  (measured, not guessed) and below it in z-order. Dismissed ids: localStorage
  **`tm_missing_dismissed:<userId>:<YYYY-MM-DD IST>`** (try/catch; in memory if blocked).
- **Tried and removed:** an 8-second "new ship-to" nudge with Later / ✕ (`265606a3`), replaced by the
  card in `15f5072e`. Do not re-add it.
- The old "N missing" badge + popover were removed. The Assign / Base — No Tint interceptor is
  unchanged (it opens the Add ship-to form now and still replays after the save).

---

## 7. Add ship-to form

- **UI** — `components/tint/manager/add-ship-to-sheet.tsx`, one page: Code (read-only) · Name ·
  near-duplicate note · Site address · Area · Sales person (+ details card) · Receivers (+ add / ✕).
  It replaced `CustomerMissingSheet` on the Tint Manager. That file now has **no callers**, and was
  left in place.
- **Rules** — `lib/customers/ship-to-rules.ts`, shared by the form and the route, **every field
  mandatory**: address ≥ 10 chars · area · a sales person **with a phone** in `sales_officer_master`
  (on 2026-10-02 only "TEST — Smart Flow" #19 had none) · at least one receiver with a ≥2-char name
  AND a 10-digit mobile starting 6–9 (spaces, dashes, +91 / 91 / 0 stripped). Partly filled extra
  rows refused; empty extra rows ignored.
- **Save** — `POST /api/tint/manager/ship-to/create` (gate `customers` canEdit, same as the admin).
  Server core `lib/customers/create-customer.ts`, **extracted from `POST /api/admin/customers`**, which
  now calls it too (behaviour unchanged; the admin keeps its pre-existing `$transaction` via an
  option, the TM route uses none). Writes:
  - `delivery_point_master` — code, name, address, area; route + delivery type NULL = "Use area default".
  - `delivery_point_contacts` — the receivers, role **"Receiver"** by name (else "Site Engineer"), the
    first listed first.
  - `customer_sales_officers` — the one sales person as PRIMARY + SoSync (which adds the SO's own
    contact and, by `enforcePrimaryContactRule`, makes it the site's primary contact).
  - the backfill — every orphan order with that ship-to code: `customerMissing` false + `customerId`.
  - `mo_customer_keywords` — one row if none exists for the code (findFirst + create: no unique on
    `customerCode`), so the site is searchable in `/po` and `/place-order`.
  400 if the code is already in the master. ONE success toast: "✓ {name} added to master · N bills updated".
- `GET /api/tint/manager/ship-to/options` — active areas, active sales officers, ≤5 similar names.

---

## 8. Delivery challan (`app/api/tint/manager/challans/[orderId]/route.ts`)

The challan is re-resolved from the customer master on every GET (only number, transporter, vehicle,
formulas and print/void are stored), so these apply to old challans on their next open:
- **SHIP TO name** — the master `customerName` when a master record exists (ship-to or override);
  SAP's name only when there is none. Code unchanged.
- **SITE / RECEIVER** — `SITE_ROLES` = Receiver, Site Engineer, Contractor, Supervisor.
- **Contacts oldest first** — `orderBy: { id: "asc" }` on all three ship-to contact lists (normal,
  same-code refetch, override).

---

## 9. Data change (no DDL, no schema bump)

`contact_role_master` row **"Receiver" (id 6)** — inserted by the owner through the SQL Editor
(confirmed by read-only SELECT 2026-10-02: ids 1 Owner · 2 Contractor · 3 Manager · 4 Site Engineer ·
5 Sales Officer · 6 Receiver). Data only; no schema version change.

---

## 10. Lessons

1. **A copied filter keeps its old scope.** The first missing-customer rule copied the old badge's
   stage filter (`notIn SUPPORT_DONE_STAGE_NAMES`, every stage ranked ≥ 60), which silently hid every
   picked and checked bill — the Base tab's whole population. Check a copied filter's scope against
   the NEW screen before reusing it.
2. **Builds on the depot PC: delete `.next`, never move it aside.** Twenty-two `.next-stale-*`
   folders (~14 GB) filled the disk and failed a build with ENOSPC. Run `next build` **alone** —
   parallel parity scripts during a build ran the machine out of memory.

---

*Draft · 2026-10-02 · for the Tint Manager consolidation pass.*

**Shipped later the same day — `8379d434`:** the Tint tab now counts TINT LINES ONLY (`import_raw_line_items.isTinting`, one helper `lib/tint/tint-lines.ts`, new orders-route fields `tintVolume` / `tintArticleTag`) in the summary cards, operator board, group headers, Vol / Art. columns and history, and each operator shows "avg N L/hr" (same pace rule as the top card: tint litres done ÷ hours since that operator's first start, to the last finish on a history day). This supersedes the "Not shipped" note in §1.

**Shipped 2026-10-03 — `916ae32c`:** Tint tab Operators board draws TWO tracks per operator (top = work segments: green done, blue tinting; bottom = orange striped pause segments, only when there is one), rebuilt from `tint_pause_events` + the `tint_logs` "started" row (`lib/tint/job-track.ts`; new orders-route fields `jobTrack`, `formulaLines`); one status word per operator; a cursor hover card (Done/Tinting: tint L · articles, time, took, formula values; Paused: reason, remark, since/for, progress); and a FORMULA column in the Tint tab tables (first line + "+N line"). ⚠ `elapsedMinutesAtPause` is minutes of THAT run, not cumulative (the pause route), whatever §5 says.

**Shipped 2026-10-03 — `a3033e9a`:** Operators board round 3 — a WORK block hovers as "Worked HH:MM – HH:MM · N min" + "Total worked" (done = accumulatedMinutes; a paused job's faded-blue block shows the work card with a Paused pill, not the pause card); hovering any piece outlines every piece of that job on both tracks; blocks inset 1px a side (2px gap) and at least 6px wide, centred on their time; durations under a minute read "under 1 min"; with 2+ tint lines each formula row is prefixed by the line's own articles ("14 Drum · LFY 10 · BLK 25"), new optional `formulaLines[].articles` on the orders route (also in the Formula cell's hover).
