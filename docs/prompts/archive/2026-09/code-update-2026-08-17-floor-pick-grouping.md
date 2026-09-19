# code-update-2026-08-17 — Floor Control: the By-group view

**Status: SHIPPED.** Commit `3e989cb5`, pushed to `origin/main` 2026-08-17.
This is a RECORD for a later consolidation pass. No canonical `CLAUDE_*.md` file was
edited in the session that produced it.

---

## 1. What shipped

A **fourth view chip** on the Floor tab — `Flat / By route / By picker / By group` — that
shows WAITING bills only, bundled so one picker fetches shared material once.

Eight files, all under `lib/floor/` and `components/floor/`:

| File | Role |
|---|---|
| `lib/floor/grouping.ts` | **new** — the pure bundling engine |
| `lib/floor/types.ts` | `FloorWaitingSkus`, `PickGroupCandidate`, `PickGroup`; `waitingSkus` on `FloorBoardResult` |
| `lib/floor/queries.ts` | `skusByObd()` + one extra sequential read at the tail of `getFloorBoard` |
| `lib/floor/scope.ts` | `scopeBoard()` narrows `waitingSkus` alongside `rows` |
| `components/floor/group-row.tsx` | **new** — one bundle, route-row's expand/collapse mechanics |
| `components/floor/floor-board.tsx` | group branch, header strip, expand set, Live-strip counts |
| `components/floor/floor-page.tsx` | the chip, `viewForContext`, race-free `bulkAssign` |
| `components/floor/floor-table.tsx` | optional `showSlot` / `chipFor` props |

**Floor ONLY.** `/picking` and both mobile boards were deliberately out of scope and
nothing under `app/api/picking/`, `lib/picking/` or `components/picking/` was modified —
verified with `git status` on those three paths at commit time. Assign reuses
`POST /api/picking/assign` as a caller, unchanged: **a group of 4 is ONE existing call,
no API change, no new route, no schema change.**

---

## 2. The locked rule

> Two bills bundle only if one adds ZERO new `skuCodeRaw` to the other.
> Max 4 bills per group (1 main + 3 riders). `savedTrips` = sum of riders' distinct
> SKU counts. Exact `skuCodeRaw` only — never `skuId`, never `sku_master` (CORE §13).

**Deliberately EXCLUDED. Do not re-add any of these as an "improvement":**

- no dispatch-slot or date filter — groups span slots and days *on purpose*
- no route filter — route is displayed, never enforced
- no volume or quantity limit — litres are shown, the human decides
- no partial overlap, no percentage, no threshold
- no rarity or scarcity weighting
- **no persistence** — no table, no column, recomputed on every board load

---

## 3. The zero-SKU landmine

**An empty SKU set is a subset of every set.** A bill with no `lineStatus='active'` lines
therefore satisfies "adds zero new SKUs" against *every* main bill on the board, and would
ride free with the first one it met, on every load, telling the operator to fetch
something that does not exist.

Guarded explicitly as step 1 of `buildPickGroups` — such bills fall straight through to
`ungrouped`, never dropped silently. **It fired on live data on its first run:** of 8
waiting bills on 17 Aug, one had zero active lines.

Anyone rewriting or porting this function must re-add the guard. It is not defensive
padding; it is the difference between a useful bundle and a confident lie.

---

## 4. Determinism is load-bearing

The By-group view has **no live-sync pause of its own** (`CLAUDE_FLOOR.md §5` — the marker
is paused only on history / detail-open; an untouched board simply refetches). So a 15s
marker change re-runs `load()` and re-renders the bundles.

Therefore: **identical input must produce byte-identical groups.** Every sort in
`grouping.ts` ends on `obdNumber` as a total-order tie-break (`orders.obdNumber` is
`@unique`), with the locale pinned to `"en"` exactly as `lib/picking/sort.ts` pins it, so
the depot PC and Vercel cannot disagree. `waitingSkus` is de-duplicated and sorted at the
source for the same reason — a reshuffling input defeats a deterministic engine.

For *genuine* board changes the mitigation is different and also deliberate: expanded
groups persist in a `Set` keyed by the **main bill's `orderId`**, not by list position.
Keying on position would silently move the open group to whatever floated to the top. A
group whose main is gone simply disappears — no placeholder, no toast; a bill leaving the
board is correct behaviour and must stay visible as such.

**Do not "simplify" either mechanism.**

---

## 5. The CLAUDE_UI §10 ruling — several teals on screen at once

With a picker chosen, every group header carries a filled-teal **"Assign all {n} to
{name}"** button, so several filled teals can be on screen simultaneously. `CLAUDE_UI §10`
says one teal per surface.

**This was a deliberate reading, not an oversight.** A group row is its own surface with
one job, and a list of bundles is several *independent decisions* — not one primary action
with competitors. The §10 rule was minted for the detail panel's action row, where the
question is "which single button is the job right now". Recorded here so a future pass does
not "fix" it back to grey without knowing it was decided.

*(Flagged to Smart Flow at build time as a judgment call open to reversal — if it is toned
to an outline, do it as a decision, not as a bug fix.)*

---

## 6. Reachability — with the honest bound

Measured over 14 days, 5-minute samples, 08:00–20:00 IST (2,000 samples):

- **A group was available in 41.9% (lower bound) to 75.7% (upper bound) of samples.**
- Waiting-pool size, lower bound: **median 7**, p75 18, p90 21, max 42.
- Dwell at `pending_picking`: **median 23.5 min**, p75 196 min, **28% under 5 minutes**.
- Release bursts: 16.9/day, median 4 bills, biggest 35 — but three of the five biggest left
  a pool of 0 within a minute. Bursts do not create a standing pool.

The **2–3 waiting bills** that prompted the investigation was a single afternoon instant,
not the norm. The bound is wide for the reason in §10 below, and cannot be narrowed with
the data that exists today.

---

## 7. The rail question is CLOSED

Grouping the rail (undecided, pre-release) instead of the live board yields **241 groups
vs 234** for whole-day pooling — statistically no gain.

The reason is structural: **enrichment auto-dispatches bills to `pending_picking` in the
same second they are created** (the "Created via auto-import" and "Auto-dispatched by
enrichment" log rows share a timestamp to the second — verified on orders 10542, 10543,
12497). The rail therefore never holds anything long enough to be a pool. Any gain from
grouping comes from pooling across **time**, not from moving to a different **stage**.

**Do not revisit this as a new idea.** It has been measured.

---

## 8. The Live strip copy fix

`components/floor/floor-board.tsx` previously read:

> `everything not yet checked, whenever it was due`

That describes only **arm 1** of `floorLiveBaseWhere`. Arm 2 also puts everything **checked
today** on the board — on 17 Aug that was **97 of 104 rows**, so the copy promised a set a
fifteenth the size of the count beside it, and made a correct badge look broken.

Now reads **`{n} still open · {m} checked today`**, derived over the same `dueRows` the
Floor badge counts (so the two always sum to it), via the existing `countByStatus()` helper
in `status-pill.tsx` — four stage meanings, one owner. The green dot, "Live" label and
"History ›" are unchanged, and History keeps its own separate wording ("past day — read
only").

---

## 9. Stale in `docs/CLAUDE_FLOOR.md` — for the consolidation pass

Six findings from this session's read. **Not fixed here; the doc pass owns them.**

| # | Where | What is stale |
|---|---|---|
| 1 | header line 2 + footer | **Schema stamp reads `v27.13`** while `CLAUDE_CORE.md:2` reads **v27.15** and `CLAUDE_PICKING.md:2` reads **v27.15**. This is the one item that formally trips the router's §4 "stop and ask". |
| 2 | §2 | Names only two view pivots ("Flat/By-route"). There were three at read time (By picker landed 2026-08-11 and is the **default**), and four as of this commit. |
| 3 | §2 | Lists the slot tabs unconditionally. They are **hidden** in By picker, in the "what he's holding" reading, and now in By group (`floor-board.tsx` `showSlotTabs`). |
| 4 | §4.6 | Specs the assign bar as `[picker ▾][Assign]`. With `lockedPicker` set it renders a static **"To {name}"** label instead (`assign-bar.tsx:43, 135-137`) — recorded only in §11's file-index row, never in the section that owns the bar. |
| 5 | §5 | "the detail panel is open, **a selection is up**, History mode, or the tab is hidden" is true of the RAIL poll but **not the marker** — the marker pauses only on `!isLive \|\| detailOpen`; a selection re-routes `onChange` to `reconcileSelection()` instead of pausing. The "tab is hidden" term is not at the floor call site (may live inside `use-picking-marker` — unverified). |
| 6 | §3 / §4.6 | The whole 2026-08-11 assign-context mechanism (banner, pending/current narrowing, `openAssignContext`) exists only as prose in §11's file index; the sections owning the feeds and the action surfaces never mention it. Related: §11's picker-card row predates commit `4947bddc` (2026-08-15), which changed the card's stats to count `withPicker` rows only. |

**On the version stamp:** I could not find the "check BOTH ends of the file" rule stated in
`CLAUDE_CORE.md §12` (§12 is the Screens index). The practice is real but recorded
elsewhere — `CLAUDE_FLOOR.md`'s own change log (**FLR-5**: "the footer date-drift open item
fixed — version + date now at both ends") and `CLAUDE_CORE.md:1145` (v27.13 minting: "§7
heading, header and footer stamps updated"). Cite those, not §12.

---

## 10. For ROADMAP — not this feature

**1,093 waiting spells over 14 days have no observable exit.** No later `order_status_logs`
row, no `pick_assignments` row; the bills now sit at `workflowStage='dispatched'`, and
their `orders.updatedAt` values cluster on **nine dates** (08-03: 320, 08-08: 280, 08-06:
190, 08-13: 122, …).

That is the signature of **bulk sweeps, not per-bill exits**. Consequence: the board's own
history is **unreconstructable** — for 57% of spells there is no way to know when a bill
left the waiting pool. This is precisely why §6 is a bound rather than a measurement, and
no amount of care in the analysis can narrow it while the gap exists.

Related to the still-open **"no automatic drain `pick_checked` → `dispatched`"** gap owned
by `CLAUDE_PICKING.md §7`. Whatever writes `dispatched` in bulk is adjacent to that gap and
should be identified in the same session.

---

## 11. NOT verified

- **The two-groups-in-quick-succession race on the group Assign button was never tested.**
  Only one group existed on the board at build time, so the scenario the explicit-id fix
  exists for could not be exercised. The fix is in place — `bulkAssign(pickerId,
  explicitIds?)` resolves its targets from the passed ids and never reads `selection`
  state — but the behaviour is **unconfirmed on a real screen**. Test it by pressing
  "Assign all" on two different groups in quick succession and confirming the second press
  assigns the second group.
- **Nothing in this feature was seen rendered.** No login was available (the dev server
  307s to `/login`, and production credentials are deliberately not used), so every claim
  about layout, spacing, truncation and interaction is reasoned from code. The full
  hand-test list was handed to Smart Flow at build time; the assign path leads it.

---

*Record written 2026-08-17. Commit `3e989cb5`. Consolidation pass owns §9.*
