# Tint and master data move to per-user ticks — what shipped, 2026-09-06
# Type: `code-update` · Lives in: docs/prompts/drafts/

**Type:** `code-update` — the record of work that is live on `main`.
**Continues:** `code-update-2026-09-04-user-based-access.md` (steps 1-5, the model itself).
**Gated by:** `code-discovery-2026-09-06-tint-conversion-gate.md` ·
`code-discovery-2026-09-06-master-data-gate.md` — both read-only, both written before any code moved.

**In one line:** the two biggest blocks of job-title gates left after 2026-09-04 — the Tint module
and the master-data screens — now decide access from the caller's own `user_page_access` row, and
the 57 redundant admin bypasses that stood in front of those checks are gone. **Seven commits, all
pushed. No SQL, no schema change, no schema version minted.**

Canon: `CLAUDE_TINT.md §13` (rewritten) · `CLAUDE_CORE.md §5` / `§13` · `ROADMAP.md` →
*User-based access*.

---

## 1. What shipped, in order

| # | SHA | What | Files |
|---|---|---|---|
| 1 | `cd0ed055` | tint: rename `isOpsOrAdmin` → `canSeeAllOperatorRows` | 9 |
| 2 | `64f897a9` | tint: gate write routes on per-user ticks instead of job titles | 21 |
| 3 | `74c51869` | tint: `canEdit` on three write routes; audit four unattributed writes | 7 + ROADMAP |
| 4 | `2b25a48f` | tint: fix manual-entry lookup left behind by `64f897a9` | 1 |
| 5 | `d3211766` | admin: master-data routes gate on ticks, not job titles | 7 |
| 6 | `65fd0e10` | rbac: remove redundant admin bypasses | 57 + CORE + ROADMAP |
| 7 | `fbbe30bd` | tint: read routes gate on ticks | 13 |

### The order was the point, again

Same discipline as 2026-09-04, for a different reason. There the sequence made each step inert until
the next turned it on; here it makes each step **legible**.

1. **Rename first.** `isOpsOrAdmin` and `isAdminOrOps` sat one letter apart in the same eight
   functions and meant opposite things — one a FACE branch that must never convert, one a bypass
   that must. The conversion edits the lines immediately above and below the FACE one. Renaming it
   in its own commit, with `added == deleted` in every file, means the next diff **cannot** touch it
   by accident, and a reviewer can see that it did not.
2. **Writes, then the repair, then reads.** Writes are where a wrong gate costs data. Reads followed
   the same day only because the write conversion left an asymmetry (§4) that had to be closed.
3. **Bypasses last.** Removing 57 wrappers touches 57 files across every module. Doing it before the
   tint and master-data conversions would have buried two behaviour changes inside a diff that is
   supposed to have none.

---

## 2. Commit by commit — what changed, and who gained or lost

### 1 · `cd0ed055` — the rename

Pure rename, 30 lines across 9 files, `added == deleted` in every file. **Nobody gains or loses
anything.** It exists so that commit 2 is safe to read.

```
canSeeAllOperatorRows   reads the SINGULAR session.user.role and decides WHOSE ROWS the
  (was isOpsOrAdmin)    query may touch: ...(x ? {} : { assignedToId: userId }). A FACE
                        branch. 🔴 NEVER a tick — it fails OPEN.
isAdminOrOps            reads the MERGED role set and only decides whether to run the
                        permission check. A bypass. Converts cleanly.
```

Documented permanently in `CLAUDE_TINT.md §13.4`, with both names in the table so a grep for either
one lands on the warning.

### 2 · `64f897a9` — the tint writes

19 write handlers + 2 reads, per the gate report's group tables.

| Tick | Handlers |
|---|---|
| `tint_manager`/`canEdit` (11) | `assign`, `cancel-assignment`, `splits/cancel`, `splits/create`, `splits/reassign`, `orders/[id]/status`, `splits/[id]/status`, `reorder`, `challans/[orderId]` PATCH, `manual-entry`, `manual-entry/revert` |
| `tint_operator`/`canEdit` (8) | `start`, `done`, `split/start`, `split/done`, `tinter-issue` POST + `[id]` PATCH, `tinter-issue-b` POST + `[id]` PATCH |
| `tint_operator`/`canView` (2) | `history`, `my-orders` |

- 🔴 **LOST: Operations User**, on 15 of the 19 writes. He holds **no tick on either tint key**, and
  no `role_permissions` row has ever granted him one — he was admitted purely by the spelling of
  `operations` inside a role array. **Both tint layouts already redirected him** at `/tint/manager`
  and `/tint/operator`, so what he lost was reachable only by direct HTTP call. Intended: this
  closed a gap that was open, it did not open one.
- **GAINED: Prakash** (`operation_manager`), on `manual-entry` and `manual-entry/revert` — the only
  two manager routes carrying the narrow `[TINT_MANAGER, ADMIN]` where every other one also named
  `OPERATION_MANAGER`. Owner-approved. *(This gain is what commit 4 exists to make usable.)*
- **GAINED: Harsh** (the superuser), on `start` / `done` / `split/start` / `split/done`.
  `requireRole` has no admin arm, so those four had been redirecting the owner to `/unauthorized`.

Deliberately untouched and verified untouched: `canSeeAllOperatorRows` (0 removed lines mention it),
`operator/shades` + `operator/shades/[id]` (empty diff), the two `$transaction` routes.

### 3 · `74c51869` — `canEdit`, and four audit calls

Two repairs to files commits 1-2 already touched, so they were not opened a third time.

**`canView` → `canEdit`** on `operator/pause`, `operator/resume`, `manager/orders/[id]/remove` —
three writes each, gated on a read permission. **All three change NOBODY today**: `canView` and
`canEdit` are the same holder set on both tint keys. They were latent, not live. What made them
worth closing is that the sets were only ever identical **by accident of the old role grid**, and
since 2026-09-04 an admin sets the two independently per person from a screen — so one view-only
grant would have handed a bystander the ability to pause a live tint job, or to remove an OBD from
the board and void its challan.

🔴 **Two code comments asserted the retired model in so many words**, and both were corrected in
place and dated rather than deleted, so the change stays legible to whoever wrote them:
`remove:26-27` — *"Page access = full action authority on that page (OrbitOMS locked model)"* — and
the same claim shorter at `pause:48-49`.

**`logAdminAction` on four tint writes** (`manager/reorder`, `manager/challans/[orderId]` PATCH,
`operator/tinter-issue/[id]` PATCH and its `-b` twin). The two TI routes mattered most:
`submittedById` is stamped at CREATE and never moves, so **every later correction to a formula was
attributable to whoever first raised the entry rather than to whoever changed it.** The challan call
is deliberately **outside** the pre-existing `$transaction`. The 5th tint gap,
`operator/shades/[id]` PUT, is deliberately still unwired — it rides with the shades
retire-or-convert decision.

### 4 · `2b25a48f` — a live bug, shipped that morning, found by the next sweep

`64f897a9` widened `manual-entry` POST and did not touch `manual-entry/lookup` GET, which kept the
narrow `[TINT_MANAGER, ADMIN]`. The modal calls them in that order —
`manual-tint-entry-modal.tsx:150` then `:188` — so **Prakash held the write and was refused the
read. Manual tint entry was broken for him for part of the day.**

🔴 **And it failed invisibly, which is why nobody reported it.** `requireRole` calls `redirect()`, a
307 that `fetch` follows to `/unauthorized`; the HTML comes back **200**, so `res.ok` is true,
`res.json()` then throws, and the modal's own catch swallowed it into a `console.error` and an empty
box. No permission error, no toast.

Now `tint_manager`/`canView`, with a comment saying **a companion GET must never be narrower than
the write it feeds.** The commit also swept all 21 converted handlers against the reads their own
screens perform, testing whether each surviving role array is a **superset** of that screen's
writers — 8 manager GETs and 2 tinter-issue GETs were supersets, and this was the **only**
asymmetry.

### 5 · `d3211766` — the master-data routes

The gate report's Group A: 14 handlers across 7 files. **On 11 of the 14 this moves NOBODY**, and
**zero people gain anywhere in the group** — 14 people passed `requireRole` on the customers routes
and 3 hold the tick; on `skus`, `routes_areas` and `vehicles` the only holder is the superuser.

🔴 **The three that needed a different key.** `admin/areas` GET, `admin/routes` GET and
`admin/sub-areas` GET carried a **three-clause** bypass — admin **OR** `tint_manager` **OR**
`support` skipped the flag entirely — so here deleting the array **narrows** rather than widens.
They are gated on **`customers`/`canEdit`, NOT `routes_areas`/`canView`.**

| | Live, 2026-09-06 |
|---|---|
| can open the sheet (`tint_manager`/`canView`) | Chandresh Kolgha · Harsh · Prakash |
| `customers`/`canEdit` | Chandresh Kolgha · Harsh · Prakash |
| `routes_areas`/`canView` | **Harsh alone** |
| who can open the sheet but lacks `customers`/`canEdit` | **nobody** — covered exactly |
| same, had `routes_areas`/`canView` been used | **Chandresh AND Prakash — both broken** |

The caller check is the reason: these three GETs have exactly **one** caller in the whole app,
`components/shared/customer-missing-sheet.tsx:162-165`, the missing-customer form on the Tint
Manager board. The admin Routes/Areas/Sub-areas tables do **not** call them — their list data
arrives as server props and they only ever POST/PATCH. So the three are reference data for
**creating a customer**, not for managing routes.

**And granting the obvious key would have been worse than the bug.** `buildNavItems` reads the same
tick, so a `routes_areas` grant handed to Chandresh to make a dropdown work would also have put a
**Routes admin screen in his sidebar** — a screen he has never had. Each of the three carries this
reasoning inline.

**One rule change, flagged rather than buried:** `sub-areas` POST moved from `requireSuperuser` to
`routes_areas`/`canEdit`, matching its `areas` and `routes` siblings. Its own `[id]` PATCH and
`import` are still `requireSuperuser`, so **sub-area CREATE is now looser than sub-area EDIT.** Same
person either way today; a different rule tomorrow. Owner decision: leave it, and bring the other
two forward. The block is commented so reverting that one handler is a two-line change.

### 6 · `65fd0e10` — the 57 redundant bypasses

**57 sites across 57 files** — 50 `if (!roles.includes("admin")) { … }` and 7 of the singular
spelling. The wrapper let admin skip a permission check it would have passed anyway.

**Safe for every possible session, not merely today's**, and proved from the resolver source rather
than from live data:

```ts
checkAnyPermission:  if (roleSlugs.includes("admin")) return true;   // line 1
checkPermission:     if (roleSlug === "admin") return true;          // line 1
both, immediately after:  if (access.isSuperuser) return true;
```

The wrapper tested **the same value by the same test** the resolver runs on its own first line.
Proved structurally too: 266 lines removed, 152 added, and the 114-line difference is exactly 57
wrapper-opens plus 57 closing braces — **every added line is a dedented copy of a removed one.**

**The count, corrected twice.** The census said 22 (mutating routes only, tint excluded); the
2026-09-06 gate said 81 (every occurrence, including forms that are not wrappers). Swept fresh
across `app/`: **76 admin-test occurrences** — 57 one-clause wrappers (removed), **9 MULTI-clause
conditions that are permission GRANTS written as role names** and change somebody, 4 of the same
redundancy in variable form, 1 un-negated FACE branch in `(ops)/layout.tsx:37` that **must not
move**, and 5 comments or UI flags.

🔴 **The warning this commit deleted was already false when it was written.** `CLAUDE_CORE.md §13`
claimed *"a superuser who is not ALSO role-admin would fall through into the permission check and
would be denied"*. Such a person falls into the resolver and is admitted by the `isSuperuser` arm
two lines later — the 2026-09-04 resolver change closed that gap in the same commit range that
introduced the warning about it. Struck through and corrected in place rather than deleted: *"the
second superuser is unsafe"* is exactly the kind of claim that gets quoted forward.

### 7 · `fbbe30bd` — the tint reads

13 handlers: the 10 tint GETs still on job titles, plus 3 redundant bypasses in the variable form
commit 6's sweep could not match (`pause-history`, `skip-history`, `remove`).

| Tick | Handlers |
|---|---|
| `tint_manager`/`canView` (8) | `challans`, `challans/[orderId]` GET, `marker`, `missing-customers`, `operators`, `orders`, `orders/[id]/splits`, `ti-report` |
| `tint_operator`/`canView` (2) | `tinter-issue/[id]` GET, `tinter-issue-b/[id]` GET |

**LOSES Operations User on 10 of 10. GAINS nobody.** Until this commit he could still read eight
manager endpoints and two tinter-issue endpoints by direct HTTP call while holding no tick and being
redirected by both layouts.

**The read/write split was never a decision** — it was the residue of two conversion dates, and it
landed inconsistently: `pause-history` and `skip-history` were already tick-gated, so he could read
a challan but not a pause history **on the same board**.

---

## 3. Where the module stands now — derived 2026-09-06, not quoted

`app/api/tint/**` holds **37 route files and 41 exported handlers.** **37 of the 41 gate on a
per-user tick**, across 35 files:

| Key | canView | canEdit | Total |
|---|---|---|---|
| `tint_manager` | 11 | 12 | **23** |
| `tint_operator` | 4 | 10 | **14** |
| **All** | **15** | **22** | **37** |

The four that do not: **`operator/shades` GET + POST and `operator/shades/[id]` PUT** (owner
decision — deprecated `shade_master`, retirement candidates) and **`operator/skip`**, which is
ownership-scoped and has no job title to convert.

**There is no job-title gate left anywhere under `app/api/tint/` except the two shades files.**

---

## 4. What the owner verified by hand — the only record of this

*Reproduced verbatim from the session brief. No session had a login, and the dev server points at
the production database, so **no session tested any of this in a browser**. This block is the only
evidence that exists.*

> **Friday 2026-09-04, after the switch was flipped to 'user':**
> - Logged in as picker (on a phone), floor supervisor, billing operator, tint manager, tint
>   operator and operation manager. All normal.
> - Admin panel after the superuser flag: `/admin` loaded, `/admin/access` showed 39 people, renamed
>   a route, changed a System Config value, Hide settings worked.
> - Audit log: created a test user, reset its password, confirmed the password row's `beforeData`
>   and `afterData` were BOTH NULL. Saving with no changes wrote no row.
> - The audit log immediately caught the old permissions screen recreating 12 retired rows on save;
>   those were cleared by SQL the same night.
>
> **Friday/Saturday, proven by real production use:**
> - The billing team punched real SO numbers all day with no issue — the 11 Mail Orders write routes
>   locked in `0f56eede`.
>
> **Sunday 2026-09-06, after the tint and master-data conversions:**
> - Chandresh Kolgha (`tint_manager`): full manager board — assign, cancel, splits, stage changes,
>   reorder, challan save. All normal.
> - A tint operator: own jobs only, still correctly scoped. Start, tinter issue, pause, resume, done,
>   and a split — all normal.
> - **THE KEY TEST, the one that proves the whole model:**
>   `/api/admin/areas` and `/api/admin/routes` opened in a browser
>   — as Chandresh Kolgha → full data returned
>   — as Bankim (billing) → `{"error":"Forbidden"}`
>   Same address, two people, opposite answers, decided by the ticks.
> - Mail Orders, MRN, Picking and Floor all loaded normally after `65fd0e10` touched 57 files across
>   every module.
>
> - ⚠ **NOT verified: manual tint entry.** The owner could not find the Manual Entry button on the
>   Tint Manager screen at all.

### 4a. The manual-entry question is ANSWERED — and "the modal may be unreachable" was the wrong candidate

Derived from the tree in this session, 2026-09-06.

**The modal is reachable. There is no button labelled "Manual Entry", and there has not been one
since the board rebuild.** `ManualTintEntryModal` is mounted at
`components/tint/tint-manager-content.tsx:869-873` on `pullModalOpen` (`:123`), and **two** things
set it:

| Entry point | Where | What it reads |
|---|---|---|
| The **"Add to Tint"** pill — a `+` icon in the board header | `tint-manager-content.tsx:715` | `title="Add OBD to Tint (M)"` |
| The **`M`** keyboard shortcut | `tint-manager-content.tsx:322-324` | listed in the header's shortcuts strip as *"Add OBD to Tint"* |

So the owner was looking for the right thing under a name the 2026-09-05/06 board rebuild
(`a0f9378b` → `082eb92e`) had already replaced. ⚠ **The API routes kept the old name** —
`manager/manual-entry`, `/lookup`, `/revert` — so a grep for either name finds only half the flow,
and that is exactly how a screen and its endpoints drift apart in the reader's head. Recorded in
`CLAUDE_TINT.md §7`.

🔴 **The flow itself is still unverified.** Knowing where the button is does not test it, and the
route behind it is the one that shipped broken for Prakash that morning (`2b25a48f`). **This remains
the one thing on the 2026-09-06 list nobody has exercised end to end** — as Chandresh, and
separately as Prakash, whose access to it is four hours old.

---

## 5. Verification a session could actually do

- `npx tsc --noEmit` exits 0 before every one of the seven commits and after this documentation pass.
- Read-only SELECTs for every claim of fact — `ACCESS_SOURCE = 'user'`, `user_page_access` = **1,053
  rows** (39 users × 27 keys), 1 superuser, and every holder set named above. Re-run today, not
  quoted from the gate reports.
- Handler counts derived by sweeping `app/api/tint/**` file by file for
  `export async function GET|POST|PATCH|PUT|DELETE` and reading the gate **at the handler, not at
  the file** — three files carry a GET and a mutating handler with different gates.
- `65fd0e10`'s neutrality proved **structurally** (added lines minus removed lines is empty) rather
  than argued from today's role table.

---

## 6. Corrections this work produced

Facts that were wrong in a prior document or in the brief, found by deriving rather than
transcribing.

| Claim | Reality |
|---|---|
| `CLAUDE_CORE.md §5` says *"/admin/customers uses the richer split view, the other three the same tables"* — the 2026-09-06 master-data gate report, repeated into the brief | **The sentence is not in §5 and never was.** It is a code comment at `lib/permissions.ts:117` and a `ROADMAP.md` bullet, and both describe the **retired Support-group** copies, where it is not wrong. The underlying fact still needed recording: `/tint/manager/customers` renders `CustomersSplitView` too |
| "22 inline bypass sites" (census) | **57** removed; **76** admin-test occurrences in total, of which 9 are grants, not bypasses |
| "81 bypass sites" (2026-09-06 gate) | counted every occurrence including non-wrapper forms; 57 is the count of the thing removed |
| Tint census §2f heading: "Tint Operator (10 files)" | its own table lists **12** |
| ROADMAP: *"Every tint GET still gates on a job title … nine manager GETs plus three GET halves"* | **stale within hours** — `fbbe30bd` converted them the same day. Corrected in this pass |
| `mrn/photo/[photoId]` bypass at `:169-170` (CORE §13) | the lines are **`:167-168`** |
| Brief: "24 gates, 22 converted" | correct for **writes**. The module-wide figure is **37 of 41 handlers** on ticks, because 13 reads converted too |
| Brief: `65fd0e10` "touched 57 files" | **57 code files**; the commit changed **59** including CORE and ROADMAP |
| Brief: the `/dispatcher` four are unreachable "including by the two people holding the dispatcher role" | **three** users hold it — Ajay Vansiya and Dhanraj Shah (active) and `Test Dispatcher` (inactive). All three hold zero of the four ticks, so the conclusion stands |
| Brief: "`api/mrn/photo/[photoId]` and `api/reports/tint-summary`: two bypasses left unswept" | true, but they are **not the same kind**. `mrn/photo` is the redundant form and harmless; `reports/tint-summary:33` is a **multi-clause grant** that still admits Operations User to a report every other tint endpoint now refuses him |

The pattern is the one 2026-09-04 named and it did not stop: **every one of these came from a number
or a location written down once and copied forward.** Three separate documents said `CLAUDE_CORE.md
§5` contained a sentence that was never in it, because the first one to say so was never checked.

---

## 7. What is NOT done

All of it is in `ROADMAP.md` → *User-based access*, one line each. The four that matter most:

1. 🔴 **`operator/shades` POST and `operator/shades/[id]` PUT** — retire or convert, and answer
   *"does anything still call them?"* first. Under `shade_master`/`canEdit` the conversion revokes
   shade writes from the two active operators whose screen it is.
2. 🔴 **The silent-403 pattern** — `fetchAll` and its cousins return `[]` on any failure, so a 403
   and "genuinely empty" are indistinguishable. **Three silent failures in one week.** One systemic
   issue to fix at the helper, not three bugs to patch.
3. 🔴 **`prisma/seed.ts` has never heard of `user_page_access`.** A wipe-and-reseed rebuilds the
   fallback and leaves live access empty — and looks like it succeeded.
4. **Manual tint entry, end to end**, as Chandresh and as Prakash (§4a).

**None of steps 7 or 8 should happen while `ACCESS_SOURCE` can still be flipped back.**
`role_permissions` is the rollback; dropping it turns a 30-second `UPDATE` into an outage.

---

*Record only. Written 2026-09-06 from the tree, the seven commit diffs and read-only SELECTs. No
application code, no SQL and no schema change in this pass. Where a prior document is quoted it is
named and checked — two were found stale and are corrected in §6 rather than repeated.*
