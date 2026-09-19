# Code discovery — tint conversion gate: who would lose, who would gain
# 2026-09-06 · READ-ONLY · no application code changed · Lives in: docs/prompts/drafts/

**Type:** `code-discovery` — the GATE before converting `app/api/tint/**` from job-title gates to
per-user ticks. **No code was written, edited, moved or proposed.**

**State verified before anything else** (the four gate checks the prompt required):

| Check | Required | Live | |
|---|---|---|---|
| `0af680e4` at or near tip | present | present — 9 commits back (`fa0bac6c`…`baaac0b0`, all tint/picking) | ✅ |
| `SELECT value FROM system_config WHERE key='ACCESS_SOURCE'` | `user` | `user` | ✅ |
| `SELECT count(*) FROM user_page_access` | 1053 | 1053 | ✅ |
| `SELECT count(*) FROM users WHERE "isSuperuser"=true` | 1 | 1 | ✅ |

Read-only scripts: `scripts/_chk-gate-20260906.ts`, `scripts/_chk-tint-gate-20260906.ts`,
`scripts/_chk-tint-gate2-20260906.ts` (underscore-prefixed, outside the `tsc` gate per
`tsconfig.json`'s `exclude`). Every query is a `findMany` / `findUnique` / `count`. Nothing was
written.

---

## 0. The answer in one line

**One active person would lose something, and it is the same person on 15 of the 24 routes:
`Operations User` (u20).** He holds **zero ticks on `tint_manager` and zero on `tint_operator`** and
reaches every one of those routes today purely because his job title is spelled `operations` inside
a role array. **One person would gain: `Harsh` (u1, the superuser)** on the four operator
start/done routes, where `requireRole([TINT_OPERATOR, OPERATIONS])` locks him out today. **A second
gains quietly: `Prakash`**, on manual tint entry.

The sharp edge is that **this divergence already exists in the live tree.** Both tint layouts
(`app/(tint)/tint/manager/layout.tsx:26`, `app/(tint)/tint/operator/layout.tsx:26`) already gate on
the tick, so Operations User is **already redirected to `/unauthorized`** at both screens — while
every API route beneath them still admits him by title. Conversion does not create the gap; it
closes a gap that is open right now.

---

## 1. Every tint route that gates on a job title

**25 mutating handlers exist under `app/api/tint/**`. 24 of them gate on a job title.** The 25th
(`operator/skip`) gates on session + row ownership and names no role at all.

The 37 route files under `app/api/tint/**` were swept handler by handler for
`export async function POST|PATCH|PUT|DELETE`. GET-only files (`manager/challans`,
`manager/manual-entry/lookup`, `manager/marker`, `manager/missing-customers`, `manager/operators`,
`manager/orders`, `manager/orders/[id]/pause-history`, `manager/orders/[id]/skip-history`,
`manager/orders/[id]/splits`, `manager/ti-report`, `operator/history`, `operator/my-orders`) are out
of scope. `manager/challans/[orderId]`, `operator/shades` and the two `tinter-issue/[id]` files mix
a GET with a mutating handler, and the gate was read **at the handler, not at the file**.

### Manager — 12 mutating handlers, 12 files

| # | File · line | Method | Exact role gate | Also a flag? | Protects |
|---|---|---|---|---|---|
| 1 | `manager/assign/route.ts:21` | POST | `requireRole([TINT_MANAGER, ADMIN, OPERATIONS, OPERATION_MANAGER])` `:23` | yes — `:24` `primary !== "admin" && primary !== OPERATIONS` → `checkPermission(primary, "tint_manager", "canEdit")` | assign a tint job to an operator |
| 2 | `manager/cancel-assignment/route.ts:10` | POST | same 4 · `:12` | same · `:13-14` | cancel an assignment, bill back to Pending |
| 3 | `manager/splits/cancel/route.ts:14` | POST | same 4 · `:16` | same · `:17-18` | cancel a split |
| 4 | `manager/splits/create/route.ts:63` | POST | same 4 · `:65` | same · `:66-67` | create splits off one OBD |
| 5 | `manager/splits/reassign/route.ts:15` | POST | same 4 · `:17` | same · `:18-19` | move a split to another operator |
| 6 | `manager/orders/[id]/status/route.ts:8` | PATCH | same 4 · `:13` | **no — role only** | order stage change (`orders.update` `:56` + `order_status_logs.create` `:61`) |
| 7 | `manager/splits/[id]/status/route.ts:8` | PATCH | same 4 · `:13` | **no — role only** | split stage change (`order_splits.update` `:60` + `split_status_logs.create` `:65`) |
| 8 | `manager/reorder/route.ts:16` | PATCH | same 4 · `:18` | **no — role only** | operator queue re-sequence (4 `sequenceOrder` updates, `:97-98`/`:139-140`) |
| 9 | `manager/challans/[orderId]/route.ts:432` | PATCH | same 4 · `:437` | **no — role only** | challan save + formula upsert |
| 10 | `manager/manual-entry/route.ts:41` | POST | `requireRole([TINT_MANAGER, ADMIN])` · `:43` | **no — role only** | manual tint entry — **6 writes**, incl. `delivery_challans.create` `:267` |
| 11 | `manager/manual-entry/revert/route.ts:52` | POST | `requireRole([TINT_MANAGER, ADMIN])` · `:54` | **no — role only** | revert a manual entry — 5 writes |
| 12 | `manager/orders/[id]/remove/route.ts:15` | POST | inline `session.user.role === "admin"` bypass · `:29` | yes — `:32` `checkAnyPermission(roles, "tint_manager", **"canView"**)` | soft-remove an OBD + void its challan |

### Operator — 13 mutating handlers, 13 files (12 gate on a title)

| # | File · line | Method | Exact role gate | Also a flag? | Protects |
|---|---|---|---|---|---|
| 13 | `operator/start/route.ts:15` | POST | `requireRole([TINT_OPERATOR, OPERATIONS])` · `:17` | yes — `:19-21` `isAdminOrOps` bypass → `checkAnyPermission(roles, "tint_operator", "canEdit")` | start a tint job |
| 14 | `operator/done/route.ts:29` | POST | same 2 · `:31` | same · `:33-35` | finish a tint job |
| 15 | `operator/split/start/route.ts:21` | POST | same 2 · `:23` | same · `:25-27` | start a split |
| 16 | `operator/split/done/route.ts:29` | POST | same 2 · `:31` | same · `:33-35` | finish a split (+ parent bubble) |
| 17 | `operator/pause/route.ts:37` | POST | **no `requireRole`** — inline `roles.includes("admin")` bypass · `:51` | yes — `:52` `checkAnyPermission(roles, "tint_operator", **"canView"**)` | pause a job (3 writes) |
| 18 | `operator/resume/route.ts:17` | POST | same shape · `:30` | yes — `:31` **`"canView"`** | resume a job (3 writes) |
| 19 | `operator/shades/route.ts:134` | POST | `hasRole([TINT_OPERATOR, TINT_MANAGER, ADMIN])` · `:136` (`ALLOWED_ROLES` `:54`) | **no — role only** | `shade_master.create` `:196` — ⚠ **deprecated table** |
| 20 | `operator/shades/[id]/route.ts:51` | PUT | same 3 · `:56` (`ALLOWED_ROLES` `:48`) | **no — role only** | `shade_master.update` `:91` — ⚠ **deprecated table** |
| 21 | `operator/tinter-issue/route.ts:27` | POST | `hasRole([TINT_OPERATOR, ADMIN, OPERATIONS])` · `:29` | **no — role only** | log a tinter issue |
| 22 | `operator/tinter-issue/[id]/route.ts:69` | PATCH | same 3 · `:74` | **no — role only** | edit a tinter-issue entry |
| 23 | `operator/tinter-issue-b/route.ts:26` | POST | same 3 · `:28` | **no — role only** | tinter-issue B create |
| 24 | `operator/tinter-issue-b/[id]/route.ts:70` | PATCH | same 3 · `:75` | **no — role only** | tinter-issue B edit |
| — | `operator/skip/route.ts:27` | POST | **none** — session at `:30`, then `asg.assignedToId !== userId → 403 "Not your job"` at `:107` | no | skip an assigned job. **Not a job-title gate — nothing to convert.** |

### My count vs the census's 24

**24 job-title-gated mutating handlers — the census's number is right, its §2f heading is not.**

- §2e "Tint Manager (12 files)" — **agrees**, file for file. 12/12.
- §2f is headed **"Tint Operator (10 files)"** and its own table lists **12 rows**. The table is
  correct; the heading is a stale count. Derived independently here: 12 operator files carry a
  job-title gate on a mutating handler.
- §2f omits `operator/skip` entirely. That is not an error — skip names no role, so it does not
  belong in a role census. It is recorded here so a later reader does not "find" a 13th operator
  route and conclude the census missed it. The 08-30 report §3c row 19 already has it.
- 12 + 12 = **24**, matching the prompt. Counted as *handlers* rather than *files* the answer is the
  same, because no file carries two mutating handlers.

---

## 2. The two sets, side by side

### The population that can touch tint at all

Of 39 users (32 active), **six** appear anywhere in either set. The other 33 hold no tint role and
no tint tick — every one of the seven inactive accounts included (`Test Support`, `Test Dispatcher`,
`Test Floor Supervisor`, `Ramesh K.`, `Sunil P.`, `Test Picker 2`, `Test Delete Me`). None appears
in any A or B below, so no row is quietly carrying a dormant account.

| id | Name | Effective roles (`user_roles`, else primary) | `session.user.role` (singular) | `tint_manager` ticks | `tint_operator` ticks |
|---|---|---|---|---|---|
| u1 | **Harsh** | `admin` | `admin` | V+I+X+E+D | V+I+X+E+D |
| u20 | **Operations User** | `operations`, `logistics` | `operations` | **— none —** | **— none —** |
| u21 | **Chandresh Kolgha** | `tint_manager`, `tint_operator` | `tint_manager` | V+X+E | V+E |
| u22 | **Deepak Vasava** | `tint_operator` | `tint_operator` | — none — | V+E |
| u23 | **Chandrasing Valvi** | `tint_operator` | `tint_operator` | — none — | V+E |
| u32 | **Prakash** | `floor_access`, `operation_manager` | `operation_manager` | V+X+E | **— none —** |

All six are active. `Harsh` is the sole superuser.

🔴 **Two things in that table decide almost every row below.**

1. **`Operations User` holds no tint tick of any kind.** Not `canView`, not `canEdit`, on neither
   key. Today he passes every tint gate that names `operations` — and every one of those gates
   either *bypasses* the flag check for him (`primary !== OPERATIONS`, `isAdminOrOps`) or does not
   check a flag at all. He is admitted **entirely** by the spelling of his job title.
2. **`Harsh` holds `admin` and nothing else.** `requireRole` (`lib/rbac.ts:58-66`) has **no admin
   short-circuit** — it is a plain "does the merged role set intersect the allowed array". So
   `requireRole([TINT_OPERATOR, OPERATIONS])` **redirects the superuser to `/unauthorized`.** The
   `userRoles.includes("admin")` test on the very next line of those four routes is unreachable for
   an admin-only account.

### Method

- **A (today)** = evaluate the live gate, in order, against each of the six. `requireRole` reads the
  **merged** set (`session.user.roles ?? [session.user.role]`); the `!== "admin"` /
  `!== OPERATIONS` bypasses and `checkPermission(session!.user.role, …)` read the **singular**
  primary. Where a flag check survives the bypass it resolves in **user mode** — the roleSlug
  argument only feeds the `=== "admin"` short-circuit; the row actually read is `user_page_access`
  by `session.user.id` (`lib/permissions.ts:544-560`).
- **B (after)** = the same handler with the role array deleted and one
  `checkAnyPermission(roles, <key>, <action>)` left, keeping both superuser arms
  (`roles.includes("admin")` and `isSuperuser`) exactly as `checkAnyPermission` already carries them.

### Group M1 — assign · cancel-assignment · splits/cancel · splits/create · splits/reassign (5 routes)

`requireRole([TM, ADMIN, OPERATIONS, OPERATION_MANAGER])` → bypass if primary is `admin` or
`operations` → else `tint_manager` / `canEdit`.

| | Who |
|---|---|
| **A — today** | Harsh *(bypass: primary=admin)* · **Operations User** *(bypass: primary=operations — no flag consulted)* · Chandresh Kolgha *(tick)* · Prakash *(tick)* |
| **B — tick I would use: `tint_manager` / `canEdit`** | Harsh · Chandresh Kolgha · Prakash |
| 🔴 **WOULD LOSE** | **Operations User** |
| **WOULD GAIN** | *empty* |

### Group M2 — orders/[id]/status · splits/[id]/status · reorder · challans/[orderId] PATCH (4 routes)

`requireRole([TM, ADMIN, OPERATIONS, OPERATION_MANAGER])` and nothing else. No flag is consulted for
anybody.

| | Who |
|---|---|
| **A — today** | Harsh · **Operations User** · Chandresh Kolgha · Prakash |
| **B — `tint_manager` / `canEdit`** | Harsh · Chandresh Kolgha · Prakash |
| 🔴 **WOULD LOSE** | **Operations User** |
| **WOULD GAIN** | *empty* |

> **The challan PATCH has a second candidate key, and it does not change the answer.**
> `challans/[orderId]` is the Delivery Challans screen, so `delivery_challans` / `canEdit` is the
> defensible choice over `tint_manager` / `canEdit`. Live holders of `delivery_challans.canEdit` are
> **Harsh, Chandresh Kolgha, Prakash** — the identical set. Either key gives the same B, the same
> loss and the same gain **today**; they are two different keys and can diverge tomorrow, so the
> choice still has to be made deliberately rather than by coincidence.

### Group M3 — manual-entry · manual-entry/revert (2 routes)

`requireRole([TINT_MANAGER, ADMIN])` — a **narrower** array than every other manager route.

| | Who |
|---|---|
| **A — today** | Harsh · Chandresh Kolgha |
| **B — `tint_manager` / `canEdit`** | Harsh · Chandresh Kolgha · Prakash |
| **WOULD LOSE** | *empty* |
| 🔴 **WOULD GAIN** | **Prakash** |

> This is the reverse case §3 asks about, and it is the quiet one. Prakash (`operation_manager`)
> holds `tint_manager.canEdit`, so a straight conversion hands him **manual tint entry and
> manual-entry revert** — 6 and 5 writes respectively, including `delivery_challans.create` at
> `manual-entry/route.ts:267`. Nobody decided he should have it; the narrow role array is the only
> thing withholding it, and converting deletes that array. Whether the narrowness was deliberate or
> a copy-paste that never grew the other two names is **not recoverable from the code** — neither
> route carries a comment, and both predate the census.

### Group M4 — orders/[id]/remove (1 route)

Inline `role === "admin"` bypass → `tint_manager` / **`canView`**. One of the three no-comment
routes; see §4.

| | Who |
|---|---|
| **A — today (`canView`)** | Harsh · Chandresh Kolgha · Prakash |
| **B — `tint_manager` / `canEdit`** (the correct action) | Harsh · Chandresh Kolgha · Prakash |
| **WOULD LOSE** | *empty* |
| **WOULD GAIN** | *empty* |

### Group O1 — operator/start · done · split/start · split/done (4 routes)

`requireRole([TINT_OPERATOR, OPERATIONS])` → bypass if merged roles include `admin` or `operations`
→ else `tint_operator` / `canEdit`.

| | Who |
|---|---|
| **A — today** | **Operations User** *(bypass)* · Chandresh Kolgha *(tick)* · Deepak Vasava *(tick)* · Chandrasing Valvi *(tick)* — **Harsh is NOT in A**: `requireRole` has no admin arm and he holds neither name |
| **B — `tint_operator` / `canEdit`** | Harsh *(tick, and the admin arm inside `checkAnyPermission`)* · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| 🔴 **WOULD LOSE** | **Operations User** |
| 🔴 **WOULD GAIN** | **Harsh** |

> Harsh's gain is the superuser being let back into four routes he is currently redirected out of.
> It is almost certainly the intended state — every other tint gate admits him — but it **is** a
> change in who can call these endpoints, and it is exactly the kind of thing this gate exists to
> name rather than assume. Note it is *not* the flag arm doing it: `checkAnyPermission` would admit
> him on `roles.includes("admin")` even with all his ticks off.

### Group O2 — operator/pause · resume (2 routes)

No `requireRole` at all. `roles.includes("admin")` bypass → `tint_operator` / **`canView`**. Two of
the three no-comment routes; see §4.

| | Who |
|---|---|
| **A — today (`canView`)** | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi. **Operations User is already OUT** — he holds no `tint_operator` tick and is not `admin`, and these two routes have no `operations` arm to carry him |
| **B — `tint_operator` / `canEdit`** (the correct action) | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| **WOULD LOSE** | *empty* |
| **WOULD GAIN** | *empty* |

### Group O3 — operator/shades POST · operator/shades/[id] PUT (2 routes)

`hasRole([TINT_OPERATOR, TINT_MANAGER, ADMIN])`, no flag. **The tick you pick decides the answer,
and the two candidates disagree.**

| | Who |
|---|---|
| **A — today** | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| **B(i) — `shade_master` / `canEdit`** *(the key that names what the route writes)* | Harsh · Chandresh Kolgha |
| **B(ii) — `tint_operator` / `canEdit`** *(the key that names where the route lives)* | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| 🔴 **WOULD LOSE under B(i)** | **Deepak Vasava, Chandrasing Valvi** — both real, active tint operators |
| **WOULD LOSE under B(ii)** | *empty* |
| **WOULD GAIN** | *empty*, under either |

> `shade_master.canEdit` is held by **Harsh and Chandresh Kolgha only** (live). The role template
> agrees — `role_permissions` grants `shade_master` to `tint_manager` and `admin` and to no operator
> slug. So the semantically obvious key silently revokes shade creation from the two people whose
> screen it is. This is the one route pair in the module where conversion is a **judgement call
> about intent**, not a mechanical substitution, and it is left unresolved here by design.
>
> ⚠ Both routes write **`shade_master`, which CORE §13 and `CLAUDE_TINT.md §14` both record as
> DEPRECATED since 2026-05-25 with the instruction "Do not write to it"** — the live operator
> workflow writes `sampling_register` / `sampling_recipes` / `sampling_usage_log` instead. Whether
> these two routes still have a caller was **not** established here (out of scope; no code was read
> beyond the gate and the write line). If they are dead, the right move is not a tick at all.

### Group O4 — tinter-issue POST/PATCH · tinter-issue-b POST/PATCH (4 routes)

`hasRole([TINT_OPERATOR, ADMIN, OPERATIONS])`, no flag.

| | Who |
|---|---|
| **A — today** | Harsh · **Operations User** · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| **B — `tint_operator` / `canEdit`** | Harsh · Chandresh Kolgha · Deepak Vasava · Chandrasing Valvi |
| 🔴 **WOULD LOSE** | **Operations User** |
| **WOULD GAIN** | *empty* |

### The whole thing on one page

| Routes | WOULD LOSE | WOULD GAIN |
|---|---|---|
| M1 — assign, cancel-assignment, splits/cancel, splits/create, splits/reassign (5) | **Operations User** | empty |
| M2 — orders/[id]/status, splits/[id]/status, reorder, challans/[orderId] (4) | **Operations User** | empty |
| M3 — manual-entry, manual-entry/revert (2) | empty | **Prakash** |
| M4 — orders/[id]/remove (1) | empty | empty |
| O1 — start, done, split/start, split/done (4) | **Operations User** | **Harsh** |
| O2 — pause, resume (2) | empty | empty |
| O3 — shades POST, shades/[id] PUT (2) | **Deepak Vasava, Chandrasing Valvi** *(under `shade_master`)* · empty *(under `tint_operator`)* | empty |
| O4 — tinter-issue ×2, tinter-issue-b ×2 (4) | **Operations User** | empty |

**15 of 24 routes lose Operations User. 2 gain Prakash. 4 gain Harsh. 2 may lose both operators
depending on a single key choice.**

---

## 3. The reverse — who would GAIN, in full

Three gains, all named above, restated here because the prompt asks for them separately and because
a gain nobody intended is the quieter failure.

| Who | On what | Why they gain | Is it intended? |
|---|---|---|---|
| **Prakash** (`operation_manager`) | `manager/manual-entry` POST · `manager/manual-entry/revert` POST | He holds `tint_manager.canEdit`. Today the narrow `requireRole([TINT_MANAGER, ADMIN])` is the *only* thing withholding these two routes from him; every other manager route already admits him. | **Unknown — and this is the open question of the whole gate.** No comment on either route. If the narrow array was deliberate, a tick cannot express it and these two routes must keep the job title (§6). If it was a copy-paste that never grew, the gain is a bug fix. **Owner decision.** |
| **Harsh** (superuser) | `operator/start` · `done` · `split/start` · `split/done` | `requireRole` has no admin arm (`lib/rbac.ts:58-66`), so the superuser is redirected today. `checkAnyPermission` carries both superuser arms, so he is admitted after. | **Almost certainly yes** — he is admitted on every other tint route and holds all five ticks on both keys. Named anyway because it is a real change to the admitted set, not a no-op. |
| *nobody else* | — | — | — |

**Nobody gains on M1, M2, M4, O2, O3 or O4.** Explicitly checked, not assumed: for each of those the
B set is a subset of the A set, person by person.

---

## 4. The three routes with no comment

`CLAUDE_CORE.md §13` (via census §9 item 6) and the 08-30 report §3b rows 3-5 flag these as gating
on `canView` where `canEdit` is meant, harmless *today* only because the two holder sets are
identical. Under per-user ticks those sets can diverge by construction.

| Route | Gate today | Correct action | Who it changes, today | The divergence risk |
|---|---|---|---|---|
| `operator/pause/route.ts:52` | `tint_operator` / `canView` — writes `tint_pause_events.create`, `tint_assignments.update`, `order_status_logs.create` | **`canEdit`** | **Nobody.** `tint_operator` canView holders = canEdit holders = Harsh, Chandresh, Deepak, Chandrasing. Verified live, not inferred. | A view-only grant on `tint_operator` — one tick on `/admin/access`, no deploy — hands that person the ability to pause a live tint job. Under role mode that required minting a whole new role; now it is a checkbox. |
| `operator/resume/route.ts:31` | `tint_operator` / `canView` — 3 writes | **`canEdit`** | **Nobody.** Same two identical sets. | Same. Pause and resume move together; they are the same latent hole twice. |
| `manager/orders/[id]/remove/route.ts:32` | `tint_manager` / `canView` — soft-removes an OBD (`orders.update` `:96`), voids its challan (`delivery_challans.update` `:109`), logs the stage `:121` | **`canEdit`** | **Nobody.** `tint_manager` canView = canEdit = Harsh, Chandresh, Prakash. | **The worst of the three by consequence** — a view-only grant would let someone remove a bill from the board and void a challan. ⚠ Note the route's own comment at `:26-27`: *"Page access = full action authority on that page (OrbitOMS locked model)."* That is a **deliberate design claim that `canView` implies write authority** — and it is exactly the model per-user ticks retire. It is the closest thing to a rationale any of the three carries, and it argues *against* the conversion rather than for it. |

**All three change nobody today.** That is the finding, and it is the reason the fix is cheap right
now and will not stay cheap: the sets are identical *by accident of the current grid*, and the grid
is now editable per person from a screen.

**⚠ No fourth `canView`-on-a-write exists in tint.** The 08-30 report lists five such routes
app-wide, three of them tint. This sweep confirms the list is complete for `app/api/tint/**` — the
other nine flag-checking tint handlers all read `canEdit`.

---

## 5. Live data — the authority

`ACCESS_SOURCE = 'user'`, so `user_page_access` is what the app enforces. `role_permissions` is the
fallback only. Both are printed; where they disagree, the first is what is live.

### `user_page_access` — page key `tint_manager`

All 39 users have a row (dense; all five booleans stored). **36 rows are all-false.** The three that
are not:

| Flag | Holders, by name |
|---|---|
| `canView` | **Harsh, Chandresh Kolgha, Prakash** |
| `canImport` | **Harsh** |
| `canExport` | **Harsh, Chandresh Kolgha, Prakash** |
| `canEdit` | **Harsh, Chandresh Kolgha, Prakash** |
| `canDelete` | **Harsh** |

### `user_page_access` — page key `tint_operator`

39 rows. **35 all-false.** The four that are not:

| Flag | Holders, by name |
|---|---|
| `canView` | **Harsh, Chandresh Kolgha, Deepak Vasava, Chandrasing Valvi** |
| `canImport` | **Harsh** |
| `canExport` | **Harsh** |
| `canEdit` | **Harsh, Chandresh Kolgha, Deepak Vasava, Chandrasing Valvi** |
| `canDelete` | **Harsh** |

All eight holders above are **active**. No inactive account holds a tint tick.

**`canView` and `canEdit` are the same set on both keys.** That single fact is why §4's three routes
are harmless today, and why every "would lose" / "would gain" in §2 is driven by the role array
rather than by the choice of action.

### Adjacent keys, because two of them are candidate targets

| Key | `canView` | `canEdit` | `canExport` |
|---|---|---|---|
| `shade_master` | Harsh, Chandresh Kolgha | **Harsh, Chandresh Kolgha** | Harsh |
| `delivery_challans` | Harsh, Chandresh Kolgha, Prakash | **Harsh, Chandresh Kolgha, Prakash** | Harsh |
| `ti_report` | Harsh, Chandresh Kolgha, Prakash | Harsh | Harsh, Chandresh Kolgha, Prakash |
| `sampling_library` | Harsh, Chandresh, Deepak, Chandrasing, Dhruv, Kuldeep, Prakash | same seven | Harsh, Chandresh, Dhruv, Kuldeep, Prakash |

### `role_permissions` — the fallback, for comparison only

```
tint_manager   admin              V+I+X+E+D
tint_manager   operation_manager  V+X+E
tint_manager   tint_manager       V+X+E
tint_manager   dispatcher / floor_supervisor / picker / support / tint_operator   NONE
tint_operator  admin              V+I+X+E+D
tint_operator  tint_operator      V+E
tint_operator  dispatcher / floor_supervisor / picker / support / tint_manager    NONE
```

🔴 **There is no `operations` row for either key — not in the table, not in the ticks.** The role
that 15 of the 24 routes name by hand has never been granted tint access by either access system.
It has only ever been granted by the role arrays themselves.

🔴 **`tint_manager` holds no `tint_operator` grant in the fallback, yet Chandresh Kolgha holds
`tint_operator` ticks.** Not a fill error: he carries `tint_operator` as a **secondary role** in
`user_roles`, and the 2026-09-04 fill reproduced `getAllPermissionsForRoles()`' OR-merge across all
of a person's roles. His ticks are correct; a reader comparing the two tables column-by-column will
think they disagree, and they do not.

---

## 6. What cannot be expressed as a tick — the FACE sites

The census §3 distinction: a role read that asks **"which person is this"** rather than **"is this
allowed"**. These cannot become a tick, because a tick answers the second question and they ask the
first.

### 6a. `isOpsOrAdmin` — the ownership-scope branch. **9 handlers. KEEP THE JOB TITLE.**

```ts
const isOpsOrAdmin = ["operations", "admin"].includes(session!.user.role ?? "");
...
where: { orderId, ...(isOpsOrAdmin ? {} : { assignedToId: userId }), ... }
```

This does not decide whether the caller may act. It decides **whose rows the query is allowed to
touch** — an operator is scoped to his own assignments, a supervisor sees everyone's. Same shape as
`app/api/picking/combined/route.ts:63` (census §3a row 2), which carries the explicit comment *"a
picker cannot ask for anybody else's combined list even by editing the URL."*

Sites, all reading the **singular** `session.user.role`:

| Handler | Declared | Used at |
|---|---|---|
| `operator/start/route.ts` POST | `:32` | `:38`, `:56`, `:85` |
| `operator/done/route.ts` POST | `:46` | `:62` |
| `operator/split/start/route.ts` POST | `:38` | `:44`, `:65`, `:88` |
| `operator/split/done/route.ts` POST | `:46` | `:60` |
| `operator/tinter-issue/route.ts` POST | `:80` | `:87`, `:93` |
| `operator/tinter-issue/[id]/route.ts` PATCH | `:89` | `:98`, `:105` |
| `operator/tinter-issue-b/route.ts` POST | `:79` | `:86`, `:92` |
| `operator/tinter-issue-b/[id]/route.ts` PATCH | `:90` | `:99`, `:106` |
| `operator/my-orders/route.ts` GET *(not mutating — listed for completeness)* | `:23` | `:41`, `:58`, `:107`, `:142`, `:160` |

**What breaks if this is converted to a tick.** Replace it with `tint_operator.canEdit` and every
holder of that tick — today Chandresh, Deepak and Chandrasing — takes the wide arm and can start,
finish or edit **any operator's job**, not their own. The one-job-at-a-time rule
(`operator/start/route.ts:56`) and the "Assignment not found or not assigned to you" 404s all hang
off this branch. It fails **open**, not closed — the opposite of the picking FACE sites the census
examined.

⚠ **These nine sit inside eight of the 24 routes being converted.** The conversion touches the
`requireRole` line and the `checkAnyPermission` line in the same handlers. **The `isOpsOrAdmin` line
sits between them and must be left exactly as it is** — including its use of the singular
`session.user.role` rather than the merged set, which is a separate latent inconsistency and not
this session's to resolve.

### 6b. `operator/skip/route.ts:107` — ownership, already tick-free

`if (asg.assignedToId !== userId) → 403 "Not your job"`. No role, no tick, no conversion. Already in
the shape the other operator routes would need if their FACE branch were ever rewritten. Listed so a
converting session does not open the file, find no `requireRole`, and assume it was missed.

### 6c. Checked and found NOT to be FACE

- The `isAdminOrOps` variable on `start` / `done` / `split/start` / `split/done` / `history` /
  `my-orders` (`:19` / `:33` / `:25` / `:33` / `:114` / `:16`) reads the **merged** set and only
  decides whether to run the permission check. It is a permission bypass, converts cleanly, and is
  **not** the `isOpsOrAdmin` branch a few lines below it despite the near-identical name.
  🔴 **Two variables, one letter apart, opposite classifications, in the same eight functions.**
  This is the single most likely mistake a converting session will make. A rename is out of scope
  here, but would be cheap and worth doing first.
- `manager/challans/[orderId]/route.ts:269` / `:280` — `OWNER_ROLES` / `SITE_ROLES` are **customer
  contact roles** on `contactRole.name` (the S5 contact cascade, `CLAUDE_TINT.md §9.6`). Nothing to
  do with user roles. A grep for `ROLES` lights these up every time.
- `app/(tint)/tint/manager/layout.tsx:23` / `operator/layout.tsx:23` — `primaryRole` is passed to
  `buildNavItems` and cast `as RoleSidebarRole`. Label lookup only (census §3b). Not FACE, not a
  gate.

---

## 7. Noted in passing — not fixed, not proposed

Per the prompt's scope discipline: observed while reading the gate, **nothing acted on.**

1. 🔴 **The screens and their APIs already disagree, right now.** Both tint layouts gate on
   `checkAnyPermission(roles, "<key>", "canView")` with only an `admin` bypass
   (`manager/layout.tsx:25-28`, `operator/layout.tsx:25-28`). Operations User holds neither tick, so
   he is **already redirected to `/unauthorized`** at `/tint/manager` and `/tint/operator` — while
   the 15 API routes beneath them still admit him by title. His access is reachable only by calling
   the endpoints directly. Whether that is a live defect or a dead role array is an owner question;
   either way, "he would lose it" describes something he cannot currently use through the UI.
2. `app/(tint)/ti-report/page.tsx:9` sits under `app/(tint)/layout.tsx`, which has **no gate at
   all**, and its own `requireRole` names `OPERATIONS`. So Operations User can reach `/ti-report`
   even though he cannot reach `/tint/manager/ti-report`. Read-only screen, out of scope, unverified
   beyond those two files.
3. `requireRole` has **no admin arm**. Six tint gates therefore exclude an admin-only account. Known
   consequence of `lib/rbac.ts:58-66`; the superuser also holds the role today, so only an
   admin-*only* account is affected, and exactly one account exists.
4. **`$transaction` in tint, as already documented.** `manager/cancel-assignment` and
   `manager/splits/cancel` both wrap their sequence in an interactive `prisma.$transaction` —
   `CLAUDE_TINT.md §14` records this as deliberately deferred, an owner decision.
   `manager/challans/[orderId]:527` likewise. Untouched.
5. **`shades` POST/PUT write the deprecated `shade_master`** (`:196`, `:91`) against CORE §13's "Do
   not write to it". Flagged in §2 group O3.
6. `CLAUDE_TINT.md §13` lists three TM page keys and reproduces a `role_permissions` INSERT as if it
   were the access model. Under `ACCESS_SOURCE = user` that SQL is the fallback table, not live
   access. Stale framing, not a wrong fact. Not edited.
7. The census §2f heading says **10 files** where its own table lists **12**. Recorded in §1 so the
   number is not copied forward a third time.
8. `operator/history` GET and `operator/my-orders` GET carry the same
   `requireRole([TINT_OPERATOR, OPERATIONS])` + `tint_operator` / `canView` shape as the mutating
   four. They are reads, so outside this gate's scope, but they carry the **same** Operations-User
   loss and the **same** Harsh gain, and should move in the same commit rather than be left behind.

---

## 8. What this gate settles, and what it does not

**Settled, from live data:**

- 24 job-title-gated mutating handlers, 12 manager + 12 operator. The census's number is right.
- Exactly one active person loses anything on the straight conversion: **Operations User**, on 15 of
  the 24.
- Exactly two people gain: **Prakash** on 2 routes, **Harsh** on 4.
- The three no-comment `canView` routes change **nobody** today, on verified holder sets.

**Not settled — owner decisions, stated as questions, not answered:**

1. **Is `operations` meant to have tint write access at all?** No tick, no `role_permissions` row,
   locked out of both screens, admitted by 15 role arrays. One of those four facts is wrong and the
   code cannot say which.
2. **Was `requireRole([TINT_MANAGER, ADMIN])` on the two manual-entry routes deliberate?** If yes,
   they keep the job title and join §6. If no, Prakash's gain is a fix.
3. **`shade_master` or `tint_operator` for the two shades routes** — the choice costs two active
   operators their shade writes, or does not. Prior question: does anything still call them, given
   the table is deprecated?
4. **Does `canView` imply write authority on a page?** `manager/orders/[id]/remove:26-27` says yes in
   so many words ("the OrbitOMS locked model"). Per-user ticks assume no. That contradiction is
   older than this gate and outlives it.

---

*Discovery only. No application code was written, edited, archived or moved. No conversion was
written and none is proposed. Three read-only query scripts were added under `scripts/_*` (outside
the `tsc` gate per `tsconfig.json`'s `exclude`). Every set membership above was derived by
evaluating the live gate against live rows, not by reading a prior document — where a prior document
is quoted, it is named and checked.*
