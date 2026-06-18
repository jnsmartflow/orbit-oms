# Context Update — Tint Operator search-first sampling flow + cross-site reuse
Session date: 2026-06-16
Target files: CLAUDE_SAMPLING_LIBRARY.md (suggestion engine), CLAUDE_TINT.md (Tint Operator), CLAUDE_UI.md §34/§35

## SCHEMA CHANGES
None. All work reads existing tables (`sampling_register`, `sampling_recipes`, `sampling_usage_log`). No `prisma db push`, no `$transaction`, sequential awaits only.

## NEW/MODIFIED FILES
| File | Purpose |
|---|---|
| `app/api/sampling-library/_lib/suggest.ts` | Added `flatSuggestions` to the suggest payload (uncapped this-site list, `isExactMatch`, `primarySiteName`, `otherSites[]`). Extracted shared helpers `groupOtherSitesBySampling(samplingNos, excludeSiteId)` + `assembleFlatRow({...})`. New exported interfaces `SuggestFlatRow`, `SuggestOtherSite`. Existing `exactMatches`/`referenceList` retained but no longer consumed by the UI. |
| `app/api/sampling-library/operator-search/route.ts` | **NEW.** Global partial-match search endpoint. |
| `components/tint/operator/flat-suggestion-list.tsx` | **NEW.** The flat table (Sampling / Shade / Site / Formula / Use), exact-row treatment, red "+N sites" expander. Replaces `suggestion-card.tsx`. |
| `components/tint/tint-operator-content.tsx` | Search box lifted to parent; per-entry view mode `browse \| confirm \| newshade`; new-site auto-form + grey reuse zone + divider; type-aware suggestion apply; reuse heading; Tinter/Acotone toggle → white-pill. |
| `components/tint/sku-display-toggle.tsx` | Fini/Generic toggle → white-pill. |
| `components/tint/operator/suggestion-card.tsx` | **No longer imported** (retired; safe to delete in cleanup). |

## NEW API ENDPOINTS
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/sampling-library/operator-search` | `sampling_library:canView` | Partial (ILIKE contains) global search on `samplingNo` / `shadeName` / usage site name; optional `type` filter; `RESULT_LIMIT = 50`; returns `SuggestFlatRow` rows (applyable, incl. `primarySiteName` + `otherSites[]`, `isExactMatch:false`). |

## BUSINESS RULES ADDED
- **Search-first, one flat list.** Operator suggestion area is a single flat list, not the old exact/other split. Repeat site → full this-site shade list, **no cap**, recent-first, exact match pinned top. New site → no list; new-shade form auto-renders with the search retained for cross-site reuse.
- **Search scope:** all sites, partial (contains) match on sampling no / shade name / site name. No fuzzy (CORE §3 never-fuzzy-match-sites preserved; fuzzy/`pg_trgm` deferred). No formula-value search.
- **Exact match** = a sampling with a variant matching the current line's `skuCode` AND `packCode`. Multiple exacts possible (one per shade tinted on that base+pack). Pinned top + grey EXACT chip + grey wash + gray-900 left bar.
- **Pick = reuse, no allocation.** Picking a suggestion or a cross-site search result attaches the EXISTING `samplingNo`; the resolution layer (`sampling-resolution.ts`) was already correct (Scenarios 2/3). A cross-site pick records the current site as another usage. The duplicate problem was *findability*, not the save path.
- **Collapse-on-pick.** Per-entry mode `browse \| confirm \| newshade`. Pick → confirm (existing applied-shade bar + active-values grid + "Show all"). Add shade → newshade form. The TI form never sits under a long list.
- **Type-aware suggestion apply.** Apply reads pigment columns from the card's own `tinterType` (not the toggle), auto-flips the toggle to match, and a toggle change refetches suggestions. Fixes Acotone suggestions not populating. Cards carry `tinterType` and show a TINTER (grey) / ACOTONE (orange) tag.

## BUSINESS RULES CHANGED / SUPERSEDED
- **Suggestion engine** (CLAUDE_SAMPLING_LIBRARY.md): the two-section exact/reference UI and the `exact.slice(0,3)` / `reference.slice(0,5)` caps are gone. Superseded by `flatSuggestions`.
- **UI §34 colour budget (Tint Operator):**
  - Fini/Generic + Tinter/Acotone toggles → **white-pill on gray-100 track** (active `bg-white text-gray-900 shadow-sm`), no longer `bg-gray-900`.
  - Suggestion-list **"Use" buttons → soft grey** (`bg-gray-200 text-gray-800`), not `bg-gray-900`.
  - Exact row → `bg-[#eef1f4]` wash + `border-l-[3px] border-l-gray-900` + grey EXACT chip; pigment chips white-bg on exact rows.
  - Reuse heading → `text-gray-900 font-semibold` "REUSE A SHADE — ANY SITE".
  - Shared universal-header segmented control (slot toggles, other boards) **untouched** — still teal.

## BUSINESS RULES REMOVED / DEPRECATED
- `suggestion-card.tsx` retired (no importers). Two-section exact/reference rendering removed.

## PENDING ITEMS
- **Data consolidation — NOT done (original Issue 5).** Existing duplicate sampling numbers created 25 May → now (from the old findability bug) still need: identify dupes by recipe fingerprint → pick earliest as canonical → repoint `tinter_issue_entries` / challan references → mark others inactive (`mergedIntoId`, never delete). Code prevents *new* duplicates; historical dupes remain. **Needs a dedicated cleanup session.**
- Fuzzy/typo search (`pg_trgm`) deferred — partial match only shipped.
- `exactMatches` / `referenceList` still built in `suggest.ts` but unused by the UI — remove in cleanup once no other consumer confirmed.
- `components/tint/operator/suggestion-card.tsx` safe to delete.

## CONSOLIDATION NOTES
- **CLAUDE_SAMPLING_LIBRARY.md** — rewrite the suggestion-engine section: flat list (no cap), exact-match definition (sku+pack, multiple allowed), `operator-search` endpoint, `otherSites` grouping, reuse-on-pick, `SuggestFlatRow` shape.
- **CLAUDE_TINT.md** (Tint Operator) — document the search-first flow, view modes, new-site auto-form + reuse zone, type-aware apply.
- **CLAUDE_UI.md §34** — update the Tint Operator colour budget per CHANGED/SUPERSEDED above.
- **DOC FIX** — CLAUDE_UI / SAMPLING_LIBRARY referenced `status-pills.tsx` and `sampling-list.tsx` for the tinter-type tag; those paths don't exist. Real file: `components/sampling-library/sampling-library-list-pane.tsx` (~:263-269).
