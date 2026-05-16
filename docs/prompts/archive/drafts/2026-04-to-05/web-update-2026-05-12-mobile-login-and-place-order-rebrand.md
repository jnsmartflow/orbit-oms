# Code Update — Mobile login support + Purchase Order (PO) cosmetic rebrand
Session date: 2026-05-12
Session type: feature (DB + auth + UI shipped end-to-end)
Target files: CLAUDE_CORE.md §3, §5, §15; CLAUDE_UI.md (login form, /place-order layout)
Implementation status: shipped to production (4 commits, all deployed)

## DECISION SUMMARY

Mobile-number login was added as a parallel identifier alongside email login. Users can now type **either** their `.in` email **or** their 10-digit mobile number in the login field; backend routes the lookup based on a strict `/^\d{10}$/` regex. Email login remains backward-compatible. As part of the same rollout, 3 new users (Ajay Vansiya, Dhanraj Shah, Priya Chaudhari) were added with the `dispatcher` / `support` roles, but their permissions were stripped to **only** `place_order` viewable until the real dispatcher/support screens are production-ready. The `/place-order` page was given the standard role-based sidebar (was previously full-bleed, no sidebar) so existing users can navigate away from it. The visible label "Place Order" was renamed to "Purchase Order (PO)" in two places — the sidebar nav and the page header — while the URL `/place-order`, DB pageKey `place_order`, and all code identifiers stay unchanged.

Rejected alternatives:
- **OTP login (WhatsApp/SMS)** — researched, deferred. WhatsApp OTP via MSG91 estimated ~₹510/month for current usage; SMS OTP blocked by DLT registration overhead (~₹5,900 one-time + 3-7 day approval). Will revisit as a "Forgot Password" feature first before considering OTP-only login.
- **Force-logout via NEXTAUTH_SECRET rotation** — decided against. Old sessions allowed to expire naturally; new credentials communicated via WhatsApp instead.
- **New `order_taker` role for the 3 new users** — rejected. Temporary permission restriction on existing dispatcher/support roles is simpler and reversible when their real screens ship.
- **Full URL rename `/place-order` → `/purchase-order`** — rejected. Cosmetic label change only; URL stays for bookmark stability and zero permission churn.

## CONTEXT CHANGES

- `users` table has new `phone TEXT` column with `CHECK (phone IS NULL OR phone ~ '^[0-9]{10}$')` and partial unique index `WHERE phone IS NOT NULL`. Nullable for users who don't have a phone backfilled yet.
- `NextAuth` credentials provider in `lib/auth.ts` accepts email OR 10-digit phone. Zod schema relaxed from `z.string().email()` → `z.string().min(1)`. Lookup uses `findFirst` (not `findUnique`) with conditional `where` clause. Strict 10-digit regex only — no `+91` / dashes / spaces accepted.
- Login form (`app/login/login-form.tsx`) label is "Email or Mobile Number", `type="text"` (was `type="email"` which browser-blocked digit-only inputs), `autoComplete="username"`. Field `id`/`name` remains `email` (auth contract).
- `ROLE_REDIRECTS` map in `lib/rbac.ts` — `dispatcher` and `support` now redirect to `/place-order` (was `/dispatcher` and `/support`). Both target routes still exist in code but are intentionally gated until production-ready. Reversible: change map values when screens ship.
- `role_permissions` table: `dispatcher` and `support` have `canView = true` ONLY for `pageKey = 'place_order'`. All other pageKeys for these two roles are `canView = false`. (Was: dispatcher had 8 viewable pages, support had 7.)
- `/place-order` route now uses the standard role-based sidebar (mirrors `/mail-orders` layout pattern). Previously had its own minimal full-bleed layout. The sidebar is 72px collapsed → 220px overlay on hover (no content shift); page width math verified clean at 1024/1280/1366/1440/1920px. Cart panel + product grid + customer search bar all unchanged.
- Sidebar label and page header on `/place-order` now read **"Purchase Order (PO)"**. URL stays `/place-order`. Database pageKey stays `place_order`. Public customer-facing `/order` route deliberately kept as "Place Order" (different audience).
- 9 dummy users hard-deleted from production: `tintmanager@orbitoms.com` + 8 picker test accounts (Vikram, Jayesh, Kiran, Bharat, Mahesh, Anil, Deepak V., Sanjay). Cleared their `attendance_summary` rows first (FK blocker). `user_roles` cascaded via `onDelete: Cascade`.
- 4 email domain swaps `.com → .in`: Harsh (admin@), Dhruv, Kuldeep, Operations User. Test accounts (Support/Dispatcher/FloorSupervisor) deliberately left on `.com` for now.
- 6 existing depot users (Kuldeep, Deepanshu, Bankim, Chandresh, Chandrasing, Deepak Vasava) had passwords reset to the pattern: **lowercase first name + first 4 digits of mobile** (e.g. `deepanshu9456`). 3 new users created with same pattern.
- `.gitignore` extended: `pass.*` (catches credentials scratchpads) and `.claude/` (Claude Code local settings).
- Engineering rule clarification: **DB columns are mostly camelCase, but `pick_assignments` is the exception** — uses `@map` directives to snake_case (`picker_id`, `assigned_by_id`, `order_id`, `assigned_at`, `picked_at`). Always grep schema for `@map` on the specific table before writing raw SQL. (This bit us once during the FK audit.)

## NEW PENDING ITEMS

- **Reverse permission restriction when dispatch/support screens ship** | me / Claude Code | blocker: those screens being production-ready | When `/dispatcher` and `/support` pages are deployment-ready, run UPDATE on `role_permissions` to restore `canView = true` for the relevant pages, and update `ROLE_REDIRECTS` in `lib/rbac.ts` to point back to `/dispatcher` and `/support`.
- **Rotate Supabase DB password** | me | not blocking | Old password `OrbitOMS2026` briefly entered conversation transcript. Pick new password without `@ # $` (per CLAUDE_CORE §3). Update Vercel env var.
- **Untrack `.claude/settings.local.json`** | me / Claude Code | not blocking | One-time `git rm --cached .claude/settings.local.json` to stop tracking. The `.gitignore` rule only applies to new files going forward.
- **Add `dispatcher` and `admin` to `RoleSidebarRole` type + `ROLE_LABELS` map** | Claude Code | cosmetic only | Sidebar subtitle area renders empty for these roles. ~5 lines, ~5 min. Optional polish.
- **Update login error message** | Claude Code | low priority | Currently reads "Invalid email or password." Should read "Invalid credentials" or "Invalid email/mobile or password" now that mobile login is supported.
- **Admin user create/edit form — add phone field** | Claude Code | low priority | The original Stage 1 plan had this as Prompt 5. Skipped because new users were created via SQL. When future onboarding happens via UI, admin form needs a phone input with 10-digit validation. Stage 1.5 candidate.
- **OTP-based password reset via WhatsApp** | future | not started | Researched and costed (~₹510/month MSG91 subscription + ~₹0.25/OTP). Deferred to Phase 3+. Lets users self-serve password reset without admin intervention.

## SUPERSEDED DECISIONS

- **CLAUDE_CORE §5 Login redirects** — dispatcher and support no longer redirect to `/dispatcher` and `/support`. Now both → `/place-order`. Marked temporary until those screens are production-ready.
- **CLAUDE_CORE §3 engineering rule "DB columns are camelCase (no @map)"** — the "no @map" claim is inaccurate. `pick_assignments` uses `@map` to snake_case. Rule should read: "DB columns are mostly camelCase; one exception is `pick_assignments` which uses `@map` to snake_case. Grep schema for `@map` on the specific table before writing raw SQL."
- **`(place-order)/layout.tsx` minimal-no-sidebar design** (from `web-update-2026-05-06-place-order-built-pending-taxonomy.md`) — superseded. Layout now uses the shared role-based sidebar pattern. Full-bleed grid trade-off no longer applies; width math verified clean even with 72px sidebar overlay.

## MOCKUPS / ARTEFACTS PRODUCED

None this session — all decisions wired straight into code.

## PROMPTS DRAFTED FOR CLAUDE CODE

All 7 prompts drafted and executed in this session (already shipped). Recorded for reference:

- `prompt-1-schema-v2.md` — Supabase SQL to add `phone` column with check + unique index
- `cc-prompt-prisma-add-phone.md` — Manual Prisma schema edit + regenerate
- `prompt-2b-v2-final.md` — Combined user cleanup SQL (delete 9, swap 4 emails, backfill 6 phones, reset 6 passwords, insert 3 new users)
- `prompt-3-auth-logic.md` — NextAuth credentials provider accepts email OR phone
- `prompt-4-login-ui.md` — Login form label + type changes
- `prompt-6-rename-cosmetic.md` — "Place Order" → "Purchase Order (PO)" visible labels only
- `prompt-7-sidebar-restore.md` — Role-based sidebar restoration on `/place-order`

Plus 3 commit prompts (commit-prompt.md, commit-prompt-rbac-fix.md, commit-prompt-rename-sidebar.md).

Phase 2C SQL (the dispatcher/support permission restriction) was written inline in chat, not drafted as a standalone prompt — reproduce from this draft if needed for rollback.

## CONSOLIDATION NOTES

- **CLAUDE_CORE.md §3** — Replace "DB columns are camelCase (no @map)" with: "DB columns are mostly camelCase. Exception: `pick_assignments` uses `@map` to snake_case (`picker_id`, `assigned_by_id`, `order_id`, `assigned_at`, `picked_at`). Always grep schema for `@map` on the specific table before writing raw SQL."
- **CLAUDE_CORE.md §5 Login redirects** — Update the table to show dispatcher → `/place-order` and support → `/place-order`, with a footnote: "Temporary, until /dispatcher and /support screens are production-ready. Restore via lib/rbac.ts and role_permissions UPDATE."
- **CLAUDE_CORE.md §6 Users table** — Schema bumped to **v26.6** (was v26.5). Add `phone String? @unique` to the users model. Note the 10-digit CHECK constraint + partial unique index.
- **CLAUDE_CORE.md §15 Sidebar** — Update count of layouts using role-based sidebar from "8 layout files" to "9 layout files" (added `(place-order)/layout.tsx`).
- **CLAUDE_UI.md** — Add login form spec: field label "Email or Mobile Number", type="text", autoComplete="username". Document the 10-digit mobile validation pattern.
- **CLAUDE_UI.md** — Update `/place-order` description: no longer full-bleed; uses role-based sidebar overlay (72px collapsed). Visible label is "Purchase Order (PO)".
- **CLAUDE_CORE.md §22 Roles** (or wherever roles are listed) — Note that `dispatcher` and `support` are currently restricted to `place_order` only via `role_permissions`. When restoring, run rollback SQL captured in this draft.

---

## ROLLBACK SQL (preserved for when dispatch/support screens ship)

When `/dispatcher` and `/support` pages are production-ready, restore permissions and redirects:

```sql
-- Restore dispatcher's original viewable pages (pre-Phase 2C state)
UPDATE role_permissions SET "canView" = true WHERE "roleSlug" = 'dispatcher' AND "pageKey" IN (
  'customers', 'dispatcher', 'import_obd', 'planning_board',
  'routes_areas', 'skus', 'support_queue', 'vehicles', 'warehouse'
);
UPDATE role_permissions SET "canEdit" = true WHERE "roleSlug" = 'dispatcher' AND "pageKey" = 'dispatcher';
UPDATE role_permissions SET "canEdit" = true WHERE "roleSlug" = 'dispatcher' AND "pageKey" = 'planning_board';

-- Restore support's original viewable pages
UPDATE role_permissions SET "canView" = true WHERE "roleSlug" = 'support' AND "pageKey" IN (
  'customers', 'import_obd', 'routes_areas', 'skus', 'support_queue', 'vehicles'
);
UPDATE role_permissions SET "canEdit" = true WHERE "roleSlug" = 'support' AND "pageKey" = 'support_queue';
```

And in `lib/rbac.ts`:
```diff
-  dispatcher: "/place-order",
-  support: "/place-order",
+  dispatcher: "/dispatcher",
+  support: "/support",
```
