# ROADMAP.md — OrbitOMS Planned Work
# Updated 2026-09-03 (CI module inventory — new `## CI — Goods Return Note` section, 13 items incl. the 32-string SAP reason list; the module shipped 2026-08-31→09-03 and had no ROADMAP entry) · Prior: 2026-08-09 (articleTag rule shipped — 2 new Import items, ZINR item superseded; Picking Stage 3 closed — findings shipped) · 2026-08-05 (full item-by-item status pass, reconciliation cycle) · Lives in: orbit-oms/docs/ (manual attach — NOT auto-loaded)

Attach this file when planning the next phase of any module. Live "what's next" list, separated from canonical docs.

Items grouped by module. Within each module: SHIPPED → P0 (blocking) → P1 (next up) → P2+ (later).

---

## Place Order / Mail Orders — v2 single source of truth (3-stage plan)

The big architectural arc. **Currently in Stage 1.** Full plan in `CLAUDE_PLACE_ORDER.md §19`.

**Shipped 2026-06-19 — App-format parser + Table C fast-path (app orders → V2):**
- Mail parser v7.2: App reader (`Parse-AppBody`) + sorter (`Test-IsAppFormat`, routes on first content line `Bill To:`) + name-lock (pins the exact emitted name so the Table C key matches by construction). Human/typed path untouched. Manual-deploy to depot PC. (The repo's `docs/Parser/Parse-MailOrders-V7.ps1` working copy is **tracked** and now at v7.3.0 — status-pass correction 2026-08-05; the canonical LIVE parser is still outside git per `CLAUDE_MAIL_ORDERS.md §3`, which owns the version ruling.)
- Table C exact-match fast-path in enrichment (commit `da219238`, on `main`): app line → exact dict (built from `mo_sku_lookup_v2` via `buildTableCContext`) → V2 material via a V2 resolver; 15 collisions excluded from the dict → keyword fallback. Stacked design (exact-first, keyword-fallback). Tested 11/11 this session; one real SKU rescue proven (`2K PU GLOSS 90 BASE` → V2 primary). **INGEST-only** — verified the other callers (debug / backfill / re-enrich) pass no context.
- **Net:** a clean app line that HITS Table C resolves via `mo_sku_lookup_v2` (fast lane). A MISS (collision / not-in-dict) and ALL typed/human orders still resolve via legacy `mo_sku_lookup` (keyword path — verified ingest still reads it; legacy `mo_sku_lookup` model still in schema). The split is intentional — a partial early bridge ahead of full Stage 3. Legacy tables stay (do NOT delete).

**Pending (this bridge):**
- [x] ~~Parser go-live (v7.2)~~ — **CONFIRMED LIVE 2026-07-15** (the app-only `Dispatch:` tag came back on a real order — `CLAUDE_MAIL_ORDERS.md §3.1`). NEW residue: the repo copy moved on to **v7.3** (piece-pack peel); whether v7.3 is deployed is unverifiable from here — redeploy when convenient.
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
- ~~Add `isPrimary` filter to `/api/place-order/data`~~ — **✅ SHIPPED 2026-07-15** (`46b500fb`; confirmed live against the route 2026-07-16 — `CLAUDE_PLACE_ORDER.md §16/§22`)

### Stage 2 — make v2 parser-ready

1. Fill canonical key (`product`) on all remaining rows (full hygiene)
2. Build the one universal keyword layer in v2 (word→product + word→colour), seeded from legacy `mo_product_keywords` + `mo_base_keywords`
3. Point `/po` + `/place-order` search at the shared layer
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

- **Order email line-item reformat — ✅ SHIPPED 2026-06-19.** Plain text, NO HTML/bold (bold needs an HTML send-path — declined). Per-line format `{n}. {Product Name} - {pack}*{qty}`: numbered lines (`1.` `2.` `3.`); `" - "` (space-hyphen-space) after the product name; keep `*` and the comma multi-pack list (`1L*6, 4L*4, 10L*1, 20L*1`); customer header unchanged. e.g. `1. GLOSS Brilliant White - 1L*6` / `5. WS MAX Brilliant White - 1L*6, 4L*4, 10L*1, 20L*1`. Done via the **shared** `renderOrderBody` helper in `lib/place-order/email.ts` (the preferred no-divergence approach, like the `emailLineLabel` consolidation) — all 3 builders then live (`lib/place-order/email.ts`, `app/po/po-page.tsx`, and `app/order/page.tsx` — the last retired 2026-07-27, leaving two) call it. Plus refinements: header resequenced (Bill To → Ship To → Dispatch → Remark → Note), proper-case names (`emailCase`, codes/short/digit words stay caps), per-bill right-aligned line numbers with figure-space padding, and CC `surat.order@outlook.com` on desktop `/place-order` only. The app emitting this format is exactly what mail parser v7.2 (`Parse-AppBody`) reads. No email-builder shared-helper work pending. Code-only, no DB/reseed.

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

- **Sampling Issue-5 duplicate cleanup (IN PROGRESS).** Runbook + reference graph shipped (`CLAUDE_SAMPLING_LIBRARY.md §12`); dedupe by EXACT formula fingerprint, never shade name; inactivate (never delete) sources. **3 white-only groups merged** (`26-0196`/`26-0106`/`26-0094`); **~380 duplicate groups remained AS OF 2026-07-27 — re-COUNT before resuming the runbook** (status-pass note 2026-08-05: figure not re-run; merges may have happened since). Pending: build the **exact-dupe-finder tool** (seed number → all matching active samplings → dated review CSV); remove junk test sampling **`#26-0285`**. Owner chose manual SQL over a batch script for now.

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
- ~~Challan lazy creation removal~~ — **✅ VERIFIED CLOSED 2026-08-04**: the `[orderId]` detail API has no create call; creation is import-time only (`CLAUDE_TINT.md §14`)
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

### ~~Auto-Import resume~~ — MOOT (status-passed 2026-08-05)

The whole "paused since 2026-05-14, to un-pause:" block described a world that ended 2026-06-20 —
**Auto-Import has been LIVE on the v2 JSON path ever since** (944+ batches; `CLAUDE_CORE.md §4` /
`CLAUDE_IMPORT.md §10`, both corrected 2026-08-03/04). One survivor from the old checklist:

- **Cross-source orphan policy — OPEN, now LIVE-RELEVANT daily** (it was "deferred until un-paused";
  it un-paused six weeks before anyone re-read the line). Three options still on the table —
  `CLAUDE_IMPORT.md §15`.

### New import items (opened 2026-08-04, from the IMPORT v1.7 pass)

- **Retire-or-keep the v1 `?action=auto` handler + `IMPORT_HMAC_SECRET`** — the v1 multipart path has
  ZERO batch evidence in the entire table; whether its depot task still fires is import-PC-only
  knowledge. Owner decision (retiring changes a live API surface), not a cleanup.
- **Parser `$ScriptVersion = "6.5.0"` stale variable** (`docs/Parser/Parse-MailOrders-V7.ps1:136`) —
  one-line script fix; the file header (v7.3.0) is the real version. Owner-approved edit + redeploy.
- **A version field in the ingest payload** — the parser stamps no version anywhere, so the deployed
  version is permanently unverifiable from the depot PC (bit the 2026-08-04 pass). One header/body
  field + one column or log line fixes the class forever.

### P2 — Auto-Import patch path

Today Auto-Import is create-only. If late-update detection is needed (e.g. SAP marks an OBD as cancelled), go through `upsertObd` like manual SAP does, with `LINE_AUTHORITY['auto-import'] = 'authoritative'`. Full re-audit needed. Deferred until business case emerges.

### P2 — Weight diff in audit log

`ExistingLine` doesn't carry weights so re-import weight changes go un-audited. Add weight diff to the patch path if depot ops needs the tracking.

### P2 — Old SAP layout fallback shim

If SAP ever ships the old 25-column layout again, implement a layout detector. Not built today.

### ~~P2 — `articleTag` rule for ZINR rows~~ — SUPERSEDED 2026-08-09 (`9de0c55b`)

ZINR was never the reason tags were missing. The manual-SAP parser emitted `null` for **every** item
category, ZINR included. The rule now lives in `lib/article-tag.ts` and applies to all categories —
`CLAUDE_IMPORT.md §8.2`. One crumb left: the `zinr-article-tag-pending` warning text still says
"needs articleTag rule (deferred)". It gates nothing (preview-only, never reaches confirm), so it was
left rather than removed inside a change about the tag rule. **Retiring that one string is a P2
one-liner** — `lib/sap-parser/apply-rules.ts:144-151`.

### P1 — Backfill historically wrong / null `articleTag`

The 2026-08-09 fix corrects **new imports only**. `patchLines` (`lib/import-upsert/lines.ts`) never
touches `articleTag` on an existing line, so even re-uploading an old OBD will not repair it. Two
populations, and the second matters more:

- **~19,200 lines with a NULL tag** — cosmetic gap; the picker sees no pack count, same as before.
- **138 lines with a WRONG tag** across four 1 L SKUs (`5948208`, `5948212`, `5948220`,
  `IN32400023`), computed at 6/carton when the catalog says 9 — e.g. qty 45 reads `7 Carton 3 Tin`
  where the truth is `5 Carton`. **Worse than null**, because it reads as authoritative and a picker
  will count against it.
- Order-level roll-ups also do not recompute until an order's lines next change, so some orders show
  a null tag even though their lines are tagged (`CLAUDE_IMPORT.md §8.2`, multi-group bug).

Needs an owner decision before anything runs: this rewrites live picking data on orders that may
already be picked. A one-off script (not a schema change) — read lines, recompute via
`computeArticleInfo()`, write back, then rebuild the affected `import_obd_query_summary` rows.
**Ranked P1 not P2 only because of the 138 wrong ones**; the null backfill alone would be P2.

### P2 — A real `containerType` column on `sku_master_v2`

The permanent Drum-vs-Bag blind spot. Verified 2026-08-09 across the whole catalog: **nothing**
in `sku_master_v2` — `category`, `materialType`, `paintType`, `unit`, or any combination — separates
a drum from a bag. `unit` is `KG` for both (20 KG distemper → Drum, 25 KG texture → Bag) and `L` for
both. The only thing making that call today is the literal number in `lib/article-tag.ts`'s
`DRUM_SIZES` / `BAG_SIZES` lists, which means **every new pack size needs a human decision and a code
edit** — that is the recurring maintenance cost, not a one-off.

`piecesPerCarton` already proves the shape works: it identifies Carton with **perfect precision**
(zero false positives across 252 drum/bag SKUs). A `containerType` enum (`drum` / `bag` / `carton` /
`piece`) would do the same for the other three and let the fallback lists shrink to a legacy path.
Cost is not the column — it is populating ~872 catalog rows and keeping it populated. Worth doing
**if** list maintenance keeps recurring; not worth pre-empting. Would also resolve the open
`2.5 / 3 / 5 / 0.4` decisions (`CLAUDE_IMPORT.md §8.2`) at the source instead of one list edit at a time.

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

### P2 — Vercel Pro upgrade (premise REWRITTEN 2026-08-05)

~~Hobby tier cap at 2 cron jobs~~ — that premise died in January 2026: the COUNT cap is 100 on all
plans; the binding Hobby constraint is **CADENCE (once per day, fires within the hour)** —
`CLAUDE_CORE.md §4`. A third or tenth DAILY cron needs nothing. Pro is needed only for a
**sub-daily** schedule (e.g. the picking-supervisor reminder), and the chosen alternative there is
the depot-PC doorbell (`CLAUDE_NOTIFICATIONS.md §7`). Keep Pro as the fallback if the doorbell
disappoints.

### P1 — OneDrive dev-machine sync risk

`orbit-oms` is OneDrive-synced and shared between the depot/server PC and the (returning) laptop. Two machines two-way-syncing one git folder risks `.git` corruption mid-sync and propagates deletions both ways — the 3 stale deletions currently sitting in `git status` (`docs/CLAUDE_IMPORT V1.md`, two `.xlsx` files under `docs/plans/sampling-register/`) may already be a symptom of this. Decide a single-primary-dev-machine policy before it causes real data loss.

### P2 — `trip_report` field meanings (reworded 2026-08-05)

`CLAUDE_TRIP_REPORT.md §3` now lists all 38 columns (38/38 live-verified) with **10 explicitly marked
as having no confirmed display-rule meaning** (`fixedType`, `tRate`, `vehType`, `vModal`, `modiInv`,
`remark`, `isManual`, `tranTransporterName`, `custsoName`, `createdOn` — `volLt`/`totQty`/`totWeight`
gained meanings in the display-rules session). Remaining work: confirm those 10 with Smart Flow and
annotate §3.

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
- **`/po` → `/order` cutover rename — NOW UNBLOCKED (2026-07-27).** `/order` was retired
  (`de48357d`, `archive/2026-07-order/`) with **no redirect**, and the address was deliberately
  **parked for exactly this rename** — nothing occupies it. The middleware `"/order"` public-path
  entry was kept on purpose, so the address is already public and returns a clean 404 today; read
  `archive/2026-07-order/README.md` before touching it. Remaining work is the rename itself, once
  `/po` is fully signed off.
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
- ~~**`scripts/_*` tsc noise**~~ — **✅ DONE**: `tsconfig.json` `exclude` carries `"scripts/_*.ts"` + `"scripts/_tmp/**"` (and, since 2026-08-04, `"docs/_backup_*/**"`); the gate runs clean.
- ~~**Two CLAUDE.md routers**~~ — **✅ RESOLVED 2026-07-19**: `docs/CLAUDE.md` retired; the repo-root router is the ONLY router and says so in its own header.

---

## Consolidation follow-ups (opened 2026-07-16)

New OPEN items surfaced while consolidating the 17 drafts (Jul 8–16) into canonical docs (Place Order, Support, UI, new `CLAUDE_PICKING.md`, Mail Orders, Import, CORE).

### Security (P1)
- **`GET /api/mail-orders/backfill-enrich` fully unauthenticated** — no session, no HMAC; still live despite being marked TEMPORARY in its own source; performs a bulk write on `mo_order_lines`. Remove or gate it. (`CLAUDE_MAIL_ORDERS.md §18`, `CLAUDE_CORE.md §13`)
- **Mail Orders routes are session-only, no role check** — most of `app/api/mail-orders/**` never checks role/permission; write routes gate on `canView`, not `canEdit`. (`CLAUDE_MAIL_ORDERS.md §18`, `CLAUDE_CORE.md §13`)

### Bugs (P1)
- **App-format orders lose product lines before enrichment — STATUS UNCLEAR, re-test (reworded 2026-08-05).** Surfaced 2026-07-15 — the same day v7.2 was confirmed live and parsing (`CLAUDE_MAIL_ORDERS.md §3.1`), so the original "zero lines" observation may have been the pre-deploy copy. One specific line-loss class (TOOLS `"1 pc*12"` piece packs) was definitively fixed in parser **v7.3** (repo copy; deploy unverified). Before treating this as open OR closed: place one real app order and check its lines reached enrichment.

### Picking
- **Picking role grants — ✅ CLOSED 2026-07-28. Live-prod SELECT run; seed and live AGREE.** Both this
  item and the seed-fragility item below are done. **`CLAUDE_CORE.md §5`'s `picking` page-key row now
  OWNS the live-verified statement and carries the numbers** — do not restate them here or re-open
  this. One consequence worth carrying forward: the same SELECT showed `floor_supervisor` and `picker`
  hold `picking` but **NOT** `floor`, which is why the desktop retirement kept `/picking` live rather
  than redirecting (`CLAUDE_FLOOR.md §9b`).
- **SEED FRAGILITY — ✅ RESOLVED 2026-07-20, verification closed 2026-07-28.** The operations
  `/picking` grant (+ floor_supervisor + picker) have matching `prisma/seed.ts:110-112` rows, so a
  reseed no longer revokes them, and live now matches seed. Standing lesson kept: **seed is not live,
  in BOTH directions** — it has now bitten each way once.
- **Floor workflow (Picked/Approved states) — ✅ LIVE (Stage 2, shipped through commit `bae3d182`).**
- **Stage 3 — floor findings (qty-short / old MFG) — ✅ LIVE (shipped 2026-08-07/09, `cd27c976` →
  `0df656ef`).** Nothing remaining. Delivered as a **two-step** flow — picker reports (optional),
  supervisor confirms (authoritative, `recordedById IS NULL` = pending) — on the same screen both
  roles already use; exactly two reasons behind a live CHECK constraint; Old MFG additionally
  capturing a month + year (Schema v27.15). The "billing-visible message" landed not as free text but
  as a ⚠ flag on the Billing Picking list plus a read-only detail panel, both reading CONFIRMED
  findings only. Full write-up: `CLAUDE_PICKING.md §11`; the Billing half: `CLAUDE_MAIL_ORDERS.md
  §23.4.1`. ⚠ Carried forward, NOT a blocker: **3 of 4 live `old_mfg` rows predate the month/year
  columns and are dateless** (count 2026-08-09) — fixed by re-opening the line on the floor, never a
  backfill; a date read off a tin cannot be reconstructed.
- **Supervisor 10-min "N picks waiting" reminder — DEFERRED.** Not event-driven; Vercel Hobby crons are
  once-per-day (CADENCE, not count — CORE §4). Planned trigger: a small depot-PC PowerShell "doorbell"
  (committed to `scripts/`) hitting a cron-auth'd route. (`CLAUDE_NOTIFICATIONS.md §7`)
- **🔴 LOOK UP A DISPATCHED BILL — no screen can (P2, owner-stated 2026-07-28).** All **1,546**
  orders at `workflowStage 'dispatched'` are **invisible in every screen in the app**. Verified
  2026-07-28 against every surface that reads `orders`: `/floor` and `/picking` filter to stage
  sets that stop at `pick_checked`; `/trips` reads a different table; Tint Manager, Tint Summary
  and the admin dashboard filter to their own stages; Mail Orders reads `mo_orders`. The only
  surfaces without a stage filter reach them by accident — Hidden Orders (only if hidden),
  Removed Orders (only if removed), and the order-detail panel (only if something links to it,
  and nothing does).
  **The data is intact — only the view is missing.** Nothing was deleted; this is a gap, not a loss.
  The owner intends a proper **REPORT** feature, built once the workflow is complete end to end.
  Deliberately deferred, not urgent.
  ⚠ `/planning`'s `showDispatched` branch was **never** a substitute: no client ever set the
  parameter, so that board always rendered empty (`archive/2026-07-planning-board/README.md`).
- **NO AUTOMATIC DRAIN `pick_checked` → `dispatched` (P1 — workflow hole).** Orders DO reach
  `dispatched` (the old "nothing writes to it" claim was WRONG — corrected 2026-07-24), but there is
  no automatic transition. Verified 2026-07-24: **1,051** at `dispatched` (662 auto-slotted), stopping
  at **21 Jul** while `pick_checked` kept growing (**195**, newest 24 Jul).
  ⚠ **Recount 2026-07-27: 1,546 at `dispatched`** — roughly **500 rows moved in three days**, and the
  "stops at 21 Jul" observation above no longer holds. **How they moved is not understood**: either the
  one-time manual sweep was repeated, or a drain path exists that canon does not know about. Establishing
  which is the first task when this item is picked up — not investigated 2026-07-27. The 238-row move
  was a ONE-TIME manual sweep (Floor build, 23 Jul), NOT a code path. It also forced the desktop
  board's carry-over exclusion — **that workaround is gone (the board was retired 2026-07-28), the
  HOLE it worked around is not.** Needs a real design session.
  ⚠ **Changed 2026-07-28: nothing in the app reads or writes `dispatched` on a board any more.**
  `/planning` and `/warehouse` — the only two surfaces that queried that stage — are both retired
  (`639f8139`, `207e2a5c`). The ~500-row movement is **still unexplained**, and there is now one
  less place to observe it from. Priority unchanged. Pairs with the dispatched-bill lookup item
  above. (`CLAUDE_PICKING.md §7`, `CLAUDE_FLOOR.md §7`)
- **Verify "New pick assigned" push on a real device.** Code is live; **the blocker changed shape
  2026-08-04**: real picker test accounts now EXIST (ids 35/36) and the 2026-07-29 first-login test
  plan's Round 4 covers exactly this — but no result was recorded. Run it (or report it ran).
  (`CLAUDE_NOTIFICATIONS.md §6`, `CLAUDE_PICKING.md §7`)
- **Remove push-test scaffolding** — the `/picking/push-test` page + the gray admin/ops pill on
  `/picking`, after floor rollout. ⚠ **Updated 2026-07-28: only ONE door is left, and it is
  phone-only.** The desktop pill lived in the archived board; the surviving link
  (`picking-mobile-shell.tsx`) is `block md:hidden`, so **at desktop width there is now no link to
  `/picking/push-test` at all** — the page still answers if you type the URL. Not worth building a
  replacement link for scaffolding that is due to be deleted; noted so nobody hunts for a missing
  pill. (`CLAUDE_NOTIFICATIONS.md §9`)
- **Deferred row-click detail panel** — picker name, assign/pick/check times, who-checked, line items,
  permanent Undo. ⚠ **Updated 2026-07-28: the "temporary inline Undo" this was to replace is GONE** —
  it lived on the archived desktop board. Floor already has the detail panel this item describes
  (`CLAUDE_FLOOR.md §4.6`), so what remains is whether the PHONE supervisor board wants one. Plus the
  picker-login flow (own phone vs shared terminal). (`CLAUDE_PICKING.md §7`)
- **Desktop supervisor → `/floor` redirect — PARKED, explicitly NOT built (P2).** Raised by the owner
  as a future idea during the desktop retirement. **Blocked on a permission decision, not on code:**
  `floor_supervisor` and `picker` hold `picking` but **NOT** `floor` (live SELECT 2026-07-28), so a
  redirect today lands both roles — including both `/picking` login destinations — on
  `/unauthorized`. That is the same dead end that ruled the redirect out at the time. Granting `floor`
  to `floor_supervisor` hands the floor team Hold / Cancel / Release over the gatekeeper rail — an
  authority decision, not a layout one. It would also break testing the card board by narrowing a
  desktop window. (`CLAUDE_FLOOR.md §9b`, `CLAUDE_CORE.md §5`)
- **Unmatched bills have no desktop home (P2).** The archived desktop board had an "Unmatched" header
  segment listing bills whose customer never resolved. `/floor` shows "(Unmatched)" on a row but
  offers no way to filter or find them, and the card boards have no equivalent. Tint Manager's
  resolver can still FIX one — nothing now LISTS them. Pairs with the existing "missing-customer
  resolver has no Floor entry point" item below. (`CLAUDE_FLOOR.md §9b`)
- **Approve is phone-only — a STANDING gap, not a new loss (P2).** There is no way to approve a picked
  bill from a PC. This was already true before the desktop retirement (that board never had Approve
  either, and `/floor` has none — verified by a whole-folder search of `components/floor`,
  `lib/floor`, `app/api/floor`). Recorded now because the phone is the only option, so if a supervisor
  is ever at a desk without a phone the workflow stalls. (`CLAUDE_PICKING.md §6`)
- **`PickingQueueResult.date` has no reader (P2 — trivial).** Surfaced while removing the four dead
  counters 2026-07-28. `getPickingQueue()` returns `{ date, rows }`; no surface reads `date`. Left in
  place deliberately — it was not on that step's approved removal list. Remove it in its own pass, or
  leave it as a cheap debugging aid.
- **`single` scope KEPT DELIBERATELY — do not re-derive it as dead code (owner decision 2026-07-28).**
  `lib/picking/queue.ts`'s `single` scope has **no caller in app code**, and a future sweep will find
  that and propose deleting it. It is kept because it is what a request with **no `?scope=`** resolves
  to, and both public routes still accept it by name (`app/api/picking/queue/route.ts`,
  `app/api/picking/marker/route.ts`) — removing it changes a live API contract for no benefit. The
  only thing that ever exercised it was the untracked scratch script deleted at `b51cd14f`. The
  reasoning is also recorded as a comment at the scope itself; read that before acting.
- **Manifest name experiment — finish or revert.** `manifest.json` `name="Orbit"` / `short_name="OrbitOMS"`
  is an in-flight test (does iOS read them separately for the notification "from …" line?). Result
  visible only after reinstall. (`CLAUDE_NOTIFICATIONS.md §8`, `CLAUDE_ATTENDANCE.md §14`)

### Floor Control
- **RETIREMENT DEPENDENCY LIST — ✅ FULLY CLOSED. Both halves done.** `/support` retired 2026-07-27
  (`archive/2026-07-support/`); what Floor borrowed from it was extracted into `components/floor/` ·
  `lib/floor/format.ts` · `app/api/floor/` first. The **Picking DESKTOP board retired 2026-07-28**
  (`archive/2026-07-picking-desktop/`) — and the Picking half of this list turned out to need **no
  extraction at all**: the assign/unassign endpoints, the sort rule objects + `sortPickingQueue`, and
  the `use-picking-marker` hook **all survived untouched and Floor still imports all three**. What
  was removed (the `rolling` scope and four payload counters) was never Floor's. Full accounting:
  **`CLAUDE_FLOOR.md §9b`**. ⚠ Picking's card boards were never in scope and are still live at every
  width.
- **Ship-to CLEAR (✕) on the Floor detail panel (P2 — UI only).** `POST /api/floor/ship-to` already
  accepts `customerId: null` and clears the redirect; the panel offers no ✕ to send it, so an
  operator can change a ship-to but never remove one. No backend work. Deferred to the post-testing
  polish round. (`CLAUDE_FLOOR.md §4.4`)
- **Missing-customer resolver has no Floor entry point (P2).** `components/shared/customer-missing-sheet.tsx`
  opened from the Support board and the Tint Manager Kanban; with Support retired, only Tint Manager
  can resolve an unmatched customer. Decide whether Floor's detail panel should surface it.
  (`CLAUDE_MAIL_ORDERS.md §19`)
- **Floor Control v2 — slot suggestion — ✅ SHIPPED 2026-08-03** (commits `30226144` → `dee603dc` +
  `ab70c826`). Both preconditions this item set were built exactly as specified: the staleness check
  is now one closed-batch MOMENT test, and the suggestion carries date AND time. Layer spec:
  `CLAUDE_FLOOR.md §8` (hand-verification of five checks still pending there). Follow-ups it opened
  are below under **"Floor Control — slot-suggestion follow-ups (opened 2026-08-03)"**.
- **v1 gaps (P2 — from the build draft §7; carried across individually):**
  - `Waiting` pills show no elapsed time — needs a `releasedAt` on the floor payload.
  - Ship-to original→redirect name pair missing on the floor table — needs the original name on the floor feed (the rail already has it).
  - Assigned rows sink to the bottom of the board — **✅ RESOLVED + SHIPPED (`661e4e61`, 2026-07-25):** `byAssigned` excluded from Floor's sort (Floor now uses `FLOOR_SPINE` = spine minus `byAssigned`, `lib/floor/sort.ts`), so Assigned/Done rows hold their place. The residual new/urgent-bill slide above a picker's row is parked separately → **"Floor Control — carry-over + stable positions (opened 2026-07-25)"** below.
  - Rail button reads lowercase "pick slot"; mockup says "Set slot" — copy fix; the picker is Floor's own now (`components/floor/dispatch-slot-picker.tsx`), nothing to fork around. *(Still true 2026-08-05 — the 08-03 suggestion redesign kept shape B's `[pick slot]` label.)*
  - ~~Assign bar reads "Change slot" beside a "pick slot" button~~ — **✅ RESOLVED by the 2026-07-26 action-surfaces redesign**: the duplication collapsed to ONE proper "Change slot" button (`CLAUDE_FLOOR.md §4.6`).
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
  ⚠ **Updated 2026-07-28: there is no longer a Planning screen to build onto.** `/planning`, the
  `/dispatcher` stub and all 8 `/api/planning/*` routes were archived (`639f8139`,
  `archive/2026-07-planning-board/`) — the half-built board this item implicitly assumed is gone.
  That does not kill the item: it means V2 starts from a blank screen rather than an existing one,
  which is arguably cleaner. The archived code is reference for what was tried, never a base to
  restore. Still PARKED.

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
  until the catalog odd-rows above are cleaned. **Status update 2026-08-05: the COLUMNS now exist —
  `sku_master_v2.displayCategory` + `displayName` (live-verified 2026-08-04, both EMPTY, read by
  zero code; CORE §7.1.c).** The feature itself is still not built — no fill, no picking code; the
  "nothing was built" claim below is otherwise intact. Recipe is fully proven and preserved (the
  stored column landed as `displayName`, built from `category` / `product` / `baseColour` with NO
  menu-table join, `emailCase()` not `smartTitleCase`, gentle de-double only, SKU code stays the
  hero and the name is a muted reference line):
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
- [ ] **FIVE in-app depths on the supervisor board ship with no Back affordance** *(was four — the
  fifth was added 2026-08-22, see below)*. They push no history entry, so Android hardware back /
  iOS edge-swipe navigates the *browser* instead of closing them. Same gap class the detail screen
  had pre-Build-A; copy the `/po` single-authority popstate model (`CLAUDE_PLACE_ORDER.md §25`).
  1. route filter sheet
  2. check-picker filter sheet
  3. checked-picker filter sheet
  4. the bulk-bar assign sheet
  5. **the Picking tab's LEVEL 2 — one picker's bill list** *(added 2026-08-22 with the three-level
     Picking tab)*. ⚠ **This one is NOT a sheet, and that is why it matters most of the five.** It
     is a navigation DEPTH: `openPickerId` in `picking-board-mobile.tsx` moves the tab from the
     picker cards to one man's bills, with an on-screen back chevron and no history entry. So a
     hardware back from *two* levels in throws the supervisor clean out of the module — strictly
     worse than the same press from one level in, which is all the four sheets above cost.
     It was built this way ON PURPOSE rather than growing a fifth hand-rolled popstate handler
     beside the detail screen's: that is the exact proliferation this item exists to end. The code
     carries the same note at the `openPickerId` declaration. **When the shared model lands, this
     depth is part of it — do not treat the list above as sheets-only.**

  The nested assign sheet opened *from* the detail screen is already handled — not on this list.
- [ ] **Feel-tuning pending real-device use:** the 0.65× drag-follow and ~260ms slide are subjective
  one-number tweaks if the floor wants faster/stiffer.

### UI (P2)

- **Extract the Direction-A header to a shared component — ✅ SHIPPED 2026-07-29 (`a2fb6889`).** Now
  `components/shared/module-mobile-header.tsx`, extracted **verbatim** from the supervisor board:
  every className, aria-label, tap target, icon size and the safe-area padding byte-identical to the
  inline JSX it replaced. **Contract, props, design rule and adopters now live in `CLAUDE_UI.md
  §59.7`** — the section this closure created; read it there, it is not restated here. The condition
  this item set — *"extract when a second module adopts Direction A, not before"* — was met the same
  day: the picker "My Picks" face adopted Direction A in `ee023b4a` and consumes the shared header
  with `showSearch={false}`. Consumers today are those two picking faces and nothing else; **Tint
  Operator mobile** and **Trip Report mobile** are the named next candidates, and adopting is a
  markup swap rather than a design (§59.7). *(The "big search" half of `CLAUDE_UI.md §59.6`'s
  original deferred bullet was never built and is NOT covered by §59.7 — it stays deferred there.)*

### Code cleanup (P2 — one line)

- [ ] **Stale comment in `prisma/schema.prisma`** above `model sku_master_v2`: it ends
  `// No readers repointed yet — that is a separate session.` — true when `916fcd39` landed, but
  three later commits (`8f606a88`, `a227fb13`, `b91b7381`) repointed every operational reader. A
  future reader taking it at face value would conclude the migration never happened. Fix the line
  next time `schema.prisma` is edited — not worth its own commit.

---

## Post-Support-retirement cleanup (opened 2026-07-27)

Forward items left behind by the retirement (commits `bc42a948` → `62a2928c`). The retirement itself
is done and recorded in `archive/2026-07-support/README.md` — these are the loose ends.

- [ ] **`/orders` — delete it, or gate it (P2).** `app/orders/page.tsx` has **no permission gate**
  (any authenticated role can load it) and its entire body is `redirect("/floor")`. Two commits in
  its whole history: created March 2026, repointed at Floor in `62a2928c`. Because `/floor` is granted
  to admin + operations only, every other role now lands on `/unauthorized` via a route nothing links
  to. Decide: delete the route, or add a `floor` `canView` gate so the failure is honest.
- [ ] **`dispatch_change_queue` — decide whether to drop the table (P2).** Support's edit route was
  its ONLY writer in the entire codebase, and **nothing has ever read it**. Now frozen: no new rows,
  existing rows are history. Dropping a table is a bigger decision than retiring a screen and was
  deliberately not bundled into the retirement. (`CLAUDE_CORE.md §7.4`)
- [ ] **Move the four master-data pages out of their old route group (P3 — cleanup only).**
  Customers / SKUs / Routes / Vehicles sat under the Support route group and were archived with it.
  Their `/admin/*` equivalents are live and a **superset** (`/admin/customers` uses the richer split
  view), so nothing is lost — the `support` role now falls through to those. Low priority; the only
  gain is that no future reader wonders where the Support-group copies went.
  ⚠ **Do not confuse these with the `/dispatcher` four (2026-07-28).** `app/(dispatcher)/` also holds
  Customers / SKUs / Routes / Vehicles pages — **those are LIVE and were deliberately kept** when the
  `/dispatcher` index stub was archived. Same four names, different route group, opposite status.
- [ ] **Dead exports in `lib/workflow-stages.ts` (P3).** `supportMayEdit()`, `isSupportDone()` and
  `stageRank()` now have **zero callers** (`stageRank` is called only by the dead `isSupportDone`).
  The `supportMayEdit` flag on all fourteen `STAGE_LADDER` rows exists only to feed the dead function.
  ⚠ **Do NOT bulk-delete by name:** `SUPPORT_DONE_OUTPUT`, `SUPPORT_DONE_STAGE_NAMES` and
  `SUPPORT_PICKING_QUEUE_STAGE_NAMES` share the prefix and are **load-bearing** across Floor, Picking,
  Import, Tint and two admin backfill tools. (`CLAUDE_PICKING.md §2`)
- [ ] **The `SUPPORT_*` naming in `lib/workflow-stages.ts` (P3).** Four live constants and the
  `pending_support` stage name still say "support" but belong to Floor/Picking/Import/Tint. Renaming
  removes a real trap; it is a wide mechanical change (and `pending_support` would mean rewriting live
  rows), so it needs its own session — or a deliberate decision to leave the names as historical.
- [ ] **Two TI Report page files are unreachable — verify, then delete or restore (P2).**
  `app/(tint)/ti-report/page.tsx` and `app/(tint)/tint/manager/ti-report/page.tsx` both render
  `<TIReportContent />`, but `next.config.mjs` redirects **both** of their addresses to
  `/reports?r=ti-report` before either page can run — so neither has been reachable since the
  Reports hub landed. Confirm in the browser, then either delete the two files (the hub is the
  intended surface) or drop the redirects if direct access was meant to survive. **Do not leave
  both** — a page that cannot render is invisible dead code no link-search will find.
  Found during the step-8 playbook write, 2026-07-27. (`CLAUDE_CORE.md §12`, `next.config.mjs:24-27`)
- [ ] **Five pre-existing unused files (P3 — NOT caused by the retirement).** Verified dead before it
  began (`d08681e9`) and never referenced by Support: `components/shared/role-nav.tsx`,
  `components/shared/sign-out-button.tsx`, `lib/mail-orders/enrich-v2.ts`,
  `lib/picking/validate-assign.ts`, `lib/slot-history.ts`. Confirm and remove in one sweep.
  ⚠ **CONFLICT flagged 2026-08-05:** the reconciliation cycle's survivor list named `lib/slot-history.ts`
  a KEEP-as-live survivor, while this item lists it for removal — and `lib/picking/validate-assign.ts`
  is a documented DELIBERATE dormant keep (`CLAUDE_PICKING.md §7`). Resolve per-file with the owner
  before any sweep; do not delete either on this item's say-so alone.

---

## Floor Control — carry-over + stable positions (opened 2026-07-25)

Two designed-but-unbuilt items from the Floor sort work (commit `661e4e61` — the session that
excluded `byAssigned` from Floor's sort, `CLAUDE_FLOOR.md §3`). Parked with enough spec that a future
session builds without re-deciding anything.

**Shared landmine — respect on BOTH.** Any `orders` write MUST ride the existing single
`orders.update` on that path — never a second update. The live-sync marker keys on
`MAX(orders.updatedAt)`; a second write fires a false "changed" on every open board
(`CLAUDE_FLOOR.md §4` / `CLAUDE_CORE.md §3` / `CLAUDE_PICKING.md §10`).

### P1 — Floor carry-over (LOCAL only) — DESIGNED, NOT BUILT

**The problem.** A local bill left unpicked/unchecked at day's end stays filed under yesterday's dead
dispatch slot (e.g. 16:00 Thursday). Come the new day that slot's vehicle is gone, so the bill should
go on the FIRST van out that morning — not wait for the same slot again. Today nothing moves it; it
sits in the stale slot with only a 1d age badge.

**The decision (LOCKED this session).**
- **LOCAL bills only.** A local bill still unchecked at the nightly roll moves to the FIRST dispatch
  slot of the new day.
- **UP-COUNTRY is explicitly OUT — do not build a roll for it.** Up-country always dispatches at a
  fixed 18:00 (engine rule `R1_UPC_NEXT_1800`), so rolling yesterday's 18:00 to today's 18:00 changes
  nothing on screen. Reason recorded so a future session does not re-add it: there is ALSO no
  per-destination departure timetable in OrbitOMS to roll to — only geography, never a schedule.
- **Preserve the ORIGINAL dispatch slot before overwriting it**, so history shows the truth ("was
  16:00, Thu"). Today only `originalSlotId` exists and that is the ARRIVAL slot, not the dispatch
  slot — confirmed absent.
- **One `order_status_logs` row per roll** (the same log that already records hold/cancel).
- **The 1d / 2d age badge already works** (`floor-table.tsx` `ageDays`) — no change needed there.

**What must be added (from discovery, this session).**
- Two new columns on `orders`:
  - `originalDispatchTargetDate  DateTime? @db.Date`
  - `originalDispatchWindowId    Int?`
  — to preserve the first-assigned dispatch slot.
- A nightly cron: new route `/api/cron/floor-carryover`, one line in `vercel.json`. Runs once per day
  (Vercel Hobby = once daily, UTC only, fires anywhere within the specified hour — `CLAUDE_CORE.md §4`).
  Midnight IST ≈ 18:30 UTC; exact fire time drifts within that hour — acceptable, nobody picks at
  12:30am.
- The roll writes `dispatchTargetDate` + `dispatchWindowId` to the new day's first slot, copies the
  old values into `originalDispatch*` the FIRST time only (never overwrite an already-set original),
  and writes the log row — all folded into the ONE `orders.update` (shared landmine above).

**Build order (separate sessions).**
- **Session B** — add the two columns via Supabase SQL Editor, `npx prisma generate`, backfill
  `originalDispatch*` for bills already on the floor. No UI change.
- **Session C** — build the cron route + `vercel.json` line; test by MANUAL trigger BEFORE letting it
  run on a schedule.
- **Session D** — watch the real board for a few mornings: confirm leftover local bills land in the
  first slot, the original slot survived, history reads right.

### P2 — Floor frozen row number — DEFERRED (answer the open question from real use first)

**The issue.** After this session's sort fix, rows no longer jump on assign/done. But a row already in
a picker's hands can still be pushed DOWN a number when a NEW or MARK-URGENT bill sorts in above it
(seen live: MAHALAXMI marked urgent pushed Swami Colour Co from #6 to #7 while Sunil was picking it).
The desk operator walks the list top to bottom, so work re-appearing above where he has already
scanned is the concern.

**Why deferred (not broken).** The constant shuffle — on every assign and every done — is fixed and
shipped (`661e4e61`). What remains is a rare, deliberate, operator-initiated slide. Not worth building
blind; real floor use will show whether it matters, and will answer the open question below.

**The fix if built.** Freeze a row's position the moment a picker is assigned: stamp its current
number into a new nullable column (e.g. `orders.floorSequence Int?`), held across assign/done/check,
cleared on unassign/hold/cancel. New and urgent bills then shuffle only among WAITING rows, filling
leftover positions — never above a picker's row. Confirmed this needs a NEW column: `sequenceOrder`
(tint queue) and `pick_assignments.sequence` (only exists after assign) cannot be reused. Same single-
`orders.update` landmine applies.

**Open question to answer FIRST (from real use).** When a bill is DONE and CHECKED, does it KEEP its
frozen number, or RELEASE it back so waiting bills can use that position? Cannot be answered from a
screenshot — needs a few days watching a real end-of-day board. Answer this before building.

---

## Billing v2 (opened 2026-08-04, from `CLAUDE_MAIL_ORDERS.md §23.5`)

Pilot is flag-gated (`billingV2`, `TEST_USERS_ONLY`, operations id 20 only). Ordered:

- **P1 — Data-audit + plumbing session, THEN widen rollout.** Verify the dual-write lands end-to-end
  (orders → Floor; Floor → Picking), the known billing-face Picking data issue, then flip
  `billing_settings.rolloutStage` → `ALL_USERS` (must reach Deepanshu 25 + Bankim 26). Smart Flow
  wants this as its own session.
- **P1 — Clear the test-marked "done" bills** created during the pilot before real rollout (22 rows
  carried `invoicedAt` as of 2026-08-04 — re-SELECT).
- **P1 — Ship-to option-(a) ungating** — billing face reads master data, Table view reads the
  keyword cache; ungate the FK fix for everyone AFTER a legacy id/text agreement SELECT.
- **P2 — Global rename Mail Orders → Billing** (currently billing-face only).
- **P2 — Table-view retirement** — per `archive/RETIREMENT-PLAYBOOK.md`, its own careful session;
  currently hide-only, code intact for non-billing users.
- **P2 — `billingV2` flag cleanup at full rollout** — collapse the `billingV2 ?` forks, delete the
  OFF paths, retire the orphaned `billing-order-info.tsx`.
- **P2 — Violet "Already invoiced" info-row UI polish** (deferred by Smart Flow 2026-08-02).
- **OPEN QUESTION — notes plumbing:** `mo_orders.notes` has no enrichment carry line and Floor reads
  no `orders.remarks`; whether billing notes should reach Floor is a product decision
  (`CLAUDE_MAIL_ORDERS.md §23.5`).

---

## Floor Control — slot-suggestion follow-ups (opened 2026-08-03, tracked 2026-08-05)

From the shipped suggestion layer (`CLAUDE_FLOOR.md §8`); counts are AS OF 2026-08-03 — **re-SELECT
before acting on any of them**:

- **P1 — Backfill decision.** 73 auto-slotted rows sit in a window the corrected clock rule would
  change (63 window-only, **8 date-moves — think hard before moving bills across days**, 2 now
  declining); separately **85 unmatched bills have no slot at all**. Step B is forward-only — neither
  set drains on its own. Any backfill must skip `dispatchSlotSource='manual'`.
- **P1 — `arrivalSlotId` Morning defect** — same fake-clock root cause, different field, still
  unfixed: `resolveArrivalSlotId` has no time guard, so every manual-SAP bill buckets to Morning
  (`CLAUDE_IMPORT.md §12` / landmines).
- **P2 — `dispatchSlotRuleId` clear-on-manual** — one-line fix: Floor's change-slot writes
  date+window+`source:'manual'` but leaves the engine's rule id (6 contradicting rows as of 08-03).
- **P2 — Auto-confirm for HIGH-confidence suggestions** — deliberately deferred until v1 has been
  used on the rail.
- **P2 — Tint split-OBD suggestions** — out of v1 scope (full-OBD only today).
- **P2 — `card.tint.completedAt` IST render** — it is an ISO UTC string on the payload; convert at
  render when something finally displays it.
- **P2 — Mixed-slot amber warning** on the assign bar ("these 3 bills are not all on one slot") —
  dropped from the 2026-07-26 redesign as needing new data threading; revisit on demand.

---

## Floor Control — inherited Support-board gaps (verified still real 2026-08-05)

From the 2026-07-27 parity discovery (G-list), each re-checked against today's Floor before listing —
the resolved ones (tint pre-set G2, carry-over G5-old, priority G17, resolver G7 = tracked above) are
NOT repeated:

- **P1 — No undo of a release (G1).** Floor's action set is mark-urgent / change-slot / hold /
  cancel / restore — nothing pulls a released bill back to the rail; the workaround (Cancel→Restore)
  lies in the audit trail. Support's old write shows the shape.
- **P1 — No bulk release/hold from the rail (G3).** The rail has no checkboxes; a 40-bill morning is
  40 individual slot picks. Floor's release route already accepts a list.
- **P2 — Cancel records no reason (G4).** `/api/floor/actions` accepts a `reason`; the UI never
  sends one — every cancellation logs "Cancelled from floor". Support had a six-reason dialog.
- **P2 — Cancelled tab is today-only (G5)** — yesterday's cancellation can never be un-cancelled
  from Floor (`CLAUDE_FLOOR.md §3`).
- **P2 — No CSV export of the day's board (G6)** — only the Hold-report PDF exists.
- **DECIDE — arrival-slot view + day-progress tiles (G8).** Does the depot still think in
  Morning/Afternoon arrival slots and "% done today"? If no, close as a deliberate drop; if yes,
  Floor needs an arrival view.
- **DIAGNOSE — contradictory-state bills (G9).** `pending_support` WITH `dispatchStatus='dispatch'`
  matches NEITHER Floor feed (rail wants status null; board wants a later stage) — the mirror image
  of the 103-NULL parked issue. Run the count; fold into that diagnosis session.

---

## Picking — measurement + follow-up queries (opened 2026-08-04)

- **P2 — articleTag / manual-SAP correlation query** — 17% of the live queue had null `articleTag`
  (2026-07-17 sample); every null-tag sample also had `sapStatus: null`. The dedicated follow-up
  query was never run; Auto-Import being LIVE (not paused) strengthens the manual-SAP hypothesis
  (`CLAUDE_PICKING.md §7`).
- **P2 — Real pick durations** — the 30m/60m elapsed thresholds are still a guess; the 2026-07-29
  test plan asked the floor to time 3-4 real picks and no numbers came back.
- **P1 — Bring the two picking PHONE boards onto the SOFT duplicate-SO treatment** (opened
  2026-08-25). Floor moved its three surfaces (`floor-table.tsx`, `rail-card.tsx`,
  `detail-panel.tsx`) from the solid red fill to the soft treatment — a `#fef2f2` ground with a
  3px `#ef4444` inset left bar, all text and badges at their ordinary tokens, and the tag reading
  **"SAME"**. **`components/picking/picking-board-mobile.tsx`, `picker-my-picks-board.tsx`,
  `card-atoms.tsx` and `bill-symbols.tsx` were deliberately left on the SOLID fill**, so today a
  Same-SO bill looks like one thing on the phone and another on the desk. That is a known,
  accepted split, not a miss: restyling those files is a PICKING change and needs this module's
  sign-off (`CLAUDE_FLOOR.md §1` — Floor reuses Picking as a CALLER and does not modify it).
  ⚠ **THE MECHANISM ALREADY EXISTS — do not rebuild it.** `components/shared/duplicate-so-tag.tsx`
  now owns BOTH treatments: the original `DUP_SO_*` tokens (untouched, still what Picking reads)
  and a parallel `DUP_SO_SOFT_*` set, with a `variant?: "solid" | "soft"` prop on `DuplicateSoTag`
  that DEFAULTS to `"solid"`. Bringing a picking board across is: pass `variant="soft"`, swap its
  fill/border tokens for the soft pair, and delete the white-on-red flips (`DUP_SO_BADGE_CLASS`
  and friends) that only existed so badges would not vanish into the fill — the soft variant needs
  none of them. Note the label change too: "Same SO" → "SAME", one word, because the second word
  was clipping the floor table's 14% OBD track; the phone cards have more room, so decide there
  whether they keep the longer wording or match.

---

## Ops scripts — owner decisions (opened 2026-08-05)

- **The undocumented Frt/Breakwalls pipeline:** `docs/Powershell/0-FrtIngestion.ps1` (watches Outlook
  for the daily Frt Report email) + `3-PendingFetch.ps1` + `4-LogisticsEntry.ps1` (Breakwalls batch
  import) — untracked, in NO canonical file, surfaced by the 2026-08-04 reconciliation. Decide:
  document (whose module?), track in git, or remove.
- **`web-update-2026-07-14-po-save-draft-sent-feature.md` locate-or-reauthor** — already tracked
  under "Consolidation follow-ups (2026-07-16) → Place Order"; repeated here only as the standing
  blocker for documenting `/po` Drafts/Sent.

---

## Mail Orders cleanup (opened 2026-09-01, from the write-route permission fix)

Left over from `mail-orders: gate 11 write routes on mail_orders/canEdit` — the guards shipped; these
three did not. Evidence for all three: `docs/prompts/drafts/code-discovery-2026-09-01-mail-orders-gate.md`.

- **[P3] `[id]/punch` is a route with no button — wire it or remove it.** Its `onPunch` prop is
  threaded four component levels (`mail-orders-page.tsx:1465` → `mail-orders-table.tsx:49 → :118 →
  :219 → :258 → :286 → :331 → :629`) and **never invoked** — `grep "onPunch("` returns nothing.
  Punching actually happens through `[id]/so-number` PATCH, which sets `status: "punched"`,
  `punchedAt` and `punchedById` itself (`so-number/route.ts:43-51`). The route is gated and live but
  unreachable from the UI. Decide: wire the button back, or retire the route per
  `archive/RETIREMENT-PLAYBOOK.md`. ⚠ Do not assume it is dead data — it is a live *address*.
- **[P2] A 403 is silent on four of the eleven — no toast, console only.** `note`
  (`review-view.tsx:936`), `split` (`mail-orders-table.tsx:1527`, `review-view.tsx:956`),
  `lines/[lineId]/status`, and `learn-customer` (`lib/mail-orders/api.ts:145-147`, which swallows
  every error by design) all fail into `console.error` with nothing on screen; the four handlers in
  `mail-orders-page.tsx` refetch and visibly revert the optimistic row, also with no message.
  **This became a real gap on 2026-09-01** — before the fix these routes could not return 403, so a
  denial was not a reachable state. Nobody is affected today (all six canView holders also hold
  canEdit), but the symptom of any future narrowed grant is "the button does nothing". Add error
  surfacing.
- **[P3] `backfill-enrich` and `backfill-customers` — confirm not needed, then retire both.** Zero
  callers each; neither is reachable from any button. `backfill-customers` (POST, session+canEdit) is
  a finished one-time job kept "for emergency" per `CORE §13`. `backfill-enrich` is worse: its GET is
  now admin-gated (2026-09-01) but it still runs the **v1** enrichment, six args, no
  `productProfiles` — `CONTEXT_v56.md:113-116` says by name *"Do NOT use it for re-enrichment"*, and
  live enrichment is v3. Both still carry `TEMPORARY`/one-time labels. `re-enrich` is the maintained
  tool and **stays** — it has no UI by design. Retire the two per the playbook.

---

## CI — Goods Return Note (opened 2026-09-03, from the module inventory)

Canon: **`docs/CLAUDE_CI.md` v1.0**. The module went from first table to register
export in four days and nineteen commits (`e8695f40` 2026-08-31 → `3b0d04b7`
2026-09-03). Everything below is what it deliberately does NOT do yet.

### Shipped 2026-08-31 → 2026-09-03
- Three tables + five CHECK constraints + the 8-row depot-editable reason master.
- Supervisor's phone face (New + Submitted), billing's desk rail + pane, twelve API routes.
- Auto-CI from a confirmed picking finding on an invoiced bill (`618f67fc`).
- The division number on both detail screens, every bill (`bf3e59bf`).
- The 17-column register export as .xlsx (`3b0d04b7`).

### P1 — `/ci` into `PAGE_NAV_MAP`
The module is reachable **by URL only**. `ci` is in the `PageKey` union and
`ALL_PAGE_KEYS` but not in the nav map, and adding the row is not the whole fix:
`MobileShell`'s phone Home target is `navItems[0]?.href`, so an entry at index ≤ 2
steals `floor_supervisor`'s Home button from `/picking`. A correct fix must (a)
land at an index that leaves `navItems[0]` as `/picking` for that role **after**
`buildNavItems` has filtered by permission — the map index is not the built-list
index; (b) be verified on a real phone for `floor_supervisor`, not only for admin,
whose nav is longer and orders differently; (c) still surface for the desk roles.
Detail: `CLAUDE_CI.md §13 CI-16`.

### P1 — Abandoned-draft sweep
**17 drafts against 14 real CIs** (live, 2026-09-03) — more abandoned drafts than
returns. Harmless today: every feed filters `status <> 'draft'`, and a draft with
zero lines can never be submitted. But it grows, and nothing prunes it. Needs an
owner ruling on the age cut before anything is written, and it must never touch a
draft that has lines and a live editor on it.

### P1 — The old-MFG arm of the auto rule is PROVISIONAL
Owner ruling 2026-09-03: a confirmed `old_mfg` finding raises a CI for the whole
line even at a full count (nothing is short, but the stock is held, so it comes
back). **Raise now, review after testing.** ⚠ There is deliberately NO feature
flag — a switch built for a decision nobody has made is a second code path
forever. This item is the review, not a toggle. `CLAUDE_CI.md §9`.

### P1 — SAP reason codes (register column J)
Billing's Excel carries a 32-item SAP reason dropdown OrbitOMS does not hold. It
is a **separate field** from `ci_reason_master`, whose 8 plain-English labels
populate column K (REMARK); column J exports blank. If implemented it is a second
master table (`ci_sap_reason_master`) plus one column on `ci_returns` — **never** a
widening of `ci_reason_master`, which the depot edits and which feeds the other
column.

🔴 **The strings below are SAP's, copied verbatim. "cusomer", "Trasfer",
"Spornsorship" and "Eevent" are how the dropdown reads, and the inconsistent
spacing and casing around the hyphens is theirs too. A corrected spelling will not
match SAP.**

```
101-FI Master Data
102-FI Pricing
103-FI Incorrect Fees
201-QA Product
202-QA Pack
203-QA Label
204-QA Re call
205-QA Mixing/Tinting
301-LO Product/Qty error
302-LO Delivery fail
303-LO Damaged goods
304-LO Docs/Labels error
305-LO Shelf life error
401-EX Wrong order entry
402-EX Wrong advice
403-Ex Mkt & oth Service
404 - Ex PreDel No skt Now
501 - Co Right of Return
502 - Co Dry Docking
503 - Co Pos Material
504 - Co sample
505 - Co Promotions
506 - Co Customer SLOBS
507 - Co cusomer Error
508 - Co Exp Product
509 - Co Asmt Chg - Restyle
510 - Co Customer Terminate
511 - Co Trasfer Stock
512 - Co Donations
513 -  Co Spornsorship
514 - Co Eevent Trainning
515 - Co Service Provided
```

Count: **32**.

### P2 — The four register columns with no source
`L Mtrl in Depo Y/N`, `M MATERIAL STATUS`, `Q remark2` have no source in this
schema at all and would need new columns and new form fields. `J REASON` is the
SAP list above.

⚠ **`I NON TINTED` is NOT on that list. It is blank by RULING, not by absence** —
it is a one-line rollup over `import_raw_line_items.isTinting`, and the owner ruled
it stays blank in v1 (2026-09-03). Whoever "discovers" `isTinting` has not found a
gap.

### P2 — A4 print sheet for a CI
MRN has one (`app/mrn/[mrnId]/sheet/page.tsx`); CI does not. The route comments
already anticipate it ("the eventual print sheet"), and `lib/ci/derive.ts` exists
partly so a sheet and the screens cannot disagree about totals.

### P2 — `returned_to_floor` has no UI
In `chk_ci_returns_status` and in the `CiStatus` union since day one, **written by
nothing**. The question it stands in for was answered the other way (billing tells
the floor; he fixes it himself). Keeping the value costs nothing; ALTERing a live
CHECK later does not.

### P2 — The void path has never run in production
Zero voided rows. The columns, the allocator's deliberate `isVoided` exception
(`CLAUDE_CI.md §13 CI-3`) and the read filters all exist; no UI writes them. First
real void will exercise code nothing has exercised.

### P2 — A frozen auto-CI is reconciled by hand only
When billing has already closed an auto CI and a later confirm changes the due
lines, `lib/ci/auto.ts` refuses to touch it and logs `console.error`. That log **is
the entire alerting mechanism** — someone must read a Vercel log to know. No
surface shows it.

### P2 — A second register for CIs above ₹10,000?
The sheet is named `CI DATA BELOW 10000RS` and the export applies **no value
filter** (owner ruling: every closed CI in the range, whatever it is worth).
Whether a second register exists upstream is unanswered. If it does, the answer is
one clause in `getCiRegisterRows` — do not guess a threshold and do not build a
split.

### P2 — Register cell types G / H / P
`CI Qty` (litres), `CI Order value ` and `DIV` are written as **numbers**; the
original spec named only dealer code and CI Order no as numeric. Revisit if
billing's macro turns out to want text. One line in `buildCiRegisterWorkbook`.

### P2 — `ci_return_lines` has zero CHECK constraints
Nothing at the database level enforces `returnedQty >= 1`; the rule lives in
application code in two places (`PUT /lines` 400s, `lib/ci/auto.ts` skips). Fine
today — worth a CHECK if a third writer ever appears.

### P2 — Only 4 of the 8 reasons have ever been used
Live: Physically Cross 7 · Wrong Order by S.O. 3 · Return by Dealer 3 · Order
Cancel by Dealer 1. Double Order, Wrong Punching, Re Bill and Complaint Material
have never been chosen. Worth asking the depot whether they earn their place
before the SAP list lands beside them.

---

## Documentation hygiene

### Schema docs consolidation cadence
Every 2-3 weeks: consolidate `docs/prompts/drafts/` into canonical files using the consolidation prompt. Archive consumed drafts to `docs/prompts/archive/YYYY-MM/`.

Last cycle: **2026-08-04/05 — the full reconciliation cycle** (method v1.1, 12 canonical files verified claim-by-claim against code + live DB + git; 11 drafts archived to `docs/prompts/archive/2026-08/`; this status pass is its final step before 12b's router/CORE finish). Prior cycles: 2026-06-18 (29 drafts), 2026-06-02.

### `taxonomy-preview.json` path

Lives at `docs/prompts/archive/drafts/2026-04-to-05/taxonomy-preview.json`. The seed reads from this path — DO NOT move it without updating the seed.

---

## Change log — status pass 2026-08-05 (reconciliation cycle, method v1.1)

Every existing item verified against the reconciled canon (CORE v91 · UI v5.17 · IMPORT v1.7 · MAIL_ORDERS v1.11 · FLOOR v1.4 · PICKING v1.12 · TINT v1.9 · PLACE_ORDER v1.8 · NOTIFICATIONS v1.2 · ATTENDANCE v1.3 · TRIP v1.1 · SAMPLING v1.6), code, and git. Nothing deleted silently — moot/shipped items keep a struck-through record in place.

- **SHIPPED/DONE marked:** rail slot suggestion (2026-08-03) · desktop isPrimary filter (`46b500fb`) · parser v7.2 go-live (2026-07-15) · assign-bar label duplication (2026-07-26) · challan lazy-creation verification (2026-08-04) · `scripts/_*` tsconfig exclusion · the two-routers question (2026-07-19).
- **MOOT:** the entire Auto-Import un-pause block (LIVE since 2026-06-20; the orphan-policy survivor stays OPEN and live-relevant).
- **STALE WORDING rewritten:** Vercel-Pro premise (cadence, not count) · trip_report field-meanings (10 remain, TRIP §3 lists all 38) · friendly-name recipe (the columns now EXIST, inert) · app-format line-loss bug (status-unclear, re-test) · push-verify blocker (test accounts exist) · parser-copy tracked/version note · sampling merge count (as-of stamp).
- **NEW sections:** Billing v2 (8 items) · Floor slot-suggestion follow-ups (7, counts as-of 08-03) · Floor inherited Support-board gaps (G1/G3/G4/G5/G6 verified still real + G8 decide + G9 diagnose) · Picking measurement queries (2) · Ops scripts owner decisions (Frt/Breakwalls).
- **CONFLICT flagged:** `lib/slot-history.ts` — survivor-list KEEP vs the five-unused-files removal item; per-file owner decision required.
- Footer's stale "Schema v27.6" stamp removed — ROADMAP tracks work, not schema; the counter lives in `CLAUDE_CORE.md §7` (v27.12 + unnumbered 2026-07-3x additions; **v27.13 minting pending — 12b**).

---

*Updated 2026-08-09 — **articleTag rule shipped** (`9de0c55b`): the pack rule moved off the depot PC into `lib/article-tag.ts`, catalog-first; ZINR roadmap item superseded, two new Import items opened (backfill of 138 wrongly-tagged + ~19,200 null lines · a `containerType` column for the Drum-vs-Bag blind spot) — detail in `CLAUDE_IMPORT.md §8.2`. Picking **Stage 3 closed**: floor findings shipped (`cd27c976`→`0df656ef`), Billing flag + detail panel with them; the picker's third "Combined" tab (`1ad903ef`/`733fcd6b`) documented at the same time. Prior: 2026-08-05 (full status pass — see change log above); 2026-07-30 — picker "My Picks" face rebuilt on the shared shell (`a2fb6889`→`28986d0a`) + canon pass; 2026-07-28 — Picking DESKTOP board retired; 2026-06-19 — full catalog restructure, `/po` build, Hide feature, Tint Summary, parser v7.2 + Table C. Schema counter: `CLAUDE_CORE.md §7` (not tracked here).*
