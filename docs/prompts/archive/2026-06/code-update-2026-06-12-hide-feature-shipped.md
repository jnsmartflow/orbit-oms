# Session End — Hide Feature (OBD hide + Tag hide)

**Date:** 2026-06-12
**Status:** SHIPPED to `main` (live on production)
**Mockup:** `docs/mockups/settings/obd-hide-mockup.html` (approved)
**Filename for archive:** `code-update-2026-06-12-hide-feature-shipped.md`

---

## 1. What shipped (plain summary)

A new admin area **Settings → Hide** with three tabs, plus a ship-to display tweak:

- **Rules** — admin creates rules that auto-hide whole OBD/orders across every order screen. v1 conditions: **HOLD** (dispatchStatus = "hold") and **older than N days**. Toggle on/off, edit, delete.
- **Hidden Orders** — every hidden order, with *why* (rule name or manual reason + who/when). Manual hides have **Un-hide**; rule-hidden rows show **"Managed by rule"** (you change the rule to reveal them).
- **Tags** — on/off switches for Mail Order badges, app-wide. Turning one off hides that badge everywhere; data stays. Important tags (Hold/OD/CI) confirm before turning off.
- **Manual hide** — admin-only "Hide OBD…" action on Tint Manager rows (card + table) with a reason; the order drops off all boards and appears in Hidden Orders.
- **Ship-to fallback** — when the **captured** tag is off, the ship-to card shows the **bill-to** details instead of the captured override (display only).

Default state = no rules, nothing hidden, all tags on → app behaves exactly as before until an admin acts. Everything is reversible; nothing is ever deleted.

---

## 2. Schema (live + committed)

`sql/2026-06-12-hide-feature.sql` (run in Supabase SQL Editor, no transaction wrapper).

**New table `obd_visibility_rules`** — id, ruleName, conditionType ('tag' | 'daysOld'), conditionTag (e.g. 'HOLD'), conditionDaysGt, isActive (default true), createdById, createdAt, updatedById, updatedAt. Index on isActive.

**`orders` new columns** — isHidden (bool default false), hiddenById, hiddenReason, hiddenAt. Index on isHidden.

**New table `app_tag_settings`** — id, tagKey (unique), isEnabled (default true), updatedById, updatedAt.

Prisma: scalar fields only, no relations wired. Timestamps `@db.Timestamptz(6)` to match sibling columns.

---

## 3. Backend

**Helpers (`lib/hide/`):**
- `visibility.ts` — `getActiveHideRules()`, `getHideExclusion()` (where-fragment that EXCLUDES hidden orders — NULL-safe, see learnings), `getHiddenWhere()` (inverse, for the Hidden Orders list), `matchesRule(rule, order)` (in-memory matcher for labeling).
- `tag-settings.ts` — `getTagSettings()` (map tagKey→isEnabled), `isTagEnabled(map, key)` (default TRUE).
- `tag-catalog.ts` — `MO_TAG` stable-key constants + `TAG_CATALOG` (16 Mail Order entries; important: Hold, OD, CI).

**Admin APIs (all admin-only, force-dynamic, sequential awaits):**
- `GET/POST /api/admin/hide/rules`, `PATCH/DELETE /api/admin/hide/rules/[id]` (v1 validation: tag must be 'HOLD'; daysOld needs int ≥ 1).
- `POST /api/admin/hide/orders/[id]/hide` (reason required) + `/unhide` — both write `order_status_logs` (toStage ORDER_HIDDEN / ORDER_UNHIDDEN).
- `GET /api/admin/hide/hidden-orders` — `{ isRemoved:false } AND getHiddenWhere()`; labels each row manual vs rule.
- `GET/PATCH /api/admin/tag-settings` — upsert on tagKey.

---

## 4. Where the hide filter is applied (global)

`getHideExclusion()` AND-merged into every order-display query. Direct orders → `where: { AND: [ existing, hideExclusion ] }`. Splits/assignments → `order: { AND: [ { isRemoved:false }, hideExclusion ] }`.

Wired: Tint Manager (pending, completed-today, active/completed splits, completed assignments), TM missing-customers, Tint Operator my-orders (+3 splits), Support orders + slots, Planning board, Warehouse board, Operations summary.

Deliberately NOT filtered: Delivery Challans (audit OR), Admin Removed Orders (inverse), Import internals, TM reorder helper, the Hidden Orders list itself, and Mail Orders rows (separate `mo_orders` table — out of v1 scope).

---

## 5. Feature B — tag gating flow

`getOrderSignals()` (`lib/mail-orders/utils.ts`) is the SINGLE Mail Order badge emitter. Each emitted signal now carries a `tagKey`; it accepts `opts.disabledTagKeys: Set<string>` and filters out disabled signals.

Flow: `/api/mail-orders` computes `disabledTags` (keys where isEnabled === false) via `getTagSettings()` → payload → `mail-orders-page.tsx` stores a Set → drills into `review-view.tsx` (2 getOrderSignals calls + ShipToCard) and `mail-orders-table.tsx` → `SlotGroup` → `OrderRow`. Ship-to "captured" gated in `ship-to-card.tsx`. Default-ON (no settings row = badge shows).

**Ship-to fallback:** `useBillToFallback = isOverride && disabledTagKeys.has(MO_TAG.captured)` → ShipToCard renders bill-to identity (name/code/area/delivery type), drops the amber bar + captured pill. Bill-to fields threaded from review-view. Dispatch-status badges (Challan/Dispatch/Hold) untouched.

---

## 6. UI files

- Nav: **`components/admin/admin-sidebar.tsx`** — new "Settings" section with "Hide" (EyeOff icon).
- `lib/permissions.ts` — `settings_hide` in PageKey union + ALL_PAGE_KEYS (admin auto-ALL_TRUE). NOT in PAGE_NAV_MAP (that feeds the operational sidebars; would duplicate).
- `app/(admin)/admin/settings/hide/page.tsx` — server page, relies on admin layout's requireRole(ADMIN).
- `components/admin/hide-settings-content.tsx` — Rules / Hidden Orders / Tags tabs.
- `components/tint/HideObdModal.tsx` + edits to `tint-manager-content.tsx` and `tint-table-view.tsx` — admin-only "Hide OBD…" action.

---

## 7. Key decisions

- Hybrid hide: rules (bulk) + manual one-off. Global scope (hides everywhere). Stays hidden until turned off (no auto-expiry). Admin only. All reversible, all audited.
- Lean v1: hide **orders** (not mail-order rows); Tags = **Mail Order badges** (not Tint badges).
- Rule conditions v1: HOLD + daysOld only (URGENT / MISSING_CUSTOMER deferred — schema is generic).
- Single "Hide" nav home with 3 flat tabs (Rules · Hidden Orders · Tags); "Settings" grouping in the admin sidebar.

---

## 8. KEY LEARNINGS / CORRECTIONS (important for future sessions)

1. **Admin sidebar nav = `components/admin/admin-sidebar.tsx`** (a `NAV_SECTIONS` array with section headers OVERVIEW / MASTER DATA / PEOPLE / OPERATIONS / PERSONAL / now SETTINGS). `lib/permissions.ts` `buildNavItems()` / `PAGE_NAV_MAP` feeds the **operational / role-based** sidebars, NOT the admin panel. CORE §5 ("nav items come from buildNavItems() only") is misleading for `/admin/*` — correct it.
2. **NULL three-valued logic.** Prisma `NOT { field: value }` on a NULLABLE column drops NULL rows (e.g. a "hide if HOLD" rule hid every order whose dispatchStatus was null). For "exclude matching" filters, build NULL-safe KEEP conditions: `{ OR: [ { field: null }, { field: { not: value } } ] }`, AND-combined. Fixed in `getHideExclusion()`.
3. **`orders.dispatchStatus` Hold value is lowercase `"hold"`.** The capitalized `"Hold"` belongs to the mail-orders pipeline (`getOrderSignals` status badge), not the orders table.
4. **MO badges all come from `getOrderSignals()`** — one emit point, easy to gate. Tint badges are NOT centralized (hardcoded across 3 components, getAgeBadge duplicated) — gating them is the deferred "hard part".
5. **Hide audit reuses `order_status_logs`** (toStage ORDER_HIDDEN / ORDER_UNHIDDEN, note carries the reason). No separate audit table.
6. **Rule-hidden orders have no per-order un-hide** in v1 (no exception/pin). Hidden Orders tab shows "Managed by rule"; only manual hides get an Un-hide button.

---

## 9. Commits (in order)

- `54dbd225` — schema (rules table, tag settings table, orders hide columns)
- `48260591` — backend (helpers, admin APIs) + apply hide filter to all order boards
- `80fdba3c` — admin UI (Hide page, Rules + Hidden Orders tabs, manual hide action)
- *(sidebar)* — add Settings section to admin sidebar with Hide item
- *(fix)* — blank-safe HOLD exclusion (NULL-safe keep conditions)
- `13072cb0` — nav cleanup + Hidden Orders rule-row (manual-only un-hide)
- *(Feature B)* — tag on/off (catalog, getOrderSignals gating, Tags tab)
- `d0183fa0` — ship-to falls back to bill-to when captured tag is off

---

## 10. Deferred / open items (future mini-projects)

- **Hide Mail Order ROWS** (separate `mo_orders`, no hide column) — the bigger "hard part".
- **Tint badge gating** in the Tags tab (needs a shared badge registry first) — the other "hard part".
- **"N orders hidden by filter" banner** on the boards — parked (owner: add later if needed).
- **Combined rule conditions** (e.g. HOLD AND older than 7 days).
- **URGENT / MISSING_CUSTOMER** rule tags (schema supports; add helper mapping + dropdown option).
- **Settings grouping** in the operational sidebars + admin-UI polish to move other admin items under Settings.
- **Per-rule hidden counts** on the Rules tab.
- **Per-order override/pin** to reveal a single rule-hidden order.

---

## 11. Quick admin guide

- **Settings → Hide → Rules** → + Add Rule (HOLD, or older-than-N-days) → toggle on/off / delete.
- **Hidden Orders** → see everything hidden; Un-hide manual ones; rule-hidden show "Managed by rule".
- **Tags** → switch any Mail Order badge off to hide it app-wide; important ones confirm first.
- **Manual hide** → Tint Manager order menu → "Hide OBD…" → reason.
- **Captured off** also makes the ship-to card show the bill-to details.
