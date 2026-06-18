# Context Update — Tint Summary report + Reports hub
Session date: 2026-06-17
Target files: CLAUDE_TINT.md (new report), CLAUDE_UI.md (Reports hub + boards + print), CLAUDE_CORE.md (new screen, API, permissions, redirect)

## SCHEMA CHANGES
None. (Read-only report; no DB writes, no migrations.)

## NEW/MODIFIED FILES
| File | Purpose |
|---|---|
| `lib/reports/tint-summary-data.ts` | `getTintSummaryData(params)` — single source of truth for all report data; used by both API route and the page |
| `app/api/reports/tint-summary/route.ts` | JSON API; thin wrapper over the lib |
| `components/reports/tint-summary-document.tsx` | 4-page A4 report document, fully prop-driven; accepts `hiddenSections[]` |
| `app/reports/tint-summary/page.tsx` | Live report + print route (`?date`, `?print=1`, + filters + `hide`) |
| `components/reports/print-button.tsx` | Print / Save-PDF button (hidden in print output) |
| `app/reports/page.tsx` | Reports hub (Option C: rail + live preview + Customise) |
| `components/reports/reports-top-bar.tsx` | Date control + Generate PDF (teal CTA) + Customise trigger |
| `components/reports/customise-drawer.tsx` | Builder controls: section toggles, operators, Hold, SMU, Area, trend |
| `components/reports/report-params.ts` | `ReportParams` type, option lists, Area dot colours, `buildReportsHref`/`buildPrintHref` |
| `globals.css` | Top-level `@page tint-report` (A4) + `#tint-report-print-area` print isolation |
| `lib/permissions.ts` | `ti_report` nav entry repurposed: "TI Report" → "Reports" → `/reports` |
| `next.config.mjs` | Redirects `/tint/manager/ti-report` and `/ti-report` → `/reports?r=ti-report` |
| `app/reports/tint-summary/preview/page.tsx` | **TEMP** dev preview (sample data, no auth) — flagged for removal |
| `docs/mockups/MIS Report/tm-daily-report-mockup-FINAL.html` | Locked report mockup (folder name has a space — quote in commands) |

## NEW API ENDPOINTS
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/reports/tint-summary` | tint_manager / admin / operations | Report data as JSON |

Params (all optional):
```
date (default today IST) · operators (csv ids) · includeHold (default true)
smu (csv) · area (csv) · trendDays (default 7)
```

## BUSINESS RULES ADDED

**Date axes (today boundaries, all IST):**
- Intake / aging / open-age / top-customers / SMU / Area → `orders.orderDateTime` (OBD date).
- Completed / pace / operator output → `tint_assignments.completedAt` (+ `order_splits.completedAt`).

**Litres:** whole-OBD = `orders.querySnapshot.totalVolume` (SAP, already litres); split = Σ split `lineItems.rawLineItem.volumeLine`. No pack→litre maths.

**Completed set:** `tint_assignments` (status `tinting_done`, `completedAt` today) + split-level `order_splits.completedAt` today. A split OBD counts once; OBD-level completion ts = `MAX(split completedAt)`.

**SMU / Area / Top-customers breakdown pool** = open/pending OBDs ∪ completed-today OBDs (keyed by `orderId`, mutually exclusive by stage). `smu[]` / `area[]` return `{ name, count, litres, completedCount, completedLitres }`; `topCustomers` rank by total litres over the same pool. Board total = open + completed (does NOT shrink as jobs finish; is larger than "Remaining" by design).

**Hide:** `getHideExclusion()` AND-merged into every base query — never bypassed (report respects admin hide rules).

**Hold:** `lower(dispatchStatus) = 'hold'` (case-insensitive; mail-order enrichment can write capital "Hold"). `flags.holdCount` ignores `includeHold` so holds always surface.

**Area resolution:** customer → `delivery_point_master` → `area_master` → `delivery_type_master`; missing customer → "Unknown". **SMU** null → fall back to `import_raw_summary.smu`.

**Opening balance** = closing(live pending) + completed − intake (best-effort, documented in code). Closing/open is LIVE-now, not date-scoped → past-date reports have accurate completions but approximate opening/closing.

**Operators filter** scopes operator-centric outputs only (operators[], registers); aggregate balances ignore it. `operators[]` counts jobs (assignment + split) — a split OBD across two operators contributes two jobs.

**Report design (print doc):**
- 4-page A4 portrait, today-only live, litres. Inter via `next/font`.
- Brand blue `#1c3f93` accent — the app one-teal rule does NOT apply to this print document.
- Print: `@page` rules top-level in `globals.css` (never nested in `@media print`); `visibility:hidden` isolation; `#tint-report-print-area`; `print-color-adjust: exact` so colours survive PDF.
- Operator card = Jobs + Volume only (tinting time + utilisation deferred).
- Completion pace = cumulative LITRES (not OBD count) — a 20 L job ≠ a 500 L job.
- SMU / Area boards = progress bars: grey track `#d1d5db` (width = litres / maxLitres), green fill `#16a34a` (width = completedCount / count), category dot, "N done" green `#15803d` (grey if 0). Count = full workload (open + completed).
- Category dot colours — Area: Local `#2563eb`, Upcountry `#ea580c`, IGT `#0d9488`, Cross `#e11d48`. SMU: Decorative Projects `#4f46e5`, Retail Offtake `#0891b2`, other → slate `#64748b`.

**Reports hub (Option C):** `/reports` — left rail (TINT group → Tint Summary + TI Report; no future groups) · large live preview · top bar (date + Generate PDF) · Customise right-drawer. Generate opens `/reports/tint-summary?…&print=1` (auto-print); print route honours `hide` + filters so PDF matches preview. Customise drawer: 10 section IosToggles (teal ON), operator chips, Show Hold toggle, SMU chips, Area chips (dot colours), 7/14/30 trend; Done = `bg-gray-900` (modal CTA rule). URL params: `r, date, hide(csv), operators, includeHold, smu, area, trendDays` — only non-defaults written to URL.

## BUSINESS RULES CHANGED / SUPERSEDED
- **TI Report** is no longer a standalone sidebar item — folded under `/reports?r=ti-report`. Old URLs redirect. `ti_report` permission reused to gate the Reports hub. (CLAUDE_CORE screens index + CLAUDE_UI nav.)

## PENDING ITEMS
- Remove temp dev preview `app/reports/tint-summary/preview/page.tsx`.
- Switch intake/aging "today" axis from OBD date → **import time** once import-time reliability is fixed (currently unreliable, so OBD date is used).
- Operator card: add **tinting time + utilisation (approx)** later — needs attendance present-hours + handling that stored tinting time includes paused minutes.
- Future report groups (Billing, Dispatch) — rail scaffolding ready.

## CONSOLIDATION NOTES
- **CLAUDE_TINT.md** — new "Tint Summary report" section: data axes, breakdown pool (open ∪ completed-today), completed-set/split rules, the locked design.
- **CLAUDE_UI.md** — Reports hub (Option C layout), progress-bar board spec (grey track / green done-fill / category dots), report print rules (@page, isolation, print-color-adjust, brand-blue exemption from one-teal).
- **CLAUDE_CORE.md** — new screen `/reports` + `/reports/tint-summary`; new API `GET /api/reports/tint-summary`; permissions/redirect change for TI Report; engineering note: parallel session owns `scripts/_*` (excluded from "changed-files" tsc).
- ? Decide at merge: whether the OBD-date-vs-import-time axis note belongs in CORE engineering rules or the TINT report section.
