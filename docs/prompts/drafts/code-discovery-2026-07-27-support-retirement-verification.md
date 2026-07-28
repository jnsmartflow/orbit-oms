> UPDATED 2026-07-27. The three dead links reported
> here were fixed in commit 62a2928c (step 6b). The
> "NOT CLEAN" verdict in §1 refers to that finding
> and is now resolved. §7's recommendation for a
> step 6 fix is done.

# Support retirement — verification sweep
# 2026-07-27 · read-only · after step 5

Nothing was moved, edited, staged or committed to produce this report, and no SQL
was run. It is a survey of what is on disk after step 5, written to be readable by
someone who does not work in the code.

---

## 1. Verdict

**Not clean. Three live buttons and links still point at Support pages that no
longer exist**, so they now lead to a "page not found" error. Everything else
checked out: no code calls Support's old server routes, every module is intact,
the crons are unaffected, and the app compiles and builds exactly as expected.

The most serious of the three is on the **Import screen** (`/import`): after
running a SAP import, the "View Orders" button sends the user to the deleted
Support page. This affects everyone who imports, not just administrators, and it
is the one to fix first.

None of the three breaks the build, which is precisely why they survived steps 1-5
unnoticed — they are plain text web addresses, and nothing checks that a web
address still leads somewhere.

---

## 2. Sweep 1 — traces of Support in live code

Searched the whole project, excluding the `archive/` and `docs/` folders.

### A correction to how this sweep was run

The first pass reported "no hits" for two of the nine search terms. **That was
wrong, and it was my tooling at fault, not the code.** On this Windows machine the
shell rewrites any search term that begins with a `/` into a file path before the
search tool ever sees it — so looking for `/admin/support` actually searched for
`C:/Program Files/Git/admin/support`, which of course found nothing.

I only caught it because a differently-worded search found a hit that the first
search had declared absent. Every affected term was re-run using a form the shell
leaves alone. **All three genuine problems below were found by the corrected
search, and would have been missed by the original one.** Recording this because
the same trap will catch the next person who greps on this machine.

### The three real problems — live, not comments

| Where | What it says | What happens now |
|---|---|---|
| `app/orders/page.tsx:4` | `redirect("/support")` | The whole `/orders` page exists only to forward visitors to Support. It now forwards them to a dead page. |
| `components/import/import-page-content.tsx:206` | `viewOrdersHref = "/support"` | The fallback address for the "View Orders" button. **`/import` uses this fallback** (`app/(import)/import/page.tsx:4` passes no address of its own), so the main Import screen's button is broken. |
| `app/(admin)/admin/import/page.tsx:4` | `viewOrdersHref="/admin/support"` | The admin version of the same button, pointing at the admin mount of Support. Also dead. |

The button is wired at `import-page-content.tsx:948` and `:1002` — both do
`window.location.href = viewOrdersHref`, i.e. they navigate the browser straight
there. There is no fallback if the page is missing; the user simply lands on an
error.

Worth being clear about what this is **not**: it is not a case of the app trying to
*use* Support's machinery. Nothing calls Support's server routes. These are three
signposts still pointing at a building that has been demolished.

### Everything else found — all comments, all acceptable

Twenty-odd further mentions, every one inside an explanatory comment rather than
working code. They fall into three groups:

- **Notes explaining where something came from** — e.g. `lib/floor/format.ts:5`
  ("moved here from Support"), `lib/floor/hold-log.ts:31-35`, and four comments in
  the Picking routes citing how Support used to do the same job. These are useful
  history and are fine to keep.
- **Notes explaining a deliberate difference** — `app/api/floor/ship-to/route.ts:11`
  and `lib/floor/release-stages.ts:4` both say, in effect, "we intentionally did
  *not* copy Support here." Valuable; keep.
- **Two now-stale comments** worth a tidy in step 7:
  `app/api/floor/ship-to-search/route.ts:14` still claims "Support's own route is
  untouched and still serves /support" (it does not — it was archived in step 5),
  and `lib/workflow-stages.ts:139` lists an archived file as a current user.

One more, harmless: `prisma/schema.prisma:100` uses `"support_queue"` as an example
in a comment describing a database column. Cosmetic.

---

## 3. Sweep 2 — orphans and dead exports

### Files that might have been left stranded

Both files named in the brief are **still in active use** — neither was orphaned:

| File | Still used by |
|---|---|
| `lib/slot-cascade.ts` | `app/api/planning/board/route.ts`, `app/api/warehouse/board/route.ts` |
| `lib/day-boundary.ts` | `app/api/planning/board/route.ts`, `app/api/warehouse/board/route.ts` |

> 🔴 **CORRECTION 2026-07-28 — the table above is now history, and it was never quite
> right.** Both users listed are **gone from the live tree**: `/api/planning/board` was
> archived to `archive/2026-07-planning-board/` (`639f8139`) and `/api/warehouse/board`
> to `archive/2026-07-warehouse-board/` (`207e2a5c`). `lib/slot-cascade.ts` and
> `lib/day-boundary.ts` went with them.
>
> It also overstated "active use" at the time it was written. The imports were real,
> but in `/api/warehouse/board` the calls four lines below were **commented out under a
> `// DISABLED` header** — the file imported the helpers and never ran them. That is the
> *an import is not a call* trap, and this table is where it first bit. It flipped the
> claim once already; this note exists so it cannot flip a third time.
>
> Both traps are recorded in `archive/RETIREMENT-PLAYBOOK.md §4`.

A wider scan of everything under `lib/` and `components/shared/` turned up five
files with no users at all:

`components/shared/role-nav.tsx`, `components/shared/sign-out-button.tsx`,
`lib/mail-orders/enrich-v2.ts`, `lib/picking/validate-assign.ts`,
`lib/slot-history.ts`

**None of these was caused by Support leaving.** I checked each against the commit
immediately before the retirement began (`d08681e9`) and against the archived
Support files themselves: all five already had zero users before any of this
started, and none was ever referenced by Support. They are pre-existing unused
code — a ROADMAP item, not a step-5 defect. Nothing was deleted.

### Shared workflow definitions — which are still needed

`lib/workflow-stages.ts` describes the stages an order passes through. Several
things in it are named "support…" for historical reasons. **Most are very much
alive and must not be removed** — the name is misleading, not the code:

| Name | Live users | Status |
|---|---|---|
| `SUPPORT_DONE_OUTPUT` | 7 files — Floor, Import, three Picking routes, two Tint operator routes | **Heavily used** |
| `SUPPORT_DONE_STAGE_NAMES` | 3 files — an admin repair tool, the Operations summary, Tint Manager | **In use** |
| `SUPPORT_PICKING_QUEUE_STAGE_NAMES` | 1 file — `app/api/admin/fix-challans/route.ts` | **In use** (only just) |
| `STAGE_LADDER`, `PICKING_OPEN_STAGES`, `PICKING_ACTIVE_STAGES`, `PICK_ASSIGNED`, `PICK_DONE`, `PICK_CHECKED` | Floor and Picking | **In use** |

Three are now genuinely unused:

| Name | Status |
|---|---|
| `supportMayEdit()` | **Zero users.** Two comments elsewhere explicitly say they chose *not* to use it. The `supportMayEdit` flag on all fourteen stage rows exists only to feed this dead function. |
| `isSupportDone()` | **Zero users.** |
| `stageRank()` | No outside users; called only by `isSupportDone()`, which is itself dead. |

Reported, not removed. Worth noting the naming trap for whoever tackles this: four
of these names begin with "SUPPORT" and are load-bearing, while three are dead — so
"delete anything called support*" would break Floor, Picking, Import and Tint.

---

## 4. Sweep 3 — every module still whole

Every module's page file and server routes are present, and **not one of them
calls Support's old routes**. Note that several live inside bracketed folders like
`app/(tint)/` — that is a Next.js grouping device and does not appear in the web
address.

| Module | Page file | Missing imports | Calls `/api/support`? |
|---|---|---|---|
| Floor | `app/(floor)/floor/page.tsx` | none | no — 9 own routes under `/api/floor` |
| Picking | `app/picking/page.tsx` | none | no — 9 own routes |
| Tint Manager | `app/(tint)/tint/manager/page.tsx` | none | no |
| Tint Operator | `app/(tint)/tint/operator/page.tsx` | none | no |
| Sampling Library | `app/(tint)/tint/sampling-library/page.tsx` | none | no |
| Mail Orders | `app/(mail-orders)/mail-orders/page.tsx` | none | no |
| Place Order | `app/(place-order)/place-order/page.tsx`, `app/po/page.tsx`, `app/order/page.tsx` | none | no |
| Trip Report | `app/trips/page.tsx` | none | no |
| Attendance | `app/attendance/page.tsx`, `app/(ops)/admin/attendance/page.tsx` | none | no |
| Admin | `app/(admin)/admin/page.tsx` | none | no |
| Import | `app/(import)/import/page.tsx`, `app/(admin)/admin/import/page.tsx` | none | no — **but both carry a dead link (§2)** |

"No missing imports" is confirmed by the compiler, which checks every import in the
project and reported no errors (§6).

---

## 5. Sweep 4 — crons and background jobs

`vercel.json` schedules exactly two automatic jobs:

| Job | Runs at | Exists on disk? | Touches Support? |
|---|---|---|---|
| `/api/cron/attendance-rollover` | 18:35 daily | yes | no |
| `/api/cron/attendance-purge` | 20:30 daily | yes | no |

Both are attendance jobs. Neither mentions Support anywhere, and no scheduled job
points at a removed address. **Nothing here is dead.**

---

## 6. Sweep 5 — build proof

```
npx tsc --noEmit
TSC_EXIT=0
```

No output at all — the type-checker found nothing wrong across the whole project.

```
npm run build
BUILD_EXIT=0
 ✓ Compiled successfully
 ✓ Generating static pages (82/82)
```

| Measure | Expected | Actual |
|---|---|---|
| Pages | 82 | **82** ✓ |
| Server routes | 184 | **184** ✓ |
| Any `support` route in the output | none | **none** ✓ |
| The word "archive" anywhere in the output | none | **none** ✓ |

The last line is the important one: the archived folder is not compiled, not
packaged, and not shipped. It is text on disk and nothing more.

**A caution on what this proves.** A clean build means every piece of code the app
refers to exists. It does **not** mean every web address in the app leads
somewhere — those are just text, and nothing verifies them. That is exactly how the
three dead links in §2 passed five consecutive clean builds.

---

## 7. Left for step 7 (docs) or ROADMAP

### Not docs — needs a real code fix (recommend a step 6)

The three dead links in §2. Suggested destination for all three is `/floor`, which
is what replaced Support, but **that is a decision for Smart Flow, not an
assumption to act on** — `/orders` in particular may be better removed than
redirected, since it does nothing but forward.

### Step 7 — documentation

- `CLAUDE.md:50` (the router) still lists `/support` and `/operations/support` as
  live and routes work to `docs/CLAUDE_SUPPORT.md`.
- `docs/CLAUDE_SUPPORT.md` — the module's documentation, still written in the
  present tense.
- `docs/CLAUDE_CORE.md` §152-170 — the page-key table still lists both removed keys.
- `docs/CLAUDE_FLOOR.md:36` — still says Support is "live and reachable today".
- The two stale code comments in §2, plus the example in `prisma/schema.prisma:100`.
- `docs/prompts/drafts/code-discovery-2026-07-27-support-vs-floor-gap.md` — states
  Floor calls Support's routes; true when written, false since step 2.

### ROADMAP — not caused by this retirement

- The five unused files in §3, dead before any of this began.
- The three dead exports in `lib/workflow-stages.ts` (§3), plus the `supportMayEdit`
  flag on all fourteen stage rows that exists only to feed one of them.
- The "SUPPORT_*" naming across `lib/workflow-stages.ts`. Four of those names are
  used by Floor, Picking, Import and Tint and have nothing to do with the retired
  module. Renaming them would remove a real trap; it is a mechanical but wide change
  and deserves its own task.
