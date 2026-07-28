# How to retire a module

How OrbitOMS takes a screen out of service without breaking the app around it.
Written after retiring the Support board (27 July 2026, commits `bc42a948` →
`f6ace5b8`) so the next one follows the same path.

**This is the recipe, not the story.** What Support was and why it went is in
`2026-07-support/README.md`. Read that for the example; read this for the method.

A "module" here means one screen or group of screens plus the server code behind
it — e.g. the Support board and its `/api/support/*` addresses.

---

## 1. When to retire a module

Three things must be true. Not two.

1. **A successor exists and is LIVE** — not designed, not in a branch. Deployed and
   reachable today.
2. **The successor has actually been used** for real work, not just demonstrated.
3. **Nobody depends on the old screen.** Confirmed by the owner, out loud, before
   any file moves.

Then check parity honestly: **list what the old screen can do that the new one
cannot**, and decide each one — build it, or accept the loss. Do not assume the
successor covers everything because it looks similar. For Support this was a
written gap analysis, and it found five real losses that were accepted on the
record. Accepting a loss knowingly is fine; discovering it later is not.

**Why Support went is worth repeating, because it is the usual reason.** Support
was not broken. It worked. It was retired because a dead screen is a **standing
tax**: every schema change, every shared-component edit, every bug fix has to be
considered against it. In practice the tax was not being paid — improvements were
going into Floor and not being mirrored back. Two screens claiming to do the same
job, only one kept current, is worse than one screen. That is the trigger to
watch for.

**Not a reason to retire:** the code is old, or ugly, or you dislike it. If people
use it, it stays.

---

## 2. The order — never change it

Each step exists because of the one before it.

| Step | What | Why HERE |
|---|---|---|
| **0** | **Read-only discovery.** Read every file. Change nothing. Write down what the module owns, what it borrows, and what borrows from it. | Everything below depends on this list being right. Two hours here saves a broken build later. |
| **1** | **Cut the dependencies.** Any file the successor borrows from the module: move it INTO the successor now. | **The load-bearing step — see below.** |
| **2** | **Replace shared server routes.** If the successor calls the module's addresses, give it its own. | Same reason as step 1, for server code. Rewrite rather than copy where the old one carried baggage. |
| **3** | **Repoint every signpost.** Login landing pages, redirect maps, sidebars, navigation lists. | Do this while the old screen still works. If a signpost is wrong, the old screen catches the user instead of a "page not found". |
| **4** | **Archive the screens.** `git mv` into `archive/`. | Only now is nothing pointing at them. |
| **5** | **Archive the server routes, remove the permission keys, update the seed.** | The screens are gone, so nothing calls the routes. |
| **5b** | **Clear the orphaned permission rows by hand (SQL).** | A separate, reviewed step — see §6. |
| **6** | **Wide verification sweep across EVERY module.** Not just the successor. | Catches the links and leftovers the earlier steps missed. It found three. |
| **7** | **Correct the documentation.** | Last, because only now do you know what is actually true. |

### The load-bearing point

**Dependencies come out first. Always.**

A retiring module is rarely self-contained. Support owned a date-and-time-window
picker, a text-formatting helper, and two server addresses that **Floor was still
using**. Archive Support first and Floor's imports point into `archive/`, which is
excluded from the build — the app fails to compile, or worse, builds and breaks at
runtime.

So: move the shared pieces into the successor **first**, prove the app still works,
*then* archive what is left. Each extraction is its own commit, so if one is wrong
you undo one thing.

A useful test at step 1: **if you deleted the module right now, what breaks?** That
list is your step-1 work. When the list is empty, you are ready for step 4.

---

## 3. The gates — stop, do not guess

A gate is a question you answer **before** an irreversible move, and you stop if
the answer is wrong. Each of these caught something real.

**Before archiving a page: prove its replacement exists AND does at least as much.**
Not "there is an admin page with the same name" — open both. Support's Customers
page and the admin Customers page turned out to be *different components*; the
admin one was richer, so the move was safe. Two minutes of checking. Had it been
the other way round, archiving would have quietly removed a capability.

**Before removing a permission key: trace every file that uses it, and predict the
compile errors first.** Include the database seed file and any admin
permissions-management screen. Write down the expected errors, then make the
change and compare. For Support the prediction was five errors in three files; it
was exactly five in exactly those three. A surprise error means the trace was
incomplete — stop and re-trace rather than patching it.

Also check for a **permissions grid in the admin UI**. Support had one, and leaving
it would have let an administrator tick a box granting access to a screen that no
longer exists — silently re-creating the very orphan rows step 5b removes.

**Before repointing a link: check the target's permissions.**
A "page not found" replaced by "you are not allowed" is **still a dead end**. When
the three orphaned Support links were repointed at Floor, Floor was granted to only
two roles — so for other roles the fix would have swapped one dead end for another.
That needed a deliberate decision, not an assumption.

**Check the LIVE database, never the seed file alone.**
The seed file says what a *fresh* database would contain. The live one has years of
hand-made changes. Seed predicted **2** orphaned permission rows. The live table had
**8**. Same trap in reverse: a permission can exist live with no seed row, so a
reseed silently revokes it.

**A clean build proves less than it looks.** It proves every piece of code the app
refers to exists. It does **not** prove any web address still leads anywhere —
those are just text. Three dead links survived five clean builds.

---

## 4. Things that bit us

Short and honest. All of these actually happened.

- **A narrow link sweep missed three live links.** The first sweep searched only
  `href=`, `redirect(` and `push(` patterns. The misses were a default function
  argument and a component property — ordinary text. **Search for the address
  itself as plain text, everywhere**, not for the ways you expect it to be used.
  TypeScript cannot catch a wrong URL string; to the compiler `"/support"` is just
  letters.
- **The search tool lied once.** On this Windows setup, Git Bash rewrites any
  search term starting with `/` into a file path before the search program sees it,
  so looking for `/admin/support` silently searched somewhere else and reported "no
  hits". It was caught only because a differently-worded search found something the
  first had declared absent. **When a sweep returns a suspiciously clean result,
  re-run it a second way.**
- **A shared route group put unrelated pages behind the retiring module's gate.**
  Four master-data pages (Customers, SKUs, Routes, Vehicles) lived inside Support's
  folder and inherited its permission check. Revoking that permission would have
  darkened all four. **Check the folder, not just the screen.**
- **Two files held finished-but-uncommitted work, and a written brief said
  "SHIPPED" when nothing had been committed.** `git log` and `git status` are the
  truth; a status line in a document is a claim. **Verify before trusting it.**
- **The archive folder MUST be excluded in `tsconfig.json`.** Otherwise the
  type-checker keeps checking retired code and every stale reference in it blocks
  every future commit. Add the exclusion in the same commit as the first archive.
- **Use `git mv`, never copy-and-delete.** With `git mv` the file keeps its history
  and `git log --follow` still shows every change ever made to it. Copy-and-delete
  throws that away — the archive becomes a file with no past, which defeats the
  point of keeping it.
- **Retiring a screen can silently remove the only way into a shared component.**
  The missing-customer resolver opened from two places; Support was one of them. It
  still works from the other, but the loss was found in the *final* sweep, not
  planned for. **Ask what the screen is the only entry point to.**

### Added after the /order retirement (2026-07-27)

- **The search trap is WIDER than the entry above.** It is not only terms that
  *start* with `/`. A pattern **containing quote-then-slash** (`"/`) is rewritten too,
  before `rg.exe` or `git.exe` ever see it — MSYS-native `grep` is unaffected. Real
  case: `rg '"/order"'` reported **NO MATCH** in `middleware.ts`, while `grep` found
  line 14 and `od -c` showed the bytes plainly. Dodge it with a char-class:
  `["][/]order["]`. Two more traps in the same family, both hit this session:
  `[/]order` has **no word boundary** and silently matches `/orders` — cross-check
  with `grep '/order\b'`; and **never exclude a lookalike token** — filtering out
  `mo_order` to reduce noise hid a real hit. **Run every address sweep two ways and
  reconcile the line numbers, not the raw output.**

  ⚠ **Third shape, 2026-07-28: the slash does not have to be at the START.** It fires
  inside an **alternation** too — `'/warehouse|/planning|…'` was rewritten and silently
  hid **four lines in a file that plainly contained them**. Put a char-class on **every
  branch**: `'[/]warehouse|[/]planning|…'`. **This trap has now bitten three times in
  one session, in three different shapes.** Assume it will find a fourth.

- **AN IMPORT IS NOT A CALL.** A session grepped for a module name, found `import`
  lines in two route files, and wrote "these **ARE** called" into canon — overturning
  a statement that had been right. The calls sat **four lines below**, commented out,
  headed `// DISABLED`. The wrong claim shipped to `main` and survived two more
  sessions before anyone opened the call site. **Grep finds the name; only the call
  site tells you whether it runs.**

- **Stale CODE COMMENTS mislead exactly like stale docs — and no docs sweep sees
  them.** `lib/workflow-stages.ts` claimed "zero production order has ever reached
  `'dispatched'`" — a claim ROADMAP had corrected **three days earlier**. A discovery
  report cited the comment and repeated it as fact, then drew a conclusion from it.
  **When a code comment states a fact about live data, verify it against the data.**

- **The successor-parity gate earned its keep.** Retiring `/order` looked trivial —
  one file, zero importers, a clean type-check. The parity gate caught that `/order`
  offered a **Hold** dispatch option `/po` does not (`Normal|Hold|Urgent` vs
  `Normal|Urgent|Call`). No build, type-check or link sweep would ever surface that.
  The owner accepted the loss knowingly, which is exactly the point: **a gate that has
  only ever passed is not evidence it is unnecessary — it is evidence it has not yet
  met the case it exists for.**

### Added after the Picking DESKTOP retirement (2026-07-28)

Five traps, all hit on a retirement that touched no route, no page key and no permission row —
proof that "small" retirements bite in their own ways.

- **`git log --follow` returns NOTHING until the rename is COMMITTED.** Staging a `git mv` is not
  enough: `--follow` on the new path reports zero commits while the move sits in the index, which
  reads exactly like history was lost. **Verify history at the OLD path first, commit, then
  re-verify at the new one.** Check the rename similarity too — a clean move records `R100`.

- **A removal can strand code that the type-checker will never mention.** `noUnusedLocals` is OFF in
  this repo, so deleting a branch can orphan an import — or, worse, **an entire database
  round-trip** — and `tsc --noEmit` stays green. One removal here left a
  `prisma.dispatch_slot_master.findMany()` whose only purpose had been the deleted counters; nothing
  flagged it. **After every removal, grep by hand for each symbol the deleted code was the sole user
  of.** A clean type-check is not a clean removal.

- **An UNTRACKED file can masquerade as a live reader and block a correct cleanup.** A local scratch
  script was the only thing reading four payload fields, so the conservative rule ("if it has a
  reader, leave it") halted a valid deletion for a whole step. The file was not in git, not in the
  build, and not on any other machine. **Run `git ls-files` on a reader before treating it as real**,
  and say plainly whether a blocker is in the repository or just on this disk.

- **A NAME MATCH IS NOT A READER.** Searching for `windows`, `assignedCount` and friends also hit the
  picker-roster payload — a completely different object that happens to share a word. Believing the
  grep would have falsely blocked a correct removal, exactly inverting the previous trap. **Open the
  call site and confirm WHICH object the property belongs to.** Sibling of *an import is not a call*
  and *capability is not reachability*: three shapes of the same discipline.

- **A DISCOVERY REPORT IS EVIDENCE, NOT AUTHORITY.** This programme's report was wrong three separate
  times — it said Floor had no per-route progress roll-up (Floor ships one), it named the archived
  desktop file as sole consumer of the counters, and it reported one counter as already reader-less.
  Every error was caught downstream, and only by re-reading the code. **Re-verify every inherited
  claim at the step that acts on it**, including claims from your own earlier steps. Commit the
  report as a dated record, errors and all — corrections belong in the canonical files, not
  retro-fitted into the draft.

### Added after the Warehouse + Planning retirements (2026-07-28)

- **CAPABILITY IS NOT REACHABILITY.** `app/api/planning/board/route.ts` had a
  `showDispatched` branch reading `workflowStage 'dispatched'` — **1,546 live rows**. A
  discovery draft read the handler and concluded the Planning board "is NOT always
  empty". **No client code ever set that parameter**:
  `components/planning/planning-page.tsx:137` fetched the board with a date and nothing
  else. The board had **always** rendered empty. **Reading the handler tells you what
  CAN happen; only the caller tells you what DOES.** This is the sibling of *an import
  is not a call* — same failure, one layer up. And note where it happened: **inside a
  correction block written to fix a different stale claim.** A correction can introduce
  its own error; re-verify the fix, not just the bug.

- **A ROUTE GROUP IS NOT A MODULE.** `app/(dispatcher)/` looked like it belonged to the
  retiring `/dispatcher` page. It held **six** files — the stub, a layout, and **four
  LIVE master-data pages** (customers, routes_areas, skus, vehicles). Archiving the
  folder would have taken four working screens off the app. **Move named files only.
  List a folder's contents before assuming what it contains.**

- **A PAGE KEY AND A ROLE CAN SHARE A WORD.** `dispatcher` was simultaneously a retiring
  **page key** and a live **role**. `lib/permissions.ts`'s `PageKey` and
  `role-sidebar.tsx`'s `RoleSidebarRole` are **different unions**. Deleting from the
  wrong one would have broken a live role. **Always state which union you are editing** —
  in the plan, in the diff, and in the commit message.

- **SEED IS NOT LIVE — three times in one week.** Support: seed predicted **2** orphaned
  rows, live held **8**. Warehouse: seed held **2**, live held **7**. The dispatcher
  role: seed grants it five pages, live has all five at `canView=false`. **Never plan a
  permission change from `prisma/seed.ts`. SELECT first, every time** — and when they
  disagree, say which one you are describing.

---

## 5. Archive layout

```
archive/
├── README.md                  index of every retired module
├── RETIREMENT-PLAYBOOK.md     this file
└── {YYYY-MM}-{module}/        one folder per retirement
    ├── README.md              REQUIRED — see below
    ├── app/ · components/ · api/   the moved code, original paths preserved
    └── docs/                  the module's own documentation
```

Folder name: year-month plus the module name — `2026-07-support`. Dated, so the
order is obvious years later.

Inside, **keep the original folder structure**. A reader should recognise where a
file used to live without being told.

**Every archive folder carries its own `README.md`**, and it must answer four
questions in plain English:

1. **What was it?** What the screen did, for a reader who never saw it.
2. **Why did it go, and what replaced it?**
3. **What moved OUT before the archive** — the shared pieces, and where they live
   now. This is the section that stops someone re-adding a file that already exists
   elsewhere under a different name.
4. **What was deliberately left behind**, and why (§6).

Add a row to `archive/README.md` in the same commit.

---

## 6. What stays behind on purpose

**Database rows and tables are not part of a code archive.** Archiving code and
changing a live database are different actions with different risks. Keep them in
separate, clearly-labelled steps.

- **Orphaned permission rows** — after the keys are gone from the code, rows
  granting access to the dead screen sit in the database doing nothing: a key with
  no lock left to fit. Harmless, but clutter. Clear them in **one reviewed SQL
  statement of their own** (step 5b), never as a side effect of a file move. Look
  at the live table first — the count will not match the seed file.
- **Frozen tables** — a table only the retired module wrote to, that nothing reads,
  is now frozen: no new rows, existing ones are history. **Dropping a table is a
  separate decision** with its own risk, and it does not belong inside a
  retirement. Park it and decide deliberately.
- **Workflow stage strings are shared vocabulary — do not rename them.** OrbitOMS
  still has a stage called `pending_support` and constants named `SUPPORT_DONE_*`
  that are used by four other modules. The names are historical; the values are
  live and written into thousands of database rows. Renaming would mean rewriting
  live data for a cosmetic gain. **Leave them, and say in the docs that the name is
  historical.** A future cleanup can rename them on purpose, with its own plan.

The same caution applies to dead code the retirement leaves behind — unused
functions, a now-pointless flag. Record them; remove them in their own pass. Above
all, **do not delete by name-matching**: three functions with a `support` prefix
were genuinely dead, while four constants sharing that prefix were load-bearing
across Floor, Picking, Import and Tint.

---

## 7. Honest note on reinstating

Moving a folder back is easy. Making it work is not.

By the time a module is archived, its shared pieces have **moved and changed** —
that was step 1. The archived files import from paths that no longer hold what they
expect, and the permission keys they check no longer exist. Support's archived code
does not merely need moving back; it needs the pickers, the routes, the page keys
and the database rows restored too, in the versions it remembers, which no longer
exist.

**Treat an archive as reference, not a rollback plan.** It is kept so a person can
read how a decision used to be made — the guard conditions, the wording, the edge
cases someone thought hard about once.

**If the successor falls short, build the missing behaviour INTO the successor.**
Never revive the archive. Two screens doing one job is the problem the retirement
solved.

---

## 7b. Completed retirements

Index only — `archive/README.md` carries the full table, each folder's README the story.

| Date | What | Commit |
|---|---|---|
| 2026-07-27 | Support board — screens, API routes, spec | `bc42a948` → `63164ed2` |
| 2026-07-27 | `/order` — public no-login order page | `9dce858b`, `de48357d` |
| 2026-07-27 | `/operations/warehouse` + `/operations/dispatch` — alternate mounts | `83ec3fc1` |
| **2026-07-28** | **login landings repointed to `/picking`** (floor_supervisor, picker) | **`c4323cd4`** |
| 2026-07-28 | Warehouse board — `/warehouse` + 2 stubs + board API + components | `207e2a5c` |
| 2026-07-28 | Planning board — `/planning` + `/dispatcher` stub + 8 API routes + components | `639f8139` |
| 2026-07-28 | **Picking DESKTOP board** — the wide-screen table only. **A branch removed from inside a LIVE route, not a route retirement:** `/picking` stays live and renders the card board at every width; no page key removed, no permission row cleared, no orphaned DB rows to clean, no SQL run at all. Six steps: extract live rules from the UI spec → track the discovery report → fix stale code comments → remove the face + archive the file → hide it from the desktop sidebar only → remove the dead scope, counters and docs | `90c9a865` → `561368da` |

⚠ **The row in bold is the sequencing lesson.** Those two roles were moved onto `/picking`
**before** the Warehouse board was archived — not after. Every login landing, redirect and
link should be repointed and verified *first*; archiving comes last. **Move the people out
before you demolish the building.** §2 already says dependencies come out first; this is the
same rule applied to humans rather than imports.

---

## 8. Candidates for next retirement

From what is visible in the repo and ROADMAP today. Nothing here is decided.

| Candidate | Successor | Blocker |
|---|---|---|
| **Shade Master** (`/tint/manager/shades`, `/tint/shades`) | Sampling Library (`/tint/sampling-library`) | Furthest along of the three. `shade_master` has been deprecated since 2026-05-25 and is documented "do not write to it", but the screens are still in the navigation. ROADMAP wants four weeks of traffic audit plus a final CSV dump before the **table** drops — note the **screens** could retire earlier than the table. (ROADMAP → Sampling Library) |
| **Admin SKU CRUD + the three `skus/page.tsx` browse pages** | `sku_master_v2` | These are the last live readers of the old `sku_master` table, so they retire *with* it. **Read the id-space landmine in `CLAUDE_CORE.md §13` first.** Known blocker: `scripts/normalise-sampling-data.ts:313` reads the old table and is inside the type-check gate, so it will block every commit at the drop. (ROADMAP → Retire old `sku_master`) |

**Two file-level cleanups, not module retirements** — this playbook is overkill for
them, but they are the same family:

- **The two TI Report page files** are **unreachable** — `next.config.mjs` redirects
  both addresses away before either page can render. Dead code hidden behind a
  redirect: the kind a "who links here?" search will never find, because nothing
  links to it and nothing needs to. **Worth learning as a class — when checking
  whether a screen is still reachable, read the redirect and rewrite rules in
  `next.config.mjs`, not just the links.** Tracked at ROADMAP → *Post-Support-retirement
  cleanup*.
- **`/orders`** — no permission gate, and its entire body forwards to `/floor`. Two
  commits in its whole history. Delete it or gate it. (ROADMAP → Post-Support-retirement cleanup)

---

*Written 2026-07-27, after the Support retirement; last updated 2026-07-28, after the Picking
DESKTOP retirement. Update it after the next one —
especially §4, which is only useful if it keeps growing.*
