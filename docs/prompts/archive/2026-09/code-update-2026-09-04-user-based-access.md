# User-based access — what shipped, 2026-09-04

**Type:** `code-update` — the record of a migration that is live.
**Plan it executes:** `web-update-2026-08-31-user-based-access-plan.md`
**Evidence it was built on:** `code-discovery-2026-08-31-role-census.md` (422 sites, 208 files) ·
`code-discovery-2026-08-30-permission-actions.md` (per-flag call-site census)

**In one line:** OrbitOMS stopped deciding access from job titles and started deciding it per
person. Eight commits, all live. Model now documented in `CLAUDE_CORE.md §5`; schema in §7.14/§7.15;
screen in `CLAUDE_UI.md §63`; what remains in `ROADMAP.md → User-based access`.

---

## 1. What shipped, in order

| # | SHA | What |
|---|---|---|
| 1 | `c3cf726b` | audit: log mail-order writes and hide-rule deletion — 8 routes |
| 2 | `95253ff7` | docs: CORE §7.13 audit-log coverage — actual counts |
| 3 | `6c76c56a` | access: per-user access screen (read-only) + `user_page_access` model |
| 4 | `187980cb` | access: editing + save for the per-user access screen |
| 5 | `2f461f93` | access: read permissions from `user_page_access` behind `ACCESS_SOURCE` |
| 6 | `ff39fc71` | access: show live permission source on the access screen |
| 7 | `b493f87c` | rbac: superuser flag on users, admin role kept as fallback |
| 8 | `b915c88e` | rbac: admin routes gate on superuser flag — 68 sites, 55 files |

Two SQL files were run by the owner in the Supabase SQL Editor, not by a session:
`sql/2026-09-04-user-page-access.sql` (creates and fills the table), and by hand the
`ACCESS_SOURCE` row plus `users.isSuperuser`.

### The order was the point

Each step was inert until the next one turned it on, so every stage had a rollback that was not
"revert and redeploy":

1. **Build the table and fill it** — nothing read it.
2. **Build the screen** — it edited a table nothing consulted. The screen said so, in an amber
   banner, so nobody would tick a box expecting an effect.
3. **Teach the resolvers to read it, behind a switch shipped OFF** — behaviour byte-identical on
   deploy.
4. **Flip the switch** — a 30-second `UPDATE`, reversible the same way.
5. **Only then** turn `admin` into a flag.

---

## 2. The number that made the cutover safe

`sql/2026-09-04-user-page-access.sql` did not just fill the table. Its Part 3 compared **all 1,053
rows** against what the live role system granted, using a *different* SQL formulation from the one
that wrote them (correlated `EXISTS` per flag versus `bool_or`/`GROUP BY`), and returned only rows
that differed.

**It returned zero.** 1,053 rows = 39 users × 27 page keys, byte-identical to the role system.

That is why flipping `ACCESS_SOURCE` to `user` changed nothing for anybody. The switch was not a
leap of faith; it was a no-op that had been proven to be one.

The fill reproduces `getAllPermissionsForRoles()` exactly, including two traps worth restating:

- **The admin short-circuit happens BEFORE `role_permissions` is read.** The 14 admin rows in that
  table are dead data the app has never consulted, and one of them (`floor`) actively disagrees with
  what admin really gets. Filling admin from the table would have been wrong on `floor` and missing
  13 keys.
- **`lib/auth.ts:208`** — `allRoles.length > 0 ? allRoles : [primaryRole]`. A user with ANY
  `user_roles` rows gets *exactly those rows*; the primary is **not** appended. Verified: nobody is
  in the state where that loses them access. Reproduced anyway, because the table had to match the
  app rather than match what we wished the app did.

---

## 3. Verified by hand, and by whom

**By the owner, on production, on the night of 2026-09-04.** He flipped `ACCESS_SOURCE` to `user`
and hand-tested across **seven roles**. The prompt that opened step 5 records it as "live in
production and hand-tested across seven roles tonight". `admin_audit_log` corroborates the session
independently: 4 `system_config` updates (the flips) and 5 `user_page_access` updates.

**Not verified by any session.** No session had a login, and the dev server points at the production
database, so **no session tested any of this in a browser**. What sessions verified was:

- `npx tsc --noEmit` exit 0 before every commit; `next build` compiles.
- Read-only SELECTs for every claim of fact — row counts, column shapes, who holds which role,
  whether a column existed before depending on it.
- The parity SELECT above, run read-only with a CTE shadowing the real table so that even the
  verification wrote nothing.
- Grep proofs that excluded module paths were untouched, over the *staged* set rather than the
  working tree, so pre-existing edits could not flatter the result.

---

## 4. What was NOT done, and why

- **The `admin` role arm is still in every superuser check.** `flag OR role === "admin"`, never the
  flag alone. Exactly one account administers OrbitOMS, and it is the same account that reaches the
  `ACCESS_SOURCE` switch and can grant the flag back. Removing the arm is a later, deliberate
  decision with a tested recovery path. `CLAUDE_CORE.md §13`.
- **`role_permissions` was not retired.** It is the rollback. Dropping it while the switch can flip
  back converts a 30-second `UPDATE` into an outage. Same for `user_roles` and `role_master`, which
  still supply the label, the login redirect and the `/admin/access` baseline.
- **58 `requireRole` calls naming roles beyond ADMIN, 22 inline bypass sites, and 12 inline checks
  under `app/api/tint/` were left alone.** They are permission questions, not admin gates, and tint
  was not re-tested that night. Step 6.
- **`ROLE_HREF_OVERRIDES` untouched.** The same `customers` tick resolves to three different URLs by
  job title. A tick says *whether* you may see Customers, never *which* Customers screen — an
  unresolved ambiguity, not an oversight. Step 7/8 collapses the three screens.
- **The `attendance` nav special case untouched.** Already driven by per-user flags.
- **`MobileShell`'s Home button rule untouched** — still `navItems[0].href`. Only the menu's source
  moved. It must now be re-derived per person rather than per role.
- **13 write routes still record no actor.** Deferred by decision into each module's own conversion
  so those files are not edited twice. `CLAUDE_CORE.md §13`.
- **Two resolver paths were unified, because leaving them was the landmine.**
  `app/(admin)/admin/layout.tsx` and the admin branch of `app/(ops)/layout.tsx` used the *singular*
  resolver on the primary role while everything else merged all roles. The `(ops)` one was the real
  trap: it admits on `roles.includes("admin")` and then looked up the PRIMARY, so a user holding
  admin as a *secondary* role would have been let in and then denied. Verified nobody was in that
  state before changing it.

---

## 5. Rollback

**In order, cheapest first. None of these needs a deploy.**

**1 — Access is wrong for ordinary users.** Back to job titles:

```sql
UPDATE system_config SET value = 'role' WHERE key = 'ACCESS_SOURCE';
```

Lands within ~30 seconds fleet-wide. `role_permissions` is untouched and still correct, so this is a
true restore, not a degraded mode.

**2 — The owner cannot reach `/admin`.** First sign out and back in — the likeliest cause is a stale
JWT. If that fails, from the Supabase SQL Editor:

```sql
UPDATE users SET "isSuperuser" = true WHERE email = 'admin@orbitoms.in';
UPDATE users SET "roleId" = (SELECT id FROM role_master WHERE name = 'admin')
  WHERE email = 'admin@orbitoms.in';

SELECT u.id, u.email, u."isActive", u."isSuperuser", r.name AS role
FROM users u JOIN role_master r ON r.id = u."roleId"
WHERE u.email = 'admin@orbitoms.in';
```

Then sign out and back in — do not wait out the 5-minute refresh window while locked out. The two
arms are independent, so restoring either one restores access; run both.

**3 — Still broken.** The fault is in code, not data:

```bash
git revert --no-edit b915c88e b493f87c   # superuser
git revert --no-edit ff39fc71 2f461f93   # the switch and its indicator
git push origin main
```

The tables and columns can stay; unread, they are inert.

**To cut one person off immediately** — not a rollback, but the thing to reach for when it is
urgent — `users.isActive = false`. Checked at sign-in and not behind the 5-minute window, unlike
`isSuperuser`.

---

## 6. Corrections this work produced

Facts that were wrong in earlier drafts or prompts, found by deriving rather than transcribing:

| Claim | Reality |
|---|---|
| "~48 admin `requireRole` calls" | **57** converted (60 grep hits − 2 comments − 1 excluded) |
| "8 inline `role !== admin` checks" (census §2c) | **11** admin-only gates — the census omitted four GET arms |
| "~54 `requireRole` naming other roles" | **58** — a mis-addition in the step-5 report, repeated into the step-6 brief |
| "21 bypass sites" | **22** |
| Mail Orders gate fixed "2026-08-31" | `0f56eede` is dated **2026-08-30** |
| Census §6c list A: "48 files" | enumerates **49**; true gap total 71, not 70 |
| Mockup: "Mail Orders does not check permissions when saving" | Fixed 2026-08-30. **Two sessions repeated it as current.** Struck through and dated in place. |
| `attendance` is "not in `PAGE_NAV_MAP`" | It **is**. Five keys are missing from it, not two. |

The pattern is worth naming: **every one of these came from a number written down once and copied
forward.** The parity SELECT, the grep counts and the read-only checks exist because the alternative
is a document that is confidently wrong and reads exactly like one that is right.
