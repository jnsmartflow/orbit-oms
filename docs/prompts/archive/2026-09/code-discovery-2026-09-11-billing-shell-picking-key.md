# Code discovery — the billing shell + a page key for the Billing Picking tab
# 2026-09-11 · READ-ONLY diagnosis · no code written, no commits
# Files read: CLAUDE.md (v1.12) · docs/CLAUDE_CORE.md (v104, Schema v27.24) · docs/CLAUDE_UI.md (v5.29)
#             docs/CLAUDE_MAIL_ORDERS.md (v1.13, Schema v27.15) · docs/CLAUDE_PICKING.md (v1.17, Schema v27.15)
#             docs/CLAUDE_MRN.md (v1.1, Schema v27.20) · docs/CLAUDE_CI.md (v1.1, Schema v27.21)

---

## 0. Three facts to read before anything else

### 0.1 🔴 The prototype named in the brief DOES NOT EXIST

`docs/mockups/billing/depotshell_5.html` is not in the repo. Neither is anything else
matching it. Searches run:

```
find . -iname "*depot*"          → 0 hits (excluding node_modules/.next)
find . -iname "*shell*.html"     → docs/mockups/picking/mobile-shell-v1.html only
grep -ril "depot shell" docs     → 0 hits
ls docs/mockups/billing/         → billing-final-mockup.html   (only file, 23 KB, dated 2026-07-30)
```

`docs/mockups/billing/` holds exactly one file, `billing-final-mockup.html`, which is the
mockup the SHIPPED Billing v2 face was built to — it is referenced by name in
`components/billing/billing-tab-bar.tsx:3-4` and `components/billing/billing-picking-tab.tsx:4`.
It is not a four-tab Depot Shell prototype.

**Consequence: Section F is answered only for its code-side half.** Every question in F that
is about the CODE (which paths write `invoiceNo`, whether an operator-typed number collides,
what the live tab has, whether pulse-count data already exists) is answered below from the
code. The half that requires reading the prototype's markup, script, "rules" and "still open"
notes is **not delivered**, because the file was not there to read. Nothing in this report is
inferred from a prototype I could not open.

### 0.2 🔴 Billing v2 is NOT a pilot any more — the flag is `ALL_USERS` live

```sql
-- read-only SELECT, 2026-09-11
SELECT id, scope, "rolloutStage" FROM billing_settings;
--  1 | GLOBAL | ALL_USERS
```

`docs/CLAUDE_MAIL_ORDERS.md §23` and the `CLAUDE.md` §3 router row both describe this as
`TEST_USERS_ONLY` with one flagged user. **The live row says `ALL_USERS`.** Per
`lib/billing/flag.ts:85-86`, `ALL_USERS` returns `true` for everybody and the per-user flag is
never consulted:

```ts
// lib/billing/flag.ts:85-86
if (stage === "OFF") return false;
if (stage === "ALL_USERS") return true;
```

So **every one of the seven people who hold `mail_orders/canView` sees the billing face and
its Picking tab today** — not one pilot user. `users.billingV2TestUser = true` is still set on
exactly one account (Operations User, id 20) but is now dead weight.

This is not a guess about who uses it. It is confirmed by C3 below: four different people have
marked bills done in the last 14 days, including two the docs list as "the rollout target".

**The CODE wins. The docs are stale.** The router row calling Billing a "PILOT, flag-gated
(operations id 20 only until rollout)" and `MAIL_ORDERS §23`'s "PILOT SCOPE (live state, SELECT
2026-08-04)" block both need correcting in the next docs pass. Nothing was changed by me.

### 0.3 Files I created (disclosure)

The brief said to edit only the report. I added two read-only diagnostic scripts, following the
repo's existing `scripts/_chk-*.ts` convention, to run the Section C and Section E queries:

- `scripts/_chk-billing-shell-20260911.ts` — SELECT only
- `scripts/_chk-nav-20260911.ts` — SELECT only

Both are additive, neither writes anything. Delete or keep at your discretion.

---

## A. The billing Picking tab — every gate that decides who sees or uses it

### A.1 There is NO gate of its own. The tab rides entirely on `mail_orders`.

Every gate below resolves to the key `mail_orders`. Not one of them mentions Picking.

| # | Layer | File:line | Gate |
|---|---|---|---|
| 1 | Route layout guard | `app/(mail-orders)/mail-orders/layout.tsx:29` | `checkAnyPermission(roles, "mail_orders", "canView")` → `redirect("/unauthorized")` |
| 2 | Flag read (server) | `app/(mail-orders)/mail-orders/layout.tsx:56` | `isBillingV2Enabled(Number(session.user.id))` → couriered by `BillingV2Provider` (`:77`) |
| 3 | Flag read (client) | `app/(mail-orders)/mail-orders/mail-orders-page.tsx:220` | `const billingV2 = useBillingV2()` |
| 4 | Tab state owner | `mail-orders-page.tsx:221` | `useState<BillingTab>("orders")` — not persisted, a reload lands on Orders |
| 5 | Tab bar mount | `review-view.tsx:2797` | `{billingV2 && onBillingTabChange && (<BillingTabBar …/>)}` |
| 6 | Tab body mount | `review-view.tsx:2808-2809` | `{billingV2 && billingTab === "picking" ? <BillingPickingTab date={selectedDate}/> : …}` |
| 7 | `middleware.ts` | — | **no role check for `/mail-orders`** — only "has a session" |

Layers 5 and 6 are the only thing that hides the tab, and both key on `billingV2`, which is
now `true` for everyone (§0.2). **There is no permission anywhere that can hide the Picking tab
from someone who holds `mail_orders/canView`.** That is precisely what goal 1 is asking to fix.

⚠ The tab bar and the tab body are **two separate guards on two different lines**. A new page
key must gate both, or the bar renders a Picking pill that switches to an empty pane.

### A.2 The count badge

`components/billing/billing-tab-bar.tsx:44-76`. The Picking pill's count is **not** passed in —
the bar fetches it itself:

- `MARKER_URL = "/api/billing/picking/marker"` (`:19`)
- `refreshCount()` reads `body.count` off that endpoint (`:49-61`)
- it subscribes to the single shared poll rather than owning a timer (`:76`,
  `useBillingMarkerSubscription`)
- the shared poll lives in `components/billing/billing-marker-provider.tsx`, mounted at
  `mail-orders-page.tsx:1347`, cadence `BILLING_MARKER_POLL_MS = 30_000`
  (`billing-marker-provider.tsx:47`)

The Orders pill's count comes from the page (`ordersCount={pendingActionCount}`,
`review-view.tsx:2802`).

🔴 **The badge fetch fires while the operator is on the Orders tab.** That is deliberate (the
file comment at `:10-12` says so). It means the marker route is called by anyone who loads the
billing face, whether or not they ever open Picking. A new page key must gate the count fetch
too, or a revoked user's browser polls a route that now 403s, every 30 seconds, all day.

### A.3 Every API route the tab calls, with its gate

All six use `checkAnyPermission` (never `checkPermission`), all six gate on `mail_orders`, all
six carry `export const dynamic = "force-dynamic"`.

| Route | Called from | Key | Flag | Helper |
|---|---|---|---|---|
| `GET /api/billing/picking/list` | `billing-picking-tab.tsx:45,128` | `mail_orders` | `canView` (`list/route.ts:85`) | `checkAnyPermission` |
| `GET /api/billing/picking/marker` | `billing-tab-bar.tsx:19,52` **and** `billing-marker-provider.tsx:33` | `mail_orders` | `canView` (`marker/route.ts:62`) | `checkAnyPermission` |
| `POST /api/billing/picking/mark-done` | `billing-picking-tab.tsx:279`, `billing-order-detail-panel.tsx:64,165` | `mail_orders` | `canEdit` (`mark-done/route.ts:58`) | `checkAnyPermission` |
| `POST /api/billing/picking/undo` | `billing-picking-tab.tsx:280` | `mail_orders` | `canEdit` (`undo/route.ts:49`) | `checkAnyPermission` |
| `GET /api/billing/picking/order/[orderId]` | `billing-order-detail-panel.tsx:58,128` | `mail_orders` | `canView` (`order/[orderId]/route.ts:57`) | `checkAnyPermission` |

Three more billing routes exist but belong to the **Orders** tab, not Picking — listed so a
repoint does not sweep them up by accident:

| Route | Key | Flag | Line |
|---|---|---|---|
| `POST /api/billing/mail-order/actions` | `mail_orders` | `canEdit` | `actions/route.ts:73` |
| `GET /api/billing/ship-to-search` | `mail_orders` | `canView` | `ship-to-search/route.ts:33` |
| `GET /api/billing/dispatch-windows` | `mail_orders` | `canView` | `dispatch-windows/route.ts:27` |

🔴 **These three were carved out of Floor's equivalents ON PURPOSE** so they gate on
`mail_orders` rather than `floor` (`MAIL_ORDERS §23.3`, `§23.4.1`). The same trap applies in
reverse to the new key: a route repointed to a key the caller does not yet hold 403s silently.

### A.4 Client-side allow-lists and role checks on this screen

- **`canImportOBDs`** — `mail-orders-page.tsx:169-170`. A hardcoded array:
  `["admin", "dispatcher", "support", "billing_operator", "tint_manager", "operation_manager", "operations"]`
  tested against `session.user.role` (the PRIMARY role only, not the multi-role array). It feeds
  `showImport` on the header (`:1212`), and the header owns the modal
  (`components/universal-header.tsx:621-623`). Belongs to the **Orders** tab / the header, not to
  Picking. The server-side import gate is separate and stricter:
  `app/api/import/obd/route.ts:4116` `requireRole(...)` plus `:4125`
  `checkPermission(session.user.role, "import_obd", "canImport")` — note `checkPermission`
  (single role) here, not `checkAnyPermission`.
- **No other client-side role check touches the Picking tab.** `billing-picking-tab.tsx` and
  `billing-order-detail-panel.tsx` read no session and no role; every restriction they apply is
  a data predicate, not a permission.
- `mrnPerms`-style "hide the control" prop threading exists on MRN and CI but **not** on the
  billing Picking tab: Mark done, Undo and Copy OBDs are rendered unconditionally and stopped
  only by the server's `canEdit`. Today that is harmless — every `mail_orders` holder is
  view+edit (C1c) — and it becomes a live gap the moment the new key can be granted view-only.

---

## B. Registration points for a new page key

### B.1 🔴 READ THIS FIRST: the access model changed on 2026-09-04 and the brief's map is stale

`system_config.ACCESS_SOURCE = 'user'` (SELECT-verified in C0). Since that flip
(`CORE §5`), **`role_permissions` is not what the app enforces.** Every resolver in
`lib/permissions.ts` asks `getAccessSource()` and, in `user` mode, reads
`user_page_access` by `session.user.id` instead — `lib/permissions.ts:566-569`, `:591-597`,
`:617-620`, `:650-653`, `:693-696`.

So the brief's "`/admin/permissions` … PAGES_CONFIG" question has a two-part answer:

- `/admin/permissions` is **the rollback editor for `ACCESS_SOURCE='role'`** and writes
  `role_permissions`. It is URL-only — removed from the admin sidebar on 2026-09-06 and
  explicitly kept alive for exactly this reason (`components/admin/admin-sidebar.tsx:51-55`).
- **`/admin/access` is the screen that actually decides access today** — per person, writing
  `user_page_access` (`app/(admin)/admin/access/page.tsx`,
  `app/api/admin/access/[userId]/route.ts:133` upsert).

A new page key must be registered in BOTH, or it is either unmanageable now or unmanageable
after a rollback.

### B.2 Every registration point, in the order a build should touch them

| # | What | File:line | Required for | Notes |
|---|---|---|---|---|
| 1 | `PageKey` union | `lib/permissions.ts:178-212` | type safety on every gate | add the literal; `tsc` then flags every stale comparison |
| 2 | `ALL_PAGE_KEYS` | `lib/permissions.ts:245-255` | admin ALL_TRUE bypass, `/admin/access` row | currently 27 keys → 28 |
| 3 | `ACCESS_SECTIONS` | `lib/permissions.ts:359-374` | the key RENDERS on `/admin/access` | 🔴 **asserted, not optional** — `access/page.tsx:46-48` computes `missing`/`extra` and `:147` renders an error banner "Section map out of step with ALL_PAGE_KEYS". Put the new key in the `"Operations"` section beside `mail_orders`. |
| 4 | `ACTION_PAGES` | `lib/permissions.ts:286-308` | the `canEdit` cell renders as a CHECKBOX not a dash | 🔴 Mark done / Undo gate on `canEdit`, so the new key MUST be added to `ACTION_PAGES.canEdit`. Omit it and `/admin/access` shows a grey dash for a switch that gates two live writes, and nobody can turn it on. The block comment at `:278-283` says exactly this. |
| 5 | `PAGE_NAV_MAP` | `lib/permissions.ts:25-115` | a SIDEBAR entry | **Only if the tab becomes its own route.** Position is behaviour — see E.2. If the tab stays a tab, add nothing here. |
| 6 | `ICON_MAP` | `components/shared/role-sidebar.tsx:40-77` | the sidebar + mobile Menu icon | Only alongside #5. An absent key falls through to `DEFAULT_ICON` (the generic `User` glyph) in the desktop sidebar, the mobile Menu sheet and the admin app switcher — three read sites, all `ICON_MAP[item.pageKey] ?? DEFAULT_ICON`. |
| 7 | `buildNavItems` | `lib/permissions.ts:144-174` | nothing — **no edit needed** | It filters `PAGE_NAV_MAP` generically on `allPerms[pageKey]?.canView`. The only special case is `attendance` (`:155-166`). |
| 8 | Admin bypass | `lib/permissions.ts:546-548`, `:641-648`, `:684-691`, plus `:561`, `:585`, `:612` | admin sees it | **No edit needed** — driven off `ALL_PAGE_KEYS` (#2) and the `roleSlug === "admin"` / `isSuperuser` short-circuits. |
| 9 | `prisma/seed.ts` | `prisma/seed.ts:68-164` | a wipe-and-reseed reproduces ROLE-template grants | 🔴 See B.4 — seed writes `role_permissions` only. |
| 10 | `/admin/access` grid | `app/(admin)/admin/access/page.tsx:40`, `app/api/admin/access/[userId]/route.ts:65` | manageable per person | **No edit needed** — both call `allPageKeys()`. #2 + #3 + #4 are sufficient. |
| 11 | `/admin/permissions` `PAGES_CONFIG` | `components/admin/permissions-manager.tsx:25-42` | manageable in ROLE fallback mode | 🔴 See B.3 — badly stale. |
| 12 | Page / route gates | the call sites in A.1 and A.3 | the key actually gates something | swap `"mail_orders"` → the new key at the chosen sites |

Nothing else in the repo hardcodes a page-key list. `grep -rn "ALL_PAGE_KEYS\|allPageKeys()"`
returns only `lib/permissions.ts`, `app/(admin)/admin/access/page.tsx`,
`app/api/admin/access/[userId]/route.ts`, `lib/access/role-baseline.ts:92`, plus one script and
two archived copies under `docs/dhruv-review/` and `docs/_backup_2026-08-04/`.

### B.3 🔴 `/admin/permissions` PAGES_CONFIG — the answer to "which keys does it list"

`components/admin/permissions-manager.tsx:25-42`. **Thirteen keys**, against
`ALL_PAGE_KEYS`'s twenty-seven:

```
dashboard · users · system_config · permissions
customers · skus · routes_areas · vehicles
import_obd · tint_manager · tint_operator · dispatcher · warehouse
```

**Explicitly, for the five keys the brief asked about:**

| Key | In PAGES_CONFIG? |
|---|---|
| `mail_orders` | ❌ **NO** |
| `picking` | ❌ **NO** |
| `mrn` | ❌ **NO** |
| `ci` | ❌ **NO** |
| `floor` | ❌ **NO** |

The sixteen keys it is missing: `mail_orders`, `picking`, `floor`, `mrn`, `ci`, `place_order`,
`trip_report`, `delivery_challans`, `shade_master`, `sampling_library`, `ti_report`,
`attendance`, `attendance_admin`, `settings_hide`, `operations_tinting`,
`operations_tint_operator`. And it still lists two keys that were **retired in July 2026** —
`dispatcher` and `warehouse` (`CORE §12`: "Page keys removed with them: … `warehouse` …
`dispatcher`").

Its `ROLES_CONFIG` (`:13-21`) is equally stale: seven roles (`admin`, `dispatcher`, `support`,
`tint_manager`, `tint_operator`, `floor_supervisor`, `picker`). It does **not** list
`operations`, `billing_operator`, `operation_manager`, `ops_admin`, `logistics`, or the
`floor_access` role that now exists live (C1).

**How it renders and how it saves.** Renders a role × page grid grouped by `SECTIONS`
(`:212`, `:277`). Saves by flattening `ROLES_CONFIG × PAGES_CONFIG` into an `updates` array
(`:387-393`) and POSTing to `/api/admin/permissions`, which `requireSuperuser`s
(`route.ts:12,37`) and **upserts** each row (`route.ts:85`).

✅ **A save here cannot wipe the newer rows** — it is upsert-only, no `deleteMany`, and rows for
keys or roles outside its two arrays are never named. The damage is confined to "you cannot
manage the modern keys from this screen", which is tolerable while it is a rollback editor and
`ACCESS_SOURCE='user'`.

⚠ **But it becomes load-bearing the moment someone pulls the `ACCESS_SOURCE` rollback.** In
`role` mode the app reads `role_permissions`, and the only UI that writes it cannot see 16 of
the 27 keys. Adding a new key here is cheap insurance, not cosmetics.

### B.4 🔴 `prisma/seed.ts` seeds `role_permissions` ONLY — zero `user_page_access` rows

`grep -n "user_page_access\|userPageAccess" prisma/seed.ts` → **no hits.**

Since the live source is `user_page_access`, **a wipe-and-reseed grants nobody anything**
except via the `admin` bypass. Seed rows for the new key are still worth writing (they are the
role baseline `/admin/access` compares each person against — `lib/access/role-baseline.ts`) but
they will **not** turn the feature on for anyone. Granting the new key to the four people who
actually use it (C3) is an `/admin/access` action, per person, and there is no seed path for it.

Also note the existing gap `MAIL_ORDERS §22` flags, still real: `prisma/seed.ts` contains
**zero** rows for `pageKey='mail_orders'` (the seed's page-key list is `tint_operator`,
`tint_manager`, `customers`, `skus`, `routes_areas`, `vehicles`, `import_obd`, `picking`,
`floor`, `mrn`, `ci`).

### B.5 Candidate names, each proved unused

Greps run as plain bare words (no slash terms needed), case-insensitive, across the whole repo
excluding `node_modules`, `.next`, `.git`:

| Candidate | Whole-repo files | Code-tree hits (`app lib components prisma scripts middleware.ts auth.config.ts`) | Verdict |
|---|---|---|---|
| `billing_picking` | **0** | **0** | ✅ free everywhere — no code, no docs, no archive, no SQL |
| `billing_invoice` | **0** | **0** | ✅ free |
| `billing_queue` | **0** | **0** | ✅ free |
| `invoice_queue` | 0 | 0 | ✅ free |
| `billing_handoff` | 0 | 0 | ✅ free |
| `invoicing` | 16 files | 10 | ⚠ all ten are PROSE inside comments (`billing-picking-tab.tsx:3`, `lib/ci/auto.ts:23`, and so on). No identifier, no string literal, no DB value — but it reads ambiguously beside `mail_orders` |

**Recommendation: `billing_picking`.**

- It is the only candidate that names both halves of what it gates: the BILLING module, the
  PICKING handoff list. A reader who meets it in a `checkAnyPermission` call knows immediately
  which of the two "picking"s is meant.
- It cannot be confused with the floor's `picking` key by a grep: `grep -w picking` does not
  match it, and a plain `grep picking` returns both, which is the safe direction.
- 🔴 The one thing it must never become is a bare `picking` anywhere. `CORE §5`'s `picking`
  row is the owner of the floor board's grants and is cross-referenced by `CLAUDE_PICKING.md §1`
  and `CLAUDE_FLOOR.md §9b`. Twenty-four people hold `picking` today (C1c).

Second choice `billing_invoice` — arguably a better description of the WORK (these are bills
about to be invoiced) but a worse description of the SCREEN, which the operator calls Picking.

---

## C. Live data — read-only SELECTs

All blocks below are **read-only** (`SELECT` / Prisma `findMany` / `groupBy` / `aggregate` /
`count`). Nothing was written. Run via `scripts/_chk-billing-shell-20260911.ts` and
`scripts/_chk-nav-20260911.ts` against `DATABASE_URL` (the Supabase pooler).

### C0 — which source is live

```sql
SELECT key, value FROM system_config WHERE key = 'ACCESS_SOURCE';   -- read-only
```

| key | value |
|---|---|
| ACCESS_SOURCE | **user** |

So `role_permissions` (C1) is the **template / rollback**, and `user_page_access` (C1c) is what
the app enforces. Both are given below.

### C1 — `role_permissions` for `mail_orders`, `picking`, `mrn`, `ci`, `floor`

```sql
SELECT "roleSlug","pageKey","canView","canImport","canExport","canEdit","canDelete"
FROM role_permissions
WHERE "pageKey" IN ('mail_orders','picking','mrn','ci','floor')
ORDER BY "pageKey","roleSlug";   -- read-only
```

| roleSlug | pageKey | V | I | X | E | D |
|---|---|---|---|---|---|---|
| billing_operator | ci | ✓ | ✗ | ✓ | ✓ | ✓ |
| floor_supervisor | ci | ✓ | ✗ | ✗ | ✓ | ✗ |
| operations | ci | ✓ | ✗ | ✓ | ✓ | ✗ |
| admin | floor | ✓ | ✗ | ✗ | ✓ | ✗ |
| **floor_access** | floor | ✓ | ✗ | ✗ | ✓ | ✗ |
| operations | floor | ✓ | ✗ | ✗ | ✓ | ✗ |
| billing_operator | mail_orders | ✓ | ✗ | ✗ | ✓ | ✗ |
| operation_manager | mail_orders | ✓ | ✗ | ✗ | ✓ | ✗ |
| operations | mail_orders | ✓ | ✗ | ✗ | ✓ | ✗ |
| tint_manager | mail_orders | ✓ | ✗ | ✗ | ✓ | ✗ |
| billing_operator | mrn | ✓ | ✗ | ✓ | ✓ | ✓ |
| floor_supervisor | mrn | ✓ | ✗ | ✗ | ✓ | ✗ |
| operations | mrn | ✓ | ✗ | ✓ | ✓ | ✗ |
| floor_supervisor | picking | ✓ | ✗ | ✗ | ✓ | ✗ |
| operations | picking | ✓ | ✗ | ✗ | ✓ | ✗ |
| picker | picking | ✓ | ✗ | ✗ | ✗ | ✗ |

**Disagreements with `prisma/seed.ts`:**

1. 🔴 **`floor_access` is a role slug that exists live and is in NO doc and NO seed.** It holds
   `floor` view+edit. It is not in `CORE §5`'s `role_master` table, not in `ROLE_REDIRECTS`
   (`lib/rbac.ts:23-45`), and not in `permissions-manager.tsx`'s `ROLES_CONFIG`. Four live
   users carry it as a SECONDARY role (C4). **A wipe-and-reseed deletes this grant.**
2. `mail_orders` — **four live rows, ZERO seed rows.** Seed's page-key list has no
   `mail_orders` entry at all. A reseed silently revokes Billing for everyone but admin. This is
   the landmine `MAIL_ORDERS §22` already records; it is still open.
3. `ci`, `mrn`, `picking`, and the `admin` / `operations` `floor` rows — **seed and live agree
   row for row** (`prisma/seed.ts:108-110`, `:117-118`, `:141-147`, `:162-164`). Confirmed.
4. Seed rows that are **all-false live** and would be re-granted by a reseed: `support` and
   `dispatcher` on `customers` / `skus` / `routes_areas` / `vehicles` / `import_obd`
   (`prisma/seed.ts:78-89`). Pre-existing drift, outside this task's blast radius, restated
   because a reseed is one of the ways this build could go wrong.

### C1c — `user_page_access` canView=true for the same five keys (THE LIVE SOURCE)

```sql
SELECT "pageKey","userId","canView","canEdit","canExport","canDelete"
FROM user_page_access
WHERE "pageKey" IN ('mail_orders','picking','mrn','ci','floor') AND "canView" = true;  -- read-only
```

**`mail_orders` — seven people, and this is exactly who sees the Picking tab today:**

| userId | name | active | primary role | V | E |
|---|---|---|---|---|---|
| 26 | Bankim | ✓ | billing_operator | ✓ | ✓ |
| 21 | Chandresh Kolgha | ✓ | tint_manager | ✓ | ✓ |
| 25 | Deepanshu Thakur | ✓ | billing_operator | ✓ | ✓ |
| 1 | Harsh | ✓ | admin | ✓ | ✓ |
| 20 | Operations User | ✓ | operations | ✓ | ✓ |
| 32 | Prakash | ✓ | operation_manager | ✓ | ✓ |
| 53 | Test Delete Me | ✗ (inactive) | billing_operator | ✓ | ✓ |

🔴 **All seven hold canEdit.** There is no view-only `mail_orders` holder, which is why gating
Mark done / Undo on `canEdit` blocks nobody today — and why nobody has ever exercised the
"view-only billing operator" path.

**The other four keys, counted:** `floor` 8 people · `mrn` 12 · `ci` 12 · `picking` 24
(16 pickers + 7 floor supervisors + operations + admin, four of them inactive test accounts).
Full rows in the script output; only `mail_orders` bears on this build.

### C2 — billing rollout

```sql
SELECT id, scope, "rolloutStage" FROM billing_settings;                     -- read-only
SELECT id, name FROM users WHERE "billingV2TestUser" = true;                -- read-only
```

| id | scope | rolloutStage |
|---|---|---|
| 1 | GLOBAL | **ALL_USERS** |

| id | name | primary role | active |
|---|---|---|---|
| 20 | Operations User | operations | ✓ |

🔴 **`ALL_USERS` means the per-user flag is never read** (`lib/billing/flag.ts:86`). Operations
User's flag is a fossil of the pilot. See §0.2 — the docs still say `TEST_USERS_ONLY`. The stage
was set directly in the database, not by a commit: `git log -S"ALL_USERS" -- lib/billing/flag.ts`
returns only `1a64efa0` (2026-07-30), the commit that introduced the ladder.

### C3 — who actually uses the billing Picking tab (last 14 days)

`orders.invoicedAt` / `invoicedById` are written by **exactly one path**,
`app/api/billing/picking/mark-done/route.ts:97` (cleared by `undo/route.ts:87`). So this IS the
Picking-tab usage census — nothing else in the codebase can produce these rows.

```sql
SELECT "invoicedById", COUNT(*) FROM orders
WHERE "invoicedAt" >= now() - interval '14 days' AND "invoicedById" IS NOT NULL
GROUP BY "invoicedById";   -- read-only
```

| invoicedById | name | primary role | bills marked done, 14d |
|---|---|---|---|
| 26 | Bankim | billing_operator | **479** |
| 25 | Deepanshu Thakur | billing_operator | **446** |
| 32 | Prakash | operation_manager | **165** |
| 21 | Chandresh Kolgha | tint_manager | **4** |

All-time rows carrying `invoicedAt`: **1,892**.

**Read this before choosing who gets the new key.**

- The tab is in heavy daily production use — roughly 1,090 bills in fourteen days, about 78 a
  day. It is not a pilot surface.
- **Four people use it, and only two are `billing_operator`.** Prakash (`operation_manager`) at
  165 is a real user, not a test. Chandresh (`tint_manager`) at 4 is marginal but nonzero.
- 🔴 **Operations User (id 20) — the one flagged pilot account, and the account the docs name
  as the pilot — has marked ZERO bills done in fourteen days.** Granting the new key by "who was
  in the pilot" would grant the wrong person and revoke the three who do the work.
- Grant the new key to **25, 26, 32** at minimum, and decide deliberately about **21** (4 bills
  — could be a real fallback, could be an accident). Harsh (1) needs nothing; admin bypasses.

### C4 — secondary roles giving `mail_orders` / `mrn` / `ci` access a primary role would not

```sql
SELECT u.id, u.name, r.name AS role, ur."isPrimary" FROM user_roles ur
JOIN users u ON u.id = ur."userId" JOIN role_master r ON r.id = ur."roleId";  -- read-only
```

| id | name | primary | all roles (\* = primary) |
|---|---|---|---|
| 32 | Prakash | operation_manager | `floor_access`, operation_manager\* |
| 29 | Ajay Vansiya | dispatcher | dispatcher\*, logistics, `floor_access` |
| 31 | Priya Chaudhari | support | support\*, logistics, `floor_access` |
| 30 | Dhanraj Shah | dispatcher | dispatcher\*, logistics, `floor_access` |
| 20 | Operations User | operations | operations\*, logistics |

**Answer to the question as asked: NO secondary role grants `mail_orders`, `mrn` or `ci` to
anyone.** The only secondary roles in use are `logistics` (Trip Report) and `floor_access`.

🔴 **But the question is now the wrong question, and that is the finding.** Under
`ACCESS_SOURCE='user'` a secondary role grants nothing at all — `checkAnyPermission` in user
mode ignores the role array entirely and reads one row for one user
(`lib/permissions.ts:591-597`; the comment at `:593-595` says so: "No merge in user mode").
Secondary roles still change the sidebar baseline and `/admin/access`'s comparison, but they no
longer widen access. **Do not design the new key's grants around role membership.**

⚠ One real consequence for this build: `app/mrn/page.tsx:118` computes
`canClose = roles.includes("billing_operator") || roles.includes("admin")` — an explicit ROLE
check, not a permission read, deliberately (the comment at `:109-117` explains it, and
`CLAUDE_MRN.md §9` confirms it). That is the one place where the multi-role array still decides
something in these three modules, and it must not be folded into a page key.

### C — one SQL block for Smart Flow to re-run

The Supabase SQL Editor shows only the last result, so here is all of C in one statement.
**Read-only. `SELECT` only. Safe to paste as-is.**

```sql
-- Billing shell / Picking page key — one-shot diagnosis. READ-ONLY.
SELECT 'C0 access_source' AS block, key AS a, value AS b, NULL AS c, NULL AS d, NULL::int AS n
FROM system_config WHERE key = 'ACCESS_SOURCE'
UNION ALL
SELECT 'C1 role_perms', "roleSlug", "pageKey",
       concat('V',"canView"::int,' I',"canImport"::int,' X',"canExport"::int),
       concat('E',"canEdit"::int,' D',"canDelete"::int), NULL
FROM role_permissions WHERE "pageKey" IN ('mail_orders','picking','mrn','ci','floor')
UNION ALL
SELECT 'C1c user_access', u.name, a."pageKey",
       concat('V',a."canView"::int,' E',a."canEdit"::int),
       concat('active=', u."isActive"::text), a."userId"
FROM user_page_access a JOIN users u ON u.id = a."userId"
WHERE a."pageKey" IN ('mail_orders','picking','mrn','ci','floor') AND a."canView"
UNION ALL
SELECT 'C2 rollout', scope, "rolloutStage", NULL, NULL, id FROM billing_settings
UNION ALL
SELECT 'C2b flagged user', name, NULL, NULL, concat('active=', "isActive"::text), id
FROM users WHERE "billingV2TestUser"
UNION ALL
SELECT 'C3 markdone 14d', u.name, COALESCE(r.name,'?'), NULL, NULL, COUNT(*)::int
FROM orders o JOIN users u ON u.id = o."invoicedById"
LEFT JOIN role_master r ON r.id = u."roleId"
WHERE o."invoicedAt" >= now() - interval '14 days'
GROUP BY u.name, r.name
UNION ALL
SELECT 'C4 secondary roles', u.name, r.name,
       CASE WHEN ur."isPrimary" THEN 'PRIMARY' ELSE 'secondary' END, NULL, u.id
FROM user_roles ur JOIN users u ON u.id = ur."userId" JOIN role_master r ON r.id = ur."roleId"
WHERE u.id IN (SELECT "userId" FROM user_roles GROUP BY "userId" HAVING COUNT(*) > 1)
ORDER BY 1, 6, 2;
```

---

## D. The consolidated shell — how the three desk faces are built today

### D.1 Side by side

| | `/mail-orders` (billing face) | `/mrn` (desk face) | `/ci` (desk face) |
|---|---|---|---|
| Route | `app/(mail-orders)/mail-orders/page.tsx` | `app/mrn/page.tsx` | `app/ci/page.tsx` |
| Layout file | ✅ `layout.tsx` (route group) | ❌ **none, forced** | ❌ **none, forced** |
| Guard | `layout.tsx:29` `checkAnyPermission(roles,"mail_orders","canView")` | `page.tsx:69` `…"mrn","canView"` | `page.tsx:85` `…"ci","canView"` |
| Role branch to phone | **none** — one face for all | `page.tsx:95` `primaryRole === "floor_supervisor"` → `MrnSupervisorShell` | `page.tsx:104` same test → `CiShell` |
| Shell component | `mail-orders-page.tsx` → `review-view.tsx` | `components/mrn/mrn-shell.tsx` → `MrnBillingShell` (`:346`) → `components/mrn/billing-board.tsx` | `components/ci/billing-board.tsx` (`CiBillingBoardScreen`) |
| Header | `<UniversalHeader>` `mail-orders-page.tsx:1211`, heavily reconfigured for billing (`searchLayout="wide-right"`, `showClock={false}`, `showShortcutsButton={false}`, `importVariant="primary"`, `suppressFilterBar`) | `<UniversalHeader>` `components/mrn/billing-board.tsx:208` | `<UniversalHeader>` `components/ci/billing-board.tsx:198` |
| Root sizing | inside `RoleLayoutClient` children | `<div className="flex h-screen flex-col overflow-hidden">` (`billing-board.tsx:207`) | `<div className="flex h-screen flex-col overflow-hidden">` (`billing-board.tsx:197`) |
| Rail / pane | left rail + right pane inside `review-view.tsx`; the billing tab bar sits at the top of the RIGHT pane (`:2790-2806`) | `344px minmax(0,1fr)` two-track grid (`billing-board.tsx:249-260`) | `344px minmax(0,1fr)`, one rail, pending above closed (`billing-board.tsx:230+`) |
| Marker poll | `/api/billing/picking/marker`, **30s** (`billing-marker-provider.tsx:33,47`), mounted at `mail-orders-page.tsx:1347`, `enabled={billingV2}` | 🔴 **NONE on the desk face.** The poll is inside `MrnSupervisorShell` (`mrn-shell.tsx:263-270`, `/api/mrn/marker?tab=…`, 15s) | `/api/ci/marker?date=…`, 15s, `components/ci/billing-board.tsx:156-165` |
| Poll pause rule | any subscriber holding a key (`useBillingMarkerPause`); the detail panel holds `"picking-detail-mark-done"` while marking (`billing-order-detail-panel.tsx:122`) | `paused: detailOpen \|\| overlayBusy` (`mrn-shell.tsx:269`) | `paused: formActive` — anything typed in the close form or a save in flight (`billing-board.tsx:164`) |
| Tab-hidden pause | shared, `lib/hooks/use-picking-marker.ts:313` (`visibilitychange`) | same hook | same hook |
| Keyboard shortcuts | 🔴 **heavy** — two capture-phase listeners: Ctrl/Meta combos (`mail-orders-page.tsx:932`) and single-key nav + cascading Esc (`:1111`). Panel = `MO_SHORTCUTS` (`:54`), rendered via `HeaderShortcuts` on the control row (`:1183`) | none page-level; `components/mrn/modal-shell.tsx:38-40` owns Esc for every MRN modal, `photo-lightbox.tsx:154` stacks on top | 🔴 **none at all** — `grep Escape components/ci/*.tsx` → 0 hits |
| Esc owner | `mail-orders-page.tsx:945` cascading ladder (popover → smart-copy → blur input); plus `billing-order-detail-panel.tsx:202-208` in CAPTURE phase with `stopPropagation` | `modal-shell.tsx` (window, non-capture) | nobody |
| Import button | `<UniversalHeader showImport={canImportOBDs}>` (`mail-orders-page.tsx:1212`); the header owns the modal (`universal-header.tsx:621`) | not passed | not passed |
| Search owner | page state `searchQuery` (`mail-orders-page.tsx:179`), fed to the header AND down into `ReviewView` (`:1297`, `:1366`) | board state `search` (`billing-board.tsx:217-218`) | board state `search` (`billing-board.tsx:200-201`) |
| Live row counts | 1,892 orders ever carried `invoicedAt` | 20 MRNs | 52 CI returns |

### D.2 The two things that make this hard

1. 🔴 **All three desk boards own the full viewport.** MRN and CI each open with
   `flex h-screen flex-col overflow-hidden` and mount their own `<UniversalHeader>` as the first
   child. Billing does the same through `mail-orders-page.tsx`. **Any shell that mounts two of
   them at once gets two `h-screen` columns and two sticky headers.**
2. 🔴 **The floor_supervisor phone faces on `/mrn` and `/ci` must stay untouched, and they are
   branched at the PAGE, above the desk board.** `app/mrn/page.tsx:95` and
   `app/ci/page.tsx:104`. Both files carry an explicit "NO layout.tsx, and that is forced rather
   than stylistic" comment (`mrn/page.tsx:40-46`, `ci/page.tsx:42-49`): a server `layout.tsx`
   cannot supply `workflowTabs` / `activeTabKey` / `onTabChange` / `hideBar`, and a layout
   rendering a bare `RoleLayoutClient` would **permanently lock the supervisor to the default
   Home/Menu/You bar**. Any shell must sit strictly BELOW that branch or it breaks two phone
   faces that seven floor supervisors use.

### D.3 Option A — one new route, tabs switch client-side, each module's desk board mounts inside

**What breaks or must change**

- **Double headers — certain.** Each desk board renders its own `<UniversalHeader>` as its first
  child. A shell with its own header gives every tab two sticky 52px rows. Fixing it means
  either hoisting the header into the shell and threading three different prop sets (Billing's
  five neutral props vs MRN's `leftExtra` New-MRN button vs CI's `leftExtra` register export)
  through one component, or adding a `suppressHeader` prop to three boards. Both are the kind of
  shared-component surgery `MAIL_ORDERS §23.1` exists to prevent.
- **Viewport math — certain.** Three `h-screen` roots nested inside a shell that is itself inside
  `RoleLayoutClient`'s `pb-[76px] md:pb-0` wrapper. Every one needs re-rooting.
- **Marker polls for hidden tabs.** Three polls on three URLs at two cadences (Billing 30s, CI
  15s, MRN desk none). Mount all three and a hidden tab polls all day; mount lazily and the
  row-2 pulse counts the design wants are dark until you open the tab. You cannot have both
  without a new endpoint (see F.4).
- **Deep links and the back button — a real regression.** `/mrn` and `/ci` are live addresses
  today. Client-side tab state (`billingTab` is plain `useState`, not persisted —
  `mail-orders-page.tsx:221`) means no URL for a tab, the back button leaves the shell entirely,
  and every existing bookmark either 404s or needs a redirect.
- **Shortcut / Esc collisions — the worst of it.** `mail-orders-page.tsx` installs two
  **capture-phase** listeners on `document` and `window` (`:932`, `:1111`) covering Ctrl+C,
  Ctrl+V, `E`, `S` and a cascading Esc. Mount that component inside a shell alongside MRN's
  `modal-shell.tsx` Esc (window, **non-capture**) and CI's nothing, and Escape ordering becomes
  a priority chain nobody has designed. The billing detail panel already has to use
  `{capture: true}` plus `stopPropagation` (`billing-order-detail-panel.tsx:207`) to survive the
  page's own ladder — inside a shell it would have three ladders to beat.
- **Bundle size.** One route would import Billing (a 1,526-line page plus a ~2,900-line
  `review-view.tsx`), MRN and CI together. MRN is specifically architected to avoid this —
  `lib/mrn/workbook.ts` is kept split from `report.ts` because `xlsx` is ~900KB and webpack
  cannot tree-shake it (`CLAUDE_MRN.md §8`). A single route reopens that class of problem.
- **Phone faces.** Safe only if the shell route is desk-only and the `/mrn` + `/ci` routes stay
  live for supervisors — which means keeping the old routes anyway, i.e. most of Option B.

**Size: large.** Touches three shared boards, the shared header, three marker wirings, and the
keyboard model. **Risk: high.** Every regression lands on the two people doing 78 invoices a day.

### D.4 Option B — keep the routes, each desk page renders a shared tab strip of LINKS ✅ RECOMMENDED

**What breaks or must change**

- **Double headers — none.** Each route keeps its own `<UniversalHeader>` exactly as configured
  today. The tab strip is a new sibling, mounted between the header and the body — the same
  position and shape `BillingTabBar` already occupies on the billing face
  (`review-view.tsx:2790-2806`), which is itself a copy of Floor's tab row
  (`floor-page.tsx:613`). **The primitive already exists and is already approved.**
- **Marker polls — unchanged.** Only the mounted route polls. No hidden-tab polling, by
  construction. This is the single biggest reason to prefer B.
- **Deep links and back button — unchanged, and improved.** `/mrn`, `/ci` and `/mail-orders` keep
  their URLs. Next's `<Link>` gives real history entries, so the back button walks the tabs. A
  new `/billing/picking` route would give the Picking tab a URL it has never had.
- **Shortcut / Esc — unchanged.** Each route keeps its own listeners because only one route is
  ever mounted. No priority chain to design.
- **Bundle — unchanged.** Route-level code splitting is preserved.
- **Phone faces — untouched, and provably so.** The strip mounts inside each DESK branch
  (`MrnBillingShell`, `CiBillingBoardScreen`, the billing face) — strictly below the
  `primaryRole === "floor_supervisor"` test at `mrn/page.tsx:95` and `ci/page.tsx:104`. The
  supervisor branch never renders it.
- **Each route keeps its own guard**, which is the whole point: `mrn/canView`, `ci/canView`,
  `mail_orders/canView`, `billing_picking/canView`. The strip renders a tab only where the
  viewer holds that key — the design's rule, implemented with zero new gating machinery.
- **What must actually be built:** one new `components/shared/module-tab-strip.tsx`; the strip's
  per-tab permission input threaded from each server page (each already computes `allPerms` —
  `mrn/page.tsx:72`, `ci/page.tsx:88`, `mail-orders/layout.tsx:32`); and, if the Picking tab
  becomes its own route, a new `/billing/picking` page mounting `BillingPickingTab`.
- **What genuinely regresses:** a tab switch becomes a full route navigation, so it is slower
  than today's instant `setBillingTab`. Billing's Orders↔Picking switch would go from ~0ms to a
  server round trip. **Mitigation: keep Orders and Picking as client tabs inside `/mail-orders`
  and make only MRN and CI links.** That hybrid is what I would ship.
- **Second regression:** four tab counts across three routes. Each route can only cheaply count
  its own. See F.4.

**Size: small to medium.** One new shared component, three small mount sites, one optional new
route. **Risk: low** — no shared board is restructured, and the OFF path for every existing
screen is byte-identical if the strip renders nothing when fewer than two tabs are permitted.

### D.5 Recommendation

**Option B**, in the hybrid form: a shared tab strip of `<Link>`s across `/mail-orders`, `/mrn`
and `/ci`, with **Orders | Picking staying client-side tabs inside `/mail-orders`**.

The deciding argument is not aesthetics. It is that **Option A cannot be built without
restructuring `review-view.tsx`, `components/mrn/billing-board.tsx` and
`components/ci/billing-board.tsx` simultaneously**, and those three files are the live daily
surfaces of two billing operators, seven floor supervisors and the operations desk. Option B
adds a strip and changes nothing underneath it. It also delivers the actual product goal — each
tab shown only when the viewer holds canView on its key — as a direct consequence of route
guards that already exist, rather than as new shell logic that has to be got right.

---

## E. Sidebar + landing impact

### E.1 `PAGE_NAV_MAP` order today (`lib/permissions.ts:25-115`)

```
 0 operations_tinting        → /operations/tinting
 1 operations_tint_operator  → /operations/tint-operator
 2 picking                   → /picking
 3 floor                     → /floor
 4 import_obd                → /import
 5 tint_manager              → /tint/manager
 6 tint_operator             → /tint/operator
 7 customers                 → /admin/customers
 8 skus                      → /admin/skus
 9 routes_areas              → /admin/routes
10 vehicles                  → /admin/vehicles
11 trip_report               → /trips
12 place_order               → /place-order
13 mail_orders               → label "Billing" → /mail-orders
14 mrn                       → /mrn
15 ci                        → label "CI" → /ci
16 delivery_challans         → /tint/manager/challan
17 shade_master              → /tint/manager/shades
18 sampling_library          → /tint/sampling-library
19 ti_report                 → label "Reports" → /reports
20 attendance                → /attendance
21 attendance_admin          → /admin/attendance
```

### E.2 BUILT navItems after permission filtering (LIVE, user mode, per representative person)

Derived by replaying `buildNavItems`' filter against live `user_page_access` — **not** against
`role_permissions`, because the live source is `user` (C0). Under `ACCESS_SOURCE='user'` these
are **per-person**, not per-role, so two people with the same job title can differ. They do.

| Person | role | items | **navItems[0] (phone Home)** |
|---|---|---|---|
| Deepanshu Thakur (25) | billing_operator | 9 | **`/floor`** |
| Bankim (26) | billing_operator | 4 | **`/place-order`** |
| Operations User (20) | operations | 8 | `/operations/tinting` |
| Ravi Yadav (37) | floor_supervisor | 3 | ✅ `/picking` |
| Ravi Valvi (38) | floor_supervisor | 3 | ✅ `/picking` |
| Chandresh Kolgha (21) | tint_manager | 10 | `/floor` |
| Prakash (32) | operation_manager | 8 | `/floor` |
| Harsh (1) | admin | 22 | `/operations/tinting` |
| pickers (42-52, 35) | picker | 1 | ✅ `/picking` |

Full built lists for the four that matter to this build:

```
billing_operator / Deepanshu (25):
  0 floor→/floor  1 tint_manager  2 place_order  3 mail_orders  4 mrn  5 ci
  6 delivery_challans  7 sampling_library  8 ti_report
billing_operator / Bankim (26):
  0 place_order→/place-order  1 mail_orders  2 mrn  3 ci
floor_supervisor / Ravi Yadav (37):
  0 picking→/picking  1 mrn  2 ci
operations / Operations User (20):
  0 operations_tinting  1 operations_tint_operator  2 picking  3 floor
  4 trip_report  5 mail_orders  6 mrn  7 ci
```

🔴 **Two findings that change how a new nav entry must be positioned.**

1. **`PAGE_NAV_MAP`'s own comment about billing_operator is now wrong.** Lines 79-84 state
   "billing_operator, whose first granted entry (place_order) sits at index 12". That was true in
   role mode. In user mode **Deepanshu's first granted entry is `floor` at index 3** and his Home
   button is `/floor`, while **Bankim's is `/place-order`**. Two billing operators, two different
   Home buttons. The comment's instruction — "Re-derive it against the grants, never from this
   comment" — is the part that still holds, and this report is that re-derivation.
2. **The safe insertion window for a new key is AFTER index 12 (`place_order`).** Anything
   inserted at index ≤ 12 steals Bankim's Home button. Anything at index ≤ 2 steals every floor
   supervisor's and every picker's Home from `/picking` — the `CI-16` / `CORE §12` landmine,
   still exactly as stated. **A `billing_picking` entry immediately after `mail_orders` (new
   index 14) displaces nobody**, verified above.

### E.3 🔴 The sidebar "CI" entry and "Billing" label — what actually shipped, and when

**Canon is out of date. The code wins.**

| Claim in canon | Reality in code | Evidence |
|---|---|---|
| `CORE §12`: "`/ci` IS REACHABLE BY URL ONLY … deliberately NOT in `PAGE_NAV_MAP`" | ❌ **`ci` IS in `PAGE_NAV_MAP`**, at index 15, label "CI", href `/ci` | `lib/permissions.ts:102` |
| `CLAUDE_CI.md §13 CI-16`: the same claim | ❌ same | same line |
| `app/ci/page.tsx:57-62`: "⚠ NOT IN THE SIDEBAR YET" | ❌ stale code comment | `app/ci/page.tsx:57` |
| `lib/permissions.ts:201-204`: "⚠ DELIBERATELY NOT IN PAGE_NAV_MAP YET" | ❌ a stale comment sitting **99 lines below the entry it denies** | `:201` vs `:102` |
| `CORE §12`: the page was "Mail Orders" | ❌ the nav label is **"Billing"** | `lib/permissions.ts:65` |

**When it shipped:**

```
55c3cdc6  2026-08-31  ci: billing desk face + nav entry
          "Steps 5 and 6 of the CI build. /ci now has both faces and is
           reachable from the sidebar, so the supervisor journey can be
           hand-tested on a real phone."

bf218da8  2026-08-06  chore(billing): drop the Phase-0 debug marker,
                      rename sidebar label to Billing
```

So the CI nav entry shipped **2026-08-31** — `CLAUDE_CI.md v1.1` and `CORE v104` are both dated
**2026-09-04**, four days later, and both still describe it as absent. Four separate places say
"not in the sidebar" about a line that has been in the sidebar for eleven days.

✅ **And the `CI-16` safety condition was met, whether or not anyone checked.** E.2 confirms
every floor supervisor's `navItems[0]` is still `/picking`, because `ci` landed at index 15 and
`picking` sits at index 2. Condition (a) holds live. Condition (b) — "verified on a real phone
for that role" — I cannot verify from here.

### E.4 Collapsing Billing / MRN / CI into ONE sidebar entry

Per person, using the live built lists:

| Person | today | after collapse | navItems[0] |
|---|---|---|---|
| Ravi Yadav (37), floor_supervisor | `picking`, `mrn`, `ci` (3) | `picking` + one collapsed entry → 2 | ✅ **still `/picking`** |
| Deepanshu (25), billing_operator | 9 | 7 | `/floor` (unchanged) |
| Bankim (26), billing_operator | 4 | 2 | `/place-order` (unchanged) |
| Operations User (20) | 8 | 6 | `/operations/tinting` (unchanged) |
| Prakash (32), operation_manager | 8 | 8 (holds only `mail_orders`) | `/floor` (unchanged) |
| Chandresh (21), tint_manager | 10 | 10 (holds only `mail_orders`) | `/floor` (unchanged) |
| Harsh (1), admin | 22 | 20 | `/operations/tinting` (unchanged) |

🔴 **No role's `navItems[0]` moves, floor_supervisor's included — PROVIDED the collapsed entry
lands at index ≥ 13.** The three keys being collapsed sit at 13/14/15 today, so a collapsed
entry in that window is safe by construction. `/picking` stays floor_supervisor's Home.

⚠ **But collapsing has a real cost for the floor supervisor, and it is not a Home-button
problem.** Ravi Yadav's entire sidebar is three items: Picking, MRN, CI. Collapsing two of them
behind one "Billing" entry means his phone Menu sheet shows **two** rows, one of which is a
module-switcher he must open to find MRN. He does not use the Billing Orders tab at all — he
holds no `mail_orders` (C1c). **Recommend: do NOT collapse the sidebar entries.** Keep
`mail_orders`, `mrn` and `ci` as three sidebar rows and let the shared tab strip do the
consolidating on the DESK faces only. The strip is desk-side; the sidebar is what the phone uses.

### E.5 `ROLE_REDIRECTS` landings (`lib/rbac.ts:23-45`)

```
admin → /admin                    dispatcher → /place-order      support → /place-order
tint_manager → /tint/manager      tint_operator → /tint/operator
operations → /floor               floor_supervisor → /picking    picker → /picking
billing_operator → /mail-orders   ops_admin → /admin/attendance
operation_manager → /tint/manager logistics → /trips
```

**Nothing here needs to change for either option.** `billing_operator → /mail-orders` still
lands on the Orders tab, which is correct: Orders is the first work of the day, Picking the last.
If the Picking tab becomes its own route, do **not** repoint the landing.

⚠ `floor_access` has **no** entry in this map. A user whose PRIMARY role were `floor_access`
would land nowhere defined. Today all four holders carry it as a secondary role only, so it is
latent, not live. Worth naming in the docs pass.

---

## F. Prototype vs reality

🔴 **`docs/mockups/billing/depotshell_5.html` does not exist (§0.1).** I cannot enumerate what
the prototype assumes, because I could not read it. Below is every part of Section F that the
CODE answers on its own. The prototype-reading half is not delivered.

### F.1 Who writes `orders.invoiceNo` — and would an operator-typed number collide?

**Answer: yes, it would collide, and the collision is silent and one-way destructive.**

`invoiceNo` is written by **exactly two code paths, both inside the SAP import, both
server-side, neither reachable from any UI**:

| Path | File:line | Behaviour |
|---|---|---|
| Main OBD import upsert | `app/api/import/obd/route.ts:1067, 1374, 2359, 2466, 2645, 2701, 3063, 3345` | `invoiceNo: toStr(hr["InvoiceNo"]) \|\| null` — straight from the SAP header row |
| Auto-import `?action=patch-headers` | `app/api/import/obd/route.ts:3688, 3779-3780` | **fill-if-null ONLY**: `if (existing.invoiceNo === null && incomingInvoiceNo) { updateData.invoiceNo = … }` |

**No other file in the repo writes it.** Everything else reads it.

The collision, in three steps:

1. `patch-headers` is **fill-if-null**. If an operator has already typed a number into
   `invoiceNo`, SAP's real number **will never overwrite it** — the guard at `:3779` sees a
   non-null value and skips. The bill keeps whatever the operator typed, forever. There is no
   reconciliation pass anywhere.
2. `invoiceNo IS NULL` is a **load-bearing predicate in four places**:
   - the Pending list (`lib/billing/picking-where.ts:75`) — a typed number removes the bill from
     Pending immediately, which looks like success
   - the Undo guard (`app/api/billing/picking/undo/route.ts:87` `invoiceNo: null`) — with a
     number present, **Undo silently matches 0 rows**. The route's own comment at `:20-22` spells
     out why: clearing `invoicedAt` on a row that has an `invoiceNo` makes the bill vanish from
     BOTH lists.
   - the Done "informational" arm (`picking-where.ts:160`, `MAIL_ORDERS §23.4`) — a typed number
     makes the bill render with a violet "Already invoiced" badge showing the operator's own
     typing back at them as though SAP had confirmed it
   - 🔴 `lib/ci/auto.ts:16, 126-127` — **`orders.invoiceNo` IS THE FIRE RULE for the automatic
     CI.** The file's header says so verbatim: "THE FIRE RULE — orders.invoiceNo, AND NOTHING
     ELSE". A confirmed picking finding on a bill with a non-null `invoiceNo` **raises a CI
     return automatically** (`app/api/picking/findings/confirm/route.ts:162`: "🔴 `invoiceNo` IS
     THE TRIGGER — the DATABASE COLUMN, not billing's 'Already invoiced'"). An operator-typed
     number would make the floor's next confirmed shortage on that bill raise a **real goods
     return against an invoice that does not exist in SAP**.
3. `mark-done`'s WHERE ANDs `invoiceNo: null` (`MAIL_ORDERS §23.4`) — the write-path safety that
   exists today depends on the column staying SAP's.

**Verdict: an operator-typed invoice number must NOT be written to `orders.invoiceNo`.** If the
design genuinely needs the operator to record a number at mark-done time, it needs a **new,
separate column** (`orders.billingInvoiceNoTyped`, or a field on a new table) that no predicate
reads. That is a schema change and therefore a Smart Flow SQL Editor job, not a code change.

### F.2 What the LIVE Picking tab has

Listed so it can be checked against the prototype when the file turns up. Every item is in the
code today:

| Feature | Where |
|---|---|
| Multi-select checkboxes on Pending rows | `billing-picking-tab.tsx:596` (the cell `stopPropagation`s so ticking never opens the panel) |
| **Copy OBDs** — the primary teal CTA, writes to the clipboard | `:235-243`, `:505-514` |
| **Mark done** (bulk, from the selection) | `:279` → `POST /api/billing/picking/mark-done` |
| **Mark done** (single, from the detail panel) | `billing-order-detail-panel.tsx:64, 165` |
| **Undo** — today-only, and only while `invoiceNo` is still null | `:280` → `/undo`; window is `getISTDayRange()` + `invoiceNo: null` (`undo/route.ts:79-88`) |
| **Confirmed-shortage ⚠ flag + red row wash + 3px red left edge** | `:583` `row.hasConfirmedShortage`; computed by one batched query in `list/route.ts` |
| 🔴 A flagged row renders **NO checkbox at all** | `:27-33` — it cannot be swept into a bulk Mark done; the panel is the only path |
| **Read-only detail panel** — lines, qty, litres, shortfall cards, the confirmer's name | `billing-order-detail-panel.tsx`, fed by `GET /api/billing/picking/order/[orderId]` |
| Esc + backdrop close on the panel, CAPTURE phase | `billing-order-detail-panel.tsx:202-208` |
| Done area keyed on the CHECK date, with violet "Already invoiced" info rows | `picking-where.ts:160`, `MAIL_ORDERS §23.4` |
| Date stepper driving the Done area only | `date` prop from `selectedDate` (`review-view.tsx:2809`) |
| Live count badge + teal pip on the tab | `billing-tab-bar.tsx:90-95, 111` |

**Which of these a redesign drops is a question I cannot answer without the prototype.** What I
can say is which are load-bearing and must survive any redesign: the flagged-row no-checkbox
rule (`§23.4.1` — "Billing invoices against confirmed fact"), the Undo `invoiceNo: null` guard
(F.1), and the all-dates Pending backlog with **no date fence** (`picking-where.ts`, and
`CLAUDE_CI.md §8`: "the billing Picking tab shipped that assumption once and rendered an empty
tab over a real backlog").

### F.3 The Orders tab placeholder

Not assessable — see §0.1.

### F.4 Row-2 "pulse" counts per tab — does the data already exist?

**Partly. Three of four exist; none is reachable from one call.**

| Tab | Count available? | Source | Gate |
|---|---|---|---|
| Orders | ✅ already computed client-side | `pendingActionCount` in `mail-orders-page.tsx`, passed at `review-view.tsx:2802` | in-page, no fetch |
| Picking | ✅ | `GET /api/billing/picking/marker` → `{count, latest}` (`marker/route.ts:102`) | `mail_orders/canView` |
| CI | ✅ | `GET /api/ci/marker?date=…` → `{count, latest}` (`marker/route.ts:90-97`) | `ci/canView` |
| MRN | ⚠ **only per supervisor tab** | `GET /api/mrn/marker?tab=toCheck\|checking\|done` — `tab` is **REQUIRED and 400s without one** (`marker/route.ts:83-88`). It counts the SUPERVISOR board's tab, not billing's date-railed desk list. | `mrn/canView` |

**So a four-tab pulse row needs either three simultaneous polls on three different gates at two
different cadences (Billing 30s, CI 15s, MRN none-on-desk), or ONE new endpoint** that returns
all four counts and gates each arm on its own key, returning `null` for keys the caller does not
hold. The second is the right answer and it is genuinely new work — it is the one piece of this
project that cannot be assembled from what already exists.

⚠ A warning that applies either way: `CORE §3` — "never add a second `orders.update` to any
picking path". These are all read-only markers today; keep them that way.

### F.5 Other reality checks worth carrying into the design

- **`/ci` IS in the sidebar** (E.3) — any prototype or doc assuming it is URL-only is eleven
  days out of date.
- **Billing v2 is `ALL_USERS`** (§0.2) — any design gated on "the pilot user" is aimed at the one
  person with zero usage.
- **The MRN desk face does not poll at all** (D.1) — a shell assuming three live tabs is assuming
  something MRN has never done.

---

## G. Local testing reality

**Does the local dev server point at production Supabase? — YES.**

`.env` and `.env.local` carry an **identical** `DATABASE_URL` (verified by SHA-256 comparison
without printing the value; both digests begin `4d549725`). Its host is the Supabase **pooler**,
which is the same connection `CORE §3` sanctions for read-only production SELECTs and the same
one every `scripts/_chk-*.ts` in this repo uses. No separate dev database exists. No value is
printed anywhere in this report.

### Actions that write LIVE production rows when clicked during a local test

**Billing / Picking tab**

| Click | Route | Live write |
|---|---|---|
| Mark done (bulk or from the panel) | `POST /api/billing/picking/mark-done` | `orders.invoicedAt = now()`, `orders.invoicedById` — `mark-done/route.ts:97`. **Removes real bills from the real operators' Pending list.** |
| Undo | `POST /api/billing/picking/undo` | `orders.invoicedAt = null`, `invoicedById = null` — `undo/route.ts:87`. Today-only, and refuses once SAP has filled `invoiceNo`. |
| Urgent / Hold / Slot / Ship-to on the Orders tab | `POST /api/billing/mail-order/actions` | 🔴 **DUAL WRITE** — `mo_orders` AND `orders` via `updateMany WHERE soNumber`. A Hold written in the wrong case silently drops the bill off Floor's live board (`§23.3`). |
| Punch an SO number | the mail-orders write routes | `mo_orders.status`, `soNumber`, `punchedAt` |
| Import (the header modal) | `POST /api/import/obd` | the whole SAP upsert — orders, lines, enrichment |

**MRN** — every one of these is a live write: create an MRN (`mrn` row + `srNo` allocation, which
counts soft-removed rows), paste lines (🔴 **scoped DELETE** then insert —
`app/api/mrn/[mrnId]/lines/route.ts`, `CLAUDE_MRN.md §5`), START / END, confirm a line, capture a
photo (uploads to the private `mrn-photos` **Supabase Storage bucket** via the service-role key),
delete a photo, delete the MRN, and 🔴 **Punch the OTR / close** — which flips an MRN to `closed`,
the signed-document state. There are **20 real MRNs** live.

**CI** — create a draft, edit lines, submit (allocates a real `ciNumber`), and 🔴 **Close CI**,
which writes `ciDate` / `sapCiNumber` / `ciValue` and flips the status. There are **52 real CI
returns** live. ⚠ A `PUT /lines` on a submitted CI requires `ci.supervisorId === viewerId` **with
no admin bypass** (`CLAUDE_CI.md §11`).

**Picking** — confirming a finding on an invoiced bill 🔴 **automatically raises a CI**
(`lib/ci/auto.ts`, `findings/confirm/route.ts:162`). Not a billing screen, but reachable during a
shell test, and it creates a real goods-return document.

### Practical guidance

- Read-only exploration is safe and sanctioned. **Every button above is not.**
- 🔴 There is **no** test account you can safely click these with, and per your standing
  instruction no production credentials are to be used for smoke-testing. Any click test needs a
  deliberate decision about which rows may be dirtied and a cleanup plan agreed in advance.
- The pre-existing cleanup debt is still open: `MAIL_ORDERS §23.5` lists "clear the test-marked
  done bills before real rollout" as outstanding. 1,892 orders carry `invoicedAt`; some fraction
  are test marks from the pilot.

---

## Open decisions for Smart Flow

1. **Name the new key `billing_picking`?** Zero hits repo-wide; names both halves; cannot be
   confused with the floor's `picking` by grep. → **Recommend yes.**
2. **Shell shape — Option A (one route) or Option B (shared tab strip of links)?** →
   **Recommend Option B**, hybrid: MRN and CI are links, Orders↔Picking stay client tabs inside
   `/mail-orders`. A is a three-file restructure of daily-production surfaces.
3. **Does the Billing Picking tab become its own route (`/billing/picking`)?** It would gain a
   URL, a back-button entry and a clean guard, at the cost of a navigation on every switch. →
   **Recommend no for now** — keep it a client tab, gate it on the new key, revisit if the shell
   ships.
4. **Who gets `billing_picking` on day one?** Live usage says Bankim (26), Deepanshu (25) and
   Prakash (32). Chandresh (21) has 4 bills in 14 days. Operations User (20) has zero. →
   **Recommend granting 25, 26, 32; decide 21 explicitly; skip 20.**
5. **Is a `canView`-without-`canEdit` grant on the new key allowed?** Nobody holds one today, so
   Mark done / Undo render unconditionally and are stopped only by the server. If view-only is
   intended, the buttons need hiding client-side (MRN's HIDDEN-vs-DISABLED rule, `§9`). →
   **Recommend: ship view+edit only for now, and note the gap.**
6. **Does the new key go in `PAGE_NAV_MAP`?** Only if decision 3 says yes. If so it must land at
   index ≥ 13 (immediately after `mail_orders`), which displaces nobody — verified live. →
   **Recommend no nav entry while it stays a tab.**
7. **Do we correct the stale canon in this build or a separate docs pass?** Five items are
   provably wrong: Billing v2 is `ALL_USERS` not a pilot; `ci` IS in `PAGE_NAV_MAP`; the sidebar
   label is "Billing"; `PAGE_NAV_MAP:79-84`'s billing_operator Home claim; and the undocumented
   `floor_access` role. → **Recommend a separate docs pass** — none of it blocks the build, and
   bundling doc edits into a code push hides them.
8. **Do we fix `/admin/permissions` PAGES_CONFIG?** It is missing 16 of 27 keys and still lists
   two retired ones. Harmless today (upsert-only, and `ACCESS_SOURCE='user'`), dangerous the
   moment anyone pulls the rollback. → **Recommend: add the new key to it as part of this build,
   and log the other 16 as separate work.**
9. **Row-2 pulse counts — build the new consolidated endpoint, or three polls?** → **Recommend
   deferring pulse counts out of v1 entirely.** It is the only piece needing genuinely new server
   work, and the tab strip is useful without it.
10. **Where does an operator-typed invoice number go, if the design wants one?** Not
    `orders.invoiceNo` (F.1 — it breaks Undo, the Done arm, and the automatic-CI fire rule). →
    **Recommend: drop the requirement, or spec a new column through the SQL Editor.**
11. **Do we collapse Billing / MRN / CI into one sidebar entry?** Safe for every Home button if it
    lands at index ≥ 13, but it costs the floor supervisor — his whole sidebar is three rows. →
    **Recommend no.** Consolidate the desk faces; leave the sidebar alone.
12. **Someone must produce `depotshell_5.html`.** Section F's design half is unanswerable without
    it, and no shell decision beyond D.5 should be locked until it is read.

---

## Suggested build order

1. Get `depotshell_5.html` into `docs/mockups/billing/` and re-read Section F against it. Confirm
   decisions 2, 3, 9 and 10 before writing code.
2. Settle decisions 1, 4, 5 and 6 out loud. The name and the grant list are the two that are
   expensive to change after the fact.
3. Register the key, code only, no behaviour change: `PageKey` union → `ALL_PAGE_KEYS` →
   `ACCESS_SECTIONS` (Operations) → `ACTION_PAGES.canEdit`. Run `npx tsc --noEmit`. Open
   `/admin/access` and confirm the new row renders with a live `canEdit` checkbox, not a dash.
4. Add the key to `prisma/seed.ts` as a role template, and to `permissions-manager.tsx`'s
   `PAGES_CONFIG` so the rollback editor can see it. Neither changes live behaviour.
5. Smart Flow grants `billing_picking` in `/admin/access` to the people decision 4 named —
   **before** any gate is repointed, so nobody loses the tab for a single page load.
6. Verify the grants by read-only SELECT on `user_page_access` before touching a gate.
7. Repoint the gates, in this order — reads first, writes last, so a mistake fails visible rather
   than silent: `list` → `marker` → `order/[orderId]` → `mark-done` → `undo`.
8. Gate the UI on the new key: thread `allPerms["billing_picking"].canView` from the layout into
   `mail-orders-page.tsx`, and gate **both** mount points (`review-view.tsx:2797` tab bar and
   `:2808` tab body) plus the count fetch in `billing-tab-bar.tsx`. Three sites, not one.
9. Test locally against each of the four real users' permission shapes — **without clicking any
   write button** (Section G). Confirm: a holder sees the tab; a non-holder sees only Orders and
   their browser makes no marker call.
10. `npx tsc --noEmit`, then confirm `git diff HEAD --stat` is empty before push
    (`MAIL_ORDERS §23.6` — an uncommitted export once passed locally and broke the Vercel build).
11. Only now start the shell. Build `components/shared/module-tab-strip.tsx` on its own,
    rendering nothing when fewer than two tabs are permitted — so every existing screen is
    byte-identical until it is mounted.
12. Mount the strip on ONE desk face first (`/ci`, the lowest-traffic at 52 rows), verify, then
    `/mrn`, then `/mail-orders`. Never all three in one commit.
13. Confirm on a real phone that `/mrn` and `/ci` still branch to the supervisor face and that
    `navItems[0]` is still `/picking` for a floor_supervisor account.
14. Push, then verify on production — `CORE §3`: commit is not deploy.
15. Separate docs pass for decision 7.

---

*Report written 2026-09-11. Read-only diagnosis; no application code was modified and nothing was
committed. Two additive read-only scripts were created (§0.3). Where a doc and the code disagreed,
the code is reported and the disagreement named.*
