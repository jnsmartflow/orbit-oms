# Code discovery — Admin Panel

**Date:** 2026-08-28
**HEAD:** `e85f1562790bd7a42f274e02b03aa4755dca5090` (`main`, "floor: correct stale landing-view comment")
**Scope:** read-only discovery. **Nothing was changed.** No application code was written, edited,
archived, renamed or moved. No INSERT / UPDATE / DELETE / ALTER / DROP was issued.
**Live DB access:** read-only `SELECT`s via Prisma against production (`DATABASE_URL`, pooler),
per `CLAUDE_CORE.md §3`. Four throwaway query scripts were written, run, and moved out of the repo
to the session scratchpad; the repo tree is byte-identical to HEAD except for this file.

**Files read:** `CLAUDE.md`, `docs/CLAUDE_CORE.md` (v94 · Schema v27.15), `docs/CLAUDE_UI.md`
(v5.18), `docs/CLAUDE_ATTENDANCE.md` (v1.3 · Schema v27.13), `docs/ROADMAP.md` (2026-08-09),
`archive/RETIREMENT-PLAYBOOK.md` (2026-07-28), `components/admin/admin-sidebar.tsx`,
`lib/permissions.ts`, `lib/rbac.ts`, `middleware.ts`.

---

## 1. Master table — every admin page

**Walked the filesystem, not the sidebar.** Two route groups hold `/admin/*` URLs:
`app/(admin)/admin/` (27 pages) and `app/(ops)/admin/attendance/` (4 pages) — **31 pages** total.
A third `admin` directory exists, `app/api/admin/`, which holds 69 route handlers and no pages.
Verified two ways (`find -type d -name admin`, and a per-route-group directory walk); both agree.
One further screen is listed here because the **admin sidebar links to it** even though its URL is
not under `/admin`: `/tint/shades`.

Every page in the `(admin)` group inherits `components/admin/admin-header.tsx` — a hand-rolled 52px
breadcrumb + clock + sign-out bar mounted by `admin-layout-client.tsx`. That is the default and is
not repeated per row; the Header column names anything rendered **in addition to, or instead of,**
that bar.

Verdict key: **KEEP** = true admin · **MOVE** = daily operational board · **DUPLICATE** = a better
version exists elsewhere · **DEAD** = reads a retired/deprecated table, or its successor shipped.

| # | Route | File | Group | What it does | Header | Verdict |
|---|---|---|---|---|---|---|
| 1 | `/admin` | `app/(admin)/admin/page.tsx` | (admin) | 4 stat cards (users / routes / SKUs / customers) + last-8-users table | AdminHeader only | KEEP |
| 2 | `/admin/system-config` | `.../system-config/page.tsx` | (admin) | key-value editor over `system_config` (25 live rows) | AdminHeader only | KEEP |
| 3 | `/admin/users` | `.../users/page.tsx` | (admin) | user list, add / edit / reset password / activate | AdminHeader only | KEEP |
| 4 | `/admin/permissions` | `.../permissions/page.tsx` | (admin) | role × page permission matrix; writes `role_permissions` | AdminHeader only | KEEP |
| 5 | `/admin/roles` | `.../roles/page.tsx` | (admin) | read-only `role_master` list | AdminHeader only | KEEP |
| 6 | `/admin/delivery-types` | `.../delivery-types/page.tsx` | (admin) | read-only `delivery_type_master` (4 rows) | AdminHeader only | KEEP |
| 7 | `/admin/slots` | `.../slots/page.tsx` | (admin) | `slot_master` CRUD (6 rows) | AdminHeader only | KEEP |
| 8 | `/admin/slot-rules` | `.../slot-rules/page.tsx` | (admin) | full CRUD over `delivery_type_slot_config` — slot picker, cutoff windows, default flag | AdminHeader only | KEEP (see §7 — reads a table CORE calls dead) |
| 9 | `/admin/dispatch-cutoffs` | `.../dispatch-cutoffs/page.tsx` | (admin) | active/default **toggles** over the same `delivery_type_slot_config` rows | AdminHeader only | **DUPLICATE** |
| 10 | `/admin/routes` | `.../routes/page.tsx` | (admin) | `route_master` CRUD (20 rows) | AdminHeader only | KEEP |
| 11 | `/admin/areas` | `.../areas/page.tsx` | (admin) | `area_master` CRUD (390 rows) | AdminHeader only | KEEP |
| 12 | `/admin/sub-areas` | `.../sub-areas/page.tsx` | (admin) | `sub_area_master` CRUD (1 live row) | AdminHeader only | KEEP |
| 13 | `/admin/product-categories` | `.../product-categories/page.tsx` | (admin) | `product_category` CRUD (20 rows) | AdminHeader only | **DEAD** |
| 14 | `/admin/product-names` | `.../product-names/page.tsx` | (admin) | `product_name` CRUD (142 rows) | AdminHeader only | **DEAD** |
| 15 | `/admin/base-colours` | `.../base-colours/page.tsx` | (admin) | `base_colour` CRUD (82 rows) | AdminHeader only | **DEAD** |
| 16 | `/admin/skus` | `.../skus/page.tsx` | (admin) | CRUD over the **old** `sku_master` (1,051 rows) | AdminHeader only | **DEAD** |
| 17 | `/admin/skus/[id]/sub-skus` | `.../skus/[id]/sub-skus/page.tsx` | (admin) | 6-line stub, body is `redirect("/admin/skus")` | none (redirects) | **DEAD** |
| 18 | `/admin/transporters` | `.../transporters/page.tsx` | (admin) | `transporter_master` CRUD (25 rows) | AdminHeader only | KEEP |
| 19 | `/admin/vehicles` | `.../vehicles/page.tsx` | (admin) | `vehicle_master` CRUD (6 rows) | AdminHeader only | KEEP |
| 20 | `/admin/sales-officers` | `.../sales-officers/page.tsx` | (admin) | `sales_officer_master` CRUD (10 rows) | AdminHeader only | KEEP |
| 21 | `/admin/so-groups` | `.../so-groups/page.tsx` | (admin) | `sales_officer_group` CRUD (**0 live rows**) | AdminHeader only | KEEP |
| 22 | `/admin/contact-roles` | `.../contact-roles/page.tsx` | (admin) | `contact_role_master` CRUD (5 rows) | AdminHeader only | KEEP |
| 23 | `/admin/customers` | `.../customers/page.tsx` | (admin) | customer master split view over `delivery_point_master` (1,890 rows) + contacts + multi-SO | AdminHeader only | KEEP |
| 24 | `/admin/import` | `.../import/page.tsx` | (admin) | SAP OBD import screen — `<ImportPageContent viewOrdersHref="/floor" />` | AdminHeader only (no UniversalHeader, per UI §6) | **DUPLICATE** |
| 25 | `/admin/tint-manager` | `.../tint-manager/page.tsx` | (admin) | `<TintManagerContent />` — the Tint Manager board | AdminHeader (breadcrumb suppressed) **+ UniversalHeader** | **DUPLICATE** |
| 26 | `/admin/removed-orders` | `.../removed-orders/page.tsx` | (admin) | list + restore soft-deleted OBDs (43 live rows) | AdminHeader only | KEEP |
| 27 | `/admin/settings/hide` | `.../settings/hide/page.tsx` | (admin) | Rules / Hidden Orders / Tags tabs (2 rules, 0 hidden orders, 3 tag rows live) | AdminHeader only | KEEP |
| 28 | `/admin/attendance` | `app/(ops)/admin/attendance/page.tsx` | (ops) | daily attendance roster + 340px detail panel + selfie viewer | **attendance-page-header** (+ AdminHeader for an admin) | **MOVE** |
| 29 | `/admin/attendance/ot-pending` | `.../ot-pending/page.tsx` | (ops) | OT approval queue — approve / reject per claim | **attendance-page-header** (+ AdminHeader for an admin) | **MOVE** |
| 30 | `/admin/attendance/ot-audit` | `.../ot-audit/page.tsx` | (ops) | monthly OT audit report — 6 stat tiles + per-user expand | **attendance-page-header** (+ AdminHeader for an admin) | KEEP |
| 31 | `/admin/attendance/settings` | `.../settings/page.tsx` | (ops) | 6-section attendance/OT settings form | **attendance-page-header** (+ AdminHeader for an admin) | KEEP |
| 32 | `/tint/shades` *(admin-sidebar link, not an `/admin` URL)* | `app/(tint)/tint/shades/page.tsx` | (tint) | `<ShadeMasterContent />` over deprecated `shade_master` (133 rows) | **UniversalHeader**, and **no sidebar at all** | **DEAD** |

**Evidence for every DUPLICATE and DEAD verdict**

- **#9 `/admin/dispatch-cutoffs` — DUPLICATE of `/admin/slot-rules`.** Both pages query the same
  table with the same `include`: `dispatch-cutoffs/page.tsx:8` and `slot-rules/page.tsx:8` both call
  `prisma.delivery_type_slot_config.findMany`. Slot Rules is the richer one — it also loads
  `slot_master` for a slot picker and its API supports create/update of `slotId`, `windowStart`,
  `windowEnd` and `slotRuleType` (`app/api/admin/slot-rules/route.ts`), while Dispatch Cutoffs only
  toggles `isActive` / default (`app/api/admin/dispatch-cutoffs/[id]/route.ts`). Dispatch Cutoffs is
  also the orphan — it has no sidebar entry (§3).
- **#13/#14/#15 — DEAD.** `product_category`, `product_name` and `base_colour` are the three FK
  helpers of the old `sku_master`, which `CLAUDE_CORE.md §7.1.c` records as "dead to operations,
  pending drop" since v27.11. Their only non-admin readers are the three legacy `skus/page.tsx`
  browse pages, which read the same dead parent (§7).
- **#16 `/admin/skus` — DEAD.** `app/(admin)/admin/skus/page.tsx:24` reads `prisma.sku_master`.
  Its successor shipped: `sku_master_v2` holds 1,743 live rows to old `sku_master`'s 1,051, and the
  admin dashboard itself already counts the new table (`app/(admin)/admin/page.tsx`, the
  "2026-07-19b repoint" comment). `RETIREMENT-PLAYBOOK.md §8` names this screen a retirement
  candidate. ⚠ Read the id-space landmine in `CLAUDE_CORE.md §13` before touching any of this.
- **#17 `/admin/skus/[id]/sub-skus` — DEAD.** The page body is one `redirect("/admin/skus")`; its
  API sibling `app/api/admin/skus/[id]/sub-skus/route.ts` returns HTTP 410 with
  "sub-skus removed in schema v10" on both GET and POST.
- **#24 `/admin/import` — DUPLICATE of `/import`.** Both render the same component. `/import` is
  `<ImportPageContent />`; `/admin/import` is `<ImportPageContent viewOrdersHref="/floor" />`, and
  `components/import/import-page-content.tsx:206` already defaults that prop to `"/floor"` — so the
  two mounts are behaviourally identical. `/import` is the canonical one: it is the address in
  `PAGE_NAV_MAP` under `import_obd`. **`/admin/import` is not richer.**
- **#25 `/admin/tint-manager` — DUPLICATE of `/tint/manager`.** The two page files are identical
  apart from the function name; both are `return <TintManagerContent />`. `/tint/manager` is the
  canonical one (the `tint_manager` entry in `PAGE_NAV_MAP`, and the login landing for
  `tint_manager` / `operation_manager`). Neither file declares `export const dynamic`, which
  `CLAUDE_CORE.md §3` requires.
- **#28/#29 — MOVE.** These are daily operational boards by the owner's own rule: a per-day roster
  keyed on today's IST date, and a work queue of claims awaiting action. They are not user
  creation, master data, who-sees-what, or settings. **There is no other screen to move them to
  today** — see the open questions.
- **#32 `/tint/shades` — DEAD.** `CLAUDE_CORE.md §13` records `shade_master` as deprecated since
  2026-05-25, superseded by the Sampling Library; live row counts confirm the shift —
  `shade_master` 133 rows against `sampling_register` 4,756. `RETIREMENT-PLAYBOOK.md §8` lists it as
  the furthest-along retirement candidate. It is also byte-identical to
  `app/(tint)/tint/manager/shades/page.tsx`, and `PAGE_NAV_MAP` points the `shade_master` key at
  **that other address** while the admin sidebar and the Tint Operator layout point at this one.

---

## 2. The sidebar, dumped in full

From `components/admin/admin-sidebar.tsx`, lines 33-94. Reproduced exactly as written. Comments in
the source are preserved.

```tsx
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin" },
    ],
  },
  {
    label: "Master Data",
    items: [
      { label: "System Config",       href: "/admin/system-config" },
      { label: "Users",               href: "/admin/users" },
      { label: "Permissions",         href: "/admin/permissions" },
      { label: "Roles",               href: "/admin/roles" },
      { label: "Delivery Types",      href: "/admin/delivery-types" },
      { label: "Slot Master",         href: "/admin/slots" },
      { label: "Slot Rules",          href: "/admin/slot-rules" },
      { label: "Routes",              href: "/admin/routes",    pageKey: "routes_areas" },
      { label: "Areas",               href: "/admin/areas",     pageKey: "routes_areas" },
      { label: "Sub-areas",           href: "/admin/sub-areas" },
      { label: "Product Categories",  href: "/admin/product-categories" },
      { label: "Product Names",       href: "/admin/product-names" },
      { label: "Base Colours",        href: "/admin/base-colours" },
      { label: "SKUs",                href: "/admin/skus",      pageKey: "skus" },
      { label: "Transporters",        href: "/admin/transporters" },
      { label: "Vehicles",            href: "/admin/vehicles",  pageKey: "vehicles" },
    ],
  },
  {
    label: "People",
    items: [
      { label: "Sales Officers", href: "/admin/sales-officers" },
      { label: "SO Groups",      href: "/admin/so-groups" },
      { label: "Contact Roles",  href: "/admin/contact-roles" },
      { label: "Customers",      href: "/admin/customers",     pageKey: "customers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Import Orders", href: "/admin/import" },
      { label: "Tint Manager",  href: "/admin/tint-manager" },
      { label: "Shade Master",  href: "/tint/shades" },
      // CalendarCheck icon distinguishes the admin all-users view from
      // the personal "My Attendance" entry below (which uses ClipboardCheck).
      { label: "Attendance",    href: "/admin/attendance", icon: CalendarCheck },
    ],
  },
  {
    label: "Personal",
    items: [
      { label: "Attendance", href: "/attendance" },
    ],
  },
  {
    label: "Settings",
    items: [
      // pageKey "settings_hide" → admin sees it (ALL_TRUE), gated for everyone else.
      { label: "Hide", href: "/admin/settings/hide", pageKey: "settings_hide" },
    ],
  },
];
```

**Icons.** Each item takes `item.icon` if present, else `ICONS[item.label]`, else `LayoutDashboard`
(lines 100-128). Only the admin-Attendance row sets `icon:` explicitly (`CalendarCheck`), to
distinguish it from the personal Attendance row (`ClipboardCheck`).

**Gating (lines 161-168).**

```tsx
function visibleItems(items: NavItem[]) {
  return items.filter((item) => {
    if (item.pageKey) {
      return userRole === "admin" || allPerms[item.pageKey]?.canView === true;
    }
    return userRole === "admin";
  });
}
```

**⚠ That gating is unreachable today.** `AdminSidebar` is mounted from exactly two places
(`app/(admin)/admin/layout.tsx:23` and `app/(ops)/layout.tsx:43`), and both reach it only after an
admin check — `requireRole(session, [ROLES.ADMIN])` in the first, `if (roles.includes("admin"))` in
the second. So `userRole === "admin"` is always true, `allPerms` is always `ALL_TRUE`, and the six
`pageKey` branches never decide anything. The one theoretical exception: `(ops)/layout.tsx` passes
`primaryRole`, not the matched role, so a user holding **admin as a secondary role** would land in
the else branch. **No such user exists** — the only admin row in `user_roles` is user 1 (Harsh),
`isPrimary = true`.

---

## 3. Orphans, both directions

### 3a. Sidebar items with no page file behind them (dead links)

**Empty.** All 27 sidebar hrefs resolve to a real `page.tsx`. Checked by resolving each href against
the filesystem, then re-checked against `next.config.mjs` — its only two redirects target
`/tint/manager/ti-report` and `/ti-report`, neither of which is an admin address, and its two
rewrites are `/demo` and `/.well-known/assetlinks.json`. No admin page is hidden behind a redirect.

### 3b. Page files with no sidebar item pointing at them

**Six**, of which four are the attendance sub-pages that are reached by their own in-page switcher
rather than the sidebar.

| Route | File | How it is reached today |
|---|---|---|
| `/admin/dispatch-cutoffs` | `app/(admin)/admin/dispatch-cutoffs/page.tsx` | **Nothing links to it.** URL-only. |
| `/admin/removed-orders` | `app/(admin)/admin/removed-orders/page.tsx` | **Nothing links to it.** URL-only. `CLAUDE_CORE.md §12` documents it as a live admin screen. |
| `/admin/skus/[id]/sub-skus` | `app/(admin)/admin/skus/[id]/sub-skus/page.tsx` | **Nothing links to it.** URL-only, and it redirects straight back to `/admin/skus`. |
| `/admin/attendance/ot-pending` | `app/(ops)/admin/attendance/ot-pending/page.tsx` | strip-1 workflow switcher in `attendance-page-header.tsx` |
| `/admin/attendance/settings` | `app/(ops)/admin/attendance/settings/page.tsx` | same switcher |
| `/admin/attendance/ot-audit` | `app/(ops)/admin/attendance/ot-audit/page.tsx` | same switcher |

**One orphaned component, not a page:** `components/admin/operations-overview.tsx` exports
`OperationsOverview()` and **has zero importers** anywhere in `app/`, `components/` or `lib/`.

---

## 4. What is actually operations, not admin

Verdicts are in the master table column, with the evidence lines beneath it. Summary of the counts:

| Verdict | Count | Which |
|---|---|---|
| KEEP | 21 | dashboard, system-config, users, permissions, roles, delivery-types, slots, slot-rules, routes, areas, sub-areas, transporters, vehicles, sales-officers, so-groups, contact-roles, customers, removed-orders, settings/hide, attendance/ot-audit, attendance/settings |
| MOVE | 2 | `/admin/attendance`, `/admin/attendance/ot-pending` |
| DUPLICATE | 3 | `/admin/dispatch-cutoffs`, `/admin/import`, `/admin/tint-manager` |
| DEAD | 6 | `/admin/skus`, `/admin/skus/[id]/sub-skus`, `/admin/product-categories`, `/admin/product-names`, `/admin/base-colours`, `/tint/shades` |

Two notes on the MOVE verdicts, so they are not read as recommendations to build something:

- The attendance **roster** and **OT pending queue** are daily operational boards under the owner's
  stated rule. But there is no attendance module outside `/admin/attendance` for an admin or an
  ops_admin, and `ROLE_REDIRECTS` sends `ops_admin` to `/admin/attendance` at login
  (`lib/rbac.ts:42`). Moving them means choosing a new home first. That is an owner decision, §"Open
  questions".
- `attendance/settings` and `attendance/ot-audit` stay KEEP: one is a settings form, the other a
  monthly report, and neither is worked day to day.

---

## 5. The "who sees what" surface

### 5a. Every admin screen touching the permission tables

| Screen / route | File | Reads | Writes |
|---|---|---|---|
| `/admin/permissions` (page) | `app/(admin)/admin/permissions/page.tsx:12` | `role_permissions` | — |
| Permissions matrix (client) | `components/admin/permissions-manager.tsx:397` | — | POSTs to `/api/admin/permissions` |
| `POST /api/admin/permissions` | `app/api/admin/permissions/route.ts:51-73` | — | **upserts `role_permissions`** |
| `GET /api/admin/permissions` | same file, lines 9-18 | `role_permissions` | — |
| `GET /api/admin/permissions/[roleSlug]` | `app/api/admin/permissions/[roleSlug]/route.ts` | `role_permissions` | — |
| `/admin/roles` (page) | `app/(admin)/admin/roles/page.tsx:6` | `role_master` | — (read-only screen) |
| `/admin/users` (page) | `app/(admin)/admin/users/page.tsx` | `users`, `role_master` | — |
| `POST /api/admin/users` | `app/api/admin/users/route.ts:55` | `users` | **creates `users`** (incl. `roleId`) |
| `PATCH /api/admin/users/[id]` | `app/api/admin/users/[id]/route.ts:62` | `users` | **updates `users.roleId`**, name, email, isActive, password |

**`user_roles` has no admin screen and no API route at all.** A repo-wide search for the model
across `app/`, `lib/`, `components/`, `prisma/seed.ts` and `scripts/` returns exactly one hit, and
it is a comment (`lib/push/recipients.ts:16`). The table is read in one place only —
`lib/auth.ts:192`, via the `userRoles` include on login — and is populated by hand in the database.
It currently holds **29 rows across 21 users**, including every multi-role grant in production
(Ajay / Dhanraj / Priya / Prakash on `floor_access`, four users on `logistics`, Chandresh on
`tint_operator`). **None of that is manageable from the admin panel.**

Two follow-ons from `POST /api/admin/users`: a newly created user gets `users.roleId` and **no
`user_roles` row**. `lib/auth.ts:208` handles that — `const roles = allRoles.length > 0 ? allRoles :
[primaryRole]` — so the new user logs in fine with a single role. Adding a second role afterwards
requires a direct DB write.

`GET /api/admin/permissions` and `GET /api/admin/permissions/[roleSlug]` have **no callers** in the
repo; the page loads its rows server-side and the matrix only ever POSTs. An import is not a call,
and here there is not even an import.

### 5b. Does the Permissions screen build from `ALL_PAGE_KEYS`?

**No. It hardcodes its own lists.** `components/admin/permissions-manager.tsx` imports exactly one
thing from `lib/permissions.ts` — `import type { ActionKey }` (line 9). It never imports
`ALL_PAGE_KEYS`, `PageKey`, or `PAGE_NAV_MAP`. Both axes of the grid are local constants:

```tsx
// components/admin/permissions-manager.tsx:13-42
const ROLES_CONFIG = [
  { slug: "admin",            label: "Admin",          color: "#4338ca" },
  { slug: "dispatcher",       label: "Dispatcher",     color: "#dc2626" },
  { slug: "support",          label: "Support",        color: "#7c3aed" },
  { slug: "tint_manager",     label: "Tint Mgr",       color: "#d97706" },
  { slug: "tint_operator",    label: "Tint Op",        color: "#c2410c" },
  { slug: "floor_supervisor", label: "Floor Sup",      color: "#16a34a" },
  { slug: "picker",           label: "Picker",         color: "#0f766e" },
] as const;

const SECTIONS = ["Admin Panel", "Master Data", "Operations"] as const;

const PAGES_CONFIG = [
  // Admin Panel
  { key: "dashboard",     label: "Dashboard",      path: "/admin",               section: "Admin Panel" },
  { key: "users",         label: "Users",          path: "/admin/users",         section: "Admin Panel" },
  { key: "system_config", label: "System Config",  path: "/admin/system-config", section: "Admin Panel" },
  { key: "permissions",   label: "Permissions",    path: "/admin/permissions",   section: "Admin Panel" },
  // Master Data
  { key: "customers",     label: "Customers",      path: "/admin/customers",     section: "Master Data" },
  { key: "skus",          label: "SKUs",           path: "/admin/skus",          section: "Master Data" },
  { key: "routes_areas",  label: "Routes & Areas", path: "/admin/routes",        section: "Master Data" },
  { key: "vehicles",      label: "Vehicles",       path: "/admin/vehicles",      section: "Master Data" },
  // Operations
  { key: "import_obd",    label: "Import OBD",     path: "/import",              section: "Operations" },
  { key: "tint_manager",  label: "Tint Manager",   path: "/tint/manager",        section: "Operations" },
  { key: "tint_operator", label: "Tint Operator",  path: "/tint/operator",       section: "Operations" },
  { key: "dispatcher",    label: "Dispatcher",     path: "/dispatcher",          section: "Operations" },
  { key: "warehouse",     label: "Warehouse",      path: "/warehouse",           section: "Operations" },
] as const;
```

Consequences, all mechanical:

- The screen shows **13 page keys**. `ALL_PAGE_KEYS` has **26**. It is missing 15 live keys:
  `operations_tinting`, `operations_tint_operator`, `picking`, `floor`, `place_order`,
  `trip_report`, `mail_orders`, `mrn`, `delivery_challans`, `shade_master`, `sampling_library`,
  `ti_report`, `attendance`, `attendance_admin`, `settings_hide`.
- The screen shows **7 roles**. `role_master` holds **12**. It is missing `operations`,
  `billing_operator`, `ops_admin`, `operation_manager`, `logistics`, `floor_access`.
- The per-role count badge (`getViewCount`, line 382) counts only its own 13 keys, so it
  under-reports. `tint_manager` holds **17** live grant rows and the badge can never exceed 13.
- `handleSave` (line 387) builds updates for **every** non-admin role × **every** page in its
  config — 6 × 13 = 78 upserts — and `POST /api/admin/permissions` upserts all of them. It never
  deletes, so the 30 live grants outside its 13 keys survive a save untouched. Verified against
  live: of those 78 rows, **66 already exist and 12 would be created.**

### 5c. Do the seven retired page keys still appear?

Two of the seven do, all three occurrences in the Permissions UI. Swept two ways — MSYS `grep` over
quoted literals and ripgrep with an alternation — and both agree.

| Retired key | In `ALL_PAGE_KEYS` / `PageKey` / `PAGE_NAV_MAP`? | In the Permissions UI? | In live `role_permissions`? |
|---|---|---|---|
| `support_queue` | no (comment only, `lib/permissions.ts:19`) | no | no |
| `operations_support` | no (comment only, line 19) | no | no |
| `operations_warehouse` | no (comment only, line 28) | no | no |
| `operations_dispatch` | no (comment only, line 28) | no | no |
| `warehouse` | no (comment only, line 45) | **YES** — `permissions-manager.tsx:41`, and in the `NA_IMPORT` / `NA_DELETE` sets at lines 54 and 58 | no |
| `planning_board` | no (comment only, line 36) | no | no |
| `dispatcher` (**the page key**, not the role) | no (comment only, line 36) | **YES** — `permissions-manager.tsx:40`, and lines 54 and 58 | no |

So the three type-level surfaces are clean; the retired keys survive **only** in the admin
Permissions screen. Because the save writes every cell of its own grid, **pressing Save Changes on
that screen re-creates the 12 rows the retirement cleared** — `dispatcher` and `warehouse` × the six
non-admin roles. Confirmed by the 66-exist / 12-created count above: the 12 are exactly those.
Nothing reads them (neither key is in the `PageKey` union), so they would be inert rows, but they
are inert rows the retirement deliberately deleted.

⚠ Naming, per playbook §4: `permissions-manager.tsx:15` also carries `{ slug: "dispatcher" }`.
That is the **role**, which is live and must stay. Line 40 is the **page key**, which is retired.
Same word, two different lists, opposite status. Separately,
`components/shared/role-sidebar.tsx:23-24` lists `"planning"` and `"warehouse"` in
`RoleSidebarRole` — that is a third union again, of role names, and is out of scope here.

### 5d. Live `role_permissions` — every distinct pageKey, with row counts

Read-only `groupBy` against production, 2026-08-28. **115 rows total, 24 distinct page keys,
13 distinct role slugs.**

| pageKey | rows | | pageKey | rows |
|---|---|---|---|---|
| `attendance_admin` | 1 | | `permissions` | 7 |
| `customers` | 8 | | `picking` | 3 |
| `dashboard` | 7 | | `place_order` | 6 |
| `delivery_challans` | 2 | | `routes_areas` | 7 |
| `floor` | 3 | | `sampling_library` | 5 |
| `import_obd` | 10 | | `shade_master` | 1 |
| `mail_orders` | 4 | | `skus` | 7 |
| `mrn` | 3 | | `system_config` | 7 |
| `operations_tint_operator` | 1 | | `ti_report` | 2 |
| `operations_tinting` | 1 | | `tint_manager` | 8 |
| | | | `tint_operator` | 7 |
| | | | `trip_report` | 1 |
| | | | `users` | 7 |
| | | | `vehicles` | 7 |

- **Keys in the DB that are NOT in the `PageKey` union: none.** All 24 are union members.
- **Keys in the union with zero DB rows: two** — `attendance` and `settings_hide`. Both are
  by design. `lib/permissions.ts:130-141` special-cases `attendance` on user-level flags rather
  than a grant row, and lines 86-89 record that `settings_hide` is deliberately kept out of
  `PAGE_NAV_MAP` and resolves to `ALL_TRUE` for admin.

Role slugs present: `admin` 14, `tint_manager` 17, `floor_supervisor` 13, `dispatcher` 12,
`picker` 12, `support` 12, `tint_operator` 12, `operation_manager` 8, `operations` 7,
`billing_operator` 4, `ops_admin` 2, `floor_access` 1, `logistics` 1.

**`floor_access` (role_master id 17) is undocumented.** Its own description says
"Floor Control only - secondary role - added 2026-08-06 for Ajay/Priya/Prakash/Dhanraj", it holds
`floor` `canView`+`canEdit`, and four users carry it in `user_roles`. It appears in **none** of:
`CLAUDE_CORE.md §5`, `lib/rbac.ts` `ROLES`, `ROLE_REDIRECTS`, `prisma/seed.ts` `role_master`, or the
Permissions screen's `ROLES_CONFIG`.

### 5e. Live grid — `roleSlug IN ('admin','ops_admin')`

```
admin      customers                  V=true  I=true  X=true  E=true  D=true
admin      dashboard                  V=true  I=true  X=true  E=true  D=true
admin      floor                      V=true  I=false X=false E=true  D=false
admin      import_obd                 V=true  I=true  X=true  E=true  D=true
admin      permissions                V=true  I=true  X=true  E=true  D=true
admin      place_order                V=true  I=true  X=true  E=true  D=true
admin      routes_areas               V=true  I=true  X=true  E=true  D=true
admin      sampling_library           V=true  I=true  X=true  E=true  D=true
admin      skus                       V=true  I=true  X=true  E=true  D=true
admin      system_config              V=true  I=true  X=true  E=true  D=true
admin      tint_manager               V=true  I=true  X=true  E=true  D=true
admin      tint_operator              V=true  I=true  X=true  E=true  D=true
admin      users                      V=true  I=true  X=true  E=true  D=true
admin      vehicles                   V=true  I=true  X=true  E=true  D=true

ops_admin  attendance_admin           V=true  I=false X=true  E=false D=false
ops_admin  sampling_library           V=true  I=true  X=true  E=true  D=false
```

The 14 `admin` rows are cosmetic — every permission helper in `lib/permissions.ts` short-circuits on
`roleSlug === "admin"` before touching the table (lines 231, 246, 261, 281, 313). **`ops_admin` has
exactly two grants.** That is the whole of what it can see, and §6 works through what it means.

### 5f. Seed vs live

`prisma/seed.ts` seeds **10** roles and **24** permission rows, all by `upsert`, with **no
`deleteMany`** anywhere. Live has 12 roles and 115 rows. Live is the truth; the disagreements:

| Role | Key | Seed | Live | Effect of a wipe-and-reseed |
|---|---|---|---|---|
| `dispatcher` | `customers`, `skus`, `routes_areas`, `vehicles` | `canView: true` | **all `canView=false`** | silently re-grants 4 pages |
| `dispatcher` | `import_obd` | `canView: true, canImport: true` | **all false** | silently re-grants |
| `support` | same five keys | `canView: true` (+`canImport` on `import_obd`) | **all false** | silently re-grants |
| `tint_manager` | `skus`, `routes_areas`, `vehicles` | `canView: true` | **all `canView=false`** | silently re-grants 3 pages |
| `tint_manager` | `customers` | `canView: true, canEdit: false` | `canView=true, canEdit=true` | **downgrades** an editor to read-only |
| `role_master` | — | 10 rows | 12 rows | `operation_manager`, `logistics`, `floor_access` are not in seed; upsert means they survive, but a fresh DB would lack them |
| everything else | 91 live rows | absent from seed | live-only | survives (upsert, no delete), but seed is not a record of it |

The `dispatcher` / `support` half of this is already recorded in `CLAUDE_CORE.md §5`. **The
`tint_manager` half is not** — CORE's drift note names only dispatcher and support.

### 5g. Can a new user be created end to end today?

**Partly. Four of the seven things you would want are missing.**

The flow that works: `/admin/users` → "Add User" → `components/admin/add-user-sheet.tsx` collects
`name`, `email`, `password` + confirm, and **one** role from a `role_master` dropdown →
`POST /api/admin/users` → bcrypt hash at cost 10 → `prisma.users.create({ data: { name, email,
roleId, password: passwordHash } })`. The user can log in immediately, and `lib/auth.ts:208` falls
back to the primary role when `user_roles` is empty. Editing (`edit-user-sheet.tsx` →
`PATCH /api/admin/users/[id]`) can change name, email, role, active flag and password.

What is missing:

| Wanted | Status | Where it breaks |
|---|---|---|
| Name, email, password | ✅ works | — |
| **One** role | ✅ works | writes `users.roleId` only |
| **Multiple roles** (`user_roles`) | ❌ **absent** | `createSchema` (`route.ts:29-34`) has no roles array; nothing in the repo ever writes `user_roles` |
| **Phone** | ❌ **absent** | `users.phone` is a valid login identifier (`lib/auth.ts:185`, `CLAUDE_CORE.md §5`) and 26 of 38 live users have one, but neither `createSchema` nor `patchSchema` accepts it and no admin form has the field |
| **Reset password** | ✅ works | `reset-password-dialog.tsx` → the same PATCH |
| `attendanceTestUser` flag | ❌ absent | gates attendance rollout per `lib/permissions.ts:138`; DB-only |
| `billingV2TestUser` flag | ❌ absent | gates the Billing v2 pilot per `CLAUDE_CORE.md §7`; DB-only |

So: **a new user can be created with one role and a password, but cannot be given a phone number,
a second role, or either rollout flag without a direct database write.**

---

## 6. Who can even open the admin panel

### 6a. How `/admin` is gated

**By layout, not middleware, and not per page.** `middleware.ts` does not mention `/admin` at all —
it only checks the public-path list, the cron and HMAC exemptions, the (currently empty)
`PHASE1_BLOCKED` array, and then "no session → `/login`". Any authenticated user of any role passes
middleware for `/admin`.

The real gate is one line in each of the two group layouts:

```tsx
// app/(admin)/admin/layout.tsx:14-15   — covers all 27 pages in that group
const session = await auth();
requireRole(session, [ROLES.ADMIN]);
```

```tsx
// app/(ops)/layout.tsx:25-33           — covers the 4 attendance pages
const session = await auth();
if (!session?.user) redirect("/login");
const roles = session.user.roles ?? [session.user.role];
if (!roles.some((r) => ["admin", "ops_admin"].includes(r))) {
  redirect("/unauthorized");
}
```

`requireRole` (`lib/rbac.ts:58-66`) redirects to `/unauthorized` on a miss and checks
`session.user.roles ?? [session.user.role]`, so a secondary admin role would pass. Several pages add
their own redundant `checkPermission` on top (areas, routes, skus, vehicles, customers), which is
belt-and-braces inside an already admin-only group.

### 6b. What an `ops_admin` sees in the sidebar today

**They never see the admin sidebar at all.** `app/(ops)/layout.tsx` forks on line 38: an admin gets
`AdminLayoutClient` (the admin sidebar), and everyone else — which today means `ops_admin` — gets
`RoleLayoutClient` with the ordinary `RoleSidebar`, whose items come from `buildNavItems()` over
their live grants.

`ops_admin` holds two grants: `attendance_admin` and `sampling_library` (§5e). Walking
`PAGE_NAV_MAP` in order against those, and applying the `attendance` special case at
`lib/permissions.ts:136` (which returns **false** for `ops_admin` by design, to avoid a duplicate
Attendance row), their sidebar is exactly **two items**:

1. **Sampling Library** → `/tint/sampling-library`
2. **Attendance** → `/admin/attendance`

**Neither sends them to `/unauthorized`.** `/admin/attendance` is inside the `(ops)` group, which
admits `ops_admin` explicitly. `/tint/sampling-library` has its own layout gate
(`app/(tint)/tint/sampling-library/layout.tsx:25-28`) which calls
`checkAnyPermission(roles, "sampling_library", "canView")` — and `ops_admin` holds it.

Typing `/admin` directly does bounce them: `(admin)/admin/layout.tsx` is admin-only, so every other
admin URL redirects them to `/unauthorized`. Their login landing is `/admin/attendance`
(`lib/rbac.ts:42`), which resolves.

**But two API endpoints under a page they can open are admin-only, so parts of it fail for them:**

| Endpoint | Guard | Called from | Effect for `ops_admin` |
|---|---|---|---|
| `GET /api/admin/attendance/export` | `hasRole(session, [ROLES.ADMIN])` — line 42 | `attendance-page-header.tsx:10` (`triggerCsvExport`), on **all four** attendance pages | CSV export returns **403** |
| `GET /api/admin/attendance/photo` | `hasRole(session, [ROLES.ADMIN])` — line 19 | `user-detail-panel.tsx:76` (`<PhotoViewer>`) on the roster detail panel | selfie viewer returns **403** |

The other four attendance endpoints (`ot-audit`, `ot-pending`, `ot-pending/[recordId]`, `settings`)
all guard on `[ROLES.ADMIN, ROLES.OPS_ADMIN]` and work. Whether the two admin-only ones are
deliberate (photos are DPDP-sensitive; export is a bulk extract) or an oversight is an owner call.

### 6c. Admin pages and `app/api/admin/*` routes with no permission check

**Pages: none.** Every one of the 31 is covered by its group layout's gate. Nine `(admin)`-group
pages carry no gate of their own, which is correct — the layout has it, and two of them say so in a
comment (`removed-orders/page.tsx:4`, `settings/hide/page.tsx:4`).

**API routes: one, and it is inert.**
`app/api/admin/skus/[id]/sub-skus/route.ts` never calls `auth()`. Both its handlers return HTTP 410
with a fixed message and touch no data, so there is nothing to leak.

Nine other routes came back clean on a `requireRole` / `checkPermission` search and are **not**
ungated — they inline the check instead, as `if (session.user.role !== "admin") return 403`:
`hide/hidden-orders`, `hide/orders/[id]/hide`, `hide/orders/[id]/unhide`, `hide/rules`,
`hide/rules/[id]`, `removed-orders`, `removed-orders/[id]/restore`, `tag-settings`. Opening each
call site confirmed the check is present in every exported handler. One behavioural difference worth
recording: these read `session.user.role`, the **primary** role, whereas `requireRole` reads the
full `roles` array — so a user holding admin as a secondary role would be denied by these nine and
allowed by the rest. No such user exists today.

Two further observations, not gaps: `POST /api/admin/permissions` uses `prisma.$transaction`
(line 51), which `CLAUDE_CORE.md §3` forbids and §13 does not currently list among the known
exceptions. And `fix-slots` / `fix-challans` — the one-time backfill endpoints §13 says to keep —
are gated to `[ROLES.ADMIN, ROLES.OPERATIONS]`.

---

## 7. Dead data behind admin screens

File and line for every live read or write of a table `CLAUDE_CORE.md` marks dead or deprecated.
**Nothing was touched.**

### Old `sku_master` (1,051 rows; successor `sku_master_v2` has 1,743)

| File | Line | Op |
|---|---|---|
| `app/(admin)/admin/skus/page.tsx` | 24, 29 | findMany, count |
| `app/api/admin/skus/route.ts` | 62, 69, 90, 95 | findMany, count, findUnique, **create** |
| `app/api/admin/skus/[id]/route.ts` | 45, 51 | findFirst, **update** |
| `app/api/admin/skus/import/route.ts` | 83 | **createMany** |
| `app/(dispatcher)/dispatcher/skus/page.tsx` | 23, 24 | findMany, count *(outside /admin)* |
| `app/(tint)/tint/manager/skus/page.tsx` | 23, 24 | findMany, count *(outside /admin)* |

### `product_category` (20 rows) — FK helper of old `sku_master`

`app/(admin)/admin/product-categories/page.tsx:7` · `app/(admin)/admin/product-names/page.tsx:15` ·
`app/(admin)/admin/skus/page.tsx:30` · `app/api/admin/product-categories/route.ts:13,34,41` ·
`app/api/admin/product-categories/[id]/route.ts:26,30,38` ·
`app/api/admin/product-categories/import/route.ts:23` ·
`app/api/admin/product-names/import/route.ts:19` · `app/api/admin/skus/import/route.ts:22` ·
*(outside /admin)* `app/(dispatcher)/dispatcher/skus/page.tsx:25`,
`app/(tint)/tint/manager/skus/page.tsx:25`

### `product_name` (142 rows) — FK helper

`app/(admin)/admin/product-names/page.tsx:8` · `app/(admin)/admin/skus/page.tsx:31` ·
`app/api/admin/product-names/route.ts:17,43,50` · `app/api/admin/product-names/[id]/route.ts:27,31,39` ·
`app/api/admin/product-names/import/route.ts:36` · `app/api/admin/skus/import/route.ts:23` ·
*(outside /admin)* `app/(dispatcher)/dispatcher/skus/page.tsx:26`,
`app/(tint)/tint/manager/skus/page.tsx:26`

### `base_colour` (82 rows) — FK helper

`app/(admin)/admin/base-colours/page.tsx:7` · `app/(admin)/admin/skus/page.tsx:32` ·
`app/api/admin/base-colours/route.ts:13,34,41` · `app/api/admin/base-colours/[id]/route.ts:26,38,46` ·
`app/api/admin/base-colours/import/route.ts:23` · `app/api/admin/skus/import/route.ts:24` ·
*(outside /admin)* `app/(dispatcher)/dispatcher/skus/page.tsx:27`,
`app/(tint)/tint/manager/skus/page.tsx:27`

### `shade_master` (133 rows; deprecated 2026-05-25, superseded by `sampling_register`, 4,756 rows)

| File | Line | Op |
|---|---|---|
| `app/api/admin/shades/route.ts` | 41, 50 | findMany, count |
| `app/api/admin/shades/[id]/route.ts` | 34, 39 | findUnique, **update** |
| `app/api/tint/operator/shades/route.ts` | 88, 125, 178, 196 | findMany ×2, findFirst, **create** *(outside /admin)* |
| `app/api/tint/operator/shades/[id]/route.ts` | 86, 91 | findUnique, **update** *(outside /admin)* |

The screen behind these is `/tint/shades` (row 32 in the master table), linked from the admin
sidebar. ⚠ `CLAUDE_CORE.md §13` says shade_master "is no longer read or written by the live operator
workflow" — the **create** at `app/api/tint/operator/shades/route.ts:196` is still in the tree. I did
not determine whether any client reaches it; that is a Tint-module question, not an admin one.

### `delivery_type_slot_config` (6 rows)

| File | Line | Op |
|---|---|---|
| `app/(admin)/admin/dispatch-cutoffs/page.tsx` | 8 | findMany |
| `app/(admin)/admin/slot-rules/page.tsx` | 8 | findMany |
| `app/api/admin/dispatch-cutoffs/route.ts` | 12 | findMany |
| `app/api/admin/dispatch-cutoffs/[id]/route.ts` | 27, 32, 38 | findUnique, **updateMany**, **update** |
| `app/api/admin/slot-rules/route.ts` | 18, 62, 74, 90, 97 | findMany, findUnique, findFirst, **update**, **create** |
| `app/api/admin/slot-rules/[id]/route.ts` | 36, 60, 80, 87 | findUnique, findFirst, **update** ×2 |
| `app/api/admin/slots/[id]/route.ts` | 35 | count (delete guard) |

⚠ **Doc drift.** `CLAUDE_CORE.md §13` says this table "exists but not consumed anywhere". It is
consumed — by two admin screens and four admin API routes, which read **and write** it. What is
true is narrower: **no operational path reads it.** `lib/slots/slot-ruler.ts`, which stamps
`arrivalSlotId` at import, does not reference it. So the table is admin-only, written by admins and
read by nothing downstream.

### `dispatch_change_queue` (0 rows)

**No live readers or writers anywhere.** A repo-wide search over `app/`, `components/` and `lib/`
returns zero hits for `prisma.dispatch_change_queue`. This matches the ROADMAP item opened
2026-07-27: Support's edit route was its only writer, nothing ever read it, and the table is now
frozen and empty.

---

## 8. Consistency with the rest of the app

### 8a. Tables — three families, and only one follows the standard

`CLAUDE_UI.md §27` is the fixed-table standard (`table-layout: fixed` + `<colgroup>` + percentage
widths). ⚠ `CLAUDE_CORE.md §3` cites it as "§40" — §40 in the live UI file is *OT prompt screens*.
That is a stale cross-reference in CORE, not two different standards.

| Family | Surfaces | Files |
|---|---|---|
| **Follows §27** (fixed + colgroup) | 5 | `attendance/roster-table.tsx`, `attendance/ot-pending-table.tsx`, `attendance/ot-audit-table.tsx`, `hide-settings-content.tsx`, `removed-orders-content.tsx` |
| **shadcn `<Table>`** from `@/components/ui/table` — auto layout, no colgroup | 17 | `base-colours-table`, `contact-roles-table`, `customers-table`, `product-categories-table`, `product-names-table`, `sales-officers-table`, `skus-table`, `slot-rules-table`, `slots-table`, `so-groups-table`, `sub-areas-table`, `sub-skus-manager`, `transporters-table`, `users-table`, `vehicles-table`, plus inline tables in `delivery-types/page.tsx` and `roles/page.tsx` |
| **Hand-rolled `<table>`**, auto layout, own header typography | 4 | `areas-table.tsx:204`, `routes-table.tsx:195`, `csv-import-modal.tsx`, `admin/page.tsx` (Recent Users) |

§27's own "Applies to" list already names "Admin attendance roster", "Admin OT pending queue" and
"Admin OT audit user table" — and those three are exactly the ones that comply. **The 21 master-data
tables that make up most of the admin panel are outside the standard.**

### 8b. Headers

| Header | Admin surfaces |
|---|---|
| `admin-header.tsx` (hand-rolled 52px breadcrumb + clock + sign-out) | **all 27** `(admin)`-group pages, mounted by the layout; also the 4 attendance pages **when an admin views them**. It suppresses its own breadcrumb on `/admin/tint-manager` (line 70) |
| `attendance-page-header.tsx` (two-strip workflow switcher) | the 4 `(ops)` attendance pages — **by design, not a defect** (`CLAUDE_UI.md §6`, `CLAUDE_ATTENDANCE.md §9.0`) |
| `UniversalHeader` | 2 admin-reachable screens only: `/admin/tint-manager` (via `TintManagerContent`) and `/tint/shades` (via `ShadeMasterContent`) — both are duplicate/dead mounts of boards that live elsewhere |
| none | `/admin/skus/[id]/sub-skus` (redirects) |

So no genuine admin screen uses `UniversalHeader`, and the admin panel's own header is a hand-rolled
component that appears nowhere else in the app. `/admin/import` renders no `UniversalHeader`, which
UI §6 already records for `import-page-content.tsx`.

⚠ **`/tint/shades` drops the shell entirely.** `app/(tint)/layout.tsx` is a bare passthrough and
there is no layout under `tint/shades/`, so clicking "Shade Master" in the admin sidebar leaves the
admin frame and lands on a page with **no sidebar of any kind** — only `UniversalHeader`. The user's
only way back is the browser Back button.

### 8c. Mobile

**The admin panel does not inherit the mobile shell of `CLAUDE_UI.md §59.** `role-layout-client.tsx`
is the single global mount point for `MobileShellProvider` + the Home/Menu/You bar, and neither
`app/(admin)/layout.tsx` (a 5-line passthrough) nor `app/(admin)/admin/layout.tsx` routes through
it. The `(ops)` layout routes through `RoleLayoutClient` **only on its `ops_admin` branch**
(line 70); its admin branch uses `AdminLayoutClient` and does not.

It is not desktop-*only* either — `admin-sidebar.tsx` ships its own mobile affordances: a
`md:hidden` top bar with a hamburger (line 320) and a slide-in drawer (line 344). But
`admin-layout-client.tsx:23` sets the content offset as an **inline style**,
`marginLeft: isCollapsed ? "72px" : "240px"`, with no responsive breakpoint — so on a phone the page
body is pushed 72-240px right underneath a bar that is already overlaying it. I did not open this on
a device; see Confidence.

### 8d. How many distinct visual patterns

**About eight**, counting a pattern as a layout a reader would have to learn separately:

1. shadcn `<Table>` master-data list (17 surfaces — the dominant one)
2. hand-rolled `<table>` master-data list (areas, routes)
3. §27 fixed-layout table (attendance ×3, hide, removed-orders)
4. split view with a detail pane (`customers-split-view.tsx` — no `<table>` at all)
5. settings form (`system-config-form.tsx`, `dispatch-cutoffs-form.tsx`, attendance `settings-form.tsx`)
6. stat-card dashboard (`admin/page.tsx`)
7. bespoke permission matrix (`permissions-manager.tsx` — button grid, two tabs, its own role rail)
8. an embedded operational board with its own `UniversalHeader` (`/admin/tint-manager`, `/tint/shades`)

Plus the import screen (`import-page-content.tsx`), which is its own thing again if you count it.

---

## Open questions for the owner

1. **The Permissions screen shows 13 pages and 7 roles; the app has 26 page keys and 12 roles. What
   should it show?** Options: (a) generate both axes from `ALL_PAGE_KEYS` and `role_master` so it can
   never drift again; (b) keep a curated list but bring it up to date by hand; (c) leave it and
   manage the other 15 keys in the database.
2. **Saving the Permissions screen re-creates the 12 retired-page-key rows (`dispatcher` and
   `warehouse` × 6 roles) that the July retirements deleted. Remove those two rows from the screen?**
   Options: (a) delete them from `PAGES_CONFIG` and let the 12 stale rows never come back; (b) delete
   them and also clear any that got created; (c) leave them, since nothing reads the keys.
3. **`user_roles` is production-critical and has no admin screen.** Four people hold `floor_access`
   and four hold `logistics` purely through hand-written rows. Options: (a) build multi-role
   assignment into the Users screen; (b) keep it a database operation and document that; (c) collapse
   secondary roles into permissions instead.
4. **A new user cannot be given a phone number from the admin panel, but a phone is a valid login
   identifier and 26 of 38 live users have one.** Options: (a) add phone to the add and edit user
   forms; (b) leave it as a database field only.
5. **The `floor_access` role exists live (id 17, four users, holds `floor`) but is in no document, no
   constant, and no seed row.** Options: (a) add it to `lib/rbac.ts`, `ROLE_REDIRECTS`, the seed and
   CORE §5; (b) fold those four users into an existing role; (c) record it as deliberately informal.
6. **Where should the attendance roster and the OT pending queue live, if not under `/admin`?** They
   are daily operational boards, but `ops_admin` lands on `/admin/attendance` at login and there is
   no attendance module elsewhere. Options: (a) leave them where they are and accept the exception;
   (b) give attendance its own top-level route and repoint the `ops_admin` landing; (c) move only the
   OT pending queue.
7. **`ops_admin` can open the attendance dashboard, but the CSV export and the selfie viewer both
   return 403 for them.** Options: (a) deliberate — photos are personal data and export is a bulk
   extract, so leave it and hide the two controls for them; (b) an oversight — widen both guards to
   `[ADMIN, OPS_ADMIN]` like the other four attendance routes.
8. **Six screens read tables marked dead: the old `sku_master` plus its three FK helpers, and
   `shade_master`.** Options: (a) retire them now, following the playbook; (b) hide them from the
   sidebar but leave the routes reachable; (c) leave everything until the `sku_master` drop session,
   which they must be part of anyway.
9. **`/admin/dispatch-cutoffs` duplicates `/admin/slot-rules` over the same 6 rows and is linked from
   nowhere.** Options: (a) retire the cutoffs page; (b) keep it as a quick-toggle view and add it to
   the sidebar; (c) leave it URL-only.
10. **`/admin/tint-manager` and `/admin/import` are second mounts of `/tint/manager` and `/import`.**
    Options: (a) retire both admin mounts and point the sidebar rows at the canonical addresses;
    (b) keep them so an admin never leaves the admin frame; (c) keep `/admin/import` only, since
    importing is arguably an admin act.
11. **`/admin/removed-orders` is a documented live admin screen with no sidebar entry.** Options:
    (a) add it, probably under Settings; (b) leave it URL-only on purpose.
12. **21 of the admin panel's tables ignore the §27 fixed-table standard that the rest of the app
    follows.** Options: (a) convert them in one pass; (b) convert only the ones you actually work in;
    (c) accept two table styles and write the exception into UI §27.
13. **`prisma/seed.ts` would re-grant five pages to `dispatcher` and `support`, three to
    `tint_manager`, and downgrade `tint_manager`'s customer edit rights.** Options: (a) update the
    seed to match live; (b) stop treating the seed as a source of truth for permissions and say so;
    (c) leave it, since a wipe-and-reseed is not planned.

---

## Confidence

Everything above came from reading the files at HEAD `e85f1562` and from read-only `SELECT`s against
production. These specific points are weaker, and are listed so nobody treats them as verified:

- **Nothing was observed in a running browser.** No dev server was started and no account was used
  (per the standing rule against production credentials). Every statement about what a user *sees* is
  derived from reading layouts, gates and live grant rows.
- **The `ops_admin` two-item sidebar (§6b) is computed, not observed.** I walked `PAGE_NAV_MAP` in
  source order against the two live grants and applied the `attendance` special case by hand. It
  should be confirmed on a real `ops_admin` session.
- **The 403s on the attendance export and photo endpoints (§6b) are inferred** from the route guards
  plus the presence of the two call sites. I did not issue a request as an `ops_admin`.
- **The mobile claim in §8c is inferred from CSS**, specifically the non-responsive inline
  `marginLeft` in `admin-layout-client.tsx:23`. Nothing was rendered at a phone width.
- **`components/admin/attendance/export-button.tsx` exports both `ExportButton` and
  `triggerCsvExport`; only `triggerCsvExport` has an importer.** Whether `<ExportButton>` itself is
  ever rendered was not chased down.
- **The "about eight visual patterns" count in §8d is a judgement**, not a measurement. Someone
  splitting or merging categories would reasonably land between six and ten.
- **`app/api/tint/operator/shades/route.ts:196` still creates `shade_master` rows**, which sits
  awkwardly beside CORE §13's "no longer written by the live operator workflow". I recorded the line
  but did not check whether any client reaches that handler — capability is not reachability, and
  resolving it belongs to a Tint session.
- **The four query scripts** used for the live SELECTs were moved to the session scratchpad rather
  than left in `scripts/`. They are reproducible from the queries described in §5d, §5e and §7.
- **Grep hygiene:** every address and page-key sweep was run twice, once with MSYS `grep` over
  quoted literals and once with ripgrep using char-class alternations. All sweeps reconciled. The
  page-file inventory was likewise built two ways and both returned 31.
