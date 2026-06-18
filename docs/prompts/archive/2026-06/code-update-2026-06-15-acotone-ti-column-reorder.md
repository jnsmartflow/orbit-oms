# Context Update v1 — Acotone TI columns reordered to match operator paper register
Session date: 2026-06-15
Target files: CLAUDE_TINT.md §3 (Tint Operator), §11 (TI Report)

## SCHEMA CHANGES
None. Pure render-order change. `tinter_issue_entries_b` columns unchanged — Prisma selects by name, so column order in schema does not affect display.

## NEW/MODIFIED FILES
| File | Purpose |
|---|---|
| `components/tint/ti-report-content.tsx` | `ACOTONE_SHADES` array (~line 51) reordered — drives TI report display, inline shade-expand, and XLSX export from one source |
| `components/tint/tint-operator-content.tsx` | `ACOTONE_SHADES` object array (~lines 270–285, operator grid) and `ACOTONE_COLS` string array (~line 515, TI load mapping) both reordered |

## NEW API ENDPOINTS
None.

## BUSINESS RULES ADDED
- Acotone TI column order is now locked to the operator's physical register order: `WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1, OR1, GR1, BU1, BU2`. This order applies identically to the operator input grid, the TI report, and the Excel export.
- Invariant: in `tint-operator-content.tsx`, `ACOTONE_SHADES` (grid) and `ACOTONE_COLS` (load mapping) must stay code-for-code aligned. If they drift, saved values load into the wrong cells. Any future Acotone column change must edit both together.
- Operator grid colour/style props are keyed to each shade code (object array), so reordering moves whole objects — colours travel with their code.

## BUSINESS RULES CHANGED / SUPERSEDED
- Previous Acotone column order (`YE2, YE1, XY1, XR1, WH1, RE2, RE1, OR1, NO2, NO1, MA1, GR1, BU2, BU1`) is superseded. Historical printed/exported reports from before this change will not match the new on-screen order — accepted, no migration.

## PENDING ITEMS
- TINTER table (`tinter_issue_entries`, pigment codes YOX/LFY/GRN/etc.) was NOT reviewed against any paper register this session. Open question: does the TINTER report order also need to match a physical register? Confirm with operators if so.

## CONSOLIDATION NOTES
- CLAUDE_TINT.md §11 (TI Report) — add the locked Acotone column order and note the single-array source (report + XLSX + shade-expand).
- CLAUDE_TINT.md §3 (Tint Operator) — add the `ACOTONE_SHADES`/`ACOTONE_COLS` code-alignment invariant under landmines or §3.5 pigment cells.
- Consider whether TINTER order needs the same treatment (PENDING ITEMS) — flag at merge.

Commit: `e0f650e6` · pushed to main · deployed (Vercel bom1).
