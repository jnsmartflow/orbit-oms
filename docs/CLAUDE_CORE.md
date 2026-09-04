# CLAUDE_CORE.md — OrbitOMS Core
# v100 · Schema v27.23 · September 2026 · updated 2026-09-04 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_UI.md

---

## 1. What this app is

Depot-level order management for a paint distribution company (JSW Dulux, formerly Akzo Nobel India). Single depot, Surat. Two parallel pipelines:

- **OBD pipeline:** SAP XLS import → tinting → Floor Control release (`/floor` — the desk step formerly done on the retired Support board) → warehouse picking → vehicle dispatch
- **Mail order pipeline:** Forwarded email parsing → SKU enrichment → SAP punching → SO number capture → dispatch data flows back to OBD

Plus three standalone modules:
- **Place Order** (`/place-order`) — depot phone-order entry; **`/po`** public mobile equivalent (`/order`, the original public page, retired 2026-07-27 — `archive/2026-07-order/`)
- **Attendance** (`/attendance`) — check-in/out PWA with OT workflow
- **Sampling Library** (`/tint/sampling-library`) — digital paper register, shade recipes + usage history

Internal tool. Role-based access. Scale: ~100-200 OBDs/day, ~150+ mail orders/day, ~25-35 dispatch plans/day. Live at https://orbitoms.in.

---

## 2. Tech stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 14 App Router |
| Language | TypeScript (strict) |
| Styling | Tailwind + shadcn/ui |
| ORM | Prisma |
| Database | Supabase (PostgreSQL) |
| Auth | NextAuth.js v5 |
| Host | Vercel |
| Package manager | npm |
| XLS | `xlsx` npm package |
| Storage | Supabase Storage (attendance selfies, private bucket) |
| Icons (PWA) | `@resvg/resvg-js` (devDep) |

Never introduce new libraries without being asked.

---

## 3. Engineering rules — non-negotiable

- Never `prisma db push`. Schema changes via Supabase SQL Editor + `npx prisma generate`.
- `npx prisma db pull` fails locally with P1001 (Supabase direct host is IPv6-only; depot ISP is IPv4-only). Workflow: ALTER in Supabase SQL Editor → hand-edit `prisma/schema.prisma` to match → `npx prisma generate`.
- **Read-only SELECTs against production are ALLOWED and encouraged** (`DATABASE_URL`, the pooler, works — only `db pull`'s DIRECT_URL host is unreachable): verify claims about live data instead of inferring them. `SELECT` / `information_schema` / `pg_catalog` only — **never** INSERT/UPDATE/DELETE/ALTER/DROP. Every write, schema or data, still goes through Smart Flow in the Supabase SQL Editor. Show the query and label it read-only.
- Never `prisma.$transaction`. Use sequential awaits.
- Never delete files unless explicitly instructed.
- All API routes: `export const dynamic = 'force-dynamic'`
- `npx tsc --noEmit` passes before commit.
- Supabase columns are camelCase (no `@map`).
- Vercel region: `bom1`.
- Auth: `lib/auth.ts` (Node) vs `auth.config.ts` (Edge). Do not merge.
- `@page` CSS: top-level in globals.css, never nested.
- DB passwords: no `@`, `#`, `$` (breaks URL parsing).
- `Array.from()` around Set/Map iterators.
- All commits go directly to `main`. No feature branches, no PR workflow. Smoke-test locally before push.
- **Commit ≠ deploy.** Vercel builds from `origin/main`. A local commit on `main` is NOT live until `git push origin main`. DB reseeds run against Supabase directly and are independent of code deploy — easy to land schema/data changes without the code that uses them. Always finish a session with both a code push AND a verification that the new behaviour shows on production.
- **A `router.refresh()` is DISCARDED by a history pop — never pair the two.** Next's router action queue gives navigations priority: an `ACTION_NAVIGATE`/`ACTION_RESTORE` — which is what a `history.back()` becomes — marks any *pending* action `discarded = true`, so its result is never applied (`node_modules/next/dist/shared/lib/router/action-queue.js`). Only a discarded **server action** gets the `needsRefresh` rescue; a plain `router.refresh()` gets nothing. **Symptom:** any screen that closes an overlay via `history.back()` AND refreshes through the router silently loses that refresh, and shows stale data until some unrelated later refresh happens to win. **THE FIX IS NOT TIMING.** Two attempts to order the calls shipped — awaiting the pop, then a deferred flag plus an edge effect — and **both looked green in `tsc` and in the build while the bug stayed live on production**; the ordering belongs to React's and Next's schedulers, not to us, so no amount of re-sequencing at the call site can win it. **The fix is a client `fetch` + `setState`:** it never enters that queue and cannot be discarded — which is why a sibling screen doing the identical pop after its own write never had the bug at all. First hit: the picker "My Picks" face (`4f9d1324` introduced the pop, `9941bedb` failed to fix it, `570b7078` fixed it) — behaviour in `CLAUDE_PICKING.md §5.4`, not restated here. **No type-check, lint or build catches this. Only a device does.**
- PowerShell on depot PC: PS 5.1. `[BitConverter]::ToString($h).Replace("-","").ToLower()` (not `[Convert]::ToHexString()`). `Invoke-WebRequest -UseBasicParsing` (not `Invoke-RestMethod`). `$x = default; try { $x = expr } catch { $x = fallback }` — never `$x = try {...} catch {...}` (PS7+ only).
- Parser files UTF-8 with BOM for non-ASCII chars.
- Google Maps URLs: `https://www.google.com/maps?q=LAT,LONG`. Never `place_id:` format.
- HMAC-signed auto-import: the LIVE path signs with fixed string `"auto-import-json-v1"` (`IMPORT_HMAC_SECRET_JSON`); `"auto-import-v1"` (`IMPORT_HMAC_SECRET`) belongs to the v1 multipart handler — wired but with zero batch evidence ever; retire-or-keep is a ROADMAP owner decision. Both timestamp-free (avoids PC clock drift). *(Corrected 2026-08-05 — this line named only the dead v1 string.)*
- `<UniversalHeader />` is mandatory for all boards. No custom headers.
- `page.tsx` pattern: bare `<ComponentName />`, no wrapper div, no title.
- Fixed table standard (`CLAUDE_UI.md §40`) for ALL data tables.
- Sidebar role: always `session.user.role` — never hardcoded.
- **Soft-delete reads:** every `orders` list/find adds `where: { isRemoved: false }`. Every `delivery_challans` list adds `where: { isVoided: false }` — EXCEPT challan sequence-number allocation, which MUST include voided rows to avoid collision.
- **Voided challan audit surface:** challan list/detail uses `OR: [{ isRemoved: false }, { isRemoved: true, challan: { isVoided: true } }]` so Chandresh still sees voided-challan rows for removed OBDs.
- **Partial unique index reconcile pattern (P2002):** when a partial unique index enforces "exactly one row of a kind per parent" (e.g. one Primary SO per customer), reconcile loops MUST demote-then-promote, never promote-then-demote. Pre-clear all rows of the constrained kind to a non-conflicting state (one `updateMany`) before running the main upsert loop. Drops role-comparison optimisations — safer than carrying stale-cache bugs.
- **Seed is source of truth.** Any structural/taxonomy/grouping change applied directly to a live DB will be wiped by the next wipe-and-reseed. All such changes must go into the seed script (the durable source). Direct-to-DB ALTERs are acceptable for hot fixes ONLY when paired with the matching seed edit.
- **Never fuzzy-match site names.** Site name suffixes like "FACE" / phase numbers distinguish genuinely different sites. Stripping or fuzzy-matching risks linking the wrong site. For backfill, prefer OBD→order→customerId resolution over name-based matches.
- **`Date.parse()` on an offset-less ISO date-time is read in the HOST's timezone — normalise before parsing.** Per the ES spec, `"2026-07-30T18:45:00"` (no `Z`, no `±HH:MM`) is **local** time, while a date-ONLY string (`"2026-07-30"`) is UTC. This is harmless while a date rule runs only on Vercel (UTC), and breaks the moment the same rule ALSO runs in a browser on a depot phone in **Asia/Kolkata**: the two hosts disagree by **5.5 hours**, so the same row lands in a different IST day depending on which one evaluated it — and **only near midnight**, so it passes every daytime test and every test written on one host. Safe inputs, which is why this is rare rather than constant: real `Date` objects (Prisma) and any string carrying `Z` or an offset (JSON and RSC payloads always emit one). An offset-less string must be normalised to UTC first — reference implementation `pickedAtMs()` in `lib/picking/picker-split.ts`. ⚠ **The trigger is "this logic now runs in two places", NOT "this logic is new"** — moving an existing, correct, server-side date rule to the client is exactly when it bites, and the rule itself will not have changed a character.
- **OneDrive + Next.js stale `.next` symptom:** `Error: Cannot find module './NNNN.js'` + `missing required error components, refreshing...`. Fix: stop the dev server, `taskkill /F /IM node.exe`, `rmdir /s /q .next`, restart. Pause OneDrive sync if `rmdir` hits a permission error.
- **Stop the dev server before any git operation in this repo.** Same OneDrive file-lock reason as above.
- **Picking live-sync is READ-ONLY — it adds no `orders.update`.** The 15s change-marker (`CLAUDE_PICKING.md §10`) only READS (`COUNT` + `MAX(orders.updatedAt)` via `buildPickingWhere`); do not assume the poll writes. And **never add a second `orders.update` to any picking path** (e.g. a notification trigger) — the marker keys on `MAX(orders.updatedAt)`, so an extra write fires a false "changed" on every board.

---

## 4. Infrastructure

**Domain:** orbitoms.in (Namecheap). DNS: A `@` → Vercel IP, CNAME `www` → Vercel DNS. SSL auto-provisioned. `orbitoms.in` redirects to `www.orbitoms.in`.

**Hosting:** Vercel Hobby. Production = `main` branch. Region `bom1` Mumbai. Vercel auto-deploys on push to `main`.

**Database:** Supabase Pro ($25/mo, never pauses). Region `ap-south-1`. Pooler: Transaction mode, port 6543, pool size 15, max clients 200. DIRECT_URL on port 5432 for `prisma generate`.

**Env vars (Vercel):** `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (https://www.orbitoms.in), `IMPORT_HMAC_SECRET` (v1 multipart auto path), `IMPORT_HMAC_SECRET_JSON` (v2 JSON auto path: `?action=auto-json` / `check` / `patch-headers` / `pending-invoices` — the path the live Auto-Import runs on), `MAIL_ORDER_HMAC_SECRET`, `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**Local codebase:** `C:\Users\HP\OneDrive\VS Code\orbit-oms` · GitHub `jnsmartflow/orbit-oms`. Working branch: `main`.

**Depot PC PowerShell tools (outside git):**

| Tool | Location | Schedule | Purpose |
|---|---|---|---|
| `Parse-MailOrders` (**V7 line** — repo copy `docs/Parser/Parse-MailOrders-V7.ps1` v7.3.0; live PC ≥v7.2, version ruling owned by `CLAUDE_MAIL_ORDERS.md §3`) | `C:\Users\HP\OneDrive\VS Code\mail-orders\` — the MAIL PC | continuous | Forwarded email parser. Outlook COM. Dedup via `processed_ids_fw.json`. *(Row named "v6_5" until 2026-08-05.)* |
| **`Auto-Import-v2.ps1`** (pure JSON; internal stamp "v1.0") | `F:\VS Code\OBD-Import Tool v2\` — **on the import PC, unverifiable from the depot PC**; repo copy `docs/Powershell/Auto-Import-v2.ps1` | **LIVE** — ~10-min timer; batches observed 08:15–22:52 IST, none on Sundays | SAP OBD fetch via Breakwalls FormGetData JSON → `?action=auto-json` (HMAC `auto-import-json-v1` / `IMPORT_HMAC_SECRET_JSON`; batches stamp `[auto-import] auto-json`), plus `check` + `patch-headers`/`pending-invoices`. Resumed 2026-06-20. ⚠ Corrected 2026-08-04 (second pass): this row previously named `Auto-Import.ps1` "v2.0" — that file is the **v1 multipart** script (**zero batches ever**; "v2.0" = Tool v2, not the pipeline) and may or may not still run on the import PC. Detail: `CLAUDE_IMPORT.md §10`. |
| `Watch-Import-V2.ps1` | `F:\VS Code\OBD-Import Tool v2\` | manual | Cycle summary watcher. Supports `-Today` and `-Date YYYY-MM-DD` modes. |

**Auto-Import v2 state files** (in `Master\`): `yesterday-recovery-state.txt`, `pending-upload.txt`, `last-spec-call.txt`, `last-noise-call.txt`, `obd-tally-<date>.txt`, `session-cookie.txt` (4-hour cache), `daily-state.txt`. ExecutionTimeLimit on `2_Auto_Import` scheduler task is `PT5M`. Repetition interval `PT10M`, `StopAtDurationEnd=false`.

**Monitoring:** `/api/health` for manual checks. `vercel.json` currently defines **2 daily cron jobs** — attendance rollover (`35 18 * * *`) + photo purge (`30 20 * * *`), both `/api/cron/*`, bearer-auth via `lib/cron-auth.ts`.

**Vercel cron limits — CORRECTED 2026-07-22 (Vercel docs + Jan-2026 changelog):** the old "2 cron schedules, Hobby tier cap" wording was wrong on both count and cap. The per-project job COUNT cap was lifted to **100 on all plans** (the per-team "2 on Hobby" cap is GONE) — **count is no longer the constraint.** The binding constraint on **Hobby is CADENCE: crons run at most ONCE PER DAY** — any more-frequent expression **FAILS AT DEPLOY**, and firing is only guaranteed within the specified hour (a `01:00` job may fire any time before `02:00`), UTC only. **Consequence: freeing a "slot" does NOT enable a frequent job.** A sub-daily schedule (e.g. the deferred 10-minute picking-supervisor timer, `CLAUDE_NOTIFICATIONS.md §7`) needs an **EXTERNAL trigger** — the planned depot-PC PowerShell doorbell — or Vercel Pro. Do not re-attempt a frequent Vercel cron on Hobby.

---

## 5. Roles and users

> ## 🔴 READ THIS BEFORE ANYTHING ELSE IN §5 — THE MODEL CHANGED ON 2026-09-04
>
> **Access comes from `user_page_access`, one row per (user, page key).** Not from
> `role_permissions`. Everything below the horizontal rule describes ROLES, and roles no longer
> grant anything on their own.
>
> **A job title is a LABEL and a STARTING TEMPLATE. It grants nothing.** It still decides the
> sidebar heading, the login landing route (`ROLE_REDIRECTS`), the `ROLE_HREF_OVERRIDES` rewrites,
> and which face two screens draw (Picking, MRN). It does not decide what anyone may do.
>
> ### The panic button — flipping the source
>
> `system_config` key **`ACCESS_SOURCE`**. **Live value: `user`** (SELECT-verified 2026-09-04).
>
> ```sql
> -- BACK TO JOB TITLES. This is the rollback. Run it first, ask questions after.
> UPDATE system_config SET value = 'role' WHERE key = 'ACCESS_SOURCE';
>
> -- FORWARD TO PER-PERSON TICKS. The live setting.
> UPDATE system_config SET value = 'user' WHERE key = 'ACCESS_SOURCE';
>
> -- Which is it right now?
> SELECT value FROM system_config WHERE key = 'ACCESS_SOURCE';
> ```
>
> Either takes effect **within ~30 seconds**, fleet-wide, with no deploy and no restart —
> `lib/access/source.ts` caches the value in module scope for 30s. You do not need to be logged in
> to run these. `/admin/access` shows which source is live in a banner at the top, driven by the
> same cached value, so it cannot disagree with what is being enforced.
>
> **Only the exact string `user` turns it on.** A missing row, a null, a typo, odd casing, or any
> database error resolves to `role` — and an error caches that safe answer for a full TTL rather
> than retrying. Failing back to the old behaviour is always safe; failing forward would change
> everyone's access at the worst possible moment.
>
> ⚠ The cache is **per serverless instance**, so for up to 30s after a flip one lambda can be on
> ticks while another is on roles. Invisible while the two sources agree — which they did exactly
> (0 diffs, §7.14) at cutover — and a real 30-second transition the moment anyone edits a tick.
>
> ### What is retained
>
> **`role_permissions` is NOT retired and must not be dropped.** It is the fallback the switch
> flips back to, it is still written by the old `/admin/permissions` screen, and it is still read in
> `role` mode. 118 rows across 13 slugs, live. Dropping it while `ACCESS_SOURCE` can be flipped
> back turns the rollback into an outage — see §13.
>
> `user_roles` (29 rows, 20 users) and `role_master` (13 roles) are likewise retained. They still
> feed the label, the redirect and the `/admin/access` "what would their job title give them"
> baseline.
>
> ### Admin is now a flag
>
> **`users.isSuperuser`**, checked by 68 gates as **`isSuperuser === true` OR `roles includes
> "admin"`** — `isSuperuser(session)` / `requireSuperuser(session)` in `lib/rbac.ts`. Live: 1 of 39
> users, and that user holds both.
>
> **Both arms exist because one account holds this.** If the flag fails to reach the session for any
> reason — a token minted before the deploy, a session callback that stops copying the claim, a bad
> edit to `auth.config.ts` — the role arm still admits the owner. He is the only person who can
> reach the `ACCESS_SOURCE` switch above and the only person who can grant the flag back. **Removing
> the role arm is a later, deliberate decision, not a tidy-up** (§13).
>
> A flag change lands within **~5 minutes** (the JWT refresh window) with no sign-out. **To cut
> access NOW, set `users.isActive = false`** — checked at sign-in, not cached.
>
> ### Where the detail lives
>
> Schema: §7.14 (`user_page_access`) and §7.15 (`isSuperuser`). Screen: §12 and `CLAUDE_UI.md §63`.
> What shipped and what did not: `docs/prompts/drafts/code-update-2026-09-04-user-based-access.md`.
> Remaining work: `ROADMAP.md` → *User-based access*.

---

`role_master` IDs — **labels and starting templates, not grants.** The "primary access" column
below describes where the job title *lands* someone at login (`ROLE_REDIRECTS`), which survives the
change; it is no longer a statement about what they may see.

| ID | Role | Primary route | Key users |
|---|---|---|---|
| 1 | admin | `/admin` | admin@orbitoms.in |
| 2 | dispatcher | `/place-order` (gated, see below) | Ajay Vansiya, Dhanraj Shah |
| 3 | support | `/place-order` (gated) | Priya Chaudhari (id=31). ⚠ Rahul (§6 team) has NO active support user account — SELECT 2026-08-04 shows only Priya + a test account. |
| 4 | tint_manager | `/tint/manager` | Chandresh Kolgha |
| 5 | tint_operator | `/tint/operator` | Deepak Vasava, Chandrasing Valvi |
| 6 | floor_supervisor | `/picking` | Test Supervisor 1 (id=34) — test account, first real logins 2026-07-29 |
| 7 | picker | `/picking` | Test Picker 1 (id=35), Test Picker 2 (id=36) — test accounts |
| 12 | operations | `/floor` | operations@orbitoms.in |
| 13 | billing_operator | `/mail-orders` | Deepanshu Thakur (id=25), Bankim (id=26) |
| 14 | ops_admin | `/admin/attendance` | Dhruv (id=27), Kuldeep (id=28) |
| 16 | logistics | `/trips` | Praveen (primary role — sees only Trip Report). Full detail: `CLAUDE_TRIP_REPORT.md §1`. |
| 15 | operation_manager | `/tint/manager` | Prakash (id=32, active). **CONFIRMED REAL 2026-08-04** (role_master SELECT: id 15; one active user) — settling the 2026-07-10 "undocumented slug, no confirmed row" open item; first flagged confirmed in `docs/prompts/drafts/web-test-plan-2026-07-29-picking-first-real-login.md`. |

**Login redirects** (`lib/rbac.ts` `ROLE_REDIRECTS` map — verified against live code 2026-07-16, three entries corrected): admin→`/admin`, dispatcher→`/place-order`, support→`/place-order`, tint_manager→`/tint/manager`, tint_operator→`/tint/operator`, **floor_supervisor→`/picking`** and **picker→`/picking`** (both repointed 2026-07-28, commit `c4323cd4` — they previously landed on the `/warehouse/supervisor` and `/warehouse/picker` stubs, which forwarded to the now-archived, always-empty `/warehouse` board), **operations→`/floor`** (was `/operations/support`; repointed 2026-07-27 with the Support retirement, commit `3ff717e5`), billing_operator→`/mail-orders`, **ops_admin→`/admin/attendance`** (was wrongly `/admin`), operation_manager→`/tint/manager` (previously missing from this map entirely), logistics→`/trips`.

**Middleware — no forced attendance redirect (fixed 2026-07-04).** `middleware.ts` previously had an attendance gate (~lines 69-96) that redirected EVERY authenticated request to `/attendance` until check-in — not mobile-specific, but fired right after the login redirect above, so it looked mobile-only. That entire `if` block + the unused `istDateString` import were removed. Login (mobile and desktop) now routes straight to the role's landing page via `ROLE_REDIRECTS`, with no forced detour. Attendance itself is unaffected — still reachable directly at `/attendance`. Only 3 test accounts (admin/ops_admin) ever had the flag; no operational role relied on it. Confirmed via `middleware.ts` — no attendance-gate or `istDateString` reference remains. Full detail: `CLAUDE_TRIP_REPORT.md §7` (this fix shipped alongside the Trip Report build).

**Trip Report secondary-role grants:** 4 existing users were added to `logistics` as a **secondary** role via `user_roles` (primary roles kept, unaffected): Ajay Vansiya (dispatcher), Dhanraj Shah (dispatcher), Priya Chaudhari (support), Operations User (operations). The `operations` role itself is NOT granted `trip_report` — only these 5 named users (the 4 above + Praveen).

**Dispatcher / support gated permissions:** these roles have `role_permissions.canView = true` only for `pageKey = 'place_order'`; all other pageKeys are `canView = false` — **confirmed LIVE by SELECT 2026-07-28.** ⚠ **`prisma/seed.ts` disagrees**: it seeds `dispatcher` and `support` rows for `customers`, `skus`, `routes_areas`, `vehicles` and `import_obd` with `canView: true`. **Live is the authority here; seed is stale.** A wipe-and-reseed would silently re-grant all five. Anywhere else in this file that lists these roles as holding another key is describing seed, not reality. ⚠ This used to read "until the real dispatcher/support screens go live" — **that premise is dead**: the Support board was retired 2026-07-27 (`archive/2026-07-support/`), so no such screen is coming. The grants are unchanged; only the stated reason was wrong.

**Multi-role users (`user_roles` table):**

```
user_roles
├── id          SERIAL PK
├── userId      FK → users.id (CASCADE)
├── roleId      FK → role_master.id (RESTRICT)
├── isPrimary   BOOLEAN
├── createdAt   TIMESTAMPTZ
└── createdById FK → users.id (nullable)

UNIQUE (userId, roleId)
UNIQUE (userId) WHERE isPrimary = true
```

Primary role drives login redirect and href overrides. Additional rows add nav items and unlock APIs. `users.roleId` retained as denormalised primary-role pointer for fast reads.

**Login identifiers:** `users` has `phone TEXT` with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. NextAuth credentials provider accepts email OR 10-digit phone — `/^\d{10}$/` regex routes the lookup. Field `id`/`name` stays `email` (auth contract). Strict 10-digit only — no `+91`, dashes, or spaces.

**Permissions:** `lib/permissions.ts` has `PAGE_NAV_MAP`, the `PageKey` type, and `ALL_PAGE_KEYS` (27 keys).

🔴 **THE TABLE BELOW IS THE ROLE TEMPLATE / FALLBACK, NOT LIVE ACCESS.** Since 2026-09-04 the
resolvers read `user_page_access` by user id; these `role_permissions` rows are what a job title
*would* grant, which is (a) what the ticks were seeded from, (b) what `/admin/access` compares each
person against, and (c) what the app falls back to if `ACCESS_SOURCE` is flipped to `role`. To
answer "what can this person actually do today", read their `user_page_access` rows or open
`/admin/access` — not this table.

Current page keys and their role-template grants:

| Page key | Granted to |
|---|---|
| `import_obd` | admin (view+import); `canImport=true` (with `canView=false` — import runs from the universal modal, not a page view) on billing_operator, tint_manager, **operations (granted 2026-08-01, commit `c8f8d020` + live row)** and operation_manager — SELECT 2026-08-04. ⚠ `dispatcher` and `support` appear in `prisma/seed.ts` with `canView`+`canImport` true but are **all-false LIVE** — seed/live drift; see §5's gated-permissions note. Import authority also lives in the client allow-list (`canImportOBDs`, mail-orders-page) and the route's `requireRole` — three places, keep in step. |
| `delivery_challans` | tint_manager (view + edit), admin |
| `shade_master` | tint_manager (view), admin — DEPRECATED, retiring soon (see §13) |
| `ti_report` | tint_manager (view + export), admin |
| `sampling_library` | **FIVE roles, ALL canView+canEdit — SELECT 2026-08-05:** admin, tint_manager, tint_operator, ops_admin, operation_manager. ⚠ This row said "tint_operator (view)" until 2026-08-05 — the live rows disagree; "operators are read-only" is a UI convention, not a grant (`CLAUDE_SAMPLING_LIBRARY.md` header). |
| `customers` | admin, operation_manager, tint_manager (view + edit) — SELECT 2026-08-04. ⚠ This row previously named the key **`customer_master`** and listed **ops_admin** — both wrong: the live key (and the `PageKey` union member, `lib/permissions.ts`) is `customers`, and ops_admin holds no row for it. ⚠ `support` and `dispatcher` are seeded but **`canView=false` LIVE** — same drift as `import_obd` above. |
| `place_order` | admin, billing_operator, tint_manager, support, dispatcher |
| `attendance` | all roles gated per rollout stage — visibility from user-level flags, **no `role_permissions` row exists for this key by design** (`lib/permissions.ts` special-cases it) |
| `attendance_admin` | the `/admin/attendance` dashboard key (separate from end-user `attendance`) — in the `PageKey` union and live `role_permissions`; previously missing from this table |
| `removed_orders` | admin only |
| `ti_report` (reused) | gates the Reports hub `/reports` (Tint Summary + TI Report) |
| `settings_hide` | admin only (v27.6). In `PageKey` union + `ALL_PAGE_KEYS` (admin auto-ALL_TRUE), **NOT** in `PAGE_NAV_MAP` (that feeds operational sidebars; would duplicate the admin entry). |
| `trip_report` | logistics (view only) + the 4 named secondary-role users above (§5). `operations` role NOT granted. → `CLAUDE_TRIP_REPORT.md §1`. |
| `mail_orders` | billing_operator (view + edit), operations (view + edit — **granted 2026-07-10**, one additive DB row, no code deploy), operation_manager (view + edit), tint_manager (**view + edit** — *corrected 2026-09-01: this row read "view only" from 2026-07-10; live SELECT shows `canEdit=true`*). Zero rows in `prisma/seed.ts` — DB-only, wiped on reseed. → `CLAUDE_MAIL_ORDERS.md §22`. |
| `picking` | ✅ **LIVE-VERIFIED 2026-07-28 — this row is the OWNER of that statement; other files cross-reference it.** Direct `role_permissions` SELECT against production: `floor_supervisor` view=true edit=true · `operations` view=true edit=true · `picker` view=true edit=**false**; plus admin via bypass. **Seed and live AGREE** (`prisma/seed.ts:110-112`, seeded 2026-07-20) — resolving the prior "no picking rows / seed-fragile operations grant" landmine (§13). ⚠ The same SELECT established that **`floor_supervisor` and `picker` hold `picking` but NOT `floor`** — `/floor` is not a fallback for either role, which is why the Picking desktop retirement kept `/picking` live instead of redirecting (`CLAUDE_FLOOR.md §9b`). Any "granted in seed, prod unverified" wording elsewhere is stale — this supersedes it. → `CLAUDE_PICKING.md §1/§7`. |
| `floor` | admin + operations (view + edit); admin via bypass. New pageKey (2026-07-24) for Floor Control (`/floor`) — in `PageKey` union, `ALL_PAGE_KEYS`, and `PAGE_NAV_MAP` (→ `/floor`). **Present in BOTH `prisma/seed.ts` AND live `role_permissions` (SQL 2026-07-23) — verified both sides**, unlike the `picking` grant above. `dispatch planner` / `telecaller` (design-named) deferred — no matching slug / does not exist. → `CLAUDE_FLOOR.md §1`. |
| `mrn` | **Three roles — SELECT-verified live 2026-09-03:** `billing_operator` view+edit+**export**+delete · `operations` view+edit+**export** · `floor_supervisor` view+edit, **export FALSE**. Admin via bypass. Seed and live AGREE (`prisma/seed.ts`, corrected by `544543f2` — that commit exists because seed and live had disagreed on exactly this `canExport` pair). ⚠ **The withheld export is DESIGNED, not an oversight in the grant:** the supervisor records what arrived, the REPORT is billing's deliverable, and `app/api/mrn/[mrnId]/export/route.ts` gates on `canExport` rather than `canView` for that reason. → `CLAUDE_MRN.md §9`. |
| `ci` | **Three roles, the SAME shape as `mrn` and for the same reason — SELECT-verified live 2026-09-03:** `billing_operator` view+edit+**export**+delete · `operations` view+edit+**export** · `floor_supervisor` view+edit, **export FALSE**. Admin via bypass. **Seed and live AGREE row for row** (`prisma/seed.ts:162-164`, applied to live by `sql/2026-08-31-ci-module.sql` and seeded so a wipe-and-reseed reproduces them). ⚠ The floor raises the return; the REGISTER is billing's, so `app/api/ci/export/route.ts` gates on `canExport` while the board next door gates on `canView` — a session "tidying" that difference away would hand billing's outward-going document to the floor. ⚠ `ci` is in the `PageKey` union and `ALL_PAGE_KEYS` but deliberately **NOT in `PAGE_NAV_MAP`** — see §12. → `CLAUDE_CI.md §11`. |

**Sidebar:** Layout files pass `session.user.role as RoleSidebarRole` (not hardcoded). For **operational / role-based** sidebars, nav items come from `buildNavItems()` in `lib/permissions.ts` only — no manual appending. ⚠️ The **admin panel** sidebar is the separate `components/admin/admin-sidebar.tsx` (`NAV_SECTIONS` array: OVERVIEW / MASTER DATA / PEOPLE / OPERATIONS / PERSONAL / SETTINGS) — `buildNavItems()`/`PAGE_NAV_MAP` do NOT feed it. New admin items (e.g. Settings → Hide) are added there.

**Route guard:** `PHASE1_BLOCKED` in `middleware.ts` is currently `[]` (all routes unblocked). To temporarily block a route, add the path to this array.

---

## 6. Team

| Person | Role |
|---|---|
| Chandresh Kolgha | Tint Manager |
| Deepak Vasava, Chandrasing Valvi | Tint Operators |
| Deepanshu Thakur | Billing Operator (primary, id=25) |
| Bankim | Billing Operator (id=26) |
| Rahul | Support |
| Ajay Vansiya, Dhanraj Shah | Dispatcher (Place Order only for now) |
| Priya Chaudhari | Support (Place Order only for now) |
| Dhruv (id=27), Kuldeep (id=28) | Ops Admin |
| Prakashbhai | Team lead, reports to Smart Flow (developer) |

---

## 7. Database schema — v27.23

Versions: v21 base → v22 (mo_*) → v23 (orders dispatch) → v24 (customer match) → v25 (split) → v26 (mo_order_remarks) → v26.1 (isLocked) → v26.2 (mo_line_status) → v26.3 (carton + piecesPerCarton) → v26.4 (mo_learned_customers) → v26.5 (orders.orderDateTime) → v26.6 (user_roles + manual_tint_entries + users.phone + mo_sku_lookup.refDescription) → v27.0 (attendance foundation) → v27.1 (attendance settings hardening) → v27.2 (OT workflow + 2026-05-13 place-order v2 tables) → v27.3 (sampling_register + sampling_recipes + sampling_usage_log; orders.isRemoved + delivery_challans.isVoided; tint_skip_events + tint_pause_events; tint_assignments + import_raw_line_items netWeight/totalWeight) → v27.4 (sampling_usage_log.deliveryNumber backfill + tinter_issue_entries.samplingNo/shadeName) → v27.5 (customer_sales_officers + linkedSalesOfficerId on delivery_point_contacts + 3 columns on delivery_challan_formulas + sampling_recipes.packCode nullable with NULLS NOT DISTINCT + mo_sku_lookup_v2.isPrimary + mo_order_form_index_v2.mobileFamily) → v27.6 (mo_order_form_index_v2.region; Hide feature: `obd_visibility_rules` + `app_tag_settings` tables + orders.isHidden/hiddenById/hiddenReason/hiddenAt — §7.10) → v27.7 (Support gatekeeper + Hold/Dispatch-Target: orders.mailMatched; orders.heldAt, dispatchTargetDate, dispatchWindowId, arrivalSlotId; new `dispatch_slot_master` table — §7.4) → **v27.8** (Trip Report module, 2026-07-04/06: new standalone `trip_report` table — full columns → `CLAUDE_TRIP_REPORT.md §3`, §7.11 pointer here; `trip_report_delivery_no_dis_date_key` UNIQUE(deliveryNo, disDate); `mirror_trip_report_today` Postgres function) → **v27.9** (Support ship-to override, 2026-07-07: `orders.shipToOverrideCustomerId` Int? FK → `delivery_point_master`, relation `shipToOverrideCustomer` / `@relation("OrderShipToOverride")` — see dual-relation note in §7.3; `mo_orders.shipToOverrideCustomerId` Int? FK → `delivery_point_master`, relation `shipToOverrideCustomer` / `@relation("MoOrderShipToOverride")` — mo_orders' first relation to that table, no dual-relation trap) → **v27.10** (Picking Stage 2 — 2026-07-17/18 sessions, already shipped in code: `pick_assignments.checkedAt` DateTime? `@map("checked_at")` + `checkedById` Int? `@map("checked_by_id")`, relation `checkedBy` / `@relation("PickAssignmentCheckedBy")` — THIRD named relation from `pick_assignments` to `users`, alongside `picker`/`PickAssignmentPicker` and `assignedBy`/`PickAssignmentAssignedBy`, all correctly named on both sides today — no ambiguity. Supports the supervisor Approve step of the picking floor workflow — `CLAUDE_PICKING.md §6`) → **v27.11** (Flat SKU catalog, 2026-07-19, commit `916fcd39`: new standalone `sku_master_v2` table — 17 columns, FLAT, zero relations, `material` `@unique` as the natural key; mirrors `mo_sku_lookup_v2` MINUS `containerType`, PLUS `isActive` (new lifecycle flag) and `updatedAt` (`DateTime?`, hand-maintained, deliberately NO `@updatedAt`). Both timestamps carry `@db.Timestamptz(6)` — required, or Prisma emits plain `timestamp` and mismatches the live column. Built + poured via `docs/prompts/drafts/build-sku-master-v2-2026-07-19.sql`: 1,743 rows, 25 retired TOOLS `645xxxx` rows marked `isActive=false`. Old `sku_master` + its 3 FK helpers are now dead to operations, pending drop — §7.1.c) → **v27.12** (Push notifications + Picking live-sync, 2026-07-22: new standalone `push_subscriptions` table — 11 cols, `endpoint` UNIQUE `push_subscriptions_endpoint_key`, FK `userId`→users ON DELETE CASCADE, `updatedAt` a PLAIN `@default(now())` NOT `@updatedAt`; PLUS new index `orders_updatedAt_idx` on `orders("updatedAt" DESC)` backing the live-sync marker — §7.12) → **v27.13** (2026-07-20/30/31 additions, SELECT-verified live 2026-08-04; **minted 2026-08-05** in the reconciliation final pass): (a) `orders.pickEarlyReleasedAt` Timestamptz(6) + `pickEarlyReleasedById` FK→users `@relation("OrderPickEarlyReleasedBy")` (Picking early-release 5b, 2026-07-20 — `CLAUDE_PICKING.md`); (b) **Billing v2** (2026-07-30/31, `docs/prompts/drafts/billing-phase-2-build-decisions.md` — behaviour docs land in the MAIL_ORDERS session): new singleton `billing_settings` (scope UNIQUE `billing_settings_scope_key`, `rolloutStage` enforced by CHECK `chk_billing_settings_rollout_stage` OFF|TEST_USERS_ONLY|ALL_USERS — live row TEST_USERS_ONLY); `users.billingV2TestUser` Boolean (read fresh per page load by `lib/billing/flag.ts`, deliberately NOT JWT-cached — live: user 20 only); `orders.invoicedAt` Timestamptz(6) + `invoicedById` FK→users `@relation("OrderInvoicedBy")` (billing mark-done — 22 rows already carry it); partial index `orders_billing_pending_idx` ON orders("workflowStage") WHERE invoicedAt IS NULL AND invoiceNo IS NULL AND isRemoved=false (partial — NOT expressible in Prisma, do not model as `@@index`); `mo_orders.dispatchTargetDate` @db.Date + `dispatchWindowId` FK → `dispatch_slot_master` (slot INTENT — live FK name is all-lowercase `mo_orders_dispatchwindowid_fkey`, Postgres folded it; a camelCase FK search comes back empty and looks like a missing FK) + partial index `mo_orders_slot_intent_idx`; (c) `sku_master_v2.displayCategory` + `displayName` (deferred friendly-name columns — §7.1.c) → **v27.14** (2026-08-07): new standalone `pick_findings` table — 15 columns, the floor's "qty short / old stock" record against one raw line. FK to `orders`, a UNIQUE FK to `import_raw_line_items` (one finding per line), and **TWO named relations to `users`** (`PickFindingReportedBy` / `PickFindingRecordedBy` — both explicitly named on both sides, or Prisma errors). Live CHECK `chk_pick_findings_reason` and the partial `pick_findings_confirmed_idx` are NOT expressible in Prisma and are recorded by hand; `pick_findings_order_idx` IS modelled, with an explicit `map:`. Schema only at mint — **the UI landed the next day, see v27.15**. Full column list + landmines: §7.4. → **v27.15** (2026-08-08): `pick_findings.mfgMonth` INT? + `mfgYear` INT? — the OLD MFG half of `reason`, captured by the picker/supervisor popup. Live CHECK `chk_pick_findings_mfg_month` (month IS NULL OR 1-12) is NOT expressible in Prisma and is recorded by hand; there is deliberately NO year constraint. 🔴 The reason-dependency (REQUIRED on `old_mfg`, FORCED NULL on `short_quantity`) is **not enforced by the database** — it lives in both write routes and is written unconditionally on every save. §7.4. → **v27.16** (MRN module, 2026-08-20) and **v27.17** (2026-08-22: `mrn_line_batches.bestBeforeMonth`/`Year` made NULLABLE and retired from every surface) — ⚠ **both were minted in `prisma/schema.prisma` on 2026-08-20/22 but NEVER recorded in this chain**, which is why it read v27.15 until 2026-09-01 while the schema file already said v27.17. Bridged here rather than renumbered: the versions are real and shipped. Columns + landmines live in `prisma/schema.prisma`'s `mrn` / `mrn_lines` / `mrn_line_batches` headers. ✅ **The MRN module now has a canonical file — `docs/CLAUDE_MRN.md` (v1.0, 2026-09-01) — and it, not the 2026-08-20 design draft, is the authority.** That draft predates two days of change and is a historical record only. No §7 block is owed here: MRN's tables are documented in their own file. → **v27.18** (2026-09-01): new standalone `admin_audit_log` table — 9 columns, the WHO-changed-WHAT trail for admin writes that record no actor on the row itself. `id` **BigInt** (live BIGSERIAL, matching the `tint_skip_events`/`tint_pause_events` precedent), ONE FK `userId`→users (single FK, so the relation is deliberately UNNAMED — contrast the PickFinding*/Mrn* clusters in §7.3), `createdAt` Timestamptz(6). Three hand-named indexes, all modelled with an explicit `map:` because the live names are not what Prisma would generate: `admin_audit_log_created_idx` (createdAt DESC), `admin_audit_log_entity_idx` (entity, entityId), `admin_audit_log_user_idx` (userId). Written by exactly one caller, `lib/audit/log.ts`, which only ever INSERTs — append-only by convention, not by constraint. Wired at mint to 3 of the unattributed write paths (`admin/permissions` POST, `admin/users` POST, `admin/users/[id]` PATCH) — **that was the count on 2026-09-01 and it is history, not the current state: 43 routes are wired as of 2026-09-04.** Live coverage, and which routes are excluded or deferred and why, are in §7.13's coverage block; §13 carries the deferral. §7.13. → **v27.19** (2026-09-01, MRN photos + the OTR close — `CLAUDE_MRN.md §3-§4`): `mrn.closedAt` Timestamptz(6) + `closedById` Int? FK→users `@relation("MrnClosedBy")` — the FIFTH named relation from `mrn` to `users`, ON DELETE SET NULL like its three siblings and deliberately NOT the RESTRICT `createdById` carries; `chk_mrn_status` widened to a FOURTH value `closed`; new standalone `mrn_photos` table — 10 columns, FKs to `mrn` (CASCADE), `mrn_lines` (CASCADE) and `users` (RESTRICT, `@relation("MrnPhotoCapturedBy")`), `storagePath` UNIQUE, two live CHECKs Prisma cannot see (`chk_mrn_photo_kind`, `chk_mrn_photo_lr_truck_level`). Objects live in a PRIVATE Supabase bucket `mrn-photos` created by hand — not by SQL, and deliberately NOT a prefix inside `attendance-photos`, whose purge cron would reach them. → **v27.20** (2026-09-01, the delivery split — `CLAUDE_MRN.md §5`): `mrn_lines.deliveryNo` text NOT NULL — one STI can carry several delivery numbers, so the number moved off the header onto the LINES; the unique index moved with it, `(mrnId, lineNo)` → `(mrnId, deliveryNo, lineNo)`, plus `mrn_lines_mrnId_deliveryNo_idx`. ⚠ The column still carries a TEMPORARY `DEFAULT ''` — scaffolding so it could be added NOT NULL to a populated table, dropped by the still-commented Part 4 of `docs/prompts/drafts/sql-2026-09-01-mrn-delivery-split.sql`. `mrn.deliveryNo` is KEPT but FROZEN: no writer since 2026-09-01, real history for the MRNs raised before it. `mrn.otrNo` likewise has exactly one writer now, `POST /api/mrn/[mrnId]/close`. ⚠ **Both of these were recorded in the chain ON THE DAY, which the v27.16/17 entry above exists to explain was not done last time.** → **v27.21** (CI module — Goods Return Note, **2026-08-31**, three tables live in one SQL pass by `sql/2026-08-31-ci-module.sql`; `ci_returns.source` + its CHECK followed on 2026-09-01 with the auto-CI, `618f67fc`): new standalone `ci_reason_master` (7 cols, `code` UNIQUE, 8 seeded rows — DATA not code, the depot relabels a reason without a deploy), `ci_returns` (**32 cols** — 31 until `source`; the `schema.prisma` header said 31 until it was corrected 2026-09-03) and `ci_return_lines` (12 cols, `UNIQUE(ciReturnId, lineNumber)`, and `rawLineItemId` is a plain nullable Int **pointer, NOT an FK** — contrast `pick_findings`, which does carry a UNIQUE FK to that table). `ci_returns` carries **FIVE named relations**: three to `users` (`CiReturnSupervisor` / `CiReturnBillingOperator` / `CiReturnVoidedBy` — all three explicitly named on both sides, or Prisma errors at generate time, §7.3's rule), plus `CiReturnOrder` → `orders` (ON DELETE Restrict) and `CiReturnCustomer` → `delivery_point_master` (SET NULL; named on one FK only, deliberately, to match the name the other side carries). **FIVE live CHECK constraints, none expressible in Prisma** (§7.4) and all on `ci_returns`: `chk_ci_returns_status` (draft|submitted|closed|returned_to_floor — the fourth is allowed from day one and written by nothing), `_return_type` (full|part), `_material_moved` (moved|not_moved), `_source` (manual|auto_finding), and the load-bearing `chk_ci_returns_complete_when_not_draft`, which is what makes four NULLABLE columns safe: a draft may carry NULL, anything that is not a draft may not. Six indexes on `ci_returns` (pkey, `ciNumber` UNIQUE, + `invoiceNo` / `obdNumber` / `orderId` / `status` / `materialReceivedDate`); **`orders_invoiceNo_idx` was added in the same 2026-08-31 pass** and had also never been recorded here — half of every CI search was a sequential scan before it. ⚠ **MINTED LATE, ON 2026-09-03, AND THIS ENTRY IS A RECORD RATHER THAN A PATCH.** The tables went live on 2026-08-31 — *before* v27.19 and v27.20 — and were never entered in this chain at all: a `grep ci_returns` over this file returned zero hits for three days while the module shipped nineteen commits and reached production. **This is the SECOND time**, the first being v27.16/17 (MRN), which the entry two steps above exists to explain. The pattern is the same both times: a module builds fast, the tables land in one SQL pass, and the chain — which nothing enforces and no build step checks — is the one artefact nobody circles back to. Recording it silently would have taught nothing. ✅ **No §7 block is owed**, exactly as v27.20 ruled for MRN: the columns, their nullability and the reasoning all live in `prisma/schema.prisma`'s three model headers and in **`docs/CLAUDE_CI.md` (v1.0, 2026-09-03), which is the authority** — not the 2026-08-31 design draft, which predates three days of change and is wrong in at least one countable way (it describes nine API routes; there are twelve). → **v27.22** (per-user access, 2026-09-04: new standalone `user_page_access` — 10 columns, one row per (user, pageKey), `UNIQUE(userId, pageKey)` as the ON CONFLICT target for the save route plus a `pageKey` index for the reverse "who can reach Floor?" lookup. ONE FK to `users` (CASCADE), so the relation is deliberately UNNAMED. Filled by `sql/2026-09-04-user-page-access.sql` with **1,053 rows = 39 users × 27 ALL_PAGE_KEYS**, reproducing `getAllPermissionsForRoles()` exactly — admin short-circuit, OR-merge across `user_roles`, and `lib/auth.ts:208`'s rule that any `user_roles` rows REPLACE the primary rather than adding to it — then parity-checked against the live role system at **0 diffs**, which is why the cutover changed nobody's access. §7.14) → **v27.23** (superuser, 2026-09-04: `users.isSuperuser` Boolean NOT NULL DEFAULT false — the `admin` JOB TITLE becomes a flag on the person, checked by 68 gates as **flag OR role**, never the flag alone. Live: 1 of 39 users. Rides the JWT as an OPTIONAL claim, re-read on the existing 5-minute attendance stale window, so a grant or revoke lands without a sign-out. §7.15, and the two-arm rule in §13.)

### 7.1 Setup / Master

```
status_master              UNIFIED. Domains: dispatch|tinting|pick_list|import|workflow|priority
system_config              Key-value
role_master                Roles — ids 1-7 + 12-16, 12 rows live (see §5; SELECT 2026-08-04)
role_permissions           (roleSlug, pageKey, canView, canImport, canExport, canEdit, canDelete)
user_roles                 Multi-role assignment (§5)
users                      Depot staff. bcryptjs 10 rounds. roleId FK. phone TEXT (nullable, 10-digit).
                           Attendance columns: attendanceConsentAt, attendanceConsentVersion,
                           attendanceExempt, attendanceTestUser.

product_category, product_name, base_colour, sku_master
                           ⚠ ALL FOUR DEAD to operations, pending drop — see §7.1.c
sku_master_v2              THE live operational SKU catalog (v27.11). FLAT, keyed by `material`.
transporter_master, vehicle_master
delivery_type_master       Local | Upcountry | IGT | Cross
slot_master                Slots 1-5
delivery_type_slot_config  UNUSED
route_master, area_master, area_route_map, sub_area_master
sales_officer_master, sales_officer_group
contact_role_master
customer_type_master, premises_type_master
delivery_point_master      Ship-to. primaryRouteId, salesOfficerGroupId
                           (now classification-tag only, no longer drives SO),
                           customerRating (A/B/C). salesOfficerId DEPRECATED — still read by
                           CSV importer until Phase 8 migration, write-ignored from admin UI.
                           **CORRECTED 2026-07-16: no `deliveryTypeOverride` column exists.**
                           Real columns are two separate FKs → `delivery_type_master.id`:
                           `dispatchDeliveryTypeId` Int? and `reportingDeliveryTypeId` Int?.
delivery_point_contacts    contactRoleId FK, isPrimary BOOLEAN.
                           linkedSalesOfficerId Int? FK → sales_officer_master ON DELETE SET NULL.
                           NULL for manual contacts; set for auto-managed SO contacts. v27.5.

customer_sales_officers    v27.5. NEW. Multi-SO per customer.
                           id, customerId (FK → delivery_point_master CASCADE),
                           salesOfficerId (FK → sales_officer_master RESTRICT),
                           role (enum CustomerSalesOfficerRole: PRIMARY|BACKUP|JUNIOR),
                           contactDismissed BOOLEAN DEFAULT false,
                           createdAt, updatedAt.
                           UNIQUE (customerId, salesOfficerId).
                           Partial UNIQUE INDEX on customerId WHERE role = 'PRIMARY'.
                           Indexes: salesOfficerId, (customerId, role).
```

### 7.1.b Enums

```
CustomerSalesOfficerRole   PRIMARY | BACKUP | JUNIOR
PackCode                   17 values: ml_500 | L_0_9 | L_0_925 | L_1 | L_3_6 | L_3_7 | L_4 | L_9 |
                           L_9_25 | L_10 | L_15 | L_18 | L_18_5 | L_20 | L_22 | L_30 | L_40
TinterType                 TINTER | ACOTONE
StatusDomain               dispatch | tinting | pick_list | import | workflow | priority (status_master.domain)
SlotRuleType               time_based | default
```

Five app enums total — pg_enum verified 2026-08-04 (value counts 3/17/2/6/2 match schema.prisma exactly).

### 7.1.c SKU catalog — THREE tables, keep them straight [v27.11, 2026-07-19]

The single most confused area in this app. **Three different SKU-ish tables exist and they are not
versions of each other.** Read this before touching anything with "sku" in its name.

| # | Table | Whose engine | Status |
|---|---|---|---|
| 1 | `mo_sku_lookup` (v1) + the keyword tables | The **EMAIL PARSER** — normal typed customer emails | **OUT OF SCOPE. Never touched. Stays.** |
| 2 | `mo_sku_lookup_v2` | **Order entry** — `/po`, `/place-order` + the app-email fast lane | Live, unchanged |
| 3 | **`sku_master_v2`** | **Operations** — the live operational catalog | **[LIVE]** since 2026-07-19 |
| — | `sku_master` (OLD, normalised) + `product_category` + `product_name` + `base_colour` | formerly operations | **DEAD to operations. Pending drop.** |

> ⚠ **Naming trap:** the owner sometimes calls the OLD `sku_master` "version one". That is **NOT**
> `mo_sku_lookup` (v1). Table 1 belongs to the email parser and is not part of this story at all.
> Confirm which table is meant before acting on the phrase.

**`sku_master_v2` — 19 columns** (`prisma/schema.prisma`, no `@map`/`@@map` anywhere; was 17 at v27.11 — `displayCategory`/`displayName` added later, see below):

```
id               Int       PK autoincrement (surrogate — the machine pointer)
material         String    @unique   ← THE NATURAL KEY (SAP material code)
description      String              (serves old sku_master.skuName)
category         String              (family: WS / GLOSS / TOOLS … — replaces product_category FK)
displayCategory  String?             deferred friendly-name override — EMPTY, no readers yet
displayName      String?             deferred friendly-name override — EMPTY, no readers yet
product          String              (SAP-clean name — replaces product_name FK)
baseColour       String              ('' when none, never NULL — replaces base_colour FK)
packCode         String              TEXT, not the PackCode enum ("1", "500", "12")
unit             String?             "L" | "ML" | "KG" | "GM" | "PC"
refMaterial      String?
refDescription   String?
paintType        String?
materialType     String?
piecesPerCarton  Int?                (serves old sku_master.unitsPerCarton)
isPrimary        Boolean  @default(true)   duplicate-twin flag
isActive         Boolean  @default(true)   NEW — lifecycle/discontinued flag
createdAt        DateTime @default(now()) @db.Timestamptz(6)
updatedAt        DateTime?              @db.Timestamptz(6)
```

- **Zero Prisma relations.** Deliberately flat — no FKs, no helper tables. The catalog is maintained
  by a single admin via SQL/CSV, so form-dropdown FKs bought nothing and added friction.
- **`isPrimary` vs `isActive` answer DIFFERENT questions — do not conflate.** `isPrimary=false` =
  "another row is the one to show for this product" (duplicate twin). `isActive=false` =
  "discontinued, no longer sellable". The 25 retired TOOLS `645xxxx` codes are the known case where
  live v2 data had conflated them (they were switched off via `isPrimary` only, because v2 had no
  lifecycle flag); they now carry `isActive=false` with `isPrimary` left as-is.
- **`updatedAt` has NO `@updatedAt` directive** — hand-maintained by SQL, not auto-stamped. Keep it
  manual.
- **`containerType` was NOT carried forward** from old `sku_master` — it had no operational reader,
  only the retiring admin CRUD form.
- **The friendly-name columns NOW EXIST but are inert** (corrected 2026-08-04 — this bullet used to say
  "`skuDisplayName` deliberately does NOT exist yet"): `displayCategory` + `displayName` were added for
  the deferred Picking-card friendly-name feature (SELECT-verified live 2026-08-04, both empty, read by
  no code). The FEATURE is still deferred — see `docs/ROADMAP.md` / `CLAUDE_PICKING.md`. Do not wire
  readers speculatively.

**`material` (the SAP code) is the natural key for every repoint — never an internal row id.** It is
identical across both tables, never null on a raw line (`import_raw_line_items.skuCodeRaw`), and is
the ONLY safe join. This is the spine of the whole migration; see the id-space landmine in §13.

**Live readers of `sku_master_v2`** (all resolve by `material`, all keep a raw-text fallback):

| Reader | File |
|---|---|
| Import — recognition gates (preview + confirm, both paths) | `app/api/import/obd/route.ts` |
| Picking detail screen | `app/api/picking/order/[orderId]/route.ts` |
| Order-detail panel (shared by **Tint Manager + Floor**) | `app/api/orders/[id]/detail/route.ts` |
| Removed-lines view | `app/api/orders/[id]/removed-lines/route.ts` |
| Admin dashboard count tile (`isActive` count) | `app/(admin)/admin/page.tsx` |

**The ONLY live readers of old `sku_master`** are the admin SKU-edit CRUD pages — `/api/admin/skus/*`
plus the three `skus/page.tsx` browse pages (admin, tint-manager, dispatcher — the Support one was
archived 2026-07-27). They read
their own table and never the bookmark; they retire **with** the table. Confirmed non-readers of the
catalog entirely (they read the raw imported line, `skuDescriptionRaw`): Tint Manager, Tint Operator,
Delivery Challan, Sampling Library, Warehouse, Trip Report.

**Coverage reality — set expectations before quoting a number.** Against distinct ACTIVE raw SAP
import codes (~1,152): old `sku_master` ~57%, `sku_master_v2` ~73%, **~309 codes (~27%) in NEITHER**
→ raw-text fallback. The often-quoted **"~99%" figure is WRONG for this population** — it belongs to
Table C's coverage of app-format **email** lines (`CLAUDE_MAIL_ORDERS.md §4.1`). The 309-code cleanup
is a ROADMAP item.

**Still open (future "retire old table" session):** drop old `sku_master` + its 3 FK helpers, drop the
`skuId` column + relation, retire the admin CRUD surface, rename `sku_master_v2` → `sku_master`. Read
every §13 landmine below before starting it.

### 7.2 Import (full detail → `CLAUDE_IMPORT.md`)

```
import_batches             One per import session
import_raw_summary         One per OBD. smuNumber, soNumber, obdEmailDate, obdEmailTime
import_raw_line_items      Per line. lineId, skuCodeRaw, batchCode, netWeight, totalWeight
                           lineStatus 'active'|'removed_by_import', removedAt, removedReason
import_enriched_line_items Per raw line. skuId Int? — ⚠ VESTIGIAL: written null since 2026-07-19,
                           read by nothing live. Catalog now resolved by `material`, NOT this FK.
                           lineWeight is a "recognised?" flag (0/null), NOT a mass. See §13.
import_obd_query_summary   Per-OBD totals
import_shadow_log          INSERT-ONLY shadow log
```

### 7.3 Orders + Tinting

```
orders                     workflowStage, slotId, originalSlotId, dispatchSlotDeadline,
                           orderDateTime, smu, customerMissing, isPicked, pickedAt, pickedById,
                           soNumber, remarks, shipToOverride, slotToOverride, sequenceOrder,
                           orderType.

                           SOFT-DELETE columns (v27.3):
                           isRemoved BOOLEAN DEFAULT false NOT NULL
                           removalReason TEXT (CUSTOMER_CANCELLED | WRONG_ORDER)
                           removalRemark TEXT (mandatory free text)
                           removedAt TIMESTAMPTZ, removedById, restoredAt, restoredById

                           HIDE columns (v27.6 — manual one-off hide, §7.10):
                           isHidden BOOLEAN DEFAULT false (indexed), hiddenById,
                           hiddenReason TEXT, hiddenAt TIMESTAMPTZ

                           GATEKEEPER column (v27.7 — built for the since-retired Support board):
                           mailMatched Boolean NOT NULL DEFAULT false — true when enrichment
                           matched a mail order. ⚠ WRITE-ONLY since 2026-07-27: its only UI
                           consumer (the Support table's envelope icon) was archived with the
                           board; a repo sweep 2026-08-04 finds ONE reference — the enrichment
                           write (app/api/import/obd/route.ts:249) — and no reader. Kept: it is
                           still the only record of "this OBD arrived via mail", and
                           orderDateTime cannot proxy for it (it is NEVER null).

                           HOLD + DISPATCH-TARGET columns (v27.7 — Support module, 06-27 session):
                           heldAt TIMESTAMPTZ? — hold footprint anchor; set to obdEmailDate (NOT wall-clock)
                           dispatchTargetDate DATE? — chosen dispatch day (date-only; window carries the time)
                           dispatchWindowId INT? FK → dispatch_slot_master.id
                           arrivalSlotId INT? FK → slot_master.id — arrival-day slot; used for history grouping
                           (dispatchWindow is a Prisma relation on dispatchWindowId, not an extra column)

                           DISPATCH-ENGINE columns (documentation backfill 2026-07-24 — pre-existing, NOT a
                           migration; present in schema.prisma, landed with the dispatch-engine build,
                           version not recorded — no version-history entry cites them):
                           dispatchSlotSource String? — WHO set the slot: 'auto' (the engine) | 'manual'
                             (a human). The engine SKIPS any order already 'manual' — the guard that stops
                             it overwriting a person's decision (§7.4).
                           dispatchSlotRuleId String? — which engine rule produced the slot (e.g.
                             R1_LOCAL_1230). Engine + rule ids owned by §7.4.

                           SHIP-TO OVERRIDE column (v27.9 — 2026-07-07 session; written today by
                           Floor, CLAUDE_FLOOR.md §4.4):
                           shipToOverrideCustomerId INT? FK → delivery_point_master.id
                           relation `shipToOverrideCustomer`, @relation("OrderShipToOverride")
                           ⚠ DUAL-RELATION TRAP: `orders` already relates to delivery_point_master via
                           `customer` / @relation("OrderCustomer") (customerId). Both relations MUST stay
                           explicitly named on all sides (model + back-relation on delivery_point_master) —
                           an unnamed relation here is a Prisma ambiguity error, not a warning.
                           The legacy boolean `shipToOverride` flag is retained and kept in sync
                           (true when an id is set, false when cleared) — a flag can still be true
                           with the id null (free-text redirects with no resolved customer).

                           PICKING EARLY-RELEASE columns (2026-07-20, v27.13 — §7):
                           pickEarlyReleasedAt TIMESTAMPTZ?, pickEarlyReleasedById INT? FK → users
                           relation @relation("OrderPickEarlyReleasedBy"). Timestamp+actor, NOT a
                           stage value — behaviour: CLAUDE_PICKING.md.

                           BILLING MARK-DONE columns (2026-07-30, v27.13 — §7):
                           invoicedAt TIMESTAMPTZ?, invoicedById INT? FK → users
                           relation @relation("OrderInvoicedBy") — the billing operator's "marked
                           invoiced" decision, distinct from SAP's invoiceNo/invoiceDate facts.
                           Clearing invoicedAt is the Undo. Backed by partial index
                           orders_billing_pending_idx (v27.13 — §7). Behaviour docs land with the
                           MAIL_ORDERS reconciliation session.
                           ⚠ Every FK to users on this table MUST carry a named @relation on both
                           sides — FIVE exist now (OrderPickedBy / OrderRemovedBy / OrderRestoredBy /
                           OrderPickEarlyReleasedBy / OrderInvoicedBy; hiddenById is a bare Int with
                           no relation) — an unnamed one is a Prisma ambiguity ERROR.

order_splits               Per tint batch/split
split_line_items           Per line
split_status_logs          INSERT-ONLY audit

tint_assignments           Per whole-OBD tint assignment.
                           operatorSequence UNUSED — sort by sequenceOrder.
                           v27.3 columns: skippedAt, skipEventId (FK BIGINT);
                                          pauseCount INT, lastPausedAt, currentProgress JSONB,
                                          accumulatedMinutes INT (canonical "total tinting time"
                                          on done — pause route increments per pause; done route
                                          folds final delta).
                           Status enum: assigned | tinting_in_progress | paused | skipped | done.

tint_skip_events           v27.3. id BIGSERIAL. orderId, assignmentId (FK),
                           skippedById, skippedAt, reason TEXT,
                           tinterType TEXT?, outOfStockColours TEXT[],
                           remark TEXT?, createdAt.

tint_pause_events          v27.3. id BIGSERIAL. orderId, assignmentId,
                           pausedById, pausedAt, pauseReason TEXT,
                           progressAtPause JSONB, elapsedMinutesAtPause INT,
                           pauseRemark TEXT?, resumedAt, resumedById, resumeRemark.

tint_logs, order_status_logs   INSERT-ONLY. order_status_logs gets OBD_REMOVED,
                               OPERATOR_SKIP, OPERATOR_PAUSE, OPERATOR_RESUME events.
tinter_issue_entries       Per base batch TI entry.
                           v27.4: samplingNo TEXT?, shadeName TEXT? — wires TI to sampling library.
tinter_issue_entries_b     Bucket-level TI entries.
                           v27.4: samplingNo TEXT?, shadeName TEXT?.
shade_master               DEPRECATED. Sampling Library is the live source of truth for new
                           shades. Table still exists with historical data; scheduled for
                           deletion after a retention window. Do not write to it.
manual_tint_entries        Manual override: orderId FK, lineIds JSON, reason, createdBy, createdAt.
```

### 7.4 Dispatch + Warehouse

```
dispatch_plans             UNIQUE (planDate, slotId, vehicleId, tripNumber)
dispatch_plan_orders       Order-level. clearedAt TIMESTAMPTZ.
pick_assignments           Picker assignments. orderId FK unique per active.
                           CHECKED columns (v27.10 — Picking Stage 2, 2026-07-17/18 sessions):
                           checkedAt DateTime? @map("checked_at"); checkedById Int?
                           @map("checked_by_id"), relation checkedBy /
                           @relation("PickAssignmentCheckedBy") — THIRD named relation to
                           `users` on this table, alongside picker/PickAssignmentPicker and
                           assignedBy/PickAssignmentAssignedBy. All three are correctly named
                           on both sides today (users model: pickAssignmentsAsPicker /
                           pickAssignmentsAssigned / pickAssignmentsChecked) — no Prisma
                           ambiguity. Any FUTURE 4th relation to `users` on this table must
                           follow the same explicit-naming discipline (§7.3's dual-relation-
                           trap pattern, same underlying rule).
                           HIDDEN CONSTRAINT: the live DB has `CHECK chk_pick_assignments_status`
                           restricting `status` to exactly `'assigned'` / `'picked'` —
                           invisible in this schema (no `@db` annotation surfaces Postgres
                           CHECK constraints; same pattern as `users.phone`'s CHECK, §5). A
                           third status string needs a SQL ALTER on this constraint FIRST
                           (Supabase SQL Editor, §3) — never just add a new value in
                           application code. This is exactly why Checked/Approved was modeled
                           as new `checkedAt`/`checkedById` columns instead of a third status
                           value — `CLAUDE_PICKING.md §6/§7`.
                           This table uses `@map` snake_case on every column (order_id,
                           picker_id, assigned_at, assigned_by_id, picked_at, checked_at,
                           checked_by_id) — predates and is EXEMPT from the camelCase-no-`@map`
                           rule (§3); an older table from the Phase 4 pick-list build.

pick_findings              v27.14 (2026-08-07). NEW. What the floor ACTUALLY found on a
                           checked line — the Stage-3 "qty short / old stock" record
                           (`CLAUDE_PICKING.md §7`'s deferred item). Created by hand in the
                           Supabase SQL Editor, hand-mirrored into schema.prisma; columns
                           re-verified against information_schema before the model was written.
                           id SERIAL PK; orderId INT NOT NULL FK → orders.id;
                           rawLineItemId INT NOT NULL **UNIQUE** FK → import_raw_line_items.id
                           (one finding per raw line ⇒ one-to-one from the line's side);
                           obdNumber TEXT NOT NULL; lineId TEXT?; skuCodeRaw TEXT?;
                           qtyOrdered INT NOT NULL; qtyFound INT NOT NULL; reason TEXT NOT NULL;
                           remarks TEXT?; mfgMonth INT?; mfgYear INT?;
                           reportedById INT? FK → users; reportedAt TIMESTAMPTZ?;
                           recordedById INT? FK → users; recordedAt TIMESTAMPTZ?;
                           createdAt TIMESTAMPTZ NOT NULL DEFAULT now().
                           camelCase, NO `@map` — unlike its neighbour pick_assignments above,
                           which is snake_case-mapped because it predates that rule. Do not
                           harmonise the two.
                           ⚠ TWO named relations to `users` — reportedBy /
                           @relation("PickFindingReportedBy") and recordedBy /
                           @relation("PickFindingRecordedBy"), with back-relations
                           pickFindingsReported / pickFindingsRecorded on the users model.
                           BOTH must stay explicitly named on both sides or Prisma throws an
                           ambiguity ERROR at generate time (§7.3's dual-relation trap; the same
                           discipline pick_assignments' three users relations follow).
                           ⚠ obdNumber / lineId / skuCodeRaw are DENORMALISED COPIES on purpose
                           — a finding is a record of what a human observed and must still read
                           correctly if its line is later soft-removed by a re-import. `lineId`
                           here is TEXT and nullable, NOT the Int import_raw_line_items carries:
                           a display copy, not a join key. Do not drop them as "derivable".
                           WHY THE FK IS SAFE: a re-import PATCHES a matched line in place and
                           SOFT-removes an absent one (lineStatus='removed_by_import',
                           `lib/import-upsert/lines.ts`); there is no hard delete of that table
                           anywhere in the repo, and four other tables already FK the same id.
                           NOT EXPRESSIBLE IN PRISMA — live only, recorded by hand:
                             chk_pick_findings_reason CHECK (reason IN ('short_quantity','old_mfg'))
                               — same class as chk_pick_assignments_status above: a THIRD reason
                               needs a SQL ALTER FIRST, never just a new literal in app code.
                             pick_findings_confirmed_idx ON ("recordedById")
                               WHERE "recordedById" IS NOT NULL — partial, same class as
                               orders_billing_pending_idx (§7). Do NOT model it as @@index.
                             chk_pick_findings_mfg_month CHECK
                               (mfgMonth IS NULL OR mfgMonth BETWEEN 1 AND 12) — v27.15.
                           v27.15 (2026-08-08): mfgMonth / mfgYear INT? added — the OLD MFG half
                           of `reason`. 🔴 REASON-DEPENDENT, AND THE DB DOES NOT ENFORCE THAT:
                           the CHECK above constrains the month's RANGE only, and nothing at DB
                           level ties either column to `reason`. Both are REQUIRED when
                           reason='old_mfg' and FORCED TO NULL when reason='short_quantity' —
                           that rule lives in BOTH write routes
                           (app/api/picking/findings/report|confirm), written unconditionally on
                           every save so a stale date cannot outlive a reason change. Deliberately
                           NO year constraint: "a reasonable year" is a UI judgement that ages,
                           not an invariant. A short_quantity row carrying a non-null mfgMonth is
                           a BUG in a write path, not a permitted state.
                           pick_findings_order_idx ON ("orderId") IS modelled — as
                           `@@index([orderId], map: "pick_findings_order_idx")`; the `map:` is
                           required because Prisma would otherwise name it ..._orderId_idx.
                           LIVE SURFACES (was "no UI reads or writes this table yet", true only
                           on 2026-08-07): the picker records via POST .../findings/report, the
                           supervisor confirms via .../findings/confirm, both picking boards
                           render the row, and Billing reads CONFIRMED rows only
                           (recordedById IS NOT NULL) for its Picking-list flag + detail panel.

pick_lists, pick_list_items   ⚠ BOTH EMPTY — 0 rows live (SELECT 2026-08-07) against 680 in
                           pick_assignments. Legacy Phase 4; their qtyRequired/qtyPicked are NOT
                           the shortage store — pick_findings above is.
dispatch_change_queue

dispatch_slot_master       v27.7. Dispatch TIME windows — DISTINCT from arrival slots in slot_master.
                           id INT PK, windowTime TEXT (e.g. "10:30"), label TEXT?,
                           sortOrder INT, isActive BOOL, createdAt TIMESTAMPTZ, updatedAt TIMESTAMPTZ.
                           Seeded 4 windows: 10:30 / 12:30 / 16:00 / 18:00.
                           FK target for orders.dispatchWindowId. Drives the LIVE dispatch engine
                           (auto-slot-assignment) below.
```

**Dispatch engine — auto-slot at enrichment [LIVE].** CORE owns this; `CLAUDE_FLOOR.md §6` points
here rather than re-describing it.

- **Status [LIVE].** `evaluateDispatchSlot()` (`lib/dispatch/dispatch-engine.ts`) is imported
  (`app/api/import/obd/route.ts:22`) and wired into `applyMailOrderEnrichment` — it auto-assigns a
  dispatch **date + window** at enrichment, per-`soNumber` (never a full-table scan). Pure function,
  no I/O, no `Date.now()` — every decision derives from its inputs (deterministic, backfill-safe).
- **The anchor clock — `pickEffectiveClock` (added to canon 2026-08-05):** given the email clock
  (`orderDateTime`) and the punch clock (`obdEmailDate`), same IST calendar date → the EARLIER of
  the two; different date → the LATER; one null → the other outright; both null → decline
  (`no-order-datetime` — the bill reaches the operator unslotted, deliberately).
- **Input guard — `resolveArrivalClocks` (2026-08-02/03, in FRONT of the engine):** a date-only
  value (exactly 00:00:00.000 UTC — the manual-SAP no-time-column artifact) is not a clock and is
  passed as null; a later-day date-only value forces a decline rather than a back-date. Single
  owner `lib/dispatch/punch-clock.ts` — full contract **`CLAUDE_IMPORT.md §12.1b`**; its second
  consumer is Floor's rail suggestion (**`CLAUDE_FLOOR.md §8`**), so the hint and the written slot
  can never disagree about which clocks exist.
- **What it writes** (`route.ts:368-376`): `dispatchTargetDate`, `dispatchWindowId`,
  `dispatchSlotSource='auto'`, `dispatchSlotRuleId` (§7.3).
- **Manual-skip guard** (`route.ts:344`): it SKIPS any order already `dispatchSlotSource='manual'` —
  a human's chosen slot is never overwritten (this is why Floor writes `'manual'` on its
  Release/change-slot paths).
- **Scope — deliberately narrow.** Fires only for `smu='Deco Retail'` and `dispatchStatus='dispatch'`,
  delivery type Local or Upcountry. Decorative Projects / Retail Offtake / Distributor / IGT never
  auto-slot — they reach the operator to decide. Reviewed and approved, not an oversight.
- **The window rule (6 rules).** Local: arrive ≤10:30 → today 10:30 · ≤12:30 → 12:30 · ≤16:00 →
  16:00 · after 16:00 → next working day 10:30. Upcountry: ≤17:00 → today 18:00 · after 17:00 →
  next working day 18:00. Rule ids `R1_LOCAL_1030 / _1230 / _1600 / _NEXT_1030`, `R1_UPC_1800 /
  _NEXT_1800` (stored in `dispatchSlotRuleId`).
- **The Sunday rule.** "Next working day" skips **Sunday only** (depot closed; Saturday is a working
  day; holidays not modelled), via `nextWorkingDateOnlyUTC()`. It previously rolled a late bill to the
  next **calendar** day, so a Saturday-evening Local/Upcountry bill was scheduled into Sunday —
  **FIXED in the Floor Control build** (→ `CLAUDE_FLOOR.md §6`). This was a live enrichment bug,
  independent of Floor.
- **Live evidence (SELECT 2026-07-24).** Of **1,051** orders at `workflowStage='dispatched'`, **662**
  carry `dispatchSlotSource='auto'` — the engine does the majority of slotting, not a trial.
- **Live recount (SELECT 2026-07-27): 1,546 at `dispatched`** — roughly **500 rows moved in three days**,
  by a route **not currently understood**. Nothing in this codebase automatically drains
  `pick_checked → dispatched`; that hole and its history are owned by `docs/ROADMAP.md` (P1) and
  `CLAUDE_PICKING.md §7` — not restated here (**repointed 2026-07-30: this said `§9`, which is the
  retired-desktop-board section; the drain hole moved to §7 on 2026-07-28 and CORE was the only file
  still carrying the old pointer**). **Not investigated** on 2026-07-27; flagged only. The
  2026-07-24 line above stays as the dated snapshot it was.
- **Parked (not the engine's fault):** the `Deco` (9 rows) un-mapped SMU never matches `Deco Retail`
  so never auto-slots; and 103 Deco Retail bills reached `pending_support` with `dispatchStatus` NULL
  (the engine fires only on `='dispatch'`) — an upstream diagnosis, `CLAUDE_FLOOR.md §10`.

### 7.5 Delivery Challan

```
delivery_challans          One per eligible order (Retail Offtake / Decorative Projects).
                           Number: CHN-{YEAR}-{5-digit seq}.

                           VOID columns (v27.3):
                           isVoided BOOLEAN DEFAULT false NOT NULL
                           voidReason TEXT (mirrors order removal reason)
                           voidRemark TEXT, voidedAt TIMESTAMPTZ

delivery_challan_formulas  Per-line tinting formula. v27.5 adds 3 columns for auto-fill tracking:
                           isManuallyOverridden BOOLEAN NOT NULL DEFAULT false
                             — permanent per-row lock once TM types a value; future TI never overwrites.
                           autoFilledAt TIMESTAMPTZ?
                             — timestamp of last auto-fill write; cleared on manual override.
                           sourceTiEntryId INTEGER?
                             — audit pointer to the TI row id that filled this formula.
                             No FK (cross-table — can be from either TI table).
```

### 7.6 Mail Orders (mo_*)

```
mo_orders                  Per parsed email
                           SHIP-TO OVERRIDE (v27.9): shipToOverrideCustomerId INT? FK →
                           delivery_point_master.id, relation `shipToOverrideCustomer`,
                           @relation("MoOrderShipToOverride") — mo_orders' FIRST relation to
                           delivery_point_master, no dual-relation trap. Legacy boolean
                           `shipToOverride` retained. Full detail: CLAUDE_MAIL_ORDERS.md §6.
                           SLOT INTENT (2026-07-30, v27.13 — §7): dispatchTargetDate
                           @db.Date + dispatchWindowId FK → dispatch_slot_master (live FK name
                           all-lowercase mo_orders_dispatchwindowid_fkey). The operator's slot
                           DECISION, carried at enrichment into orders with
                           dispatchSlotSource='manual' BEFORE the engine loop so the §7.4
                           manual-skip guard honours it. Written together or not at all.
                           As-built record: docs/prompts/drafts/billing-phase-2-build-decisions.md.
mo_order_lines             Per product line. isCarton, cartonCount.
mo_order_remarks           billing|delivery|contact|instruction|cross|customer|area|unknown
mo_line_status             SKU found/not-found tracking
mo_product_keywords        ~1,076 rows
mo_base_keywords           ~267 rows
mo_sku_lookup              ~1,599 rows. material UNIQUE. refMaterial, refDescription.
mo_customer_keywords       Auto-grows on operator picks
mo_learned_customers       Operator correction log with guard rules
```

Full detail in `CLAUDE_MAIL_ORDERS.md`.

### 7.7 Place Order (v2 tables)

```
mo_order_form_index_v2     ~454 active rows (after the full catalog restructure).
                           Columns:
                             family, product, baseColour, displayName, searchTokens,
                             tinterType, productType, sortOrder, isActive,
                             section, subgroup, uiGroup,
                             mobileFamily TEXT? (v27.5) — collapses Promise-family variants for
                                                          mobile labelling; declared but currently
                                                          NOT used as the label (label stays = family).
                             region TEXT? (v27.6) — optional grey-line qualifier (TOOLS 4" brushes:
                                                    Delhi NCR / UP Punjab / South); null on all paint.
                           UNIQUE (family, subProduct, baseColour) — **CORRECTED 2026-07-16**:
                           earlier docs wrongly said `(family, product, baseColour)`. `product` is
                           nullable; `subProduct` is NOT NULL — any duplicate guard must key on
                           `subProduct`, or it silently fails to catch duplicates on null-`product`
                           rows.
                           `product` is the SAP-clean stock name — the JOIN KEY into
                           mo_sku_lookup_v2.product. May be null on rows the seed couldn't resolve;
                           those rows render as "no packs" on the order form.

mo_sku_lookup_v2           ~1,680 rows (after the full catalog restructure). Parallel clean-name version.
                           material UNIQUE.
                           packCode TEXT — **CORRECTED 2026-07-16**: bare numeric string
                             ("1"/"4"/"10"/"20"/"500"/"400"/"12"/"25"...), NOT the `PackCode` enum
                             earlier docs claimed. `unit` is the separate type discriminator.
                           description TEXT NOT NULL — undocumented until 2026-07-16; every
                             insert must supply it, no db default.
                           isPrimary BOOLEAN NOT NULL DEFAULT true (v27.5)
                             — false on confirmed duplicate twins. **BOTH** `/api/order/data`
                               **AND** `/api/place-order/data` filter WHERE isPrimary = true
                               (confirmed live 2026-07-16 against `route.ts:92-93` — desktop was
                               fixed to match mobile in commit `46b500fb`, 2026-07-15). Earlier
                               "desktop unfiltered" claim is retired; do not reintroduce it
                               without re-reading the live route first.
```

Full detail in `CLAUDE_PLACE_ORDER.md`.

### 7.8 Attendance + OT

> Rewritten 2026-08-05 against `information_schema` (re-confirmed same day) — the previous block
> carried three PHANTOM columns (`otCutoffHourIST`, `otRequiresApproval`,
> `otAutoApproveThresholdMinutes` — zero code references either) and wrong names throughout.
> `CLAUDE_ATTENDANCE.md §2` owns the full live column blocks; summary here only.

```
attendance_records         Per CHECK_IN | CHECK_OUT event. `timestamp` (the instant),
                           attendanceDate (IST), sessionId, location* trio, photo fields,
                           isManualEntry/manualReason, boolean flags.
                           OT columns: otClaimed, otClaimReason, otTotalLessThan95,
                           otApprovalStatus, otMinutesCredited (the credited figure),
                           otApprovedById, otApprovedAt, otAdminNote.

attendance_summary         One per (userId, attendanceDate). totalMinutesWorked,
                           overtimeMinutes, lateMinutes, otMinutesCredited, otApprovalState,
                           status (plain String, default 'ABSENT'), hasMissingCheckout,
                           hasGeofenceViolation, hasManualEntries, sessionCount.

attendance_settings        @@unique([scope, roleSlug]) — singleton BY CONVENTION (one GLOBAL
                           row). rolloutStage, dpdpConsentVersion,
                           workStartTime/EndTime, checkInWindowStart/End, lateGraceMinutes,
                           halfDayThresholdMinutes, geofenceLat/Lng/RadiusMeters,
                           requirePhoto/Location, photoRetentionDays/MaxWidthPx/JpegQuality,
                           depotWorkingMinutes (the 9.5h OT denominator — THE auto-approval
                           driver; there is no threshold column), otTriggerTime,
                           otMonthlyGraceLimit, otPromptEnabled.

attendance_ot_grace        Per (userId, yearMonth) — flagCount, the monthly grace counter.
attendance_ot_audit        Per action on an OT record — who/when/from/to/note.
                           (Both were undocumented here until 2026-08-05.)
```

Full detail in `CLAUDE_ATTENDANCE.md §2` (live-verified blocks) + `§16` (the corrected OT rule).

### 7.9 Sampling Library

```
sampling_register          samplingNo TEXT PK. shadeName, tinterType (TINTER|ACOTONE),
                           siteId FK?, siteNameRaw, salesOfficerId, dealerName, notes,
                           isActive, needsReview, createdById, createdAt, updatedAt.
                           Child sampling numbers use #PARENT-N suffix convention
                           (e.g. #134591-1) — see CLAUDE_SAMPLING_LIBRARY.md.

sampling_recipes           id PK. samplingNo FK CASCADE, skuCode, productName,
                           packCode (PackCode enum) — NULLABLE since v27.5 (legacy paper
                             register entries often have no pack recorded).
                           tinQty, 13 TINTER + 14 ACOTONE pigment columns
                           (all Decimal default 0), isPrimary, usageCount,
                           firstUsedAt, lastUsedAt, createdAt, updatedAt.
                           UNIQUE (samplingNo, skuCode, packCode) with NULLS NOT DISTINCT
                             — blocks duplicate null-pack rows on re-import. v27.5.

sampling_usage_log         id PK. samplingNo FK CASCADE, recipeId FK SET NULL,
                           usageDate DATE?, operatorId FK?, operatorNameRaw, tinQty,
                           dealerNameRaw, siteId FK?, siteNameRaw, skuCodeRaw,
                           packCode?, deliveryNumber TEXT? (v27.4), sourceRowIndex,
                           createdAt.
                           Suggestion engine matches by siteId STRICTLY (numeric FK).
                           Writes MUST populate siteId from orders.customerId
                           (= resolved ship-to FK). Fixed 2026-06-01.
```

Full detail in `CLAUDE_SAMPLING_LIBRARY.md`.

### 7.10 Visibility / Hide (v27.6)

Admin "Settings → Hide" feature. SQL: `sql/2026-06-12-hide-feature.sql` (no transaction wrapper). Prisma: scalar fields only, no relations; timestamps `@db.Timestamptz(6)`.

```
obd_visibility_rules       Bulk auto-hide rules. id, ruleName,
                           conditionType ('tag' | 'daysOld'),
                           conditionTag (e.g. 'HOLD'), conditionDaysGt INT,
                           isActive BOOLEAN DEFAULT true (indexed),
                           createdById, createdAt, updatedById, updatedAt.
                           v1 conditions: HOLD + daysOld only (schema is generic).

app_tag_settings           Per-badge on/off. id, tagKey TEXT UNIQUE,
                           isEnabled BOOLEAN DEFAULT true, updatedById, updatedAt.
                           Default-ON (no row = badge shows).

orders                     hide columns (see §7.3): isHidden, hiddenById, hiddenReason, hiddenAt.
```

Hide **audit reuses `order_status_logs`** (toStage `ORDER_HIDDEN` / `ORDER_UNHIDDEN`, note carries reason) — no separate audit table. Helpers `lib/hide/visibility.ts` (`getActiveHideRules`, `getHideExclusion` — NULL-safe, see §13 — `getHiddenWhere`, `matchesRule`), `lib/hide/tag-settings.ts`, `lib/hide/tag-catalog.ts`. Feature spec: `CLAUDE_UI.md §57`; MO tag-gating: `CLAUDE_MAIL_ORDERS.md §21`.

### 7.11 Trip Report (v27.8)

```
trip_report                Standalone Supabase mirror of NTS trip/delivery data — read-only,
                           not connected to the orders/OBD pipeline. sourceId TEXT @id (NTS's
                           own row id — changes per pull, not used for dedup).
                           UNIQUE (deliveryNo, disDate) — trip_report_delivery_no_dis_date_key.
                           Indexes: (disDate), (disDate, tripNo).
```

Full ~38-column list: `CLAUDE_TRIP_REPORT.md §3`. Populated by an external PowerShell puller (outside the repo) via the `mirror_trip_report_today(rows jsonb)` Postgres function — an atomic per-day delete+insert, not a row-level upsert (see `CLAUDE_TRIP_REPORT.md §2` for why). `/trips` access: `CLAUDE_TRIP_REPORT.md §1`; roles: §5 above.

### 7.12 Push notifications + live-sync (v27.12)

Behaviour lives in `CLAUDE_NOTIFICATIONS.md` (push) + `CLAUDE_PICKING.md §10` (live-sync). CORE carries the schema only. Both objects were created by hand in Supabase and hand-mirrored into `prisma/schema.prisma` (db pull cannot run here — §3).

```
push_subscriptions         Web Push device subscriptions — ONE row per device endpoint.
                           camelCase, no @map. 11 columns:
                           id            Int PK autoincrement
                           userId        Int FK → users.id ON DELETE CASCADE
                           endpoint      String UNIQUE — push_subscriptions_endpoint_key
                           p256dh        String
                           auth          String
                           userAgent     String?
                           isActive      Boolean DEFAULT true
                           failureCount  Int     DEFAULT 0
                           lastSeenAt     DateTime? @db.Timestamptz(6)
                           createdAt      DateTime  @default(now()) @db.Timestamptz(6)
                           updatedAt      DateTime  @default(now()) @db.Timestamptz(6)
                           ⚠ updatedAt is a PLAIN @default(now()) — NOT @updatedAt, NO DB
                           trigger. Every write MUST set it explicitly (§13 landmine).

orders — NEW index         orders_updatedAt_idx  =  @@index([updatedAt(sort: Desc)])
                           on orders("updatedAt" DESC). Backs the Picking live-sync
                           change-marker's MAX(updatedAt) probe (CLAUDE_PICKING.md §10).
                           NOTE: orders otherwise has NO secondary indexes beyond its
                           PK + the obdNumber UNIQUE.
```

---

### 7.13 Admin audit trail (v27.18)

WHO changed WHAT, for admin writes that record no actor on the row itself. Created by hand in Supabase (owner, 2026-09-01) and hand-mirrored into `prisma/schema.prisma`; shape SELECT-verified against live before mirroring (db pull cannot run here — §3). Written by exactly ONE caller: `lib/audit/log.ts`.

```
admin_audit_log            Append-only admin action trail. camelCase, no @map. 9 columns:
                           id          BigInt   PK autoincrement  ← live BIGSERIAL
                           userId      Int      FK → users.id (no ON DELETE clause)
                           entity      String   table/domain, e.g. "users"
                           entityId    String?  which row — TEXT, see below
                           action      String   "create" | "update" | "delete" | verb
                           summary     String?  the one line a skimming reader sees
                           beforeData  Json?    state before — SECRETS STRIPPED
                           afterData   Json?    state after  — SECRETS STRIPPED
                           createdAt   DateTime @default(now()) @db.Timestamptz(6)

                           3 indexes, ALL modelled with an explicit map: — the live
                           names are hand-made and are NOT what Prisma generates:
                             admin_audit_log_created_idx  (createdAt DESC)
                             admin_audit_log_entity_idx   (entity, entityId)
                             admin_audit_log_user_idx     (userId)

                           ONE FK to users, so the relation is deliberately UNNAMED
                           (back-relation `adminAuditLogs` on users). Contrast the
                           PickFinding* / Mrn* clusters in §7.3, which have several
                           FKs to users and MUST stay named on BOTH sides.
```

**Four things that will bite:**

- 🔴 **`entityId` is TEXT, not Int.** It has to hold a composite key — `role_permissions` is keyed by `roleSlug`+`pageKey`, not an id — so numeric ids are stringified by the caller. Do not "tidy" it to Int; a whole entity loses its addressability.
- 🔴 **`id` is BigInt, and `JSON.stringify` THROWS on a BigInt** (`Do not know how to serialize a BigInt`). The write path is safe only because it never returns the created row. **Any future read API must convert** (`Number(row.id)` or `.toString()`) before returning rows, or the route 500s on its first result.
- 🔴 **Never a password or a hash in `beforeData`/`afterData`.** Enforced in `lib/audit/log.ts`'s `redact()`, which strips secret-ish keys on EVERY call so a forgetful caller is still safe — Prisma cannot express this. A password reset is recorded as the fact `summary: "password reset"` with nothing in the data fields. A bcrypt hash is not "already safe"; it is offline-crackable and is exactly what an audit table must not accumulate.
- **Append-only by CONVENTION, not by constraint.** Nothing in the schema or the database stops an UPDATE or DELETE. The discipline is that `lib/audit/log.ts` is the only writer and only inserts. Do not add an edit path.

### Coverage — 43 wired, 14 excluded, 13 deferred (2026-09-04)

**Counted from the tree, not from a prior claim.** `grep -rn "logAdminAction({" app/` returns **43 call sites in 43 files** — exactly one per route file, no route logging twice. This block previously said "wired at mint — 3 routes … the other 67 are §13"; both numbers were true on 2026-09-01 and are wrong now.

| Wave | Commit | Routes | What |
|---|---|---|---|
| 1a | `f00808c1` | **3** | `admin/permissions` POST, `admin/users` POST, `admin/users/[id]` PATCH |
| 1b | `e757ba78` + `2207aca4` | **32** | All remaining admin master data: customers, routes, areas, sub-areas, vehicles, system-config, slots, slot-rules, transporters, sales-officers, so-groups, contact-roles, customer-types, premises-types |
| 1c | `c3cf726b` | **8** | Mail Orders ×7 + `admin/hide/rules/[id]` DELETE |
| | | **43** | |

**Excluded on purpose — 14 routes.** The old `sku_master` family (`admin/skus`, `product-categories`, `product-names`, `base-colours` — POST + `[id]` PATCH + `import` POST each = 12), plus `admin/shades/[id]` PATCH and `admin/dispatch-cutoffs/[id]` PATCH. All fourteen sit behind screens already agreed for retirement. Verified present and unwired 2026-09-04. **Do not wire them** — they go with their screens.

**Deferred on purpose — 13 routes.** Sampling Library 3 (`[samplingNo]` PATCH, `/review` POST, `/variants` POST) · MRN 2 (`[mrnId]/header` PATCH, `[mrnId]/lines` PUT) · Tint 5 (`manager/reorder` PATCH, `manager/challans/[orderId]` PATCH, `operator/shades/[id]` PUT, `operator/tinter-issue/[id]` PATCH, `operator/tinter-issue-b/[id]` PATCH) · Billing 1 (`billing/mail-order/actions` POST) · backfill 2 (`admin/fix-challans` POST, `admin/fix-slots` POST). Verified present and unwired 2026-09-04.

🔴 **These 13 are deferred by DECISION, not oversight, and the reason is that wiring them now means editing the same files twice.** Each belongs to a module with its own conversion still ahead of it — the Sampling Library, MRN, Tint and Billing sessions each reopen these exact routes. An audit call added today would be re-read, re-reasoned and possibly re-shaped by that session anyway, so it is folded into the conversion instead. **A later session finding one of these unwired has NOT found a gap to close on its own** — it has found work that belongs to that module's session. If you are already in that module's session, wire it then.

`mail-orders/ingest` POST is left unwired permanently: it is the HMAC machine path, and there is no person to record.

**One arithmetic note on the census.** `code-discovery-2026-08-31-role-census.md §6c` list A says "48 files" and enumerates **49** (counted mechanically, `sort -u`). With `admin/hide/rules/[id]` DELETE — called out in the same section but outside list A's enumeration — the true gap total is **71**, not the 70 the prose states. 43 + 14 + 13 + 1 machine path = 71. The census is right about every route and off by one on its own subtotal; it has not been edited, because a discovery draft is a record of what was found on its date.

| Route | entity | action | Logged |
|---|---|---|---|
| `app/api/admin/permissions/route.ts` POST | `role_permissions` | `update` | Only the role/page pairs whose flags **changed** — the grid re-posts all ~78 rows on every save, so a no-op save writes no line at all |
| `app/api/admin/users/route.ts` POST | `users` | `create` | name, email, roleId. **Never the password** |
| `app/api/admin/users/[id]/route.ts` PATCH | `users` | `update` | Diff of name/email/roleId/isActive. **Password reset → summary only, no data** |

**The conventions the 43 share**, set by the three above and followed by the other 40:

- `entity` is the name **the app** uses, not always the table: `customers` (the table is `delivery_point_master`), `sub_areas`, `so_groups`, `mail_orders`. `entityId` is the row id stringified, or **`null`** for an action with no single subject — a CSV import, a settings save covering several keys, a bulk backfill.
- `action` is `create` | `update` | `delete` | `import` | `backfill`, plus the domain verb `split` for the one route that is neither a create nor an update of the row it names.
- An **update logs only the fields that MOVED**. A form that re-posts everything on every save (the permissions grid, the customer editor, system-config) would otherwise write an unreadable line on every no-op save. Where nothing moved, no row is written at all. The exception is `mail-orders/[id]/lock`, where the click IS the event and is logged unconditionally — a lock toggle has no re-post noise to suppress.
- **A bulk run is ONE row**, never one per record. A 400-line log entry for one button click is noise.
- Where a route performs a **second write the response never mentions** — orphan-order re-parenting on customer create, the area/route remap, a forced slot-rule default demoting its predecessor, a customer change propagating to split siblings — that write is named in the `summary`. It is otherwise invisible.
- The before-image comes from the read the route **already does** (its 404 check, its uniqueness guard). Seven routes had nothing reusable and gained a `SELECT`; each says so in a comment at the call site.

⚠ `admin/permissions` POST still uses `prisma.$transaction`, which §3 forbids. **Left deliberately** and commented as such in the route — it is due to be replaced entirely in a later step of the per-user access work, and unwrapping a 78-row upsert now would change its failure semantics for no lasting benefit.

---

### 7.14 Per-user page access (v27.22)

**The source of every permission in the app since 2026-09-04.** One row per (user, page key), replacing the role→page grid as the thing the resolvers read. Created and filled by `sql/2026-09-04-user-page-access.sql`; hand-mirrored into `prisma/schema.prisma` (db push/pull banned — §3).

```
user_page_access           Per-user page permissions. camelCase, no @map. 10 columns:
                           id          Int      PK autoincrement (live SERIAL)
                           userId      Int      FK → users.id, ON DELETE CASCADE
                           pageKey     String   one of the 27 ALL_PAGE_KEYS values
                           canView     Boolean  NOT NULL DEFAULT false
                           canImport   Boolean  NOT NULL DEFAULT false
                           canExport   Boolean  NOT NULL DEFAULT false
                           canEdit     Boolean  NOT NULL DEFAULT false
                           canDelete   Boolean  NOT NULL DEFAULT false
                           createdAt   DateTime @default(now()) @db.Timestamptz(6)
                           updatedAt   DateTime @default(now()) @updatedAt @db.Timestamptz(6)

                           UNIQUE (userId, pageKey)  user_page_access_user_page_key
                           INDEX  (pageKey)          user_page_access_page_idx

                           ONE FK to users, so the relation is deliberately UNNAMED
                           (back-relation `pageAccess`). Contrast the Mrn*/
                           PickFinding*/CiReturn* clusters in §7.3.
```

**Live count, SELECT-verified 2026-09-04: 1,053 rows = 39 users × 27 page keys.** Every user gets every key, active or not — a deactivated person keeps their ticks so reactivating them restores what they had.

**Four things that will bite:**

- 🔴 **The UNIQUE is load-bearing, not decoration.** It is the `ON CONFLICT` target for the save route's upserts. Dropping it breaks saving, not just uniqueness.
- 🔴 **`updatedAt` carries BOTH `@default(now())` and `@updatedAt`**, unlike `push_subscriptions` (§7.12), whose plain default is recorded there as deliberate. The difference is also deliberate: this table is *edited*, so Prisma must advance the timestamp.
- **There is no `pageKey` FK, on purpose.** The key list lives in TypeScript (`ALL_PAGE_KEYS`), not in a table; a lookup table here would be a second source of truth for it.
- **No index on the five booleans.** Two distinct values each, never selective, and every real query filters on `userId` or `pageKey` first. The UNIQUE's index, with `userId` leading, already serves both hot reads: "every page for this person" and "this person, this page".

**How it was filled, and why that matters more than the table.** The fill reproduced `getAllPermissionsForRoles()` exactly — the admin short-circuit, the OR-merge across every role in `user_roles`, and `lib/auth.ts:208`'s rule that a user with ANY `user_roles` rows gets *exactly those* rows and not their primary. A parity SELECT then compared all 1,053 rows against what the live role system granted: **0 diffs**. That is why flipping the switch (§7.15 / §5) was a no-op for every person.

---

### 7.15 Superuser flag (v27.23)

```
users.isSuperuser          Boolean NOT NULL DEFAULT false
```

"May administer OrbitOMS." Replaces the `admin` **job title** as the thing 68 admin gates check. Live 2026-09-04: **1 of 39 users** — u1, who also still holds the `admin` role.

🔴 **BOTH ARMS, ALWAYS — `isSuperuser === true` OR `roles includes "admin"`.** Implemented once, in `lib/rbac.ts`'s `isSuperuser(session)` / `requireSuperuser(session)`. Never the flag alone. Full reasoning in §13; the short version is that one account holds this, and it is the same account that reaches the `ACCESS_SOURCE` panic switch.

**Session plumbing.** The flag is a claim on the JWT (`auth.config.ts`), set on sign-in and **re-read on the same 5-minute stale window as the attendance claims** (`lib/auth.ts` `fetchUserAttendanceFlags`, which already re-reads the user row, so it costs no extra query). The claim is **optional** on the session type on purpose: a token minted before 2026-09-04 carries none, `undefined` must read as false, and the role arm carries such a session until its next refresh.

**Timing, and the thing to reach for in an emergency:** granting or revoking lands within **~5 minutes** without a sign-out. To cut someone off **NOW**, set `users.isActive = false` — that is checked at sign-in and is not behind the stale window.

---

## 8. Key business rules (cross-cutting)

- **Volume unit:** Always litres. Never cubic metres.
- **Customer types:** Bill To = dealer (always in master). Ship To = site (may be new).
- **Cross billing ≠ ship-to override.** Cross billing is informational; ship-to is different delivery address.
- **Dispatch Hold:** Punch order but don't dispatch. Billing blocks: cannot punch at all.
- **OD/CI detection:** word-boundary regex `\bOD\b`, `\bCI\b`. `.includes()` false-positives on "Plywood".
- **Tinting eligibility:** SMU-gated. Only "Decorative Projects" or "Retail Offtake" get tinted.
- **Stainer vs tinter by pack:** 50/100/200ML = universal stainer. 1L = machine tinter / Acotone.
- **Warehouse zone sort:** putty (deepest) → oil → wood → water → stainer (nearest dispatch). Pack size ASC.
- **Challan eligibility:** SMU = "Retail Offtake" or "Decorative Projects". Auto-created at import.
- **UTC→IST for mail order timestamps:** `AssumeUniversal` + `ConvertTimeFromUtc`. Never `.ToUniversalTime()`.
- **Keyword length sorting is critical** — shorter generic keywords override longer specific ones without DESC sort.
- **Bill To = dealer / Ship To = site** terminology applies on challans and mail orders.
- **Order recipient:** `/po` + `/place-order` send orders to **`surat.depot@akzonobel.com`** (AkzoNobel inbox auto-forwards to `surat.order@outlook.com`, the parser inbox — so the parser `OutlookAccount` config is unchanged). The public `/order` page sent to `surat.order@outlook.com` **directly** until it retired 2026-07-27 — which is why the parser inbox is that address and stays that way. (`CLAUDE_PLACE_ORDER.md §11`.)
- **Mobile external-scheme handoff:** on mobile, a synchronous `history.go()` in the same tick as a `mailto:` (or any external navigation) cancels the handoff — fire the external navigation first, defer any history reset via `setTimeout(…, 0)` (`CLAUDE_PLACE_ORDER.md §25`).

---

## 9. Slot assignment

Time-based thresholds, IST.

| Time (IST) | Slot |
|---|---|
| < 10:30 | Morning (id=1) |
| < 12:30 | Afternoon (id=2) |
| < 15:30 | Evening (id=3) |
| ≥ 15:30 (or null) | Night (id=4) |

**Non-tint orders:** slot assigned at import via `resolveSlot()` on `orderDateTime`.

**Tint orders (`orderType === "tint"`):** `slotId = null` at import. Slot assigned at tinting completion based on IST time. Splits: parent slot set when last split completes.

**`arrivalSlotId` (2026-06-29 — added v27.7 column, behaviour completed this consolidation):** stamped at import for ALL orders — tint and non-tint alike — via `resolveArrivalSlotId(emailDateTime)` (the 5-slot ruler in `lib/slots/slot-ruler.ts`: Morning/Afternoon/Evening/Late Evening/Night, distinct from the 4-slot table above). `slotId` stays null for tint until completion, unaffected by this. Full detail + landmines (manual-SAP no-time-column → Morning default, JSON auto-import re-stamp fix): `CLAUDE_IMPORT.md §12`.

**Slot cascade and day-boundary reset — GONE from the live tree (2026-07-28).** `lib/slot-cascade.ts` and `lib/day-boundary.ts` no longer exist under `lib/`. They were archived with the Planning board (commit `639f8139`) to **`archive/2026-07-planning-board/lib/`**, because their last two importers went with it: `app/api/planning/board/route.ts` (step 7) and `app/api/warehouse/board/route.ts` (step 6). Their calls had been commented out — headed `// DISABLED: slot cascade removed — slots are fixed by obdEmailTime` — long before that, so **they had not run in production for a considerable time**; archiving them changed no behaviour. **If either is ever restored, it must skip tint orders.**

⚠ **This entry has been wrong twice — check the tree before rewriting it.** Originally "exist but are not called" (correct) → 2026-07-27 `f6ace5b8` flipped it to "they ARE called" after reading only the `import` lines (**wrong** — an import is not a call) → 2026-07-27 `a078289f` restored the truth → 2026-07-28 `639f8139` archived both files. Full landmine entry: §13.

**`applyMailOrderEnrichment()`:** On SAP import, checks `mo_orders` for matching `soNumber`. If found, applies `dispatchStatus`, `priorityLevel`, `remarks`, overrides, and sets `orderDateTime` from `mo_orders.receivedAt`. Skips slot recalc for tint orders. One soNumber can map to many OBDs (`updateMany`).

---

## 10. Universal header system

Component: `components/universal-header.tsx`. Used by ALL boards.

**Row 1 (52px sticky, z-30):** Title (ReactNode) · Stats (11px gray-400) · Clock IST HH:MM · ⌨ Shortcuts · Download · Search (180→260px).

**Row 2 (40px sticky top-[52px], z-30):** Segmented control + leftExtra · rightExtra · Filter ▾ · Date stepper (calendar popover).

**Color rule:** ONE teal element = active slot segment. Everything else gray. *Per-screen exemption:* Sampling Library uses teal on multiple elements intentionally (`CLAUDE_UI.md §22`).

**Slot segments:** the depot-wide 4-segment rule (`slot_master`-driven, filter out Next Day Morning, no "All" button) was written for the Support / Planning / Warehouse boards — **all three retired 2026-07-27/28, so no board renders it today.** The rule is kept because `slot_master` itself is live: it is still read by the admin Slots and Slot-Rules screens, the operations summary, Tint Manager's order list, and `lib/slots/slot-ruler.ts` (which stamps `arrivalSlotId` at import). ⚠ Not to be confused with `dispatch_slot_master`, the separate dispatch-window table Floor and Picking use. **Mail Orders is a separate system** (computed at render from `receivedAt`, hardcoded names in `lib/mail-orders/utils.ts`, cutoffs in `system_config`) and shows **5** since 2026-06-18 (added "Late Evening"; `CLAUDE_MAIL_ORDERS.md §9.1`). The two slot systems never share numbers.

Per-board wiring summary in `CLAUDE_UI.md §6`.

---

## 11. Sidebar behaviour

- Default state: collapsed (72px, icons only)
- Hover expands to 220px as **overlay** (page never shifts)
- Mouse leave collapses after 150ms delay
- No click toggle. No localStorage persistence. Always starts collapsed.
- API: `useRoleSidebar()` returns `{ isExpanded, expand, collapse }`.
- Main content locked at `marginLeft: 72px` / `maxWidth: calc(100vw - 72px)`.

Files: `components/shared/role-sidebar-provider.tsx`, `role-sidebar.tsx`, `role-layout-client.tsx`.

`/place-order` uses the same sidebar. `/attendance` uses no sidebar (full-screen PWA layout). `/po` uses no sidebar (public mobile).

**What fills an operational sidebar changed on 2026-09-04, but only its SOURCE.** `buildNavItems()` still filters on `allPerms[pageKey]?.canView`; what moved is where `allPerms` comes from — `user_page_access` by user id rather than `role_permissions` by slug (§5). Two things about that are worth knowing before touching nav code:

- **`MobileShell`'s Home button is still `navItems[0].href`** — the first entry of `PAGE_NAV_MAP` that this person may VIEW. The rule is unchanged; the input is now per-person, so it must be re-derived **per user** rather than per role. The position warnings on the `mrn` and `ci` entries in `lib/permissions.ts` still stand and now bind 39 people, not 13 roles.
- **The admin sidebar is separate and now gates on superuser.** `components/admin/admin-sidebar.tsx` (`NAV_SECTIONS`) is not fed by `buildNavItems()`. Its keyless items show to a superuser only; the **Access** item (People → Access, → `/admin/access`) is one of them.

**Mobile shell (2026-07-05/06):** `role-layout-client.tsx` now also mounts a shared mobile app shell (`components/shared/mobile-shell.tsx`) globally as a sibling to `<RoleSidebar>` — a fixed, mobile-only (`block md:hidden`) Home/Menu/You bottom bar. Every page that wraps itself in `role-layout-client.tsx` inherits it automatically, no per-page work. Desktop sidebar untouched. Pages with their own layout that bypasses this wrapper (Attendance, `/po`) don't get it — **verified in code 2026-07-27**: `app/po/` does not use `role-layout-client.tsx`, so `/po` builds its own Home/Drafts/Sent bar inline. Full spec: `CLAUDE_UI.md §59`.

---

## 12. Screens index

Full detail in domain files. Cross-reference only here.

### Admin
`/admin`. Superuser (`users.isSuperuser` OR the `admin` role — §5), plus ops_admin for the attendance dashboard. Customer / SKU / route / area / user / system config / import / attendance dashboard / **removed-orders** (superuser-only restore page) / **Settings → Hide** (`/admin/settings/hide` — Rules / Hidden Orders / Tags tabs; `CLAUDE_UI.md §57`, schema §7.10).

### Admin → Access
**`/admin/access`** (2026-09-04). Superuser only. **The screen that decides what everybody can do** — per-user page permissions, one person at a time: a searchable people rail on the left, and on the right that person's 27 page keys × 5 actions as a `CLAUDE_UI.md §27` fixed table. Writes `user_page_access` (§7.14); every save writes one `admin_audit_log` row (§7.13). Shows which source is live (`ACCESS_SOURCE`, §5) in a banner, and an amber dot wherever a person's ticks differ from what their job title would grant. → `CLAUDE_UI.md §63`.

### Mail Orders
`/mail-orders`. billing_operator, tint_manager, admin. → `CLAUDE_MAIL_ORDERS.md`

### Tint Manager / Operator / Challans / Shades
`/tint/*`. → `CLAUDE_TINT.md`

### Reports
`/reports` hub + `/reports/tint-summary`. tint_manager, admin, operations. Gated by the reused `ti_report` permission. **Tint Summary** daily MIS report + the former **TI Report** (folded in — old `/tint/manager/ti-report` and `/ti-report` redirect to `/reports?r=ti-report`). API: `GET /api/reports/tint-summary`. → `CLAUDE_TINT.md §11-§12`, `CLAUDE_UI.md §56`.

### Sampling Library
`/tint/sampling-library`. tint_manager, tint_operator (read), admin. → `CLAUDE_SAMPLING_LIBRARY.md`

### Attendance
`/attendance` (end-user PWA), `/admin/attendance` (admin dashboard + ot-pending + settings + ot-audit). → `CLAUDE_ATTENDANCE.md`

### Trip Report
`/trips` (list, per-trip detail), `/trips/[tripNo]/sheet` (A4 print). logistics + 4 named secondary-role users (§5). Read-only NTS trip mirror — standalone, not connected to the OBD pipeline. → `CLAUDE_TRIP_REPORT.md`

### Place Order
`/place-order` (desktop, label "Purchase Order (PO)"). `/po` (public mobile, no login). → `CLAUDE_PLACE_ORDER.md`

### Import
`/admin/import`. → `CLAUDE_IMPORT.md`

### Picking
`/picking`. ONE face at every width — the card board — branching by ROLE: the supervisor board (**Assign / Picking / Done** tabs, renamed from Assign/Check/Done on 2026-07-20) or the picker's own "My Picks". **The DESKTOP queue is RETIRED** (2026-07-28, `archive/2026-07-picking-desktop/`); the width-based split went with it. admin, operations, **floor_supervisor** (view+edit) and **picker** (view only) — grants live-verified 2026-07-28, §5. ⚠ The old "floor_supervisor currently CANNOT open it" caveat is **retired**: resolved when the grants were seeded 2026-07-20, and since 2026-07-28 (`c4323cd4`) this is where both roles **land at login**. Picking is hidden from the DESKTOP sidebar only — the phone Menu sheet keeps it, and no permission changed. → `CLAUDE_PICKING.md`.

### Floor Control
`/floor`. admin, operations. The desk screen (left rail = undecided bills / right = Floor / On-hold / Cancelled + detail panel). Hand-rolled header (UI §6 named exception). Built to consolidate the Support board + the Picking **desktop** board; **both are now retired** — Support 2026-07-27 (`archive/2026-07-support/`, `CLAUDE_FLOOR.md §9`) and the Picking desktop queue 2026-07-28 (`archive/2026-07-picking-desktop/`, `CLAUDE_FLOOR.md §9b`). **`/picking` itself is still live** and keeps its card boards at every width. → `CLAUDE_FLOOR.md`.

### MRN — Material Receipt Note
`/mrn`. Stock coming **IN** off a depot truck. billing_operator, operations, floor_supervisor, admin. **TWO faces on ONE route, branched by ROLE and never by viewport:** the supervisor's phone (To check / Checking / Done → line sheet → END) and billing's desk (date rail → pane → delivery tabs → the XLS and the A4 sheet). Status ladder `open → checking → done → closed`. → `CLAUDE_MRN.md`.

### CI — Goods Return Note (CI Form)
`/ci`. Stock coming **BACK** from a customer — the return counterpart to MRN. billing_operator, operations, floor_supervisor, admin. **TWO faces on ONE route, branched by ROLE and never by viewport:** the floor supervisor's phone (search a bill → Full bill / Part → lines → details → submit) and billing's desk (one rail, pending above closed → Close CI). Status ladder `draft → submitted → closed`; `returned_to_floor` is permitted by the CHECK and written by nothing. Also raised **automatically** from a confirmed picking finding on an invoiced bill (`CLAUDE_PICKING.md §11.7` → `CLAUDE_CI.md §9`), and exports billing's 17-column register as .xlsx. → `CLAUDE_CI.md`.

🔴 **`/ci` IS REACHABLE BY URL ONLY, AND THE REASON IS BEHAVIOURAL — NOT AN UNFINISHED TASK.** `ci` is in the `PageKey` union and in `ALL_PAGE_KEYS`, but deliberately **NOT in `PAGE_NAV_MAP`**. `MobileShell`'s phone Home target is **`navItems[0]?.href`**, so a nav entry inserted at index ≤ 2 would **steal `floor_supervisor`'s Home button from `/picking`** — the screen he lands on at login (§5's redirect map) and works from all day. Adding the row is therefore not the fix on its own. **A correct fix must satisfy all three:** (a) the entry lands at an index that leaves `navItems[0]` as `/picking` for `floor_supervisor` **after** `buildNavItems()` has filtered by permission — the index in `PAGE_NAV_MAP` is NOT the index in the built list, because filtering shortens it differently per role; (b) it is verified on a real phone **for that role**, not only for admin, whose nav is longer and orders differently; (c) the desk roles still get it, since `billing_operator` reaches the same route. Until then the URL is the entry point, and that is a known state. Tracked in `ROADMAP.md`; detail in `CLAUDE_CI.md §13 CI-16`.

### Operations View
`/operations/tinting|tint-operator`. operations, ops_admin, admin. (Its other three children — `support`, `dispatch`, `warehouse` — are all retired; operations now lands on `/floor`.)

### Retired 2026-07-27/28 — do not re-document these as live

Five screens left the app across that week. **Each archive folder's README owns its story — point at it, never retell it here.**

| Gone | Was | Archive |
|---|---|---|
| `/support`, `/operations/support`, `/admin/support` + `/api/support/*` | the gatekeeper desk | `archive/2026-07-support/` |
| `/order` | the public no-login mobile order page (`/po` supersedes it; the address is **parked**, no redirect) | `archive/2026-07-order/` |
| `/operations/warehouse`, `/operations/dispatch` | alternate mounts only — same components, different gate | `archive/2026-07-operations-pages/` |
| `/warehouse`, `/warehouse/supervisor`, `/warehouse/picker` + `/api/warehouse/board` | the post-picking dispatch board — **always rendered empty** | `archive/2026-07-warehouse-board/` |
| `/planning`, the `/dispatcher` stub + all 8 `/api/planning/*` | dispatch planning — **always rendered empty** | `archive/2026-07-planning-board/` |

🔴 **Three things that survived and are routinely mistaken for casualties:**
- **`app/api/warehouse/pickers/route.ts` is LIVE** — the Picking supervisor board calls it (`picking-board-mobile.tsx:936`). It is the **only** route under `app/api/warehouse/`. **Never archive that folder wholesale.** *(It had a second caller, `picking-queue.tsx:686`, until that board was archived 2026-07-28 — the route survived precisely because the surviving caller was checked first.)*
- **`/dispatcher/customers`, `/dispatcher/skus`, `/dispatcher/routes`, `/dispatcher/vehicles` are LIVE** — only the `/dispatcher` index stub went. They gate on their own page keys.
- **The `dispatcher` ROLE is LIVE** — only the `dispatcher` **page key** was retired. Role and page key are different things sharing a word.

Page keys removed with them: `support_queue`, `operations_support`, `operations_warehouse`, `operations_dispatch`, `warehouse`, `planning_board`, `dispatcher`. All corresponding live `role_permissions` rows have been cleared.

### Public
- `/po` — public mobile order form. No login. Generates mailto. (Succeeded `/order`, retired 2026-07-27 — address **parked**, no redirect; story: `archive/2026-07-order/README.md`.)
- `/demo` — animated tutorial. Rewrites to `/order-demo.html`.
- `/login`, `/not-ready`, `/unauthorized`.

`middleware.ts` public paths: `/login`, `/unauthorized`, `/not-ready`, `/api/auth`, `/api/health`, `/order`, `/api/order`, `/po`, `/demo`, `/order-demo.html`, `/api/cron/*` (bearer auth). ⚠ **`/order` stays on purpose** even though its page is retired: the check at `middleware.ts:26` is `startsWith`, so removing it would (a) make the parked address return a **login prompt** instead of a 404, and (b) silently put **`/orders`** behind auth via the prefix match.

`middleware.ts` `PHASE1_BLOCKED` is currently **`[]`** (§5) — `/picking` and `/floor` are both reachable today; neither has been switched off. `/support` is gone (retired 2026-07-27), removed at the route level rather than blocked here.

---

## 13. Landmines

Existing in code but intentionally disabled, broken, or stale. Do not "fix" without explicit instruction.

### 🚨 THE ID-SPACE LANDMINE — read before touching the SKU catalog

> ## DO NOT repoint `import_enriched_line_items.skuId` to `sku_master_v2`.
>
> **The two tables assign COMPLETELY DIFFERENT id numbers to the same material code.** This is not
> "a few collisions" — it is **zero overlap**, verified read-only against production, not reasoned:
>
> ```
> === ID-SPACE COMPARISON (old id → what lives at that id in NEW) ===
>   same id, SAME material code  :     0     ← not one. anywhere.
>   same id, DIFFERENT material  :   477     ← silent mispoint
>   old id absent from new table :   574     ← FK would dangle
>
> === Weighted by live pointers (5,000-row sample) ===
>   pointer would still be CORRECT :     0
>   pointer would MISPOINT         : 2,065
>   pointer would DANGLE           : 2,935
> ```
>
> These are not near-misses — `IN28916271` vs `5906723` are different *products*. A naive FK repoint
> turns **every historical enriched line** into a confidently-WRONG product name and pack size on a
> live picking bill and the removed-lines view. That is far worse than the current blank, which at
> least reads as "unknown" (`CLAUDE_PICKING.md §7` treats a blank pack as a mis-pick **preventer**).
>
> **The bookmark is retired by RESOLVING VIA `material` — never by moving the FK.** Every repointed
> reader batch-matches `sku_master_v2.material` against `import_raw_line_items.skuCodeRaw`. Inline
> warning comments were left at all four former read sites — **leave them there.**
>
> ⚠ **THE WARNING NOW TRAVELS WITH THREE MODULE RESOLVERS, and each carries its own copy on
> purpose:** `lib/picking/resolve-lines.ts`, `lib/mrn/resolve-lines.ts` and — added 2026-08-31 —
> `lib/ci/resolve-lines.ts`. All three match on `material` ONLY, all three state why in their
> headers, and CI's spells out the stakes for a document that replaces a signed paper form: a blank
> reads as "unknown" and stops the operator, **a wrong product name reads as fact and gets signed.**
> When this list grows, the new resolver copies the warning too. Do not delete one as duplication —
> it is the same rule reaching a fourth author who will never open this file.
>
> Cause: the pour ordered rows by `mo_sku_lookup_v2`'s own sequence, which has no relationship to the
> order `sku_master` was built in over the preceding years. Evidence:
> `docs/prompts/drafts/code-discovery-2026-07-19b-catalog-repoint.md`.

Supporting facts for the same area:

- **`import_enriched_line_items.skuId` is write-only** — written `null` since 2026-07-19, read by
  **nothing live**: zero runtime paths read the column, traverse the `sku` relation off an enriched
  line, or filter on it (four-vector sweep, `code-discovery-2026-07-19h`). The only readers anywhere
  are two underscore-prefixed scratch diagnostics (`_diagnose-sku-5961032.ts`,
  `_diagnose-skuid-collision.ts`) — outside the `tsc` gate, never imported by the app. **This does
  NOT authorise dropping the column or the relation** — that is bundled with the retire-old-table
  session. Keeping the column is what makes rollback a one-commit revert.
- **`lineWeight` is NOT a weight.** It has never held a mass — a recognised line stores literal `0`,
  an unrecognised one `null`. There is no `grossWeightPerUnit` column on either catalog table. It is
  in practice a "was this code recognised?" flag; every reader is display-only and tolerates null,
  and nothing does arithmetic on it. The name is the trap. Detail: `CLAUDE_IMPORT.md §8.1`.
- **Tint's `skuId` is a FALSE POSITIVE — never repoint tint.** The `skuId` identifiers throughout
  tint code **alias `rawLineItemId`**, not a catalog id — proven at
  `components/tint/tint-operator-content.tsx:2479`/`:2503` (`skuId: li.rawLineItemId as number`) and
  compared back against `rawLineItemId` at `:1728`. The value round-trips through
  `tint_assignments.currentProgress`/`lastProgressSnapshot` JSONB as `{ items: [{ skuId, doneQty }] }`.
  No tint path contains a single `sku_master` reference. A grep for `skuId` WILL light up tint — it
  is noise, every time.
- **`scripts/normalise-sampling-data.ts:313` still reads old `sku_master`** and — unlike the
  underscore scratch scripts — has **no underscore prefix**, so `tsconfig.json`'s `exclude`
  (`scripts/_*.ts`) does not cover it: **it is inside the `tsc --noEmit` gate.** At the DROP step it
  will fail to compile and block every commit until dealt with. Known pre-DROP risk, not a bug today.
  Cross-ref `CLAUDE_SAMPLING_LIBRARY.md §3`.

---

- **~~`lib/slot-cascade.ts`, `lib/day-boundary.ts`~~ — NO LONGER A LIVE TRAP (archived 2026-07-28).** Both files left `lib/` with the Planning board (`639f8139`) and now sit in `archive/2026-07-planning-board/lib/`. They cannot mislead a reader of the live tree any more, so the full landmine is retired to a pointer. Story: `archive/2026-07-planning-board/README.md`. **If either is ever restored, it must skip tint orders** — that condition survives the archive. ⚠ This entry flipped twice before it settled (`f6ace5b8` wrong → `a078289f` right → `639f8139` archived); the lesson it taught — **an import is not a call, open the call site** — is kept in `archive/RETIREMENT-PLAYBOOK.md §4`, which is where a live-trap lesson belongs once the trap itself is gone.
- **27 write routes still record no actor, and 13 of those are DEFERRED BY DECISION — not a gap to close on sight.** Counted from the tree 2026-09-04, not quoted: `grep -rn "logAdminAction({" app/` returns 43 wired call sites. Of what remains, **14** are the old `sku_master` family + Shade Master + dispatch-cutoffs, excluded permanently because they retire with their screens; **13** belong to modules whose own conversion is still ahead — Sampling Library 3, MRN 2, Tint 5, Billing 1, backfill 2. Those 13 are folded into their module's session **so the same files are not edited twice**: that session reopens these exact routes, re-reads the surrounding code and may reshape the call anyway. ⚠ The trap is that an unwired route looks identical whether it was missed or parked. **It was parked.** Do not sweep them in a tidy-up pass; wire one only when you are already inside that module's conversion. Full route lists, per module, in §7.13's coverage block. (`mail-orders/ingest` POST is unwired *permanently* — HMAC machine path, no person to record.)
- 🔴 **THE SUPERUSER RULE IS TWO ARMS, AND THE SECOND ONE IS NOT DEAD CODE.** Every admin gate is `isSuperuser === true` **OR** `roles includes "admin"` (`lib/rbac.ts`). The role arm looks redundant — the one superuser also holds the role — and it is not. **Exactly ONE account can administer OrbitOMS.** He is the only person who can reach the `ACCESS_SOURCE` switch (§5), the only person who can grant the flag back, and the only person who can edit `/admin/access`. If the flag stops reaching the session for any reason — a JWT minted before 2026-09-04 and not yet refreshed, a session callback that stops copying the claim, a bad edit to `auth.config.ts`, a botched migration — the role arm is what keeps him in. Dropping it is a **later, deliberate decision** taken with a tested recovery path, never a tidy-up, and never "the flag obviously works by now". That is the one change in this whole project that cannot be undone from inside the app. Recovery if it ever happens: `docs/prompts/drafts/code-update-2026-09-04-user-based-access.md` §Rollback.
- 🔴 **`role_permissions` MUST NOT BE DROPPED while `ACCESS_SOURCE` can be flipped back.** It reads like a retired table — nothing consults it for live access since 2026-09-04 — and it is the *entire* rollback path. Dropping it turns a 30-second `UPDATE system_config` into an outage with no way back. It is also still written by the old `/admin/permissions` screen and still read by `/admin/access` to compute each person's "differs from their role" baseline. 118 rows, 13 slugs, live. Retiring it is ROADMAP step 8, and it comes *after* the switch itself is removed, not before. Same for `user_roles` (29 rows) and `role_master` (13 rows), which still supply the label, the login redirect and that baseline.
- ⚠ **22 sites still compare `session.user.role !== "admin"` as an admin BYPASS of a permission check**, in the shape `if (role !== "admin") { checkPermission(...) }` — admin skipping the check rather than an admin-only gate. Counted 2026-09-04, excluding the 12 more under `app/api/tint/`. **A superuser who is not ALSO role-admin would fall through into the permission check instead of bypassing it**, and would be denied wherever their ticks do not cover the page. **No live impact today** — the single superuser holds both — and it becomes real the moment a second superuser is created without the `admin` role. Step 6 closes it (ROADMAP → *User-based access*). Do not "fix" one of these in isolation while the surrounding route still gates on a role array; they move together.
- **`operatorSequence` field** on `tint_assignments`/`order_splits` — exists in schema, no longer used for sorting. Sort by `sequenceOrder` only.
- **`delivery_type_slot_config` table** — exists but not consumed anywhere.
- **`SlotSummaryItem` interface** in `tint-manager-content.tsx` — defined but unused.
- **Duplicate pick columns** on `orders` and `order_splits` (camelCase + snake_case). Use camelCase via Prisma.
- **TM reorder API** (`/api/tint/manager/reorder/route.ts` ~line 429) uses `prisma.$transaction` — violates §3, left as-is for simple two-update swap.
- **Challan PATCH `prisma.$transaction`** (`app/api/tint/manager/challans/[orderId]/route.ts:527`) — formula upsert wrapped in `$transaction`. Pre-existing; only Chandresh saves challans (low concurrency). Refactor in a dedicated session.
- **Challan cell-clear UX bug** — `components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell in the UI does NOT clear the DB row. After auto-fill shipped, a TM cannot "unlock" a manually-overridden row by clearing it. Mitigation if needed: build a proper "Reset to auto" button.
- **One-time backfill endpoints** (keep for emergency):
  - `POST /api/admin/fix-slots` — backfills `orderDateTime` + recalculates slotId
  - `POST /api/admin/fix-challans` — creates missing delivery_challans
  - `POST /api/mail-orders/backfill-customers` — marked TEMPORARY
- **`enrich-v2.ts`** — duplicate `SkuEntry` type, not imported anywhere.
- **`CATEGORY_KEYWORDS` constant** in `enrich.ts` — dead code.
- **GEN SKUs** — 8 deleted: `5860311, 5984151, 5967877, 5955808, 5955810, 5955818, 5955826, 5911947`. If new GEN SKUs appear in imports, delete them.
- **Challan sequence allocation must include voided rows** — opposite of every other challan read. Don't filter `isVoided: false` in sequence-numbering queries.
- **~~Auto-Import paused~~ — WRONG, corrected 2026-08-04. Auto-Import is LIVE** (resumed 2026-06-20; §4). This "paused since 2026-05-14" line survived six weeks stale here and in IMPORT (corrected there 2026-08-03, `4aad3622`) and was quoted onward by a discovery draft — a doc claim is not a data claim, SELECT `import_batches` before repeating it. The open item it carried is still open: the cross-source orphan policy audit (`CLAUDE_IMPORT.md §15`) was never done before the resume.
- **`shade_master` deprecated.** Sampling Library Phase 4 shipped (2026-05-25). All new shade saves write to `sampling_register` + `sampling_recipes` + `sampling_usage_log`. `shade_master` table still exists with historical data but is no longer read or written by the live operator workflow. Scheduled for deletion after a retention window. Do not write to it.
- **Split-done usage-log gap.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints never appear in the Sampling Library usage history or same-site suggestions. Pre-existing, separate from any other tint bug. ROADMAP item: decide whether splits should log usage.
- **`/api/order/data` and `/api/place-order/data` carry duplicated v2 payload queries** — no shared helper yet. If you edit the v2 payload shape, edit BOTH or extract a shared builder.
- **Legacy `mo_order_form_index` + `mo_sku_lookup` orphaned by `/po` and `/place-order`** — both frontends read v2 tables (the retired `/order` moved across on 2026-05-29, before it went). BUT the mail parser + enrichment still read the LEGACY tables. Do NOT delete the legacy tables until the parser is migrated to v2 (Stage 3 of the v2 single-source plan; see `CLAUDE_PLACE_ORDER.md`).
- **Pre-existing `prisma.$transaction` in admin customer routes** (`app/api/admin/customers/route.ts` lines 133 & 186) — flagged in multi-SO commit, left untouched. Refactor when convenient.
- **NULL three-valued logic (Hide filter).** Prisma `NOT { field: value }` on a NULLABLE column DROPS NULL rows (a "hide if HOLD" rule hid every order whose `dispatchStatus` was null). For "exclude matching" filters build NULL-safe KEEP conditions: `{ OR: [ { field: null }, { field: { not: value } } ] }`, AND-combined. Implemented in `getHideExclusion()`. Live consumer list (call-site sweep 2026-08-04 — the old list named the retired Support/Planning/Warehouse boards): Tint Manager orders, TM missing-customers, Tint Operator my-orders, Operations summary, **Floor — all five feeds** (`lib/floor/queries.ts`), **Billing Pending** (`lib/billing/picking-where.ts`; the billing DONE arm skips it deliberately — see that route's comment), Tint Summary report. NOT into Hidden-Orders/restore views, challan audit OR, import internals, or `mo_orders` (out of v1 scope). ⚠ **Picking does NOT apply it** (`lib/picking/queue.ts` — zero calls): an admin-hidden order is invisible on Floor but visible on Picking. Standing asymmetry, not an accident of this pass — decide per-surface.
- **`orders.dispatchStatus` Hold value is lowercase `"hold"`.** The capitalized `"Hold"` belongs to the mail-orders pipeline (`getOrderSignals` status badge), not the orders table.
- **MO badges are centralized in `getOrderSignals()`** (one emit point — easy to tag-gate, §MAIL_ORDERS §21). **Tint badges are NOT centralized** (hardcoded across 3 components, `getAgeBadge` duplicated) — gating them needs a shared badge registry first (the deferred "hard part").
- **Hide does NOT delete.** Rules + manual hide are reversible; rule-hidden orders have no per-order un-hide in v1 (Hidden Orders shows "Managed by rule"); only manual hides get an Un-hide button.
- **~~Orphaned `components/support/ship-to-override-modal.tsx`~~ — RESOLVED 2026-07-27.** Archived with the rest of the Support module (`archive/2026-07-support/components/support/`). It was never live; the ship-to feature is now Floor's own (`CLAUDE_FLOOR.md §4.4`).
- **~~Picking role grants — prod verification pending~~ — FULLY RESOLVED 2026-07-28. No longer a landmine.** Seeded 2026-07-20 (`prisma/seed.ts:110-112`) and **SELECT-verified against live production on 2026-07-28**: seed and live agree exactly. The grant table in **§5 owns the numbers** — do not restate them here. What made this a landmine for eight days was the *gap* between the two, and the gap is closed. ⚠ The lesson survives the fix: **seed is not live, in both directions** — this cycle's risk was "seeded but prod unconfirmed", the prior cycle's was the mirror (a live grant with no seed row, which a reseed would have silently revoked). Always SELECT.
- **67 write paths still record NO ACTOR — "who did this?" is unanswerable for most of the app** [v27.18, 2026-09-01]. The 2026-08-31 census found **70** such paths out of 134 mutating routes; `admin_audit_log` (§7.13) wired **3** of them, leaving **67**. The full list, grouped and named file by file, is `docs/prompts/drafts/code-discovery-2026-08-31-role-census.md §6c` — **A.** admin master data, 48 files (not one master-data write in the app records who made it) · **B.** Mail Orders, 8 · **C.** Sampling Library, 3 (creation records `createdById`; every subsequent edit does not) · **D.** MRN, 2 (⚠ **that figure predates the photo routes.** `header` PATCH and `lines` PUT are still the two the census named, and `POST /api/mrn/[mrnId]/close` — added 2026-09-01 — records `closedById` deliberately so it did not become a third. But `DELETE /api/mrn/photo/[photoId]` hard-deletes the row and therefore records nobody at all, which the 2026-08-31 census could not have counted. `CLAUDE_MRN.md §12`) · **E.** Tint, 5 (creation records `submittedById`; resolution records nobody) · **F.** Billing, 1 · **G.** backfill, 2. Only 9 of the 70 even have `session.user.id` in scope; the rest need the id threaded in as well as somewhere to put it. ⚠ **Why this gets worse, as a fact and not an opinion:** today an unattributed write is narrowed by the role gate — `admin/permissions` POST can only have been the one active admin. Under per-user access the suspect set becomes everyone holding that tick, and the role gate stops narrowing anything. Fix the paths before the access model changes, not after. The pattern to copy is `lib/audit/log.ts` + any of the three routes wired in §7.13. ⚠ **The CI module (2026-08-31/09-03) added FIVE mutating routes and the count did NOT move** — `draft`, `lines`, `submit`, `details` and `close` all record an actor on the row itself (`supervisorId` at raise, `billingOperatorId` at close, `voidedById` on a void), so none of them joins the 67. Recorded so a future census does not re-derive it, and as the shape a new module should copy: **the cheapest audit trail is an actor column on the row, not a log entry after the fact.** ⚠ CI's one gap is the same one MRN has — a hard delete records nobody: `lib/ci/auto.ts` DELETEs an auto-CI whose due lines have gone to zero, and that removal is attributable only from a `console.warn`.
- **`push_subscriptions.updatedAt` is a PLAIN `@default(now())` — NOT `@updatedAt`, no DB trigger** [LANDMINE, v27.12] — the column defaults only on INSERT; an UPDATE that omits it leaves a **stale** timestamp. EVERY write must pass `updatedAt: new Date()` explicitly (`lib/push/send.ts` + the subscribe/unsubscribe routes). Same trap class as a NOT-NULL-no-default column — the *name* misleads you into expecting auto-stamping. Schema §7.12; behaviour `CLAUDE_NOTIFICATIONS.md`.
- **~~SECURITY — `GET /api/mail-orders/backfill-enrich` is fully unauthenticated~~ — FIXED 2026-09-01.** The GET now runs `requireRole(session, [ROLES.ADMIN])` before `runBackfill()`; the POST's HMAC machine path was left untouched. The `TEMPORARY — delete after backfill` comment is still in its own source and the route still has zero callers — retire-or-keep is a ROADMAP item, not a landmine.
- **~~SECURITY — broad no-role-check gap across `app/api/mail-orders/**`~~ — FIXED 2026-09-01.** All eleven write routes now gate on `checkAnyPermission(roles, "mail_orders", "canEdit")` (full list: `CLAUDE_MAIL_ORDERS.md §18`). The write population dropped from every logged-in user to the four granted roles. ⚠ The lesson survives the fix: **the gap was "no check at all", not "the wrong check"** — this entry and the one below it both mis-stated it as `canView` for seven weeks, and only a handler-by-handler sweep (`docs/prompts/drafts/code-discovery-2026-08-30-permission-actions.md §3c`) caught it. Read the gate, not the guard's name.
- **~~Mail Orders write routes gate on `canView`, not `canEdit`~~ — WRONG ON BOTH HALVES, corrected 2026-09-01.** Mail Orders never gated on `canView` — it gated on **nothing but a session** (above). And `/picking`'s `assign`/`unassign` were moved to `canEdit` in code on **2026-07-20**; `picking/done` and `findings/report` deliberately stay on `canView` because the picker holds `canView` only and they are the picker's own actions (`assign/route.ts:19-33` explains it). Neither half of this entry was true when it was written.
- **`addToPackMap` dedupe-collision risk** (`app/api/place-order/data/route.ts` and `/api/order/data`) — dedup key is first-row-wins with **no `orderBy`** on the `skuRows` query. If two `isPrimary=true` rows ever collide on the same rendered pack, which one wins is unspecified. Unrelated to the isPrimary filter itself (§7.7) — a separate, still-open risk.
- **Floor selection: the table-header checkbox is a toggle-all, NOT a clear; Esc has ONE owner** (2026-07-26 action-surfaces redesign, shipped — recorded in `docs/prompts/drafts/web-update-2026-07-26-floor-action-surfaces.md` §5, still unmerged into `CLAUDE_FLOOR.md`). `lib/floor/selection.ts` `toggleAll()` on a PARTIAL selection selects-all rather than clearing, and it is per-group — which is why a global Clear affordance must exist somewhere. `floor-page.tsx` is the single window-level Esc owner for the whole floor tree; **never add a second Esc keydown listener under `components/floor/`** (two listeners race in registration order). Full spec belongs to the FLOOR reconciliation session — this entry only stops a CORE reader from "fixing" either behaviour.
- **"WHITE BASE" in a SKU `description` does NOT reliably mean Brilliant White** — at least 3 WS Powerflexx SKUs were found misfiled under `baseColour='BRILLIANT WHITE'` despite being `90 BASE` (fixed 2026-07-16). Likely not isolated — a catalog-wide `description ILIKE '%WHITE BASE%'` sweep under `baseColour='BRILLIANT WHITE'` is a candidate follow-up, not yet run.

---

## 14. Operational checklists

- **Sampling duplicate merge:** dedupe by EXACT full formula (recipe fingerprint), never shade name; use RAW `packCode` enum in SQL (not the display label); never delete `sampling_register` rows (inactivate `isActive=false`); preserve the single-`isPrimary` invariant on the master. Full runbook + reference graph: `CLAUDE_SAMPLING_LIBRARY.md §12`. Note: GEN-SKU delete-list SKUs may still appear as historical sampling variants — merging does not auto-strip them.

---

## 15. Key lib modules (cross-cutting / new this cycle)

Quick index; full detail in domain file maps.

| Module | Purpose | Doc |
|---|---|---|
| `lib/place-order/pack-buckets.ts` | desktop variant-grid columns (`PACK_TO_BUCKET`, `FAMILY_BUCKET_OVERRIDES`, silent-drop) | PLACE_ORDER §24 |
| `lib/place-order/keyword-family-map.ts` | whole-query word→family search promotion (shared mobile+desktop) | PLACE_ORDER §13 |
| `lib/place-order/sub-product-descriptors.ts` | two-line descriptors + `isVariantQualifierTab` + `getSecondLine` | UI §43 |
| `lib/place-order/email.ts` | `buildEmail` + `emailLineLabel` (single name source for all 3 builders) | PLACE_ORDER §11 |
| `lib/sampling/pack-litres.ts` | dose-litres map + `packDoseLitres`/`scalePigments`/`perLitreFingerprint` | SAMPLING §11 |
| `lib/hide/*` | `visibility.ts`, `tag-settings.ts`, `tag-catalog.ts` (Hide feature) | §7.10, UI §57 |
| `lib/reports/tint-summary-data.ts` | Tint Summary report data source-of-truth | TINT §12 |
| `lib/picking/picker-split.ts` | `splitPickerRows()` — the picker's Pending/Done + today-IST rule, called by BOTH the server page and the client shell so the two can never disagree about which tab a bill is in. Pure: no I/O, and the clock is passed in rather than read inside. Also the reference implementation for the offset-less-`Date.parse` rule (§3) | PICKING §5.4 |
| `lib/billing/flag.ts` + `lib/billing/picking-where.ts` | Billing v2 rollout gate (per-page-load read of `billing_settings` + `users.billingV2TestUser`) · shared WHERE builders for the billing Picking tab (list + marker read the same predicate) | doc home pending — MAIL_ORDERS session (as-built: `drafts/billing-phase-2-build-decisions.md`) |
| `lib/dispatch/punch-clock.ts` | arrival-clock validation feeding the dispatch engine (2026-08-02/03 commits `03b6dd19`→`dee603dc`: a date-only punch is a DAY, not a clock — both arrival clocks validated before slotting) | §7.4-adjacent; doc home pending — flag for the next IMPORT/FLOOR pass |

| `lib/ci/*` | The CI module — 7 files, and **the client/server line is load-bearing.** `types.ts` (wire shapes + status guards) and `derive.ts` (litres, totals, pack breakdown, dealer rule — **PURE**: no Prisma, no I/O, no clock) are imported by client components, `derive.ts` **by value**, so both must stay pure. `queries.ts` / `auto.ts` / `number.ts` / `resolve-lines.ts` are server-only via `prisma`; **`workbook.ts` is server-only for a SECOND reason** — `xlsx` is a ~900KB CommonJS bundle with side effects that webpack cannot tree-shake out of anything a client component imports, which is why `queries.ts` takes its row type with `import type` (erased by `isolatedModules`). Same split, same reason, as `lib/mrn/workbook.ts` vs `lib/mrn/report.ts` | CI §14 |

Engineering note: a parallel session owns `scripts/_*` scratch files (sampling/report seed helpers) — they throw `tsc --noEmit` errors but are never committed; exclude `scripts/_*` from tsconfig or delete to keep the gate clean. Same treatment for `docs/dhruv-review/**` (added 2026-07-08) — a parked, untracked draft-review snapshot with its own stale/incomplete types; excluded from `tsconfig.json` for the same reason (never committed, not live code).

---

## Change log — v98 (2026-09-03, the CI module inventory)

The CI module — Goods Return Note — shipped from first table to register export in **four days and
nineteen commits** (`e8695f40` 2026-08-31 16:42 → `3b0d04b7` 2026-09-03 22:51) and this file had
**never heard of it**: a `grep ci_returns` over CORE returned zero hits the whole time. Eight edits,
all sourced from the code, the live schema and read-only SELECTs.

- **§7 — `v27.21` minted, BACK-DATED to 2026-08-31 and written as a record rather than a patch.**
  Three tables + five CHECKs + five named relations + `ci_returns.source` (2026-09-01) +
  `orders_invoiceNo_idx`, which had also never been recorded. 🔴 **Second time in a row** a module's
  tables reached production without entering this chain — v27.16/17 (MRN) was the first, and the
  entry two steps above it exists to explain that. Same shape both times: the tables land in one SQL
  pass, and the chain is the one artefact nothing enforces and no build step checks.
- **§7 — no §7 block is owed**, following v27.20's ruling for MRN. `docs/CLAUDE_CI.md` **v1.0** is
  the authority; the 2026-08-31 design draft is history (it describes nine API routes; there are
  twelve).
- **§5 — the page-key table gains `ci` AND `mrn`.** Neither was in it. Both carry the same
  three-role shape, SELECT-verified 2026-09-03, and the same designed asymmetry: `floor_supervisor`
  holds view+edit but **NOT canExport**, because the floor does the work and the REPORT is billing's.
- **§12 — the screens index gains `CI` AND `MRN`.** Neither was in it either. Leaving one module in
  and one out is the drift this pass exists to stop.
- **§12 — 🔴 `/ci` is reachable by URL only, and the reason is BEHAVIOURAL**, not an unfinished task:
  `MobileShell`'s phone Home target is `navItems[0]?.href`, so a `PAGE_NAV_MAP` entry at index ≤ 2
  steals `floor_supervisor`'s Home button from `/picking`. The three conditions a correct fix must
  satisfy are written out there, because "add the nav row" is the obvious move and it is wrong.
- **§13 — the id-space warning now travels with THREE module resolvers** (picking, mrn, ci). Each
  carries its own copy on purpose; deleting one as duplication removes the rule from the author who
  will never open this file.
- **§13 — the unattributed-write census is unchanged at 67, and that is worth saying:** CI added
  five mutating routes and **all five record an actor on the row itself**. That is the shape a new
  module should copy. Its one gap is MRN's: a hard delete (the auto-CI's zero-due-lines removal)
  records nobody.
- **§15 — `lib/ci/*` added**, with the client/server line stated, because `derive.ts` is imported
  **by value** by three client components and `workbook.ts` must never be.

⚠ **What this pass did NOT do:** re-reconcile the other domain files. Nine of twelve still carry
Schema v27.13 or v27.15 stamps against this file's v27.21 — in practice that stamp records the
version a file was last RECONCILED against, not the current schema, and none of v27.16-v27.21
touches their tables. `CLAUDE_PICKING.md` was bumped to **v1.16** for its new §11.7 back-reference
and its stamp deliberately left at v27.15 for that reason.

---

## Change log — v90 (2026-08-04 reconciliation pass, method v1.1)

Evidence: read-only SELECTs against production 2026-08-04 + call-site sweeps + git log. Claim IDs from the session report.

- CORE-1/2 (§4 tool table + §13): Auto-Import "PAUSED since 2026-05-14" → **LIVE** — 156 `[auto-import] auto-json` batches 2026-07-28→08-03; runs the v2 JSON path.
- CORE-3 (§4): env list gains `IMPORT_HMAC_SECRET_JSON` (required by the live v2 handlers).
- CORE-5 (§5): `operation_manager` confirmed real — role_master id 15, Prakash id 32 (settles the 2026-07-10 open item; source: web-test-plan draft, DB-verified).
- CORE-6/7 (§5): floor_supervisor/picker/support "Key users" updated to live accounts; Rahul has no active support account.
- CORE-8 (§5): `import_obd` grants row rebuilt from live (operations + operation_manager canImport, 2026-08-01 grant; dispatcher/support all-false drift now includes canImport).
- CORE-9 (§5): page key `customer_master` → **`customers`**; grants are admin/operation_manager/tint_manager, NOT ops_admin.
- CORE-10 (§5): `attendance_admin` page key row added; `attendance` row notes its no-DB-row design.
- CORE-11 (§7): version chain gains the unnumbered 2026-07-20/30/31 additions (pickEarlyReleased*, billing_settings, billingV2TestUser, invoicedAt/ById + partial index, mo_orders slot intent + lowercase FK name, sku_master_v2 display columns). No version minted — Smart Flow's counter.
- CORE-12 (§7.1): role_master "Roles 1-14" → ids 1-7 + 12-16.
- CORE-13 (§7.1.b): enum list completed (StatusDomain, SlotRuleType; PackCode = 17 real values) — pg_enum verified.
- CORE-14/15 (§7.1.c): sku_master_v2 17 → 19 columns; "skuDisplayName does not exist" bullet inverted to match reality (columns exist, inert).
- CORE-16 (§7.3): `mailMatched` — Support envelope consumer is archived; flag is write-only today; dead `SUPPORT §5` pointer removed.
- CORE-17/18 (§7.3, §7.6): orders billing/early-release columns + mo_orders slot intent documented.
- CORE-19 (§13): hide-filter consumer list rebuilt from live call sites (Floor five feeds + Billing Pending + Tint Summary in; retired Support/Planning/Warehouse out; Picking's deliberate non-application flagged).
- CORE-20 (§13): new landmine — Floor toggle-all/single-Esc-owner (from the unmerged 2026-07-26 action-surfaces draft; FLOOR session owns the full spec).
- CORE-21 (§15): rows for lib/billing/*, lib/dispatch/punch-clock.ts (doc homes pending).
- CORE-22 (§1): OBD pipeline line no longer names the retired Support/Planning steps as live.

## Change log — v92 (2026-08-05, reconciliation FINAL pass — 12b)

- FP-a (§7.8): attendance blocks rewritten from ATTENDANCE v1.3's live-verified list (re-SELECTed 2026-08-05) — three phantom columns out, names corrected, the two OT tables named with pointers.
- FP-b (§7.4): `pickEffectiveClock` + the `resolveArrivalClocks` input guard added to canon (cross-refs IMPORT §12.1b / FLOOR §8).
- FP-c (§3): the HMAC rule line now names the LIVE `auto-import-json-v1` string; `auto-import-v1` marked as the dead v1 handler's.
- FP-d (§4): parser row → the V7 line (repo v7.3.0, live ≥v7.2; MAIL_ORDERS §3 owns the ruling).
- FP-e (§5): `sampling_library` row rebuilt from live (five roles, all canView+canEdit — SELECT 2026-08-05).
- FP-f (§7): **v27.13 MINTED** — the unnumbered 2026-07-20/30/31 addendum is now the numbered entry; §7 heading, header and footer stamps updated; the four in-body "unnumbered" citations renumbered.
- (§6 Rahul: untouched — no owner answer accompanied this pass.)

## Change log — v91 (2026-08-04, IMPORT reconciliation follow-up)

- IMP-1 (§4 tool table, named row only): the Auto-Import row named the wrong file — the live script is **`Auto-Import-v2.ps1`** (pure JSON); `Auto-Import.ps1` "v2.0" is the v1 multipart script with zero batch evidence. Schedule wording replaced with the observed batch window; `F:\` path marked as describing the import PC (unverifiable from here). Evidence + detail: `CLAUDE_IMPORT.md v1.7 §10/§14`.

---

*CORE v100 · Schema v27.23 · OrbitOMS · updated 2026-09-04 — **THE ACCESS MODEL CHANGED. §5 is rewritten and now opens with a red block: access comes from `user_page_access` (one row per user per page key), a job title is a LABEL and a STARTING TEMPLATE that grants nothing, and `admin` is `users.isSuperuser`. The `ACCESS_SOURCE` panic button — both SQL statements, copy-paste ready — is at the top of §5 because somebody who has never seen it needs to find it in five seconds.** Two schema versions minted: **v27.22** `user_page_access` (§7.14, 1,053 rows = 39 users × 27 keys, parity-checked against the live role system at 0 diffs, which is why the cutover changed nobody's access) and **v27.23** `users.isSuperuser` (§7.15, 1 of 39 users, checked as flag OR role). §12 gains an **Admin → Access** entry, §11 records that `buildNavItems` kept its rule and changed its source — so `navItems[0]` Home must now be re-derived per PERSON, not per role — and §13 gains three landmines: the two-arm superuser rule (one account, and dropping the role arm is the one change that cannot be undone from inside the app), that `role_permissions` must NOT be dropped while the switch can be flipped back because it IS the rollback, and the 22 remaining `role !== "admin"` bypass sites that a second superuser would fall through. Numbers derived from the tree and live SELECTs, not from the brief — which said ~54 `requireRole` calls (58), 21 bypass sites (22) and 2026-08-31 for commit `0f56eede` (2026-08-30). Prior, v99 (2026-09-04): **§7.13 gained a COVERAGE block and §13 a deferral entry; no schema change, so the schema stamp holds at v27.21.** The old §7.13 line said the audit log was "wired at mint — 3 routes … the other 67 are §13"; both numbers were true on 2026-09-01 and neither survived 1b and 1c. The replacement is **derived, not quoted** — `grep -rn "logAdminAction({" app/` returns **43 call sites in 43 files**, one per route, matching 3 (`f00808c1`) + 32 (`e757ba78`/`2207aca4`) + 8 (`c3cf726b`). It also records the two sets that are NOT wired and why they differ: **14** excluded permanently (old `sku_master` family + Shade Master + dispatch-cutoffs — they retire with their screens) and **13** deferred by decision into the Sampling Library / MRN / Tint / Billing conversions, so those files are not edited twice. §13 carries the same warning in the place a later session will actually hit it: an unwired route looks identical whether it was missed or parked, and these were parked. The conventions the 43 share — entity naming, `entityId: null` for bulk, changed-fields-only diffs, one row per bulk run, naming a hidden second write in the summary — are written down for the first time, because until now they lived only in the wired routes. Also recorded: the census's §6c list A says "48 files" and enumerates **49**, which makes the real gap total **71**, not 70 (43 + 14 + 13 + 1 machine path); the draft is left unedited, being a record of its own date. The v27.18 chain entry's "the other 67 remain" clause is marked as history rather than current state. Prior, v98 (2026-09-03): **v27.21 (the CI module: `ci_reason_master` + `ci_returns` + `ci_return_lines`, five CHECKs, `orders_invoiceNo_idx`) MINTED LATE and back-dated to 2026-08-31**, written as a record because it is the SECOND time a module reached production without entering the version chain; `docs/CLAUDE_CI.md` v1.0 is its authority and no §7 block is owed, per the v27.20 ruling for MRN. §5 and §12 gained rows for **both** CI and MRN — neither module was in either index. 🔴 §12 records that `/ci` is URL-only because a `PAGE_NAV_MAP` entry at index ≤ 2 would steal `floor_supervisor`'s Home button from `/picking`. Earlier, in v97 — v27.19 (MRN photos + the `closed` status + `mrn_photos`) and v27.20 (the delivery split: `mrn_lines.deliveryNo` and its per-delivery unique index) recorded in the chain ON THE DAY, which is what the v27.16/17 entry exists to say was not done last time; the "a full §7 block for MRN is still owed" claim retired — `docs/CLAUDE_MRN.md` is now the authority. Earlier in v96: `admin_audit_log` minted (§7.13); the MISSING v27.16/v27.17 MRN entries bridged into the version chain; §5 mail_orders grant corrected (tint_manager is view+edit, live SELECT); three §13 landmines closed or corrected by the Mail Orders write-route fix*
