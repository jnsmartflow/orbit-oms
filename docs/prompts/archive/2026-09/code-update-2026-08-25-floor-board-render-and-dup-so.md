# code-update-2026-08-25 — Floor board render fixes + duplicate-SO soft treatment

Classification: `code-update-*` — SHIPPED. Merge as current reality after `git log` confirms the
commits below (project rule: a SHIPPED line is a claim, not a fact).

Target files: `CLAUDE_FLOOR.md` (primary), `CLAUDE_UI.md` (§23 family), `CLAUDE_PICKING.md`
(one cross-reference), `CLAUDE_CORE.md` (§13 feed count).

Commits: `07bc5104` · `37a3a1f2` · `bc232f72` (2026-08-25).

---

## 1. What shipped

### 1a. The all-done ✓ no longer swallows the board

**Symptom:** once every bill due today was checked, the Floor pane showed a centred green
"Everything on the floor is done" panel and nothing else. The operator lost every bill he had
just finished.

**Root cause — RENDER, not data.** `components/floor/floor-board.tsx`: `allDone`
(`!isHistory && !inContext && dueRows.length > 0 && dueRows.every(r => r.isChecked)`) sat as an
`else if` **ahead of every table-rendering branch**, so the panel replaced the row list wholesale.
The rows were in the payload the whole time — counted in the date-bar strip and in the tab badge,
simply never drawn.

Verified against production 2026-08-25: the floor's live set held **89 rows** (6 `pick_assigned`,
1 `pick_done`, 82 `pick_checked`-today) while the screen showed none.

**Fix:** the ✓ becomes a `CarryoverBanner`-shaped green strip rendered ONCE in the scroll
container above the active view; every branch still draws its list underneath. Scoped to the three
row-list views, so By-picker and By-group are byte-identical. Green, never teal (UI §10 /
FLOOR §4.6). `allDone`'s computation is unchanged.

**Also removed in the same commit:** the Upcoming strip's `!allDone` gate. It existed because
`allDone` used to replace the body; an all-checked day now shows tomorrow's work at the foot of
the board. **New behaviour, not yet eyeballed.**

### 1b. Empty slot tab had no empty state

The final flat branch rendered `<FloorTable rows={sort(tabRows)}>` with no guard — when `viewRows`
was non-empty but the active slot tab held nothing, it drew a column header over zero rows and said
nothing. Now names the window, quiet neutral, no red or amber.

⚠ **Narrower than it looks.** The identical blank still exists in **By route** when the open window
is empty. It was deliberately NOT guarded: in the pending-assign context that branch groups over
`tabRowsAll` so every route stays listed even when its waiting pile is empty. It needs its own
`tabRowsAll` guard — see §4.

### 1c. Ship-to name pair on the floor table

Closes the gap recorded at `CLAUDE_FLOOR.md §8b` ("the ship-to original→redirect name pair is
missing on the floor table (rail already has it)").

`getFloorBoard` collapsed both parties into one `dealerName` and emitted only the
`isShipToOverride` boolean, so a redirected row rendered a nameless violet "→ ship-to changed"
caption. The Prisma include was never the problem — `FLOOR_BOARD_INCLUDE` already pulls `customer`
and `shipToOverrideCustomer` through `FLOOR_DEALER_SELECT`, which selects `customerName`.

- `lib/floor/types.ts` — `FloorBoardRow` gains `customerName` and `shipToOverrideName`, mirroring
  `FloorRailCard`. **Declared on the Floor type, never on `PickingQueueRow`** (FLOOR §1 ownership
  boundary).
- `lib/floor/queries.ts` — both emitted in `getFloorBoard`'s row literal. No new query, no new
  await, no write (the live marker keys on `MAX(orders.updatedAt)`, FLOOR §5/§10).
- `components/floor/floor-table.tsx` — renders `{original} → {redirect}` worded like `rail-card.tsx`,
  violet unchanged, inside the existing column with its own ellipsis + `title`. No column widened
  or added. The stale "LIMITED by the payload" comment was removed.

**The redirect relation:** `shipToOverrideCustomer`, relation name `"OrderShipToOverride"` on
`shipToOverrideCustomerId`, the named sibling of `"OrderCustomer"` on `customerId`
(`prisma/schema.prisma:730–731 / :726–727`) — both explicitly named per CORE §3's dual-FK rule.
`isShipToOverride` is derived as `shipToOverrideCustomerId !== null` in all four feeds.

### 1d. Filter: site + redirect were silently unsatisfiable

`lib/floor/filter.ts` makes `site` require `!isShipToOverride` and `redirect` require
`isShipToOverride`, and `matchesFlags` ANDs with `.every` — so ticking both returned zero rows every
time, with no explanation on screen.

Fixed in the SHEET, not the predicate: `filter-sheet.tsx`'s `toggleFlag` now clears the opposite
when either is switched on. **`lib/floor/filter.ts` is untouched — it owns what a flag MEANS.**

Also confirmed while diagnosing, worth recording because it refutes an obvious guess: `FLAG_OPTIONS`
is a **hardcoded literal array**, not built from rows, so the chip can never render empty or lose
its choices whatever the data contains. And **the rail is never filtered** (design §6.1) — search
only HIGHLIGHTS rail cards. An operator who ticks a chip and looks left sees no change, which reads
as "filter not working".

### 1e. Duplicate-SO row: full red → 3px bar + soft tint

**Naming:** the flag is `hasDuplicateSo`; the chip previously read "Same SO". Everything behind it is
`duplicate-so` / `DUP_SO_*`. There is no flag called "SAME".

Solid `#dc2626` filled the whole row, which is why `DUP_SO_BADGE_CLASS` had to flip the age chip,
the elapsed pill, the ⚡ and the StatusPill to white just to keep them visible.

**New treatment (Floor only):** `#fef2f2` ground + `inset 3px 0 0 #ef4444` left bar; every badge,
glyph and pill renders exactly as on an ordinary row.

⚠ **The bar is an INSET BOX-SHADOW, never `border-left`** — the table is `table-layout: fixed` with
colgroup percentages (UI §27) and the first column's `pl-[10px] pr-[4px]` would be eaten by a real
border. It rides the checkbox cell when interactive, the OBD cell when not.

**Chip now reads "SAME", one word.** "Same SO" overflowed the 14% OBD track and shipped rendering
"SAME …". Fixed with a shorter word, not a wider column; the `title` tooltip is unchanged.

**How Picking stayed byte-identical — the mechanism worth remembering.**
`components/shared/duplicate-so-tag.tsx` now owns **TWO treatments, split by MODULE**. Every existing
`DUP_SO_*` token was **added to, never edited, renamed or re-valued**. A new `DUP_SO_SOFT_*` set plus
`variant?: "solid" | "soft"` defaulting to `"solid"`; only `floor-table` / `rail-card` /
`detail-panel` pass `"soft"`. Both picking call sites omit the prop —
`git diff --stat components/picking/` was empty at commit. This is the same additive shape FLOOR §1
already blesses for `use-picking-marker`.

**COLOUR IS A RECORDED DECISION, NOT AN OVERSIGHT.** `#ef4444` is also the urgent ⚡ on this board,
and UI §3 assigns `bg-red-50` to Urgent / Hold / Voided. Smart Flow ruled **2026-08-25** that on a
floor row `red-50` + a `red-500` bar means Same-SO, and Urgent keeps the ⚡ alone. A future pass must
not "fix" this. If two red meanings are ever confused on the floor, that is the thing to revisit —
the alternative considered and rejected was purple (the app's "these bills are related" colour).

---

## 2. Diagnosis findings worth keeping (no code acted on them)

These were proven at the call site and are cheaper to record than to re-derive.

- **`floorLiveBaseWhere` is correct and has not drifted.** Arm 2 still fences on
  `pickAssignment.checkedAt` inside `getISTDayRange()`, not on `dispatchTargetDate`.
- **`pickAssignment` is a to-ONE relation**, not `some`/`every` — `orderId Int @unique`
  (`schema.prisma:1226`), `orders.pickAssignment pick_assignments?` (`:791`). A reassignment
  `deleteMany`s the old row then creates a new one, so exactly one row exists and its `checkedAt`
  decides. Safe by construction.
- **No UTC/IST cliff.** `getISTDayRange()` returns UTC instants; `pick_assignments.checked_at` is
  `timestamp with time zone`. Same units at every hour.
- **Nothing advances a bill past `pick_checked`.** The terminal writer is
  `app/api/picking/approve/route.ts` (stamps `checkedAt`, then sets `PICK_CHECKED`). The only other
  `workflowStage: "dispatched"` in the live tree is inside a `prisma.orders.count()` — a READ.
  `scripts/_waiting-pool.ts` mentions it but is underscore-prefixed, outside the tsc gate, never
  imported. No raw SQL anywhere in `app/` or `lib/`. `vercel.json` declares only the two attendance
  crons.
- **Board and marker are still the ONE shared predicate.** `getFloorLiveMarkerWhere()` =
  `floorLiveBaseWhere(getISTDayRange())` AND hide, identical to `getFloorBoard`'s live branch. The
  marker was the TRIGGER of the visible transition (checking the last bill moves
  `MAX(orders.updatedAt)` while `count` holds, firing a refetch) but never the cause — the refetch
  returned the same 89 rows.
- **Live census 2026-08-25 IST:** `pending_picking` 0 · `pick_assigned` 6 · `pick_done` 1 ·
  `pick_checked` 784 (784 with a `checked_at`, **0 NULL**, 82 inside today IST) · board set 89 rows,
  none upcoming.
- **`hasDuplicateSo` renders on:** the four `FloorTable` call sites (flat / slot bands / by-route /
  by-group / Upcoming — one component, so they cannot diverge), the rail card, the detail panel, and
  the two picking phone boards. **Not** on By-picker cards (they aggregate), and **not** on Hold or
  Cancelled — `FloorHoldRow` has no `hasDuplicateSo` (documented gap at
  `duplicate-so-tag.tsx:27–30`).

---

## 3. Corrections to make in `CLAUDE_FLOOR.md` (v1.4)

Six lines. Grep every canonical file for each — a wrong claim is never in one file only.

1. **§6(c), ~line 185** — "a bill can never disappear at completion". True of `floorLiveBaseWhere`,
   false of the SCREEN until `bc232f72`. Add the render-side qualifier and point at the new landmine
   in §5 below.
2. **§8, ~line 199** — `RAIL_SUGGESTIONS_ENABLED` is cited at `lib/floor/queries.ts:70`. It is at
   **:87** today.
3. **§2, ~line 48** — the Floor pane is described as "slot bands (All view) or Flat/By-route (a slot
   tab)". Two more view pivots exist and are unmentioned: **By picker** (`mode` defaults to
   `"picker"` — this is the view `/floor` LANDS on) and **By group** (`RULE2_ENABLED`,
   `group-row.tsx`). §11's `picker-card.tsx` row already covers By-picker, so §2 alone is behind.
4. **§3, ~line 56** — "Four SELECT-only feeds" contradicts `CLAUDE_CORE.md §13`'s "Floor — all five
   feeds". `getFloorPickers` makes five. Settle it in both files in the same pass.
5. **§11 key-files table** — missing `lib/floor/scope.ts` (added 2026-08-09, now the shared owner of
   `inScope`) and `components/floor/group-row.tsx`.
6. **§8b, ~line 252** — the ship-to name-pair gap is **SHIPPED** (§1c above). Move it out of
   DEFERRED into the live spec.

---

## 4. Still open — carry to ROADMAP, do not lose

- **By-route empty window still draws a blank.** Needs its own `tabRowsAll` guard; a `tabRows`-based
  one would kill the deliberate "every route stays listed" behaviour.
- **Four inline empty/done states remain un-refactored** in `floor-board.tsx`. A shared
  `board-empty.tsx` beside `rail-empty.tsx` is still the right end state; the Upcoming-strip work
  should ride with it.
- **OBD colour drift.** `floor-table.tsx` renders OBD at `#111827`; `CLAUDE_UI.md §4` canon is
  `#1f2937`. Deliberately left alone — matching ordinary rows beat matching canon for this change.
  Aligning the whole table touches every row state and is its own ticket.
- **Phone picking boards still show the solid red treatment**, so a duplicate-SO bill looks different
  on the phone and on the desk. Already in ROADMAP with the `variant` prop named as the mechanism.
  It is a PICKING change and wants that module's sign-off.
- **The design source for a shipped change is untracked.** The mockup lives at
  `docs/prompts/drafts/duplicate-so-highlight-mockup_1.html` and is not in git. Move it to
  `docs/mockups/floor-control/` and track it. (A second mockup was drawn on the web side before this
  was found — the repo one is authoritative; note that its labelled B is a bordered wash and its
  bar option is C, while what shipped is C's shape at the values in §1e.)
- **Nothing shipped today has been seen on a screen.** No login exists on the Claude Code side. The
  ✓ banner, the empty-window state, the name pair, the soft rows, the SAME chip's fit and the newly
  visible Upcoming strip are all unverified renders as of the push.

---

## 5. New landmines to add

**§10 (`CLAUDE_FLOOR.md`) — the query being right does not mean the row is on screen.**
`floorLiveBaseWhere` kept all 89 rows; a single unguarded `else if` in `floor-board.tsx` replaced the
list. §6(c)'s "can never disappear at completion" was written from the WHERE and was true of it. When
a board reports empty, prove which half is empty — the payload or the render — before touching the
predicate. Same family as CAPABILITY IS NOT REACHABILITY, one layer further out: the data can be
there and reachable and still not drawn.

**Process — staging a file by name still ships every task's edits inside it.**
`07bc5104` ("Floor history: show what was CHECKED that day") swept up the `queries.ts` half of the
ship-to change from an in-progress working tree, while `types.ts` stayed behind. `main` then assigned
two fields that did not exist on the type and **did not typecheck on its own** — invisible locally,
because the uncommitted `types.ts` was sitting on top. `37a3a1f2` closed it. Staging by name is not
enough when one FILE carries two tasks; check `git diff` of each staged file, not just its name.

---

*Draft for consolidation into canon by Claude Code. Web only drafts; consolidation edits files on
disk and always starts with a READ + PLAN step that writes nothing.*
