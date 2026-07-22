# CLAUDE_PICKING.md — Picking Module
# v1.3 · Schema v27.11 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

---

## 1. What Picking is

Picking sits between Support and physical dispatch: an order becomes pickable the instant Support's
"done" action fires, and leaves Picking once a picker has been assigned to fetch it. **The full cycle
is built and live** — assign → pick → done → check → approve, every state visible and traceable on
both boards (shipped across the 2026-07-17/18 sessions; full state ladder in §6).

**Route:** `/picking` — one route, two faces via a responsive switch (`app/picking/page.tsx`):
- **Desktop queue** (`hidden md:block`, `components/picking/picking-queue.tsx`) — table view.
- **Mobile** (`block md:hidden`, `components/picking/picking-board-mobile.tsx` OR
  `components/picking/picker-my-picks-board.tsx`) — branches by role: the **supervisor board**
  (Assign / Check / Done — three **bottom** tabs — + a detail screen. [LIVE], §5) for supervisors, or
  the picker's own **"My Picks"** board (Pending / Done. [LIVE], §5) when the viewer is a picker — or,
  today, an admin/operations session using the `?view=picker&as=<id>` test hook (§7).

  Both mobile faces mount through `components/picking/picking-mobile-shell.tsx`, which wraps
  `<RoleLayoutClient>` — Picking is the **first and reference consumer** of the shared shell's
  per-module bottom-tab slot (`CLAUDE_UI.md §59`).

**Who can use it — access reality:** page + every API route gate on `checkAnyPermission(roles,
"picking", "canView")` with an `admin` bypass. **Today that's effectively admin + operations only** —
`floor_supervisor` AND `picker`, the intended primary users (supervisors and pickers on the floor),
both have **no `picking` row in `role_permissions` or `prisma/seed.ts`** (confirmed by grep — zero
matches for either role, or in fact for ANY role). SQL + seed rows are prepared for `floor_supervisor`
but not yet run, and `picker` needs its own separate grant. Operations' own live grant has a separate,
sharper problem — it isn't in the seed file at all. Full detail: §7.

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
needing a change. `supportMayEdit` is a **per-row flag, not a rank threshold** — Support is unlocked
at 10-20 and 50-60, locked at 30-40 (mid-tint) and again from 70 onward (picker has it) — a genuine
hole in the middle that a simple `rank >= X` test would get wrong.

**The constants that matter here:**
- `SUPPORT_DONE_OUTPUT = "pending_picking"` — the ONE current value Support's done-action writes.
  `closed` is legacy-only; nothing writes it anymore, but old rows at that rank must still behave
  identically (hence the shared rank 60).
- `PICK_ASSIGNED = "pick_assigned"` — what the Assign action writes.
- `PICK_DONE = "pick_done"` — what the picker's Mark Done action writes (`POST /api/picking/done`).
- `PICK_CHECKED = "pick_checked"` — what the supervisor's Approve action writes
  (`POST /api/picking/approve`). Both are live, not planned — see §5/§6.

**Today's live ladder (Support → Picking → Checked):**
```
pending_support → [Support Done] → pending_picking → [Assign] → pick_assigned
  → [Picker Mark Done] → pick_done → [Supervisor Approve] → pick_checked → (dispatch, unbuilt)
```
`pick_assigned` has `supportMayEdit: false` — this is the enforcement point for "Support is locked
out of orders being physically worked": once a bill is assigned to a picker, Support's hold/cancel/
dispatch routes must treat it as untouchable. (The equivalent lock for the tint stages, 30-40, is
Support-side work already documented in `CLAUDE_SUPPORT.md` §4.9/§4.15 — same registry, same
principle, applied earlier in the ladder.)

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

**`GET /api/picking/queue`** — `getPickingQueue(dateParam)`; `date` optional (trim, empty→today).
Same `canView` gate as the page.

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
called this "not built"; that was superseded within two days. The desktop `picking-queue.tsx` route
and the mobile board's Assign tab (§5) both drive the same `/api/picking/assign` batch endpoint.

---

## 5. Mobile supervisor board [LIVE]

`components/picking/picking-board-mobile.tsx`, mounted via the responsive switch in
`app/picking/page.tsx`. Live in production on `/picking`'s mobile viewport, **test-mode assign** (see
§4 — every assignment is tagged and reversible).

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
- **The picker face gets the DEFAULT bar.** `PickingMobileShell` only mounts the tab/fetch machinery
  when `!showPickerFace`; the picker's "My Picks" board and the desktop queue leave `workflowTabs`
  undefined, so they keep the standard Home/Menu/You bar untouched.
- Tab icons (lucide): `Inbox` (Assign) · `ClipboardCheck` (Check) · `CheckCircle2` (Done). Count badge
  hidden at 0.
- The top teal header keeps the "Picking" title + search toggle, and gained the grid/avatar triggers
  that open the shared Menu/You sheets via `useMobileShell()`.

**⚠️ "Done" is a SCREEN LABEL ONLY — no new stage exists.** The third tab's visible text changed
`Checked` → `Done` (Stage 4/4). Everything underneath is unchanged:

| Layer | Value |
|---|---|
| Visible tab label | **"Done"** |
| Tab `key` / `activeTab` literal | `"checked"` |
| `orders.workflowStage` (DB) | **`pick_checked`** — unchanged, §2 |
| Constant | `PICK_CHECKED` — unchanged |
| Row flag | `isChecked` — unchanged |

Renaming the KEY would silently break tab switching, the Check-tab split, and the Done-list render.
**Label ≠ key ≠ stage.** No migration happened, no ladder entry was added — if you are looking for a
`pick_done`-vs-`pick_checked` distinction, §2 still governs.

**⚠️ Two different things are called "Done" on this module — keep them apart:**

| | Supervisor board — **Done** tab (§5.2) | Picker "My Picks" — **Done** tab (§5.4) |
|---|---|---|
| Who sees it | supervisor | the picker himself |
| Stage shown | `pick_checked` only | `pick_done` **OR** `pick_checked` (either) |
| Means | "I approved this bill" | "I finished fetching this bill" |
| Renamed 2026-07-19? | **yes** (was "Checked") | **no** — always been "Done" |

The picker's Done tab deliberately includes approved bills, so a bill stays in his own history instead
of vanishing the moment a supervisor checks it.

### 5.2 Three tabs, three jobs

Not three stages. "Picking" (waiting) was explicitly rejected as its own tab: waiting isn't a job you
do, and today nothing moves a bill out of it automatically.

- **Assign tab** — flat list in **server sort order** (§3), no client re-sort or grouping. Route
  dropdown (client-derived from loaded rows) + delivery-type pills, both stack with search. Select
  (checkbox) → floating bar → picker sheet → `POST /api/picking/assign`.
- **Check tab** — split into "Needs check" (`pick_done`, picker finished) and "Still picking"
  (`pick_assigned`), **not narrowed by the Assign tab's route filter** (mirrors desktop, where
  assigned rows ignore the route filter). Filtered by **picker**, not route — at the dispatch point
  supervisors think in people, not lanes. Elapsed-time pill (grey <30m, amber 30m+, red 60m+) on
  "Still picking" ticks off a local clock every 30s, no refetch; "Needs check" gets a flat green
  "Picked Xm ago" pill instead (not tiered — a receipt, not an urgency signal). Undo lives on the
  detail screen, not the card, for "Still picking" rows only. Tapping a "Needs check" card opens the
  per-line tick screen; ticking every line unlocks **Approve** (`POST /api/picking/approve`), which
  writes `pick_checked` + `pick_assignments.checkedAt`/`checkedById`.
- **Done tab** (labelled "Checked" until 2026-07-19 — same tab, same `"checked"` key, see 5.1)
  **[LIVE, 2026-07-18]** — every bill at `pick_checked`, today's dispatch-target date
  only (same `dispatchTargetDate` scope every other row already uses — no separate "today" concept
  was introduced). Flat list, **re-sorted newest-checked-first** (the one place this board deviates
  from `PICKING_SPINE` — a display-only re-order of an already-filtered slice; `sort.ts` itself is
  untouched). Own type-pill filter + own picker-filter dropdown (filters by **picker**, the same
  semantic as the Check tab's dropdown — the checker's identity is a display concern on the card, not
  a filter axis). Card: right of line 1 shows plain grey `checked {time}` (not a pill — finished,
  nothing ticking); a dedicated line below the area/picker line reads `✓ Checked by {name}` — **its
  own line, never folded into the area/picker line**, because a long area name + a long
  picker/checker name measured out to overflow the card and the checker's identity — the entire
  point of this tab — must never be the thing a `truncate` ellipsis silently clips. Tap → the same
  detail screen, fully read-only for these rows (no ticks, no Approve, no Undo, no Assign-to-picker —
  all four CTAs/affordances gate on `!isChecked` alongside their existing `isDone`/`isAssigned`
  checks).

**Card DNA (shared by all three tabs):** OBD (mono) + window tag · ★ `isKeyCustomer` · ⚡
`priorityLevel === 1` (strict equality) · dealer name as hero · area + `articleTag` (Assign tab) or
area + picker name (Check/Done tabs) rendered **verbatim** (no client-side drum/carton parsing).

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
  also removes the mistap risk of switching Assign/Check/Done while reading one bill. Because the bar
  is gone, the three detail CTAs use `max(env(safe-area-inset-bottom, 0px), 16px)` (the `/po` footer
  convention) and sit flush — they no longer pad by `MOBILE_NAV_CLEARANCE`.
  **`MOBILE_NAV_CLEARANCE` is still imported and still used by `SHEET_GEOMETRY` for the list-view
  sheets — do NOT remove it.**

**Swipe between bills + the "N of M" counter [LIVE]:**

- `openDetail(orderId, listKey)` — the signature carries a **`listKey`** (`waiting` | `needsCheck` |
  `stillPicking` | `checked`) because the Check tab has two sections; prev/next must page the RIGHT
  list. All four call sites pass it.
- The index is derived **live on every render** from `activeDetailList` + `detailOrderId`, never
  frozen at open time — `handleUndo` refetches while the detail is open, so a captured array would go
  stale.
- Counter is **Option F**: merged into the existing "packs · volume" summary row (already pinned,
  never scrolls) as `‹ N of M ›`, neutral gray, with tap arrows. **Hidden when the list has one
  item.** Teal stays reserved for the Assign CTA — this is navigation, not a primary action. Reuse
  `detailIndex`/`activeDetailList`; do not compute a parallel index.
- **⚠️ Gesture rules — the back gesture and the paging gesture SHARE the touch region and were
  designed together. Do not tune one without the other:** 24px edge exclusion (an edge-start touch is
  always the OS back gesture, never a bill change), 10px deadzone, 1.5× axis-dominance lock (so
  vertical scrolling in the line list coexists), 80px commit threshold, **no wrap at the boundaries**.
- Slide animation (Build B): Option-1 "slide across", `SLIDE_DRAG_FOLLOW = 0.65` finger-follow,
  `SLIDE_MS = 130` per half (~260ms end to end). Arrow taps and swipes call the same transition, so
  both produce an identical slide. Option 3 "card deck" was rejected — it reads as "dismissed this
  bill" on a work tool. **Feel-tuning of these two numbers is pending real-device confirmation on the
  floor** — they are one-number tweaks, not a redesign.

**Desktop untouched (behaviour-wise):** `picking-queue.tsx`'s rendered rows/counts/selection are
unchanged by the Checked tab. Because `lib/picking/queue.ts`'s WHERE clause is shared, widening it to
include `pick_checked` (2026-07-18) required additive guards in THREE desktop call sites
(`unassignedRows`, `availableRoutes`, `selectableIdsInTab` — all gained `&& !r.isChecked`) purely to
keep a checked bill from reappearing there as if untouched. No desktop Checked view was built — a
pick_checked row has no home on desktop, by design (§7).

### 5.4 Picker face — "My Picks" board

**[LIVE]** `components/picking/picker-my-picks-board.tsx`, mounted by
`app/picking/page.tsx` on the SAME mobile route when the viewer's primary role is `picker` — or,
today, an admin/operations session using the `?view=picker&as=<id>` test hook, since no real
picker-facing login flow has shipped yet (§7). Two tabs, **Pending / Done**, still a **TOP** strip —
this face was NOT moved to Direction A (5.1), it keeps the shared shell's default Home/Menu/You bar.
Its `TopBarTab` is now a **local copy** living in this file: the supervisor board's original was
removed when its strip moved to the bottom bar, so there is no longer a shared original to point at —
if this face is ever converted to bottom tabs, that copy goes with it. Three-line card only (OBD+window · dealer name ·
area+articleTag) — no clock, no avatar, no footer; the Done tab additionally shows the pick time as
his receipt. `pending`/`done` are computed server-side in `page.tsx` from the SAME `getPickingQueue()`
rows, scoped to `pickerId` (a real FK, never a display-name match) — `pending` excludes both `isDone`
and `isChecked`; `done` includes either, so an approved bill stays visible in his own history instead
of vanishing the moment a supervisor checks it. Mark Done is fire-and-forget, no confirm sheet (see
Design decisions, §6); `POST /api/picking/done` re-verifies `pickerId` ownership server-side even
under the admin view-as hook — the coarse permission gate plus this ownership check are what stop
"mark someone else's bill done" without a real grant. Roster data for the "view as" dropdown comes
from `lib/picking/picker-roster.ts` (new file, 2026-07-17/18 build).

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
- **Ephemeral ticks, not persisted.** The tick screen is a forcing function, not an audit trail —
  median live bill is 2 lines (72% ≤ 3), so a phone-lock mid-check costs re-scanning 2-3 lines, not
  real data loss. Revisit only if floor usage proves phone-locks routinely hit the long tail.
- **No confirm sheet on Mark Done.** Fire-and-forget + toast, matching the existing assign/unassign
  pattern — the Done tab is the safety net; he can look and see it landed.
- **No Undo on a picked/checked bill.** A wrong pick is fixed by the picker fetching the remaining
  goods, then the supervisor approving — not by guessing an exception path before anyone has used the
  screen enough to know what it should look like.

---

## 7. Open / deferred + landmines

- **`floor_supervisor` AND `picker` both cannot open `/picking` today** [LANDMINE / access gap] —
  confirmed via `prisma/seed.ts` grep: **zero rows for `pageKey: "picking"` for any role at all** —
  not `floor_supervisor`, not `picker` (2026-07-17 discovery — a second, previously-undocumented
  instance of the same gap), not even `operations` (see the next bullet). SQL + a seed row are
  prepared for `floor_supervisor` (from the 2026-07-16 session) but **not yet run**:
  ```sql
  INSERT INTO role_permissions
    ("roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete", "updatedAt")
  VALUES
    ('floor_supervisor', 'picking', true, false, false, false, false, now())
  ON CONFLICT ("roleSlug", "pageKey")
  DO UPDATE SET "canView" = EXCLUDED."canView", "updatedAt" = now();
  ```
  `picker` needs its **own separate INSERT** — the SQL above only covers one of the two intended real
  floor users. Must land **both** the SQL row AND the matching `prisma/seed.ts` row, for EACH role — a
  live-only grant dies on the next reseed (CORE §3 seed-is-source-of-truth rule; see the next bullet
  for a live example of exactly that already having happened). 2 real picker-role users exist today
  for testing: Ramesh K. (id 8) and Sunil P. (id 9) — seed/test accounts, not real depot staff yet.
- **Operations' `/picking` grant is itself seed-fragile** [LANDMINE, 2026-07-19 discovery] —
  `role_permissions` has exactly one live row for `pageKey: "picking"` today:
  `roleSlug: "operations", canView: true`. **This row does not exist in `prisma/seed.ts` at all**
  (confirmed by grep — zero matches for `"picking"` as a `pageKey` anywhere in the seed file, for any
  role). Direct violation of CORE §3's "seed is source of truth" rule: the grant was made live-only,
  with no matching seed edit. **The next wipe-and-reseed silently revokes Operations' `/picking`
  access** — no error, no warning, it just stops working. Needs its own seed row, landed as its own
  fix rather than silently bundled into the `floor_supervisor`/`picker` grant above.
- **`canView` gates writes, not `canEdit`** [LANDMINE] — confirmed live: `assign/route.ts` and
  `unassign/route.ts` both check `checkAnyPermission(roles, "picking", "canView")`, the identical
  flag the read route and the page use. There is no read-only picking access today; a real write
  probably should check `canEdit` instead. Pre-existing, not introduced by any one session.
- **A vehicle/load-aware sort was designed, then deliberately removed in V1 (2026-07-13).** Do not
  rediscover a `>= 950kg` / `grossWeight` "truck-ready" ranking as new — it was tried, fully
  implemented, and stripped in favour of the flat spine in §3. If load-awareness returns, it re-enters
  as a new named rule slotted into `PICKING_SPINE`, not a rewrite of the spine itself.
- **`lib/picking/validate-assign.ts` is DORMANT** [LANDMINE] — still on disk, zero references
  anywhere. Kept per CORE §3 (never delete files unless instructed) specifically so the no-jump guard
  is a one-line re-wire if a future session needs it back.
- **Cross / IGT delivery types have no pill on the mobile board** — reachable only via "All".
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
- **`articleTag` is null on some bills** — **confirmed a real, ongoing minority pattern, not a
  handful of strays** (2026-07-17 discovery): **17% of the live picking-queue set** (111 of 663
  orders — 105 non-tint, 6 tint) have a null `articleTag`, layered on a much larger **69%
  system-wide/historical gap** (5,589 of 8,084 `import_obd_query_summary` rows), which mostly
  predates the `article_tag` raw SAP-XLS column existing at all. Not conclusively tied to one order
  type or import path from the data alone — every null-tag sample also has `sapStatus: null`, which
  may correlate with the manual-SAP-upload path (Auto-Import paused since 2026-05-14, CORE §4), but
  that correlation needs a dedicated follow-up query to confirm. Still open, now evidence-based.
- **Real pick durations are unmeasured** — the Check tab's 30m/60m elapsed thresholds are a guess, not
  a measured depot baseline.
- **Decided against, revisit only if usage proves otherwise:** pinning the mobile filter row + lane
  strip — mechanically easy but costs ~200-215px permanently claimed on every screen (nearly a full
  card of list density in all scroll states). Shipped lean; same call as the no-jump guard above.
- **Commit ≠ deploy discipline.** A build stage was once committed but never pushed, and separately an
  unrelated commit sat un-pushed on the depot PC and rode along with this work. Every build prompt for
  this module from the 2026-07-16 session onward carries `git push origin main` in its exit criteria —
  worth keeping for any future Picking session.
- **`windows[].count` and `totalCount` excluding done/checked rows** [WAS LANDMINE 2026-07-18 →
  FIXED 2026-07-21, step 5B] — historically `lib/picking/queue.ts`'s `getPickingQueue()` computed
  `windows[].count` as `sortedRows.filter(r => r.windowId === w.id && !r.isAssigned).length` and
  `totalCount` as `sortedRows.length - assignedCount`, neither excluding `isDone`/`isChecked`, so both
  desktop stats (`picking-queue.tsx`'s per-window header badges and the "OBDs"/"All" segment count)
  over-counted "still queued" bills by however many were done or checked that day. **Now fixed:** both
  formulas gate on a shared `isStillWaiting` predicate — `!r.isAssigned && !r.isDone && !r.isChecked
  && r.zone !== "upcoming"` (`queue.ts` ~`:508`; `windows[].count` ~`:515`, `totalCount` ~`:525`). The
  fix went slightly **beyond** what this note originally described (`&& !r.isDone && !r.isChecked`): it
  also excludes `zone === "upcoming"` (future-dated rows), so the counts mean "still needs a picker
  **today**." Done/checked/upcoming rows still ride in `rows` (rendered inline on desktop) — just not
  counted. Desktop-only stats; mobile computes its own counts.
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
  must be grepped across every `isAssigned`/`isDone`/`isChecked` consumer on BOTH boards before
  shipping. This has now bitten twice (`pick_done`, then `pick_checked`), always the same shape: a new
  stage is `false` on every existing boolean, so filters shaped `!isAssigned && !isDone` silently treat
  it as "still waiting." Call sites that needed a guard this round: mobile `waitingRows` + the detail
  screen's "Assign to picker" CTA; desktop `unassignedRows` + `availableRoutes` +
  `selectableIdsInTab`; and `app/picking/page.tsx`'s picker split (the worst one — an approved bill
  fell into the picker's own Pending tab with a live-looking Mark Done CTA). Grep first, don't assume.
- **`MOBILE_NAV_CLEARANCE` was missed 4 times before centralization** — the fixed bottom-nav clearance
  figure (76px + safe-area) was hand-copied separately into `FilterBottomSheet`, the Assign-to-picker
  sheet, and both detail-screen CTAs before it was pulled into one constant, exported from
  `components/shared/mobile-shell.tsx` (the file that renders the nav itself) and reused via
  `SHEET_GEOMETRY` and every bottom-pinned element. Fixed now, kept as a standing note — a repeat
  layout constant that isn't centralized on first use tends to get re-copied wrong at least once more.
  **Still required** (2026-07-19): the detail-screen CTAs stopped using it when the bar started
  hiding there (§5.3), but `SHEET_GEOMETRY` and the list-view sheets still do — do not remove it.

**Deferred to Stage 3 [NEXT]:** supervisor recording **what he actually found** on a Checked bill —
qty short (e.g. 8 of 10), remarks, and a message the billing operator sees so he can fix it in SAP.
Needs a findings table (a typed number is data, can't be ephemeral, unlike the tick screen). The tick
screen and this qty screen are the same screen, so it bolts on once the plain version has been used
on the floor for a while — nothing else in the system changes, it's a note, not an edit to the order.

---

## 8. Key files index

| File | Role |
|---|---|
| `app/picking/page.tsx` | Responsive switch (desktop queue `hidden md:block` vs mobile board `block md:hidden`); also builds the picker "My Picks" `pending`/`done` split (excludes/includes `isChecked` — 2026-07-18) |
| `components/picking/picking-queue.tsx` | Desktop board — visually untouched; gained `&& !r.isChecked` guards (2026-07-18) in 3 call sites so a checked bill can't leak into the unassigned table/route filter/select-all |
| `components/picking/picking-mobile-shell.tsx` | **Direction-A wrapper (2026-07-19)** — owns `data`/`activeTab`/`refetchQueue`/`detailOpen`, computes the bottom-tab counts, fills `RoleLayoutClient`'s `workflowTabs`/`hideBar` slots; exposes `usePickingBoard()` (§5.1) |
| `components/picking/picking-board-mobile.tsx` | Mobile supervisor board — Assign/Check/**Done** tab CONTENT (the tab strip itself now lives in the bottom bar), shared `CheckCard`, detail screen + its popstate/swipe machinery (§5.2-§5.3) |
| `components/picking/picker-my-picks-board.tsx` | Picker's own "My Picks" board (§5.4) — Pending/Done **top** tabs, own local `TopBarTab` copy, default shell bar; its `pending` prop is pre-filtered upstream (page.tsx) so an approved bill never reaches its "Mark done" CTA |
| `lib/picking/picker-roster.ts` | Roster/lookup for the admin "view as picker" dropdown (new file, 2026-07-17/18 build) |
| `components/shared/mobile-shell.tsx` | Not picking-specific, but load-bearing here — the three-way bottom-bar slot (`CLAUDE_UI.md §59`) and the `MOBILE_NAV_CLEARANCE` export every bottom-pinned sheet reads from (§7) |
| `components/shared/workflow-tab-bar.tsx` | The generic per-module bottom-tab bar Picking's three tabs render through (`CLAUDE_UI.md §59.3`) |
| `components/shared/mobile-shell-context.tsx` | Menu/You sheets + `useMobileShell()` — how Picking's own header opens them (`CLAUDE_UI.md §59.1`) |
| `app/api/picking/queue/route.ts` | GET — `getPickingQueue(dateParam)`, `canView` gate |
| `app/api/picking/assign/route.ts` | POST — batch assign, sequential two-write pair per bill, never `$transaction`, test-mode notes |
| `app/api/picking/unassign/route.ts` | POST — single-bill undo, mirrors Support's undo-dispatch two-write order |
| `app/api/picking/done/route.ts` | POST — picker Mark Done, writes `pick_done` + `pick_assignments.pickedAt` |
| `app/api/picking/approve/route.ts` | POST — supervisor Approve, writes `pick_checked` + `pick_assignments.checkedAt`/`checkedById` (real session user, never request-body-trusted) |
| `app/api/picking/order/[orderId]/route.ts` | GET — on-demand line items for the mobile detail screen; no FK, matches on `obdNumber` |
| `lib/picking/queue.ts` | `getPickingQueue()` — builds `PickingQueueRow[]` from `orders` + `querySnapshot`; WHERE clause now includes `pick_checked`, select includes `checkedAt`/`checkedBy` |
| `lib/picking/sort.ts` | `PICKING_SPINE` + `sortPickingQueue()` — the flat sort spine, §3 — untouched |
| `lib/picking/types.ts` | `PickingQueueRow`, `SortRule` shapes — `isChecked`/`checkedAt`/`checkedByName` added 2026-07-18 |
| `lib/picking/validate-assign.ts` | DORMANT — the no-jump guard, unused, kept on disk (§7) |
| `lib/workflow-stages.ts` | Central stage-ladder registry — `STAGE_LADDER`, `SUPPORT_DONE_OUTPUT`, `PICK_ASSIGNED`, `PICK_DONE`, `PICK_CHECKED`, `stageRank()`, `supportMayEdit()`, `isSupportDone()` (§2) |
| `docs/mockups/picking/supervisor-assign-board.html` | Approved mobile board mockup |
| `docs/mockups/picking/supervisor-check-split.html` | Approved Check-tab split mockup (Needs check / Still picking) |

---

*CLAUDE_PICKING.md v1.3 · Picking Module · July 2026*
