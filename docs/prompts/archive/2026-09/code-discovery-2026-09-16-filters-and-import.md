# Code discovery — filter chip gating + the Import tick

**Date:** 2026-09-16 · **Type:** DIAGNOSIS ONLY — no code, no DB writes, no SELECT run
**Files read:** CLAUDE.md (Router v1.12), docs/CLAUDE_CORE.md (v104 · Schema v27.24 — §3, §5, §7.10,
§7.14, §7.15), docs/CLAUDE_UI.md (v5.29), docs/CLAUDE_IMPORT.md (v1.10 — §9, §11),
docs/CLAUDE_MAIL_ORDERS.md (v1.13 — §21, §22, §23), the 2026-09-11 discovery drafts
(billing-action-ticks, hide-scope-access, hide-tags, hide-tags-billing), lib/permissions.ts,
lib/rbac.ts, lib/hide/tag-catalog.ts, lib/hide/tag-settings.ts,
components/billing/billing-actions-access-provider.tsx, components/billing/billing-action-ribbon.tsx,
app/(mail-orders)/mail-orders/{layout,mail-orders-page,review-view}.tsx, components/header-filter.tsx,
components/universal-header.tsx, app/api/import/obd/route.ts (POST router), middleware.ts,
app/(import)/import/{layout,page}.tsx, app/(admin)/admin/import/page.tsx, the five tint content
components' import wiring.

⚠ **Two paths named in the prompt do not exist:** `docs/prompts/archive/2026-09/` (no such folder —
archive stops at 2026-08) and `docs/prompts/drafts/code-update-2026-09-12-hide-scope-and-action-ticks.md`
(never committed under that name). The 2026-09-11 drafts above plus commits `abd495f4` (hide scope)
and `a991a1c4` (billing ticks) were read in their place.

---

## Part 1 — Filter chips

### 1.1 Where the panel lives

- **One array, two mounts.** `MO_FILTER_GROUPS`, `app/(mail-orders)/mail-orders/mail-orders-page.tsx:31-38`.
  - Billing face (flag ON, Focus): `HeaderFilter` inside `billingHeaderSlot`, `:1207-1211`, dividers `:1206` / `:1212`.
  - Old Mail Orders face (flag OFF, or Table mode): `UniversalHeader filterGroups={MO_FILTER_GROUPS}`, `:1346-1348`
    (suppressed on the billing face by `suppressFilterBar={billingV2 && viewMode === "focus"}`, `:1345`).
- State: `headerFilters` `useState`, `:182` — in-memory only.
- Applied in `filteredOrders`, `:425-512`. Also read by `hasHeaderFilter`, `:523-526` (drives the billing empty-state copy).
- Renderer: `components/header-filter.tsx` — groups loop `:152-180`, heading `:154-160` (drawn unconditionally),
  count badge `:92-94` (counts EVERY value in `activeFilters`), toggle `:96-106` (spreads the whole
  `activeFilters`), Clear all `:111-116` (rebuilds from the groups it was PASSED), returns `null` when
  `groups` is empty `:118`.

### 1.2 Chip table — all eleven chips, nothing else exists

"Finds" = the predicate in `filteredOrders`. No chip exists outside these six groups.

| Group | Chip | Def `page.tsx` | Predicate | Proposed owner | Loses a FIND ability? | Recommendation |
|---|---|---|---|---|---|---|
| STATUS | Pending | :32 | `status` `:428-431` | **nothing** | Yes — the core triage | **Always shown** |
| STATUS | Punched | :32 | same | **nothing** | Yes — "what did we already do" | **Always shown** |
| MATCH | Matched | :33 | `customerMatchStatus` `:433-436` | **nothing** | Yes | **Always shown** |
| MATCH | Multiple | :33 | same | **nothing** | Yes — billing must resolve these before punching | **Always shown** |
| MATCH | Unmatched | :33 | same | **nothing** | Yes — same | **Always shown** |
| DISPATCH | Hold | :34 | `dispatchStatus` `:438-441` | tick **`billing_hold`** | Yes — "show me held bills" | **Follow `billing_hold`** — owner call, see note A |
| DISPATCH | Dispatch | :34 | same (the complement) | tick **`billing_hold`** (pair) | Yes, same fact inverted | **Follow `billing_hold`** — never split from Hold |
| PRIORITY | Urgent | :35 | `dispatchPriority` `:444-450` | tick **`billing_urgent`** | Yes — "show me urgent" | **Follow `billing_urgent`** — owner call, note A |
| PRIORITY | Normal | :35 | same (complement) | tick **`billing_urgent`** (pair) | Yes | **Follow `billing_urgent`** |
| LOCK | Locked | :36 | `isLocked OR isOdCiFlagged()` `:453-460` | **nothing** — note B | Yes — OD/CI blocked bills | **Always shown** |
| LOCK | Unlocked | :36 | same | **nothing** | Yes | **Always shown** |
| DEALER | Key | :37 | `isKeyCustomer` `:463-465` | tag **`mail_orders.key_customer`** (`tag-catalog.ts:50`, entry `:82`) | Minor | **Follow the tag** — note C |

**Neither `billing_slot` nor `billing_ship_to` owns any chip** — there is no Slot or Ship-to filter.

**Note A — why Hold/Urgent follow the TICK, not the tag.** On the billing face the `mail_orders.hold` and
`mail_orders.urgent` tags are *dead*: the ship card's Urgent and status chips are stripped at the call
site (`review-view.tsx:1506`), and the rail never draws them. The ONLY place a billing user sees
hold/urgent state is the ribbon button itself, gated on the tick (`billing-action-ribbon.tsx:58`, `:82`).
So for a person without the tick, the Hold chip would be the one thing left on the screen that knows
about hold — pressing it narrows the rail to rows that show no visible reason for being there. Following
the tick keeps "what you can see" and "what you can filter on" the same. **The cost is real and is the
owner's to accept:** a punch-only operator loses the ability to *find* held bills. If the owner wants
finding kept, the alternative is "always shown" for DISPATCH and PRIORITY — do not choose the tag; it
controls nothing on this face.

**Note B — LOCK has no owner, and should not get one now.** The predicate mixes two facts: the manual
flag (`isLocked`, written by `handleFlag` `:603-624` / key **F** `:1075-1080`, server-gated on
`mail_orders` canEdit at `app/api/mail-orders/[id]/lock/route.ts:20`) and a regex over remarks/subject
(`lib/mail-orders/utils.ts:614-631`, which also matches "bill tomorrow"). The amber rail border shows
the same thing to everyone regardless of any tag (`review-view.tsx:1109`). The 2026-09-11 hide-tags
draft *proposed* a `mail_orders.locked` key; it was never minted (not in `MO_TAG`). Nothing hides the
lock state, so nothing should hide the chip. Minting a key just for this chip is not justified.

**Note C — Key dealer.** The ★ on the rail (`review-view.tsx:1166`) and the "Key" pill on the Bill To
card (`:2219`) already follow `mail_orders.key_customer`. A Key chip that still filters on a hidden
star leaks the fact the admin hid. ⚠ Tags have **no admin bypass** (`tag-settings.ts` header) — Harsh
loses the chip too if the tag is off for him; ticks DO bypass for admin/superuser. Test as a real user.

**Do NOT reuse `mail_orders.match_chip` for MATCH.** That key is the "✓ 6/6" SKU-*line* readiness chip
(`tag-catalog.ts:83`, `review-view.tsx:2414`); the MATCH filter is *customer* match. Different facts.

### 1.3 Already-applied filter when its chip disappears (stuck-filter risk)

**Real, and it has two entry points:**
1. **Tags change mid-session.** `disabledTagKeys` is re-set on every `loadOrders` (`page.tsx:287`),
   which the 30s marker drives. An admin turning `key_customer` off while an operator has **Key**
   applied would hide the chip but leave `headerFilters.keyDealer = ["key"]`.
2. **Ticks are fixed per page load** (`layout.tsx:96-99`), so they only change on reload — and state
   resets on reload. Low risk, but the same fix covers it.

Consequences if the groups array is merely filtered: `filteredOrders` keeps narrowing on the invisible
value; the Filter button's count badge (`header-filter.tsx:92-94`) still counts it; `hasHeaderFilter`
stays true so the empty state says "No orders match your filter" with no visible filter to clear;
toggling any other chip re-spreads the hidden value (`:103`). "Clear all" happens to drop it (it
rebuilds from passed groups, `:111-116`), but only if the operator thinks to press it.

**Avoid it by deriving, not mutating:** compute `visibleGroups` (options filtered, empty groups dropped)
and `effectiveFilters` = `headerFilters` intersected with the visible options — as a `useMemo`, never a
`setState` in an effect. Use `effectiveFilters` in **all three** readers: `filteredOrders`,
`hasHeaderFilter`, and the `activeFilters` prop to the billing `HeaderFilter`. The raw state can keep the
stale value harmlessly; if the chip comes back, the filter comes back with it (acceptable — it is the
operator's own selection). No change to `header-filter.tsx` is needed.

### 1.4 When a whole group empties

`header-filter.tsx:154-160` draws the heading for every group it is given, and `gi === 0` picks the top
margin by array index. So **drop empty groups before passing** (`groups.filter(g => g.options.length > 0)`) —
the heading goes with it and the first remaining group gets the right margin for free. Pairs (Hold+Dispatch,
Urgent+Normal) always empty together, so a half-group never appears.
Edge: if every group empties, `HeaderFilter` returns `null` (`:118`) but the two dividers at
`page.tsx:1206` and `:1212` would sit back to back. Not reachable with this plan (STATUS/MATCH/LOCK are
always shown), but gate the first divider on `visibleGroups.length > 0` anyway — it costs one condition.

### 1.5 Anything that could re-apply a hidden filter behind the panel's back

**None found.** Checked:
- `setHeaderFilters` has exactly two writers — both are `HeaderFilter` `onFilterChange` props (`:1210`, `:1348`).
- **Keyboard:** no shortcut writes filters. **N** (`:1104-1118`) *jumps* to the next row with unmatched
  SKU lines — navigation, not a filter, and it is line match, not customer match. **F** toggles the lock
  (a write). 1-9 slot jumps are gone on the billing face (`segments={undefined}`).
- **localStorage:** `mo-column-visibility` (`page.tsx:258/:272`), `mo-review-desc-mode`
  (`review-view.tsx:647/:707`), the legacy notes-size key (removed, `:718`), the write-only
  `mo-slot-email-sent-*` (`:368`). None stores filters.
- **URL:** no `useSearchParams` / `URLSearchParams` in the module.
- **Search:** the 19-field matcher (`:467-500`) reads none of `dispatchStatus`, `dispatchPriority` or
  `isKeyCustomer`, so typing cannot reproduce a hidden chip.
- The "N Urgent · N Hold" strip (`:1483-1491`) is Table-mode only and is a readout, not a filter.

### 1.6 The old Mail Orders face

**Yes, the same array renders there** (`:1346`). Recommendation: **leave it untouched.** §23.1 requires the
flag-OFF path to stay byte-identical, the four ticks scope the BILLING face only (CORE §5), and on the old
face the Hold/Urgent badges are governed by the tags, not the ticks — gating its chips on ticks would be
a second, contradictory rule. Build `visibleGroups` only when `billingV2` and pass it only to the
`billingHeaderSlot` mount. Billing users cannot reach Table mode (the toggle is hidden), so the header
mount never shows them the ungated array.

---

## Part 2 — The Import button

### 2.1 Every place that decides it today

| # | Where | file:line | Rule | Allows |
|---|---|---|---|---|
| 1 | Billing / Mail Orders button | `mail-orders-page.tsx:171-172`, used `:1267` | **primary** role in a 7-list | admin, dispatcher, support, billing_operator, tint_manager, operation_manager, operations |
| 2 | Tint Manager button | `components/tint/tint-manager-content.tsx:82-83`, `:821` | primary role in a **5-list** | admin, dispatcher, support, billing_operator, tint_manager |
| 3 | Tint Operator button | `tint-operator-content.tsx:406-407`, `:1613` | same 5-list | same |
| 4 | Challans button | `challan-content.tsx:63-64`, `:310` | same 5-list | same |
| 5 | Shades button | `shade-master-content.tsx:135-136`, `:221` | same 5-list | same |
| 6 | TI Report button | `ti-report-content.tsx:362-363`, `:469` | same 5-list | same |
| 7 | Modal mount | `components/universal-header.tsx:655-657` (button `:481/:506/:517-520`) | `showImport` prop | whatever the caller passed |
| 8 | Import route — role | `app/api/import/obd/route.ts:4596-4604` | `requireRole` over **all** held roles (`lib/rbac.ts:58-66`) | the 7-list. ⚠ Fails with `redirect("/unauthorized")`, not a 403 |
| 9 | Import route — tick | `route.ts:4605-4606` | `checkPermission(session.user.role, "import_obd", "canImport")` (`lib/permissions.ts:665-688`) | user mode: the person's tick; admin **primary** role or superuser bypass. Role mode: **primary role only**, no merge |
| 10 | `/import` page | `app/(import)/import/layout.tsx:20` | `requireRole` | admin, dispatcher, support only — its page (`ImportPageContent`) posts to the same route |
| 11 | `/import` sidebar link | `lib/permissions.ts:43` (`PAGE_NAV_MAP`) | `import_obd` **canView** | anyone with canView — who then hits #10 |
| 12 | `/admin/import` | `app/(admin)/admin/layout.tsx:16` `requireSuperuser` | superuser | Harsh |

So a person must pass #8 AND #9 to import, while the button follows #1-#6, which check neither the
tick nor secondary roles. Two different client lists exist, not one.

### 2.2 What to change so the tick is the only rule

**Server (`route.ts`):**
- Delete the `requireRole` block `:4596-4604`.
- Replace `:4605` with a session null-check (→ 401) and
  `checkAnyPermission(session.user.roles ?? [session.user.role], "import_obd", "canImport")` → 403.
  `checkAnyPermission` keeps both superuser arms (admin in ANY role, or the flag — `permissions.ts:696-700`)
  and, in role mode, OR-merges secondary roles, which `checkPermission(primary)` does not.
- **"Tick only" still includes the superuser bypass.** That is the resolver's contract (CORE §5 safety rule), not a second rule — say so to the owner.

**Must stay exempt, untouched, and ABOVE the new check:**
- `middleware.ts:46-53` — session bypass for `x-import-key-id` = `auto-import-v1` / `auto-import-json-v1`.
- `route.ts:4588-4593` — the six HMAC actions dispatched before session auth: `auto` (v1), `check`,
  `auto-json`, `patch-headers`, `pending-invoices`, `day-obds`.

**Client (six sites):** replace the six role lists with the tick. The five tint screens sit under a bare
`app/(tint)/layout.tsx` and pages with mixed auth, so there is no shared layout to courier from. One
mechanism for all six: a small `GET` (e.g. `/api/import/obd/access` → `{ canImport }`, force-dynamic, same
`checkAnyPermission` call) read once on mount by a `useCanImportObds()` hook, **default false**. Each
content component passes its result as `showImport`. `UniversalHeader` keeps its neutral prop — it must
not learn about permissions (§23.1).

**Owner decision, not bundled silently:** `/import` (#10) still says admin/dispatcher/support. For "one
rule" it should gate on `import_obd` canImport too, and the sidebar link (#11) reads canView. Recommend
moving #10 to canImport in the same commit; leave #11 alone (canView is the sidebar's contract everywhere).

### 2.3 Who gains or loses

Reasoned from code, not data (SELECT below not run). In `user` mode:
- **Server — nobody loses.** Today's route already requires the tick (or superuser); tick-only is a
  strict superset. **Gains:** tick holders whose roles are all outside the 7-list (e.g. floor_supervisor,
  picker, logistics, tint_operator, ops_admin), who today are redirected despite the tick; anyone with
  `admin` as a *secondary* role.
- **Button — gains:** tick holders on tint screens whose primary role is operation_manager or operations
  (e.g. operations on `/operations/tinting`, which renders `TintManagerContent` — no button today), and
  anyone outside the lists. **Loses:** people who see a button today without the tick — seed says
  dispatcher and support, whose live ticks are all-false (CORE §5). That button already 403s, so they lose
  a dead control, not an ability.

```sql
-- READ-ONLY. Import: today vs tick-only, per active user. Assumes ACCESS_SOURCE = 'user'.
WITH u AS (
  SELECT us.id, us.name, us."isSuperuser",
         pr.name AS primary_role,
         COALESCE(
           (SELECT array_agg(rm.name ORDER BY rm.name)
              FROM user_roles ur JOIN role_master rm ON rm.id = ur."roleId"
             WHERE ur."userId" = us.id),
           ARRAY[pr.name]) AS roles
  FROM users us
  JOIN role_master pr ON pr.id = us."roleId"
  WHERE us."isActive" = true
)
SELECT u.id, u.name, u.primary_role, u.roles, u."isSuperuser",
       COALESCE(upa."canImport", false) AS tick_can_import,
       u.primary_role IN ('admin','dispatcher','support','billing_operator','tint_manager','operation_manager','operations')
         AS billing_button_today,
       u.primary_role IN ('admin','dispatcher','support','billing_operator','tint_manager')
         AS tint_button_today,
       (u.roles && ARRAY['admin','dispatcher','support','billing_operator','tint_manager','operation_manager','operations'])
         AND (COALESCE(upa."canImport", false) OR u.primary_role = 'admin' OR u."isSuperuser")
         AS may_import_today,
       (COALESCE(upa."canImport", false) OR 'admin' = ANY(u.roles) OR u."isSuperuser")
         AS may_import_tick_only
FROM u
LEFT JOIN user_page_access upa ON upa."userId" = u.id AND upa."pageKey" = 'import_obd'
ORDER BY may_import_tick_only DESC, u.name;
```

Check `SELECT value FROM system_config WHERE key = 'ACCESS_SOURCE';` first — if it reads `role`, the
`may_import_today` column is wrong (role mode reads `role_permissions` for the primary role).

### 2.4 Does any other screen mount the import modal?

**No — the premise is wrong. It is mounted on SIX components across 13 routes**, all through
`UniversalHeader` with `showImport`:
- `/mail-orders` (MailOrdersPage)
- `/tint/manager`, `/admin/tint-manager`, `/operations/tinting` (TintManagerContent)
- `/tint/operator`, `/operations/tint-operator` (TintOperatorContent)
- `/challan`, `/tint/manager/challan` (ChallanContent)
- `/tint/shades`, `/tint/manager/shades` (ShadeMasterContent)
- `/ti-report`, `/tint/manager/ti-report`, `/reports` (TIReportContent)

Also: `ImportProgressPill` renders in every `UniversalHeader` regardless (`universal-header.tsx:422`),
offering "import another" only when `showImport`. `/import` and `/admin/import` do not use the modal but
post to the same route.

---

## Part 3 — Build plan

**Two commits, import first.** They share no files, and the import change is server-side authority
(worth landing and verifying on its own), while the chips are billing-face UI.

**Commit 1 — `import: the import_obd tick is the only rule`**
- `app/api/import/obd/route.ts` — drop `requireRole`, switch to `checkAnyPermission` over all roles; HMAC block untouched above it.
- New `GET` access route + `useCanImportObds()` hook (fail-closed false).
- The six client sites: role list → hook.
- `app/(import)/import/layout.tsx` — to canImport, **if the owner agrees** (2.2).
- Gates: `tsc --noEmit`; confirm the six HMAC dispatches still precede auth (grep); run the 2.3 SELECT first
  and show the owner the gain list before pushing.
- Risks: a button that appears ~one fetch after mount (starts hidden — correct direction); a new route
  that must carry `force-dynamic`; the day's auto-import is unaffected only if the HMAC lines stay above the check.

**Commit 2 — `billing: filter chips follow the action ticks and the key-dealer tag`**
- `mail-orders-page.tsx` only: `visibleGroups` + `effectiveFilters` memos (billing face only), used by
  `filteredOrders`, `hasHeaderFilter` and the billing `HeaderFilter` mount; first divider gated.
  `useBillingActionsAccess()` is already reachable (provider in the layout).
- OFF path: `MO_FILTER_GROUPS` still goes to `UniversalHeader` unchanged — verify with a diff of the flag-OFF branch.
- Gates: `tsc`; test as a non-admin pilot user (ticks bypass for admin, tags do not — admin testing proves
  nothing, MAIL_ORDERS §22).
- Risks: the stuck filter (1.3) if any reader is left on raw `headerFilters`; the owner's note-A decision
  on whether finding held/urgent bills should survive a missing tick.

**No new keys.** Every chip either has an existing owner (`billing_hold`, `billing_urgent`,
`mail_orders.key_customer`) or genuinely needs none (STATUS, MATCH, LOCK). The one chip group that
arguably has no owner — LOCK — should stay always-shown rather than mint `mail_orders.locked`.

---

## Where docs and code disagree (code wins)

1. **CORE §5 permissions paragraph** — "⚠ Nothing reads them yet — all four buttons still gate on
   `mail_orders` canEdit". **Stale:** `a991a1c4` wired them — `layout.tsx:96-99`, the ribbon, the ✎ pencil
   (`review-view.tsx:2249`) and the route (`app/api/billing/mail-order/actions/route.ts:123-126`).
2. **`lib/permissions.ts:360-362`** — code comment says the same stale thing ("THE CHECKS THESE ANTICIPATE DO NOT EXIST YET").
3. **CORE §5 `import_obd` row** — "three places, keep in step". Actually **six** client allow-lists in
   **two different** versions (7-role vs 5-role), plus the route's role list, the route's tick, and the
   `/import` layout's own 3-role list.
4. **CLAUDE_IMPORT §9 snippet** — already flagged as lagging on 2026-09-14; additionally it shows
   `checkPermission` guarded by `role !== "admin"`, which is gone, and does not mention the `requireRole`
   failure mode is a redirect, not a 403.
5. **CORE §7.14** — "one of the 27 ALL_PAGE_KEYS values". Now more: `billing_picking`, `billing_print`
   and the four billing ticks have been added since.
6. **MAIL_ORDERS §22** — "Mail Orders uses only `checkAnyPermission`; `requireRole`/`hasRole` are unused".
   True of its routes, but the page's Import button is decided by a hardcoded role list (#1) and the import
   route uses `requireRole`.
