# code-update-2026-09-18-picking-colour-work

**Classification:** `code-update-*` — **SHIPPED.** Merge as current reality.

**Context read this session:** CLAUDE.md Router v1.12 · CLAUDE_CORE.md v104 · Schema v27.24 ·
CLAUDE_PICKING.md v1.17 · Schema v27.15 · CLAUDE_UI.md v5.30 · CLAUDE_TINT.md v2.1 · Schema v27.13 ·
CLAUDE_IMPORT.md v1.10 · CLAUDE_FLOOR.md v1.4 · Schema v27.13.

**No schema change. No migration. No writes anywhere. No new permission.** Two new API routes, one
new field on an in-memory row type, one new card atom, one new read-only UI section.

**Commits — read from `git log`, not from memory. All five on `main`, all pushed:**

| # | Commit | When (IST) | What |
|---|---|---|---|
| 1 | `ba03fc89` | 2026-09-17 23:46 | `colourWork` — the field only, nothing renders it (8 files, +340/−4) |
| 2 | `0841b5c9` | 2026-09-17 23:52 | the TINT/BASE word on every surface, and the 🎨 goes (9 files, +176/−41) |
| 3 | `2bcb47e9` | 2026-09-17 23:58 | BASE loses its border; both words flip on a duplicate card (4 files, +44/−13) |
| 4 | `aeed851c` | 2026-09-18 08:08 | the tint room as a read-only feed + its own marker (4 files, +655/−2) |
| 5 | `e2446c70` | 2026-09-18 08:23 | the Tinting section on the Picking tab (4 files, +532/−7) |

---

## 1. What this is, in plain English

**Two things, one thread.** A supervisor picking a bill could not tell paint that was mixed here from
paint that ships in the tin it arrived in, and he could not see work that was still on a mixer at all.

**(a) The TINT / BASE word.** A small pink badge in the left caption of every picking bill card,
reading `TINT` when the tint room actually mixed a colour for that bill and `BASE` when it did not.
It replaces a 🎨 emoji that keyed on `orders.orderType` and therefore called a bill "tinted" when the
Tint Manager had closed it through **"Base — No Tint"** — 15 such bills in the 14 days to 2026-09-17.

**(b) The Tinting section.** A read-only panel on `/picking`'s Picking tab, under the picker list,
showing what the tint room is holding: a "waiting for operator" pool card and one card per tint
operator, each openable into that operator's bills. The supervisor can act on none of it — a tint
bill reaches his Assign tab only when a tint done-route moves its stage.

### 🔴 The word renders for SMU 74 and 77 ONLY, and the silence is the design

Deco Retail (70) is ~90% of a live board — 1,530 of 1,703 bills in the 14-day sample — so a word on
it would sit on almost every card and bury the ones worth reading. The identical reasoning keeps `0d`
off `AgeBadge` and keeps `SmuBadge` to the same two divisions.

⚠ **And within 74/77, `BASE` does NOT mean "a bill full of base tins".** Most non-tint project bills
are distempers, primers, sealers, textures, putty and ready-mixed enamels — measured on the same
sample, 45 of 65 non-tint 74 bills and 61 of 70 non-tint 77 bills carry no base-coloured line at all.
`BASE` is the honest answer to *"did the tint room mix anything for this bill?"* — "no" — and must
never be read as a claim about what is in the boxes. That is exactly why the field is called
`colourWork` and not `isBase`.

---

## 2. The classification rule

`colourWork: "tint" | "base" | null` on `PickingQueueRow`.

| Value | Rule |
|---|---|
| `"tint"` | SMU 74/77, `orderType === "tint"`, and finished by a **real** operator: a `tinting_done` whole-OBD `tint_assignments` row whose `assignedToId` is not the placeholder, **or** a `tinting_done` `order_splits` row |
| `"base"` | SMU 74/77 and either `orderType !== "tint"`, **or** a tint bill finished by the Base — No Tint placeholder |
| `null` | every other division, **and** a 74/77 tint bill not yet finished |

`resolveColourWork()` decides all four, in one place. `finishedByRealOperator` **wins** over
`finishedByBaseOperator`: the two are mutually exclusive in live data (all 15 bypassed bills carry a
base row and nothing else), but Undo → re-assign → real completion can legitimately leave both
behind, and in that case the paint *was* mixed.

### 🔴 KEY ON `tinting_done`, NEVER ON "AN ASSIGNMENT ROW EXISTS"

Six `tint_assignments` rows carry a live-looking status right now (`assigned` ×5, `paused` ×1). **Five
of them sit on bills that left the tint room long ago** — one `dispatched` (row 753, order 10740) and
four `cancelled` (rows 901, 915, 1004, 1127) — and only row 1149 is a genuine live assignment. A rule
that asked "does this bill have an assignment row?" would put a dispatched bill back in an operator's
queue and would label finished bills off a job nobody is doing.

⚠ **`9108585737` is the case that proves the other direction.** It is a 77 **tint** bill at
`dispatched` with **zero** `tinting_done` rows — one of the bills the 2026-07-23 manual backfill sweep
force-closed (`CLAUDE_FLOOR.md §7`) without it ever being tinted. It correctly gets **`null`**: no
word at all, rather than a confident `TINT` it did not earn. A future session tempted to infer "it
reached dispatch, so it must have been tinted" has this bill as the counter-example.

---

## 3. Live counts — and the brief's expectation was wrong, not the code

Measured by running the real loader over the 14 days to 2026-09-17 (read-only):

| Division | `tint` | `base` | `null` |
|---|---|---|---|
| Decorative Projects (74) | 76 | 67 | 2 |
| Retail Offtake (77) | 17 | 83 | 1 |
| Deco Retail (70) | 0 | 0 | 1,530 |
| Distributor (76) · `Deco` (10) · no SMU | 0 | 0 | 38 |
| **Total** | **93** | **150** | **1,571** |

🔴 **The build brief expected "about 15 base" and got 150. The code is right; the expectation counted
only one of the rule's two arms.** 15 is the number of bills closed through Base — No Tint. Arm (a) —
"a 74/77 bill that was never a tint bill" — adds the other 135. `67 + 83 = 150 = 135 + 15`, and the
split matches the bypasses exactly (74: 65 + 2, 77: 70 + 13).

**Consequence to carry:** `BASE` appears on roughly **ten bills a day**, not one. It is an ordinary
label on a project-division bill, not a rare flag — which is the right outcome, since "nothing was
mixed for this bill" is the common case in 74/77.

For scale: ~10.6 tint bills arrive a day (peak 21), ~9.3 are completed a day (peak 15), ~2,131 L/day.

---

## 4. `colourWork` — file layout and the two naming decisions

| File | Contents |
|---|---|
| `lib/picking/colour-work.ts` | **PURE.** `ColourWork`, `PROJECT_SMU_CODES`, `ProjectSmuCode`, `isProjectSmu()`, `resolveColourWork()`. No prisma, no clock, no I/O |
| `lib/picking/colour-work-query.ts` | `getColourWorkByOrder(bills)` — the batched read |
| `lib/picking/types.ts` | the field on `PickingQueueRow` (type-only import, so the module stays emit-free) |
| `lib/floor/types.ts` | the same field on `FloorPartyFields` (hold + cancelled rows) and `FloorDetail` |

**Why the name avoids "tint":** `tint-*` in `tailwind.config.ts` is a **SKY BLUE** family
(`tint.600 = #0284C7`, and `bg-tint-bg text-tint-700` is Floor's *"With picker"* pill). A `tintKind`
field beside it reads as a shade of blue. The words on screen are TINT and BASE; the field is named
for the question they answer.

**Why `PROJECT_SMU_CODES` had to live in a prisma-free module:** the only existing 74/77 gate was
`SMU_BADGE_STYLE`'s keys inside `components/picking/card-atoms.tsx`, a `"use client"` file — and
`lib/` must not import `components/`. So the two codes moved to the pure module, `isSmuBadged` now
delegates to `isProjectSmu`, and `SMU_BADGE_STYLE` is typed `Record<ProjectSmuCode, …>` so **a code
added without a colour is a compile error** rather than a gate that says yes over a badge that
renders nothing. `SmuBadge`'s behaviour is unchanged (one type-narrowing test replaced a null check
plus an undefined lookup).

### 🔴 `buildPickingWhere` WAS NOT TOUCHED, and that is the load-bearing part

The classification is a **post-fetch enrichment** of rows the predicate already returned — the same
shape as `getDuplicateSoNumbers`, the dealer/user maps and the family catalog lookup beside it. No
term was added to `buildPickingWhere`, which the picking queue and `/api/picking/marker` share, so
**"Marker ⊇ queue, never ⊂"** (`PICKING §10`) is untouched and the Assign badge cannot move.

**Cost:** zero queries when no project-division **tint** bill is loaded — the ordinary Deco-Retail-
heavy board. Otherwise exactly three: `getBaseOperatorId()` (one indexed hit on a UNIQUE column),
one batched `tint_assignments` read, one batched `order_splits` read. Sequential awaits, SELECT-only.

**Five fillers**, because the word renders on five surfaces: `lib/picking/queue.ts`,
`lib/floor/queries.ts` ×3 (board, hold, cancelled) and `app/api/floor/order/[orderId]/route.ts`. The
detail route uses the shared loader rather than deriving from the `tintAssignment` row it already
fetches — that read is `findFirst` on `createdAt desc`, so a bill whose latest row is a skip or a
cancellation would classify differently there than on the board, and one bill reading two ways across
two screens is the defect one owner exists to prevent.

---

## 5. The badge

`ColourWorkBadge` + `isColourWorkBadged` in `components/picking/card-atoms.tsx`, beside `AgeBadge`
and `SmuBadge`.

**Geometry is SmuBadge's, copied:** `text-[11px] font-bold px-2 py-[3px] rounded-full shrink-0
whitespace-nowrap`, with `tabular-nums` dropped (no digits) and `tracking-[0.04em]` added — the one
thing an all-caps word needs that a two-digit number does not.

**Colours are copied from `components/floor/status-pill.tsx`'s `META`, with the source named in a
comment. No new Tailwind family, no new token file:**

- `TINT` → `bg-[#db2777] text-white` (Floor's `tinting` pill, the one solid fill)
- `BASE` → `bg-[#fce7f3] text-[#be185d]` (Floor's `tintAssigned` fill)

Copied rather than imported because those values live inside a Floor-private `META` object keyed by
Floor's own status union — nothing importable exists. **If Floor's pinks change, re-copy these.**
Violet was unavailable (Orbit's action colour) and `tint-*` is blue, which `status-pill.tsx`'s own
note explains.

**BASE's border was dropped in commit 3** (`#fbcfe8`, Floor's `tintDone` edge). A 1px border made
BASE **2px taller than TINT**, and the two sit one card apart in the same list, so the words did not
line up. The pale fill reads as a pill without help at this size; `AgeBadge` already mixes bordered
and borderless tiers.

**`onRed` (commit 3) — the duplicate-SO treatment.** Both pinks die on that card's solid `#dc2626`
fill (`#db2777` is barely a shape; `#fce7f3` reads as a second, paler alarm), so on such a card the
badge takes `border border-white text-white`: transparent fill, white edge, white word, same size.
**No new colour.** It spends the colour coding and keeps the WORD — the same trade `bill-symbols.tsx`'s
`tone()` makes for its glyphs and `AgeBadge` makes for its whole scale. The prop is optional and
defaults **false**, so Floor's three call sites are byte-identical: Floor's duplicate treatment is
`soft`, which has no red fill to survive. Consequence: on a red card TINT and BASE are the same
colour and size, told apart only by the word — correct there, where the instruction is "open both
bills and check".

### The left caption, not `captionRight`

The word sits in the **left caption, immediately after the `OBD · time` text** and before the Done-
Checked band's bare SMU number. One inserted element covers **all five `PickingCard` variants**
because that caption block is variant-independent — and the fact is too.

🔴 **`captionRight` could not have carried it.** It is already full on four of five variants: `assign`
holds ★ ⚡ + the "released" chip + `AgeBadge`; `assignLocked` holds ★ + `UpcomingDayBadge`; `picking`
and `doneCheck` each hold their elapsed pill from `checkCardPill()`; only `doneChecked` is empty.
`captionRight` is untouched on every variant — the only lines removed from those clusters were the
two 🎨 spans.

### Every surface changed

| Surface | Before → after |
|---|---|
| `PickingCard` ×5 variants (`picking-board-mobile.tsx`) | 🎨 in `captionRight` on two variants → the word in the left caption on all five |
| picker card (`picker-my-picks-board.tsx`) | nothing → the word after the OBD (that caption has no `· time` — DIVERGENCE 2) |
| both detail headers (`bill-symbols.tsx`) | 🎨 → the badge, in place; `TINT_COLOR` removed with it |
| `floor/floor-table.tsx`, `hold-tab.tsx`, `cancelled-tab.tsx` | `Droplet` → the badge, keeping its `ml-1` |
| `floor/detail-panel.tsx` | the `Droplet + "Tint"` chip → the badge (**not in the brief's list; found and included**) |
| `floor/detail-details.tsx` | `Tinting: Yes/No` → `Tinted` / `Base — no tint` / `—` |

`hasBillSymbols`'s `isTint` term had to move with the mark, not just the render: it is now
`isColourWorkBadged(colourWork)`. There is one live tint bill outside the two divisions (a Deco Retail
bill imported as Z007), and it would otherwise have made that gate true while the badge rendered
nothing — leaving both callers drawing a separator in front of an empty run.

### 🔴 LINE-LEVEL TINT MARKS ARE A DIFFERENT FACT AND WERE LEFT ALONE

`components/floor/detail-items.tsx` (a dot per line) and
`components/billing/billing-order-detail-panel.tsx` mark **one line** via `isTinting` — "this line is
a tintable product" — which is not the same question as "was a colour mixed for this bill". They were
deliberately not touched and must not be "harmonised". `git diff --stat` on both is empty.

`app/(mail-orders)/mail-orders/review-view.tsx`'s `Droplet` is the **volume** icon. A grep for
`Droplet` hits it; it has nothing to do with tint.

---

## 6. 🔴 THE `LC_ALL=C grep` RULE — a fourth shape of CORE's grep trap

Verifying "no 🎨 remains", the first sweep returned **NONE** and it was a **false clean**. The emoji
was demonstrably in the file (`od -c` shows `360 237 216 250` = `F0 9F 8E A8`). Both of these matched
nothing:

```bash
grep -rn -f <(printf '\xf0\x9f\x8e\xa8') …     # returns nothing
grep -rnP '\xf0\x9f\x8e\xa8' …                  # returns nothing
```

**The one that works:**

```bash
LC_ALL=C grep -rn "$(printf '\xf0\x9f\x8e\xa8')" components app lib --include=*.tsx --include=*.ts
```

**The rule for canon:** a multibyte pattern (emoji, `—`, `·`, `₹`, any non-ASCII glyph) cannot be
trusted to `grep` in this Git Bash without `LC_ALL=C`, and a clean result must be re-run a second way
and reconciled. This is the **fourth** shape of the trap CORE §13 / the retirement playbook already
record for slashes in search terms: the first three were the slash rewrite, `href=`-only sweeps, and
word-boundary overmatching. Same lesson — **an empty result is a claim, not a fact.**

**What actually remains (reconciled, `LC_ALL=C`):**

- **Zero rendered 🎨 on any live surface.**
- Six occurrences in explanatory comments written this session: `bill-symbols.tsx` ×3,
  `card-atoms.tsx` ×1, `picking-board-mobile.tsx` ×2.
- `app/po2/v2-manifest.ts` — a pre-existing comment about colours, unrelated.
- `components/shared/order-detail-panel.tsx:261` — a **rendered** 🎨, as a per-**LINE** column header.
  ⚠ **That file is RETIRED with zero live importers** (verified: the three other hits are comments in
  other files saying so; `CLAUDE_TINT.md §1` records its retirement in the 2026-09-05/06 board
  rebuild). Doubly out of scope: retired file, line-level fact. It is a candidate for
  `archive/RETIREMENT-PLAYBOOK.md`, not for an edit.

---

## 7. The feed and its marker

| | |
|---|---|
| Feed | `GET /api/picking/tint-workload` |
| Marker | `GET /api/picking/tint-workload/marker` |
| Logic | `lib/picking/tint-workload.ts` — `getTintWorkload()`, `getTintWorkloadMarker()` |

**Gate: `picking` canView on both.** It is the only tick the whole floor team shares — **all 6 active
floor supervisors and all 12 active pickers hold it**, zero missing rows (one test account in each
group), and **not one of them holds `tint_manager`, `tint_operator` or `floor`**. That is why neither
existing feed could be reused: `/api/tint/manager/orders` would have meant granting the floor the
Tint Manager board and its writes, `/api/floor/board` the desk screen.

**Roster-seeded, like `/api/warehouse/pickers` and deliberately UNLIKE the picker list directly above
it on the same tab.** Every active tint operator appears even with nothing on him ("Free"); the picker
list only lists a picker because a bill put him there. An operator with no work is a fact; an absent
card reads as "no such operator". Operators are identified exactly as
`/api/tint/manager/operators` does — `isActive` **plus** the `tint_operator` role through
`user_roles`, never `users.roleId`.

🔴 **The Base — No Tint placeholder (users id 54) needs no special case and does not get one.** It is
`isActive: false` **and** carries **zero** `user_roles` rows, so it fails both halves of the roster
test (live: ids 22 and 23 in, 54 out). An id-based filter would hide a real operator the day ids
shift. (It does hold 5 `user_page_access` rows, all false — so `lib/tint/base-operator.ts`'s comment
saying "no user_page_access rows" is stale in that one clause.)

**Scope:** bills at `pending_tint_assignment` / `tint_assigned` / `tinting_in_progress`, `orderType
"tint"`, `isRemoved: false`. The three stages are **written out, not derived from rank** — ranks
20-40 happen to be these today, and a rank filter would silently absorb a future mid-pipeline stage
into "this bill is in the tint room" (the same argument `lib/floor/queries.ts` makes for its own
three).

### The four state wordings and their exact sources

| State | Wording | Source |
|---|---|---|
| `tinting` | `tinting · 42 min` | `computeElapsedMs()` (`lib/tint/elapsed-time.ts`). 🔴 **NEVER `startedAt` alone** — resume resets that column (`TINT §5`), so a job paused an hour and resumed would read 0 min. The helper folds `accumulatedMinutes` back in |
| `queued` | `in queue · 2nd` | rank **RECOMPUTED per operator** on `[sequenceOrder asc, createdAt asc]` — the ORDER BY the reorder route swaps on, the same ranking `components/tint/manager/rows.ts` does. 🔴 **Never `orders.sequenceOrder` itself**: it is a sparse `MAX+1` usually still at its `0` default, so it ORDERS but does not COUNT, and printing it would show "7th" to a man holding two bills |
| `paused` | `paused · 18 min so far` | `accumulatedMinutes`, as **time SPENT**. 🔴 **NOT how much of the bill is done** — that is `currentProgress`, a per-SKU JSONB snapshot no screen reads (`TINT §14`), and it is deliberately **not returned** so "18 min so far" can never be read as "18% done" |
| `waiting` | `waiting · 4h` | whole hours since `orderDateTime ?? obdEmailDate ?? createdAt`, **floored**. ⚠ A SQL cross-check using `round()` read 14h where the loader read 13h — floor is right for an age: at 13h40m, "14h" claims more than has happened, and `shortElapsed` in `floor-table.tsx` floors for the same reason |

**Drums** are the **D count off the order-level article tag**, through the shared `parseArticleTag` —
the same figure Floor's ARTICLE column shows. No line quantities are counted. A **null tag
contributes nothing rather than zero** (~27% of SAP codes are unmastered), so a drum total can
under-report and that is the deliberate direction, matching `lib/floor/format.ts`.

**Splits: a split bill is counted ONCE** and attributed to the operator holding its **most advanced**
split (in progress first, then lowest `sequenceOrder`, then earliest `createdAt`). `splitCount` and
`splitOperatorNames` carry the rest, so a UI can say "split across 2" without the bill sitting in two
buckets and doubling totals that are the **parent's** litres and drums. Legacy shape only: the Create
Split UI went in the 2026-09-05/06 rebuild and `splits/create` has had no caller since (`TINT §1.11`),
so no new split can be made and none is live.

**No hide exclusion**, following the surface it feeds: `lib/picking/queue.ts` makes zero
`getHideExclusion()` calls by standing per-surface decision (`CORE §13` / `PICKING §7`). Consequence:
an admin-hidden tint bill shows in this section and **not** on the Tint Manager board. Recorded in the
module so it is not discovered later as an inconsistency.

**The pool fallback:** a bill at an assigned stage with **no live assignment row** is attributed to
the **pool** with state `waiting`. Data-inconsistent (the stage says somebody has it, no row says
who), none live, and the pool is the honest place because the actionable truth is "this needs an
operator". It also keeps the invariant the section's totals rest on: **`totals = pool + operators`**.

**The deactivated-operator card:** a bill held by somebody off the roster gets a card of its own,
`id: -1`, named **"No longer an operator"**. Reachable when an operator is deactivated while still
holding work — his bills keep his FK and `isActive: false` takes him off the roster. Without it,
`pool + operators` would silently be short of `totals`.

**`billToByObd` is now EXPORTED from `lib/floor/queries.ts`** (body untouched). It was module-private
while Floor was its only caller, though the note at the end of Floor's rail section already claimed it
was exported; this feed shows the same "billed to {dealer}" line, and one read of that column beats a
second copy.

### Live output at build time (2026-09-18, ~00:20 IST)

```
totals: 2 bills · 11 D · 220 L
pool:   1 bill · 1 D · 20 L · oldest wait 13h
  9109525928  Ambe Angel Villa  SMU 77  20 L  1 D  waiting · 13h
              Bharuch · Upcountry · billed to EZZY INDUSTRIAL SOLUTIONS
Deepak Vasava (22)      1 bill · 10 D · 200 L · 1 in queue
  9109588952  SUN SATTVAM       SMU 74  200 L 10 D  in queue · 1st
Chandrasing Valvi (23)  Free
```

Cross-checked against straight SQL: 2 bills, 220 L, tags `1 Drum` / `10 Drum` → 11 D. Invariants all
true: `2 = 1 + 1`, no bill in two buckets, `11 = 1 + 10`, `220 = 20 + 200`.

---

## 8. 🔴 THE MARKER BUG — and the rule it produces

**Commit 4 shipped a marker that could never have fired on a pause.** It returned:

```json
{ "count": 2, "latestOrder": "…", "latestAssignment": "…" }
```

`lib/hooks/use-picking-marker.ts` compares **exactly four field names** — `count`, `latest`,
`heldBack`, `heldBackTrucks`. It never reads `latestOrder` or `latestAssignment`. So `latest` was
`undefined` on every probe, `undefined === undefined` on both sides of the comparison, and **only
`count` was live**: a pause moves neither the count nor the order clock, so the one state the second
clock was added to catch still fired nothing.

**The bug the second clock existed to prevent, reintroduced one field name later.** Fixed in
`e2446c70`: `latest` is now the **later of the two** ISO strings (they sort lexicographically, so no
`Date` is constructed), and both clocks ride along for a human reading the response.

> ### THE RULE FOR CANON
> **A MARKER PAYLOAD IS A CONTRACT WITH `use-picking-marker`'S FOUR FIELD NAMES:** `count`,
> `latest`, `heldBack`, `heldBackTrucks`. **A new marker route MUST return `count` and `latest`.**
> A field the hook does not read cannot make anything refetch, and the failure is SILENT — the poll
> runs all day, the values look sensible in the response, and nothing ever refreshes. Extra fields
> are free; renaming `latest` away, or splitting it into two clocks, disables the marker.
>
> **And the companion rule:** a marker must watch **every table whose writes change what its board
> shows.** Pause and resume write **only** the assignment row — zero `orders.update` calls in
> `app/api/tint/operator/pause/route.ts` and `resume/route.ts` — so any marker built on
> `MAX(orders.updatedAt)` alone is blind to a pause.

⚠ **`/api/tint/manager/marker` STILL HAS THAT BLIND SPOT** — it aggregates `MAX(orders.updatedAt)`
only, so the Tint Manager's own board does not refresh on a pause or a resume. It was read while this
work was done and **deliberately not copied**; fixing it belongs to that module. → ROADMAP.

**Verified live:** `{ count: 2, latest: "2026-09-17T13:22:22.077Z" (the order clock),
latestAssignment: "2026-09-17T12:53:25.071Z" }`. A pause now would push the assignment clock past the
order clock and move `latest`.

---

## 9. The Tinting section

**Mount point:** inside the `activeTab === "picking"` block of
`components/picking/picking-board-mobile.tsx`, as a sibling conditional **after the level-1 picker
list and before the Bill-view list**. Full gate:

```
!loading && !error && tintWork !== null && tintWork.totals.bills > 0
  && pickingView === "picker" && openPickerId === null && openTintId === null
```

**The heading is the Upcoming-zone heading verbatim** — `flex items-center gap-1.5 text-[11.5px]
font-semibold uppercase tracking-wider text-gray-400 mt-[22px] mb-2 px-[2px] pt-[14px] border-t
border-gray-200` — only the words differ: `TINTING · 2 · 11 D · 220 L`.

**Two gates were widened, and they are the only existing conditionals touched:**

1. the picker list gained `&& openTintId === null`;
2. the type-pills / summary row's existing level-2 hide became `openPickerId !== null || openTintId
   !== null`.

Both are the mutual exclusion the design asks for — a tab-wide section under a one-man header answers
a question nobody asked. **The filter state is untouched while hidden** (`checkTypeFilter` and
`pickingView` keep their values), which is the rule the existing note beside it records.

**`openTintId: number | "pool" | null`** is the whole tap-through: the same in-place swap
`openPickerId` performs, own `ChevronLeft` back control, no router push, no history entry — so Android
back leaves the module from here exactly as it already does from a picker's level 2.

**The bucket is re-resolved off `tintWork` on every render, never snapshotted at tap time.** A refetch
that empties an operator therefore renders the empty line with the back control still live, instead of
navigating out from under a thumb — the rule the picker's own level 2 documents.

**"View ›" is a two-part jump, and it has to be.** The shell switches the tab (it owns `activeTab`)
and bumps `tintJumpNonce`; the board scrolls its `tintSectionRef` when that nonce moves. **The section
does not exist in the DOM until the tab change has rendered**, so the scroll cannot be in the same
call as the tab switch. The effect fires only when the nonce moves and only on the Picking tab, and it
resets both level-2 states so the jump always lands on the card list.

**The Assign strip:** one `border-t` line directly under the existing summary strip, `mx-[-16px]`,
same padding and type, `#fce7f3` ground / `#fbcfe8` border / `#be185d` text — the pair `card-atoms.tsx`
already copied from `status-pill.tsx`. Its own strip **below** the summary, never folded into it: the
summary is "what the filters currently show", and these bills are not in that list at all.

### 🔴 Why the level-2 bills are `TintBillRow` and not `PickingCard`

`PickingCard` takes a full `PickingQueueRow` — **forty fields, a required `onOpen`, and five variants
that all either select or open a detail screen** — and the feed returns `TintWorkloadBill`, a
different shape by design. Passing one would have meant **fabricating a row with a fake numeric id in
the same key space as real orders** (the trap `PickingDetailLine`'s hardener note already records) or
widening the card; both were ruled out. `TintBillRow` therefore reuses the card's **shell** and its
`CLAUDE_UI.md §60` type tokens and renders the bill's own four lines — OBD · time + `SmuBadge`, site,
route + litres, "billed to", then drums and the state — as a `div` with **no tap target anywhere**.

**`TintCard` (the operator/pool card) IS the picker card's markup** with different words in it: same
button classes, same `CARD_SHADOW_V2`, same 16.5px/600 name, same 13px/600 tabular counts row with
muted units and `·` separators, same 12.5px third line the picker card gives its routes. No size,
colour, radius or spacing was taken from the mockup, and `PickingCard` gained no variant.

**A free operator's card is a `div`, not a `button`** — a button that opens nothing is a control that
lies. The "billed to" line uses the caption token (11.5px `#98a2b3`) because the picker card has no
such line; staying inside the picking module's own scale beat importing Floor's.

**No TINT word on cards inside this section** — every bill there is a tint bill, so the word would be
on all of them.

**The Local / UPC pills deliberately do NOT filter the section.** The feed's per-operator bills, drums
and litres are server-computed (drums skip an untagged bill rather than counting it as zero), so
filtering would mean re-aggregating all three client-side — recomputing the figures the feed exists to
own. The pills keep narrowing the picker list above, as they always have. → ROADMAP.

### Proofs

- **Five removed lines in total** across both components: the context destructure, the context memo
  and its deps, and the two render gates. `git diff` shows no other `-` line, so the picker card, the
  filter strip, both summary strips, the tab bar, `card-atoms.tsx`, `picker-my-picks-board.tsx` and
  `app/picking/page.tsx` are byte-identical.
- **The Assign badge is computed from exactly the same rows as before** — the `workflowTabs` memo
  produces **no diff lines at all**; still `data.rows.filter(r => !r.isAssigned && !r.isDone &&
  !r.isChecked && r.zone === "due")`.
- **Nothing from the feed enters the picking data.** It lands on its own state, never in `data`, so
  the three tab badges, the Assign badge, the held-back band and `rowStatus` cannot see it.
- **The picker face never fetches it** — zero `tint` references inside `PickerPickingShell`, and both
  call sites are in `SupervisorPickingShell`. His face has no Picking tab (`PICKER_TAB_KEYS`), so the
  section is unreachable there by construction, not by a flag.
- **Two marker instances on one screen are safe** — every field in `usePickingMarker` is a
  per-instance ref. Both pause on the same `detailOpen || overlayBusy`.

### Empty cases

| Case | What renders |
|---|---|
| No tint work at all (`totals.bills === 0`), **or the fetch failed, or it has not landed** (`tintWork === null`) | Nothing: no heading, no cards, no footnote, no Assign strip. The tab is the board it has always been. This is every failure mode — the fetch is silent by design |
| Pool empty, operators busy | The pool card is skipped entirely (no "nothing waiting" placeholder); operator cards carry the section |
| All operators free | Each renders "Free" with no counts and no state line, with the pool card above if anything waits. Nothing waiting **and** everyone free means `totals.bills === 0`, so the section is gone — the two cannot disagree |
| An operator emptied while his level 2 is open | "Nothing in the tint room for this card", back control still live |

---

## 10. The open permissions question — decision pending from Smart Flow

**A picker can fetch `/api/picking/tint-workload`.** The gate is `picking` canView, and every picker
holds it. His face never renders the section, so this is reachable only by typing the URL.

**The only new fact it exposes to him is how long a named colleague has been on a job** — "tinting ·
42 min", "paused · 18 min so far". Everything else in the payload (dealer and site names, routes,
litres, drums) he already sees on his own board. There is no cost, no contact detail and no money in
it.

It sits on `picking` canView **because that is the only tick the whole floor group shares** — all 18
active supervisor/picker accounts hold it, and none holds a tint or floor key. Narrowing it would need
a new page key that nobody holds yet, which is a permissions decision rather than a route detail.
**Owner call outstanding.** → ROADMAP.

---

## 11. What is NOT verified

- 🔴 **Every screen claim in this document is unverified.** Claude Code has no login (`CORE`), so
  nothing here has been seen rendered — not the badge on any card, not the section, not the strip.
- **A paused bill inside the feed.** There is no paused bill in the tint room right now; the only
  live `paused` row sits on a **cancelled** bill (9109519819, 45 accumulated minutes) and is correctly
  excluded. The math was exercised against that real row without writing — `computeElapsedMs` returns
  **45 min so far** — but a paused bill has never been seen *in* the feed.
- **The marker firing on a pause, end to end.** Proven by construction only: zero `orders.update` in
  the pause/resume routes, `tint_assignments.updatedAt` carries `@updatedAt`, and the two clocks are
  demonstrably different values right now. A search for a historical pause whose order row is older
  than the pause returned **zero rows** — every paused bill later took order-row writes — so live
  history cannot isolate it without a write, and none was made.
- **The route called as a picker.** `checkAnyPermission` resolves the **session's** user id, not the
  roles passed to it, so the gate cannot be simulated from a script. The underlying
  `user_page_access` rows are SELECT-verified; the HTTP call is not.
- **No automated test covers any of this**, in line with the rest of the module.

---

## 12. Login checklist for Smart Flow

Live OBDs, all current as of 2026-09-18:

1. **Assign tab — the word.** `TINT` on 9109529395, 9109532369, 9109554159 (74) and 9109380872 (77);
   `BASE` on 9109525927 and 9109571833. Check it sits after the time, that the time truncates before
   the word, and that the dealer name below has not moved.
2. **Done → Checked band.** 9109504028 and 9109535717 are the two **bypassed** bills on the board;
   they must read **BASE**. They wore 🎨 before this change — this is the bug being fixed. Also check
   the bare SMU number still renders after the word on that band only.
3. **Picking tab + a picker's level 2.** The word in the caption, the elapsed pill still alone on the
   right.
4. **The picker's My Picks** (needs a picker login or `?view=picker&as=<id>`): the same word on his
   card, Pending and Done.
5. **Both detail headers** — the word where the 🎨 was, and the run's separator still correct.
6. **A duplicate-SO card** — 9109496488 (77) or 9107512409 (74), both on the Done tab. On `/picking`
   that card is a solid red fill: judge the white outlined word on it. On `/floor` the treatment is
   `soft`, so it should look ordinary.
7. **Deco Retail bills show no word at all** — the ~90% case, and the one that proves the silence.
8. **`/floor`** — the board table's Ship-to cell, Hold tab, Cancelled tab, the detail panel's chip row
   and the Details tab's "Tinting" row now reading `Tinted` / `Base — no tint` / `—`. The table is the
   densest of these: a pill where a 12px droplet was is the biggest visual change in the work.
9. **The Tinting section.** Heading `TINTING · 2 · 11 D · 220 L`; pool card first (9109525928,
   `oldest waiting 13h`); then Deepak Vasava (`1 in queue`); then Chandrasing Valvi (`Free`, not
   tappable).
10. **Tap Deepak** → his one bill (9109588952, `in queue · 1st`), back chevron works, type pills and
    summary strip gone, nothing on the bill responds to a tap. Back → pills and strip return with the
    same filter.
11. **Mutual exclusion** — open a picker's level 2 and confirm the tint section vanishes; open a tint
    operator's bills and confirm the picker list vanishes.
12. **The Assign strip** — the pink "Tinting now · 2 bills · 11 D · 220 L · View ›" under the grey
    summary strip; "View ›" lands on the Picking tab scrolled to the section.
13. **The empty state** — when the room clears, the section and the pink line disappear completely,
    leaving no heading.
14. 🔴 **THE PAUSE TEST — the one thing no read-only check can prove.** Have Deepak start a job, then
    pause it. Within ~15 s the operator card should read **`paused · N min so far`** with no reload,
    and the section should keep updating. If it does not, the marker is the place to look — that path
    is code-proven and screen-unproven.

---

## For consolidation

### `CLAUDE_CORE.md`
- **§13 — the `LC_ALL=C` grep rule** (§6 above), as the fourth shape of the existing grep trap. This
  is the most portable lesson in the session.
- **§3 or §13 — the marker-payload contract** (§8): `use-picking-marker` compares `count` / `latest` /
  `heldBack` / `heldBackTrucks` and nothing else; a new marker must return `latest`, and a marker must
  watch every table whose writes change its board — pause/resume never touch `orders`.
- **§13** — `lib/tint/base-operator.ts`'s "no `user_page_access` rows" clause is stale: it has 5, all
  false. The double exclusion that matters (`isActive: false` + zero `user_roles`) is intact.

### `CLAUDE_PICKING.md`
- `colourWork`: the rule, the file split, the `tinting_done` key, the 93/150/1,571 counts and the
  "~10 BASE bills a day" consequence.
- The badge: §5 above in full, including that `captionRight` was full on four of five variants and
  that line-level marks are a different fact.
- A new section for the Tinting feed + section (§7 and §9), including the four state wordings and
  their sources.
- §10 gains the second marker instance and the contract rule.
- §5.2's SMU-badge note: `isSmuBadged` now delegates to `isProjectSmu`; `SMU_BADGE_STYLE` is typed on
  the union. The note's "flag-row guard" clause is already stale — the flag row became `BillSymbols`
  on 2026-08-22.

### `CLAUDE_TINT.md`
- The Base — No Tint bypass finally has a downstream consumer: `colourWork` is what makes a bypassed
  bill readable on the floor. (The 2026-09-06 draft's "CLAUDE_TINT.md should gain a section" item is
  still owed, and this is now part of it.)
- §1.9: the manager marker's pause blind spot, flagged not fixed.
- §1.3/§2's "done writes `pending_support`, or `pending_picking` on a pre-set slot" is stale — since
  `b3dfe5b8` (2026-09-11) it is `pending_picking` unless the bill is **held**.
- §13.1's `tint_manager` canView holders omit Deepanshu Thakur (live).

### `CLAUDE_FLOOR.md`
- The four bill-level tint marks are now the word; `detail-details.tsx`'s Tinting row reads the kind.
- `billToByObd` is exported.
- ⚠ **This file is v1.4 (2026-08-04) and has fallen a long way behind the code.** It has never heard
  of the **Tinting tab**, `tintPhase`, `tintPhaseOf()`, the **four pink status pills**, `/api/floor/
  tint-operators`, **trips / the trip desk**, the per-trip visibility gate, or the rail-feed deletion
  of 2026-09-13. It needs its own catch-up pass — wider than this merge.

### `CLAUDE_UI.md`
- `ColourWorkBadge` beside `AgeBadge`/`SmuBadge` in the card-atoms inventory: geometry, the two pinks
  with their `status-pill.tsx` provenance, the `onRed` white-outline state, and that BASE carries no
  border so the two words match in height.
- §62: the word's position in the left caption; the pink Assign strip; the Tinting section's reuse of
  the Upcoming heading.

### To `ROADMAP.md`, NOT canon
- **Fix `/api/tint/manager/marker`** — add `MAX(tint_assignments.updatedAt)` so the Tint Manager board
  refreshes on a pause or resume. Known, flagged, deliberately untouched.
- **The permissions decision** (§10): leave the feed on `picking` canView, or mint a tick that
  excludes pickers.
- **Local / UPC filtering of the Tinting section** — needs the feed to return per-delivery-type
  aggregates, or the client to re-aggregate (rejected here).
- **Archive `components/shared/order-detail-panel.tsx`** via `archive/RETIREMENT-PLAYBOOK.md` — zero
  live importers, and it still renders a per-line 🎨.
- **Tint Manager History view** — still deferred from the 2026-09-06 session, untouched here.

---

## The mockup

**The approved design is `docs/mockups/picking-tint/picking-tint-base-mockup-v8.html` — and it is NOT
IN THE REPO.** The file exists on the dev machine at that path but is **untracked** (`git ls-files
docs/mockups/picking-tint/` returns nothing), so every design reference in this draft points at a file
a reader cannot open from a clone. **Smart Flow still has to add it** — that folder is created by
committing the file, which is why it was not created empty here.

For the record, what the build took from it: structure, the four state wordings, the section's card
order, and the "Read only — these bills reach Assign when tinting is finished" line. **No class, size,
colour, radius or spacing was copied from it** — the built picker card was the design, on instruction.
Two places where the mockup and the shipped code differ, code winning both times:

- it names the badge **`BillKindBadge`**; the shipped atom is **`ColourWorkBadge`** (named by meaning,
  per the build instruction, because `tint-*` is sky blue);
- its sample data shows **9109554159 as BASE**; that bill was tinted by a real operator and correctly
  renders **TINT**. The mockup's labels are illustrative — the field is computed.

---

*OrbitOMS · shipped and pushed 2026-09-17/18 · commits `ba03fc89` → `e2446c70` · every screen claim
awaits Smart Flow's hand-verification (§11/§12)*
