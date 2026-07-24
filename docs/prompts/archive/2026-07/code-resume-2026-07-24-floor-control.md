# Floor Control build — resume brief (v2)
**Date:** 24 July 2026
**Repo state:** main @ 34fad163 · **NOT PUSHED** (7 commits waiting)

This supersedes `code-resume-2026-07-23-floor-control.md`.

---

## How to use this file

Paste the contents of this file into a fresh Claude Code session as the
first message. Wait for it to confirm "All files read. Ready." before
giving it any task. Do not let it start work off this file alone.

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

Plus the Floor code already written:
```
lib/floor/types.ts
lib/floor/queries.ts
lib/floor/suggest.ts          (gated off — see Step 10)
lib/floor/selection.ts
app/api/floor/board/route.ts
app/api/floor/hold/route.ts
app/api/floor/cancelled/route.ts
app/api/floor/release/route.ts
app/api/floor/actions/route.ts
components/floor/*.tsx         (13 files)
lib/dispatch/dispatch-engine.ts
```

---

## Progress — build plan

- [x] **0. Dispatch engine Sunday fix** — `310d774c`
- [x] **1. Permissions + route + shell** — `d3c013dd`
- [x] **2. Data layer (4 read feeds)** — committed
- [x] **2b. One-time backlog cleanup** — SQL, done on live
- [x] **3. Left rail + card + tint strip + Release** — `93e47c9f`
- [x] **3b. Slot suggestion disabled** — `820a958a`
- [x] **4. Floor pane** — `2da09c3f`
- [x] **5. Selection + assignment bar + actions** — `34fad163`
- [ ] **6. Hold + Cancelled tabs + PDF export ← NEXT**
- [ ] 7. Detail panel
- [ ] 8. Search + filter
- [ ] 9. Live sync (two patterns)
- [ ] 10. Slot suggestion — re-enable and fix

All of Steps 0-5 are verified working on screen against live data.

---

## NEXT TASK — Step 6: Hold + Cancelled tabs + PDF

Builds the two non-Floor top tabs. Both are currently inert.

**Hold tab (design §8):** table grouped by how long each bill has been
held, bulk release bar (reuses the Support dispatch-slot-picker), and a
PDF preview/export with an "as on {date, time}" header and age-band counts.

**Cancelled tab:** table with bulk "Restore to decisions", which sends a
bill back to the left rail.

Both reuse the Step 5 actions route (`hold`, `cancel`, `restore`) and the
Step 3 release route. No new write paths.

### CARRIED DECISION — the `heldAt` problem (settled, do not re-open)

`orders.heldAt` is written as `obdEmailDate ?? now` — the bill's ARRIVAL
date, not the wall-clock moment of holding. This matches Support
(`app/api/support/orders/[id]/hold/route.ts:66`) and is documented as
intentional in CLAUDE_SUPPORT §4.9: Support anchors its amber hold
footprint to the arrival day.

Floor's §8 needs the opposite — how long a bill has been ON HOLD. Reading
`heldAt` would show a 3-week-old bill held 5 minutes ago as "21 days".

**Decision: do NOT change the write.** Flipping it to `now` would move the
amber Hold marker on Support's history board — a regression in a module we
are told not to touch — and would only half-fix Floor anyway.

**The fix goes on the READ side, in `getFloorHold()`:** derive "held since"
from the hold event's wall-clock `order_status_logs.createdAt`.

Two constraints on that:
1. Identify the hold event by the log NOTE, **not** by a sentinel
   `toStage`. A fake value in `toStage` pollutes the stage ladder and every
   future query that reads stages then has to know about a value that is
   not a stage. Define the note text as an exported constant shared by
   writer and reader — do not match a loose string.
2. Recognise BOTH the Floor's note and Support's hold note (Support does
   write a hold log — confirmed at `hold/route.ts:69-77`), so a bill held
   from Support groups correctly on the Floor. Re-verify this at the top of
   Step 6 and stop if it has changed.

---

## Open observations — noted, not yet actioned

1. **Assigned rows sink to the bottom.** The spine's `byAssigned` rule
   pushes assigned bills below unassigned ones. Correct for "what still
   needs a decision", but it buries a bill that has been with a picker 40
   minutes. Revisit after Steps 8-9 (search/filter and live sync may change
   how this feels). Do not change the spine unprompted.
2. **`Waiting` pills show no duration.** `FloorBoardRow` has no
   released/updated timestamp. Needs a `releasedAt` on the floor payload.
   Small follow-up, not yet scheduled.
3. **Ship-to original→redirect name pair** (§7.5) not rendered on the floor
   table — the floor payload carries only the effective dealer. The rail
   already gets both names (added in Step 3). Same follow-up as #2.
4. **Button copy** — the rail's no-suggestion button reads lowercase
   "pick slot"; mockup says "Set slot". The assign bar reads "Change slot"
   next to a "pick slot" button — two labels, one action. Cosmetic; goes
   with Step 10 polish.
5. **Possible duplicate bills** — four identical `Shree Rang Sarita` rows,
   all 22 Jul 18:31, all 140 L, different OBD numbers. Worth confirming
   they are genuinely separate bills. Not blocking.

---

## Decisions already made — do not re-litigate

**The left/right split (design §3 lines 59-73, §6.4 line 258):**
- A bill enrichment successfully slotted NEVER appears on the left rail. It
  appears on the right, carrying its stored `dispatchTargetDate` /
  `dispatchWindowId`.
- The left rail holds ONLY bills enrichment could not slot. Having no slot
  is precisely why they are there.

**Rail predicate (settled in Step 2):**
```
workflowStage IN (order_created, pending_tint_assignment, tint_assigned,
                  tinting_in_progress, pending_support)   -- rank < 60
AND dispatchStatus IS NULL
AND isRemoved = false
AND <getHideExclusion()>
```

**Slot suggestion is OFF and deferred to Step 10.** Every rail card renders
`[ pick slot ] [ Hold ] [ ✕ ]`. No teal Release button anywhere.
`lib/floor/suggest.ts` is intact but gated behind
`RAIL_SUGGESTIONS_ENABLED = false` in `lib/floor/queries.ts` — flipping that
one constant re-enables it.

Reason for deferring: the suggestion carried a stale-date bug (cards showed
"Release to Wed 16:00" on a Thursday, because the staleness check compared
clock time only, not the full date). Smart Flow chose to remove it rather
than patch it, and to revisit the whole suggestion rule after the workflow
has been used. **The fix, when Step 10 comes:** compare the full suggested
moment (date + time) against now, not minutes-since-midnight.

**The dispatch engine is LIVE and working**
(`lib/dispatch/dispatch-engine.ts`, wired into `applyMailOrderEnrichment()`
in `app/api/import/obd/route.ts`). Confirmed on live: 1045 rows
`dispatchSlotSource='auto'`, all six rules firing, all `smu='Deco Retail'`.
⚠ CORE §7.4, SUPPORT §4.13 and SUPPORT §12 all still say this is [NEXT].
**They are STALE.** Do not edit them in a build session — logged for the
next consolidation cycle.

**Engine scope — deliberately narrow:** fires only for `smu='Deco Retail'`.
Projects / Retail Offtake / Distributor never get a suggestion. Reviewed and
approved, not an oversight.

**Sunday:** fixed in the engine (Step 0). Next-day rolls off Sunday to
Monday. Saturday is a working day. Holidays are not modelled.

**Roles:** v1 access is **admin + operations only**. The `role_permissions`
grant HAS been run on live (both rows confirmed canView=t, canEdit=t).
`dispatch planner` and `telecaller` deferred.

**Header:** `/floor` deliberately does NOT use `UniversalHeader`. It is
hand-rolled to mockup `01-board.html`. Approved divergence from CLAUDE_UI
§6, logged for consolidation. Do not "fix" it back.

**Assignment reuses Picking unchanged.** Floor calls
`/api/picking/assign` and `/api/picking/unassign` as a caller. Do not fork,
do not modify `lib/picking/*`.

**`dispatchSlotSource: 'manual'`** is written on release and change-slot so
a later enrichment run cannot overwrite the operator's chosen slot.

**No per-row release button and no per-row slot picker on the floor table.**
He works in bulk (design §7.14).

**Other settled choices:**
- Litres: `querySnapshot.totalVolume` (Picking's source).
- Key dealer: `effectiveDealer.isKeyCustomer` via
  `shipToOverrideCustomer ?? customer`.
- Article tag: reuse `formatArticleTag` (live map is D/C/T/B — the mockup's
  DR/BX/TN are illustrative and wrong).
- SMU site set = `{"Retail Offtake", "Decorative Projects"}` — confirmed
  against live data.
- Gift lines: OUT OF SCOPE for v1. No identifier exists in the codebase.
  Do not invent a heuristic.
- No per-row Slot column on the All view — the band header carries it.
- Delivery type: from `effectiveDealer.area.deliveryType.name`.
- Dispatch window ids: resolve at runtime by `windowTime`. Never hardcode.
- Sort spine: reuse `lib/picking/sort.ts`. Do not copy it.
- Floor carry-over: carries over anything NOT `pick_checked`. A NEW scope —
  do not reuse or modify `lib/picking/queue.ts`'s WHERE.
- Live sync (Step 9): two different patterns, not one hook. Rail = Mail
  Orders 30s refetch. Floor = Picking 15s marker hook.
- Removed from scope per design §7.13: the stats line right of the slot
  tabs, any "pickers free" tile, any floor-idle alarm.

---

## Data work already done on live (do not repeat)

**23 July — one-time backlog cleanup.** 238 stale pending bills (goods had
physically gone out weeks earlier but were never recorded) were closed to
`workflowStage='dispatched'`, each with an `order_status_logs` row noting
the backfill. Bills newer than 2 days were left alone.

Result: rail went from 261 → 23. Support's pending backlog cleared by the
same amount. Two of the 238 were `tinting_in_progress` with open splits;
the splits were deliberately left alone.

---

## Parked issues (not blocking)

- **`Deco` (9 rows)** — un-mapped raw XLS SMU value leaking through one
  import path; should be `Deco Retail`. These bills silently never get an
  auto slot.
- **103 Deco Retail bills reached `pending_support` with `dispatchStatus`
  NULL** — the engine only fires when `dispatchStatus='dispatch'`, so these
  never got auto-slotted. Something upstream is not setting it. Worth a
  separate diagnosis session.
- **`dispatched` stage** — 1051 orders carry it. CLAUDE_PICKING says no
  write path to `dispatched` exists. That doc is wrong.
- **Stale docs for consolidation:** CORE §7.4, SUPPORT §4.13, SUPPORT §12
  (engine is built, not [NEXT]); CLAUDE_PICKING (the `dispatched`
  write-path claim); CLAUDE_UI §6 (needs the /floor header exception).

---

## Engineering rules — CORE §3

- No `prisma.$transaction`. Sequential awaits only.
- No `prisma db push`. Schema changes via Supabase SQL Editor, then
  `npx prisma generate`.
- `export const dynamic = 'force-dynamic'` on all API routes.
- `npx tsc --noEmit` clean before every commit.
- `git add` by explicit filename — never `git add .`
- Stop the dev server before any git operation.
- Commit directly to main. No feature branches.
- One `orders.update` per bill — a second write fires a false "changed" on
  every board's `updatedAt` live-sync marker.
- One `order_status_logs` row per bill per action.
- CORE §13: resolve catalog by `material === skuCodeRaw`, never via a
  sku id.

---

## Working pattern

One step at a time. Build it, show the verification, give the exact commit
command, then **WAIT** for Smart Flow's go before committing. Do not start
the next step unprompted.

Nothing is pushed. Deployment happens later, deliberately, in one go.
