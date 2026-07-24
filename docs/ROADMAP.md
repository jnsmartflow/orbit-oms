# ROADMAP.md — OrbitOMS Planned Work
# Updated 2026-07-22 · Lives in: orbit-oms/docs/ (manual attach — NOT auto-loaded)

Attach this file when planning the next phase of any module. Live "what's next" list, separated from canonical docs.

Items grouped by module. Within each module: SHIPPED → P0 (blocking) → P1 (next up) → P2+ (later).

---

## Place Order / Mail Orders — v2 single source of truth (3-stage plan)

The big architectural arc. **Currently in Stage 1.** Full plan in `CLAUDE_PLACE_ORDER.md §19`.

**Shipped 2026-06-19 — App-format parser + Table C fast-path (app orders → V2):**
- Mail parser v7.2: App reader (`Parse-AppBody`) + sorter (`Test-IsAppFormat`, routes on first content line `Bill To:`) + name-lock (pins the exact emitted name so the Table C key matches by construction). Human/typed path untouched. Manual-deploy to depot PC. (Parser lives in the repo's `docs/Parser/` working copy and is **untracked / not committed** — the canonical live parser is outside git per `CLAUDE_MAIL_ORDERS.md §3`.)
- Table C exact-match fast-path in enrichment (commit `da219238`, on `main`): app line → exact dict (built from `mo_sku_lookup_v2` via `buildTableCContext`) → V2 material via a V2 resolver; 15 collisions excluded from the dict → keyword fallback. Stacked design (exact-first, keyword-fallback). Tested 11/11 this session; one real SKU rescue proven (`2K PU GLOSS 90 BASE` → V2 primary). **INGEST-only** — verified the other callers (debug / backfill / re-enrich) pass no context.
- **Net:** a clean app line that HITS Table C resolves via `mo_sku_lookup_v2` (fast lane). A MISS (collision / not-in-dict) and ALL typed/human orders still resolve via legacy `mo_sku_lookup` (keyword path — verified ingest still reads it; legacy `mo_sku_lookup` model still in schema). The split is intentional — a partial early bridge ahead of full Stage 3. Legacy tables stay (do NOT delete).

**Pending (this bridge):**
- [ ] Parser go-live: re-copy the name-locked v7.2 parser to the live PC (UTF-8 BOM) + restart. (Live copy is pre-name-lock — cannot be verified from here.)
- [ ] Live verification: first real app order → billed SKU matches app-catalogue intent (rescue sanity-check), with live keywords.
- [ ] Reclaim the 13 double-primary collisions into the fast lane: pick keeper per pair → `SET_FALSE` loser in `scripts/v2-sku-seed-from-legacy.ts` + flip `isPrimary` in Supabase (SELECT-verify + backup). The 2 pack-rounding collisions stay excluded.
- [ ] Thread `tableC` into RE-ENRICH so historical / re-run orders also get the fast-path (ingest-only today).

### Stage 1 — urgent fix (production-safe) · IN PROGRESS

**Shipped:**
- `/order` cut from legacy to v2 catalog (2026-05-29)
- Order dedup (`isPrimary` + `mobileFamily` columns, Promise umbrella collapse)
- `/place-order` grouping recovered + baked into seed
- Phase 1 `product` join-key fill (92 broken rows)
- Distemper/SmartChoice search-token fix

**Stage 1 remaining touch-ups (next session before Stage 2 starts):**
- ~13 oddball rows still showing no packs (`product = null`):
  - AQUATECH: PU Coat, Interior WBC, Roof Coat (BW/Grey/Teracotta), Crackfiller (5/10/20mm), Flexible Coat (Advance/Neo), IBC Advance
  - DISTEMPER: Acrylic Distemper / Interior Distemper
  - PRIMER: 2in1 Interior-Exterior Primer
  - STAINER: HP Colorant
- 8 mapped-but-base-unstocked rows — `product` set correctly but base has no SKU:
  - WS Protect Brilliant White (flagged — plain WS Protect has no BW though Dustproof/Max cousins do)
  - WS Max Yellow Base; WS Protect 90/93/96/97 Base; WS Protect Dustproof Yellow Base / ROX
- Stock-side: Acrylic Distemper / Interior Distemper SKU missing its `packCode`
- Optional cosmetic: WS rows carry `mobileFamily = MAX/POWERFLEXX/PROTECT/RAINPROOF`. Harmless today (labels by `family = "WS"`); normalise to "WS" only if desired
- Add `isPrimary` filter to `/api/place-order/data` (desktop catch-up)

### Stage 2 — make v2 parser-ready

1. Fill canonical key (`product`) on all remaining rows (full hygiene)
2. Build the one universal keyword layer in v2 (word→product + word→colour), seeded from legacy `mo_product_keywords` + `mo_base_keywords`
3. Point `/order` + `/place-order` search at the shared layer
4. Readiness check — confirm v2 carries everything the parser needs (packs, colour strategies DIRECT/FIXED/NUMBERED/COLOUR, carton multiply, no-match handling)
5. Verify search + readiness

### Stage 3 — migrate parser to v2 (only on explicit go-ahead)

1. Switch parser resolution to read v2 + shared keyword layer instead of legacy tables
2. Carry over no-match / zero-skip rule + operator "fix-it" resolve loop + `mo_line_status` audit
3. Test on real sample emails
4. Run old + new side by side, confirm they agree, then cut over — retire legacy tables LAST

---

## Place Order — per-product CSV rollout ✅ COMPLETE (2026-06-14)

The catalog-restructure workstream is **done — all families folded** into the final 9-tile speed dial (`CLAUDE_PLACE_ORDER.md §6/§23`). 6-step loop documented in `CLAUDE_PLACE_ORDER.md §14`. Covered GLOSS/PU Enamel/Satin/Promise/Velvet Touch/Sadolin/SuperCover/SuperClean/Primer/Distemper/Texture/Putty/Tools/Stainer/Spray Paint/M900 + the remaining-5 (Tile/Metallic/Lustre/Smoothover/Floor Plus) + email branding + dormant-alias light-up (PU Enamel etc.).

### Optional search refinements (NOT built — pick up if Smart Flow asks)
- `rainproof` → Rainproof only (drop the weak Dustproof link)
- `ws` → WS-family-first (rank WS family above unrelated products that merely contain "WS")

---

## Place Order — email + catalog (deferred)

### P2 — Deferred / open

- **Order email line-item reformat — ✅ SHIPPED 2026-06-19.** Plain text, NO HTML/bold (bold needs an HTML send-path — declined). Per-line format `{n}. {Product Name} - {pack}*{qty}`: numbered lines (`1.` `2.` `3.`); `" - "` (space-hyphen-space) after the product name; keep `*` and the comma multi-pack list (`1L*6, 4L*4, 10L*1, 20L*1`); customer header unchanged. e.g. `1. GLOSS Brilliant White - 1L*6` / `5. WS MAX Brilliant White - 1L*6, 4L*4, 10L*1, 20L*1`. Done via the **shared** `renderOrderBody` helper in `lib/place-order/email.ts` (the preferred no-divergence approach, like the `emailLineLabel` consolidation) — all 3 builders (`lib/place-order/email.ts`, `app/po/po-page.tsx`, `app/order/page.tsx`) call it. Plus refinements: header resequenced (Bill To → Ship To → Dispatch → Remark → Note), proper-case names (`emailCase`, codes/short/digit words stay caps), per-bill right-aligned line numbers with figure-space padding, and CC `surat.order@outlook.com` on desktop `/place-order` only. The app emitting this format is exactly what mail parser v7.2 (`Parse-AppBody`) reads. No email-builder shared-helper work pending. Code-only, no DB/reseed.

- **5IN1 Phiroza — create SAP codes.** `IN56000473` (500ML) + `IN56000471` (4L) were injected into v2 (owner-approved, SAP-unverified). They will NOT bill until created in SAP. Once real in SAP they import naturally — then verify the injected rows still match (no duplicate).

---

## Sampling Library

### Shipped 2026-05-22 to 2026-06-01
- Phase 1 (foundation + 3,566 parents + repair)
- Phase 2 (detail pane)
- Phase 3 (normalisation + deliveryNumber)
- Phase 4 (live operator integration — 2026-05-25)
- Phase 4 siteId bug fix + backfill (2026-06-01, commit `df7e61e9`)
- Phase 4.6 REVIEW pile import (601 sampling numbers, `packCode` nullable)
- Phase 4.7 Cohort A + B full restore (4,353 shades total)
- Phase 4.8 new tinting rows 16-25 May import

### P0/P1 — None active right now

Sampling Library is operationally stable. Reactive items only.

### P2 — Deferred / planned

- **Phase 4.5 + 5 orphan fix.** Designed (14 points locked), parked indefinitely. Live data shows ~15 orphans/month — manual cleanup is cheaper. Monthly check query in `CLAUDE_SAMPLING_LIBRARY.md §3`. Trigger Phase 4.5 + 5 if orphan count crosses 20/month sustained.

- **Sampling Issue-5 duplicate cleanup (IN PROGRESS).** Runbook + reference graph shipped (`CLAUDE_SAMPLING_LIBRARY.md §12`); dedupe by EXACT formula fingerprint, never shade name; inactivate (never delete) sources. **3 white-only groups merged** (`26-0196`/`26-0106`/`26-0094`); **~380 duplicate groups remain** — process group by group. Pending: build the **exact-dupe-finder tool** (seed number → all matching active samplings → dated review CSV); remove junk test sampling **`#26-0285`**. Owner chose manual SQL over a batch script for now.

- **Phase 5 fuzzy site match.** ~2,411 parents siteless after backfill. Recover most via fuzzy match against `delivery_point_master.customerName`. NEVER auto-fuzzy without operator review — site suffixes like "FACE" / phase numbers distinguish genuine different sites. CORE §3 rule.

- **Split-done usage-log gap.** `app/api/tint/operator/split/done/route.ts` never writes a `sampling_usage_log` row. Split-completed tints never appear in usage history or same-site suggestions. Decide whether splits should log usage.

- **`usageCount` cron rebuild** as belt-and-braces. Phase 4 keeps the counter in sync on every write; cron would catch drift.

- **Cross-customer "same site" grouping.** Multi-SAP-code sites (e.g. "Sun Shantam" with 5 customer codes) treated as separate sites. Schema change likely needed — `site_group_id` on `delivery_point_master` or a new `site_groups` table.

- **Suggestion card prominence (Option 1 from 2026-05-26 session).** Make exact-match cards visually louder to nudge operators away from typing duplicate shade names. Cheap UX fix, 2-4 hours, lower risk than Phase 4.5+5.

- **Delete `shade_master` table.** Phase 4 retired it from live use. Table still exists with historical data. Plan: confirm no live consumer (grep + audit page traffic for 4 weeks) → final CSV dump → drop page from nav → delete route → `DROP TABLE shade_master` → schema bump. No urgency.

---

## Customer Master + Multi-SO

### Shipped 2026-05-26
- Phases 1-7 of multi-SO + contacts auto-sync (commit `d1e298da`)
- 8 customers migrated, 2 contacts stamped, 6 auto-contacts created
- Eager sync in missing-customer resolver
- ContactCard auto/manual visual treatment
- Primary/Backup/Junior roles with P2002 reconcile pattern

### P1 — Phase 8 cleanup (6 items, ordered by priority)

1. **Drop `delivery_point_master.salesOfficerId` column.** Write-ignored from admin UI but still read by CSV importer. Drop only after #3.
2. **Update CSV importer** (`app/api/admin/customers/import/route.ts`) to write to `customer_sales_officers` instead of legacy `salesOfficerId`. Required before #1.
3. **CSV template header label** says `salesOfficerGroup` but importer expects `salesofficername` — pre-existing misleading label, rename when #2 ships.
4. **Refresh `CLAUDE_TINT.md §9.6` cascade docs** to remove SO-Group fallback once Phase 8 backfill is complete (today the cascade still falls back through it).
5. **Simplify `_lib/detail.ts` cascade** (sampling library detail panel). Legacy fallback is dead code for all post-Phase-6 entries; consider after one-time backfill of legacy null sampling rows.
6. **One-time backfill of pre-Phase-6 `sampling_register.salesOfficerId`** so detail.ts cascade can be fully retired. Optional.

Also: **add `@deprecated` JSDoc** to `delivery_point_master.salesOfficerId` in Prisma schema, flagging the field as legacy-only.

---

## Tint Module

### Shipped (in May 2026 cycle, before this consolidation)
- Operator Skip Job
- Operator Pause / Resume
- Remove OBD soft-delete
- Mark Done refactor (partial qty support)
- Challan formula auto-fill from TI (2026-05-26)

### P1 — Surface partial-qty Done to TM

`tint_assignments.currentProgress` is stored on every Done event with per-SKU actual qty, but no TM screen reads it. Add:
- Badge on Completed Today section of Kanban: `Short by N tins`
- Read `currentProgress` in TM consumers
- Optionally extend `PauseHistoryModal` into a "Job Lifecycle Modal" showing pauses + done event side-by-side

**Open question:** does the delivery challan auto-fill from assigned qty? If yes, partial-done jobs could print challans with wrong qty. Needs verification before partial-done is considered production-safe.

### P1 — Pause kebab on non-pending Table sections

Today the pause kebab item only renders in the pending-stage Table view. In Progress and Completed Today have the pause **badge** but no kebab. Four other entry points cover the gap. Add kebab to other sections if Chandresh asks.

### P2 — Material picking workflow

Designed (schema spec exists in earlier drafts), not built. Operator-side flow for tracking which tinter materials (pigments) are consumed per job. Sketch:
- New table `tint_material_consumption` (assignmentId, materialCode, qtyMl, recordedAt)
- Operator screen line in TI panel: "Add material consumption"
- TM report: per-material per-day depletion

Useful for inventory planning, not blocking.

### P2 — Challan PATCH `$transaction` refactor

`app/api/tint/manager/challans/[orderId]/route.ts:527` — formula upsert wrapped in `$transaction`. Pre-existing, violates CORE §3, low-concurrency so safe today. Refactor in a dedicated session.

### P2 — Challan cell-clear UX fix

`components/tint/challan-content.tsx:211-213` filters empty strings out of PATCH body. Server has no delete branch. Clearing a cell does NOT clear the DB row, so a TM can't "unlock" a manually-overridden formula by clearing it. Build a proper "Reset to auto" button when this becomes needed.

### P2 — TM reorder `$transaction` refactor

`/api/tint/manager/reorder/route.ts` ~line 429 uses `prisma.$transaction`. Two-update swap so partial-failure semantics are acceptable. Refactor when convenient.

### P2 — Pre-existing `$transaction` in admin customer routes

`app/api/admin/customers/route.ts` lines 133 + 186. Left untouched in multi-SO commit. Refactor when convenient.

### P2 — Cosmetic cleanups

- CustomerMissingSheet styling to match admin customer split-view form
- Shade Master `isActive` filter — production verification (deferring; table is retiring)
- Challan lazy creation removal (verify `[orderId]` detail API doesn't still auto-create)
- Challan print CSS audit — old class names `ch-header`, `tint-yes` may persist

---

## Attendance + OT

### Shipped
- Phase 1 + Phase 1b (all OT admin UIs)
- OT prompt UI in check-out flow
- Grace policy (auto-credit + manual approval)

### P1 — Phase 2 admin writes

- **Manual entry record.** Admin adds a missed check-in/out after the fact with `isManualEntry = true` and `manualReason`. Backend missing.
- **Edit existing record.** Correct wrong timestamp, photo, or location. Audit field bump on every edit. Backend missing.
- **Mark exception.** Set summary `status` to `ON_LEAVE` or `EXEMPT` for a specific day with reason. Backend missing.

### P1 — Phase 2 master-data writes

**Holidays management.** CRUD on a `holidays` table — date + name + applies-to-all-roles. Rollover cron should treat holidays as non-attendance (skip ABSENT insertion). Backend + frontend both missing.

### P1 — Real geofence coordinates

Currently placeholder: Surat city centre `21.1702, 72.8311` with ±150m radius. Walk the depot perimeter with the "Use my current location" button on the new settings UI.

### P2 — Polish

- In-app notification when admin acts on OT
- Service worker for offline check-in/out
- Push notifications for OT decisions
- Submitting state polish on OT screen
- Auto-ticking clock on OT prompt screens
- Settings 403 toast label (currently mis-labelled "Session expired")

---

## Import Pipeline

### Auto-Import resume (when ready)

Auto-Import paused since 2026-05-14. To un-pause:
1. Verify `IMPORT_HMAC_SECRET` matches across depot PC + Vercel
2. Decide cross-source orphan policy (CLAUDE_IMPORT.md §15 — three options on the table)
3. Smoke-test against a small known batch in test mode
4. Re-enable Windows Task Scheduler task `2_Auto_Import`
5. Monitor `import_batches` + `/api/health` for first 24h

### P2 — Auto-Import patch path

Today Auto-Import is create-only. If late-update detection is needed (e.g. SAP marks an OBD as cancelled), go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Full re-audit needed. Deferred until business case emerges.

### P2 — Weight diff in audit log

`ExistingLine` doesn't carry weights so re-import weight changes go un-audited. Add weight diff to the patch path if depot ops needs the tracking.

### P2 — Old SAP layout fallback shim

If SAP ever ships the old 25-column layout again, implement a layout detector. Not built today.

### P2 — `articleTag` rule for ZINR rows

Today ZINR rows include with `zinr-article-tag-pending` breadcrumb warning. Implement the rule if business semantics emerge.

---

## Cross-cutting

### P2 — Tests

Zero automated tests today. `npx tsc --noEmit` is the only smoke. Worth adding:
- Parser unit tests (deterministic on fixture XLSX)
- Enrichment unit tests (test corpus of 100+ real lines)
- Slot resolution unit tests
- OT logic unit tests
- SoSync reconcile-loop tests (P2002 patterns)

### P2 — ESLint + pre-commit

`npm run lint` is unconfigured. Wire `eslint-config-next` strict + simple pre-commit hook.

### P2 — Vercel Pro upgrade

Hobby tier cap at 2 cron jobs. If we ever need a third (e.g. nightly Sampling Library `usageCount` rebuild + retention sweep), we'll need Pro.

### P1 — OneDrive dev-machine sync risk

`orbit-oms` is OneDrive-synced and shared between the depot/server PC and the (returning) laptop. Two machines two-way-syncing one git folder risks `.git` corruption mid-sync and propagates deletions both ways — the 3 stale deletions currently sitting in `git status` (`docs/CLAUDE_IMPORT V1.md`, two `.xlsx` files under `docs/plans/sampling-register/`) may already be a symptom of this. Decide a single-primary-dev-machine policy before it causes real data loss.

### P2 — `trip_report` field meanings

13 columns exist in the live `trip_report` table but are undocumented: `fixedType`, `tRate`, `vehType`, `vModal`, `volLt`, `totQty`, `totWeight`, `modiInv`, `remark`, `isManual`, `tranTransporterName`, `custsoName`, `createdOn`. Confirm meanings with Smart Flow and backfill into `CLAUDE_TRIP_REPORT.md §3`.

---

## Consolidation follow-ups (opened 2026-06-18)

New OPEN items surfaced while consolidating the 29 drafts. Grouped by module.

### Place Order / Catalog
- **Primer Int/Ext billing audit** — orders placed via `/place-order` between the 2026-06-08 Primer rebuild and the 2026-06-09 fix (`f217a1f7`) may have billed the OPPOSITE SAP (Int↔Ext). Audit that window.
- **Multi-Purpose Thinner billing audit** — thinner orders between the Sadolin `-final` rebuild and the 2026-06-09 fix (`70bd6369`) may have shown/emailed "PU Prime Thinner". Audit if any went to customers.
- **Spray Paint + M900 legacy `mo_sku_lookup` re-key** — both were un-hidden in v2 only; the v1 parser still emits `SR SPRAY PAINT` / `M900` for inbound emails. Re-key rides the parser→v2 migration (§19).
- **VT Specialty dedicated-tab fold** — currently search-only (Concrete Finish / Marble / Clear Coat). Deferred fold into a Velvet Touch tab (would reuse the per-row-family bucket + dormant-alias recipe).
- **Smoothover EXTERIORS→UTILITY + 96/97 YOX-vs-Yellow alias standardisation** — the deferred "final CORE section pass" (do the UTILITY/INTERIORS/EXTERIORS relabel together, not piecemeal).
- **Order email line-item reformat** — see the existing deferred bullet under "Place Order — email + catalog".

### /po (going-forward mobile)
- **`/po` → `/order` cutover rename** — replace the frozen `/order` backup once `/po` is fully signed off.
- **Server-side per-user recents** — recents are device-local localStorage today; needs login-scoped storage.
- **Orbit-bar collapse-on-scroll** — mockup approved, not built.
- **Dispatch slot feature** (date + time window on `/po` review) — design agreed, build deferred by owner; mockup in `docs/mockups/dispatch-slot/`.

### Tint / Reports
- **Edit-path modal gate** — the "Update TI Entry" path skips the formula-match gate and can save a null `samplingNo`. Wire the gate onto the edit/update path.
- **Cross-type reuse rows** — a TINTER line still lists ACOTONE shades (plain). Optionally filter the reuse list to the line's tinter type. Low priority.
- **Remove temp dev preview** `app/reports/tint-summary/preview/page.tsx`.
- **Intake/aging axis: OBD-date → import-time** — switch once import-time reliability is fixed (currently unreliable, so OBD date is used).
- **Operator card: tinting time + utilisation** — needs attendance present-hours + handling that stored tinting time includes paused minutes.

### Mail Orders
- **Late-Evening / Night slot-summary auto-email gap** — `slotDefs` trigger array has only 3 entries (Morning/Afternoon/Evening); Night and the new Late Evening don't auto-fire. Add them if auto-emails for those slots are wanted (`CLAUDE_MAIL_ORDERS.md §13`).
- **Dispatch cutoffs "Change-2"** — Local vs Upcountry dispatch cutoffs. Latent infra exists (`delivery_type_master`, `delivery_type_slot_config` UNUSED, `orders.dispatchSlotDeadline`, `delivery_point_master.dispatchDeliveryTypeId`/`reportingDeliveryTypeId` — corrected 2026-07-16, no `deliveryTypeOverride` column exists). Recommend a dedicated discovery session before building.

### Hide feature (Settings → Hide) — v1 deferreds
- **Hide Mail Order ROWS** (separate `mo_orders`, no hide column) — the bigger "hard part".
- **Tint badge gating** in the Tags tab — needs a shared badge registry first (Tint badges aren't centralized).
- **"N orders hidden by filter" banner** on the boards — parked.
- **Combined rule conditions** (e.g. HOLD AND older than 7 days); URGENT / MISSING_CUSTOMER rule tags; per-rule hidden counts; per-order override/pin to reveal one rule-hidden order.

### Cross-cutting
- **`scripts/_*` tsc noise** — untracked scratch files throw ~24 `tsc --noEmit` errors. Exclude `scripts/_*` from tsconfig or delete to keep the gate clean.
- **Two CLAUDE.md routers (repo-root vs docs/)** — confirm both intended or consolidate to one.

---

## Consolidation follow-ups (opened 2026-07-16)

New OPEN items surfaced while consolidating the 17 drafts (Jul 8–16) into canonical docs (Place Order, Support, UI, new `CLAUDE_PICKING.md`, Mail Orders, Import, CORE).

### Security (P1)
- **`GET /api/mail-orders/backfill-enrich` fully unauthenticated** — no session, no HMAC; still live despite being marked TEMPORARY in its own source; performs a bulk write on `mo_order_lines`. Remove or gate it. (`CLAUDE_MAIL_ORDERS.md §18`, `CLAUDE_CORE.md §13`)
- **Mail Orders routes are session-only, no role check** — most of `app/api/mail-orders/**` never checks role/permission; write routes gate on `canView`, not `canEdit`. (`CLAUDE_MAIL_ORDERS.md §18`, `CLAUDE_CORE.md §13`)

### Bugs (P1)
- **App-format orders lose all product lines before enrichment.** Headers parse correctly (Bill To/Ship To/Dispatch), but zero product lines reach enrichment on a real test order. Live, unresolved, undocumented until this line. Surfaced 2026-07-15.

### Picking
- **Picking role grants — SEEDED 2026-07-20; VERIFY ON LIVE PROD (P1).** `floor_supervisor` (view+edit),
  `picker` (view only), `operations` (view+edit) now in `prisma/seed.ts:110-112`. Confirmed in seed
  ONLY — run a `SELECT` to confirm `floor_supervisor` + `picker` can actually open `/picking` on
  production (grant-vs-prod not yet verified). (`CLAUDE_PICKING.md §1/§7`, `CLAUDE_CORE.md §5/§13`)
- **SEED FRAGILITY — ✅ RESOLVED 2026-07-20.** The operations `/picking` grant (+ floor_supervisor +
  picker) now have matching `prisma/seed.ts:110-112` rows, so a reseed no longer revokes them. Prod
  verification folded into the item above.
- **Floor workflow (Picked/Approved states) — ✅ LIVE (Stage 2, shipped through commit `bae3d182`).**
  Remaining: Stage 3 — supervisor findings (qty-short, remarks, billing-visible message), tracked
  inline in `CLAUDE_PICKING.md §7`.
- **Supervisor 10-min "N picks waiting" reminder — DEFERRED.** Not event-driven; Vercel Hobby crons are
  once-per-day (CADENCE, not count — CORE §4). Planned trigger: a small depot-PC PowerShell "doorbell"
  (committed to `scripts/`) hitting a cron-auth'd route. (`CLAUDE_NOTIFICATIONS.md §7`)
- **NO AUTOMATIC DRAIN `pick_checked` → `dispatched` (P1 — workflow hole).** Orders DO reach
  `dispatched` (the old "nothing writes to it" claim was WRONG — corrected 2026-07-24), but there is
  no automatic transition. Verified 2026-07-24: **1,051** at `dispatched` (662 auto-slotted) but it
  stops at **21 Jul** while `pick_checked` keeps growing (**195**, newest 24 Jul). The 238-row move
  was a ONE-TIME manual sweep (Floor build, 23 Jul), NOT a code path. Forced the desktop step-5b
  carry-over workaround. Needs a real design session. (`CLAUDE_PICKING.md §9`, `CLAUDE_FLOOR.md §7`)
- **Verify "New pick assigned" push on a real device.** Code is live; device-verification pending until
  a real picker has a login + subscribed phone. (`CLAUDE_NOTIFICATIONS.md §6`)
- **Remove push-test scaffolding** — the `/picking/push-test` page + the gray admin/ops pill on
  `/picking`, after floor rollout. (`CLAUDE_NOTIFICATIONS.md §9`)
- **Deferred row-click detail panel** — picker name, assign/pick/check times, who-checked, line items,
  permanent Undo; remove the temporary inline Undo when it lands. Plus the picker-login flow (own phone
  vs shared terminal). (`CLAUDE_PICKING.md §9`)
- **Manifest name experiment — finish or revert.** `manifest.json` `name="Orbit"` / `short_name="OrbitOMS"`
  is an in-flight test (does iOS read them separately for the notification "from …" line?). Result
  visible only after reinstall. (`CLAUDE_NOTIFICATIONS.md §8`, `CLAUDE_ATTENDANCE.md §14`)

### Floor Control
- **RETIREMENT DEPENDENCY LIST (P0 — blocks any switch-off).** Before `/support` or the Picking
  DESKTOP board can be retired, enumerate everything Floor borrows from them: the Picking
  assign/unassign endpoints, the sort spine, the Support dispatch-slot-picker, `formatArticleTag`, and
  the `use-picking-marker` hook. No tab is switched off until this list exists AND a trigger is agreed.
  ⚠ Picking's MOBILE boards are NOT in scope for retirement. (`CLAUDE_FLOOR.md §9`)
- **Floor Control v2 — re-enable slot suggestion (Step 10 of the build).** `lib/floor/suggest.ts` is
  gated behind `RAIL_SUGGESTIONS_ENABLED=false`. Two fixes first: (1) the staleness check must compare
  the full moment (date + time) vs now, not minutes-since-midnight (the bug that caused removal);
  (2) carry date AND time. (`CLAUDE_FLOOR.md §8`)
- **v1 gaps (P2 — from the build draft §7; carried across individually):**
  - `Waiting` pills show no elapsed time — needs a `releasedAt` on the floor payload.
  - Ship-to original→redirect name pair missing on the floor table — needs the original name on the floor feed (the rail already has it).
  - Assigned rows sink to the bottom of the board — decide whether `byAssigned` is right for this screen.
  - Rail button reads lowercase "pick slot"; mockup says "Set slot" — copy fix without forking the Support picker.
  - Assign bar reads "Change slot" beside a "pick slot" button — one label, one action.
  - No picker search — search matches customer / route / OBD only.
  - Detail-panel header pill shows no elapsed time — the panel is not a live surface.
  (`CLAUDE_FLOOR.md §8`)
- **Parked data issues (diagnose — open observations, not module state):** 103 Deco Retail bills reached
  `pending_support` with `dispatchStatus` NULL (the engine fires only on `='dispatch'` — an upstream
  diagnosis); the `Deco` 9-row un-mapped SMU leak (should be `Deco Retail`, so those bills never
  auto-slot). (`CLAUDE_FLOOR.md §10`, `CLAUDE_CORE.md §7.4`)

### Import
- **Arrival-slot same-day/different-day rule.** Designed, not built — the live fork still uses the old `receivedAt` vs `punchedAt` comparison. (`CLAUDE_IMPORT.md §12.2`)

### Dispatch / Planning
- **Dispatch Planning Brain V2 — PARKED, fork unresolved.** The 6-slot sliding-capacity design conflicts with the live `vehicle_master` (flat-capacity, 6 rows, no sliding). No code written; the design-locked and fleet-mismatch-discovery drafts are kept as reference only — do NOT treat the locked design as settled. A `CLAUDE_PLANNING.md` gets created only when this ships.

### Place Order
- **Missing draft: `web-update-2026-07-14-po-save-draft-sent-feature.md`.** Referenced by the Favourites session as a companion but absent from `docs/prompts/drafts/`. The `/po` Drafts/Sent feature (draft list, receipt, resend) is live in code but undocumented in `CLAUDE_PLACE_ORDER.md`/`CLAUDE_UI.md` pending this draft's recovery or re-authoring.

---

## Consolidation follow-ups (opened 2026-07-19)

From the flat-SKU-catalog migration + the Direction-A mobile shell batch. Canonical detail:
`CLAUDE_CORE.md §7.1.c` + `§13`, `CLAUDE_IMPORT.md §8.1`, `CLAUDE_PICKING.md §5`, `CLAUDE_UI.md §59`.

### Catalog cleanup (P1 — blocks the friendly-name build)

- [ ] **~309 unknown SAP codes.** Active on real bills but present in NEITHER catalog table (old
  `sku_master` ~57% coverage, `sku_master_v2` ~73%, ~27% in neither). They fall back to raw SAP text
  with a blank pack. Export by frequency:
  `docs/prompts/drafts/unknown-sku-codes-2026-07-19.csv` (309 rows + header — leave it where it is).
  Owner review needed: genuinely obsolete vs. never-mastered — **needs Chandresh/depot input.**
  Overlaps the blank-pack landmine in `CLAUDE_PICKING.md §7` (reduced 2026-07-19, NOT closed).
- [ ] **7 odd Promise/duplicate rows**, surfaced by the friendly-name generation: 3 pre-existing
  Promise SmartChoice duplicate identities whose names collide (Int Primer, Ext Primer, Acrylic
  Distemper), a bare "Promise" row with no product identity (family `PROMISE INTERIOR`, product
  `PROMISE`, base `PROMISE`), and 2 stutter rows ("Promise Primer Promise Primer", "Acrylic
  Distemper Duwel Acrylic Distemper"). Harmless clumsy names today. Its own careful data pass with
  its own rollback — not bundled with anything else.

### Friendly product name on the picking card (P2 — DEFERRED, designed + proven)

- [ ] Deferred by Smart Flow 2026-07-19: unwilling to risk any misleading name on a picking card
  until the catalog odd-rows above are cleaned. **Nothing was built** — no column, no picking code.
  Recipe is fully proven and preserved (stored `skuDisplayName String?`, built from `category` /
  `product` / `baseColour` with NO menu-table join, `emailCase()` not `smartTitleCase`, gentle
  de-double only, SKU code stays the hero and the name is a muted reference line):
  `docs/prompts/drafts/web-update-2026-07-19-sku-master-v2-project-v2.md §5` + the per-family samples
  in `code-discovery-2026-07-19d-picking-name-samples.md`. **Resume order:** clean the catalog → re-run
  the 19d sampling to confirm zero misleading names → build in two steps (fill via reviewable SQL,
  then show on the card).

### Retire old `sku_master` — the final swap (P2 — one dedicated session)

- [ ] Drop old `sku_master` + its 3 FK helper tables (`product_category`, `product_name`,
  `base_colour`); drop `import_enriched_line_items.skuId` + its relation; retire the admin SKU-CRUD
  surface (`/api/admin/skus/*` + the 4 `skus/page.tsx` browse pages — the only live readers left);
  rename `sku_master_v2` → `sku_master`. **Read `CLAUDE_CORE.md §13`'s id-space landmine first.**
- [ ] **Blocker to handle IN that session:** `scripts/normalise-sampling-data.ts:313` reads old
  `sku_master` and has no underscore prefix, so it is INSIDE the `tsc --noEmit` gate — it will fail
  to compile at the DROP and block every commit until fixed (`CLAUDE_SAMPLING_LIBRARY.md §3`).
- [ ] Remove the 2 scratch diagnostics that read the bookmark (`scripts/_diagnose-sku-5961032.ts`,
  `scripts/_diagnose-skuid-collision.ts`) — outside the gate, so they block nothing, but they are the
  only remaining readers.

### Picking (P2)

- [ ] **Slide-to-done control** — designed + approved 2026-07-19, **not built** (the batch stopped
  before it by choice). Replace the detail screen's **Approve** button with a drag-to-confirm control
  firing the *same* `handleApprove(detailRow)` → `POST /api/picking/approve` `{orderId}`. The
  `allLinesChecked` gate and the API are unchanged — only the input mechanism changes. **Green**, not
  teal (separates "finish" from teal "assign").
- [ ] **Four detail-area sheets ship with no Back affordance** — route filter, check-picker filter,
  checked-picker filter, and the bulk-bar assign sheet. They push no history entry, so Android
  hardware back / iOS edge-swipe navigates the *browser* instead of closing them. Same gap class the
  detail screen had pre-Build-A; copy the `/po` single-authority popstate model
  (`CLAUDE_PLACE_ORDER.md §25`). The nested assign sheet opened *from* the detail screen is already
  handled — not on this list.
- [ ] **Feel-tuning pending real-device use:** the 0.65× drag-follow and ~260ms slide are subjective
  one-number tweaks if the floor wants faster/stiffer.

### UI (P2)

- [ ] **Extract the Direction-A header to a shared component** — the remaining half of `CLAUDE_UI.md
  §59`'s partly-live deferred item. Picking has the working header (title + search toggle + grid /
  avatar triggers into the shared sheets via `useMobileShell()`); it is not yet extracted, so every
  other page still keeps its own header. Extract when a second module adopts Direction A, not before.

### Code cleanup (P2 — one line)

- [ ] **Stale comment in `prisma/schema.prisma`** above `model sku_master_v2`: it ends
  `// No readers repointed yet — that is a separate session.` — true when `916fcd39` landed, but
  three later commits (`8f606a88`, `a227fb13`, `b91b7381`) repointed every operational reader. A
  future reader taking it at face value would conclude the migration never happened. Fix the line
  next time `schema.prisma` is edited — not worth its own commit.

---

## Documentation hygiene

### Schema docs consolidation cadence
Every 2-3 weeks: consolidate `docs/prompts/drafts/` into canonical files using the consolidation prompt. Archive consumed drafts to `docs/prompts/archive/YYYY-MM/`.

Last cycle: 2026-06-18 (29 code-update drafts from Jun 2 – Jun 18: full catalog restructure, `/po` redesign + back-nav, desktop parity, pack buckets, email single-source, Sadolin/SuperCover/SuperClean/Tools/Spray Paint/M900, Stainer codes, Hide feature, tint sampling reuse + pack scaling + duplicate-merge runbook, Tint Summary report, mail-orders 5 slots). Prior cycle: 2026-06-02.

### `taxonomy-preview.json` path

Lives at `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`. The seed reads from this path — DO NOT move it without updating the seed.

---

*Updated 2026-06-19 — reflects the full catalog restructure (all families folded, 9-tile dial), `/po` going-forward build, desktop `/place-order` parity, email single-source + AkzoNobel recipient, Hide feature shipped, tint sampling reuse + pack scaling + duplicate-merge runbook (3 groups merged), Tint Summary report + `/reports` hub, mail-orders 5 slots, **app-format order email (shared `renderOrderBody` + proper-case + line-number alignment) + mail parser v7.2 (`Parse-AppBody` reader, `Test-IsAppFormat` sorter, name-lock) + Table C exact-name enrichment fast-path (app orders → `mo_sku_lookup_v2`, ingest-only, 15 collisions excluded)**. Schema v27.6.*
