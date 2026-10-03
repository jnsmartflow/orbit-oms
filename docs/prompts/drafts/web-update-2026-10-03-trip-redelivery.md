# Trip re-delivery — full flow plan (web-update, 2026-10-03)

**Status:** DECISION DRAFT. Nothing built. Rev 5 — owner reviewed the first mockup.
**Built on:** `code-discovery-2026-10-03-trip-redelivery.md` (code at `fa6e5c8d`) + live read 2026-10-03 09:43 IST.
**Owner file when shipped:** `CLAUDE_FLOOR_TRIPS.md` (new section "Re-deliveries"). Floor owns the shell it draws in.

### Revision trail (do not revert without the owner)
- Rev 2: planner only **adds**. No Delivered / Came back buttons — outcomes come with the driver app. Rev 1's close buttons, "one open re-delivery per bill" rule and carry-rule arm were dropped.
- Rev 3: a retry can happen **the same day on a different trip** → warning + "Truck came back" tick, not a refusal. Attempts counted per trip.
- Rev 4: reasons = Shop / site closed, Wrong dispatch.
- Rev 5 (mockup review): **no NTS** anywhere (history and attempt count use Orbit trips only); a re-delivery shows as a **normal bill row with a RE-DEL tag** (rev 1–4 had a separate non-tickable block); clicking the tag opens an info modal; it is removed **like any bill** (tick → Remove from trip) and the entry is **deleted**; an invoice covering several OBDs lets the planner **tick several** and add them together.

---

## 1. What it is

A bill that already went out on a truck and came back undelivered is put on another trip as a
**re-delivery** (attempt 2, 3…). The planner adds it from an opened trip on `/floor` by typing the OBD
or invoice number. It sits in the stop's bill list like any bill, with a **RE-DEL** tag. Clicking the
tag shows its history. A third attempt is the same action on another trip (same day or later).

It must not change any bill's stage, hold or trip pointer (`orders.tripDropId` keeps pointing at the
bill's first trip).

### Ownership boundary
- Owns: table `trip_redeliveries`, `/api/floor/trips/[id]/redeliveries`, two activity actions, the RE-DEL tag + info modal, the add dialog.
- Reuses: drop key, the bill finder (extracted from the lookup route), FloorTable, the Floor shell, live-feed trigger functions.

---

## 2. Owner decisions

| # | Question | Answer |
|---|---|---|
| 1 | Who can be re-delivered? | Stage `pick_checked` or `dispatched`, not removed. Otherwise refused: "Not gone out yet — add it to a trip normally." |
| 2 | Same-day attempts | Allowed on a different trip. If the bill's latest attempt is on a trip dated today or later (non-cancelled), warning "Already on L-261003-01 today. Add only if that truck came back." + **Truck came back** tick before Add enables. Server requires `confirmedReturn: true` in that case |
| 3 | Attempt number / history | **Orbit trips only. No NTS.** Earlier attempts = the bill's own trip (if any) + its re-deliveries on non-cancelled trips. Attempt = 1 + that count (minimum 2). A bill with no earlier Orbit trip shows "No earlier Orbit trip" and is attempt 2 |
| 4 | Same bill twice on one trip | Refused (real unique on trip + bill) |
| 5 | Remove | Exactly like a normal bill: tick the row → **Remove from trip**. The `trip_redeliveries` row is **deleted**. The `redelivery_removed` activity row keeps OBD, attempt and reason, so the record survives |
| 6 | Trip cancelled | Re-delivery rows are **kept** as the record of the plan (same as drop rows). Every count and history ignores cancelled trips. OBDs listed in the `cancelled` activity row |
| 7 | Invoice with several OBDs | All shown with tick boxes; planner ticks one or more; one reason + note apply to all ticked; each bill shows its own warning/refusal |
| 8 | Re-delivery-only trip → Send to billing | Refused (nothing new to bill). Button tip "Re-deliveries only — nothing to bill" |
| 9 | Stop counts / area label | A re-delivery counts as a bill in the stop line ("2 bills · 1 re-del") and its stop names the trip's area/route |
| 10 | Trip Detail report | Include re-deliveries, marked RE-DEL |
| 11 | Reasons | CHECK: `site_closed`, `wrong_dispatch`. Note optional |
| 12 | Hand trips | Truck trips only in v1 |
| 13 | Who adds / removes | Floor canEdit. No new tick |
| 14 | Live feed | ON → 3 triggers in the same SQL |
| 15 | Outcomes | Not in v1. Driver app adds columns later |

---

## 3. Data model

### 3.1 `trip_redeliveries`

| Column | Type | Rule |
|---|---|---|
| `id` | serial PK | |
| `tripId` | int NOT NULL → trips | RESTRICT |
| `tripDropId` | int NOT NULL → trip_drops | RESTRICT |
| `orderId` | int NOT NULL → orders | RESTRICT |
| `obdNumber` | text NOT NULL | snapshot |
| `invoiceNo` | text NULL | snapshot; display reads live `orders.invoiceNo` |
| `attemptNo` | int NOT NULL | CHECK `>= 2` |
| `prevTripId` | int NULL → trips | Orbit trip of the previous attempt; null if none |
| `reason` | text NOT NULL | CHECK in `site_closed`, `wrong_dispatch` |
| `note` | text NULL | |
| `confirmedReturn` | boolean NOT NULL default false | the same-day tick was given |
| `createdAt`, `createdById` → users, `updatedAt` | | |

- UNIQUE `trip_redeliveries_trip_order_key` (`tripId`, `orderId`) — a real unique (rows are deleted on remove, so no partial index needed). Modelled as `@@unique` in Prisma.
- Indexes (`tripDropId`), (`orderId`).
- Two FKs to `trips` → named Prisma relations on all sides.
- `tripId` / `tripDropId` always written from the same drop row (landmine note).
- No status column in v1.

### 3.2 Same SQL file
- `chk_trip_activity_action` → 16 values (+ `redelivery_added`, `redelivery_removed`), `_v2` fence pattern, read-back.
- `trg_live_changes_trip_redeliveries_{ins,upd,del}` copied from the `trip_drops` triggers, `('trip','parent','tripId')`.
- Schema version minted in CORE in the same commit. **SQL runs before code deploys.**

---

## 4. The flow

### 4.1 Add
1. Opened trip → stops bar → **Re-delivery** (beside "+ Add bills"). Hidden on Hand, cancelled, dispatched trips.
2. Dialog: one box "OBD or invoice no."
3. One OBD → one card: customer, OBD, invoice, stage, **Earlier trips** (Orbit only), "This will be attempt N".
   An invoice with several OBDs → one line per OBD with a tick box, each with its own attempt / warning / refusal.
4. Refusals (bill can't be ticked / Add disabled): not gone out, already on this trip, removed, Hand trip.
   Warning: latest attempt today or later → "Truck came back" tick.
5. Reason pill + optional note → **Add re-delivery** (adds every ticked bill).
6. Server re-checks each bill, finds-or-creates the stop, writes one row per bill and **one** `redelivery_added` activity row per press. No `orders` write.

### 4.2 On the trip
- The re-delivered bill appears **in the stop's normal bill table**, built from `TripDetail` re-delivery data, with a **RE-DEL** chip in the OBD cell (warn colour). Row key is `rd:<id>`, never the plain order id.
- Clicking the RE-DEL chip opens a read-only **info modal**: customer, OBD, invoice, attempt N, reason, note, earlier Orbit trips with dates, added by / when, "Truck came back" confirmed (if given).
- Stop header "2 bills · 1 re-del"; rail card "+1 re-del".

### 4.3 Remove (like any bill)
- Tick the RE-DEL row → bottom bar → **Remove from trip**.
- 🔴 **Safety rule:** if any ticked row is a re-delivery, the bottom bar offers **only Remove from trip**. Hold, cancel, release, change slot and every other bill action are hidden — they would change the real bill.
- The client splits the selection: normal bills → existing `bills` remove; RE-DEL rows → new redelivery remove (deletes the rows, one `redelivery_removed` activity row). Stop is deleted if it now holds no bill and no re-delivery.
- **Root fix in the same build:** the existing bills remove route checks that each bill's stop belongs to the trip in the URL (closes FLOOR_TRIPS open item 4 / landmine 8), so even a wrong call can never strip a bill off its first trip.

### 4.4 Trip cancel
Rows kept; OBDs listed in the activity row; nothing else.

### 4.5 Desk
No carry rule change.

---

## 5. Changes to existing code

| # | File | Change |
|---|---|---|
| 1 | `lib/trips/find-bill.ts` (new) | Extract from `lookup/route.ts`; pure refactor |
| 2 | `lib/trips/drop.ts` (new) | Extract `findOrCreateTripDrop` from `bills/route.ts`, using `effectiveCustomerId()`; same refactor commit |
| 3 | `app/api/floor/trips/[id]/bills/route.ts` | Remove: (a) bill's stop must belong to this trip; (b) empty-stop delete also counts re-deliveries |
| 4 | `app/api/floor/trips/[id]/cancel/route.ts` | List re-delivery OBDs in the activity row |
| 5 | `lib/trips/queries.ts` | `redeliveries[]` per drop with the fields FloorTable needs; `redeliveryCount` on `TripSummary`; area label counts re-delivery stops; history/attempt ignore cancelled trips |
| 6 | `lib/trips/activity.ts` + `schema.prisma` | 2 actions + writers; fix stale CHECK comment |
| 7 | `lib/trips/redelivery.ts` (new) | Eligibility, latest-attempt check, history + attempt (Orbit only), add (multi), remove (delete) |
| 8 | `app/api/floor/trips/[id]/redeliveries/route.ts` (new) | GET search (canView); POST add / remove (canEdit) |
| 9 | `components/floor/` | Re-delivery button + dialog; RE-DEL chip + info modal; rows merged into the stop table with `rd:` keys; bottom bar restriction; selection split on remove; header/rail counts |
| 10 | `lib/reports/trip-detail-data.ts` | RE-DEL marked rows |

---

## 6. Build order
1. Mockup revision → review.
2. SQL → read-back → `schema.prisma` → `npx prisma generate`.
3. Refactor commit (1–2) + remove-route guard (3a), tsc clean.
4. Server commit (3b–8).
5. UI commit (9–10).
6. Hand smoke test by Smart Flow.

---

## 7. Parked for ROADMAP
- Driver app outcomes (delivered / came back), CI link, re-picking.
- Trip dispatch writes after 15 Sep: 45 trips at `dispatched`, last app dispatch log 2026-09-18 04:27 UTC — canon says no caller since 2026-09-15. Needs its own discovery.
- Canon gaps from discovery (lookup route, `isHand`/`vehicleSize`, gate-ON rule, live change feed).
- 125 empty `trip_drops` rows.

---

*web-update-2026-10-03-trip-redelivery.md · rev 5 · decision draft · not built*
