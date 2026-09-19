# code-update-2026-08-11-tint-operator-history.md

Session type: code-update (shipped)
Compiled by: Claude.ai planning session, from Claude Code's own build/polish reports (same session, depot PC)
Status: Pushed to `origin/main` and Vercel auto-deploy triggered. Live smoke test on orbitoms.in by Smart Flow — confirm before merging this draft into CLAUDE_TINT.md as current reality (per the "SHIPPED is a claim, not a fact" rule).

---

## What shipped

A new **History** view on `/tint/operator`, next to the existing "My Jobs" view. Lets Deepak/Chandrasing see their own completed tint jobs — which site, which shade, which formula, how many tins — for any single day in the last 7 (default: Today). Read-only, no workflow changes to the existing Jobs face.

Commits (local → pushed as one push, `2d80cc69..5ce8d8ec`):
- `dfd9b669` — the History face: new route, panel, shared toggle, date-stepper minDate
- `b2e7c78a` — visual polish pass (hierarchy, casing, tags, column order)
- `5ce8d8ec` — column width rebalance (data-driven, not guessed)

No schema or migration. No database writes at any point in the build — reads existing columns only.

---

## New / changed files

**New:**
- `app/api/tint/operator/history/route.ts` — `GET ?date=YYYY-MM-DD`, `force-dynamic`, tint_operator auth (mirrors `my-orders`). Clamps date to `[today−6, today]` IST, echoes back the effective date/minDate/maxDate. Two parallel queries across `tinter_issue_entries` + `tinter_issue_entries_b`, plus a sequential `import_raw_summary` overlay for site-name consistency with `my-orders`. `isRemoved:false` + `getHideExclusion()` applied.
- `components/shared/header-view-toggle.tsx` — new shared "dark active" toggle (UI §21 style), generic over its option union. First real consumer of this pattern as a component rather than inline JSX.
- `components/tint/operator/party-cards.tsx` — Bill To / Ship To card block, extracted verbatim from the existing Jobs face so both views render identical cards.
- `components/tint/operator/history-panel.tsx` — the 340px job list (left) + detail pane with the line table (right).

**Edited:**
- `components/ui/date-picker-popover.tsx` — optional `minDate` (day cells + prev-month nav disabled below the floor).
- `components/header-date-stepper.tsx` — optional `minDate`; left chevron mirrors the existing `isToday` disable pattern. The four existing date-math helpers were left untouched (their own file header says they're copied character-for-character).
- `components/universal-header.tsx` — forwards the new `minDate` prop through to `HeaderDateStepper`.
- `components/tint/tint-operator-content.tsx` — view state, gated fetch, toggle wired into the title slot, Row 2 branch (job pill ↔ date stepper), body branch (Jobs ↔ History), swapped in the extracted party-cards.

---

## Decisions locked in during design (for future reference)

- **Row grain:** one History entry = one job (OBD or split), each expandable to its TI lines (shade, base SKU, pack, formula/sampling number, qty).
- **"Completed" filter:** only jobs that reached tinting-done. In-progress/not-yet-finished TI entries are excluded, even though the underlying TI row exists as soon as the operator saves it. Cancelled splits are excluded too.
- **Identity:** filtered by `submittedById` (who typed the TI), not `assignedToId` (who the job was assigned to). They differ on 10 of 939 live rows. **Caveat if this query is ever reused for a manager-facing view:** `tint_manager` Chandresh's own `submittedById` rows (134 live) would surface — this is fine for an operator's own screen (only they can reach it) but would need re-filtering for any TM/admin reuse.
- **Date logic:** uses the correct IST-midnight boundary (same pattern as `istDayBounds()` in `lib/reports/tint-summary-data.ts`) — deliberately does **not** reuse `my-orders/route.ts`'s UTC-midnight logic, which undercounts "today" for anything completed before 05:30 IST. That bug is pre-existing in `my-orders` and was **not fixed** in this pass — still open, low real-world impact since the depot doesn't tint at 3am.
- **Text casing:** `smartTitleCase()` applied to site/customer names only. Deliberately **not** applied to SKU descriptions, shade names, or formula numbers — they're SAP-issued codes, and the function visibly damages them (e.g. "30GY 83/021" → "30gy 83/021"). Confirmed against UI §15's own exclusion list (codes/badges/column headers).
- **TINTER/ACOTONE tag:** matches the existing bare mono grey/orange treatment from `suggestion-card.tsx` / `flat-suggestion-list.tsx` (no fill, no border) rather than inventing a filled-pill 4th variant.
- **Column widths** (`history-panel.tsx` line table), tuned from real data percentiles, not guesses: SKU 39% · Pack 8% · Qty 6% · Type 9% · Formula No. 13% · Shade 25%. `samplingNo` is always exactly 7 characters live (p50=p90=p99=max), so Formula No.'s column is now header-width-constrained rather than data-constrained — shortening the header text to just "Formula" would free a few more points for SKU if ever revisited.

---

## Known gaps carried into this feature (pre-existing, not introduced here)

- **Split jobs are a near-dormant path.** Only 5 split TI rows exist live (0 on Acotone), only 4 `order_splits` rows have ever reached tinting-done. `tintAssignmentId` is **NULL on every split TI row** — `app/api/tint/manager/assign/route.ts` never sets `splitId` on `tint_assignments` (confirmed structurally: 0 of 773 live `tint_assignments` rows have a non-null `splitId`). History resolves a split job via `splitId ?? orderId` and reads completion off `order_splits` directly rather than through the assignment — do not "fix" this by routing through `tintAssignmentId`, it will silently drop all split work.
- **Split-completed tints still don't write `sampling_usage_log`** (pre-existing gap, tracked in CORE §13 / TINT §14). Unrelated to this feature but adjacent — a split job showing correctly in History may still be invisible to Sampling Library's usage history / same-site suggestions.
- **Mail Orders' own Table/Focus toggle was not retrofitted** to the new `header-view-toggle.tsx` shared component — it still has its own inline version (with a `data-tutorial` hook and a billing-flag branch that would need to come along). Optional future cleanup, not required.

---

## Suggested landing spot in canon

New subsection under **CLAUDE_TINT.md §3 (Tint Operator)** — e.g. "§3.13 Operator History view" — plus a one-line mention in CLAUDE_UI.md §6's per-board wiring table (History mode's Row 2 wiring: date stepper + summary, no job pill) and possibly a short new entry in §21-adjacent for the new shared `header-view-toggle.tsx` component if it gets a second consumer later.

No router change needed (`/tint/operator` already exists; this is a mode within the existing screen, not a new route/page).
