# Floor Control build — resume brief
**Date:** 23 July 2026
**Repo state:** main @ 93e47c9f · **NOT PUSHED** (4 commits waiting)

---

## How to use this file

Paste the contents of this file into a fresh Claude Code session as the
first message, then wait for it to confirm before giving it any task.

---

## What is being built

`/floor` — Floor Control, a new module. It merges what Support and Picking
do for one person: the desk operator who decides which bills go to the
floor and watches what happens to them there.

**The design is LOCKED.** Sources of truth:
- Behaviour: `docs/prompts/drafts/web-update-2026-07-22-floor-control.md`
- Layout, spacing, copy: `docs/mockups/floor-control/01-board.html`,
  `02-detail-panel.html`, `03-slot-rule.html`, `04-card-spec.html`

Do not redesign. If something looks wrong, say so and stop.

**Nothing in Support or Picking is modified by this work.**

---

## Files to read at the start of the new session

```
CLAUDE.md (repo root)
docs/CLAUDE_CORE.md
docs/CLAUDE_UI.md
docs/CLAUDE_SUPPORT.md
docs/CLAUDE_PICKING.md
docs/CLAUDE_MAIL_ORDERS.md
docs/CLAUDE_IMPORT.md
docs/CLAUDE_TINT.md
docs/prompts/drafts/web-update-2026-07-22-floor-control.md
prisma/schema.prisma
docs/mockups/floor-control/*.html
```

Plus the code already written:
```
lib/floor/types.ts
lib/floor/queries.ts
lib/floor/suggest.ts
app/api/floor/board/route.ts
app/api/floor/hold/route.ts
app/api/floor/cancelled/route.ts
app/api/floor/release/route.ts
components/floor/*.tsx
lib/dispatch/dispatch-engine.ts
```

---

## Progress — 10-step build plan

- [x] **0. Dispatch engine Sunday fix** — commit `310d774c`
- [x] **1. Permissions + route + shell** — commit `d3c013dd`
- [x] **2. Data layer (4 read feeds + suggestion)** — commit (see log)
- [x] **2b. One-time backlog cleanup** — SQL, done on live
- [x] **3. Left rail + card + tint strip + Release** — commit `93e47c9f`
- [ ] **3b. BUG FIX — stale slot suggestion (see below) ← DO THIS NEXT**
- [ ] 4. Floor pane — slot bands, route rows, table, status pills
- [ ] 5. Assignment bar + spine + write actions
- [ ] 6. Hold + Cancelled tabs + PDF export
- [ ] 7. Detail panel
- [ ] 8. Search + filter
- [ ] 9. Live sync (two patterns)

---

## NEXT TASK — the stale-slot bug

**Found by eye on the live rail, 23 July.**

Today is Thursday 23 Jul. Rail cards for bills that arrived 22 Jul are
showing a teal button reading **"Release to Wed 16:00"** — yesterday.

**Cause:** the stale check in `lib/floor/suggest.ts` compares clock time
only, not the full date. A window that passed earlier *today* greys out
correctly. A window that passed on a *previous day* sails straight
through and is still offered.

**Impact:** pressing it stamps a `dispatchTargetDate` in the past. The
bill lands on a floor board for a day that has already gone and drops
straight into carry-over.

**Affects:** every carried-over card on the rail, which is most of them.

**Fix:** the stale comparison must be against a full timestamp (date +
time), not minutes-since-midnight. If the suggested slot moment is
earlier than "now", return `null` so the UI shows the grey Set slot
button.

**Constraints on the fix:**
- `lib/floor/suggest.ts` only. Do NOT change
  `lib/dispatch/dispatch-engine.ts` — the engine is correct; it is
  deterministic on arrival time and deliberately has no clock.
- The clock stays a passed-in argument. No `Date.now()` inside the
  function.
- Do not rewrite any stored value. Only the button changes.

---

## Two smaller items noted at the same time (not yet actioned)

1. **Button copy** — the no-suggestion button renders as lowercase
   "pick slot" (the reused Support `dispatch-slot-picker`'s own label).
   Mockup says **"Set slot"**. Cosmetic; deferred to polish.
2. **Possible duplicate bills** — four identical `Shree Rang Sarita`
   cards, all 22 Jul 18:31, all 140 L, different OBD numbers. Needs a
   look to confirm they are genuinely separate bills and not a duplicate
   import. Not blocking.

---

## Decisions already made — do not re-litigate

**The left/right split (design §3 lines 59-73, §6.4 line 258):**
- A bill enrichment successfully slotted NEVER appears on the left rail.
  It appears on the right, carrying its stored `dispatchTargetDate` /
  `dispatchWindowId`.
- The left rail holds ONLY bills enrichment could not slot. Having no
  slot is precisely why they are there.
- The rail's suggested slot is therefore a render-time computation
  against an EMPTY stored value. It is written only on Release.

**Rail predicate (settled in Step 2):**
```
workflowStage IN (order_created, pending_tint_assignment, tint_assigned,
                  tinting_in_progress, pending_support)   -- rank < 60
AND dispatchStatus IS NULL
AND isRemoved = false
AND <getHideExclusion()>
```

**The dispatch engine is LIVE and working** (`lib/dispatch/dispatch-engine.ts`,
wired into `applyMailOrderEnrichment()` in `app/api/import/obd/route.ts`).
Confirmed on live: 1045 rows `dispatchSlotSource='auto'`, all six rules
firing, all `smu='Deco Retail'`.
⚠ CORE §7.4, SUPPORT §4.13 and SUPPORT §12 all still say this is [NEXT],
not built. **They are STALE.** Do not edit them in a build session —
logged for the next consolidation cycle.

**Engine scope — deliberately kept narrow:** it only fires for
`smu = 'Deco Retail'`. Projects / Retail Offtake / Distributor never get
a suggestion; they land on the rail with a grey Set slot button and the
operator chooses. This was reviewed and approved, not an oversight.

**Sunday:** fixed in the engine (Step 0). Next-day rolls off Sunday to
Monday. Saturday is a working day. Holidays are not modelled.

**Roles:** v1 access is **admin + operations only**. The
`role_permissions` grant HAS been run on live (both rows confirmed
canView=t, canEdit=t). `dispatch planner` and `telecaller` are deferred.

**Header:** `/floor` deliberately does NOT use `UniversalHeader`. It is
hand-rolled to mockup `01-board.html` (title + date/time; scope chips +
search/filter). This is an approved divergence from CLAUDE_UI §6, logged
for consolidation. Do not "fix" it back.

**`dispatchSlotSource: 'manual'`** is written on release so a later
enrichment run cannot overwrite the operator's chosen slot. Intentional.

**Other settled choices:**
- Litres: `querySnapshot.totalVolume` (Picking's source), not
  `import_raw_summary.volume`.
- Key dealer: `effectiveDealer.isKeyCustomer` via
  `shipToOverrideCustomer ?? customer`.
- Article tag: reuse `formatArticleTag` (live map is D/C/T/B — the
  mockup's DR/BX/TN are illustrative and wrong).
- Gift lines: OUT OF SCOPE for v1. No identifier exists in the codebase.
  Do not invent a heuristic.
- Delivery type: from `effectiveDealer.area.deliveryType.name`.
- Dispatch window ids: resolve at runtime by `windowTime`. Never hardcode.
- Sort spine: reuse `lib/picking/sort.ts`. Do not copy it.
- Floor carry-over: carries over anything NOT `pick_checked`. This is a
  NEW scope — do not reuse or modify `lib/picking/queue.ts`'s WHERE.
- Live sync: two different patterns, not one hook. Rail = Mail Orders
  30s refetch. Floor = Picking 15s marker hook.

---

## Data work already done on live (do not repeat)

**23 July — one-time backlog cleanup.** 238 stale pending bills (goods
had physically gone out weeks earlier but were never recorded in the
system) were closed to `workflowStage = 'dispatched'`, each with an
`order_status_logs` row noting the backfill. Bills newer than 2 days
were left alone.

Result: rail went from 261 → 23. Support's pending backlog cleared by
the same amount.

Two of those 238 were `tinting_in_progress` with open splits. The splits
were deliberately left alone.

---

## Parked issues (not blocking the build)

- **`Deco` (9 rows)** — an un-mapped raw XLS SMU value leaking through
  one import path; should be `Deco Retail`. These bills silently never
  get an auto slot.
- **103 Deco Retail bills reached `pending_support` with
  `dispatchStatus` NULL** — the engine only fires when
  `dispatchStatus='dispatch'`, so these never got auto-slotted.
  Something upstream is not setting it. Worth a separate diagnosis
  session.
- **`dispatched` stage** — 1051 orders now carry it (813 predate the
  cleanup). CLAUDE_PICKING says no write path to `dispatched` exists.
  That doc is wrong. Logged for consolidation.
- **Stale docs to fix at consolidation:** CORE §7.4, SUPPORT §4.13,
  SUPPORT §12 (engine is built, not [NEXT]); CLAUDE_PICKING (the
  `dispatched` write-path claim); CLAUDE_UI §6 (needs the /floor header
  exception written in).

---

## Engineering rules — CORE §3

- No `prisma.$transaction`. Sequential awaits only.
- No `prisma db push`. Schema changes via Supabase SQL Editor, then
  `npx prisma generate`.
- `export const dynamic = 'force-dynamic'` on all API routes.
- `npx tsc --noEmit` clean before every commit.
- `git add` by explicit filename — never `git add .` (the repo carries
  unrelated untracked scratch files).
- Stop the dev server before any git operation.
- Commit directly to main. No feature branches.
- One `orders.update` per bill — a second write fires a false "changed"
  on every board's `updatedAt` live-sync marker.
- CORE §13: resolve catalog by `material === skuCodeRaw`, never via a
  sku id.

---

## Working pattern for this build

One step at a time. Build it, show the diff and the verification, give
the exact commit command, then **WAIT** for Smart Flow's go before
committing. Do not start the next step unprompted.

Nothing is pushed. Deployment happens later, deliberately, in one go.
