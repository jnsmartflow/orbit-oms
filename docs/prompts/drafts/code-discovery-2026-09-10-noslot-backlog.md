# code-discovery-2026-09-10-noslot-backlog.md
# DISCOVERY ONLY. No code written, no schema change, no DDL, no cleanup run.
# All database access was read-only SELECT through the pooler (CORE §3).
# Serves: docs/mockups/floor-trips/floor-trips-v3.html — retiring the decision rail.

**Read:** the v3 mockup, `code-discovery-2026-09-09-floor-trips.md`, `CLAUDE_FLOOR.md §3`,
`lib/floor/queries.ts` (`getFloorRail`, `getFloorBoard`, `floorLiveBaseWhere`),
`lib/picking/queue.ts` (`buildPickingWhere`), `app/api/picking/marker/route.ts`,
`CLAUDE_CORE.md §3` and `§7.3`.

**Numbers taken live 2026-09-10, ~08:40 IST.**

---

## A — The numbers

### 🔴 First, a correction to the question

Section 3(b) asks for "everything NOT on the live board and NOT cancelled, removed, dispatched or
closed — i.e. everything that would newly appear". Taken literally that set is **2,706 bills**. It is
the wrong number to plan on, and the reason matters more than the figure.

**2,545 of those 2,706 are `pick_checked` + `dispatchStatus='dispatch'` — finished work.** They are
off the live board for one reason only: `floorLiveBaseWhere`'s second arm keeps `pick_checked` bills
**checked today**, and these were checked on an earlier day. They are not unreleased, they are not
waiting for a decision, and nothing about the rail's retirement should bring them back.

| Population | Bills | What it is |
|---|---:|---|
| Literal 3(b) set | **2,706** | everything not live and not terminal |
| — of which `pick_checked` + `dispatch` | **2,545** | **finished work, already picked and checked** |
| — of which `dispatchStatus = 'hold'` | **157** | already on the Hold tab today |
| — of which `dispatchStatus IS NULL` | **4** | the actual rail |

**The population the design is about — bills not yet released — is 161, not 2,706.** Everything
below reports that set, and says where the other 2,545 sit.

⚠ **This is a live warning about the implementation, not a quibble.** If "widen the floor board" is
implemented as "drop the `dispatchStatus='dispatch'` term", **2,545 finished bills land on the
board** — sixty times the current live count of 40. The widening has to be written as a deliberate
union of the live predicate with the unreleased one, never as a removal of a term.

### A(a) · What the rail shows today — **4 bills**

The predicate, read off `lib/floor/queries.ts:350-356`: `workflowStage IN RAIL_STAGES` (rank < 60,
derived from `STAGE_LADDER`) AND `dispatchStatus IS NULL` AND `isRemoved = false`, AND the admin
hide-exclusion.

| | |
|---|---:|
| bills on the rail | **4** |
| of them tint | 3 |
| carrying a `dispatchTargetDate` | 0 |
| carrying a `dispatchWindowId` | 0 |

By stage: `pending_support` 1 · `pending_tint_assignment` 1 · `tint_assigned` 1 ·
`tinting_in_progress` 1. All four arrived **2026-09-09**, yesterday.

**The rail is essentially empty and has no backlog.** The 2026-07-23 sweep recorded in
`CLAUDE_FLOOR.md §7` cleared 261 → 23; it has stayed clear since.

### A(b) · What would newly appear — **161 bills, and 157 of them are already on screen**

| dispatchStatus | workflowStage | Bills | Invoiced | Oldest arrival | Newest |
|---|---|---:|---:|---|---|
| hold | pending_support | 138 | 134 | 2026-08-06 | 2026-09-09 |
| hold | pick_done | 10 | 10 | 2026-09-07 | 2026-09-07 |
| hold | pending_picking | 7 | 3 | 2026-08-20 | 2026-08-20 |
| hold | pick_checked | 2 | 2 | 2026-08-14 | 2026-09-07 |
| (null) | tint_assigned | 1 | 1 | 2026-09-09 | 2026-09-09 |
| (null) | pending_support | 1 | 1 | 2026-09-09 | 2026-09-09 |
| (null) | pending_tint_assignment | 1 | 1 | 2026-09-09 | 2026-09-09 |
| (null) | tinting_in_progress | 1 | 1 | 2026-09-09 | 2026-09-09 |
| | **total** | **161** | **154** | | |

🔴 **The 157 hold bills are NOT new to the screen.** `getFloorHold` (`lib/floor/queries.ts:898`)
selects `dispatchStatus='hold'` with **no date anchor at all** — every hold, every date — and a live
count confirms the On-hold tab holds exactly **157**. Merging them into the main board moves them
from one tab to another; it does not surface anything hidden.

**So the genuinely new arrivals are the 4 rail bills.** Whether the Hold tab survives the merge is a
design decision this report does not make, but the number to plan the board's height around is
40 live + 4 rail, not 161 and certainly not 2,706.

### A(c) · The 161, by age

Anchored on `dispatchTargetDate`, falling back to `obdEmailDate` where the target is null — which is
all 161 of them, since not one carries a target date.

| Bucket | Bills | Invoiced | Tint |
|---|---:|---:|---:|
| today or later | 0 | 0 | 0 |
| 1-7 days | 77 | 76 | 3 |
| 8-30 days | 39 | 35 | 0 |
| 31-90 days | 45 | 42 | 0 |
| older than 90 | 0 | 0 | 0 |
| no date at all | 0 | 0 | 0 |

For contrast, the literal 2,706 set buckets as 17 today · 999 in 1-7 days · 1,645 in 8-30 days ·
45 in 31-90 — the shape of finished daily work, not of a backlog.

### A(d) · The 161 — invoice, assignment, open tint

| | |
|---|---:|
| carrying an `invoiceNo` | **154 of 161 (96%)** |
| carrying a `pick_assignments` row | 12 |
| tint bills | 3 |
| **tint bills with an OPEN split** | **0** |

🔴 **96% already have a SAP invoice number.** A bill SAP has invoiced has, in the ordinary course,
physically left. That is the single most important number in this report and it is what §C is built
on.

**Zero open tint splits.** The 2026-07-23 sweep had to leave two `tinting_in_progress` bills alone
for exactly this reason; today there is nothing in that state to protect. The three tint bills in
the set all have their splits finished or cancelled.

### A(e) · The 103 Deco Retail bills with `dispatchStatus` NULL — **gone, all of them**

`CLAUDE_FLOOR.md §10` and the 2026-09-09 report both carry this as a parked data issue: 103 Deco
Retail bills reached `pending_support` with `dispatchStatus` NULL because the dispatch engine fires
only on `='dispatch'`.

**Live count today: 0.** No Deco Retail bill anywhere in the table has a NULL `dispatchStatus` and a
non-terminal stage. The issue resolved itself between 2026-08-04 and now, by a route this report did
not establish.

⚠ **`CLAUDE_FLOOR.md §10`'s parked-issue list should lose that entry.** It is being read forward as
a live problem and it is not one.

### A(f) · The oldest bill in the set

| | |
|---|---|
| order id | 11496 |
| OBD | 9108644782 |
| customer | Shree Rang Sarita |
| stage / status | `pending_support` / `hold` |
| SMU · type | Deco Retail · non_tint |
| arrived | 2026-08-06 (35 days) |
| dispatchTargetDate | null |
| invoiceNo | **I536224003** |
| last log | `pending_support` — *"[obd_created] OBD 9108644782 created with 13 line(s) via manual-sap batch BATCH-20260806-018"*, 2026-08-06 06:43 |

Its last log line is its **creation**. Nothing has happened to it in 35 days except being held, and
SAP invoiced it. The next four oldest are the same shape — four more Shree Rang Sarita / Deco Retail
holds from 2026-08-06, three of them invoiced, all with creation as their last log.

---

## B — The safety proof

**Question: can a bill with `dispatchStatus` NULL and no slot reach the supervisor's Assign tab?**

**Answer: no, and it is excluded twice over on the path that matters. Verified by reading
`buildPickingWhere` at the call site, not by inference.**

### B1 · `openPending` — the scope every live board uses

`lib/picking/queue.ts:349-428`. The returned object, structurally:

```ts
{
  dispatchStatus: "dispatch",          // ← TOP-LEVEL
  isRemoved: false,                    // ← TOP-LEVEL
  OR: [
    gateOn ? { workflowStage: SUPPORT_DONE_OUTPUT, pickVisibleAt: { not: null } }
           : { workflowStage: SUPPORT_DONE_OUTPUT },
    { workflowStage: { in: [PICK_ASSIGNED, PICK_DONE] } },
    { workflowStage: PICK_CHECKED, pickAssignment: { checkedAt: { gte, lt } } },
  ],
}
```

**EXCLUSION 1 — `dispatchStatus: "dispatch"`, at the top level.** Prisma ANDs top-level keys with
each other and with the `OR`. A bill whose `dispatchStatus` is NULL fails this term before any
branch of the `OR` is evaluated. There is no branch that can rescue it, because the `OR` is a
sibling of this key, not an alternative to it.

⚠ And SQL NULL semantics make it stricter, not looser: `"dispatchStatus" = 'dispatch'` is
`UNKNOWN` for a NULL, and a `WHERE` keeps only rows that are `TRUE`. A NULL is not "not equal", it
is "not admitted".

**EXCLUSION 2 — the stage branches.** Every branch of the `OR` names a stage from
`PICKING_ACTIVE_STAGES`. The five rail stages — `order_created`, `pending_tint_assignment`,
`tint_assigned`, `tinting_in_progress`, `pending_support` — appear in none of them. So even if
exclusion 1 were somehow removed, a rail bill still matches nothing.

**Two independent terms, either one sufficient.** That is defence in depth and it is worth keeping
both: a future change that widens the stage set would still hit the status term, and the reverse.

### B2 · `single` — caller-less but a public API contract

`lib/picking/queue.ts:429-450`:

```ts
{
  dispatchStatus: "dispatch",
  dispatchTargetDate: dateOnly,
  workflowStage: { in: PICKING_ACTIVE_STAGES },
  isRemoved: false,
}
```

**THREE independent exclusions**: the same status term, the same stage set, plus
`dispatchTargetDate: dateOnly` — an equality against a `Date`, which a NULL target date can never
satisfy. No app code selects this scope (`PICKING §4`), but both public routes accept it by name, so
it is proved here too.

### B3 · The picking marker

`app/api/picking/marker/route.ts:114-122`. It does not build a predicate of its own:

```ts
const { where } = buildPickingWhere({ date: dateParam, scope: scopeParam, gateOn });
const scopedWhere = pickerId !== undefined ? { ...where, pickAssignment: { pickerId } } : where;
```

The only thing added is `pickAssignment: { pickerId }`, which **narrows** — a bill with no assignment
row is excluded by it. Nothing widens. The marker therefore inherits both exclusions from B1
unchanged, which is the "Marker ⊇ queue, never ⊂" invariant (`PICKING §10`) working in the safe
direction here.

`countHeldBackWaiting` (`lib/picking/visibility-gate.ts:98`) spreads
`workflowStage: SUPPORT_DONE_OUTPUT, pickVisibleAt: null` onto the **ungated** board where — which
still carries `dispatchStatus: "dispatch"` at the top level. A rail bill cannot be counted there
either.

### B4 · Every other consumer, checked

| Caller | How it reaches the predicate | Can a rail bill leak? |
|---|---|---|
| `GET /api/picking/queue` | `getPickingQueue` → `buildPickingWhere` | no |
| `app/picking/page.tsx` (picker first paint) | `getPickingQueue({ pickerId })` | no — narrowed further |
| `GET /api/picking/combined` | `getPickingQueue({ scope: "openPending", pickerId })` | no |
| `GET /api/picking/marker` | B3 | no |
| `lib/billing/picking-where.ts` | its own predicate, `workflowStage: 'pick_checked'` + `dispatchStatus: "dispatch"` | no |

**Conclusion: widening the floor board cannot leak unreleased work to the floor.** The floor's
visibility is decided by `buildPickingWhere`, and no change to `getFloorBoard` touches it. The two
predicates share no code and no term.

### B5 · 🔴 The inverse problem, which IS real and is not what was asked

The proof above is that nothing leaks. The corollary is that **nothing gets through either**, and
the v3 design depends on it getting through.

The mockup's keyline says: *"Adding a bill to a trip writes the trip's date and slot onto the bill …
putting a bill on the 12:30 trip **is** saying it goes at 12:30."*

That is not what the shipped routes do:

- **`POST /api/floor/trips/[id]/bills`** writes `{ tripDropId: drop.id }` and nothing else. No
  `dispatchTargetDate`, no `dispatchWindowId`, no `dispatchStatus`, no `workflowStage`.
- **`POST /api/floor/trips/[id]/release`** calls `stampPickVisibility`, whose locked rule refuses any
  bill not at `SUPPORT_DONE_OUTPUT`. A `pending_support` rail bill is refused with *"only waiting
  bills can be shown"*, which my release route re-buckets as `notWaiting` — a bucket whose label
  means "already with a picker" and would be **wrong** for this bill.

**So a no-slot bill put on a trip and released today would: stay at `pending_support`, keep
`dispatchStatus` NULL, never reach the picking board, and be reported to the planner as though it
were already with a picker.** Three failures, one of them a lie on screen.

**What the release path must also do**, and it is exactly what `POST /api/floor/release` already does
today (`app/api/floor/release/route.ts:104-116`): write `dispatchTargetDate`, `dispatchWindowId`,
`dispatchStatus='dispatch'`, `workflowStage=SUPPORT_DONE_OUTPUT`, `dispatchSlotSource='manual'` —
one `orders.update` per bill, plus its log row.

⚠ **And `FLOOR_RELEASABLE_STAGES` is `["pending_support","pending_picking"]` only.** Three of the
four current rail bills are mid-tint (`pending_tint_assignment`, `tint_assigned`,
`tinting_in_progress`) and are **not releasable by that list** — deliberately, so a bill can never
reach a rack with no shade (`FLOOR §4.2`). Putting a mid-tint bill on a trip has to be allowed
(membership is not gated) while releasing it must still refuse until the shades are done. The v3
design does not say what the trip band shows in that state.

---

## C — Cleanup proposal · 🔴 DEAD — DO NOT RUN

> 🔴 **KILLED BY OWNER STATEMENT, 2026-09-10.** Hold bills are GENUINE WORKING STATE. On-hold is a
> deliberate act the depot performs on a real bill, not a queue that silts up, so **age is not
> evidence that the goods shipped** — which is the entire reasoning this section rests on. The SQL
> below must never be run, and the 42 bills it targets must not be closed to `dispatched` by any
> sweep.
>
> It is kept, not deleted, for two reasons: it records the SHAPE of a backfill done correctly (one
> `orders.update` and one `order_status_logs` row per bill, no `BEGIN`/`COMMIT`, blast radius read
> first), and it records that the question was asked and answered so a later session does not ask it
> again. Live count 2026-09-10: **155** bills on hold.
>
> Recorded in `web-update-2026-09-09-floor-trip-module.md` §7.1.

Everything below is the original 2026-09-10 proposal, superseded.

**The rail backlog does not need cleaning — it is 4 bills, all from yesterday.** What does look
stale is the **Hold tab**, and it is stale in the same way the 2026-07-23 sweep found:

| Hold bills | Count | Invoiced | Not invoiced |
|---|---:|---:|---:|
| arrived in the last 30 days | 112 | 107 | 5 |
| **arrived more than 30 days ago** | **45** | **42** | **3** |

**42 bills held for over a month with a SAP invoice number against them.** The oldest is 35 days.
Their last log line is, in every one of the five sampled, their own creation. Held, invoiced, and
untouched since.

The SQL below follows the shape of the July backfill recorded in `CLAUDE_FLOOR.md §7`: close them to
`workflowStage='dispatched'`, one `order_status_logs` row each saying what happened and why. It is
**commented out and has not been run.**

⚠ **Three things to weigh before uncommenting.**

1. **The invoice is evidence, not proof.** 96% of the whole unreleased set carries one, so an invoice
   number does not distinguish "shipped" from "held after invoicing". The 35-day age is the stronger
   signal and the two together are the case — but this is a judgement about physical goods that only
   the depot can settle. The July sweep was run *after* confirming the goods had shipped weeks
   earlier; the same confirmation is owed here.
2. **`dispatched` currently has no writer** (`code-discovery-2026-09-09-floor-trips.md §B`), and the
   trip module is meant to become one. Adding 42 more hand-swept rows to a stage of 4,137 already
   unattributable ones makes that history slightly worse. Doing it *after* the trip module ships
   would let the real dispatch action record them properly instead.
3. **The 3 uninvoiced old holds are excluded** and must stay excluded. They are the ones most likely
   to be genuinely held rather than forgotten.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- STALE HOLD CLEANUP — 🔴 DEAD. NEVER RUN THIS.
-- Killed by owner statement 2026-09-10: hold bills are genuine working state,
-- so age is not evidence the goods shipped. See the banner on section C.
-- Shape follows the 2026-07-23 backfill (CLAUDE_FLOOR.md §7): close the bill,
-- write ONE log row per bill saying what happened and why.
-- No BEGIN/COMMIT (CORE §3). Read the SELECT before uncommenting anything.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · BLAST RADIUS. Read-only. Run this first, on its own. ──────────
-- Every hold bill, labelled TOUCHED or SURVIVES, with the reason.
SELECT
  CASE
    WHEN (o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date
         < (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date - 30
     AND o."invoiceNo" IS NOT NULL
    THEN 'TOUCHED'
    ELSE 'SURVIVES'
  END                                                        AS verdict,
  CASE
    WHEN (o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date
         >= (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date - 30
      THEN 'held less than 30 days'
    WHEN o."invoiceNo" IS NULL
      THEN 'no invoice — may be genuinely held'
    ELSE 'held 30+ days and invoiced'
  END                                                        AS reason,
  o.id, o."obdNumber", o."workflowStage", o.smu, o."orderType",
  (o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date        AS arrived,
  o."invoiceNo",
  COALESCE(c."customerName", o."shipToCustomerName", '(unmatched)') AS customer
FROM orders o
LEFT JOIN delivery_point_master c
       ON c.id = COALESCE(o."shipToOverrideCustomerId", o."customerId")
WHERE o."dispatchStatus" = 'hold'
  AND o."isRemoved" = false
  AND o."workflowStage" NOT IN ('cancelled','dispatched','closed')
ORDER BY verdict, arrived;

-- Expected on 2026-09-10:  TOUCHED 42  ·  SURVIVES 115  (112 recent + 3 uninvoiced)


-- ── STEP 2 · THE LOG ROWS. Commented out. Run BEFORE step 3. ──────────────
-- One row per bill, written FIRST so that a failure between the two steps
-- leaves a log entry with no state change — recoverable — rather than a state
-- change with no record of why, which is the 3,896 unattributable `dispatched`
-- rows this project already has.
--
-- `changedById` = 1 (Harsh), the same actor the July sweep used. Change it if
-- somebody else runs this.
--
-- INSERT INTO order_status_logs ("orderId", "fromStage", "toStage", "changedById", note, "createdAt")
-- SELECT o.id,
--        o."workflowStage",
--        'dispatched',
--        1,
--        'Bulk backfill: held 30+ days with a SAP invoice, goods believed dispatched, never recorded in system',
--        now()
--   FROM orders o
--  WHERE o."dispatchStatus" = 'hold'
--    AND o."isRemoved" = false
--    AND o."workflowStage" NOT IN ('cancelled','dispatched','closed')
--    AND o."invoiceNo" IS NOT NULL
--    AND (o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date
--        < (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date - 30;


-- ── STEP 3 · THE STATE CHANGE. Commented out. ─────────────────────────────
-- ⚠ THE PREDICATE IS IDENTICAL TO STEP 2's, so the two sets cannot diverge —
-- but they are evaluated at different moments, so a bill imported between the
-- two would get a log row and no update, or the reverse. At 42 rows on a quiet
-- table that window is theoretical; if it matters, run both inside one minute.
--
-- ⚠ `dispatchStatus` IS DELIBERATELY LEFT AS 'hold'. The July sweep changed the
-- stage only. Clearing the status would also clear the record that these bills
-- were held, which is the one fact explaining why they sat for a month.
--
-- ⚠ `updatedAt` IS NOT SET, AND THAT IS DELIBERATE. `orders` has no trigger and
-- Prisma's @updatedAt is application-level, so a raw UPDATE leaves it alone —
-- which means the live-sync markers (MAX(orders.updatedAt)) will NOT fire on
-- every board for a 42-row sweep. Setting it would refresh every open screen in
-- the depot for a change nobody is watching.
--
-- UPDATE orders o
--    SET "workflowStage" = 'dispatched'
--  WHERE o."dispatchStatus" = 'hold'
--    AND o."isRemoved" = false
--    AND o."workflowStage" NOT IN ('cancelled','dispatched','closed')
--    AND o."invoiceNo" IS NOT NULL
--    AND (o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date
--        < (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date - 30;


-- ── STEP 4 · VERIFY. Read-only. ───────────────────────────────────────────
SELECT 'hold remaining'        AS chk, count(*)::text AS value
  FROM orders WHERE "dispatchStatus"='hold' AND "isRemoved"=false
   AND "workflowStage" NOT IN ('cancelled','dispatched','closed')
UNION ALL
SELECT 'log rows written today',
       count(*)::text FROM order_status_logs
 WHERE "toStage"='dispatched'
   AND note LIKE 'Bulk backfill: held 30+ days%'
   AND ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date
       = (date_trunc('day',(now() AT TIME ZONE 'Asia/Kolkata')))::date
UNION ALL
SELECT 'oldest surviving hold',
       COALESCE(min((o."obdEmailDate" AT TIME ZONE 'Asia/Kolkata')::date)::text,'(none)')
  FROM orders o WHERE o."dispatchStatus"='hold' AND o."isRemoved"=false
   AND o."workflowStage" NOT IN ('cancelled','dispatched','closed');
```

**Recommendation: do not run this yet.** The rail retirement does not depend on it — the rail holds
4 bills — and reason 2 above says the same 42 rows are better closed by the trip module's own
dispatch action, with a real actor, than by a fourth hand sweep.

---

## D — What I could not verify

1. **Whether the 42 stale hold bills actually shipped.** Every signal points that way — 30+ days
   held, a SAP invoice, no log since creation — but that is inference from the record, not knowledge
   of the goods. The July sweep was run after confirming physical dispatch; the same confirmation is
   owed and only the depot can give it.
2. **How the 103 Deco Retail NULL-status bills resolved.** They are gone (A(e)), and I did not
   establish by what route. The count could have been drained by the same hand-run sweep that moved
   ~2,600 rows to `dispatched`, or by enrichment catching up. `order_status_logs` for those orders
   would answer it; I did not query them.
3. **No screen was checked.** Claude Code has no login. Every claim about what the rail, the Hold tab
   or the Assign tab shows is derived from the predicate in code, not observed. That includes the
   statement that the 157 hold bills are already visible — it follows from `getFloorHold` having no
   date anchor, which I read, not from seeing 157 rows on a tab.
4. **The safety proof is a reading proof, not an executed one.** I did not create a bill with
   `dispatchStatus` NULL and watch the Assign tab refuse it, because that needs a write. The argument
   rests on Prisma's documented AND-of-top-level-keys behaviour and on SQL NULL semantics, both of
   which are load-bearing. If either were wrong the proof would fail — but the same two facts
   underpin every predicate in this codebase already.
5. **B5's conclusion that a released rail bill would report as `notWaiting` is traced, not run.** It
   follows `stampPickVisibility`'s stage guard into my own release route's re-bucketing, both of
   which I wrote. Worth one manual test on a draft trip holding a `pending_support` bill before the
   v3 work starts.
6. **`isRemoved` is excluded everywhere in this report**, matching CORE §3's soft-delete rule. 46
   removed bills sit at `pending_tint_assignment`; they are in none of these counts and should not
   be.
7. **The age buckets anchor on `obdEmailDate` for the whole 161**, because not one of them carries a
   `dispatchTargetDate`. For the literal 2,706 set the anchor is mostly the target date, so the two
   bucket tables are not measuring quite the same thing — noted rather than reconciled, since the
   161 is the set that matters.
8. **Two scratch scripts** were written to run these SELECTs: `scripts/_noslot_backlog_20260910.ts`
   and `_noslot_backlog2_20260910.ts`. Underscore-prefixed, so outside the `tsc --noEmit` gate.
   SELECT-only. Not deleted (CORE §3).

---

*Discovery only. No application code written, no DDL run, no cleanup executed,
`prisma/schema.prisma` untouched. All database access read-only.*
