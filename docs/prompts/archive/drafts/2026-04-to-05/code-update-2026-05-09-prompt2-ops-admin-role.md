# Prompt 2 — Add `ops_admin` Role + Create Dhruv & Kuldeep Accounts

**Predecessor:** `code-update-2026-05-09-prompt1-role-schema-diagnosis.md`
**Successor:** Prompt 3 — Middleware whitelist + filtered sidebar for ops_admin
**Status:** Step 0 complete · STOPPED awaiting Smart Flow review before Step 1

---

## What this prompt does

Adds a new role `ops_admin` to the system end-to-end (DB, types, sidebar, permissions, login redirects), creates two user accounts (Dhruv, Kuldeep), and centralizes the two drift-prone `ROLE_REDIRECTS` maps into a single source in `lib/rbac.ts`. Also refreshes `prisma/seed.ts` so a fresh seed reproduces the full 10-role production set.

Foundation for the attendance pilot. Subsequent prompts: middleware whitelist (P3), PC no-camera fallback (P4), mobile route guard (P5), pilot activation SQL (P6).

---

## Decisions locked

| Decision | Value |
|---|---|
| Sidebar pattern for ops_admin | RoleSidebar (not admin sidebar) |
| Sidebar label | "Operations Admin" |
| Landing route after login | `/admin/attendance` |
| Attendance nav visibility | Add `attendance` to `ALL_PAGE_KEYS` + insert `role_permissions` row |
| Two ROLE_REDIRECTS maps | Centralize into `lib/rbac.ts` |
| `prisma/seed.ts` | Refresh to all 10 roles |
| User accounts | Dhruv + Kuldeep, role = `ops_admin`, `attendanceTestUser=true` |
| Initial password | `OpsAdmin@2026` (bcryptjs 10 rounds), rotated after first login |
| Phase 2 admin powers | NOT in this prompt — Phase 1 view-only |

---

## Constraints

- Schema changes via Supabase SQL Editor only. Never `prisma db push`.
- Sequential awaits — never `prisma.$transaction`.
- All new API routes: `export const dynamic = 'force-dynamic'`.
- `tsc --noEmit` must pass before commit.
- Supabase columns are camelCase.
- bcryptjs 10 rounds.
- No file deletions unless explicit. No new npm dependencies.
- Layout files: bare component pattern.
- Universal Header mandatory.

---

## Files read

Confirmed (full state retained from Prompt 1 plus refresh on schema head):

1. `prisma/schema.prisma` — `role_master`, `users`, `role_permissions`, `user_roles` (lines 60-161)
2. `prisma/seed.ts` — current seed shape (7 roles only)
3. `lib/rbac.ts` — `ROLES` const + guards
4. `lib/auth.ts` — JWT shape + role normalization
5. `auth.config.ts` — Edge config + Session type augmentation
6. `lib/permissions.ts` — `ALL_PAGE_KEYS`, `PAGE_NAV_MAP`, `buildNavItems()`
7. `components/shared/role-sidebar.tsx` — `RoleSidebarRole` union + `ROLE_LABELS`
8. `app/page.tsx` — root redirect (uses local `ROLE_REDIRECTS`)
9. `app/login/page.tsx` — login redirect (uses different local `ROLE_REDIRECTS`)
10. `app/login/login-form.tsx` — submits to `/`
11. `middleware.ts` — read for context only (Prompt 3 owns edits)

> All files read. Schema v27.1, RoleSidebar pattern confirmed, ROLES const at lib/rbac.ts:5-15.

---

## Step 0 — Database inspection · COMPLETE

**Method:** temporary `_tmp_role_inspect.mjs` script using `prisma.$queryRaw` for 4 read-only SELECTs against the production pooler. Script verified mutation-free before run, executed cleanly (exit 0), then deleted (not committed).

**Connection target verified:**
- `DATABASE_URL host = aws-1-ap-south-1.pooler.supabase.com:6543` ← production transaction-mode pooler (matches `CLAUDE_CORE.md §4`)
- `DIRECT_URL host = db.lgtcibgrzhmuhnxmxvmd.supabase.co:5432` ← production direct (port 5432, for `prisma generate`)

### 0.1 — `SELECT id, name, description FROM role_master ORDER BY id`

| id | name | description |
|---:|---|---|
| 1  | admin | System administrator |
| 2  | dispatcher | Builds and confirms dispatch plans |
| 3  | support | Reviews orders and sets dispatch status |
| 4  | tint_manager | Assigns tinting jobs to operators |
| 5  | tint_operator | Executes tinting jobs |
| 6  | floor_supervisor | Manages warehouse execution |
| 7  | picker | Picks material from warehouse |
| 12 | operations | Unified operations view across all boards |
| 13 | billing_operator | SAP billing operator — punches mail orders into SAP |

9 rows. **`ops_admin` does NOT exist** — safe to INSERT. Note the gap at IDs 8–11 (some prior role inserts/deletes left holes; harmless).

### 0.2 — Existing users matching Dhruv / Kuldeep

```
[]
```

**Zero matches** on either name (`'Dhruv'`, `'Kuldeep'`) or email (`ILIKE '%dhruv%' OR ILIKE '%kuldeep%'`). Safe to INSERT both.

### 0.3 — `SELECT MAX(id) AS max_role_id FROM role_master`

```
max_role_id = 13
```

So the `INSERT ... RETURNING id` for `ops_admin` will land at **id 14** via autoincrement. The playbook's `<OPS_ADMIN_ID>` placeholder approach handles this fine.

### 0.4 — `SELECT "roleSlug", "pageKey", "canView" FROM role_permissions WHERE "roleSlug" = 'admin' ORDER BY "pageKey"`

15 rows. Admin's stored `pageKey` set:

`customers`, `dashboard`, `dispatcher`, `import_obd`, `permissions`, `place_order`, `routes_areas`, `skus`, `support_queue`, `system_config`, `tint_manager`, `tint_operator`, `users`, `vehicles`, `warehouse`

All `canView = true`.

**Notable absences for admin:** `operations_support`, `operations_tinting`, `operations_tint_operator`, `operations_dispatch`, `operations_warehouse`, `mail_orders`, `delivery_challans`, `shade_master`, `ti_report`, `planning_board`, `attendance`. These are operationally harmless because admin bypasses `role_permissions` entirely via the 5 `roleSlug === "admin"` short-circuits in `lib/permissions.ts` (which return `ALL_TRUE` without a DB read). The 15 stored rows are legacy seed data and could be considered stale; deleting them is risk-free but out of scope here.

For reference, the canonical `pageKey` set per `lib/permissions.ts ALL_PAGE_KEYS` (current) is 25 keys; admin has rows for 15 of them. The playbook's Step 4.2 will add `attendance` to `ALL_PAGE_KEYS` (currently absent from the array but already in the `PageKey` type).

---

## Step 0 — Findings + flags for Smart Flow review

| Item | Status | Note |
|---|---|---|
| `ops_admin` already exists? | ❌ No | Safe to INSERT (id 14 by autoincrement) |
| Dhruv / Kuldeep users exist? | ❌ No matches | Safe to INSERT both |
| Production has all 9 roles from `lib/rbac.ts ROLES`? | ✅ Yes | Confirms diagnosis: seed.ts is out of date but DB is current |
| Admin's role_permissions matches `ALL_PAGE_KEYS`? | ⚠️ Partial | 15 of ~25 page keys; harmless because admin bypasses in code |
| `attendance` already in `ALL_PAGE_KEYS`? | (code-side check) | Per file read: NO — Step 4.2 fix still needed |
| Third copy of `ROLE_REDIRECTS` in repo? | (code-side check) | Per Prompt 1 grep: only 2 — both in `app/`. Step 1 handles. |

**Email convention check:** the playbook proposes `dhruv@orbitoms.com` / `kuldeep@orbitoms.com`. Existing prod users use the same `@orbitoms.com` convention (e.g. `admin@orbitoms.com`, `operations@orbitoms.com`). Matches.

**ID sparsity:** `role_master` has gaps at 8–11. Just an FYI — Postgres serial doesn't reuse holes. `ops_admin` will get 14, not 8.

---

## STOPPED — awaiting Smart Flow "go"

Per the playbook's Step 0 instruction: `STOP HERE. Do not proceed to Step 1 until Smart Flow reviews the DB inspection output and gives explicit "go".`

No code edits, no SQL writes, no schema changes have been made. The temp inspection script was deleted. Working tree on `feat/attendance-feature-complete` is unchanged from the start of this session apart from the new draft markdown files in `docs/prompts/drafts/`.

When you give "go", I will proceed with **Step 1 — Centralize ROLE_REDIRECTS** (lib/rbac.ts edit + import swaps in `app/page.tsx` and `app/login/page.tsx`, then `tsc --noEmit`).

---

## Out of scope (later prompts)

- Middleware whitelist for `ops_admin` → Prompt 3
- PC no-camera help card on `/attendance` → Prompt 4
- Mobile route guard → Prompt 5
- `UPDATE attendance_settings SET rolloutStage='TEST_USERS_ONLY'` → Prompt 6
- Phase 2 ops_admin manual-entry / edit / mark-exception → separate spec

---

## Acceptance criteria (locked, will be verified at end)

- [ ] `role_master` row exists for `ops_admin`
- [ ] `role_permissions` row: `(ops_admin, attendance, canView=true, canExport=true)`
- [ ] `users` rows for Dhruv + Kuldeep with `roleId → ops_admin`, `attendanceTestUser=true`
- [ ] `ROLES.OPS_ADMIN` constant in `lib/rbac.ts`
- [ ] `RoleSidebarRole` union includes `"ops_admin"`
- [ ] `ROLE_LABELS["ops_admin"] === "Operations Admin"`
- [ ] `ALL_PAGE_KEYS` array includes `"attendance"`
- [ ] `ROLE_REDIRECTS` exported from `lib/rbac.ts`; `app/page.tsx` and `app/login/page.tsx` import from it
- [ ] `prisma/seed.ts` upserts all 10 roles
- [ ] `tsc --noEmit` passes with zero errors
- [ ] Local smoke test passes for ops_admin, admin, tint_manager logins
- [ ] Production smoke test passes after Vercel deploy
- [ ] Commit pushed to `main`, Vercel deploy green

---

*Prompt 2 of 6 · Attendance pilot rollout · 2026-05-09 · Step 0 complete · awaiting go for Step 1*
