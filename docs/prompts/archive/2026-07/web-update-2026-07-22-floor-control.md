# Floor Control — design decisions

**Type:** `web-update` — design session, nothing built yet
**Date:** 22 July 2026
**Status:** DESIGN LOCKED · NOT BUILT
**Mockups:** `docs/mockups/floor-control/`
**Route (proposed):** `/floor`
**Supersedes:** nothing. Support and Picking stay live and untouched until this is proven.

---

## 1. Why this module exists

Support and Picking are two screens doing halves of one job.

The desk operator's work is: decide which bills go to the floor, and watch what happens
to them there. Support does the deciding. Picking shows the watching. He has to keep
walking between two rooms.

**The failure this is designed against is not tab-switching. It is a blind spot.**

While he is on the Picking board — where things move, where people ask questions — orders
that failed enrichment pile up on Support where nobody can see them. They are not late,
not flagged, not anywhere. At 10:30 the floor supervisor clears his queue and stands idle,
believing there is no more work. There is: five bills that were never released. Those five
miss the 12:30 vehicle, roll to 16:00, and the afternoon runs behind. One forgotten click
at 09:40 broke the day.

**Design principle: unreleased orders must chase him.** Wherever his eyes are, a bill with
no slot must be visible. The moment he has to *remember* to go and look, the design has
already failed.

Volume context: 200–400 bills/day. 75–80% self-enrich and need no human. The remaining
20% are the entire job.

---

## 2. Naming

**Module name: `Floor Control`.**

`Dispatch` was considered and **deliberately reserved** for the future vehicle-planning
module. Spending the word now would leave nothing good for the real thing later.

```
Floor Control   →  what gets picked, and how it is going      (this module)
Dispatch        →  which vehicle, which load, what leaves     (future)
```

`Floor Control` names the *place he is responsible for*, not the action he takes. Actions
change as the product grows; the floor does not.

---

## 3. The two-pane model

One rule the operator has to learn, and it is one sentence:

> **Left = not on the floor. Right = on the floor.**

Every bill is on one side or the other. Never both, never neither.

| | Left rail | Right pane |
|---|---|---|
| Contains | bills waiting for a human decision | everything already decided |
| Shape | cards, one per bill | tables + tabs |
| Width | 344px fixed | remainder |
| He does | decides | watches, and assigns |

**The two doors.** An auto-enriched bill (80%) never touches the left rail — it appears
directly on the right, in its slot, as `Waiting`. A failed-enrichment bill lands on the
left; when he presses Release it moves to the right and becomes indistinguishable from
the auto ones. That is correct: once it is on the floor, how it got there does not matter.

**Support's "Done" group disappears** and this is an upgrade, not a loss. Today "Done"
means *"I dealt with this"* and then goes quiet — a receipt that cannot tell him whether
the bill was ever picked. Here the same bill stays alive as a row that keeps updating
itself. The receipt grows up into a live status.

---

## 4. Data anchors — the foundation

Three different anchors. Getting this wrong makes the UI useless, so it is stated first.

| Pane | Anchored to | Date navigation affects it? |
|---|---|---|
| Left rail | **nothing** — pure open state | no |
| Floor (Live) | **status**, not date | no |
| Floor (History) | `dispatchTargetDate` | yes |
| On hold | **nothing** — pure open state | no |
| Cancelled | day it was cancelled | yes |

One sentence: **anything still waiting for a human ignores dates; anything already
decided belongs to a day.**

### 4.1 Left rail has no date anchor

A pending bill has **no** `dispatchTargetDate` — that is the definition of pending. There
is nothing to filter it by.

**Consequence:** yesterday's unfinished work is still there tomorrow morning, above
today's arrivals, age still counting (`18 hrs`, `2 days`). It cannot fall off the screen.
That was the whole disease.

### 4.2 Floor is status-first

`pick_checked` is the finish line. **Picked but unchecked is not done.**

Live board = every bill **not yet checked**, whatever day it was due, plus nothing from
the future. This reuses the Due-zone rule the Picking module already runs
(`dispatchTargetDate <= today OR NULL`, active stages only).

Three bills unfinished at close of day appear on tomorrow's board at the top of the Due
zone, tagged `1d`. Nothing falls through.

⚠ **Correction to the current Picking carry-over rule.** CLAUDE_PICKING notes the
carry-over exclusion as *"a workaround, not a fix."* The hole: a bill Picked yesterday but
never Checked is excluded from carry-over as "finished-ish", yet nobody ever checked it —
so it can disappear. **Floor Control carries over anything not `pick_checked`.**

### 4.3 Live vs History

- **Live** — default, always the truth, no date control. Everything not yet checked.
- **History** — deliberate, dated, **read-only**. A grey bar reads
  `Sat 19 Jul · past day — read only`.

The date stepper does **not** move the Live board. If it did, he could sit on 21 Jul all
afternoon and never see today's work — the blind spot again in a new costume.

**Read-only matters:** a bill that shipped three days ago has a signed challan. Editing it
makes the screen disagree with reality.

### 4.4 A bill can be in two places, and that is correct

History = *what was promised for that day.* Live = *what I still owe.*

A bill due 19 Jul, finally checked on the 22nd:
- Open **19 Jul** → present, marked `Done · 3d late`
- Open **22 Jul** → absent. Its promise day was the 19th.

This makes each day's history an honest scorecard: *18 promised · 15 completed on the day
· 3 late.* Moving it would make the 19th look perfect and hide three missed vehicles.

**No snapshot table needed** — history is computed from `dispatchTargetDate` plus the
check timestamp. No nightly job, nothing to go stale.

### 4.5 `dispatchTargetDate` is written once

Written when the slot is given. **Never edited afterwards.** It is a record of the promise,
not a working field.

An unfinished bill keeps appearing on the Live board, tagged `3d`, until it is checked. He
does not move it — he clears it. Three options, no fourth:

- **Leave it** — the default, nothing to click
- **Hold** — leaves the board, goes to the hold list
- **Cancel** — dead

If a dealer asks for Friday, that is **Hold with a date**, not a date edit. The original
promise stays in the record, so the miss stays visible.

---

## 5. Header

Two rows.

**Row 1** — `Floor Control` · date and time far right. Nothing else.
No live indicator here; it lives on the floor bar where it means something.

**Row 2** — delivery-type scope on the left, one search and one filter on the right.

### 5.1 Scope — `All · Local · Upcountry · IGT`

Two or three people split the depot's work by delivery type, so scope is **not a tab, it
is the whole desk**. Everything obeys it: left rail, floor, hold, cancelled, upcoming,
and all counts.

### 5.2 One search

One box. It reads what is typed:
- **Text** → matches ship-to name, route, OBD
- **Numbers** → treats them as OBDs, matched on **last 3+ digits or full number**

Multi-number input is the important case: comma, space or newline separated, pasted
straight from Excel or WhatsApp. Matched bills filter in **and are auto-ticked**, so he
goes straight to the bottom bar and releases.

**Runs on Enter, not on keystroke.** Live filtering would make the list jump while pasting,
and `2` would match forty bills before he finishes typing `237`.

**Not-found is shown, never silent.** A chip per number — teal with a match count, red
`999 · not found` — and a summary line: *"3 bills matched · 1 number not in this list."*
Silently filtering 6 numbers to 5 is how an order goes missing.

Search applies to whichever tab is open. It never touches the left rail (see §6.1).

### 5.3 One filter

Only what is **not** already a control on screen. Scope, slot and route are visible
controls, so they get no duplicate.

- **Status** — Waiting / With picker / Needs check / Done (floor only)
- **Flags** — Key dealer · Urgent · Tint · Site delivery · Carried over · Ship-to changed

Button shows a count when active.

### 5.4 Removed

The `4 orders held today` banner. That count now rides on the tab as
`On hold  62  • 4 today` — muted grey text with a small amber dot. A fact, not an alarm.

---

## 6. Left rail

Header: `Needs your decision` · count · `oldest first`.

### 6.1 The never-filtered rule

**Search, slot tabs, route grouping, the date stepper and the filter never touch the left
rail.** The only thing that narrows it is the header scope.

This is the single guard against the original blind spot. If any filter could empty the
rail, he could be looking at a clean rail while bills pile up behind the filter.

Sort is **oldest first, always**. Carried-over bills float to the top by construction — no
separate rule needed.

### 6.2 The card

```
9108440731   22 Jul 09:22              1d  ★  ⚡  💧
Ambika Paints
Varachha · 96 L
[ Release to 12:30 ] [ Slot ] [ Hold ] [ ✕ ]
```

| Element | Source | Rule |
|---|---|---|
| OBD | `obdNumber` | mono, 11.5px, `#374151` |
| When | `obdEmailDate ?? orderDateTime` | mail time if matched, else SAP import time. **Never blank.** `DD MMM HH:mm` IST |
| Age tag | carried-over | `1d` / `2d`, **grey** `#f3f4f6`/`#6b7280` — a fact, not an alarm |
| ★ | `isKeyCustomer` | amber `#f59e0b`, same glyph as picker card |
| ⚡ | `priorityLevel === 1` | red `#ef4444` |
| Droplet | tint orders | Lucide `Droplet`, violet `#7c3aed` while tinting, green `#16a34a` when ready |
| Icon order | — | age → ★ → ⚡ → droplet. **Fixed**, so position always means the same thing |
| Customer | `customer.customerName` | 14px bold, largest thing on the card |
| Route · Vol | `routeName` + `importVolume` | which vehicle, and does it fit |
| Ship-to line | override only | violet `→ {name}`, or muted `billed to {dealer}` on a site bill |
| Release | — | carries the suggested slot in its own label; falls back to grey **Set slot** |

**Deliberately not on the card:**

- **Status** — every card here has the same status. A field where every value is identical
  carries zero information. Support already learned this on its own Hold tab.
- **Slot** — a pending bill has no slot; that is *why* it is here. The *suggested* slot
  rides inside the Release button, where it is actionable rather than decorative.
- **Reason it stopped** — moved to the detail panel. Tried on the card, removed as noise.
- Article tag, materialType, line count, priority as text, delivery-type text badge — all
  in the panel on click.

**Colour is deliberately absent.** Urgency is carried by **position** (oldest at top),
not by paint. Colour is reserved for status pills on the right.

### 6.3 Tint on the card

A tint bill cannot be picked until the shade physically exists. The strip sits **one line
above the Release button** — the last thing his eye crosses before deciding — and updates
itself as the tint team works.

| Stage | Strip text | Count | Colour |
|---|---|---|---|
| `pending_tint_assignment` | Waiting for tint assignment | — | violet |
| `tint_assigned` | Assigned to {operator} | 0 of 5 shades | violet |
| `tinting_in_progress` | {operator} is mixing | 3 of 5 shades | violet |
| all splits `tinting_done` | All shades ready | 5 of 5 shades | green |

**Why the split count matters.** One tint bill becomes several split jobs; the parent only
advances when **every non-cancelled split** is `tinting_done` (CLAUDE_TINT §114). A single
"in progress" label would hide that two shades are still unmade at 11:40 — exactly the
fact he needs before promising the 12:30 vehicle.

**Release is dimmed until the shade is ready.** This is the one guard kept in v1: releasing
a tint bill with no shade sends a picker to a rack where the material does not exist. That
is a man walking, not a data error. **Slot stays live** so he can pre-set in advance —
matching Support's existing pre-set-slot route (CLAUDE_SUPPORT §4.16), which writes only
`dispatchTargetDate` + `dispatchWindowId` without touching `workflowStage`.

⚠ The Lucide icon was chosen as `Droplet`, replacing the 🎨 emoji used on Support. Reason:
an emoji cannot be recoloured, so it cannot go green when the shade is ready, and renders
differently per machine. **Support's own tint pills stay as they are** — this change is
Floor Control only unless a later session decides to unify.

### 6.4 Empty states

Every empty state says **why** it is empty and **what happens next**. Never a bare "no
records" — that reads like a fault to someone non-technical, and he will phone to ask if
the system is broken.

| When | Headline | Body |
|---|---|---|
| Nothing pending, floor running | All clear | Every order that came in has a slot. New ones appear here on their own. |
| Before first import | Nothing yet today | The first bills usually arrive around 8:00. |
| Scoped, nothing in scope | Nothing for {type} right now | Other delivery types may still have work. `[Show all types]` |

The third one is critical — without it he sees "All clear" while sitting on IGT and
believes the whole day is clean.

---

## 7. Floor

### 7.1 Structure

**The tab decides the outer grouping, the toggle decides the inner.**

- **A slot tab (`10:30` / `12:30` / `16:00` / `18:00`)** → no bands, no Slot column.
  Toggle: **Flat** or **By route**.
- **`All`** → slot bands are the structure, each collapsible, each with its own progress
  bar and `4 of 7 done`. Contents are **flat only** — route grouping inside bands was
  tried and rejected as confusing.

**Tab order: `10:30 · 12:30 · 16:00 · 18:00 · All`.** He lands on **10:30** and works left
to right through the day; `All` sits at the end as the summary.

**Slot column only renders on `All`.** On a slot tab every row has the same value, so it
is dropped — same reasoning as dropping Status from the left card.

### 7.2 Route rows

One line per route, collapsed, **sorted worst-first** (least complete at top, ties broken
by size). Click one to expand only that route.

```
▸  Palsana  2d     3 bills · 178 L   ▓▓▓░░░░░░░   0 of 3 done
```

Chosen over tiles and over always-expanded grouping because:
1. **Fixed height** — 11 routes is always 11 lines. Tiles wrap; expanded tables grow with
   order count.
2. **It ranks his problems** — the route nobody has started sits at line one. He does not
   search; the screen already sorted by "who needs help".
3. **One thing opens at a time** — never reading two routes at once.
4. **It survives 300 orders** — the flat list is 300 rows, the route view is still 11 lines.

### 7.3 Progress bar

Four segments in the four locked status colours, in proportion. This shows *where* a route
is stuck, not just how far along — a route at "2 of 6" made entirely of purple is fine;
the same number made of grey means nobody has started.

### 7.4 Carry-over

A banner above the routes: `↷ 3 bills carried from an earlier day — oldest 2 days. These
already missed a vehicle.` Route rows carry a `2d` tag; individual rows carry `1d`/`2d`
next to the OBD.

### 7.5 Columns

`☐ · # · OBD + date · Ship to · Route · [Slot] · Vol · Article · Picker · Status`

**`Ship to` — one column, four cases.** The header is `Ship to` because that is literally
correct in all of them: the headline is always the party receiving goods.

| SMU & case | Marker | Headline / sub-line |
|---|---|---|
| Normal retail, goes to the dealer | none | Dealer name. Nothing else. |
| Normal retail, sent elsewhere | violet `→` | Dealer name, then violet `→ {other party}` |
| Retail Offtake / Project, goes to site | slate `Building2` | **Site name is the headline.** Muted `billed to {dealer}` below. **No violet** — normal for this SMU |
| Retail Offtake / Project, sent to a shop | violet `→` | Shop name, then violet `→ shop instead of site` |

**Why this rule.** Under a naive design the violet marker fires on every project order —
several hundred a week — and he stops seeing it. Under this rule it fires only when a human
deliberately redirected something, maybe twice a day. That is worth a second look, and he
will give it one.

⚠ **Needs confirming in build:** the exact `orders.smu` strings for Retail Offtake and
Project. If they vary, this needs a lookup so the rule does not silently fail on a spelling
variant.

**Four icons, four colours, no clash:**
★ amber key dealer · ⚡ red urgent · `Building2` slate site · droplet violet tint.
**Ship-to has no icon** — the violet text is the marker. A truck icon was tried and removed
as decoration.

**Vol** — gift icon **before** the number so the column stays right-aligned and every
number lines up. The volume prints normally (it is real and it means something). Only the
**band and route totals** exclude gift lines.

**Article** — `6 DR · 2 BX · 1 TN`, abbreviated as Support does. Tells him how long the
pick will physically take.

**Status** — pill carrying the time after a faded dot.

### 7.6 Status names and colours — LOCKED

| Stage | Label | Colour |
|---|---|---|
| `pending_picking` | **Waiting** | grey `#f3f4f6` / `#6b7280` |
| `pick_assigned` | **With picker** | violet `#ede9fe` / `#6d28d9` |
| `pick_done` | **Needs check** | amber `#fef3c7` / `#b45309` |
| `pick_checked` | **Done** | green `#dcfce7` / `#15803d` |

Renamed from Assigned/Picked/Ready. Each label now answers **"who owes the next move?"** —
nobody, the picker, the supervisor, nobody. A controller's board should read like a list of
debts. `Ready` was the worst of the old set: ready for what?

**Pill radius 4px, not a capsule.** Ladder across the board: age tag 3px → status pill 4px
→ buttons 5–6px → cards 8px. Small elements tighter, big elements softer.

### 7.7 Time rides inside the pill

`Waiting · 16m` — `With picker · 52m` — `Needs check · 31m` — `Done · 09:12`

The status and the duration are **the same fact**, so they sit in the same place. Split
into two columns the eye has to join them on every row.

| Status | Reads as | Means |
|---|---|---|
| Waiting · 16m | released, nobody has taken it | is the floor ignoring it? |
| With picker · 52m | Ramesh has had it 52 min | is he stuck? |
| Needs check · 31m | picked, unverified | the supervisor is behind, not the picker |
| Done · 09:12 | checked at 09:12 | the only stage where a clock beats a duration |

Units two characters — `16m`, `17h`, `2d` — so the pill never grows enough to shift the
column. Separator is a faded `·`.

**Fallback if this ever wraps at 1280px:** move to a dedicated column, not under the picker
name. Under the picker fails because a Waiting row has no picker and the time dangles under
a dash.

### 7.8 Picker assignment

**Nothing to switch on.** The `#` spine column and checkboxes are always present.

- Tick rows → bottom bar rises → `assign to [Choose picker ▾]` → **Assign**
- **Header checkbox** selects or clears every assignable row in that table. On `All`, each
  band has its own.
- Checkboxes on **Waiting and With picker** only. Past that the material is off the shelf.
- Selection including an assigned bill → button becomes **Reassign**, **Unassign** appears,
  and a violet note reads *"includes bills a picker already has."*
- **Unassign** returns it to Waiting and the picker's phone drops it.
- Picker dropdown carries current load — `Ramesh - 3 on hand`, `Dinesh - free`.
- Bar also carries **Change slot · Mark urgent · Hold**.

**Identical interaction to the live Picking board.** No new pattern.

### 7.9 The spine

`PICKING_SPINE = [byAssigned, byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo]`

**Applied within whatever list is on screen**, and the `#` restarts at 1 in each group:

- `All` → spine inside each slot band
- `12:30 · Flat` → spine across that whole cutoff
- `12:30 · By route` → spine **inside each route**, so he can clear Adajan without touching
  Varachha

The spine is not a global ranking he must obey top to bottom. It answers *"within what I am
looking at, who is next?"* — so it works at every level, and route grouping scopes it rather
than breaking it.

⚠ An earlier draft **blocked assignment in route view** on the theory that route is not part
of the spine. **That was wrong and is removed.** The desk operator may become the primary
assigner — he knows a dealer is on the phone, or that one route's vehicle leaves first. He
picks the scope; the spine orders it.

### 7.10 Row hover actions

Two buttons at the right end:
- **⚡** — instant urgent toggle, no dialog, lights red when already urgent
- **⋯** — opens the detail panel

A ship-to button was tried here and **removed**: changing ship-to needs a searchable picker
over thousands of delivery points, which does not belong in a row popover. It lives in the
panel. Hidden on History and Upcoming rows.

### 7.11 Upcoming

Collapsed strip at the bottom: `▸ Upcoming 3 — locked until their dispatch day`. Rows
greyed, status reads `for Thu 23 Jul`. Auto-graduates at midnight. Reuses the existing
Picking Upcoming zone.

### 7.12 Day-finished state

Not a grey "no data" box:

> **Everything on the floor is done.**
> 47 bills · 2,140 L · all checked.
> Last one closed at 16:12.

He will see this several times a week and it is the only feedback the screen ever gives him
that he did well.

### 7.13 Removed from the floor

- The stats line right of the slot tabs (`18 bills · 1,032 L · 11 routes · 6 picked`)
- The icon legend strip
- A "pickers free" tile and floor-idle alarm — **invented, and cut**: nothing in OrbitOMS
  tracks whether a picker is free. A red alarm built on a guess is worse than no alarm
- A 🔒 icon after Status on non-pullable rows — absence of a button is the message

---

## 8. On hold

Five columns only: `☐ · OBD + date · Ship to · Route · Held since`.
**No reason column** — it is in the panel.

- Grouped by age: `Held today` · `This week` · `1 week to 1 month` · `Older than a month`
- **Recent first by default**, toggle to Oldest first for backlog cleaning
- **No per-row release button and no per-row slot picker.** He releases in bulk — tick
  rows, the bottom bar rises with `release to [date ▾] [window ▾]`, then **Release**.
  Same shape as Support.
- **Export PDF** top-right → preview sheet with `as on {date, time}`, counts per age band,
  then the table. Download from there.

Hold is a **pure open state** — no date anchor, all dates always. The list can reach 100+,
which is why it is a table in the main area and not cards in the rail: the rail only ever
holds work he will finish today.

---

## 9. Cancelled

Six columns: `☐ · OBD + date · Ship to · Route · Reason · Cancelled` (time, with *by
{user}* underneath).

Tick → **Restore to decisions**. The bill returns to the left rail as an undecided card,
not into limbo.

**Today only** — anchored to the day it was cancelled. Older ones are in History. No sort
toggle, no PDF, no find box; it is a short list and none of that earns its place.

---

## 10. Detail panel

Mockup: `docs/mockups/floor-control/02-detail-panel.html`

Opens from any row or card, in any tab. 472px, slides from the right.

### 10.1 Why he opens it

1. A dealer is on the phone — where is my order, what is in it
2. **The address is wrong — change ship-to.** This is the main purpose
3. The timing is wrong — update slot
4. Something looks stuck — why

He never opens it to read totals. Kg and litres were in an earlier draft and **cut**; the
litre total still appears at the foot of Items where someone actually checks it.

### 10.2 Layout — four zones, three fixed

```
┌ FIXED ─────────────────────────────────┐
│ 9108440712   22 Jul 2026 · 14:56    ✕  │
│ Swastik Forestaa   SH-3358101          │
│ [With picker · 52m] [★ Key] [🏢 Site]  │
├────────────────────────────────────────┤
│ [primary] [Change ship-to] [Update slot] [⋯] │
├────────────────────────────────────────┤
│ Items 7  │  Details  │  Activity       │
├ SCROLLS ───────────────────────────────┤
│ …                                      │
├ FIXED ─────────────────────────────────┤
│ ‹ Previous   6 of 21 in this list   Next › │
└────────────────────────────────────────┘
```

Header is **three lines**. Route, area, SMU, material and bill-to are all deliberately
absent — route and area are in the row he clicked from, the rest is in Details.

**Tags carry treatment facts only**: status, key dealer, urgent, site, tint. A `UPC` tag was
tried and cut — that is classification, not treatment.

### 10.3 Actions

`[ context primary ] [ Change ship-to ] [ Update slot ] [ ⋯ ]`

**Change ship-to and Update slot never move** — same position on every bill, on every tab,
so his hand learns one place. The **⋯** holds rare and destructive actions (Unassign, Hold,
Cancel) so four buttons never become seven.

| Source | Primary |
|---|---|
| Floor row | Reassign picker |
| Left rail card | Release to {slot} — dimmed if tint not ready |
| Hold row | Release to floor |
| Cancelled row | Restore to decisions |
| Done bill | none — a line says it is closed, ship-to still editable |

### 10.4 Tabs

**Items** — index, full product name, SKU, pack chip, quantity, litres. Violet dot marks a
tint line. Gift line is rose with a `GIFT` tag and the footer reads
`7 lines · 304 L · gift line not counted` — the exclusion explained at the exact place
someone would question it.

**Details** — four groups:
- **Parties** — Bill to (code + name), Ship to (code + name)
- **Reference** — OBD date, SO number, Invoice date, Invoice number
- **Classification** — Delivery type, SMU, Route, Area
- **Planning** — Dispatch date, Slot (with change), Priority, Picker, Tinting, Material

⚠ The raw `workflowStage` string was in an earlier draft and **removed** — the status pill
says it in English and Activity shows how it got there. Three copies of one fact.

**Activity** — timeline, newest first, each entry saying **what happened, when, and who**:
*"Assigned to Ramesh K. · by Deepanshu"*, *"Dispatch slot set to 10:30 · enrichment ·
area cutoff"*. This is the audit trail and also how he answers "why is this late" without
phoning anyone.

### 10.5 Prev / Next

Pinned to the bottom, never scrolls away. He walks to the next bill *after* he has finished
with this one, so the control sits at the end of the reading — not competing with the OBD
at the top, where it was in an earlier draft.

Walks whichever list he came from: `6 of 21 in this list`.

---

## 11. Slot suggestion rule

Mockup / tester: `docs/mockups/floor-control/03-slot-rule.html`

This is what sits inside the **Release to …** button label.

⚠ **Important finding.** Three canonical files
(CORE §7.4, SUPPORT §4.13 "On the horizon", SUPPORT §12) all state that auto-assignment of
`dispatchTargetDate` / `dispatchWindowId` at enrichment — "the brain" — is **[NEXT], not
built**. Smart Flow produced a screenshot of the Support board showing 40 done rows all
carrying `22 Jul · 10:30`, which is consistent with **either** a live rule **or** a single
bulk-dispatch action (every arrival time on that screen was before 10:30, so both
explanations produce an identical screen). **Unresolved from the docs alone. The build
session must read `applyMailOrderEnrichment` and settle it against the code**, per the
standing rule that code wins over prose.

If no rule exists, the function below **is** the brain — design it once, call it from both
Floor Control and enrichment, and they can never disagree.

### 11.1 The rule

| Delivery type | Arrived | Suggest |
|---|---|---|
| **Local** | on or before 10:30 | today · 10:30 |
| **Local** | 10:31 – 12:30 | today · 12:30 |
| **Local** | 12:31 – 16:00 | today · 16:00 |
| **Local** | after 16:00 | next working day · 10:30 |
| **Upcountry** | on or before 17:00 | today · 18:00 |
| **Upcountry** | after 17:00 | next working day · 18:00 |
| **IGT / any other** | any time | **no suggestion** |
| **Any** | suggested window already passed | **no suggestion** |

Local never uses 18:00; Upcountry only uses 18:00. The two types read two different halves
of the four-window ruler.

**No suggestion → the button reads grey `Set slot`** and he chooses. Better an honest blank
than a guess he has to check.

**Next working day skips Sunday only.** A Saturday-evening Local bill suggests Monday
10:30. Holidays are not modelled.

### 11.2 Which timestamp feeds it

The same one the arrival slot uses (CLAUDE_IMPORT §12.2):

| Situation | Timestamp |
|---|---|
| mail and OBD on the same IST day | `orderDateTime` |
| different IST day (blocked, released later) | `obdEmailDate` |

Reusing it means the suggestion and the arrival-slot tab can never contradict each other.

### 11.3 The stale case

A bill arrived 09:50 and is still on the rail at 14:00. The rule points at today 10:30 — a
vehicle that left three hours ago.

**Decision: no suggestion.** The card drops to grey **Set slot**. Recomputing to "the next
window it could still make" was considered and rejected — the operator decides.

---

## 12. Ship-to change

**Search covers all of `delivery_point_master`** — not filtered to that customer. Any
dealer or site can receive any bill.

**Writes `shipToOverrideCustomerId` only.**

- **Delivery type re-derives from the new area** — the tag, the header scope and which tab
  the bill belongs to all follow
- **Slot is NOT touched.** No recompute, no clearing. It stays exactly as it was
- **If the new delivery type differs from the old**, a confirm before saving:
  *"This is now an Upcountry delivery. The slot is still 12:30 — change it if needed."*
  He can proceed either way. A heads-up, not a block

### 12.1 Free-text ship-to — LATER, not v1

Some addresses are not in the master. He should be able to type a raw address — but he must
**also pick an Area by hand**, because route, cutoff and the slot rule all hang off the
area. A free-text address with no area would land on the floor with no route and no vehicle.

⚠ **Schema gap:** `orders.shipToOverrideCustomerId` is `Int?` FK → `delivery_point_master`.
A free-text address has nowhere to go. Needs either two new columns
(`shipToFreeText` + `shipToAreaId`) or a lightweight one-off master row. **Schema decision,
not a UI one. Not decided.**

---

## 13. Live sync

**Reuse both existing implementations. Do not invent a third pattern.**

- **Left rail** → the Mail Orders pattern. A new import appears on its own.
- **Right side** → the Picking live-sync already built
  (`orders_updatedAt_idx` on `orders("updatedAt" DESC)`, CORE v27.12).

Four facts the build needs:

1. A new bill lands on the rail with the same entry treatment Mail Orders uses; tab and
   band counts re-tick
2. A status change updates the pill and its time **in place** — the row does not jump
   position
3. If a row is **selected** and someone else changes it, the tick clears and the row
   updates — his selection cannot act on a stale bill
4. Connection lost → thin grey strip under the header,
   *"Not connected — showing last update 14:32."* **Never a modal.** The board stays readable

The blinking green **Live** dot sits on the floor bar, not the header — where the data is,
and where his eyes are. It disappears in History, where a live dot would be a lie.

---

## 14. Loading

**Skeleton, never a spinner.**

The shape appears immediately — header, scope, rail, tabs, route rows — as grey bars. Data
fills in place, roughly a second.

A spinner on a blank screen makes him wait without knowing what for. A skeleton tells him
the screen is coming and where things will be, and because the layout never jumps his eyes
are already parked on the rail when the cards arrive.

---

## 15. Roles and platform

- **Who gets it:** admin, operations, dispatch planner, telecaller
- **Who does not:** floor supervisor, pickers, labour
- **Desktop only.** The supervisor and picker phone experience is already built and in
  testing — this is not a mobile screen and must not be designed as one

---

## 16. Post-action behaviour

After he acts on a card: it fades left over 250ms and the list closes the gap. **The next
card does not jump under his cursor** — it settles, then he moves. One accidental
double-release is one bill on the wrong vehicle.

---

## 17. Open items — carried into build

| # | Item | Why open |
|---|---|---|
| 1 | **Does an auto slot rule already exist?** | Docs say no; a screenshot is ambiguous. **Build session must read `applyMailOrderEnrichment` and settle it.** Blocks §11 |
| 2 | Exact `orders.smu` strings for Retail Offtake / Project | §7.5 site-vs-shop rule silently fails on a spelling variant |
| 3 | Free-text ship-to schema | §12.1 — two columns or a master row. Deferred, not decided |
| 4 | Find-by-number on the Floor tab too? | Built for Hold. Likely useful on Floor ("driver is asking about these eight bills") |
| 5 | Keyboard shortcuts | Never decided. May not be worth it for this operator |
| 6 | Notifications | Deliberately parked — front end first |
| 7 | Tint icon divergence | Floor Control uses Lucide `Droplet`; Support keeps 🎨. Unify later or leave |

---

## 18. Build path

1. **Discovery only** — read every relevant file, settle open item #1, inventory what can
   be reused from Support and Picking. **No code.**
2. Build as a **new route** (`/floor`). Support and Picking stay live and untouched
3. Parallel testing — the old routes keep working
4. Real operator trial
5. Only then consider retiring anything

**Nothing in Support or Picking is modified by this build.**

---

## 19. Mockups

| File | Contents |
|---|---|
| `01-board.html` | The whole board — rail, floor, hold, cancelled, header, scenes for carry-over / day-finished / history |
| `02-detail-panel.html` | Detail panel, four sources |
| `03-slot-rule.html` | Slot suggestion rule, interactive tester |
| `04-card-spec.html` | Left card field-by-field spec + tint chain walkthrough + empty states |

Path: `docs/mockups/floor-control/`
