# Code discovery — billing action ticks (hold / slot / urgent / ship-to)
# 2026-09-11 · DIAGNOSIS ONLY, no code written, no SQL run · Claude Code session

**Files read:** `CLAUDE.md` (v1.12) · `docs/CLAUDE_CORE.md` (v104, Schema v27.24 — §3, §5, §7.13,
§7.14, §13) · `docs/CLAUDE_MAIL_ORDERS.md` (v1.13 — §22, §23.1-23.3, §23.6) ·
`docs/CLAUDE_FLOOR.md` (§4.1-§4.5, ship-to) · today's two discovery drafts ·
`sql/2026-09-04-user-page-access.sql` · `code-update-2026-09-04-user-based-access.md` ·
`web-update-2026-08-31-user-based-access-plan.md` · `code-discovery-2026-08-31-role-census.md` ·
`lib/permissions.ts` · `lib/rbac.ts` · `lib/access/source.ts` · `lib/access/role-baseline.ts` ·
`lib/auth.ts` · `lib/billing/mo-actions.ts` · `app/api/admin/access/[userId]/route.ts` ·
`app/(admin)/admin/access/page.tsx` · `components/admin/permissions-manager.tsx` ·
`app/api/billing/mail-order/actions/route.ts` · all of `app/api/billing/picking/*` ·
`components/billing/*` · `review-view.tsx` · `meta-ribbon.tsx` ·
`app/(mail-orders)/mail-orders/layout.tsx` · every route writing the eight dispatch /
ship-to columns · `prisma/seed.ts` · commits `38b545df` and `9bc027a9`.

---

## A. Every door

Eight columns carry these four facts: `dispatchStatus` · `dispatchPriority` / `priorityLevel` ·
`dispatchTargetDate` + `dispatchWindowId` + `dispatchSlotSource` · `shipToOverride` +
`shipToOverrideCustomerId`. Each door below is proved by its CALLER, not just its handler — a
route nothing reachable calls is not a door.

### A.1 IN SCOPE — the Billing face

| Action | Route (write) | Gate today | Caller (reachability) | Who reaches it |
|---|---|---|---|---|
| **Hold** | `billing/mail-order/actions/route.ts:203` (`mo_orders`) + `:206` (`orders`, lowercase) | `mail_orders`/canEdit `:73` | `billing-action-ribbon.tsx:97` → `mo-actions.ts:23` | Billing face only |
| **Urgent** | same route `:214` + `:215` (`priorityLevel` 1/3) | same, `:73` | `billing-action-ribbon.tsx:87` | Billing face only |
| **Slot set** | same route `:163` + `:165` (`dispatchSlotSource:'manual'`) | same, `:73` | `billing-action-ribbon.tsx:130` via `DispatchSlotPicker` | Billing face only |
| **Slot clear** | same route `:130` + `:134` (`dispatchSlotSource:null`) | same, `:73` | same picker, `onChange(null)` | Billing face only |
| **Ship-to set** | same route `:189` + `:190` | same, `:73` | `billing-ship-to-pencil.tsx:93` | Billing face only |
| **Ship-to clear** | same route `:171` + `:172` | same, `:73` | pencil's "Clear ship-to redirect" `:158` | Billing face only |

**One route, one gate, four actions.** `POST /api/billing/mail-order/actions` is the only door for
all six operations, and `checkAnyPermission(roles, "mail_orders", "canEdit")` at `:73` is the only
check it makes. That is why one tick per button needs a per-action check INSIDE the route, not a
second route.

**Reachability is narrow and already flag-gated.** Both components are mounted only under
`billingV2`: the ribbon at `review-view.tsx:1884` (and `:1951`, the `actionsSlot` arm the
`contentOverride` path never renders), the pencil at `:2209` as `ShipToCard`'s `actionSlot`.
`postMailOrderAction` has exactly two callers, both above. So today's real population is
"mail_orders/canEdit **and** the billingV2 flag" — the flag is the de-facto second gate, and it is
a pilot flag, not a permission.

### A.2 OUT OF SCOPE — the other doors, so the owner knows they exist

| Action | Route | Gate | Note |
|---|---|---|---|
| Hold / cancel / restore | `floor/actions/route.ts:125, :135, :167` | `floor`/canEdit `:51` | Floor's own. Also writes `heldAt`; Billing does not (§23.3) |
| Urgent | `floor/actions/route.ts:112` (`priorityLevel`) | `floor`/canEdit | |
| Change slot | `floor/actions/route.ts:115` | `floor`/canEdit | |
| Release (writes slot + status) | `floor/release/route.ts` → `lib/floor/release.ts:183-186` | `floor`/canEdit `:65` | Bulk release from the rail and Hold tab |
| Ship-to set / clear | `floor/ship-to/route.ts:100-101` | `floor`/canEdit `:37` | Floor's own route, not Billing's |
| Slot (trip build) | `floor/trips/route.ts:227` | `floor`/canEdit `:66, :123` | |
| Slot + status (import) | `import/obd/route.ts:417-420, :460, :475, :606, :616-619` | HMAC (machine) or `import_obd` | The dispatch engine; `dispatchSlotSource:'auto'` |
| Priority + ship-to (parser) | `mail-orders/ingest/route.ts:348-350` | HMAC `:70` | No person; nothing to tick |
| All four, copied to the child | `mail-orders/[id]/split/route.ts:103-104` | `mail_orders`/canEdit `:20` | A split INHERITS the parent's values — it does not set new ones |

🔴 **`floor` and `mail_orders` are different populations.** MAIL_ORDERS §23.3 records that
Billing's read routes were carved out precisely because Deepanshu (25) and Bankim (26) hold
`mail_orders` but not `floor`. Ticking the Billing buttons off therefore does **not** close the
Floor doors, and is not meant to — Floor is where these decisions belong (today's billing report
§B.2). Say this to the owner plainly: after this change, a bill can still be held, slotted,
un-urgented and redirected from `/floor` by anyone holding `floor`/canEdit.

⚠ **The split route is a door the four ticks will not cover.** It copies `dispatchPriority` and
`shipToOverride` onto the child bill under `mail_orders`/canEdit. That is inheritance, not a new
decision, so gating it would break splitting; recorded so nobody later calls it a hole.

---

## B. The ticks — copying the `billing_picking` pattern

### B.1 Exactly how `billing_picking` was added

Two commits, **register first, repoint second**, and the gap between them is where the owner
granted the rows by hand. That ordering is the whole safety property: registering first lets the
grid draw the switch so the people who need it can be granted BEFORE any gate moves.

**Step 1 — `38b545df` "access: register billing_picking page key (no behaviour change)"**

| File | Change |
|---|---|
| `lib/permissions.ts` | `PageKey` union (`:214`) · `ALL_PAGE_KEYS` 27→28 (`:273`) · `ACCESS_SECTIONS` Operations, directly after `mail_orders` (`:401`) · `ACTION_PAGES.canEdit` (`:320`) · `PAGE_LABEL_OVERRIDES` (`:378`) |
| `prisma/seed.ts` | four role-TEMPLATE `role_permissions` rows mirroring the live `mail_orders` rows |
| `components/admin/permissions-manager.tsx` | one `PAGES_CONFIG` row — the `ACCESS_SOURCE='role'` rollback editor |
| `docs/CLAUDE_CORE.md` | the ALL_PAGE_KEYS count, 27→28 |
| **Not** `PAGE_NAV_MAP`, **not** `ICON_MAP` | it is a tab inside a route, not a route |

**Step 2 — `9bc027a9` "billing: Picking tab gates on billing_picking"**: five routes repointed
(reads first, then writes), `layout.tsx` reads the key off the `allPerms` map it had already
computed, a provider couriers it, both mount points gated, and view-only **hides** the write
controls rather than disabling them (UI §10).

**No SQL file exists for the rows.** The commit message records a read-only SELECT proving all five
active non-admin holders already had the key before the repoint — the grants were made through
`/admin/access` by the owner. §D.1 proposes a SQL file instead, because four keys × the day-one
population is too many clicks to do reliably by hand.

### B.2 The four proposed keys

| Key | Grid label | Section / position | Meaning |
|---|---|---|---|
| `billing_hold` | `Billing · Hold` | Operations, after `billing_picking` | may put a mail order on hold / release it |
| `billing_slot` | `Billing · Slot` | next | may set / clear the dispatch slot |
| `billing_urgent` | `Billing · Urgent` | next | may mark / clear urgent |
| `billing_ship_to` | `Billing · Ship-to` | next | may redirect / clear the delivery dealer |

The `Billing ·` prefix is **required, not cosmetic** — the same reasoning `38b545df` gives for
`Billing · Picking`. These keys are not in `PAGE_NAV_MAP`, so `pageLabel()` would fall through to
the raw key, and `picking` / `floor` already sit in the same section under plain names.

**Which boolean means "can use this button": `canEdit`.** All four are writes, and `canEdit` is
what every write gate in the app asks. Each key needs an `ACTION_PAGES.canEdit` entry, added
**ahead of its call sites** exactly as `billing_picking` was — without it `/admin/access` draws a
dash, and a dash is a switch nobody can turn on, which makes granting-before-repointing impossible.

**`canView` is the problem to decide.** The grid always draws View (it is asked on every page), so
each of these four rows will show a View switch that gates nothing. Three options, owner's call:

- **(a) Leave View on and ignore it.** Zero work. Costs: four more inert switches, and CORE already
  records eight live-but-inert `canExport` grants as the reason `ACTION_PAGES` exists at all.
- **(b) Give View a meaning:** View = the button renders read-only / the state is visible,
  Edit = the button works. This is the "Held marker" option in B.5 given a home, and it is the only
  option that makes the row honest without touching the grid.
- **(c) Teach `ACTION_PAGES` a `canView` exclusion list** so the grid can dash View too. This is a
  real change to a map whose header says it is advisory and must never filter anything — I would
  not do it for four rows.

**Recommendation: (b) if the owner wants the Held marker, otherwise (a).** Do not do (c).

### B.3 Where the check goes in the actions route

Inside `POST /api/billing/mail-order/actions`, **after** the action is parsed at `:89` and
**before** the payload is built at `:120` — so one check per request, on a validated action name,
with nothing written yet:

```
action → key:   hold → billing_hold · slot → billing_slot
                urgent → billing_urgent · shipTo → billing_ship_to
```

Keep the existing `mail_orders`/canEdit check at `:73` as the outer gate and add the per-action one
beneath it. Both must pass: `mail_orders` says "you may work on this screen", the new key says
"you may take this decision".

- Use `checkAnyPermission`, never `checkPermission` — the same helper every other gate uses, and
  the one that takes the full role list.
- **Admin / superuser bypass comes free.** Both arms short-circuit inside `checkAnyPermission`
  (`lib/permissions.ts:583-589`) before any table is read. Do not add a second bypass.
- 403 with a message naming the action: `"You do not have permission to change the dispatch slot."`
  A bare "Forbidden" on a button the user can see is the worst of both worlds — and `mo-actions.ts`
  already surfaces `body.error` verbatim to the ribbon (`:37-38`), so the message reaches the
  screen with no client change.

### B.4 How the Billing face learns the four values — no extra query

**Copy `layout.tsx:68-70` exactly.** It already resolves `allPerms` for `buildNavItems`, then reads
`allPerms["billing_picking"]` off that same map — no second query, no client fetch, and the map
already follows `ACCESS_SOURCE` and already has the superuser short-circuit applied. Four more
reads off the same object cost nothing.

Courier them the way `BillingPickingAccessProvider` does (`components/billing/billing-picking-access-provider.tsx`,
63 lines, same shape as `BillingV2Provider`). One provider carrying an object of four booleans, not
four providers.

Then gate the render at the call sites: the three ribbon buttons inside `BillingActionRibbon`
(each `<button>` individually, since the owner wants Slot without Hold), and the pencil at
`review-view.tsx:2209` — where suppressed must resolve to `undefined`, never `null`, so
`ShipToCard`'s `actionSlot` contributes no DOM (§23.1 and the prop's own comment).

🔴 **Hide, do not disable** — UI §10, and the lesson `9bc027a9` cites: MRN offered `operations` a
Delete that returned Forbidden. Hidden says "not yours"; disabled says "not yet".

⚠ **A ribbon with every button hidden must not leave an empty divider.** The billing ribbon row
draws a `w-px h-4 bg-gray-200` separator before the punch group (`review-view.tsx` billing ribbon).
Check it renders nothing when the action cluster is empty.

### B.5 Option to put to the owner — the read-only "Held" marker

Today the Hold button is the **only** thing on the Billing face that shows a bill is held: the ship
card's Hold chip is filtered out at `review-view.tsx:1478`, and the rail row reads
`isLocked || isOdCiFlagged()` — text patterns, never `dispatchStatus`. So hiding the Hold button
from a person makes held bills **indistinguishable** from live ones for them.

Offer both, do not decide:

- **Yes, show a marker.** A small read-only "Held" chip where the button was, for someone without
  the tick. Costs one more render branch; means "you cannot change this" rather than "this is not
  happening". This is what option (b) in B.2 would use `canView` for.
- **No marker.** Simpler, and consistent with how the tab disappears entirely for a non-holder of
  `billing_picking`. But a billing operator who cannot see a hold may punch and chase a bill that
  Floor has deliberately stopped.

My read: the same argument appears in today's billing report §B.2 risk list, and it points at yes.
It is still the owner's call.

---

## C. Day-one safety — default-deny

**An absent row means all-false** (`lib/permissions.ts:461`). So on the day these keys register,
**nobody holds them**, and on the day the gates repoint, **every button vanishes for everyone**
unless rows exist first. This is exactly why `billing_picking` was done in two commits.

### C.1 Who must be granted, and why that list is what it is

The population that can use these buttons TODAY is the intersection of three facts:

1. `mail_orders`/canEdit on the **live** source (`user_page_access`, `ACCESS_SOURCE='user'`) —
   the route's only gate;
2. reaches the Billing face — `billing_settings.rolloutStage` + `users.billingV2TestUser`
   (`lib/billing/flag.ts`), because both components are mounted under `billingV2`;
3. `isActive` — checked at sign-in.

Plus the superuser, who bypasses regardless and needs no row.

`9bc027a9` named the five active non-admin `mail_orders` holders as of 2026-09-11: **Bankim (26),
Chandresh Kolgha (21), Deepanshu Thakur (25), Operations User (20), Prakash (32)**, with Harsh (1)
admin. **Grant all four keys' canEdit to those five.** Granting on `mail_orders`/canEdit rather
than on the narrower billingV2 population is deliberate: the flag is a pilot switch that will widen
to `ALL_USERS`, and a tick that only covers today's pilot would silently deny the next two people
the moment the flag moves.

⚠ **Do not take that list on trust — it is a day old and seed is not live.** Run the SELECT below.

### C.2 The missing-rows gap

CORE §7.14 records **1,053 rows = 39 users × 27 keys** (SELECT 2026-09-04). Since then
`billing_picking` made it 28 keys, and the owner's count says 40 users. A full grid would now be
**40 × 28 = 1,120**, and `billing_picking` rows were only ever created for the handful who needed
them — so a shortfall is expected and is not a fault.

**Does it matter here? No, and this is the reassuring part.** A new key has no rows for anyone by
definition, so every person starts denied whether or not they were short a row before. The gap
matters for exactly one thing: the day-one INSERT must **create** rows, not only update them, for
people who have none. `ON CONFLICT … DO UPDATE` covers both in one statement.

### C.3 `prisma/seed.ts` — verified by grep, 2026-09-11

**It has never heard of `user_page_access` or `isSuperuser`.** Zero hits for either. It seeds
`role_permissions` only (`:55`, `:196`), and `38b545df` added four `billing_picking` rows to that
same role table, with its own comment saying "seed is not live, in both directions".

🔴 **What a wipe-and-reseed does today:** it rebuilds the fallback table and leaves the
**authoritative** one empty. Under `ACCESS_SOURCE='user'` every non-superuser then resolves
all-false — nobody can do anything — **and the seed reports success.** This is the open P0 in
`ROADMAP.md → User-based access`. These four keys do not create it and cannot fix it, but they add
four more rows to whatever eventually repairs it.

### C.4 The one read-only SELECT

```sql
-- READ-ONLY. Who must be granted the four billing action keys on day one.
-- Reads the LIVE source (user_page_access). No INSERT/UPDATE/DELETE/DDL.
SELECT
  u.id,
  u.name,
  u."isActive",
  u."isSuperuser",
  u."billingV2TestUser",
  r.name                                        AS job_title,
  COALESCE(mo."canView", false)                 AS mail_orders_view,
  COALESCE(mo."canEdit", false)                 AS mail_orders_edit,
  28 - COUNT(upa."pageKey")                     AS missing_page_rows,
  CASE
    WHEN u."isSuperuser" THEN 'superuser — bypasses, needs no row'
    WHEN NOT u."isActive" THEN 'inactive — skip'
    WHEN COALESCE(mo."canEdit", false) THEN 'GRANT all four keys'
    ELSE 'no grant'
  END                                           AS day_one
FROM users u
JOIN role_master r            ON r.id = u."roleId"
LEFT JOIN user_page_access mo ON mo."userId" = u.id AND mo."pageKey" = 'mail_orders'
LEFT JOIN user_page_access upa ON upa."userId" = u.id
GROUP BY u.id, u.name, u."isActive", u."isSuperuser", u."billingV2TestUser",
         r.name, mo."canView", mo."canEdit"
ORDER BY day_one, u.name;
```

Read it as: every row saying **GRANT all four keys** is the day-one list. `missing_page_rows`
above 0 is the §C.2 gap for that person — informational here, since the INSERT creates rows anyway.
If `ACCESS_SOURCE` is not `'user'` this SELECT describes the wrong table, so confirm that first:
`SELECT value FROM system_config WHERE key = 'ACCESS_SOURCE';`

---

## D. Build plan

### D.1 Step 1 — SQL, run before any gate ships

`sql/2026-09-XX-billing-action-keys.sql`. Supabase SQL Editor, no `BEGIN`/`COMMIT`, idempotent.
The real constraint is **`user_page_access_user_page_key`** on `("userId","pageKey")`
(`sql/2026-09-04-user-page-access.sql:81`), and that file's own INSERT names it — copy the form:

```sql
-- NOT RUN. One row per (day-one person × the four new keys).
INSERT INTO user_page_access ("userId", "pageKey", "canView", "canEdit")
SELECT u.id, k."pageKey", true, true
FROM users u
JOIN user_page_access mo
  ON mo."userId" = u.id AND mo."pageKey" = 'mail_orders' AND mo."canEdit" = true
CROSS JOIN (VALUES ('billing_hold'),('billing_slot'),
                   ('billing_urgent'),('billing_ship_to')) AS k("pageKey")
WHERE u."isActive" = true
ON CONFLICT ON CONSTRAINT user_page_access_user_page_key
DO UPDATE SET "canView" = true, "canEdit" = true;
```

Derived from the live table rather than a hardcoded id list, so it cannot go stale between writing
and running. `DO UPDATE`, not `DO NOTHING`: a person with a pre-existing all-false row must be
raised, and `DO NOTHING` would silently leave them denied. Finish with a verification SELECT
counting rows per key, as both prior SQL files do.

### D.2 Step 2 — code, in the two-commit shape

**Commit A, register (no behaviour change):** `lib/permissions.ts` — union, `ALL_PAGE_KEYS` 28→32,
`ACCESS_SECTIONS` after `billing_picking`, `ACTION_PAGES.canEdit` ×4, `PAGE_LABEL_OVERRIDES` ×4 ·
`prisma/seed.ts` role templates · `components/admin/permissions-manager.tsx` four rows ·
`docs/CLAUDE_CORE.md` key count 28→32. Then **run the SQL and confirm the switches are on**.

**Commit B, gate:** `app/api/billing/mail-order/actions/route.ts` (per-action check + 403) ·
`app/(mail-orders)/mail-orders/layout.tsx` (four reads off `allPerms`) · a new
`components/billing/billing-actions-access-provider.tsx` · `components/billing/billing-action-ribbon.tsx`
(three buttons gated individually) · `app/(mail-orders)/mail-orders/review-view.tsx` (pencil
`actionSlot` → `undefined`; divider check).

### D.3 Step 3 — hand-checks (the owner's; Claude Code cannot log in)

1. `/admin/access` shows four new rows under Operations, each with a working Edit switch — not a dash.
2. Before the SQL: the switches read off for everyone. After: on for the five.
3. As a granted person, all four buttons work exactly as today.
4. Revoke one tick — say Hold — and confirm the button disappears while Slot, Urgent and the pencil
   still work. This is the "Slot without Hold" requirement.
5. With Hold revoked, confirm a previously-held bill is **still held** on Floor. Hiding must never
   release.
6. Revoke all four and confirm the ribbon leaves no empty divider and no stray gap.
7. Confirm the 403 message names the action, and that it appears in the ribbon rather than silently.
8. Confirm the admin keeps all four with no rows of his own.

### D.4 Risks

- 🔴 **Order is the whole safety property.** Gate before granting and all four buttons vanish for
  everyone, exactly as repointing `billing_picking` first would have taken the tab from four people.
- 🔴 **The reseed P0 (§C.3)** now costs four more keys. Unchanged in kind, worth restating.
- ⚠ **Four inert `canView` switches** unless the owner takes option (b) in §B.2.
- ⚠ **Hiding Hold hides the only hold signal on this face** (§B.5) — decide the marker before
  shipping, not after.
- ⚠ **Floor's doors stay open** (§A.2). This change scopes the Billing face and nothing else; say so
  to the owner so "we locked down holds" does not become the belief.
- ⚠ **`ALL_PAGE_KEYS` is asserted against `ACCESS_SECTIONS`** by the access page
  (`app/(admin)/admin/access/page.tsx:44-46`) — add to both or the screen renders a drift banner.
- ⚠ **The old role grid is 16 keys out of date already** (`38b545df`'s own note). Adding four rows
  there keeps the rollback path honest; fixing the rest is separate work.

---

*Diagnosis only. No files changed outside this document, no SQL executed, no dev server run.*
