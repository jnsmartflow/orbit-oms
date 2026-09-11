# Code discovery — per-user access, and scoping the hide switches to everyone / role / user
# 2026-09-11 · DIAGNOSIS ONLY, no code written, no SQL run · Claude Code session

**Files read:** `CLAUDE.md` (router v1.12) · `docs/CLAUDE_CORE.md` (v104, Schema v27.24 — §3, §5,
§7.10, §7.13, §7.14, §7.15, §12, §13) · `docs/CLAUDE_UI.md` (v5.29 — §57, §63) ·
`docs/prompts/drafts/code-discovery-2026-09-11-hide-tags-billing.md` ·
`code-discovery-2026-08-31-role-census.md` · `code-update-2026-09-04-user-based-access.md` ·
`web-update-2026-08-31-user-based-access-plan.md` · `docs/ROADMAP.md → User-based access` ·
`lib/permissions.ts` · `lib/rbac.ts` · `lib/access/source.ts` · `lib/access/role-baseline.ts` ·
`lib/auth.ts` · `lib/audit/log.ts` · `lib/hide/tag-catalog.ts` · `lib/hide/tag-settings.ts` ·
`prisma/schema.prisma` (users, role_master, user_roles, role_permissions, user_page_access,
app_tag_settings, system_config, admin_audit_log) · `app/api/admin/access/[userId]/route.ts` ·
`app/api/admin/permissions/*` · `app/api/admin/users/*` · `app/api/admin/tag-settings/route.ts` ·
`app/api/billing/mail-order/actions/route.ts` · `app/api/mail-orders/route.ts` ·
`app/(admin)/admin/access/page.tsx` · `app/(admin)/admin/layout.tsx` ·
`app/(admin)/admin/settings/hide/page.tsx` · `components/admin/admin-sidebar.tsx` ·
`components/admin/hide-settings-content.tsx`.

---

## A. How access works today, as built

**The owner is right and the older docs are stale.** Access is **per user**, live, and has been
since 2026-09-04.

### A.1 The tables

| Table | Role today | Live? |
|---|---|---|
| `user_page_access` | **The authority.** One row per (userId, pageKey) × 5 booleans. `UNIQUE (userId, pageKey)` is the upsert target and is load-bearing | Yes — 1,053 rows = 39 users × 27 keys (CORE §7.14, SELECT-verified 2026-09-04) |
| `role_permissions` | **The retained fallback**, keyed `(roleSlug, pageKey)`. Read only in `role` mode; still written by the legacy grid | Yes, 118 rows / 13 slugs — **must not be dropped** (CORE §5, §13) |
| `user_roles` | label, redirect, and the `/admin/access` "what would their job title give them" baseline. Grants nothing | Yes, 29 rows / 20 users |
| `role_master` | 13 roles. `name` is the slug source — there is no `slug` column; `lib/auth.ts:217-221` lowercases it and replaces spaces with underscores | Yes |
| `users.isSuperuser` | "may administer OrbitOMS" — replaces the `admin` job title on 68 gates | Yes, 1 of 39 |
| `system_config.ACCESS_SOURCE` | the runtime switch, `role` \| `user`. **Live value `user`** | Yes |

### A.2 One real call path, walked

`POST /api/billing/mail-order/actions` (the Hold / Slot / Urgent / ship-to writes from today's
report) → `:66` `auth()` → `:72` `roles = session.user.roles ?? [session.user.role]` → `:73`
`checkAnyPermission(roles, "mail_orders", "canEdit")` (`lib/permissions.ts:579`):

1. `roleSlugs.includes("admin")` → true returns immediately. The **role arm of the safety rule**,
   placed first because it costs no session read.
2. `sessionAccess()` (`:425`) does ONE `auth()` and returns `{ userId, isSuperuser }`. If
   `isSuperuser === true` → true. That is the **flag arm**.
3. `userModeId(access)` (`:447`) asks `getAccessSource()`. It returns the userId only when the
   cached `system_config` value is exactly `"user"`; **every other outcome — missing row, null,
   whitespace, wrong case, any DB error — resolves to `"role"`**, cached for a full 30 s TTL.
4. In user mode: `userPagePerms(userId, "mail_orders")` reads the one `user_page_access` row.
   **Absent row ≡ all five false.** `:593-596` notes there is no merge here — one person, one row;
   the OR across roles already happened once, when the ticks were written.
5. In role mode: `role_permissions.findMany({ roleSlug: { in: roleSlugs }, pageKey })` and
   `rows.some(r => r[action])`.

🔴 **The userId never arrives as an argument.** The five resolvers still take role slugs; user mode
calls `auth()` itself and reads `session.user.id` (`lib/permissions.ts:394-401`). **That makes every
one of them a question about the LOGGED-IN user only.** A caller asking about somebody else must use
`getRolePermissionsForRoles()`, which is pinned to the role table and never consults the switch.
This constrains everything in §B: any scoped-hide resolver must take the target user explicitly, not
inherit this pattern.

### A.3 Which screen edits it

`/admin/access` (`CLAUDE_UI.md §63`), superuser-only via
`app/(admin)/admin/layout.tsx:15-16` (`requireSuperuser`). Left rail of people, right pane of all 27
page keys in five sections, five checkbox columns. `PATCH /api/admin/access/[userId]` saves **only
the flags that moved** (`route.ts:25-28`), rejects unknown page keys rather than dropping them
(`:68-76`), upserts on the unique constraint, and writes one `admin_audit_log` line. A live-source
banner drives off the **same cached value the resolvers read**, so the screen cannot disagree with
what is enforced.

The old role grid `/admin/permissions` is **still live and still writes `role_permissions`**, but is
**URL-only** — removed from the admin sidebar (`components/admin/admin-sidebar.tsx:51-53`).

### A.4 Does admin bypass everything?

Yes, on two arms, in `lib/rbac.ts:104-111` (`isSuperuser`) and again inline at the top of each of
the five resolvers. `checkPermission` / `checkAnyPermission` return `true`, and
`getPagePermissions` / `getAllPermissionsForRole(s)` return `ALL_TRUE` for all 27 keys, **before
the access source is ever consulted**. Both arms are deliberate and documented as not-to-be-tidied
(`lib/rbac.ts:74-96`).

### A.5 Half-built / stale

- 🔴 **`app/api/admin/access/[userId]/route.ts:20-23` is stale and says the opposite of the
  truth.** Its header still reads *"WRITING HERE CHANGES WHAT NOBODY CAN DO. Every gate and every
  menu still resolves through role_permissions; this table is consulted by nothing until step 4."*
  Step 4 shipped (`2f461f93`) and `ACCESS_SOURCE` is `user`. Writing there now changes what people
  can actually do. The comment was true for about a day. **Code disagreeing with its own comment,
  and the most dangerous one found in this pass.**
- **`/admin/permissions` — UI with a reader only in fallback mode.** Live, writes
  `role_permissions`, unreachable from the nav. Not dead (it is the rollback surface) but no longer
  what it looks like.
- **`admin/permissions` POST still uses `prisma.$transaction`**, which CORE §3 forbids — left
  deliberately and commented as such.
- **`ACTION_PAGES` / `isActionAvailable()` is advisory and cosmetic only** — it decides checkbox vs
  dash on `/admin/access` and must never filter what is read, saved or compared. The save route
  deliberately does not validate against it.
- 🔴 **P0 already on ROADMAP: `prisma/seed.ts` has never heard of `user_page_access`.** Zero grep
  hits, verified 2026-09-06. A wipe-and-reseed rebuilds only the fallback and leaves live access
  **empty**, so every non-superuser resolves all-false and **the seed looks like it succeeded**.
  This matters to §B and drives the recommendation.

### A.6 Docs vs code

| Claim | Where | Reality |
|---|---|---|
| "this table is consulted by nothing" | `api/admin/access/[userId]/route.ts:20-23` | Consulted by all five resolvers. **Stale.** |
| "Access to `/mail-orders` is entirely DB-driven via `role_permissions`" | `CLAUDE_MAIL_ORDERS.md §22` | True only in `role` mode. Live mode reads `user_page_access`. §22 predates the conversion and has not been reconciled |
| "per-user access work pending" | older drafts | Shipped 2026-09-04, eight commits |
| CORE §5 / §7.14 / §7.15, UI §63 | | **Accurate.** These were written with the conversion and match the code |

---

## B. Can the hide switches reuse it?

### B.0 The finding that shapes the answer: the switches are two different kinds of thing

| Kind | Examples | Nature | Default |
|---|---|---|---|
| **Badges** | notes / delivery / bill bands, key dealer, match chip, punched-by, and all 16 existing tags | cosmetic render-suppression; data untouched | **ON** (no row = shows) |
| **Capabilities** | Hold, Slot, Urgent, ship-to pencil | removes the ability to WRITE | **granted** (today everyone with `mail_orders`/canEdit can do all four) |

🔴 **Hiding a button is not a permission.** `POST /api/billing/mail-order/actions:73` gates on
`mail_orders`/canEdit and nothing else. Every one of the four MO grants is canEdit=true
(MAIL_ORDERS §22), so removing the buttons from the screen leaves the route wide open to anyone who
can open Mail Orders. A capability switch that only hides pixels is a capability switch that does
not work.

### Option 1 — extend the per-user access system (switches become entries beside page permissions)

- **Schema:** none, if a switch becomes a `PageKey` with `canView` as its meaning.
- **Admin UI:** free — `/admin/access` renders every `ALL_PAGE_KEYS` entry automatically, in
  sections defined by `ACCESS_SECTIONS`.
- **How Billing gets it:** it already does, via `getAllPermissionsForRole(s)`.
- 🔴 **Three blockers.**
  1. **The default is inverted.** `user_page_access` is default-DENY — absent row ≡ all false
     (`lib/permissions.ts:461`). A hide switch is default-ON. A new user, or any user after the
     §A.5 reseed, would get **every badge hidden**, which is the P0 failure mode with a cosmetic
     blast radius added on top.
  2. **There is no role tier.** `user_page_access` has a `userId` and nothing else. "By role" would
     have to live in `role_permissions`, the retained rollback table written by a URL-only legacy
     screen — spreading one behaviour across two tables and two screens.
  3. **Category error for badges.** `user_page_access` answers "may this person do X". A badge
     toggle answers "should this pixel render". Storing a cosmetic preference in the authorisation
     table means every future reader of that table has to know which keys are real.

**Verdict: right home for the four capabilities, wrong home for the badges.**

### Option 2 — extend `app_tag_settings` with scope columns

- **Schema:** add `scope TEXT NOT NULL DEFAULT 'everyone'` (CHECK in `everyone|role|user`),
  `roleSlug TEXT NULL`, `userId INT NULL` (FK → users, ON DELETE CASCADE). Replace the `tagKey`
  UNIQUE.
- ⚠ **The unique is a landmine.** Postgres treats NULLs as distinct, so a naive
  `UNIQUE (tagKey, roleSlug, userId)` **does not stop two `everyone` rows for the same tag**, and
  the resolver would then be non-deterministic. Needs three partial unique indexes (one per scope)
  or a generated scope-key column. Get this wrong and the bug appears months later, intermittently.
- **Admin UI:** the Tags tab already renders `TAG_CATALOG` generically
  (`hide-settings-content.tsx:164-170, :188-222`) — it gains a per-switch scope control, not a
  rewrite.
- **How Billing gets it:** `GET /api/mail-orders` already has the session and already calls
  `getTagSettings()` (`route.ts:270`). It becomes `getTagSettings(userId, roleSlugs)` — one query,
  one sequential await, **payload shape `disabledTags: string[]` unchanged**, so
  `mail-orders-page.tsx:269`, `review-view.tsx` and `mail-orders-table.tsx` need no change at all.
- **Default-ON survives by construction:** no rows → empty disabled set → today's behaviour
  exactly. And unlike Option 1, an empty table after a reseed is the **safe** direction.
- **Risks:** the NULL-unique trap above; `/api/mail-orders` gains one query; resolution order must
  live in exactly one function.

### Option 3 — RECOMMENDED: split by nature, one owner each

**Badges → Option 2.** Scoped `app_tag_settings`, resolver in `lib/hide/tag-settings.ts`, admin in
the existing Tags tab. The Hide feature already owns badge visibility (CORE §7.10); this extends
its own table rather than building anything new.

**Capabilities → Option 1, as ONE new page key**, not four. Add `billing_dispatch_actions` to
`PageKey` / `ALL_PAGE_KEYS` / `ACCESS_SECTIONS`, with `canEdit` deciding both whether the four
controls render **and** whether `POST /api/billing/mail-order/actions` accepts the write. One tick
per person on a screen that already exists, in the system that already owns "who may write what",
and it closes the server-side hole that hiding buttons leaves open.

This is the reading of *one owner per behaviour* that holds: badge visibility has exactly one
owner (Hide), and write capability has exactly one owner (the access system). Putting capabilities
into the Hide table would be the second access system the rule forbids.

🔴 **One caveat on the capability half, and it is the reason to do the badges first.** Adding a page
key inherits the §A.5 P0: under `ACCESS_SOURCE = 'user'`, a key nobody has a row for resolves
**false for everyone**, so the four controls would vanish for all pilot users on deploy until 39
rows are written. That is a data step in the Supabase SQL Editor, not a code step, and it must be
run **before** the gate ships — the same order the 2026-09-04 conversion used.

---

## C. Must-answers

### C1. Does admin (bypass) also get hidden items?

**Two different answers, and the asymmetry is deliberate.**

- **Badges — NO bypass. The superuser sees exactly what the switch says.** Today `getTagSettings()`
  takes no session at all and there is no bypass anywhere in the tag path, so this is also the
  zero-change answer. It is the right one: the admin sets these switches and needs to see the
  result to know they worked. A bypass would mean the one person who can configure the feature is
  the one person who can never see it.
- **Capabilities — YES, bypass, automatically.** `isSuperuser` short-circuits inside every resolver
  before the source is consulted (`lib/permissions.ts:564`, `:589` and the three siblings). The owner
  keeps Hold / Slot / Urgent / the pencil whatever the ticks say. No code needed; state it in the
  admin copy so it is not mistaken for a bug.

### C2. Multi-role users — if one role hides and another shows, which wins?

**Proposed rule: SHOW wins. A role-scoped hide bites only when EVERY role the user holds hides it.**

Two reasons. First, it is the merge rule already live: `mergeRolePerms()`
(`lib/permissions.ts:503-529`) ORs grants across roles, so the most permissive role decides. A hide
is the negation of a grant, so the equivalent is "shows if any role allows it". Second, it fails in
the safe direction — a badge shown in error is noise, a badge hidden in error is a fact the operator
never learns.

Say out loud what this costs: a role-scoped hide is **weak** for the 9 users who hold more than one
role (29 `user_roles` rows across 20 users). That is precisely why the user tier exists, and the
admin UI should say so on the role control.

Full resolution order, most specific first:

```
user row for this tagKey      → decides, full stop
else: role rows for any of the user's roles → hidden only if EVERY matching row says hidden
else: the everyone row        → decides
else: no row                  → SHOWN (default-ON)
```

Note the role slugs need no query: `session.user.roles` is already on the JWT, slugified from
`role_master.name` at `lib/auth.ts:217-221`, and is `userRoles` when the user has any, else the
primary role.

### C3. Who changed a switch — can it log to `admin_audit_log`?

**Yes, and it should — `PATCH /api/admin/tag-settings` currently logs nothing.** It is superuser-
gated and has the session (`route.ts:34, :57`), so the call is two lines after the upsert.

`entityId` is TEXT **precisely so it can hold a composite key** (CORE §7.13 — `role_permissions` is
keyed by roleSlug+pageKey), so a scoped switch addresses cleanly as
`mail_orders.hold|role:billing_operator` or `mail_orders.notes_band|user:25`.

Follow the three rules in `lib/audit/log.ts`: call it **after** the write succeeds, never wrap it in
logic that reads its result, and let it swallow its own failures. Log only what moved, per the
convention the other 43 call sites share. `entity: "app_tag_settings"`, `action: "update"`.

⚠ If a log-reading API is ever added, `admin_audit_log.id` is **BigInt and `JSON.stringify` throws
on it** — convert before returning, or the route 500s on its first result.

### C4. Default-ON must stay true

It does, in both halves, but for different reasons and only if two things hold.

- **Badges:** no rows → the resolver returns an empty set → `disabledTags: []` → every existing
  render site behaves exactly as today. The scope columns must be **nullable with an `everyone`
  default**, so existing rows migrate to `scope='everyone'` and mean what they mean now. **Verify
  with a count before and after the ALTER** — the migration must not change a single resolved
  answer for any user.
- **Capabilities:** the opposite — default-DENY. That is why the 39 rows must be written **before**
  the gate ships (§B Option 3 caveat).
- **Seed must stay silent on `app_tag_settings`** — zero rows is the correct seeded state, and it
  is what ships today.

---

## D. Rough build plan

### D.1 Phase 1 — badges (self-contained, no access-system change)

| Step | What | Files / SQL |
|---|---|---|
| 1 | Add the 7 badge keys from today's billing report to the catalog | `lib/hide/tag-catalog.ts` |
| 2 | Gate them at their call sites (all call-site expressions, `undefined` never `null` — §23.1/§23.6) | `review-view.tsx` (~7 sites) |
| 3 | SQL: scope columns + three partial unique indexes | `sql/2026-09-XX-tag-scope.sql`, run by the owner in the Supabase SQL Editor; mirror by hand into `prisma/schema.prisma`, then `npx prisma generate` (never `db push`/`db pull` — CORE §3) |
| 4 | Resolver: `getTagSettings(userId, roleSlugs)` with the C2 order, in ONE function | `lib/hide/tag-settings.ts` |
| 5 | Wire it | `app/api/mail-orders/route.ts:270` only — payload shape unchanged, so no client file moves |
| 6 | Admin: per-switch scope control + audit line | `components/admin/hide-settings-content.tsx`, `app/api/admin/tag-settings/route.ts` |

**SQL shape (not run, and the partial indexes are the point):**

```sql
-- NOT RUN. Review before executing in the Supabase SQL Editor. No transaction wrapper.
ALTER TABLE app_tag_settings
  ADD COLUMN "scope"    TEXT NOT NULL DEFAULT 'everyone',
  ADD COLUMN "roleSlug" TEXT,
  ADD COLUMN "userId"   INTEGER REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE app_tag_settings
  ADD CONSTRAINT chk_app_tag_settings_scope CHECK (
    ("scope" = 'everyone' AND "roleSlug" IS NULL AND "userId" IS NULL) OR
    ("scope" = 'role'     AND "roleSlug" IS NOT NULL AND "userId" IS NULL) OR
    ("scope" = 'user'     AND "roleSlug" IS NULL AND "userId" IS NOT NULL)
  );

-- The existing UNIQUE(tagKey) must go, or no tag can have more than one scope row.
ALTER TABLE app_tag_settings DROP CONSTRAINT app_tag_settings_tagKey_key;

-- 🔴 THREE PARTIAL UNIQUES, not one composite. A plain UNIQUE(tagKey,roleSlug,userId)
-- would allow TWO 'everyone' rows per tag, because Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX app_tag_settings_everyone_key ON app_tag_settings ("tagKey")            WHERE "scope" = 'everyone';
CREATE UNIQUE INDEX app_tag_settings_role_key     ON app_tag_settings ("tagKey","roleSlug") WHERE "scope" = 'role';
CREATE UNIQUE INDEX app_tag_settings_user_key     ON app_tag_settings ("tagKey","userId")   WHERE "scope" = 'user';

CREATE INDEX app_tag_settings_user_idx ON app_tag_settings ("userId") WHERE "userId" IS NOT NULL;
```

### D.2 Phase 2 — capabilities (separate session, after Phase 1 is proven)

1. Write the 39 `user_page_access` rows for the new key **first**, in the SQL Editor.
2. Add `billing_dispatch_actions` to `PageKey`, `ALL_PAGE_KEYS`, `ACCESS_SECTIONS`, `PAGE_LABELS`,
   `ACTION_PAGES` (canEdit only) — `lib/permissions.ts`.
3. Gate the render: `review-view.tsx:1837` (the ribbon) and `:2158` (the pencil).
4. Gate the write: `app/api/billing/mail-order/actions/route.ts:73`, a second
   `checkAnyPermission(roles, "billing_dispatch_actions", "canEdit")`.
5. Teach `prisma/seed.ts` about `user_page_access`, or close the ROADMAP P0 first — a reseed
   between steps 1 and 5 removes the capability from everyone.

### D.3 What the Tags tab would look like

Each catalog row keeps its label, description and Important chip, and the single on/off toggle
becomes a scope control:

```
Notes band                                    [ Everyone ▾ ]  [ ●—— ]
Parser-detected remarks. Not the operator's own note.
   └ Everyone · By role · By person
       By role   → role picker, chips for each role with an override
       By person → user picker, chips for each person with an override
```

Three things the copy has to carry:

- the current tab header says *"Switch a badge on/off across the whole app. Data stays — only the
  visual badge changes"* (`hide-settings-content.tsx:181`). With scopes, "across the whole app" is
  no longer true and the sentence needs splitting per scope;
- the C2 rule, on the role control: *"a person with more than one job title keeps the badge if any
  of their roles shows it"*;
- the C1 rule: *"you will see these switches take effect yourself — admin is not exempt."*

---

## E. The one read-only SELECT

Everything above about live data is sourced from CORE, which was SELECT-verified on 2026-09-04 —
**a week old, and seed is not live.** Run this yourself in the Supabase SQL Editor to confirm the
ground the plan stands on. Read-only: no INSERT, UPDATE, DELETE or DDL.

```sql
-- READ-ONLY. The four facts the hide-scope plan depends on.
SELECT 'access_source'        AS fact, (SELECT value FROM system_config WHERE key = 'ACCESS_SOURCE') AS value
UNION ALL
SELECT 'user_page_access_rows',  (SELECT COUNT(*)::text FROM user_page_access)
UNION ALL
SELECT 'users_total',            (SELECT COUNT(*)::text FROM users)
UNION ALL
SELECT 'superusers',             (SELECT COUNT(*)::text FROM users WHERE "isSuperuser" = true)
UNION ALL
SELECT 'role_permissions_rows',  (SELECT COUNT(*)::text FROM role_permissions)
UNION ALL
SELECT 'multi_role_users',       (SELECT COUNT(*)::text FROM (SELECT "userId" FROM user_roles GROUP BY "userId" HAVING COUNT(*) > 1) m)
UNION ALL
SELECT 'app_tag_settings_rows',  (SELECT COUNT(*)::text FROM app_tag_settings)
UNION ALL
SELECT 'app_tag_settings_off',   (SELECT COUNT(*)::text FROM app_tag_settings WHERE "isEnabled" = false);
```

How to read it:

- `access_source` must be `user`. Anything else and the whole of §A.2's user path is dormant, and
  Phase 2 would gate on a table nothing reads.
- `user_page_access_rows` should equal `users_total × 27`. A shortfall means some people have no
  row for some key, and an absent row is **all-false** — those people are the ones Phase 2's step 1
  must cover.
- `multi_role_users` sizes the C2 problem. If it is 0, the role tier is unambiguous today and the
  merge rule only matters for the future.
- `app_tag_settings_rows` sizes the migration. `app_tag_settings_off` is how many switches are
  actually in use — if it is 0, nobody has ever turned a badge off and the whole feature is
  unexercised in production, which changes how much the scope work is worth doing now.

---

*Diagnosis only. No files changed outside this document, no SQL executed, no dev server run.*
