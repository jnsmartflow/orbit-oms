# Context Update v1 — Pack-size multiplier for Tint Operator reuse (scale formula by pack, TINTER only)
Session date: 2026-06-16
Target files: CLAUDE_TINT.md, CLAUDE_UI.md, CLAUDE_SAMPLING_LIBRARY.md, CLAUDE_CORE.md (lib index)

## SCHEMA CHANGES
None. Schema stays v27.5. New pack variants are created at save-time through the existing `sampling_recipes.create` (resolution Scenario 2) — no DDL.

## NEW/MODIFIED FILES
| File | Purpose |
|---|---|
| `lib/sampling/pack-litres.ts` (NEW) | Shared dose-litres map + `packDoseLitres`, `canScale`, `scalePigments` (3 dp), `perLitreFingerprint` (2 dp). Importable client + API. |
| `components/tint/operator/flat-suggestion-list.tsx` | Reuse list now scales formulas to the line pack; PACK + LAST USED split into their own columns; ✓ / ×N / stored markers; locked pack pill; per-row TINTER gate. |
| `components/tint/operator/formula-match-modal.tsx` | Matched rows scale to line pack with ✓ / ×N markers; added a clearly-labelled **Cancel** (aborts, no mint). |
| `components/tint/tint-operator-content.tsx` | Passes `linePack` + `scalingEnabled` to list + modal; `applySuggestionToEntry` scales picked recipe to line pack (TINTER); formula-match POST sends `packCode`; removed "Assigned" header badge; "Pending" line-card pill → plain text. |
| `app/api/sampling-library/formula-match/route.ts` | Match is now per-litre for TINTER (catches scaled packs), exact 27-value for ACOTONE; active/zero pre-filter for both. |

## BUSINESS RULES ADDED
- **Pack dose-litres (multiplier basis).** A pack scales by its *dose* litres, not its raw base volume. Base sizes pair with their nominal can (colorant fills the gap):
  ```
  ml_500→0.5 · L_0_9/L_0_925/L_1→1 · L_3_6/L_3_7/L_4→4 ·
  L_9/L_9_25/L_10→10 · L_15→15 · L_18/L_18_5/L_20→20 ·
  L_22→22 · L_30→30 · L_40→40 · null→unscalable
  ```
- **Pack scaling is linear by dose-litres** (verified across all 217 multi-pack samplings; the only non-clean cases were data-quality noise — typos / mislabeled packs / duplicate rows / trivial rounding, not real exceptions).
- **Reuse-search formulas auto-scale to the line's pack.** Applies to **both** list modes — the site list ("Shades at this site") and the global search ("Searching all sites") — since they share one component (`FlatSuggestionList`, fed `browseRows = isSearching ? searchResults : flatSuggestions`). The pack is **locked to the line** (derived from `entry.packCode`); the operator cannot pick another pack. Shown as a locked pill `PACK · {label} 🔒`. Rows carry the raw stored pigments + their own `packCode`, so scaling is computed client-side; no `suggest.ts` / `operator-search` change was needed.
- **PACK-column markers:** green `{pack} ✓` = saved at that pack (real) · teal `{pack} ×N` = live multiplier from the saved pack · `{— } stored` = blank/unknown pack, cannot scale.
- **Using a scaled row creates a NEW pack variant under the SAME sampling number** (no new number). Each pack variant keeps its own `usageCount` / `lastUsedAt`. Existing variants stay immutable (Issue-1 guard unchanged).
- **formula-match catches scaled packs** via per-litre fingerprint (2 dp tolerance) — a typed-fresh 4 L formula matches an existing 20 L recipe of the same shade.
- **TINTER-only gate.** All pack scaling / markers / auto-scale / per-litre matching apply to **TINTER only**. ACOTONE is untouched: plain pack pill, raw formula, exact match. The gate is per-**row** (`row.tinterType === 'TINTER'`) — an ACOTONE row never shows ✓ / ×N even on a TINTER line.
- **Reuse / "Same shade found" modal:** Cancel / Esc / backdrop aborts the save with **no** new number; only **Use** (reuse, scaled) and **Create new** (explicit) mint/save.

## BUSINESS RULES CHANGED / SUPERSEDED
- Reuse-list row meta was `{pack} · {date}` under the formula → now **PACK** and **LAST USED** are separate columns; the FORMULA cell is chips only. (CLAUDE_UI — reuse list / fixed-table standard.)
- Issue-1 formula-match was exact 27-value equality → now **per-litre for TINTER**, exact retained for ACOTONE.

## BUSINESS RULES REMOVED / DEPRECATED
- **"Assigned" status badge removed** from the Tint Operator job header ("In Progress" retained).
- **"Pending" line-card badge** changed from a boxed amber pill to plain `text-amber-700 font-semibold` text (no box).

## PENDING ITEMS
- **Possible UX revisit — locked pack vs pack filter.** The pack is currently **locked to the line**. After a few days of real operator use, Smart Flow may want to switch this to a **manual pack-size filter** (clickable 1 / 4 / 10 / 20 LT buttons) so an operator can preview / pick another pack. Decision deferred pending real-world use; the locked pill was chosen first to prevent applying a wrong-pack dose by mistake.
- **Edit-path modal gate (pre-existing).** The "Update TI Entry" path (editing an already-saved line) does **not** run the formula-match gate and does not resolve/mint a sampling for a typed-fresh shade — it saves with a null `samplingNo` and no modal. Normal "Save TI" on a fresh line is unaffected. Needs the same gate wired into the edit/update path.
- **Cleanup — junk test sampling `#26-0285` ("Test")** created during local testing (localhost → prod DB). To be removed (`sampling_register` + `sampling_recipes` + any `sampling_usage_log`). Smart Flow handling.
- **(Carried) Historical duplicate cleanup (Issue 5).** ~738 formula-duplicate sampling numbers + the 55 non-clean pack rows (typos / mislabeled packs / duplicate-pack rows). Collapse to a canonical 26-series number, repoint TI/challan refs, mark others inactive. The reuse modal prevents **new** duplicates but does not erase existing ones.
- **Cross-type rows in the list.** A TINTER line's reuse list still shows ACOTONE shades from the same site (now rendered plain, no ✓/×N). Consider filtering the list to the line's tinter type so cross-type rows don't appear at all — deferred, low priority.

## CONSOLIDATION NOTES
- **CLAUDE_TINT.md** — Tint Operator pack multiplier: dose-litres model, line-locked pack, scaled apply → new pack variant, per-pack usage tracking, per-litre formula-match, TINTER-only gate, modal Cancel.
- **CLAUDE_UI.md** — Reuse list new columns (PACK + LAST USED); ✓ / ×N / stored markers; locked pack pill; removed Assigned badge; plain-text Pending; modal scaled rows + Cancel button.
- **CLAUDE_SAMPLING_LIBRARY.md** — one sampling number holds multiple pack variants (formula identity + pack scaling); each variant tracks its own usage; recipes immutable.
- **CLAUDE_CORE.md** — add `lib/sampling/pack-litres.ts` to the lib index. Schema unchanged (v27.5).
- **(?)** Whether the locked-pack vs pack-filter choice rises to a UI rule, or stays a deferred decision — decide at merge.
