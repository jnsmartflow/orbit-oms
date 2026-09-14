# Floor trip feature — discovery report

Read-only. No code was changed to produce this. Every claim below cites a file and a line.

---

## 0. First, a naming note

There is nothing called "floor to floor" in this repo. A case-insensitive search for
`floor[ _-]?to[ _-]?floor` across `app/`, `lib/`, `components/`, `docs/` and `prisma/`
returns no matches.

The feature you mean is **the trip desk on `/floor`**. That is the name the code uses:
`components/floor/trip-desk.tsx:3` calls itself "THE TRIP DESK". This report describes that.

---

## 1. Data model

### The three tables

**`trips`** — `prisma/schema.prisma:3217-3262`. One row per planned load.

| Column | Line | Note |
|---|---|---|
| `tripNumber` | 3219 | Unique. Shape `L-260914-01`, enforced by a CHECK. See §6. |
| `tripDate` | 3220 | A `@db.Date`, not a timestamp. |
| `typeCode` | 3221 | One letter. `L`, `U`, `I`, `C`. |
| `seq` | 3223 | The number within a date and type. |
| `deliveryTypeId` | 3222 | FK to `delivery_type_master`. Decides the letter. |
| `dispatchWindowId` | 3225 | Nullable. The time slot. A trip can have none. |
| `vehicleId` / `adhocVehicleNo` | 3229, 3231 | Either one or neither, never both. |
| `driverName` / `driverPhone` | 3232-3233 | **Snapshotted at build time**, not read through the FK. `app/api/floor/trips/route.ts:195-197` copies them. The reason is at `route.ts:108-112`: a sheet printed last week must keep saying who actually drove. |
| `status` | 3236 | Default `"draft"`. |
| `releasedAt` / `releasedById` | 3237-3239 | |
| `dispatchedAt` / `dispatchedById` | 3240-3242 | |
| `cancelledAt` / `cancelledById` | 3243-3245 | |

Indexes: `trips_date_idx`, `trips_status_idx`, `trips_vehicle_idx` (3257-3259). Unique on
`[tripDate, typeCode, seq]` (3255).

**`trip_drops`** — `prisma/schema.prisma:3312-3343`. One row per **stop**, not per bill.

A drop is a customer. Two bills for one shop are one stop. That rule is stated at
`lib/trips/drop-key.ts:3-6` and enforced in the database by `chk_trip_drops_key`, which
computes `dropKey` as `'c:' || customerId` when a customer is resolved and `'s:' || shipToCode`
otherwise (`drop-key.ts:11-17`, verified live against `pg_constraint`).

The `c:` / `s:` prefixes exist because `customerId` 1856 and a SAP ship-to code of "1856" are
different id spaces (`drop-key.ts:19-24`).

Two uniques, answering different questions (`schema.prisma:3331-3334`):

- `[tripId, dropKey]` — the stop's identity.
- `[tripId, dropSeq]` — the stop's position.

`tripId` cascades on delete (3315).

**`orders.tripDropId`** — `prisma/schema.prisma:1062-1063`. Nullable FK, `ON DELETE SET NULL`.
This is the only link from a bill to a trip. There is no direct `orders.tripId`.

### How a bill reaches a trip

`orders.tripDropId` → `trip_drops.id` → `trip_drops.tripId` → `trips.id`.

Every reader walks it in that order with batched `IN` lists, never a Prisma `include` chain.
Example: `app/api/floor/trips/[id]/dispatch/route.ts:106-117` reads drops, then reads orders
by `tripDropId: { in: [...] }`.

### The trip number

`lib/trips/number.ts` owns it and nothing else.

- The letter comes from a hardcoded map at `number.ts:60-65`:
  `Local → L`, `Upcountry → U`, `IGT → I`, `Cross → C`.
- An unmapped delivery type **throws** rather than guessing (`number.ts:77-86`). The route
  catches that and returns a 400 (`app/api/floor/trips/route.ts:183-189`).
- Format is `{letter}-{YYMMDD}-{seq padded to 2}` (`number.ts:122-124`).
- `seq` is `max(seq) + 1` for that date and type (`number.ts:171-186`).
- On a unique collision the insert is retried **once**, not in a loop (`number.ts:203-213`).
  The reasoning is at `number.ts:189-199`: a loop would hang a serverless function.

---

## 2. Status values

### Trip status — `trips.status`

The database CHECK, read live from `pg_constraint`:

```
chk_trips_status CHECK (status = ANY (ARRAY['draft','released','loading','dispatched','cancelled']))
```

Mirrored as a comment at `prisma/schema.prisma:3149`.

| Value | Written by | Read by |
|---|---|---|
| `draft` | `app/api/floor/trips/route.ts:237` at creation | everywhere |
| `released` | `app/api/floor/trips/[id]/release/route.ts:339-340` | everywhere |
| `loading` | **nothing** — see §6 | `components/floor/floor-board.tsx:649`, `components/floor/trip-rail.tsx:60` |
| `dispatched` | `app/api/floor/trips/[id]/dispatch/route.ts:150-154` | everywhere |
| `cancelled` | `app/api/floor/trips/[id]/cancel/route.ts:190-194` | everywhere |

Live counts on production right now: 48 `cancelled`, 29 `released`, 6 `draft`. Zero
`dispatched`, zero `loading`.

> 🔴 **Out of date — slice 1 (2026-09-14) removed `loading` from the code.** The `Read by`
> column above is now empty: `floor-board.tsx:649` lost its `|| t.status === "loading"` term and
> `trip-rail.tsx:60` lost its `STATE_META` entry. **The report also missed a third site** —
> `trip-band.tsx:40` carried its own `STATE_META` with a bare `loading:` key, which the original
> grep did not match because the key is unquoted. That entry is gone too.
>
> ⚠ **The CHECK constraint quoted above is still accurate.** The DDL is not run from this
> repo (schema writes go through the Supabase SQL Editor), so the live constraint still admits
> `loading` until the `ALTER` in slice 1's handover is applied. Code first, constraint second,
> deliberately — the reverse order would let a live row fail a write.

Two CHECK constraints tie a status to its stamps, verified live:

```
chk_trips_cancelled_complete  status <> 'cancelled'  OR (cancelledAt  IS NOT NULL AND cancelledById  IS NOT NULL)
chk_trips_dispatched_complete status <> 'dispatched' OR (dispatchedAt IS NOT NULL AND dispatchedById IS NOT NULL)
```

There is **no** equivalent for `released`. See §6.

### Bill stage — `orders.workflowStage`

Plain strings, no Prisma enum. The constants live in `lib/workflow-stages.ts`:

| Constant | Line | Value |
|---|---|---|
| `SUPPORT_DONE_OUTPUT` | 61 | `"pending_picking"` |
| `PICK_ASSIGNED` | 87 | `"pick_assigned"` |
| `PICK_DONE` | 90 | `"pick_done"` |
| `PICK_CHECKED` | 93 | `"pick_checked"` |
| `DISPATCHED` | 109 | `"dispatched"` |

`"pending_support"` is the rail stage, used by name at `lib/floor/release-stages.ts:21`.

> ⚠ **Out of date — see section 8.1.** Calling this "the rail stage" described the design, not
> the live data. 143 bills sit there today and **every one of them is on hold**; the rail
> predicate itself (`pending_support` with a null `dispatchStatus`) matches **zero** bills. The
> stage is now where held bills rest, not where new bills wait.

### Bill dispatch decision — `orders.dispatchStatus`

Three values appear in trip code: `"dispatch"`, `"hold"`, and `null`.

- `"dispatch"` is written by release (`lib/floor/release.ts:184`).
- `"hold"` outranks every stage in the trip counters (`lib/trips/queries.ts:189`) and blocks
  dispatch outright (`lib/floor/dispatch.ts:160`).

### Trip counter buckets

`bucketFor` in `lib/trips/queries.ts:184-209` maps one bill to one bucket:

| Test | Line | Bucket |
|---|---|---|
| `dispatchStatus === "hold"` | 189 | `held` — **tested first, outranks stage** |
| stage `pending_picking` | 190 | `waiting` |
| stage `pick_assigned` | 191 | `withPicker` |
| stage `pick_done` | 192 | `picked` |
| stage `pick_checked` **or** `dispatched` | 206 | `checked` |
| anything else | 207 | `other` |

The `dispatched → checked` fold is deliberate and explained at `queries.ts:193-205`: a shipped
bill did not stop being finished by leaving.

`isReady` is at `queries.ts:420-423`:

```
counts.total > 0 && counts.total - counts.held > 0 && counts.checked === counts.total - counts.held
```

Holds are out of the denominator. The reason is at `queries.ts:412-419`: one hold used to pin a
finished load open forever.

---

## 3. State machine

### Transitions

| From | To | Route | Guard | Also writes |
|---|---|---|---|---|
| — | `draft` | `POST /api/floor/trips`, `route.ts:220-239` | none | number allocated, driver snapshotted |
| `draft` | `released` | `POST .../[id]/release`, `route.ts:336-341` | not `cancelled`, not `dispatched` (`:122-125`); trip must have bills (`:166-168`) | `releasedAt`, `releasedById` on the first release only |
| `released` | `released` | same route | same | re-runnable; the status write is a no-op |
| `released` | `dispatched` | `POST .../[id]/dispatch`, `route.ts:150-154` | not `cancelled` (`:84`); already-`dispatched` is a silent no-op (`:90-102`); trip must have bills (`:119-124`) | `dispatchedAt`, `dispatchedById`. **Only fires when nothing is left** — see below |
| `draft` or `released` | `cancelled` | `POST .../[id]/cancel`, `route.ts:190-194` | not already `cancelled` (`:82`); not `dispatched` (`:92`); **refused if any bill on it is already `dispatched`** (`:137-146`) | `cancelledAt`, `cancelledById`; every bill's `tripDropId` set to `null` (`:169`) |
| anything | `loading` | **no route** | — | — |

### The closing test

`dispatch/route.ts:139-157`. After bills move, the route re-counts:

```
orders where tripDropId IN drops, isRemoved false,
             workflowStage <> 'dispatched',
             dispatchStatus <> 'hold'
```

If that count is zero, the trip closes. Held bills count as settled. The reason is at
`dispatch/route.ts:41-46`: a hold is a human saying "not this one", and a load that has
otherwise gone should not sit open.

The count only runs when something actually moved (`:139`).

### Diagram

```
                    POST /api/floor/trips
                             |
                             v
                        +---------+
                        |  draft  |<---- bills added / removed
                        +----+----+      POST .../[id]/bills
                             |
             POST .../[id]/release
       (writes releasedAt + releasedById once)
                             |
                             v
                     +--------------+
        +----------->|   released   |<---- still add / remove bills
        |            +------+-------+      still re-release
        |                   |
        |   POST .../[id]/dispatch   <- pressed repeatedly through the day
        |   moves pick_checked bills -> workflowStage 'dispatched'
        +-------------------+
                            |  only when NOTHING is left
                            |  that is neither dispatched nor held
                            v
                     +--------------+
                     |  dispatched  |   terminal. no route edits it.
                     +--------------+

        +----------+
        | loading  |   defined by the CHECK. nothing writes it. See section 6.
        +----------+

   draft or released --> POST .../[id]/cancel --> +-----------+
   (refused if any bill already dispatched)       | cancelled |  terminal
   detaches every bill: tripDropId = null         +-----------+
```

### What each press does to the bills

**Release** — `lib/floor/release.ts:179-199`. For each eligible bill, one `orders.update`
setting `dispatchTargetDate`, `dispatchWindowId`, `dispatchStatus: "dispatch"`,
`workflowStage: "pending_picking"`, `dispatchSlotSource: "manual"`, plus exactly one
`order_status_logs` row.

Eligible means the stage is in `FLOOR_RELEASABLE_STAGES` (`release.ts:173`), which is exactly
two values (`lib/floor/release-stages.ts:16-29`):

- `pending_support` — the classic rail release. **Out of date: see section 8.1.** No bill on
  any trip is at this stage, and the only bills anywhere at it are held ones.
- `pending_picking` — a bill auto-dispatched to the floor and then held. Without this entry
  such a bill could never leave Hold (`release-stages.ts:24-28`).

The slot is required for this write. A trip with no `dispatchWindowId` still releases; the
bills that would have moved come back in a `needsSlot` bucket instead (`release/route.ts:204`,
reasoning at `:57`).

**Dispatch** — `lib/floor/dispatch.ts:142-190`. Per bill, in order:

| Test | Line | Outcome |
|---|---|---|
| missing or `isRemoved` | 146 | `failed` |
| already `dispatched` | 153 | `alreadyDispatched` — no write |
| `dispatchStatus === "hold"` | 160 | `held` — no write |
| stage is not `pick_checked` | 166 | `notChecked` — no write |
| otherwise | 173-190 | `workflowStage: "dispatched"` plus one `order_status_logs` row |

It does **not** touch `dispatchStatus` or `tripDropId` (`dispatch.ts:51-56`).

**Cancel** — `cancel/route.ts:169` sets `tripDropId: null` on every bill. It writes **no**
`order_status_logs` rows (`:38`).

**Add / remove bills** — `POST .../[id]/bills`.

- Refused entirely when the trip is `cancelled` or `dispatched` (`bills/route.ts:85-90`).
- Add: computes the drop key, finds or creates the stop, snapshots the customer name, area and
  route onto the drop (`:148-215`). A bill already on another trip is **refused, not moved**
  (`:156-172`).
- `dropSeq` is `max + 1`, never `count + 1`, and gaps are left alone (`:177-186`).
- Remove: sets `tripDropId: null`, then deletes the drop if no bills remain on it
  (`:126-143`).

---

## 4. Buttons and screens

### The screen

`/floor` → `app/(floor)/floor/page.tsx:5-7`, a thin shell rendering
`components/floor/floor-page.tsx`. The trip desk itself is `components/floor/trip-desk.tsx`,
which is the shell for all four tabs (`trip-desk.tsx:612-619` — the rail renders on every tab).

The rail (`components/floor/trip-rail.tsx:13-17`) shows:

- **"To plan"** — the pool of undecided bills. The default selection.
- one card per trip, grouped under its slot label, with a **"No slot yet"** group for trips
  that have none.

### The wording switch

`lib/floor/trip-wording.ts:39-84`. One boolean, `gateOn`, changes three strings. `gateOn` comes
from the picking-visibility gate, owned in `components/floor/floor-page.tsx:224-225`.

| | `gateOn` true | `gateOn` false (today) |
|---|---|---|
| draft button | "Release to floor" | **"Confirm plan"** |
| status chip | "Released" | "Confirmed" |
| caption | none | "The floor can see these bills. Dispatch them as they are checked." |

"Confirm plan" is frozen by an owner decision (`trip-wording.ts:48-49`). The chip stays
"Confirmed" rather than "Dispatched" because the trip row genuinely has not reached the
`dispatched` status (`trip-wording.ts:69-75`).

> 🔴 **Out of date — slice 1 (2026-09-14) deleted the switch.** `tripWording` no longer takes
> `gateOn` and returns ONE fixed set. The `gateOn` column of the table above is gone: the button
> is always "Confirm plan", the chip always "Confirmed", and **the caption row was deleted
> outright with nothing replacing it.** The toast verb at `floor-page.tsx` was frozen to
> "confirmed" in the same slice, for the same reason — it named the press, and a press whose
> label no longer moves should not have a toast that does.
>
> ⚠ **The switch itself is untouched and still live.** Only the trip LABELS stopped tracking it.
> Section 7.2 lists its other readers; `desk-pool.tsx:119`, `trip-band.tsx:241`,
> `floor-table.tsx:829`, `floor-page.tsx:1832` and the "N shown to pickers" clause all still
> change with the gate, because those say different things about two states that genuinely
> differ.

### Buttons on the trip band (the collapsed card)

`components/floor/trip-band.tsx:262-296`. Always visible, open or closed (`:252-255`).

| Button | Condition | Line |
|---|---|---|
| Confirm plan / Release to floor | `isDraft && onRelease`, disabled at zero bills | 263-275 |
| Add bills | `onAddBills` | 276-280 |
| Change vehicle | `onChangeVehicle` | 281-286 |
| Cancel trip | `onCancelTrip`, red text | 287-296 |

No actions at all on a cancelled or dispatched trip (`:250`).

### Buttons on the detail panel header

`components/floor/trip-detail-header.tsx:222-300`. The whole row is hidden when
`isClosed || readOnly` (`:222`).

| Button | Condition | Line |
|---|---|---|
| Confirm plan / Release to floor | `isDraft`, disabled at zero bills | 224-238 |
| **Mark dispatched (N)** | `!isDraft && onDispatch`, disabled when N is 0 | 258-271 |
| Add bills | always | 273-275 |
| Change vehicle | always | 276-278 |
| **Reorder stops** | always, **permanently disabled** | 285-291 |
| Cancel trip | always, red text | 292-298 |

**Mark dispatched** is the newest press, added 2026-09-14. Its count is
`Math.max(0, trip.counts.checked - trip.dispatchedCount)`. It is deliberately always rendered
on a released trip and disabled at zero rather than hidden (`trip-detail-header.tsx:247-252`):
it is pressed repeatedly through the day and must stay in the same place.

**Reorder stops** is rendered disabled on purpose. There is no route that writes
`trip_drops.dropSeq` (`trip-detail-header.tsx:280-282`). Stop order is the order bills were
added.

> 🔴 **Out of date — slice 1 (2026-09-14) deleted the button.** The row in the table above and
> this paragraph both describe a button that no longer renders. Nothing replaced it, and stop
> order is still the order bills were added. The underlying gap is unchanged: no route writes
> `trip_drops.dropSeq`. Section 6, item 6 carries the same flag.

### Creating a trip

`components/floor/build-trip-drawer.tsx`. Opens from the pool with the ticked rows. The
**"Create trip"** button (`:362-369`) makes two calls in sequence:

1. `POST /api/floor/trips` (`:134-135`)
2. `POST /api/floor/trips/{id}/bills` (`:157-158`)

It does not release. `build-trip-drawer.tsx:24` says so in as many words.

### Adding bills to an existing trip

`components/floor/floor-bottom-bar.tsx:130-160`. A select, labelled **"Add to trip"**
(`:146`), with "New trip…" at the bottom of the list (`:12`).

### Wiring

`components/floor/floor-page.tsx:748` is the only caller of the dispatch endpoint. It reaches
the button through `trip-desk.tsx:555` → `trip-detail-header.tsx:261`.

### The seven API routes

| Route | File |
|---|---|
| `GET` / `POST` `/api/floor/trips` | `app/api/floor/trips/route.ts` |
| `GET` / `PATCH` `/api/floor/trips/[id]` | `app/api/floor/trips/[id]/route.ts` |
| `POST /api/floor/trips/[id]/bills` | `app/api/floor/trips/[id]/bills/route.ts` |
| `POST /api/floor/trips/[id]/release` | `app/api/floor/trips/[id]/release/route.ts` |
| `POST /api/floor/trips/[id]/dispatch` | `app/api/floor/trips/[id]/dispatch/route.ts` |
| `POST /api/floor/trips/[id]/cancel` | `app/api/floor/trips/[id]/cancel/route.ts` |
| `GET /api/floor/trips/options` | `app/api/floor/trips/options/route.ts` |

### The lib files

| File | Owns |
|---|---|
| `lib/trips/number.ts` | the trip number and nothing else |
| `lib/trips/drop-key.ts` | which stop a bill belongs to. Pure, no Prisma |
| `lib/trips/live-trips.ts` | which trips a desk shows. One definition, two callers |
| `lib/trips/queries.ts` | `getTripsForDate`, `getTripDetail`, `bucketFor`, `isReady` |
| `lib/floor/release.ts` | `releaseBillsToFloor`, shared with `POST /api/floor/release` |
| `lib/floor/release-stages.ts` | `FLOOR_RELEASABLE_STAGES` |
| `lib/floor/dispatch.ts` | `markBillsDispatched` |
| `lib/floor/trip-wording.ts` | the gate-dependent strings. Pure |

### Which trips appear on the desk

`lib/trips/live-trips.ts` holds the one definition:

```
tripsOnDeskWhere(deskDate) = tripDate = deskDate OR (status = 'draft' AND tripDate < deskDate)
```

So today's trips, plus every open draft from any earlier day. `getTripsForDate` uses it
(`lib/trips/queries.ts:481`) and so does the board's fourth arm. The comment at
`queries.ts:473-480` records why: the two spellings had drifted, and the board was refusing the
bills of 22 carried drafts on 2026-09-13.

There is no lower date bound. That is a known characteristic, not an oversight — an open draft
is visible on the rail and someone can cancel or confirm it.

---

## 5. Who can do what

Everything hangs off one page key, `floor`, checked with `checkAnyPermission`.

Live grants, read from `role_permissions` on production:

| Role | canView | canEdit |
|---|---|---|
| `admin` | yes | yes |
| `operations` | yes | yes |
| `floor_access` | yes | yes |

No other role has any grant on `floor`. No role in production has view without edit, so the
`canView` / `canEdit` split below is currently a distinction without a difference.

### Gate per entry point

| Entry point | Gate | Line |
|---|---|---|
| the `/floor` page itself | `floor` + `canView`, else redirect to `/unauthorized` | `app/(floor)/floor/layout.tsx:35-36` |
| `GET /api/floor/trips` | `floor` + **`canEdit`** | `app/api/floor/trips/route.ts:66` |
| `POST /api/floor/trips` | `floor` + `canEdit` | `app/api/floor/trips/route.ts:123` |
| `GET /api/floor/trips/[id]` | `floor` + `canView` | `app/api/floor/trips/[id]/route.ts:32` |
| `PATCH /api/floor/trips/[id]` | `floor` + `canEdit` | `app/api/floor/trips/[id]/route.ts:116` |
| `POST .../[id]/bills` | `floor` + `canEdit` | `app/api/floor/trips/[id]/bills/route.ts:50` |
| `POST .../[id]/release` | `floor` + `canEdit` | `app/api/floor/trips/[id]/release/route.ts:91` |
| `POST .../[id]/dispatch` | `floor` + `canEdit` | `app/api/floor/trips/[id]/dispatch/route.ts:62` |
| `POST .../[id]/cancel` | `floor` + `canEdit` | `app/api/floor/trips/[id]/cancel/route.ts:60` |
| `GET /api/floor/trips/options` | `floor` + **`canEdit`** | `app/api/floor/trips/options/route.ts:46` |

There is no admin-only trip action. The dispatch route says so explicitly
(`dispatch/route.ts:48-50`).

### What PATCH can change

`app/api/floor/trips/[id]/route.ts:149-192` builds the update from six optional fields only:
`vehicleId`, `adhocVehicleNo`, `transporterId`, `dispatchWindowId`, `note`,
`transporterTripNo`. **Status is not one of them.** A cancelled trip refuses PATCH entirely
(`:144-145`).

### Who is stamped

The actor is always taken from the session, never from the request body
(`dispatch/route.ts:65-71`, `cancel/route.ts:65-68`, `release/route.ts:95-98`). A non-integer
session user id is a 500, because the CHECK constraints need a real id.

---

## 6. Confusing or broken bits

### 1. The number CHECK will reject the 100th trip of a day — confirmed

`lib/trips/number.ts:122-124` pads with `String(seq).padStart(2, "0")`, which widens and never
truncates. Seq 137 renders `137`. The comment at `number.ts:113-121` states this is deliberate
and that "both halves must agree".

They do not. The live CHECK is:

```
chk_trips_number_shape CHECK ("tripNumber" = "typeCode" || '-' || to_char("tripDate",'YYMMDD') || '-' || lpad(seq::text, 2, '0'))
```

Postgres `lpad` **truncates on the right** when the string is already longer than the width. I
ran it against production:

| expression | result |
|---|---|
| `lpad('7',2,'0')` | `07` |
| `lpad('137',2,'0')` | `13` |
| `lpad('100',2,'0')` | `10` |

So at seq 100 the application writes `L-260914-100` and the constraint computes `L-260914-10`.
The insert is rejected. The route turns that into a 400 reading "Could not create the trip"
(`app/api/floor/trips/route.ts:255-258`), which tells the planner nothing useful.

Not reachable yet. The highest `seq` in production is 21, on `L` for 2026-09-12. But the code
comment claims the two halves agree, and they do not, so a future reader will trust the wrong
thing.

### 2. `loading` is a status nothing can ever produce

`chk_trips_status` admits it. Two components render it:
`components/floor/trip-rail.tsx:60` gives it an amber "Loading" chip, and
`components/floor/floor-board.tsx:649` treats it as an open trip alongside `draft` and
`released`. No route writes it. A search for the literal across `app/`, `lib/` and `components/`
finds only React loading flags and those two reads.

Production has zero rows at `loading`.

The likely intent is the loading screen the wording file calls "a few weeks out"
(`lib/floor/trip-wording.ts:56-57`), but that is an inference from a comment. **Unclear**
whether the value is reserved deliberately or left over.

> 🔴 **Acted on — slice 1 (2026-09-14).** The decision went the other way: the value was
> removed rather than kept reserved. All three code sites are gone (the two named here plus
> `trip-band.tsx:40`, which this item missed), and the `ALTER` dropping it from
> `chk_trips_status` is handed over separately because schema writes do not run from this repo.
> If the loading screen is ever built, the value returns to the CHECK and to both `STATE_META`
> maps together — both files now carry a comment saying so.

### 3. A stale comment claims the type-code CHECK refuses `C`

`app/api/floor/trips/route.ts:252-254` says "chk_trips_type_code refuses 'C' today — Cross has
no letter in the format yet".

The live constraint is:

```
chk_trips_type_code CHECK ("typeCode" = ANY (ARRAY['L','U','I','C']))
```

`C` is admitted, and `lib/trips/number.ts:63` maps `Cross → C`. The comment is wrong.

### 4. `released` has no completeness CHECK, and the route uses that

`cancelled` and `dispatched` each have a CHECK forcing their `At` and `ById` columns to be set.
`released` has none.

> 🔴 **The second half of this item was wrong. Corrected in section 8.3.** I wrote that a
> release which moved no bill advances the trip while omitting the stamps. It does not. The
> branch at `release/route.ts:335-341` tests whether the trip was **already** released, not
> whether anything was written, so a first press always writes status and both stamps together.
> Live check: **0 of 29** released trips are missing either stamp.

What stands: there is genuinely no `chk_trips_released_complete`, so the database does not
forbid a `released` row with a null stamp. No code path produces one, and none exists in
production — the gap is theoretical rather than live.

### 5. Two different things share the word "dispatch"

- `trips.status = 'dispatched'` means the trip row is closed out.
- `orders.dispatchStatus = 'dispatch'` means "this bill is going out", and it is written by
  **release**, not by dispatch (`lib/floor/release.ts:184`).
- `orders.workflowStage = 'dispatched'` means the bill has physically gone.

So pressing "Confirm plan" sets a column called `dispatchStatus` to `dispatch` on every bill
while dispatching nothing. `lib/floor/dispatch.ts:54-56` flags this directly: `dispatch` is a
decision, not an event. It is a genuine trap for a new reader.

### 6. "Reorder stops" is a permanently disabled button

`components/floor/trip-detail-header.tsx:285-291`. Rendered on every open trip, always
disabled, titled "Not built yet". The comment at `:280-282` says it was rendered rather than
omitted so the gap stays visible. Whether that is still the right call now that it has shipped
is a judgement, but a button that never works deserves a decision.

> 🔴 **Decided — slice 1 (2026-09-14) deleted it.** The button and its comment are gone from
> `trip-detail-header.tsx`. The gap it was pointing at is still open: no route writes
> `trip_drops.dropSeq`, and reordering stops remains unbuilt.

### 7. Cancel writes no audit trail on the bills

`cancel/route.ts:38` states it: the trip carries `cancelledAt` and `cancelledById`, but
detaching a bill from a trip writes no `order_status_logs` row. Bills silently lose their
`tripDropId`. With 48 cancelled trips in production, there is no per-bill record of when any of
them left a load.

### 8. Two GET routes gated on `canEdit`

`GET /api/floor/trips` (`route.ts:66`) and `GET /api/floor/trips/options` (`options/route.ts:46`)
both require `canEdit`, while `GET /api/floor/trips/[id]` requires only `canView`
(`[id]/route.ts:32`). Reading the trip list needs a write permission; reading one trip does
not. This has no effect today because every granted role has both. **Unclear** whether the
inconsistency is deliberate.

### 9. A stop's customer snapshot can go stale and nothing refreshes it

`bills/route.ts:198-215` copies `customerName`, `areaName` and `routeName` onto the drop when
the stop is **created**. Adding a second bill to an existing stop reuses the row and does not
re-read. If the master record changes between the first and second add, the drop keeps the old
name. That may well be the intent, matching the driver-snapshot reasoning at
`trips/route.ts:108-112`, but unlike the driver case there is no comment saying so.

---

## 7. The picking-visibility gate, traced end to end

Read-only. Added on a later pass. Same rules: file and line for every claim, "unclear" rather
than a guess.

### 7.1 Where the switch actually lives

It is **one row in the `app_settings` table**, keyed `"picking.visibilityGate"`
(`lib/picking/visibility-gate.ts:27`). The key is exported as a constant so no caller retypes
it; the comment at `visibility-gate.ts:23-26` explains why a hand-typed key would fail
silently.

It is **not** an env var, **not** a feature-flag file, **not** a role check, and **not** per
user. It is one global boolean that applies to the whole depot at once.

**The reader.** `isPickGateOn()` at `visibility-gate.ts:44-53`. It fails closed to `false` in
four separate ways, listed at `:33-38`: no row, a row with `isEnabled` false, a null read (the
test is `=== true`, not truthy), and a thrown query (caught and swallowed). The reason for the
last one is at `visibility-gate.ts:39-42`: this runs on a 15-second poll, and a database blip
must degrade to the ungated board rather than to an empty screen.

The whole module is **default-OFF**, and `visibility-gate.ts:12-18` calls that asymmetry
deliberate: a missing row must not make the floor's work disappear.

**The API.** `GET` and `POST /api/floor/pick-gate` (`app/api/floor/pick-gate/route.ts`).

- `GET` returns `{ enabled }` (`:37-56`), with `Cache-Control: no-store` so the switch is never
  drawn in the wrong position (`:52-53`).
- `POST` takes `{ enabled: boolean }` and upserts the row (`:89-93`). It requires a strict
  boolean; `"false"` and `0` are rejected with a 400 (`:74-78`).

**Who can change it.** Both verbs require page key `floor` with `canEdit`
(`pick-gate/route.ts:43-44` for GET, `:66-67` for POST). Per section 5, that is exactly three
roles: `admin`, `operations`, `floor_access`.

`pick-gate/route.ts:29-33` states the rule in as many words: `floor_supervisor` must **not** be
able to flip it, because he is the person the gate is applied to, and a switch its own subject
can turn off is not a control. The read is gated the same way on purpose.

**Where it is changed from.** The `/floor` page header. `components/floor/floor-page.tsx:1674`
renders `PickGateToggle`, whose implementation is `components/floor/pick-gate-toggle.tsx`. The
state is fetched at `floor-page.tsx:409-419` and held at `:224-225`. There is no other UI
anywhere that flips it — no admin settings page, no script.

**Its value in production right now.** I read the row directly:

```
id                2
settingKey        picking.visibilityGate
isEnabled         false
updatedById       30
updatedAt         2026-09-14T06:16:23.856Z
```

**The gate is OFF.** It was last changed this morning by user 30, Dhanraj Shah, who holds
`dispatcher`, `logistics` and `floor_access` — the last of those is what grants the permission.

Two related live counts, for section 7.3:

| | |
|---|---|
| orders carrying a `pickVisibleAt` stamp | 51 |
| bills at `pending_picking`, not removed | 13 |
| of those, with `pickVisibleAt` null | **13** |

### 7.2 Every read of the gate

I searched `app/`, `lib/` and `components/` for `isPickGateOn`, `countHeldBackWaiting`,
`gateOn`, `gateEnabled` and `pickVisibleAt`. These are all of them.

#### DATA — a query filter changes, so different rows are fetched

| # | Where | What changes |
|---|---|---|
| 1 | `lib/picking/queue.ts:381-383` | The **only** filter change in the codebase. The waiting branch of `buildPickingWhere` becomes `{ workflowStage: SUPPORT_DONE_OUTPUT, pickVisibleAt: { not: null } }` instead of `{ workflowStage: SUPPORT_DONE_OUTPUT }`. Resolved by `getPickingQueue` at `queue.ts:517`. |
| 2 | `app/api/picking/marker/route.ts:112-115` | The 15-second live-sync marker reads the same helper and feeds the same builder, so the marker watches the same set the board renders. The rule is stated at `:109-111`: marker must be a superset of the queue, never a subset. |
| 3 | `lib/picking/visibility-gate.ts:90-103`, `countHeldBackWaiting` | Gate OFF returns `0` **with no query at all** (`:100`). Gate ON runs a count of `workflowStage = pending_picking AND pickVisibleAt IS NULL`. Called at `queue.ts:1007-1011` and `marker/route.ts:164-168`. |

Two deliberate skips on that count: a per-picker fetch returns 0 without a round trip
(`queue.ts:1005-1006`, `marker/route.ts:161-163`), because a held-back bill is unassigned and
can never be one picker's.

**Nothing else in the codebase changes a query.** I checked specifically:

- `app/api/floor/board/route.ts` — no gate term.
- `lib/floor/queries.ts` — no gate term. Line 1008 only serialises `pickVisibleAt` onto the
  row payload for display.
- `app/api/billing/picking/list/route.ts` — no gate term. Its `visibility` import
  (`:6`) is the unrelated Hide feature.

#### VISIBILITY — something appears or disappears

| # | Where | What changes |
|---|---|---|
| 4 | `components/floor/floor-table.tsx:829` | `heldBack={gateOn && isHeldBack(row)}`. Gate off is `false` on every row, so the pill is unchanged. Gate on swaps the status pill's label and colours to "At desk" (`status-pill.tsx:279`, applied at `:311`). No new column (`floor-table.tsx:821-825`). |
| 5 | `components/floor/floor-page.tsx:1832` | The **Show / Send back strip** subtree only exists when `gateOn` is true. Gate off and it does not render at all. |
| 6 | `components/picking/picking-board-mobile.tsx:2907-2912` | The amber **"N more with the planner"** band on the supervisor's board. Rendered whenever `heldBack > 0`, which is only reachable with the gate on. Deliberately inert — no button, because releasing is the desk's job (`:2902-2904`). |
| 7 | `components/floor/pick-gate-toggle.tsx:78-113` | The control itself, three-way: renders **nothing** while the state is unknown (`:78`), a ghost "Desk control off" button when off (`:80-93`), an amber bar reading "Desk control ON · floor sees only what you show" plus "N not shown" plus a Turn off button when on (`:95-113`). |
| 8 | `components/floor/floor-board.tsx:312-319` | `gateOn` is forwarded on **both** arms of the props fork, so the read-only "what he's holding" view shows the same pill. The comment at `:312-316` says why: dropping it on one arm would make the same bill read differently on two views of one board. |

#### WORDING — a label changes, nothing moves

| # | Where | Gate OFF | Gate ON |
|---|---|---|---|
| 9 | `lib/floor/trip-wording.ts:39-84`, draft button | "Confirm plan" | "Release to floor" |
| 10 | `lib/floor/trip-wording.ts`, status chip | "Confirmed" | "Released" |
| 11 | `lib/floor/trip-wording.ts`, caption under the button | "The floor can see these bills. Dispatch them as they are checked." | no caption |
| 12 | `components/floor/desk-pool.tsx:119-121` | "not on a trip yet — floor can already see them" | "not on a trip, floor cannot see them" |
| 13 | `components/floor/floor-page.tsx:661` | toast says "Trip NNN confirmed" | toast says "Trip NNN released" |
| 14 | `components/floor/floor-page.tsx:673` | the "N shown to pickers" clause is omitted | the clause is appended |
| 15 | `components/floor/trip-rail.tsx:114` | rail chip label, via `tripWording` | same |

The trip wording reads the same `gateOn` from `floor-page.tsx:225`, so it is the same switch —
not a second flag that happens to share a name.

### 7.3 The supervisor's picking screens with the gate ON

**The exact filter.** `lib/picking/queue.ts:381-383`:

```js
gateOn
  ? { workflowStage: SUPPORT_DONE_OUTPUT, pickVisibleAt: { not: null } }
  : { workflowStage: SUPPORT_DONE_OUTPUT },
```

`SUPPORT_DONE_OUTPUT` is `"pending_picking"` (`lib/workflow-stages.ts:61`).

**What is hidden.** Every bill at `pending_picking` whose `pickVisibleAt` is null. Nothing
else. The comment at `queue.ts:377-380` confirms the term goes on that branch and nowhere
else.

**What is explicitly never hidden.** `queue.ts:385-393` is a locked owner rule. The in-progress
branch, `{ workflowStage: { in: [PICK_ASSIGNED, PICK_DONE] } }`, is never gated in any state of
the switch, and neither is the checked branch. The stated reason: once a bill is in a picker's
hands, hiding it would strand physical work with no screen saying so.

**The render condition on the tab.** `components/picking/picking-board-mobile.tsx:1558-1559`:

```js
const waitingRows = data ? data.rows.filter((r) => !r.isAssigned && !r.isDone && !r.isChecked) : [];
```

`data.rows` has already been gated server-side, so the Assign tab simply receives fewer rows.
No client-side gate test exists.

**What this would do today.** All 13 waiting bills currently carry a null `pickVisibleAt`.
Flipping the gate on right now would empty the supervisor's Assign tab completely and show the
band reading "13 more with the planner".

**Where the hidden bills go.** They stay exactly where they were, on the desk's own screen.
`/floor` is never gated — `lib/floor/queries.ts` carries no gate term and
`app/api/floor/board/route.ts` carries none. A held-back bill appears on the Floor tab with an
"At desk" pill (`floor-table.tsx:829`) and can be selected and handed over through the Show
strip (`floor-page.tsx:1832-1842`).

So: hidden from the supervisor, visible to the desk, counted for the supervisor on the amber
band. They do not fall into a gap.

### 7.4 What "pending assignment" means in code

**The phrase does not exist in the picking module.** The only matches in the tree are
`app/api/tint/manager/orders/route.ts:121` and `components/tint/tint-table-view.tsx:642-644`,
both of which are the tint manager's own "Pending Assignment" column. That is a different
feature and this gate does not touch it.

The picking equivalent is the **Assign tab**, and it is two conditions in two places:

| Layer | Condition | Line |
|---|---|---|
| server | `workflowStage === "pending_picking"` — the waiting branch of `buildPickingWhere` | `lib/picking/queue.ts:382-383` |
| client | `!r.isAssigned && !r.isDone && !r.isChecked` | `components/picking/picking-board-mobile.tsx:1559` |

No `pick_assignments` row is involved in the server condition. The stage is the whole
definition. A bill at `pending_picking` has, by construction, not been assigned.

**How the gate changes it.** It AND-s one term, `pickVisibleAt: { not: null }`, onto the server
condition only. The client condition is untouched. Nothing about assignment changes, and the
other two branches of the query are untouched.

### 7.5 Picker versus supervisor

**The SUPERVISOR is affected.** Two ways:

- His Assign tab loses every un-stamped waiting bill (`queue.ts:381-383`).
- He gains the amber "N more with the planner" band (`picking-board-mobile.tsx:2907`).

**The PICKER is not affected at all.** Three independent reasons, any one of which is
sufficient:

1. The in-progress branch is never gated (`queue.ts:385-393`). A picker's bills are at
   `pick_assigned` or `pick_done`.
2. The picker face narrows the query by `pickAssignment: { pickerId }`
   (`queue.ts:527-530`), and a waiting bill has no `pick_assignments` row, so it could never
   have reached him regardless.
3. `splitPickerRows` filters on `r.pickerId === viewerId` (`lib/picking/picker-split.ts:123`),
   which drops anything unassigned a second time.

He also never sees the band: `heldBack` is forced to 0 for any per-picker fetch
(`queue.ts:1005-1010`, `marker/route.ts:161-166`).

**The DESK is affected in wording and pills, never in data.** Items 4, 5, 7, 8 and 9 to 15 of
section 7.2.

### 7.6 Honest assessment

**Can the gate make a bill invisible to everyone? No.**

The `/floor` board has no gate term anywhere in its query path. Every bill the gate hides from
the supervisor is still on the desk's screen, wearing a pill that says it is at the desk, in a
selection the desk can act on. I checked the three plausible hiding places
(`app/api/floor/board/route.ts`, `lib/floor/queries.ts`,
`app/api/billing/picking/list/route.ts`) and none of them filters on `pickVisibleAt`.

**Can the same bill show a different status on two screens at once? Yes. Here is the exact
combination.**

**A tint bill whose shades are finished, not yet handed over, with the gate ON.**

Concretely: `orderType = "tint"`, `workflowStage = "pending_picking"`, `pickVisibleAt = null`.
That row's `tintPhase` resolves to `"done"` and `rowStatus` returns `"tintDone"`.

- `isHeldBack()` returns **true**, because it tests `PICKABLE_WAITING`, which is
  `["waiting", "tintDone"]` (`components/floor/status-pill.tsx:60`, used at `:172`).
- So the bill **is** counted in the header's "N not shown" (`floor-page.tsx:1550-1555`) and
  **is** offered in the Show strip's held-back group (`floor-page.tsx:1576`).
- But the pill only swaps when `heldBack && status === "waiting"`
  (`status-pill.tsx:311`). `"tintDone"` is not `"waiting"`, so the row keeps its normal
  "Tint done" pill and never reads "At desk".

The header therefore says the bill is not shown while the row itself says nothing of the kind.

This is precisely the bug class the comment directly above `isHeldBack` warns about
(`status-pill.tsx:165-171`): that comment records widening the test from `=== "waiting"` to
`PICKABLE_WAITING` so tinted bills stopped silently dropping out of the count. The pill swap
one hundred and forty lines below was not widened with it.

Reachable today? The gate is off, so no. It becomes live the moment anyone flips the switch
while a finished tint bill sits unhanded-over.

**One more divergence, this one documented and deliberate.**

Two screens show a "held back" number and they are computed from different sources:

| Screen | Number | Source |
|---|---|---|
| `/floor` header, "N not shown" | counted client-side over the rows already loaded, excluding the `upcoming` zone | `floor-page.tsx:1550-1555` |
| supervisor's board, "N more with the planner" | a server `count()` over the picking scope | `visibility-gate.ts:90-103` |

`floor-page.tsx:1546-1549` states the choice outright: Floor must never call the picking
marker, because two sources for one figure is two figures that can disagree. The consequence is
that the two numbers genuinely can differ, since they are fenced by different scopes. That is a
known trade-off rather than a defect, but anyone comparing the two screens should expect it.

**A third thing worth knowing, not a defect.** The switch and the stamps are fully independent
(`pick-gate/route.ts:18-27`). Turning the gate off clears no `pickVisibleAt`. Right now 51
orders carry a stamp while the gate is off, so those stamps are doing nothing and are invisible
on every screen. Flipping the gate on makes that stored set the visible set immediately,
including any stamp that has gone stale. The independence is deliberate and well argued at
`pick-gate/route.ts:22-27`, but the stored state is not shown anywhere while the gate is off.

---

## 8. The rail, the arrival path, and what Release still does

Read-only, added on a third pass. Two of the three premises this section was asked to check
turned out to be wrong, and one of my own earlier claims did too. All three are corrected here
rather than quietly.

### 8.1 Is the `pending_support` stage dead? No. But the rail is empty.

**The count.** Bills at `workflowStage = 'pending_support'`, `isRemoved = false`, read live:

| | |
|---|---|
| at `pending_support`, not removed | **143** |
| at `pending_support` including removed | 143 |
| of those, with `dispatchStatus = 'hold'` | **143** |
| of those, with `dispatchStatus` null — **the rail predicate** | **0** |
| of those, attached to a trip | 0 |

Created between 2026-08-06 and 2026-09-12. All but one carry no `dispatchTargetDate`.

So the honest answer is not "the rail no longer exists" and not "the stage is dead". It is
narrower and more useful:

> **`pending_support` is alive and holds 143 bills, but every one of them is on hold. The rail
> — undecided bills at `pending_support` with no dispatch status — is empty, and has nothing in
> it to release.**

The rail predicate is stated at `app/api/floor/actions/route.ts:160-161`: rank below 60 plus
`dispatchStatus` null. Zero bills satisfy it.

**Every place that writes `pending_support` onto an order.** Five, not zero:

| File and line | What it is |
|---|---|
| `app/api/import/obd/route.ts:1333-1335` | The manual / confirm import path. The stage a new **non-tint** bill is created at. |
| `app/api/import/obd/route.ts:3307` | The Auto-Import path. Same rule, same line of code repeated. |
| `app/api/floor/actions/route.ts:167` | The `restore` action — a cancelled bill goes back to `pending_support` with `dispatchStatus: null`. This is the one writer that can still put a bill on the rail. |
| `app/api/tint/manager/base-bypass/route.ts:185, 226` | Base bypass writes `pending_support` when the bill is held, `pending_picking` otherwise. |
| `app/api/tint/manager/manual-entry/revert/route.ts:233, 271` | Reverting a manual tint entry. |

Two comments already in the tree say the same thing I measured, in the same words:
`app/api/tint/manager/manual-entry/route.ts:134-142` and
`app/api/tint/manager/manual-entry/lookup/route.ts:70-78` both record that "almost NO bill is at
`pending_support` any more", and both record that a stage test against it would have broken the
tint manual-entry screen.

### 8.2 The current arrival path

Four steps, all inside one import request.

**1. The bill is created.** `app/api/import/obd/route.ts:1333-1335` (manual path) and `:3307`
(Auto-Import path), the same expression in both:

```js
const workflowStage = orderType === "tint" ? "pending_tint_assignment" : "pending_support";
```

So a non-tint bill still lands at `pending_support`. That part of the old design is unchanged.

**2. Mail-order enrichment runs.** Called at `:1413` and `:3382`. When the matching `mo_orders`
row carries `dispatchStatus = 'dispatch'`, one `orders.update` moves the bill to
`pending_picking` with `dispatchStatus: 'dispatch'` (`:473-476`), plus one `order_status_logs`
row noted "Auto-dispatched by enrichment" (`:478-486`). The guard is stage-only:
`workflowStage: "pending_support"` (`:450`).

**3. The no-mail-order fallback runs immediately after.** Called at `:1421` and `:3388`, defined
at `:552`. Added 2026-09-11. It selects anything still at `pending_support` with
`dispatchStatus` null, not tint, not removed (`:566-573`), and writes stage, status and slot in
one update (`:640-648`) with one log row reading "Auto-dispatched on import (no mail order for
this bill)" (`:651-660`).

Its header records why it exists, with the measurement (`:503-510`): over the 30 days to
2026-09-10, **zero of 711** unmatched bills were ever auto-dispatched, while a human released
**861** by hand, median wait one hour and worst wait 32 days. The unmatched bills are the
Project, Offtake and Distributor divisions, which do not order by mail at all (`:512-517`).

**4. Tint bills are released separately**, by the tint routes on completion (`:540-542`).

**Is auto-dispatch now the only path? For a non-tint bill, yes.** Between steps 1 and 3 the
bill passes through `pending_support` inside a single request and does not stop there. The only
bills that persist at that stage are the two categories excluded by construction:

- **held** — `dispatchStatus: null` cannot match `'hold'`, stated at `:544-546`.
- **tint** — excluded at `:566-573` because a bill whose shades are unmade must not reach a
  picker (`:540-542`).

That matches the live data exactly: 143 at `pending_support`, all 143 held, none unheld.

### 8.3 Released trips with no `releasedAt`

**Zero, out of 29.** I checked for either stamp missing, not just `releasedAt`. Every released
trip carries both `releasedAt` and `releasedById`. There is no list to print.

> ⚠ **This corrects section 6, item 4, which was wrong.** I wrote there that when the release
> wrote nothing it still advanced a draft to `released` while omitting the stamps. That is not
> what the code does. The branch at `app/api/floor/trips/[id]/release/route.ts:335-341` tests
> `trip.releasedAt !== null` — whether the trip has **already** been released — not whether
> anything was written this time. A first release always writes status and both stamps together
> (`:340`); a re-run leaves the existing stamps alone, so a catch-up press cannot overwrite who
> released the load (`:330-334`).

What remains true from that item: there is genuinely no `chk_trips_released_complete`
constraint, so nothing in the database *forbids* a `released` row with a null stamp. But no
code path produces one, and none exists in production.

### 8.4 So what does Release / Confirm plan actually still do?

**The bills on every open trip right now**, read live:

| workflowStage | dispatchStatus | count |
|---|---|---|
| `dispatched` | `dispatch` | 136 |
| `pick_checked` | `dispatch` | 64 |

Zero at `pending_support`. Zero at `pending_picking`. `FLOOR_RELEASABLE_STAGES` is
`["pending_support", "pending_picking"]` (`lib/floor/release-stages.ts:16-29`), and neither
stage above is in it, so `releaseBillsToFloor` refuses all 200 (`lib/floor/release.ts:172-176`).

**Every remaining effect, in the order the route runs them:**

| # | Effect | Line | Fires today? |
|---|---|---|---|
| 1 | `releaseBillsToFloor` is called | `route.ts:193-201` | yes, but every bill is refused |
| 2 | Refusals at `pick_checked` / `dispatched` are re-bucketed as `alreadyFinished`, so the press is not reported as a failure | `route.ts:278-281` | yes — this is what stops a 422 |
| 3 | `stampPickVisibility` on `released ∪ alreadyReleased` | `route.ts:221-225` | **no** — both lists are empty, so the function is never called |
| 4 | `trips.update` → `status: 'released'`, plus `releasedAt` and `releasedById` on the first press | `route.ts:336-341` | **yes — this is the only write** |
| 5 | The wording flips: the draft button leaves the band, the chip becomes "Confirmed" | §7.2 items 9-11 | yes, as a consequence of 4 |

**The capabilities that are still in the code but fire on nothing today:**

| # | Effect | Line | Why it does not fire |
|---|---|---|---|
| 6 | **Clears a hold.** A bill at `pending_support` or `pending_picking` with `dispatchStatus: 'hold'` is rewritten to `dispatchStatus: 'dispatch'` and `workflowStage: 'pending_picking'`, with one log row | `release.ts:179-199` | no held bill is attached to any trip — 0 of 143 |
| 7 | **Re-affirms the slot** — `dispatchTargetDate` and `dispatchWindowId` copied from the trip | `release.ts:181-182` | same population as 6 |
| 8 | **Reports `needsSlot`** when the trip has no dispatch window | `route.ts:204-211` | only lists bills that are in `FLOOR_RELEASABLE_STAGES`, so it is empty for the same reason |

`pending_picking` is in the releasable list **only** so that effect 6 can happen — the comment
at `release-stages.ts:24-28` says a held bill could otherwise never leave the Hold tab.

**The blunt answer.** On the trips this depot actually builds, pressing Confirm plan writes one
row in the `trips` table and touches no bill at all. Not "clears holds and nothing else" — it
does not even clear holds, because no held bill is ever on a trip. Its entire bill-level job
applies to two stages that no trip bill is at.

That is not accidental, and the route says so. `route.ts:290-313` records that a trip made
entirely of checked bills is "the NORMAL, EVERYDAY state of a trip on this board", and that the
`alreadyFinished` bucket exists precisely so such a press marks the trip released instead of
failing with "No bill on this trip could be released". The press is a statement about the
**plan**, not about the goods — which is exactly the reasoning `lib/floor/trip-wording.ts:48-49`
gives for freezing the label as "Confirm plan".

---

## 9. Trip history, and who actually needs the slot

Read-only, fourth pass.

### 9.1 What record a trip keeps today

**Every timestamp and actor column on `trips`:**

| Column | Line | Nullable | What it records |
|---|---|---|---|
| `createdAt` | 3246 | no | when the trip was built |
| `createdById` | 3247 | no | who built it (relation at 3248) |
| `releasedAt` | 3237 | yes | first release only |
| `releasedById` | 3238 | yes | who released it (relation at 3239) |
| `dispatchedAt` | 3240 | yes | when the trip closed out |
| `dispatchedById` | 3241 | yes | who closed it (relation at 3242) |
| `cancelledAt` | 3243 | yes | when it was called off |
| `cancelledById` | 3244 | yes | who called it off (relation at 3245) |
| `updatedAt` | 3249 | no | `@updatedAt`, bumps on every write |

That is **four moments**: created, released, dispatched, cancelled. Each is recorded once, and
each has an actor.

**There is no column for anything else.** No `updatedById`. Nothing for a vehicle change,
nothing for a slot change, nothing for a note edit, nothing for bills moving on or off.

**Does any audit or log row get written? Per action:**

| Action | Log row? | Evidence |
|---|---|---|
| **Trip created** | **No** | `app/api/floor/trips/route.ts:220-239` is one `prisma.trips.create` and nothing else follows it. |
| **Vehicle / transporter / slot / note changed via PATCH** | **No** | `app/api/floor/trips/[id]/route.ts:236-241` is one `prisma.trips.update` and nothing else. |
| **Bills added or removed** | **No, deliberately** | `app/api/floor/trips/[id]/bills/route.ts:32-38` states it outright: no `order_status_logs` row for attach or detach, because the trips table carries its own stamps and a per-bill row on a high-frequency action would bury the events people read back. |
| **Release** | One row **per bill that actually moved** | `lib/floor/release.ts:191-199`. Per section 8.4, no bill on any live trip is in a releasable stage, so today this writes **zero** rows. |
| **Dispatch** | One row per bill moved | `lib/floor/dispatch.ts:182-190`. |
| **Cancel** | **No rows at all** | `app/api/floor/trips/[id]/cancel/route.ts:38`. |

I searched `app/api/floor/trips/` and `lib/trips/` for `order_status_logs`, `admin_audit_log`
and `auditLog`. Every match is a comment explaining why a row is *not* written. There is no
audit write anywhere in the trip module.

**So how much of a trip's story is recorded?** Four moments and three actors, and nothing in
between. Specifically, none of this is recoverable:

- who changed the vehicle, when, and what it was before
- who attached or removed a bill, and when
- how many times the slot moved, or who moved it
- who edited the note or the transporter trip number

The only trace an edit leaves is `updatedAt`, which says something changed without saying what
or who, and is overwritten by the next edit.

**One further erasure worth knowing.** Cancelling a trip sets `tripDropId` to null on every
bill (`cancel/route.ts:169`), and removing the last bill from a stop deletes the drop row
(`bills/route.ts:141-143`). After a cancel, the trip keeps `cancelledAt` and `cancelledById`,
but **there is no record of which bills were ever on it.** With 49 cancelled trips in
production, that membership is gone.

### 9.2 Every read of `trips.dispatchWindowId`

⚠ `orders.dispatchWindowId` is a **different column with the same name** and is heavily used
across billing, floor actions and the importer. None of that is in scope here. Below is the
trip column only.

**The column itself:**

| # | File and line | What it does | If it were null |
|---|---|---|---|
| 1 | `lib/trips/queries.ts:282` | selected in `TRIP_SELECT` | nothing |
| 2 | `lib/trips/queries.ts:333` | collects distinct ids to batch-load window labels | nulls are skipped by `distinct` |
| 3 | `lib/trips/queries.ts:398-399` | maps the id to a `windowTime` label on the summary | `windowTime` is null, explicitly guarded |
| 4 | **`app/api/floor/trips/[id]/release/route.ts:132-133`** | `const windowId` / `const hasSlot` | **the only behavioural branch in the codebase** |
| 5 | `app/api/floor/trips/[id]/release/route.ts:136-142` | reads the window's label for the log note | not read at all — the lookup is skipped |
| 6 | `app/api/floor/trips/route.ts:227` | written at creation | write, not a read |
| 7 | `app/api/floor/trips/[id]/route.ts:175-178` | written via PATCH | write, not a read |

**The derived `windowTime` label, on the display side:**

| # | File and line | What it does | If it were null |
|---|---|---|---|
| 8 | `components/floor/trip-rail.tsx:165` | the rail's group key | falls into a "No slot yet" group, sorted last (`:171-172`) |
| 9 | `components/floor/trip-band.tsx:166` | first item of the band's meta line | dropped by `.filter(Boolean)` at `:173` |
| 10 | `components/floor/trip-detail-header.tsx:120` | the header line | renders `· no slot yet` |
| 11 | `components/floor/floor-bottom-bar.tsx:150` | the "Add to trip" dropdown label | the suffix is simply omitted |

**Your belief is correct, and it can be put harder.** The slot gate on the Release button was
removed on 2026-09-13 (`trip-detail-header.tsx:226-234` records it stranded 104 bills across 19
slot-less trips). What survives is one branch: when `hasSlot` is false, `releaseBillsToFloor` is
not called at all (`release/route.ts:193-202`) and the bills it would have written are reported
in `needsSlot` instead (`:204-211`).

Every other reference is either a write or a display path, and **every display path already has
an explicit null branch**. None of them breaks.

One refinement to your framing: `needsSlot` is filtered to bills in `FLOOR_RELEASABLE_STAGES`
that are not already released (`release/route.ts:207-211`). Per section 8.4, that set is empty
on every live trip. So even the one hard dependency currently produces an empty list on every
press.

**Live counts, read at the time of writing:**

| status | trips | with a null slot |
|---|---|---|
| cancelled | 49 | 33 |
| draft | 14 | 6 |
| released | 29 | 18 |

**24 open trips** (draft plus released) carry no slot — more than half of them.

⚠ These totals have moved since section 2 was written earlier the same day: draft went 6 → 14
and cancelled 48 → 49. The depot is live; treat every count in this report as a reading, not a
constant.

**Does the rail render them correctly? Yes.** They group under "No slot yet", which sorts last
by the explicit guards at `trip-rail.tsx:171-172`. The comment at `trip-rail.tsx:17` says this
is deliberate: a slot-less trip is a real trip the planner is still deciding about, and it is
shown rather than hidden. The band drops the empty label silently and the detail header prints
"no slot yet", so all three surfaces are correct with a null.

### 9.3 If release is deleted, does a trip still need a slot?

**No.**

Nothing else in the codebase branches on `trips.dispatchWindowId`. Delete the release route and
the column has exactly four consumers left — items 8 through 11 above — and all four are
labels. Every one of them already handles null, because 24 live trips are exercising that path
right now.

It would not become dead data. The rail still groups by it, and two headers still print it, so
it stays a useful way to sort a planner's day. But it would stop having any behaviour attached
to it: no write would depend on it, no bucket would report on it, and no press would act
differently because of it.

Two caveats on that answer:

- It is the **trip's** slot that becomes display-only. `orders.dispatchWindowId` is a separate
  column, is what the picking and floor boards band by, and is untouched by this.
- The slot is currently the only thing the rail groups trips by. Removing the field, as opposed
  to removing its behaviour, would leave the rail with no grouping at all. That is a product
  decision, not a code dependency.

---

*Written 2026-09-14 against the tree at commit `a501650f`. Sections 7, 8 and 9 added the same
day; section 8 corrects section 6, item 4.*

*Sections 0 to 9 are a record of the tree AS FOUND and are not rewritten when the code changes.
Where a later slice has removed something they describe, the passage carries a blockquote naming
the slice. **Slice 1 (2026-09-14)** removed the `loading` trip status from the code, the
"Reorder stops" button, the caption under the draft button, and the desk-control switch inside
`lib/floor/trip-wording.ts` — flagged in sections 2, 4 and 6.*

*Every count is a live reading taken while writing, not a constant.*
