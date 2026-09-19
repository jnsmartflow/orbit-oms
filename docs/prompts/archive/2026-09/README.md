# docs/prompts/archive/2026-09/

Drafts consumed by the 2026-09-18/19 canon sweep. They are filed here for audit only: **the canonical files are the authority**, and where a draft and canon disagree, canon (reconciled to the code) wins. Classification and commit proof come from `docs/prompts/drafts/code-discovery-2026-09-18-canon-sweep.md §6`.

Still in `docs/prompts/drafts/` on purpose: the sweep's own record (the report, the live-check SQL and its results CSV); two OPEN discoveries (enriched-line gap, urgent-red migration); three REFERENCE discoveries (pick-grouping evidence, no-slot backlog, /po2 presentation source); the four CSVs; the two MRN SQL files; the dup-SO mockup.

Filed 2026-09-19. 31 were moved with `git mv` (history kept). 29 had never been committed, so they were moved as plain files and enter git for the first time here.

## code-update (21)

| Draft | What it was | Shipped in | Absorbed by |
|---|---|---|---|
| code-update-2026-08-11-tint-operator-history.md | History face on /tint/operator | dfd9b669, b2e7c78a, 5ce8d8ec | CLAUDE_TINT §3.13 |
| code-update-2026-08-17-floor-pick-grouping.md | Floor "By group" view, rule 1 exact-SKU bundling | 3e989cb5 (Floor UI later retired, engine → 3fdd0e13) | CLAUDE_PICKING §5.5 |
| code-update-2026-08-18-floor-oil-grouping.md | Rule 2 same-family (oil paint) bundling | 3fadb0c7, 3fdd0e13 | CLAUDE_PICKING §5.5 |
| code-update-2026-08-18-picking-grouping.md | Pick bundles on the supervisor Assign tab | 467c2afe | CLAUDE_PICKING §5.5 |
| code-update-2026-08-20-duplicate-so-highlight_1.md | Solid-red duplicate-SO flag (Picking + Floor) | 4f21b7da, 57cd274d, 2c54bdfb | CLAUDE_PICKING §5, CLAUDE_UI |
| code-update-2026-08-25-floor-board-render-and-dup-so.md | All-done strip, empty-slot state, ship-to pair, soft dup-SO | 07bc5104, 37a3a1f2, bc232f72 (board parts later retired) | CLAUDE_FLOOR §4.9 |
| code-update-2026-08-25-floor-history-checked-arm.md | Floor History matches checkedAt on the viewed day | 07bc5104 | CLAUDE_FLOOR §3 |
| code-update-2026-08-25-floor-history-detail-panel.md | History rows open a read-only detail panel | e9fcd612 | CLAUDE_FLOOR §4.7 |
| code-update-2026-08-31-floor-invoice-column.md | Invoice column on the floor table | 697b193b | CLAUDE_FLOOR §4.9 |
| code-update-2026-08-31-picking-sap-name-fallback.md | Picking card falls back to the SAP dealer name | 47791643, 67393fd2 | CLAUDE_PICKING §5, CLAUDE_NOTIFICATIONS §2 |
| code-update-2026-09-04-user-based-access.md | Per-user ticks replace job titles; superuser flag | c3cf726b → b915c88e | CLAUDE_CORE §5, §7.14, §7.15 |
| code-update-2026-09-06-admin-shell-redesign.md | Admin sidebar 20 items / 5 groups, app switcher | 44125138, 0fc145bb, 8d7a3bef, 95b24352 | CLAUDE_UI §64 |
| code-update-2026-09-06-tint-and-master-data.md | Tint + master-data routes gate on ticks | cd0ed055 → fbbe30bd | CLAUDE_TINT §13, CLAUDE_CORE §5 |
| code-update-2026-09-06-tint-base-no-tint.md | "Base — No Tint" bypass + Tinter Issue pending list | c9ef1c31 → e12ce9e9 | CLAUDE_TINT §1.12 |
| code-update-2026-09-08-floor-tint-lock.md | Floor Hold/Cancel locked while a tint job is open | 56db79b8, 4af18cc8 (card half retired with the rail) | CLAUDE_FLOOR §4 |
| code-update-2026-09-08-po-v2-board.md | /po-v2-8f4kd2 board, drawer, Drafts/Sent | d054a028 → 3c713282 (superseded by the /po2 launch) | CLAUDE_PO2 |
| code-update-2026-09-09-picking-visibility-gate.md | Floor holds waiting bills back from the Assign tab | 5fce9f31 → da80d657 (per-bill mechanism retired by 791a2cd6) | CLAUDE_FLOOR_TRIPS, CLAUDE_PICKING §4 |
| code-update-2026-09-10-po2-polish-and-launch.md | /po2 goes live: favourites, art, overlays | 145b5f32, a988ab41, 8954014a | CLAUDE_PO2 |
| code-update-2026-09-10-trip-desk.md | Trip desk replaces the floor board; trips/trip_drops | aead3c32 → 7a66ac3e (then reworked in slices 1–10) | CLAUDE_FLOOR_TRIPS, CLAUDE_FLOOR §2, CLAUDE_CORE §7.16 |
| code-update-2026-09-14-sap-paste-import.md | Paste the SAP OBD list from the clipboard | 37ceb57a, c8528fa8 | CLAUDE_IMPORT §3.4 |
| code-update-2026-09-18-picking-colour-work.md | colourWork TINT/BASE word + read-only Tinting section | ba03fc89, 0841b5c9, 2bcb47e9, aeed851c, e2446c70 | CLAUDE_PICKING §5.6 |

## web-update (10)

| Draft | What it was | Shipped in | Absorbed by |
|---|---|---|---|
| web-update-2026-08-12-machine-naming.md | Split "depot PC" into dev laptop vs server PC | **NOT implemented.** Filed as a record; the wording change is an owner decision (16 "depot PC" hits remain in canon, none factually wrong) | — |
| web-update-2026-08-20-mrn-module-design.md | MRN module design | 644dce96 → 554a3213 | CLAUDE_MRN |
| web-update-2026-08-28-admin-redesign.md | Admin panel redesign (13 decisions) | PARTIAL: 0fc145bb, 8d7a3bef, 6c76c56a; leftovers in ROADMAP | CLAUDE_UI §64, ROADMAP |
| web-update-2026-08-31-ci-module.md | CI Goods Return Note spec | e8695f40 → 3b0d04b7 | CLAUDE_CI |
| web-update-2026-08-31-mrn-photos-otr.md | MRN photos + OTR close | b6d84b3d → fedf0563 | CLAUDE_MRN |
| web-update-2026-08-31-user-based-access-plan.md | Plan: per-user ticks replace roles | via code-update-2026-09-04 | CLAUDE_CORE §5 |
| web-update-2026-09-06-orbit-colour-spec-v2.md | Colour system v2 (violet brand, tint → sky) | 3eed60e8 → 2542f998 | CLAUDE_UI §2 |
| web-update-2026-09-06-orbit-rebrand.md | Rebrand to Orbit (name, wordmark, tagline) | 8fac2a67, 3564f083, de7453bb, 6dd818c1 (colour section superseded by spec v2) | CLAUDE_UI §2.3 |
| web-update-2026-09-09-floor-trip-module.md | Floor becomes a trip board: decision record | aead3c32 → 7a66ac3e, since diverged | CLAUDE_FLOOR_TRIPS |
| web-update-2026-09-09-trip-schema.md | Trip module DDL proposal (its header says "NOT RUN"; it was applied) | aead3c32 | CLAUDE_CORE §7 v27.29, CLAUDE_FLOOR_TRIPS |

## code-discovery: consumed (23) and superseded (3)

| Draft | What it was | Shipped / status | Absorbed by |
|---|---|---|---|
| code-discovery-2026-08-06-floor-order-time-source.md | Floor shows email time, not SAP punch time | 2c71fa0b, 8a4c1973, a9966e5d | CLAUDE_FLOOR §4.9 |
| code-discovery-2026-08-15-import-overlap-baseline.md | Batch SKU overlap too thin to group | **SUPERSEDED** by the overlap-window ladder | — (do not quote its verdict) |
| code-discovery-2026-08-15-overlap-window-ladder.md | Half-day containment: grouping IS worth building | 3e989cb5, 3fadb0c7, 3fdd0e13, 467c2afe | CLAUDE_PICKING §5.5 |
| code-discovery-2026-08-18-tint-manager-floor-parity.md | TM vs Floor parity audit | **SUPERSEDED** by the code: 9dcc3d96, bbb9628c | — |
| code-discovery-2026-08-21-picking-board-v2.md | Five supervisor-board changes | f7c8d232, ffbe85e2, 663c538f, adcc212d, 05d4ca21 | CLAUDE_PICKING §5.2 |
| code-discovery-2026-08-28-admin-panel.md | 31 admin pages audited | 44125138, 0fc145bb, 8d7a3bef | CLAUDE_UI §64, ROADMAP (dead tables) |
| code-discovery-2026-08-30-permission-actions.md | Which permission flags are actually read | 0f56eede, 74c51869 | CLAUDE_CORE §5, ROADMAP |
| code-discovery-2026-08-31-ci-module-readiness.md | CI module step 0 | e8695f40, fb87bbae, 55c3cdc6 | CLAUDE_CI |
| code-discovery-2026-08-31-role-census.md | 422 role-reading sites | 6c76c56a, 2f461f93, b493f87c, 0af680e4 | CLAUDE_CORE §7.14, ROADMAP (RoleSidebarRole) |
| code-discovery-2026-09-01-mail-orders-gate.md | Gating 11 MO write routes blocks nobody (header 09-01, committed 08-30) | 0f56eede, 158f64b2 | CLAUDE_MAIL_ORDERS §18, §22 |
| code-discovery-2026-09-06-admin-shell-state.md | Admin nav state before the rebuild | 44125138, 0fc145bb, 8d7a3bef, 95b24352 | CLAUDE_UI §64 |
| code-discovery-2026-09-06-colour-inventory.md | Teal stocktake | 3eed60e8, 5daa58fc, c96157ea, b585240f | CLAUDE_UI §2 |
| code-discovery-2026-09-06-master-data-gate.md | Master-data role arrays | d3211766, 65fd0e10, 2b25a48f | CLAUDE_CORE §5 |
| code-discovery-2026-09-06-tint-conversion-gate.md | Tint routes move to ticks | cd0ed055, 64f897a9, 74c51869, fbbe30bd | CLAUDE_TINT §13 |
| code-discovery-2026-09-08-import-qty-integrity.md | SAP batch sub-item qty, header drift, empty payload | 25fc3c99, a290c116, 9188699a, a11bf7ee, eb34532c, d8fcf1ed (Defect B still open) | CLAUDE_IMPORT §8, §8.3, §15 |
| code-discovery-2026-09-08-trip-mirror.md | Puller path, fetchedAt readers | 88bf9926, aa525bd4 | CLAUDE_TRIP_REPORT |
| code-discovery-2026-09-09-floor-trips.md | Floor dates, stages, drops, masters for trips | aead3c32, cd6be71a, 04f4c97b, bbb9628c, f41b52c9 | CLAUDE_FLOOR_TRIPS |
| code-discovery-2026-09-10-dates-weight-orphans.md | Date rule, per-bill KG, orphaned components | e656ad80, 828b59ca, 79bcc412, cdbf95b1, f41b52c9 | CLAUDE_FLOOR §4.9, §10b |
| code-discovery-2026-09-11-pending-support.md | 711 bills/month stuck without a mail order | b3dfe5b8 | CLAUDE_IMPORT §2.1 |
| code-discovery-2026-09-11-billing-action-ticks.md | Hold/slot/urgent/ship-to as per-user ticks | c73ee93b, a991a1c4 | CLAUDE_BILLING §5 |
| code-discovery-2026-09-11-billing-shell-picking-key.md | billing_picking key + a consolidated desk shell | 38b545df, 9bc027a9 (the shell half was never built) | CLAUDE_BILLING §6 |
| code-discovery-2026-09-11-hide-scope-access.md | Hide switches scoped to everyone/role/user | fb2f3853, abd495f4 | CLAUDE_MAIL_ORDERS §21, CLAUDE_CORE §7.10 |
| code-discovery-2026-09-11-hide-tags.md | Missing MO hide tags (old face) | **SUPERSEDED** by hide-tags-billing | — |
| code-discovery-2026-09-11-hide-tags-billing.md | Hide tags on the Billing face | abd495f4, f1dcfa58 | CLAUDE_MAIL_ORDERS §21 |
| code-discovery-2026-09-14-mail-orders-desktop-presentation-source.md | Billing desk source for the client deck (contains real staff names and inbox addresses) | bf499a94, 77f857cd | docs/presentation only |
| code-discovery-2026-09-16-filters-and-import.md | Filter chips follow tag switches; import_obd tick only | f1dcfa58, 792efc52 | CLAUDE_MAIL_ORDERS §21, CLAUDE_IMPORT §9 |

## code-resume (1) and raw script output (2)

| Draft | What it was | Shipped / status | Absorbed by |
|---|---|---|---|
| code-resume-2026-09-08-trip-mirror-rewrite.md | Trip mirror hash-gated upsert, Phase A + Phase B | Phase A 88bf9926; **Phase B open** (puller host unknown) | CLAUDE_TRIP_REPORT, ROADMAP |
| _ladder-raw-sections.md | Raw ladder tables for the window-ladder draft | written by `scripts/analysis/import-overlap-baseline.ts` | — (regenerable) |
| _overlap-raw-sections.md | Raw baseline tables (6,375-bill re-run) | written by `scripts/analysis/import-overlap-baseline.ts` | — (regenerable) |

Note: `scripts/analysis/import-overlap-baseline.ts` still writes its raw output into `docs/prompts/drafts/`. A re-run will create fresh `_*.md` files there. That is expected; file them here again afterwards.
