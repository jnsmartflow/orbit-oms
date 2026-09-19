# Discovery — why bills are parked at `pending_support`

**2026-09-11 · DISCOVERY ONLY · no code written, no schema change, no DDL run, nothing applied.**
Every database read below is a SELECT. Live numbers are today's and move.

Read for this: `CLAUDE_IMPORT.md`, `CLAUDE_CORE.md §7.4`, `CLAUDE_MAIL_ORDERS.md`,
`app/api/import/obd/route.ts`, `lib/import-upsert.ts`, `lib/import-upsert/header.ts`,
`lib/import-upsert/effects.ts`, `lib/dispatch/dispatch-engine.ts`, `lib/workflow-stages.ts`,
`app/api/floor/actions/route.ts`, `code-discovery-2026-09-10-noslot-backlog.md`.

> ⚠ **THE 36 WERE ALREADY CLEARED BEFORE I LOOKED.** There are **zero** bills at `pending_support`
> with a NULL `dispatchStatus` right now. Everything in §D is reconstructed from
> `order_status_logs`, not observed in the stuck state. See §G1.

---

## A — The paths

### A1 · Every path that creates an order

Two, and they are the same code twice.

| Site | Path | `workflowStage` written | `dispatchStatus` written |
|---|---|---|---|
| `app/api/import/obd/route.ts:1160-1162` | manual template / manual-SAP confirm | `pending_tint_assignment` if the lines tint, else **`pending_support`** | **none — NULL** |
| `app/api/import/obd/route.ts:3114` | auto-import | identical expression | **none — NULL** |

Neither `createMany` includes `dispatchStatus` at all. **Every bill in the depot is born at
`pending_support` with a NULL status.** Getting out of it is a second, separate step.

### A2 · The second step — `applyMailOrderEnrichment`

`app/api/import/obd/route.ts:242`. Called from three places: the manual-template path (`:1240`), the
auto path (`:3189`), and the manual-SAP effect loop (`:1797`). It loops the batch's SO numbers and,
per SO number, does this:

```ts
const mailOrder = await prisma.mo_orders.findFirst({ where: { soNumber: soNum }, ... });
if (!mailOrder) continue;                                  // ← GATE 1
...
if (mailOrder.dispatchStatus) {
  updateData.dispatchStatus = mailOrder.dispatchStatus.toLowerCase();   // ← the only writer
}
...
if (updateData.dispatchStatus === "dispatch") {            // ← GATE 2, the auto-done
  // pending_support → pending_picking, one orders.update, one log row
}
```

So **`dispatchStatus` on a new bill comes from ONE place: a matching `mo_orders` row.** No mail order,
no status. No status, no stage flip. The bill stays at `pending_support` indefinitely.

### A3 · Manual SAP versus automatic — I checked, and the difference is NOT the one suspected

The lead in the brief was that the stuck bills' logs read `via manual-sap batch BATCH-…`. **Manual SAP
is not the discriminator.** Of the 32 bills swept this morning, **25 came from `[auto-import]` and only
6 from `[manual-sap]`.**

The two paths do differ mechanically, and it is worth recording so nobody re-investigates it:

- **Auto and manual-template** call `applyMailOrderEnrichment` unconditionally with every created SO
  number.
- **Manual SAP** calls it only when `buildEffects` (`lib/import-upsert/effects.ts:51-55`) emits a
  `mail-order-enrichment` effect, which requires `soNumberChanged && a.finalSoNumber`.

That looks like a real divergence and is not one in practice: `applyMailOrderEnrichment` itself opens
with `soNumbers.filter(Boolean)`, so a null SO number is dropped on every path anyway. Both paths need
an SO number, and both then need the `mo_orders` row. **The manual-SAP effect gate is a redundant
second copy of a filter the function already applies** — harmless today, and a place two paths could
drift tomorrow.

---

## B — Why the engine skips them

### B1 · Two different gates, and the brief conflates them

`evaluateDispatchSlot` assigns a **SLOT**. It has never assigned a **STAGE**. The stage flip is the
auto-done block at `:446`, which is gated on `updateData.dispatchStatus === "dispatch"` and never asks
the engine anything. Both gates matter but they fail for different bills.

`evaluateDispatchSlot` (`lib/dispatch/dispatch-engine.ts:146-160`), in fixed order:

| # | Gate | Declines with |
|---|---|---|
| 1 | `smu !== "Deco Retail"` | `smu-not-deco-retail` |
| 2 | `dispatchStatus?.toLowerCase() !== "dispatch"` | `status-not-dispatch` |
| 3 | delivery type not `Local` or `Upcountry` | `delivery-type-unhandled` |
| 4 | both clocks null | `no-order-datetime` |

**Gate 2 is the one the brief asks about, and the thing that sets `'dispatch'` before the engine runs is
`applyMailOrderEnrichment` — the same function, twenty lines earlier, from the same `mo_orders` row.**
The engine is called at `:396`, inside that function, after the `updateMany` at `:346` has already
written the status. There is no other writer in the import path.

So the ordering is: mail order → `dispatchStatus` → engine → slot → auto-done → `pending_picking`. Break
the first link and all four later ones are dead.

### B2 · Measured — `mailMatched` is the whole gate

Non-tint bills created in the last 30 days, by the two gates:

| mail matched? | SMU | bills | auto-dispatched by the importer | needed a human |
|---|---|---:|---:|---:|
| yes | Deco Retail | 2,464 | **2,322** | 53 |
| no | other SMU | 376 | **0** | 335 |
| no | Deco Retail | 335 | **0** | 285 |
| yes | other SMU | 3 | 3 | 0 |

**Zero of 711 unmatched bills were ever auto-dispatched, whatever their SMU.** 2,325 of 2,467 matched
ones were. The SMU gate does not decide the STAGE at all — the 3 matched non-Deco bills all advanced.
What SMU decides is the SLOT:

| mail matched? | SMU | bills | slot from the engine | slot set by hand | no slot |
|---|---|---:|---:|---:|---:|
| yes | Deco Retail | 2,464 | **2,230** | 134 | 100 |
| no | other SMU | 376 | **0** | 334 | 42 |
| no | Deco Retail | 335 | **0** | 285 | 50 |
| yes | other SMU | 3 | **0** | 1 | 2 |

So there are **two separate failures stacked on the same bills**, and fixing one leaves the other:

1. **No mail match → no `dispatchStatus` → no stage flip.** Every unmatched bill.
2. **SMU not `Deco Retail` → no slot even if the status were set.** 376 of the 711.

### B3 · The third writer of the stranded state — the floor's own Change slot

`app/api/floor/actions/route.ts:115` writes `dispatchTargetDate`, `dispatchWindowId` and
`dispatchSlotSource: "manual"` and **deliberately writes neither `dispatchStatus` nor a stage**. That
is why the brief's bills had "a date and window already set but `dispatchStatus` NULL": that state was
created **this morning by the operator**, not by the importer. Ajay Vansiya changed the slot on 46 bills
between 04:22 and 04:36 IST; the hand sweep released 32 of them at 04:58.

31 of the 32 carry `dispatchSlotSource = 'manual'`. Only one had no slot source at all.

---

## C — How often, and since when

### C1 · It is not new, and there is no start date

Transitions OUT of `pending_support` over 30 days, by who did it:

| actor | rows |
|---|---:|
| the importer, "Auto-dispatched by enrichment" | 2,329 |
| **a human pressing Release on the floor** | **861** |
| a human changing the slot | 42 |
| this morning's hand sweep | 32 |
| cancelled | 14 |
| other | 15 |

**861 bills in 30 days were released by hand, by two or three named users, every single working day.**
That is roughly 30 a day, and it is the job the decision rail existed to do.

Per day, the importer versus a person:

| day | by the importer | by a human |
|---|---:|---:|
| 2026-08-17 | 84 | 27 |
| 2026-08-20 | 146 | 55 |
| 2026-08-22 | 49 | 62 |
| 2026-08-25 | 115 | 49 |
| 2026-08-30 | 31 | 35 |
| 2026-09-07 | 237 | 75 |
| 2026-09-09 | 98 | 59 |
| 2026-09-10 | 82 | 75 |

Every day for thirty days. Not a trickle, not a new fault, and no date it started on. **What changed
yesterday is not the leak — it is the bucket.** `bbb9628c` retired the decision rail, which was the
surface those 30-a-day were cleared on. The bills are still on the board (see §E3), but the one-press
Release that used to empty them is gone, so a day's worth piled up overnight and was visible this
morning as 36.

### C2 · How long a bill waited

Of the 861 human releases: **median 1 hour, mean 19 hours, worst 767 hours** — 32 days. The median says
the rail was worked promptly; the mean and the worst say bills fell through it regularly and sat until
somebody happened to look.

### C3 · The second producer — tint completions

`toStage = 'pending_support'` log rows, 30 days, biggest first:

| note | from | rows |
|---|---|---:|
| **"Tinting completed — moved to support queue"** | `tinting_in_progress` | **231** |
| "Dispatch slot changed to 2026-09-11 10:30" | `pending_support` | 39 |
| "Created via auto-import batch …" | (creation) | the rest |

`app/api/tint/operator/done/route.ts:181` computes
`hasPresetSlot = order.dispatchWindowId != null && order.dispatchTargetDate != null`. With a preset slot
the bill goes straight to `pending_picking` with `dispatchStatus: 'dispatch'`. **Without one it lands at
`pending_support`** and nothing releases it. 205 of the 861 human releases were tint bills, and **none of
them was mail-matched** — so enrichment could never have helped them. Same code at
`tint/operator/split/done/route.ts:197` and `tint/manager/base-bypass/route.ts:223`.

**Any fix that only touches the import path leaves roughly a quarter of the problem in place.**

---

## D — What the stuck ones share

Reconstructed from the 32 rows carrying
`note = 'Released to floor: desk backlog cleared by hand after the rail retirement'`.

| property | the 32 swept | 229 created the same day that went through |
|---|---:|---:|
| **mail matched** | **0** | **191** |
| customer unmatched | 5 | 0 |
| SMU = Deco Retail | 5 | 215 |
| SO number null | 0 | — |
| email clock missing | 0 | — |
| punch clock missing | 0 | — |

**The difference is `mailMatched`, and it is absolute: 0 of 32 against 191 of 229.** Not the batch, not
the clock, not the SO number — every one of the 32 had an SO number and both clocks.

Their SMUs: Retail Offtake 12, Decorative Projects 10, Deco Retail 5, Distributor 5. Their delivery
types: Upcountry 15, Local 11, IGT 1, and **5 with no delivery type at all** — those five would be
declined by the engine's gate 3 even after both other gates were fixed.

Their batches: `[auto-import]` 26, `[manual-sap]` 6. **The manual-SAP lead does not hold** (§A3).

---

## E — Who else uses this stage

Two sweeps agreed exactly, 61 occurrences: an ERE over `app components lib prisma` and MSYS-native
`grep -F` over the same tree.

### E1 · WRITERS — everything that puts a bill INTO `pending_support`

| Call site | When | Status written |
|---|---|---|
| `app/api/import/obd/route.ts:1162` | every non-tint bill, manual paths | NULL |
| `app/api/import/obd/route.ts:3114` | every non-tint bill, auto path | NULL |
| `app/api/tint/operator/done/route.ts:193` | tint finished, **no preset slot** | NULL |
| `app/api/tint/operator/split/done/route.ts:197` | split tint finished, no preset slot | NULL |
| `app/api/tint/manager/base-bypass/route.ts:223` | Base — No Tint bypass, no preset slot | NULL |
| `app/api/tint/manager/manual-entry/revert/route.ts:233, :271` | manual tint entry reverted | NULL |
| `app/api/tint/manager/orders/route.ts:239` | tint manager write | — |
| `app/api/floor/actions/route.ts:167` | **Restore** a cancelled bill | explicitly `null` |

### E2 · READERS — what still depends on bills being in it

| Consumer | What it does | Effect if the stage empties |
|---|---|---|
| `lib/floor/queries.ts` `RAIL_STAGES` (rank < 60) | the floor board's **un-slotted arm** and the live marker's | the second arm returns fewer rows — that is the goal |
| `lib/floor/release-stages.ts` `FLOOR_RELEASABLE_STAGES` | `["pending_support","pending_picking"]` — what `releaseBillsToFloor` accepts | **must keep accepting it**; hold bills live here |
| `lib/workflow-stages.ts` `isSupportDone` | rank 50 < 60 → a `pending_support` bill is NOT done | used by list filters across Tint Manager, Operations and two admin backfills |
| `app/api/tint/manager/manual-entry/lookup/route.ts:68` | **refuses** unless `workflowStage === 'pending_support'` | 🔴 manual tint entry would stop finding bills |
| `app/api/tint/manager/manual-entry/route.ts:132` | same guard on the write | 🔴 same |
| `app/api/tint/manager/orders/route.ts:817` | "Set B only picks up completions that landed at `pending_support`" | 🔴 a tint completion list would go empty |
| `app/api/operations/summary/route.ts:26, :83, :136` | three counts | counts drop to the hold population |
| `app/(admin)/admin/page.tsx:33` | an admin dashboard count | same |
| `components/floor/rail-card.tsx:119`, `detail-panel.tsx:376` | `releasable = stage === 'pending_support'` | rail-card no longer renders; **the detail panel still does** |

### E3 · A stranded bill is NOT invisible today

`floorUnslottedWhere()` is `workflowStage IN RAIL_STAGES AND dispatchStatus IS NULL`, and `RAIL_STAGES`
is every stage at rank < 60, which **includes `pending_support`**. Since `bbb9628c` that set is unioned
into the floor board. A stranded bill therefore shows as a row wearing a `no slot` chip.

It is **on the screen and not pickable** — `buildPickingWhere` requires `dispatchStatus: 'dispatch'`,
so the supervisor never sees it. That is the real shape of "sits until somebody notices".

### E4 · Hold lives here too

All **139** bills at `pending_support` right now are `dispatchStatus = 'hold'`, and zero are NULL.
`isSupportDone` returns true for a held bill *because of the status*, not the stage — hold is not a
stage and a held bill deliberately stays at `pending_support`. **Any change to this stage must leave the
hold population exactly where it is** (owner ruling 2026-09-10; see
`web-update-2026-09-09-floor-trip-module.md §7.1`).

---

## F — Proposed fix

Target: **every bill arrives ready for the floor, with a time.** Exceptions: a bill still tinting, and a
bill deliberately held.

### F1 · Recommendation, in order

**1. Give the importer a fallback when there is no mail order.** This is the 711-bill root cause and
nothing else touches it. After `applyMailOrderEnrichment` has run for a batch, take every bill still at
`pending_support` with a NULL status whose `orderType` is not tint, set `dispatchStatus: 'dispatch'`,
run the engine, and apply the auto-done — one `orders.update` per bill, one log row saying it was the
fallback and not a mail match.

*Risk:* a mail order that arrives LATER would previously have set `hold`, and now finds the bill already
released. Today's behaviour is not better — the bill sits unreleased instead — but the hold intent is
genuinely lost. **Mitigate by scoping the fallback to bills older than the mail-matching window** rather
than firing it in the same request, or by having late enrichment re-apply `hold` when it sees one.

**2. Do NOT remove the engine's `dispatchStatus` gate.** It is what stops the engine slotting a held or
cancelled bill, and it is also read by `lib/floor/suggest.ts`. Setting the status earlier (step 1) makes
the gate pass honestly. Removing it would let the engine assign slots to bills nobody intends to ship.

**3. Decide the SMU gate separately and deliberately.** 376 unmatched non-Deco bills a month get no slot
even after step 1. The gate is a business rule — `Retail Offtake`, `Decorative Projects` and
`Distributor` may genuinely not want an auto-slot. **This is an owner question, not a bug**, and step 1
is worth shipping without it: those bills would at least reach `pending_picking` with a status, and the
floor gives them a slot by putting them on a trip.

**4. Fix the tint path the same way.** `hasPresetSlot` false currently means "park it". It should mean
"run the engine now, using the completion time as the clock" — which is what
`CLAUDE_TINT.md`'s slot-at-completion already does for the preset case. 231 bills a month.

**5. What happens to a bill the engine cannot schedule.** Do **not** invent "today plus the next
window". The engine declines for four distinct reasons and they are not the same problem: no delivery
type (5 of the 32) is a **master-data fault** that a default would hide forever. Recommend: advance the
stage and the status, leave the slot NULL, and let it land on the floor board with its existing
`no slot` chip. The desk gives it a slot by putting it on a trip, which is the v3 design. **A bill with
no slot is visible and actionable; a bill with a wrong slot is neither.**

### F2 · 🔴 What breaks if `pending_support` stops receiving new bills

Nothing proposed here empties the stage — hold still lives in it, and so does every reverted tint entry.
But these are the consumers that would notice a sharp drop, from §E2:

- 🔴 **Tint manual entry** (`manual-entry/lookup/route.ts:68`, `route.ts:132`) refuses any bill not at
  `pending_support`. If step 4 advances tint completions straight to `pending_picking`, **manual entry
  stops finding them.** This is the one hard blocker and must be changed in the same commit.
- 🔴 **Tint manager orders, Set B** (`orders/route.ts:817`) "only picks up completions that landed at
  `pending_support`". Same commit.
- **Operations summary** and the **admin dashboard** would show near-zero. Cosmetic, but both are
  labelled as a queue depth and would read as a broken feed.
- **`FLOOR_RELEASABLE_STAGES` must keep `pending_support`** — the Hold tab's release depends on it.
- **`isSupportDone`** is unaffected: it keys on rank and on the hold status, neither of which moves.

### F3 · SQL for anything already stuck — COMMENTED OUT, NOT RUN

There is nothing to clear today: **zero bills are in this state.** The block is written for the next
time, and follows the shape of this morning's sweep and the 2026-07-23 backfill recorded in
`CLAUDE_FLOOR.md §7`.

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- STRANDED pending_support SWEEP — PROPOSAL, 2026-09-11. NOT RUN.
-- Zero rows matched when this was written. Re-read STEP 1 before uncommenting.
-- One orders.update and one order_status_logs row per bill. No BEGIN/COMMIT
-- (CORE §3). Never touches a bill that is held or mid-tint.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 1 · BLAST RADIUS. Read-only. Run this first, on its own. ──────────
SELECT o.id,
       o."obdNumber",
       o.smu,
       o."orderType",
       o."dispatchStatus",
       o."dispatchTargetDate"::text                       AS slot_date,
       w."windowTime"                                     AS slot_window,
       o."dispatchSlotSource",
       o."mailMatched",
       (o."createdAt" AT TIME ZONE 'Asia/Kolkata')::text  AS created_ist,
       CASE
         WHEN o."dispatchStatus" = 'hold'                 THEN 'SURVIVES — held on purpose'
         WHEN o."orderType" = 'tint'                      THEN 'SURVIVES — still tinting'
         WHEN o."dispatchTargetDate" IS NULL              THEN 'SURVIVES — no slot to release into'
         ELSE 'TOUCHED — release to the floor on its own slot'
       END                                                AS verdict
  FROM orders o
  LEFT JOIN dispatch_slot_master w ON w.id = o."dispatchWindowId"
 WHERE o."workflowStage"  = 'pending_support'
   AND o."dispatchStatus" IS NULL
   AND o."isRemoved"      = false
 ORDER BY verdict, o."createdAt";

-- ── STEP 2 · THE WRITE. Commented out. ────────────────────────────────────
-- ⚠ Only bills that ALREADY have a date AND a window. This sweep releases a
--   bill onto the slot somebody already chose; it never invents one. A bill
--   with no slot is left for the desk to put on a trip, which is the v3 flow.
-- ⚠ `dispatchStatus` is set to 'dispatch' in the SAME update as the stage —
--   exactly ONE orders.update per bill. The live-sync markers key on
--   MAX(orders.updatedAt), so a second write fires a false "changed" on every
--   board in the depot (FLOOR §4/§10, PICKING §10).
-- ⚠ `dispatchSlotSource` is LEFT ALONE. It already says who chose the slot,
--   and overwriting it would erase that.
--
-- UPDATE orders o
--    SET "workflowStage"  = 'pending_picking',
--        "dispatchStatus" = 'dispatch'
--  WHERE o."workflowStage"      = 'pending_support'
--    AND o."dispatchStatus"     IS NULL
--    AND o."isRemoved"          = false
--    AND o."orderType"          <> 'tint'
--    AND o."dispatchTargetDate" IS NOT NULL
--    AND o."dispatchWindowId"   IS NOT NULL;
--
-- ⚠ Prisma's @updatedAt is APPLICATION-level, so a raw UPDATE leaves
--   orders."updatedAt" untouched and the boards do not flicker. That is also
--   why this sweep is invisible to the live-sync marker — deliberate here, and
--   the reason the 4,137 `dispatched` rows have no attribution (§C of the
--   noslot-backlog draft). Write the log rows below so this one does.
--
-- INSERT INTO order_status_logs ("orderId", "fromStage", "toStage", "changedById", note, "createdAt")
-- SELECT o.id, 'pending_support', 'pending_picking', <YOUR_USER_ID>,
--        'Released to floor: stranded desk backlog swept ' || to_char(now(), 'YYYY-MM-DD'),
--        now()
--   FROM orders o
--  WHERE o."workflowStage"  = 'pending_picking'
--    AND o."dispatchStatus" = 'dispatch'
--    AND o.id IN (<THE IDS STEP 1 LABELLED "TOUCHED">);

-- ── STEP 3 · VERIFY. Read-only. ───────────────────────────────────────────
SELECT 'stranded remaining' AS chk, COUNT(*)::text AS value
  FROM orders WHERE "workflowStage"='pending_support' AND "dispatchStatus" IS NULL AND "isRemoved"=false
UNION ALL
SELECT 'held (must be unchanged)', COUNT(*)::text
  FROM orders WHERE "workflowStage"='pending_support' AND "dispatchStatus"='hold' AND "isRemoved"=false
UNION ALL
SELECT 'log rows written today', COUNT(*)::text
  FROM order_status_logs
 WHERE note LIKE 'Released to floor: stranded desk backlog swept%'
   AND ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
```

---

## G — What I could not verify

1. 🔴 **The 36 were gone before I looked.** Zero bills are in the stranded state now. §D is
   reconstructed from the 32 log rows this morning's sweep wrote; **the 4 mid-tint bills that were
   correctly left behind carry no log row and I could not identify them at all.** The reconstruction
   cannot see any bill that was stuck and then cleared by a raw UPDATE, because a raw UPDATE leaves no
   trace — which is the same blind spot §C of the noslot-backlog draft records.
2. **"36 stuck, 32 released" does not reconcile exactly.** The logs show Ajay changing the slot on
   **46** bills this morning and 32 being released. I cannot tell from the data which 36 the owner
   counted, or whether the extra 14 were already released by other means.
3. **Nothing was verified on screen.** There is no login here. Every claim about what an operator sees
   is read from component source.
4. **I did not read the mail-order matcher itself.** Why 711 bills in 30 days have no `mo_orders` row is
   a separate question — it could be that those customers do not order by mail at all, or that the
   matcher is failing. **That distinction changes which fix is right** and this discovery does not
   settle it.
5. **The `hold` interaction with the proposed fallback is reasoned, not tested.** I did not measure how
   often a mail order arrives AFTER its OBD, which is what decides whether F1's risk is real or
   theoretical.
6. **Live numbers are today's, 2026-09-11, and move.** The 30-day window ends yesterday.
7. **A writer that sets the stage from a VARIABLE rather than a literal would not appear in either
   sweep.** Both sweeps matched the literal `pending_support`. I closed the obvious case —
   `lib/import-upsert/header.ts:6` states that `workflowStage` is **locked** and never patched, so the
   patch path cannot be a hidden writer — but I did not exhaustively trace every `workflowStage:` write
   in the tree back to its source expression.
