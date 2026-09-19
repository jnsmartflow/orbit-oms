# Code discovery — admin shell state, before the nav rebuild
# 2026-09-06 · READ-ONLY · no application code written, edited or moved · Lives in: docs/prompts/drafts/

**Type:** `code-discovery` — the state of the admin SHELL (nav + layout) as it exists at
`200882f0`, read against the 2026-08-28 redesign decisions and the 2026-09-04 / 2026-09-06 access
migration. **Nothing was changed.** The only file created is this one.

**Scope discipline.** The access system (`user_page_access`, `ACCESS_SOURCE`, `users.isSuperuser`,
`/admin/access`) is DONE and is not touched or proposed against here. It is read only as the thing
the shell must now agree with.

**Evidence:** the files on disk, **`npx next build`'s route table (run 2026-09-06, exit 0)**, read-only SELECTs, and two independent
grep sweeps per question (ripgrep with `[/]` char classes, then MSYS `grep` over quoted literals).
Every sweep is printed with both results. **No login was used and nothing was observed in a
browser** — anything behind auth 307s to `/login`, so a live route and a dead one look identical
from outside.

---

## 0. The four answers, in one line each

- **Q1.** `NAV_SECTIONS` today is **28 items in 6 groups**, not the 27-in-6 the 08-28 discovery
  recorded — **Access** was added on 2026-09-04 and is present at `admin-sidebar.tsx:67`. The file
  has not moved. 🔴 **Rebuilding `NAV_SECTIONS` alone is NOT enough:** the filter is
  `userRole === "admin"` on the **singular primary job title** — the last job-title gate in the
  admin shell, and the one thing here the access migration did not convert.
- **Q2.** **All 21 proposed rows resolve to a real `page.tsx`.** No dead links, no redirects, no
  middleware entries, and **not one resolves to a `/dispatcher/*` screen**. Three resolve somewhere
  the 08-28 design did not assume. `/admin/permissions` stays reachable by URL after it leaves the
  menu — its page and its superuser gate are untouched.
- **Q3.** `PAGE_NAV_MAP` lives in `lib/permissions.ts:19-108` and carries **`{ pageKey, label, href }`
  — labels YES, icons NO.** Icons live in a *different* file, `components/shared/role-sidebar.tsx`'s
  `ICON_MAP`, which covers 18 of the 27 keys. **Two of the six addresses the mockup's app switcher
  offers have no icon there**, and one of the six is not in `PAGE_NAV_MAP` at all under that name.
- **Q4.** Beyond decisions 1-3, **eight further assumptions in the 08-28 draft are now false**, and
  three of its findings are still exactly true. Detail in §4.

---

## Q1 — WHAT IS IN THE MENU TODAY

### Q1a. `NAV_SECTIONS`, verbatim

`components/admin/admin-sidebar.tsx:33-98`. Reproduced exactly, comments preserved.

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
      // Per-user page access (2026-09-04, step 3 of the role→user conversion).
      // Admin-only by construction: no pageKey, so visibleItems() shows it to
      // admin alone — the same gate every other keyless item here uses.
      { label: "Access",         href: "/admin/access", icon: ShieldCheck },
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

**Count: 28 items in 6 groups** — Overview 1 · Master Data 16 · People 5 · Operations 4 · Personal 1
· Settings 1. *(The 08-28 discovery recorded 27 in 6; **Access** is the 28th, added 2026-09-04.)*

**Page keys used: three, on six items.** `routes_areas` (Routes, Areas), `skus` (SKUs), `vehicles`
(Vehicles), `customers` (Customers), `settings_hide` (Hide). **The other 22 items carry no page key
at all.**

**Icons.** Two items pass an explicit `icon:` (Access → `ShieldCheck`, admin Attendance →
`CalendarCheck`); the rest resolve through `ICONS[item.label]` at `admin-sidebar.tsx:104-132`, a
**label-keyed** map (not page-key-keyed) with 27 entries. `ICONS` carries one dead row — `"My Tint
Jobs"` → `Paintbrush` — matching no item in `NAV_SECTIONS`. The resolution order is
`item.icon ?? ICONS[item.label] ?? LayoutDashboard` (`:188`, `:225`).

⚠ **The icon map is keyed on the LABEL string.** Relabelling "Roles" to "Job Titles" **silently
drops its icon** to the `LayoutDashboard` fallback unless `ICONS` is updated or an explicit `icon:`
is passed. Same for any other rename in the rebuild.

### Q1b. Is "Access" present, and has the file moved?

**Both confirmed.**

- **Access is present** — `admin-sidebar.tsx:67`, in the **People** group, first item, with an
  explicit `icon: ShieldCheck` and a three-line comment recording why it is keyless.
- **The file has NOT moved.** It is still `components/admin/admin-sidebar.tsx` (15,366 bytes, mtime
  2026-09-04 21:32). `find` returns exactly three matches for `admin-sidebar*` and the other two are
  archived copies outside the live tree: `docs/dhruv-review/components/admin/admin-sidebar-Dhruv.tsx`
  and `docs/_backup_2026-08-04/dhruv-review/.../admin-sidebar-Dhruv.tsx`. Neither is imported.

**Its mount points — double sweep, both agree, exactly two:**

```
### SWEEP A1 — rg
app/(admin)/admin/layout.tsx:5,31,33     AdminLayoutClient
app/(ops)/layout.tsx:8,51,53             AdminLayoutClient   ← admin branch only
components/admin/admin-layout-client.tsx:3,20   AdminSidebar

### SWEEP A2 — MSYS grep: identical set, identical lines
```

`AdminSidebar` has exactly one importer (`admin-layout-client.tsx:3`); `AdminLayoutClient` has two
(`(admin)/admin/layout.tsx`, `(ops)/layout.tsx:51` inside `if (roles.includes("admin"))`).
**No commented-out or `// DISABLED` call site exists in any of the four shell files** — swept for
`// <`, `{/* <` and `DISABLED`, zero hits.

### Q1c. 🔴 How the sidebar decides what you see — and why `NAV_SECTIONS` alone is not enough

**It reads a hardcoded job-title comparison. Not `user_page_access`, not `role_permissions`, not
`isSuperuser`.** The whole filter is nine lines:

```tsx
// components/admin/admin-sidebar.tsx:165-172
function visibleItems(items: NavItem[]) {
  return items.filter((item) => {
    if (item.pageKey) {
      return userRole === "admin" || allPerms[item.pageKey]?.canView === true;
    }
    return userRole === "admin";
  });
}
```

`userRole` is a prop. It is filled from the **singular primary role** at both mount points:

```tsx
// app/(admin)/admin/layout.tsx:15,27
requireSuperuser(session);
const userRole = session!.user.role;          // ← SINGULAR primary, not the merged set

// app/(ops)/layout.tsx:28,51
const primaryRole = session.user.role;        // ← same
<AdminLayoutClient ... userRole={primaryRole} ... >
```

`allPerms` **is** on the new model — `getAllPermissionsForRoles(...)` at both mounts, and that
resolver carries both superuser arms and the `ACCESS_SOURCE` switch (`lib/permissions.ts:673-690`).
So the six **keyed** items already resolve correctly per person. **The 22 keyless items do not.**

🔴 **The consequence, and it is a real divergence, not a hypothetical one.** The gate on the door is
`requireSuperuser(session)` = `isSuperuser === true` **OR** `roles includes "admin"`. The gate on
the menu is `userRole === "admin"` on the primary role alone. **A superuser who does not also hold
`admin` as their PRIMARY role passes the door and gets a sidebar with six items** — Routes, Areas,
SKUs, Vehicles, Customers, Hide — and **no Dashboard, no Users, no Access, no System Config, no
Permissions**. They would be locked out of the access screen by the menu while being admitted to it
by the route.

**Nobody is in that state today** — read-only SELECT 2026-09-06: exactly one superuser, `u1 Harsh`,
`isSuperuser = true` **and** `roleId = 1` (`admin`), so both tests agree for him. **That is the same
"identical by accident" shape the tint conversion closed** (`CLAUDE_TINT.md §13.1`): it is one
`/admin/access` tick and one `users.isSuperuser` grant away from diverging, and granting the flag is
now a one-field edit rather than a role change.

**What this means for the rebuild, stated plainly:** rebuilding `NAV_SECTIONS` changes *what is in
the list*. It does not change *who sees the list*. The filter is a separate, four-line fix and it is
the last job-title gate in the admin shell. Whether to make it here or leave it is an owner call —
it is listed in OPEN QUESTIONS, not decided.

### Q1d. What is in the footer area today

**There is no footer nav.** The bottom of the sidebar is a **user identity block only** —
`admin-sidebar.tsx:289-305`, inside `sidebarContent()`, after the nav and separated by
`border-t border-gray-200`:

| Element | Detail |
|---|---|
| Avatar | 32px circle, `bg-teal-600`, white 11px bold **initials** from `getInitials(userName)` (`:136-143`, first letter of each word, upper-cased, first 2 chars) |
| Name | 12px semibold `text-gray-800`, truncated — `{userName}` |
| Role | 10px `text-gray-400`, truncated — `{userRole}`, **the raw slug**, e.g. `admin`, not a pretty label |
| Collapsed | avatar only, centred, `py-3`; name and role hidden behind `{!collapsed && …}` |

**There is no "My Attendance" link in the footer and no app switcher.** "My Attendance" exists today
as a normal nav row — the `Personal` group's single item, `{ label: "Attendance", href: "/attendance" }`
(`:88`). The proposed footer would be new construction, not a move of existing markup.

Sign-out is **not** in the sidebar. It is in `admin-header.tsx:81-87`, top right, beside a live
clock — `signOut({ callbackUrl: "/login" })`.

---

## Q2 — DO ALL 20 PROPOSED ITEMS RESOLVE

### The arithmetic first

The prompt lists **20 menu items plus a footer item = 21 rows**. The 08-28 mockup Screen 1 shows
**19 in 5 groups**; the difference is that the prompt splits the mockup's single **"Roles & Access"**
row back into two — **Access** and **Job Titles**. Reconciled: live 28 − 8 leaving = 20 that carry
over, + **Removed Orders** (a page with no live nav entry) = **21**.

### The table

Every row verified against the filesystem. Page key column = the key the **page itself** checks, not
the key the sidebar attaches.

| # | Group | Proposed label | href | `page.tsx` exists | Page key checked | In `PageKey` union | Redirect / middleware |
|---|---|---|---|---|---|---|---|
| 1 | OVERVIEW | Dashboard | `/admin` | ✅ `app/(admin)/admin/page.tsx` | none (layout only) | `dashboard` exists — **gates nothing** | none |
| 2 | PEOPLE & ACCESS | Users | `/admin/users` | ✅ `app/(admin)/admin/users/page.tsx` | none (layout only) | `users` exists — **gates nothing** | none |
| 3 | PEOPLE & ACCESS | Access | `/admin/access` | ✅ `app/(admin)/admin/access/page.tsx` | none — comment at `:22-24` says superuser-only by layout inheritance | n/a (keyless by design) | none |
| 4 | PEOPLE & ACCESS | Job Titles | `/admin/roles` | ✅ `app/(admin)/admin/roles/page.tsx` | none (layout only) | n/a | none |
| 5 | PEOPLE & ACCESS | Attendance | `/admin/attendance` | ✅ **`app/(ops)/admin/attendance/page.tsx`** | none — `(ops)` layout gate | `attendance_admin` exists — **gates nothing** | none; `:44` `redirect("/admin")` if settings row missing |
| 6 | CUSTOMERS | Customers | `/admin/customers` | ✅ `app/(admin)/admin/customers/page.tsx` | **`customers` / `canView`** (`:12-13`) | ✅ | none |
| 7 | CUSTOMERS | Sales Officers | `/admin/sales-officers` | ✅ `.../sales-officers/page.tsx` | none (layout only) | n/a | none |
| 8 | CUSTOMERS | SO Groups | `/admin/so-groups` | ✅ `.../so-groups/page.tsx` | none (layout only) | n/a | none |
| 9 | CUSTOMERS | Contact Roles | `/admin/contact-roles` | ✅ `.../contact-roles/page.tsx` | none (layout only) | n/a | none |
| 10 | DEPOT MASTER | Routes | `/admin/routes` | ✅ `.../routes/page.tsx` | **`routes_areas` / `canView`** (`:12-13`) | ✅ | none |
| 11 | DEPOT MASTER | Areas | `/admin/areas` | ✅ `.../areas/page.tsx` | **`routes_areas` / `canView`** (`:12-13`) | ✅ | none |
| 12 | DEPOT MASTER | Sub-areas | `/admin/sub-areas` | ✅ `.../sub-areas/page.tsx` | **none** — layout only | ✅ (`routes_areas`, unused here) | none |
| 13 | DEPOT MASTER | Delivery Types | `/admin/delivery-types` | ✅ `.../delivery-types/page.tsx` | none (layout only) | n/a | none |
| 14 | DEPOT MASTER | Slot Master | `/admin/slots` | ✅ `.../slots/page.tsx` | none (layout only) | n/a | none |
| 15 | DEPOT MASTER | Slot Rules | `/admin/slot-rules` | ✅ `.../slot-rules/page.tsx` | none (layout only) | n/a | none |
| 16 | DEPOT MASTER | Transporters | `/admin/transporters` | ✅ `.../transporters/page.tsx` | none (layout only) | n/a | none |
| 17 | DEPOT MASTER | Vehicles | `/admin/vehicles` | ✅ `.../vehicles/page.tsx` | **`vehicles` / `canView`** (`:11-13`) | ✅ | none |
| 18 | SETTINGS | System Config | `/admin/system-config` | ✅ `.../system-config/page.tsx` | none (layout only) | `system_config` exists — **gates nothing** | none |
| 19 | SETTINGS | Hide | `/admin/settings/hide` | ✅ `.../settings/hide/page.tsx` | none — comment at `:4` says layout | `settings_hide` ✅ | none |
| 20 | SETTINGS | Removed Orders | `/admin/removed-orders` | ✅ `.../removed-orders/page.tsx` | none — comment at `:4` says layout | n/a | none |
| 21 | FOOTER | My Attendance | `/attendance` | ✅ **`app/attendance/page.tsx`** | none — own `auth()` + `redirect("/login")` | `attendance` ✅ (special-cased in `buildNavItems`) | none |

### Confirmed against the build route table

`npx next build`, exit 0, 2026-09-06. **All 21 proposed addresses appear as `ƒ` (dynamic,
server-rendered). None is missing, none is static-prerendered, none is a redirect stub.** The
`/admin*` block of the table, verbatim — **32 routes**, matching the filesystem count exactly
(28 in `app/(admin)/admin/` + 4 in `app/(ops)/admin/`):

```
├ ƒ /admin                        ├ ƒ /admin/permissions          ├ ƒ /admin/slot-rules
├ ƒ /admin/access                 ├ ƒ /admin/product-categories   ├ ƒ /admin/slots
├ ƒ /admin/areas                  ├ ƒ /admin/product-names        ├ ƒ /admin/so-groups
├ ƒ /admin/attendance             ├ ƒ /admin/removed-orders       ├ ƒ /admin/sub-areas
├ ƒ /admin/attendance/ot-audit    ├ ƒ /admin/roles                ├ ƒ /admin/system-config
├ ƒ /admin/attendance/ot-pending  ├ ƒ /admin/routes               ├ ƒ /admin/tint-manager
├ ƒ /admin/attendance/settings    ├ ƒ /admin/sales-officers       ├ ƒ /admin/transporters
├ ƒ /admin/base-colours           ├ ƒ /admin/settings/hide        ├ ƒ /admin/users
├ ƒ /admin/contact-roles          ├ ƒ /admin/skus                 ├ ƒ /admin/vehicles
├ ƒ /admin/customers              ├ ƒ /admin/skus/[id]/sub-skus   ├ ƒ /attendance
├ ƒ /admin/delivery-types         ├ ƒ /admin/dispatch-cutoffs     ├ ƒ /admin/import
```

**`/admin/permissions` is in that table** — it is a real, built route, not a stale file.

**No dead links. No redirects. No middleware entries.** `next.config.mjs` has exactly two redirects
(`/tint/manager/ti-report` and `/ti-report` → `/reports?r=ti-report`) and two rewrites (`/demo`,
`/.well-known/assetlinks.json`) — **none touches an admin address.** `middleware.ts` never mentions
`/admin`; `PHASE1_BLOCKED` is `[]`.

### The three that resolve differently from what the 08-28 design assumed

1. 🔴 **Row 5 — Attendance is in a DIFFERENT ROUTE GROUP.** `/admin/attendance` looks like an
   `(admin)` page and is not: it is `app/(ops)/admin/attendance/page.tsx`, gated by
   `app/(ops)/layout.tsx:30-32` (`roles.some(r => ["admin","ops_admin"].includes(r))`) — **not** by
   `requireSuperuser`. It reaches the admin shell only through that layout's `roles.includes("admin")`
   branch at `:37`, which re-mounts `AdminLayoutClient` by hand. **Two consequences for a nav
   rebuild:** the admin sidebar renders on that page from a *second* call site that must be kept in
   step, and `ops_admin` — whose login landing is this address — never sees the admin sidebar at all
   (they get `RoleLayoutClient`). A route group is not a module: `app/(ops)/admin/` holds 4 pages,
   `app/(admin)/admin/` holds 28.
2. **Row 21 — My Attendance leaves the admin shell entirely.** `app/attendance/page.tsx` is under
   neither group and has **no sidebar of any kind** (CORE §11: *"`/attendance` uses no sidebar
   (full-screen PWA layout)"*). Clicking the proposed footer item drops the admin frame with no way
   back but browser Back — **the same complaint the 08-28 draft raised against Shade Master** and
   used as a reason to remove it. It is being kept, in the footer, with that property unaddressed.
3. **Row 4 — Job Titles is `app/(admin)/admin/roles/page.tsx`, and its own copy is wrong.** 37
   lines, read-only, `prisma.role_master.findMany`. Its subtitle reads *"Read-only. Seeded at setup —
   7 system roles."* — **live `role_master` holds 13** (SELECT 2026-09-06: admin, dispatcher,
   support, tint_manager, tint_operator, floor_supervisor, picker, operations, billing_operator,
   ops_admin, operation_manager, logistics, **floor_access**). A relabel to "Job Titles" puts a
   screen in the menu whose first sentence is false by six.

### Flags requested explicitly

- **Any of the 21 with NO page?** **None.** All 21 resolve.
- **Any resolving to a `/dispatcher/*` screen?** **None.** Double sweep:

```
### SWEEP C1 — rg, char class '"[/]dispatcher[/](customers|skus|routes|vehicles)"'
lib/permissions.ts:125-128   (ROLE_HREF_OVERRIDES only)
### SWEEP C2 — MSYS grep, quoted literals: identical four lines
```

  The four `/dispatcher/*` addresses exist **only** inside `ROLE_HREF_OVERRIDES`
  (`lib/permissions.ts:124-129`), which is read by `buildNavItems()`. **The admin sidebar does not
  call `buildNavItems()` and never has** — it hardcodes `/admin/*`. So the 2026-09-06 master-data
  gate finding (the four `/dispatcher` screens are reachable by nobody) **does not touch any of the
  21**; it stays a `ROLE_HREF_OVERRIDES` problem for the operational sidebar.
- **Removed Orders — confirmed live, confirmed orphaned.** `app/(admin)/admin/removed-orders/page.tsx`,
  11 lines, renders `<RemovedOrdersContent />`; its own comment at `:3` says *"Hidden admin page — no
  sidebar entry. Direct URL only."* Live data behind it: **47 removed orders** (SELECT 2026-09-06;
  the 08-28 discovery said 43). Double sweep for inbound links:

```
### SWEEP D1 — rg '[/]admin[/]removed-orders'   ### SWEEP D2 — MSYS grep '/admin/removed-orders'
Both return the same 3 lines, and NOT ONE is a navigational link:
  app/(admin)/admin/removed-orders/page.tsx:1        its own component import
  components/admin/removed-orders-content.tsx:109    fetch("/api/admin/removed-orders?…")   ← the API
  components/admin/RestoreObdModal.tsx:95            fetch("/api/admin/removed-orders/…")   ← the API
```

  **Real route: `/admin/removed-orders`.** Adding it to the menu is a genuinely new link, not a
  restoration of a lost one.

### ⚠ Separately confirmed — `/admin/permissions` survives leaving the menu

**It does. Its route resolves, its gate is intact, and nothing else changes.**

| | |
|---|---|
| Page file | `app/(admin)/admin/permissions/page.tsx` — **exists**, 10+ lines, renders `<PermissionsManager …/>` |
| Its own gate | `app/(admin)/admin/permissions/page.tsx:2,10` — `import { requireSuperuser }`, then `requireSuperuser(session)`. **A second, explicit gate on top of the layout's.** |
| Layout gate | `app/(admin)/admin/layout.tsx:15` — `requireSuperuser(session)` |
| API gate | `app/api/admin/permissions/route.ts:12` (GET) and `:37` (POST) — `requireSuperuser(session)` on both |
| Redirect / middleware | **none** |
| Only inbound link today | `components/admin/admin-sidebar.tsx:45` — the menu row itself |

🔴 **So removing the menu row makes `/admin/permissions` URL-only, and that is the whole change.**
The address keeps working for anyone who types it, exactly as `/admin/removed-orders` and
`/admin/dispatch-cutoffs` do today. **This matters because it is the `ACCESS_SOURCE='role'` rollback
editor:** `role_permissions` is the table the panic switch flips back to (`CLAUDE_CORE.md §5`,
`§13`), and this screen is the only UI that writes it.

⚠ **Two things to know before relying on it as a rollback tool, neither of which this task changes:**

- `POST /api/admin/permissions:83` **still uses `prisma.$transaction`**, now with a comment at
  `:79-82` recording it as a deliberate, documented exception pending the route's replacement. The
  08-28 draft's *"fix it to sequential awaits in the same pass"* was overtaken by that decision.
- The screen still re-posts **all ~78 cells of its own 6 × 13 grid** on every save — the mechanism
  that recreated 12 retired page-key rows on 2026-09-04, caught by `admin_audit_log` the same night.
  A rollback that runs through this screen re-arms that. `ROADMAP.md` → *P2 — The old permissions
  screen* owns it.

---

## Q3 — APP SWITCHER GROUNDWORK

### `PAGE_NAV_MAP` in full

**File: `lib/permissions.ts`, lines 19-108.** Type at `:8-12`:

```ts
export interface NavItemConfig {
  pageKey: string;
  label:   string;
  href:    string;
}
```

**Contents — 24 entries, in source order. Order is behaviour: `buildNavItems()` preserves it and
`MobileShell`'s Home target is `navItems[0].href`.**

| # | `pageKey` | `label` | `href` |
|---|---|---|---|
| 0 | `operations_tinting` | Tinting | `/operations/tinting` |
| 1 | `operations_tint_operator` | Tint Operator | `/operations/tint-operator` |
| 2 | `picking` | Picking | `/picking` |
| 3 | `floor` | Floor | `/floor` |
| 4 | `import_obd` | Import OBDs | `/import` |
| 5 | `tint_manager` | Tint Manager | `/tint/manager` |
| 6 | `tint_operator` | Tint Operator | `/tint/operator` |
| 7 | `customers` | Customers | `/admin/customers` |
| 8 | `skus` | SKUs | `/admin/skus` |
| 9 | `routes_areas` | Routes | `/admin/routes` |
| 10 | `vehicles` | Vehicles | `/admin/vehicles` |
| 11 | `trip_report` | Trip Report | `/trips` |
| 12 | `place_order` | Purchase Order (PO) | `/place-order` |
| 13 | `mail_orders` | **Billing** | `/mail-orders` |
| 14 | `mrn` | MRN | `/mrn` |
| 15 | `ci` | CI | `/ci` |
| 16 | `delivery_challans` | Delivery Challans | `/tint/manager/challan` |
| 17 | `shade_master` | Shade Master | `/tint/manager/shades` |
| 18 | `sampling_library` | Sampling Library | `/tint/sampling-library` |
| 19 | `ti_report` | **Reports** | `/reports` |
| 20 | `attendance` | Attendance | `/attendance` |
| 21 | `attendance_admin` | Attendance | `/admin/attendance` |

*(The map's remaining ~60 lines are comments recording seven retired keys and the two 🔴 position
warnings on `mrn` and `ci`. `settings_hide` is deliberately absent — comment at `:105-108`.)*

### Does it carry labels and icons?

**Labels: YES. Icons: NO.** `NavItemConfig` has exactly three fields. **Icons live in a different
file**: `components/shared/role-sidebar.tsx:39-67`, `ICON_MAP`, keyed by **pageKey**, consumed at
`:128` and `:155` as `ICON_MAP[item.pageKey] ?? DEFAULT_ICON` (`DEFAULT_ICON = User`, `:69`).

**`ICON_MAP` covers 18 of the 27 `ALL_PAGE_KEYS`.** Present: `operations_tinting`,
`operations_tint_operator`, `picking`, `import_obd`, `tint_manager`, `tint_operator`, `customers`,
`skus`, `routes_areas`, `vehicles`, `trip_report`, `delivery_challans`, `sampling_library`,
`shade_master`, `ti_report`, `mail_orders`, `mrn`, `ci`.
**Absent — these fall back to the generic `User` glyph:** 🔴 **`floor`**, 🔴 **`place_order`**,
`dashboard`, `users`, `system_config`, `permissions`, `settings_hide`, `attendance`,
`attendance_admin`.

⚠ **And the admin sidebar's own `ICONS` map is a THIRD map, keyed on the LABEL string**
(`admin-sidebar.tsx:104-132`). So a switcher built inside the admin shell has two incompatible icon
sources to choose between: `ICON_MAP` by page key, or `ICONS` by label. **Neither is in
`PAGE_NAV_MAP`, and neither is imported by the admin sidebar today.**

### The canonical addresses an admin should be offered — from the map, not invented

The mockup's switcher offers six: *Floor Control · Picking · Tint Manager · Mail Orders · Import OBD
· Reports*. Matched against what `PAGE_NAV_MAP` actually holds:

| Mockup wording | `PAGE_NAV_MAP` entry | Canonical href | In build table | Icon in `ICON_MAP`? |
|---|---|---|---|---|
| Floor Control | `floor` → label **"Floor"** | `/floor` | ✅ `ƒ /floor` | 🔴 **no** — falls back to `User` |
| Picking | `picking` → "Picking" | `/picking` | ✅ `ƒ /picking` | ✅ `PackageCheck` |
| Tint Manager | `tint_manager` → "Tint Manager" | `/tint/manager` | ✅ `ƒ /tint/manager` | ✅ `Layers` |
| Mail Orders | `mail_orders` → **"Billing"** | `/mail-orders` | ✅ `ƒ /mail-orders` | ✅ `Mail` |
| Import OBD | `import_obd` → "Import OBDs" | `/import` | ✅ `ƒ /import` *(distinct from `ƒ /admin/import`)* | ✅ `Upload` |
| Reports | `ti_report` → "Reports" | `/reports` | ✅ `ƒ /reports` | ✅ `BarChart2` |

🔴 **Two wording mismatches to settle before the switcher is built, both from the map:** the map
calls `floor` **"Floor"**, not "Floor Control"; and it calls `mail_orders` **"Billing"**, not "Mail
Orders". If the switcher reads `PAGE_NAV_MAP` (which is what "do not hardcode" means here), the
labels it renders will be *Floor* and *Billing*, not what the mockup draws.

**Three further live addresses the map holds that the mockup's six omit** — recorded, not
recommended: `mrn` → `/mrn`, `ci` → `/ci`, `trip_report` → `/trips`. All three are live modules with
their own canonical addresses. Whether an admin should be offered them is an owner decision.

⚠ **`/ci` is URL-only by design** — `CLAUDE_CORE.md §12` records that a `PAGE_NAV_MAP` entry at index
≤ 2 would steal `floor_supervisor`'s Home button from `/picking`. It is in the map at index 15, so
it is safe there; a switcher reading the map inherits that safety for free, and a hardcoded list
would not.

🔴 **The switcher must NOT be built by filtering `PAGE_NAV_MAP` through the admin's own
permissions and calling it done.** A superuser resolves to `ALL_TRUE` on all 27 keys
(`getAllPermissionsForRoles` → `getAllPermissionsForRole("admin")`), so every entry passes and the
switcher would render all 22 rows including `operations_tinting`, `operations_tint_operator` and
`shade_master`. The six-item list is a **curated** subset. Curate it by page key, read label and
href from the map.

---

## Q4 — WHAT HAS THE ACCESS WORK OVERTAKEN

Decisions **1, 2 and 3** are known-superseded and are not re-argued. Reading the whole 08-28 draft
and its discovery against `code-update-2026-09-04-user-based-access.md` and
`code-update-2026-09-06-tint-and-master-data.md`:

### 🔴 Now false — eight more

| # | Where | The 08-28 claim | What is true at `200882f0` |
|---|---|---|---|
| 1 | draft §1, closing para | *"`admin-sidebar.tsx`'s per-item `pageKey` gating is **dead code** — both mount points are already admin-only, so `userRole === "admin"` is always true and the six `pageKey` branches never decide anything."* | **False, and it is the most consequential stale line in the document.** The door is now `requireSuperuser` (flag **OR** role); the menu is still `userRole === "admin"` on the **primary**. The six keyed branches are now the **only** ones that would fire for a flag-only superuser, and the 22 keyless items would vanish. The gating is not dead — it is the half that still works. **Q1c.** |
| 2 | discovery §6a | *"`app/(admin)/admin/layout.tsx:14-15` — `requireRole(session, [ROLES.ADMIN])`"* | **Now `requireSuperuser(session)` at `:15`** (`b915c88e`). Same for `/admin/permissions/page.tsx:10` and the whole `(admin)` group. |
| 3 | discovery §6c | *"nine routes inline `if (session.user.role !== "admin") return 403` … so a user holding admin as a **secondary** role would be denied by these nine and allowed by the rest"* | **False.** All eight `hide/*` + `removed-orders*` + `tag-settings` routes now call **`isSuperuser(session)`**, which reads the **merged** role set plus the flag. Verified file by file: zero occurrences of `role !== "admin"` remain in any of them. The primary/secondary split those nine created is gone. |
| 4 | draft §4a | *"`POST /api/admin/permissions` currently uses `prisma.$transaction` (`route.ts:51`) … **Fix it to sequential awaits in the same pass.**"* | **Overtaken by a decision, not by a fix.** Still `$transaction`, now at `:83`, with an explicit `⚠` comment at `:79-82`: *"LEFT DELIBERATELY. The route is due to be replaced entirely in a later step of the per-user access work; unwrapping a 78-row upsert now would change its failure semantics for no lasting benefit."* Do not "fix" it in the shell rebuild. |
| 5 | draft §3 + §4a | *"**Roles & Access** — `/admin/access` … Merges the read-only Roles list and the Permissions matrix into one screen with two tabs. **Rows:** all page keys. **Columns:** all roles, read from live `role_master`."* | **The screen that shipped is not this screen.** `/admin/access` is **people × pages**, not roles × pages: a searchable people rail on the left and one person's 27 keys × 5 actions on the right (`CLAUDE_CORE.md §12`, `CLAUDE_UI.md §63`). It did **not** absorb the Roles list — `/admin/roles` is untouched, which is exactly why the prompt's new nav needs a separate **Job Titles** row the 08-28 nav did not have. |
| 6 | discovery §5b | *"`ALL_PAGE_KEYS` has **26**"*, and the 15-key missing list | **27 now** — `ci` was added 2026-09-01. Any count derived from that list is off by one. |
| 7 | discovery §1 / §2 | *"27 pages in `app/(admin)/admin/`"*, *"31 pages total"*, *"the sidebar … 27 items in 6 groups"* | **28 / 32 / 28.** `/admin/access` added the page (2026-09-04) and its nav row. |
| 8 | draft §2 decision 5, discovery §5g | *"`floor_access` … is live with 4 users and **in no file**"* | Still absent from `lib/rbac.ts` `ROLES` and `prisma/seed.ts`, **but no longer undocumented** — `ROADMAP.md` → *Step 8* now records it as *"a role invented to hand Floor Control to four named people; under ticks it becomes four ticks and stops existing"*, and the retirement path is the decision, not documentation. Decision 5's *"add it to `ROLE_REDIRECTS`, the seed and CORE §5"* now points the wrong way. |

### ✅ Still exactly true — checked, not assumed

| Where | The claim | Verified 2026-09-06 |
|---|---|---|
| draft §5 (Mobile) | `admin-layout-client.tsx:23` inline `marginLeft` with no breakpoint | **True**, unchanged. See ALSO RECORD below. |
| draft §5 (Dead code) | `components/admin/operations-overview.tsx` has zero importers | **True.** Double sweep — rg and MSYS grep both return exactly one line, `operations-overview.tsx:27`, its own `export function`. No importer anywhere in `app/`, `components/`, `lib/`. |
| draft §5 (⚠) | `CLAUDE_CORE.md §3` cites the fixed-table standard as *"§40"*; §40 in `CLAUDE_UI.md` is *OT prompt screens*; the real one is **§27** | **True and still uncorrected.** CORE §3 line reads *"Fixed table standard (`CLAUDE_UI.md §40`) for ALL data tables"*; `CLAUDE_UI.md:435` is `## 27. Fixed table layout standard`, `:819` is `## 40. OT prompt screens (check-out)`. |

### Neither — decisions 6-13, status

| # | Decision | Status |
|---|---|---|
| 4 | Add phone to the user forms | **Not built.** Untouched by the access work; still open. |
| 6 | Attendance stays in admin under People & Access | **Unaffected**, and the prompt's nav keeps it. ⚠ But see Q2's flag: it is an `(ops)`-group page reaching the admin shell through a second `AdminLayoutClient` mount. |
| 7 | `ops_admin`'s two 403s — hide the controls | **Not built, and unverified.** The 08-28 confidence block already flagged these as *inferred* from route guards, never observed. `65fd0e10` swept 57 bypasses; whether it touched either guard was **not** checked here. |
| 8 | 6 dead-table screens: remove from nav, leave routes | **Unaffected** and consistent with the prompt (all six leave the menu). |
| 9 | Retire `/admin/dispatch-cutoffs` | **Unaffected.** Page still exists, still orphaned, still absent from the proposed 21. |
| 10 | `/admin/tint-manager` + `/admin/import` leave the nav | **Unaffected.** Both pages still exist; neither is in the proposed 21. |
| 11 | Add Removed Orders under Settings | **Unaffected**, still orphaned, 47 live rows. |
| 12 | 21 tables → §27 | **Unaffected.** Out of scope for a shell-only rebuild. |
| 13 | Update `prisma/seed.ts` to match live | 🔴 **Still open and now WORSE than 08-28 described.** The draft's concern was seed re-granting five pages to `dispatcher`/`support`. As of 2026-09-06, `prisma/seed.ts` has **zero hits for `user_page_access` or `isSuperuser`** — it seeds only `role_permissions`, the fallback. Under `ACCESS_SOURCE = 'user'` a wipe-and-reseed leaves live access **empty** and looks like it succeeded. Already logged as `ROADMAP.md` → *P0*. Not this project's to fix; named so decision 13 is not closed on the old, smaller premise. |

### One thing the access work created that the 08-28 draft could not have known

**Five page keys in the union gate nothing.** `dashboard`, `users`, `system_config`, `permissions`
and `attendance_admin` are in `PageKey` and `ALL_PAGE_KEYS`, and `ACCESS_SECTIONS` groups the first
four plus `settings_hide` under an **"Admin panel"** heading on `/admin/access`
(`lib/permissions.ts:365-367`). Double sweep for a gate on any of them:

```
### SWEEP B2 — MSYS grep for checkPermission/checkAnyPermission on those keys: ZERO hits
### SWEEP B1 — rg: the only non-lib hits are entity: "users" / "system_config"
    (audit-log entity names in app/api/admin/users/route.ts:73, users/[id]/route.ts:119,
     system-config/route.ts:77) and permissions-manager.tsx's own hardcoded PAGES_CONFIG.
```

So `/admin/access` renders an **Admin panel** section of five rows that decide nothing — the admin
shell is gated on `requireSuperuser`, start to finish. `ACTION_PAGES` already dashes their *action*
columns (comment at `:294-296`); the `canView` column is still a live checkbox. **Not a defect in
the access screen** — it is the shell that never adopted the keys. It becomes a real question the
moment the nav rebuild asks "should Users be a tick rather than superuser-only?" Owner decision;
recorded, not proposed.

---

## ALSO RECORD (not fixed) — the content offset

**File: `components/admin/admin-layout-client.tsx`, 32 lines total. Quoted with line numbers:**

```tsx
15  export function AdminLayoutClient({ userName, userRole, allPerms, children }: AdminLayoutClientProps) {
16    const { isCollapsed } = useSidebar();
17
18    return (
19      <div style={{ background: "var(--bg)" }}>
20        <AdminSidebar userName={userName} userRole={userRole} allPerms={allPerms} />
21        <div
22          className="h-screen flex flex-col overflow-hidden transition-all duration-200"
23          style={{ marginLeft: isCollapsed ? "72px" : "240px" }}
24        >
25          <AdminHeader userName={userName} userRole={userRole} />
26          <main className="flex-1 overflow-y-auto p-5 scrollbar-hide" style={{ background: "var(--bg)" }}>
27            {children}
28          </main>
29        </div>
30      </div>
31    );
32  }
```

**Line 23 is the whole issue: an inline `marginLeft` with no `md:` breakpoint.** The sidebar that
justifies it is `hidden md:flex` (`admin-sidebar.tsx:313`) — so below `md` the sidebar is not
rendered and the body is still pushed 72–240px right, underneath the mobile bar already overlaying
it at `z-50`.

### Every element that reads `isCollapsed` — double sweep, both agree, 9 lines in 3 files

| File · line | What it does |
|---|---|
| `components/admin/sidebar-provider.tsx:6` | `isCollapsed: boolean` on `SidebarContextValue` |
| `components/admin/sidebar-provider.tsx:11` | context default `isCollapsed: false` |
| `components/admin/sidebar-provider.tsx:16` | `useState(false)` — the state itself; hydrated from `localStorage["sidebar-collapsed"]` at `:18-23`, written at `:28` |
| `components/admin/sidebar-provider.tsx:34` | provides `{ isCollapsed, toggle }` |
| **`components/admin/admin-layout-client.tsx:16`** | **consumer** — `const { isCollapsed } = useSidebar()` |
| 🔴 **`components/admin/admin-layout-client.tsx:23`** | **the content offset** — `marginLeft: isCollapsed ? "72px" : "240px"`, **no breakpoint** |
| **`components/admin/admin-sidebar.tsx:158`** | **consumer** — `const { isCollapsed, toggle } = useSidebar()` |
| `components/admin/admin-sidebar.tsx:315` | sidebar `width: isCollapsed ? "72px" : "240px"` — **inside a `hidden md:flex` `<aside>`**, so it is desktop-only already |
| `components/admin/admin-sidebar.tsx:320` | `{sidebarContent(isCollapsed)}` — picks `collapsedNav` vs `expandedNav` and the brand/user block variants |

**Two consumers only** — `admin-layout-client.tsx` and `admin-sidebar.tsx`. `admin-header.tsx` does
**not** read it. The state is not URL- or session-backed: it is `localStorage["sidebar-collapsed"]`,
read once in an effect, so **the first paint is always uncollapsed (240px) regardless of the stored
value** (`sidebar-provider.tsx:16` initialises `false`).

### Where the mobile bar and the drawer live

🔴 **Both are in `admin-sidebar.tsx`, NOT in `admin-layout-client.tsx`** — the same file as the
desktop sidebar, all three returned from one fragment at `:309-360`:

| Element | Lines | Class |
|---|---|---|
| Desktop sidebar `<aside>` | `313-321` | `hidden md:flex md:fixed md:inset-y-0 md:left-0 md:z-50` |
| **Mobile top bar** | `324-345` | `md:hidden fixed top-0 left-0 z-50 … h-[52px]` — hamburger + wordmark |
| **Mobile drawer** | `348-358` | `md:hidden fixed inset-0 z-40 flex` — a `w-60` `<aside>` with `paddingTop: 52px` rendering `expandedNav`, plus a `bg-black/40` scrim that closes it |

Drawer open/close state is `mobileOpen`, local `useState` in `AdminSidebar` (`:157`), separate from
`isCollapsed` — the two do not interact. Every nav `<Link>` calls `setMobileOpen(false)` on click
(`:194`, `:231`).

**So the responsive halves are split across two files:** the bar and drawer that handle small
screens are in `admin-sidebar.tsx` and already correct; the offset that breaks on small screens is
one line in `admin-layout-client.tsx`. The 08-28 draft's *"Fix the offset; the sidebar's own
`md:hidden` bar and drawer already exist and work"* is still accurate. **Nothing was changed here.**

---

## Confidence

- **No login, no browser, no dev server.** Every statement about what a person *sees* is derived
  from reading layouts, gates and live rows. The Q1c divergence is derived from the source of
  `requireSuperuser`, `visibleItems` and `getAllPermissionsForRoles`, plus a SELECT confirming one
  superuser whose primary role is `admin` — **not** observed.
- **Grep hygiene:** seven sweeps (A, B, C, D, E, F, G), each run twice — ripgrep with `[/]` char
  classes on every branch, then MSYS `grep` over quoted literals. **All seven reconciled**; both
  results are printed above.
- **Capability vs reachability:** `/admin/permissions`, `/admin/removed-orders` and
  `/admin/dispatch-cutoffs` are reported as *reachable by URL* because their page files and gates
  exist. That anybody does reach them is not claimed.
- **A route group is not a module:** `app/(admin)/admin/` (28 pages), `app/(ops)/admin/` (4),
  `app/api/admin/` (routes, no pages) were each listed before being described.
- **PageKey vs RoleSidebarRole:** every "key" above is a **PageKey** unless the word *role* appears.
  `dispatcher` is named once as a page key (retired, still in `permissions-manager.tsx`) and once as
  a role (live, 3 users) — flagged at each use.
- **No permission fact is stated from seed.** The seed is discussed only as the thing that does
  **not** know about `user_page_access`.
- **Read-only scripts:** `scripts/_chk-adminshell-20260906.ts` (underscore-prefixed, outside the
  `tsc` gate per `tsconfig.json`'s `exclude`). Every query is a `SELECT`. Nothing was written.
- **Not chased down:** whether `65fd0e10` altered either of the two `ops_admin` 403 guards
  (08-28 decision 7); and whether `<ExportButton>` is rendered anywhere, which the 08-28 confidence
  block also left open.

---

## OPEN QUESTIONS FOR SMART FLOW:

1. 🔴 **Does the sidebar filter get fixed in this rebuild, or stay a job title?**
   `visibleItems()` tests `userRole === "admin"` on the **primary** role while the door tests
   `requireSuperuser` (flag **OR** role). A flag-only superuser would pass the door and see six
   items. Nobody is in that state today. Options: (a) change the filter to `isSuperuser(session)`
   passed as a prop — four lines, and it makes the shell agree with its own door; (b) give the
   keyless items real page keys and gate them like everything else — bigger, and it makes five
   currently-inert keys mean something; (c) leave it, and record that granting `isSuperuser` without
   the `admin` role produces a broken menu.
2. **Which label wins for the app switcher — the mockup's or `PAGE_NAV_MAP`'s?** The map says
   **"Floor"** and **"Billing"**; the mockup draws *Floor Control* and *Mail Orders*. Reading the
   map (the "do not hardcode" instruction) renders the map's words.
3. **Where do the switcher's icons come from?** Three incompatible maps exist: `ICON_MAP` by page
   key (`role-sidebar.tsx`, 18 of 27 keys — **`floor` and `place_order` are missing**), `ICONS` by
   label (`admin-sidebar.tsx`, 27 label rows), and none in `PAGE_NAV_MAP`. Add `floor` to
   `ICON_MAP`, add a fourth map, or accept the generic `User` glyph on Floor Control?
4. **Should MRN, CI and Trip Report be in the switcher?** All three are live modules with canonical
   addresses in `PAGE_NAV_MAP` that the mockup's six omit. ⚠ CI is deliberately URL-only in the
   operational sidebar for a Home-button reason that does **not** apply to an admin switcher.
5. **"My Attendance" in the footer drops the admin shell entirely** — `/attendance` has no sidebar
   of any kind, so browser Back is the only way home. That is the exact property used to argue Shade
   Master out of the nav. Keep it, or route it through something that preserves the frame?
6. **Relabelling "Roles" to "Job Titles" silently drops its icon** (`ICONS` is keyed on the label
   string). Update `ICONS`, or pass an explicit `icon:` on that item?
7. **`/admin/roles`' own subtitle says "Seeded at setup — 7 system roles"; live `role_master` holds
   13.** In scope for a nav-only rebuild, or a separate one-line fix?
8. **Five page keys gate nothing** — `dashboard`, `users`, `system_config`, `permissions`,
   `attendance_admin` — yet `/admin/access` shows an "Admin panel" section of checkboxes for four of
   them. Wire them to the shell, mark them inert on the access screen, or leave both as they are?
9. **`/admin/attendance` reaches the admin shell through a SECOND `AdminLayoutClient` mount** in
   `app/(ops)/layout.tsx:51`, gated on `["admin","ops_admin"]` rather than `requireSuperuser`. A nav
   rebuild has to keep both mounts in step. Is consolidating them in scope, or explicitly not?
10. **08-28 decision 7 (`ops_admin`'s two 403s) was never verified and is still not.** Both claims
    are inferred from route guards; whether `65fd0e10`'s bypass sweep changed either guard was not
    checked in this pass. Worth a look before anyone hides a control on the strength of it.
