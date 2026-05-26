# ROADMAP.md — OrbitOMS Planned Work
# Updated 2026-05-25 · Lives in: orbit-oms/docs/ (manual attach — NOT auto-loaded)

Attach this file when planning the next phase of any module. It's the live "what's next" list, separated from the canonical docs.

Items grouped by module. Within each module: P0 (blocking) → P1 (next up) → P2+ (later).

---

## Mail Orders

### P1 — Stage D / E (subVariant column migration)

Currently `product` and `baseColour` columns in `mo_order_form_index_v2` carry bucket+variant info instead of clean dimensions (Path A tactical decision). Stage E adds a proper `subVariant` column and rewrites the search + enrichment paths to read it.

**Stage D** — data prep:
- Backfill `subVariant` column on v2 table from existing `product` + `baseColour` pairs
- Audit divergences with legacy `mo_order_form_index.description`
- Smoke-test on a fresh `/place-order` flow

**Stage E** — cutover:
- Code paths in `lib/place-order/` read `subVariant` instead of `baseColour`
- Variant grid renders new dimension
- Cart panel labels adjusted
- Search scoring updated
- Drop the bucket+variant convention from v2 schema

Estimated effort: 2-3 sessions.

### P2 — Taxonomy backlog (deferred from Path A session)

Originally scoped for the Path A taxonomy session but deferred:
- TEXTURE family (RUSTIC + MATT) — add to v2 taxonomy
- FLOOR PLUS (24 SKUs, 12+ colour variants) — section assignment + variant grid sanity check
- PROTECT bucket review
- `mo_product_keywords` updates for new bucket names

### P2 — Public /order parity with /place-order

The desktop `/place-order` uses v2 tables; the public mobile `/order` still uses LEGACY `mo_order_form_index`. Two parallel taxonomies during the migration window. Plan to cut `/order` to v2 after Stage E ships.

### Polish

- ESLint bootstrap. `npm run lint` currently prompts to set up. Wire `eslint-config-next` strict, then add to CI / pre-commit.
- `.claude/settings.local.json` to `.gitignore` (trivial one-liner, re-confirmed on 2026-05-20).
- Mail Orders Table view visual consistency with redesigned Review View (decide if/how Table view adopts similar treatment).
- MetaRibbon `bg-white` (Interpretation β): if operators feel the ribbon looks lost on gray tint, wrap it like the cards.
- Unmatched picker inline-input restore (one-extra-click regression accepted but worth revisiting after a week of operator use).

---

## Tint Module

### P1 — Surface partial-qty Done to TM

`tint_assignments.currentProgress` is stored on every Done event with per-SKU actual qty, but no TM screen reads it today. Add:
- Badge on Completed Today section of Kanban: `Short by N tins`
- Read `currentProgress` in TM consumers
- Optionally extend `PauseHistoryModal` into a "Job Lifecycle Modal" showing pauses + done event side-by-side

**Open question:** does the delivery challan auto-fill from assigned qty? If yes, partial-done jobs could print challans with wrong qty. Needs verification before partial-done is considered production-safe. Estimated 1-2 hours.

### P1 — Pause kebab on non-pending Table sections

Today the pause kebab item only renders in the pending-stage Table view section. In Progress and Completed Today have the pause **badge** but no kebab. Four other entry points cover the gap. Add kebab to other sections if Chandresh asks.

### P2 — Material picking workflow

Designed (schema spec exists in earlier drafts), not built. Operator-side flow for tracking which tinter materials (pigments) are consumed per job. Sketch:
- New table `tint_material_consumption` (assignmentId, materialCode, qtyMl, recordedAt)
- Operator screen line in TI panel: "Add material consumption"
- TM report: per-material per-day depletion

Useful for inventory planning but not blocking.

### P2 — TM reorder $transaction refactor

`/api/tint/manager/reorder/route.ts` ~line 429 uses `prisma.$transaction` — violates CORE §3. Two-update swap so partial-failure semantics are acceptable. Refactor to sequential awaits when convenient.

### P2 — Cosmetic cleanups

- CustomerMissingSheet styling to match admin customer split-view form
- Shade Master `isActive` filter — production verification
- Challan lazy creation removal (verify `[orderId]` detail API doesn't still auto-create)
- Challan print CSS audit — old class names `ch-header`, `tint-yes` may persist

---

## Sampling Library

### Shipped 2026-05-25 — Phase 4 (live operator integration)

Wired Sampling Library into live Tint Operator TI workflow per locked spec:
- TI Save attaches `samplingNo` to `tinter_issue_entries` (new or existing shade)
- TI Done writes `sampling_usage_log` row with real operator, OBD, dealer, site, qty, date
- New variant auto-created when `(samplingNo, skuCode, packCode)` doesn't exist
- Suggestion card on operator screen (exact match + reference shades by `siteId + skuCode + packCode`)
- Save shade toggle removed; always-visible shade name input
- Confirmation popup on save showing allocated `samplingNo`
- `shade_master` retired (table kept temporarily for historical data, scheduled for deletion)

Locked decisions captured in `CLAUDE_SAMPLING_LIBRARY.md §3`.

### P1 — Delete `shade_master` table

Phase 4 retired `shade_master` from live use. Table still exists in DB with historical data. Plan:
1. Confirm no live consumer reads it (grep `prisma.shade_master`, audit `/tint/manager/shades` page traffic for 4 weeks)
2. Take final dump as CSV backup
3. Drop the `shade_master` page from nav (remove `shade_master` page key from `role_permissions`)
4. Delete the `/tint/manager/shades` route
5. `DROP TABLE shade_master` in Supabase
6. Hand-edit `prisma/schema.prisma`, `npx prisma generate`
7. Bump schema version

Trigger: any time after the retention window — no urgency.

### P2 — Cross-customer site grouping

Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) currently treated as separate sites. Group at Site level once Phase 4 stabilises. Schema change likely needed — a `site_group_id` on `delivery_point_master` or a new `site_groups` table.

### P2 — Usage count cron rebuild

`sampling_recipes.usageCount` is denormalised. Phase 4 keeps it in sync on every usage_log write, but a nightly cron rebuild from `sampling_usage_log` would be belt-and-braces.

---

## Attendance + OT

### P1 — Phase 2 admin writes

- **Manual entry record.** Admin adds a missed check-in/out after the fact with `isManualEntry = true` and `manualReason` text. Backend missing — needs new route at `app/api/admin/attendance/manual-entry/route.ts` and a modal in admin dashboard.
- **Edit existing record.** Correct a wrong timestamp, photo, or location after the fact. Audit field bump on every edit. Backend missing.
- **Mark exception.** Set summary `status` to `ON_LEAVE` or `EXEMPT` for a specific day with reason text. Backend missing.

### P1 — Phase 2 master-data writes

- **Holidays management.** CRUD on a `holidays` table — date + name + applies-to-all-roles. Rollover cron should treat holidays as non-attendance days (skip ABSENT insertion). Backend + frontend both missing.

### P1 — Real geofence coordinates

Currently placeholder: Surat city centre `21.1702, 72.8311` with ±150m radius. Needs physical measurement of actual depot. Plan: walk perimeter with the "Use my current location" button on the new settings UI.

### P2 — Quality / polish

- **In-app notification when admin acts on OT.** When admin approves or rejects a PENDING claim, user sees a toast / badge / email on next session.
- **Service worker for offline check-in/out.** PWA currently requires network. Queue offline → flush on reconnect. Storage budget: photo blob in IndexedDB until upload succeeds.
- **Push notifications.** Web push for OT decisions and manager alerts.
- **Submitting state polish on OT screen.** Dedicated "submitting OT claim" state to smooth the brief ConfirmView flash.
- **Auto-ticking clock on OT prompt screens.** 30-second `setInterval` to refresh `formatIstClock(new Date())` and "N min overtime so far". Not deemed worth it yet.
- **Settings 403 toast label.** Currently "Session expired — refresh and re-login" on permission-denied. Should say "Permission denied". Cosmetic mis-label.

---

## Import Pipeline

### P0 (when ready) — Auto-Import resume

Auto-Import has been paused since 2026-05-14. To un-pause:
1. Verify `IMPORT_HMAC_SECRET` matches across depot PC + Vercel
2. Decide cross-source orphan policy (CLAUDE_IMPORT.md §15 — three options on the table)
3. Smoke-test against a small known batch in test mode
4. Re-enable Windows Task Scheduler task `2_Auto_Import`
5. Monitor `import_batches` + `/api/health` for first 24h

### P2 — Auto-Import patch path

Today Auto-Import is create-only. If late-update detection is needed (e.g. SAP marks an OBD as cancelled), the path needs to go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Big change — full re-audit needed. Deferred until business case emerges.

### P2 — Weight diff in audit log

Currently `ExistingLine` doesn't carry weights so re-import weight changes go un-audited. Add weight diff to the patch path if depot ops needs the tracking.

### P2 — Old SAP layout fallback shim

If SAP ever ships the old 25-column layout again (depot-level legacy), implement a layout detector. Not built today — SAP must re-export.

### P2 — `articleTag` rule for ZINR rows

Today ZINR rows include with `zinr-article-tag-pending` breadcrumb warning. If business semantics emerge for ZINR articleTags, implement the rule and remove the warning.

---

## Place Order

### P1 — Stage E completion

Same as Mail Orders Stage E (above). Place Order is the primary consumer of v2 tables.

### P2 — Responsive merge of /place-order and /order

Two parallel codepaths today: `/place-order` (desktop, auth'd) and `/order` (public mobile). Merge into a single responsive UI once Stage E lands. Avoid maintaining two product lists.

### P2 — Public /order using v2 tables

Currently `/order` still reads LEGACY `mo_order_form_index`. Cut to v2 once Stage E ships.

---

## Cross-cutting

### P2 — Tests

Zero automated tests today. `npx tsc --noEmit` is the only smoke. A few worth adding:
- Parser unit tests (deterministic on fixture XLSX)
- Enrichment unit tests (test corpus of 100+ real lines)
- Slot resolution unit tests
- OT logic unit tests

### P2 — ESLint + pre-commit

`npm run lint` is unconfigured. Wire `eslint-config-next` strict + simple pre-commit hook.

### P2 — Migration to Vercel Pro

Hobby tier cap at 2 cron jobs. If we ever need a third (e.g. nightly Sampling Library usage_count rebuild + retention sweep), we'll need Pro.

---

## Deferred / Known issues

### Tint Module — Deferred

- **Refactor challan PATCH out of `prisma.$transaction`**
  File: `app/api/tint/manager/challans/[orderId]/route.ts:527`
  Same landmine class as TM reorder API. Currently
  safe because only one TM user saves challans. Plan
  a dedicated session to refactor to sequential awaits.
  Surfaced during: Phase 4 of challan formula auto-fill
  feature (May 2026).

- **Cell-clear unlock affordance on challan formula**
  Today, clearing a formula cell in the UI does not
  delete the DB row (client filters empty strings,
  server has no delete branch). After auto-fill ship,
  a TM cannot "unlock" a manually overridden row by
  clearing it. If unlock is ever needed, build a
  proper "Reset to auto" button rather than rely on
  empty-string semantics.
  Surfaced during: Phase 4 of challan formula auto-fill
  feature (May 2026).

---

*Updated 2026-05-25 — reflects Sampling Library Phase 4 SHIPPED (live TI integration, shade_master deprecated), all OT admin UIs shipped, 3 tint features shipped, Review View redesign shipped, /order mobile keyboard fix shipped.*
