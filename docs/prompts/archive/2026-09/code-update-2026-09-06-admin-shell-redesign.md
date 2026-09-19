# Admin shell redesign — nav, switcher, mobile offset

**Date:** 2026-09-06
**Classification:** `code-update` — SHIPPED. Merge as current reality.
**Session:** Claude.ai planning + prompt drafting; Claude Code executed on the depot PC.
**Scope:** The admin panel SHELL only — sidebar and layout. The access system was not touched.

---

## 1. What shipped

Four commits, all on `main`, all with `tsc --noEmit` exit 0 and a clean `next build`
before commit. All four hand-tested by Smart Flow in a browser.

| # | SHA | Files | What |
|---|-----|-------|------|
| 1 | `44125138` | 4 | Sidebar visibility filter moved from the job title to `isSuperuser` |
| 2 | `0fc145bb` | 1 | Sidebar rebuilt: 28 items / 6 groups → 20 items / 5 groups + footer link |
| 3 | `8d7a3bef` | 7 | App switcher in the sidebar footer, nine destinations |
| 4 | `95b24352` | 1 | Mobile content offset — left and top |

> Per session-end rule 9: these SHAs are the evidence. A consolidation pass should
> confirm them against `git log` before merging this file as current reality.

**Nothing was deleted.** No `page.tsx`, no `route.ts`, no API handler, no permission
row, no page key. Items left the MENU ARRAY only. Verified after commit 2: all 32
`/admin` routes still present in the build route table; `/admin/permissions` and
`/admin/skus` confirmed by hand to still open by address.

---

## 2. Commit 1 — the filter (`44125138`)

### The defect

The admin panel's door and its menu asked different questions about the same person.

- **Door** — `app/(admin)/admin/layout.tsx` → `requireSuperuser(session)` since 2026-09-04.
- **Menu** — `admin-sidebar.tsx:168,170` → `userRole === "admin"`, the singular primary
  job title.

22 of the 28 menu items carried no page key, so their entire visibility hung off that
job-title check. A flag-only superuser (`users.isSuperuser = true`, primary role
something else) passed the door and saw **6 of 28 items** — no Dashboard, no Users, no
Access. This was the last job-title gate left in the admin shell; every other one was
closed on 09-04 and 09-06.

### Why it had never bitten

One superuser exists (u1 Harsh) and he holds *both* the flag and the admin job title,
so both arms of `isSuperuser` fire independently and both checks agreed. It worked by
accident, and was one field-edit from diverging.

### The gate (run before the change, 2026-09-06)

Live read-only SELECT over all 39 users, replicating `lib/auth.ts:217-221`'s
`allRoles.length > 0 ? allRoles : [primaryRole]` rule. No seed data used.

- **Loss set (old TRUE, new FALSE): EMPTY.**
- **Gain set (old FALSE, new TRUE): EMPTY.**
- A no-op for all 39 live users on the day it shipped.
- `ops_admin` unaffected — `app/(ops)/layout.tsx:37` forks on the *merged* role set, so
  a non-superuser `ops_admin` never renders `AdminSidebar` at all. And if they did, the
  count is 0 of 28 before and after (all five keyed ticks are `canView = false` for u27
  and u28, confirmed live).

### Structural argument, worth keeping

`requireSuperuser`'s entire body is `if (!isSuperuser(session)) redirect(...)`. The menu
test and the door test are now the identical function, on the identical session, in the
identical request. It is therefore **impossible by construction** for anyone to gain a
menu item without passing the door — not "unlikely today", unreachable.

### Implementation note

`admin-sidebar.tsx` is `"use client"` and has no session in scope. The value is threaded
as an `isSuperuser: boolean` prop from **both** server layouts — the same route
`allPerms` already takes. `useSession()` was rejected: the server layouts already hold
the session, and a prop keeps the component pure with no second client fetch to go
stale.

The `||` page-key / `canView` branch was **not** touched.

---

## 3. Commit 2 — the menu (`0fc145bb`)

### The governing rule (Smart Flow, restated)

> Admin is for user creation, master data, who-sees-what, and settings.
> Operational boards do not belong there.

### The 20 items, 5 groups + footer

```
OVERVIEW         Dashboard
PEOPLE & ACCESS  Users · Access · Job Titles · Attendance
CUSTOMERS        Customers · Sales Officers · SO Groups · Contact Roles
DEPOT MASTER     Routes · Areas · Sub-areas · Delivery Types ·
                 Slot Master · Slot Rules · Transporters · Vehicles
SETTINGS         System Config · Hide · Removed Orders
FOOTER           My Attendance · app switcher
```

Arithmetic: 28 − 8 removed + 1 added (Removed Orders) − 1 moved to footer = 20.

### 🔴 What LEFT the menu, and why — do not add these back

| Item | Why it left |
|------|-------------|
| **Permissions** | Edits `role_permissions`, which since 2026-09-04 is only the `ACCESS_SOURCE='role'` **rollback safety net**. It also re-posts all ~78 grid cells on save, which recreated 12 retired permission rows — caught live by the audit log on 2026-08-30. **Its route MUST stay reachable.** It returns later as the starter-set editor. |
| **SKUs** | Reads the dead `sku_master` family. Note: this one *carries* pageKey `skus` — the key and screen survive, only the menu row went. |
| **Product Categories** | Dead `sku_master` family. |
| **Product Names** | Dead `sku_master` family. |
| **Base Colours** | Dead `sku_master` family. |
| **Import Orders** | Operational. Canonical address `/import`. |
| **Tint Manager** | Operational. Canonical address `/tint/manager`. |
| **Shade Master** | Operational. Canonical address `/tint/shades`. |

All eight remain live and reachable by typing the address. Retirement is a **separate**
job with its own gate under `archive/RETIREMENT-PLAYBOOK.md` and did not happen here.

### What JOINED

- **Removed Orders** (`/admin/removed-orders`) — a live screen with 47 rows that
  **nothing linked to**. Placed under SETTINGS. Smart Flow's call, 2026-09-06:
  operationally flavoured, parked in Settings for now, may move once used.

### What was RENAMED

- **Roles → Job Titles.** Since the access migration a job title grants nothing — it is
  a label and a starting template. Calling it "Roles" implied it still controlled access.

### 5 keyed survivors — page keys preserved

`Customers` (customers) · `Routes` (routes_areas) · `Areas` (routes_areas) ·
`Vehicles` (vehicles) · `Hide` (settings_hide)

---

## 4. Commit 3 — the app switcher (`8d7a3bef`)

Once the operational items left the menu, an admin had **no way out of the admin frame
except the browser back button**. The footer switcher fixes that.

### The nine — a CURATED list, keys hardcoded, labels and hrefs read from `PAGE_NAV_MAP`

| # | page key | label (from map) | href (from map) | icon |
|---|----------|------------------|-----------------|------|
| 1 | `floor` | Floor | `/floor` | LayoutGrid ← **added to ICON_MAP** |
| 2 | `picking` | Picking | `/picking` | PackageCheck |
| 3 | `tint_manager` | Tint Manager | `/tint/manager` | Layers |
| 4 | `mail_orders` | Billing | `/mail-orders` | Mail |
| 5 | `import_obd` | Import OBDs | `/import` | Upload |
| 6 | `ti_report` | Reports | `/reports` | BarChart2 |
| 7 | `mrn` | MRN | `/mrn` | Container |
| 8 | `ci` | CI | `/ci` | Undo2 |
| 9 | `trip_report` | Trip Report | `/trips` | Route |

The August mockup named six. MRN and CI were built after it was drawn; Trips was simply
omitted. Smart Flow chose nine on 2026-09-06.

### 🔴 Deliberately NOT permission-filtered

A superuser resolves `ALL_TRUE` on all 27 keys via `getAllPermissionsForRoles`' own
`isSuperuser` arm (`lib/permissions.ts:682-684`). Filtering the switcher through
permissions would pass **22** entries and drag Tinting, Tint Operator and Shade Master
straight back in — the exact thing this redesign removed. The nine keys are a fixed list
in `lib/admin/app-switcher.ts`.

### Label wording — the map wins

The mockup said *Floor Control* and *Mail Orders*. `PAGE_NAV_MAP` says **Floor** and
**Billing**, and that is what every other sidebar renders. One place, one name. The
mockup wording is stale, not a requirement.

---

## 5. Commit 4 — the mobile offset (`95b24352`)

`admin-layout-client.tsx:21-23` set the content offset as an inline
`marginLeft: isCollapsed ? "72px" : "240px"` with **no breakpoint**, so on a phone the
page body was pushed 72–240px right, underneath the `md:hidden` bar already overlaying
it. The drawer itself always worked; only the offset was wrong.

**A second bug was found and fixed in the same commit.** The mobile bar is
`fixed top-0 h-[52px]` and out of flow, so `AdminHeader` was rendering *underneath* it
and `h-screen` pushed the last 52px off the bottom. Fixing only `marginLeft` would have
brought the content into view and left it decapitated. Both halves shipped.

Inline styles cannot carry a breakpoint, so the value moved to a CSS custom property set
inline, applied through responsive classes. `ml-0` / `pt-[52px]` are base rules; both
`md:` rules sit inside `@media (min-width:768px)`. Desktop computed styles are unchanged
at `margin-left: 72px|240px`, `padding-top: 0`, collapsed and expanded — verified in the
built CSS.

---

## 6. New landmines — read before touching this shell again

1. **AN ICON MAP KEYED ON A LABEL STRING SILENTLY ORPHANS ITS ICON WHEN YOU RELABEL.**
   The admin sidebar's `ICONS` map is keyed on the label text. Renaming "Roles" to
   "Job Titles" drops the icon unless the map key is renamed in the same edit. No
   compiler will tell you. There are now three icon maps in the app —
   `ICON_MAP` (by page key, `role-sidebar.tsx`), admin `ICONS` (by label string), and
   `PAGE_NAV_MAP` (no icons at all). **Do not make it four.**

2. **A DOOR AND A MENU CAN ASK DIFFERENT QUESTIONS ABOUT THE SAME PERSON.** When a gate
   changes, sweep for every *other* place that answers the same question. The 09-04
   migration converted ~68 gates and missed the menu, because the menu is not a gate —
   it is a rendering decision that happens to depend on identity. Look for those too.

3. **`lib/permissions.ts` IMPORTS PRISMA AND AUTH**, so no `"use client"` file can
   import `PAGE_NAV_MAP` directly. Resolve on the server and pass as props — the shape
   `buildNavItems` → `RoleSidebar` already uses. Commit 3 added one word (`export`) to
   that module; no row, order or comment in the map changed.

4. **A FIXED, OUT-OF-FLOW MOBILE BAR NEEDS A TOP OFFSET AS WELL AS A LEFT ONE.** Fixing
   only the horizontal offset makes the content visible and decapitated. Check both axes.

5. **FIVE PAGE KEYS GATE NOTHING ANYWHERE** — `dashboard`, `users`, `system_config`,
   `permissions`, `attendance_admin`. Zero `checkPermission` hits; the only matches are
   `entity:` names for the audit log. `/admin/access` renders an "Admin panel" section of
   checkboxes for four of them that currently do nothing. Not acted on.

---

## 7. Supersedes

`docs/prompts/drafts/web-update-2026-08-28-admin-redesign.md` — **ARCHIVE, do not merge.**

Its §2 decisions 1, 2 and 3 assumed a role × pages permission matrix. That model was
tried and removed by the 2026-09-04 access migration; the screen that shipped is
**people × pages** and did not absorb `/admin/roles`, which is why Access and Job Titles
are two separate menu rows. Its NAV decisions 8–13 were the basis for this work and are
now realised here.

Eight further assumptions in that draft were found false on 2026-09-06. The one that
mattered:

> "the pageKey gating is dead code — `userRole === "admin"` is always true"

**False**, and it is the sentence that would have sent a rebuild down the wrong path.
See §2. The rest were counting drift (26 → 27 page keys, 27 → 28 sidebar items),
`requireRole` → `requireSuperuser`, and decision 5's `floor_access` guidance now
pointing the wrong way (it is ROADMAP'd for retirement).

Companion discovery file, still accurate:
`docs/prompts/drafts/code-discovery-2026-09-06-admin-shell-state.md` (683 lines).

---

## 8. Known, recorded, NOT acted on

- **`lib/permissions.ts:150`** — `buildNavItems`' attendance special case,
  `if (roleSlug === "admin") return true;`. The **sibling** of the filter fixed in
  commit 1: a nav-visibility decision keyed on the primary job title, in the operational
  sidebar. All 13 callers pass `primaryRole`. Deliberately left; deserves its own gate.
- **The four `/dispatcher/*` master-data screens** (customers, skus, routes, vehicles) —
  reachable by NOBODY, confirmed 2026-09-06, including by the people holding the
  `dispatcher` role. Retirement candidates.
- **The two `operator/shades` routes and the `shade_master` family** — retirement
  candidates, deliberately left on job titles.
- **`fetchAll` and its cousins return `[]` on ANY failure**, so a 403 and "there is
  nothing here" are indistinguishable. Three silent failures in one week from this one
  habit. Systemic, on the ROADMAP.
- **`operations-overview.tsx` has zero importers** — verified both sweeps.
- **`CORE §3` cites the fixed-table standard as §40.** §40 is OT prompt screens; the
  real one is **§27**. Fix at consolidation.
- **`POST /api/admin/permissions:83` still uses `$transaction`**, now carrying a comment
  marking it a deliberate exception pending replacement. The 08-28 draft's "fix it in
  the same pass" is overtaken.
- **The Job Titles screen subtitle says "Seeded at setup — 7 system roles."** Live
  `role_master` holds **13**, including `floor_access`. Stale copy on a live screen.
- **Eight orphaned `ICONS` entries** remain in `admin-sidebar.tsx` for the removed items.
  Left deliberately — harmless, and cheap if any item returns.

---

## 9. For the consolidation pass

| File | Change needed |
|------|---------------|
| `CLAUDE_UI.md §7` | Rewrite the admin sidebar spec: 20 items / 5 groups, the footer switcher, the responsive offset. The old 6-group description is dead. |
| `CLAUDE_CORE.md §5` | The admin menu now asks `isSuperuser`, not the job title. Screens index: eight screens are live but no longer in the admin menu. |
| `CLAUDE_CORE.md §7` | Note `/admin/permissions` and `/admin/removed-orders`' new reachability status. |
| `CLAUDE_CORE.md §3` | Add landmines 1–4 from §6 above. Fix the §40 → §27 citation while in there. |
| Router `CLAUDE.md` | No new canonical file — this is a shell change to an existing module. Confirm no row needs editing. |
| `ROADMAP.md` | Add `lib/permissions.ts:150`, and the five no-op page keys from §6.5. |

Archive `web-update-2026-08-28-admin-redesign.md` to `docs/prompts/archive/2026-09/`
in the same pass, per §7.

---

## 10. Hand tests passed

Verified by Smart Flow in a browser, 2026-09-06:

- 28 items / 6 groups before commit 1, unchanged after it — the no-op the gate predicted.
- `/admin/permissions` and `/admin/skus` still open by address after commit 2.
- The switcher renders nine entries with icons; hover shows the correct address;
  Floor opens.
- **Outstanding:** the phone check on `/admin` (commit 4) — deferred by Smart Flow to
  a later sitting. Commit 4's desktop behaviour was verified unchanged.
