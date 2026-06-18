# Context Update v2 — Tint reuse list: pack FILTER + nominal 1/4/10/20 buckets
Session date: 2026-06-17
Target files: CLAUDE_TINT.md (Tint Operator reuse list), CLAUDE_UI.md (filter dropdown + pack pill), CLAUDE_SAMPLING_LIBRARY.md (pack scaling model)

> Supersedes the reuse-LIST portion of `code-update-2026-06-16-pack-size-multiplier.md`. That draft described a flat list that auto-scaled every shade to the line pack with ✓/×N markers. That UI is **gone** — replaced by the pack filter described here. The scaling-on-Use, per-litre formula match, modal scaling, and TINTER-only gate from that draft are all UNCHANGED and still apply.

## SCHEMA CHANGES
None.

## NEW/MODIFIED FILES
| File | Purpose |
|------|---------|
| `components/tint/tint-operator-content.tsx` | Pack-filter dropdown lives in the parent search row `[PACK ▾] [Search…] [+ Add shade]`. Builds bucket options, holds filter state, applies the filter before passing rows to the list. |
| `components/tint/operator/flat-suggestion-list.tsx` | PACK column now shows the NOMINAL bucket label; green when it matches the line's bucket, grey otherwise. Flat scaling, ✓/×N/stored markers, and the `scalingEnabled` prop removed. |
| `lib/sampling/pack-litres.ts` | Unchanged. `packDoseLitres()` is the bucket basis (no edits this session). |

`formula-match-modal.tsx`, `app/api/sampling-library/_lib/suggest.ts`, and the formula-match API were **not** touched.

## NEW API ENDPOINTS
None.

## BUSINESS RULES ADDED
- **Reuse list is a FILTER, not an auto-scaler.** The reuse list shows shades at their **raw stored** formula values. It no longer rewrites every row to the line pack.
- **Pack dropdown defaults to the line's pack.** Before any manual pick, the filter derives the current line's pack and shows only that pack's shades. Resets to the line default on job change and on line/SKU change.
- **Four nominal buckets only: 1 / 4 / 10 / 20 (litres).** The dropdown never lists raw pack codes. Each shade is bucketed by `packDoseLitres(packCode)`, which folds the real pack sizes into a nominal can:
  - `3.6L / 3.7L / 4L → 4`
  - `0.9L / 0.925L / 1L → 1`
  - `9L / 9.25L / 10L → 10`
  - `18L / 18.5L / 20L → 20`
- **Dropdown order:** `All packs · {total}`, then `1 LT`, `4 LT`, `10 LT`, `20 LT` — each `{n} LT · {count}`, the line's bucket tagged `· LINE`, 0-count buckets disabled.
- **Filter match is by bucket, not exact pack.** Selecting "4 LT" shows every shade whose `packDoseLitres` is 4 (so a 3.7L shade appears under 4 LT). "All packs" applies no filter.
- **Rare packs only under "All packs".** Shades whose `packDoseLitres` is not in {1,4,10,20} (0.5 / 15 / 22 / 30 / 40) or null appear ONLY in the All-packs view, never in a numbered bucket. If the line's own pack is rare/null, the filter defaults to "All packs".
- **PACK column shows the nominal label.** A shade stored as 3.7L / 18L reads as "4 LT" / "20 LT" in the PACK column (matches the product-vs-pack mapping — e.g. an 18L base product is shown as its 20L can). Green pill = same bucket as the line (exact fit, no scaling on Use); grey pill = different bucket (formula auto-scales to the line pack when **Use** is tapped, TINTER only).
- **Scaling still happens ON USE only.** `applySuggestionToEntry` scales a grey (different-bucket) TINTER shade to the line pack at the moment of Use. ACOTONE is never scaled. The list itself never shows scaled numbers.

## BUSINESS RULES CHANGED / SUPERSEDED
- **Reuse list UI** (CLAUDE_TINT / CLAUDE_UI): the flat "scale-everything-to-line-pack with ✓ (exact) / ×N (scaled) markers" list is removed. Replaced by the pack-filter dropdown + raw-value list above. The ✓/×N markers, the per-row "stored" marker, and the `scalingEnabled` prop no longer exist.

## BUSINESS RULES REMOVED / DEPRECATED
- ✓ / ×N suggestion markers — removed (commit 3779c09e).
- `scalingEnabled` prop on the suggestion row — removed (commit 3779c09e).

## PENDING ITEMS
- **DONE this session:** pack-filter rework + nominal buckets shipped and live on main (commits `3779c09e` filter rework, `0008a72b` bucket fix). Both verified on local; pushed to bom1.
- **Scratch-file tsc noise (NEW):** `tsc --noEmit` reports 24 errors, all in untracked `scripts/_*` scratch files (never committed). Exclude `scripts/_*` from tsconfig or delete them so the tsc gate stays clean.
- **Edit-path modal gate (still open, pre-existing):** the "Update TI Entry" path (editing an already-saved line) skips the formula-match gate + sampling resolution and can save a null `samplingNo`. The gate currently lives only in Save-TI / handleSubmitTI. Needs the same gate on the edit path.
- **Possible UX revisit (NEW, watch):** after a few days of real use, Smart Flow may prefer a manual pack filter over the line-default lock. No change unless requested.
- **Cross-type filter (low priority):** a TINTER line still lists ACOTONE shades (rendered plain). Consider filtering the list to the line's tinter type.
- **Issue 5 — historical duplicate cleanup (future session, prompt drafted):** club all formula-duplicate sampling numbers into one canonical, repoint references, mark others inactive. Canonical pick order: (1) 26-series number; (2) else highest total usageCount; (3) tie-break oldest createdAt. Do NOT delete.

## CONSOLIDATION NOTES
- **CLAUDE_TINT.md (Tint Operator reuse list)** — replace the reuse-list spec: pack-filter dropdown defaulting to the line bucket, raw-value rows, scaling on Use only. Remove any ✓/×N description.
- **CLAUDE_UI.md** — add the filter dropdown spec (`[PACK ▾] [Search…] [+ Add shade]` on one row; All / 1 / 4 / 10 / 20; LINE tag; 0-count disabled) and the PACK pill rule (nominal label; green = line bucket, grey = other).
- **CLAUDE_SAMPLING_LIBRARY.md** — record the nominal bucket map (1/4/10/20 via `packDoseLitres`; folds 3.6/3.7→4, 0.9/0.925→1, 9/9.25→10, 18/18.5→20; rare 0.5/15/22/30/40 standalone) as the canonical pack-grouping for reuse.
- **Note for merge:** this fully supersedes the LIST-UI section of the 2026-06-16 pack-multiplier draft. When consolidating, take the list UI from THIS draft and the scaling/modal/match mechanics from the 2026-06-16 draft.
