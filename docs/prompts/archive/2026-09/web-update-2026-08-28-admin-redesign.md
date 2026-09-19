# Admin Panel Redesign — decisions + new nav map

**Date:** 2026-08-28
**Type:** `web-update` — decisions taken on Claude.ai, not yet built.
**Basis:** `docs/prompts/drafts/code-discovery-2026-08-28-admin-panel.md` (read-only discovery at HEAD `e85f1562`).
**Owner rule that drives all of this:** *admin is for user creation, master data, who-sees-what,
and settings. Operational boards do not belong here.*

---

## 1. What was actually wrong

Three separate problems, not one:

1. **The Permissions screen is broken as a control surface.** It renders 13 page keys of the live
   26 and 7 roles of the live 12, from two hardcoded arrays in
   `components/admin/permissions-manager.tsx`. Its Save writes every cell of its own 6 × 13 grid,
   so pressing Save **re-creates the 12 `dispatcher` / `warehouse` permission rows that the July
   retirements deliberately deleted**. The screen that is supposed to answer "which page for which
   user" is the least trustworthy screen in the panel.
2. **There is no admin surface for `user_roles` at all.** 29 rows across 21 users — every
   secondary-role grant in production, including four users on `floor_access` and four on
   `logistics` — exist only as hand-typed database rows. `users.phone` is the same story: a valid
   login identifier on 26 of 38 live users, with no field on either admin form.
3. **The nav is a 27-item flat wall** carrying 4 operational items, 6 pages over dead tables, and
   3 real pages that appear in no section.

Nothing crashes. `admin-sidebar.tsx`'s per-item `pageKey` gating is dead code — both mount points
are already admin-only, so `userRole === "admin"` is always true and the six `pageKey` branches
never decide anything.

---

## 2. Decisions

All thirteen open questions from the discovery, answered.

| # | Question | Decision |
|---|---|---|
| 1 | Permissions screen axes | **Generate both axes from the app's own constants** — rows from `ALL_PAGE_KEYS`, columns from live `role_master`. It can then never drift again. |
| 2 | Retired page keys on that screen | **Fall out automatically with #1.** Plus one SQL to clear any `dispatcher` / `warehouse` rows a Save has already created. |
| 3 | `user_roles` | **Build multi-role assignment into the Users screen.** |
| 4 | Phone on the user form | **Add it** to both add and edit, 10-digit only (matches the live `CHECK`). |
| 5 | `floor_access` role | **Document it properly** — `lib/rbac.ts` `ROLES`, `prisma/seed.ts` `role_master`, `CLAUDE_CORE.md §5`. It is live with 4 users and in no file; a wipe-and-reseed would lose it. No `ROLE_REDIRECTS` entry — it is secondary-only, never a primary role. |
| 6 | Attendance (4 screens) | **Stay in admin, under a People & Access group.** Attendance is staff administration, not depot order operations, so it does not breach the owner rule. `ops_admin`'s login landing is unchanged. |
| 7 | `ops_admin` gets 403 on CSV export + selfie viewer | **Treat as deliberate — hide the two controls for `ops_admin` instead of widening the guards.** Selfies and a bulk attendance export are the two most personal things in the app. A hidden control is honest; a button that 403s is not. *(Override this if Dhruv and Kuldeep actually need the export.)* |
| 8 | 6 screens over dead tables | **Remove from the nav now; leave the routes and the code alone.** Deleting them drags in the `sku_master` id-space landmine (`CLAUDE_CORE.md §13`) and belongs to the retire-old-table session. |
| 9 | `/admin/dispatch-cutoffs` | **Retire.** Duplicate of Slot Rules over the same 6 rows, linked from nowhere. |
| 10 | `/admin/tint-manager`, `/admin/import` | **Both leave the admin panel.** Canonical addresses `/tint/manager` and `/import` stay. Nav gains an app-switcher so an admin still has a way out. |
| 11 | `/admin/removed-orders` | **Add to the nav**, under Settings. |
| 12 | 21 tables off the §27 fixed-table standard | **Convert during the rebuild.** This is what "in sync with the app" means. |
| 13 | Seed vs live permissions | **Update `prisma/seed.ts` to match live.** Today a reseed would silently re-grant 5 pages to `dispatcher` and `support`, 3 to `tint_manager`, and downgrade `tint_manager`'s customer edit rights. |

---

## 3. The new nav

**19 items in 5 groups**, down from 27 in 6. Every group answers one of the four things admin is for.

```
OVERVIEW
  Dashboard                    /admin

PEOPLE & ACCESS
  Users                        /admin/users
  Roles & Access               /admin/access            ← Permissions + Roles, merged
  Attendance                   /admin/attendance        ← keeps its own 4-tab switcher

CUSTOMERS
  Customers                    /admin/customers
  Sales Officers               /admin/sales-officers
  SO Groups                    /admin/so-groups
  Contact Roles                /admin/contact-roles

DEPOT MASTER
  Routes                       /admin/routes
  Areas                        /admin/areas
  Sub-areas                    /admin/sub-areas
  Delivery Types               /admin/delivery-types
  Slot Master                  /admin/slots
  Slot Rules                   /admin/slot-rules
  Transporters                 /admin/transporters
  Vehicles                     /admin/vehicles

SETTINGS
  System Config                /admin/system-config
  Hide                         /admin/settings/hide
  Removed Orders               /admin/removed-orders

── footer ──────────────────────────────
  My Attendance                /attendance
  Open OrbitOMS  ▸             app switcher
```

### Leaving the nav

| Item | Why | What happens to the route |
|---|---|---|
| Import Orders | operational; `/import` is canonical | route stays, reachable from the app switcher |
| Tint Manager | operational; `/tint/manager` is canonical | route stays for now, retire in a later pass |
| Shade Master | dead table, and it drops the admin shell entirely — no sidebar, browser Back is the only way home | route stays |
| SKUs · Product Categories · Product Names · Base Colours | all four read the dead `sku_master` family | routes stay, retire with the SKU drop |
| Dispatch Cutoffs | duplicate of Slot Rules | retire |
| `/admin/skus/[id]/sub-skus` | a redirect stub whose API returns 410 | retire |

### Two things the new nav must add

- **App switcher in the footer.** Once the 4 operational items leave, an admin has no link out of
  the admin frame. A small popover — Floor · Picking · Tint Manager · Mail Orders · Reports · Import
  — solves it without putting operations back in the nav.
- **A gap this creates, named honestly:** hiding `/admin/skus` leaves **no browse screen for the
  live catalog**. `sku_master_v2` (1,743 rows) has no admin UI at all. Either accept that the
  catalog is SQL-maintained (it already is), or add a small read-only SKU browser later. Not in
  scope for this rebuild — ROADMAP item.

---

## 4. The two screens that get rebuilt, not restyled

Everything else in the nav is a restyle. These two are the actual repair.

### 4a. Roles & Access — `/admin/access`

Merges the read-only Roles list and the Permissions matrix into one screen with two tabs.

- **Rows:** all page keys, read from `ALL_PAGE_KEYS`. Grouped by section derived from
  `PAGE_NAV_MAP`, not from a hand-written section list.
- **Columns:** all roles, read from live `role_master` — 12 today, and 13 when `floor_access` is
  documented. Never a hardcoded array again.
- **The `admin` column is read-only and visibly marked "always on"** — every permission helper in
  `lib/permissions.ts` short-circuits on `roleSlug === "admin"` before touching the table, so its
  14 live rows are cosmetic. Showing editable checkboxes that change nothing is a lie.
- **Two keys are marked as special-cased, not editable:** `attendance` (driven by user-level flags,
  no grant row by design) and `settings_hide` (admin-only, deliberately outside `PAGE_NAV_MAP`).
- **Save writes only the cells that changed.** Today's Save upserts all 78 cells of its grid
  whether they changed or not; that is the mechanism that resurrects retired rows.
- **`POST /api/admin/permissions` currently uses `prisma.$transaction`** (`route.ts:51`), which
  CORE §3 forbids and §13 does not list as an accepted exception. Fix it to sequential awaits in
  the same pass.

### 4b. Users — `/admin/users`

The add and edit forms gain four fields:

| Field | Notes |
|---|---|
| **Phone** | 10 digits only, no `+91`, no spaces or dashes. Live `CHECK (phone ~ '^[0-9]{10}$')` and a partial unique index. Must be nullable. |
| **Secondary roles** | Multi-select writing `user_roles`. **The partial unique index `UNIQUE (userId) WHERE isPrimary = true` means the demote-then-promote rule applies** — clear the existing primary before writing the new one, never the reverse (CORE §3, the P2002 reconcile pattern). |
| **Attendance test user** | `users.attendanceTestUser` — gates the attendance rollout. |
| **Billing v2 test user** | `users.billingV2TestUser` — gates the Billing v2 pilot. Read fresh per page load, deliberately not JWT-cached. |

---

## 5. Visual standard

The admin panel is to look like the rest of the app, with one deliberate exception.

- **Tables → the §27 fixed-table standard** (`table-layout: fixed` + `<colgroup>` + percentage
  widths) for all 21 master-data tables. Today only 5 admin surfaces comply, and they are the three
  attendance tables plus Hide and Removed Orders. Three table families become one.
  ⚠ `CLAUDE_CORE.md §3` cites this standard as "§40" — §40 in the live UI file is *OT prompt
  screens*. That is a stale cross-reference in CORE and should be corrected to §27 in the same pass.
- **Header → `admin-header.tsx` stays**, as the admin frame's own identity. It is a named exception
  to the `UniversalHeader` rule, like `/floor`, and should be written into `CLAUDE_UI.md §6` as one
  rather than left undocumented. No genuine admin screen uses `UniversalHeader` today; the only two
  that do are the duplicate mounts that are leaving.
- **Attendance keeps `attendance-page-header.tsx`** and its 4-tab workflow switcher. That is
  deliberate and already documented (`CLAUDE_UI.md §6`, `CLAUDE_ATTENDANCE.md §9.0`) — not a defect
  to fix.
- **Mobile.** `admin-layout-client.tsx:23` sets the content offset as an inline
  `marginLeft: isCollapsed ? "72px" : "240px"` with **no responsive breakpoint**, so on a phone the
  page body is pushed 72–240px right underneath the hamburger bar that is already overlaying it.
  Fix the offset; the sidebar's own `md:hidden` bar and drawer already exist and work.
  The admin panel does **not** route through `role-layout-client.tsx` and so does not inherit the
  §59 mobile shell — leave it that way, it has its own drawer.
- **Dead code to remove while in there:** `components/admin/operations-overview.tsx` has zero
  importers anywhere in `app/`, `components/` or `lib/`.

---

## 6. Build order

Each step is its own Claude Code prompt and its own commit. Nothing here is irreversible except
step 6, which gets a gate.

| Step | What | Risk |
|---|---|---|
| 1 | Mockup — new nav + Roles & Access + Users forms, as HTML in `docs/mockups/admin/` | none |
| 2 | Rebuild Roles & Access from `ALL_PAGE_KEYS` + `role_master`; drop the `$transaction`; save only changed cells | medium — read it against live before trusting it |
| 3 | SQL: clear any resurrected `dispatcher` / `warehouse` rows; document `floor_access`; align `prisma/seed.ts` with live | **SELECT the survivors and the casualties in the same block before anything is deleted** |
| 4 | Users screen — phone, secondary roles, two rollout flags | medium — the `isPrimary` partial index rule |
| 5 | New nav structure + app switcher + mobile offset fix | low |
| 6 | Table conversion to §27, in batches by group | low each, tedious in bulk |
| 7 | Retire `/admin/dispatch-cutoffs` and the sub-skus stub | **gate first** — playbook §7 |

**Not in this project:** the `sku_master` family retirement, the Shade Master retirement, and the
`/admin/tint-manager` + `/admin/import` route removals. All four leave the nav here and are deleted
in their own sessions, each with its own gate.

---

## 7. Docs this will touch when it ships

- `CLAUDE_CORE.md §5` — the admin sidebar note (`NAV_SECTIONS` sections change), `floor_access`,
  the `tint_manager` half of the seed/live drift (CORE currently names only dispatcher and support).
- `CLAUDE_CORE.md §3` — the "§40" → "§27" fixed-table cross-reference.
- `CLAUDE_CORE.md §12` — the Admin screens-index entry.
- `CLAUDE_CORE.md §13` — `delivery_type_slot_config` is recorded as "not consumed anywhere". It is:
  two admin screens and four admin API routes read **and write** it. The true statement is narrower —
  *no operational path reads it*.
- `CLAUDE_UI.md §6` — `admin-header.tsx` as a named exception alongside `/floor`.
- `CLAUDE_UI.md` — a new section for the admin panel's own layout, replacing whatever §57 implies
  about the Settings section.
- `ROADMAP.md` — the live-catalog browse gap; the four deferred retirements.
