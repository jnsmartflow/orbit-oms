# CLAUDE_PICKING.md — Picking Module
# v1.1 · Schema v27.9 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md

---

## 1. What Picking is

Picking sits between Support and physical dispatch: an order becomes pickable the instant Support's
"done" action fires, and leaves Picking once a picker has been assigned to fetch it. Today the module
covers **queue + assign/undo only** — the walk to "picked, checked, cleared for dispatch" is designed
(§6) but not built.

**Route:** `/picking` — one route, two faces via a responsive switch (`app/picking/page.tsx`):
- **Desktop queue** (`hidden md:block`, `components/picking/picking-queue.tsx`) — table view.
- **Mobile supervisor board** (`block md:hidden`, `components/picking/picking-board-mobile.tsx`) —
  Assign/Check tabs + a detail screen. [LIVE], §5.

**Who can use it — access reality:** page + every API route gate on `checkAnyPermission(roles,
"picking", "canView")` with an `admin` bypass. **Today that's effectively admin + operations only** —
`floor_supervisor`, the intended primary user (supervisors on the floor), has **no `picking` row in
`role_permissions` or `prisma/seed.ts`** (confirmed by grep — zero matches). SQL + a seed row are
prepared but not yet run. See §7.

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

**Three tabs, three jobs** — not three stages. "Picking" (waiting) was explicitly rejected as its own
tab: waiting isn't a job you do, and today nothing moves a bill out of it automatically.

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
- **Checked tab [LIVE, 2026-07-18]** — every bill at `pick_checked`, today's dispatch-target date
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
area + picker name (Check/Checked tabs) rendered **verbatim** (no client-side drum/carton parsing).

**Detail screen + new route:** `GET /api/picking/order/[orderId]/route.ts` — on-demand line items,
not part of the main queue payload (`PickingQueueRow` only carries order-level aggregates). There is
**no FK from `orders` to line items** — matched via the order's own `obdNumber` against
`import_raw_line_items`. Reads the **full active line set**, not just the enriched subset, falling
back to the raw SAP description/code when a line never enriched against `sku_master` — nothing
silently disappears from what the picker sees. Pack code renders in a fixed-width tile with no
container word (the picker matches pack size against the shelf, not container type) — a deliberate
column-scan design (SKU is the matching key; product name is confirmation after).

**Desktop untouched (behaviour-wise):** `picking-queue.tsx`'s rendered rows/counts/selection are
unchanged by the Checked tab. Because `lib/picking/queue.ts`'s WHERE clause is shared, widening it to
include `pick_checked` (2026-07-18) required additive guards in THREE desktop call sites
(`unassignedRows`, `availableRoutes`, `selectableIdsInTab` — all gained `&& !r.isChecked`) purely to
keep a checked bill from reappearing there as if untouched. No desktop Checked view was built — a
pick_checked row has no home on desktop, by design (§7).

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
supervisor board's **Checked tab** (§5), which is its permanent same-day record. Nothing today moves
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

---

## 7. Open / deferred + landmines

- **`floor_supervisor` cannot open `/picking` today** [LANDMINE / access gap] — confirmed via
  `prisma/seed.ts` grep, zero rows for `floor_supervisor` + `picking`. SQL + a seed row are prepared
  (from the 2026-07-16 session) but **not yet run**:
  ```sql
  INSERT INTO role_permissions
    ("roleSlug", "pageKey", "canView", "canEdit", "canImport", "canExport", "canDelete", "updatedAt")
  VALUES
    ('floor_supervisor', 'picking', true, false, false, false, false, now())
  ON CONFLICT ("roleSlug", "pageKey")
  DO UPDATE SET "canView" = EXCLUDED."canView", "updatedAt" = now();
  ```
  Must land **both** the SQL row AND the matching `prisma/seed.ts` row — a live-only grant dies on the
  next reseed (CORE §3 seed-is-source-of-truth rule).
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
- **SKU `5961032`** (`DN WS Metallic Gold 0.5L`) renders with a **null pack** on the detail screen
  while IN-prefixed SKUs resolve fine — unresolved open question (stray SKU, or a whole class of old
  numeric SAP codes with the same gap?). A blank pack is exactly the thing that prevents a mis-pick,
  so this matters more than its size suggests.
- **`articleTag` is null on some bills** (e.g. seen on a real order with area but nothing after) —
  unresolved: a handful of strays, or a pattern tied to one order type/import path? Never answered.
- **Real pick durations are unmeasured** — the Check tab's 30m/60m elapsed thresholds are a guess, not
  a measured depot baseline.
- **Decided against, revisit only if usage proves otherwise:** pinning the mobile filter row + lane
  strip — mechanically easy but costs ~200-215px permanently claimed on every screen (nearly a full
  card of list density in all scroll states). Shipped lean; same call as the no-jump guard above.
- **Commit ≠ deploy discipline.** A build stage was once committed but never pushed, and separately an
  unrelated commit sat un-pushed on the depot PC and rode along with this work. Every build prompt for
  this module from the 2026-07-16 session onward carries `git push origin main` in its exit criteria —
  worth keeping for any future Picking session.
- **`windows[].count` and `totalCount` don't exclude done/checked rows** [LANDMINE, 2026-07-18] —
  `lib/picking/queue.ts`'s `getPickingQueue()` computes `windows[].count` as
  `sortedRows.filter(r => r.windowId === w.id && !r.isAssigned).length` and `totalCount` as
  `sortedRows.length - assignedCount`. Neither excludes `isDone` or `isChecked` rows, so both desktop
  stats (`picking-queue.tsx`'s per-window header badges and the "OBDs"/"All" segment count) over-count
  "still queued" bills by however many are done or checked that day. Pre-existing for `isDone` (never
  patched when `pick_done` went live); `isChecked` just compounds it. Not fixed here on purpose — a
  correction would itself be a desktop-visible behaviour change, out of scope for an additive build.
  Fix both together in one pass someday (`&& !r.isDone && !r.isChecked` on both formulas), not
  piecemeal.

---

## 8. Key files index

| File | Role |
|---|---|
| `app/picking/page.tsx` | Responsive switch (desktop queue `hidden md:block` vs mobile board `block md:hidden`); also builds the picker "My Picks" `pending`/`done` split (excludes/includes `isChecked` — 2026-07-18) |
| `components/picking/picking-queue.tsx` | Desktop board — visually untouched; gained `&& !r.isChecked` guards (2026-07-18) in 3 call sites so a checked bill can't leak into the unassigned table/route filter/select-all |
| `components/picking/picking-board-mobile.tsx` | Mobile supervisor board — Assign/Check/**Checked** tabs, shared `CheckCard`, detail screen (§5) |
| `components/picking/picker-my-picks-board.tsx` | Picker's own board — untouched this cycle; its `pending` prop is now pre-filtered upstream (page.tsx) so an approved bill never reaches its "Mark done" CTA |
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

*CLAUDE_PICKING.md v1.1 · Picking Module · July 2026*
