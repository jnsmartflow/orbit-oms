# Code Discovery — Picking Stage 2 (Picked/Checked + Line Ticks)
2026-07-17 · Discovery only. No code, schema, or commit made during this session.

All files listed in the brief were read. Live DB queries below ran as **read-only** diagnostics
(`scripts/_diagnose-sku-5961032.ts`, which already existed on disk, plus two throwaway scratch
scripts written to the session scratchpad — not committed, not left in the repo) against the
production Supabase DB via the existing `lib/prisma` client, same as any local `npx tsx` run. No
writes were issued anywhere. **All files read.**

Where a doc and the code disagreed, the code is reported as truth and the conflict is called out
explicitly.

---

## A — STAGE LADDER

### A1. STAGE_LADDER exactly as coded

Source: `lib/workflow-stages.ts:35-46`.

| Stage | Rank | supportMayEdit |
|---|---|---|
| `order_created` | 10 | true |
| `pending_tint_assignment` | 20 | true |
| `tint_assigned` | 30 | false |
| `tinting_in_progress` | 40 | false |
| `pending_support` | 50 | true |
| `pending_picking` | 60 | true |
| `closed` (legacy alias, same rank) | 60 | true |
| `pick_assigned` | 70 | false |
| `dispatched` | 90 | false |
| `cancelled` | null (terminal) | false |

No stage in the ladder is defined-but-never-written. Every one of the 10 entries is written
somewhere in live code (`closed` only historically — see A4).

**Surprise, not in the ladder at all:** `"dispatch_confirmation"` — read/written by Planning
(`app/api/planning/board/route.ts:28-29,60`) and Warehouse (`app/api/warehouse/board/route.ts:76`)
as a `workflowStage` value, but it does not appear anywhere in `STAGE_LADDER`. See A5/B1.

### A2. `stageRank()` call sites

Grep for `stageRank(` across the whole repo: **exactly two call sites, both inside
`lib/workflow-stages.ts` itself** (`workflow-stages.ts:60` — the definition; `workflow-stages.ts:94`
— inside `isSupportDone()`). **No external file calls `stageRank()` directly, and no file does a
hardcoded numeric rank comparison (`>= 60`, `=== 70`, etc.) against `workflowStage`.** Every
consumer that needs a "stage set" imports one of the two pre-derived arrays
(`SUPPORT_DONE_STAGE_NAMES`, `SUPPORT_PICKING_QUEUE_STAGE_NAMES`) or the two named constants
(`SUPPORT_DONE_OUTPUT`, `PICK_ASSIGNED`) — never a raw rank number. This is the direct reason the
A5 verdict below is "constants-file edit only."

### A3. Raw stage-name strings used outside `lib/workflow-stages.ts`

These are the files that would break a **rename** of a stage string (not a rank renumber — see A2).

**`"pick_assigned"`** — `app/api/picking/assign/route.ts` (via the imported `PICK_ASSIGNED`
constant, not a raw literal) and `prisma/seed.ts:139` (**unrelated collision** — see the BLOCKERS
section: this is a `status_master` row for the `pick_list` *domain*, a completely different table/
system from `orders.workflowStage`, that happens to reuse the same string).

**`"pending_picking"`** — consumed everywhere as the `SUPPORT_DONE_OUTPUT` constant
(`lib/workflow-stages.ts:52`), never as a raw literal, in: `app/api/support/orders/route.ts`,
`app/api/import/obd/route.ts`, `app/api/support/orders/[id]/undo-dispatch/route.ts`,
`app/api/support/bulk/route.ts`, `app/api/support/orders/[id]/release/route.ts`,
`app/api/support/orders/[id]/dispatch/route.ts`, `app/api/picking/unassign/route.ts`,
`app/api/tint/operator/split/done/route.ts`, `app/api/tint/operator/done/route.ts`.

**`"dispatched"`** — this ONE is genuinely raw-string, in real production code, in files that
never import from `lib/workflow-stages.ts` at all:
- `app/api/operations/summary/route.ts:37` — `workflowStage: "dispatched"` (today's dispatched-today
  count on the Operations dashboard's Import tile)
- `app/api/planning/board/route.ts:29` — `["dispatch_confirmation", "dispatched"]` allowlist
- `app/api/tint/manager/assign/route.ts:109` — comment only, referencing it as a blocking stage
- `app/api/planning/plans/[id]/add-orders/route.ts:60`, `remove-order/route.ts` (via plan `.status`,
  not `workflowStage` — see next bullet), `assign-vehicle/route.ts:76-98` — **writes**
  `workflowStage: "dispatched"` (line 77) as part of confirming a dispatch plan
- `app/api/support/slots/route.ts` — comments referencing "closed/dispatched" for `doneCount`

**Load-bearing distinction:** `dispatch_plans.status` and `order_splits.status` ALSO use the string
`"dispatched"` as one of their own values (`assign-vehicle/route.ts:60,64-68,94-98`;
`app/api/planning/plans/[id]/loading-complete|add-orders|remove-order/route.ts`) — these are
**different columns on different tables**, not `orders.workflowStage`. They share the English word
by convention only; renaming `orders.workflowStage`'s `"dispatched"` value would NOT need to touch
these, and vice versa. Worth flagging because it's easy to grep-confuse the two.

### A4. Is `dispatched` written by anything today?

**Yes, exactly one writer:** `app/api/planning/plans/[id]/assign-vehicle/route.ts:77` —
`workflowStage: "dispatched"` when a dispatch plan's vehicle assignment is confirmed. This is
downstream of Planning, which itself only ever reads orders at `workflowStage: "dispatch_confirmation"`
(`app/api/planning/board/route.ts:76` — Warehouse board — and `:28-29` — Planning board).

**But nothing writes `"dispatch_confirmation"` to `orders.workflowStage` anywhere in the codebase**
(confirmed by grep — zero write sites; the only two `dispatch_confirmation` hits outside comments/docs
are the two READ filters above). This matches the code's own comment in
`lib/workflow-stages.ts:119-121`: *"zero production order has ever reached 'dispatched'; the
Planning pipeline that writes it requires 'dispatch_confirmation', a stage nothing in this codebase
writes yet."* Confirmed live: **`dispatched` is currently dead/unreachable code** — Planning and
`assign-vehicle` form a complete but never-triggered pipeline stage, because nothing upstream ever
produces a `dispatch_confirmation` order for them to act on. Support's own "Done" action writes
`pending_picking`/`closed`, never `dispatch_confirmation` (§3 of `CLAUDE_SUPPORT.md`, confirmed in
`lib/workflow-stages.ts:52`).

**Read/filtered by:** `operations/summary` (dispatched-today count, `route.ts:35-41`), Planning board
(`route.ts:28-29`), Warehouse board (`route.ts:76`, on `dispatch_confirmation` only — never
`dispatched`), Support's `SUPPORT_DONE_STAGE_NAMES` derived set (rank ≥ 60 includes it — see A2/§support
usages below). Trips (`trip_report` mirror table) and delivery-challan routes do **not** filter on
`workflowStage` at all (confirmed — zero matches).

### A5. VERDICT — add `pick_done=80`, `pick_checked=90`, move `dispatched` 90→100

**Confirmed: constants-file edit only, for the rank renumber itself.** Because A2 shows zero
external callers ever read a raw rank number, moving `dispatched`'s rank from 90 to 100 changes
nothing observable — no file compares `stageRank(x) === 90` or similar.

**But three second-order effects need explicit handling, not automatic:**

1. **`supportMayEdit` does NOT auto-inherit from rank** — it's a plain per-row flag by design
   (`lib/workflow-stages.ts:23,33-34`, explicit comment: *"do not collapse it into rank >= X"*).
   Adding `pick_done`/`pick_checked` StageDef rows requires **manually** setting
   `supportMayEdit: false` on each — it is not automatic just because their rank is ≥ 70. Trivial
   (one line each, matching `pick_assigned`'s existing row), but not free — confirmed this is a
   real step, not a formality.
2. **`SUPPORT_DONE_STAGE_NAMES`** (`workflow-stages.ts:105-107`, derived as rank ≥ 60) **will
   automatically absorb `pick_done` and `pick_checked`** the moment they're added at rank 80/90 —
   no code change needed there, but every consumer of that array changes behaviour the instant the
   ladder changes: `app/api/operations/summary/route.ts` (excludes from active-work counts — already
   excludes `pick_assigned` today, so this is continuity, not a new exclusion class),
   `app/api/support/slots/route.ts` (doneCount + header fencing — same continuity),
   `app/api/tint/manager/missing-customers/route.ts` (excludes done orders — same continuity),
   `app/api/support/orders/route.ts` (main list — same continuity), `app/api/admin/fix-slots/route.ts`
   (backfill target exclusion — same continuity). **In every case this is a continuation of the
   exact treatment `pick_assigned` (rank 70) already gets today** — Support/Operations/Tint-Manager
   already treat "assigned to a picker" as done; extending that to "picked" and "checked" is the
   same policy, not a new one.
3. **`SUPPORT_PICKING_QUEUE_STAGE_NAMES`** (`workflow-stages.ts:129-131`, narrower — exactly rank
   60) is **unaffected** — `pick_done`/`pick_checked` land at 80/90, not 60, so this array (used by
   `support/orders/route.ts` history-footprint arms and `admin/fix-challans/route.ts` challan
   eligibility) stays exactly `[pending_picking, closed]` regardless.

**Nothing breaks.** The rank move is safe. The two new stages joining `SUPPORT_DONE_STAGE_NAMES`
is a real behaviour change but a *correct, continuity-preserving* one — every board that already
treats `pick_assigned` as "done work, not mine to show" will treat `pick_done`/`pick_checked` the
same way, which is the desired outcome (an order mid-pick or checked-off should not reappear on
Support's active board, Operations' active-work tile, or TM's missing-customer sheet).

---

## B — WHAT'S DOWNSTREAM

### B1. What consumes a bill after `pick_assigned` today?

**Nothing, functionally.** Traced every consumer of `workflowStage`:

- **Planning** (`app/api/planning/board/route.ts:28-29`) reads `["dispatch_confirmation",
  "dispatched"]` only — never `pick_assigned`, `pick_done`, or `pick_checked`.
- **Warehouse board** (`app/api/warehouse/board/route.ts:76`) reads `= "dispatch_confirmation"`
  only.
- **Trips** (`trip_report`) — standalone NTS mirror table, no FK to `orders`, no `workflowStage`
  filter anywhere (confirmed zero matches under `app/api/trips`).
- **Delivery challan** routes — no `workflowStage` filter anywhere (confirmed zero matches under
  `app/api/tint/manager/challans`); challans are keyed by `orderId` directly and voided/audited by
  their own `isVoided` flag, independent of the order's stage.
- **Operations Warehouse tile** (`app/api/operations/summary/route.ts:74-94`) is the one place that
  *looks* downstream of picking, but it reads two different, disconnected signals:
  - `unassigned` filters `workflowStage: { in: ["pending_support", "submitted", "tinting",
    "tint_done", "ready"] }` (`route.ts:82-84`) — **`"submitted"`, `"tinting"`, `"tint_done"`, and
    `"ready"` do not exist anywhere in `STAGE_LADDER` or in any live write path** (confirmed by
    grep — none of these four strings are ever written to `orders.workflowStage` elsewhere in the
    codebase). This is the exact **"ghost-stage counter"** landmine already flagged in
    `CLAUDE_SUPPORT.md §8` — this tile is silently near-useless today, unrelated to this build.
  - `picking` / `picked` (`route.ts:89-93`) read **`pick_assignments.status`**, not
    `orders.workflowStage` at all — `status: "assigned"` → "picking" tile, `status: "picked"` →
    "picked" tile. **Zero rows currently have `status = "picked"`** (confirmed live — see C2), so
    this tile currently always shows `picked: 0`.

**Conclusion for B1:** neither Planning, Warehouse, Trips, nor Challans consume `pick_assigned` (or
would consume `pick_done`/`pick_checked`) today. The only live "downstream" signal is Operations'
Warehouse tile, and it is wired to `pick_assignments.status`, not `orders.workflowStage` — meaning
if picker-Done/supervisor-Approve is built as new `workflowStage` values (`pick_done`,
`pick_checked`) WITHOUT also touching `pick_assignments.status`, this Operations tile will not move
at all. If it's built by advancing `pick_assignments.status` to `"picked"` instead (which already
fits the existing DB CHECK constraint — see C2), the tile updates for free.

### B2. Does any board show a `pick_done`/`pick_checked` order wrongly, or lose it?

No regression on any board — confirmed by re-checking each board's exact filter:

- **Support** (`app/api/support/orders/route.ts`) excludes via `SUPPORT_DONE_STAGE_NAMES`
  (rank ≥ 60) already excludes `pick_assigned` today; `pick_done`/`pick_checked` join the same
  exclusion automatically (A5.2) — same "not mine anymore" treatment, no change in kind.
- **Tint Manager** — no `workflowStage` filter on picking-stage values at all (TM only cares about
  `pending_tint_assignment`/`tint_assigned`/`tinting_in_progress`, confirmed via
  `lib/reports/tint-summary-data.ts:152`); unaffected either way.
- **Trips / Reports** — confirmed no `workflowStage` filter exists (B1); unaffected.
- **Warehouse / Planning** — both filter on `dispatch_confirmation`/`dispatched` only, a stage
  nothing upstream produces yet (A4); `pick_done`/`pick_checked` orders simply won't appear there,
  exactly as `pick_assigned` orders don't appear there today. No change, no loss — they were never
  visible on those boards to begin with.
- **Admin** (`fix-slots`, `fix-challans`) — both exclude via the derived stage-name arrays (A5.2);
  same continuity.

**The only board that actually SHOWS picking-stage orders is `/picking` itself** — and building
`pick_done`/`pick_checked` display there is precisely the unbuilt work this discovery is scoping.

### B3. Does anything rely on `supportMayEdit` being false at rank ≥ 70? Do 80/90 inherit correctly?

**Yes, five Support routes call `supportMayEdit()` as their edit gate:**
`app/api/support/orders/[id]/release/route.ts:57`, `hold/route.ts:37`, `dispatch/route.ts:57`,
`cancel/route.ts:50`, `bulk/route.ts:67` (plus `undo-dispatch/route.ts:41`, combined with a
`SUPPORT_PICKING_QUEUE_STAGE_NAMES` membership check). All five would correctly stay locked out on
a `pick_done`/`pick_checked` order **only if** the new StageDef rows are given `supportMayEdit:
false` explicitly (B3/A5.2 — this is a manual step per new row, not automatic). Getting it right is
one line per stage; getting it wrong (leaving it undefined, which TypeScript would actually reject
at the type level since `supportMayEdit: boolean` is required on `StageDef`) would silently
re-open Support's edit routes on a bill that's already on the floor — a real, if easily-avoided,
risk to flag explicitly in the build prompt.

---

## C — `pick_assignments` TABLE

### C1. Model as coded

Prisma (`prisma/schema.prisma:1055-1069`):

```
model pick_assignments {
  id           Int       @id @default(autoincrement())
  orderId      Int       @unique @map("order_id")
  order        orders    @relation(fields: [orderId], references: [id])
  pickerId     Int       @map("picker_id")
  picker       users     @relation("PickAssignmentPicker", fields: [pickerId], references: [id])
  sequence     Int
  assignedAt   DateTime  @default(now()) @map("assigned_at")
  assignedById Int       @map("assigned_by_id")
  assignedBy   users     @relation("PickAssignmentAssignedBy", fields: [assignedById], references: [id])
  status       String    @default("assigned")
  pickedAt     DateTime? @map("picked_at")
  notes        String?
  clearedAt    DateTime? @db.Timestamptz
}
```

**Live DB constraints** (queried directly via `pg_constraint` — these are NOT visible in the Prisma
schema above, since Prisma has no `@db` annotation surfacing them):

| Constraint | Type | Definition |
|---|---|---|
| `pick_assignments_pkey` | PRIMARY KEY | `(id)` |
| `uq_pick_assignments_order` | UNIQUE | `(order_id)` |
| `pick_assignments_order_id_fkey` | FOREIGN KEY | `order_id → orders(id) ON DELETE CASCADE` |
| `pick_assignments_picker_id_fkey` | FOREIGN KEY | `picker_id → users(id)` |
| `pick_assignments_assigned_by_id_fkey` | FOREIGN KEY | `assigned_by_id → users(id)` |
| **`chk_pick_assignments_status`** | **CHECK** | **`status = ANY (ARRAY['assigned','picked'])`** |

### C2. Is `status` free or constrained? What's written today? Zero-schema-change path?

**Constrained — and this is the single most important finding in this discovery.** `status` is
typed `String` in Prisma with no visible constraint, but the LIVE database has a hand-added CHECK
constraint (`chk_pick_assignments_status`) restricting it to **exactly** `'assigned'` or `'picked'`
— nothing else is legal today, not even at the DB layer, regardless of what the app sends.

**Currently written:** confirmed via `GROUP BY status` on all 304 live rows — **100% are
`'assigned'`; zero rows are `'picked'`.** `assign/route.ts:113` hardcodes `status: "assigned"` on
create; nothing in the live codebase ever writes `'picked'` (no `UPDATE ... status = 'picked'` site
exists anywhere in `app/api/picking/**`).

**Could it carry `assigned → picked → checked` with NO schema change?** **Partially — split
verdict:**
- `assigned → picked`: **yes, zero schema change needed.** `'picked'` is already a legal CHECK
  value, just never written yet. A picker-Done API can `UPDATE pick_assignments SET status =
  'picked', pickedAt = now()` today with no ALTER anything.
- `picked → checked` (or any third status word): **no — requires an ALTER on
  `chk_pick_assignments_status`** to add the new value to the `ANY (ARRAY[...])` list. Per CORE §3
  this must go via Supabase SQL Editor + `npx prisma generate` (the "never `prisma db push`" rule),
  not a Prisma-only change — the CHECK constraint isn't even modeled in `schema.prisma`, so a naive
  "just add the string" approach would silently violate a constraint Prisma doesn't know exists and
  the app would only discover at write-time via a Postgres error.
- **This is exactly why the locked design in `CLAUDE_PICKING.md §6` uses a separate `approved`
  timestamp + `approvedBy` column for the 4th state, not a third `status` string** — it avoids ever
  touching this CHECK constraint. That design choice is confirmed correct and should be kept: model
  Checked/Approved as new columns on `pick_assignments` (or a new join), not as a `status` value.

### C3. `pickedAt` — ever written? Ever read?

**Never written.** Confirmed live: **0 of 304** rows have `pickedAt` set (all null). No route
anywhere writes to it (`assign/route.ts:115-117` explicitly leaves it null with a comment: *"the
bill is assigned, not picked. pick_done is a later stage and will set it"*). No route reads it
either (not selected in `lib/picking/queue.ts`'s `pickAssignment` include, `queue.ts:127-133`; not
referenced in `picking-board-mobile.tsx`). It is pure dead-but-intended-for-later column today,
exactly as the doc claims.

### C4. Real one-row-per-order constraint?

**Yes, confirmed real** — `uq_pick_assignments_order` is a genuine Postgres `UNIQUE (order_id)`
constraint (C1 table above), not just Prisma's `@unique` annotation layered on top of nothing. The
`CLAUDE_PICKING.md §6` claim ("double-assign is already prevented at the DB level") is accurate.

### C5. Columns needed for picker Done + supervisor Checked

Given C2's split verdict, the zero-schema-change path is:

- **Done (picker):** no new column needed — `pick_assignments.pickedAt` already exists, unused, and
  `status: 'picked'` is already CHECK-legal. A Done API only needs to `UPDATE pick_assignments SET
  status = 'picked', pickedAt = now() WHERE orderId = ? AND status = 'assigned'`. "By whom" is
  already implicit (`pickerId` on the same row — the assignment IS the picker's row; no separate
  "picked by" column needed since one order has exactly one assignment, C4).
- **Checked (supervisor):** needs genuinely new columns, matching the camelCase-no-`@map`... wait,
  this table's existing columns DO use `@map` to snake_case (`order_id`, `picker_id`,
  `assigned_at`, `assigned_by_id`, `picked_at`) — **this table predates and is exempt from the
  CORE §3 "Supabase columns are camelCase, `@map` causes P2022" rule** (it's an older table from
  the Phase 4 pick-list build, before that convention was locked in for newer tables). Proposed
  names, matching this table's OWN established style:
  - `checkedAt DateTime? @map("checked_at")`
  - `checkedById Int? @map("checked_by_id")` + relation to `users` (a third named relation on
    `pick_assignments` → `users`, alongside the existing `PickAssignmentPicker` and
    `PickAssignmentAssignedBy` — needs its own relation name, e.g. `"PickAssignmentCheckedBy"`)

  Both nullable (a row starts `checkedAt: null`). No CHECK-constraint change needed for these — they
  are plain new columns, not a new `status` value.

---

## D — LINE TICKS

### D1. Ephemeral vs persisted — honest comparison

**(a) Ephemeral — client state only, resets if the app closes:**
- Cost: near-zero. A `Set<number>` of ticked line-item ids in the detail screen's existing React
  state (`picking-board-mobile.tsx` already has this exact pattern for `selected`,
  `unassigningIds`, etc. — `:314,343`). No API route, no schema, no migration.
- Failure mode: a phone lock/app-kill mid-check silently discards all progress on that bill. The
  supervisor re-opens the bill to find every tick gone, with no signal that this happened (no "you
  had ticked 4/9 lines" recovery).

**(b) Persisted — a table keyed to order + line:**
- Cost: real. A new table (e.g. `pick_line_checks(orderId, lineItemId, checkedAt, checkedById)`) or
  a JSON column on `pick_assignments`. Either way: schema change (Supabase SQL Editor + `prisma
  generate`, CORE §3), a new API route (or extending the existing detail-screen fetch), and
  client-side sync logic (optimistic tick + server write + reconcile-on-reopen).
- Failure mode: none of D2's — survives app kill, phone lock, even device swap mid-bill.

### D2. If ephemeral — real risk, real bill size

**Risk if the phone locks mid-check:** the supervisor loses their place in a partially-ticked bill
and has to re-scan every line from the top with no memory of where they'd gotten to. Since the tick
is explicitly a **forcing function** (per the brief — not an audit trail), the actual harm is
"re-does a few seconds of work," not "loses data that mattered" — there is no downstream consumer
of tick state (nothing reads it, nothing reports on it, C3 confirms `pickedAt`/status don't depend
on per-line state). The worst case is operator annoyance, not a broken pipeline.

**Real bill size, queried live** (663 orders currently sitting in `dispatch` + `pending_picking`/
`pick_assigned` — the exact picking-queue-eligible set): **median 2 lines, average 3.3 lines, p90 =
7 lines, max = 36 lines.** Distribution: 476/663 (72%) have 1-3 lines, 100 have 4-6, 51 have 7-10,
30 have 11-20, only 6 bills have 21+ lines. **Most bills are short enough that a lost tick-state on
phone-lock costs re-scanning 2-3 lines, not 36** — the tail exists but is rare.

### D3. Recommendation

**Ephemeral.** The brief's own framing settles it — this is a forcing function, not an audit trail,
and C3 confirms nothing downstream reads per-line state today. D2's real-bill-size data (median 2,
72% at ≤3 lines) means the ephemeral failure mode (re-scan from top on phone-lock) costs seconds for
the large majority of bills and, even in the rare 21+-line tail, is still just re-work, not data
loss. Persisting costs a real schema change, a real new table/column, and real sync-logic
complexity for a benefit (surviving an app-kill mid-check) that only matters on the long tail. Build
ephemeral first; if floor usage later shows phone-locks routinely happen mid-check on the long
bills, that's a concrete, measured reason to add persistence — not a guess made now.

---

## E — PICKER ROLE + SESSION

### E1. Does role `picker` exist? How many users?

**Yes**, seeded in `prisma/seed.ts:42` (`{ name: "picker", description: "Warehouse picker" }`).
**Exactly 2 live picker-role users**, queried directly: **Ramesh K.** (id 8,
`ramesh.picker@orbitoms.in`, active) and **Sunil P.** (id 9, `sunil.picker@orbitoms.in`, active).
For reference, **1 floor_supervisor** exists: "Test Floor Supervisor" (id 6,
`floorsupervisor@orbitoms.com`, active) — confirms both are still test/seed accounts, not real
depot staff names (unlike the picker roster documented for other modules in CORE §6).

### E2. `GET /api/warehouse/pickers` — requires/returns

**Requires:** `requireRole(session, [ROLES.FLOOR_SUPERVISOR, ROLES.ADMIN, ROLES.OPERATIONS])`
(`app/api/warehouse/pickers/route.ts:10`) — **note: `picker` role itself is NOT in this allowlist.**
A logged-in picker cannot call their own roster endpoint. (This is the endpoint the mobile
supervisor board's Assign sheet calls, `picking-board-mobile.tsx:398` — a supervisor action, so this
is consistent with intended use, just worth flagging since it also blocks a future "picker views
their own queue" screen from reusing it as-is.)

**Returns:** `{ pickers: [{ id, name, avatarInitial, status: "picking"|"available", assignedCount,
pickedCount, pendingCount, totalKg }] }` — today's assignments computed from `pick_assignments`
joined to `querySnapshot.totalWeight`, `status in ["assigned","picked"]`
(`pickers/route.ts:26-31,64-77`). Sorted picking-first then alphabetical.

### E3. Session shape

From `auth.config.ts:8-26` (Edge-safe augmentation) + `lib/auth.ts` (Node `jwt` callback):

```ts
session.user: {
  id: string;                                // "8", "9" etc — user.id.toString()
  role: string;                               // primary role, snake_case: "picker"
  roles: string[];                            // ALL roles (multi-role), snake_case
  name?: string; email?: string;              // DefaultSession fields
  attendanceTestUser?, attendanceExempt?,
  attendanceConsentVersion?, rolloutStage?,
  rolloutStageStaleAt?, lastCheckInDate?       // attendance-gate claims, unrelated to picking
}
```

`role` and `roles` are lowercased + underscored from `role_master.name`/`user_roles` at sign-in
(`lib/auth.ts:204-208`) — a picker's session carries `role: "picker"`, `roles: ["picker"]` (no
secondary roles seeded for Ramesh/Sunil).

### E4. Can a `picker`-role user reach `/picking` today?

**No.** Confirmed by direct DB query on `role_permissions` for `pageKey = 'picking'`: **exactly one
row exists — `roleSlug: "operations"`, `canView: true`.** There is **no row for `picker`** (nor
`floor_supervisor`, matching the already-documented landmine) and **no row for `admin`** either —
admin reaches `/picking` purely via the code-level bypass (`roles.includes("admin")`,
`app/picking/page.tsx:23` and identically in every API route), not a DB grant. **A picker-role user
today gets redirected to `/unauthorized`** the instant they hit `/picking`
(`app/picking/page.tsx:24-26`) — same gate that blocks `floor_supervisor`. The `picker` role's ONLY
live `role_permissions` grant is `pageKey: "warehouse"` (`prisma/seed.ts:95`), a page that also
isn't `/picking`.

**This is a second, previously-undocumented instance of the same access gap CLAUDE_PICKING.md §7
already flags for `floor_supervisor`** — the prepared SQL there only grants `floor_supervisor`; it
does not grant `picker`. Both roles need a row before either can open `/picking` for real
floor use.

### E5. Test hook — cheapest way to test under admin only

Since the intended real users (picker, floor_supervisor) are both currently locked out (E4) and
Support wants to test on admin only with zero new grants, the cheapest option that costs nothing
today: **a client-side "View as" toggle, visible only when `session.user.roles.includes("admin")`,
that narrows the already-loaded queue data to `row.pickerId === selectedPickerId`** (or
`assignedToName === picker.name`, matching the existing Check-tab picker filter's exact pattern —
`picking-board-mobile.tsx:499-520`, already built and working). This needs:
- **No new API route** — the picking queue payload already carries `assignedToName`/picker identity
  per row (`lib/picking/types.ts:23-24`).
- **No new grant** — admin already bypasses every gate.
- **One new piece of client state** (a `viewAsPickerId` dropdown, admin-only) plus a filter
  predicate reusing the Check tab's existing `pickerCounts`/`pickerOptions` derivation
  (`picking-board-mobile.tsx:506-520`) — this is UI-only, no schema, no new fetch.

Cost estimate: small — one dropdown + one filter clause reusing code that already exists on this
same file for the Check tab's picker filter. Not built this session per the brief; described only.

---

## F — UI REUSE

### F1. Is `picking-board-mobile.tsx` separable (list/card/detail) or a monolith?

**Structurally a single 1,362-line client component file, but logically well-separated inside
it** — not a hard monolith, more an un-extracted one. Concretely:
- **List rendering** for both tabs (`:858-1048`) is straightforward `.map()` over filtered rows with
  inline card JSX — not its own component, but trivially extractable (no shared mutable state beyond
  props already being passed down as plain values).
- **Card** — two near-identical inline card blocks (Assign card `:875-936`, Check card `:962-1046`)
  sharing the same "card DNA" (OBD/window header, dealer name hero, area+articleTag line) but NOT
  factored into one shared `<PickingCard>` component today — each tab hand-rolls its own JSX. A
  third "picker face" would either duplicate this a third time or (better) finally extract the
  shared card now.
- **Detail screen** (`:1083-1267`) is a single always-mounted overlay (`translateX` slide, never
  unmounted) — self-contained, reads `detailRow`/`lineItems` from the same top-level state, calls
  its own `/api/picking/order/[orderId]` fetch. This part IS cleanly separable — it doesn't share
  markup with the list/card sections, only state plumbing (`detailOrderId`, `openDetail()`).
- **Reusable primitives already extracted as real sub-components:** `TopBarTab`, `SelectBox`,
  `TypeFilterPills`, `FilterBottomSheet` (`:119-294`) — these ARE proper, props-driven, zero-
  external-state components today, genuinely reusable as-is by a third face.

**Verdict:** a third "picker face" (different scope + CTA) could reuse `FilterBottomSheet`,
`TypeFilterPills`, `SelectBox`, and the detail-screen pattern directly with no fork. It would need
to either duplicate the card JSX a third time (fast, but adds a third copy of the same drift risk
already present between Assign/Check cards) or take the opportunity to extract one shared
`<PickingCard variant="assign"|"check"|"picker">` component first — a real but bounded refactor, not
a rewrite.

### F2. How does `app/picking/page.tsx` switch desktop vs mobile? Where would a third face slot in?

Pure CSS responsive switch, not a UA-sniff or a server decision (`app/picking/page.tsx:52-58`):

```tsx
<div className="hidden md:block"><PickingQueue /></div>
<div className="block md:hidden"><PickingBoardMobile /></div>
```

Both components are **always mounted in the DOM**; Tailwind's `hidden md:block` / `block md:hidden`
purely toggles visibility per breakpoint. **A third, role-based face would need actual conditional
rendering** (not a third CSS breakpoint — there's no viewport signal for "picker vs supervisor"),
e.g.:

```tsx
{primaryRole === "picker"
  ? <div className="block md:hidden"><PickerMyBillsBoard /></div>
  : <div className="block md:hidden"><PickingBoardMobile /></div>}
```

gated on `primaryRole` (already available server-side at `page.tsx:21`, same variable already used
for the sidebar). This is a small, well-contained change to `page.tsx` — the existing responsive
switch doesn't need to be redesigned, just extended with one role branch inside the mobile arm.

### F3. Does the detail screen reserve a right-hand gutter for a tick box?

**Yes, confirmed in the live JSX**, not just a design note. `picking-board-mobile.tsx:1242-1246`:

```tsx
{/* QTY — fixed, plain, no "x" prefix. Space to the right of
    this column is reserved for a future tick-off checkbox. */}
<div className="shrink-0 flex items-center justify-center px-3.5">
  <span className="text-[26px] font-extrabold text-gray-900">{li.qty}</span>
</div>
```

The comment is explicit and matches the design intent exactly — the QTY column is the rightmost
element on the line-item card today (`:1218-1247`, three columns: pack tile / body / qty, no fourth
column yet), with `px-3.5` padding already leaving visual room for a checkbox to slot in as a fourth
element without restructuring the card.

---

## G — OPEN QUESTIONS

### G1. SKU 5961032 — null pack. Stray, or a whole class?

**Ran the existing read-only diagnostic** (`scripts/_diagnose-sku-5961032.ts`, already on disk from
a prior session — not written this session) against live data:

- `sku_master` has **no row at all** for skuCode `5961032` (`findUnique` returned `null`) — this
  isn't a join miss or a bad pack code, the SKU is simply **absent from the master table entirely**.
- On the same OBD (9108267692), the three sibling `IN`-prefixed lines all resolve fine with real
  pack sizes (`500ML`, `1LT`, `1LT`).
- **Sampled 500 distinct non-`IN`-prefixed raw SKU codes** across all active import line items:
  **278 exist in `sku_master`, 222 (44%) do not** — including `5961032` and, notably, `5911947`,
  which is one of the 8 GEN SKUs already flagged as intentionally deleted in `CLAUDE_CORE.md §13`.

**Verdict: a whole class, not a stray.** Legacy numeric (non-`IN`-prefixed) SAP codes are missing
from `sku_master` at a ~44% rate in this sample — vastly more than the 8 known intentionally-deleted
GEN SKUs account for. This is a real, sizeable gap in master-data coverage for older-style SAP
codes, not an isolated one-off. Since a blank pack is exactly what prevents a mis-pick (per the
brief), this deserves its own follow-up pass (likely: import a batch of legacy numeric codes into
`sku_master`, or confirm with Chandresh/depot which of the 222 are genuinely obsolete vs. just
never-mastered) — out of scope to fix in this discovery, but now backed by a real number instead of
"unresolved."

### G2. `articleTag` null — strays, or a pattern?

**Ran a fresh read-only query** (not a pre-existing script) against `import_obd_query_summary` and
the live picking-queue-eligible order set:

- **System-wide: 5,589 of 8,084 `import_obd_query_summary` rows (69%) have `articleTag = null`.**
  Every sampled null row also has `totalArticle: 0`, `sapStatus: null`, and is on a `workflowStage
  = "closed"` order — consistent with **historical imports that predate the `article`/`article_tag`
  raw-line columns existing at all** (confirmed in code: `articleTag` is populated purely from a raw
  `lr["article_tag"]` SAP-XLS column, `app/api/import/obd/route.ts:788,2614` — if the source row
  never had that column, the field is null by construction, not by a bug).
- **Narrowed to what actually matters for picking** (the 663 orders currently in
  `dispatch`+`pending_picking`/`pick_assigned`): **111 of 663 (16.7%) have null articleTag — 105
  non-tint, 6 tint.** Meaningfully more common than "a handful of strays," but far below the 69%
  system-wide rate — meaning recent/current imports are much better populated than the historical
  average, and the gap concentrates in non-tint orders.

**Verdict: a real, ongoing minority pattern on current data (~17% of live picking-queue bills),
layered on top of a much larger historical-data gap** (69% overall, mostly pre-dating the column).
Not tied to one single order type (both tint and non-tint show it) or cleanly to one import path
via the data alone — `sapStatus: null` on every null-tag sample suggests these rows may correlate
with the manual-SAP-upload path (Auto-Import has been paused since 2026-05-14 per CORE §4, so
"manual upload" is likely the dominant current source regardless), but that correlation was not
conclusively isolated this session and would need a query specifically comparing `sapStatus`
non-null vs null against `articleTag` null-rate to confirm — flagged as **needs a follow-up query**,
not answered with full confidence here.

---

## BLOCKERS + SURPRISES

1. **`pick_assignments.status` has a live DB CHECK constraint (`chk_pick_assignments_status`)
   restricting it to exactly `'assigned'`/`'picked'`, invisible in `schema.prisma`.** This is the
   single biggest thing that changes the plan: `assigned → picked` is free (zero schema change,
   `'picked'` already legal); `picked → checked` as a third status string is NOT free (needs an
   ALTER via Supabase SQL Editor). Confirms the existing `CLAUDE_PICKING.md §6` design choice
   (separate `approved`/`approvedBy` columns rather than a third status value) was already the
   right call — keep it, don't be tempted to add `'checked'` to the status string.

2. **`STAGE_LADDER` is not actually the single source of truth its own docstring claims.** Planning
   and Warehouse read/write `"dispatch_confirmation"` — a stage that doesn't exist anywhere in
   `STAGE_LADDER`. This is pre-existing and currently harmless only because nothing writes
   `dispatch_confirmation` yet (confirmed dead code, A4), but it means "add a stage, edit one file"
   is only true for Support-side consumers today — Planning/Warehouse/TM never migrated onto the
   registry (matches the file's own comment, `workflow-stages.ts:11-15`, that this migration hasn't
   happened yet).

3. **`picker`-role users cannot open `/picking` today — a second, previously undocumented instance
   of the access gap already flagged for `floor_supervisor`.** Confirmed live: zero
   `role_permissions` rows for `roleSlug: 'picker', pageKey: 'picking'`. Only `operations` has a
   real grant; `admin` works via code bypass, not a DB row. The prepared SQL in
   `CLAUDE_PICKING.md §7` only grants `floor_supervisor` — it will need a second `INSERT` for
   `picker` before either intended real user can reach the board for genuine floor use (E4).

4. **Operations' Warehouse dashboard tile is already broken independent of this build** — its
   `unassigned` count filters on four `workflowStage` values (`"submitted"`, `"tinting"`,
   `"tint_done"`, `"ready"`) that are never written anywhere in the live codebase (confirmed by
   grep — pure dead strings), and its `picking`/`picked` counts read `pick_assignments.status`
   rather than `orders.workflowStage`, meaning **whichever mechanism Stage 2 ends up using
   (workflowStage vs pick_assignments.status) determines whether this tile ever reflects the new
   feature** — if Done/Checked are modeled purely as new `workflowStage` values, this tile stays
   permanently blind to them without an unrelated separate fix.

5. **Real numbers replace two "unresolved" open questions from `CLAUDE_PICKING.md §7`:** SKU
   5961032's null pack is a 44%-of-sample class gap in `sku_master` for legacy numeric codes, not a
   stray (G1); `articleTag` nulls affect ~17% of the current picking queue, concentrated more in
   non-tint orders, on top of a much larger 69% historical-data gap that predates the column
   existing (G2). Neither is fully closed (G2 especially — the `sapStatus` correlation needs a
   dedicated query), but both are now evidence-based rather than open guesses.

6. **`docs/CLAUDE.md` (repo-root-adjacent, `docs/` copy) and root `CLAUDE.md` are two separate
   router files with slightly different content** (the `docs/` one lacks the "Non-negotiable rules"
   inline block that the root one has as §1) — both were present and both got read per the system
   context; not a Stage 2 blocker, just worth a maintainer's awareness that there are two router
   files in play, not one.

7. **Median bill size in the live picking queue is 2 lines (avg 3.3, p90 7, max 36)** — small enough
   that the D3 ephemeral-ticks recommendation is comfortably low-risk; the "phone locks mid-check"
   failure mode almost never means "lose 36 lines of progress," it usually means "lose 1-2."
