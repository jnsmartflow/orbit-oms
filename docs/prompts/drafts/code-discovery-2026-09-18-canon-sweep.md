# Code discovery — canon drift sweep · 2026-09-18

> **Type:** code-discovery (READ + PLAN ONLY). No canonical file, code file or router was edited. No git writes. No database queries. No dev server was running (checked with `tasklist`; no node process).
> **HEAD:** `ec6343ba` (2026-09-18 14:15 IST) · **Sweep baseline:** `7d8ceece` (2026-08-05). See §1 for why the baseline is not ~28 July.
> **Method:** the owner ran Step 1 (git, route table, schema diff, auth/union diffs). Eleven read-only workers then did Steps 2 and 3, one per canon-file group plus two draft classifiers and one for ROADMAP. Every worker read its canonical files in full and followed the sweep rules: code wins, import ≠ call, capability ≠ reachability, name the union, seed ≠ live, char-class greps checked a second way, archive READMEs only. §4 and §6 carry their findings nearly verbatim. Each STALE bullet quotes the canon text and the code line that contradicts it.
> **Code wins.** Wherever this report says "live", it means the code at HEAD. Anything that needs a database or a login is marked, and collected in §8.

## Step 0 — files read

**All files read: 91.**
- **Router and canon (17):** `CLAUDE.md`; the 14 `docs/CLAUDE_*.md` (CORE, UI, MAIL_ORDERS, TINT, SAMPLING_LIBRARY, PLACE_ORDER, ATTENDANCE, IMPORT, TRIP_REPORT, PICKING, NOTIFICATIONS, FLOOR, **and MRN and CI**, which the task list left out but the router routes to); `docs/ROADMAP.md`; `archive/RETIREMENT-PLAYBOOK.md`.
- **Drafts (72):** every file in `docs/prompts/drafts/` (31 code-discovery, 21 code-update, 10 web-update, 1 code-resume, 2 sql, 4 csv, 2 raw `_*.md`, 1 html mockup). The 1.2 MB CSV and one other CSV were read head-only.
- **Other (2):** `archive/README.md` and `archive/2026-09-floor-rail/README.md`, both READMEs only.

### Header vs footer

| File | Header | Footer | Match? | Last commit | Note |
|---|---|---|---|---|---|
| CLAUDE.md (router) | v1.12 · 2026-09-04 | v1.12 · 2026-09-04 | yes | 509d58c5 09-04 | |
| CLAUDE_CORE | v104 · Schema v27.24 · 2026-09-08 | v104 · v27.24 · 2026-09-08 | yes | c73ee93b 09-12 | ⚠ 38b545df, 9bc027a9 and c73ee93b edited the §5 body after 09-08 and bumped neither end |
| CLAUDE_UI | v5.30 · 2026-09-17 | v5.30 · 2026-09-17 | yes | 0db792a1 09-17 | no schema stamp, by design |
| CLAUDE_MAIL_ORDERS | v1.13 · v27.15 · 2026-09-01 | same | yes | 158f64b2 **08-30** | ⚠ forward-dated: the text says 09-01 but its only commit is 08-30 22:47 |
| CLAUDE_TINT | v2.1 · v27.13 · 2026-09-06 | same | yes | 233e88f9 09-06 | |
| CLAUDE_SAMPLING_LIBRARY | v1.6 · v27.13 · 2026-08-04 | same | yes | 7d8ceece 08-05 | |
| CLAUDE_PLACE_ORDER | v1.8 · v27.13 · 2026-08-04 | same | yes | 7d8ceece 08-05 | |
| CLAUDE_ATTENDANCE | v1.3 · v27.13 · 2026-08-04 | same | yes | 7d8ceece 08-05 | |
| CLAUDE_IMPORT | v1.10 · v27.15 · 2026-09-14 | same | yes | c8528fa8 09-14 | |
| CLAUDE_TRIP_REPORT | v1.2 · v27.24 · 2026-09-08 | same | yes | aa525bd4 09-08 | |
| CLAUDE_PICKING | v1.17 · v27.15 · 2026-09-04 | same | yes | 2027b1a4 09-04 | the change-log body has no v1.14, v1.16 or v1.17 entries (footer prose only) |
| CLAUDE_NOTIFICATIONS | v1.3 · v27.13 · 2026-08-12 | same | yes | a2523d16 08-12 | |
| CLAUDE_FLOOR | v1.4 · v27.13 · 2026-08-04 | same | yes | e9fcd612 08-26 | the 08-26 commit edited the body without bumping either end |
| CLAUDE_MRN | v1.1 · v27.20 · 2026-09-04 | same | yes | 0ebb290e 09-04 | |
| CLAUDE_CI | v1.1 · v27.21 · 2026-09-04 | same | yes | 2027b1a4 09-04 | |
| ROADMAP | "Updated 2026-09-06" | "Updated 2026-08-09" | **NO** | 23804504 09-15 | neither stamp matches the last commit; 9 commits after 09-06 bumped neither |
| RETIREMENT-PLAYBOOK | (no stamp) | "last updated 2026-07-28" | n/a | 8bcbabbb 07-28 | missing the 2026-09-13 floor-rail retirement |

No domain file claims a schema stamp newer than CORE's v27.24, so the router's §4 stop condition does not fire. Lagging stamps are normal, and **none may be bumped without a reconciliation pass**.

---

## 1. Baseline, commit count, date range

- **The literal rule does not give ~28 July.** "The last commit that edited any canonical file" is **`0db792a1` (2026-09-17)**, the UI v5.30 edit. Canon has been edited piecemeal almost every day, so no single "last canon edit" can serve as a global baseline. `git log -- docs/CLAUDE_*.md CLAUDE.md` shows edits on 09-04, 09-06, 09-08, 09-09, 09-10, 09-11, 09-12, 09-14 and 09-17.
- **The chosen sweep baseline is `7d8ceece` (2026-08-05, "docs: final pass 12b – CORE v92, v27.13 minted + stamp wave, router billing row, method graduated").** This is the last **full** reconciliation cycle, and it is also the most recent commit for the three oldest files (SAMPLING, PLACE_ORDER, ATTENDANCE). Every canonical file's own last commit is on or after it, so it covers everything any file could be missing. The nearest ~28 July candidates (`63164ed2`/`af72075a`, playbook and retirement) predate it and would add no information.
- **Per-file baselines** are in the Step 0 table ("Last commit"). The workers weighted code changes after each file's own last commit.
- **Range:** `7d8ceece..ec6343ba` = **485 commits**, 2026-08-05 → 2026-09-18. **729 code files changed** under app/, components/, lib/, prisma/, scripts/, public/, middleware, vercel and next.config: 362 added, 346 modified, 21 deleted or renamed; +89,640 / −8,150 lines.

### Commits by module (number of commits touching each path; one commit can count in several rows)

| Module (path) | Commits | | Module (path) | Commits |
|---|---|---|---|---|
| docs/ | 104 | | api/tint | 20 |
| app/po-v2-8f4kd2 → app/po2 (+po9) | 95 + 3 + 1 | | api/picking | 20 |
| components/floor | 80 | | lib/mrn | 17 |
| components/mrn | 53 | | components/billing | 16 |
| components/picking | 48 | | api/mrn | 16 |
| lib/floor | 47 | | lib/permissions | 14 |
| prisma/ | 39 | | scripts/ | 13 |
| lib/picking | 32 | | FLOOR-TO-FLOOR-DISCOVERY.md (repo root) | 13 |
| api/floor | 31 | | sql/ | 13 |
| app/(mail-orders)/mail-orders | 31 | | lib/ci | 12 |
| components/tint | 26 | | api/import | 10 |
| components/admin | 26 | | app/(admin)/admin | 10 |
| components/shared | 24 | | api/billing | 9 |
| components/ci | 24 | | app/mrn | 9 |
| public/ | 23 | | components/mail-orders, api/admin, app/po, app/login | 8 each |
| lib/trips (new) | 22 | | lib/billing, lib/hooks, app/globals.css, components/trip-report | 7 each |

Low counts: middleware.ts 1 (comment only), auth.config.ts 1, lib/auth.ts 1, next.config.mjs 1, vercel.json 0. The full per-module hash lists are in the sweep scratchpad (`bymod.json`), not reproduced here.

**Deletions and moves since baseline:**
- `components/floor/{carryover-banner,floor-board,floor-tabs,slot-band,upcoming-strip}.tsx`, plus more floor components deleted in cdbf95b1 and f41b52c9 (see §4 FLOOR GONE).
- `components/floor/{floor-rail,rail-card,rail-empty,tint-strip}.tsx` moved to `archive/2026-09-floor-rail/` (79bcc412).
- `lib/push/quiet-hours.ts`, `public/category-images/*` (11 images) and `docs/CLAUDE_IMPORT V1.md`.
- Route files deleted: `app/api/floor/pick-visible/route.ts` (791a2cd6; an **empty folder** remains) and `app/api/floor/trips/[id]/release/route.ts` (8eaa4663).

### Step 1.5 — auth, middleware, config and the unions

| Artefact | Changed since baseline? | What changed | Union / surface touched |
|---|---|---|---|
| `middleware.ts` | comment only | adds a 🔴 comment that the HMAC machine path stays exempt from the Import OBDs tick. `PUBLIC_PATHS` is unchanged, and the `"/order"` survivor entry is intact. Its "line 26" comment is stale (the check is at `:36`) | none |
| `auth.config.ts` | yes | `isSuperuser?: boolean` on Session.user, User and JWT; session callback `token.isSuperuser === true` | session/JWT shape (not a union) |
| `lib/auth.ts` | yes | `fetchUserAttendanceFlags` also reads `users.isSuperuser` and re-stamps it on the 5-min stale window, so no re-login is needed | JWT claim |
| `lib/rbac.ts` | yes | adds `isSuperuser()` / `requireSuperuser()` (flag OR admin role, both arms deliberate). **`ROLE_REDIRECTS` unchanged apart from comments** | role-slug landing map: unchanged |
| `vercel.json` | **no** | crons `attendance-rollover 35 18 * * *` and `attendance-purge 30 20 * * *` | — |
| `next.config.mjs` | yes | rewrite `/.well-known/assetlinks.json → /assetlinks.json` (TWA). Redirects unchanged (`/ti-report`, `/tint/manager/ti-report` → `/reports?r=ti-report`) | — |
| **`PageKey` union** (`lib/permissions.ts:205`) | **yes, +14** | `tint_panel_items`, `tint_panel_details`, `tint_panel_activity`, `place_order_ship_to`, `billing_picking`, `billing_print`, `billing_hold`, `billing_slot`, `billing_urgent`, `billing_ship_to`, `mrn`, `ci`, `reports_tint_summary`, `reports_ti_report`. `ALL_PAGE_KEYS` = **39** | **PageKey** |
| `PAGE_NAV_MAP` | yes | `mail_orders` label "Mail Orders" → **"Billing"**; new rows `mrn → /mrn` and **`ci → /ci`** (so CI IS in the nav: 55c3cdc6, 2026-08-31) | PageKey-keyed nav |
| New in permissions | yes | `REPORT_PAGE_KEYS` + `canViewAnyReport` (the Reports nav row, PageKey `ti_report`, now shows when ANY report key is viewable; `ti_report` is labelled "legacy — no effect"); `ACTION_PAGES` / `isActionAvailable`; `PAGE_LABEL_OVERRIDES` / `pageLabel`; `ACCESS_SECTIONS` (39 keys, 5 groups); `checkAnyPermission` gains a superuser arm and a **user mode** (`user_page_access`, behind `lib/access/source.ts` `ACCESS_SOURCE`, 30 s cache) | PageKey |
| **`RoleSidebarRole` union** (`components/shared/role-sidebar.tsx:18`) | **no** | still the 11 slugs `support, tint_manager, tint_operator, import, support_import, planning, warehouse, operations, ops_admin, billing_operator, operation_manager`. The sidebar changes are the icon map (`floor: LayoutGrid`, `mrn: Container`, `ci: Undo2`), the OrbitWordmark and the violet palette. ⚠ The union still **lacks** `admin, dispatcher, floor_supervisor, picker, logistics, floor_access` (the role-census draft Q7 says their heading renders empty) | **RoleSidebarRole**: unchanged, and incomplete |
| Permission **seed** (`prisma/seed.ts`) | yes (+208) | **Seed says:** `mrn` and `ci` rows for billing_operator, floor_supervisor and operations; `billing_picking`, `billing_print`, `billing_hold/slot/urgent/ship_to` for billing_operator, operations, operation_manager and tint_manager (canEdit); `tint_panel_*` view for tint_manager and operation_manager; `reports_tint_summary` view and `reports_ti_report` view+export for tint_manager and operation_manager; 8 `ci_reason_master` rows. Seed writes **no** `user_page_access` or `isSuperuser` rows | role slugs (seed only; **not live**) |

---

## 2. Route table

The table was built from the filesystem: every `page.tsx` and `route.ts` under `app/`, with route groups stripped. That gives **322 routes: 80 pages and 242 API handlers**, in 85 families.

**How "documented" was decided.** A route is "documented" if its full path (dynamic segments wildcarded) appears in any `CLAUDE*.md`. That check was then repeated a second way with MSYS `grep -E` using char-class paths (`floor[/]trips`, `billing[/]print`, …), and the two methods agreed on every family spot-checked. It is a **path-level** test, so a route that canon describes in prose without its full path shows as UNDOCUMENTED. The workers resolved the important ones in §4. Examples: the MRN routes `header`, `line/[lineId]`, `photos`, `board` and `resolve-skus` are covered in MRN prose, and so is `/api/auth`.

**Result: 184 documented, 138 UNDOCUMENTED by full path.** Of the 138, **the ones that matter** (shipped since baseline, no canon anywhere) are:
- the whole **`/api/floor/trips/*`** family (9 routes), `/api/floor/pick-gate` and `/api/floor/tint-operators`
- **`/api/billing/print/*`** (3), and `/api/billing/picking/{mark-done,marker,undo}` by path
- **`/po9`**, **`/po-v2-8f4kd2`** (redirect) and the two `manifest.webmanifest` handlers. `/po2` itself is mentioned only in UI and ROADMAP, so it has no module canon.
- `/api/tint/manager/{base-bypass, base-bypass/undo, base-pending}` and `/api/tint/operator/history`
- `/api/picking/{cancel, tint-workload, tint-workload/marker, push-test}`
- `/api/import/access`, `/api/admin/access/[userId]`, `/api/admin/tag-audience`, `/api/mail-orders/marker`, `/api/user/notes-font-size` and `/api/sampling-library/suggest`

The rest of the 138 are pre-baseline master-data CRUD (`/admin/*` pages and `/api/admin/*`). Canon covers those only as "Core only — stubs" (router §3), which is an accepted gap, not new drift.

**Documented-but-gone.** No **live-claimed** route is missing from the tree. Every canon path that no longer resolves (`/api/support/*`, `/api/planning/*`, `/api/warehouse/board`, `/order`) is already described as retired. The survivors are present and must stay documented as live: `app/api/warehouse/pickers/route.ts`, the four `app/(dispatcher)/dispatcher/{customers,routes,skus,vehicles}` pages, and the middleware `"/order"` entry. `lib/slot-history.ts` also still exists. Two routes were deleted since baseline, but **canon never documented either**:
- `/api/floor/pick-visible`: the folder is still present and empty
- `/api/floor/trips/[id]/release`

Everything else that is gone is a component, function or view rather than a route; see §4 FLOOR/UI GONE.

| Family | Pages | APIs | Documented | UNDOCUMENTED (full path not found in any CLAUDE*.md) |
|---|---|---|---|---|
| `/` | 1 | 0 | 1 | — |
| `/admin` | 28 | 0 | 10 | `/admin/areas`, `/admin/base-colours`, `/admin/contact-roles`, `/admin/delivery-types`, `/admin/dispatch-cutoffs`, `/admin/product-categories`, `/admin/product-names`, `/admin/roles`, `/admin/routes`, `/admin/sales-officers`, `/admin/skus/[id]/sub-skus`, `/admin/slot-rules`, `/admin/so-groups`, `/admin/sub-areas`, `/admin/system-config`, `/admin/tint-manager`, `/admin/transporters`, `/admin/vehicles` |
| `/admin/attendance` | 4 | 0 | 4 | — |
| `/api/admin/access` | 0 | 1 | 0 | `/api/admin/access/[userId]` |
| `/api/admin/areas` | 0 | 3 | 0 | `/api/admin/areas/[id]`, `/api/admin/areas/import`, `/api/admin/areas` |
| `/api/admin/attendance` | 0 | 6 | 6 | — |
| `/api/admin/base-colours` | 0 | 3 | 0 | `/api/admin/base-colours/[id]`, `/api/admin/base-colours/import`, `/api/admin/base-colours` |
| `/api/admin/contact-roles` | 0 | 2 | 0 | `/api/admin/contact-roles/[id]`, `/api/admin/contact-roles` |
| `/api/admin/customer-types` | 0 | 1 | 0 | `/api/admin/customer-types` |
| `/api/admin/customers` | 0 | 3 | 2 | `/api/admin/customers/import` |
| `/api/admin/delivery-types` | 0 | 1 | 0 | `/api/admin/delivery-types` |
| `/api/admin/dispatch-cutoffs` | 0 | 2 | 0 | `/api/admin/dispatch-cutoffs/[id]`, `/api/admin/dispatch-cutoffs` |
| `/api/admin/fix-challans` | 0 | 1 | 1 | — |
| `/api/admin/fix-slots` | 0 | 1 | 1 | — |
| `/api/admin/hide` | 0 | 5 | 0 | `/api/admin/hide/hidden-orders`, `/api/admin/hide/orders/[id]/hide`, `/api/admin/hide/orders/[id]/unhide`, `/api/admin/hide/rules/[id]`, `/api/admin/hide/rules` |
| `/api/admin/permissions` | 0 | 2 | 2 | — |
| `/api/admin/premises-types` | 0 | 1 | 0 | `/api/admin/premises-types` |
| `/api/admin/product-categories` | 0 | 3 | 0 | `/api/admin/product-categories/[id]`, `/api/admin/product-categories/import`, `/api/admin/product-categories` |
| `/api/admin/product-names` | 0 | 3 | 0 | `/api/admin/product-names/[id]`, `/api/admin/product-names/import`, `/api/admin/product-names` |
| `/api/admin/removed-orders` | 0 | 2 | 2 | — |
| `/api/admin/routes` | 0 | 3 | 0 | `/api/admin/routes/[id]`, `/api/admin/routes/import`, `/api/admin/routes` |
| `/api/admin/sales-officers` | 0 | 3 | 0 | `/api/admin/sales-officers/[id]`, `/api/admin/sales-officers/import`, `/api/admin/sales-officers` |
| `/api/admin/shades` | 0 | 2 | 2 | — |
| `/api/admin/skus` | 0 | 4 | 2 | `/api/admin/skus/[id]/sub-skus`, `/api/admin/skus/import` |
| `/api/admin/slot-rules` | 0 | 2 | 0 | `/api/admin/slot-rules/[id]`, `/api/admin/slot-rules` |
| `/api/admin/slots` | 0 | 2 | 2 | — |
| `/api/admin/so-groups` | 0 | 2 | 0 | `/api/admin/so-groups/[id]`, `/api/admin/so-groups` |
| `/api/admin/sub-areas` | 0 | 3 | 0 | `/api/admin/sub-areas/[id]`, `/api/admin/sub-areas/import`, `/api/admin/sub-areas` |
| `/api/admin/system-config` | 0 | 1 | 0 | `/api/admin/system-config` |
| `/api/admin/tag-audience` | 0 | 1 | 0 | `/api/admin/tag-audience` |
| `/api/admin/tag-settings` | 0 | 1 | 0 | `/api/admin/tag-settings` |
| `/api/admin/transporters` | 0 | 3 | 0 | `/api/admin/transporters/[id]`, `/api/admin/transporters/import`, `/api/admin/transporters` |
| `/api/admin/users` | 0 | 2 | 2 | — |
| `/api/admin/vehicles` | 0 | 3 | 0 | `/api/admin/vehicles/[id]`, `/api/admin/vehicles/import`, `/api/admin/vehicles` |
| `/api/attendance` | 0 | 3 | 3 | — |
| `/api/auth` | 0 | 1 | 0 | `/api/auth/[...nextauth]` |
| `/api/billing/dispatch-windows` | 0 | 1 | 1 | — |
| `/api/billing/mail-order` | 0 | 1 | 1 | — |
| `/api/billing/picking` | 0 | 5 | 2 | `/api/billing/picking/mark-done`, `/api/billing/picking/marker`, `/api/billing/picking/undo` |
| `/api/billing/print` | 0 | 3 | 0 | `/api/billing/print/list`, `/api/billing/print/marker`, `/api/billing/print/trip/[id]/copy` |
| `/api/billing/ship-to-search` | 0 | 1 | 1 | — |
| `/api/ci` | 0 | 12 | 8 | `/api/ci/[ciId]/details`, `/api/ci/[ciId]/lines`, `/api/ci/[ciId]/submit`, `/api/ci/board` |
| `/api/cron` | 0 | 2 | 2 | — |
| `/api/floor` | 0 | 20 | 9 | `/api/floor/pick-gate`, `/api/floor/tint-operators`, `/api/floor/trips/[id]/billing`, `/api/floor/trips/[id]/bills`, `/api/floor/trips/[id]/cancel`, `/api/floor/trips/[id]/confirm`, `/api/floor/trips/[id]/dispatch`, `/api/floor/trips/[id]`, `/api/floor/trips/[id]/show`, `/api/floor/trips/options`, `/api/floor/trips` |
| `/api/health` | 0 | 1 | 1 | — |
| `/api/import` | 0 | 2 | 1 | `/api/import/access` |
| `/api/mail-orders` | 0 | 20 | 18 | `/api/mail-orders/[id]/note`, `/api/mail-orders/marker` |
| `/api/mrn` | 0 | 16 | 11 | `/api/mrn/[mrnId]/header`, `/api/mrn/[mrnId]/line/[lineId]`, `/api/mrn/[mrnId]/photos`, `/api/mrn/board`, `/api/mrn/resolve-skus` |
| `/api/operations` | 0 | 1 | 0 | `/api/operations/summary` |
| `/api/order` | 0 | 1 | 1 | — |
| `/api/orders` | 0 | 3 | 2 | `/api/orders/[id]/audit-history` |
| `/api/picking` | 0 | 15 | 11 | `/api/picking/cancel`, `/api/picking/push-test`, `/api/picking/tint-workload/marker`, `/api/picking/tint-workload` |
| `/api/place-order` | 0 | 3 | 2 | `/api/place-order/last-order/[customerCode]` |
| `/api/push` | 0 | 3 | 3 | — |
| `/api/reports` | 0 | 1 | 1 | — |
| `/api/sampling-library` | 0 | 8 | 7 | `/api/sampling-library/suggest` |
| `/api/system-config` | 0 | 1 | 0 | `/api/system-config/slot-cutoffs` |
| `/api/tint/manager` | 0 | 25 | 13 | `/api/tint/manager/assign`, `/api/tint/manager/base-bypass`, `/api/tint/manager/base-bypass/undo`, `/api/tint/manager/base-pending`, `/api/tint/manager/manual-entry/lookup`, `/api/tint/manager/manual-entry/revert`, `/api/tint/manager/manual-entry`, `/api/tint/manager/missing-customers`, `/api/tint/manager/operators`, `/api/tint/manager/orders/[id]/splits`, `/api/tint/manager/splits/[id]/status`, `/api/tint/manager/ti-report` |
| `/api/tint/operator` | 0 | 15 | 8 | `/api/tint/operator/history`, `/api/tint/operator/shades/[id]`, `/api/tint/operator/shades`, `/api/tint/operator/split/start`, `/api/tint/operator/tinter-issue/[id]`, `/api/tint/operator/tinter-issue-b/[id]`, `/api/tint/operator/tinter-issue-b` |
| `/api/trips` | 0 | 2 | 2 | — |
| `/api/user` | 0 | 1 | 0 | `/api/user/notes-font-size` |
| `/api/warehouse` | 0 | 1 | 1 | — |
| `/attendance` | 5 | 0 | 5 | — |
| `/challan` | 1 | 0 | 0 | `/challan` |
| `/ci` | 1 | 0 | 1 | — |
| `/dispatcher` | 4 | 0 | 4 | — |
| `/floor` | 1 | 0 | 1 | — |
| `/import` | 1 | 0 | 1 | — |
| `/login` | 1 | 0 | 1 | — |
| `/mail-orders` | 1 | 0 | 1 | — |
| `/mrn` | 2 | 0 | 2 | — |
| `/not-ready` | 1 | 0 | 1 | — |
| `/operations` | 3 | 0 | 2 | `/operations/tint-operator` |
| `/orders` | 1 | 0 | 1 | — |
| `/picking` | 2 | 0 | 2 | — |
| `/place-order` | 1 | 0 | 1 | — |
| `/po` | 1 | 0 | 1 | — |
| `/po-v2-8f4kd2` | 1 | 0 | 0 | `/po-v2-8f4kd2` |
| `/po2` | 1 | 1 | 1 | `/po2/manifest.webmanifest` |
| `/po9` | 1 | 1 | 0 | `/po9/manifest.webmanifest`, `/po9` |
| `/reports` | 3 | 0 | 3 | — |
| `/ti-report` | 1 | 0 | 1 | — |
| `/tint` | 11 | 0 | 6 | `/tint/manager/challan`, `/tint/manager/routes`, `/tint/manager/skus`, `/tint/manager/vehicles`, `/tint/shades` |
| `/trips` | 2 | 0 | 2 | — |
| `/unauthorized` | 1 | 0 | 1 | — |

**Route-level notes (capability ≠ reachability):**

- `/api/auth/[...nextauth]` — NextAuth handler; canon refers to `/api/auth` generically (CORE §12) — treat as documented
- `/po2/manifest.webmanifest` — NEW — /po2 PWA manifest (route handler, built from app/po2/v2-manifest.ts)
- `/po9/manifest.webmanifest` — NEW — /po9 PWA manifest
- `/po9` — NEW 2026-09-15 (23804504) — /po2 mounted with ship-to off; public via "/po" prefix
- `/po-v2-8f4kd2` — redirect("/po2") stub (145b5f32)
- `/api/floor/trips/[id]/confirm` — no client caller since slice 6 — kept on purpose
- `/api/floor/trips/[id]/dispatch` — no client caller since slice 7 — kept on purpose; only writer of workflowStage=dispatched
- `/api/picking/push-test` — throwaway push proof endpoint, called by /picking/push-test
- `/api/tint/operator/shades` — no in-app caller (only a comment) — external caller not ruled out
- `/api/tint/operator/shades/[id]` — no in-app caller
- `/api/system-config/slot-cutoffs` — 0 callers since c103d5f4 (orphaned)
- `/admin/tint-manager` — renders TintManagerContent WITHOUT its access provider — panel tabs/Reports pill hidden; URL-only

<details><summary>Full per-route list (322 rows: URL · kind · status · canon files that mention it)</summary>

| URL | Kind | Status | Mentioned in |
|---|---|---|---|
| `/admin/access` | PAGE | documented | CORE,TINT,UI |
| `/admin/areas` | PAGE | **UNDOCUMENTED** |  |
| `/admin/base-colours` | PAGE | **UNDOCUMENTED** |  |
| `/admin/contact-roles` | PAGE | **UNDOCUMENTED** |  |
| `/admin/customers` | PAGE | documented | CORE,MAIL_ORDERS |
| `/admin/delivery-types` | PAGE | **UNDOCUMENTED** |  |
| `/admin/dispatch-cutoffs` | PAGE | **UNDOCUMENTED** |  |
| `/admin/import` | PAGE | documented | CLAUDE,CORE,IMPORT |
| `/admin` | PAGE | documented | CLAUDE,ATTENDANCE,CORE,IMPORT,MAIL_ORDERS,TINT,UI |
| `/admin/permissions` | PAGE | documented | CORE |
| `/admin/product-categories` | PAGE | **UNDOCUMENTED** |  |
| `/admin/product-names` | PAGE | **UNDOCUMENTED** |  |
| `/admin/removed-orders` | PAGE | documented | TINT |
| `/admin/roles` | PAGE | **UNDOCUMENTED** |  |
| `/admin/routes` | PAGE | **UNDOCUMENTED** |  |
| `/admin/sales-officers` | PAGE | **UNDOCUMENTED** |  |
| `/admin/settings/hide` | PAGE | documented | CORE |
| `/admin/skus/[id]/sub-skus` | PAGE | **UNDOCUMENTED** |  |
| `/admin/skus` | PAGE | documented | CORE |
| `/admin/slot-rules` | PAGE | **UNDOCUMENTED** |  |
| `/admin/slots` | PAGE | documented | MAIL_ORDERS |
| `/admin/so-groups` | PAGE | **UNDOCUMENTED** |  |
| `/admin/sub-areas` | PAGE | **UNDOCUMENTED** |  |
| `/admin/system-config` | PAGE | **UNDOCUMENTED** |  |
| `/admin/tint-manager` | PAGE | **UNDOCUMENTED** |  |
| `/admin/transporters` | PAGE | **UNDOCUMENTED** |  |
| `/admin/users` | PAGE | documented | CORE |
| `/admin/vehicles` | PAGE | **UNDOCUMENTED** |  |
| `/dispatcher/customers` | PAGE | documented | CORE |
| `/dispatcher/routes` | PAGE | documented | CORE |
| `/dispatcher/skus` | PAGE | documented | CORE |
| `/dispatcher/vehicles` | PAGE | documented | CORE |
| `/floor` | PAGE | documented | CLAUDE,CI,CORE,FLOOR,IMPORT,MAIL_ORDERS,MRN,NOTIFICATIONS,PICKING,TINT,TRIP_REPORT,UI |
| `/import` | PAGE | documented | CLAUDE,CORE,IMPORT,MAIL_ORDERS,PLACE_ORDER,TINT |
| `/mail-orders` | PAGE | documented | CLAUDE,CORE,FLOOR,MAIL_ORDERS,UI |
| `/operations` | PAGE | documented | CLAUDE,CORE,PICKING,TINT |
| `/operations/tinting` | PAGE | documented | CORE |
| `/operations/tint-operator` | PAGE | **UNDOCUMENTED** |  |
| `/admin/attendance/ot-audit` | PAGE | documented | ATTENDANCE,UI |
| `/admin/attendance/ot-pending` | PAGE | documented | ATTENDANCE,UI |
| `/admin/attendance` | PAGE | documented | ATTENDANCE,CORE,UI |
| `/admin/attendance/settings` | PAGE | documented | ATTENDANCE,UI |
| `/place-order` | PAGE | documented | CLAUDE,CI,CORE,MAIL_ORDERS,PICKING,PLACE_ORDER,UI |
| `/challan` | PAGE | **UNDOCUMENTED** |  |
| `/tint/manager/challan` | PAGE | **UNDOCUMENTED** |  |
| `/tint/manager/customers` | PAGE | documented | CORE |
| `/tint/manager` | PAGE | documented | CLAUDE,CORE,TINT,UI |
| `/tint/manager/routes` | PAGE | **UNDOCUMENTED** |  |
| `/tint/manager/shades` | PAGE | documented | TINT |
| `/tint/manager/skus` | PAGE | **UNDOCUMENTED** |  |
| `/tint/manager/ti-report` | PAGE | documented | CORE,TINT |
| `/tint/manager/vehicles` | PAGE | **UNDOCUMENTED** |  |
| `/tint/operator` | PAGE | documented | CLAUDE,CORE,SAMPLING_LIBRARY,TINT |
| `/tint/sampling-library` | PAGE | documented | CLAUDE,CORE,SAMPLING_LIBRARY,UI |
| `/tint/shades` | PAGE | **UNDOCUMENTED** |  |
| `/ti-report` | PAGE | documented | CORE,TINT |
| `/api/admin/access/[userId]` | API | **UNDOCUMENTED** |  |
| `/api/admin/areas/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/areas/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/areas` | API | **UNDOCUMENTED** |  |
| `/api/admin/attendance/export` | API | documented | ATTENDANCE |
| `/api/admin/attendance/ot-audit` | API | documented | ATTENDANCE |
| `/api/admin/attendance/ot-pending/[recordId]` | API | documented | ATTENDANCE |
| `/api/admin/attendance/ot-pending` | API | documented | ATTENDANCE |
| `/api/admin/attendance/photo` | API | documented | ATTENDANCE,UI |
| `/api/admin/attendance/settings` | API | documented | ATTENDANCE |
| `/api/admin/base-colours/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/base-colours/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/base-colours` | API | **UNDOCUMENTED** |  |
| `/api/admin/contact-roles/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/contact-roles` | API | **UNDOCUMENTED** |  |
| `/api/admin/customers/[id]` | API | documented | CORE |
| `/api/admin/customers/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/customers` | API | documented | CORE,MAIL_ORDERS |
| `/api/admin/customer-types` | API | **UNDOCUMENTED** |  |
| `/api/admin/delivery-types` | API | **UNDOCUMENTED** |  |
| `/api/admin/dispatch-cutoffs/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/dispatch-cutoffs` | API | **UNDOCUMENTED** |  |
| `/api/admin/fix-challans` | API | documented | CORE |
| `/api/admin/fix-slots` | API | documented | CORE |
| `/api/admin/hide/hidden-orders` | API | **UNDOCUMENTED** |  |
| `/api/admin/hide/orders/[id]/hide` | API | **UNDOCUMENTED** |  |
| `/api/admin/hide/orders/[id]/unhide` | API | **UNDOCUMENTED** |  |
| `/api/admin/hide/rules/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/hide/rules` | API | **UNDOCUMENTED** |  |
| `/api/admin/permissions/[roleSlug]` | API | documented | CORE |
| `/api/admin/permissions` | API | documented | CORE |
| `/api/admin/premises-types` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-categories/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-categories/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-categories` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-names/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-names/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/product-names` | API | **UNDOCUMENTED** |  |
| `/api/admin/removed-orders/[id]/restore` | API | documented | TINT |
| `/api/admin/removed-orders` | API | documented | TINT |
| `/api/admin/routes/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/routes/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/routes` | API | **UNDOCUMENTED** |  |
| `/api/admin/sales-officers/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/sales-officers/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/sales-officers` | API | **UNDOCUMENTED** |  |
| `/api/admin/shades/[id]` | API | documented | TINT |
| `/api/admin/shades` | API | documented | TINT |
| `/api/admin/skus/[id]` | API | documented | CORE |
| `/api/admin/skus/[id]/sub-skus` | API | **UNDOCUMENTED** |  |
| `/api/admin/skus/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/skus` | API | documented | CORE |
| `/api/admin/slot-rules/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/slot-rules` | API | **UNDOCUMENTED** |  |
| `/api/admin/slots/[id]` | API | documented | MAIL_ORDERS |
| `/api/admin/slots` | API | documented | MAIL_ORDERS |
| `/api/admin/so-groups/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/so-groups` | API | **UNDOCUMENTED** |  |
| `/api/admin/sub-areas/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/sub-areas/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/sub-areas` | API | **UNDOCUMENTED** |  |
| `/api/admin/system-config` | API | **UNDOCUMENTED** |  |
| `/api/admin/tag-audience` | API | **UNDOCUMENTED** |  |
| `/api/admin/tag-settings` | API | **UNDOCUMENTED** |  |
| `/api/admin/transporters/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/transporters/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/transporters` | API | **UNDOCUMENTED** |  |
| `/api/admin/users/[id]` | API | documented | CORE |
| `/api/admin/users` | API | documented | CORE |
| `/api/admin/vehicles/[id]` | API | **UNDOCUMENTED** |  |
| `/api/admin/vehicles/import` | API | **UNDOCUMENTED** |  |
| `/api/admin/vehicles` | API | **UNDOCUMENTED** |  |
| `/api/attendance/check-in` | API | documented | ATTENDANCE |
| `/api/attendance/check-out` | API | documented | ATTENDANCE |
| `/api/attendance/consent` | API | documented | ATTENDANCE |
| `/api/auth/[...nextauth]` | API | **UNDOCUMENTED** |  |
| `/api/billing/dispatch-windows` | API | documented | MAIL_ORDERS |
| `/api/billing/mail-order/actions` | API | documented | CORE,MAIL_ORDERS |
| `/api/billing/picking/list` | API | documented | IMPORT,MAIL_ORDERS |
| `/api/billing/picking/mark-done` | API | **UNDOCUMENTED** |  |
| `/api/billing/picking/marker` | API | **UNDOCUMENTED** |  |
| `/api/billing/picking/order/[orderId]` | API | documented | MAIL_ORDERS |
| `/api/billing/picking/undo` | API | **UNDOCUMENTED** |  |
| `/api/billing/print/list` | API | **UNDOCUMENTED** |  |
| `/api/billing/print/marker` | API | **UNDOCUMENTED** |  |
| `/api/billing/print/trip/[id]/copy` | API | **UNDOCUMENTED** |  |
| `/api/billing/ship-to-search` | API | documented | MAIL_ORDERS |
| `/api/ci/[ciId]/close` | API | documented | CI,MRN |
| `/api/ci/[ciId]/details` | API | **UNDOCUMENTED** |  |
| `/api/ci/[ciId]/lines` | API | **UNDOCUMENTED** |  |
| `/api/ci/[ciId]` | API | documented | CLAUDE,CI,CORE,MRN |
| `/api/ci/[ciId]/submit` | API | **UNDOCUMENTED** |  |
| `/api/ci/bill/[orderId]` | API | documented | CI |
| `/api/ci/board` | API | **UNDOCUMENTED** |  |
| `/api/ci/draft` | API | documented | CI |
| `/api/ci/export` | API | documented | CI,CORE |
| `/api/ci/marker` | API | documented | CI |
| `/api/ci/reasons` | API | documented | CI |
| `/api/ci/search` | API | documented | CI |
| `/api/cron/attendance-purge` | API | documented | ATTENDANCE,MRN |
| `/api/cron/attendance-rollover` | API | documented | ATTENDANCE |
| `/api/floor/actions` | API | documented | FLOOR |
| `/api/floor/board` | API | documented | FLOOR |
| `/api/floor/cancelled` | API | documented | FLOOR |
| `/api/floor/hold` | API | documented | FLOOR |
| `/api/floor/marker` | API | documented | CLAUDE,FLOOR,PICKING,TINT |
| `/api/floor/order/[orderId]` | API | documented | FLOOR,MAIL_ORDERS |
| `/api/floor/pick-gate` | API | **UNDOCUMENTED** |  |
| `/api/floor/release` | API | documented | FLOOR |
| `/api/floor/ship-to` | API | documented | FLOOR |
| `/api/floor/ship-to-search` | API | documented | FLOOR |
| `/api/floor/tint-operators` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/billing` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/bills` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/cancel` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/confirm` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/dispatch` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/[id]/show` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips/options` | API | **UNDOCUMENTED** |  |
| `/api/floor/trips` | API | **UNDOCUMENTED** |  |
| `/api/health` | API | documented | CORE |
| `/api/import/access` | API | **UNDOCUMENTED** |  |
| `/api/import/obd` | API | documented | CORE,IMPORT,MAIL_ORDERS,TINT |
| `/api/mail-orders/[id]/customer` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/[id]/lock` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/[id]/note` | API | **UNDOCUMENTED** |  |
| `/api/mail-orders/[id]/original-lines` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/[id]/punch` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/[id]/so-number` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/[id]/split` | API | documented | MAIL_ORDERS,UI |
| `/api/mail-orders/backfill-customers` | API | documented | CORE |
| `/api/mail-orders/backfill-enrich` | API | documented | CORE,MAIL_ORDERS |
| `/api/mail-orders/customers/search` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/debug-enrich` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/ingest` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/keywords` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/learn-customer` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/lines/[lineId]/resolve` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/lines/[lineId]/status` | API | documented | MAIL_ORDERS |
| `/api/mail-orders/marker` | API | **UNDOCUMENTED** |  |
| `/api/mail-orders/re-enrich` | API | documented | MAIL_ORDERS |
| `/api/mail-orders` | API | documented | CORE,MAIL_ORDERS,UI |
| `/api/mail-orders/skus` | API | documented | MAIL_ORDERS |
| `/api/mrn/[mrnId]/close` | API | documented | CORE,MRN |
| `/api/mrn/[mrnId]/delete` | API | documented | MRN |
| `/api/mrn/[mrnId]/end` | API | documented | MRN |
| `/api/mrn/[mrnId]/export` | API | documented | CI,CORE |
| `/api/mrn/[mrnId]/header` | API | **UNDOCUMENTED** |  |
| `/api/mrn/[mrnId]/line/[lineId]` | API | **UNDOCUMENTED** |  |
| `/api/mrn/[mrnId]/lines` | API | documented | MRN |
| `/api/mrn/[mrnId]/photo` | API | documented | MRN |
| `/api/mrn/[mrnId]/photos` | API | **UNDOCUMENTED** |  |
| `/api/mrn/[mrnId]` | API | documented | CLAUDE,CI,CORE,MRN |
| `/api/mrn/[mrnId]/start` | API | documented | MRN |
| `/api/mrn/board` | API | **UNDOCUMENTED** |  |
| `/api/mrn/create` | API | documented | MRN |
| `/api/mrn/marker` | API | documented | MRN |
| `/api/mrn/photo/[photoId]` | API | documented | CORE,MRN |
| `/api/mrn/resolve-skus` | API | **UNDOCUMENTED** |  |
| `/api/operations/summary` | API | **UNDOCUMENTED** |  |
| `/api/order/data` | API | documented | CORE,PLACE_ORDER |
| `/api/orders/[id]/audit-history` | API | **UNDOCUMENTED** |  |
| `/api/orders/[id]/detail` | API | documented | CORE |
| `/api/orders/[id]/removed-lines` | API | documented | CORE |
| `/api/picking/approve` | API | documented | PICKING |
| `/api/picking/assign` | API | documented | FLOOR,NOTIFICATIONS,PICKING |
| `/api/picking/cancel` | API | **UNDOCUMENTED** |  |
| `/api/picking/combined` | API | documented | PICKING |
| `/api/picking/done` | API | documented | NOTIFICATIONS,PICKING |
| `/api/picking/findings/confirm` | API | documented | CI,PICKING |
| `/api/picking/findings/report` | API | documented | CORE,PICKING |
| `/api/picking/marker` | API | documented | NOTIFICATIONS,PICKING |
| `/api/picking/order/[orderId]` | API | documented | CORE,PICKING |
| `/api/picking/push-test` | API | **UNDOCUMENTED** |  |
| `/api/picking/queue` | API | documented | PICKING |
| `/api/picking/release` | API | documented | PICKING |
| `/api/picking/tint-workload/marker` | API | **UNDOCUMENTED** |  |
| `/api/picking/tint-workload` | API | **UNDOCUMENTED** |  |
| `/api/picking/unassign` | API | documented | FLOOR,PICKING |
| `/api/place-order/data` | API | documented | CORE,PLACE_ORDER |
| `/api/place-order/last-order/[customerCode]` | API | **UNDOCUMENTED** |  |
| `/api/place-order/quick-tiles` | API | documented | PLACE_ORDER |
| `/api/push/subscribe` | API | documented | NOTIFICATIONS |
| `/api/push/test-saved` | API | documented | NOTIFICATIONS |
| `/api/push/unsubscribe` | API | documented | NOTIFICATIONS |
| `/api/reports/tint-summary` | API | documented | CORE,TINT |
| `/api/sampling-library/[samplingNo]/review` | API | documented | SAMPLING_LIBRARY |
| `/api/sampling-library/[samplingNo]` | API | documented | SAMPLING_LIBRARY,TINT |
| `/api/sampling-library/[samplingNo]/usage-log` | API | documented | SAMPLING_LIBRARY |
| `/api/sampling-library/[samplingNo]/variants` | API | documented | SAMPLING_LIBRARY |
| `/api/sampling-library/formula-match` | API | documented | SAMPLING_LIBRARY,TINT |
| `/api/sampling-library/operator-search` | API | documented | SAMPLING_LIBRARY |
| `/api/sampling-library` | API | documented | SAMPLING_LIBRARY,TINT |
| `/api/sampling-library/suggest` | API | **UNDOCUMENTED** |  |
| `/api/system-config/slot-cutoffs` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/assign` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/base-bypass` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/base-bypass/undo` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/base-pending` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/cancel-assignment` | API | documented | TINT |
| `/api/tint/manager/challans/[orderId]` | API | documented | CORE,TINT |
| `/api/tint/manager/challans` | API | documented | CORE,TINT |
| `/api/tint/manager/manual-entry/lookup` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/manual-entry/revert` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/manual-entry` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/marker` | API | documented | TINT |
| `/api/tint/manager/missing-customers` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/operators` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/orders/[id]/pause-history` | API | documented | TINT |
| `/api/tint/manager/orders/[id]/remove` | API | documented | TINT |
| `/api/tint/manager/orders/[id]/skip-history` | API | documented | TINT |
| `/api/tint/manager/orders/[id]/splits` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/orders/[id]/status` | API | documented | TINT |
| `/api/tint/manager/orders` | API | documented | CORE,TINT |
| `/api/tint/manager/reorder` | API | documented | CORE,TINT |
| `/api/tint/manager/splits/[id]/status` | API | **UNDOCUMENTED** |  |
| `/api/tint/manager/splits/cancel` | API | documented | TINT |
| `/api/tint/manager/splits/create` | API | documented | TINT |
| `/api/tint/manager/splits/reassign` | API | documented | TINT |
| `/api/tint/manager/ti-report` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/done` | API | documented | TINT |
| `/api/tint/operator/history` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/my-orders` | API | documented | TINT |
| `/api/tint/operator/pause` | API | documented | CORE,TINT |
| `/api/tint/operator/resume` | API | documented | TINT |
| `/api/tint/operator/shades/[id]` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/shades` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/skip` | API | documented | TINT |
| `/api/tint/operator/split/done` | API | documented | CORE,SAMPLING_LIBRARY,TINT |
| `/api/tint/operator/split/start` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/start` | API | documented | TINT |
| `/api/tint/operator/tinter-issue/[id]` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/tinter-issue` | API | documented | TINT |
| `/api/tint/operator/tinter-issue-b/[id]` | API | **UNDOCUMENTED** |  |
| `/api/tint/operator/tinter-issue-b` | API | **UNDOCUMENTED** |  |
| `/api/trips/[tripNo]` | API | documented | TRIP_REPORT |
| `/api/trips` | API | documented | TRIP_REPORT |
| `/api/user/notes-font-size` | API | **UNDOCUMENTED** |  |
| `/api/warehouse/pickers` | API | documented | CLAUDE,CORE,PICKING |
| `/attendance/check-in` | PAGE | documented | ATTENDANCE |
| `/attendance/check-out` | PAGE | documented | ATTENDANCE,UI |
| `/attendance/consent` | PAGE | documented | ATTENDANCE |
| `/attendance/history` | PAGE | documented | ATTENDANCE |
| `/attendance` | PAGE | documented | CLAUDE,ATTENDANCE,CORE,MRN,UI |
| `/ci` | PAGE | documented | CLAUDE,CI,CORE,MRN,PICKING,UI |
| `/login` | PAGE | documented | CORE,PICKING,UI |
| `/mrn/[mrnId]/sheet` | PAGE | documented | MRN |
| `/mrn` | PAGE | documented | CLAUDE,CI,CORE,MRN,PICKING,UI |
| `/not-ready` | PAGE | documented | CORE |
| `/orders` | PAGE | documented | CORE,FLOOR,TINT |
| `/` | PAGE | documented | CLAUDE,ATTENDANCE,CORE,FLOOR,IMPORT,MAIL_ORDERS,MRN,NOTIFICATIONS,PICKING,PLACE_ORDER,SAMPLING_LIBRARY,TINT,TRIP_REPORT,UI |
| `/picking` | PAGE | documented | CLAUDE,CI,CORE,FLOOR,IMPORT,MAIL_ORDERS,MRN,NOTIFICATIONS,PICKING,UI |
| `/picking/push-test` | PAGE | documented | NOTIFICATIONS |
| `/po` | PAGE | documented | CLAUDE,CORE,MAIL_ORDERS,PICKING,PLACE_ORDER,UI |
| `/po2/manifest.webmanifest` | API | **UNDOCUMENTED** |  |
| `/po2` | PAGE | documented | UI |
| `/po9/manifest.webmanifest` | API | **UNDOCUMENTED** |  |
| `/po9` | PAGE | **UNDOCUMENTED** |  |
| `/po-v2-8f4kd2` | PAGE | **UNDOCUMENTED** |  |
| `/reports` | PAGE | documented | CLAUDE,CORE,PICKING,TINT,UI |
| `/reports/tint-summary` | PAGE | documented | CORE,TINT,UI |
| `/reports/tint-summary/preview` | PAGE | documented | TINT |
| `/trips/[tripNo]/sheet` | PAGE | documented | CORE,TRIP_REPORT |
| `/trips` | PAGE | documented | CLAUDE,CORE,TRIP_REPORT,UI |
| `/unauthorized` | PAGE | documented | CORE,MAIL_ORDERS,TINT |

</details>

---

## 3. Schema diff since baseline (`prisma/schema.prisma` @ 7d8ceece vs HEAD)

This compares the Prisma file only; **the database was not queried.** Enums: **none added, removed or changed**, because the schema uses String + DB CHECK constraints for status vocabularies. 26 commits touched `prisma/schema.prisma` since baseline.

### Models added (15)

| Model | Fields | Mirror commit | In canon? | Schema version |
|---|---|---|---|---|
| `pick_findings` | 21 | cd27c976 (08-07), mfgMonth/Year 286457e7 | CORE §7.4, PICKING §11 | v27.14 / v27.15 ✔ |
| `mrn`, `mrn_lines`, `mrn_line_batches` | 30 / 23 / 10 | 644dce96 (08-21), 0b996572 | CLAUDE_MRN | v27.16 / v27.17 ✔ |
| `mrn_photos` (+ `mrn.status` 'closed', `closedAt/closedById`) | 13 | b6d84b3d (09-01) | CLAUDE_MRN | v27.19 ✔ |
| `mrn_lines.deliveryNo` + unique `(mrnId, deliveryNo, lineNo)` | — | 0ac5bcaa (09-01) | CLAUDE_MRN | v27.20 ✔ |
| `admin_audit_log` | 10 | f00808c1 (08-30) | CORE §7.13 | v27.18 ✔ |
| `ci_reason_master`, `ci_returns`, `ci_return_lines` | 8 / 39 / 13 | e8695f40 (08-31) | CLAUDE_CI | v27.21 ✔ |
| `user_page_access` | 11 | 6c76c56a (09-04) | CORE §7.14 | v27.22 ✔ |
| `users.isSuperuser` | — | b493f87c (09-04) | CORE §7.15 | v27.23 ✔ |
| `MirrorHeartbeat` (`@@map("mirror_heartbeat")`) + `TripReport.rowHash` | 7 | 88bf9926 (09-08) | TRIP_REPORT, CORE | v27.24 ✔ |
| **`app_settings`** | 6 | 16eff3d5 (09-09) | **none** | **none minted** |
| **`trips`** | 43 | aead3c32 (09-09) | **none** | **none minted** |
| **`trip_drops`** | 14 | aead3c32 (09-09) | **none** | **none minted** |
| **`trip_activity`** | 9 | c84f8faa (09-14) | **none** | **none minted** |

### Columns and relations added or changed on existing models

| Model | Change | In canon? |
|---|---|---|
| `orders` | + `pickVisibleAt`, `pickVisibleById` → users "OrderPickVisibleBy" (16eff3d5): **dead since slice 8 (791a2cd6)**, not read or written | none |
| `orders` | + `tripDropId` → `trip_drops` (onDelete SetNull), `@@index([tripDropId])` (aead3c32) | none |
| `orders` | + `loadedAt`, `loadedById` → users "OrderLoadedBy" (SetNull): **no reader or writer anywhere** | none |
| `orders` | + `@@index([invoiceNo])` (mirrors the v27.21 index) | CORE v27.21 ✔ (but §7.12 "no secondary indexes" line is stale) |
| `orders` | + back-relations `pickFindings`, `ciReturns` | ✔ |
| `users` | + `isSuperuser` ✔ · + **`notesFontSize Int @default(11)`** (6409f07c; DB CHECK 11-20) · + 27 back-relations (MRN ×8, trips ×8, trip_activity, app_settings, audit, CI ×3, pick_findings ×2, pageAccess, orders ×2) | notesFontSize: **none** |
| `app_tag_settings` | `tagKey` **loses `@unique`**; + `scope String @default("everyone")`, `roleSlug String?`, `userId Int?`, `@@index([userId])`, `@@index([roleSlug])` (abd495f4, sql/2026-09-11-hide-tag-scope.sql). Uniqueness is now three partial unique indexes + `chk_app_tag_settings_scope`, per code comments | **stale**: CORE §7.10 says `tagKey TEXT UNIQUE` |
| `mo_orders` | + `updatedAt DateTime @default(now())`, DB-trigger owned (`trg_mo_orders_updated_at`), deliberately not `@updatedAt` (71e7b53a) | none |
| `route_master` | + **`bayNumber Int?`** (f7c8d232, read by picking and floor queries) | none |
| `transporter_master` | + **`isRealTransporter Boolean @default(false)`** (filters `/api/floor/trips/options`) + `trips[]` | none |
| `vehicle_master`, `delivery_type_master`, `dispatch_slot_master` ("TripDispatchWindow") | + `trips[]` back-relations | none |
| `delivery_point_master` | + `ciReturns` ("CiReturnCustomer"), `tripDrops` | CI ✔ / trips none |
| `import_raw_line_items` | + `pickFinding pick_findings?` | ✔ |
| `attendance_ot_grace` | `updatedAt` attribute order only (no semantic change) | n/a |

### Findings

1. **Four tables and eight columns shipped outside the schema version chain.** The four tables are `app_settings`, `trips`, `trip_drops` and `trip_activity`. The eight columns are `orders.tripDropId`, `pickVisibleAt`, `pickVisibleById`, `loadedAt`, `loadedById`, `route_master.bayNumber`, `transporter_master.isRealTransporter` and `users.notesFontSize`, plus `mo_orders.updatedAt` and the `app_tag_settings` rework. CORE's chain stops at v27.24 (09-08). This is the **third** module to ship outside the chain, after MRN (v27.16/17 bridged late) and CI. The CORE pass must mint the missing versions retroactively, in commit order.
2. **Two sets of dead columns are mirrored in Prisma.** `orders.pickVisibleAt/ById` has been dead since slice 8. `orders.loadedAt/ById` was never wired: the `loaded` stage was cancelled per the trip-module draft. Canon should record both as "present, deliberately unused" so nobody reads meaning into them.
3. **Stale schema comments** (claims, not facts): `prisma/schema.prisma:1211` says of `app_settings` "NOTHING CONSUMES THIS YET". In fact `lib/picking/visibility-gate.ts:58` and `app/api/floor/pick-gate/route.ts:108` consume it.
4. Every constraint claim in this section (the `chk_trips_*` constraints, the `trips_date_type_seq_live_key` partial unique index, `chk_trip_drops_key`, `chk_trip_activity_action`, and the `app_tag_settings` partial indexes) comes from **code comments and commit messages**. They need a live `pg_constraint` / `pg_indexes` SELECT (§8).


---

## 4. Per-canonical-file STALE / MISSING / GONE

### Summary

Counts are **per file and not de-duplicated.** Several facts are stale in more than one file: CI "URL only" in CORE, the router, CI and ROADMAP; `app_tag_settings.tagKey UNIQUE` in CORE and MAIL_ORDERS; the "nothing reads the billing keys" line in CORE and in code comments. Each owning file must fix its own copy.

| File | STALE | MISSING | GONE | Worst gap |
|---|---|---|---|---|
| CLAUDE_FLOOR | 18 (9 H) | 15 (7 H) | 12 | describes a screen (rail, slot tabs, By picker, assign bar) that stopped rendering 2026-09-10; nothing on the trip desk |
| CLAUDE_UI | 28 | 7 | 4 | §1–§11 and ~15 later sections still say **teal** is the brand; 0 `teal-<n>` classes remain in code (violet since c96157ea) |
| CLAUDE_CORE | 22 (6 H) | 8 | 3 | trips/app_settings schema absent and unversioned; §5 says 32 keys (39), "nothing reads" billing ticks (read), `ti_report` gates Reports (gates nothing), CI not in nav (it is) |
| CLAUDE_TINT | 21 (8 H) | 10 | 0 | finished tint bills now go straight to `pending_picking` with a slot (b3dfe5b8); "Base — No Tint" bypass has no canon |
| CLAUDE_PICKING | 19 (4 H) | 16 (5 H) | 0 | bills no longer need Floor Release; visibility gate, bundling, cancel, Tinting feed, colourWork, hardener, bay: all undocumented |
| CLAUDE_MAIL_ORDERS | 19 | 11 | 2 | Billing is **not a pilot** (ALL_USERS since 08-06, per recorded evidence); Print tab absent; gates now `billing_*` keys |
| CLAUDE_ATTENDANCE | 16 | 3 | 2 | describes a middleware gate removed 2026-07-04; OT status values are UPPERCASE in code |
| CLAUDE_IMPORT | 14 | 8 | 0 | `applyNoMailOrderFallback` (every non-tint bill auto-released) absent; qty-guard work absent; role list gone |
| CLAUDE_PLACE_ORDER | 12 | 7 | 0 | `/po2` + `/po9` (≈97 commits, 15.7k lines) in no module file; last-order route shape wrong |
| CLAUDE_SAMPLING_LIBRARY | 12 | 4 | 0 | §8 lists 17 files that never existed; Edit/Deactivate buttons only `console.log` |
| CLAUDE_NOTIFICATIONS | 6 | 3 | 0 | a third push trigger (picking cancel) and a fourth `sendToUser` caller; `urgency:"high"` |
| CLAUDE_MRN | 5 | 2 | 1 | Print/XLS "billing's alone" contradicts its own table and seed; badge colours gone |
| CLAUDE_CI | 5 | 0 | 0 | "reachable by URL only" was never true (nav entry since 55c3cdc6) |
| CLAUDE_TRIP_REPORT | 2 | 5 | 0 | accurate; lacks the disambiguation from Orbit's own `trips` |
| CLAUDE.md (router) | 4 | 2 | 0 | `/ci` row and `/floor` row stale; no rows for /po2, trips, Billing Print; floor-rail retirement missing |
| ROADMAP.md | 21 | 11 | 3 | header/footer dates disagree; shipped items still open (CI nav, tint-summary bypass, /po2 favourites); trips absent |
| RETIREMENT-PLAYBOOK + archive/README | 1 | 1 | 0 | 2026-09-13 floor-rail retirement not indexed |
| **Total** | **225** | **113** | **27** | |

### Cross-cutting facts that no canon file holds (highest value)
1. **Orbit's trip module**: `trips`/`trip_drops`/`trip_activity`, `lib/trips/*` (~2,650 lines), 9 `/api/floor/trips/*` routes, the trip desk, slices 1–10, "+ Add bills", trip types. **Zero canon hits.** Its only record is `FLOOR-TO-FLOOR-DISCOVERY.md` at the repo root (1,438 lines, 13 commits, referenced by nothing).
2. **Import auto-release (`applyNoMailOrderFallback`, b3dfe5b8, 2026-09-11).** Every new non-tint bill with no mail order goes straight to `pending_picking` with an engine slot. That rewrites the pipeline story in CORE §1/§7.4, IMPORT, PICKING §1/§2, TINT §2 and FLOOR §2.
3. **The pick visibility gate / desk control**: the `app_settings['picking.visibilityGate']` key, per-trip `trips.shownAt`, the waiting-branch filter, and the marker's `heldBack`/`heldBackTrucks`.
4. **Billing Print tab + Send to billing**: `billing_print`, `/api/billing/print/*`, `trips.sentToBillingAt/billingCopiedAt`.
5. **`/po2` + `/po9`**, both public through the `"/po"` prefix match in `middleware.ts:26/36`.
6. **Tick expansion 09-11 → 09-17** (39 keys) plus per-user access mode: many "role X holds Y" statements across canon are now per-user facts.
7. **Violet rebrand.** UI canon still reads as teal in its foundations.

### Stale code comments flagged across workers (claims, not facts — list for a later code-comment pass, **not** a doc batch)
- `lib/permissions.ts`:
  - `:258-263`, `:284-287`, `:412-431`: "nothing reads it yet" / "checks don't exist yet". All are read now.
  - `:300-303`: CI "not in PAGE_NAV_MAP yet".
  - `:36-40`: "/planning and /warehouse stay live".
  - `:127`: "richer split view".
- `prisma/schema.prisma:1211`: `app_settings` "nothing consumes this".
- `middleware.ts:20`: "line 26" (actually `:36`).
- `lib/floor/queries.ts`:
  - `:151-153`, `:704`, `:844`, `:1172`: rail / `getFloorRail` references.
  - `:622`: "assign-bar dropdown".
- `lib/floor/hold-log.ts:27-28`: "clear-hold" action that doesn't exist.
- `lib/floor/release.ts:5`: "the rail".
- `lib/floor/use-floor-rail-poll.ts:3-5`.
- `components/floor/`:
  - `floor-page.tsx:9-14`, `:884-886`.
  - `floor-table.tsx:3-10`, `:34-35`.
  - `detail-panel.tsx:391/393`: points at the deleted `rail-card.tsx`.
- `app/api/floor/trips/[id]/confirm/route.ts:39`.
- `lib/floor/dispatch.ts:6,17-18` vs `lib/workflow-stages.ts`: the two give conflicting `dispatched` counts (4,137 vs 7,067). Both are claims.
- `lib/billing/flag.ts:19-21`: pilot wording.
- `app/ci/page.tsx:57-62`: "NOT IN THE SIDEBAR YET".
- `app/api/mrn/[mrnId]/export/route.ts:21`.
- `components/picking/picking-mobile-shell.tsx:227-231`: "admin-only", "one-teal rule".
- `public/sw.js:9`: "three picking surfaces".
- `lib/picking/queue.ts ~:456`: cites the retired CLAUDE_SUPPORT.md.
- `components/admin/admin-sidebar.tsx:65`: "switcher not built".
- `tailwind.config.ts`: "NOTHING reads these yet" (146 files use `brand-*`).
- `app/(admin)/admin/roles/page.tsx:14`: "7 system roles".

### Live code defects surfaced in passing (not doc drift — for the owner, not a canon batch)
- `mail-orders-page.tsx:99` `MO_SHORTCUTS` still advertises **"E · Slot email"**, but that shortcut was removed on 2026-08-10.
- `@page mo-landscape` is **nested inside `@media print`** (`globals.css:630`), which breaks router rule §1. Whether it still prints landscape needs a real print test.
- `GET /api/floor/trips` is gated `canEdit` while the board is `canView`, and the client swallows the 403. A view-only floor user would see a desk with no trips.
- `/admin/tint-manager` renders the board without its access provider, so the panel tabs and Reports pill are hidden even for the superuser.
- `getFloorBoard` still computes `waitingSkus`/`oilSkus`, and no Floor component reads them. That is two extra queries per board load.
- **Orphans on disk with zero importers:** `components/floor/{assign-bar,assign-context-banner,trip-selection-bar}.tsx`, `lib/floor/suggest.ts`, `components/mail-orders/{slot-completion-modal,so-email-panel}.tsx`, `lib/mail-orders/{enrich-v2,taxonomy-mapping}.ts`, and `components/tint/{tint-table-view,split-builder-modal}.tsx`. They are kept per the no-delete rule and need an explicit owner instruction.
- Sampling Library: the Edit, Deactivate and Mark-for-review buttons only call `console.log`.

### Per-file detail (worker output, verbatim apart from heading levels)


<!-- source: sweep worker out-floor-trip.md -->

### out-floor-trip.md — canon drift sweep, 2026-09-18 (READ-ONLY)

Worker scope: `docs/CLAUDE_FLOOR.md` + `docs/CLAUDE_TRIP_REPORT.md`. Code wins. HEAD `ec6343ba`.

---

#### DECISION — does the Floor trip desk need its own canonical file?

**YES. Recommend `docs/CLAUDE_FLOOR_TRIPS.md`**, plus a rewrite of CLAUDE_FLOOR.md around the trip desk.
- **Size.** `lib/trips/*` = 9 files, about 2,650 lines (queries 926, activity 687, number 313, show 169, live-trips 152, billing 113, drop-key 103, type-choice, route-label). There are 9 route files under `app/api/floor/trips/*`, 10 trip components under `components/floor/` (trip-desk 943, trip-rail 454, trip-detail-header 428, trip-form 306, trip-vehicle-editor 270, trip-history, trip-bar, trip-add-band, trip-options, trip-selection-bar [orphan]) and 3 new tables (`trips` 43 fields, `trip_drops` 14, `trip_activity` 9). The work spans roughly 60 commits from 2026-09-09 to 09-18. No canon file mentions any of it (grep of `docs/CLAUDE*.md` + ROADMAP for `trip_drops`, `trip_activity`, `tripDropId`, `api/floor/trips`, `TripDesk`, `shownAt`, `sentToBilling`, `pick-gate`, `app_settings`, `pickVisibleAt`, `isRealTransporter`, `loadedAt`: **zero hits**).
- It meets router §6 "module reaches production-live status → own file". It also has its own invariants that need a home: the trip-number allocator with 3 DB guards, the drop-key CHECK, the "NO TRIP ACTION MAY CHANGE A BILL'S STATUS OR ITS HOLD" rule, the carry-forward rule and the dispatch close.
- **Why not `CLAUDE_DISPATCH.md`:** "dispatch" already means three other things: the CORE §7.4 dispatch engine, `orders.dispatchStatus`, and the `dispatcher` role and `(dispatcher)` route group. It would add a fourth collision.
- **Why not fold it into CLAUDE_TRIP_REPORT.md:** that file is the NTS mirror, a different system. The code keeps the two apart on purpose. `app/api/floor/trips/route.ts:6-15` says: *"WHY THIS IS NOT `/api/trips`. That address is TAKEN … the read-only NTS Trip Report mirror … nothing reconciles them."*

##### The naming collision. The new file and TRIP_REPORT must both state it at the top.
| Name | What it is | Owner |
|---|---|---|
| `trips` table (+ `trip_drops`, `trip_activity`) | Orbit's OWN truck plan, built on `/floor` | new CLAUDE_FLOOR_TRIPS |
| `/api/floor/trips/*` | API for the `trips` table (gate `floor`) | new CLAUDE_FLOOR_TRIPS |
| `lib/trips/*` | Orbit trips logic. NOT the mirror | new CLAUDE_FLOOR_TRIPS |
| `TripReport` model / `trip_report` table | NTS mirror, fed by the puller | CLAUDE_TRIP_REPORT |
| `/trips` page + `/trips/[tripNo]/sheet` | NTS mirror UI (PageKey `trip_report`) | CLAUDE_TRIP_REPORT |
| `/api/trips`, `/api/trips/[tripNo]` | NTS mirror API (session-gated only) | CLAUDE_TRIP_REPORT |
| `lib/trip-report/*`, `components/trip-report/*` | NTS mirror | CLAUDE_TRIP_REPORT |
| `trips.transporterTripNo` | free text on an Orbit trip. It is NOT a key into `trip_report.tripNo` | new file |

Traps:
- `tripNumber` (Orbit, `L-260909-01`) and `tripNo` (NTS `tripno1`) are different id spaces.
- `lib/trips/drop-key.ts:4` borrows TRIP_REPORT §4's rule "Drops = unique customers" as the Orbit stop identity.
- `scripts/backfill-nts-trips-2026-09-11.ts` (bf14cb51) READ `trip_report` to create 25 Orbit trips and place 71 bills. That was the only data bridge, and it was one-time.

---

##### docs/CLAUDE_FLOOR.md — header v1.4 / footer v1.4 / last commit e9fcd612 2026-08-26
Header vs footer: they match ("v1.4 · Schema v27.13 · … updated 2026-08-04" at both ends). The content is about 5 weeks and roughly 110 floor commits behind. Its §2, §3, §5, §8 and §11 describe a screen that no longer renders.

###### STALE
- [H] [§2] *"Left rail (344px) — 'Needs your decision'. Cards, one per bill. Holds ONLY bills the dispatch engine could not auto-slot…"* — CODE: `archive/2026-09-floor-rail/README.md` says "It stopped rendering on 2026-09-10, when the trip desk replaced the board (bbb9628c)". `components/floor/trip-rail.tsx:5-8` says "IT REPLACES THE DECISION RAIL ENTIRELY … Those bills are now rows on the board itself, marked with a quiet `no slot` chip, and the rail holds TRIPS instead." The left rail is now the trip list ("To plan" pool plus one card per trip, flat, newest-created first; `trip-rail.tsx:14-19`).
- [H] [§2] *"Right pane — three top tabs: Floor / On hold / Cancelled"* — CODE: `components/floor/floor-page.tsx:114` `type TopTab = "floor" | "tinting" | "hold" | "cancelled";`. There are four tabs: **Tinting** was added in 143706be. The rail renders on all four tabs (`TripDesk` is the shell, and Hold and Cancelled ride in as `sideBody`).
- [H] [§2] *"slot tabs `10:30 · 12:30 · 16:00 · 18:00 · All` · slot bands (All view) or Flat/By-route"* — CODE: `components/floor/trip-desk.tsx:6-12` says "the slot tabs (the slot is a chip on each rail card since slice 6), By picker …, By group, the At-desk pool block, and the decision rail … It does neither now". The three states are pool / trip / add (`trip-desk.tsx:14-20`).
- [H] [§3] Rail feed row *"`getFloorRail(scope)` | `GET /api/floor/board`"* and *"`GET /api/floor/board` returns `{ rail, floor, pickers }`"* — CODE: `app/api/floor/board/route.ts` `return NextResponse.json({ scope, floor, pickers });`. `lib/floor/queries.ts:642` has the comment "── 1. RAIL — REMOVED 2026-09-13 ──". `getFloorRail` does not exist.
- [H] [§3/§5/§10] *"`floorLiveBaseWhere(todayRange)` — the live predicate, SHARED by the board and the marker … Two arms"* — CODE: `lib/floor/queries.ts:475-490` `floorBoardWhere` = `OR: [floorLiveBaseWhere(...), floorUnslottedWhere(), floorCarriedPoolWhere(), floorTripBillsWhere(todayDateOnly)]`, and `:508` marker `return { AND: [floorBoardWhere(getISTDayRange(), getISTTodayDateOnly()), hide] };`. The board and the marker share **floorBoardWhere (4 arms)**. `floorLiveBaseWhere` is now arm 1 only. §10's landmine should name `floorBoardWhere`.
- [H] [§3] History = *"TWO arms under one OR … `PICKING_ACTIVE_STAGES`"* — CODE: `lib/floor/queries.ts:736-804` history `base` = `OR:[ {…workflowStage: { in: FLOOR_HISTORY_STAGES } …}, floorHistoryTripBillsWhere(anchorDate) ]`, and `:101` `const FLOOR_HISTORY_STAGES = [...PICKING_ACTIVE_STAGES, DISPATCHED];`. The checked arm is `{ in: [PICK_CHECKED, DISPATCHED] }` (`:796`). Commits 551069aa (dispatched is visible in history) and 175c83fd (slice 10 by-trip arm).
- [H] [§4.6] Assign bar spec *"Assign bar (`assign-bar.tsx`) — four controls …"* — CODE: `components/floor/floor-page.tsx:17` has the comment "assign-bar.tsx replaced by floor-bottom-bar.tsx — Add to trip / Remove from trip. Assigning a picker is /picking's job." A Grep for `AssignBar` in components/app/lib finds no importer. The live bar is `components/floor/floor-bottom-bar.tsx`. Detail-panel Assign/Reassign still calls `/api/picking/assign` (`floor-page.tsx:1248-1250`), so §4.3 survives for the panel only.
- [H] [§8, §10 first bullet] *"Rail slot suggestion [LIVE] … `RAIL_SUGGESTIONS_ENABLED = true` (`lib/floor/queries.ts:70`)"* — CODE: `lib/floor/queries.ts:326-332` says "RAIL_SUGGESTIONS_ENABLED WAS HERE AND WENT WITH THE RAIL (2026-09-13) … `lib/floor/suggest.ts` is left in place, unimported … CLAUDE_FLOOR §8 documents the layer as LIVE and is now out of date". A Grep for importers of `floor/suggest` finds none. The whole section is now dormant code.
- [H] [§1 Access] *"v1 grant = admin + operations only … present in BOTH prisma/seed.ts and live role_permissions"* — CODE: `app/api/floor/trips/[id]/dispatch/route.ts:59-60` says "held live by admin, operations and floor_access". `lib/permissions.ts:801-807` `checkAnyPermission` now has a superuser-flag arm and a **user mode** (`userPagePerms(userId, pageKey)`). Seed (`prisma/seed.ts:117-118`) still says admin and operations only. The drafts (`code-discovery-2026-08-31-role-census.md:577-582`) record 4 users on the `floor_access` role. So "only these two roles" no longer describes how access is decided. This is "drafts say, seed says". Live is unverified.
- [M] [§5] *"Rail → Mail Orders pattern: a 30s full refetch (`lib/floor/use-floor-rail-poll.ts`). A new import appears on its own."* — CODE: `components/floor/floor-page.tsx:1388-1391` `useFloorRailPoll({ paused: !isLive || detailOpen || selection.size > 0, onTick: () => void load() })`. There is no rail. The hook now refetches the whole desk (board, hold, cancelled and trips; `floor-page.tsx:348-351`). The hook name and its header comment are vestigial.
- [M] [§4.1] Cancel is described only as *"`workflowStage="cancelled"`, `dispatchStatus=null`"* and *"exactly ONE orders.update"* — CODE: `app/api/floor/actions/route.ts:130-153` `clearAssignment = true` has an ORPHAN FIX (2026-08-20, 00d7da22). Cancel now also deletes the `pick_assignments` row after the stage write. That is a second write to a second table. It is not a second `orders.update`, but canon never mentions it.
- [M] [§4.1] Restore *"→ back onto the left rail"* — CODE: `actions/route.ts` restore writes `pending_support`/`dispatchStatus:null`. That bill now shows as a `no slot` ROW on the Floor board through `floorUnslottedWhere` (arm 2). There is no rail.
- [M] [§10] *"The floor row displays `orderDateTime` while the slot was decided by `obdEmailDate`"* — CODE: `lib/floor/queries.ts:929` `const displayDate = resolveFloorDisplayDate(order.orderDateTime, order.obdEmailDate);` (`lib/floor/format.ts:162-176`, 8a4c1973 2026-08-06). The row shows `obdEmailDate`, or the email time flagged with a glyph on a same-day match. Hold and Cancelled use `obdEmailDate ?? orderDateTime` (`:1247`, `:1336`). The discovery draft (G1) reached the same finding. A narrower residual gap may remain.
- [M] [§10] *"Slot tabs group by `windowTime` ALONE … (the `tabRows` filter in `floor-board.tsx`)"* — GONE. `floor-board.tsx` was deleted in cdbf95b1. There are no slot tabs. The landmine is moot.
- [M] [§3 / §8b] *"FLOOR_SPINE applied in the TWO places … the client re-sort helper (`components/floor/floor-board.tsx`)"* and *"the `#` column now numbers every row"* — CODE: `components/floor/trip-desk.tsx:33-34` imports `sortPickingQueue` + `FLOOR_SPINE`, so the client sort now lives in trip-desk. `components/floor/floor-table.tsx:14-15` says "The # and Picker columns were REMOVED 2026-09-10 with the trip desk." Columns are ☐ · OBD · Invoice|Operator · Ship to · Route · Due · Vol/KG · Article · Status (`floor-table.tsx:555-562`).
- [M] [§11] picker-card row says *"By picker … the view `/floor` LANDS on (`mode` defaults to `"picker"`)"* — CODE: `picker-card.tsx` was deleted in f41b52c9. The default had already become By route on 2026-08-27 (8468297a). By route itself went with the trip desk (TripDesk has Flat | By route in pool state only).
- [M] [§6c] *"done = check date convention now has three implementations: Floor …"* — still true for arm 1. But canon does not say that arm 3 (`floorCarriedPoolWhere`, `queries.ts:198`) now keeps a checked bill with no trip on the board **whatever day it was checked** (36a39ba7). That reverses "finished work is filed by day" for bills with no trip.
- [L] [§3] *"Four SELECT-only feeds"* — the client now loads five in parallel. `floor-page.tsx:348-351` fetches board, hold, cancelled and `/api/floor/trips?date=`. There are also on-demand `/api/floor/pick-gate`, `/api/floor/trips/options` and `/api/floor/tint-operators` (`:430`, `:470`, `:1740`).
- [L] [§4.7] `FloorDetailSource` list *"`rail` · `floor` · `hold` · `cancelled` · `history`"* — CODE: `lib/floor/types.ts:422` still has `"rail"`, but there is no rail source. It is a vestigial union member (the README says the `case "rail"` pager branch was removed).
- [L] [§10] *"`dispatched`-stage rows … 1,051 … `dispatched` stops 21 Jul"* — dated counts. The draft `code-discovery-2026-09-09-floor-trips.md` G6 measured 4,137 `dispatched` on 2026-09-09. Commit 3945e6d5 says that many came from hand-run SQL UPDATEs. The claim "no automatic drain" still holds in code: `/api/floor/trips/[id]/dispatch` exists but has NO caller (`floor-page.tsx:808-813`).

###### MISSING (no canon anywhere; I grepped all `docs/CLAUDE*.md`)
- [H] **The trip desk / Orbit trips module as a whole**: bbb9628c, 04f4c97b, cd6be71a, slices 1-10 (c539aae4 … 175c83fd), the redesign (a8a8573e, 0a89e317, 30b393e3), "+ Add bills" (7966d24d…dab9e8e7), and trip types (b95b6eeb, 41c5dab8, 1b1005c6, ec6343ba). Code: `components/floor/trip-*.tsx`, `lib/trips/*`, `app/api/floor/trips/**`. Goes to the new file.
- [H] **Schema, entirely undocumented** (CORE stays at v27.24, and the trip DDL carries no version stamp): `trips` (43 fields; statuses via `chk_trips_status` draft|released|loading|dispatched|cancelled per bf14cb51; `chk_trips_dispatched_complete`; `chk_trips_number_shape`; partial unique `trips_date_type_seq_live_key WHERE status<>'cancelled'`; 7 named FKs to users), `trip_drops` (14; `chk_trip_drops_key` 'c:'/'s:' prefixes, `lib/trips/drop-key.ts:11-24`), `trip_activity` (9; `chk_trip_activity_action`; 14 `TRIP_ACTIONS` in `lib/trips/activity.ts:112-127`), `orders.tripDropId` (the ONE trip pointer, FK SET NULL), `orders.loadedAt/loadedById` (**no reader or writer in app/lib/components**, reserved for a future loading screen), `orders.pickVisibleAt/ById` (**dead since slice 8**, `lib/picking/visibility-gate.ts:22-24`), `transporter_master.isRealTransporter` (filters `/api/floor/trips/options`, `route.ts:77`), and `app_settings` (key `picking.visibilityGate`, `visibility-gate.ts:40`). Owner: CORE §7 plus the new file.
- [H] **Desk control / pick visibility gate** (7e89e8fb, fdc03beb, 9a3671ec, 963665af, 791a2cd6): `app_settings` switch, `components/floor/pick-gate-toggle.tsx`, `GET/POST /api/floor/pick-gate` (canEdit). With the switch ON, a waiting bill on an unshown trip is hidden from the supervisor's Assign tab. Turning it ON auto-shows trips holding waiting bills (`showTripsHoldingWaitingBills`, the no-cliff rule). Show per trip is `POST /api/floor/trips/[id]/show` → `trips.shownAt`. It also touches CLAUDE_PICKING, which has no mention of it either.
- [H] **Send to billing → Billing Print tab** (22ced2d8, 6d008f8e): `POST /api/floor/trips/[id]/billing`, `lib/trips/billing.ts`, `trips.sentToBillingAt` / `billingCopiedAt`, `lib/billing/print.ts`, PageKey `billing_print`. Take-back is refused once billing has copied. No canon file mentions it (MAIL_ORDERS §23 owner should confirm).
- [H] **The "no trip action changes a bill's status or hold" rule** (8eaa4663): `app/api/floor/trips/[id]/confirm/route.ts:13-25`. Also: trip attach/detach writes one `orders.update` and **no `order_status_logs` row** (`[id]/bills/route.ts` header). Trip membership is not gated by stage.
- [H] **Two orphan-but-kept API routes** that must not be removed as dead code: `POST /api/floor/trips/[id]/confirm` (no caller since slice 6, `floor-page.tsx:803-807`) and `POST /api/floor/trips/[id]/dispatch` (no caller since slice 7, kept for the future loading screen, `dispatch/route.ts:14-23`). Consequence: **nothing in the UI writes `workflowStage='dispatched'` and no trip closes.**
- [H] **Import no-mail-order fallback: every bill reaches the floor without a release step** (b3dfe5b8, 2026-09-11, `applyNoMailOrderFallback`). This changes what the `no slot` arm holds and why. Primary owner is IMPORT. FLOOR §2/§4.2 should cross-reference it.
- [M] Board predicate arms 3 and 4 and their load-bearing redundant term: `floorCarriedPoolWhere` (`queries.ts:198`) and `floorTripBillsWhere` with `tripDropId: { not: null }` ("worth 21 ms", `:226-240`). `liveTripsOnDeskWhere` / `tripsOnDeskWhere` (`lib/trips/live-trips.ts`) is the one owner of "which trips a desk is about", and the board, rail and marker all derive from it (10ae7c29, 175c83fd).
- [M] Trip numbering: `{T}-{YYMMDD}-{NN}`, lowest free seq, and a cancelled trip renamed `<n>-C` that gives its number back (62ea5f1b, `lib/trips/number.ts:1-45`). Type choice for a mixed selection is the majority, with tie-breaks (`lib/trips/type-choice.ts`). The rail lists a trip by its stored type, and the chip shows the mix (`trip-rail.tsx:21-33`, ec6343ba).
- [M] Tint on the floor: four tint pills (79bcc412, 6b315729), the Tinting tab, `GET /api/floor/tint-operators` (Operator column takes the Invoice slot on the Tinting tab, 143706be), and the tint lock (56db79b8, 4af18cc8: a bill with unfinished tinting cannot be held or cancelled from the panel). The detail panel shows tint-room facts.
- [M] Floor table Invoice column (697b193b), duplicate-SO soft treatment (4f21b7da, 57cd274d, bc232f72; `DuplicateSoTag` soft), TINT/BASE word (0841b5c9, `ColourWorkBadge`), and the Due column (e656ad80).
- [M] **Dead payload**: `getFloorBoard` still computes `waitingSkus` and `oilSkus`, with an extra `import_raw_line_items` query and an extra `sku_master_v2` query while `RULE2_ENABLED = true` (`lib/floor/queries.ts:1146-1165`). **No floor component reads them** (grep `components/floor` finds none). Only the By-group view read them, and it is gone. This is the same class as the rail feed that cost 28%. Owner decision: keep, cut, or document.
- [M] View-only access mismatch: the board is gated `floor canView`, but `GET /api/floor/trips` is gated `canEdit` (`app/api/floor/trips/route.ts:68`). The client swallows the failure (`floor-page.tsx:351` `.catch(() => null)`). A view-only floor user would see a desk with no trips. Whether any such user exists is unverified.
- [L] Board fetched once unscoped, with scope chips filtered client-side (9c3b3cf5, `lib/floor/scope.ts`). `tripInScope` / `tripMixLabel` scope trips by their own type.
- [L] `archive/2026-09-floor-rail/` retirement (79bcc412). The router §3 retired table has no row for it, and FLOOR §9 should gain a §9c.
- [L] Hold-clear groundwork: `FLOOR_CLEAR_HOLD_NOTE`, `FLOOR_CLEAR_HOLD_STAGES` (82b25ce0), constants only and not wired (see stale comments below).

###### GONE (absence proven by `ls components/floor lib/floor` + `git log --diff-filter=D` + Grep)
- `components/floor/floor-rail.tsx`, `rail-card.tsx`, `rail-empty.tsx`, `tint-strip.tsx` moved to `archive/2026-09-floor-rail/` (79bcc412). They are named in §2, §8 and §11.
- `components/floor/floor-board.tsx`, `trip-band.tsx`, `build-trip-drawer.tsx`, `desk-pool.tsx` were deleted in cdbf95b1. `carryover-banner.tsx`, `floor-tabs.tsx`, `group-row.tsx`, `picker-card.tsx`, `slot-band.tsx`, `upcoming-strip.tsx` and `lib/floor/trip-wording.ts` were deleted in f41b52c9. §11 names floor-board, floor-tabs, slot-band, carryover-banner, upcoming-strip and picker-card.
- `components/floor/show-strip.tsx` and `app/api/floor/pick-visible/route.ts` were deleted in 791a2cd6.
- `app/api/floor/trips/[id]/release/route.ts` was deleted in 8eaa4663.
- `lib/floor/grouping.ts` was deleted in 3fdd0e13 (moved to `lib/picking/grouping.ts`).
- `getFloorRail`, `buildTintState`, `RAIL_SUGGESTIONS_ENABLED`, `railInScope` and the `rail`/`railCount` board keys are gone (`queries.ts:642-667`, the README).
- **On disk but UNREACHABLE** (zero importers by Grep): `components/floor/assign-bar.tsx`, `assign-context-banner.tsx`, `trip-selection-bar.tsx`, and `lib/floor/suggest.ts`. §4.6 and §11 describe the first two as live.

###### Stale code comments spotted (claims about data or code)
- `lib/floor/queries.ts:151-153` says "used in THREE places … the rail feed (which still exists)". The rail feed was removed 2026-09-13.
- `lib/floor/queries.ts:704`, `:844` and `:1172` say "See getFloorRail above". That function no longer exists.
- `app/api/floor/actions/route.ts` restore branch says "back onto the left rail … satisfies the rail predicate (getFloorRail …)". There is no rail or getFloorRail.
- `lib/floor/release.ts:5` says "ONE CALLER: POST /api/floor/release (the rail, the Hold tab and the detail panel's Release)". The rail is gone.
- `lib/floor/hold-log.ts:27-28` says `FLOOR_CLEAR_HOLD_NOTE` is "Written by `app/api/floor/actions/route.ts` (action "clear-hold")". FALSE: `ACTIONS` (`actions/route.ts:22`) = mark-urgent, change-slot, hold, cancel, restore, and a Grep for `clear-hold` finds only this comment.
- `lib/floor/hold-log.ts:6-8` says Support "anchors its amber hold footprint … a module Floor Control must not touch". Support was retired 2026-07-27.
- `components/floor/floor-page.tsx:9-14` says "Putting a bill on a trip is what gives it a slot". Since slice 3, no trip action writes a bill. `:24-27` says the other components are "still on disk"; floor-rail was since archived.
- `components/floor/floor-table.tsx:3-10` says it is rendered by "the flat slot-tab view, inside each slot band (All) … and by the Upcoming strip", and "The ⋯ (details) button stays INERT". All three render sites are gone, and ⋯ is live. `:34-35` talks about the "# column", which was removed.
- `lib/floor/use-floor-rail-poll.ts:3-5` says "The RAIL's live-sync". It now drives the whole desk.
- `lib/floor/queries.ts:622` says "drives the assign-bar dropdown". assign-bar is unreachable. The pickers are still returned by `/api/floor/board`, and the only reader may be the detail panel (not verified).
- `app/api/floor/trips/[id]/confirm/route.ts:39` says "Mark dispatched renders on every open trip". Contradicted by `floor-page.tsx:808` ("THE MARK DISPATCHED HANDLER WENT IN SLICE 7").
- Per the discovery draft G9: `prisma/schema.prisma` has comments "NOTHING CONSUMES THESE YET" on `pickVisibleAt` / `app_settings`. Not re-checked line by line. Today `pickVisibleAt` really has no consumer again, and `app_settings` does have one.

###### Confidence notes
- The live `role_permissions` / user-mode ticks for `floor` were not verified (no DB). The `floor_access` count comes from 2026-08-31 drafts.
- The trips CHECK constraints and the partial index are taken from code comments and commit messages, not from the DB.
- Whether any user has floor canView without canEdit (the trips 403 gap) is unverified.
- The counts (44 rows, 2,604, 142, 772 ms) are dated measurements quoted from comments. They are not re-measured.
- I did not audit `lib/trips/queries.ts` (926 lines) or `activity.ts` line by line. The MISSING items above rest on headers and call sites.

---

##### docs/CLAUDE_TRIP_REPORT.md — header v1.2 / footer v1.2 / last commit aa525bd4 2026-09-08
Header vs footer: they match ("v1.2 · Schema v27.24 … updated 2026-09-08" at both ends). **Overall ACCURATE.** Mirror code has not changed since, apart from rebrand styling.

Verified correct:
- `TripReport` has 39 fields including `rowHash String?` (`prisma/schema.prisma`, model TripReport).
- `MirrorHeartbeat` has 7 fields with `@@map("mirror_heartbeat")` and zero relations.
- Both `@@index` lines still lack `map:`, consistent with [NEXT].
- `/trips` gates on `checkAnyPermission(roles, "trip_report", "canView")` (`app/trips/page.tsx:50`).
- `/api/trips` and `/api/trips/[tripNo]` are session-only (`route.ts:40-42`), with no permission check.
- `ROLE_REDIRECTS.logistics = "/trips"` (`lib/rbac.ts:44`).
- PageKey `trip_report` → `/trips` (`lib/permissions.ts:63`), with the Route icon (`role-sidebar.tsx:59`).
- `@page trip-sheet` is top-level (`globals.css:24`). `pixelRatio: 2` and `cacheBust: false` (`share-sheet-image.ts:70,75`). UPC mapping (`display.ts:100`). `MIN_ROWS = 20`.
- No app code reads `mirror_heartbeat`, consistent with "nothing yet asks".

###### STALE
- [L] [§6] The logo-capture fix says data URI "failed identically" and implies a URL `src`. CODE: `components/trip-report/trip-sheet-document.tsx:3,216` `src={JSW_DULUX_LOGO_DATA_URI}` (`lib/trip-report/logo-data-uri.ts`, 4a0001c4, 2026-07-06). The live logo IS a data URI plus explicit width. This predates baseline, so it is only a wording clarity issue.
- [L] [§3] *"`fetchedAt` TIMESTAMPTZ DEFAULT now()"* — Prisma declares `fetchedAt DateTime @default(now())` with **no `@db.Timestamptz`**, which is Prisma's timestamp(3) default. Either the Prisma mirror is imprecise or the canon is. Live is unverified. It is the same class as the missing index `map:`.

###### MISSING
- [M] **The disambiguation from Orbit's own `trips`.** No word in the file says that the `trips` table, `/api/floor/trips` and `lib/trips/*` are a different system. They are not the mirror, never write to `trip_report`, and live alongside `/trips` for a "parallel run". The file also lacks the retirement path: "when NTS stops → puller off → `/trips` retired via playbook". Evidence: `app/api/floor/trips/route.ts:6-15`. The draft `web-update-2026-09-09-floor-trip-module.md:160-166, :249` explicitly routed this note to CLAUDE_TRIP_REPORT, and it never landed.
- [M] **The mirror now has downstream readers and borrowers.** `scripts/backfill-nts-trips-2026-09-11.ts` (bf14cb51) read `trip_report` once to create 25 Orbit trips and 71 placements. `lib/trips/drop-key.ts:3-5` cites TRIP_REPORT §4 "Drops = unique customers" as the Orbit stop identity, so a change to §4 now affects Orbit trips. `app/api/floor/trips/[id]/dispatch/route.ts:21-23` names "the NTS trip_report mirror" as "the record of the truck leaving" until the loading screen exists. §1's "Standalone" is still true for code writes but no longer for meaning.
- [L] [§8] The key files index omits `components/trip-report/trip-sheet-print-button.tsx` and `lib/trip-report/logo-data-uri.ts`.
- [L] [§1 visual-spec ownership] The 2026-09-09 mobile/rebrand changes are not recorded. `/trips` now has a pale masthead with `themeColor #F5F3FF` and `statusBarStyle: "default"` (`app/trips/page.tsx:12-37`, b51e6a15), teal → violet (c96157ea), and the footer says "Generated by Orbit" (8fac2a67). This file claims the `/trips` visual spec by delegation.
- [L] Vehicle master vs mirror fleet gap (draft discovery G10: 34 vehicle numbers in the mirror against 6 `vehicle_master` rows). The trip-schema draft D8 proposed seeding vehicles from `trip_report`. Whether that ran is unverified.

###### GONE
- None.

###### Stale code comments spotted
- Draft `web-update-2026-09-09-floor-trip-module.md:162` still says the mirror "deletes today's rows and reinserts them". That is the pre-v27.24 design. It is only a draft, so not canon, but a reader following it would be wrong.

###### Confidence notes
- §2.2 function internals, the heartbeat behaviour, the puller host, the cadence and the §1 named-user grants cannot be verified without DB or machine access. They were not re-checked.
- Under the new user-mode permission model (`lib/permissions.ts:801-807`), the §1 "logistics role plus 4 users as secondary role" framing may not be how access is decided any more. CORE §5 owns this.


<!-- source: sweep worker out-ui.md -->

##### docs/CLAUDE_UI.md — header v5.30 / footer v5.30 / last commit 0db792a1 2026-09-17
Header-vs-footer match: yes (both "v5.30 · updated 2026-09-17").

Headline: the file is two documents stitched together. §10.1, §12, §59.3, §59.8, §59.9 and §62 are post-rebrand (violet `brand-*` / `ink-*`). **§1–§11, §14, §17, §22, §23, §28, §31, §34, §40, §45, §48, §50, §53–§56, §59.1–§59.2 and §63 still describe TEAL as the brand.** The code has **zero** `teal-<n>` classes left: `grep -rE "\bteal-[0-9]"` over components/ app/ lib/ gives 0 files, and the Grep tool gives 0 matches (checked both ways). `brand-<n>` appears in 146 .tsx files. Rebrand commits: 5daa58fc + c96157ea (2026-09-09, "Rebrand step 2b: teal brand colour becomes Orbit violet"), then the step 3/4/5 commits.

###### STALE
- [H] [§1/§2] "**Teal is the brand.** `teal-600` (#0d9488) is the single brand accent." / §2 table "Brand | `teal-600` | #0d9488 | CTAs, focus borders, active nav…" — CODE: `tailwind.config.ts` `brand: { … 600: "#7C3AED", 700: "#6D28D9" … }` plus the comment "`data.teal` #0D9488 is the IGT delivery type" (teal is now only a data identity). No `teal-*` class is left in the code. **The whole §2 "Teal brand system" table, the Brand rules and the §6 "Colour rule — ONE teal element" need rewriting as brand-600.** No canon file documents the new token families at all (see MISSING).
- [H] [§2 Logo mark] "White (on teal bg): circle r=7 stroke, circle r=2.2 fill centre, circle r=2 fill at cx=18" — CODE: `components/shared/orbit-wordmark.tsx:9-11` "There is no symbol and no tile baked in here — callers own both". A grep for `cx="18"`/`r="2.2"` finds nothing. The orbit symbol is GONE. It was replaced by the outlined-path `OrbitWordmark`.
- [H] [§2 Brand rules / §7] "Sidebar logo: `bg-teal-600 hover:bg-teal-700` with orbit SVG" / "Sidebar accent: `borderLeft: "3px solid #0d9488"`" / §7 "Active nav: `bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600`" — CODE: `components/shared/role-sidebar.tsx:196` `borderLeft:  "3px solid #7C3AED",`; `:213-215` `<OrbitWordmark height={isExpanded ? 19 : 14} className="text-brand-800 …"/>` (comment :209: "no tile either"); `:143` `"bg-brand-50 text-brand-700 font-semibold pl-[10px] border-l-2 border-brand-600"`. §5's "Sidebar" row repeats the same stale #0d9488.
- [H] [§6 Segmented control] "Active: `bg-teal-600 text-white font-medium`" — CODE: `components/universal-header.tsx:609` `? "bg-brand-600 text-white font-medium"`.
- [M] [§6] "`importVariant?: "default" | "primary"` (primary = teal Import)" — CODE: `components/universal-header.tsx:433` `? "flex items-center gap-1.5 h-[36px] … bg-ink-900 hover:bg-ink-700 text-white …"`. The primary Import is ink-900, not violet or teal. (The prop's own JSDoc at :158 "brand-600, 36px tall" is also stale; see the comments section.)
- [M] [§6 roster] "Live consumers (import sweep 2026-08-04) — 8 boards: Mail Orders (`mail-orders-page.tsx` + `review-view.tsx`, one board) …" — CODE: an import sweep of `universal-header` gives 10 files. It now includes **`components/ci/billing-board.tsx`** and **`components/mrn/billing-board.tsx`** (the CI and MRN desk faces). `review-view.tsx` no longer contains the string `UniversalHeader`. The roster and the wiring table have no CI-desk or MRN-desk rows.
- [M] [§6 table / §34] "Tint Operator | Job pill (teal, dropdown)" and "Row 2: Job filter as **teal-600 segment pill**" — CODE: `components/tint/tint-operator-content.tsx:1597-1601` passes `title={… <HeaderViewToggle …>}` (a Jobs/History view toggle, new shared component). Any "pill" colour would now be brand. (The Tint worker owns the depth; UI canon's claim is wrong on colour and misses the toggle.)
- [H] [§9/§10/§11/§14] "Focus: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`", "Primary CTA: `bg-teal-600 hover:bg-teal-700`", "IosToggle ON: `bg-teal-600`", "§14 Presets … `bg-teal-600` active" — CODE: 50× `focus:border-brand-500` + 41× `focus:ring-brand-500/10` across components/app. `components/reports/customise-drawer.tsx` IosToggle uses `bg-brand-600`. `components/ui/date-picker-popover.tsx:183` `"bg-brand-600 text-white font-medium"`.
- [H] [§59.1] "Menu sheet … Active row `bg-teal-50 text-teal-700 border-l-teal-600`" and "You sheet — teal avatar (initials) + userName + role label + red Sign out row" — CODE: `components/shared/mobile-shell-context.tsx:157` `? "bg-ink-25 text-ink-900 font-semibold border-l-brand-600"`; `:185` avatar `border-ink-100 bg-ink-50 … text-ink-600`; `:196` `<PushToggle />` (a Notifications row above Sign out, not listed); `:200` Sign out `text-ink-500 hover:text-ink-700`, so it is **not red**. This also contradicts UI's own §10.1/§59.9.
- [M] [§59.2] "**Home** → … (active-teal when `pathname === that href`)" — CODE: `components/shared/mobile-shell.tsx:88` `isHomeActive ? "text-ink-900" : "text-gray-400"` + `:99` `bg-brand-600` underline.
- [M] [§59.3] "Icon-on-top layout, count badge top-right of the icon, teal underline pill on the active tab." — CODE: `components/shared/workflow-tab-bar.tsx:77` `"… h-[3px] w-8 rounded-full bg-brand-600"`. The file's own next bullet (§59.9 note) is correct, so the section contradicts itself.
- [M] [§62] "**One-teal on the card:** the only teal is the selected tint/check" — this contradicts the bullet directly above it ("`ink-25` tint + `data.slate` border + a small `data.slate` check badge"). Selection is slate now, and there is no teal and no brand on the card.
- [M] [§55 / §59.6 viewport block] `themeColor: "#0d9488"` — CODE: `app/layout.tsx:54` `themeColor: "#7C3AED",`; `public/manifest.json` `"theme_color": "#7C3AED"`. §55's floating CTA "shadow `0 8px 22px rgba(13,148,136,.42)`" — CODE: `app/po/po-page.tsx:2102` `"0 8px 22px rgba(124,58,237,0.42)"`. The "teal pill" wording in the same §55 bullets is also stale.
- [M] [§48] "Icons: orbit logo on teal-600 bg, 192/512px PNG" — CODE: `public/icon-source.svg` colours are `#8460EF/#7F55EB/#7C3AED/#6428C4/#4C1D95` (the violet ramp §12.1.1 itself cites). Icons were regenerated in 67d734e2 (2026-09-09).
- [M] [§59.6 DEFERRED] "PWA install … **no service worker exists** (never built)" — CODE: `public/sw.js:2` "OrbitOMS — Web Push PROOF service worker." It is registered at `components/push/push-toggle.tsx:67` `await navigator.serviceWorker.register("/sw.js");` (live since 7f041c95, 2026-07-22; documented in CLAUDE_NOTIFICATIONS.md).
- [M] [§59.4] "**Picking is the first consumer**" of `workflowTabs` (read as "only") / §59.6 "live on `/trips`, `/place-order`, `/picking`" — CODE: `workflowTabs=` is also passed by `components/ci/ci-shell.tsx` and `components/mrn/mrn-shell.tsx`. `RoleLayoutClient` is mounted by 12 app layouts/pages (floor, import, mail-orders, operations, (ops), place-order, tint manager/operator/sampling-library, ci, mrn, trips). The consumer list is badly undercounted.
- [L] [§59.7 prop table] The table lists title/avatarInitials/onAvatarClick/onMenuClick/showSearch/searchActive/onSearchToggle only — CODE: `components/shared/module-mobile-header.tsx:53` `subtitle?:      string;` (added 1ad903ef, 2026-08-07, for the picker's Combined tab, and rendered at :101-106). The consumer count "SEVEN" is still correct: 7 files, verified.
- [M] [§28 InstructionsStrip] "**`tone?: "default" | "violet"` prop** … `violet` = the Billing v2 notes band (Floor's tint-strip palette `#f5f3ff`/`#5b21b6`/`#7c3aed` …)" — CODE: `components/mail-orders/instructions-strip.tsx:19` `tone?: "default" | "notes";` with `bg-brand-50 … border-l-brand-600` at :35(+66). The new props `fontSize` (driven by `users.notesFontSize`, 11-15) and `controlsSlot` are undocumented. The "Floor's tint-strip" it borrows from is archived (`archive/2026-09-floor-rail/tint-strip.tsx`).
- [H] [§57 Tags tab] "**Tags** — grouped on/off switches for Mail Order badges (app-wide); important tags (Hold / OD / CI) open a confirm before turning off." — CODE: `components/admin/hide-settings-content.tsx:113` `type TagMode = "everyone" | "nobody" | "except" | "only";`. It is a per-tag "Who sees it" dropdown with role/person exception chips. It reads `/api/admin/tag-audience` (:216), and rows carry `scope` / `roleSlug` / `userId` (:127-133). Commit abd495f4 (2026-09-11), "scoped tag switches + 6 billing tags". It is not app-wide on/off any more. No canon file mentions `tag-audience` or the four modes (grep across docs/CLAUDE_*.md: 0 hits).
- [M] [§57 Manual hide] "admin-only "Hide OBD…" action on Tint Manager rows (card + table) via `HideObdModal.tsx`" — CODE: `components/tint/tint-manager-content.tsx:1025-1043` has the comment "Hide OBD (admin) and Revert-from-tint … live on the rail's context strip below the list rather than in a row menu" and renders `<option value="">Hide an OBD…</option>` in a "Pending bill actions" select. There are no card or row menus: the Kanban is gone and `tint-table-view.tsx` has no importer (see GONE). "Backend/schema: later batch" is also stale, because the API exists (`app/api/admin/hide/{rules,rules/[id],hidden-orders,orders/[id]/hide,orders/[id]/unhide}`).
- [H] [§63 table] "rows: all 27 ALL_PAGE_KEYS, in five sections" — CODE: `lib/permissions.ts:553` "The 39 keys grouped for display" (`ACCESS_SECTIONS`, :561-582, adds billing_print/hold/slot/urgent/ship_to, place_order_ship_to, tint_panel_*, reports_*, …). The five section names still match.
- [M] [§63 dash rule] "Export and Delete are asked on MRN and nowhere else; … Edit on eleven pages" — CODE: `lib/permissions.ts` `ACTION_PAGES.canExport: ["mrn", "reports_ti_report"]`, and canEdit now lists 18 keys (11 original + billing_picking, billing_print, 4 billing action ticks, place_order_ship_to).
- [M] [§63 colours] "Selected row: `bg-teal-50`, `border-l-2 border-teal-600`, teal avatar, teal name"; "banner, teal when the person matches"; "Live (`ACCESS_SOURCE = user`): teal"; "teal **Save changes**"; "checkbox … teal filled" — CODE: `components/admin/access-manager.tsx:292` `"border-brand-600 bg-brand-50"`, `:300` `bg-brand-600 text-white` (avatar), `:393` matches-banner `border-brand-100 bg-brand-50 … text-brand-700`, **`:210` live banner `"border-ok/30 bg-ok-bg text-ok-text"` (green `ok`, not brand)**, `:485` Save `bg-brand-600`, `:611` checkbox `border-brand-600 bg-brand-600`.
- [M] [§10.1] The live state-encoding avatar example "`OperatorTd` — `components/tint/tint-table-view.tsx`, its `avatarColor` prop" — CODE: `components/tint/tint-manager-content.tsx:24-25` "RETIRED, NOT DELETED … components/tint/tint-table-view.tsx — the old Kanban table". Nothing imports `TintTableView`, so this example is dead code, not live. `OperatorAvatar` (board-bits.tsx:141) is live.
- [M] [§33 TM table / §37 / §8] §33 "Column header pills (all 4 kanban columns)", widths 4/13/10/18/7/9/6/15/10/8%; §37 "Modal trigger from 5 entry points: Kanban PAUSED pill, … Table kebab item"; §8 "Age badge … on tint manager card + table" — these all describe the retired Kanban/`tint-table-view.tsx`. Pause history now opens from `components/tint/manager/board-detail-panel.tsx:430` (`onOpenPauseHistory`). (The Tint worker owns the screen; UI canon still asserts the old surfaces.)
- [M] [§53 ContactCard] "Avatar (40×40 circular…)", "Auto-managed … Avatar background: teal-50, ring `teal-200`", "Badge: `bg-teal-50 text-teal-700 border-teal-200`" — CODE: `components/admin/contact-card.tsx:90` `w-8 h-8 rounded-full ${avatarClass}` (32px, role-tinted via `SO_ROLE_AVATAR_CLASSES`: `customer-sheet.tsx:71-73` brand-100/blue-50/amber-50); `:175` badge `text-brand-700 bg-brand-50 border border-brand-200`. §54 "Avatar: teal-50, ring teal-200" / role chip teal → `sales-officers-list.tsx:36` `PRIMARY: "border-brand-300 bg-brand-50 text-brand-700"`.
- [L] [§3 Delivery dots] "IGT | `bg-teal-600`" — CODE: `components/mail-orders/bill-to-card.tsx:26` `case "IGT": return "bg-data-teal";` (same hex, new token; 6 sites).
- [L] [§22] The Sampling Library teal exemption lists "segment pill, variant tabs, PRIMARY pill, pack pill, Export links, recipe-history active row" — CODE: only two brand uses remain in components/sampling-library (`detail-pane.tsx:395` badge `bg-brand-50 text-brand-700`, `list-pane.tsx:254` active row `bg-brand-50 border-l-brand-700`), plus the shared header segment. The exemption's element list no longer matches; low confidence on what each old element became.
- [L] [§23/§17/§28 left panel/§31/§40/§45/§50/§56] Each still names `teal-*` for punched row, copy flash, selected row, challan selected row, "Yes, claim OT", dispatch dot "Normal", "Rollout activated" toast, Generate PDF / Customise IosToggles. The code has no teal classes, so every one of these is now brand (or data/ok). This is the same root cause as the [H] bullets above, listed so the rewrite covers every section.
- [M] [§28 Print] "Print: A4 landscape" — CODE: `app/globals.css:630` `@page mo-landscape {` sits **inside `@media print`** (opened at :422). That breaks CLAUDE.md §1's rule and UI §32's "`@page` rules MUST be top-level". The code's own comment at `globals.css:33-35` says: "`@page mo-landscape` further down IS nested inside @media print — a pre-existing violation … Do not copy it." The canon's landscape claim rests on a declaration the project's own rule says is ignored. See the confidence notes.
- [L] [§62.2] "the mobile `UpcomingDayBadge` and Floor's Upcoming strip both render the day only" — `components/floor/upcoming-strip.tsx` was deleted (log.txt, D). Floor's upcoming view is now a `variant: "upcoming"` inside `trip-desk.tsx`.

###### MISSING
- [H] The whole **Orbit token palette** in `tailwind.config.ts` — `brand` 50–900, the `ink` neutral (with no 300/800, "NOT `neutral` or `gray`"), `tint` (sky, "Nothing but tint may use this family"), `ok`, `warn`, `danger` ("NAMED `danger`, NOT `urgent`"), `fav`, and `data.{teal,blue,orange,rose,cyan,lime,pink,slate}` as identities. UI canon uses `brand-600`/`ink-*`/`data.slate` in §10.1/§59.x but never defines the families or their rules. The only definition lives in `docs/prompts/drafts/web-update-2026-09-06-orbit-colour-spec-v2.md`. Commits 5daa58fc, c96157ea (2026-09-09) and the rebrand step-1 token commit. Grep of the other canon files for `brand-`: only PLACE_ORDER (2) and TINT (1) mention it at all.
- [H] **Admin shell redesign** (2026-09-06: 0fc145bb "rebuild sidebar to 20 items in 5 groups", 8d7a3bef "app switcher in the sidebar footer", 95b24352, 44125138). `components/admin/admin-sidebar.tsx` NAV_SECTIONS = Overview / People & Access / Customers / Depot Master / Settings, "Roles" relabelled "Job Titles", Removed Orders added to the menu, My Attendance moved to a footer link, and a nine-destination app switcher (`lib/admin/app-switcher.ts`). It uses `OrbitWordmark` (`admin-sidebar.tsx:22`). UI canon has no admin-shell section. CORE §284 still lists the old "OVERVIEW / MASTER DATA / PEOPLE / OPERATIONS / PERSONAL / SETTINGS", which is the CORE worker's to fix.
- [M] **`ImportProgressPill`** (`components/import/import-progress-pill.tsx`, wired into `universal-header.tsx` ~:408-426). It disables Import while a run is running or failed and is shown on every header with Import. 37ceb57a (2026-09-14). There are 0 hits in any canon file.
- [M] **`useCanImportObds`** (`lib/hooks/use-can-import-obds.ts`, → `GET /api/import/access`, fail-closed). It drives `showImport` on Mail Orders + 5 tint screens: "ONE helper for all of them; never a per-screen role list (owner, 2026-09-16)". There are 0 hits in canon.
- [M] **`HeaderViewToggle`** (`components/shared/header-view-toggle.tsx`). This is §21's view-toggle look extracted into a shared component; the consumer is Tint Operator (Jobs/History), and Mail Orders is not yet a consumer. There are 0 hits in canon.
- [M] **`useKeyboardOpen`** (`lib/hooks/use-keyboard-open.ts`). This is the §55/§59.6 `keyboardOpen` rule extracted as a hook (120px drop, ~100ms debounce); consumers are `components/mrn/line-sheet.tsx`, `app/po2/product-drawer.tsx` and `app/po2/v2-sheet.tsx`. Canon states the rule but never names the shared hook, so the next module will re-derive it.
- [L] The PushToggle row in the You sheet is documented in CLAUDE_NOTIFICATIONS.md §3 but absent from UI §59.1's You-sheet anatomy (covered by the STALE bullet above).
- [L] `OrbitWordmark` is named in §12.2 but its file path (`components/shared/orbit-wordmark.tsx`, GENERATED by `scripts/generate-wordmark.mjs`, "do not edit by hand"), its `currentColor` contract and its three call sites (role-sidebar, admin-sidebar, login) are not recorded.

###### GONE
- [§2] The Orbit logo symbol (circle r=7 / r=2.2 / cx=18). Checked two ways: the Bash grep for `cx="18"|r="2.2"` gives 0 hits in components/ app/, and the only `r="7"` is a search-glass icon in `cart-panel.tsx:396`. `orbit-wordmark.tsx:9-11` states "There is no symbol".
- [§62.4] "(`components/floor/progress-bar.tsx`, used by `route-row.tsx` and `slot-band.tsx`) and sorts routes worst-first … (`components/floor/floor-board.tsx:201-208`)" — `slot-band.tsx` and `floor-board.tsx` were deleted (log.txt `D components/floor/floor-board.tsx`, `D components/floor/slot-band.tsx`; `ls components/floor` shows neither). The roll-up survives: `RouteRow` is now imported by `components/floor/trip-desk.tsx:36`, and the worst-first sort is in `trip-desk.tsx:911-923` (`ByRoute`, "The completion RATIO, worst-first"). The point still stands but both file anchors are dead.
- [§10.1] `OperatorTd` in `tint-table-view.tsx` is presented as live. The file still compiles but has no importer (retired per `tint-manager-content.tsx:24-25`).
- [§28] "Floor's tint-strip palette": `tint-strip.tsx` now lives in `archive/2026-09-floor-rail/` (retired).
- Clean for the other deleted items: UI canon never mentions `lib/push/quiet-hours.ts`, `public/category-images/*`, `carryover-banner`, `floor-tabs`, `floor-rail`, `rail-card` or `rail-empty` (grep over CLAUDE_UI.md gives 0 hits).

###### Stale code comments spotted (claims about data)
- `components/universal-header.tsx:158,163-166` — the JSDoc says `importVariant="primary"` is "brand-600" and warns about "spend[ing] its teal elsewhere", but the code at :433 is `bg-ink-900`.
- `components/admin/admin-sidebar.tsx:65-66` — "⚠ An admin now has NO LINK OUT of the admin frame. The app switcher … is step 6 and is deliberately not built here." The switcher IS built (`switcherItems`, :227-262; 8d7a3bef).
- `tailwind.config.ts` (danger block) — "⚠ Twelve live sites still paint Urgent in red". UI §3 says three components. One of the two counts is wrong; both are unverified claims.
- `tailwind.config.ts` (data.pink) — "Decorative Projects SMU (moves off #4F46E5)", yet `components/reports/tint-summary-document.tsx:333` still has `"Decorative Projects": "#4f46e5"`. That matches UI §56, so the comment's claim is the stale one (or the move was never done).
- `tailwind.config.ts` brand block — "Added 2026-09-08 (rebrand step 1). NOTHING reads these yet". This is false today: 146 files use `brand-*`.
- `components/mail-orders/instructions-strip.tsx` (~:66+21-25) — refers to "violet arm", `border-l-[#7c3aed]` and "VIOLET_NOTES_DOT above", but the constant is `NOTES_DOT = "bg-brand-600"` and the tone is `"notes"`.
- `components/floor/route-row.tsx:4` — "Parent (FloorBoard) sorts routes worst-first". FloorBoard is deleted; the parent is `trip-desk.tsx`.
- Many "teal" comments now describe violet/brand elements: `components/floor/assign-bar.tsx:19`, `detail-panel.tsx:580-615`, `billing/billing-tab-bar.tsx:12`, `billing/billing-picking-tab.tsx:531,599,656,792`, `ci/*` (new-return, spine, submitted-detail, ci-rail, register-export:53 "CLAUDE_UI.md §297"), `components/tint/HideObdModal.tsx:185`, `components/admin/hide-settings-content.tsx:1183`, `access-manager.tsx:378`, `attendance-home.tsx` (`variant="teal"` prop name). These are harmless but will mislead any grep-based audit.

###### Confidence notes / things you could not verify without a login or DB
- The `@page mo-landscape` nesting: Chromium may in fact honour `@page` inside `@media print`. The finding is that it breaks the project's own rule and the code comment calls it a violation. Whether the mail-order print actually comes out landscape needs a real print test.
- §22 (Sampling Library): I did not diff the pre-rebrand file to map each of the six named "teal" elements to its current colour. Low confidence beyond "the list no longer matches".
- The /po, /po2, Floor, Picking, CI, MRN and Tint screens were not audited in depth, per scope. The claims above are limited to what UI canon itself asserts.
- The `hide-settings-content` Tags modes were read from source only. I did not check whether important-tag confirms still fire on the "nobody/except/only" modes (the code's `hidesFromSomeone` suggests yes).

---
Counts — CLAUDE_UI.md: STALE 28 · MISSING 7 · GONE 4 (+1 clean check)
Top 3 gaps:
1. §1–§11 (and ~15 later sections) still define TEAL as the brand; code has 0 `teal-*` classes, brand is violet `brand-600` #7C3AED. The token system (brand/ink/tint/ok/warn/danger/data.*) is defined in no canon file.
2. §57 Tags tab is now a 4-mode "Who sees it" audience picker (role/person exceptions, /api/admin/tag-audience, abd495f4), not app-wide on/off switches. Manual hide moved off row menus to a rail select.
3. §63 /admin/access: 39 page keys, not 27. Edit is on 18 pages and Export on 2. The admin shell redesign (5 groups, app switcher, Job Titles) is undocumented in UI canon.


<!-- source: sweep worker out-core.md -->

### out-core.md — CORE + router + retirement playbook (read-only sweep, 2026-09-18, HEAD ec6343ba)

##### docs/CLAUDE_CORE.md — header v104 · Schema v27.24 (updated 2026-09-08) / footer v104 · Schema v27.24 (2026-09-08) / last commit c73ee93b 2026-09-12
Header-vs-footer match: **yes**. Both are stale, though. Three later commits edited the §5 body with no version bump and no footer entry: `38b545df` (2026-09-11, 27→28 keys), `9bc027a9` (2026-09-11), and `c73ee93b` (2026-09-12, 28→32 keys plus the billing action-tick sentence). The header, footer and version chain don't record any of them.

###### STALE
- [H] [§12 CI + §5 `ci` row] "`ci` is in the `PageKey` union and in `ALL_PAGE_KEYS`, but deliberately **NOT in `PAGE_NAV_MAP`** … Until then the URL is the entry point". The §5 row says the same: "deliberately **NOT in `PAGE_NAV_MAP`** — see §12". CODE: `lib/permissions.ts:102` `{ pageKey: "ci",                 label: "CI",            href: "/ci" },` was added by `55c3cdc6` on 2026-08-31, titled "ci: billing desk face + nav entry", and it's in the sidebar icon map at `components/shared/role-sidebar.tsx:76` `ci:                  Undo2,`. The comment above it (`:96-101`) records that navItems[0] was checked on 2026-09-01 and displaces nobody. So CI has been in the nav since before CORE v98 wrote this red block (2026-09-03). The router's `/ci` row carries the same false "URL only" claim.
- [H] [§5 Permissions] "`ALL_PAGE_KEYS` (**32 keys** since 2026-09-11 …". CODE: `lib/permissions.ts:353-375` lists **39** keys, and `:553` says "The 39 keys grouped for display". Seven keys are missing from CORE entirely: `billing_print` (slice 9, 2026-09-15), `place_order_ship_to`, `tint_panel_items/details/activity`, `reports_tint_summary` and `reports_ti_report` (all 2026-09-17).
- [H] [§5 Permissions] "⚠ **Nothing reads them yet** — all four buttons still gate on `mail_orders` canEdit inside `/api/billing/mail-order/actions`". CODE: `app/api/billing/mail-order/actions/route.ts:136` `const mayAct = await checkAnyPermission(roles, ACTION_KEY[action], "canEdit");`, with `ACTION_KEY = { hold: "billing_hold", slot: "billing_slot", … }` at `:122-127`, plus client reads at `app/(mail-orders)/mail-orders/layout.tsx:96-99`. The gate was repointed by `a991a1c4` (2026-09-12).
- [H] [§12 Reports + §5 table rows `ti_report` / `ti_report (reused)`] "Gated by the reused `ti_report` permission" and "`ti_report` (reused) | gates the Reports hub `/reports`". CODE: `lib/permissions.ts:155` says "the old `ti_report` key gates nothing any more". `:165-166` `canViewAnyReport` → `REPORT_PAGE_KEYS.some(...)`, and `:542` labels it `ti_report: "Reports (legacy — no effect)"`. The routes gate on `reports_tint_summary` (`app/api/reports/tint-summary/route.ts:37`) and `reports_ti_report` (`app/api/tint/manager/ti-report/route.ts:24`).
- [H] [§12 Floor Control] "`/floor`. admin, operations. The desk screen (left rail = undecided bills / right = Floor / On-hold / Cancelled + detail panel)". CODE: the trip desk replaced that layout. `bbb9628c` (2026-09-10) is "the trip desk replaces the board — trips left, bills right" and added `components/floor/trip-desk.tsx` and `trip-rail.tsx`. The decision rail was then archived by `79bcc412` (2026-09-13) to `archive/2026-09-floor-rail/`, whose README says "It stopped rendering on **2026-09-10**".
- [H] [§13, "Still open — TWO" (b)] "`app/api/reports/tint-summary/route.ts:33` — a **MULTI-clause** bypass, `role !== "admin" && role !== OPERATIONS` … It admits Operations User to the Tint Summary report". CODE: `app/api/reports/tint-summary/route.ts:30-38` now reads `// Gate (2026-09-17): the reports_tint_summary tick … Replaced a requireRole role list + a primary-role checkPermission.` followed by `const allowed = await checkAnyPermission(roles, "reports_tint_summary", "canView");`. The landmine is closed.
- [M] [§7.10] "`app_tag_settings` Per-badge on/off. id, tagKey TEXT UNIQUE, isEnabled …". CODE: `prisma/schema.prisma:1190` `tagKey      String` (no longer @unique), plus `:1191-1193` `scope String @default("everyone")`, `roleSlug String?`, `userId Int?`. The comment at `:1171` reads "🔴 `tagKey` IS NO LONGER @unique". Live uniqueness now comes from three partial unique indexes and `chk_app_tag_settings_scope` (commit `abd495f4`, 2026-09-11, `sql/2026-09-11-hide-tag-scope.sql`). Writes can't use `upsert` any more (findFirst→update/create), and nothing in CORE says so.
- [M] [§7.3 orders] "FIVE exist now (OrderPickedBy / OrderRemovedBy / OrderRestoredBy / OrderPickEarlyReleasedBy / OrderInvoicedBy …)". CODE: the orders model now has **seven** named user relations. `prisma/schema.prisma` adds `pickVisibleBy users? @relation("OrderPickVisibleBy", …)` and `loadedBy users? @relation("OrderLoadedBy", …, onDelete: SetNull)`. Also new: `tripDropId` → `trip_drops` (SetNull).
- [M] [§7.12] "NOTE: orders otherwise has NO secondary indexes beyond its PK + the obdNumber UNIQUE." CODE: the orders model also has `@@index([invoiceNo])` (orders_invoiceNo_idx, which CORE v27.21 itself records) and `@@index([tripDropId])`, plus the partial `orders_billing_pending_idx`.
- [M] [§7.14 / §12 Admin→Access] "`pageKey String one of the 27 ALL_PAGE_KEYS values`" and "that person's 27 page keys × 5 actions". CODE: 39 keys (`lib/permissions.ts:353-375`). The "every user gets every key" premise no longer holds either: `lib/permissions.ts:235-236` says "Absent row ≡ false: sql/2026-09-17-tint-panel-tabs.sql grants the people who saw the tabs".
- [M] [§7.13 Coverage + §13 "27 write routes still record no actor"] "43 call sites in 43 files … Tint 5 (`manager/reorder` PATCH, `manager/challans/[orderId]` PATCH, … `tinter-issue/[id]` PATCH, `tinter-issue-b/[id]` PATCH)". CODE: `grep -rln "logAdminAction({" app` → **49** files. Newly wired since d99709b8: `tint/manager/reorder`, `tint/manager/challans/[orderId]`, `tint/operator/tinter-issue/[id]`, `tint/operator/tinter-issue-b/[id]`, and `admin/tag-settings`. So 4 of the 5 "deferred Tint" routes are wired now.
- [M] [§13 requireRole] "every surviving `requireRole` array that omits `admin` still has the hole. 10 of the 58 name no admin at all". CODE: `grep -rn "requireRole(" app components` → **23** call sites (62 at d99709b8). The tint, master-data and report conversions removed most of them, so both "58" and "10" are stale. The owner needs to recount which of the remaining 23 omit admin.
- [M] [§13] "**TM reorder API** (`/api/tint/manager/reorder/route.ts` ~line 429) uses `prisma.$transaction`". CODE: `app/api/tint/manager/reorder/route.ts:102` `// Sequential awaits — never prisma.$transaction (CORE §3: …`. It was removed by `a0f9378b` (2026-09-05). Anchor drift in the same list: the challan `$transaction` is now at `challans/[orderId]/route.ts:551` (CORE says `:527`), and admin customers at `:137`/`:194` (CORE says 133/186).
- [M] [§7.4 Dispatch engine "Parked" bullet + §9 `applyMailOrderEnrichment`] "103 Deco Retail bills reached `pending_support` with `dispatchStatus` NULL (the engine fires only on `='dispatch'`) — an upstream diagnosis". CODE: `app/api/import/obd/route.ts:554` `async function applyNoMailOrderFallback(…)` is called at `:1423`, `:2017`, `:2562` and `:3869`. It releases non-tint `pending_support` + `dispatchStatus: null` bills automatically (`b3dfe5b8`, 2026-09-11, "every bill reaches the floor on its own — no release step"). It isn't in any canon file (see MISSING).
- [L] [§7.4 anchors] "`app/api/import/obd/route.ts:249`" (mailMatched write), "`route.ts:344`" (manual-skip guard) and "`route.ts:368-376`" (engine writes). CODE: `:263` `const updateData: Record<string, unknown> = { mailMatched: true };`, `:381` `if (ord.dispatchSlotSource === "manual") {`, and `:418-425`. There's also a second engine call site at `:599` inside the fallback.
- [L] [§12 Public] "the check at `middleware.ts:26` is `startsWith`". CODE: `middleware.ts:36` `if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {`. The code comment at `middleware.ts:20` ("The check at line 26") is stale too.
- [L] [§5 ROLE_HREF_OVERRIDES] "`lib/permissions.ts:112-136`" and "lives in **`lib/permissions.ts:117`**". CODE: the overrides are now at `:122-146` and the "richer split view" comment is at `:127`.
- [L] [§7.14] "`lib/auth.ts:208`'s rule that any `user_roles` rows REPLACE the primary". CODE: now `lib/auth.ts:221` `const roles = allRoles.length > 0 ? allRoles : [primaryRole];`.
- [L] [§12 Picking survivors] "`app/api/warehouse/pickers/route.ts` is LIVE — the Picking supervisor board calls it (`picking-board-mobile.tsx:936`)". CODE: the caller is now at `components/picking/picking-board-mobile.tsx:1734` `const res = await fetch("/api/warehouse/pickers");`. The claim still holds; only the anchor moved.
- [L] [§5 / §7.15] "checked by 68 gates". CODE: `grep "isSuperuser(\|requireSuperuser("` over app/lib/components gives ~76 non-definition call sites. It's a derived number that has drifted.
- [L] [§12 Mail Orders] "`/mail-orders`. billing_operator, tint_manager, admin." That contradicts CORE's own §5 `mail_orders` row, which adds operations and operation_manager. It's also no longer a role statement at all under per-user access.
- [L] [§7.1 vs §5] Internal contradiction: §7.1 says "`role_master` … ids 1-7 + 12-16, 12 rows live", while §5 says "`role_master` (13 roles)" and "118 rows across 13 slugs". This needs a DB check to settle.

###### MISSING
- [H] **The Trips module (Floor trip desk) is in no canon file at all.** Grep across `docs/CLAUDE_*.md` finds 0 hits for `trip_drops`, `trip_activity`, `app_settings`, `pickVisible`, `tripDropId`, `loadedAt`, `billing_print`, "trip desk" or "pick gate". ROADMAP doesn't have them either. What's there:
  - Schema: `trips` (43 fields), `trip_drops` (14), `trip_activity` (9) and `orders.tripDropId` (DDL mirror `aead3c32` 2026-09-09, `c84f8faa` 2026-09-14), with 7 named `Trip*By` relations on users. `transporter_master.isRealTransporter` is read at `app/api/floor/trips/options/route.ts:77`.
  - Routes and libs: `app/api/floor/trips/**` (route, `[id]`, bills, cancel, confirm, dispatch, billing, options), `lib/trips/*`, and slices 1-9 (`c539aae4`→`22ced2d8`).
  - None of this has a schema-version entry. The chain stops at v27.24, and nothing was minted for `aead3c32`, `16eff3d5`, `c84f8faa`, `abd495f4`, `71e7b53a` or the slice-8/9 DDL. That's the third time (after MRN and CI) that a module shipped outside the chain.
- [H] **`app_settings` + the floor pick-visibility gate.** The table was added by `16eff3d5` (2026-09-09). It's read at `lib/picking/visibility-gate.ts:58` and written at `app/api/floor/pick-gate/route.ts:108`, with key `picking.visibilityGate`, default-OFF, and per-trip `trips.shownAt` since slice 8 (`791a2cd6`). `orders.pickVisibleAt/ById` are now dead columns (visibility-gate.ts header). None of this is in CORE §7 or anywhere else.
- [H] **Billing Print tab + `billing_print` key.** Slice 9, `22ced2d8`, 2026-09-15: `app/api/billing/print/*`, `lib/billing/print.ts`, gated at `app/(mail-orders)/mail-orders/layout.tsx:77`. Grep finds it in no canon file. The router's Billing row doesn't mention it.
- [H] **No-mail-order auto-release fallback** (`b3dfe5b8`, `app/api/import/obd/route.ts:496-560+`). It changes the OBD pipeline in §1 ("→ Floor Control release") and the §7.4 dispatch-engine story. The code comment records the measured basis: "zero of 711 … auto-dispatched … a human released **861** by hand". It's in no canon file.
- [M] **The 2026-09-17 access keys**: `tint_panel_*` (read in `app/(tint)/tint/manager/layout.tsx:38-40`, gating `api/orders/[id]/audit-history:33` and the pause/skip-history routes), `place_order_ship_to` (`app/(place-order)/layout.tsx:47`), and `REPORT_PAGE_KEYS`/`canViewAnyReport` (`lib/permissions.ts:156-167`). None appear in the §5 table. Seed says: tint_manager and operation_manager get tint_panel_* view (`prisma/seed.ts:255-260`) and reports_* view, with export on reports_ti_report (`:273-276`). Billing_print and the 4 billing ticks go to billing_operator, operations, operation_manager and tint_manager (`:199-202`, `:224-242`).
- [M] **Schema columns documented nowhere**: `users.notesFontSize` (read at `app/(mail-orders)/mail-orders/layout.tsx:115`, `6409f07c`); `route_master.bayNumber` (`lib/floor/queries.ts:366`, `lib/picking/queue.ts:306`, `f7c8d232`); `mo_orders.updatedAt`, which is DB-trigger owned (`trg_mo_orders_updated_at`, deliberately not `@updatedAt`, `71e7b53a`). That's the opposite case to the `push_subscriptions` landmine in §13 and should sit next to it.
- [M] **The middleware prefix side-effects nobody lists.** `"/po"` in `PUBLIC_PATHS` (`middleware.ts:26`) also makes `/po2`, `/po9` and `/po-v2-8f4kd2` public (the `app/po9/page.tsx` header relies on this on purpose). `"/api/order"` (`middleware.ts:25`) makes `/api/orders/*` skip the session redirect, so all three `/api/orders/[id]/*` routes are protected only by their own `auth()` (verified present in each). §12 Public lists `/po` only, with no `/po2`, `/po9` or the `/po-v2-8f4kd2` redirect (`145b5f32`, `23804504`).
- [L] **`$transaction` sites not in §13**: `app/api/admin/areas/[id]/route.ts:43`, `admin/shades/route.ts:40`, `admin/skus/route.ts:64`, `tint/manager/cancel-assignment:28`, `tint/manager/splits/{cancel:43,create:150,reassign:50}`, `tint/operator/split/done:56`. §13 names only reorder (now gone), challans, admin/customers and admin/permissions.
- [L] §15 has no row for `lib/trips/*`, `lib/picking/visibility-gate.ts`, `lib/billing/print.ts`, `lib/access/source.ts` or `lib/access/role-baseline.ts`.

###### GONE
- [§13] TM reorder `$transaction`: `grep transaction app/api/tint/manager/reorder/route.ts` → only the comment at :102 ("never prisma.$transaction"). The call is gone (`a0f9378b`).
- [§13 (b)] The tint-summary multi-clause role bypass: `grep -n "role !== \"admin\"" app/api/reports/tint-summary/route.ts` → none. `grep -rn "role !== \"admin\"\|role !== 'admin'" app lib components` → 0 hits repo-wide.
- [§12 Floor] The "left rail = undecided bills". `getFloorRail`/`floor-rail.tsx` were archived to `archive/2026-09-floor-rail/`, and `ls components/floor` shows no `floor-rail.tsx`, `rail-card.tsx`, `tint-strip.tsx` or `rail-empty.tsx`.

###### Stale code comments spotted (claims about data/behaviour)
- `lib/permissions.ts:258-263` (billing_picking): "⚠ REGISTERED ONLY — NOTHING READS IT YET". Wrong: 5 routes gate on it, e.g. `app/api/billing/picking/list/route.ts:92`.
- `lib/permissions.ts:284-287` (billing_hold…): "⚠ Nothing reads these yet". Wrong: `actions/route.ts:136`.
- `lib/permissions.ts:412-419` and `:429-431` (ACTION_PAGES): "not yet backed by a check" / "THE CHECKS THESE ANTICIPATE DO NOT EXIST YET". Both are now backed.
- `lib/permissions.ts:300-303` (ci): "⚠ DELIBERATELY NOT IN PAGE_NAV_MAP YET. There is no /ci page until step 5". It's been in PAGE_NAV_MAP since `55c3cdc6`.
- `lib/permissions.ts:36-40`: "The boards themselves stay live at /planning and /warehouse". Both were archived 2026-07-28.
- `prisma/schema.prisma:1211` (app_settings): "⚠ NOTHING CONSUMES THIS YET — no query, route, component or seed entry". It's consumed by `lib/picking/visibility-gate.ts:58` and `app/api/floor/pick-gate/route.ts:108`.
- `middleware.ts:20`: "The check at line 26 is startsWith()". It's actually line 36.
- `lib/permissions.ts:127`: "richer split view" (already flagged in CORE §5; still unfixed).

###### Confidence notes / not verifiable without DB/login
- I didn't verify `user_page_access` live row counts and grants for the 12 new keys, `ACCESS_SOURCE` still = `user`, the `role_master` count (12 vs 13), or `chk_app_tag_settings_scope` and the partial indexes. All of these need a SELECT.
- Whether `orders.loadedAt/loadedById` are written anywhere: grep finds no writer in app/lib/components, so they're schema-only for now.
- The 2026-09-12 `c73ee93b` edit to §5 was correct when made (32); the key count then grew in 2026-09-15/17 commits that didn't touch CORE.

---

##### CLAUDE.md (router) — header v1.12 (2026-09-04) / footer v1.12 (2026-09-04) / last commit 509d58c5 2026-09-04
Header-vs-footer match: **yes**.

###### STALE
- [H] [§3 `/ci` row] "⚠ Reachable by URL only — not in the sidebar yet, and the reason is behavioural (CORE §12)". CODE: `lib/permissions.ts:102` `{ pageKey: "ci", label: "CI", href: "/ci" },` (since `55c3cdc6` 2026-08-31), and `components/shared/role-sidebar.tsx:76` `ci: Undo2,`.
- [H] [§3 `/floor` row] "left rail (undecided bills) / right pane (Floor / On-hold / Cancelled + detail panel); floor actions (hold/cancel/release/change-slot)". CODE: the trip desk is `components/floor/trip-desk.tsx` and `trip-rail.tsx` (`bbb9628c`), and the rail was archived (`79bcc412`). The trips module (`/api/floor/trips/*`, `lib/trips/*`, `trips`/`trip_drops`/`trip_activity`, the pick gate `/api/floor/pick-gate`) isn't named in any row.
- [M] [§3 "Retired" preamble + table] "Five SCREENS were retired in July 2026, plus one BOARD inside a route that stayed live." CODE: `archive/2026-09-floor-rail/` exists (`79bcc412`, 2026-09-13; README "The Floor decision rail — retired 2026-09-13"). It's the same shape as the Picking-desktop row (a component plus feed removed from a live route) and has no row.
- [L] [§4 item 4 note] The domain-file counts ("eleven of the twelve") are dated history and were correct on 2026-09-04: there are 12 domain files, 14 `CLAUDE_*.md` in total. Current stamps: CORE v27.24; TRIP_REPORT v27.24 (now matches); CI v27.21; MRN v27.20; PICKING/IMPORT/MAIL_ORDERS v27.15; the other five are v27.13. None is newer than CORE, so no stop condition applies.

###### MISSING
- [M] Route families with no §3 row or pointer: `/po2`, `/po9`, and the `/po-v2-8f4kd2` redirect (the Place Order row lists `/place-order`, `/po` only, although CLAUDE_UI mentions po2); the Billing **Print** tab and `/api/billing/print/*` (the Billing row stops at the Picking tab); the Floor trips API (`/api/floor/trips/*`, `/api/floor/pick-gate`); `/admin/access` (only implicitly under "/admin (other) → Core only"); `/orders` (a redirect page to `/floor`, see playbook).
- [L] The Tint row covers `/reports` but not the per-report ticks (`REPORT_PAGE_KEYS`).

###### GONE
- none

---

##### archive/RETIREMENT-PLAYBOOK.md — no version stamp; footer "last updated 2026-07-28" / last commit 8bcbabbb 2026-07-28
(archive/README.md, same last commit.)

###### STALE
- [M] [§7b Completed retirements, and archive/README.md table] Both stop at the 2026-07-28 Picking desktop row. `archive/2026-09-floor-rail/` (`79bcc412`, 2026-09-13) isn't indexed. The playbook's own §5 rule, "Add a row to `archive/README.md` in the same commit", was not followed. CODE: `ls archive/` → `2026-09-floor-rail`; `grep -rn "2026-09-floor-rail" docs CLAUDE.md archive/README.md` → no hits.
- Claims checked and **still true**:
  - `/orders` "entire body forwards to `/floor`. Two commits in its whole history": `app/orders/page.tsx` is `redirect("/floor");` and `git log --oneline -- app/orders/page.tsx | wc -l` = 2.
  - The two TI Report page files are unreachable behind `next.config.mjs` redirects: both `app/(tint)/ti-report/page.tsx` and `app/(tint)/tint/manager/ti-report/page.tsx` still exist, and `next.config.mjs` redirects both to `/reports?r=ti-report`.
  - `scripts/normalise-sampling-data.ts:313` still reads `prisma.sku_master` and is not excluded by `tsconfig.json` (`"scripts/_*.ts"` only).
  - Shade Master is still in the nav (`lib/permissions.ts:104`).

###### MISSING
- [L] §4 "Things that bit us" has nothing from the 2026-09-13 floor-rail retirement. Its README records a new lesson: a UI removed on 2026-09-10 left its **server feed** running for three days (772 ms, ~28% of each board request), and "removing a fetch is not removing an arm" (`floorUnslottedWhere` is still live). This is the first retirement not in the index.

###### GONE
- none

---

##### Other checks (no drift found)
- `vercel.json` crons (`35 18`, `30 20`) match CORE §4.
- `ROLE_REDIRECTS` (`lib/rbac.ts:23-45`) matches CORE §5 exactly.
- `lib/access/source.ts:41` `TTL_MS = 30_000` matches "~30 seconds".
- `isSuperuser` rides the JWT (`auth.config.ts:81`) and is refreshed by `fetchUserAttendanceFlags` (`lib/auth.ts:34-55`, `:130-166`), as CORE §7.15 says.
- `next.config.mjs` rewrites `/demo` and `/.well-known/assetlinks.json`. The assetlinks rewrite isn't in canon: a [L] MISSING, since CORE §12 only mentions `/demo`.
- All `route.ts` files carry `force-dynamic`.
- `prisma/seed.ts` still writes no `user_page_access` or `isSuperuser` rows (only comments at `:186/:197/:221` mention them), so the §13 seed landmine still stands.
- `components/shared/customer-missing-sheet.tsx:118-127` `fetchAll` still returns `[]` on `!res.ok` / catch, so the silent-403 landmine still stands.
- `mrn/photo` `isAdmin` is still at `:167-168`.


<!-- source: sweep worker out-tint-sampling.md -->

### Canon drift sweep — TINT + SAMPLING_LIBRARY (2026-09-18, read-only)

Method: read both canon files in full; listed every file under app/api/tint, app/api/sampling-library, app/api/reports, app/(tint), app/reports, components/{tint,reports,sampling-library}, lib/{tint,reports,sampling}; read gates on all 40 tint route files; read the done / split-done / base-bypass / marker / orders routes at the write sites; `git show` on c9ef1c31..e12ce9e9 (base bypass), b3dfe5b8, 0fbcd4be, 6f628b05, c5b2e783, 73a762e8. No DB queries. Schema diff since baseline touches no tint or sampling table.

---

##### docs/CLAUDE_TINT.md — header v2.1 (Schema v27.13, updated 2026-09-06) / footer v2.1 (Schema v27.13, updated 2026-09-06) / last commit 233e88f9 2026-09-06
Header-vs-footer match: yes.

###### STALE
- [H] [§2, bullets 3–5] "If no slot was pre-set: `workflowStage: "pending_support"` (the rail)." and "it advances the parent to `workflowStage = "pending_support"`". CODE: `app/api/tint/operator/done/route.ts:222-228` `: { workflowStage: SUPPORT_DONE_OUTPUT, dispatchStatus: "dispatch", slotId..., ...(completionSlot ?? {}) }`. `pending_support` is written ONLY when `isHeld` (`:196` `const isHeld = order.dispatchStatus === "hold";`, `:216-221`). Same at `split/done/route.ts:206-213`. Since b3dfe5b8 (2026-09-11) every finished tint bill, slot or no slot, goes straight to `pending_picking`. Only a held bill stays at `pending_support`.
- [H] [§2.1, bullet 2] "Completion deliberately does NOT pre-set a dispatch slot. Neither done route writes `dispatchTargetDate`/`dispatchWindowId` … it would leave the Floor rail entirely." CODE: `done/route.ts:209-210` `!isHeld && !hasPresetSlot ? await resolveCompletionSlot(orderId, now) : null`, then spread into the update at `:227`. `lib/dispatch/completion-slot.ts:107-109` returns `{ dispatchTargetDate: result.targetDate, dispatchWindowId: window.id }`. Completion now DOES write the slot and deliberately skips the Floor rail. The reasoning in the bullet is the opposite of the 2026-09-11 owner decision.
- [H] [§1.3] "A finished job leaves the tint stages entirely (`done/route.ts` writes `pending_support`, or `pending_picking` on a pre-set slot)". Same code as above: it writes `pending_picking` unless the bill is held.
- [H] [§11] "the `ti_report` permission gates the hub." CODE: `lib/permissions.ts:542` `ti_report: "Reports (legacy — no effect)",`; `:155` "`ti_report` key gates nothing any more"; `app/reports/page.tsx:42` `if (!canViewAnyReport(allPerms)) redirect("/unauthorized");` with `RAIL_ITEMS` pageKeys `reports_tint_summary` / `reports_ti_report` (`:27-28`) (6f628b05, 2026-09-17).
- [H] [§12] "used by both the JSON API (`GET /api/reports/tint-summary`, auth tint_manager/admin/operations)". CODE: `app/api/reports/tint-summary/route.ts:37` `checkAnyPermission(roles, "reports_tint_summary", "canView")`, and the same key at `app/reports/tint-summary/page.tsx:59`.
- [H] [§13.1] "Three TM page keys in `lib/permissions.ts`: delivery_challans, shade_master, ti_report" and "`delivery_challans` and `ti_report` gate their *screens*; the challan and TI-report **APIs** gate on `tint_manager`." CODE: `app/api/tint/manager/ti-report/route.ts:24` `checkAnyPermission(roles, "reports_ti_report", "canView")`. PageKey union now also has `tint_panel_items|details|activity` (`lib/permissions.ts:237-239`) and `reports_tint_summary|reports_ti_report` (`:316-317`). The challan screen `app/(tint)/tint/manager/challan/page.tsx` is gated by the manager layout's `tint_manager` canView (`app/(tint)/tint/manager/layout.tsx:26`) plus `requireRole([TINT_MANAGER, ADMIN, OPERATION_MANAGER])`. `delivery_challans` only decides whether the sidebar row shows.
- [H] [§1.2] "Left rail, 344px — 'Needs assignment'. … Strictly `workflowStage === "pending_tint_assignment"`." The rail now also holds a second list, "Tinter Issue pending" (the Base bypasses that still owe a TI), with a line drill-down and Undo. CODE: `components/tint/manager/board-rail.tsx:37-51` (`basePending`, `baseDrill`, `onUndoBase`) and `:256-317`.
- [H] [§1.5] "Single-operator only, from the rail card's popover or the panel." The Assign menu now has a third choice. CODE: `board-rail.tsx:243-245` `label: "Base — No Tint", … onPick: () => { setMenu(null); onBaseBypass(o); }`.
- [M] [§1.2 / §1.1] Detail panel "Items / Details / Activity tabs" is described as always present, and "Everything else is wired as before — … the Reports link". CODE: `app/(tint)/tint/manager/layout.tsx:37-41` reads `tint_panel_items/details/activity` canView and `canViewAnyReport`, and passes them through `TintManagerAccessProvider`. A tab without its tick is never mounted. The Reports pill is conditional: `tint-manager-content.tsx:893` `{canReports && (`.
- [M] [§4 API table / §5 API table] skip-history and pause-history "Auth: TM/Admin". CODE: `app/api/tint/manager/orders/[id]/pause-history/route.ts:20` needs tint_manager canView AND `:26` `checkAnyPermission(roles, "tint_panel_activity", "canView")`. skip-history is the same at `:21/:27`.
- [M] [§13.2] "`app/api/tint/**` holds **37 route files and 41 exported handlers.** **37 of the 41** … tint_manager 11 canView + 12 canEdit = 23 … tint_operator 4+10 = 14". CODE today: **40 route files, 44 handlers, 40 gated by a tick**:
  - tint_manager: 11 canView + 14 canEdit = 25. base-pending adds a canView; base-bypass and base-bypass/undo add two canEdit.
  - reports_ti_report canView: 1 (ti-report, which moved off tint_manager).
  - tint_operator: 4 + 10 = 14, unchanged.
  - The same 4 are not ticked: the 3 operator/shades handlers and skip.
  - The stray `app/api/tint/manager/splits/[id]/status/route (1).ts` is a 3-line `export {}` stub, not a route.
- [M] [§14] "⚠ STILL OPEN, and this is where the `$transaction` debt moved: cancel-assignment … and splits/cancel". Incomplete. There are also live `$transaction`s at `app/api/tint/operator/split/done/route.ts:56`, `app/api/tint/manager/splits/reassign/route.ts:50` (called from `tint-manager-content.tsx:614`) and `splits/create/route.ts:150` (no caller). The challan PATCH one is cited as `:527`; it is now at `challans/[orderId]/route.ts:551`.
- [M] [§8 UI] "TM Kanban card → 3-dot menu → 'Remove OBD' … TM Table view → same 3-dot menu in row (primary use)". The Kanban and `tint-table-view.tsx` are retired (§1 says so itself). Remove OBD is now offered only on the rail (§1.2), so §8 contradicts §1.
- [M] [§9 heading + key files] "Delivery Challan — /tint/manager/challans". The live page is `app/(tint)/tint/manager/challan/page.tsx` (singular), and `lib/permissions.ts:103` has `href: "/tint/manager/challan"`. A second mount at `app/(tint)/challan/page.tsx` has a narrower `requireRole([TINT_MANAGER, ADMIN])`.
- [M] [§1.4] "`tinting_in_progress` → violet (with picker)"; [§1.3] "Split rows carry a violet 'Split' tag"; "copied hex-for-hex … not exported as tokens". CODE:
  - `components/tint/manager/board-bits.tsx:95` `tinting_in_progress: { … cls: "bg-tint-bg text-tint-700" }` (sky, 73a762e8), and Floor `status-pill.tsx:181` `withPicker … "bg-tint-bg text-tint-700"`, a token now.
  - `board-table.tsx:263` Split tag is `bg-warn-bg text-warn-text` (b585240f).
- [L] [§13.5 last ⚠] "he carries `tint_operator` as a **secondary role** in `user_roles`". This is unverified (DB), but the ship note `docs/prompts/drafts/code-update-2026-09-06-tint-base-no-tint.md:39` records `DELETE FROM user_roles WHERE "userId" = 21 AND "roleId" = 5` on 2026-09-06. It needs a SELECT. The §13.1 holder table may still be right, because ticks live in `user_page_access`.
- [L] [§2 bullet 3] "sets `slotId` + `originalSlotId` on order using `resolveSlot()` thresholds". CODE: `done/route.ts:171-182` is an inline IIFE with hard-coded `"10:30"/"12:30"/"15:30"` → ids 1-4, and `resolveSlot` is not imported in either done route.
- [L] [§2 / §2.1 line refs] `done/route.ts:183-191` → now `:212-228`; `done/route.ts:159` completedAt → `:164`; `split/done/route.ts:100` → `:105`; `split/done:169` stale-comment ref → the comment is now at `:173-177`.
- [L] [§7 table] Line refs `tint-manager-content.tsx:715`, `:322-324`, `:123`, `:869-873` → now `:907` (`title="Add OBD to Tint (M)"`), `:345-347`, `:131`, `:1099`.
- [L] [§3.1] "Row 1: UniversalHeader title 'My Jobs'"; "Job filter as teal-600 segment pill". CODE: `tint-operator-content.tsx:1595-1599` title is a Jobs/History toggle, with the comment "The word 'My Jobs' is gone". The pill is `bg-brand-600` (`:1647`).
- [L] [§3.8] "Both operator card (1s tick) and table view (60s tick) delegate to this helper". The table view is retired, so only the operator card is live.
- [L] [§9.3] "Selected: `bg-teal-50 + border-l-teal-600`". CODE: `challan-content.tsx:386-387` `borderLeft: \`3px solid ${isSelected ? "#7C3AED" …}\`` / `"#F5F3FF"` (brand violet).
- [L] [§14] "Pause kebab on Table is pending-stage only…". The table it describes is retired.
- [L] [§8] "Removable by: users with TM-delete-right OR Admin". CODE: `orders/[id]/remove/route.ts:39` `checkAnyPermission(roles, "tint_manager", "canEdit")`.

###### MISSING
- [H] **"Base — No Tint" bypass: whole feature, no canon anywhere.** Commits c9ef1c31, d5fd1b58, 99175a99, 88f1dcfb, 4b9d321b, b93d9424, e12ce9e9. Only `docs/prompts/drafts/code-update-2026-09-06-tint-base-no-tint.md` describes it, and that file asks for a TINT section.
  - `POST /api/tint/manager/base-bypass`: tint_manager canEdit. Accepts `pending_tint_assignment` only, otherwise 400. Customer-missing gives a 400 plus the same interceptor sheet as Assign. It writes a `tinting_done` `tint_assignments` row with `startedAt = completedAt = now`, the same stage/slot update as done, and `tint_logs.action = "base_no_tint_bypass"`.
  - `POST …/base-bypass/undo`: refuses with TI_ALREADY_RECORDED / ALREADY_PICKED / released / stale.
  - `GET /api/tint/manager/base-pending`: tint_manager canView.
  - The placeholder worker is `lib/tint/base-operator.ts`. `BASE_OPERATOR_EMAIL = "base-notint@system.invalid"`. It is keyed by email, never id, and is `isActive=false` on purpose.
  - It is excluded from the board's Set E, from marker arms 2 and 3 (`marker/route.ts:109,124`), and from the report's `realCompletedObds` (`lib/reports/tint-summary-data.ts:460`).
  - TI routes let the placeholder's jobs be edited: `tinter-issue/route.ts:126-127` `assignedToId: { in: [userId, baseOperatorId] }`, and the same in `tinter-issue-b`.
  - The UI is `components/tint/manager/base-ti-panel.tsx`.
  - Downstream consumer: `lib/picking/colour-work-query.ts`.
- [H] **Completion slot rule** (b3dfe5b8): `lib/dispatch/completion-slot.ts` `resolveCompletionSlot()` is the single owner. There is a held-bill exception in done, split/done and base-bypass. No canon file mentions `resolveCompletionSlot` (grep of docs/CLAUDE_*.md + ROADMAP is empty).
- [M] **Manual tint entry's accepted stages** (b3dfe5b8). `manual-entry` and `manual-entry/lookup` now test `MANUAL_TINT_PULLABLE_STAGES = ["pending_support", "pending_picking"]` (`lib/workflow-stages.ts:84`). §7 says nothing on which stages can be pulled.
- [M] **Tint Operator History face** (dfd9b669, b2e7c78a, 5ce8d8ec, 2026-08-11, which predates v2.0/v2.1 and was still missed). `GET /api/tint/operator/history?date=YYYY-MM-DD`: tint_operator canView, 7-day window, IST bounds, keyed on `tinter_issue_entries.submittedById`. It uses `components/tint/operator/history-panel.tsx` and the Jobs/History toggle in the header. Absent from §3 key files, §3.1 and §3.11.
- [M] **Panel-tab ticks** (0fbcd4be): `tint_panel_items|details|activity`, `TintManagerAccessProvider`, and `/api/orders/[id]/audit-history` now gated on `tint_panel_details` canView. Not in any canon file (grep `tint_panel` in docs/CLAUDE_*.md is empty).
- [M] **Report ticks** (6f628b05): `REPORT_PAGE_KEYS`, `canViewAnyReport`, and `reports_ti_report` canExport → Download Excel (`lib/permissions.ts:453`, `ti-report-content.tsx:479` `showDownload={canExport}`). `/api/tint/manager/operators` is now `tint_manager` OR `reports_ti_report` (`operators/route.ts:22-23`). Not in any canon file.
- [M] **§12 Tint Summary Base split**: KPIs, pace and trend use `realCompletedObds` (Base excluded), while the operator cards and Completed register still list "Base / No Tint" (`tint-summary-data.ts:387-462, :641`). They can legitimately disagree, by design.
- [M] **Sampling usage-log gap #2**: TIs saved on a Base-bypassed bill through `base-ti-panel.tsx` never produce `sampling_usage_log` rows. `writeUsageLogsForAssignment` has exactly one caller, `done/route.ts:265`, and neither tinter-issue route writes usage. So Base-bill shades are invisible to same-site suggestions, the same way split-done ones are. Neither canon file mentions this.
- [L] **Live but undocumented mounts**:
  - `/admin/tint-manager` (`app/(admin)/admin/tint-manager/page.tsx` renders `<TintManagerContent />`) sits outside the manager layout, so no `TintManagerAccessProvider` wraps it. The context default is `NONE` (`tint-manager-access-provider.tsx:48-53`), so every panel tab and the Reports pill are hidden there even for the superuser. It is URL-only (removed from the admin sidebar per `admin-sidebar.tsx:62`).
  - `/operations/tint-operator` (`app/(operations)/operations/tint-operator/page.tsx`) is gated by job title `["operations","admin"].includes(session.user.role)`.
  - `/tint/shades` is the operator-sidebar Shade Master (`app/(tint)/tint/operator/layout.tsx` adds `href: "/tint/shades"`). §10 names only `/tint/manager/shades`.
  - `/tint/manager/{customers,routes,skus,vehicles}` pages are not in TINT.
- [L] **The answer to §13.2's open question** "does anything still call these two routes?": **no client calls `/api/tint/operator/shades*`**. Its only hit is a comment at `tint-operator-content.tsx:886` ("legacy preload … is gone"). The Shade Master screen calls `/api/admin/shades` (`shade-master-content.tsx:167,191`).
- [L] [§3.12] Reuse rows now carry `otherVariants` (a "+N packs" disclosure, view-only, no pigments) from c5b2e783 (`flat-suggestion-list.tsx:169-296`).
- [L] **Cross-module tint reads with no TINT pointer**:
  - `GET /api/picking/tint-workload` (+ `/marker`) is gated by the `picking` PageKey canView (aeed851c, e2446c70).
  - `GET /api/floor/tint-operators` is gated by the `floor` PageKey canView (143706be).
  - The floor tint lock widened to "waiting" (4af18cc8).
  - These belong to FLOOR/PICKING canon; flagged so the owners check.

###### GONE
- None of TINT's described routes or files are gone. Verified present: `splits/create` (still no caller: only `split-builder-modal.tsx:201`, and that modal is not imported anywhere), `orders/[id]/status` and `splits/[id]/status` (no client caller; grep of components/tint for `/status` is empty), the retired `tint-table-view.tsx` / `split-builder-modal.tsx`, the `ti-report` redirects (`next.config.mjs:33-34`), and the preview page `app/reports/tint-summary/preview/page.tsx`, which §12 "Pending" correctly still lists.
- `slotSummary` is still built and returned, and nothing reads it (grep outside the route is empty). §1.10 is still correct.
- The split-done usage-log gap is **still open**: `split/done/route.ts` has no `usage` reference at all. §14 is still correct.

###### Stale code comments spotted (claims about data or model)
- `app/api/tint/operator/split/done/route.ts:173-176`: "Auto-flips to SUPPORT_DONE_OUTPUT … if operator pre-set a slot, otherwise lands in pending_support". The code below it (`:201-213`) releases without a preset and stays at pending_support only when held.
- `app/api/tint/manager/challans/[orderId]/route.ts:452`: "The GET above deliberately still uses requireRole". The GET uses `checkAnyPermission(roles, "tint_manager", "canView")` at `:34`.
- `app/api/tint/manager/orders/[id]/pause-history/route.ts:18`: "Permission gate (locked OrbitOMS model): Admin OR canView on tint_manager". This is the retired "locked model" phrasing that §13.3 says was scrubbed. It also omits the `tint_panel_activity` AND-gate added 6 lines below.
- `app/api/tint/operator/history/route.ts` header: "`my-orders/route.ts` builds its 'today' with `setUTCHours(0,0,0,0)`". I verified this true at `my-orders/route.ts:28`, so it is a real latent IST bug in `totalDoneToday`/`totalAssignedToday` (§3.11), not a stale comment.
- `challan-content.tsx:391` "Selected teal styling" and `tint-operator-content.tsx:1643` "teal pill" are stale since the rebrand (the colours are brand violet now).

###### Confidence notes
- DB not queried. Unverified:
  - §13.1 holder tables.
  - Whether `sql/2026-09-17-tint-panel-tabs.sql` / `sql/2026-09-17-report-ticks.sql` ran. Both commits say DO NOT PUSH before the SQL; absent rows read false, so Chandresh/Prakash would see no panel tabs or reports.
  - Chandresh's `user_roles` removal.
  - The live placeholder row (id 54 per the draft).
- The §13.2 handler counts are derived from the tree by grepping `^export async function` plus the gate line per file. They are exact for the current tree.
- I did not re-verify §3.3–§3.7, §5 pause/resume logic, §6, or §9.5–§9.10 line-by-line. No commit since 2026-09-06 touched those paths except rebrand colour swaps.

---

##### docs/CLAUDE_SAMPLING_LIBRARY.md — header v1.6 (Schema v27.13, updated 2026-08-04) / footer v1.6 (Schema v27.13, updated 2026-08-04) / last commit 7d8ceece 2026-08-05
Header-vs-footer match: yes.

###### STALE
- [H] [§8 Files map] It lists `app/(tint)/tint/sampling-library/{sampling-library-page.tsx, sampling-list.tsx, sampling-detail.tsx, edit-modal.tsx, deactivate-modal.tsx, review-modal.tsx, new-variant-modal.tsx}`, `components/sampling-library/{variant-tabs, recipe-table, usage-log-table, used-at-list, skus-used-list, action-buttons}.tsx`, and `lib/sampling-library/{types,fetchers,filters,allocate-sampling-no}.ts`. **None of these exist, and none ever existed in git** (`git log --all` on them is empty). The live tree:
  - The route folder is just `layout.tsx` (sampling_library canView gate) and `page.tsx`, which is `return <SamplingLibraryContent />`. It is not "server: roles + initial fetch".
  - `components/sampling-library/` holds `sampling-library-content.tsx`, `-detail-pane.tsx` and `-list-pane.tsx`.
  - `api/sampling-library/_lib/` also holds `detail.ts` and `validate.ts`, which the map omits.
  - Allocation lives in `app/api/tint/operator/_lib/sampling-resolution.ts` (`allocateNextSamplingNo`).
- [H] [§4 Detail pane item 8] "Edit (pencil) → opens edit modal · Deactivate (ban) → PATCH … confirm modal · Mark for review → POST …/review". CODE: `components/sampling-library/sampling-library-detail-pane.tsx:414` `onClick={() => console.log("edit", detail.samplingNo)}`, `:420` `console.log("deactivate", …)`, `:426` `console.log("mark-review", …)`. All three are unwired stubs. No client anywhere calls PATCH `/[samplingNo]`, POST `/variants`, POST `/review` or POST `/api/sampling-library`.
- [M] [§5] "POST | `/api/sampling-library` | sampling_library canEdit | Create new parent entry (…inserts first variant + first usage_log row)". CODE: `app/api/sampling-library/route.ts:253` `checkAnyPermission(roles, "sampling_library", "canImport")`. The route writes `sampling_register.create` (`:375`) and `sampling_recipes.create` (`:410`) and no `sampling_usage_log` row.
- [M] [§5] "POST | `/formula-match` | operator |". CODE: `formula-match/route.ts:42` `checkAnyPermission(roles, "sampling_library", "canView")`.
- [M] [§5] "POST | `/[samplingNo]/review` | canEdit | Toggle `needsReview`". CODE: `review/route.ts:9-10` "Marks a 'needs review' shade as reviewed. Idempotent miss returns 400 if already reviewed". `:62` `if (existing.needsReview === false)` → 400; `:76` `data: { needsReview: false, … }`. It is one-way and clears the flag, the opposite of §4's "Mark for review".
- [M] [§6] "`MAX(samplingNo) + 1` — plain sequential, no year prefix … retry up to 5 times". CODE: `sampling-resolution.ts:13-22` `getIstYearPrefix()` … `SELECT next_sampling_no(${yearPrefix})`. Both allocators retry 3 times: `sampling-resolution.ts:193` `attempt === 2`, and `route.ts` `for (let attempt = 0; attempt < 3; …)`. §3 Phase 4.5 already names `next_sampling_no()`, so §6 contradicts its own file.
- [M] [Header roles table] It presents the `role_permissions` grants ("roleSlug | canView | canEdit") as who holds access. Since 2026-09-04, `ACCESS_SOURCE = user` and access comes from `user_page_access` (TINT §13 banner, CORE §5), so this table is the fallback now. It needs the same reframing TINT §13 got.
- [L] [Header line 21] "⚠ `CLAUDE_CORE.md §5`'s `sampling_library` row still shows the OLD list — flagged for the final CORE pass". CORE now carries the five-role row: `docs/CLAUDE_CORE.md:269` "FIVE roles, ALL canView+canEdit — SELECT 2026-08-05" (FP-e). Resolved.
- [L] [§11] "⚠ The CODE COMMENT at `suggest.ts:51-52` says the opposite ('The current UI still reads exactMatches + referenceList') — it is a STALE COMMENT". The comment was corrected on 2026-08-05 (6f1e35a8). It now reads `suggest.ts:51-54` "flatSuggestions IS what the live UI reads … exactMatches + referenceList are still BUILT but consumed by nothing".
- [L] [§4 Visual style — exemption] "this page uses teal across multiple elements intentionally". CODE: zero `teal` in `components/sampling-library/*.tsx`. The rebrand (5daa58fc/c96157ea) moved it to `bg-brand-50` / `text-brand-700` / `border-brand-200`.
- [L] [§9] "`usageDate` is captured at minute granularity". CODE: `prisma/schema.prisma` `usageDate DateTime? @db.Date` (date only). §2 itself says `DATE`.
- [L] [§3 Phase 4.7] "`suggest.ts:133` short-circuits on `if (!row.recipe) continue`". This is now `suggest.ts:351`.

###### MISSING
- [M] [§5] `GET /api/sampling-library/suggest?siteId=&skuCode=&packCode=` (sampling_library canView, `suggest/route.ts:21`) is **absent from the API table and the files map**, yet it feeds the operator reuse list. Callers: `tint-operator-content.tsx:986` and `components/tint/manager/base-ti-panel.tsx:172`. §11 describes `_lib/suggest.ts` but never names the endpoint.
- [M] [§11] `otherVariants` / `SuggestVariant` (c5b2e783): every other pack/SKU variant of a shade, view-only with no pigments, with `lastUsedAt` from the recipe's own column rather than from the usage log. Both producers use it (`buildSuggestPayload` adds one extra query per page; `operator-search` has no new query), and it is rendered as "+N packs" in `flat-suggestion-list.tsx:245-296`.
- [M] [§1 / §9] A second consumer of the library now exists: the Tint Manager's `base-ti-panel.tsx`, which uses suggest, operator-search and formula-match, and saves through the operator TI routes. Its TIs write **no** `sampling_usage_log` (see the TINT MISSING bullet). This is a second usage-log gap beside split-done.
- [L] [§2] The `sampling_usage_log` index list omits `@@index([siteId], map: "idx_sampling_usage_log_site")` (schema.prisma). That is the index the strict-siteId suggestion engine depends on.

###### GONE
- None. All 8 live route files match §5 paths except the undocumented `/suggest`: route.ts, [samplingNo], variants, review, usage-log, operator-search, formula-match, suggest. `components/tint/operator/suggestion-card.tsx` still exists with no importer, which matches "retired".
- The split-done usage-log gap is **still open**, confirmed: no `usage` reference in `app/api/tint/operator/split/done/route.ts`, and the only caller of `writeUsageLogsForAssignment` is `done/route.ts:265`.

###### Stale code comments spotted
- `app/api/sampling-library/suggest/route.ts:10-12`: "Powers the operator-screen SuggestionCard: exact … matches on top, other samplings at the same site beneath". SuggestionCard is retired, and the live consumer reads `flatSuggestions` via `flat-suggestion-list.tsx`.

###### Confidence notes
- The operator (and ops_admin) `canEdit` grant noted in the header now has no UI path at all: every write button in the library is a `console.log`. Operators do write samplings, but only through the TI routes (`sampling-resolution.ts`), which are gated by tint_operator canEdit, not sampling_library.
- The §12 merge-runbook status (2026-07-27 figures) cannot be checked without a DB read.


<!-- source: sweep worker out-picking-notif.md -->

### Canon drift — CLAUDE_PICKING.md + CLAUDE_NOTIFICATIONS.md (sweep 2026-09-18, read-only)

Method: both canon files read in full; code read at call sites; commits since each file's own last commit taken from scratchpad/commits.txt and `git log`/`git show`. Keyword sweeps against ALL `docs/CLAUDE_*.md` + `CLAUDE.md` + `docs/ROADMAP.md` were run before any "no canon anywhere" claim. No DB queries were run.

---

##### docs/CLAUDE_PICKING.md — header v1.17 / footer v1.17 / last commit 2027b1a4 2026-09-04
Header vs footer match: **yes**. Both say v1.17 · Schema v27.15 · 2026-09-04.
- Form note: the change-log body has entries only for v1.12, v1.13 and v1.15. v1.14, v1.16 and v1.17 are recorded only in the footer prose.
- Footer claim to re-check: *"v27.16-v27.21 … touch no picking table"*. `route_master.bayNumber` was added in picking commit f7c8d232 (2026-08-21), and the board reads it (`lib/picking/queue.ts` DEALER_SELECT `primaryRoute: { select: { name: true, bayNumber: true } }`). The stamp itself can stay as it is (router §4), but that sentence is false.

###### STALE
- [H] [§1, §2] "an order becomes pickable the instant Floor's **Release** fires" and the ladder `pending_support → [Floor Release] → pending_picking`. CODE: `app/api/import/obd/route.ts:641-651` `data: { dispatchStatus: "dispatch", workflowStage: SUPPORT_DONE_OUTPUT, ...slotData }` inside `applyNoMailOrderFallback`, called on all three import paths (:1423, :2017, :2562, :3869). Commit b3dfe5b8 (2026-09-11): "every bill reaches the floor on its own — no release step". Non-tint bills now arrive at `pending_picking` on import. Mail-matched bills go through auto-done (:477), and unmatched bills through this fallback. The only remaining exceptions are tinting bills and held bills. Floor Release is no longer the normal entry point.
- [H] [§4 queue / §8 `lib/picking/queue.ts` row / §10] "Returns `{ date, rows }`" and "the payload is now `{ date, rows }` and every surface counts what it needs off `rows`". CODE: `lib/picking/queue.ts:255-293`, where `PickingQueueResult` also carries `waitingSkus`, `oilSkus` (pick bundling, 2026-08-18), `heldBack` and `heldBackTrucks` (visibility gate, 2026-09-09 / slice 8). The same stale claim appears in §7 ("`windows[].count` … GONE") and in NOTIFICATIONS §8 landmine 6.
- [H] [§10] Marker returns "`{ count, latest }`" and "the marker is TWO numbers". CODE: `app/api/picking/marker/route.ts:23` "Marker = (count, latest, heldBack)" and `:173-177` `heldBack: held.bills, … heldBackTrucks: held.trucks`. The marker also reads `isPickGateOn()` (:112) and passes `gateOn` into `buildPickingWhere`. Neither the change-detection contract nor "Marker ⊇ queue" names the gate. The rule that both callers must pass the same `gateOn` lives only in a code comment (`queue.ts:198-205`).
- [H] [§4, §10 "Marker ⊇ queue … always `buildPickingWhere()`"] `buildPickingWhere` now takes `gateOn`, and its openPending WAITING arm is split from the in-progress arm. CODE: `lib/picking/queue.ts:396` `waitingBranchWhere(gateOn),` then `{ workflowStage: { in: [PICK_ASSIGNED, PICK_DONE] } }`. With the gate ON, a waiting bill is shown only when `tripDropId: null` OR its trip has `shownAt` set (`lib/picking/visibility-gate.ts:96-101`). Canon describes an ungated single `in` clause.
- [M] [§6, §2 ladder "(dispatch, unbuilt)", §7 "NO AUTOMATIC DRAIN" / "that write path doesn't exist yet"] CODE: `lib/floor/dispatch.ts:176-179` `data: { workflowStage: DISPATCHED }`, plus a log row, called from `app/api/floor/trips/[id]/dispatch/route.ts`. The write path now EXISTS (3945e6d5, 2026-09-13). BUT the route's own header (:14) says "NO CALLER SINCE SLICE 7 (2026-09-15), AND KEPT ON PURPOSE", and a grep of components/ and app/ finds no client caller. So "nothing on the floor writes `dispatched`" is still true in practice, but canon should say a capability exists and is unreachable, rather than "doesn't exist". §7's figures (1,051 dispatched, 2026-07-24) are also out of date. Code comments now claim 4,137 rows (`lib/workflow-stages.ts` DISPATCHED doc) and 7,067 (`lib/floor/dispatch.ts:6`). Those are claims, not verified here.
- [M] [§1 "Access is now SEEDED … `role_permissions` … seed and live agree"; §7 grants block] Permissions no longer come from role rows alone. CODE: `lib/permissions.ts:789-808` `checkAnyPermission` → admin role → `access.isSuperuser` flag → `userModeId` → `user_page_access`, and only falls back to `role_permissions` in role mode. CORE says `ACCESS_SOURCE` is live = `user` (CORE :145, "SELECT-verified 2026-09-04"). Picking access is therefore decided per user by ticks, and "the admin bypass" is now "admin role OR isSuperuser flag". §1's "floor_supervisor and picker hold `picking` but NOT `floor`" is now a per-user fact, not a per-role one. The tint-workload commit aeed851c SELECT-verified it for the current 6 supervisors and 12 pickers.
- [M] [§5.2 Zone 2] "Opens … OR via **manual early-release** (tap 🔒 → confirm → jumps to Zone 1; `POST /api/picking/release` …)". CODE: `lib/picking/release-window.ts:10-11`: "A supervisor may release an upcoming (future-dated) bill early ONLY on the LAST WORKING DAY before its dispatch date". The release route imports `isReleasableToday`/`previousWorkingDateOnlyUTC` (:10), and `PickingQueueRow.releasableToday` (`queue.ts:817`) drives the lock (43b759a1, 2026-09-07). Early release is now gated to a single day, and Sunday is skipped. The rule is duplicated on purpose in `lib/dispatch/dispatch-engine.ts`, with a mirror-both warning.
- [M] [§5.2 Picking tab] "Filtered by **picker**, not route … Undo lives on the detail screen, not the card." CODE: `components/picking/picking-board-mobile.tsx:1457` `const [pickingView, setPickingView] = useState<PickingView>("picker");`. The tab is now three levels: picker cards → that picker's bills → the bill (adcc212d). A Picker|Bill toggle replaced the dropdown (05d4ca21). `:442` says "The Picking tab's level-2 list puts its Undo control here" (on the card shelf). `DetailListKey` is now a discriminated union with `{ kind: "stillPicking"; pickerId: number | null }` (`:190-206`), not the four strings in §5.3.
- [M] [§5.2 Card DNA; §5.4 card language; the ⚠ CORRECTED 2026-08-19 box] "where-row = route dot + **area** + volume" and picker "route dot + **area** + `articleTag` + volume". CODE: `picking-board-mobile.tsx:857` `{row.route ?? "—"}` and `picker-my-picks-board.tsx:1622-1628` "ROUTE, not area (2026-08-21) … {row.route ?? "—"}" (f7c8d232). Also "picker name at its right end on Picking/Done": the Done tab's CHECKED card was rebuilt (99c218a8). Its where-row right end is now the volume, and the picker name moved to a footer sentence.
- [M] [§5.2 SMU badge, trap (b); "all four picking surfaces … BOTH detail-screen headers"] "isSmuBadged is also in the flag-row guard (`isKeyCustomer || priorityLevel === 1 || isTint || …`)" and "The PICKER detail header had no flag row at all, so one is created". CODE: the detail headers no longer have a flag row. `components/picking/bill-symbols.tsx:46-60` `hasBillSymbols()` = `hasDuplicateSo || isKeyCustomer || priorityLevel === 1 || isColourWorkBadged(row.colourWork) || isSmuBadged(row.smuCode)`, rendered as `<BillSymbols>` at `picking-board-mobile.tsx:4115` / `picker-my-picks-board.tsx:1819`. `isTint` was replaced by `colourWork` (0841b5c9, 2026-09-17).
- [M] [§5.3 NO_BILL_SWIPE_ATTR bullet; §5.3 "the pack-filter chips … overflow the screen … reaching the chips past the right edge means scrolling that strip"] CODE: `picking-board-mobile.tsx:4415` and `picker-my-picks-board.tsx:1977`, both `flex items-center flex-wrap gap-1.5`. Chips now wrap instead of scrolling (474b08a5, 2026-08-20). The picker strip keeps the attribute "as a GUARD rather than a repair" (`:1960`). The supervisor strip still does not carry it, which is now harmless because the row no longer scrolls.
- [M] [§5.3 "Reads the **full active line set** … nothing silently disappears"] CODE: `app/api/picking/order/[orderId]/route.ts:6` imports `groupPickingDetailLines`. `lib/picking/group-lines.ts:5-31` merges SAP per-batch split lines into one row per (skuCodeRaw, pack), sums the quantities, and carries `lineIds` (b86a4a8c). Each row also has `family` (c85c739d) and `hardener` (6d61ce79). Canon describes one row per raw line.
- [M] [§5.2 Done tab "ticking every line unlocks **Approve**"; §6 "supervisor ticks every line + taps Approve"] CODE: `picking-board-mobile.tsx:1600` `hardenerCheckedIds`, counted in at `:2507`. caa2a06b: "the hardener … gates Approve". For 2K PU SKUs (`lib/picking/hardener-skus.ts`) there is an extra HARDENER sub-row whose tick is required before Approve unlocks.
- [M] [§10 last bullet] "`use-picking-marker` gained OPTIONAL `url` + `onProbe` … **All three Picking call sites pass neither and are byte-identical**". CODE: `components/picking/picking-mobile-shell.tsx:548-554` `usePickingMarker({ scope: "openPending", url: "/api/picking/tint-workload/marker", … })`. The hook also now returns `resync()` (`lib/hooks/use-picking-marker.ts:110`, 32e66a9b), and both picking shells use it (`markerResync`, shell:498, picker board:507). Non-picking consumers are now Floor, Billing, CI, MRN, Tint Manager and Mail Orders.
- [L] [§7 "The picker's pinned stat row now carries FOUR things … deferred"] CODE: `picker-my-picks-board.tsx:1868-1876`. Volume moved onto the wrapping articleTag line (2026-08-22), and the code comment cites this deferred note as resolved. The bay and route moved to `BillBand` (`components/picking/bill-band.tsx`).
- [L] [§8 `card-atoms.tsx` row] "Both import exactly four … ⚠ `FamilyChip` … `CardShelf` is their only consumer; do not hunt for board-level call sites." CODE: `picking-board-mobile.tsx:34` imports `FamilyChip`, `ColourWorkBadge`, `SmuBadge` and `isSmuBadged`, and renders `<FamilyChip>` at `:3481`.
- [L] [§5.1 / §5.3] "The top **teal** header"; "Teal stays reserved for the Assign CTA". CODE: `app/picking/page.tsx:17-22` "THIS ROUTE'S HEADER IS A PALE MASTHEAD (#F5F3FF)". The 2026-09-09 rebrand moved teal to violet. The UI canon now carries a "one violet" rule (UI v5.30 §59.9).
- [L] [§2] "`SUPPORT_DONE_OUTPUT` … seven files import it". CODE: `grep -rl SUPPORT_DONE_OUTPUT app lib components` shows 14 files.
- [L] [§6 build history (3)] "no picker-facing login flow shipped yet". This contradicts the same file's §5.4: "real picker/supervisor test accounts … land here on login".
- [L] [§8 `picking/page.tsx` / §5.4 test hook] "`?view=picker&as=<id>` test hook (admin preview)". CODE: `app/picking/page.tsx:95` `canUseTestHook = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATIONS)`, so operations has the hook too. Canon says "admin/operations" in §1 but "kept for admin preview" in §5.4. Minor.

###### MISSING (nothing in any `docs/CLAUDE_*.md` unless noted)
- [H] **Floor visibility gate / "desk control"** (7e89e8fb, fdc03beb, 9a3671ec, 963665af, da80d657, 2026-09-09; made per-trip in slice 8, 791a2cd6, 2026-09-15). Code: `lib/picking/visibility-gate.ts` (`PICK_VISIBILITY_GATE_KEY = "picking.visibilityGate"` in `app_settings`; `isPickGateOn()` fails closed to OFF; `waitingBranchWhere`; `countHeldBackWaiting`), `app/api/floor/pick-gate` (the toggle is `components/floor/pick-gate-toggle.tsx`, gated on floor canEdit), and the Assign-tab band "N trucks with the planner · M bills" (`picking-board-mobile.tsx:3174-3200`).
  - Answer to the brief: **YES, the picking queue filters, but no longer on pickVisible.** `orders.pickVisibleAt/pickVisibleById` "are no longer read or written" (visibility-gate.ts:22-24). The filter is `tripDropId IS NULL OR trip.shownAt IS NOT NULL`, applied to the WAITING branch only, and the assigned/picked/checked branches are never gated.
  - The draft `code-update-2026-09-09-picking-visibility-gate.md` describes the per-bill version, which slice 8 superseded.
  - `app/api/floor/pick-visible/` exists as an EMPTY folder; the route was retired in slice 8.
  - A grep for `pickVisible|shownAt|visibility gate|app_settings` across canon finds nothing.
- [H] **Pick bundling on the Assign tab** (3fdd0e13 moved the engine into Picking; 467c2afe). Code: `lib/picking/grouping.ts` (`buildPickGroups`, `buildOilGroups`, `buildOilSkuSet`), which Picking now OWNS and Floor imports (`lib/floor/queries.ts:37`). Flag: `PICKING_GROUPING_ENABLED = true` (`queue.ts:237`), deliberately separate from Floor's `RULE2_ENABLED`. Payload siblings: `waitingSkus`/`oilSkus`. UI: SAME MATERIAL / MOSTLY SAME / SINGLE PICKS headings and stripes. Types are `PickGroupCandidate`/`PickGroup`/`OilGroup`. This changes the Assign tab's DISPLAY order on top of §3's spine. Drafts: code-update-2026-08-17/18 *-grouping.md and code-discovery-2026-08-18-pick-grouping-evidence.md.
- [H] **Supervisor cancel** (00d7da22, af075572). `POST /api/picking/cancel` gates on picking canEdit and writes a `cancelled` stage, clears `dispatchStatus`, deletes `pick_assignments`, and adds one log row. There is no undo here; restore happens on Floor's Cancelled tab. `PICKING_CANCELLABLE_STAGES` = `pending_picking`/`pick_assigned`/`pick_done` (`lib/workflow-stages.ts`), which is narrower than Floor's. UI is `components/picking/cancel-sheet.tsx` and `lib/picking/cancel-reasons.ts` (the ⋯ menu on the supervisor detail). It is also a new **push trigger** (see NOTIFICATIONS). Commit 00d7da22 also fixed "Floor's orphaned pick_assignments trap".
- [H] **Tint room feed + Tinting section on the Picking tab** (aeed851c, e2446c70, 2026-09-18). Code: `GET /api/picking/tint-workload` + `/marker` (gated on picking canView, not a tint key), `lib/picking/tint-workload.ts` (555 lines), and `TintCard`/`TintBillRow` in `picking-board-mobile.tsx:970-1155`. The section is read-only and has its own marker hook paused on `detailOpen || overlayBusy`. The Assign strip has a "View ›" jump (`goToTinting`, shell :557).
- [H] **colourWork + TINT/BASE word** (ba03fc89, 0841b5c9, 2bcb47e9, 2026-09-17). Code: `lib/picking/colour-work.ts`, `colour-work-query.ts`, `PickingQueueRow.colourWork: "tint"|"base"|null` (SMU 74/77 only), and `ColourWorkBadge`/`isColourWorkBadged` in `card-atoms.tsx`. The 🎨 emoji keyed on `orderType` is gone. Draft `code-update-2026-09-18-picking-colour-work.md`: **shipped** (all five commits are on main, including the 4771de51 session record).
- [M] **Duplicate-SO flag** (4f21b7da, 57cd274d, 2c54bdfb). Code: `lib/picking/duplicate-so.ts`, `PickingQueueRow.hasDuplicateSo`, solid-red card/header treatment and `components/shared/duplicate-so-tag.tsx`. Canon: only in `CLAUDE_UI.md` (§59.8 note, :1584), nothing in PICKING.
- [M] **SAP-name fallback** (47791643, then 67393fd2 removed the "not in master" marker, 2026-08-31). Code: `queue.ts:826-859`, where dealerName = override → customer → `shipToCustomerName` → "(Unmatched)". `dealerInMaster` stays on the row and is read by search (`lib/picking/search.ts:110`, where "unmatched" is searchable). Draft `code-update-2026-08-31-picking-sap-name-fallback.md` is unmerged into canon.
- [M] **Bay on the open bill** (f7c8d232, 7c310235, 99c218a8). `route_master.bayNumber` → `PickingQueueRow.bayNumber` via `area.primaryRoute`, never `primaryRouteId`. Rendered in `components/picking/bill-band.tsx` (a white band with amber `#d97706`) on both detail screens. `bay-circle.tsx` was deleted. `bayNumber` appears in NO canon file, and CORE does not have the column either.
- [M] **Hardener rows** (6d61ce79, 223fa723, caa2a06b). `lib/picking/hardener-skus.ts` holds a code-only SAP-code list. `PickingDetailLine.hardener` is a picker sub-row and a supervisor sub-row that gates Approve. The supervisor's hardener ticks are ephemeral (`hardenerCheckedIds`).
- [M] **WhatsApp share of confirmed findings** (fa0bac6c, ea7b117d "SHORT DISPATCH, monospace block"). `lib/picking/share-findings-text.ts` (416 lines, pure) plus a supervisor Done-detail share button that uses the OS share sheet with nothing stored. It should be in §11.
- [M] **Detail line grouping by product family** (c85c739d). `lib/picking/family-groups.ts` holds the single COALESCE(displayCategory, category) rule, shared with the card family chips.
- [M] **Search predicate** (663c538f). `lib/picking/search.ts` has one predicate across four call sites that matches picker, route and area. **Route sheet** lists only present routes; `matchesType()` (f7c8d232).
- [M] **Assign sheet picker counts** (ffbe85e2). `/api/warehouse/pickers` now counts OPEN bills (`workflowStage: PICK_ASSIGNED`, `app/api/warehouse/pickers/route.ts:75`) instead of the status filter, and the roster is refetched on every sheet open. §7's two-dropdown note should cite this.
- [L] **Marker duplicate-rebuild fix** (32e66a9b): `resync()` after every action (see §10 STALE above). **Queue lookups batched** (57d40553).
- [L] §8 key-files index is missing: `bill-band.tsx`, `bill-symbols.tsx`, `cancel-sheet.tsx`, `lib/picking/{cancel-reasons, colour-work, colour-work-query, duplicate-so, family-groups, grouping, group-lines, hardener-skus, release-window, search, share-findings-text, tint-workload, visibility-gate}.ts`, `app/api/picking/{cancel, tint-workload, tint-workload/marker}`, and `app/api/picking/push-test/route.ts`. The findings/combined routes are already listed.
- [L] Discovery `code-discovery-2026-08-21-picking-board-v2.md` (the board v2: route sheet, route-not-area, bay, Picking-tab three levels, picker counts) shipped as f7c8d232 → 99c218a8 (2026-08-21/22). None of it reached canon, even though PICKING v1.16/v1.17 were written afterwards (2026-09-03/04).

###### GONE
- [§8 lib/workflow-stages row / §2] Nothing substantive. `supportMayEdit()` still has zero external callers, as canon says.
- `bay-circle.tsx` was never canon, so nothing to remove. `orders.pickVisibleAt` as a live read is gone, but canon never documented it.
- Retired DetailListKey strings: canon §5.3 lists `waiting | needsCheck | stillPicking | checked` as bare strings. The shape is gone (now an object union). Already covered under STALE.

###### Stale code comments spotted (claims about data)
- `lib/picking/queue.ts` ~:456: "CLAUDE_SUPPORT.md §3 (parking-stage flip)". That file was retired with Support.
- `components/picking/picking-board-mobile.tsx` ~:209: "Fixed locale — same rationale as picking-queue.tsx (the desktop sibling)". The file is archived.
- `components/picking/picking-mobile-shell.tsx:227-231`: "Admin-only, mobile-only link". The gate is `app/picking/page.tsx:73` `roles.includes("admin") || roles.includes("operations")`. It also says "Gray, NOT teal (one-teal rule)", which predates the rebrand.
- `lib/workflow-stages.ts`: "The stage the (not-yet-built) Assigned button will write" and "(not-yet-built) supervisor Approve action". Both are built.
- Conflicting `dispatched` counts in comments: `lib/workflow-stages.ts` DISPATCHED doc says "4,137 ROWS ARE ALREADY AT IT", and `lib/floor/dispatch.ts:6` says "The stage has been reached 7,067 times … 244 times". Both are claims. Neither was verified here.
- `lib/floor/dispatch.ts:17-18` says "One caller today (POST /api/floor/trips/[id]/dispatch)", while that route says "NO CALLER SINCE SLICE 7".
- `public/sw.js:9`: "silently break live sync on all three picking surfaces". There are two picking surfaces now, and many other consumers of the same hook.

###### Confidence notes / could not verify without login or DB
- The live value of `app_settings['picking.visibilityGate']` was not checked (no DB), so whether the gate is ON in production is unknown. The code default is OFF.
- `ACCESS_SOURCE=user` is taken from CORE's own 2026-09-04 SELECT note, not re-queried.
- I did not trace whether `pick_findings` on a MERGED detail row (multiple `lineIds`) attaches to the first line or to all of them. The rawLineItemId-unique model in §11.6 may need a note. Check `group-lines.ts` / `order/[orderId]/route.ts`.
- The Tinting section's exact scope rules (which tint stages, which operators) were not read in depth. They are in `lib/picking/tint-workload.ts`.

---

##### docs/CLAUDE_NOTIFICATIONS.md — header v1.3 / footer v1.3 / last commit a2523d16 2026-08-12
Header vs footer match: **yes**. Both say v1.3 · Schema v27.13 · updated 2026-08-12.

Quiet hours: canon correctly says they were REMOVED. `lib/push/quiet-hours.ts` is gone, `grep isWithinDepotHours|DEPOT_HOURS|quiet-hours` over app/lib/components returns nothing, and both routes carry "There is NO time-of-day gate" comments (assign :174-176, done :159-161). The deleted file is cited only historically: NOTIF §2 :55-56, §8 landmine 4 and the change log. No other canon file cites it. VAPID env names and the default subject match `lib/push/send.ts:34-37`. Recipients (`lib/push/recipients.ts`) match §10 exactly. sw.js is still push + notificationclick only, with no fetch handler and no caches.

###### STALE
- [H] [§1, §2] "**Two** [triggers], both fired from the existing picking write routes" and "**Caller sweep 2026-08-04: `sendToUser` has exactly three callers** … Nothing else pushes". CODE: `app/api/picking/cancel/route.ts:266` `await sendToUser(heldByPickerId, { title: "Bill cancelled", body: \`${dealerName} · ${order.obdNumber} — stop picking this bill\`, tag: \`pick-cancelled-${order.id}\`, … })` (00d7da22 / af075572, 2026-08-20). There are now **three triggers and four callers**. The cancel trigger notifies the picker who was holding the bill, skips self-cancel (`heldByPickerId !== changedById`), is fully swallowed and awaited, and adds no `orders` write, so it follows landmines 2 and 5. Floor's own cancel (`/api/floor/actions`) does NOT push; only the picking route does.
- [M] [§2 bullet] "**Customer** = the effective dealer (`shipToOverrideCustomer ?? customer`, `.customerName`)". CODE: `app/api/picking/assign/route.ts:196-200` `o.shipToOverrideCustomer?.customerName ?? o.customer?.customerName ?? o.shipToCustomerName ?? "(Unmatched)"`. The same code is in done/route.ts and cancel/route.ts (the SAP-name fallback, 2026-08-31). Push bodies deliberately carry no "not in master" marker.
- [M] [§8 landmine 8] "`manifest.json` `name` is `"Orbit"` with `short_name` still `"OrbitOMS"` … unfinished experiment … notifications still display 'from OrbitOMS'". CODE: `public/manifest.json:3` `"short_name": "Orbit",` (4a2f763f "pwa: match manifest short_name to name (Orbit)", 2026-08-12). The same landmine says "Do NOT change … theme", but `theme_color` is now `#7C3AED` (740a9a21, rebrand 2026-09-09).
- [L] [§9] "'Push test (temporary)' link … its own comment says **admin-only**". CODE: `app/picking/page.tsx:73` `const canSeePushTest = roles.includes("admin") || roles.includes("operations");`. Operations sees it too. The comment in `picking-mobile-shell.tsx:228` is stale; canon repeated it. The "~:165" line cite is now ~:227-241.
- [L] [§8 landmine 6] "`getPickingQueue()` … returns `{ date, rows }`". See the PICKING STALE above: the payload now also carries `waitingSkus`, `oilSkus`, `heldBack` and `heldBackTrucks`. A future "waiting to assign" timer would also have to decide whether to count gate-hidden bills (`heldBack`). The tombstone rule in `queue.ts:208-219` predates the gate.
- [L] [§8 landmine 1] "`use-picking-marker.ts` polls `/api/picking/marker` every 15s". Still true, but the hook now also polls other URLs (floor, billing, ci, mrn, tint, mail-orders, tint-workload markers), which makes the no-caching rule broader than stated.

###### MISSING
- [M] **`urgency: "high"` on every send** (1448c7e6, 2026-08-14). CODE: `lib/push/send.ts:81-87` `{ urgency: "high" }` as the options argument to `sendNotification`, "the standard lever against the aggressive battery management on Indian budget Androids". Not in §4, §5 or §8 landmine 9, and not in any canon file (the `urgency` grep hits in PICKING/UI/ROADMAP are unrelated).
- [M] **`app/api/picking/push-test/route.ts`**, the throwaway proof endpoint that calls `web-push` `sendNotification` DIRECTLY (not `sendToUser`) against a body-supplied subscription, gated on picking canView. Called by `app/picking/push-test/push-test-client.tsx:155`. It is absent from §9 (temporary scaffolding) and §10 (key files), and it is a fifth push-sending path that the §2 caller sweep does not see because it greps only `sendToUser`. It predates the baseline (7f041c95, 2026-07-22) but was never documented.
- [L] **Cancel trigger row** for the §2 table: "Bill cancelled" / `{dealer} · {obdNumber} — stop picking this bill` / recipient = held-by picker / not verified on a device.

###### GONE
- None. `lib/push/quiet-hours.ts` and its constants are gone, and canon already says so correctly.

###### Stale code comments spotted
- `components/picking/picking-mobile-shell.tsx:228`: "Admin-only" (the code allows admin OR operations).
- `public/sw.js:9`: "all three picking surfaces" (there are two now).

###### Confidence notes
- Whether the "New pick assigned" and "Bill cancelled" pushes have been verified on a device is unrecorded in code. §6's "NOT yet verified" presumably still applies to both.
- The VAPID env values and Vercel config were not checked (no access). Only the names in code were.


<!-- source: sweep worker out-mail-orders.md -->

##### docs/CLAUDE_MAIL_ORDERS.md — header v1.13 / footer v1.13 / last commit 158f64b2 2026-08-30 22:47 IST

Header-vs-footer match: **yes** (both "v1.13 · Schema v27.15 · Parser v7.3.0 … updated 2026-09-01").
⚠ Date oddity: the text says "updated 2026-09-01" and "FIXED 2026-09-01" (§18, §22), but the only commit carrying it is 158f64b2, author AND committer date 2026-08-30 22:47 +0530. The code fix it describes (0f56eede) is also 2026-08-30 22:44. The doc is forward-dated by two days. No later commit touches the file, so everything shipped from 2026-08-31 onward is unreconciled here.

###### STALE
- [H] [header, line 6, §23 title, §23 "PILOT SCOPE"] "Billing v2 [PILOT — flag-gated]" / "`billing_settings.rolloutStage = 'TEST_USERS_ONLY'`; exactly ONE flagged user — Operations User (id 20)". Same claim in the router CLAUDE.md §3 row: "PILOT, flag-gated (operations id 20 only until rollout)". CODE: `lib/billing/flag.ts:86` `if (stage === "ALL_USERS") return true;`. The per-user flag is only read on TEST_USERS_ONLY. EVIDENCE the stage is ALL_USERS (DB, not code, so I did not re-run it): commit c103d5f4 (2026-08-10) message says "live value is ALL_USERS since 2026-08-06 … CLAUDE_MAIL_ORDERS 23 still says TEST_USERS_ONLY and is stale". `docs/prompts/drafts/code-discovery-2026-09-11-billing-shell-picking-key.md §0.2` has a read-only SELECT dated 2026-09-11 returning `1 | GLOBAL | ALL_USERS`. It also records ~1,090 bills marked done in 14 days by Deepanshu, Bankim, Prakash and Chandresh, and zero by id 20. Billing is fully rolled out, not a pilot. The router row and §23 both need correcting.
- [H] [§23.4] "routes `/api/billing/picking/list` + `/marker` gated on `mail_orders/canView`". CODE: `app/api/billing/picking/list/route.ts:92` `checkAnyPermission(roles, "billing_picking", "canView")`; `marker/route.ts:70` same. Mark done and Undo gate on `billing_picking` canEdit (`mark-done/route.ts:69`, `undo/route.ts:55`). Repointed by 9bc027a9 (2026-09-11).
- [H] [§23.4.1] "🔴 GATED ON `mail_orders`/canView — NOT `floor`/canView, and that is the whole reason this route exists". CODE: `app/api/billing/picking/order/[orderId]/route.ts:64` `checkAnyPermission(roles, "billing_picking", "canView")`. The point that it avoids `floor` still holds, but the key named is wrong.
- [H] [§23.4.1(b)] "The read-only detail panel … No ship-to, slot, reassign or edit controls: a close button, a backdrop and Esc." and "The checkbox cell stops the row click — ticking leads to a write". CODE: `components/billing/billing-order-detail-panel.tsx:7` "carries the ONE action that follows from the answer: Mark done"; `:64` `const MARK_DONE_URL = "/api/billing/picking/mark-done"`. Commit 93291cbc (2026-08-20): a bill with a confirmed finding has NO checkbox on the list, and the panel's Mark done is the only way to mark it done.
- [H] [§22] "Access to `/mail-orders` is **entirely DB-driven** via `role_permissions`". Also the grants table "[LIVE — re-verified by SELECT 2026-09-01 …]". CODE: `lib/permissions.ts:806-811` (checkAnyPermission): in user mode it returns `(await userPagePerms(userId, pageKey))[action]`, which reads `user_page_access`. The switch is `lib/access/source.ts:50` `getAccessSource()`. CORE §5 (line 145) records "Live value: `user`" (2026-09-04). The role_permissions table in §22 is now only the fallback and baseline, not the authority.
- [M] [§22] "`admin` bypasses the permission table entirely (hard-coded bypass in `lib/permissions.ts`)". CODE: `lib/permissions.ts:799` `if (access.isSuperuser) return true;   // flag arm`, after the `roleSlugs.includes("admin")` role arm. The bypass is now "flag OR role" (users.isSuperuser, v27.23).
- [H] [§21] "Admin 'Settings → Hide → Tags' can switch any Mail Order badge off **app-wide**" and "the 16-entry catalog". CODE: `lib/hide/tag-settings.ts:83-85`: `arms = [{ scope: "everyone" }]`, plus `{ scope: "role", roleSlug: { in: roleSlugs } }` and `{ scope: "user", userId }`. The resolution rule is "user row wins, then role, then everyone" (`:54`). `lib/hide/tag-catalog.ts` now has **22** `tagKey: MO_TAG.*` entries. abd495f4 (2026-09-11) added `keyCustomer`, `matchChip`, `punchedBy` and the "Violet band (Billing)" group `notesBand`/`deliveryLine`/`billLine`. Schema: `app_tag_settings.scope/roleSlug/userId`, and tagKey is no longer UNIQUE (schemadiff). The "who sees it" picker is fed by `app/api/admin/tag-audience/route.ts`.
- [H] [§13] "Auto-detect when all orders in slot are punched. Also auto-trigger 15min after slot cutoff … Modal … Per-SO 'Send'". The "Known gap" note about `slotDefs` is also dead. CODE: `app/(mail-orders)/mail-orders/mail-orders-page.tsx:390-412` "Slot summary email — FULLY REMOVED FROM THIS PAGE … the `E` shortcut, the <SlotCompletionModal> render …" (c103d5f4, 2026-08-10). See GONE.
- [M] [§10] "E | Open Slot Email modal". CODE: no `E` handler remains (the key handlers at `mail-orders-page.tsx:1111-1197` cover R/F/?/ / /N/P/T only). BUT `mail-orders-page.tsx:99` `{ key: "E", label: "Slot email" }` is still in `MO_SHORTCUTS`, which the Billing ⌨ row renders (`:1290`). The help panel advertises a dead key. This is a UI bug, not just drift.
- [M] [§9.1] "Auto-refresh: 30s polling + `visibilitychange`." CODE: `mail-orders-page.tsx:368-370` `url: "/api/mail-orders/marker", pollMs: MAIL_ORDERS_MARKER_POLL_MS`. This is a marker-gated refresh: the full list is fetched only when {count, latest} moves (0cbe73ef, 2026-08-10). Billing's tabs use one shared marker poll at 30s (`components/billing/billing-marker-provider.tsx:47`, abcf9fdd), plus a second poll for Print (`:175`).
- [M] [§9.1] "Cutoffs are DB-configurable in `system_config` … `parseHHMM()`". CODE: c103d5f4 dropped `fetchSlotCutoffs()` from the page. Per its message, `slotCutoffs` "is now never populated, so they fall back to getSlotFromTime's hardcoded 630/750/1020/1200". An admin cutoff edit no longer reaches this page. (Note: 00cfac02 had added a 5-minute cache to `app/api/system-config/slot-cutoffs/route.ts` two days earlier. That route now has 0 callers.)
- [M] [§9 / §9.1 / §23.2] "Table code fully intact for non-billing users" and the whole Table view and 5-slot bucketing are described as a live face. CODE: `lib/billing/flag.ts:86`. With the stage at ALL_USERS (see the first bullet), `billingV2` is true for everyone who passes the layout, so the Table/Focus toggle and the slot sections cannot be reached. c103d5f4's message says "Unreachable while rolloutStage is ALL_USERS". The code is still there but dormant.
- [M] [§23.4] Info arm "`pick_checked` + `invoiceNo IS NOT NULL` + `checkedAt` in that IST day". CODE: `lib/billing/picking-where.ts:149` `workflowStage: { in: [BILLING_PENDING_STAGE, DISPATCHED] }` (551069aa, 2026-09-11). Only the info arm was widened. The pending arm stays `:69` `workflowStage: BILLING_PENDING_STAGE`.
- [M] [§23.2] Ribbon "`Urgent · Hold · Slot · Notes │ [Order No + Punch]`". CODE: a Copy button was re-added next to Notes (44813cf9/63a323db, `review-view.tsx:4` imports `Copy`). Hold, Slot, Urgent and ✎ are now HIDDEN per user by the action ticks (`app/(mail-orders)/mail-orders/layout.tsx:96-99`, `components/billing/billing-action-ribbon.tsx:102` "Hidden, never disabled").
- [M] [§23.3] The actions route is described as gated only by the `mail_orders` pattern. §18 cites "`app/api/billing/mail-order/actions/route.ts:66-77`" as the model block. CODE: `actions/route.ts:73` `checkAnyPermission(roles, "mail_orders", "canEdit")` AND `:136` `checkAnyPermission(roles, ACTION_KEY[action], "canEdit")`, with `ACTION_KEY` = billing_hold/slot/urgent/ship_to (`:123-126`). Both must pass (a991a1c4, 2026-09-12). The line citation 66-77 has also drifted (now 71-75).
- [M] [§23.5] Deferred list: "widen rollout `TEST_USERS_ONLY → ALL_USERS`" was done 2026-08-06 (per c103d5f4, DB). "global rename Mail Orders → Billing" is partly done: `lib/permissions.ts:65` `{ pageKey: "mail_orders", label: "Billing", href: "/mail-orders" }` (bf218da8, 2026-08-06). The route and page key are unchanged.
- [L] [§6 last para / §23.2 Option-(a) caveat] "non-billing users still see a blank ship-to name for pencil-set overrides until rollout". Moot now that the stage is ALL_USERS: no user is on the non-billing face.
- [L] [§9.5] ShipToCard override = "3px amber left bar … amber ⚑ captured pill". CODE: `components/mail-orders/ship-to-card.tsx:111` on the billing call site is `bg-brand-50 … before:bg-brand-600`. This is the violet/brand tone (2916b5f8, rebrand 9b1654cc). Amber (`:112`) survives only on the dormant non-billing path.
- [L] [§2] The `mo_orders` column list has no `updatedAt`. CODE: `prisma/schema.prisma` model mo_orders `updatedAt DateTime @default(now())` (new since baseline, schemadiff). It is DB-trigger-stamped (`trg_mo_orders_updated_at`, per `app/api/mail-orders/marker/route.ts` header) and is what the new marker keys on.
- [L] [§8] The file list is missing live files: `line-status-panel.tsx`, `tutorial-overlay.tsx`, `components/mail-orders/notes-font-size-provider.tsx`, `lib/mail-orders/notes-font-size.ts`, `app/api/mail-orders/marker/route.ts`. It lists `slot-completion-modal.tsx` as live, but it is orphaned. Orphans not flagged: `components/mail-orders/so-email-panel.tsx`, `lib/mail-orders/enrich-v2.ts` (0 importers; CORE:1404 notes it), `lib/mail-orders/taxonomy-mapping.ts` (0 importers).
- [L] [§7] The API table is missing `PATCH /api/mail-orders/[id]/note` (canEdit), `GET /api/mail-orders/marker` (canView, `marker/route.ts:87`), `POST /api/mail-orders/backfill-customers` (canEdit) and `backfill-enrich` (GET admin / POST HMAC). §18 names some of these, but the endpoint table does not.

###### MISSING
- [H] Billing **Print tab** (slice 9, 22ced2d8 + 6d008f8e, a5e1b758, a3b4cdfe; 2026-09-15). Page key `billing_print` (`lib/permissions.ts:276`). Routes `GET /api/billing/print/list` (`:39` canView), `GET /api/billing/print/marker` (`:30` canView), `POST /api/billing/print/trip/[id]/copy` (`:34` canEdit). Also `components/billing/billing-print-tab.tsx`, `billing-print-access-provider.tsx`, `lib/billing/print.ts`, the third pill in `billing-tab-bar.tsx:184`, the `trips.billingCopiedAt` column and the `invoices_copied` trip_activity row. It is fed by Floor's "Send to billing" (`app/api/floor/trips/[id]/billing/route.ts`). Seed has `billing_print` rows (`prisma/seed.ts:194-199`). Grep of all `docs/CLAUDE_*.md` for "Print tab" / "billing/print" / "sentToBilling" returns nothing, so this is in NO canon file.
- [H] **Per-button billing action ticks are enforced.** a991a1c4 (after c73ee93b's "no gate yet"): server `actions/route.ts:136`; layout `layout.tsx:96-99`; `components/billing/billing-actions-access-provider.tsx`; ribbon hides the buttons. Not in MAIL_ORDERS. CORE:252 mentions the keys but says "⚠ Nothing reads them yet". That is stale in CORE too.
- [H] **`billing_picking` page key gates the Picking tab** (38b545df register, 9bc027a9 gate). Layout `:70-72`, `billing-picking-access-provider.tsx`. CORE:252 documents it; MAIL_ORDERS §23.4 does not (see STALE).
- [M] **Per-user Notes font size.** `users.notesFontSize` Int default 11, CHECK 11-20 (`schema.prisma:153,164`). `POST /api/user/notes-font-size` (called from `mail-orders-page.tsx:643`). `lib/mail-orders/notes-font-size.ts` (MIN 11 / MAX 20, read fresh in layout, fails soft to 11; P2022-tolerant). Legacy localStorage key `mo-review-notes-font-size` (`review-view.tsx:253`). Commits 2f642c9c→6409f07c→2916b5f8. No canon anywhere (grep "notesFontSize" in docs/CLAUDE_*.md = 0).
- [M] **Mail-orders marker** `GET /api/mail-orders/marker` (0cbe73ef): count + MAX(mo_orders.updatedAt) for the IST day, plus MAX(app_tag_settings.updatedAt). The route header documents its accepted blind spots (mo_line_status, isKeyCustomer, mo_customer_keywords, alt-SKU).
- [M] **Key-dealer ★** on the inbox row and the "Key" pill on BillToCard, from `delivery_point_master.isKeyCustomer` (`app/api/mail-orders/route.ts:225-260`; `review-view.tsx:1166,2219`). It is tag-switchable (`MO_TAG.keyCustomer`). Not in MAIL_ORDERS.
- [M] **Filter chips follow the tag switches** (f1dcfa58, 2026-09-16, `mail-orders-page.tsx`) and **Orders keyboard shortcuts act only on the Orders tab** (5ec6d65c, 2026-09-15).
- [L] **Truck icon** next to the dealer name for Truck Order bills (aded19ed; `review-view.tsx:196-197,1126,1167`).
- [L] **5-minute in-process cache** for the alt-SKU combo maps (00cfac02; `app/api/mail-orders/route.ts:34-88`, `COMBO_CACHE_TTL_MS = 5*60*1000` at `:58`). It is per warm instance. §7/§9.2 still describe alt-SKU as a per-request build.
- [L] **Audit logging on mail-order writes** (c3cf726b): `entity: "mail_orders"` audit calls in customer/lock/note/split/resolve/re-enrich/backfill-customers routes. CORE §7.13 owns the table; MAIL_ORDERS has no pointer.
- [L] `mo_orders.updatedAt` + trigger (see STALE §2).

###### GONE
- Slot-completion modal, the auto-trigger, the `E` shortcut, `mo-slot-email-sent-*` writes and the `slotDefs` known gap (§8, §10, §13, and the §14 builder's live use). Proof: `grep -rln "SlotCompletionModal\|slot-completion-modal" app components` finds only comments in `mail-orders-page.tsx` and the orphan file itself. `buildSlotSummaryHTML` is called only from `slot-completion-modal.tsx:95` and `components/mail-orders/so-email-panel.tsx:116`, and both files have 0 importers. §14 (email-template.ts) now describes orphaned code, kept on disk per CORE §3.
- `fetchSlotCutoffs()` / `GET /api/system-config/slot-cutoffs`: 0 callers per c103d5f4 (orphaned, not deleted).

###### Stale code comments spotted (claims about data)
- `lib/permissions.ts:258` "⚠ REGISTERED ONLY — NOTHING READS IT YET. The tab still gates on `mail_orders`…". False: the 5 picking routes and the layout read `billing_picking` (9bc027a9).
- `lib/permissions.ts:284-287` "⚠ Nothing reads these yet. All four buttons still gate on `mail_orders` canEdit". False: `actions/route.ts:136`, `layout.tsx:96-99`.
- `lib/permissions.ts:412-416` ("not yet backed by a check … Mark done (api/billing/picking/mark-done:58) … gate on … `mail_orders`") and `:429-431` ("THE CHECKS THESE ANTICIPATE DO NOT EXIST YET"). Both false now.
- `lib/billing/flag.ts:19-21` "TEST_USERS_ONLY — … The seeded default, and DARK on arrival (0 users opted in), so the pilot is a single per-user flip on `operations` (id 20)". This is history, not the current state (live is ALL_USERS per the evidence above).
- `mail-orders-page.tsx:99` `{ key: "E", label: "Slot email" }`: a UI string claiming a shortcut that no longer exists.
- CORE:252 (not my file) repeats "Nothing reads them yet" for the four action ticks. CORE §7.10 (line ~941) still says `app_tag_settings … tagKey TEXT UNIQUE`, but the schema dropped `@unique` and added scope/roleSlug/userId.

###### Confidence notes / things I could not verify without a login or DB
- The rollout stage (ALL_USERS) is DB state. The code only proves the switch exists. My evidence is two independent recorded observations: the c103d5f4 commit message (2026-08-10) and the 2026-09-11 discovery draft's SELECT. I did not query the DB (brief rule). The per-user flag on id 20 is reported as still set, but it is dead weight under ALL_USERS.
- ACCESS_SOURCE = `user` is taken from CORE §5 (SELECT 2026-09-04), not re-verified.
- Parser: repo copy header `docs/Parser/Parse-MailOrders-V7.ps1:8` `Version: 7.3.0`, and `:136` `$ScriptVersion = "6.5.0"` is still stale. This matches the canon exactly. The last parser commit is 319055fd (2026-07-15). The deployed version is still unverifiable.
- Holds (verified, not stale): the 11 write routes gate on `mail_orders/canEdit`; the read routes (`route.ts` GET, original-lines, skus, customers/search, debug-enrich) are session-only; backfill-enrich GET uses `requireRole(ADMIN)`; middleware bypasses at `middleware.ts:60,65`; §23.3 dual-write, soNumber guard, slot clear → `dispatchSlotSource:null` and heldAt-not-written (`actions/route.ts:179,249,260,284-292`); ship-to-search and dispatch-windows still gate on `mail_orders/canView`; `billing-order-info.tsx` is still orphaned (review-view mentions it only in comments); the seed still has zero `mail_orders` rows (only `billing_picking` / `billing_print`); §9.3 signal→card routing matches `lib/mail-orders/utils.ts:736-787`.
- Urgent red migration (code-discovery-2026-09-08 + rebrand b585240f/9b1654cc): colour changes landed in mail-orders-table, review-view, instructions-strip and ship-to-card. The tag catalog still describes Urgent as "Amber badge" (`tag-catalog.ts:65`). Colour spec is CLAUDE_UI territory; I did not audit individual hexes.
- Duplicate-SO highlight (`hasDuplicateSo`) is Floor/Picking only. There is no mail-orders or billing surface (grep of `app/(mail-orders)`, `components/billing`, `lib/billing` returns nothing), so it is not owed here.


<!-- source: sweep worker out-po-attendance.md -->

### Canon drift sweep: CLAUDE_PLACE_ORDER.md + CLAUDE_ATTENDANCE.md (2026-09-18, read-only)

##### docs/CLAUDE_PLACE_ORDER.md — header v1.8 / footer v1.8 / last commit 7d8ceece 2026-08-05
Header-vs-footer match: yes ("v1.8 · Schema v27.13 · August 2026 · updated 2026-08-04" / "*Place Order v1.8 · Schema v27.13 · OrbitOMS · updated 2026-08-04*").

**Route facts established from code (what the canon should describe):**
| Address | What it is now | Evidence |
|---|---|---|
| `/place-order` | Desktop, session-gated (`place_order` PageKey canView) | `app/(place-order)/layout.tsx:34` |
| `/po` | **Still live**, unchanged v1 mobile page (single-file `po-page.tsx` + `splash-screen.tsx`), public | `app/po/page.tsx:40-42` |
| `/po2` | **Live since 2026-09-10** (145b5f32): v2 salesman order page, 14 files in `app/po2/`, ~15.7k lines, public, no session | `app/po2/page.tsx:4` "LIVE at /po2 since 2026-09-10" |
| `/po9` | **Live since 2026-09-15** (23804504): mounts `/po2`'s component with `shipToEnabled={false}` — a mount, not a fork; own manifest id `/po9`; shares every `po2_*` localStorage key with `/po2` | `app/po9/page.tsx:47` `return <PoV2Page shipToEnabled={false} />;` |
| `/po-v2-8f4kd2` | Server-side redirect stub → `/po2`. "Old address redirected" means **this page.tsx `redirect()`**, not next.config | `app/po-v2-8f4kd2/page.tsx:31-33` `redirect("/po2");` |
| `/po2/manifest.webmanifest`, `/po9/manifest.webmanifest` | GET route handlers, one builder `app/po2/v2-manifest.ts` `v2Manifest(mount,"Orbit")`, id/start_url/scope = mount, served `application/manifest+json` | `app/po2/manifest.webmanifest/route.ts:54-56`, `app/po9/manifest.webmanifest/route.ts:16-18` |
| Public paths | `middleware.ts:26` `"/po"` + `:36` `startsWith` prefix match ⇒ `/po`, `/po2`, `/po9`, `/po-v2-8f4kd2` all public; manifest URLs never reach middleware (dot rule, `:90`). `/order` entry (`:24`) kept (survivor) and also keeps `/orders` public | `middleware.ts:24-36,90` |

###### STALE
- [H] [header "Routes:" block + §1 + §15 + §25] "**`/po`** — **going-forward** depot mobile PO page" / §25 "`/po` — going-forward depot mobile PO" — CODE: `app/po2/page.tsx:4` `// The v2 salesman order page. LIVE at /po2 since 2026-09-10.` — The route list names only `/place-order`, `/po` and the retired `/order`. `/po2`, `/po9` and the `/po-v2-8f4kd2` redirect are not mentioned anywhere in this file. Per ROADMAP.md:1526-1531, `/po2` is the successor and `/po` stays live only until a planned retirement.
- [H] [§25] "**Eventual cutover: rename `/po` → `/order` — now UNBLOCKED.** … the address was deliberately **parked for exactly this rename**." — CODE: `app/po-v2-8f4kd2/page.tsx:32` `redirect("/po2");` together with `app/po2/page.tsx:4`. The successor is now `/po2`. ROADMAP.md:1551 has "P2 — Retire `/po`, per the playbook", with `/po2` as the parity target. This file still states the rename plan as the live direction, which is stale.
- [H] [§22] "**TWO order pages — change both relevant ones.** `/po` … and `/place-order` … a pack/render change must be repeated on every live surface." — CODE: `app/po2/v2-data.ts:1732` `export function sortedPacks(packs: ApiPack[])` (its own pack pipeline) + `app/po9/page.tsx:47`. There are now **three codebases** (`app/po`, `app/po2` which also serves `/po9`, and `(place-order)`), and `/po2` keeps its own pack rows and sorting. A change made to the "two" pages misses v2.
- [H] [§16 + §20] "| POST | `/api/place-order/last-order` | Returns last order normalised to units for given customerCode |" and "`POST /api/place-order/last-order?customerCode=...`" — CODE: `app/api/place-order/last-order/[customerCode]/route.ts:41` `export async function GET(` (dynamic segment; caller `last-order-recall.tsx:154` `` `/api/place-order/last-order/${encodeURIComponent(customerCode)}` ``). Both the method and the URL shape are wrong. The route also applies a 30-day cutoff (`THIRTY_DAYS_MS`, :50) that the doc doesn't mention. routetable marks it UNDOCUMENTED.
- [M] [§11] "Send opens `mailto:{recipient}?subject=...&body=...` … No POST, no DB row." / "Recipient … → **`surat.depot@akzonobel.com`**" — CODE: `lib/place-order/email.ts:66` `export const ORDER_CC = "surat.order@outlook.com";` and `:284-285` `` `mailto:${ORDER_TO}` + `?cc=${encodeURIComponent(ORDER_CC)}` ``. Desktop `/place-order` **CCs the parser inbox**, while `/po` and `/po2` do not (`app/po2/v2-email.ts:103-109`). The CC has shipped since 8b21d566 (2026-06-19) and is not in any canon file (grep `ORDER_CC|cc=` docs/*.md = 0).
- [M] [§11] "**TWO builders, ONE name source.** `lib/place-order/email.ts` (desktop) and `app/po/po-page.tsx` (inline)" / "`renderOrderBody` is the single builder for both surfaces" — CODE: `app/po2/v2-email.ts:12-15` `import { ORDER_TO, buildSubject, emailLineLabel, renderOrderBody, … } from "@/lib/place-order/email";`. `/po2` and `/po9` are a third caller.
- [M] [§11 / §25] (implied byte-parity between surfaces) — CODE: `app/po2/v2-data.ts:1732-1735` `sortedPacks` → `sortPacks(...)` against `app/po/po-page.tsx:101-106` `sortPackEntries` (packToMl → KG packs compare 0 vs 0). Since 4e8ca379, `/po2` emails KG packs ascending (`5KG*1, 10KG*2`), while `/po` and `/place-order` still use DB insertion order. The wires differ for 6 KG products (Acrylic Distemper, Magik ×2, Duwel, VT Concrete Finish, Acrylic Putty). The canon doesn't know about this.
- [M] [§16] "`/api/order/data` … **serves `/po`** (`app/po/po-page.tsx`…)" — CODE: `app/po2/po-v2-page.tsx:557` `const res = await fetch("/api/order/data", { cache: "no-store" });`. The route also serves `/po2` and `/po9`. It is unauthenticated and returns every `mo_customer_keywords` name/code/area (ROADMAP P0, :1540). The canon doesn't flag that exposure.
- [M] [§3] The roles/permissions table has no entry for the new **PageKey** `place_order_ship_to` — CODE: `lib/permissions.ts:249` `| "place_order_ship_to"`, `app/(place-order)/layout.tsx:47` `const canShipTo = allPerms["place_order_ship_to"]?.canEdit ?? false;`. §11/§25 say desktop options include "a Ship To line (omitted when 'same as billing')". Since 650f4b1e (2026-09-17), desktop Ship To is **hidden and forced to ""** in the email and on draft restore unless the user holds canEdit on this key. No grants exist, so only admin/superuser see it. The key isn't in CORE or any other canon file either.
- [L] [§17 files map] "`speed-dial.tsx` · `send-button.tsx` · `variant-grid.tsx` … (directly under `app/(place-order)/place-order/`)" and `lib/place-order/constants.ts`, `cart.ts`, `draft.ts`, `search.ts` — CODE: `ls app/(place-order)/place-order/` puts the components under `components/` (`speed-dial-grid.tsx`, `speed-dial-tile.tsx`, no send-button). `lib/place-order/` has no constants/cart/draft/search.ts, and git shows no delete of any of them, so these names were never real. Unlisted real files: `saved-drafts.ts`, `sent-orders.ts`, `monogram.ts`, `use-keyboard-routing.ts`, `fav-customers.ts`, `components/place-order/place-order-access-provider.tsx`, `app/po/splash-screen.tsx`, the whole `app/po2/`, `app/po9/`, `app/po-v2-8f4kd2/`.
- [L] [§21] "old v1 key (`orbitoms_place_order_draft`) read, ignored, removed" — CODE: `lib/place-order/draft-storage.ts:22` `window.localStorage.removeItem("orbitoms_place_order_draft_v1");` — the key name is wrong, and the code never reads it (remove only).
- [L] [§9 / §2 / §16 / §22] line refs drifted: "`pack.ts:108-123`" → PACK_STEP_MAP is now `pack.ts:111-126`. "`PRODUCT_CARTON_OVERRIDES` (`pack.ts:139-141`)" → `:158`. "`route.ts:92-93`" isPrimary → `app/api/place-order/data/route.ts:97-98`. The values themselves are all still correct.

###### MISSING
- [H] **The `/po2` module as a whole**: 97 commits (bbcc73fa 2026-09-06 hidden shell → 145b5f32 launch → 23804504 /po9). It is covered only by ROADMAP.md:1524-1670, three drafts, and styling cross-refs in CLAUDE_UI.md:23/100/1516/1550. Undocumented facts: a board-first landing (tiles, "the dealer is a field on the way out", seven screens on one URL, `po-v2-page.tsx:62-80`); a single bill per order (`v2-email.ts:90-92`); storage under `po2_*` keys only (`po2_draft`, `po2_saved_drafts`, `po2_sent_orders`, `po2_fav_customers`, `po2_my_dealers`, `po2_starred_dealers`, `po2_starred_shipto`, `po2_fav_products`; `v2-storage.ts:25-36`); a containment rule (v2 edits nothing outside `app/po2/`; read-only imports of `lib/place-order/email.ts`, `mobile-search.ts`, `pack.ts`, and `components/shared/orbit-wordmark`); the wire guard `scripts/po-v2-email-fixtures.ts`; no CC; `ORDER_TO` shared.
- [H] **`/po9`** (23804504): ship-to off, shared storage with `/po2`, so a `/po2` draft's ship-to shows read-only on `/po9`. routetable: UNDOCUMENTED.
- [M] **The `/po-v2-8f4kd2` redirect** and its stated removal plan (ROADMAP P3). Note that it does NOT rescue an installed PWA, because `/po2`'s manifest `id` is `"/po2"`. routetable: UNDOCUMENTED.
- [M] **Per-route manifests**: `/po` → `public/po.webmanifest` (no `id`), and `/po2`/`/po9` → route handlers with `id` = mount (`v2-manifest.ts:55-72`). This is what keeps three separate installable home-screen apps from merging. Undocumented (§25 "Android shell" only mentions `display_override`).
- [M] **Middleware prefix landmine**: `"/po"` in PUBLIC_PATHS makes *any* path starting with `/po` public (e.g. a future `/portal` or `/po-admin`). CORE:1290 lists `/po` but not this consequence.
- [M] **/po Drafts/Sent**: §25 records a "⚠️ Gap". The code exists: `lib/place-order/saved-drafts.ts` (key `po_saved_drafts`, `MAX_DRAFTS = 20`), `lib/place-order/sent-orders.ts` (key `po_sent_orders`, today/yesterday IST retention), and a separate crash-recovery key `orbitoms_po_draft`. It can be documented from code; no companion draft is needed.
- [L] The desktop Ship-To gate plumbing: `components/place-order/place-order-access-provider.tsx` and `ACTION_PAGES.canEdit` membership (`lib/permissions.ts:433-436`, needed so /admin/access can grant it). Label "Purchase Order · Ship-to" (:528).

###### GONE
- None for live code. The files-map entries listed under STALE (§17) never existed. `/po` itself is **not** gone. The `/order` middleware entry stays (survivor).

###### Stale code comments spotted (claims about data/behaviour)
- `app/po2/page.tsx:115` "The teal comes from app/layout.tsx:45 — `{ themeColor: "#0d9488", ... }`" — FALSE. `app/layout.tsx:54` is `themeColor: "#7C3AED",`.
- `app/po2/manifest.webmanifest/route.ts:17` "middleware.ts:86 is matcher…" — the matcher is at `middleware.ts:90`. `app/po2/page.tsx:10-12` cites `:36`/`:26`, which are still correct.
- `app/po/page.tsx:14-23` "installable as its OWN home-screen app ("Orbit PO") … reads "Orbit PO"". CODE: same file `:28` `title: "Orbit",` and `public/po.webmanifest` `"name": "Orbit"`.
- `app/po/page.tsx:50-52` "public/po.webmanifest's theme_color and background_color moved with it". Only theme_color moved: `po.webmanifest` still has `"background_color": "#7C3AED"`.
- `app/po2/v2-email.ts:21-22` "Subject + body … byte-identical to what /po would send". This is false for KG packs since 4e8ca379 (see STALE).
- `lib/place-order/saved-drafts.ts:1-2` and `sent-orders.ts:1-2` "feature-flagged behind ?draft=on". The flag was removed (5b520304): `po-page.tsx:590` `const draftsEnabled = true;`.
- `app/(ops)/admin/attendance/page.tsx:26-27`: listed under ATTENDANCE below.

###### Confidence notes
- I can't verify from code whether any `role_permissions` row grants `place_order_ship_to` (DB). The commit message says "No grants exist".
- The §3 role list ("Primary users: admin, billing_operator, tint_manager") is a live-DB fact and was not re-checked. `lib/rbac.ts:25-26` still sends dispatcher/support to `/place-order`, which is correct.
- **Recommendation: `/po2` needs its OWN canonical file** (e.g. `docs/CLAUDE_PO2.md`) plus a router §3 row. Reasons: router §6 "Module reaches production-live status → gets own file"; the module is ~15.7k lines behind a containment fence, with its own storage, tile model, email pack order and manifests; and the 09-08/09-10 drafts plus ROADMAP already hold ~2,000 lines of material. PLACE_ORDER then needs a targeted rewrite, not a full one: header route list, §11 (third caller, CC, KG divergence), §16/§20 (last-order GET), §22 "TWO pages", §25 cutover direction, §3 ship-to key, §17 files map. Merge the two files at `/po` retirement. Sources for the new file: `code-update-2026-09-08-po-v2-board.md` (tile model, invariants, email contract), `code-update-2026-09-10-po2-polish-and-launch.md` (launch gate, containment, KG sort), `code-discovery-2026-09-12-po-v2-presentation-source.md` (presentation). All three are history only and must be re-verified against code.

---

##### docs/CLAUDE_ATTENDANCE.md — header v1.3 / footer v1.3 / last commit 7d8ceece 2026-08-05
Header-vs-footer match: yes ("v1.3 · Schema v27.13 · August 2026 · updated 2026-08-04" / "*Attendance v1.3 · Schema v27.13 · OrbitOMS · updated 2026-08-04*").

Commits since baseline touching attendance: 8598e81b, 8fac2a67, de7453bb, 740a9a21, 30dc63b1, c96157ea, 5daa58fc (rebrand, visual/strings), b915c88e + b493f87c (rbac superuser, no attendance gate changed: "the two hasRole([ADMIN, OPS_ADMIN]) attendance checks" left alone), 969d918f (camera-view shared with MRN), 4a2f763f (manifest short_name), 14747252 (next.config rewrite only). vercel.json unchanged.

###### STALE
- [H] [§4 "Gate logic (middleware.ts)"] "For `/attendance` and `/api/attendance/*`: 1. Resolve user from session 2. Check gate per rollout stage 3. If ungated → 404 4. If gated and consent stale → redirect to `/attendance/consent`" — CODE: `middleware.ts:32-83` has **no attendance logic at all**. The gate was removed in 236f9743 (2026-07-04, "Remove attendance check-in gate from middleware"). Even before that it redirected gated users *to* `/attendance` and never 404'd. Consent redirects now live in the pages (`app/attendance/page.tsx:37-39` `if (userVersion !== currentVersion) { redirect("/attendance/consent"); }`, and the same in check-in/check-out/history). CORE:227 already records the removal, so this section contradicts CORE. (The v1.3 pass marked "rollout stages + JWT stale window … Verified CORRECT", which was wrong.)
- [H] [§3] "OFF | No user gated. `/attendance` accessible to no one operationally." (and the implied rollout gating of the APIs) — CODE: `app/attendance/page.tsx:12-13` only requires a session. `app/api/attendance/check-in/route.ts:31-35` returns 401 only when unauthenticated, and there is no `rolloutStage` read in `app/attendance/**` or `app/api/attendance/**` (grep = 0). **Any logged-in user can open `/attendance` and check in at any stage.** Rollout stage now only controls sidebar visibility (`lib/permissions.ts:180-190`) and the JWT `lastCheckInDate` fetch.
- [H] [§3] "**Stale window:** middleware reads `rolloutStage` from JWT with a 5-min stale window." — CODE: `lib/auth.ts:147-160` does the refresh in the **jwt callback** (`STALE_MS`), and middleware never reads it. Consumers are `buildNavItems` and `gateAppliesTo`. The JWT's `lastCheckInDate` (`lib/auth.ts:110-114,137-141`) is still computed, but **nothing reads it** (grep: only auth.config pass-through + comments).
- [H] [§2 + §16 + §12] "`otApprovalStatus TEXT? (pending|approved|rejected|auto-approved)`" / "List records with `otApprovalStatus = pending`" — CODE: `lib/attendance/ot-logic.ts:35-39` `"NOT_CLAIMED" | "AUTO_CREDITED" | "AUTO_CREDITED_GRACE" | "PENDING"`, `app/api/admin/attendance/ot-pending/route.ts:45` `where: { otApprovalStatus: "PENDING" }`, `ot-pending/[recordId]/route.ts:130-131` `"APPROVED" | "REJECTED"`. The stored values are these six UPPERCASE tokens. The lowercase set doesn't exist, and a SQL filter written from the doc would match nothing. (DB not queried; code is the only writer.)
- [H] [§9.1 + §12 + §16] "**Approve modal:** optional adjusted-minutes input" / PATCH body "`adjustedMinutes?: number`" / "optional `adjustedMinutes` (approve)" — CODE: `components/admin/attendance/ot-approve-modal.tsx:19` "no `adjustedMinutes` parameter", `:48` `body: JSON.stringify({ action: "approve" })`, route `ot-pending/[recordId]/route.ts:34` `// Body: { action: "approve" | "reject", note?: string (≤500 chars) }`. Approve recomputes credit from the LIVE `otTriggerTime` (:114-125, :133ff). There is no override.
- [H] [§16 "Manual approval"] "Longer OT enters admin queue" — CODE: `lib/attendance/ot-logic.ts` → `if (!otTotalLessThan95) { … "AUTO_CREDITED" }`, then grace, then `"PENDING"`. The queue receives **claims on days SHORTER than `depotWorkingMinutes`** once the month's grace is used up. It is inverted, the same error the v1.3 pass fixed in the "Auto-approval" paragraph just above.
- [M] [§16 "Manual approval"] "**attendance_summary.otClaimedMinutes** sums approved + auto-approved OT per day." — CODE: `prisma/schema.prisma:2343` `otMinutesCredited    Int       @default(0)`. `otClaimedMinutes` appears nowhere (grep across prisma/app/lib/components = 0). The §2 rewrite missed this surviving line.
- [M] [§16 "Pure helper"] "Inputs: claim, reason, total worked minutes, settings. Output: `{ approvalStatus, adjustedMinutes }`." — CODE: `lib/attendance/ot-logic.ts:78` `export function decideOtOutcome(input: OtDecisionInput): OtDecisionOutput`, with output `{ otMinutesRaw, otMinutesCredited, otTotalLessThan95, otApprovalStatus, incrementGraceCounter, auditAction }` and input also `checkOutTimestamp` + `currentGraceFlagCount`. OT minutes = checkout IST − `otTriggerTime`.
- [M] [§9 Roster table] "Columns: User · Role · Check In · Out · Worked · OT · Late · Status · Geo OK · Sessions · Device · IP." — CODE: `components/admin/attendance/roster-table.tsx` `<thead>` renders `# · User · Role · In · Out · Worked · OT · Status · Flags`. The 12-column list is the **CSV** header (`export/route.ts:19-32`), not the table.
- [M] [§1 / §12] "admin dashboard at `/admin/attendance` (admin, ops_admin — the **`attendance_admin`** page key…)" and API auth "Session + admin" — CODE: the gate is a hardcoded role check, `app/(ops)/layout.tsx` `if (!roles.some((r) => ["admin", "ops_admin"].includes(r))) redirect("/unauthorized")`. The PageKey `attendance_admin` is referenced only in `lib/permissions.ts` (nav/labels) and gates nothing. The APIs split: `photo/route.ts:19` and `export/route.ts:42` `hasRole(session, [ROLES.ADMIN])` are **admin-only**, so ops_admin can't view selfies or export CSV. settings/ot-pending/ot-audit accept `[ADMIN, OPS_ADMIN]`.
- [M] [§14] "⚠ **`name` is currently `"Orbit"`** (`short_name` still `"OrbitOMS"`) — a **deliberate in-flight experiment** … **Do NOT "fix" it back**" — CODE: `public/manifest.json` `"short_name": "Orbit",` (4a2f763f, 2026-08-12, "Settles the abandoned name/short_name experiment"). The landmine is resolved. NOTIFICATIONS §8 (:225) carries the same stale claim.
- [L] [§14] "Icons generated from `public/icon-source.svg` (512×512 source: teal bg + scaled orbit composition)" / "Generator: `scripts/generate-icons.mjs`" — CODE: `public/icon-source.svg:2` `<!-- GENERATED by scripts/generate-wordmark.mjs — do not edit by hand. -->` with a violet radial gradient (#7C3AED…), rebranded 3b0490e6/67d734e2 2026-09-09. The source SVG is now itself generated; the PNGs still come from generate-icons.mjs.
- [L] [§17] "Rollover cron treats every weekday as working day." — CODE: `app/api/cron/attendance-rollover/route.ts:38-40` `where: { isActive: true, attendanceExempt: false }`, with no day-of-week or rolloutStage check. It writes ABSENT for **every** day including Sundays, for every active non-exempt user, **regardless of rolloutStage**.
- [L] [§13 files map] "`ot-pending-view.tsx` · `ot-pending-row.tsx` · `approve-modal.tsx, reject-modal.tsx`" — CODE: real files are `components/admin/attendance/ot-pending-table.tsx`, `ot-approve-modal.tsx`, `ot-reject-modal.tsx`. Also unlisted: `components/attendance/{attendance-home,bottom-nav,calendar-grid,camera-view,check-in-flow,confirm-view,history-calendar,live-timer,status-card,status-chip,success-view}.tsx`.
- [L] [§9.1] "On 409 … inline error "Already actioned. Closing…"" — CODE: `ot-pending-table.tsx:88` `text: "Already actioned by another admin. Refreshing list…"`. [§9.2/§9.3] "510 lines" / "289 lines" → now 547 / 309.

###### MISSING
- [M] **`components/attendance/camera-view.tsx` and `lib/attendance/photo.ts` are now shared with MRN** (969d918f: `components/mrn/photo-capture.tsx:5` imports `CameraView`; `lib/mrn/photo.ts` imports attendance). camera-view gained optional props `facingMode` (default "user"), `showFaceGuide` (default true) and a nullable `locationStatus`. Defaults protect clock-in, and the selfie mirror is conditional on facingMode. `captureFromVideo` quality is 0–100, not 0–1 (`camera-view.tsx:29`). MRN §539 documents its side; ATTENDANCE has no "shared consumer — don't change defaults" landmine.
- [L] Photo bucket name `attendance-photos` (`app/api/cron/attendance-purge/route.ts:8`) isn't named in ATTENDANCE (MRN:155 names it).
- [L] The superuser rbac pass (b493f87c/b915c88e) left attendance on `hasRole` role arrays, so a superuser-flag-only user without the admin role would fail the attendance admin APIs and the `(ops)` layout. Not documented; no live impact per commit (one superuser, who holds admin).

###### GONE
- The middleware attendance gate (§4 whole section): removed 236f9743. Proof: `grep -n attendance middleware.ts` = 0 hits; `git log -S attendance -- middleware.ts` shows 236f9743 as the removal.
- `otClaimedMinutes` (§16): absent from schema and code (grep = 0).

###### Stale code comments spotted (claims about data/behaviour)
- `lib/auth.ts:70-72` "Mirror of the middleware gate logic — kept in sync there." There is no middleware gate since 236f9743.
- `components/attendance/check-in-flow.tsx:151-152` "refresh JWT before showing success so the redirect's middleware check sees the new lastCheckInDate". No such middleware check exists.
- `lib/attendance/date.ts:15` "Used by middleware to compare against JWT.lastCheckInDate." Middleware no longer imports it.
- `lib/permissions.ts:182-183` "ops_admin reaches the user-facing /attendance flow via the gate redirect". There is no gate redirect.
- `app/(ops)/admin/attendance/page.tsx:26-27` "Admin gating already enforced by app/(admin)/admin/layout.tsx via requireSuperuser(session)." Wrong file and wrong mechanism: the enforcing layout is `app/(ops)/layout.tsx`, a role check for admin|ops_admin.

###### Confidence notes
- Stored `otApprovalStatus` values are inferred from the only writers (check-out route + PATCH route). I didn't run a DB SELECT, per the brief. Legacy rows could in principle carry other strings.
- "Any logged-in user can check in regardless of rolloutStage" is from reading every attendance page/API. I didn't exercise it live (no login).
- The rollover cron writing ABSENT for all active non-exempt users while rolloutStage may be OFF is a code reading. The effect on live `attendance_summary` volume is unverified (no DB).


<!-- source: sweep worker out-import-mrn-ci.md -->

### Canon drift sweep — IMPORT / MRN / CI (2026-09-18, read-only)

##### docs/CLAUDE_IMPORT.md — header v1.10 / footer v1.10 / last commit c8528fa8 2026-09-14
Header-vs-footer match: yes (both "v1.10 · Schema v27.15 · updated 2026-09-14").

Code commits touching import after c8528fa8: only `792efc52` (2026-09-16). But several 2026-08-10 → 2026-09-11 code changes were never folded into this file (v1.10 was a 4-claim correction pass, not a reconciliation).

###### STALE
- [H] [§9 snippet + lag note] Snippet: `requireRole(session, [ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.BILLING_OPERATOR, ROLES.TINT_MANAGER]); if (session!.user.role !== "admin") { const allowed = await checkPermission(session!.user.role, "import_obd", "canImport")`; and the lag note says the live POST "has … a role list that also includes `OPERATION_MANAGER` and `OPERATIONS`". — CODE: `app/api/import/obd/route.ts:4621-4625` `const allowed = await checkAnyPermission(session.user.roles ?? [session.user.role], "import_obd", "canImport");` — since `792efc52` (2026-09-16) there is NO role list at all; the `import_obd canImport` tick over ALL held roles is the only rule; 401/403 are JSON. Both the snippet and its "known to lag" correction are now wrong. Also line refs `route.ts:4585-4621` / `:4594` / `:4506` → POST is `:4584-4641`, day-obds dispatch `:4600`, handler `:4505`.
- [H] [§4 import_shadow_log] "INSERT-ONLY analysis log for shadow-mode cutover phases. Not actively written today." — CODE: `lib/import-qty-guard.ts:215` `await prisma.import_shadow_log.createMany({` called from `route.ts:1095` (manual-template preview) and `route.ts:3572` (processAutoImportRows) via `writeImportAnomalies`. Since `9188699a`/`a11bf7ee`/`d8fcf1ed` (2026-09-08) every auto/template batch with an anomaly writes rows with `shadowOutcome` ∈ `qty_mismatch` / `empty_payload_skipped` / `header_only_allowed`. §13 "import_shadow_log for shadow analysis" likewise understates.
- [H] [§2 / §10.1 / §14 "create-only"] "→ bulk createMany (CREATE-only for lines: existing OBDs skipped at ingest)" — the auto-json ingest now ALSO skips a NEW OBD whose payload has zero lines and volume>0 (not created, retried next cycle), and imports volume-zero OBDs header-only on purpose. CODE: `route.ts:4164` `return processAutoImportRows(headerRows, lineRows, "auto-json", true);` + `route.ts:3483` `if (skipEmptyPayloadObds && lines.length === 0) {` … `:3500` `headerOnlyImport = true;`. Not in canon.
- [H] [§1 / §10 / §10.1 / §14 naming trap] "Repo copy of what runs: **`docs/Powershell/Auto-Import-v2.ps1`**", cadence "~10 min". — CODE: `docs/Powershell/Auto-Import-v3.ps1` is tracked (added in `eb34532c`, 2026-09-08), header `#  Auto-Import-v3.ps1 -- v3.0 "fast lane"` / `v3 replaces the fixed 10-minute full cycle with a mode-based…`, posts to `https://www.orbitoms.in/api/import/obd?action=check|auto-json|patch-headers` and uses `?action=day-obds`. `lib/import-qty-guard.ts:162` cites `Auto-Import-v3.ps1` `:1156-1163`/`:1372-1375` as the live volume-zero rule. ROADMAP (`docs/ROADMAP.md` "⚠ Canon is stale on the auto-import cadence") already records that v3 is almost certainly what runs (1–5 min batch gaps). Canon never names v3; the naming-trap landmine lists three scripts, there are now four.
- [M] [§8.2 order-level roll-up] "`aggregateArticleTags()` in the same module, used by all THREE roll-up sites (`rebuildQuerySummaryForOrder`, manual-template CONFIRM D3, auto-import CONFIRM D3)" — CODE: `route.ts:765`, `:1501`, `:3952` all call `rollupArticleTagsBySku(...)` (`lib/article-tag.ts:291`), which groups lines by SKU and sums qty/volume BEFORE `computeArticleInfo` (commit `36103761`, 2026-08-10: "group by SKU before tagging, not after" — qty 1+5 of a 6/carton SKU = "1 Carton" not "6 Tin"; 9.3% of orders affected). `aggregateArticleTags` itself now lives in `lib/article-tag-parse.ts:67` (re-exported at `lib/article-tag.ts:231`). Also rollup returns `totalArticle` consistent with the tag. The grouping rule is absent from canon (CLAUDE_FLOOR mentions only the file move).
- [M] [§9 action table] "`preview` | `handlePreview` | Legacy preview (kept for backwards compat)" — CODE: `components/import/import-modal.tsx:44` `type Format = "sap-paste" | "sap" | "manual-template";` with a user-selectable button (`:707` `onClick={() => handleFormatChange("manual-template")}`) posting `?action=preview` then `?action=confirm` (`:427`, `:531`). The manual-template path is a live, user-reachable format, and the qty guard is wired into it (`route.ts:1038`).
- [M] [§10.1 line field map] "`Net Weight` → `netWeight`", "`Total Weight` → `totalWeight`", "`Item Category` → `itemCategory` (→ `isTinting` via Z007 rule)" — CODE: the auto path's line build (`route.ts:3440-3451`) writes `lineId, skuCodeRaw, skuDescriptionRaw, batchCode, unitQty, volumeLine, isTinting, article, articleTag, rowStatus, rowError` — no weights; `isTinting = parseBooleanCell(lr["Tinting"])` (payload flag, not Z007). Server keys are flat v1-sheet names (`lr["sku_codes"]`, `lr["line_id"]`, `lr["unit_qty"]`), not `{key,value}` pairs. ROADMAP P1 "Line weights are not populated on two of three import paths" already says so. The table describes the PS-side FormGetData input, not what the server stores.
- [M] [§6 file list — flagged in v1.10 changelog as "NOT fixed here", still wrong] "`upsertObd(input, ctx) → { outcome, effects }`", "`UpsertOutcome` ('new'|'patched'|'no-change'|'skipped-previously-removed')", "`loadExistingState()`", "`dispatchEffects()`. Effect kinds: `apply-mail-order-enrichment`, `create-challan-for-order`…", "`recordAuditEntry()`. Writes to `import_shadow_log`", "`makeKey` … `${lineId}|${skuCodeRaw}`" — CODE: `lib/import-upsert.ts:92` `upsertObd(input, source, batchId, batchRef, userId, now, options)`; `types.ts:84` `"created" | "patched" | "unchanged" | "errored"`; `state.ts:17` `loadExistingObd`; `effects.ts:47` `buildEffects`; `types.ts:71-76` `"mail-order-enrichment" | "challan-create" | …`; `audit.ts:33` `writeAuditLogs` → `order_status_logs.createMany` (`audit.ts:40`); `lines.ts:29` `` `${lineId}|${skuCodeRaw.trim()}` ``.
- [M] [§5 column constants / LineInterim / cells.ts — also flagged-not-fixed in v1.10] "`export const COL = { delivery: 0, …}`" — CODE: `lib/sap-parser/read-sheet.ts:21` `const COL = {` `delivery: 1,` (not exported, 1-based). LineInterim (`apply-rules.ts` interface) has `volumeLine: number | null`, `itemCategory: string`, `parentRowNumber`, and NO `article`/`articleTag`. `cells.ts` exports `toStr/toNum/toInt/toStrOrNull`, not `readInt/readFloat/readString`. `REQUIRED_COLS` is `read-sheet.ts:52-57`, not 54-58.
- [M] [§4 headerFile prefix table] Lists 3 prefixes only. — CODE: `route.ts:928` `headerFile: \`[${templateId}] ${batchFileName}\`` (manual-template, e.g. `[combined_v2]`), and `lib/import-qty-guard.ts:254` appends `` `${batchFileLabel} ⚠ ${parts.join(" · ")}` `` (e.g. `⚠ qty-mismatch x1: …`) to any batch with anomalies. LIKE-prefix filters still work; the table is incomplete.
- [M] [§11 UI components] "`sap-preview.tsx` — preview modal … Confirm button posts to `manual-sap-confirm`"; "`import-page-content.tsx` — admin `/admin/import` page content". — CODE: `SapPreview` is imported only by `components/import/import-page-content.tsx:37` (the modal renders its own preview); `import-page-content` backs BOTH `app/(import)/import/page.tsx` (the nav target, `lib/permissions.ts:43` `href: "/import"`) and `app/(admin)/admin/import/page.tsx`. §2's "Operator → /admin/import upload" names the secondary mount.
- [L] [§1 "two import paths"] "OrbitOMS receives OBDs from SAP via two import paths" — there are four operator/machine sources in code: manual SAP xlsx, SAP clipboard paste (the modal's DEFAULT format — `import-modal.tsx:130` `setFormat("sap-paste")`), manual-template, auto-json.
- [L] [§8.2] "Wired at three write sites — `build-obd.ts` (manual-SAP) and … `processAutoImportRows`" — the paste path reaches `computeArticleInfo` through the unchanged `buildObds` (`lib/sap-paste/index.ts` → `../sap-parser/build-obd`), so the count is right only by accident; the sentence names two files.
- [L] [§12 line refs] "`handleManualSapConfirm` (~line 1021) and the auto-import confirm path (~line 2822)" — handlers now at `route.ts:1807` and processAutoImportRows ~`:3266+`. §12.2's `~route.ts:299-308` fork is now `:337-341` (rule still the OLD receivedAt vs punchedAt — §12.2 remains correct in substance).

###### MISSING
- [H] **No-mail-order fallback release** — `applyNoMailOrderFallback` (`route.ts:554`), called at `:1423` (template confirm), `:2017` (manual-SAP confirm), `:2562` (sap-paste confirm), `:3869` (auto). Commit `b3dfe5b8` (2026-09-11). After enrichment, every new non-tint bill still at `pending_support` with `dispatchStatus` NULL is set `dispatchStatus:"dispatch"`, advanced to `SUPPORT_DONE_OUTPUT`, and slotted by `evaluateDispatchSlot` (manual slot preserved; decline leaves slot NULL; ~12.5 bills/day stay unslotted by the SMU gate) — ONE `orders.update` + ONE status log. Grep of all `docs/CLAUDE*.md` for `applyNoMailOrderFallback|no-mail|no mail order`: zero hits. Changes §2's pipeline diagram and the downstream story ("every bill reaches the floor on its own").
- [H] **Import-anomaly guard** — `lib/import-qty-guard.ts` (commits `9188699a`, `a11bf7ee`, `d8fcf1ed`, 2026-09-08): header-UnitQty-vs-line-sum mismatch recorded (measurement only, never blocks; `[qty_mismatch]` appended to `import_raw_summary.rowError`, never to `rowStatus` — rowStatus is load-bearing); empty-payload skip (volume>0, zero lines → not created, retried); volume-zero header-only carve-out (`header_only_allowed`, "AWAITING MANUAL SAP"). Not wired into manual-SAP by design. Documented only in `docs/prompts/drafts/code-discovery-2026-09-08-import-qty-integrity.md` + ROADMAP; no canon file mentions `import-qty-guard`.
- [H] **Parser rule P — parent superseded by batch sub-items** — `lib/sap-parser/apply-rules.ts` (`25fc3c99` + fix `a290c116`, 2026-09-08). `BATCH_SUB_ITEM_FLOOR = 900000`; a low-numbered parent is dropped (VISIBLE skip reason `"parent item superseded by batch sub-items"`) when a surviving ≥900000 sub-item for the same SKU exists in the same delivery; single `classifyRow()` shared by pre-pass and filter loop. Absent from §8's ordered filter list (items 1-10) and from §13's warning list. Canon grep for `superseded|sub-item|stands down`: zero.
- [H] **`GET /api/import/access` + `useCanImportObds`** — `app/api/import/access/route.ts` (new, `792efc52` 2026-09-16) returns `{ canImport }` from the same `checkAnyPermission(roles,"import_obd","canImport")`; caller is `lib/hooks/use-can-import-obds.ts` (fail-closed, default false), used by `app/(mail-orders)/mail-orders/mail-orders-page.tsx` + five tint screens (`challan-content`, `shade-master-content`, `ti-report-content`, `tint-manager-content`, `tint-operator-content`) to drive `showImport`. `app/(import)/import/layout.tsx:31` gates the page on the same tick (was a role list). Zero canon hits.
- [M] **SAP clipboard paste pipeline** — `lib/sap-paste/{index,read-paste,resolve-names}.ts`, actions `sap-paste-preview`/`sap-paste-confirm` (`route.ts:2202`, `:2355`), commit `37ceb57a`. Canon names the actions and prefix only and defers to `docs/prompts/drafts/code-update-2026-09-14-sap-paste-import.md` "pending consolidation" — still pending. Not in §2 pipeline, §9 table, §11.
- [M] **Header import pill** — `components/import/import-progress-provider.tsx` (mounted in `app/layout.tsx:90`) and `import-progress-pill.tsx` (`components/universal-header.tsx:422`), `37ceb57a`. Zero canon hits (incl. CLAUDE_UI).
- [L] `SMU_CODE_BY_NAME` (`lib/import-upsert/types.ts:243`) — CLAUDE_CI §1/§5 says "`CLAUDE_IMPORT.md` owns that map"; IMPORT never mentions it (only `DIVISION_TO_SMU`). It is documented in CLAUDE_PICKING §5.2 (~l.459).
- [L] `route.ts:4586-4593` comment block + `middleware.ts:47-50`: the six machine actions MUST stay above the session gate (moving them stops depot auto-import). Canon §9 says "dispatch BEFORE session auth" but not the must-not-move rule.

###### GONE
- none proven. (`handleAutoImport` v1, `docs/sample/Auto-Import.ps1`, `docs/Parser/Auto-Import.ps1`, `docs/Powershell/Auto-Import.ps1` all still exist.)

###### Stale code comments spotted (claims about data)
- `lib/sap-parser/apply-rules.ts` `zinr-article-tag-pending` message `"ZINR row needs articleTag rule (deferred)"` — canon already flags it stale (§8 rule 9).
- `lib/import-qty-guard.ts:247` "`CLAUDE_IMPORT.md §4 lists an errorMessage`" — no longer true since v1.10 (§4 corrected); comment lags the doc.
- `lib/import-qty-guard.ts` header: "Ten live bills hold ZERO line rows …" — a 2026-09-08 data count; ROADMAP's own correction reframes them as header-only-by-design.

###### Confidence notes
- Cannot verify which PS script the import PC actually schedules (v2 vs v3) — ROADMAP's batch-gap evidence points to v3.
- §1 primary-users grant list and §4 status counts are live-DB claims; not re-checked.
- `docs/Powershell/0-FrtIngestion.ps1`, `3-PendingFetch.ps1`, `4-LogisticsEntry.ps1` (untracked) are Breakwalls freight/logistics-entry automation (`an.breakwalls.biz`), not OrbitOMS import; out of IMPORT's scope. Mentioned only in ROADMAP.
- Middleware HMAC exemption (`middleware.ts:51-54`, header `x-import-key-id` ∈ `auto-import-v1`/`auto-import-json-v1`, path `/api/import/obd`) matches canon.

---

##### docs/CLAUDE_MRN.md — header v1.1 / footer v1.1 / last commit 0ebb290e 2026-09-04
Header-vs-footer match: yes (v1.1 · Schema v27.20 · updated 2026-09-04).

Code commits after 0ebb290e: `65fd0e10` (admin-bypass removal, behaviour-neutral), rebrand/masthead commits `c96157ea`…`0db792a1` (colour/header only), plus `79bcc412` (2026-09-13) which deleted a file canon cites.

###### STALE
- [M] [§4.5] "with a count badge on its top-right corner — `#f5f3ff` / `#5b21b6`, the notes/remark shade owned by `components/floor/tint-strip.tsx:30` … Never a Tailwind `purple-*`." — CODE: `components/mrn/photos-button.tsx:146` `… bg-ink-50 … text-ink-600 ring-2 ring-white [box-shadow:inset_0_0_0_1px_#E9E7F0]`; and `components/floor/tint-strip.tsx` no longer exists (deleted in `79bcc412`, 2026-09-13). Badge is now ink tokens (rebrand `b585240f`/`c96157ea`).
- [M] [§9 internal contradiction] Table: "`operations` | ✓ | ✓ | ✓ | ✗" (canExport ✓) vs next table "Print / Download XLS | `canExport` — billing's alone (§11 OQ-11)". Seed agrees with the table: `prisma/seed.ts:147` `roleSlug: "operations", pageKey: "mrn", … canExport: true`. The "billing's alone" row is wrong (or the grant is) — and the export route's own comment claims the opposite (see stale comments).
- [L] [§11] "`components/mrn/lines-table.tsx` | Three column sets, …" vs §8.1 "**TWO** column sets" — CODE: `lines-table.tsx:93` `BILLING_COLUMNS`, `:102` `DONE_COLUMNS` — two sets, three render arms. §11 row is wrong.
- [L] [§1] "`app/mrn/page.tsx:69`: `showSupervisorFace = primaryRole === "floor_supervisor"`" — now `app/mrn/page.tsx:95`.
- [L] [§10 / §11] "`sql-2026-08-31-mrn-photos-otr.sql` … Photos + `closed` DDL, as run" — the file now carries QUOTED constraint names (`CONSTRAINT "mrn_photos_mrnId_fkey"`) and a header explaining the fold; it is the corrected DDL, not literally what ran.

###### MISSING
- [L] No route inventory. Seven of sixteen MRN API routes are not named by path anywhere in canon: `GET /api/mrn/[mrnId]` (detail, canView), `GET /api/mrn/board` (canView), `GET /api/mrn/[mrnId]/export` (canExport, done/closed only — §8 describes the XLS without naming it), `PATCH /api/mrn/[mrnId]/header` (described only as "header PATCH"), `PUT /api/mrn/[mrnId]/line/[lineId]` (the supervisor's per-line confirm, canEdit, 409 unless `checking`), `GET /api/mrn/[mrnId]/photos` (list, canView), `POST /api/mrn/resolve-skus` (canView, caller `components/mrn/paste-lines-modal.tsx:84` — the preview's catalog lookup). CLAUDE_CI §14 has the table MRN lacks.
- [L] Components not in §11 index: `close-mrn-modal`, `delete-mrn-modal`, `edit-header-modal`, `end-sheet`, `new-mrn-modal`, `paste-lines-modal`, `mrn-rail`, `rail-card`, `supervisor-card`, `status-pill`, `print-sheet-button`, `modal-shell` (named only in §10), `format.ts`.

###### GONE
- `components/floor/tint-strip.tsx` (cited §4.5 as the owner of the badge shade) — deleted `79bcc412`; `ls components/floor/tint-strip.tsx` → no such file.

###### Stale code comments spotted
- `app/api/mrn/[mrnId]/export/route.ts:21-22` "`floor_supervisor` and `operations` both hold `mrn.canView` TRUE and `mrn.canExport` FALSE" — seed (`prisma/seed.ts:147`) and canon §9 table say operations canExport TRUE.
- `components/mrn/photos-button.tsx:132-140` "THE SHADE HAS ONE OWNER … #f5f3ff / #5b21b6 come from components/floor/tint-strip.tsx:30" — both the file and the colours are gone from the code it sits above.

###### SQL drafts vs prisma/schema.prisma
- `sql-2026-08-31-mrn-photos-otr.sql` — **schema.prisma mirrors it**: `model mrn_photos` has all 10 columns with matching nullability, `mrnId`/`lineId` `onDelete: Cascade`, `capturedBy` required (Prisma default Restrict), `storagePath @unique`, indexes `[mrnId]`, `[mrnId, kind]`, `[lineId]`; `model mrn` has `closedAt @db.Timestamptz(6)`, `closedById Int?` + `closedBy` relation, `status String @default("open")`. CHECKs (`chk_mrn_status` incl. `closed`, `chk_mrn_photo_kind`, `chk_mrn_photo_lr_truck_level`) are not expressible in Prisma — cannot confirm live.
- `sql-2026-09-01-mrn-delivery-split.sql` — **schema.prisma mirrors it**: `mrn_lines.deliveryNo String` (NOT NULL), `@@unique([mrnId, deliveryNo, lineNo])`, `@@index([mrnId, deliveryNo])`. Deliberately NO `@default("")` (schema comment: live DEFAULT '' is "deliberate and temporary", Part 4 still commented in the draft). Whether Part 4 has since been run is a DB question — unverifiable here.

###### Confidence notes
- §12 live state (11 MRNs, 0 photos, 0 closed) is a 2026-09-01 SELECT — stale by definition, not re-checked.
- Core claims re-verified in code: one-way ladder, `CLOSE_ROLES = [BILLING_OPERATOR, ADMIN]` + guarded `updateMany` (`close/route.ts:62,164`), scoped `deleteMany({ where: { mrnId, deliveryNo } })` (`lines/route.ts:378`), no header writer of `mrn.deliveryNo`, `MAX_PHOTOS_PER_GROUP = 5` (`lib/mrn/photo.ts:114`), bucket `mrn-photos`, 300s signed URLs, allocator counts soft-removed rows, marker imports `buildMrnSupervisorWhere`, no `app/mrn/layout.tsx`, supervisor tabs To check/Checking/Done.

---

##### docs/CLAUDE_CI.md — header v1.1 / footer v1.1 / last commit 2027b1a4 2026-09-04
Header-vs-footer match: yes (header l.2 "v1.1 · Schema v27.21 · … updated 2026-09-04"; footer l.822-823 "CLAUDE_CI.md v1.1 · Schema v27.21 · … updated 2026-09-04").

Code commits after 2027b1a4: `65fd0e10` (admin-bypass removal, behaviour-neutral) + rebrand/masthead UI commits (`c96157ea`, `5daa58fc`, `b585240f`, `30dc63b1`, `b3896d30`, `872b380e`, `b51e6a15`, `e355eb51`).

###### STALE
- [H] [§13 CI-16 + §15 + router CLAUDE.md §3 CI row] "`ci` is in the `PageKey` union and in `ALL_PAGE_KEYS`, but deliberately **not in `PAGE_NAV_MAP`** … Until then the URL is the entry point"; §15 "**`/ci` is not in the sidebar**"; router: "⚠ Reachable by URL only — not in the sidebar yet". — CODE: `lib/permissions.ts:102` `{ pageKey: "ci", label: "CI", href: "/ci" },` placed after `mrn` with a comment verifying navItems[0] unchanged for floor_supervisor (/picking), billing_operator (/place-order), operations (/operations/tinting); `components/shared/role-sidebar.tsx:76` `ci: Undo2,`. `buildNavItems` (`lib/permissions.ts`) shows it for any role with `ci` canView. `git log -S'"/ci"' -- lib/permissions.ts` → only `55c3cdc6 2026-08-31 ci: billing desk face + nav entry`; `git show 2027b1a4:lib/permissions.ts` already has it at line 94. **False since before v1.0 was written** — CI IS in the sidebar. (Criteria (a) and (c) of CI-16 appear met by the comment's own derivation; (b) "verified on a real phone" is unverifiable here.)
- [M] [§14 route table + §11] "`[ciId]/details` | PATCH | canEdit" and §11 "Two routes carry a sharper gate on top of the permission" (lines, submit). — CODE: `app/api/ci/[ciId]/details/route.ts:69` `const EDIT_ROLES = [ROLES.FLOOR_SUPERVISOR, ROLES.OPERATIONS, ROLES.ADMIN];` `:92` `if (!hasRole(session, EDIT_ROLES))`, and `:254` `if (fresh.supervisorId !== viewerId)` inside a guarded `updateMany WHERE status='submitted' AND supervisorId=:me` with "NO ADMIN BYPASS" (`:51`). Details carries canEdit + role list + ownership. Present since `65042a79` (2026-09-01), i.e. stale at authoring.
- [M] [§14 route table] "`[ciId]/close` | POST | canEdit" — CODE: `app/api/ci/[ciId]/close/route.ts:49` `const CLOSE_ROLES = [ROLES.BILLING_OPERATOR, ROLES.OPERATIONS, ROLES.ADMIN];` `:77` `if (!hasRole(session, CLOSE_ROLES))` → 403 "Closing a return is the billing operator's step." (floor_supervisor holds canEdit but cannot close). Also `[ciId]/submit` has `SUBMIT_ROLES` (`submit/route.ts:61`) on top of ownership. CLAUDE_MRN §3 documents CI's CLOSE_ROLES; CI's own file does not.
- [L] [§8] "**Row 1** carries the title, the counts in `stats` …" — `b3896d30` (2026-09-09) removed CI's `title` from `components/ci/billing-board.tsx` ("eleven screens stop naming themselves"); Row 1 now starts with the stats.
- [L] [§5] "`SMU_CODE_BY_NAME` (`CLAUDE_IMPORT.md` owns that map). CI is its third caller, after `lib/picking/queue.ts` and `lib/floor/queries.ts`." — IMPORT canon never mentions the map (PICKING §5.2 does); importers today: `lib/picking/queue.ts`, `lib/floor/queries.ts`, `lib/ci/queries.ts:30`, `lib/picking/colour-work-query.ts:4`, `lib/picking/tint-workload.ts:3` — five.

###### MISSING
- none of substance — no CI behaviour shipped after 2027b1a4 beyond UI recolour/masthead (owned by CLAUDE_UI §59.8).

###### GONE
- none. 12 API routes, 14 components, 7 lib files, all `force-dynamic` — counts match §14 exactly.

###### Stale code comments spotted
- `app/ci/page.tsx:57-62` "⚠ NOT IN THE SIDEBAR YET. `ci` is in the PageKey union and ALL_PAGE_KEYS but deliberately NOT in PAGE_NAV_MAP — that is step 6 … Reach this page by URL until then." — contradicted by `lib/permissions.ts:102`.

###### Confidence notes
- §15 live shape (31 rows, 17 drafts, 0 voided) and §11 grant table are 2026-09-03 SELECTs; not re-checked (no DB).
- Re-verified in code: `CiStatus` union incl. `returned_to_floor` with no writer (only read in `lib/ci/queries.ts:364,412`); auto hook at `app/api/picking/findings/confirm/route.ts:314` `await reconcileAutoCi(order, supervisorId)`; `AUTO_REASON_CODE = "PHYSICALLY_CROSS"`; `OFFSET = 1000`; marker imports `buildCiBillingWhere`; export gated `canExport`; page branches on `primaryRole`, gated `ci canView`.


<!-- source: sweep worker out-roadmap.md -->

### out-roadmap.md — canon drift sweep 2026-09-18 (read-only)

##### docs/ROADMAP.md — header "Updated 2026-09-06" / footer "Updated 2026-08-09" / last commit 23804504 2026-09-15

Header-vs-footer match: **NO — and neither one matches the last commit.**
- Line 2 header: `# Updated 2026-09-06 (tint + master-data access conversion — ...` (the header was last rewritten by fd2c7249, 2026-09-06).
- Line 1696 footer: `*Updated 2026-08-09 — **articleTag rule shipped** (`9de0c55b`) ...` (the footer has not changed since 0b0dcff1, 2026-08-09).
- Last commit 23804504 (2026-09-15, "add /po9 — same order page with ship-to off"): `git show 23804504 --stat` shows the commit touching app/po2/*, app/po9/* and docs/ROADMAP.md. The ROADMAP diff is **+2 lines only**. It added the `**/po9 exists (2026-09-15)**` paragraph under `## /po2` (line 1533) and changed neither the header nor the footer.
- **Nine commits after 2026-09-06 added sections without updating the header or footer:** 54714f72, 7cb2074e (09-08 import P1s and correction), aa525bd4 (09-08 trip_report 39-column note), ebc54c38 (09-09 park po-v2), fdf31da8/c4a4eb90 (09-09), 120cc5a3/d17354ce/145b5f32 (09-10 `/po2` LIVE), 23804504 (09-15 /po9). The file has two date stamps, and both are stale.
- The 2026-08-05 change log (1683-1692) is the only change log. It has no entries for any of the later additions.

###### STALE
- [H] [CI §P1 "/ci into PAGE_NAV_MAP", l.1392-1401] "The module is reachable **by URL only**. `ci` is in the `PageKey` union and `ALL_PAGE_KEYS` but not in the nav map". CODE: `lib/permissions.ts:102` `{ pageKey: "ci", label: "CI", href: "/ci" },`. It was added by **55c3cdc6 (2026-08-31, "ci: billing desk face + nav entry")**. `git show 4dcbc115:lib/permissions.ts` has it at :94, so the line was already there when CLAUDE_CI v1.0 and this ROADMAP item were written. `git log -S` finds only that one adding commit. The comment above the line (:90-101) records a navItems[0] check done on 2026-09-01 (floor_supervisor still lands on /picking). The same false claim is in `CLAUDE_CI.md §13 CI-16` (l.690-702, 811) and in the router `CLAUDE.md §3` /ci row ("Reachable by URL only — not in the sidebar yet").
- [H] [User-based access §P1 "Two bypasses", l.102-108] "`app/api/reports/tint-summary/route.ts:33` — ... `role !== "admin" && role !== OPERATIONS` ... **still admits Operations User to the Tint Summary report**". CODE: `app/api/reports/tint-summary/route.ts:37` `const allowed = await checkAnyPermission(roles, "reports_tint_summary", "canView");`, with the comment at :30-33 "Gate (2026-09-17): the reports_tint_summary tick ... Replaced a requireRole role list + a primary-role checkPermission". Fixed by **6f628b05** (2026-09-17). Close the item.
- [M] [User-based access §P1 Step 6, l.41-45] "**58 `requireRole` calls whose array names roles beyond ADMIN** ... the biggest being 18× `[TINT_MANAGER, ADMIN, OPERATIONS, OPERATION_MANAGER]`". CODE: `grep -rn "requireRole(" app lib` finds **23 call sites** (lib/rbac.ts excluded). Only **19** name a role besides ADMIN, and just **one** of those has the 4-role tint shape (`app/(tint)/tint/manager/ti-report/page.tsx:9`). The largest shape now is 4× `[ADMIN, DISPATCHER, SUPPORT, TINT_MANAGER, TINT_OPERATOR, FLOOR_SUPERVISOR]` (contact-roles, delivery-types, sales-officers, so-groups). The "58" was counted before the 09-06 tint conversion and never re-counted.
- [M] [Tint Module §P2 "TM reorder `$transaction` refactor", l.393-395] "`/api/tint/manager/reorder/route.ts` ~line 429 uses `prisma.$transaction`". CODE: `app/api/tint/manager/reorder/route.ts:102` `// Sequential awaits — never prisma.$transaction (CORE §3: ...`. The file contains no `$transaction` call. Refactored in the board rebuild (a0f9378b→082eb92e). CLAUDE_TINT's footer already says "§14: the reorder landmine is CLOSED".
- [M] [/po2 §P2 "Fav block on the board — BLOCKED", l.1565-1570 + §P1 "DECISION OPEN: storage model", l.1585-1589] "🔴 **Do not start it before the storage model is settled**". CODE: `app/po2/po-v2-page.tsx:2224` `{/* ── THE FAVOURITES BLOCK ─────`; `app/po2/v2-storage.ts:36` `const FAV_PRODUCTS_KEY = "po2_fav_products";`. Shipped by **a988ab41 + f4c0444c (2026-09-09)**, then bc2cad7c and b54ae21c. Those commits came after ebc54c38 parked the item, and the 09-10 edits to this section never updated it. The block was built on localStorage, so in practice the storage question was decided as per-phone.
- [M] [/po2 §P2 "Ten board tiles still have no tin photograph", l.1572-1578] "**27 of 37 tiles resolve a picture, 10 do not** — More Interior, VT Specialty, Acotone, Uni Stainer, Machine Tinter, GVA, Coats & Additives, Luxurio, Hydro PU, Thinner & More". CODE: `app/po2/v2-data.ts:393-420` `TILE_IMAGES` now includes `"coats-additives", "vt-specialty"`, `"uni-stainer", "machine-tinter", "acotone", "spray-paint"` and `"luxurio"`. More Interior's slot went to Spray Paint (2ac3da61). The only tiles still without art are **GVA, Hydro PU and Thinner & More**; :397-403 says thinner.webp was deliberately taken off the list. Commits: 6b02feed, 797763a0, 3cd56262, 2ac3da61, 91f2bf53 (all 2026-09-10).
- [M] [Import "🔴 CORRECTION 2026-09-08", l.597-606] "Needs an owner decision between: (a) revert `a11bf7ee`, (b) carve out volume-zero ... **(b) is the recommendation**". CODE: option (b) shipped in **d8fcf1ed** (`app/api/import/obd/route.ts:3509` logs its own `header_only_allowed` row). The one-line correction at l.580-584 says this, but the decision paragraph just below it still reads as open. Strike (a)/(c).
- [M] [Consolidation 2026-07-16 §Security, l.832-833] "`GET /api/mail-orders/backfill-enrich` fully unauthenticated — no session, no HMAC" and "Mail Orders routes are session-only, no role check". CODE: `app/api/mail-orders/backfill-enrich/route.ts:169` `requireRole(session, [ROLES.ADMIN]);`; **0f56eede** (2026-08-30) gated 11 write routes on `mail_orders/canEdit`. The later "Mail Orders cleanup" section (l.1348+) knows this, but these two bullets were never struck.
- [M] [Consolidation 2026-07-16 §Picking "NO AUTOMATIC DRAIN pick_checked → dispatched", l.876-891] "⚠ **Changed 2026-07-28: nothing in the app reads or writes `dispatched` on a board any more.**" CODE: `lib/floor/dispatch.ts:178` `data: { workflowStage: DISPATCHED },`, reached via `POST /api/floor/trips/[id]/dispatch` (3945e6d5 2026-09-13, a501650f 2026-09-14). That route's own header (`route.ts` l.6-13) says "🔴 NO CALLER SINCE SLICE 7 (2026-09-15), AND KEPT ON PURPOSE ... Until that screen exists, nothing on the floor writes `dispatched`". A drain path now exists, but nothing calls it. It is waiting on a future supervisor loading screen, and the item should be rewritten around that.
- [M] [same section, "LOOK UP A DISPATCHED BILL — no screen can", l.863-875] "All **1,546** orders at `workflowStage 'dispatched'` are **invisible in every screen**". CODE: **551069aa** (2026-09-11, "history surfaces recognise 'dispatched' — shipped work is visible again"). Floor History, Billing's invoiced-info arm and the trip buckets now read `dispatched`: 2,940 bills are visible again, and per the commit message 1,197 are still unreachable. `app/api/floor/order/[orderId]/route.ts:234` `isDispatched: order.workflowStage === "dispatched",`. The item is partly done.
- [M] [User-based access §P1, l.59-66] "Prior question nobody has answered: **does anything still call these two routes?**" (`operator/shades` POST, `[id]` PUT). CODE: `grep -rn "operator/shades" components app lib` outside `app/api/tint/operator/shades` finds only a comment, `components/tint/tint-operator-content.tsx:886` `// (Phase 4) The legacy preload of /api/tint/operator/shades is gone —`. Nothing in the app calls them. An external caller is still possible, so check Vercel logs before retiring. This moves the retire-or-convert decision toward retire.
- [M] [Floor carry-over P1, l.1168-1207] The design assumes releasing to a dispatch slot, then a nightly roll to the first slot of the next day. Two changes since: **b3dfe5b8** (2026-09-11) "every bill reaches the floor on its own — no release step", and the trip desk (bbb9628c) replaced slot-based loading. **36a39ba7** added a different "pool carries forward" arm (`floorCarriedPoolWhere`). No cron exists: `vercel.json` has only attendance-rollover and attendance-purge, and schema.prisma has no `originalDispatch*` column. Check the premise before any Session B.
- [L] [Consolidation 2026-07-16 §Picking, l.937-939] "Manifest name experiment — finish or revert. `manifest.json` `name="Orbit"` / `short_name="OrbitOMS"` is an in-flight test". CODE: `public/manifest.json:2-3` `"name": "Orbit", "short_name": "Orbit"`. Finished by **4a2f763f** (2026-08-12, "pwa: match manifest short_name to name").
- [L] [Consolidation 2026-07-19 §Code cleanup, l.1098-1102] "Stale comment in `prisma/schema.prisma` ... `// No readers repointed yet`". CODE: `prisma/schema.prisma:2129` `// (ROADMAP). (This line said "No readers repointed yet" until 2026-08-05.)`. Fixed by **6f1e35a8** (2026-08-05, "retire five stale code comments").
- [L] [Billing v2 P2, l.1246] "Global rename Mail Orders → Billing (currently billing-face only)". CODE: `lib/permissions.ts:65` `{ pageKey: "mail_orders", label: "Billing", href: "/mail-orders" },`. The sidebar label reads Billing for everyone since bf218da8 (2026-08-06). Only the route and page key still say mail-orders.
- [L] [/po2 P3 "`CROSS_DEPOTS` exists twice", l.1610-1615] CODE: there are **three** copies: `app/po/po-page.tsx:89`, `app/po2/v2-data.ts:1818` (exported) and `app/(place-order)/place-order/components/cart-panel.tsx:76`.
- [L] [/po2 P3 "Three manifests exist", l.1596-1600] There are four now. **23804504** added `app/po9/manifest.webmanifest/route.ts`, and the manifest object moved to `app/po2/v2-manifest.ts`.
- [L] [/po2 P3 "Three buttons still at font-weight 800", l.1591-1594] CODE: `app/po2` has **14** `font-extrabold` (=800) sites: product-drawer.tsx 8, review-screen.tsx 5, product-search.tsx 1. The "three" may only have counted inline `fontWeight: 800`, so the count needs re-deriving.
- [L] [Consolidation 2026-07-16 §Picking P1 soft duplicate-SO, l.1315-1332] The item says Floor moved "its three surfaces (`floor-table.tsx`, `rail-card.tsx`, `detail-panel.tsx`)". Since then, `rail-card.tsx` was deleted in 79bcc412 (2026-09-13), and the same commit turned Floor's duplicate-SO row wash off ("4 · THE DUPLICATE-SO ROW WASH IS OFF"). The picking boards still have no `variant="soft"`, so that part of the item is still open.
- [L] [Cross-cutting P1 OneDrive, l.768] "the 3 stale deletions currently sitting in `git status`": `git status --porcelain` has no deletions today. The risk still applies, but that evidence is gone.
- [L] **Line-number anchors that have drifted.** Read the code, not these numbers.
  - challan `$transaction` ":527" is now `app/api/tint/manager/challans/[orderId]/route.ts:551`.
  - admin customers "lines 133 + 186" are now :137 + :194.
  - permissions-manager `NA_IMPORT`/`NA_DELETE` ":52-64" is now :100-110.
  - "`lib/permissions.ts:117`" stale comment is now :127.
  - ZINR string "`apply-rules.ts:144-151`" is now :241.
  - "`next.config.mjs:24-27`" is now :33-34.
  - v2-data "~:1508 BOARD header": the text now at :1964 reads "FAMILIES still holds the live"; "not yet consumed" is gone.
  - po-v2-page "Step 4" notes are now at :964/:990/:1011, not ~609/635/655.
  - "9x4 board" is now at :309.

###### MISSING (shipped since 2026-08-05; ROADMAP neither closes it nor lists its follow-ups)
- [H] **Floor trips: trip desk, slices 1-10, add-to-trip 1-4, redesign 1-3.** Commits 04f4c97b, 1102ad1d, bbb9628c, a5bafb40, 3945e6d5, a501650f, c539aae4, c84f8faa (trip_activity), 8eaa4663, 62ea5f1b, cdbf95b1, 3b9d1ab4, 175c83fd, 791a2cd6, 22ced2d8, a8a8573e→30b393e3, 7966d24d→49edf7c5, b95b6eeb→ec6343ba. Code: `components/floor/trip-*.tsx`, `app/api/floor/trips/**`. ROADMAP's only "trip" hits are about trip_report. Open follow-ups that are only tracked in `FLOOR-TO-FLOOR-DISCOVERY.md`:
  - l.42: the add-bills route enforces no delivery type.
  - l.46: the remove-bills route clears any stop.
  - The dispatch route has no caller until a supervisor loading screen exists.
  - Rejected: sticky header collapse, l.120.

  **No CLAUDE_*.md mentions the trip desk.** CLAUDE_FLOOR was last committed e9fcd612 (2026-08-26), and its §46/§326 still describe the deleted left rail.
- [H] **Billing Print tab and per-button billing ticks.** 22ced2d8, 6d008f8e, a5e1b758, a3b4cdfe (`components/billing/billing-print-tab.tsx`, page key `billing_print`); 9bc027a9 (`billing_picking` gate); c73ee93b/a991a1c4 (`billing_hold/slot/urgent/ship-to`); f1dcfa58 (filter chips). None of these terms appear in ROADMAP (0 hits each) or in any CLAUDE_*.md for `billing_print`/"Print tab". The Billing v2 section (l.1234-1254) is still the 08-04 pilot list.
- [M] **Pick visibility gate / "Show to floor" / held-back band.** 16eff3d5, 7e89e8fb, fdc03beb, 9a3671ec, 963665af, da80d657, 791a2cd6 (per trip). Code: `app/api/floor/pick-gate/`, `components/floor/pick-gate-toggle.tsx`. 0 ROADMAP hits, 0 CLAUDE_* hits.
- [M] **Tint "Base — No Tint" bypass.** c9ef1c31, d5fd1b58, 99175a99, 88f1dcfb, 4b9d321b, b93d9424, e12ce9e9. Code: `app/api/tint/manager/base-bypass/`. 0 ROADMAP hits, 0 CLAUDE_* hits.
- [M] **Tick expansion 2026-09-11 → 09-17**, after the User-based access section's 09-06 counts: `place_order_ship_to` (650f4b1e), one tick per Tint Manager panel tab (0fbcd4be), `reports_tint_summary`/`reports_ti_report` (6f628b05), `import_obd` as the only import rule (792efc52), `billing_*` (above). The section's "Derived state today" and counts predate all of it.
- [M] **Rebrand to Orbit violet** (3eed60e8 → 8598e81b; mobile masthead 872b380e, b51e6a15, e355eb51, 0db792a1). ROADMAP's only reference is the urgent-red leftovers item (l.1087). No follow-ups are listed, although rebrand commits mention pending items, e.g. 21807aca "non-destructive reds pending".
- [M] **`$transaction` sites ROADMAP does not list.** Listed today: challan, admin/customers, the two cancels. Not listed:
  - `app/api/admin/areas/[id]/route.ts:43`
  - `app/api/admin/permissions/route.ts:83`
  - `app/api/admin/shades/route.ts:40`
  - `app/api/admin/skus/route.ts:64`
  - `app/api/tint/manager/splits/create/route.ts:150`
  - `app/api/tint/manager/splits/reassign/route.ts:50` (live caller `tint-manager-content.tsx:614`)
  - `app/api/tint/operator/split/done/route.ts:56`
- [M] **The MRN module** (644dce96 → 92795eb0, photos b6d84b3d→b121c05e, OTR close fedf0563, delivery-on-lines 0ac5bcaa). ROADMAP mentions it only in the audit count "MRN 2" and the photo bypass. There is no MRN section; CLAUDE_MRN holds its own open items.
- [L] **Retired-but-kept files with no retirement item.** `components/tint/tint-table-view.tsx` and `components/tint/split-builder-modal.tsx` are listed as "RETIRED, NOT DELETED" at `components/tint/tint-manager-content.tsx:24-30`; order-detail-panel is the only one tracked (l.674). `lib/floor/suggest.ts` has no importer (`lib/floor/queries.ts:326-331`).
- [L] Picking features with no ROADMAP trace, probably fine if canon covers them:
  - colourWork and the Tinting section: ba03fc89, aeed851c, e2446c70
  - hardener gate: 6d61ce79 → caa2a06b
  - WhatsApp findings: fa0bac6c, ea7b117d
  - pick bundling behind `PICKING_GROUPING_ENABLED`: 467c2afe
  - early-release gate: 43b759a1
  - picking cancel: 00d7da22, af075572
  - operator History face: dfd9b669
- [L] Ops changes with no ROADMAP line: push quiet hours removed (a2523d16), TWA assetlinks (b020957c/14747252), Vercel Web Analytics (e2afa43f), admin sidebar rebuild to 20 items (0fc145bb).

###### GONE
- **Floor's left "Needs your decision" rail, and every item that assumed it.** CODE:
  - `components/floor/floor-rail.tsx`, `rail-card.tsx`, `rail-empty.tsx` and `tint-strip.tsx` were deleted by 79bcc412 (2026-09-13) (`git log --diff-filter=D`).
  - `components/floor/floor-page.tsx:878` `// ⚠ THE RAIL'S THREE HANDLERS WENT WITH THE RAIL (2026-09-10)`.
  - `lib/floor/queries.ts:326` `RAIL_SUGGESTIONS_ENABLED WAS HERE AND WENT WITH THE RAIL`.
  - b3dfe5b8 removed the release step.

  Affected ROADMAP items:
  - G1 "No undo of a release" (l.1288)
  - G3 "No bulk release/hold from the rail (The rail has no checkboxes)" (l.1291)
  - "Rail button reads lowercase 'pick slot'" (l.968). The string still exists at `dispatch-slot-picker.tsx:390`, used by the Hold tab etc., so re-scope it.
  - "the rail already has it" (l.966)
  - "P2 — Auto-confirm for HIGH-confidence suggestions ... on the rail" (l.1272). The suggestion layer has no importer.
  - "Tint split-OBD suggestions" and "`card.tint.completedAt` IST render" (l.1274-1276)
  - "Unmatched bills have no desktop home" (l.916), which should be re-evaluated against the new model.

  Note that CLAUDE_FLOOR §8 and the table at l.326 still describe the rail too; queries.ts:330-331 says so itself.
- **Mail Orders "Late-Evening / Night slot-summary auto-email gap — `slotDefs` trigger array"** (l.812). CODE: `grep -rn slotDefs app components lib` finds nothing. **c103d5f4** (2026-08-10) removed the slot-summary modal and its auto-trigger, and its message says "NOTHING WAS EVER SENT BY ANY OF THIS".
- **Tint "P1 — Surface partial-qty Done to TM: Badge on Completed Today section of Kanban"** (l.366) and **"P1 — Pause kebab on non-pending Table sections"** (l.372-374). The Kanban and its Table view are gone: `tint-manager-content.tsx:25` `components/tint/tint-table-view.tsx — the old Kanban table` is unimported. Restate both against the new board or close them. The partial-qty data question itself may still apply.

###### Post-Support-retirement cleanup: status of each item
- `/orders`: **still open.** `app/orders/page.tsx` is still `redirect("/floor")` with no gate.
- `dispatch_change_queue`: **still open.** `model dispatch_change_queue` is at schema.prisma:1534. The only code mention is a comment (`app/api/floor/ship-to/route.ts:13`), so it still has no reader.
- Master-data pages out of the old route group: open, P3.
- Dead exports in workflow-stages: **still open.** `stageRank` is called only at `lib/workflow-stages.ts:148`, inside `isSupportDone`. No external callers for `supportMayEdit()`/`isSupportDone()`; the other hits are comments.
- `SUPPORT_*` naming: open.
- Two TI Report page files: **still open.** Both page.tsx files exist, and the redirects are now at `next.config.mjs:33-34`.
- Five unused files: all five still exist. **`lib/slot-history.ts` is a brief-mandated SURVIVOR — do not list it for removal**, and the ROADMAP conflict note (l.1150-1153) should be settled in favour of KEEP.

###### Other open items confirmed still open at HEAD (no action)
- P0 seed: still does not seed `user_page_access`. The file now says so itself in comments, e.g. `prisma/seed.ts:186-188`.
- `requireRole` has no admin arm: `lib/rbac.ts:58-66`.
- The mrn/photo expression bypass: `app/api/mrn/photo/[photoId]/route.ts:167-168`.
- fetchAll: `customer-missing-sheet.tsx:118-129`.
- backfill-enrich requireRole ADMIN: :169.
- backfill-customers has no maxDuration.
- sub-areas `[id]` and import are still `requireSuperuser`.
- `/admin/permissions` and permissions-manager still exist.
- `ACCESS_SOURCE` switch: `lib/access/source.ts`.
- `role_permissions`/`user_roles` models remain.
- Router has no `/admin/access` row.
- StatusPopover and Create Split still have no live caller. Their only callers are the retired `tint-table-view.tsx` and `split-builder-modal.tsx`.
- `/api/order/data` is still public (`route.ts:6` "Public, unauthenticated endpoint").
- The `/po-v2-8f4kd2` redirect exists.
- `public/brand/` has five files, referenced only in a comment at `app/po2/manifest.webmanifest/route.ts:28-39`.
- `URGENT = "#DC2626"` is at `v2-data.ts:73`.
- Urgent is still red at `components/shared/status-badge.tsx:31` and `floor-table.tsx:~867`.
- Picking boards are still on the solid duplicate-SO fill.
- `app/reports/tint-summary/preview/` still exists.
- `/picking/push-test` is still there, linked from `picking-mobile-shell.tsx:235`.

###### Stale code comments spotted (claims about data)
- `lib/permissions.ts:127` `// /admin/customers uses the richer split view, the other three the same tables.` This describes the retired Support copies. ROADMAP already flags it (anchor :117).
- `components/floor/floor-page.tsx:884-886` says `/api/floor/release` is posted by nothing "on this screen". That is false: the same file posts to it at :1010 (Hold tab bulk release) and :1221.
- `app/api/floor/trips/[id]/dispatch/route.ts:6-13` "nothing on the floor writes `dispatched`". The route itself writes it (via `lib/floor/dispatch.ts:178`). It is only uncalled, so the claim holds only while no caller exists.

###### Confidence notes / could not verify without a login or DB
- The `billing_settings.rolloutStage` value, the live test-marked done bills, CI draft counts, the 19 short/zero-line OBDs, and the Floor backfill counts (73/85) all need a DB read. Not checked.
- The audit-trail "13 unwired" / "Tint 1 · MRN 2 ..." breakdown was not re-derived per route. There are 49 `logAdminAction(` call sites today, against 44 on 09-04 plus 4 on 09-06.
- Whether an external or depot script calls `operator/shades` can't be ruled out from the repo.

---

#### Second task — orphaned canon candidates (docs root / repo root)

| File | What it is | Referenced by a CLAUDE_*.md / router? | Recommendation |
|---|---|---|---|
| `FLOOR-TO-FLOOR-DISCOVERY.md` (repo root, 1,438 lines, **13 commits**, last 00ea0145 2026-09-18) | "Floor trip feature — discovery report". A "Where we are — 2026-09-15" block (l.7); data model, status values, state machine, buttons, permissions, broken bits, the pick-visibility gate traced end to end (§7), the rail and Release (§8), trip history (§9); open questions l.42/46, rejected idea l.120. | **No.** No CLAUDE_*.md, the router or ROADMAP mentions it. | **Fold into CLAUDE_FLOOR.md (new trips section) plus ROADMAP (open questions), then archive it.** Right now it is the only record of the trip desk, pick-gate, Show-to-floor, the Print-tab handoff and the no-release model. Its location (repo root, not docs/prompts/drafts) breaks the draft convention in ROADMAP "Documentation hygiene". This is the highest-value fold. |
| `docs/cron-notes.md` (99 lines, 1 commit, 2026-05-08) | Attendance cron schedules (UTC→IST) plus a "**Hobby tier 2-cron cap — IMPORTANT** ... We are at the cap". | No. | **Fold the schedule table into CLAUDE_ATTENDANCE / CORE §4, then retire it.** Its main claim is false: ROADMAP l.759-761 and CORE §4 say the count cap is 100 and the Hobby limit is cadence. A reader of this file would plan around a constraint that doesn't exist. |
| `docs/runbooks/reconciliation-method.md` (38 lines) | The locked reconciliation method v1.1. | Yes, router §4 item 4. | Keep as it is. It is a runbook, not canon. |
| `docs/runbooks/customer-intake.sql` | Reusable SQL template for customer intake. | Yes, CLAUDE_MAIL_ORDERS. | Keep. |
| `docs/sql-runbook/force-remove-stuck-obd.sql` | Single ops SQL. **Untracked.** | No. | Move it to `docs/runbooks/` and track it, and reference it from CLAUDE_IMPORT's landmines. Or delete it, owner's call. |
| `docs/presentation/orbit-walkthrough.html` (+ `superseded/`) | Client demo deck (bf499a94 … dc60e3ee, 2026-09-15). Modified in the working tree. | No. | Not canon. Leave it. |
| `docs/archive/` (context-bases 30, context-updates 23, uncategorised 8, README) | The old pre-canon context archive, separate from repo-root `archive/`. | No. | Not canon, but the two `archive/` trees are easy to confuse. Consider a one-line pointer in `archive/README.md`. |
| `docs/dhruv-review/` | Untracked review snapshot. | CORE l.1456 (excluded from tsc). | Nothing to do. |
| `docs/vl06O/`, `docs/fixtures/`, `docs/sample/`, `docs/elevenlabs/`, `docs/plans/*` (xlsx) | Data samples and media. `docs/plans` is referenced only by the ROADMAP OneDrive item. | — | Not canon. |
| `docs/prompts/drafts/code-discovery-2026-09-09-floor-trips.md` and other trip drafts | Drafts from the trip build. | — | Consolidate them with FLOOR-TO-FLOOR-DISCOVERY in the same CLAUDE_FLOOR pass. |

**Counts, ROADMAP.md: STALE 21 (2 H, 10 M, 9 L; the anchor bullet counts as one) · MISSING 11 (2 H, 6 M, 3 L) · GONE 3.**


---

## 5. New modules needing a canonical file

| # | Proposed file | Scope | Why its own file | Evidence of size / status |
|---|---|---|---|---|
| 1 | **`docs/CLAUDE_FLOOR_TRIPS.md`** | Orbit's own truck plan: `trips` / `trip_drops` / `trip_activity`, `lib/trips/*`, `/api/floor/trips/*`, trip numbering (`{T}-{YYMMDD}-{NN}`, cancelled frees its number), type choice, the drop key, desk control (`app_settings` pick gate + per-trip Show to floor), Send to billing, the dormant confirm and dispatch routes, and the rule that **no trip action changes a bill's status or hold** | Router §6: "module reaches production-live → own file". It has its own invariants. Folding it into TRIP_REPORT would merge two systems the code keeps apart on purpose (`app/api/floor/trips/route.ts:6-15`). **Not `CLAUDE_DISPATCH.md`**: "dispatch" already means the §7.4 engine, `orders.dispatchStatus` and the `dispatcher` role and route group | ~60 commits 09-09 → 09-18; 9 lib files (~2,650 lines); 10 components; 3 tables; 0 canon hits. Source material: `FLOOR-TO-FLOOR-DISCOVERY.md`, and the drafts web-update-09-09-floor-trip-module, web-update-09-09-trip-schema, code-discovery-09-09-floor-trips and code-update-09-10-trip-desk |
| 2 | **`docs/CLAUDE_PO2.md`** | `/po2` (live 2026-09-10), `/po9` (ship-to off, 2026-09-15), the `/po-v2-8f4kd2` redirect, both `manifest.webmanifest` handlers, `po2_*` localStorage (shared between /po2 and /po9), the favourites block, and the pack sort that differs from `/po`'s email for 6 products | Its own launch draft says "a new CLAUDE_PO2.md + router row are owed". There are now three order codebases (`/place-order`, `/po`, `/po2`). PLACE_ORDER still calls `/po` "going forward" | ~97 commits; `app/po2` ≈15.7k lines. Public via the `"/po"` prefix match |
| 3 | **`docs/CLAUDE_BILLING.md`**: ⚠ **owner decision** | Picking tab (`billing_picking`), Print tab (`billing_print`), action ticks (`billing_hold/slot/urgent/ship_to`), marker provider, notes font size, `invoicedAt` mark-done, `billing_settings` | The router records a **locked decision** that there is no CLAUDE_BILLING.md "while pilot-gated". Recorded evidence says the pilot ended on 2026-08-06 (`rolloutStage = ALL_USERS`: the c103d5f4 message, and a 2026-09-11 SELECT in a draft). If Smart Flow confirms ALL_USERS (§8 Q1), the lock's premise is gone and MAIL_ORDERS §23 (with the Table view now unreachable) should be extracted | 16 components/billing + 7 lib/billing + 9 api/billing commits since baseline |
| — | *Not new files*, but recommended as sections | the pick-bundling engine → PICKING; `applyNoMailOrderFallback` → IMPORT, owned there and cross-referenced from CORE/PICKING/TINT/FLOOR; "Base — No Tint" → TINT; per-user access and the 39 keys → stay in CORE §5/§7.14. CORE §5 is past the ~150-line extraction trigger, so a `CLAUDE_ACCESS.md` split is **optional** and an owner call |

**Retirement record owed (not a new canon file):** `archive/2026-09-floor-rail/` (79bcc412, 2026-09-13) needs a row in router §3 "Retired", in `archive/README.md` and in playbook §7b. This sweep does not touch `archive/`. Whoever writes the router row needs the owner's OK to edit the archive index.

**Orphan docs to fold, then retire:**
- `FLOOR-TO-FLOOR-DISCOVERY.md` (repo root) → CLAUDE_FLOOR_TRIPS / CLAUDE_FLOOR + ROADMAP.
- `docs/cron-notes.md` → ATTENDANCE / CORE §4. Its "2-cron cap" claim is false.
- `docs/sql-runbook/force-remove-stuck-obd.sql` (untracked) → move into `docs/runbooks/` or drop it; owner's call.

---

## 6. Drafts classification

Every one of the 72 files in `docs/prompts/drafts/` is classified below. For each draft that claims SHIPPED, a commit hash from `git log` was checked. **No draft claims a ship that could not be found in git.**

### Summary

| Type | Count | Status |
|---|---|---|
| code-update | 21 | **21 SHIPPED** (hash-proven). 6 later partly or wholly retired by code (floor pick grouping, floor oil grouping, board-render §1a/b, the floor tint-lock card half, the per-bill visibility gate, the po-v2-board move). trip-desk has been reworked beyond its own description. **Only 6 landed in canon; 14 did not.** The newest, `code-update-2026-09-18-picking-colour-work.md`, is a record of 5 shipped commits (ba03fc89, 0841b5c9, 2bcb47e9, aeed851c, e2446c70); nothing after it touches picking or tint |
| web-update | 10 | 8 IMPLEMENTED · 1 PARTIAL (08-28 admin-redesign: hardcoded permissions-manager, no phone field, `floor_access` in no file, `/admin/dispatch-cutoffs` not retired) · 1 **NOT IMPLEMENTED** (08-12 machine-naming: 17 "depot PC" hits across 7 canon files) |
| code-discovery | 31 | 23 CONSUMED (about 10 leave open residue, listed in the note column) · 2 OPEN (09-08 enriched-line-gap; 09-08 urgent-red-migration, deferred by owner) · 3 SUPERSEDED (08-15 import-overlap-baseline, 08-18 tint-manager-floor-parity, 09-11 hide-tags) · 3 REFERENCE (08-18 pick-grouping-evidence, 09-10 noslot-backlog, 09-12 po-v2-presentation-source) |
| code-resume | 1 | 09-08 trip-mirror-rewrite: Phase A CONSUMED (88bf9926) / **Phase B OPEN**, blocked on Q10 |
| sql | 2 | both **RUN**: schema.prisma mirrors them (b6d84b3d, 0ac5bcaa). The live residue is Q6 |
| csv / raw / html | 4 / 2 / 1 | REFERENCE. `unknown-sku-codes-2026-07-19.csv` is still cited by PICKING:920 and ROADMAP:1005, so **keep it**. The mockup belongs to code-update 08-20 dup-SO (shipped 57cd274d) |

### Supersession chains
- dup-SO 08-20 → 08-25 soft treatment on Floor surfaces
- web-update 08-28 admin-redesign → code-update 09-06 admin-shell + code-update 09-04 access
- web-update 08-31 access-plan → code-update 09-04
- web-update 09-06 rebrand colour section → web-update 09-06 colour-spec-v2
- web-update 08-20 MRN design → CLAUDE_MRN.md
- web-update 08-31 CI spec → CLAUDE_CI.md
- code-update 09-08 po-v2-board → code-update 09-10 po2 launch
- code-update 09-09 visibility-gate → slice 8 (791a2cd6). That draft names a `web-update-2026-09-09-picking-visibility-gate.md` it supersedes, **which does not exist**.
- discovery 08-15 overlap-baseline → 08-15 overlap-window-ladder
- discovery 09-11 hide-tags → 09-11 hide-tags-billing

### Drafts whose stated facts the code now contradicts
- The 09-09 trip-schema header still says "NOT RUN", but aead3c32 mirrors the applied DDL.
- The 08-06 floor-order-time premise was reversed by 2c71fa0b and 8a4c1973.
- The 09-09 floor-trip-module draft (l.162) says the mirror "deletes and reinserts", which is the pre-v27.24 behaviour.
- Date anomalies: 09-01 mail-orders-gate was committed 08-30; 08-31 ci-readiness cites "CORE v96 … 2026-09-01".

### Detail tables (worker output)


<!-- source: sweep worker out-drafts-update.md -->

### Drafts sweep: code-update / web-update / sql / mockup in docs/prompts/drafts/ (2026-09-18, read-only)

Method: read the header and status block of every file, plus the relevant sections. Checked every cited SHA against scratchpad/commits.txt and `git log`. Checked that the named files and identifiers exist at HEAD (ec6343ba) with `ls`, `git ls-tree` and `grep -rn`. Found deletions with `git log --diff-filter=D`. Checked whether each draft landed in canon by running `grep -l -F` for a distinctive term over docs/CLAUDE_*.md and ROADMAP.md.
Untracked (never committed) drafts: 08-11 tint-op-history, 08-20 dup-so_1, 08-25 board-render, 08-31 invoice-col, 09-06 admin-shell, 09-06 base-no-tint, 09-08 tint-lock, 09-09 visibility-gate, dup-so mockup, web 08-12, 08-20 mrn, 08-28 admin, 08-31 access-plan, 09-06 rebrand, 09-09 trip-schema.

Each "last canon commit" date below comes from `git log -1` on that file: FLOOR e9fcd612 (2026-08-26), PICKING 2027b1a4 (2026-09-04), TINT 233e88f9 (2026-09-06), PLACE_ORDER 7d8ceece (2026-08-05).

#### code-update-* (21)

| file | type | date | subject | status | proof | superseded by? | canon target + landed? |
|---|---|---|---|---|---|---|---|
| code-update-2026-08-11-tint-operator-history.md | code-update | 08-11 | History face on /tint/operator, one IST day of completed jobs | SHIPPED | dfd9b669 "tint(operator): add a History face", b2e7c78a, 5ce8d8ec; app/api/tint/operator/history/route.ts + components/tint/operator/history-panel.tsx exist | no | CLAUDE_TINT.md. **NOT landed**: "operator/history", "history-panel" and "History" all get 0 hits in TINT |
| code-update-2026-08-17-floor-pick-grouping.md | code-update | 08-17 | Floor "By group" view, Rule 1 exact-SKU bundling | SHIPPED, then **UI RETIRED** | 3e989cb5 "floor: By group view bundles waiting bills"; lib/floor/grouping.ts moved to lib/picking/grouping.ts in 3fdd0e13; floor-board.tsx deleted cdbf95b1 (slice 6); group-row.tsx deleted f41b52c9 | trip desk (bbb9628c, cdbf95b1). Residue: lib/floor/queries.ts:1163 still computes waitingSkus/oilSkus, and no components/floor file reads them (only picking-board-mobile.tsx:1898 reads them). Dead payload? | CLAUDE_FLOOR.md. Not landed ("By group"/buildPickGroups: 0 hits). Now moot: document it as retired, plus the dead server payload |
| code-update-2026-08-18-floor-oil-grouping.md | code-update | 08-18 | Rule 2 same-family (oil paint) bundling on Floor | SHIPPED, Floor UI **RETIRED** | 3fadb0c7 "floor: By group adds a second rule"; 3fdd0e13 engine to lib/picking; RULE2_ENABLED=true at lib/floor/queries.ts:352 | same as above; engine still live for Picking | FLOOR/PICKING. Not landed ("Rule 2", "oil paint", RULE2_ENABLED: 0 hits) |
| code-update-2026-08-18-picking-grouping.md | code-update | 08-18 | Pick bundles on supervisor Assign tab | SHIPPED (live) | 467c2afe "picking: Assign tab shows pick bundles"; PICKING_GROUPING_ENABLED=true lib/picking/queue.ts:237; consumer picking-board-mobile.tsx:1898 | no | CLAUDE_PICKING.md. **NOT landed** (PICKING_GROUPING_ENABLED, "bundl", "grouping": 0 hits in PICKING) |
| code-update-2026-08-20-duplicate-so-highlight_1.md | code-update | 08-20 | Solid-red duplicate-SO flag, Picking + Floor | SHIPPED | 4f21b7da (data, lib/picking/duplicate-so.ts), 57cd274d (screens), 2c54bdfb (picker board); components/shared/duplicate-so-tag.tsx | **Floor half superseded** by 08-25 soft treatment (bc232f72) | PICKING/FLOOR/UI. Partly landed: `hasDuplicateSo` in CLAUDE_UI.md only (l.1584 + footer); 0 hits in PICKING/FLOOR |
| code-update-2026-08-25-floor-board-render-and-dup-so.md | code-update | 08-25 | All-done strip, empty-slot state, ship-to pair, soft dup-SO | SHIPPED, **PARTLY RETIRED** | 07bc5104, 37a3a1f2, bc232f72 "floor: duplicate-SO goes soft". Ship-to pair still in lib/floor/types.ts:84-85. Soft tokens live in duplicate-so-tag.tsx. The all-done strip and empty state lived in floor-board.tsx, deleted in cdbf95b1; CarryoverBanner deleted in f41b52c9 | §1a/§1b superseded by trip desk | FLOOR/UI. Not landed: shipToOverrideName 0 hits; DUP_SO_SOFT only in ROADMAP |
| code-update-2026-08-25-floor-history-checked-arm.md | code-update | 08-25 | Floor History also matches checkedAt on the viewed day | SHIPPED (live) | 07bc5104 "Floor history: show what was CHECKED that day"; lib/floor/queries.ts:798 `checkedAt: { gte: anchorRange.start…` | no | CLAUDE_FLOOR.md. **Landed** (FLOOR l.61 "History: TWO arms under one OR"; same commit edited FLOOR) |
| code-update-2026-08-25-floor-history-detail-panel.md | code-update | 08-25 | History rows open a read-only detail panel | SHIPPED (live) | e9fcd612; detail-panel.tsx:386 `const readOnly = source === "history"` | no | CLAUDE_FLOOR.md §4.7. **Landed** (FLOOR l.169 "`history` — READ-ONLY") |
| code-update-2026-08-31-floor-invoice-column.md | code-update | 08-31 | INVOICE column (invoiceNo + date) after OBD on floor table | SHIPPED (live) | 697b193b "feat(floor): invoice column on the floor table"; lib/floor/format.ts exists; floor-table.tsx:282 `showInvoice = true` (the showSlot arm was later retired, see floor-table.tsx:24) | no | CLAUDE_FLOOR.md. **NOT landed** ("formatDateIST", "INVOICE column", "invoice": 0 hits in FLOOR) |
| code-update-2026-08-31-picking-sap-name-fallback.md | code-update | 08-31 | Picking card falls back to SAP dealer name | SHIPPED; the marker half was reverted (the draft's own §9 says so) | 47791643 "picking: fall back to the SAP dealer name"; 67393fd2 "remove the 'not in master' marker". Live at lib/picking/queue.ts:845-846 and :859 (dealerInMaster) | no | CLAUDE_PICKING.md. **NOT landed** (shipToCustomerName, dealerInMaster, "(Unmatched)": 0 hits in PICKING) |
| code-update-2026-09-04-user-based-access.md | code-update | 09-04 | Per-user ticks replace job titles; superuser flag | SHIPPED | c3cf726b, 95253ff7, 6c76c56a, 187980cb, 2f461f93, ff39fc71, b493f87c, b915c88e; lib/access/source.ts exists | supersedes web-update-08-31 plan | CORE §5/§7.14-15, UI §63. **Landed** (d99709b8, 0af680e4; user_page_access + ACCESS_SOURCE in CORE, UI, TINT) |
| code-update-2026-09-06-admin-shell-redesign.md | code-update | 09-06 | Admin sidebar 20 items/5 groups, app switcher, isSuperuser | SHIPPED | 44125138, 0fc145bb "rebuild sidebar to 20 items in 5 groups", 8d7a3bef "app switcher", 95b24352; admin-sidebar.tsx:237 takes isSuperuser + switcherItems | supersedes (part of) web-update-08-28 | CORE/UI. **Partly landed**: CORE l.1209 "admin sidebar … now gates on superuser". Nav shape and app switcher: 0 hits ("switcher" only hits a mobile mockup note, UI l.1480) |
| code-update-2026-09-06-tint-and-master-data.md | code-update | 09-06 | Tint + master-data routes gate on ticks; 57 bypasses removed | SHIPPED | cd0ed055, 64f897a9, 74c51869, 2b25a48f, d3211766, 65fd0e10, fbbe30bd | no | TINT §13, CORE §5/§13. **Landed** (233e88f9; `canSeeAllOperatorRows` in TINT) |
| code-update-2026-09-06-tint-base-no-tint.md | code-update | 09-06 | "Base — No Tint" bypass + Tinter Issue Pending rail | SHIPPED | c9ef1c31, d5fd1b58, 99175a99, 88f1dcfb, 4b9d321b, b93d9424, e12ce9e9; components/tint/manager/base-ti-panel.tsx exists | no | CLAUDE_TINT.md. **NOT landed** (exact "Base — No Tint", "isBase", "placeholder operator": 0 hits in canon) |
| code-update-2026-09-08-floor-tint-lock.md | code-update | 09-08 | Floor Hold/Cancel locked while tint job open | SHIPPED, **card half RETIRED** | 56db79b8, 4af18cc8. Panel half live at detail-panel.tsx:413-434. rail-card.tsx deleted in 79bcc412 ("the rail feed nobody read") | rail-card half gone with the bill rail. **Stale comment**: detail-panel.tsx:391/:393 still points readers at "rail-card.tsx", which no longer exists | CLAUDE_FLOOR.md. **NOT landed** ("tintLocked", "cancel from Tint Manager": 0 hits) |
| code-update-2026-09-08-po-v2-board.md | code-update | 09-08 | /po-v2-8f4kd2 board, drawer, Drafts/Sent screens | SHIPPED | d054a028 … 3c713282 (e.g. 1129427d, 61ee8cc7, a5767810); draft committed d69c3bc3 | **superseded** by code-update-09-10-po2 (folder moved to app/po2, 145b5f32); app/po-v2-8f4kd2/page.tsx is now a redirect | future CLAUDE_PO2.md (does not exist). Not landed (ROADMAP §"/po2" only) |
| code-update-2026-09-09-picking-visibility-gate.md | code-update | 09-09 | Floor holds waiting bills back from supervisor Assign tab | SHIPPED, **per-bill mechanism RETIRED** | 5fce9f31, 16eff3d5, 7e89e8fb, fdc03beb, 9a3671ec, 963665af, da80d657. The per-bill Show strip, POST /api/floor/pick-visible and stampPickVisibility were retired by 791a2cd6 "slice 8 — Show to floor is per trip". orders.pickVisibleAt is now unread (lib/picking/visibility-gate.ts:22) | superseded by slice 8 (per-trip shownAt). The web-update it claims to supersede (web-update-2026-09-09-picking-visibility-gate.md) **does not exist in drafts/** | PICKING/FLOOR/CORE. **NOT landed** ("pick-gate", "pickVisible", "held back", "app_settings": 0 hits in canon) |
| code-update-2026-09-10-po2-polish-and-launch.md | code-update | 09-10 | /po2 goes live; favourites, art, overlays, launch | SHIPPED | 34 SHAs incl. 145b5f32 "po-v2 goes live at /po2", a988ab41, 8954014a; app/po2 exists. Later: /po9 second mount (23804504) | no (extended by /po9) | Draft says a new **CLAUDE_PO2.md + router row are owed**. Neither exists. Only CLAUDE_UI.md (l.23/100/1516) and ROADMAP l.1524 mention /po2 |
| code-update-2026-09-10-trip-desk.md | code-update | 09-10 | Trip desk replaces floor board, trips/trip_drops schema | SHIPPED, then **heavily reworked** | aead3c32, cd6be71a, 04f4c97b, 769763e3, 1102ad1d, 8a44cd10, bbb9628c, e656ad80, 828b59ca, 53c3729a, a5bafb40, 7a66ac3e | Stale as a description. Later work: slices 1-10 (c539aae4 … 175c83fd), trip_activity c84f8faa, dispatch on confirm 3945e6d5 then its own press a501650f, release route removed 8eaa4663, redesign a8a8573e-20212fdb, add-to-trip 7966d24d-49b1e30c, mixed types 41c5dab8-ec6343ba | FLOOR/CORE/PICKING/TRIP_REPORT. **NOT landed** (trips/trip_drops/tripDropId: 0 hits in CORE §7; FLOOR unedited since 08-26) |
| code-update-2026-09-14-sap-paste-import.md | code-update | 09-14 | Paste SAP OBD list from clipboard; header import pill | SHIPPED | 37ceb57a "feat(import): paste the SAP OBD list from the clipboard"; the "View Audit" follow-up the draft called uncommitted is committed in c8528fa8 (import-modal.tsx:1046); route.ts:4634 sap-paste-preview | no | CLAUDE_IMPORT.md. **Landed** (c8528fa8, IMPORT v1.10, "sap-paste" + 37ceb57a cited at l.928) |
| code-update-2026-09-18-picking-colour-work.md | code-update | 09-18 | colourWork TINT/BASE word + read-only Tinting section | SHIPPED | ba03fc89, 0841b5c9, 2bcb47e9, aeed851c, e2446c70; draft committed 4771de51 afterwards; app/api/picking/tint-workload/{route.ts,marker} exist. The 7 later commits (b95b6eeb..ec6343ba) touch no picking/tint file | no. Open: §10 permissions question (a picker can GET /api/picking/tint-workload on picking canView) is **pending an owner decision** | CORE/PICKING/TINT/FLOOR/UI per its §"For consolidation". **NOT landed** (colourWork, "Tinting section", "TINT or BASE": 0 hits) |

#### web-update-* (10)

| file | type | date | subject | status | proof | superseded by? | canon target + landed? |
|---|---|---|---|---|---|---|---|
| web-update-2026-08-12-machine-naming.md | web-update | 08-12 | Split "depot PC" into dev laptop vs server PC | NOT IMPLEMENTED | No commit. `grep -ci "depot PC"` finds 17 hits: CORE 3, IMPORT 4, MAIL_ORDERS 3, NOTIFICATIONS 1, PICKING 2, SAMPLING 1, TRIP_REPORT 3. "server PC" / "dev laptop": 0 hits | no | CLAUDE_CORE.md §Infrastructure + all 7 files. Not landed |
| web-update-2026-08-20-mrn-module-design.md | web-update | 08-20 | MRN module design, schema v27.16 | IMPLEMENTED | 644dce96 schema, 050d2b29, 23027659, aad80730, ff083fe8, 0a8d4854, 3a5bdb1c, f0b39ff1, 114d783a, 554a3213 XLS/A4. **Diverged**: best-before retired 0b996572 (v27.17); deliveryNo moved header→lines 0ac5bcaa/8e70bc35; 4th status 'closed' 7efd3304 | **CLAUDE_MRN.md** (fb83fd3b, now v1.1) | Landed as CLAUDE_MRN.md. Draft is historical |
| web-update-2026-08-28-admin-redesign.md | web-update | 08-28 | Admin panel redesign: 13 decisions + 19-item nav | **PARTIAL** | Built: the nav (0fc145bb ships 20 items/5 groups, the design said 19), the app switcher 8d7a3bef, and /admin/access (6c76c56a). **Not built**: #1 permissions-manager.tsx:13/25 still hardcodes ROLES_CONFIG/PAGES_CONFIG; #4 no phone field on add/edit-user-sheet (grep "phone" 0 hits); #5 floor_access absent from lib/rbac.ts and prisma/seed.ts; #9 app/(admin)/admin/dispatch-cutoffs still exists (it is out of the nav, admin-sidebar.tsx:61); #12/#13 not verified | code-update-09-06-admin-shell (nav/switcher); code-update-09-04 access (#3 multi-role is moot under per-user ticks) | CORE/UI. Only the superuser gate landed (CORE l.1209) |
| web-update-2026-08-31-ci-module.md | web-update | 08-31 | CI Goods Return Note spec v3.3 | IMPLEMENTED | e8695f40 DB, fb87bbae lib+9 routes, fa5f98f9, a2a38d3f, 55c3cdc6 desk, 618f67fc auto-CI, 3b0d04b7 register. Diverged: UI rebuilt repeatedly (ec3daf6d, 32e43eb7). `returned_to_floor` is in the CHECK but written by nothing (per router) | **CLAUDE_CI.md** v1.0 4dcbc115 (now v1.1) | Landed ("ci_returns" in CI, CORE) |
| web-update-2026-08-31-mrn-photos-otr.md | web-update | 08-31 | MRN photos + OTR close (4th status) | IMPLEMENTED | b6d84b3d DB, 266c2799 storage, 969d918f camera, c6fd74f4 viewer, fedf0563 "the OTR punch — POST /close". Diverged: no kind picker, 5 per group (5e9e7834); photos moved to a header button with a badge (45ff3a87, b121c05e) | CLAUDE_MRN.md | Landed ("mrn_photos", "OTR" in MRN + CORE) |
| web-update-2026-08-31-user-based-access-plan.md | web-update | 08-31 | Verdict + plan: per-user ticks replace roles | IMPLEMENTED | Executed as code-update-09-04 (8 SHAs), continued by 09-06 (7 SHAs), 09-11/12 billing keys (38b545df, c73ee93b, a991a1c4), 09-16/17 ticks (f1dcfa58, 792efc52, 650f4b1e, 0fbcd4be, 6f628b05) | **code-update-2026-09-04-user-based-access.md** | Landed CORE §5 |
| web-update-2026-09-06-orbit-colour-spec-v2.md | web-update | 09-06 | Colour system v2: violet brand, tint to sky | IMPLEMENTED | 3eed60e8, 5daa58fc, c96157ea, 73a762e8 "tint moves from violet to sky", b585240f, 9b1654cc, 30b393e3, 2542f998; tailwind.config.ts:75 `600: "#7C3AED"`, :94-97 tint=sky. Later refinements: 872b380e pale masthead, 0db792a1 "one violet per screen" | supersedes the rebrand's colour section | CLAUDE_UI.md. Landed (brand-600, #7C3AED, sky; UI v5.30) |
| web-update-2026-09-06-orbit-rebrand.md | web-update | 09-06 | Rebrand to Orbit: name, wordmark, violet, tagline | IMPLEMENTED (colour § superseded) | 8fac2a67 "the product is called Orbit", 3564f083/de7453bb wordmark, 3b0490e6 icon, 6dd818c1 login with the tagline at app/login/page.tsx:97; "One system. Zero chaos" 0 hits. Diverged: the login panel design was dropped (48bd6c5d rings removed) | colour section → web-update-09-06-orbit-colour-spec-v2 | CLAUDE_UI.md. Landed ("Taking efficiency" in UI) |
| web-update-2026-09-09-floor-trip-module.md | web-update | 09-09 (rewritten 09-10) | Floor becomes trip board; decision record | IMPLEMENTED (Phase 1), since **diverged** | aead3c32..7a66ac3e (see trip-desk). After: 'loading' dropped from chk_trips_status (2026-09-14, schema.prisma:3152); trip_activity c84f8faa; show per trip 791a2cd6; cancelled trip frees its number 62ea5f1b; Send to billing + Print tab 22ced2d8; mixed-type trips 41c5dab8/1b1005c6 | partly by code (slices 1-10 + redesign + add-to-trip) | FLOOR/CORE/PICKING/TRIP_REPORT. **NOT landed** |
| web-update-2026-09-09-trip-schema.md | web-update | 09-09 | Trip module DDL proposal (trips, trip_drops, orders cols) | IMPLEMENTED (applied + mirrored) | aead3c32 "schema(trips): mirror the applied trip-module DDL"; schema.prisma model trips :3245, orders.tripDropId :1066, isRealTransporter :497. **The draft's own header still says "nothing applied … NOT RUN" (stale)**. Diverged: the `loaded` stage was cancelled, yet orders.loadedAt/loadedById are mirrored (schema.prisma:1085-1086) and no code reads or writes them | trip-module record says `loaded` was cancelled | CORE §7. **NOT landed** (trips/trip_drops: 0 hits in CORE) |

#### sql-* (2)

| file | type | date | subject | status | proof | superseded by? | canon + landed? |
|---|---|---|---|---|---|---|---|
| sql-2026-08-31-mrn-photos-otr.sql | sql | 08-31 (run 09-01) | chk_mrn_status +closed, mrn.closedAt/closedById, mrn_photos | RUN | schema.prisma mirrors it: mrn.closedAt/closedById :2579-2581, model mrn_photos :2796, storagePath @unique :2826. Commit b6d84b3d "mrn: photos + closed status — DB foundation" (committed the SQL too). **Confirm live** (the draft notes four constraint names were lower-cased on the real run and renamed by hand) | no | CORE §7 + CLAUDE_MRN.md. Landed |
| sql-2026-09-01-mrn-delivery-split.sql | sql | 09-01 | mrn_lines.deliveryNo + unique key swap | RUN | schema.prisma mrn_lines `deliveryNo String` (no default), `@@unique([mrnId, deliveryNo, lineNo])`, `@@index([mrnId, deliveryNo])`; mrn.deliveryNo kept as nullable legacy. Commit 0ac5bcaa (adds this SQL + schema). **Confirm live**, in particular whether the deferred Part-4/step-5 `DROP DEFAULT` was ever run (Prisma omits @default, the DB may still have DEFAULT '') | no | CORE/MRN. Landed ("deliveryNo" in MRN, CORE) |

#### mockup (1)

| file | type | date | subject | status | proof | superseded by? | canon + landed? |
|---|---|---|---|---|---|---|---|
| duplicate-so-highlight-mockup_1.html | mockup | 08-20 | "Duplicate SO Num — red card mockup" | Belongs to code-update-2026-08-20-duplicate-so-highlight_1 (it cites "option A of the mockup", l.96). That work is SHIPPED | 57cd274d "render hasDuplicateSo as the approved solid-red treatment", 2c54bdfb (picker) | Floor surfaces moved to the soft treatment in bc232f72; the phone keeps solid red (duplicate-so-tag.tsx header) | UI (hasDuplicateSo present) |

#### Counts
- code-update (21): all 21 SHIPPED. 6 of them were later **partly or wholly retired** by code: floor-pick-grouping, floor-oil-grouping (Floor UI), board-render §1a/b, floor-tint-lock card half, visibility-gate per-bill mechanism, po-v2-board (moved). trip-desk counts as stale-by-rework. Landed in canon: 6 (history-arm, history-panel, user-access, tint-master-data, sap-paste; admin-shell only partly). **Not landed: 14.**
- web-update (10): IMPLEMENTED 8, PARTIAL 1 (admin-redesign), NOT IMPLEMENTED 1 (machine-naming).
- sql (2): RUN 2 (schema.prisma mirrors both; live DB not queried).
- mockup (1): shipped (via code-update-08-20).

#### Top not-landed / partial items
1. **Floor trip desk (09-09 → 09-18)**: trips/trip_drops/trip_activity are absent from CORE §7, and CLAUDE_FLOOR.md has had no edit since 2026-08-26. It still documents the By-picker/By-group board (picker-card.tsx row at FLOOR l.328), which was deleted in cdbf95b1 and f41b52c9.
2. **/po2**: live and public since 145b5f32, with no CLAUDE_PO2.md and no router row, which its own draft says are owed. Also /po9 (23804504).
3. **colourWork + the Tinting section (09-17/18)**: 0 canon hits. Open owner decision on whether pickers may reach /api/picking/tint-workload.
4. **Tint "Base — No Tint" bypass and operator History**: shipped, with 0 hits in CLAUDE_TINT.md.
5. **Picking visibility gate**: now per-trip (791a2cd6). Picking grouping (467c2afe), SAP-name fallback and the dup-SO split between solid and soft have 0 hits in PICKING, FLOOR or CORE (the dup-SO fields do appear in CLAUDE_UI.md; the soft treatment only in ROADMAP). Plus the admin-redesign leftovers: hardcoded permissions-manager, no phone field, floor_access in no file, dispatch-cutoffs not retired.

Also flagged: lib/floor/queries.ts computes waitingSkus/oilSkus that no Floor component reads (probably dead payload). detail-panel.tsx:391/393 comments point to the deleted rail-card.tsx. orders.loadedAt/loadedById have no reader or writer. The trip-schema draft header says "NOT RUN" although it was applied.


<!-- source: sweep worker out-drafts-discovery.md -->

### Drafts sweep — code-discovery / code-resume / raw sections / CSVs (docs/prompts/drafts/)
### 2026-09-18 · READ-ONLY · HEAD ec6343ba · 38 files classified (31 code-discovery, 1 code-resume, 2 raw .md, 4 .csv)

Method: every draft's header, ask/verdict and tail were read (the large ones section by section). "Proof" hashes come from
scratchpad/commits.txt plus `git log --all -S`, and each one was checked against the file on disk. Where a draft is marked
UNTRACKED, it was never committed. `git log -1 -- <file>` returned nothing for it.

#### Counts
Each row gets exactly one primary status. Total: 38.
- CONSUMED: 24, including code-resume Phase A and billing-shell's page-key half. 11 of them leave an OPEN residue, listed in the note column.
- OPEN, as the primary status: 2 (enriched-line-gap · urgent-red-migration). Two more OPEN halves sit inside CONSUMED rows: code-resume Phase B and the billing-shell module-tab-strip.
- SUPERSEDED: 3 (import-overlap-baseline · tint-manager-floor-parity · hide-tags)
- REFERENCE: 9 (pick-grouping-evidence · noslot-backlog · po-v2-presentation-source · 2 raw sections · 4 CSVs)

#### Table

| file | type | date | subject | status | proof | note (canon landing) |
|---|---|---|---|---|---|---|
| code-discovery-2026-08-06-floor-order-time-source.md | code-discovery (UNTRACKED) | 2026-08-06 | Floor shows email time, not SAP punch time | CONSUMED | 2c71fa0b "fix(floor): detail panel OBD date prefers obdEmailDate…"; 8a4c1973 "show email time … only for same-day mail matches"; a9966e5d "Hold/Cancelled tabs prefer obdEmailDate" | The draft's premise, that Floor always shows `orderDateTime`, is **now contradicted by the code**: `lib/floor/format.ts:181-195` is a resolver, and `lib/floor/queries.ts:1247,1336` read `obdEmailDate ?? orderDateTime`. **The canon was never updated.** CLAUDE_FLOOR.md §10 (L307) still says "The floor row displays `orderDateTime` while the slot was decided by `obdEmailDate`". That is STALE [M]. The FLOOR canon has not been committed since e9fcd612 (08-26) |
| code-discovery-2026-08-15-import-overlap-baseline.md | code-discovery | 2026-08-15 | Import-batch SKU overlap too thin to group | SUPERSEDED | Its verdict was reversed by code-discovery-2026-08-15-overlap-window-ladder.md, whose header says "REPLACES THE MEASURE OF". Committed d50c1a6e | Evidence only. Its "NOT worth building" verdict must not be quoted |
| code-discovery-2026-08-15-overlap-window-ladder.md | code-discovery | 2026-08-16 (filename says 08-15) | Half-day containment: grouping IS worth building | CONSUMED | 3e989cb5 "floor: By group view bundles waiting bills that share SKUs"; 3fadb0c7; 3fdd0e13 "picking: own the pick-bundling engine"; 467c2afe "Assign tab shows pick bundles" | **The Floor half is now GONE.** `group-row.tsx` and `picker-card.tsx` were deleted in f41b52c9 (09-15). **The Picking half is live**: `lib/picking/grouping.ts`, and `PICKING_GROUPING_ENABLED = true` at `lib/picking/queue.ts:237`. **MISSING from canon:** CLAUDE_PICKING.md has no hit for grouping, bundle or PICKING_GROUPING. The ship records exist only as the drafts code-update-2026-08-18-* [H] |
| code-discovery-2026-08-18-pick-grouping-evidence.md | code-discovery (transcription) | 2026-08-18 | Evidence and rejected ideas behind pick-grouping rules | REFERENCE | d50c1a6e "docs: records the evidence behind the pick-grouping rules" | It records three discrepancies (1,106 vs 1,093; ladder dated 08-16; …). The §7 rejected ideas and the §8 roadmap items (pack-family key, zoning) should be pointed to from CLAUDE_PICKING / ROADMAP. **No pointer exists**: "pick-grouping-evidence" returns zero hits in canon |
| code-discovery-2026-08-18-tint-manager-floor-parity.md | code-discovery (UNTRACKED) | 2026-08-18 | TM vs Floor parity audit, 8 doc/code disagreements | SUPERSEDED | Overtaken by the code: 9dcc3d96 "tint: rebuild the Tint Manager board — rail + one grouped table" (09-05) and bbb9628c "the trip desk replaces the board" (09-10) | It made no recommendations. Its drift items #2/#3 (Floor's four pivots, group-row) are **moot**, because those components were deleted (f41b52c9). It also gives an outdated reading of router §4.4 (stop on a stamp mismatch), which v1.12 rewrote |
| code-discovery-2026-08-21-picking-board-v2.md | code-discovery (UNTRACKED) | 2026-08-21 | Five supervisor-board changes: routes, route-vs-area, picker sheet, Picking tab, search | CONSUMED | f7c8d232 "route sheet lists only present routes · cards show route not area"; ffbe85e2 "picker count counts OPEN bills"; 663c538f "search matches picker · route · area"; adcc212d "Picking tab becomes three levels"; 05d4ca21 | **The canon lags.** CLAUDE_PICKING.md L424 still says "where-row = route dot + area", but the code at `components/picking/picking-board-mobile.tsx:842` says "ROUTE, not area (2026-08-21)". L406 describes the Picking tab as a flat list filtered by picker, not the three-level tab from adcc212d. Both are STALE [M] |
| code-discovery-2026-08-28-admin-panel.md | code-discovery (UNTRACKED) | 2026-08-28 | 31 admin pages audited; sidebar and dead data | CONSUMED | 44125138 "sidebar visibility now asks isSuperuser"; 0fc145bb "rebuild sidebar to 20 items in 5 groups"; 8d7a3bef "app switcher" (all acted on via the 09-06 admin-shell draft) | Canon: the superuser sidebar is at CORE L1209. **OPEN residue:** §7 dead tables (old `sku_master`, `product_category`, `product_name`, `base_colour`, `shade_master`), parked in ROADMAP:1033. `app/api/tint/operator/shades/route.ts` still writes `shade_master` (unchecked) |
| code-discovery-2026-08-30-permission-actions.md | code-discovery (UNTRACKED) | 2026-08-30 | Which canView/canEdit/… flags are actually read | CONSUMED | 0f56eede "mail-orders: gate 11 write routes on mail_orders/canEdit"; 74c51869 "tint: canEdit on three write routes" | **OPEN residue:** 19 mutating routes that check only for a session. They are tracked in ROADMAP §"P1 — Step 6" and §"silent-403". It also asks for a CORE §13 two-part correction, which I did not re-verify |
| code-discovery-2026-08-31-ci-module-readiness.md | code-discovery (UNTRACKED) | 2026-08-31 | CI module step-0: numbering, invoice search, permissions | CONSUMED | e8695f40 "ci: database foundation"; fb87bbae "lib/ci/* and all nine API routes"; 55c3cdc6 "billing desk face + nav entry" | It landed in CLAUDE_CI.md v1.0 (4dcbc115). The spec it was asked to check never existed (§0). Its header cites "CORE v96 … updated 2026-09-01" in a draft dated 08-31. **Date anomaly** |
| code-discovery-2026-08-31-role-census.md | code-discovery (UNTRACKED) | 2026-08-31 | 422 role-reading sites, sorted for the per-user move | CONSUMED | 6c76c56a "access: per-user access screen"; 2f461f93 "read permissions from user_page_access behind ACCESS_SOURCE"; b493f87c/b915c88e "superuser flag"; 0af680e4 | Canon: CORE §7.14/§5 (d99709b8, 0af680e4). **OPEN residue:** (a) Q7: `RoleSidebarRole` (`components/shared/role-sidebar.tsx:18-29`) **still lacks** admin, dispatcher, floor_supervisor, picker, logistics and floor_access, so the sidebar heading renders empty for those roles [H]. (b) The 70-write actor gap has only partly closed; ROADMAP P1 still lists 13 routes with no actor |
| code-discovery-2026-09-01-mail-orders-gate.md | code-discovery | header 2026-09-01; committed 2026-08-30 | Gating 11 MO write routes blocks nobody | CONSUMED | 0f56eede "mail-orders: gate 11 write routes…" (08-30); 158f64b2 "docs: correct stale tint_manager mail_orders view-only claim" | **Date anomaly:** the header says 09-01, but the file was committed in 158f64b2 on 2026-08-30. The canon was fixed in CORE and MAIL_ORDERS (158f64b2) |
| code-discovery-2026-09-06-admin-shell-state.md | code-discovery (UNTRACKED) | 2026-09-06 | Admin nav state before rebuild; job-title filter | CONSUMED | 44125138, 0fc145bb, 8d7a3bef, 95b24352 "drop the content offset below md" | **OPEN residue:** Q7. `app/(admin)/admin/roles/page.tsx:14` still says "Seeded at setup — 7 system roles", but live `role_master` has 13 (per the draft's SELECT) [L]. Also Q8, five inert page keys on /admin/access (not re-verified), and Q9, the second AdminLayoutClient mount in `app/(ops)/layout.tsx` |
| code-discovery-2026-09-06-colour-inventory.md | code-discovery | 2026-09-06 (+ 2 corrections 09-09) | Teal stocktake: six vectors, 520 teal lines | CONSUMED | 3eed60e8 "Rebrand step 1"; 5daa58fc "step 2a"; c96157ea "step 2b"; b585240f; corrections 427ab5f1, a8f58dd1 | Landed in CLAUDE_UI (rgba vector present; last UI commit 0db792a1, 09-17). Its paired-signal rule is recorded (a8f58dd1) |
| code-discovery-2026-09-06-master-data-gate.md | code-discovery | 2026-09-06 | Master-data role arrays: who loses, who gains | CONSUMED | d3211766 "admin: master-data routes gate on ticks"; 65fd0e10 "rbac: remove redundant admin bypasses"; 2b25a48f "tint: fix manual-entry lookup left behind" (the §3a defect) | Canon: 233e88f9 (CORE/TINT). OPEN questions: sub-areas POST superuser vs canEdit, and a routes_areas grant for 2 users. Its Q3 ("retire the four /dispatcher screens?") must **not** be acted on without an owner decision. They are brief-listed survivors and stay documented as live |
| code-discovery-2026-09-06-tint-conversion-gate.md | code-discovery | 2026-09-06 | Tint routes: u20 loses access, superuser gains | CONSUMED | cd0ed055, 64f897a9 "tint: gate write routes on per-user ticks", 74c51869, fbbe30bd "tint: read routes gate on ticks" | Canon: 233e88f9 (CORE, TINT). Q4 (does canView imply write, per the `manager/orders/[id]/remove` comment) is still an open design question |
| code-discovery-2026-09-08-enriched-line-gap.md | code-discovery (UNTRACKED) | 2026-09-08 | import_enriched_line_items missing on manual-SAP/patch paths | **OPEN** | no commit found: `git log --all -S'NOT 1:1'` is empty, and no commit touches enriched writes after 09-08 | Option A (a landmine in IMPORT §14 plus a comment at `app/api/orders/[id]/detail/route.ts:107`) **was not done**. **The canon states the opposite of the code:** CLAUDE_IMPORT.md L191 says "`rawLineItemId @unique` guarantees 1:1". The draft proves the manual-SAP and patch paths never write enriched rows (~2,666 bills). STALE [M]. ROADMAP P3 (54714f72) marks the one reader (`orders/[id]/detail` plus `order-detail-panel.tsx`) as dead code |
| code-discovery-2026-09-08-import-qty-integrity.md | code-discovery (8 sessions) | 2026-09-08 | SAP batch sub-item qty, header drift, empty-payload | CONSUMED | 25fc3c99 "a parent delivery item stands down…"; a290c116; 9188699a "record when header UnitQty disagrees"; a11bf7ee "skip an OBD whose payload carried no lines"; eb34532c; d8fcf1ed "carve volume-zero header-only imports out" | **MISSING from canon [H]:** none of the six commits, and none of `lib/import-upsert` rule P, `lib/import-qty-guard.ts`, the empty-payload skip or the volume-zero carve-out, appears in CLAUDE_IMPORT.md (grep for the hashes, "qty guard", "empty payload" and "stands down" finds nothing). They are only in this draft and ROADMAP:583-603. **OPEN residue:** Defect B. `lib/import-upsert/header.ts` has no `totalUnitQty`/`grossWeight` handling, so the header is never recomputed; its gate FAILED ("do not proceed as scoped"). Also the 19 bills with lost lines (ROADMAP P1) and the unwritten line weights (ROADMAP P1) |
| code-discovery-2026-09-08-trip-mirror.md | code-discovery | 2026-09-08 | Puller path wrong; fetchedAt readers; draft corrections | CONSUMED | 88bf9926 "schema v27.24 — trip mirror: hash-gated upsert"; aa525bd4 "docs: TRIP_REPORT v1.2 — ten corrections" | Landed in CLAUDE_TRIP_REPORT (rowHash, mirror_heartbeat, puller path L32). **OPEN:** Q9, deleting the obsolete `nts trip report` copy (recorded as a landmine at TRIP_REPORT:331). Q10, a plaintext DB password in `docs/dhruv-review/-Dhruv.env` (untracked, OneDrive-synced) [H, security]. Q11, index map names |
| code-discovery-2026-09-08-urgent-red-migration.md | code-discovery | 2026-09-08/09 | Move Urgent from red to amber at 12 sites | **OPEN** (deferred by owner) | §6 done only: 6aa4e41e "red is error and destructive only — four non-destructive controls". No commit for §1 | **Urgent is still red in the code:** `components/shared/status-badge.tsx:31` `urgent: "bg-red-50 text-red-700 …"`, `components/floor/floor-table.tsx:867`, and `components/picking/bill-symbols.tsx:67` ("URGENT STAYS RED"). CLAUDE_UI v5.21 §1 states the rule (urgency is amber) and L100 calls it "a migration list", so the canon correctly says the migration is pending. Only /po2 is migrated (bba21b8c) |
| code-discovery-2026-09-09-floor-trips.md | code-discovery (UNTRACKED) | 2026-09-09 | Floor dates, stages, drops, By-picker, masters for trips | CONSUMED | aead3c32 "schema(trips): mirror the applied trip-module DDL"; cd6be71a; 04f4c97b "By trip view"; bbb9628c "the trip desk replaces the board"; f41b52c9 (By-picker components deleted) | **MISSING from canon [H]:** CLAUDE_FLOOR.md was last committed 08-26 (e9fcd612). It has no trip desk, no `trip_activity` and no pick-visibility gate (`pickVisibleAt`; zero canon hits). **GONE:** FLOOR L328 describes `components/floor/picker-card.tsx`, "the view /floor LANDS on", but that file was deleted in f41b52c9. Its §G records the doc/code drift |
| code-discovery-2026-09-10-dates-weight-orphans.md | code-discovery (UNTRACKED) | 2026-09-10 | Date rule, per-bill KG, 16 components orphaned by bbb9628c | CONSUMED | e656ad80 "every row says when it's due, and what it weighs"; 828b59ca; orphans deleted in 79bcc412, cdbf95b1, f41b52c9 | **OPEN residue:** three C1 roots are still on disk with **no importer**, only comment mentions: `components/floor/assign-bar.tsx`, `assign-context-banner.tsx` and `trip-selection-bar.tsx` (`floor-page.tsx:19-22` and `floor-bottom-bar.tsx:5` say so in comments) [L] |
| code-discovery-2026-09-10-noslot-backlog.md | code-discovery | 2026-09-10 | Retiring the rail: only 161 bills are truly unreleased | REFERENCE | Committed in ba57d706 with the trip-desk code-update; it fed bbb9628c. Its own §C cleanup is marked "DEAD — DO NOT RUN" | Evidence only. The 2,706 → 161 correction is the reusable fact. It fed the pending-support draft |
| code-discovery-2026-09-11-pending-support.md | code-discovery (UNTRACKED) | 2026-09-11 | 711 bills/month stuck at pending_support without a mail order | CONSUMED | b3dfe5b8 "feat(import,tint): every bill reaches the floor on its own — no release step" (applyNoMailOrderFallback) | **MISSING from canon [H]:** `applyNoMailOrderFallback` has zero hits in any CLAUDE_*.md. CORE §7.4/§9 and IMPORT still describe `applyMailOrderEnrichment` as the only writer of `dispatchStatus`. **OPEN:** F1.3, the SMU gate for Offtake/Projects/Distributor (owner decision) |
| code-discovery-2026-09-11-billing-action-ticks.md | code-discovery | 2026-09-11 | Hold/slot/urgent/ship-to as per-user ticks | CONSUMED | c73ee93b "access: register billing action keys…"; a991a1c4 "billing: gate hold/slot/urgent/ship-to on per-user ticks" | The keys are in CORE (c73ee93b). **MISSING** from CLAUDE_MAIL_ORDERS §23, whose last commit is 158f64b2 (08-30) [M]. The D.4 risk that Floor's doors stay open is not recorded anywhere |
| code-discovery-2026-09-11-billing-shell-picking-key.md | code-discovery (UNTRACKED) | 2026-09-11 | billing_picking key plus a consolidated desk shell | CONSUMED (key) / OPEN (shell) | 38b545df "register billing_picking page key"; 9bc027a9 "Picking tab gates on billing_picking". Shell: `git log --all -S'module-tab-strip'` is empty | Build steps 11-13 (`components/shared/module-tab-strip.tsx`, mounted /ci → /mrn → /mail-orders) **never built**. The prototype `depotshell_5.html` never existed (§0.1). Separately, the Print tab shipped via `billing_print` (22ced2d8) |
| code-discovery-2026-09-11-hide-scope-access.md | code-discovery | 2026-09-11 | Hide switches scoped to everyone/role/user | CONSUMED | fb2f3853 "hide scope: SQL (not yet run) + Tags scope mockup"; abd495f4 "hide: 'Who sees it' scoped tag switches + 6 billing tags" | **The canon is stale [H]:** CLAUDE_CORE.md L941 says `app_tag_settings … tagKey TEXT UNIQUE, isEnabled …`, but `prisma/schema.prisma:1188-1200` now has `scope String @default("everyone")`, `roleSlug`, `userId`, and no unique on tagKey |
| code-discovery-2026-09-11-hide-tags.md | code-discovery | 2026-09-11 | Missing MO hide tags plus a notes tag (old face) | SUPERSEDED | By code-discovery-2026-09-11-hide-tags-billing.md, whose line 1 reads "Supersedes … (wrong scope — old face…)" (88220e5f) | Do not act on it |
| code-discovery-2026-09-11-hide-tags-billing.md | code-discovery | 2026-09-11 | Hide tags on the billingV2 face | CONSUMED | abd495f4 "+ 6 billing tags"; f1dcfa58 "filter chips follow the same switches" | **MISSING** from CLAUDE_MAIL_ORDERS §21 (tag-gating), last committed 08-30 [M]. Its warning, that hiding Hold leaves no hold signal on the Billing face, is not in canon |
| code-discovery-2026-09-12-po-v2-presentation-source.md | code-discovery (UNTRACKED) | 2026-09-12 | /po2 source material for a client deck | REFERENCE | Fed docs/presentation (77f857cd "single end-to-end walkthrough", 1ad8e670 retires superseded decks) | **MISSING from canon [H]:** CLAUDE_PLACE_ORDER.md was last committed 7d8ceece (08-05) and has no `/po2`. The live routes `app/po2`, `app/po9` and the `app/po-v2-8f4kd2` redirect are mentioned only in UI/ROADMAP. The draft's §H lists the doc/code drift |
| code-discovery-2026-09-14-mail-orders-desktop-presentation-source.md | code-discovery (UNTRACKED) | 2026-09-14 | Billing desk source for Part 2 of the deck | CONSUMED | bf499a94 "docs(presentation): billing desk walkthrough for client deck"; 77f857cd | Presentation only; no canon target. Its §I privacy list (real staff names, inbox addresses) matters for any republish |
| code-discovery-2026-09-16-filters-and-import.md | code-discovery | 2026-09-16 | Filter chips follow tag switches; import_obd tick only | CONSUMED | f1dcfa58 "billing: filter chips follow the same switches…"; 792efc52 "import: the import_obd tick is the only rule for who can import" | **The drift it listed is still in canon/code:** CORE L1087 "one of the 27 ALL_PAGE_KEYS values" (billing_picking, billing_print, 4 billing action keys, place_order_ship_to, reports_* and tint panel ticks have been added since); `lib/permissions.ts:429` stale comment "THE CHECKS THESE ANTICIPATE DO NOT EXIST YET" (a991a1c4 wired them); MAIL_ORDERS L903 "requireRole/hasRole are unused". CORE §5 `import_obd` row (L265) vs 792efc52 not re-verified |
| code-resume-2026-09-08-trip-mirror-rewrite.md | code-resume | 2026-09-08 | Trip mirror hash-gated upsert, Phase A SQL plus Phase B | Phase A CONSUMED / Phase B **OPEN** | 88bf9926 "schema v27.24 — trip mirror: hash-gated upsert replaces delete-and-refill"; aa525bd4 (TRIP_REPORT v1.2 carries the §8 corrections) | Phase B (PowerShell puller) is BLOCKED: the live puller host is unidentified. TRIP_REPORT:232 confirms `trip_mirror_ping` is "written for Phase B and currently uncalled" |
| _ladder-raw-sections.md | raw script output (UNTRACKED) | 2026-08-16 | Raw ladder tables for the window-ladder draft | REFERENCE | Written by `scripts/analysis/import-overlap-baseline.ts:840` | It duplicates the ladder draft's tables. Referenced only by the script. Regenerable |
| _overlap-raw-sections.md | raw script output (UNTRACKED) | 2026-08-16 | Raw baseline tables (6,375-bill re-run) | REFERENCE | Written by `scripts/analysis/import-overlap-baseline.ts:436` | This is the 08-16 re-run of the superseded baseline (6,375 bills, not the draft's 6,484). Referenced only by the script |
| overlap-clusters-w2-2026-08-15.csv | csv evidence | 2026-08-16 | 252 W2 day-clusters (bills, savings, routes) | REFERENCE | d50c1a6e; written by the script at L62 | Supports the ladder draft §W2. Referenced only by the script and the ladder draft |
| overlap-pairs-2026-08-15.csv | csv evidence | 2026-08-15 | 412 batch pairs sharing ≥2 SKUs | REFERENCE | d50c1a6e; script L60 | Supports the SUPERSEDED baseline. Referenced by the script and the baseline draft |
| overlap-pairs-w2-containment-2026-08-15.csv | csv evidence (1.2 MB, head only) | 2026-08-16 | ~15k W2 pairs with containment scores | REFERENCE | d50c1a6e; script L63 | Supports the ladder draft. Referenced only by the script and the ladder draft |
| unknown-sku-codes-2026-07-19.csv | csv evidence (head only) | 2026-07-19 | 309 raw SAP codes absent from both catalogs | REFERENCE | da5e8e06 | **Still referenced by canon:** CLAUDE_PICKING.md:920 and ROADMAP:1005 ("leave it where it is"). Keep it |

#### Drafts whose live-data or code facts the code now contradicts
- 08-06 floor-order-time: its premise ("always `orderDateTime`") is reversed by 2c71fa0b and 8a4c1973. See `lib/floor/format.ts:181-195`.
- 08-15 import-overlap-baseline: its "not worth building" verdict was reversed by the ladder draft.
- 08-18 tint-manager-floor-parity: describes Floor pivots, group-row and picker-card, all deleted in f41b52c9. It also describes the pre-rebuild TM board.
- 09-10 dates-weight-orphans: of the 16 orphans it lists, 13 are gone. Three roots remain on disk.
- 08-31 role-census §8 notes its own 08-28 counts disagreed (21 vs 20 users; 12 vs 13 roles). That was re-measured, not settled.

#### Drafts that claim a SHIPPED item
- import-qty-integrity claims commits 25fc3c99, a290c116, 9188699a, a11bf7ee and d8fcf1ed. **All five were verified in commits.txt.** It says "Still unpushed". HEAD contains them, but push state was not checked (read-only).
- colour-inventory claims `c96157ea` and `b585240f`. Both were verified.
- trip-mirror and code-resume claim nothing shipped at write time. 88bf9926 later shipped Phase A.
- No draft claims a ship that I could not find.


---

## 7. Proposed batch plan

**Rule: each file is owned by exactly one batch.** A batch may *read* anything but *writes* only its own files. Cross-file pointers ("see CLAUDE_FLOOR_TRIPS §x") are written by the owner of the file that contains them.

**Run order:** **N → (A ‖ B) → C.**
- N writes the new files first, so A and B can point at them.
- C (CORE/UI/router/ROADMAP) runs last. It indexes everything and mints the missing schema versions.
- A and B can run in parallel because they share no file.

| Batch | Owns (writes) | Main inputs | Key changes |
|---|---|---|---|
| **N: new files** | `docs/CLAUDE_FLOOR_TRIPS.md` (new) · `docs/CLAUDE_PO2.md` (new) · `docs/CLAUDE_BILLING.md` (new, **only if** §8 Q1 confirms ALL_USERS and the owner lifts the router's lock) | `FLOOR-TO-FLOOR-DISCOVERY.md`, trip drafts, §3 schema, `out-floor-trip` findings; po2 drafts; `out-mail-orders` §23 findings | Write from **code + read-only SELECTs**, never from drafts. Each new file starts with the naming-collision table (trips vs trip_report vs /trips) or the three-order-pages table. New files carry the schema stamp of the CORE version they were reconciled against (v27.24 until C mints more) |
| **A: Floor / Picking cluster** | `CLAUDE_FLOOR.md` (rewrite around the trip desk; mark the rail, slot tabs, By picker and assign bar retired; `floorBoardWhere` 4 arms; History by-trip arm) · `CLAUDE_PICKING.md` · `CLAUDE_NOTIFICATIONS.md` · `CLAUDE_TRIP_REPORT.md` | `out-floor-trip`, `out-picking-notif`; drafts code-update 08-17/08-18 (grouping), 08-20/08-25 (dup-SO), 08-31 (SAP name, invoice column), 09-08 (tint lock), 09-09 (visibility gate, superseded by slice 8), 09-18 (colour work); discovery 08-21 (board v2) | PICKING: no Release step, gate, bundling, cancel, Tinting feed, colourWork, hardener, bay, early-release rule. NOTIFICATIONS: third trigger, `urgency:"high"`, push-test, manifest landmine. TRIP_REPORT: disambiguation + downstream borrowers |
| **B: Intake / Tint / Returns / Orders cluster** | `CLAUDE_MAIL_ORDERS.md` · `CLAUDE_IMPORT.md` · `CLAUDE_TINT.md` · `CLAUDE_SAMPLING_LIBRARY.md` · `CLAUDE_MRN.md` · `CLAUDE_CI.md` · `CLAUDE_PLACE_ORDER.md` · `CLAUDE_ATTENDANCE.md` | the `out-mail-orders`, `out-import-mrn-ci`, `out-tint-sampling` and `out-po-attendance` findings; drafts 09-06 base-no-tint, 08-11 operator history, 09-08 import-qty-integrity, 09-08 enriched-line-gap, 09-11 hide-tags-billing, 09-11 billing-action-ticks, 09-16 filters-and-import | IMPORT owns `applyNoMailOrderFallback` + qty guard + rule P + `/api/import/access`. TINT: completion → `pending_picking`, Base bypass, panel and report ticks. MAIL_ORDERS: drop "pilot" (pending Q1), §21 scoped tags, §22 per-user, §23 → pointer to CLAUDE_BILLING if N creates it. CI: remove "URL only". ATTENDANCE: gate removed, OT enum case. PLACE_ORDER: targeted fixes + pointer to CLAUDE_PO2. `docs/cron-notes.md` folds into ATTENDANCE. *(B is large; if it has to split, split it B1 = MAIL_ORDERS/IMPORT/MRN/CI and B2 = TINT/SAMPLING/PLACE_ORDER/ATTENDANCE, still one owner per file)* |
| **C: CORE / UI pass** (last) | `CLAUDE_CORE.md` · `CLAUDE_UI.md` · `CLAUDE.md` (router) · `docs/ROADMAP.md` | `out-core`, `out-ui`, `out-roadmap`; §3 of this report | CORE: mint the missing versions (app_settings/pickVisible, trips DDL, notesFontSize, bayNumber, mo_orders.updatedAt, tag scope, trip_activity, isRealTransporter) in commit order after a live SELECT; §5 to 39 keys + ACTION_PAGES + REPORT_PAGE_KEYS; §7.10 tag scope; §12 Floor/CI/Reports/public `/po*`; §13 landmines closed or added. UI: teal → violet foundations, tokens, §57 "Who sees it", §63 counts, admin shell, §62.4 deleted files. Router: /ci and /floor rows, new rows for FLOOR_TRIPS / PO2 / (BILLING), floor-rail retired row. ROADMAP: reconcile both date stamps, close shipped items, add trips / Print / gate / Base bypass follow-ups |

**Not in any doc batch** (separate, explicitly-instructed tasks):
- the stale-comment pass (§4 list)
- the live defects in §4
- orphan deletions (which need an explicit instruction)
- archive index rows (which need the owner's OK)
- the `docs/dhruv-review` credential issue in §8

**Stamp discipline for every batch:** bump a file's schema stamp only as the output of reconciling that file against the CORE version named. Never as a tidy-up (router §4).

---

## 8. Open questions for Smart Flow (need a login or a read-only SELECT)

| # | Question | Why it matters | Suggested check |
|---|---|---|---|
| Q1 | Is `billing_settings.rolloutStage` = **ALL_USERS**? | Decides whether MAIL_ORDERS §23 / the router still say "pilot", whether the Table view is dead, and whether CLAUDE_BILLING.md is unlocked | `SELECT * FROM billing_settings;` |
| Q2 | Is `ACCESS_SOURCE` still **user**? | Every "role X holds Y" statement in canon depends on it | SELECT on the settings row `lib/access/source.ts` reads |
| Q3 | Were `sql/2026-09-17-tint-panel-tabs.sql` and the reports-ticks SQL run, and who holds `tint_panel_*`, `reports_*`, `billing_print`, `billing_*` action ticks and `place_order_ship_to` in `user_page_access`? | Missing rows read as no access. If the SQL was skipped, Chandresh and Prakash see no panel tabs or reports | `SELECT "pageKey", count(*) … FROM user_page_access WHERE "pageKey" IN (…) GROUP BY 1;` |
| Q4 | Is `app_settings['picking.visibilityGate']` ON in production? | Decides whether the picking queue is actually filtered today (code default is OFF) | `SELECT * FROM app_settings;` |
| Q5 | Live trips constraints: does `chk_trips_status` still include `loading`? Do `chk_trips_dispatched_complete`, `chk_trips_number_shape`, `trips_date_type_seq_live_key`, `chk_trip_drops_key` and `chk_trip_activity_action` exist? What are the `app_tag_settings` partial uniques + `chk_app_tag_settings_scope`? | §3 took these from comments; CORE needs them verbatim to mint versions | `pg_constraint` / `pg_indexes` SELECTs |
| Q6 | MRN: was the deferred `DROP DEFAULT` on `mrn_lines."deliveryNo"` run? Do the four hand-renamed constraint names match the draft? | `sql-2026-09-01` Part 4 status; schema.prisma omits the default | `information_schema.columns` / `pg_constraint` |
| Q7 | `role_master` row count, 12 or 13? Who holds `floor_access`, and does any user have `floor` canView without canEdit? | CORE is internally inconsistent (12 vs 13). A view-only floor user hits the trips-403 defect | SELECTs on role_master, user_roles, user_page_access |
| Q8 | Was Chandresh's `tint_operator` role removed from `user_roles`? | TINT §13.1 table | SELECT |
| Q9 | Real `dispatched` count, and how many rows came from hand-run UPDATEs? | Code comments claim 4,137 and 7,067; PICKING §7 says 1,051 | `SELECT count(*) FROM orders WHERE "workflowStage"='dispatched';` |
| Q10 | Which machine runs the live NTS puller? | Blocks every `.ps1` change and trip-mirror Phase B (TRIP_REPORT §7) | physical / host check |
| Q11 | Does anything external call `/api/tint/operator/shades` (POST, PUT)? | No in-app caller; retire or convert | Vercel logs |
| Q12 | Does the Billing print still come out **A4 landscape**, given `@page mo-landscape` nested inside `@media print`? | UI §28 claim vs router rule §1 | a real print from the Billing screen |
| Q13 | Owner decisions (not data): (a) lift the "no CLAUDE_BILLING.md" lock? (b) may pickers reach `/api/picking/tint-workload` (currently `picking` canView)? (c) keep, cut or document the Floor board's `waitingSkus`/`oilSkus` payload? (d) delete the listed orphans? (e) add the 6 missing slugs to `RoleSidebarRole`? (f) the SMU gate for Offtake/Projects/Distributor under auto-release (pending-support draft F1.3)? (g) Defect B, header totals never recomputed (import-qty draft)? | Each changes what canon should say | owner |
| **Q14 ⚠ security** | `docs/dhruv-review/-Dhruv.env` (and `.env-Dhruv.local`) are **untracked and NOT git-ignored** (`git check-ignore` returns nothing), in a OneDrive-synced folder. The 2026-09-08 trip-mirror draft says one holds a **plaintext production DB password**. This sweep did not open either file | One `git add .` would commit it. OneDrive already syncs it | Owner: rotate the DB password, move the files out of the repo, add an ignore rule |

---

*code-discovery-2026-09-18-canon-sweep.md · read + plan only · HEAD ec6343ba · baseline 7d8ceece · written 2026-09-18. Not staged, not committed.*
