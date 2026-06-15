# ROADMAP.md — OrbitOMS Planned Work
# Updated 2026-06-02 · Lives in: orbit-oms/docs/ (manual attach — NOT auto-loaded)

Attach this file when planning the next phase of any module. Live "what's next" list, separated from canonical docs.

Items grouped by module. Within each module: SHIPPED → P0 (blocking) → P1 (next up) → P2+ (later).

---

## Place Order / Mail Orders — v2 single source of truth (3-stage plan)

The big architectural arc. **Currently in Stage 1.** Full plan in `CLAUDE_PLACE_ORDER.md §19`.

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

## Place Order — per-product CSV rollout (continuing)

Pattern established 2026-06-01 (WS Max → Protect Dustproof/Rainproof/Powerflexx). 6-step loop in `CLAUDE_PLACE_ORDER.md §14`.

**Shipped:**
- WS Max base aliases (display + search)
- WS Protect restructure (eliminated wrong "WS PROTECT", added 4 sub-products with correct SKUs)
- BASE_ALIASES extended to Dustproof/Rainproof/Powerflexx with 99 → Vibrant Red
- Search ranking (`mobile-search.ts`) with prefix/word-boundary/inner scoring

**Next products (each follows the same 6-step loop):**
- Other WS family members not yet revised (if any)
- GLOSS family base aliases (if reviewer wants)
- Other major families flagged by depot ops

### Optional search refinements (NOT built)
- `rainproof` → Rainproof only (drop the weak Dustproof link)
- `ws` → WS-family-first (rank WS family above unrelated "Dulux WS Hi-Sheen/Metallic" products that merely contain "WS")

Pick up if Smart Flow asks.

---

## Place Order — email + catalog (deferred)

### P2 — Deferred / open

- **Order email line-item reformat.** Plain text, NO HTML/bold (bold needs an HTML send-path — declined). New per-line format `{n}. {Product Name} - {pack}*{qty}`: numbered lines (`1.` `2.` `3.`); `" - "` (space-hyphen-space) after the product name; keep `*` and the comma multi-pack list (`1L*6, 4L*4, 10L*1, 20L*1`); customer header unchanged. e.g. `1. GLOSS Brilliant White - 1L*6` / `5. WS MAX Brilliant White - 1L*6, 4L*4, 10L*1, 20L*1`. Build: change the line assembly in all 3 email builders (`lib/place-order/email.ts`, `app/po/po-page.tsx`, `app/order/page.tsx`); PREFER a shared line/body render helper so they can't diverge (same reasoning as the `emailLineLabel` consolidation). Code-only, no DB/reseed.

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

- **Sampling duplicate refinement.** Planning doc exists (2026-05-27 web update). Identify duplicate sampling numbers where shadeName matches but one is "shell" (zero pigments) and another has formula. Merge with operator approval. Phase 1 (diagnosis only) → Phase 2 (preview Excel) → Phase 3 (merge SQL) → Phase 6 (prevention). Not started.

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

---

## Documentation hygiene

### Schema docs consolidation cadence
Every 2-3 weeks: consolidate `docs/prompts/drafts/` into canonical files using the consolidation prompt. Archive consumed drafts to `docs/prompts/archive/YYYY-MM/`.

Last cycle: 2026-06-02 (12 drafts: 7 code-update + 5 web-update from May 26 – Jun 1).

### `taxonomy-preview.json` path

Lives at `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`. The seed reads from this path — DO NOT move it without updating the seed.

---

*Updated 2026-06-02 — reflects Cohort A+B restore, REVIEW pile import, multi-SO + contacts auto-sync shipped, challan formula auto-fill shipped, `/order` v2 migration, order dedup, WS Max + Protect product rollouts, tint siteId bug fixed.*
