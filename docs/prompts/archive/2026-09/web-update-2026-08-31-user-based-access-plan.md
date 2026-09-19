# User-based access — verdict and plan

**Date:** 2026-08-31
**Type:** `web-update` — decision + plan. Nothing built yet.
**Evidence:** `code-discovery-2026-08-28-admin-panel.md` · `code-discovery-2026-08-30-permission-actions.md`
· `code-discovery-2026-08-31-role-census.md` (422 sites, 208 files, all live-verified).

---

## 1. Verdict — do it. It is smaller than it looks.

Three numbers decide this, and all three came back better than I expected.

**Only five screens actually need to know someone's job title.** This was the thing that could have
sunk it. If dozens of screens branched on role, "job title is just a label" would have been a lie. It
is five: the Picking board (picker's own jobs vs the supervisor board), two Picking API routes that
scope a picker to his own data, the MRN screen, and the `(ops)` layout choosing which sidebar to
draw. Everything else that reads a role is asking *may this person*, which is exactly what a tick
answers. **Twelve more sites read the role but only to print its name in the sidebar heading** —
those are label uses, which is precisely what survives.

**No role is written into any business data.** A sweep of all 85 tables found the job title stored in
exactly three places: the pointer on the user, the permission table being retired, and one unused
column. Not a single order, challan, log or report row records what job somebody held. So there is
**nothing historical to migrate and nothing that goes stale** — the single biggest risk in a change
like this simply is not present here.

**The whole secondary-role tangle is nine rows.** `user_roles` looks like 29 rows; 20 of them are
noise duplicating what the user record already says. Nine are real, and four of those nine are
`floor_access` — the role you invented to give Floor Control to Ajay, Dhanraj, Priya and Prakash.
Under ticks that role stops existing and becomes four ticks. The census confirms it grants exactly
one page and nothing else.

**One correction to what I told you earlier.** I said "roughly seventy routes hardcode job titles."
It is 94 route files, and 64 of those have no permission check at all behind the role list. My number
was low. It does not change the verdict, but you should have the right figure.

---

## 2. The one thing that got bigger

**70 of your 134 save routes record nobody.**

You told me the point of this change is that "which user did what can be logged." Right now, for a
large part of the app, it cannot be — because nothing is written down.

- **All 48 admin master-data writes.** Every customer edit, route change, SKU edit, slot rule, system
  config change, bulk CSV import. None records who did it.
- **The permissions screen itself.** Whoever changed who-can-do-what is unrecoverable.
- **User creation, role changes and password resets.** No record of who made the account.
- **Eight Mail Orders writes** — the same ones with no permission check, so doubly untraceable.
- Plus scattered gaps in Sampling Library edits, two MRN routes, five Tint routes, and the two
  backfill endpoints.

The rest of the app is fine: 58 routes record an actor properly, and there are ten audit tables doing
their job.

**And your own change makes this worse, not better.** Today an unattributed admin write must have
been you — you are the only admin. Once several people can hold the same ticks, that narrowing
disappears and the write becomes genuinely anonymous. So the audit work is not a nice extra to do
afterwards. It is part of the same job.

---

## 3. The target design

**Four moving parts.**

**a. Job title becomes a label plus a starter set.** `role_master` survives. It supplies the name
shown in the sidebar and on the user record, and it supplies the set of ticks copied onto a new user
at creation. It grants nothing, and changing a starter set later moves nobody.

**b. One new table holds the ticks.** One row per person per page, carrying the same five actions you
already have. This becomes the only thing the app asks.

**c. `admin` becomes a superuser flag on the user, not a tick.** This matters more than it sounds.
Every permission check in the app already short-circuits on admin before reading anything, and 48
master-data routes are gated on nothing but "are you the admin." Making admin a plain flag on the
person takes those 48 routes out of scope entirely — they become a one-word rename with no logic
change. Every system has a superuser; pretending admin is just another set of ticks would add work
and buy nothing.

**d. Landing page moves onto the person.** Today a map from job title to landing page decides where
someone goes after login. It becomes a field on the user, with the job title supplying the starting
value.

**What the five screen-branches do instead.** They stop reading "primary role" and read the label
directly — same value, honest name. Two of them (the Picking scoping routes) are the boundary that
stops a picker seeing another picker's bills by editing the address; those must be re-tested by hand,
not just type-checked.

---

## 4. What actually has to change

The 422 sites are not 422 decisions. They are a handful of shapes repeated, and they fall into four
buckets of very different sizes.

| Bucket | Sites | What happens | Difficulty |
|---|---:|---|---|
| **Goes through the helpers** | 139 | The helpers change where they read from. The call sites keep working — same shape, one argument different. | Mechanical. One file's internals plus a sweep. |
| **Admin-only routes** | ~48 | Become a superuser check. No logic change. | Mechanical rename. |
| **Hardcoded role lists on writes** | ~64 | Each needs a page key and a real tick check. Tint is 12 + 12 of these; the rest are scattered. | The real work. Module by module. |
| **Screen branches + labels + menu** | 48 | Five branches re-pointed, twelve labels unaffected, menu and landing re-sourced. | Small but delicate — the Picking scoping ones need hand-testing. |

**Where the weight sits:** `app/api/admin` is 69 files and 128 sites, but most of that is the
superuser bucket, so it is cheap. **Tint is the expensive one** — 53 files, 108 sites, and the
largest block of role-only write gates in the app. MRN, Picking, Floor, Sampling Library and Trips
are each self-contained with one page key, so each can convert in its own commit and be tested
alone.

---

## 5. The eight open questions, answered

The census left eight things it could not decide. My recommendations:

1. **Three different Customers screens** (`/admin/customers`, `/tint/manager/customers`,
   `/dispatcher/customers`) — one tick, three destinations. **Collapse to one.** The admin version is
   already the richer superset and ROADMAP already flags the copies for removal. Fixes twelve URL
   rewrites and deletes two screens. Do it inside this project.
2. **Attendance's nav special case** (admin always shown, ops_admin always hidden) — **make it a
   normal page with a tick.** Ops Admin simply doesn't get the tick. The special case disappears.
3. **The attendance check-in gate's admin branch** — drop the role branch; the per-user flag it
   already reads is enough.
4. **`attendance_settings.roleSlug`** — built, never used, every read passes empty. Leave it alone
   and don't design around it. Note it as dead; drop in a later cleanup.
5. **The push notification recipient list** — today three hardcoded job titles that happen to match
   exactly who holds Picking edit rights. **Switch it to read the tick.** Exact match today, so the
   switch is safe, and it stays correct on its own afterwards.
6. **Three Tint writes gated on "can view" instead of "can edit"** — **fix them in the move.** They
   are harmless today only because the two groups happen to be identical people. Under per-user ticks
   those groups come apart by design, and this quietly becomes a real hole.
7. **The sidebar heading is already broken** — six of your thirteen job titles are missing from its
   list, so admin, dispatcher, floor supervisor, picker, logistics and floor_access render a blank
   heading right now. Not caused by this change, but it sits on the same lines. Fix it by reading the
   label from the database instead of a hardcoded list.
8. **Count discrepancy** between the 28th and 31st — the 31st is right (29 rows, 20 users, 13 roles).
   Correct the earlier draft when it is consolidated.

---

## 6. The build sequence

Eight steps. Each one ships on its own and each is reversible except the last.

| # | Step | Why here | Size |
|---|---|---|---|
| **0** | **Lock the eleven Mail Orders save routes.** Copy the same three lines the other 37 already use. Delete or lock the unguarded backfill address. | Nothing built on top of this is trustworthy until it's done. | Half a day |
| **1** | **Actor columns + recording, starting with admin master data, the permissions screen and user creation.** | Your stated reason for the whole change. Independent of everything else, so it can run in parallel. | Two sessions |
| **2** | **Create the tick table and fill it** from today's role grants, one row per person per page. Nothing reads it yet. | Data only. Zero risk. Lets you compare old and new side by side. | One session |
| **3** | **Build the access screen** — person on the left, pages and ticks on the right — writing to the new table while the app still runs on roles. | You can see and correct every person's ticks *before* they go live. | Two sessions |
| **4** | **Flip the helpers to read the tick table.** One commit. This is the moment it goes live. | Reversible by reverting one commit. Smoke-test every role by hand first. | One session |
| **5** | **`admin` becomes a superuser flag**; convert the 48 admin-only routes. | Cheap, and it shrinks step 6. | One session |
| **6** | **Convert the role-only write gates, module by module.** Tint first — it is the biggest and the messiest. Then the self-contained ones. | The real work. One module per commit, each testable alone. | Three to four sessions |
| **7** | **Menu and landing move onto the person.** Re-point the five screen branches. Fix the sidebar label list. | Depends on 4. | One session |
| **8** | **Retire `role_permissions`, `user_roles` and `floor_access`.** Add starter sets, copy-from-person, and the page-first view. | Only after 4–7 have been live and quiet for a couple of weeks. | Two sessions |

**Steps 0 and 1 can start today** — neither depends on any decision still open.

---

## 7. Risks, named

- **Step 4 is the sharp moment.** Everything before it is additive. If the flip is wrong, every role
  sees the wrong thing at once. Mitigation: fill and eyeball the table in step 3 first, keep the old
  table intact, revert is one commit. **Hand-test one login per job title before and after** —
  Claude Code cannot do this, it has no credentials.
- **The two Picking scoping routes are a data boundary, not a menu item.** They stop a picker
  requesting another picker's bills by editing the address. They fail closed today. Re-test by hand.
- **38 people × 26 pages will drift** without the step-8 tools. Starter sets, copy-from-person and the
  page-first view are not polish — they are what stops nine pickers diverging within a month.
- **Step 8 is the one-way door.** Once `role_permissions` is gone, going back means re-deriving roles
  from 38 sets of ticks. Everything before step 8 is reversible; leave a gap before taking it.
- **The seed file will fight you.** It still seeds permissions that contradict live, and would
  re-grant five pages to Dispatcher and Support on any reseed. Deal with it in step 8, not before.

---

## 8. What I would not do

- **Do not convert all 422 sites in one pass.** The helpers bucket and the superuser bucket are
  mechanical; the 64 write gates are not. Mixing them in one commit makes the failure unfindable.
- **Do not delete `role_master`.** It earns its keep twice over — the label and the starter set.
- **Do not do the audit work "later".** It is the reason for the change, and the change makes the gap
  worse.
