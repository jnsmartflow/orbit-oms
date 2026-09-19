# Code discovery — permission action flags: who actually asks
# 2026-08-30 · READ-ONLY · no code changed · Lives in: docs/prompts/drafts/

**Question:** of the five `role_permissions` action flags — `canView`, `canImport`, `canExport`,
`canEdit`, `canDelete` — which are actually read by a caller at runtime, and which are only written
by the admin Permissions screen and displayed back?

**Method.** Every claim below names a CALL SITE, never a definition. Two independent sweeps were run
and reconciled: MSYS `grep -rn "[\"']<flag>[\"']"` over quoted literals across `app/ lib/ components/
prisma/ scripts/ middleware.ts auth.config.ts`, and `rg` over the same tree for unquoted property
reads (`perms.canEdit`, `row.canView`, …). `archive/**` excluded from both. Where a route file holds
both a GET and a mutating handler, the handler boundary was opened by hand
(`grep -n 'export async function'` + the gate line number) rather than inferred from the file.

Live data is a read-only `SELECT` against production (`role_permissions`, 115 rows, 2026-08-30), run
via `scripts/_chk-perm-actions-20260830.ts`. No INSERT/UPDATE/DELETE/ALTER was issued.

---

## 1. The helpers

### `ActionKey` — `lib/permissions.ts:181-186`

```ts
export type ActionKey =
  | "canView"
  | "canImport"
  | "canExport"
  | "canEdit"
  | "canDelete";
```

### Every exported helper that takes an action argument

**Two.** Both require the action explicitly — **neither has a default value**, so there is no flag
that gets asked for implicitly.

| Helper | Signature | Default action? | Role input | Admin bypass |
|---|---|---|---|---|
| `checkPermission` (`:226-239`) | `(roleSlug: string, pageKey: PageKey, action: ActionKey) => Promise<boolean>` | **no** | ONE slug — callers pass `session.user.role`, the **primary** role only | `if (roleSlug === "admin") return true` (`:231`) |
| `checkAnyPermission` (`:241-255`) | `(roleSlugs: string[], pageKey: PageKey, action: ActionKey) => Promise<boolean>` | **no** | ALL roles — `session.user.roles ?? [session.user.role]` | `if (roleSlugs.includes("admin")) return true` (`:246`) |

The other three exported helpers take **no** action argument — they return the whole
`PagePermissions` object and leave the field selection to the caller:

| Helper | Signature | Returns |
|---|---|---|
| `getPagePermissions` (`:257-276`) | `(roleSlug, pageKey)` | `PagePermissions` (`ALL_TRUE` for admin, `ALL_FALSE` for a missing row) |
| `getAllPermissionsForRole` (`:278-300`) | `(roleSlug)` | `Record<pageKey, PagePermissions>` |
| `getAllPermissionsForRoles` (`:309-343`) | `(roleSlugs)` | same, OR-merged across roles |

⚠ **The trap this file exists to name.** `checkPermission(roles, key, action)` *accepts*
`"canDelete"`. That is the type system, not evidence. The table in §2 counts only calls that pass
each literal.

⚠ **Secondary roles are invisible to `checkPermission`.** It reads one slug. Every master-data page
and route uses it (`session!.user.role`); everything built since Floor uses `checkAnyPermission`. A
user holding a grant on a *secondary* role is denied by the first family and allowed by the second.
Same split already recorded for `requireRole` vs the inline `session.user.role !== "admin"` checks in
`code-discovery-2026-08-28-admin-panel.md §6c`.

---

## 2. Per flag — who actually asks

### Verdict table

| Flag | Live call sites (literal passed to a helper) | Verdict | Evidence |
|---|---|---|---|
| `canView` | **75** | **LIVE** | 21 layouts/pages + 54 API routes; e.g. `app/(floor)/floor/layout.tsx:26` |
| `canEdit` | **38** | **LIVE** | every write route on Floor / MRN / Picking / Sampling / Tint; e.g. `app/api/floor/actions/route.ts:51` |
| `canImport` | **2** | **LIVE (thin)** | `app/api/import/obd/route.ts:3796`, `app/api/sampling-library/route.ts:253` |
| `canExport` | **2** | **LIVE (MRN only)** | `app/api/mrn/[mrnId]/export/route.ts:58`, `app/mrn/[mrnId]/sheet/page.tsx:41` |
| `canDelete` | **1** | **LIVE (MRN only)** | `app/api/mrn/[mrnId]/delete/route.ts:53` |

**No flag is STORED-ONLY.** The premise that `canExport` and `canDelete` might never be read is
false — MRN (shipped 2026-08-20) reads both. Before MRN they would have been stored-only; §5 settles
this in detail.

### 2.1 `canView` — 75 call sites

Too many to reproduce with context; the full `file:line` list is the MSYS sweep output, grouped:

**Layouts / pages (21)** — all in the shape `const allowed = await checkAnyPermission(roles, "<key>",
"canView"); if (!allowed) redirect("/unauthorized");`

```
app/(admin)/admin/areas/page.tsx:13            routes_areas    (checkPermission)
app/(admin)/admin/customers/page.tsx:13        customers       (checkPermission)
app/(admin)/admin/routes/page.tsx:13           routes_areas    (checkPermission)
app/(admin)/admin/skus/page.tsx:19             skus            (checkPermission)
app/(admin)/admin/vehicles/page.tsx:13         vehicles        (checkPermission)
app/(dispatcher)/dispatcher/customers/page.tsx:13   customers  (checkPermission)
app/(dispatcher)/dispatcher/routes/page.tsx:12      routes_areas
app/(dispatcher)/dispatcher/skus/page.tsx:18        skus
app/(dispatcher)/dispatcher/vehicles/page.tsx:12    vehicles
app/(floor)/floor/layout.tsx:26                floor
app/(mail-orders)/mail-orders/layout.tsx:30    mail_orders
app/(place-order)/layout.tsx:34                place_order
app/(tint)/tint/manager/customers/page.tsx:12  customers
app/(tint)/tint/manager/layout.tsx:26          tint_manager
app/(tint)/tint/manager/routes/page.tsx:12     routes_areas
app/(tint)/tint/manager/skus/page.tsx:18       skus
app/(tint)/tint/manager/vehicles/page.tsx:12   vehicles
app/(tint)/tint/operator/layout.tsx:26         tint_operator
app/(tint)/tint/sampling-library/layout.tsx:26 sampling_library
app/mrn/page.tsx:42                            mrn
app/picking/page.tsx:39                        picking
app/picking/push-test/page.tsx:19              picking
app/reports/page.tsx:36                        ti_report
app/reports/tint-summary/page.tsx:57           tint_manager
app/trips/page.tsx:23                          trip_report
```

**API routes (54)** — Floor 6, Picking 7, MRN 4, Billing 5, Sampling Library 7, Tint Manager 7,
Tint Operator 4, Mail Orders 1 (`marker`, a GET), admin master data 6, reports 1, plus the mutating
ones itemised in §3b.

Representative call site with context (`app/api/floor/board/route.ts:21-25`):

```ts
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

**Direct field reads, not through a helper** — `canView` is also read off the `PagePermissions`
object returned by `getAllPermissionsForRole(s)`:

- `lib/permissions.ts:142` — `buildNavItems`: `allPerms[item.pageKey]?.canView === true` decides
  every operational sidebar item.
- `components/admin/admin-sidebar.tsx:164` — `userRole === "admin" || allPerms[item.pageKey]?.canView
  === true`, the admin sidebar's own gate.
- `components/admin/permissions-manager.tsx:383` — `getPerms(roleSlug, p.key).canView`, the per-role
  count badge (display only).

**Direct reads off a raw `role_permissions` row** (no helper anywhere in the path):

- `app/(admin)/admin/permissions/page.tsx:12` — `prisma.role_permissions.findMany()` straight into
  the client component.
- `components/admin/permissions-manager.tsx:109-113` — maps that row into local state, all five flags.
- `app/api/admin/permissions/route.ts:12` (GET, returns raw rows), `:46` (admin all-true override),
  `:58-69` (the upsert body, all five flags).
- `prisma/seed.ts:68-143` + `:150-154` — seed literals and the upsert.

### 2.2 `canEdit` — 38 call sites

All 38 are `checkPermission` / `checkAnyPermission` calls; 37 gate a mutating handler (§3a) and one
is the `sampling-library/[samplingNo]` PATCH counted there too. Grouped by page key:

| Page key | Call sites | Files |
|---|---|---|
| `mrn` | 6 | `mrn/create:58`, `mrn/[mrnId]/end:51`, `header:65`, `line/[lineId]:89`, `lines:61`, `start:49` |
| `picking` | 6 | `approve:26`, `assign:36`, `cancel:72`, `findings/confirm:61`, `release:51`, `unassign:19` |
| `tint_manager` | 5 | `assign:24`, `cancel-assignment:13`, `splits/cancel:18`, `splits/create:67`, `splits/reassign:19` |
| `tint_operator` | 4 | `done:35`, `split/done:35`, `split/start:27`, `start:21` |
| `mail_orders` | 3 | `billing/mail-order/actions:73`, `billing/picking/mark-done:58`, `billing/picking/undo:49` |
| `floor` | 3 | `floor/actions:51`, `floor/release:42`, `floor/ship-to:37` |
| `sampling_library` | 3 | `[samplingNo]/review:28`, `[samplingNo]:63`, `[samplingNo]/variants:123` |
| `routes_areas` | 3 | `admin/areas:57`, `admin/routes:41`, `admin/sub-areas:39` |
| `customers` | 2 | `admin/customers:151`, `admin/customers/[id]:114` |
| `skus` | 1 | `admin/skus:79` |
| `vehicles` | 1 | `admin/vehicles:41` |
| *(comment, not a call)* | — | `app/api/picking/cancel/route.ts:30` |

Context sample (`app/api/picking/assign/route.ts:34-38`, the corrected gate):

```ts
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "picking", "canEdit");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

**Direct field reads** (helper-derived `PagePermissions`, used to hide controls, never to authorise):

```
app/mrn/page.tsx:87                                canEdit: perms?.canEdit ?? false
app/(admin)/admin/customers/page.tsx:87            canEdit={perms.canEdit}
app/(tint)/tint/manager/{customers:91,skus:58,routes:30,vehicles:39}/page.tsx
app/(dispatcher)/dispatcher/{customers:84,skus:58,routes:30,vehicles:39}/page.tsx
components/mrn/detail-pane.tsx:220,230,408 · billing-board.tsx:224 · lines-table.tsx:256,274,296
components/admin/{customers-table:231,346,394 · customers-split-view:720,1034,1174
                  skus-table:187,279 · routes-table:181,223,232 · vehicles-table:245,291,294}
```

`app/mrn/page.tsx:74-79` states the rule explicitly: *"THIS IS FOR HIDING CONTROLS, NEVER FOR
AUTHORISATION… if these two ever disagree, the ROUTE is right."*

### 2.3 `canImport` — 2 call sites

**Zero page-level or layout-level checks. Two API call sites, that is all.**

`app/api/import/obd/route.ts:3787-3799`:

```ts
  const session = await auth();
  requireRole(session, [
    ROLES.ADMIN, ROLES.DISPATCHER, ROLES.SUPPORT, ROLES.BILLING_OPERATOR,
    ROLES.TINT_MANAGER, ROLES.OPERATION_MANAGER, ROLES.OPERATIONS,
  ]);
  if (session!.user.role !== "admin") {
    const allowed = await checkPermission(session!.user.role, "import_obd", "canImport");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }
```

`app/api/sampling-library/route.ts:246-256` — the **POST** handler (bulk create of a sampling
register entry + recipes) gates on `canImport`, while the GET above it uses `canView`:

```ts
export async function POST(req: Request): Promise<NextResponse> {
  ...
  const allowed = await checkAnyPermission(roles, "sampling_library", "canImport");
```

**Direct field reads:** `perms.canImport` is passed to four master-data tables as a prop
(`admin/customers:88`, `tint/manager/{skus:59,routes:31,vehicles:40}`,
`dispatcher/{skus:59,routes:31,vehicles:40}`) and consumed at `customers-table.tsx:216,226,394`,
`skus-table.tsx:167,177`, `routes-table.tsx:161,171`, `vehicles-table.tsx:225,235`,
`customers-split-view.tsx:706,725` — the Import/Export CSV buttons on those tables.
`app/(tint)/tint/manager/customers/page.tsx:92` hardcodes `canImport={false}` regardless of the flag.

⚠ **Naming collision.** `canImportOBDs` (six client files) is a **role allow-list**, not this flag —
it never reads `role_permissions`. See §4.

### 2.4 `canExport` — 2 call sites

**Both belong to MRN. Nothing else in the app reads this flag.**

`app/api/mrn/[mrnId]/export/route.ts:53-61`:

```ts
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canExport");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
```

`app/mrn/[mrnId]/sheet/page.tsx:41` — the same gate on the A4 sheet page.

**Direct field read:** `app/mrn/page.tsx:88` → `components/mrn/detail-pane.tsx:248` (`perms.canExport
&&` hides the Export control).

Full settlement in §5.

### 2.5 `canDelete` — 1 call site

**One. `app/api/mrn/[mrnId]/delete/route.ts:49-58`:**

```ts
  // 🔴 canDelete — the one route in this step that is not canEdit.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canDelete");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
```

**Direct field read:** `app/mrn/page.tsx:89` → `components/mrn/detail-pane.tsx:239`
(`perms.canDelete &&`).

**Explicit zeros for this flag:** zero call sites outside MRN. Not one of the ~40 delete/remove/void
paths elsewhere in the app asks it — `admin/hide/rules/[id]` DELETE uses `session.user.role !==
"admin"`, `tint/manager/orders/[id]/remove` uses `tint_manager`/**`canView`**, challan void goes
through `requireRole`.

---

## 3. The canView-instead-of-canEdit gap — the full list

Scope: every route handler under `app/api/**` exporting `POST` / `PATCH` / `PUT` / `DELETE`.
**134 route files** carry at least one such handler. Where a file mixes a GET and a mutating handler,
the gate was read at the handler, not the file.

> ⚠ **`CLAUDE_CORE.md §13` is stale on both halves of its claim.** It reads: *"Mail Orders write
> routes gate on `canView`, not `canEdit` — same pattern independently found on `/picking`'s write
> routes (`assign`/`unassign` both check `canView`)."*
>
> - **Picking: fixed in code, 2026-07-20.** `assign/route.ts:36` and `unassign/route.ts:19` both read
>   `checkAnyPermission(roles, "picking", "canEdit")` today, with a 15-line comment at
>   `assign/route.ts:19-33` explaining the correction and why `done` deliberately stayed on `canView`.
> - **Mail Orders: worse than stated.** Those routes do not gate on `canView` — they gate on
>   **nothing but a session**. See list (c).

### (a) Mutating routes that correctly check `canEdit` — **37**

| # | Route | Method | Page key |
|---|---|---|---|
| 1 | `app/api/admin/areas/route.ts:57` | POST | `routes_areas` |
| 2 | `app/api/admin/customers/route.ts:151` | POST | `customers` |
| 3 | `app/api/admin/customers/[id]/route.ts:114` | PATCH | `customers` |
| 4 | `app/api/admin/routes/route.ts:41` | POST | `routes_areas` |
| 5 | `app/api/admin/skus/route.ts:79` | POST | `skus` |
| 6 | `app/api/admin/sub-areas/route.ts:39` | POST | `routes_areas` |
| 7 | `app/api/admin/vehicles/route.ts:41` | POST | `vehicles` |
| 8 | `app/api/billing/mail-order/actions/route.ts:73` | POST | `mail_orders` |
| 9 | `app/api/billing/picking/mark-done/route.ts:58` | POST | `mail_orders` |
| 10 | `app/api/billing/picking/undo/route.ts:49` | POST | `mail_orders` |
| 11 | `app/api/floor/actions/route.ts:51` | POST | `floor` |
| 12 | `app/api/floor/release/route.ts:42` | POST | `floor` |
| 13 | `app/api/floor/ship-to/route.ts:37` | POST | `floor` |
| 14 | `app/api/mrn/create/route.ts:58` | POST | `mrn` |
| 15 | `app/api/mrn/[mrnId]/end/route.ts:51` | POST | `mrn` |
| 16 | `app/api/mrn/[mrnId]/header/route.ts:65` | PATCH | `mrn` |
| 17 | `app/api/mrn/[mrnId]/line/[lineId]/route.ts:89` | PUT | `mrn` |
| 18 | `app/api/mrn/[mrnId]/lines/route.ts:61` | PUT | `mrn` |
| 19 | `app/api/mrn/[mrnId]/start/route.ts:49` | POST | `mrn` |
| 20 | `app/api/picking/approve/route.ts:26` | POST | `picking` |
| 21 | `app/api/picking/assign/route.ts:36` | POST | `picking` |
| 22 | `app/api/picking/cancel/route.ts:72` | POST | `picking` |
| 23 | `app/api/picking/findings/confirm/route.ts:61` | POST | `picking` |
| 24 | `app/api/picking/release/route.ts:51` | POST | `picking` |
| 25 | `app/api/picking/unassign/route.ts:19` | POST | `picking` |
| 26 | `app/api/sampling-library/[samplingNo]/route.ts:63` | PATCH | `sampling_library` |
| 27 | `app/api/sampling-library/[samplingNo]/review/route.ts:28` | POST | `sampling_library` |
| 28 | `app/api/sampling-library/[samplingNo]/variants/route.ts:123` | POST | `sampling_library` |
| 29 | `app/api/tint/manager/assign/route.ts:24` | POST | `tint_manager` |
| 30 | `app/api/tint/manager/cancel-assignment/route.ts:13` | POST | `tint_manager` |
| 31 | `app/api/tint/manager/splits/cancel/route.ts:18` | POST | `tint_manager` |
| 32 | `app/api/tint/manager/splits/create/route.ts:67` | POST | `tint_manager` |
| 33 | `app/api/tint/manager/splits/reassign/route.ts:19` | POST | `tint_manager` |
| 34 | `app/api/tint/operator/done/route.ts:35` | POST | `tint_operator` |
| 35 | `app/api/tint/operator/split/done/route.ts:35` | POST | `tint_operator` |
| 36 | `app/api/tint/operator/split/start/route.ts:27` | POST | `tint_operator` |
| 37 | `app/api/tint/operator/start/route.ts:21` | POST | `tint_operator` |

**Plus 2 mutating routes on a deliberately different action** (not `canEdit`, and not a gap):

| Route | Method | Action | Why |
|---|---|---|---|
| `app/api/mrn/[mrnId]/delete/route.ts:53` | POST | `canDelete` | MRN removal is billing's, not the supervisor's (route comment, design §11 OQ-11) |
| `app/api/sampling-library/route.ts:253` | POST | `canImport` | bulk register+recipe create |

### (b) Mutating routes that check `canView` only — **5**

All five write. All were opened and the writes confirmed.

| # | Route | Method | Page key | Writes | Deliberate? |
|---|---|---|---|---|---|
| 1 | `app/api/picking/done/route.ts:41` | POST | `picking` | `pick_assignments.update:117`, `orders.update:124`, `order_status_logs.create:139` | **YES** — documented at `assign/route.ts:26-29`: it is the picker's own action, bounded by a `pickerId` ownership check |
| 2 | `app/api/picking/findings/report/route.ts:57` | POST | `picking` | `pick_findings.update:276`, `pick_findings.create:301` | **YES** — its own header (`:22-28`) says `picker` holds `canView` only and *"do not 'harden' this to canEdit"* |
| 3 | `app/api/tint/operator/pause/route.ts:52` | POST | `tint_operator` | `tint_pause_events.create:214`, `tint_assignments.update:234`, `order_status_logs.create:253` | **no comment either way** |
| 4 | `app/api/tint/operator/resume/route.ts:31` | POST | `tint_operator` | `tint_assignments.update:124`, `tint_pause_events.update:134`, `order_status_logs.create:143` | **no comment either way** |
| 5 | `app/api/tint/manager/orders/[id]/remove/route.ts:32` | POST | `tint_manager` | `orders.update:96` (soft-remove), `delivery_challans.update:109`, `order_status_logs.create:121` | **no comment either way** |

🔴 **Only rows 1-2 are a live privilege gap.** Checked against the production grid (§6): for page key
`tint_operator` the `canView` holder set (`admin`, `tint_operator`) is **identical** to the `canEdit`
set, and for `tint_manager` it is identical too (`admin`, `operation_manager`, `tint_manager`). Rows
3-5 therefore grant nobody anything extra **today** — they are latent, and would open the moment a
view-only grant on either key is created. `picking` is the one key where the sets differ: `picker`
holds `canView` and not `canEdit` (§6), which is exactly the case rows 1-2 are designed around.

**Three further `canView`-gated POSTs that write NOTHING** — listed so they are not miscounted as (b):

| Route | Why it is a POST |
|---|---|
| `app/api/mrn/resolve-skus/route.ts:49` | reads master data; header at `:32-33` says *"canView, not canEdit: this reads master data and writes nothing"* |
| `app/api/sampling-library/formula-match/route.ts:42` | fingerprint comparison, read-only |
| `app/api/picking/push-test/route.ts:20` | sends a Web Push; no DB write |

### (c) Mutating routes that check nothing beyond "is there a session" — **19**

| # | Route | Method(s) | Note |
|---|---|---|---|
| 1 | `app/api/mail-orders/[id]/customer/route.ts` | PATCH | reassigns the customer on a mail order |
| 2 | `app/api/mail-orders/[id]/lock/route.ts` | PATCH | |
| 3 | `app/api/mail-orders/[id]/note/route.ts` | PATCH | |
| 4 | `app/api/mail-orders/[id]/punch/route.ts` | PATCH | |
| 5 | `app/api/mail-orders/[id]/so-number/route.ts` | PATCH | |
| 6 | `app/api/mail-orders/[id]/split/route.ts` | POST | |
| 7 | `app/api/mail-orders/backfill-customers/route.ts` | POST | marked TEMPORARY (`CORE §13`) |
| 8 | `app/api/mail-orders/learn-customer/route.ts` | POST | writes a learned keyword |
| 9 | `app/api/mail-orders/lines/[lineId]/resolve/route.ts` | POST | |
| 10 | `app/api/mail-orders/lines/[lineId]/status/route.ts` | PATCH | |
| 11 | `app/api/mail-orders/re-enrich/route.ts` | POST | |
| 12 | `app/api/attendance/check-in/route.ts` | POST | self-service; the actor IS the subject |
| 13 | `app/api/attendance/check-out/route.ts` | POST | same |
| 14 | `app/api/attendance/consent/route.ts` | POST | same |
| 15 | `app/api/user/notes-font-size/route.ts` | POST | own preference |
| 16 | `app/api/push/subscribe/route.ts` | POST | own device |
| 17 | `app/api/push/unsubscribe/route.ts` | POST | own device |
| 18 | `app/api/push/test-saved/route.ts` | POST | own device |
| 19 | `app/api/tint/operator/skip/route.ts` | POST | session + an **ownership** check (`"Not your job"`, `:109`) — no role or permission check |

Rows 1-11 are the eleven Mail Orders write routes. They confirm and sharpen `CORE §13`'s
"broad no-role-check gap across `app/api/mail-orders/**`": the gap is not `canView`, it is no
permission check at all. Rows 12-18 are self-scoped (the caller can only affect their own row) and
are a different risk class. Row 19 is ownership-scoped.

**Outside the three lists — 4 mutating handlers with no session at all:**

| Route | Method | Guard |
|---|---|---|
| `app/api/import/obd/route.ts` | POST `?action=auto\|check\|auto-json\|patch-headers\|pending-invoices\|day-obds` | HMAC only, before `auth()` is reached |
| `app/api/mail-orders/ingest/route.ts` | POST | HMAC (`MAIL_ORDER_HMAC_SECRET`) |
| `app/api/mail-orders/backfill-enrich/route.ts` | POST | HMAC — **but its `GET` (`:162`) runs the same `runBackfill()` bulk write with no guard whatsoever.** `CORE §13`'s security entry is accurate and still open. |
| `app/api/admin/skus/[id]/sub-skus/route.ts` | POST | **none** — inert, both handlers return HTTP 410 and touch no data |

The remaining ~70 mutating routes not in (a)/(b)/(c) gate on `requireRole` or an inline
`session.user.role !== "admin"` — a role check, not an action flag, so out of scope for this question.

---

## 4. Import — the three places

`CLAUDE_CORE.md §5` says import authority lives in three places that must stay in step. All three
found. **They do not agree, and there are actually FOUR lists, not three** — the client allow-list
exists in two different versions.

### Place 1 — the `canImport` flag

`app/api/import/obd/route.ts:3795-3799` (quoted in §2.3). Live holders of `import_obd.canImport`
(§6): `admin`, `billing_operator`, `operation_manager`, `operations`, `tint_manager` — **5 roles**.

### Place 2 — the client allow-list `canImportOBDs`

**Two different arrays.** `app/(mail-orders)/mail-orders/mail-orders-page.tsx:169-170`:

```tsx
  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager", "operation_manager", "operations"]
    .includes(session?.user?.role ?? "");
```

and — in **five** tint components (`tint-operator-content.tsx:406`, `tint-manager-content.tsx:1888`,
`ti-report-content.tsx:362`, `shade-master-content.tsx:135`, `challan-content.tsx:63`) — a shorter one:

```tsx
  const canImportOBDs = ["admin", "dispatcher", "support", "billing_operator", "tint_manager"]
    .includes(session?.user?.role ?? "");
```

Both read `session.user.role` — the **primary** role — and neither reads `role_permissions`.

### Place 3 — the route's own `requireRole`

`app/api/import/obd/route.ts:3788-3796`: `[ADMIN, DISPATCHER, SUPPORT, BILLING_OPERATOR,
TINT_MANAGER, OPERATION_MANAGER, OPERATIONS]` — **7 roles**.

### Do they agree?

| Role | `canImport` flag (live) | `requireRole` | Client list — mail-orders | Client list — the 5 tint files | Verdict |
|---|---|---|---|---|---|
| `admin` | ✅ (bypass) | ✅ | ✅ | ✅ | agree |
| `billing_operator` | ✅ | ✅ | ✅ | ✅ | agree |
| `tint_manager` | ✅ | ✅ | ✅ | ✅ | agree |
| **`operations`** | ✅ | ✅ | ✅ | ❌ **absent** | 🔴 **disagree** |
| **`operation_manager`** | ✅ | ✅ | ✅ | ❌ **absent** | 🔴 **disagree** |
| **`dispatcher`** | ❌ **false live** | ✅ | ✅ | ✅ | 🔴 **disagree** |
| **`support`** | ❌ **false live** | ✅ | ✅ | ✅ | 🔴 **disagree** |

**Four roles disagree, in two opposite directions:**

- `operations` and `operation_manager` **hold the flag and pass `requireRole`**, but the five tint
  screens never render an import button for them. They can import from Billing, not from any tint
  screen. Cosmetic — the server would allow it.
- `dispatcher` and `support` are offered the button on **every** screen and pass `requireRole`, then
  hit `403 Permission denied` at the flag. Both hold **all-false** `import_obd` rows live (§6 — the
  key does not appear in the `canImport` list for either). ⚠ `prisma/seed.ts:82,89` seeds them
  `canImport: true`; a wipe-and-reseed silently makes their button work. Already recorded in
  `CORE §5`, and this sweep re-confirms it against live.

The bare `import_obd` **page** (`/import`, `app/(import)/import/layout.tsx:25`) is a fifth surface: it
gates on `canView`, which per §6 **no non-admin role holds** — the module is reachable only through
the universal import modal, which is what `canImportOBDs` controls.

---

## 5. Export and Delete — settled

### `canExport` — read in exactly one module

**Yes, it is read** — but only by MRN, and only since 2026-08-20. Two call sites, §2.4.

**The attendance CSV export does NOT read it.** `app/api/admin/attendance/export/route.ts:39-42`:

```ts
export async function GET(req: Request) {
  const session = await auth();
  if (!hasRole(session, [ROLES.ADMIN])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
```

A **hardcoded role check**, admin only. `ops_admin` holds `attendance_admin.canExport = true` live
(§6) and still gets a 403 — the flag is switched on and does nothing. This is the same 403 already
recorded in `code-discovery-2026-08-28-admin-panel.md §6b`; what is new here is that a granted
`canExport` was supposed to be its answer and is not consulted.

**The Sampling Library export does not exist.** Three "Export →" buttons in
`components/sampling-library/sampling-library-detail-pane.tsx` are `console.log` stubs:

```
:574   onClick={() => console.log("export", detail.samplingNo)}
:658   onClick={() => console.log("export-used-at", detail.samplingNo)}
:752   onClick={() => console.log("export-tinting", detail.samplingNo)}
```

There is no export route under `app/api/sampling-library/`. A repo-wide sweep for `text/csv` /
`Content-Disposition` returns exactly **two** files: the MRN export and the attendance export.
So `sampling_library.canExport`, held live by five roles, has nothing to gate.

🔴 **Live contradicts the MRN export route's own comment.** `app/api/mrn/[mrnId]/export/route.ts:21-22`
asserts:

> *"`floor_supervisor` and `operations` both hold `mrn.canView` TRUE and `mrn.canExport` FALSE, and
> that is DESIGNED, not an oversight in the grant (design §11 OQ-11)."*

The SELECT says `floor_supervisor` is FALSE (comment correct) but **`operations` is TRUE** — it is in
the `canExport` list at §6. `prisma/seed.ts:143` also seeds `operations`/`mrn` with `canExport: false`.
So the live row drifted from both the seed and the documented design, and `operations` can pull
billing's MRN report today. The comment's sibling claim about `canDelete` **is** correct: neither
`floor_supervisor` nor `operations` holds it.

**What would have to change for `canExport` to work elsewhere:** the attendance export would have to
swap `hasRole(session, [ROLES.ADMIN])` for `checkAnyPermission(roles, "attendance_admin",
"canExport")`; the Sampling Library would need an export route to exist at all before its flag means
anything.

### `canDelete` — read once

**Yes, it is read** — `app/api/mrn/[mrnId]/delete/route.ts:53`, and nowhere else. Before MRN shipped
this flag was genuinely stored-only; it now has exactly one consumer.

Everything else that deletes uses a role check instead. The nearest miss is
`app/api/tint/manager/orders/[id]/remove/route.ts:32` — a soft-remove of an order plus its challan —
which gates on `tint_manager`/**`canView`** (list (b) row 5).

**What would have to change:** each delete/remove/void path would need its own `checkAnyPermission(…,
"canDelete")`, and a page key would have to be chosen for the ones that currently have none.

---

## 6. Live data — `role_permissions`, 2026-08-30

Read-only `SELECT`, **115 rows**, 24 distinct page keys, 13 role slugs (matches the 2026-08-28
baseline exactly — no rows added or removed in two days).

| Flag | Rows true | Non-admin rows true |
|---|---|---|
| `canView` | **49** | 35 |
| `canEdit` | **44** | 30 |
| `canExport` | **23** | 10 |
| `canImport` | **18** | 5 |
| `canDelete` | **14** | 1 |

`admin` holds 14 rows and is all-true on 13 of them (`floor` is V+E only) — every helper
short-circuits on `roleSlug === "admin"` before the table is read, so all 14 are cosmetic.

### `canView` = true — 49 rows

`admin` × 14 (customers, dashboard, floor, import_obd, permissions, place_order, routes_areas,
sampling_library, skus, system_config, tint_manager, tint_operator, users, vehicles), plus:

```
billing_operator   mail_orders, mrn, place_order
dispatcher         place_order
floor_access       floor
floor_supervisor   mrn, picking
logistics          trip_report
operation_manager  customers, delivery_challans, mail_orders, place_order, sampling_library, ti_report, tint_manager
operations         floor, mail_orders, mrn, operations_tint_operator, operations_tinting, picking
ops_admin          attendance_admin, sampling_library
picker             picking
support            place_order
tint_manager       customers, delivery_challans, mail_orders, place_order, sampling_library, shade_master, ti_report, tint_manager
tint_operator      sampling_library, tint_operator
```

### `canEdit` = true — 44 rows

`admin` × 14, plus:

```
billing_operator   mail_orders, mrn, place_order
dispatcher         place_order
floor_access       floor
floor_supervisor   mrn, picking
operation_manager  customers, delivery_challans, mail_orders, place_order, sampling_library, tint_manager
operations         floor, mail_orders, mrn, operations_tint_operator, operations_tinting, picking
ops_admin          sampling_library
support            place_order
tint_manager       customers, delivery_challans, mail_orders, place_order, sampling_library, shade_master, tint_manager
tint_operator      sampling_library, tint_operator
```

**The `canView`-without-`canEdit` set** (the whole population list (b) could ever affect) is exactly
**five non-admin rows**: `logistics`/`trip_report`, `ops_admin`/`attendance_admin`,
`picker`/`picking`, `operation_manager`/`ti_report`, `tint_manager`/`ti_report`. Of these only
`picker`/`picking` has a mutating route gated on `canView` (§3b rows 1-2, both deliberate).

### `canImport` = true — 18 rows

`admin` × 13 (all but `floor`), plus **5 non-admin**:

```
billing_operator   import_obd
operation_manager  import_obd
operations         import_obd
tint_manager       import_obd
ops_admin          sampling_library
```

`ops_admin`/`sampling_library`/`canImport` is the only non-`import_obd` grant, and it is **live** —
it is what `app/api/sampling-library/route.ts:253` asks for. Note `tint_manager`, `tint_operator` and
`operation_manager` hold `sampling_library` `canView`+`canEdit` but **not** `canImport`, so the
Sampling Library POST (create a register entry) is open to `admin` and `ops_admin` only.

### `canExport` = true — 23 rows

`admin` × 13 (all but `floor`), plus **10 non-admin**:

```
billing_operator   mrn                ← LIVE: gates app/api/mrn/[mrnId]/export
operations         mrn                ← LIVE, and contradicts that route's own comment (§5)
operation_manager  sampling_library, ti_report, tint_manager
ops_admin          attendance_admin, sampling_library
tint_manager       sampling_library, ti_report, tint_manager
```

**Eight of these ten do nothing.** Only the two `mrn` rows reach a call site. `attendance_admin` has
an export route that ignores the flag; `sampling_library`, `ti_report` and `tint_manager` have no
export route at all.

### `canDelete` = true — 14 rows

`admin` × 13 (all but `floor`), plus **one non-admin row in the entire database**:

```
billing_operator   mrn                ← LIVE: gates app/api/mrn/[mrnId]/delete
```

The single non-admin `canDelete` grant in production is the single one the code reads. Nothing is
switched on that does nothing here.

---

## Open questions — things this sweep could not settle

1. **`tint/operator/pause`, `resume`, and `tint/manager/orders/[id]/remove` carry no comment either
   way.** Whether `canView` was chosen (as on `picking/done`, which says so in prose) or inherited by
   copy-paste is not recoverable from the code. All three write; none is exploitable today because
   the holder sets are identical (§3b). Owner call.
2. **`operations`/`mrn`/`canExport = true` live vs `false` in seed and in the route's own comment.**
   Someone flipped the live row, or the row was created before the design settled. Which of the three
   is wrong is a decision, not a fact — and a wipe-and-reseed would silently revoke it either way.
3. **`ops_admin` holds `attendance_admin.canExport` but the export route is admin-only.** Whether the
   grant was made expecting the route to honour it, or whether admin-only is deliberate (bulk extract
   of DPDP-sensitive attendance data), is unresolved — the same open item as
   `code-discovery-2026-08-28-admin-panel.md §6b`, now with the extra fact that a granted flag exists
   and is ignored.
4. **`CORE §13`'s two-part claim needs correcting**, but the correction is a doc edit, not a code
   change, and is out of scope here: the picking half was fixed in code on 2026-07-20, and the Mail
   Orders half understates the gap (no check at all, not `canView`).
5. **The two client `canImportOBDs` arrays** — whether the five tint files are deliberately narrower
   than the mail-orders one, or simply were not updated when `operations` and `operation_manager`
   were granted, cannot be told from the code. Both are role lists that never read the flag.

---

*Discovery only. No application code was written, edited, archived or moved. One read-only query
script was added at `scripts/_chk-perm-actions-20260830.ts` (underscore-prefixed, outside the `tsc`
gate per `tsconfig.json`'s `exclude`).*
