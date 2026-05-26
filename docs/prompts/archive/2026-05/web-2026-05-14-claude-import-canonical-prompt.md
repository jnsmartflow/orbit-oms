# Claude Code Prompt — Draft `CLAUDE_IMPORT.md` canonical

**Date drafted:** 2026-05-14
**Run this in:** Claude Code on depot PC, fresh chat session
**Outcome:** A new file `docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md` containing the full draft of `CLAUDE_IMPORT.md`, ready for Smart Flow's review.

---

## When to run

Run when the next planning/documentation session starts. Suggested order:
1. Open a fresh Claude Code chat on the depot PC at `C:\Users\HP\OneDrive\VS Code\orbit-oms`
2. Paste the prompt below (everything between the `~~~` markers)
3. Let it run — estimated 20-30 minutes
4. Review the output draft, edit anything wrong
5. Once approved, copy from `docs/prompts/drafts/` to `docs/CLAUDE_IMPORT.md`
6. Update `CLAUDE.md` router to include the new file in the load matrix

---

## The Prompt

~~~
# Est: 30 min · Opus recommended

## Goal

Draft a new canonical context file `CLAUDE_IMPORT.md` that documents the complete SAP/OBD import pipeline — both manual SAP path and Auto-Import path. Follow the exact structure, tone, and depth of the existing canonical files. Output as `docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md`.

This file will become the 8th canonical context file, loaded alongside CORE + UI whenever a session touches the import pipeline.

## Files to read FIRST (do not write the draft yet)

### Existing canonicals — read for STRUCTURE, TONE, DEPTH

1. CLAUDE.md (repo root) — the router
2. docs/CLAUDE_CORE.md — for engineering rules, schema overview, infrastructure
3. docs/CLAUDE_UI.md — to understand canonical file shape
4. docs/CLAUDE_MAIL_ORDERS.md — closest analog (pipeline canonical)
5. docs/CLAUDE_TINT.md — second analog
6. docs/CLAUDE_ATTENDANCE.md — for module-canonical reference
7. docs/CLAUDE_PLACE_ORDER.md — for module-canonical reference

### Import codebase — read for CONTENT

8. lib/sap-parser/index.ts
9. lib/sap-parser/types.ts
10. lib/sap-parser/cells.ts
11. lib/sap-parser/read-sheet.ts
12. lib/sap-parser/group-rows.ts
13. lib/sap-parser/apply-rules.ts
14. lib/sap-parser/build-obd.ts
15. lib/import-upsert.ts (entry wrapper)
16. lib/import-upsert/types.ts
17. lib/import-upsert/state.ts
18. lib/import-upsert/lines.ts
19. lib/import-upsert/header.ts
20. lib/import-upsert/effects.ts
21. lib/import-upsert/audit.ts
22. lib/import-upsert/helpers.ts
23. app/api/import/obd/route.ts (handlers + entry points)
24. components/import/sap-preview.tsx
25. components/import/import-modal.tsx
26. components/import/import-page-content.tsx
27. prisma/schema.prisma — models: `import_batches`, `import_raw_summary`, `import_raw_line_items`, `import_enriched_line_items`, `import_obd_query_summary`, `import_shadow_log`

### Auto-Import reference (paused but in-scope for the canonical)

28. docs/sample/Auto-Import.ps1 (reference only — script lives outside repo at `F:\VS Code\OBD-Import Tool v2\Auto-Import.ps1`)
29. CORE §4 (infrastructure section) — for Auto-Import deployment details

### Session history (the most recent decisions)

30. docs/prompts/drafts/web-2026-05-14-sap-import-fix-plan-v2.md — the planning file (this should be saved at this path before running this prompt; if missing, ask Smart Flow to attach it as an upload)
31. docs/prompts/drafts/web-2026-05-14-sap-import-fix-session-end.md — what shipped 2026-05-14 (this should also be saved at this path; if missing, ask Smart Flow to attach it as an upload)

If either file is missing from the path, do NOT proceed without confirming with Smart Flow. These files contain the locked decisions (column map, composite key rationale, deviations, test results) that the draft must reflect accurately.

Reply with "All files read. Sections planned: [list]. Ready to draft." before writing the draft.

## Structure requirements

Follow the same section pattern as `CLAUDE_MAIL_ORDERS.md`. The draft should have these sections in this order:

### 1. What this module is
- Two-paragraph overview: manual SAP path, Auto-Import path, where they converge
- Scale (~100-200 OBDs/day per CORE §1)
- Live at https://orbitoms.in/admin/import (or actual route)

### 2. Pipeline overview
- Diagram (ASCII or numbered list) showing: file upload → parser → upsert brain → orders rollup → enrichment hook → downstream (tint, splits, challan)
- Distinguish manual SAP from Auto-Import where flow differs

### 3. File layouts
- 3.1 Manual SAP — new 19-column layout, locked column map (copy from session-end doc or plan v2)
- 3.2 Auto-Import — LogisticsTracker XLS format (read Auto-Import.ps1 to extract)
- 3.3 Old SAP layout — note as deprecated, with one-line "do not support"

### 4. Schema (import tables)
- `import_batches` — fields, purpose, status values
- `import_raw_summary` — fields, key constraints
- `import_raw_line_items` — fields incl. `netWeight`/`totalWeight`/`batchCode`/`lineStatus`
- `import_enriched_line_items` — what enrichment writes
- `import_obd_query_summary` — what it caches
- `import_shadow_log` — shadow mode analysis (used during cutover phases)

### 5. Parser package (`lib/sap-parser/`)
- File-by-file summary: index, read-sheet, group-rows, apply-rules, build-obd, cells, types
- Column constants
- LineInterim shape
- Output: ObdInput[]

### 6. Upsert brain (`lib/import-upsert/`)
- File-by-file: entry wrapper, types, state, lines, header, effects, helpers, audit
- Planner vs executor split
- Two paths: `createPath` (new OBDs) vs `applyLinePatch` (existing OBDs)
- The composite key: `(lineId + "|" + skuCodeRaw)` — why, how, `makeKey()` helper
- Orphan handling: `lineStatus = "removed_by_import"` literal — never change this
- LINE_AUTHORITY map — manual-sap is authoritative, auto-import is not

### 7. Hard rules — non-negotiable
Copy the style of CORE §3. Include:
- `removed_by_import` literal stays exact
- Composite key uses `|` separator
- LF-only filter at row level
- Qty=0 silent drop
- Auto-sum `totalWeight` into summary `grossWeight`
- Slot assignment skipped for tint orders (slotId stays null until tint completes — per CORE §9)
- Mail-order enrichment hook: `applyMailOrderEnrichment()` runs after upsert
- Customer matching cascade: see CLAUDE_MAIL_ORDERS.md (cross-ref, don't duplicate)
- Storage Location (col 3 of new SAP layout) read but ignored downstream

### 8. Filters and drops
- Delivery Type ≠ LF (row-level)
- Qty = 0 (silent drop)
- ZZRE handling (two branches in apply-rules.ts)
- Unknown SKU (warned, not dropped — flows through)

### 9. Routes and handlers
- All import operations dispatch through `POST /api/import/obd` with an `?action=...` query param. Single unified handler dispatches internally:
  - `?action=manual-sap-preview` — SAP preview (dry run, returns preview rows)
  - `?action=manual-sap-confirm` — SAP confirm (commits the import)
  - `?action=auto` — Auto-Import endpoint (HMAC-signed, called by `Auto-Import.ps1`)
  - Any other `?action=...` values present in the handler — document each
- Confirm the handler dispatch table in `app/api/import/obd/route.ts` (around the route's main switch). Quote the action → handler map.
- All routes need `export const dynamic = 'force-dynamic'` per CORE §3.

### 10. Auto-Import operational details
- Scheduled task: every 10 min, 8AM-8PM IST
- HMAC signing: `IMPORT_HMAC_SECRET`, fixed string `"auto-import-v1"`
- State files in `Master\`: list each
- PowerShell quirks (CORE §3 already lists — cross-reference)
- Currently paused — note the resume checklist

### 11. UI components
- `sap-preview.tsx` — preview modal
- `import-modal.tsx` — universal import entry
- `import-page-content.tsx` — admin import page
- What each renders, where state lives

### 12. Slot assignment integration
- Cross-reference CORE §9 (slot assignment)
- Non-tint orders: slot set at import via `resolveSlot()` on `orderDateTime`
- Tint orders: `slotId = null` at import, set on tint completion
- `applyMailOrderEnrichment()` overrides `orderDateTime` from `mo_orders.receivedAt`

### 13. Audit and observability
- `import_batches` rows record every run
- `import_shadow_log` for shadow analysis
- Console warnings to look out for
- `lineStatus` transitions: `active` ↔ `removed_by_import`

### 14. Landmines
Same style as CORE §13 — things that look fixable but aren't:
- Old SKU-only key removed but historical compatibility notes
- `parentRowNumber` on LineInterim — vestigial after Phase 1 rewrite
- `KNOWN_ITEM_CATEGORIES` warning chatter
- `duplicate-sku-summed` warning kind — removed from union, do not re-add
- ExistingLine doesn't carry weights — intentional (no weight diff in audit)

### 15. Open items / future work
- Auto-Import resume + cross-source orphan policy
- Weight diff in audit (deferred)
- Storage Location consumer (col 3)
- Tint Operator shade auto-match on duplicate-SKU lines (`tint-operator-content.tsx` line 788)
- Barcode/QR label generation post-tinter-issue
- E-way bill JSON export

## Style requirements

- Use Smart Flow's tone from existing canonicals — terse, factual, no fluff
- Hard rules in bullet form with rationale
- Code references use file paths + line numbers where stable (e.g. `lib/import-upsert/lines.ts:54-62`)
- Cross-reference other canonicals where overlap exists — do NOT duplicate (e.g. don't restate engineering rules, link to CORE §3)
- ASCII tables for column maps + schema shapes
- Markdown only, no HTML

## Length target

3000-5000 words. Comparable to `CLAUDE_MAIL_ORDERS.md` in heft.

## Header

Start the file with:

```
# CLAUDE_IMPORT.md — OrbitOMS Import Pipeline
# v1 · Schema v27.2 · Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md + docs/CLAUDE_UI.md
```

## Hard rules for the drafting

- DO NOT invent code references — only cite what you actually read
- DO NOT contradict any rule in CORE §3
- DO NOT use `prisma.$transaction` even in example code snippets
- Quote actual code where helpful, but only short blocks
- Mark anything uncertain as `[TODO: verify]` rather than guessing
- Use bullet lists sparingly — prefer prose where prose reads better

## Output

Write the draft to: `docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md`

After writing, run:
1. `wc -w docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md` — confirm word count
2. `grep -c "^## " docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md` — confirm section count (target: 15)

## Expected output back to Smart Flow

Paste:
1. Confirmation file written
2. Word count
3. Section count
4. Any `[TODO: verify]` markers you left in the draft, listed with line numbers
5. Any places you found that contradicted CORE §3 or another canonical — flag for Smart Flow review

## Do NOT
- Commit anything
- Move the draft to docs/CLAUDE_IMPORT.md — that's a manual review step
- Touch the CLAUDE.md router — that updates after Smart Flow approves the draft
- Modify any code files
~~~

## After Claude Code finishes

Smart Flow should:

1. Open the draft and skim section-by-section
2. Fix any `[TODO: verify]` markers
3. Cross-check against memory of how the pipeline actually behaves
4. When happy:
   - `mv docs/prompts/drafts/code-2026-05-14-claude-import-draft-v1.md docs/CLAUDE_IMPORT.md`
   - Edit `CLAUDE.md` router to add the new file to the load matrix:
     ```
     | OBD import, SAP parser, upsert brain, Auto-Import | docs/CLAUDE_IMPORT.md |
     ```
   - Commit: `docs: add CLAUDE_IMPORT.md canonical (v1)`
   - Move draft prompt + this draft session-end to archive folder later

---

*This is a planning artifact only. Run the prompt block above in Claude Code when ready.*
