# Code update — Floor Control History gains a CHECKED arm

**Date:** 2026-08-25 · **Module:** Floor Control (`/floor`) · **Canon touched:** `docs/CLAUDE_FLOOR.md` §3
**File changed:** `lib/floor/queries.ts` (`getFloorBoard`, history branch only) — a WHERE-clause change, nothing else.

---

## 1. The defect

`getFloorBoard()` in history mode anchored on **one** date column:

```ts
dispatchTargetDate: anchorDate,
```

i.e. **"History for day D shows bills whose `dispatchTargetDate` is D"** — the day the bill was
*promised* to the customer. Nothing in the predicate asked when the floor actually *did the work*.

For a same-day bill the promise day and the completion day coincide and nobody notices. They come
apart the moment a bill is picked ahead of its dispatch date — and when they do, the bill falls
through **every** surface:

| Surface | Verdict | Why |
|---|---|---|
| Floor **live** board | dropped | `floorLiveBaseWhere` arm 1 excludes `pick_checked`; arm 2 fences `checkedAt` on **today**, and the check was yesterday |
| Floor **history**, day of the check | dropped | promised for a different day |
| Floor **history**, day of the promise | would match | **unreachable** — the stepper clamps at yesterday |
| `/picking`, all three faces | dropped | `scope=openPending` carries the identical two arms |
| Billing **Pending** | dropped | requires `invoiceNo IS NULL AND invoicedAt IS NULL`; both were set |

The floor finished the work and then could not see that it had.

## 2. The real bill that exposed it

```
obdNumber           9109086370
orders.id           13532
workflowStage       pick_checked
dispatchStatus      dispatch
dispatchTargetDate  2026-08-25
isRemoved / isHidden false / false
picker              46 (Akash Padvi)
picked_at           2026-08-24 13:04:05 UTC  = 18:34 IST, 24 Aug
checked_at          2026-08-24 13:04:29 UTC  = 18:34 IST, 24 Aug
pickEarlyReleasedAt 2026-08-24 12:28:26 UTC
invoiceNo           I536225898
invoicedAt          2026-08-24 13:06:52 UTC
```

Promised for the 25th, released early and finished on the evening of the 24th. The depot user went
looking for it in History → 24 August, where the work happened, and it was not there.

The only live surface that could show it at all was the **Billing Picking → Done strip** stepped to
24 Aug (it buckets on `invoicedAt`) — and that is pilot-gated to `operations` id 20, so the depot
floor user could not reach it.

## 3. The change

History for day D now matches **either** anchor, under one Prisma `OR`. The outer AND terms are
untouched.

```ts
dispatchStatus: "dispatch",
isRemoved: false,
workflowStage: { in: PICKING_ACTIVE_STAGES },
OR: [
  { dispatchTargetDate: anchorDate },
  {
    workflowStage: PICK_CHECKED,
    pickAssignment: { checkedAt: { gte: anchorRange.start, lt: anchorRange.end } },
  },
],
```

`anchorRange = getISTDayRange(anchorIso)` — the **same** helper (`lib/dates.ts:20`) the live arm's
range comes from, called with the viewed day instead of today. No second timezone convention was
invented; `getISTDayRange` already accepted an arbitrary `YYYY-MM-DD` and only defaults to today
when the argument is omitted.

`pick_assignments.checked_at` is `timestamp with time zone` in the live DB and is compared to JS
`Date` bounds, half-open `[start, end)` — character-for-character the shape the live arm at
`floorLiveBaseWhere` already uses. (Note for a future reader: `prisma/schema.prisma:1236` declares
`checkedAt DateTime? @map("checked_at")` with **no** `@db.Timestamptz`, while the live column *is*
timestamptz. Pre-existing cosmetic drift, deliberately not touched here.)

**Decided: a bill may appear under two different days.** One promised for the 25th and checked on
the 24th shows in both days' history. Both statements are true — it *was* owed on the 25th and it
*was* finished on the 24th — and a day's record must not lie by omission in either direction. A bill
matching both arms on the *same* day appears once (one row, one `OR` match). Owner decision, not a
side effect of the predicate.

## 4. Blast radius — measured, not estimated

Read-only production counts, arm (b) alone minus rows arm (a) already had:

| Day | arm (a) promised | **newly appearing** | union |
|---|---|---|---|
| 2026-08-25 | 111 | 0 | 111 |
| **2026-08-24** | 122 | **14** | 136 |
| **2026-08-23** | 0 | **0** | 0 |
| 2026-08-22 | 132 | 8 | 140 |
| 2026-08-21 | 145 | 1 | 146 |
| 2026-08-20 | 144 | 16 | 160 |

23 Aug's zero was checked rather than assumed: `pick_assignments` with `checkedAt` anywhere in that
IST day is also 0. It was a **Sunday** — a closed depot, not a broken predicate.

The 14 new rows on 24 Aug are 12 bills dated 2026-08-25 and 2 dated 2026-08-22 — the promise/completion
split running in **both** directions. Order 13532 is one of them.

**`zone` was checked before shipping**, because `floor-board.tsx:214` renders only
`rows.filter(r => r.zone !== "upcoming")` and history forces `upcomingRows = []` (`:260`) — a row
emitted as `upcoming` would have been admitted by the WHERE and then silently dropped by the client,
making the whole fix inert. All 14 resolve to `zone: "due"`, because a bill can only be picked ahead
of its dispatch date by being **early-released**, and `isEarlyReleased` already suppresses `upcoming`
(`queries.ts:641-642`). 13532 carries `pickEarlyReleasedAt`. So no client change was needed.

⚠ **Latent, not currently live:** that correlation is structural but not *enforced*. A future bill
checked on D, dated after D, with `pickEarlyReleasedAt` NULL would be emitted `upcoming` and dropped
by the client. 0 of 14 today. Noted so it is not rediscovered as a mystery.

## 5. Not changed — deliberately

- **`floorLiveBaseWhere` and both live arms** — untouched.
- **`getFloorLiveMarkerWhere` / `GET /api/floor/marker`** — untouched, and it **cannot** be affected:
  it calls `getFloorLiveMarkerWhere()` (`marker/route.ts:39`), which builds
  `floorLiveBaseWhere(getISTDayRange())` and never sees `mode`/`date`. The history `base` object is
  local to `getFloorBoard` and has no other reader. History is read-only and the marker is live-only;
  `floor-page.tsx` pauses both sync mechanisms when `!isLive`.
- **`lib/picking/queue.ts` and every picking surface** — untouched.
- **No UI, column, badge or tooltip added.** Sorting, payload shape and every emitted field are
  byte-identical; this is a WHERE clause and nothing else.
- **Zero writes.** Sequential awaits only, no `prisma.$transaction`, no schema change, no SQL.

### 🅿 PARKED — the stepper clamp

`components/floor/floor-page.tsx` `stepHistory` refuses to advance past yesterday
(`if (delta > 0 && next > yesterday) return cur;`), and `enterHistory` seeds yesterday. **History can
never reach today.** That is why 25-Aug history — which *would* have matched 13532 all along — was
never a route to it.

**This is a separate issue and stays parked.** It was explicitly out of scope for this change and is
recorded here so it is not lost. It is no longer load-bearing for the reported complaint: after this
change the bill surfaces under **24 August**, the day it was actually checked, which is where the
depot user was looking.

## 6. Same class as the 2026-08-02 picking fix

This is the **third** implementation of one rule: **a completion belongs to the day it was completed,
not to the day it was owed.**

1. **Floor live** (the original) — the live checked arm was re-fenced from `dispatchTargetDate=today`
   onto `pick_assignments.checkedAt ∈ today`, because a carried-over bill was vanishing at the exact
   instant it was finished. `CLAUDE_FLOOR.md §6c/§11(c)`.
2. **Billing Picking tab** — `buildBillingInvoicedInfoWhere` buckets on `checkedAt`, same reason,
   verified on OBDs 9108242795 / 9108357546. `CLAUDE_MAIL_ORDERS.md §23.4`.
3. **Picking supervisor board**, 2026-08-02, commit `e37cbe74` — `buildPickingWhere`'s `openPending`
   checked arm moved off `dispatchTargetDate` onto `checkedAt`. `lib/picking/queue.ts:299-317` carries
   the full argument, ending "A bill must never disappear when it is finished."

Floor **history** was the one surface still anchored purely on the promise day. It now carries the
same rule — and, unlike the three above (which *moved* their anchor), history **keeps both**, because
a historical record legitimately answers two different questions about a day.

---

*Draft record · 2026-08-25 · `lib/floor/queries.ts` history branch · canon updated in `docs/CLAUDE_FLOOR.md` §3*
