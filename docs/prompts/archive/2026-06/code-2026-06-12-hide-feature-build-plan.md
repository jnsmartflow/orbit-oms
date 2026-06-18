# Build Plan — Settings › Hide (OBD Hide + Tag Hide)
# Draft · 2026-06-12 · planning artifact (not yet a canonical context file)
# Mockup: docs/mockups/settings/obd-hide-mockup.html (approved)

---

## 1. What we are building

One new admin area: **Settings › Hide**, a single nav item with **three flat tabs**:

| Tab | Feature | What it does |
|---|---|---|
| **Rules** | A | Create/turn-off rules that auto-hide whole orders (e.g. "hide if HOLD", "hide if older than N days"). |
| **Hidden Orders** | A | Safety net. Lists every hidden order, *why* it's hidden, and an Un-hide button. Nothing is ever deleted. |
| **Tags** | B | On/off switches for badges across the app (e.g. HOLD, captured). Order stays; only the badge render is turned off. |

### Locked design decisions
- **Feature A (hide orders)** = hybrid: rule-based auto-hide **+** manual one-off hide.
- **Scope = global.** A hidden order disappears from every order-listing screen. No per-screen scope.
- **Duration = stays until off.** No auto-expiry.
- **Feature B (hide tags)** = the previously-approved "Tag Settings" design, now living as the **Tags** tab.
- **Admin only.** No other role can make rules, hide orders, or toggle tags.
- **Everything reversible. Everything audited.** Default state = no rules, nothing hidden, all tags on → app behaves exactly as today until an admin acts.

### Key principle — sticker vs box
- A **tag** is a sticker on the box (badge render).
- The **tag data** is a note inside the box (the underlying flag).
- Feature B peels the sticker (badge hidden). Feature A reads the note inside and moves the whole box out of sight.
- **Therefore: hide rules read DATA, never the rendered badge.** Turning a tag off in the Tags tab must NOT break a rule that hides on that same tag.

---

## 2. Schema spec (final intent — confirm against diagnosis before writing SQL)

> All via Supabase SQL Editor → hand-edit `prisma/schema.prisma` → `npx prisma generate`. Never `prisma db push`. camelCase, no `@map`.

### New table — `obd_visibility_rules` (Feature A bulk rules)
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| ruleName | text | admin label |
| conditionType | text | `'tag'` or `'daysOld'` |
| conditionTag | text? | e.g. `'HOLD'` when type=tag |
| conditionDaysGt | int? | e.g. `14` when type=daysOld |
| isActive | boolean default true | |
| createdById | int FK→users | |
| createdAt | timestamptz default now() | |
| updatedAt | timestamptz | |

Single condition per rule for v1. Combined conditions deferred.

### `orders` — add manual-hide columns (Feature A one-offs)
| Column | Type | Notes |
|---|---|---|
| isHidden | boolean default false | |
| hiddenById | int? FK→users | |
| hiddenReason | text? | |
| hiddenAt | timestamptz? | |

### New table — `app_tag_settings` (Feature B) — *reuse existing settings table if diagnosis finds one*
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| tagKey | text UNIQUE | e.g. `'mail_orders.hold'` |
| isEnabled | boolean default true | |
| updatedById | int? FK→users | |
| updatedAt | timestamptz | |

### New table — `hide_audit_log` — *reuse existing audit table if diagnosis finds one*
| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| action | text | `rule_create / rule_toggle / rule_delete / order_hide / order_unhide / tag_toggle` |
| target | text | rule id / obdNumber / tagKey |
| beforeState | text? | |
| afterState | text? | |
| actorId | int FK→users | |
| createdAt | timestamptz default now() | |

---

## 3. Build phases

> Each phase = one or more Claude Code prompts, delivered one at a time. Diagnosis is always its own prompt, never mixed with building.

### Phase 0 — Diagnosis (READ ONLY)
Inventory before touching anything:
- Existing settings/flags table? Existing audit-log table/pattern?
- **Every** order-listing endpoint (so the hide filter is applied everywhere, no screen missed).
- **Every** badge render site + its trigger condition (feeds the Tags toggles AND the rule dropdown).
- Admin nav definition + the two-layer permission system (page-key table + hardcoded `requireRole`).
- **Output:** lean report. No code.

### Phase 1 — Schema
Create the tables/columns from §2 (after diagnosis confirms reuse vs new). SQL Editor → schema.prisma → generate. **DB touched.**

### Phase 2 — Backend core
- `lib/hide/visibility.ts` — shared helper that builds the exclusion (active rules + `isHidden = true`) for order-list queries.
- `lib/hide/tag-settings.ts` — read/write helper + an `isTagEnabled(key)` map.
- API routes (all admin-gated, `force-dynamic`, sequential awaits, audit on write):
  - `GET/POST /api/admin/hide/rules`, `PATCH/DELETE /api/admin/hide/rules/[id]`
  - `POST /api/admin/hide/orders/[obdNumber]/hide` + `/unhide`
  - `GET /api/admin/hide/hidden-orders`
  - `GET/PATCH /api/admin/tag-settings`

### Phase 3 — Apply hide filter to every order list
Wire `visibility.ts` into each order-listing endpoint found in Phase 0 (TM, mail orders, support, dispatch, warehouse, operations). **Hidden Orders view and admin restore views must NOT apply the filter.** Hidden orders still flow through import/processing — display only.

### Phase 4 — Feature B (Tags) integration
- Tag-enabled context/hook fed by `/api/admin/tag-settings` (default enabled to avoid flicker).
- Wrap each badge render site (from Phase 0) in `isTagEnabled(key)`.

### Phase 5 — Admin UI — Settings › Hide
- New page with 3 tabs per the approved mockup (`docs/mockups/settings/obd-hide-mockup.html`).
- Rules tab (list + Add Rule modal), Hidden Orders tab (list + Un-hide), Tags tab (grouped toggles, important-tag confirm).
- Add nav item under a new **Settings** group; register page key + `role_permissions` + `requireRole`.
- Manual "Hide this OBD" action + reason modal on order boards (admin only).

### Phase 6 — In-screen banners
"N orders hidden by filter — view" on each order board, linking to Hidden Orders.

### Phase 7 — Test + ship
- Create rule → matching orders vanish from all boards.
- Manual hide → vanishes; appears in Hidden Orders with reason.
- Un-hide → reappears.
- Disable rule → all its orders reappear.
- Turn a tag off in Tags → badge gone everywhere; a rule on that same tag STILL hides (data-not-badge check).
- Default (no rules, tags on) → app identical to today.
- `npx tsc --noEmit` clean → commit to main → smoke test → `git push origin main` → verify on production.

---

## 4. Engineering guardrails (CORE §3) — enforce in every build prompt
- `export const dynamic = 'force-dynamic'` on all new API routes.
- No `prisma.$transaction` — sequential awaits only.
- No `prisma db push` / `prisma db pull`. SQL Editor → hand-edit schema → `npx prisma generate`.
- camelCase columns, no `@map`.
- Admin-only on BOTH layers: page-key permission table **and** hardcoded `requireRole`.
- Order-list soft-delete reads keep `isRemoved: false`; add `isHidden` exclusion alongside — except Hidden Orders / restore views.
- `npx tsc --noEmit` passes before every commit. Commit to main, smoke-test, then push.

## 5. Prompt sequence (one per message, in order)
1. **Diagnosis** (read-only report) — Opus.
2. **Schema** (SQL + schema.prisma + generate).
3. **Backend core** (helpers + API).
4. **Apply filter** to order lists.
5. **Feature B** tag toggles + badge wrapping.
6. **Admin UI** (Settings › Hide, 3 tabs) — Opus.
7. **Banners**.
8. **Test + session doc + push**.

Build order option: Feature B (Tags) is a smaller slice and can ship before Feature A if incremental release is wanted — schema + Tags tab + badge wrapping only.
