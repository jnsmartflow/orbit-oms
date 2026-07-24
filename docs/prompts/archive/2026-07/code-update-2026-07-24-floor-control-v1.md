# Floor Control v1 — build session

**Date:** 23–24 July 2026
**Type:** `code-update` — shipped, merge as current reality
**Module:** Floor Control (`/floor`) — NEW
**Schema:** v27.12 (unchanged — no migration in this build)
**Commits:** 13, `310d774c` → `64065146`, all direct to main

---

## 1. What was built

`/floor` — a new module that merges what Support and Picking do for one
person: the desk operator who decides which bills go to the floor and
watches what happens to them there.

Support and Picking were **not modified**. Both remain live. The only
change outside the Floor module was a bug fix to the dispatch engine
(§3.1 below).

**Intended future state (stated by Smart Flow, not yet actioned):** once
Floor Control is proven, the DESKTOP versions of Support and Picking may
be retired. The mobile picking surfaces (supervisor board, picker face)
stay. Nothing has been switched off yet.

### Screen structure

| Zone | Contents |
|---|---|
| Header | Hand-rolled: title + date/time; delivery-type scope chips; search + filter |
| Left rail | "Needs your decision" — bills enrichment could not slot |
| Right pane | Floor / On hold / Cancelled tabs |
| Floor | Slot tabs (10:30 / 12:30 / 16:00 / 18:00 / All), slot bands, route rows, table, four status pills |
| Detail | 472px slide-in panel: Items / Details / Activity |

### The left/right split (the module's core rule)

- A bill enrichment **successfully slotted** never appears on the left
  rail. It appears on the right, carrying its stored
  `dispatchTargetDate` / `dispatchWindowId`.
- The left rail holds **only** bills enrichment could not slot. Having no
  slot is precisely why they are there.
- The rail's suggested slot (when re-enabled) is a render-time
  computation against an empty stored value, written only on Release.

Design doc §3 lines 59–73 and §6.4 line 258 are the authority.

---

## 2. Build steps and commits

| Step | What | Commit |
|---|---|---|
| 0 | Dispatch engine Sunday fix | `310d774c` |
| 1 | Permissions + route + shell | `d3c013dd` |
| 2 | Data layer — 4 read feeds | committed |
| 2b | One-time backlog cleanup (SQL) | live data |
| 3 | Left rail + card + tint strip + Release | `93e47c9f` |
| 3b | Slot suggestion disabled | `820a958a` |
| 4 | Floor pane | `2da09c3f` |
| 5 | Selection + assignment bar + actions | `34fad163` |
| 6 | Hold + Cancelled tabs + PDF | `355c83e6` |
| 6b | Hold-release silent no-op fix | `7ec6aa08` |
| 7 | Detail panel | `8d87914a` |
| 8 | Search + filter | `e4276dd1` |
| 9 | Live sync | `d476cf0e` |
| 9b | Carried-over bill vanished on check — fix | `64065146` |
| 10 | Slot suggestion re-enable | **NOT BUILT — deferred** |

---

## 3. Bugs found and fixed

### 3.1 Dispatch engine slotted bills to Sunday [FIXED]

`evaluateDispatchSlot()` rolled a late bill to the next **calendar** day.
A Saturday-evening Local or Upcountry bill was therefore slotted to
Sunday, when the depot is closed.

**Fix:** `nextWorkingDateOnlyUTC()` in `lib/dispatch/dispatch-engine.ts`
skips Sunday only. Saturday remains a working day. Holidays are not
modelled. Both next-day return sites consume it.

**This was a live bug independent of Floor Control** — it affected real
enrichment before this module existed.

### 3.2 Hold-tab release silently did nothing [FIXED]

Holding a bill from the floor, then releasing it from the Hold tab, was
accepted by the UI and wrote nothing.

**Root cause:** the release route (built for the rail) required
`workflowStage === "pending_support"`. A bill held from the floor sits at
`pending_picking` — hold flips `dispatchStatus` only, never the stage. It
was pushed to `failed[]`, the route returned **200**, and the client
discarded the response.

**Fix, three parts:**
1. `lib/floor/release-stages.ts` — Floor-owned `FLOOR_RELEASABLE_STAGES`
   = `["pending_support", "pending_picking"]`. Deliberately **not**
   `supportMayEdit()` — borrowing Support's permission predicate would
   couple Floor's release gate to Support's permission model.
2. Release and actions routes return **422** when nothing was written.
   Partial success stays 200 but always carries `failed[]`.
3. Client `postJson` reads the response; `reportWrite()` surfaces every
   non-2xx, hard error, or non-empty `failed[]`. The rail release path
   had the **same swallow** and is fixed by the same change.

Also fixed: the release log wrote a hardcoded `fromStage:
"pending_support"`, which would have recorded a false audit trail on
every hold release.

### 3.3 Carried-over bill vanished the moment it was checked [FIXED]

Three bills assigned to one picker, checked within a minute of each
other. Two stayed as Done; the third disappeared from the board entirely.

**Root cause:** the live scope was *(open, any date)* OR *(checked,
`dispatchTargetDate` = today)*. A carried-over bill hung on by the first
arm until checked, then failed both.

Live evidence:
```
9108438718  target 2026-07-24  checked 24 Jul 06:18  → stayed
9108501801  target 2026-07-24  checked 24 Jul 06:18  → stayed
9108440229  target 2026-07-23  checked 24 Jul 06:17  → VANISHED
```

**Fix:** the "checked" arm now fences on `pick_assignments.checkedAt`
within today's IST range (`getISTDayRange`), not on `dispatchTargetDate`.

**Rule in plain English:** the board shows everything still open whatever
day it was due, plus everything the floor finished today whatever day it
was due. A bill can never disappear at the moment of completion.

Expected side effect: a carried-over bill checked today appears under
today's Done while its band header still shows its **original** slot.
Correct and intended.

### 3.4 Stale slot suggestion [REMOVED, NOT FIXED]

Rail cards showed "Release to Wed 16:00" on a Thursday. The staleness
check compared clock time only (minutes since midnight), not the full
date — a window that passed earlier today greyed out correctly, but one
that passed on an earlier day sailed through.

Smart Flow chose to **remove the suggestion entirely** rather than patch
it, and revisit after the workflow has been used. See §7.

---

## 4. Architecture decisions

### The dispatch engine is LIVE — three canonical files are wrong

`lib/dispatch/dispatch-engine.ts` is built, wired into
`applyMailOrderEnrichment()` (`app/api/import/obd/route.ts`), and firing
in production. Confirmed against live data: **1045 rows**
`dispatchSlotSource='auto'`, all six rules firing, every one
`smu='Deco Retail'`.

⚠ **CORE §7.4, SUPPORT §4.13 and SUPPORT §12 all still describe this as
[NEXT], not built.** They are stale and must be corrected at
consolidation.

Two undocumented columns support it: `orders.dispatchSlotSource`
(`auto` / `manual`) and `orders.dispatchSlotRuleId`. Neither appears in
CORE §7.3. The engine skips any order where `dispatchSlotSource =
'manual'` — a human decision is never overwritten.

**Engine scope is deliberately narrow:** it fires only for
`smu = 'Deco Retail'`. Decorative Projects, Retail Offtake and
Distributor never auto-slot; they reach the rail and the operator
chooses. Reviewed and approved — not an oversight.

### `heldAt` is arrival date, not hold time — read-side fix

`orders.heldAt` stores `obdEmailDate ?? now` — the bill's **arrival**
date. This matches Support (`app/api/support/orders/[id]/hold/route.ts:66`)
and is intentional there per CLAUDE_SUPPORT §4.9: Support anchors its
amber hold footprint to the arrival day.

Floor's Hold tab needs the opposite — how long a bill has been **on
hold**. Reading `heldAt` would show a three-week-old bill held five
minutes ago as "21 days".

**Decision: the write was NOT changed.** Flipping it to `now` would move
the amber Hold marker on Support's history board — a regression in a
module out of scope — and would only half-fix Floor.

**The fix is on the read side** in `getFloorHold()`: "held since" derives
from the hold event's wall-clock `order_status_logs.createdAt`.

- Hold events are identified by the log **NOTE**, via a shared exported
  constant — **not** a sentinel `toStage`. A fake value in `toStage`
  would pollute the stage ladder for every future query that reads
  stages.
- Both the Floor note and Support's two hold notes
  (`"Placed on hold by support"`, `"Placed on hold by support (bulk)"`)
  are matched, so a Support-held bill groups correctly on the Floor.
- Fallback ladder: hold log → `orders.heldAt` (rendered with a leading
  `~` and an "approximate" tooltip) → unknown (banded separately under
  "Held date unknown"). Nothing can silently read as "held today".

### Live sync — two mechanisms, and one decoupling

Rail uses the Mail Orders pattern (30s full refetch). Floor uses the
Picking pattern (15s marker probe, refetch only on change). These are
genuinely different mechanisms with no shared abstraction; inventing one
was out of scope.

`lib/hooks/use-picking-marker` gained an **optional `url` parameter**
defaulting to `/api/picking/marker`, plus an optional `onProbe`. All
three Picking call sites pass neither and are byte-identical.

**Why this mattered:** as first built, the floor board watched *Picking's*
marker using its `openPending` scope — a superset of the floor's set.
That worked, but silently coupled Floor to a predicate owned by Picking.
Given that Picking's desktop board may eventually be retired, Floor would
have been depending on a leftover of a deleted module, and nothing would
have pointed at the cause when it broke. Floor now polls
`/api/floor/marker`, its own exact set, sharing `floorLiveBaseWhere()`
with the board so the two cannot drift. The same single probe drives the
connection strip — one poll, not two.

**Pause rules:** both mechanisms pause while the detail panel is open, a
selection is up, history mode is active, or the tab is hidden. A selected
row changed elsewhere is reconciled — tick cleared, toast shown — without
moving the visible board.

### Reuse boundaries

| Reused as-is | From |
|---|---|
| `POST /api/picking/assign`, `/api/picking/unassign` | Picking, unchanged |
| `lib/picking/sort.ts` — the spine | Picking |
| `components/support/dispatch-slot-picker.tsx` | Support |
| `formatArticleTag` | Support (live map is **D / C / T / B**) |
| Ship-to search + override PATCH | Support, as a **caller only** |
| `lib/hooks/use-picking-marker` | Picking, + optional params |
| `getISTDayRange` | `lib/dates.ts` |

Support's ship-to route uses `prisma.$transaction`, which CORE §3
forbids. Floor calls it as a caller; **no Floor file contains
`$transaction`**.

### Floor's own scope, not Picking's

Floor carry-over is a **new** scope: anything not `pick_checked`, any
date, plus anything checked today. `lib/picking/queue.ts`'s WHERE was
neither reused nor modified — Picking's existing carry-over excludes
`pick_done` / `pick_checked`, the known "workaround, not a fix".

### Header divergence

`/floor` deliberately does **not** use `UniversalHeader`. It is
hand-rolled to mockup `01-board.html` (title + date/time; scope chips +
search/filter). This is an approved divergence from **CLAUDE_UI §6**, and
CLAUDE_UI needs the exception written in at consolidation, or a future
session will "fix" it back.

### Print CSS

`#floor-hold-print-area` was added to `app/globals.css` for the Hold
report. Every selector is id-scoped and reuses the shared isolation model
(`body * { visibility: hidden }` + reveal by id). No new `@page`. The
four existing print surfaces — challan, mail orders, tint report, trip
sheet — are unaffected.

---

## 5. Data work done on live

### One-time backlog cleanup, 23 July

The rail opened with **261** undecided bills; only 23 were from the last
two days. 151 were over a week old, one 27 days.

Smart Flow confirmed the goods had physically gone out weeks earlier and
the system was simply never updated. **238 bills** (older than 2 days)
were closed to `workflowStage = 'dispatched'`, each with an
`order_status_logs` row: *"Bulk backfill: goods dispatched, never
recorded in system"*.

- Rail: 261 → 23
- Support's pending backlog cleared by the same 238
- Two of the 238 were `tinting_in_progress` with open splits; the splits
  were deliberately left alone

### Live SMU distribution (confirmed, useful reference)

```
Deco Retail            7080
Decorative Projects     765
Retail Offtake          479
Distributor             125
(null)                   73
Deco                      9   ← un-mapped raw XLS value
```

The site-vs-shop marker uses `{"Retail Offtake", "Decorative Projects"}` —
confirmed correct.

---

## 6. Permissions

New pageKey `"floor"` in `lib/permissions.ts` (union, `ALL_PAGE_KEYS`,
`PAGE_NAV_MAP`).

v1 access is **admin + operations only**. Rows exist in both
`prisma/seed.ts` and live `role_permissions` (granted by SQL on 23 July;
both confirmed `canView=t`, `canEdit=t`).

The design named four users — admin, operations, dispatch planner,
telecaller. `dispatch planner` has no matching slug (closest is
`dispatcher`); `telecaller` does not exist anywhere. Both deferred until
after testing.

---

## 7. Deferred — v2

### Slot suggestion [DEFERRED — Step 10, not built]

`lib/floor/suggest.ts` is intact but gated behind
`RAIL_SUGGESTIONS_ENABLED = false` in `lib/floor/queries.ts`. Flipping
that one constant re-enables it.

Every rail card currently renders `[ pick slot ] [ Hold ] [ ✕ ]` — the
operator always picks the slot himself.

**Two things must change before it comes back:**
1. **The staleness check must compare the full moment — date AND time —
   against now**, not minutes-since-midnight. This is the bug that caused
   its removal.
2. Smart Flow wants the suggestion to carry **date and time**, not time
   alone.

Deliberately deferred until v1 has been used, so the rule is designed
from real use rather than reasoned about in advance.

### Known gaps in v1

| Gap | Needs |
|---|---|
| `Waiting` pills show no elapsed time | a `releasedAt` on the floor payload |
| Ship-to original→redirect name pair missing on the floor table | original name on the floor feed (the rail already has it) |
| Assigned rows sink to the bottom of the board | a decision on whether `byAssigned` is right for this screen |
| Rail button reads lowercase "pick slot"; mockup says "Set slot" | copy fix without forking the Support picker |
| Assign bar reads "Change slot" beside a "pick slot" button | one label, one action |
| No picker search | search matches customer / route / OBD only |
| Detail panel header pill shows no elapsed time | panel is not a live surface |

### Out of scope for v1 (deliberate)

- **Gift lines** — no identifier exists anywhere in the codebase
  (`\bgift\b` returns zero matches). The GIFT tag, gift-excluded band
  totals and "gift line not counted" footer are all cut. **No heuristic
  was invented.**
- **Free-text ship-to** (§12.1) — needs a schema decision.
- **Per-row Slot column on the All view** — the band header carries it.
- Stats line right of the slot tabs, "pickers free" tile, floor-idle
  alarm — removed per design §7.13.

---

## 8. Parked issues

1. **`Deco` — 9 rows.** An un-mapped raw XLS SMU value leaking through
   one import path; should be `Deco Retail`. These bills silently never
   auto-slot.
2. **103 Deco Retail bills reached `pending_support` with
   `dispatchStatus` NULL.** The engine only fires when
   `dispatchStatus='dispatch'`, so these never auto-slotted. Something
   upstream is not setting it. **Worth a separate diagnosis session.**
3. **Four identical `Shree Rang Sarita` bills** — same timestamp
   (22 Jul 18:31), same 140 L, different OBD numbers. Possibly a
   duplicate import; possibly genuine. Unconfirmed.
4. **Pack size mismatch** — a line reading *SAT FIN 93 BASE 3.7L* carries
   pack chip `4L`, so litres compute as 4 × 4 = 16 L instead of 14.8 L.
   A catalog value, not a Floor bug. **For Chandresh's cleanup list.**
5. **Three bills marked urgent during testing** on 23 July. Should be
   cleared unless genuinely priority.
6. **Retirement dependency list.** Before any Support or Picking desktop
   screen is switched off, list exactly what Floor leans on — the assign
   endpoints, the sort spine, the slot picker, `formatArticleTag`, the
   marker hook — so the retirement is deliberate rather than a surprise.

---

## 9. Canonical file updates needed at consolidation

| File | Change |
|---|---|
| **NEW** `CLAUDE_FLOOR.md` | Floor Control gets its own canonical file + a router row |
| `CLAUDE_CORE.md` §7.4 | Dispatch engine is **LIVE**, not [NEXT] |
| `CLAUDE_CORE.md` §7.3 | Add `dispatchSlotSource`, `dispatchSlotRuleId` |
| `CLAUDE_SUPPORT.md` §4.13, §12 | Same — engine is built |
| `CLAUDE_PICKING.md` | The "no write path to `dispatched`" claim is wrong — 1051 orders carry that stage |
| `CLAUDE_UI.md` §6 | Write in the `/floor` hand-rolled header exception |
| `CLAUDE_CORE.md` | New pageKey `floor`; new module route |

---

## 10. Testing status

**Verified working against live data:** rail cards and tint strip;
release from rail; floor pane with slot tabs, bands, route rows, status
pills; carry-over banner; selection and assignment bar; assign / unassign
round trip; mark urgent; hold and release round trip; cancelled restore;
Hold tab age banding; PDF export (Trip Report print confirmed
unaffected); detail panel with Items / Details / Activity; search by
name, route and OBD; multi-number paste with auto-tick; live sync end to
end — **status pills updated on the desk screen from real picker actions
on a phone**, without a refresh.

**Not yet tested:** sustained real-world use across a full working day;
the connection-drop strip under genuine network loss; History mode;
behaviour under a full day's volume (200–400 bills) rather than the ~12
on the board during the build.

**Next:** Smart Flow tests v1 in live use, then returns for v2 — the slot
suggestion plus the gaps in §7.
