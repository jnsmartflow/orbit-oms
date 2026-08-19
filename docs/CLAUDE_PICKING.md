# CLAUDE_PICKING.md — Picking Module
# v1.15 · Schema v27.15 · August 2026 · updated 2026-08-19
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

> **The DESKTOP board is RETIRED — 2026-07-28, commits `90c9a865` → `b51cd14f`.**
> `components/picking/picking-queue.tsx` is archived at
> `archive/2026-07-picking-desktop/`. `/floor` had consolidated it with the Support
> board into one screen (`docs/CLAUDE_FLOOR.md`); Support went 2026-07-27
> (`archive/2026-07-support/`), the desktop table a day later.
>
> **`/picking` ITSELF STAYS LIVE.** It is one route with ONE face now: the mobile
> card board, rendered at EVERY screen width. **The MOBILE supervisor board and the
> picker "My Picks" face are NOT retired, NOT superseded and NOT changed** — they
> are the real working surface and always were (the floor team is Android-only).
> Nothing about permissions changed: `/picking` is still fully granted and is still
> the login landing for `floor_supervisor` and `picker` (`lib/rbac.ts`). It is only
> hidden from the DESKTOP sidebar; the phone Menu sheet keeps its entry.
>
> Floor REUSES this module **as a caller**:
> assign/unassign (§4) and the sort **rule objects** + `sortPickingQueue` (§3) stay
> OWNED HERE — Floor cross-references them and composes its OWN `FLOOR_SPINE` (the
> picking spine **minus `byAssigned`**, `lib/floor/sort.ts`) by IMPORTING these
> objects; do not copy the rule objects or `PICKING_SPINE` into `CLAUDE_FLOOR.md`.
> (Floor's exclusion of `byAssigned` is the one deliberate divergence — `CLAUDE_FLOOR.md §3`.)

---

## 1. What Picking is

Picking sits between the desk and physical dispatch: an order becomes pickable the instant Floor's
**Release** fires (`CLAUDE_FLOOR.md §4.2`), and leaves Picking once a picker has been assigned to
fetch it. (Until 2026-07-27 the trigger was Support's "done" action — same stage write, retired
surface.) **The full cycle
is built and live** — assign → pick → done → check → approve, every state visible and traceable on
both boards (shipped across the 2026-07-17/18 sessions; full state ladder in §6).

**Route:** `/picking` — one route, ONE face at every width (`app/picking/page.tsx`), branching only
by ROLE. The width-based switch is gone: the desktop table went 2026-07-28 and the card board lost
its `md:hidden` breakpoint, so the same board renders on a phone and on a PC.
- **Supervisor board** — `components/picking/picking-board-mobile.tsx` (Assign / Picking / Done —
  three **bottom** tabs — + a detail screen. [LIVE], §5).
- **Picker's own "My Picks"** — `components/picking/picker-my-picks-board.tsx` (Pending / **Combined**
  / Done — **three** **bottom** tabs since 2026-08-07 — + a detail screen. [LIVE], §5.4/§5.4.2) when
  the viewer's primary role is `picker` — or an admin/operations session using the
  `?view=picker&as=<id>` test hook (§7).

  Both mobile faces mount through `components/picking/picking-mobile-shell.tsx`, which wraps
  `<RoleLayoutClient>` — Picking is the **first and reference consumer** of the shared shell's
  per-module bottom-tab slot (`CLAUDE_UI.md §59`).

**Who can use it — access reality:** page + every API route gate on `checkAnyPermission(roles,
"picking", "canView")` with an `admin` bypass. **Access is now SEEDED** [RESOLVED 2026-07-20,
`prisma/seed.ts:110-112`]: `floor_supervisor` (canView + canEdit), `picker` (canView **only** — his
board renders but he cannot assign/approve by API), `operations` (canView + canEdit); plus `admin` via
bypass. This reverses the 2026-07-17 "zero picking rows / cannot open" finding.
> **✅ LIVE-VERIFIED 2026-07-28 — the "seed ≠ prod, verification pending" caveat is retired.** A
> direct `role_permissions` SELECT against production confirmed all three grants, and seed and live
> agree exactly. **`CLAUDE_CORE.md §5`'s page-key table owns those numbers** — read them there, they
> are not restated here. One consequence worth carrying: `floor_supervisor` and `picker` hold
> `picking` but **NOT** `floor`, so `/floor` is not a fallback for either role. The standing
> "canView gates writes, not canEdit" caveat is unaffected — see §7.

**Team on the floor (per the 2026-07-13 design session):** ~3 supervisors, ~9-10 pickers. Floor team
uses an Android phone app only — the mobile board is not a nice-to-have, it's the real surface.

---

## 2. Stage ladder [LIVE]

`orders.workflowStage` is a **plain `String` column, never a Postgres enum** — adding a stage is a
constants-file edit, zero migration.

**Central registry:** `lib/workflow-stages.ts`. This is the ONE place that encodes the ladder — every
consumer asks it a POSITION question (`stageRank(stage) >= 60`) instead of hand-maintaining its own
array of stage names. That old pattern is the exact bug class that once put a correctly-locked
`pick_assigned` order back on Support's active board wearing a Dispatch pill (it lived in one
hand-written array but not another).

| Stage | Rank | Support may edit? |
|---|---|---|
| `order_created` | 10 | yes |
| `pending_tint_assignment` | 20 | yes |
| `tint_assigned` | 30 | **no** |
| `tinting_in_progress` | 40 | **no** |
| `pending_support` | 50 | yes |
| `pending_picking` | 60 | yes |
| `closed` (legacy alias, same rank) | 60 | yes |
| `pick_assigned` | 70 | **no** |
| `pick_done` | 80 | **no** |
| `pick_checked` | 90 | **no** |
| `dispatched` | 100 | **no** |
| `cancelled` | null (terminal) | **no** |

Ranks are spaced by ten so a future stage slots in without renumbering — `pick_done` (80) and
`pick_checked` (90) landed exactly that way, pushing `dispatched` from 90 to 100 with no other file
needing a change. `supportMayEdit` is a **per-row flag, not a rank threshold** — unlocked at 10-20
and 50-60, locked at 30-40 (mid-tint) and again from 70 onward (picker has it) — a genuine hole in
the middle that a simple `rank >= X` test would get wrong. ⚠ **The flag and its `supportMayEdit()`
reader are now DEAD** (zero callers since the 2026-07-27 Support retirement; Floor gates releases on
its own `FLOOR_RELEASABLE_STAGES` — `CLAUDE_FLOOR.md §4.2`). The *shape* of the rule is documented
here because it is the reason the ladder carries a per-row flag at all; removal is a ROADMAP item.

**The constants that matter here:**
- `SUPPORT_DONE_OUTPUT = "pending_picking"` — the ONE current value the desk's done-action writes
  (Floor's Release today; the constant name is historical and still in wide live use — do not rename
  it casually, seven files import it).
  `closed` is legacy-only; nothing writes it anymore, but old rows at that rank must still behave
  identically (hence the shared rank 60).
- `PICK_ASSIGNED = "pick_assigned"` — what the Assign action writes.
- `PICK_DONE = "pick_done"` — what the picker's Mark Done action writes (`POST /api/picking/done`).
- `PICK_CHECKED = "pick_checked"` — what the supervisor's Approve action writes
  (`POST /api/picking/approve`). Both are live, not planned — see §5/§6.

**Today's live ladder (Floor → Picking → Checked):**
```
pending_support → [Floor Release] → pending_picking → [Assign] → pick_assigned
  → [Picker Mark Done] → pick_done → [Supervisor Approve] → pick_checked → (dispatch, unbuilt)
```
The `pending_support` stage NAME is historical — nothing called Support writes it any more; Floor's
rail is where such a bill now waits (`CLAUDE_FLOOR.md §3`). Renaming the stage would mean rewriting
live rows and is not proposed.

`pick_assigned` carries `supportMayEdit: false`, which was the enforcement point for "the desk is
locked out of orders being physically worked". With Support retired, the equivalent live guard is
Floor's `FLOOR_RELEASABLE_STAGES` (`CLAUDE_FLOOR.md §4.2`), which admits only `pending_support` and
`pending_picking` — an assigned bill is untouchable there by construction.

---

## 3. Sort spine [LIVE]

The picking queue is a **pure sequencing module** — it ranks; it never assigns vehicles or moves
bills between trucks. Verified against `lib/picking/sort.ts`:

```
PICKING_SPINE = [byAssigned, byWindow, byDeliveryType, byKeyCustomer, byPriority, byFifo]
                                                                          + obdNumber ASC (final fallback)
```

Rule by rule, in order — first non-zero comparison wins:

1. **`byAssigned`** — assigned rows sink to the bottom of the **whole tab**, not just their route
   block. Placed FIRST so it wins before window/route/etc. ever get a say: an assigned row in Adajan
   still sinks below an unassigned row in Varachha.
2. **`byWindow`** — dispatch window `sortOrder` ascending (10:30 → 12:30 → 16:00 → 18:00).
3. **`byDeliveryType`** — fixed depot-priority rank, NOT the `role_master`-style DB ids:
   `Local=1, Upcountry=2, Cross=3, IGT=4`, unknown/null=9.
4. **`byKeyCustomer`** — `isKeyCustomer` boolean, true floats up. Cross-route (not scoped to a
   route block).
5. **`byPriority`** — `priorityLevel` ascending (P1 next), null defaults to 3.
6. **`byFifo`** — `obdDateTime` ascending, oldest first, nulls sink last. Universal tie-break.
7. **`obdNumber` ASC** (locale-fixed to `"en"` so depot PC and Vercel sort identically) — final
   deterministic fallback, inside `sortPickingQueue()` itself, not a named spine rule.

**Route and area are DATA, not sort keys.** `route`/`area` stay on `PickingQueueRow` because the UI
needs them for the **route filter** (client-derived distinct values from the currently-loaded
unassigned rows, alphabetical, resets to "All" on tab change) — a pure view filter with no refetch
and no effect on assigned/done rows. Filtering narrows the list and re-numbers 1..N for what's shown.

**Scope today:** LOCAL delivery type in practice; the `DELIVERY_TYPE_ORDER` ranking already covers
Upcountry/Cross/IGT for whenever those are live on this board.

**No weight, no truck-ready logic, no "serve from the top" guard anywhere in this spine** — see §7 for
what was tried and removed.

---

## 4. Assign / Undo + bulk assign [LIVE]

**`GET /api/picking/queue`** — `canView` gate + admin bypass, same shape as the page. Three optional
params, all **validated rather than coerced**, because a silently-different answer is worse than a
400: **`scope`** (`single` | `openPending`; an unrecognised value 400s rather than degrading to
`single`, which would hand a mobile caller a one-day payload while it renders an all-dates board),
**`date`** (trim, empty→today, and **rejected outright alongside `scope=openPending`** — that scope
spans all dates and would silently ignore it), and **`pickerId`** (positive integer, added
2026-07-29 — narrows to one picker's bills, §5.4; a malformed value 400s rather than widening back to
the whole board). The `pickerId` validation is deliberately copied from
`app/api/picking/marker/route.ts` so the two routes accept and reject the identical value.

**`POST /api/picking/assign`** — batch `{ orderIds: number[], pickerId: number }`. The one rule that
matters: **each bill runs its own fully sequential two-write pair, never `prisma.$transaction`,
neither across bills nor across the two writes within one bill** (CORE §3). Order within the pair is
fixed and must never reverse: **(1) create the `pick_assignments` row first, (2) advance
`workflowStage` to `pick_assigned` second.** If step 2 fails, step 1's row is deleted (best-effort
cleanup) and the bill is recorded in a `failed[]` array — the loop continues to the next bill; bills
already written stay written. Reversing the order would risk a `pick_assigned` order with no
assignment record — a ghost, vanished from the queue, locked against Support, no undo path.
`pickerId` is validated as a real, active `picker`-role user **before touching any bill** (a bad
picker fails the whole batch, not just strands one). Assignment notes + the audit log note are
tagged `"(test)"` — **explicitly test-mode**, not yet a fully-trusted production write path.

**`POST /api/picking/unassign`** — single `{ orderId }`. Guard: 409 unless
`workflowStage === "pick_assigned"`. Mirrors Support's undo-dispatch pattern: **(1) revert
`workflowStage` to `pending_picking` first, (2) delete the `pick_assignments` row second**
(`deleteMany`, tolerant of an already-missing row — undo must work even if the row was cleared some
other way). Reversing this order would strand the order at `pick_assigned` with no assignment
record — locked, no trace of who had it. Both routes write an `order_status_logs` audit row
(`fromStage`/`toStage`/`changedById`/note).

**Bulk-assign IS built and live** — `web-update-2026-07-11-picking-assign-shipped-bulk-assign-planned.md`
called this "not built"; that was superseded within two days. The supervisor board's Assign tab (§5)
drives the `/api/picking/assign` batch endpoint — as does Floor's assign bar (`CLAUDE_FLOOR.md §4.3`),
and as did the desktop board before it was archived. One endpoint, every caller.

---

## 5. Mobile supervisor board [LIVE]

`components/picking/picking-board-mobile.tsx`, mounted by the role branch in
`app/picking/page.tsx`. Live in production on `/picking` at **every** width since 2026-07-28 (it was
the mobile-viewport face until then), **test-mode assign** (see §4 — every assignment is tagged and
reversible). The name stays `picking-board-mobile.tsx`: it is a phone-first card board that a PC now
also gets, not a desktop board.

### 5.1 Direction-A shell — tabs moved to the BOTTOM [LIVE, 2026-07-19]

The three workflow tabs were **relocated from the top teal header to the bottom bar** — they now
render through the shared `WorkflowTabBar` slot, not Picking's own `TopBarTab` strip. Rationale:
workflow tabs belong in the thumb zone; Menu/You demote to the header because module-switching is the
less frequent action.

**The shell mechanics live in `CLAUDE_UI.md §59` — read that, not this section, for how the slot
works.** What is Picking-specific:

- `components/picking/picking-mobile-shell.tsx` is the **owner** of the tab state and the queue
  fetch. Both had to move ONE level up from `PickingBoardMobile`, because `RoleLayoutClient` (which
  carries the slot props) renders *above* the board in the tree. `SupervisorPickingShell` owns
  `data`/`loading`/`error`/`activeTab`/`refetchQueue`/`detailOpen`, computes the three tab counts, and
  hands them back down through `PickingBoardContext` (`usePickingBoard()`).
- **One fetch, no drift.** Every consumer of `refetchQueue()` (assign / undo / approve, still inside
  `PickingBoardMobile`) updates the SAME `data` the bottom-bar counts read — the cards and the tab
  counts cannot disagree.
- **BOTH faces have their own bottom bar now — `PickingMobileShell` is a two-way branch, not a
  supervisor-only wrapper** [CHANGED 2026-07-29]. This bullet used to read *"the picker face gets the
  DEFAULT bar … it keeps the standard Home/Menu/You bar untouched"*; that is no longer true.
  `showPickerFace` now selects **`PickerPickingShell`** instead of `SupervisorPickingShell`, and the
  picker shell is the full equivalent of the supervisor one for its own face: it owns its **three**
  tabs (Pending / Combined / Done since 2026-08-07 — §5.4.2), its rows, its refetch and `detailOpen`,
  and hands them down through a **separate** context, `usePickerBoard()`. Two contexts, two hooks,
  deliberately different shapes — the picker's is smaller because that face has no filters and no
  sheets (§5.4). The archived desktop queue *did* leave `workflowTabs` undefined and take the default
  bar; **nothing live does any more.**
  > ⚠ **`PickerTabKey` is NARROWED at runtime, never cast** — `PICKER_TAB_KEYS` + `isPickerTabKey()`
  > in the shell. `WorkflowTab.key` is a bare `string`, so `onTabChange` hands back a string; the old
  > `key as PickerTabKey` cast compiled unconditionally, which means an unknown key would have been
  > written into state silently and every `activeTab === …` downstream would fall through to its
  > else-branch. **Widening the union from two keys to three is exactly the change that would have
  > exposed it.** Narrow, never cast.
- Tab icons (lucide): `Inbox` (Assign) · `Package` (Picking) · `CheckCircle2` (Done). Count badge
  hidden at 0.
- The top teal header keeps the "Picking" title + search toggle, and gained the grid/avatar triggers
  that open the shared Menu/You sheets via `useMobileShell()`.

**⚠️ Tab keys were RENAMED 2026-07-20 (the board re-cut, §5.2) — keys now MATCH labels.** The keys are
`"assign" | "picking" | "done"`. This supersedes the 2026-07-19 label-only change (which had left key
`"checked"` under the "Done" label): the re-cut made the old keys actively inverted (old `"check"`
would have held `pick_assigned` with no checking; old `"checked"` held the real needs-check work), so
label AND key moved together this time.

| Layer | Value |
|---|---|
| Tab labels / keys | **`assign` / `picking` / `done`** (label == key) |
| `orders.workflowStage` (DB) | unchanged — `pending_picking` / `pick_assigned` / `pick_done` / `pick_checked` (§2) |
| Row flags | `isAssigned` / `isDone` / `isChecked` — unchanged |

**Label == key now, but neither is the STAGE.** Four DB stages still map onto three tabs (§5.2); the
rename touched only the UI literals — no migration, no ladder entry. Nothing persists these keys
(plain `useState`, no localStorage/URL), so there was no stored value to migrate.

**⚠️ Two different "Done" tabs on this module — keep them apart:**

| | Supervisor board — **Done** tab (§5.2) | Picker "My Picks" — **Done** tab (§5.4) |
|---|---|---|
| Who sees it | supervisor | the picker himself |
| Stages shown | `pick_done` (Needs-check band) + `pick_checked`-today (Checked band) | `pick_done` **OR** `pick_checked` (either) |
| Means | "needs my check / I approved it" | "I finished fetching this bill" |
| Renamed 2026-07-20? | **yes** — key + label `checked`→`done` | **no** — always been "Done" |

The picker's Done tab deliberately includes approved bills, so a bill stays in his own history instead
of vanishing the moment a supervisor checks it.

### 5.2 Three tabs, three jobs [RE-CUT 2026-07-20 — date zones + tab restructure]

Each tab now means exactly ONE thing (mirrors the Tint supervisor board): **waiting-to-assign →
being-picked → done**. Only "done" cares about dates; the first two are status-only. The dividing line
moved one state right — **`pick_done` LEFT the middle tab and joined Done** — so every badge counts one
clean thing. (Superseded: the old Assign / Check / Done split, where Check merged `pick_assigned` +
`pick_done` into a mixed, meaningless badge.)

**Stage → tab map (shipped truth, `picking-board-mobile.tsx`):**

| Tab (key) | Stage(s) held | Badge counts |
|---|---|---|
| **Assign** (`assign`) | `pending_picking`, split into Zone 1 / Zone 2 ↓ | **Zone-1 (Due) bills only** |
| **Picking** (`picking`) | `pick_assigned` | bills out on the floor now |
| **Done** (`done`) | `pick_done` (Needs-check band) + `pick_checked`-today (Checked band) | **Needs-check only** — `isChecked` deliberately excluded from the badge |

**Mobile fetch scope (`openPending`, `getPickingQueue`):** all-dates `pending_picking` + `pick_assigned`
+ `pick_done`, PLUS `pick_checked` for **today only — fenced on `pick_assignments.checkedAt` within
today's IST instant range (`getISTDayRange()`), NOT on `dispatchTargetDate`** [FIXED 2026-08-02,
commit `e37cbe74`] (`dispatchStatus='dispatch'`, `isRemoved=false`).
So waiting / picking / needs-check never drop off by date; only the Checked band is date-fenced —
**by when the supervisor CHECKED the bill.**

> **The 2026-08-02 `checkedAt` fix — why the fence moved.** The old predicate was
> `dispatchTargetDate: todayDateOnly`. A bill checked TODAY but dispatch-dated earlier matched
> NEITHER openPending arm — it **vanished from the supervisor's Checked band at the instant of
> approval**, and (downstream) from the picker's own Done tab, whose rows the server had already
> removed. Mirror defect: a bill dispatch-dated today but checked earlier wrongly showed today. The
> Checked band applies no client date test (`checkedRows = rows.filter(isChecked)`), so the server
> predicate WAS the whole fence — `checkedAt` was fetched and displayed but never used for
> attribution. Fix (Option a, matching Floor's arm — `CLAUDE_FLOOR.md §6(c)`): the checked branch is
> now `{ workflowStage: PICK_CHECKED, pickAssignment: { checkedAt: { gte, lt } } }` over
> `getISTDayRange()` (`checkedAt` is a timestamptz instant, never compared as a `@db.Date`).
> `buildPickingWhere` stayed pure/sync — no signature change — so **the marker follows for free**
> (§10, same function). The dead `todayDateOnly` binding was removed (its only consumer was the
> replaced predicate; zone/lock/ageDays anchor elsewhere); **`single` scope was left UNCHANGED**
> (caller-less but a public API contract). No stale-badge risk: `AgeBadge` renders only under
> `variant==="assign"`. Live-verified on the pilot 2026-08-02. **This "done = check date" convention
> now has three implementations** — Floor (the original), the Billing Picking tab
> (`CLAUDE_MAIL_ORDERS.md §23.4`), and this board. Each
row's `zone` (`due` | `upcoming`) is computed from `dispatchTargetDate` vs today in `lib/picking/queue.ts`
(future date ⇒ `upcoming`; ≤ today or NULL ⇒ `due`; an early-released bill is forced `due`), with a
`ageDays` for the age tag.

- **Assign tab** — `pending_picking`, in two DATE ZONES:
  - **Zone 1 · Due** — dispatch date ≤ today (or NULL): today + overdue carry-over. The flat working
    list, server sort order (§3), selectable/assignable. Overdue bills carry a `1d`/`2d` **age tag**
    so work never silently vanishes at midnight (visual: `CLAUDE_UI.md §62.1`).
  - **Zone 2 · Upcoming** — dispatch date > today. **Visible + readable but LOCKED** (`assignLocked`
    card): the supervisor can open the bill and read line items, but Assign is disabled behind a lock +
    a neutral "for {Day}" badge — never selectable, never in Select-All. Opens automatically at
    midnight of its dispatch date (date ≤ today ⇒ graduates to Zone 1), OR via **manual early-release**
    (tap 🔒 → confirm → jumps to Zone 1; `POST /api/picking/release` stamps `orders.pickEarlyReleasedAt`
    / `pickEarlyReleasedById`, persisted so every supervisor sees the same board).
  - **Card interaction (behaviour; visuals in `CLAUDE_UI.md §62`):** **tap anywhere on an unlocked
    Assign card toggles select** — no checkbox (precise tapping was the floor pain point); 1 or many
    identically. A **soft arrow** right of the family chips opens the line-item detail (`stopPropagation`
    then `openDetail`). ≥1 selected → floating bar → picker sheet → `POST /api/picking/assign`.
    **Variant gating (one shared `PickingCard`):** only `variant==="assign"` gets tap-select + arrow;
    `assignLocked` is NOT selectable (tap = open detail); `picking` / `doneCheck` / `doneChecked` →
    tap = open detail, no select, no arrow. Rejected, do NOT re-add: long-press, swipe-to-open (Android
    users read swipe as delete/archive).
- **Picking tab** — `pick_assigned` (the "Still picking" list). Filtered by **picker**, not route (at
  the dispatch point supervisors think in people, not lanes). Elapsed-time pill (grey <30m / amber
  30m+ / red 60m+) ticks off a LOCAL 30s clock, no refetch. Undo lives on the detail screen, not the
  card.
- **Done tab** — two bands:
  - **Needs check** (top, amber) — `pick_done`, **all dates** (nothing unchecked is ever lost). Tapping
    a card opens the **per-line tick screen**; ticking every line unlocks **Approve**
    (`POST /api/picking/approve` → writes `pick_checked` + `pick_assignments.checkedAt`/`checkedById`).
    Flat green "Picked Xm ago" pill (a receipt, not a tiered urgency signal).
  - **Checked** (below, quiet) — `pick_checked`, **checked-today only** (the day's settled receipt,
    fenced on `checkedAt` — the boxed note above), re-sorted
    newest-checked-first (the one display-only deviation from `PICKING_SPINE`, on an already-filtered
    slice; `sort.ts` untouched). Own picker-filter dropdown. Fully read-only (no ticks/Approve/Undo/
    Assign — all gate on `!isChecked`). `✓ Checked by {name}` renders on its OWN line, never folded
    into the area/picker line (a long area + long checker name overflows, and `truncate` would clip the
    checker identity — the whole point of this tab).

**Card DNA (shared by all three tabs):** OBD (mono) + window tag · ★ `isKeyCustomer` · ⚡
`priorityLevel === 1` (strict equality) · dealer name as hero · **where-row = route dot + area +
volume, with the picker name at its right end on Picking/Done** · **shelf = `articleTag` chips**
(Assign + Picking only), rendered **verbatim** (no client-side drum/carton parsing). Type scale:
`CLAUDE_UI.md §60`.

> **⚠ CORRECTED 2026-08-19 — this line said "area + `articleTag` (Assign) or area + picker name
> (Picking/Done)" and had been wrong since 2026-08-14.** `articleTag` LEFT the where-row on that
> date and became the supervisor shelf's chip content (`articleTagChips` in
> `picking-board-mobile.tsx`, fed to `CardShelf`'s `chips` prop). The where-row has carried
> route dot + area + volume since Option G (2026-07-21) — volume, not `articleTag`, is what sits
> after the area. The picker's card is the one that still shows `articleTag` on its where-row, and
> that is recorded as DIVERGENCE 1 in §5.4, not here. Nothing shipped changed on this pass; the doc
> was catching up to the code.

**SMU badge [LIVE, 2026-08-19].** A small pill carrying the SAP SMU code, on **all four picking
surfaces**: the where-row right end of BOTH cards (supervisor + picker) and BOTH detail-screen
headers. One shared component — **`SmuBadge` in `components/picking/card-atoms.tsx`**, beside
`AgeBadge`, whose geometry it mirrors (rounded-full, `px-2 py-[3px]`, `shrink-0`, `tabular-nums`).

- **It renders for `smuCode` "74" and "77" ONLY.** `70`, `76`, `10`, `null` and anything
  unrecognised render **nothing**. That silence is the design, not an omission: on a live board
  (SELECT, 2026-08-19) `70` Deco Retail was **87 of 112** bills, so badging it would put a pill on
  ~78% of cards and bury the ~19% worth seeing — the same reasoning that keeps `0d` off `AgeBadge`.
  **The gate lives in that one component**; never re-test the codes at a call site. `isSmuBadged()`
  is exported for callers that must decide whether to render a *wrapper* (see the two notes below).
- **Colours are `CLAUDE_UI.md §1209`'s SMU palette** — Decorative Projects indigo `#4f46e5` on
  `#eef2ff`, Retail Offtake cyan `#0891b2` on `#ecfeff`. §1209 is the source of truth for these two
  SMUs app-wide; never invent one. They are hardcoded rather than imported because the only other
  implementation (`SMU_DOT`, `components/reports/tint-summary-document.tsx`) is a module-private
  const keyed by SMU *name* holding a single dot colour — nothing importable exists. If it is ever
  promoted to a shared export, this is the second call site to repoint.
- **⚠ NO NEW COLUMN, AND NONE IS NEEDED.** `orders` has only `smu` (the NAME); the numeric code
  stops at `import_raw_summary.smuCode`, because the importer writes both to the summary and only
  the name to the order (`lib/import-upsert.ts`, the `orders.create` at ~183 vs the
  `import_raw_summary.create` at ~217). `PickingQueueRow.smuCode` is **derived in memory** in
  `lib/picking/queue.ts` via **`SMU_CODE_BY_NAME`** (`lib/import-upsert/types.ts`, kept directly
  beside its inverse `DIVISION_TO_SMU` so the two cannot be edited independently). Zero extra SQL —
  `order.smu` was already in the payload, since that query uses `include`, which returns every base
  scalar. Sound because the name↔code relationship is a **verified bijection**: all 11,238
  `import_raw_summary` rows yield exactly six distinct pairs, with zero rows where `orders.smu` and
  `import_raw_summary.smu` disagree.
- **⚠ The "Deco"/"10" caveat.** `SMU_CODE_BY_NAME` contains a fifth entry, `"Deco" → "10"`, that
  `DIVISION_TO_SMU` does NOT: 18 live orders carry that name, written by the legacy XLS path, which
  copies `summary.smu` verbatim instead of resolving through the map. `CLAUDE_CORE.md §618` records
  the division as parked/un-mapped, and `components/floor/floor-table.tsx` says the same. The
  reverse entry exists so the lookup is total over what production actually holds — it does **not**
  mean the forward map should learn `"10"`, which would change what the importer writes. `10` is
  un-badged either way.
- **⚠ Two placement traps, both already handled — do not "simplify" them out.**
  (a) On the cards, the badge is wrapped only when `isSmuBadged()` is true. A component that returns
  `null` is still a flex CHILD, so an unconditional wrapper would park a zero-width box at the end
  of a `justify-between gap-2.5` row and cost the area text 10px of truncation width on the ~81% of
  cards with no badge. As written, those cards render **byte-identical DOM to before** — no gap, no
  alignment shift.
  (b) On the SUPERVISOR detail header, `isSmuBadged` is also in the **flag-row guard**
  (`isKeyCustomer || priorityLevel === 1 || isTint || …`). Without it, a 74/77 bill that is not a
  key dealer, not urgent and not a tint would have the whole row suppressed and show no badge.
  The PICKER detail header had no flag row at all, so one is created — conditionally, so that
  header keeps its exact two-line height on every other bill.
- **Floor fills the field but renders no badge.** `FloorBoardRow extends PickingQueueRow`, so
  `lib/floor/queries.ts` supplies `smuCode` the same derived way. Floor's own SMU treatment is
  unchanged (the `shipMarkers` site icon, `CLAUDE_FLOOR.md §7.5`).

### 5.3 Detail screen

**Route:** `GET /api/picking/order/[orderId]/route.ts` — on-demand line items, not part of the main
queue payload (`PickingQueueRow` only carries order-level aggregates). There is **no FK from `orders`
to line items** — matched via the order's own `obdNumber` against `import_raw_line_items`. Reads the
**full active line set**, not just the subset the catalog can resolve — nothing silently disappears
from what the picker sees. Pack code renders in a fixed-width tile with no container word (the picker
matches pack size against the shelf, not container type) — a deliberate column-scan design (SKU is
the matching key; product name is confirmation after).

**Catalog source — `sku_master_v2` by `material` [LIVE, 2026-07-19, commit `8f606a88`]:** line name
and pack now resolve against **`sku_master_v2`**, batch-matched on `material` ∈ the bill's
`skuCodeRaw` set. `name` ← `description`; `pack` ← `formatPack(packCode, unit)`. Raw-text fallback is
preserved exactly (`skuDescriptionRaw`, and a blank pack stays blank rather than guessing). No
`isPrimary` filter — a duplicate twin is still a real SAP code the picker may be holding.

> **⚠️ Do NOT resolve the catalog via `enrichedLineItem.sku`.** That relation rides `skuId`, which
> still points at the OLD `sku_master` and **shares no id space** with `sku_master_v2` — following it
> renders a confidently WRONG product name and pack on a live picking bill. `skuCodeRaw` is the
> stable natural key, never null, identical across both tables. Full reasoning and the id-space
> evidence: the SKU-catalog section of `CLAUDE_CORE.md`. An inline warning comment sits at the lookup
> in the route file — leave it there.

**Phone-native navigation [LIVE, 2026-07-19, commits `30fbb9fc` + `6bdaff19`]:**

- **Back stays in the module.** Android hardware back and iOS edge-swipe now **close the bill and
  return to the list** instead of navigating out of `/picking`. A minimal subset of `/po`'s
  single-authority popstate model (`CLAUDE_PLACE_ORDER.md §25`): `openDetail()` pushes **ONE** history
  entry for the whole detail *session*, and one `popstate` handler owns every close.
  `depthRef`/`navStateRef` are present; **`suppressPopRef` was deliberately NOT ported** — every close
  path here converges on the same outcome (close detail, stay on `/picking`), so there is nothing to
  disambiguate.
- **Paging does NOT stack history entries.** Swiping or arrow-tapping through twelve bills still
  leaves exactly one entry — a single Back returns to the list, not through every bill visited.
- **⚠️ Three non-header exit paths must stay handled.** `handleAssign` success routes through
  `history.back()` **guarded on `detailOpen`** (so the bulk-bar assign path, which never pushed an
  entry, doesn't misfire one); `handleApprove` success calls it **unconditionally**; `handleUndo`
  is unchanged and deliberately leaves the detail open. Orphan any of them and Back depth desyncs.
- **⚠️ Nested picker sheet closes FIRST.** A back-press while the Assign-to-picker sheet floats over
  the detail closes the **sheet**, then re-pushes to keep the single detail entry — it does not close
  the detail underneath. Guarded on `pickerSheetOpen && detailOpen`.
- **The bottom bar hides on the detail screen** via the shell's `hideBar` branch (`CLAUDE_UI.md §59`)
  — `detailOpen` is lifted into `PickingBoardContext` so `SupervisorPickingShell` can pass it up. This
  also removes the mistap risk of switching Assign/Picking/Done while reading one bill. Because the bar
  is gone, the three detail CTAs use `max(env(safe-area-inset-bottom, 0px), 16px)` (the `/po` footer
  convention) and sit flush — they no longer pad by `MOBILE_NAV_CLEARANCE`.
  **`MOBILE_NAV_CLEARANCE` is still imported and still used by `SHEET_GEOMETRY` for the list-view
  sheets — do NOT remove it.**

**Swipe between bills + the "N of M" counter [LIVE]:**

**⚠ THE GESTURE LIVES IN `components/picking/use-bill-pager.ts` — this section owns it, for BOTH
faces.** Extracted 2026-07-30 when the picker's detail screen gained the same gesture (§5.4). The
supervisor adopted it by **import swap**: the machinery came out of `picking-board-mobile.tsx`
verbatim — same constants, same three-phase animation, same rendering — so nothing about how that
board feels changed. The hook owns the index derivation, the exit/swap/enter sequence, the
direct-DOM transform write, and every number below. What stays with each CALLER is exactly two
things: **WHICH list to page** (`list`) and **WHAT per-bill state to reset on a swap** (`onSwitch`).
That split is the whole reason it is shareable — the hook knows nothing about ticks, search, Approve
or Mark done, and must not learn.

> It sits under `components/picking/`, so it is a picking atom and this file documents it. **Moving
> it to `components/shared/` is the trigger to give it a section in `CLAUDE_UI.md` instead** — at
> that point delete the contract from here rather than letting both files carry it.

- `openDetail(orderId, listKey)` — the signature carries a **`listKey`** (`waiting` | `needsCheck` |
  `stillPicking` | `checked`) because the Check tab has two sections; prev/next must page the RIGHT
  list. All four call sites pass it. (The picker face has one band per bill-list, so its own key is
  just the tab — and it stays **two** keys across three tabs, because Combined is a view of Pending
  rather than a list of its own — §5.4/§5.4.2.)
- The index is derived **live on every render** from the caller's list + the open bill's id, never
  frozen at open time — `handleUndo` refetches while the detail is open, so a captured array would go
  stale. **If the open bill leaves the list entirely the index resolves to `-1`: paging goes inert,
  both arrows are unreachable, and a past-threshold swipe SNAPS BACK rather than committing** — it
  never strands the content off-screen and never jumps to somebody else's bill.
- Counter is **Option F**: merged into the existing "packs · volume" summary row (already pinned,
  never scrolls) as `‹ N of M ›`, neutral gray, with tap arrows. **Hidden when the list has one
  item.** Teal stays reserved for the Assign CTA — this is navigation, not a primary action. Reuse
  `detailIndex`/`activeDetailList`; do not compute a parallel index.
- **⚠️ Gesture rules — the back gesture and the paging gesture SHARE the touch region and were
  designed together. These four are ONE setting, not four numbers; do not tune one without the
  others:** 24px edge exclusion (an edge-start touch is always the OS back gesture, never a bill
  change), 10px deadzone, 1.5× axis-dominance lock (so vertical scrolling in the line list coexists),
  80px commit threshold, **no wrap at the boundaries**. A partial port is how the gesture starts
  feeling wrong in a way nobody can describe — which is exactly why they now live in one file.
- **⚠️ `NO_BILL_SWIPE_ATTR` — the opt-out, and the bug that bought it** [2026-07-30]. The handlers
  sit on the detail screen's **root**, so they claim every horizontal drag in the body. That is right
  for the line list and wrong for a strip that owns its own horizontal scroll: the **pack-filter
  chips** overflow the screen on an ordinary multi-pack bill, and reaching the chips past the right
  edge means scrolling that strip — which the pager was stealing, so a long drag paged to the next
  bill and every off-screen chip became unreachable. Field-reported as "the pack filter is missing";
  the chips had never stopped rendering. A touch **starting** inside an element carrying the
  attribute is never claimed, checked *before* the edge strip. Applied to the picker's chip row.
  ⚠ **The supervisor's identical strip does NOT carry it** — same latent behaviour, deliberately left
  untouched by the fix. Never put it on the line list: swiping across the list is the primary way to
  change bills.
- Slide animation (Build B): Option-1 "slide across", `SLIDE_DRAG_FOLLOW = 0.65` finger-follow,
  `SLIDE_MS = 130` per half (~260ms end to end). Arrow taps and swipes call the same transition, so
  both produce an identical slide. Option 3 "card deck" was rejected — it reads as "dismissed this
  bill" on a work tool. **Feel-tuning of these two numbers is pending real-device confirmation on the
  floor** — they are one-number tweaks, not a redesign.

**Historical note — the shared-WHERE guard.** Widening `lib/picking/queue.ts`'s WHERE clause to
include `pick_checked` (2026-07-18) forced additive `&& !r.isChecked` guards into the then-live
desktop board's three call sites, purely to stop a checked bill reappearing there as if untouched.
That board is archived (2026-07-28), so those guards are gone with it — but the CLASS is not: the
standing rule in §7 ("every new stage must be grepped across every
`isAssigned`/`isDone`/`isChecked` consumer") is what that episode produced, and it still binds.

⚠ **A claim that used to sit here was STALE LONG BEFORE this retirement.** It read *"No desktop
Checked view was built — a `pick_checked` row has no home on desktop, by design."* That stopped
being true on **2026-07-22**, when the desktop redesign put all four states inline with a status
pill — a checked bill showed a green **Ready** pill from that day until the board was archived. The
line survived six days of doc passes because nothing forced a re-read. Recorded as a doc-drift
example, not as a consequence of the retirement.

### 5.4 Picker face — "My Picks" board

**[LIVE]** `components/picking/picker-my-picks-board.tsx`, mounted by `app/picking/page.tsx` on the
SAME route when the viewer's primary role is `picker` — or an admin/operations session using the
`?view=picker&as=<id>` test hook (kept for admin preview). Real picker/supervisor test accounts now
exist and land here on login (ids 34-36, SELECT-verified active 2026-08-04; `lib/rbac.ts` sends both
roles to `/picking`) — the 2026-07-29 first-real-login test plan was written against them; whether it
was run is not recorded (§7). Roster data for that dropdown comes from `lib/picking/picker-roster.ts`.

> **REWRITTEN 2026-07-30.** This face was rebuilt across nine commits on 29-30 July
> (`a2fb6889` → `28986d0a`). Everything the previous version of this section said about it — a TOP
> tab strip, a local `TopBarTab` copy, the default Home/Menu/You bar, a three-line card, a
> server-computed split arriving as props — **is now false in every clause**. It is recorded here
> because that stack of wrong claims is what a doc pass is for, not as history worth preserving.

**THREE BOTTOM tabs — Pending / Combined / Done** [Combined added 2026-08-07, `1ad903ef` +
`733fcd6b`; this section said "two" until 2026-08-09]. The face moved onto the shared shell's
per-module slot (Direction A, `CLAUDE_UI.md §59`), the same move the supervisor board made on
2026-07-19. Owner is `PickerPickingShell` (§5.1), reached by `usePickerBoard()`. Its local
`TopBarTab` copy was **deleted** with the strip — there is no third copy left in the module. Icons
`Package` / **`Layers`** / `CheckCircle2`; `Inbox` is deliberately not reused, it means "waiting to
be assigned", a supervisor concept the picker never sees.

**Badge on Pending ONLY** — `combined` and `done` both pass no `count`, so `WorkflowTabBar` renders
neither. `done`: a picker's finished pile is a receipt, not work still requiring him (same reasoning
that keeps `isChecked` out of the supervisor's Done badge, §5.2). `combined`: it is the SAME work as
Pending seen a different way, so a second badge would double-count the one number that means "bills
still on you".

**⚠ TWO BILL LISTS, THREE TAB KEYS.** Combined is a **VIEW of `pending`**, not a fourth list — the
shell adds nothing to `PickerBoardContext` for it, and the board derives it from the same `pending`
array the shell already owns and refreshes. That is also why it needs no second live-sync marker
(§10). The paging `DetailListKey` stays `"pending" | "done"` deliberately: a bill opened from a
Combined pill is opened **from Pending**, and the swipe pager walks the pending bills exactly as it
does from the Pending tab.

**The two lists are ONE rule, in `lib/picking/picker-split.ts`** (`splitPickerRows`, extracted
2026-07-29). Scoping is on `pickerId` — a real FK, never `assignedToName`, which is a display string
and not a scope boundary; a null viewer yields two empty lists. **Pending** = all dates, excluding
both `isDone` and `isChecked` (without the second, an approved bill falls back into his Pending tab
wearing a live Mark Done CTA — the worst instance of §7's stage-grep rule). Deliberately **not**
date-fenced, so work left mid-shift is still waiting next morning. **Done** = either finished stage,
fenced on **`pickedAt` within today-IST** — his daily receipt, so the day he did the work is the only
thing that decides membership; a bill picked yesterday evening for today's dispatch belongs to
*yesterday's* receipt. Including `pick_checked` is what keeps a bill in his own history instead of
vanishing the moment a supervisor approves it.

> ⚠ That module is imported by a server page **and** by a client component, which is why its
> `pickedAt` parsing normalises an offset-less timestamp to UTC by hand. **The rule and its reasoning
> belong to `CLAUDE_CORE.md §3`** — read it there before touching any date logic that runs on both
> sides; it is not restated here.

**First paint is seeded; the phone owns the rows after that.** `app/picking/page.tsx` resolves this
picker's rows server-side (`getPickingQueue({ scope: "openPending", pickerId })` — narrowed in the
QUERY, ~8 KB of his own bills rather than ~202 KB of the whole board) and hands them over as
`pickerRows`. From then on `PickerPickingShell` refetches them itself and re-splits with the same
`splitPickerRows`, so server and client can never disagree about which tab a bill is in. The page no
longer computes or passes the two lists.

**⚠ THE REFRESH IS A CLIENT FETCH, AND MUST STAY ONE.** It was `router.refresh()` until 2026-07-29,
and the refresh was silently thrown away by the history pop that closes a bill — Mark Done left the
bill sitting in Pending until the 15s marker fired a second, uncontested refresh. **The general rule,
the evidence and the two failed timing fixes are owned by `CLAUDE_CORE.md §3` — read it there.** What
belongs to Picking: this face calls `/api/picking/queue?scope=openPending&pickerId=<id>` and
`setState`s the result, the supervisor board doing the identical pop on Approve never had the bug,
and **no build or type-check catches a regression here — only a phone does.** Do not "simplify" it
back.

**Detail screen.** Same always-mounted `translateX` overlay as the supervisor's (§5.3), and it now
carries the same three phone-native behaviours:

- **`hideBar` while a bill is open.** The bar is `z-40` and this overlay is `z-[35]`, so before this
  the bar floated OVER an open bill and a tab tap swapped the list underneath it. `detailOpen` is
  lifted into `PickerBoardContext` so the shell can pass it up. Because the bar is gone there, the
  Mark done CTA uses the plain `/po` safe-area floor, **not** `MOBILE_NAV_CLEARANCE` — same rule and
  same reason as the supervisor's CTAs (§5.3). The LIST view keeps `pb-[76px]`: the bar IS visible
  there.
- **ONE close path.** `openDetail()` pushes exactly one history entry for the whole detail session;
  a single `popstate` handler owns every close, and **`closeDetail()` is unreachable except from
  it** — the header chevron, Android back, iOS edge-swipe, Mark Done success and the 409 path all
  call `window.history.back()` and let the pop land. Never call `closeDetail()` directly; two close
  paths that disagree is the desync the supervisor board documents in its own source. This face
  keeps its **own minimal** popstate authority rather than sharing the supervisor's: that one carries
  a nested-sheet branch (close the sheet, re-push, keep the detail entry alive) and this face has no
  sheets. If it ever gets one, the two shapes converge and extraction becomes worth it.
- **Swipe between bills** — the shared pager, contract in **§5.3**; not restated here. Picker
  specifics only: the list key is `pending` | `done` — **two keys, not three** (§5.4.2) — and a swipe
  **never crosses between them** — Pending and Done are different work, and only Done is
  date-fenced. Per-bill state reset on a swap is `activePackFilter`; the line items refetch on the
  bill-id change. The pack-filter strip carries `NO_BILL_SWIPE_ATTR` (§5.3).

**Card language is now SHARED with the supervisor** — `components/picking/card-atoms.tsx` (§8). Four
rows, not three: caption + signals · dealer name + slot hero · route dot + area + `articleTag` +
volume · the family-chip shelf. Four deliberate divergences from the supervisor card, all recorded in
the source: no created timestamp (a picker fetching goods has no use for when the order was raised),
`articleTag` KEPT on the where-row (it is what he loads against, while the supervisor card dropped it
in Option G), no picker-name slot (on his own board he IS the viewer), and the shelf's right slot
carries the Done tab's `done {time}` receipt instead of an arrow — the whole card opens detail, so a
second control for the same action would be noise. Visual tokens are `CLAUDE_UI.md §60`/`§62`.

**Mark Done** is fire-and-forget — toast, close through history, then await the refetch. No confirm
sheet (§6). `POST /api/picking/done` re-verifies `pickerId` ownership server-side even under the
admin view-as hook; the coarse permission gate plus that ownership check are what stop "mark someone
else's bill done" without a real grant (`done/route.ts` is also the one write route deliberately left
on `canView` — §7). A **409** means the bill moved out from under him (stage already advanced, or a
supervisor reassigned it): it closes the screen, says *"Already changed — refreshed."* and refetches
— the same wording and shape the supervisor board uses for its own 409s, so the module says this one
thing one way.

#### 5.4.1 Private line ticks [LIVE, 2026-07-30]

A tick circle on every line of an open bill. Tap toggles; a ticked line's SKU/name mute so his eye
skips it. A quiet **"N of M ticked"** sits above the list, counted against the FULL line set (the
pack chips are a view filter, not progress).

**⚠ THESE ARE HIS NOTES, NOT A RECORD OF HIM. Two properties, both load-bearing:**

1. **They gate NOTHING.** Mark done is always enabled — the in-flight double-tap guard is the only
   thing that can disable it. No confirm dialog, no "you have 4 unticked lines" warning, no colour
   change, no nudge. **Ticking nothing and tapping Mark done is a normal day.** There is deliberately
   no code path that reads a tick to decide anything; if one appears, the feature has changed meaning.
2. **They never leave the device.** `localStorage` only. No API call carries them (`POST
   /api/picking/done` still sends exactly `{ orderId, pickerId }`), no column stores them, no
   supervisor surface can read them. The moment they are readable by someone else they stop being
   notes and become a record of him.

**Storage shape.** One JSON blob under one key: `{ [orderId]: { t: lastTouchedMs, ids: [lineItemId] } }`.
Keyed by the line's **stable id, never its position**, so a refetch that reorders or re-filters lines
cannot move a tick onto a different item. Read back synchronously when the open bill changes — not in
an effect — so swiping to a neighbour bill and back restores his ticks with **no frame** of one
bill's lines wearing another bill's ticks. Survives the 15s refetch (plain component state, untouched
by row updates) and a phone sleeping mid-bill, which is what persistence buys over the supervisor's
in-memory equivalent. Every access is wrapped: `localStorage` throws in private-mode Safari and on
quota, and a note is never worth breaking the screen for — failure degrades to "no ticks", silently.

**Lifecycle.** Cleared on a successful Mark Done. Pruned on **every write**: entries not touched in
**7 days** are dropped, then the **50 most recently touched bills** are kept. 7 days rather than 24h
because Pending is deliberately not date-fenced (above) — a 24h window would wipe his notes on
exactly the bill he is still holding overnight. 50 is a backstop, not a working limit. An empty set
deletes its entry outright, so unticking everything leaves no residue.

**Not the supervisor's ticks.** They look identical on purpose and are a different feature with
different plumbing — the supervisor's gate Approve and are ephemeral component state (§6). Do not
merge them, do not reuse one for the other, and do not pre-fill anything a supervisor sees from these.

#### 5.4.2 Combined tab — every pending bill as one flat list [LIVE, 2026-08-07]

`1ad903ef` (the tab) + `733fcd6b` (footer and tab bar read as one bottom strip). One row per
**distinct SAP code** across all of his pending bills, quantities and volume summed — so a picker
fetching four bills walks the racks once instead of four times.

**`GET /api/picking/combined`** — `canView` + admin bypass, read-only, sequential awaits.

🔴 **THE SCOPE IS DECIDED SERVER-SIDE AND IS NEVER SENT BY THE PHONE.** There is deliberately no
`orderIds` parameter: the route resolves the viewer's own `pickerId` and re-runs the EXACT rule the
Pending tab uses — `getPickingQueue({ scope: "openPending", pickerId })` → `splitPickerRows` →
`pending`. Two things fall out of that, both load-bearing: Combined **can never show another
picker's bills** (there is no input that could widen it), and it **can never drift from Pending** —
it is not a parallel filter, it is the same one called again. `pickerId` IS accepted as a param but
ONLY for the admin `?view=picker&as=<id>` preview; a real picker's session id always wins, making
this route strictly tighter than `/api/picking/queue`.

⚠ **MERGED BY `skuCodeRaw` — the SAP code, ALWAYS, never description text.** Two bills can carry
different raw text for the same unmastered code, and text matching would silently merge or split
real products. Name/pack resolve through the shared `resolveCatalogByCode()`; a code in neither
catalog table (~27%, §7's blank-pack landmine) falls back to the FIRST contributing bill's raw text
with a null pack — cosmetic only, the merge key is unaffected.

**Bill pills toggle.** Each contributing bill is a pill; switching one off re-totals the rows
**client-side with no refetch** — which is why every row carries per-contribution `qty`/`litres`
rather than just a sum.

**⚠ TICKS MERGE, NEVER REPLACE.** A Combined row covers line items in several bills at once, and the
tick store is keyed per BILL (§5.4.1). `writeTicks()` takes a bill's WHOLE set and overwrites it —
right for the single-bill screen, which holds every line of that bill on screen, and **catastrophic
here**: a Combined row knows only its own SKU's line ids, so writing those as the bill's set would
erase every tick made on that bill's other lines. The multi-bill helpers read → union/difference →
write back per entry. Same key, same shape, same pruning — **there is no second store and there must
never be one.** A tick made in Combined and the same tick seen on that bill's own detail screen are
the same note about the same physical goods.

---

## 6. Floor workflow [LIVE] — all 4 states built

Locked design from the 2026-07-13 session; all four states are now built (as of the 2026-07-17/18
sessions — picker Mark Done, supervisor Approve + tick screen, and the Checked tab).

**State ladder (4 states, one bill at a time):**
1. Waiting — `pending_picking` [built]
2. Picking — `pick_assigned` [built]
3. **Picked** — picker taps Mark Done, material on floor — `pick_done` [built,
   `POST /api/picking/done`, stamps `pick_assignments.pickedAt`]
4. **Approved** — supervisor ticks every line + taps Approve — `pick_checked` [built,
   `POST /api/picking/approve`, stamps `pick_assignments.checkedAt`/`checkedById`]

State 4 does **not** make the bill "exit picking" in the sense of disappearing — it moves to the
supervisor board's **Done tab** (§5.2 — labelled "Checked" until 2026-07-19; the stage is still
`pick_checked`), which is its permanent same-day record. Nothing today moves
an order past `pick_checked` to `dispatched` (§7 — that write path doesn't exist yet), so a checked
bill simply stays visible there for the rest of the day.

**Roles (locked):** all 3 supervisors can assign — equal power, no single-assigner bottleneck. **Any**
supervisor can approve **any** Done bill (v1 — no "only the assigner approves" rule).

**Zoning (route = the work lane, told not enforced in V1):** one truck = one route, the natural
partition (standard zone-picking pattern). V1 zoning is **verbal**, not a claim system: "Rajesh →
Adajan, Suresh → Katargam." Each supervisor applies the route filter and serves their lane. Area is a
sub-lane inside a route, used only when one route is split across pickers.

**No-jump guard — deliberately OFF, not just relaxed.** Watch how the floor actually uses the route
filter before deciding whether to re-add a "serve from the top" restriction. **Why it's safe without
it:** double-assign is already prevented at the DB level (`pick_assignments` has an effectively
one-row-per-order constraint) — the guard only ever enforced "start from the top," not data safety.

**Build history (all done):** (1) floor app mockups in `docs/mockups/picking/`, approved before any
React; (2) states 3+4 built (`pick_done`/`pick_checked` reused the existing rank-by-10 String column —
no `approved`/`approvedBy` schema add was needed, `pick_assignments.checkedAt`/`checkedById` cover
it), picker Done API, supervisor Approve API + tick screen, the Checked tab; (3) the picker-login
question (own phone/login each, vs. a shared terminal) remains open — still V1 test-mode assign, no
picker-facing login flow shipped yet.

**Design decisions (settled — do not re-litigate):**
- **No `pickedById` column.** One assignment row per order (real DB constraint, §7) and a picker only
  ever sees his own bills, so "done by" could only ever equal "picker" — a column copying its own
  neighbour. Revisit only if a shared-terminal login model ever replaces one-picker-one-phone.
- **`checkedById` DOES earn its own column.** Any of the 3 supervisors can approve any bill, so the
  checker routinely differs from the assigner and is nowhere else on the row.
- **Ephemeral ticks, not persisted — THE SUPERVISOR'S.** Scoped 2026-07-30; this decision was made
  when only one surface had ticks. The supervisor's tick screen is a forcing function, not an audit
  trail — median live bill is 2 lines (72% ≤ 3), so a phone-lock mid-check costs re-scanning 2-3
  lines, not real data loss. Revisit only if floor usage proves phone-locks routinely hit the long
  tail. ⚠ **The PICKER's ticks are a different feature under an identical skin** — device-local,
  persisted per bill, and gating nothing at all. Contract in **§5.4.1**; do not read this bullet as
  covering them, and do not unify the two.
- **No confirm sheet on Mark Done.** Fire-and-forget + toast, matching the existing assign/unassign
  pattern — the Done tab is the safety net; he can look and see it landed.
- **No Undo on a picked/checked bill.** A wrong pick is fixed by the picker fetching the remaining
  goods, then the supervisor approving — not by guessing an exception path before anyone has used the
  screen enough to know what it should look like.

---

## 7. Open / deferred + landmines

- **Picking access is now SEEDED** [RESOLVED 2026-07-20 — was the standing "cannot open /picking"
  LANDMINE] — `prisma/seed.ts:110-112` grants, on `pageKey: "picking"`: `floor_supervisor`
  (canView + canEdit), `picker` (canView **only**), `operations` (canView + canEdit). This closes BOTH
  prior gaps in one place: the 2026-07-17 "zero picking rows for floor_supervisor/picker" finding AND
  the 2026-07-19 seed-fragile live-only `operations` grant. All three now live in the SEED (source of
  truth), so a reseed no longer revokes them.
  > **Live-verified — this stale copy corrected 2026-08-04.** This block still said "verification
  > PENDING, no SELECT was run" while §1 of this same file recorded the 2026-07-28 live SELECT — the
  > exact one-file self-contradiction the desktop-retirement discovery flagged (its §7b #10), fixed
  > in CORE/ROADMAP on 07-28/30 but never in this copy. Grants re-confirmed by SELECT **2026-08-04**
  > (CORE §5 owns the table). Test accounts (SELECT 2026-08-04): Ramesh K. (id 8) and Sunil P.
  > (id 9) are **deactivated**; the live ones are Test Supervisor 1 (id 34, floor_supervisor) +
  > Test Picker 1/2 (ids 35/36, picker) — created for the first real-login test
  > (2026-07-29 plan, archived).
- **Write-route gating — mostly RESOLVED 2026-07-20; one deliberate exception** — the four SUPERVISOR
  write routes now gate on **`canEdit`** (`assign`, `unassign`, `approve`, `release`), corrected when
  `picker` was granted `canView` so its board could render (under the old `canView` gate that grant
  also handed pickers assign/approve by direct API call). The read route + page keep `canView`.
  **`done/route.ts` deliberately stays on `canView`** — it is the PICKER's own action, bounded by its
  own `pickerId`-ownership check (§5.4/§6), not by a role flag; gating it on `canEdit` would lock
  pickers (who hold `canView` only) out of the single write their board exists to perform. So "canView
  gates writes" is no longer the blanket landmine it was — it now applies by design to exactly one
  route.
- **A vehicle/load-aware sort was designed, then deliberately removed in V1 (2026-07-13).** Do not
  rediscover a `>= 950kg` / `grossWeight` "truck-ready" ranking as new — it was tried, fully
  implemented, and stripped in favour of the flat spine in §3. If load-awareness returns, it re-enters
  as a new named rule slotted into `PICKING_SPINE`, not a rewrite of the spine itself.
- **`lib/picking/validate-assign.ts` is DORMANT** [LANDMINE] — still on disk, zero references
  anywhere. Kept per CORE §3 (never delete files unless instructed) specifically so the no-jump guard
  is a one-line re-wire if a future session needs it back.
- **Cross / IGT delivery types have no pill on the mobile board** — reachable only via "All".
- **The picker's VIEWER NAME came off his header** [2026-07-29, deferred — a live dependency of §6's
  picker-login question]. The hand-rolled teal strip that carried "you are Ramesh K." went with the
  move to the shared `ModuleMobileHeader` (title + avatar, no subtitle), so `viewerName` was dropped
  from `page.tsx` too. Identity is still reachable — a real picker sees his own name in the You
  sheet, and an admin previewing reads it off the "view as" dropdown, which is the authoritative
  control for that state anyway. **This is fine for one-picker-one-phone and NOT fine for a shared
  terminal**, where the first question the screen must answer is "whose board is this?". If §6's open
  login question resolves toward a shared terminal, restoring an always-visible viewer identity is a
  dependency of that decision, not an afterthought.
- **Pack-filter chips render only when a bill has ≥ 2 distinct pack sizes** [original rule,
  `a114cff9`; field-reported 2026-07-30, NOT a regression]. Shared by both detail screens. A bill
  whose lines all share one pack — or a single-line bill — shows no chip row at all, because there is
  nothing to filter between. Reported once as "the pack filter is missing"; the investigation found
  the chips rendering exactly where they always had, and a different, real bug alongside it (§5.3's
  `NO_BILL_SWIPE_ATTR`). Flipping the gate to always-show — "All" plus a single chip — is a one-line
  change and a deliberate rule, so it needs a decision, not a patch.
- **The picker's pinned stat row now carries FOUR things and can read as one slab** [design call,
  deferred 2026-07-30]. `articleTag` · "N of M ticked" · volume · `‹ N of M ›` bill arrows, with the
  pack-chip row directly beneath it in the same white, same bottom border, similar pill shapes. Each
  piece earned its place separately and nobody chose the combination. Not a bug — do not "fix" it
  unilaterally. Three options, cheapest first: **(1)** tint the chip row (`bg-gray-50`) so it
  separates — smallest change, diverges from the supervisor's treatment; **(2)** move the bill arrows
  into the teal header's right slot, where the supervisor's search icon sits, freeing the whole right
  half of the stat row; **(3)** move the tick counter down onto the chip row, right-aligned, leaving
  the stat row as `articleTag · volume · arrows`.
- **Blank pack on the detail screen** [LANDMINE — **REDUCED 2026-07-19, still OPEN**] — the class
  survives; only its size changed. **Do not close this.**
  - **Was** (2026-07-17 discovery): SKU `5961032` (`DN WS Metallic Gold 0.5L`) rendered with a null
    pack while IN-prefixed SKUs resolved fine — confirmed a whole class, not a stray: of 500 sampled
    distinct non-`IN`-prefixed raw SKU codes, **222 (44%) were missing from `sku_master` entirely**,
    including `5911947` (one of the 8 known deleted GEN SKUs, `CLAUDE_CORE.md §13`).
  - **Now** (after the `sku_master_v2` repoint, §5.3): `5961032` **resolves to 500ML — fixed**, and
    catalog coverage of distinct ACTIVE raw SAP import codes rose from **~57% → ~73%** (0 codes lost;
    the new table is a strict superset on the measured set). Smoke-tested: order 9909 resolved 14/14
    lines with no blanks.
  - **Still broken:** **~309 distinct SAP codes (~27%) resolve in NEITHER catalog table** and fall
    back to raw SAP text with a blank pack. Same failure mode, smaller population. A blank pack is
    exactly the thing that prevents a mis-pick — the fallback is correct behaviour, not a bug; the
    missing master data is the bug.
  - **Owner:** the catalog-cleanup backlog, not a Picking fix. The 309 codes are exported by
    frequency to `docs/prompts/drafts/unknown-sku-codes-2026-07-19.csv`; the question (genuinely
    obsolete vs. never-mastered) needs Chandresh/depot input. Tracked in `docs/ROADMAP.md`; catalog
    detail in the SKU-catalog section of `CLAUDE_CORE.md`.
  - **Anyone reading the repoint as "the blank-pack problem is solved" is wrong** — set that
    expectation before shipping anything that depends on near-total resolution.
- **~~`articleTag` is null on some bills~~ — ROOT-CAUSED AND FIXED 2026-08-09** (commit `9de0c55b`).
  The 2026-07-17 hunch was right: the null-tag correlation with `sapStatus: null` was the
  manual-SAP-upload path, which emitted `articleTag: null` for **every** line unconditionally. A
  second, independent cause was a depot-PC pack-size dictionary with no entry for several live pack
  sizes. **Import owns this end to end — see `CLAUDE_IMPORT.md §8.2`** for the rule, the two root
  causes, and what is still deliberately untagged. Picking needs no change; the tag simply arrives
  now. ⚠ **Old bills keep their old tags** — historical rows are not backfilled, and 138 lines across
  four 1 L SKUs carry a *wrong* count (not null), so a stale-looking tag on an old bill is expected,
  not a new bug (`CLAUDE_IMPORT.md §15`).
- **Real pick durations are unmeasured** — the Check tab's 30m/60m elapsed thresholds are a guess, not
  a measured depot baseline. (The 2026-07-29 first-login test plan asked the floor to time 3-4 real
  picks — no results recorded yet.)
- **Picking applies NO hide filter — deliberate per-surface asymmetry** [documented 2026-08-04].
  `lib/picking/queue.ts` makes zero `getHideExclusion()` calls (CORE §13): an admin-hidden order is
  invisible on Floor and on the Billing Pending list but **visible on Picking**. A floor-execution
  surface hiding a physical bill was never chosen; if that ever changes it is a per-surface decision,
  not a "consistency" patch.
- **A deactivated picker's SESSION keeps working until the token expires** [code-verified 2026-08-04;
  first surfaced by the 2026-07-29 test plan]. `isActive` is checked at LOGIN only
  (`lib/auth.ts` authorize); an existing JWT session is not revoked. The backstop: `done/route.ts`
  re-verifies `isActive: true` on the picker, so a deactivated picker can still OPEN his board but
  Mark Done fails with an error. Known shape, not a bug ticket — revisit only if deactivation needs
  to be immediate.
- **The supervisor board has TWO picker dropdowns fed from DIFFERENT sources** [code-verified
  2026-08-04; same test-plan finding]. The Assign sheet lists `/api/warehouse/pickers`
  (`isActive: true` filter — a switched-off picker vanishes immediately); the Picking-tab FILTER
  derives its list from `assignedToName` on the loaded rows — a switched-off picker stays in the
  filter as long as bills still carry their name. Correct behaviour twice (you cannot assign to
  them; you can still find their outstanding bills) — but it reads as an inconsistency if nobody
  says so. Do not "unify" the sources without deciding which question each list answers.
- **Decided against, revisit only if usage proves otherwise:** pinning the mobile filter row + lane
  strip — mechanically easy but costs ~200-215px permanently claimed on every screen (nearly a full
  card of list density in all scroll states). Shipped lean; same call as the no-jump guard above.
- **Commit ≠ deploy discipline.** A build stage was once committed but never pushed, and separately an
  unrelated commit sat un-pushed on the depot PC and rode along with this work. Every build prompt for
  this module from the 2026-07-16 session onward carries `git push origin main` in its exit criteria —
  worth keeping for any future Picking session.
- **~~`windows[].count` / `totalCount` over-counting~~ — GONE 2026-07-28, the counters no longer
  exist.** `getPickingQueue()` used to return four aggregates (`windows[]`, `totalCount`,
  `unmatchedCount`, `assignedCount`) that ONLY the desktop board consumed; they were removed with it
  (`b51cd14f`), along with the `isStillWaiting` predicate and a `dispatch_slot_master` round-trip
  that existed solely to build them. The payload is now `{ date, rows }` and every surface counts
  what it needs off `rows`.
  **The "still needs a picker" RULE was preserved verbatim as a tombstone comment above
  `PickingQueueResult` in `lib/picking/queue.ts` — read it there, it is not restated here.** It
  excludes future-dated rows, which is the non-obvious part, and `CLAUDE_NOTIFICATIONS.md §7` points
  a future supervisor-reminder timer at it.
- **⚠️ NO AUTOMATIC DRAIN `pick_checked` → `dispatched`** [OPEN, NEXT — moved here from §9 on
  2026-07-28 when that section was collapsed; the retirement did not touch this and it is NOT a
  desktop-board matter]. The old claim ("there is **no `dispatched` stage** / nothing ever writes to
  it") was **WRONG** — corrected 2026-07-24. Orders DO reach `dispatched`. Live SELECT
  (2026-07-24, authoritative):

  | workflowStage | total | dispatchSlotSource='auto' | oldest | newest |
  |---|---|---|---|---|
  | `dispatched` | 1,051 | 662 | 2026-06-26 | 2026-07-21 |
  | `pick_checked` | 195 | 180 | 2026-07-17 | 2026-07-24 |

  **But the drain is NOT automatic.** `dispatched` stops at 21 Jul while `pick_checked` is still
  growing (newest 24 Jul, 195 sitting there). The bulk of the `dispatched` rows came from a **one-time
  MANUAL sweep** during the Floor Control build (23 Jul, 238 rows) — **not** a code path
  (`CLAUDE_FLOOR.md §7`; do not treat it as a repeatable procedure). So the genuine gap survives,
  restated accurately: **there is still NO automatic transition draining `pick_checked` → `dispatched`.**
  It is what forced the desktop board's carry-over exclusion (a workaround, not a fix) — and that
  workaround is gone with the board, while the hole it worked around is not. A real design session,
  not a doc note. *(The 662-of-1,051 `auto` share = the live dispatch engine doing the majority of
  slotting — owned by `CLAUDE_CORE.md §7.4`, not re-described here.)*
- **`pick_assignments.status` has a live CHECK constraint invisible in `schema.prisma`**
  [LANDMINE] — `chk_pick_assignments_status` restricts `status` to exactly `'assigned'` or `'picked'`
  at the DB layer, confirmed via a direct `pg_constraint` query (2026-07-17 discovery) — it does not
  appear anywhere in the Prisma model, so a naive third `status` string would silently violate a
  constraint Prisma doesn't know exists, discovered only at write-time via a Postgres error.
  `'picked'` was already legal (free for Mark Done); a third value (e.g. `'checked'`) is NOT free — it
  needs a SQL ALTER via Supabase SQL Editor first (CORE §3). This is exactly why Checked/Approved was
  modeled as new `checkedAt`/`checkedById` timestamp columns instead of a third `status` value (§6) —
  keep that pattern for any stage past `pick_checked`; do not add a new `status` string without
  ALTERing this constraint first. Flagged for a `CLAUDE_CORE.md §7.4` documentation pass (§7 pointer,
  not written here).
- **Standing rule for any future picking stage:** every new stage added to the shared queue payload
  must be grepped across every `isAssigned`/`isDone`/`isChecked` consumer — **on every board, and
  Floor is one of them** (`lib/floor/filter.ts` derives the same four states) — before shipping. This
  has now bitten twice (`pick_done`, then `pick_checked`), always the same shape: a new stage is
  `false` on every existing boolean, so filters shaped `!isAssigned && !isDone` silently treat it as
  "still waiting." Call sites that needed a guard when `pick_checked` landed: mobile `waitingRows` +
  the detail screen's "Assign to picker" CTA; three on the then-live desktop board (`unassignedRows`,
  `availableRoutes`, `selectableIdsInTab` — archived with it); and `app/picking/page.tsx`'s picker
  split (the worst one — an approved bill fell into the picker's own Pending tab with a live-looking
  Mark Done CTA). Grep first, don't assume.
- **`MOBILE_NAV_CLEARANCE` was missed 4 times before centralization** — the fixed bottom-nav clearance
  figure (76px + safe-area) was hand-copied separately into `FilterBottomSheet`, the Assign-to-picker
  sheet, and both detail-screen CTAs before it was pulled into one constant, exported from
  `components/shared/mobile-shell.tsx` (the file that renders the nav itself) and reused via
  `SHEET_GEOMETRY` and every bottom-pinned element. Fixed now, kept as a standing note — a repeat
  layout constant that isn't centralized on first use tends to get re-copied wrong at least once more.
  **Still required** (2026-07-19): the detail-screen CTAs stopped using it when the bar started
  hiding there (§5.3), but `SHEET_GEOMETRY` and the list-view sheets still do — do not remove it.

**~~Deferred to Stage 3~~ — ✅ SHIPPED 2026-08-07/09.** See §11 below: findings are built, live, and
reach Billing. The prediction in the old note held on every point — the tick screen and the qty
screen ARE the same screen, and a finding is still a note rather than an edit to the order. Two
things it did not anticipate: recording is **two-step** (picker reports / supervisor confirms), not
supervisor-only; and the "message the billing operator sees" is not free text — it is a flag and a
panel (§11.5).

---

## 8. Key files index

| File | Role |
|---|---|
| `app/picking/page.tsx` | Role branch — supervisor board vs the picker's "My Picks", one face at every width (the width switch went with the desktop board, 2026-07-28). For the picker face it resolves **first-paint rows only**, already narrowed by `pickerId` in the query, and hands them to the shell; it no longer computes or passes the two lists (§5.4) |
| ~~`components/picking/picking-queue.tsx`~~ | **ARCHIVED 2026-07-28** → `archive/2026-07-picking-desktop/components/picking/picking-queue.tsx`. Nothing under `archive/` is compiled, deployed or reachable (`tsconfig.json` excludes it) |
| `components/picking/picking-mobile-shell.tsx` | **Direction-A wrapper — TWO shells since 2026-07-29** (§5.1). `SupervisorPickingShell` owns `data`/`activeTab`/`refetchQueue`/`detailOpen` + the three tab counts → `usePickingBoard()`. `PickerPickingShell` owns his rows, the `splitPickerRows` result, `refetchQueue`, `activeTab`, `detailOpen` → `usePickerBoard()`. Both fill `RoleLayoutClient`'s `workflowTabs`/`hideBar` slots. Also owns `PickerTabKey` + the `isPickerTabKey()` runtime narrowing — **three** picker tabs since 2026-08-07 (§5.1) |
| `components/picking/picking-board-mobile.tsx` | Supervisor board — Assign/Picking/**Done** tab CONTENT (the tab strip itself lives in the bottom bar), shared `PickingCard`, detail screen + its **popstate** authority (§5.2-§5.3). The swipe/slide half moved out to `use-bill-pager.ts` on 2026-07-30 |
| `components/picking/picker-my-picks-board.tsx` | Picker's own "My Picks" board (§5.4) — Pending/**Combined**/Done **bottom** tabs via `usePickerBoard()`, its own popstate authority, the shared pager, the device-local line ticks (§5.4.1) and their multi-bill merge helpers (§5.4.2). Takes **no** row props: the shell owns the lists |
| `components/picking/finding-recorder.tsx` | **The findings screen, shared by BOTH boards** (§11.4) — `findingState()` (THE amber/red decision), `FindingTriangleButton`, `FindingRecordBanner`, `FindingStatusBadge`, `FindingNote`, `useFindingRecorder()`, `FindingPopup`. Exactly three things differ per caller, all carried by `mode` |
| `lib/picking/findings-reasons.ts` | THE closed reason vocabulary (`short_quantity` \| `old_mfg`) + labels + `isFindingReason()`, plus the Old-MFG month/year helpers `MFG_MONTH_LABELS` / `mfgYearOptions()` / `isMfgMonth()` / `isMfgYear()` / `mfgLabel()` (§11.2-§11.3). **Pure constants, zero imports** — safe from a client component and a route handler alike; do not add a prisma import |
| `lib/picking/resolve-lines.ts` | `resolveCatalogByCode()` — batch SKU resolution against `sku_master_v2` by `material`, extracted 2026-08-07 so the single-bill detail and the Combined view resolve identically (§5.3's id-space warning lives in this file) |
| `app/api/picking/findings/report/route.ts` | POST — the PICKER's report. **`canView`** (the second deliberate exception, §11.1), bounded by `pickerId` ownership; 409 on an already-confirmed row |
| `app/api/picking/findings/confirm/route.ts` | POST — the SUPERVISOR's sign-off. **`canEdit`**; stamps `recordedById`/`recordedAt` and never touches `reportedById` |
| `app/api/picking/combined/route.ts` | GET — the Combined view (§5.4.2). Scope resolved server-side from the viewer's own `pickerId`, **no `orderIds` param**; merges by `skuCodeRaw` |
| `components/picking/card-atoms.tsx` | The two boards' shared card language (2026-07-29). Both import exactly four: `AgeBadge` (the days→colour scale, here and nowhere else), `CardShelf`, `CARD_SHADOW_V2`, `RouteDot`. ⚠ `FamilyChip` and `UnlistedChip` are exported but are **shelf internals** — `CardShelf` is their only consumer; do not hunt for board-level call sites. The CARD itself is deliberately not shared (§5.4) |
| `components/picking/use-bill-pager.ts` | The swipe/slide bill pager, shared by both detail screens (§5.3 owns the contract). Holds all four gesture constants + both slide constants, and exports `NO_BILL_SWIPE_ATTR`. Picking-scoped on purpose — moving it to `components/shared/` means re-homing its docs in `CLAUDE_UI.md` |
| `components/shared/module-mobile-header.tsx` | The Direction-A header both faces render (extracted from the supervisor board, 2026-07-29). Not picking-specific — contract lives in `CLAUDE_UI.md §59` |
| `lib/picking/picker-split.ts` | `splitPickerRows()` — THE Pending/Done + today-IST rule (§5.4), called by both the server page and the client shell so the two can never disagree. Pure; the clock is passed in, never read inside |
| `lib/picking/picker-roster.ts` | Roster/lookup for the admin "view as picker" dropdown (new file, 2026-07-17/18 build) |
| `components/shared/mobile-shell.tsx` | Not picking-specific, but load-bearing here — the three-way bottom-bar slot (`CLAUDE_UI.md §59`) and the `MOBILE_NAV_CLEARANCE` export every bottom-pinned sheet reads from (§7) |
| `components/shared/workflow-tab-bar.tsx` | The generic per-module bottom-tab bar Picking's three tabs render through (`CLAUDE_UI.md §59.3`) |
| `components/shared/mobile-shell-context.tsx` | Menu/You sheets + `useMobileShell()` — how Picking's own header opens them (`CLAUDE_UI.md §59.1`) |
| `app/api/picking/queue/route.ts` | GET — `canView` gate + admin bypass; params `date` / `scope` / `pickerId`, all **validated, never coerced** (§4) |
| `app/api/picking/assign/route.ts` | POST — batch assign, sequential two-write pair per bill, never `$transaction`, test-mode notes |
| `app/api/picking/unassign/route.ts` | POST — single-bill undo, mirrors Support's undo-dispatch two-write order |
| `app/api/picking/done/route.ts` | POST — picker Mark Done, writes `pick_done` + `pick_assignments.pickedAt` |
| `app/api/picking/approve/route.ts` | POST — supervisor Approve, writes `pick_checked` + `pick_assignments.checkedAt`/`checkedById` (real session user, never request-body-trusted) |
| `app/api/picking/order/[orderId]/route.ts` | GET — on-demand line items for the mobile detail screen; no FK, matches on `obdNumber`. Each line also carries its `finding` (or null) since 2026-08-07 — additive, so a consumer that doesn't know about findings is unaffected (§11) |
| `lib/picking/queue.ts` | `getPickingQueue()` — builds `PickingQueueRow[]` from `orders` + `querySnapshot`; WHERE includes `pick_checked`, select includes `checkedAt`/`checkedBy`. Takes an optional `pickerId` that narrows to one picker's bills **in the query** (2026-07-29, §5.4). Returns `{ date, rows }` — the four aggregate counters were removed 2026-07-28 (§7) |
| `lib/picking/sort.ts` | `PICKING_SPINE` + `sortPickingQueue()` — the flat sort spine, §3 — untouched |
| `lib/picking/types.ts` | `PickingQueueRow`, `SortRule` shapes — `isChecked`/`checkedAt`/`checkedByName` added 2026-07-18. Also the shapes BOTH boards share: `PickingDetailLine` + `PickingLineFinding` (2026-08-07, declared once because a silent drift between two private copies is what the nested `finding` object made possible) and the Combined wire types `CombinedSkuRow`/`CombinedContribution`/`CombinedBill`/`CombinedPickResult` |
| `lib/picking/validate-assign.ts` | DORMANT — the no-jump guard, unused, kept on disk (§7) |
| `lib/workflow-stages.ts` | Central stage-ladder registry — `STAGE_LADDER`, `SUPPORT_DONE_OUTPUT`, `PICK_ASSIGNED`, `PICK_DONE`, `PICK_CHECKED`, `stageRank()`, `supportMayEdit()`, `isSupportDone()` (§2) |
| `docs/mockups/picking/supervisor-assign-board.html` | Approved mobile board mockup |
| `docs/mockups/picking/supervisor-check-split.html` | Approved Check-tab split mockup (Needs check / Still picking) |

---

## 9. Desktop board — RETIRED 2026-07-28

The wide-screen table is gone. `components/picking/picking-queue.tsx` is archived at
`archive/2026-07-picking-desktop/` (that folder's `README.md` exists — verified 2026-08-04 — and owns
the story; the dated working record behind it is the discovery draft, now archived). Its
visual spec was `CLAUDE_UI.md §61`, now collapsed to a banner — the parts of it that were never
desktop-only were moved to `CLAUDE_UI.md §62.1-§62.4` and `§1` first.

**`/picking` is unaffected** — same route, same permissions, same login landing; it just renders the
card board (§5) at every width now.

**Removed with it, so do not go looking:** the `rolling` queue scope (`47cc99f9`) and the four
payload counters `windows[]` / `totalCount` / `unmatchedCount` / `assignedCount` plus the
`isStillWaiting` predicate (`b51cd14f` — see §7). `single` and `openPending` remain; `openPending` is
what every live board uses.

**The workflow-hole that used to be documented in this section is NOT about the desktop board and
has moved to §7** — see *"NO AUTOMATIC DRAIN `pick_checked` → `dispatched`"* there. It is still open.
⚠ **This note named the wrong files — corrected 2026-07-30.** It read: *"`CLAUDE_FLOOR.md §10` and
`docs/ROADMAP.md` both point at `CLAUDE_PICKING.md §9` for it."* **Neither does.** A grep across
`docs/` finds no `§9` pointer in either file — ROADMAP's picking pointers all resolve to §2 / §5 /
§6 / §7 / §10, and FLOOR carries none at all. The one file still pointing at `§9` is
**`CLAUDE_CORE.md §7.4`** — ✅ **repointed at §7 on 2026-07-30**, later in this same pass. No `§9`
pointer to the drain hole survives anywhere in `docs/`.

---

## 10. Live sync [LIVE — 2026-07-22]

Both picking surfaces self-refresh **with no manual refresh, pull-to-refresh or app restart**.
Previously each surface fetched once and never again — the acting device saw its own change, every
other device stayed stale until the app was closed and reopened.

| Surface | Refresh call | Marker scope |
|---|---|---|
| Supervisor board (`picking-mobile-shell.tsx`) | `refetchQueue()` | `openPending` |
| Picker "My Picks" (`picker-my-picks-board.tsx`) | `refetchQueue()` — the shell's own client fetch since 2026-07-29, **never `router.refresh()`** (§5.4) | `openPending` + own `pickerId` |

*(A third row lived here until 2026-07-28 — the desktop queue on `rolling` + `selectedDate`. Board
and scope were both retired; `openPending` is the only picking scope any live board uses.)*

**Marker-gated, not a blind poll.** Every 15s (`PICKING_MARKER_POLL_MS`, `lib/hooks/use-picking-marker.ts`)
the client hits a cheap endpoint — `GET /api/picking/marker?scope=…[&date=…][&pickerId=…]` →
`{ count, latest }` — and does the real (expensive) queue refetch **only when that pair MOVED**. This is
**lighter than the Mail Orders 30s auto-refresh** (which refetches the whole list every tick). The
marker is built by `buildPickingWhere()` — the SAME filter the queue uses, so it can never watch a
different set — and is backed by the `orders_updatedAt_idx` index (schema entry lives in CORE §7, not
restated here).

**Why the marker is TWO numbers, both load-bearing:** `latest` = `MAX(orders.updatedAt)` catches
in-place edits; `count` = `COUNT(*)` catches DEPARTURES — an unassigned/reassigned-away bill leaves the
set, so its `updatedAt` is outside the aggregate and only the count drops. Verified across all four
transitions (assign-to / mark-done / approve / unassign-away).

**Hook contract:** first response is the baseline (never fires on mount); fires `onChange` once per
`{count,latest}` change; **PAUSES the interval entirely while the tab is hidden** (one immediate check
on becoming visible); skips overlapping requests; **fails silently** (no toast/UI/console spam); while
`paused` keeps tracking but defers `onChange`, firing once on unpause; re-baselines when
`[scope, date, pickerId]` change.

**Pause rule — a background refresh must never move the ground under a hand:**

| Surface | `paused` resolves to |
|---|---|
| Supervisor board | `detailOpen \|\| overlayBusy` (= `pickerSheetOpen \|\| releaseTarget !== null`) |
| Picker | `detailOpen \|\| marking` |

**Live-sync landmines (READ BEFORE TOUCHING PICKING):**
- **`pick_assignments` has NO `updatedAt`.** The marker watches `orders.updatedAt` only — a complete
  proxy TODAY solely because every picking mutation pairs its `pick_assignments` write with an
  `orders.update`. **Any future assignment-only write — a note, a sequence, a picker swap that does not
  touch `orders` — silently escapes the marker and reaches no screen.** Bump `orders.updatedAt`
  alongside it, or add `@updatedAt` to `pick_assignments` and fold it in.
- **Never add a SECOND `orders.update` to a trigger** — the marker keys on `MAX(orders.updatedAt)`; an
  extra write fires a false change on every board.
- **`detailOrderId` is never reset to null** (`closeDetail` flips `detailOpen` only). Gate on
  `detailOpen`, never `detailOrderId !== null`, or you pause forever after the first bill is opened.
- **Marker ⊇ queue, never ⊂.** A marker watching a WIDER set = harmless extra refetches; a NARROWER
  set = missed updates on the floor. Never re-declare the filter — always `buildPickingWhere()`.
- **⚠️ Keep the picker marker narrowed to his own `pickerId` — the CONCLUSION outlived its reason**
  [rewritten 2026-07-30]. The reason used to be that his refresh was `router.refresh()`, re-running
  the whole server page (`auth`, permissions, `getActivePickers`, `getPickingQueue`). **That
  mechanism is gone** — it had to go (§5.4), so the "whole page re-runs" argument no longer applies
  and must not be quoted as if it did. **The narrowing still stands**, on the two reasons that were
  always the stronger ones: his phone should wake only when HIS bills change — assigned-to-him, his
  mark-done, a supervisor approving his bill, a bill leaving his set — and **never** on a board-wide
  edit that is not his; and the fetch sitting behind the marker is `?pickerId=<id>`, his own handful
  of bills, where the board-wide payload is ~202 KB and would put every other picker's work on his
  device. Widening the marker widens the fetch. Do not widen it back.
- **Selection is pruned, not frozen** — on each background refresh a ticked bill that has left the
  waiting set drops out (pausing while a selection is up was rejected: it would blind a control-tower
  view while a supervisor ticks bills). Proven on the desktop board, which is archived; **the rule
  survives as the standing answer** and is what Floor's own reconcile-with-a-toast implements
  (`CLAUDE_FLOOR.md §5`).
- **Silent background failures:** `refetchQueue`/`refetchAfterAction` swallow errors and keep last-good
  data (the full-screen error screen is owned SOLELY by the initial `load()`), so a network blip on a
  board refreshing every 15s all day can't wipe it to an error screen.
- **`use-picking-marker` gained OPTIONAL `url` + `onProbe` params (2026-07-24)** so Floor Control can
  reuse the hook against its own `/api/floor/marker`. **All three Picking call sites pass neither and
  are byte-identical** — Picking's behaviour is unchanged. `url` defaults to `/api/picking/marker`.

---

## 11. Findings — what the floor actually found [LIVE, 2026-08-07/09]

Stage 3, built across seven commits, all verified on `main`: `cd27c976` (schema) → `4d9d4535`
(picker records) → `490164c4` (supervisor confirms) → `42f14de4` (billing flag) → `bfff2400`
(billing panel) → `286457e7` (MFG month/year + note trim) → `0df656ef` (MFG date in the note).

A finding records **what was physically there** on one line. It never edits the order, never changes
a quantity anywhere, and never blocks Mark done or Approve.

### 11.1 Two steps, and only the second one counts

**Picker-optional, supervisor-authoritative.** Both roles use the SAME screen — the mockup was
explicit about that (`docs/mockups/picking/picking-shortfall-design.html`) and it is why one
component serves both (§11.4).

| Step | Who | Route | Gate | Writes |
|---|---|---|---|---|
| **Report** | picker (optional) | `POST /api/picking/findings/report` | **`canView`** | `reportedById`/`reportedAt`; leaves `recordedById` NULL |
| **Confirm** | supervisor (authoritative) | `POST /api/picking/findings/confirm` | **`canEdit`** | `recordedById`/`recordedAt`; ⚠ never touches `reportedById` |

🔴 **`recordedById IS NULL` MEANS PENDING. That single column is the whole state ladder** — amber
(reported, awaiting a supervisor) vs red (confirmed). `findingState()` in `finding-recorder.tsx` is
the ONE place that decision is made; every render site calls it rather than re-testing the column.
**Never infer the state from `qtyFound` or `reason`** — a supervisor may legitimately confirm a line
at the full ordered quantity, so "found == ordered" says nothing about whether anyone signed off.

Two asymmetries between the routes, both deliberate:
- **`report` gates on `canView`**, joining `done/route.ts` as the second deliberate exception to the
  canEdit rule above — `picker` holds canView ONLY, so canEdit would lock the one role it exists for
  out of it. The real boundary is the `pickerId`-ownership check (the bill must actually be assigned
  to the acting picker), exactly as `done/route.ts` documents for itself.
- **`report` 409s on an already-confirmed row; `confirm` does not.** A picker must never silently
  overwrite a supervisor's sign-off — that refusal is what makes the amber→red ladder trustworthy.
  A supervisor correcting his own earlier number is the expected path, so it is an ordinary update.

Both routes re-verify that the line belongs to the bill (`rawLineItemId` arrives from the client and
there is **no FK from `orders` to its line items**), refuse a non-`active` line, and refuse
`qtyFound > unitQty` — found-more-than-ordered is a typo, not a finding. That bound lives in code,
not the DB, so relaxing it is a one-line change.

### 11.2 Exactly two reasons — and the CHECK-constraint landmine

`lib/picking/findings-reasons.ts` is THE central list: **`short_quantity` | `old_mfg`**, labels
"Short quantity" / "Old MFG". Same spirit as `lib/workflow-stages.ts` — one closed vocabulary every
consumer asks, instead of hand-maintained arrays. The popup's `<select>` is built from it, so the UI
can never offer a value the API would reject.

🔴 **LANDMINE — `chk_pick_findings_reason` is a live CHECK Prisma cannot see**, restricting `reason`
to exactly those two strings. **Identical class to `chk_pick_assignments_status` (§7)**, and it bites
the same way: an unlisted value does NOT fail type-check or Prisma validation — it reaches Postgres
and comes back as a raw constraint violation. Adding a THIRD reason means, in this order: **(1)**
`ALTER` the constraint in the Supabase SQL Editor (CORE §3 — never a migration, never `db push`),
**(2)** add it to `findings-reasons.ts`, **(3)** only then use it in code. Both routes validate
against the module BEFORE any write, which is the only thing turning a bad value into a clean 400.

### 11.3 Old MFG additionally captures a month + year

`mfgMonth` / `mfgYear` (Schema **v27.15**, 2026-08-08). The popup shows two selects — Jan-Dec, and
six years newest-first — **only** when the reason is Old MFG, and both are required before Save
enables. Never prefilled on a fresh line: today's month is the one value certainly WRONG for stock
flagged as old, and a plausible wrong default saves silently.

⚠ **The reason-dependency is NOT in the database.** The live `chk_pick_findings_mfg_month` constrains
the month's RANGE only (NULL or 1-12); nothing ties either column to `reason`. Both write routes
carry the rule instead — **required on `old_mfg`, forced to NULL on `short_quantity` whatever the
body claims**, written unconditionally on every save so a stale date cannot outlive a reason change.
A short-quantity row carrying a non-null `mfgMonth` is a bug in a write path, not a permitted state.
The server's year bound is deliberately **wider** than the dropdown offers: a rolling six-year window
would start rejecting a December row's own re-save a few weeks later.

**The note reads `Found 9 · Old MFG · Mar 2024`** — trimmed to that shape on 2026-08-08 and given the
date on 2026-08-09. Short-quantity notes carry no date segment. Formatting goes through the shared
`mfgLabel()`, which returns null unless both parts are present: ⚠ **`old_mfg` findings recorded
BEFORE 2026-08-08 have no month/year and nothing can backfill a date read off a tin** — 3 of the 4
live old-MFG rows were dateless at the 2026-08-09 count (16 findings total). They render
`Found 9 · Old MFG`, which is the truth about them. Fixing one is a floor action (re-open the line,
save the date), not a migration.

### 11.4 One component, both boards

`components/picking/finding-recorder.tsx` — extracted the moment the supervisor's Done-tab detail
gained the same screen. Same seam `card-atoms.tsx` and `use-bill-pager.ts` already occupy.

Exactly **three** things differ between the two callers, all carried by `mode` (`report` | `confirm`):
which route the save posts to, the Save button's label ("Save" vs "Confirm"), and the prefill policy
on a fresh line (report prefills qty ORDERED — the common edit is "one less"; confirm prefills
NOTHING — a supervisor who has not counted must not save a number he did not type). **If a fourth
difference appears, add it to `mode` rather than forking the component.**

⚠ **What this file must never learn:** whether a line is ticked, whether Mark done / Approve is
enabled, or anything about either board's list state. Same discipline that keeps `use-bill-pager.ts`
shareable.

Three UI rules that came from live testing on 2026-08-08 and should not be undone:
- **No row fill.** Rows used to take a full amber/red background plus a 2px border, which made a bill
  with a few findings look alarming end to end. Status is carried by the badge and the coloured note
  line, nothing else. *(This does NOT bind the Billing panel — §11.5.)*
- **The header triangle is quiet** — a frosted icon matching the back button, not the original solid
  amber slab that out-shouted the customer name and competed with the CTA.
- **The popup is ALWAYS MOUNTED**, opacity/scale-toggled, never `{open && …}` — a conditionally
  rendered overlay has no previous frame to transition from and pops. It also carries
  `NO_BILL_SWIPE_ATTR` itself (§5.3), so a horizontal drag mid-edit cannot page to the next bill.
- **Remarks was removed** from the popup. The column and both routes' parameter remain, and an
  ABSENT `remarks` key means *leave it alone* — never "clear it", or a supervisor confirming a
  picker's report would wipe a remark typed before the field went away. ⚠ `mfgMonth`/`mfgYear` follow
  the OPPOSITE rule (§11.3) — do not "harmonise" them.

### 11.5 What Billing sees

Owned by `CLAUDE_MAIL_ORDERS.md §23.4`; the picking-side contract is just this: **Billing reads
CONFIRMED findings only** (`recordedById IS NOT NULL`), the same predicate on both its surfaces —
the Picking-list ⚠ flag and the detail panel. A picker's unconfirmed report is a claim, not a fact,
and must never reach a billing screen. If that predicate ever diverges between the two, a row can
carry the flag and open onto a panel with nothing flagged.

### 11.6 Table shape

Full column list + landmines: **`CLAUDE_CORE.md §7.4`** (v27.14 mint, v27.15 columns) — not restated
here. What matters on this board:

- `rawLineItemId` is **UNIQUE** → one finding per raw line, one-to-one from the line's side. It FKs
  `import_raw_line_items.id`, which is safe because a re-import PATCHES a matched line in place and
  SOFT-removes an absent one — there is no hard delete of that table anywhere in the repo.
- `obdNumber` / `lineId` / `skuCodeRaw` / `qtyOrdered` are **denormalised copies on purpose**: a
  finding is a record of what a human observed and must still read correctly if its line is later
  soft-removed. ⚠ `lineId` is TEXT here and Int on `import_raw_line_items` — a display copy, not a
  join key.
- Two named relations to `users` (`PickFindingReportedBy` / `PickFindingRecordedBy`) — both must stay
  explicitly named on both sides or Prisma errors at generate time.
- `pick_findings_confirmed_idx` is **partial** (`WHERE "recordedById" IS NOT NULL`) and NOT
  expressible in Prisma; `pick_findings_order_idx` IS modelled, with an explicit `map:`.

---

## Change log — v1.12 (2026-08-04 reconciliation pass, method v1.1)

Evidence: `lib/picking/queue.ts` + auth/route/board files read at the call sites, git (`e37cbe74` verified), one read-only SELECT (test accounts), CORE v91 anchors. Claim IDs from the session report.

- PCK-1 (§5.2): the 2026-08-02 `checkedAt` fix documented — the Checked band fences on `pick_assignments.checkedAt` in today's IST instant range, not `dispatchTargetDate`; the vanish-on-approve defect and its mirror recorded; dead `todayDateOnly` removal + untouched `single` scope noted; marker follows for free; cross-refs to Floor §6(c) + Billing §23.4.
- PCK-2 (§7): the grants block's "Seed ≠ prod — verification PENDING" copy corrected — it contradicted §1's own 2026-07-28 live verification within one file; grants re-confirmed 2026-08-04; test accounts updated (8/9 deactivated, 34-36 live — SELECT).
- PCK-3 (§7): "Auto-Import paused since 2026-05-14" — the last stale copy outside ROADMAP — corrected to LIVE per CORE v91 §4.
- PCK-4 (§7): NEW — Picking applies no hide filter (deliberate asymmetry, CORE §13); the deactivated-session behaviour and the dual-dropdown sourcing (both from the 2026-07-29 test plan) code-verified and documented.
- PCK-5 (§1/§5.4): test-hook wording updated — real picker/supervisor test accounts exist and land on `/picking`; whether the first-login test ran is not recorded.
- PCK-6 (§9): the archive README verified to exist; conditional wording removed; the discovery draft archived this session (its unrun grants SQL is satisfied by the 07-28 + 08-04 SELECTs).

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

## Change log — v1.13 (2026-08-09, Stage-3 close-out + the Combined-tab correction)

Evidence: all nine commits confirmed present on `main` by `git log` before anything was written
"LIVE" (CORE's own rule — a SHIPPED claim is a claim until git says otherwise): `cd27c976`,
`4d9d4535`, `490164c4`, `42f14de4`, `bfff2400`, `286457e7`, `0df656ef` (findings) + `1ad903ef`,
`733fcd6b` (Combined). Route/component/type files read at the call sites; one read-only SELECT
(dateless old-MFG rows).

- PCK-7 (§7 → NEW §11): **"Deferred to Stage 3" CLOSED.** Replaced with what shipped — the
  two-step picker-optional / supervisor-authoritative flow, the `recordedById IS NULL` = pending
  rule, exactly two reasons + the `chk_pick_findings_reason` landmine, Old-MFG month/year and its
  NOT-in-the-database reason-dependency, the shared `finding-recorder.tsx`, what Billing sees, and
  the table's shape. The old note's predictions held except on two points, both recorded.
- PCK-8 (§1/§5.1/§5.4/§5.3/§8 + NEW §5.4.2): **the picker face has THREE bottom tabs, not two.**
  Combined shipped 2026-08-07 and was never documented; four places still said "two" and a fifth
  described the shell as owning two tabs. Fixed together with a new §5.4.2 covering the
  server-side-only scope, the merge-by-SAP-code rule, the bill-pill re-total, and the
  ⚠ merge-never-replace tick rule. Also records the `PickerTabKey` narrow-never-cast guard, which
  the widening from two keys to three is exactly what would have exposed.
- PCK-9 (§8): key-files index gains `finding-recorder.tsx`, `findings-reasons.ts`,
  `resolve-lines.ts`, both findings routes and the combined route; the `order/[orderId]`,
  `types.ts`, `picker-my-picks-board.tsx` and `picking-mobile-shell.tsx` rows updated.
- Schema stamp -> **v27.15** (was v27.13; CORE minted v27.14 on 08-07 and v27.15 on 08-08).

---

---

## Change log — v1.15 (2026-08-19, SMU badge)

- PCK-10 (§5.2 Card DNA): **corrected a line that had been wrong since 2026-08-14.** It claimed the
  where-row carries "area + `articleTag` (Assign)"; `articleTag` became the supervisor SHELF's chip
  content on that date (`articleTagChips` → `CardShelf`'s `chips` prop) and the where-row has
  carried route dot + area + **volume** since Option G. No shipped behaviour changed — the doc was
  catching up. The picker card's where-row `articleTag` is unaffected and stays recorded as
  DIVERGENCE 1 in §5.4.
- PCK-11 (§5.2, NEW block): **the SMU badge shipped** — shared `SmuBadge` + `isSmuBadged` in
  `card-atoms.tsx`, on both cards' where-rows and both detail headers, rendering for `smuCode`
  **74/77 only** and silent for 70/76/10/null by design (70 is ~78% of a live board). Colours are
  `CLAUDE_UI.md §1209`'s palette, hardcoded with a citation because the only other implementation
  is module-private. `PickingQueueRow.smuCode` is **derived in memory** from `orders.smu` via
  `SMU_CODE_BY_NAME` — **no schema change, no migration, no extra query.** Records the
  name↔code bijection evidence, the `"Deco"`/`"10"` parked-division caveat, and the two placement
  traps (the no-wrapper-when-empty rule, and the supervisor flag-row guard).

---

*CLAUDE_PICKING.md v1.15 · Schema v27.15 · Picking Module · August 2026 · updated 2026-08-19 — SMU badge (74/77 only, derived code, no new column); §5.2's stale `articleTag` where-row claim corrected*
