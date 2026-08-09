# Web update — Article Tag fix (2026-08-09)

Target file: `docs/prompts/drafts/web-update-2026-08-09-articletag.md`

Session type: web-authored (Claude.ai/Cowork), implementation executed via Claude Code prompts run on the depot PC.
Status: SHIPPED — committed `9de0c55b`, pushed to `origin/main`, deployment verified live (site reachable, `/api/health` 200).

---

## 1. The problem this session solved

`articleTag` (pack-count summary like "5 Drum" / "2 Carton 1 Tin" / "1 Bag") was null on a large share of order lines. CLAUDE_PICKING.md §7 carried an open landmine note about this (2026-07-17 finding: 17% null in live picking queue, 69% null system-wide, correlated with `sapStatus: null`) flagged as "still open, evidence-based, dedicated follow-up query still needed."

## 2. Root causes found (two, independent)

**Cause A — manual-SAP upload path, 100% null, pure code bug.**
`lib/sap-parser/build-obd.ts` hardcoded `article: null, articleTag: null` for every line, unconditionally — no computation attempted at all, regardless of category or pack size. Verified with a same-SKU control: of 750 lines whose SKU was correctly tagged elsewhere via auto-json in the last 120 days, all 750 were still null when the same SKU arrived via manual-SAP.

**Cause B — automatic import path, ~10% null, depot-config gap (not a code bug).**
The PowerShell `Get-ArticleInfo` function (on the import PC, outside this repo) correctly computes tags by checking a pack-size dictionary file (`Master\pack-sizes.txt`, depot-PC-only, not in git) — but that dictionary had no entries for several pack sizes in live use (0.5L, 0.05L, 0.1L, 0.2L, 5L, 40L, and others). Production data was perfectly bimodal per pack size (each size either 100% tagged or 100% null), confirming a missing-entry pattern, not a logic bug.

The ZINR breadcrumb (`zinr-article-tag-pending` warning in `apply-rules.ts`) was investigated and ruled out as relevant to either cause — it never assigned a tag, only ever emitted a warning visible solely in the manual-SAP preview response (never reaches confirm/commit).

## 3. Key design decision — SKU Master v2 as primary source

Rather than just patching the old pack-size list (`pack-sizes.txt`), this session found `sku_master_v2` (the live operational catalog, LIVE since 2026-07-19) already carries `packCode`, `unit`, and `piecesPerCarton` per SKU — a per-product source of truth, not a derived guess from `volume ÷ qty`.

Verification before committing to this design (read-only diagnosis, live data):
- 94.3% of all order lines belong to a SKU that IS in the catalog; 99.9% packCode/unit completeness among matched SKUs.
- Catalog already fully answered 4 of the original 16 "gap" pack sizes (0.5L, 0.05L, 0.1L, 0.2L) — 3,006 of 3,847 gap lines, 78%, no human input needed.
- Catalog caught a live correctness bug the old list could never have caught: 4 SKUs (5948208, 5948212, 5948220, IN32400023) were being tagged with the wrong carton count (list assumed 6-per-carton for all 1L products; these SKUs are actually 9-per-carton per catalog) — 138 lines affected.
- One real blind spot found: nothing in the catalog (category, materialType, paintType, unit, or any combination) can distinguish Drum from Bag. That distinction still has to come from a fixed list or a human decision — not fixable by adding more catalog fields alone without a new "container type" column (not built in this session).

**Final architecture:** catalog-first (per-SKU `piecesPerCarton` and packCode/unit when present) → fallback to a small server-side size list (Drum/Bag/Carton buckets) when the catalog has no answer → null (untagged) if neither has an answer. One shared function, used by BOTH import paths, which also fixes Cause A as a side effect (no more separate/absent logic per path).

## 4. Rulebook — final locked state (as decided across this session)

**Carton, catalog-driven (per-SKU count from `sku_master_v2.piecesPerCarton`):**
1L, 4L (existing) · 0.5L, 0.05L, 0.1L, 0.2L (catalog already answered) · 0.3L → 12/carton (new).

**Carton, fixed count (fallback list, catalog usually has no `piecesPerCarton` for these):**
400ML spray-paint aerosol cans (8 SKUs: 5695743/44/45/47/48/49/51/52) — decided as 24/carton, **then reopened** — see §5, not shipped as Carton in this round; currently returns null like the rest of unresolved 0.4L.

**Drum (fallback list):**
10L, 20L (existing) · 15L (new).

**Bag (fallback list):**
25kg/L, 30kg/L (existing) · 40kg (new).

**Size overrides — "93 Base" tinting-base pattern (confirmed by Smart Flow: these are bases deliberately under-filled by 7.5% to leave headroom for tint colourant, so they physically ship in the same container as their round-size twin):**
0.925L → treated as 1L · 3.7L → treated as 4L (applies to the WHOLE 3.7L group by Smart Flow's explicit choice, including the unrelated "WN Wanda Basecoat" automotive products that happen to also compute to 3.7L — a conscious blanket decision, not a per-product one) · 9.25L → treated as 10L · 18.5L → treated as 20L.

**Piece goods:**
Catalog `unit === "PC"` (brushes, stickers, tools) → tag is `"{qty} Pcs"`, regardless of packSize/volume. ~335 lines.

**Deliberately left blank — no rule, no guess (Smart Flow's explicit call, pending physical verification, "day or two"):**
2.5L, 3L, 5L (open — type not yet decided) · 0.4L crackfiller/300G-family products and the 4 non-spray 0.4L automotive touch-up SKUs (type not yet decided, separately from the spray-can question) · 400ML spray-paint cans — reopened, might actually be sold as individual pieces (Pcs) rather than cartons; needs confirmation before any rule is added · the 2 lines with genuinely broken source data (null/zero volume, unfixable by any rule, one of them literally named "...20L" in its own description but has no volume value on that specific order line).

## 5. What shipped (commit `9de0c55b`)

New file `lib/article-tag.ts` (263 lines) — `computeArticleInfo()` (used at all 3 call sites; returns `{article, articleTag}`), `computeArticleTag()` (tag-only sibling per the original spec signature — currently has zero callers, dead code as shipped, kept for API compatibility), `loadPackCatalog()` (batch preload), `aggregateArticleTags()` + `parseArticleTag()` (order-level roll-up).

Modified: `lib/sap-parser/build-obd.ts` (now async; loads catalog once per file, calls the shared function instead of hardcoding null), `lib/sap-parser/index.ts` (now async, header doc corrected), `app/api/import/obd/route.ts` (catalog loaded once per batch in `processAutoImportRows`, serving both `?action=auto` and `?action=auto-json`; server-computed tag is primary, falls back to the incoming payload tag only if the server returns null AND the payload had one, logged when this fallback fires; all three order-level roll-up sites replaced with the shared `aggregateArticleTags()`).

`docs/CLAUDE_IMPORT.md` was updated in the same commit → v1.8 / Schema v27.14, new §8.2 documenting the rule, §8 rule 9 / §13 warning list / §15 open items revised. **This session's later decisions (spray cans reopened, 2.5L/3L/5L confirmed staying open, the size-override map) happened AFTER that in-commit doc update and are not yet reflected there** — see the consolidation prompt that accompanies this draft.

## 6. A bonus bug found and fixed, unplanned

Verifying the spec's "does order-level aggregation handle Pcs" step surfaced a real, already-live bug: the roll-up parser took `parts[0]` as the count and joined everything else as the type, so any multi-word tag like `"7 Carton 3 Tin"` produced type `"Carton 3 Tin"`, which matched nothing — order-level tag silently came out null. 801 of 14,207 currently-tagged production rows are this multi-group shape. Verified example: OBD 9108735710, line tagged "7 Carton 3 Tin" correctly, order-level tag was null before this fix. Fixed as part of the same `aggregateArticleTags()` replacement (§5).

## 7. Deviations from the original spec (Claude Code's judgment calls, all reasonable, kept)

1. `computeArticleTag()` (tag-only) has zero callers — `computeArticleInfo()` was used everywhere instead, since the numeric `article` column is also needed. `computeArticleTag()` is dead code as shipped.
2. Zero-remainder carton tags render as `"N Tin"` (e.g. "2 Tin"), never `"0 Carton 2 Tin"` — matches the existing `Get-ArticleInfo` output shape and all 14,207 live tagged rows; a leading "0 Carton" would have been a new, unrecognised format for `lib/floor/format.ts`.
3. The spec named `buildObdInputFromAuto` (~2487) as an auto-json write site; that function is actually `headerRowToObdInput`, reachable only from `runAutoImportShadow` (a dry-run path, `IMPORT_SHADOW_MODE` not set locally, writes no line items). Both real auto paths build lines inline in `processAutoImportRows` (auto-json delegates to it at line 3321) — one edit there covers both.
4. The order-level roll-up existed as three byte-identical inline copies (`rebuildQuerySummaryForOrder` / manual-template CONFIRM / auto-import CONFIRM), not one site as the spec assumed. All three were replaced, not just one — otherwise piece-goods orders would never roll up correctly on the auto path.

## 8. Verified safe on database load (CPU/performance)

Repo-wide grep confirmed all 3 real call sites of `computeArticleInfo()` receive a preloaded catalog (`Map.get()` in the loop body, zero I/O per line) — catalog loaded once per file (manual-SAP) or once per batch (auto-import), not once per line. A 10-line order costs 1 database query, not 10. This matches the established house pattern used in 5 other places in the codebase (picking queue, billing list, import validation/enrichment preload, OT-pending query).

Cross-checked against a real prior incident found in Claude Code's own session history (not written anywhere in the canon docs): 2026-08-08, `/api/mail-orders` was re-reading the full 1,743-row `mo_sku_lookup_v2` table + rebuilding two in-memory maps on every 30-second poll. Fixed same day with a 5-minute in-process TTL cache, commit `00cfac02`. That fix and this one are complementary, not duplicative — the mail-orders case needed a cache because it polls every 30s; the import path only fires per upload/batch, so batch-preload alone (no TTL cache) is the correct, sufficient shape here.

Same audit surfaced one still-open, unrelated item: Floor Control re-fetches the same data 3× per refresh (`getHideExclusion()` re-running 4× per refresh reading `obd_visibility_rules`, which is currently always empty and could be memoised). Explicitly out of scope for this work — Smart Flow is tracking it separately.

## 9. Coverage estimate

Of ~33,113 order lines analysed (snapshot 2026-08-07/09, live count has grown slightly since): approximately 32,844 lines (~99.2%) now get a tag after this fix — 15,370 from the manual-upload bug fix, 13,894 already working, ~2,985 from the 4 catalog-answered gap sizes, 335 piece goods, ~260 from the new rules this session (0.3L, 40kg, the four "93 Base" overrides, 15kg). Approximately 269 lines (~0.8%) remain deliberately untagged pending Smart Flow's physical verification (§4) — this will grow slightly day by day until those are confirmed, same as before the fix for those specific pack sizes only.

## 10. Deferred / not in scope for this session

- **Backfill of existing wrong/null rows.** This fix only affects NEW lines going forward. The 4 SKUs previously mis-tagged at 9-per-carton (now corrected to 6 via a direct SQL UPDATE to `sku_master_v2.piecesPerCarton`, run by Smart Flow, 2026-08-09) keep their wrong historical tags on already-existing orders — `lib/import-upsert/lines.ts` (`patchLines`) never touches `articleTag` on existing lines, so even a manual-SAP re-upload won't fix them. Explicitly scoped out; a separate backfill script would be needed if wanted.
- **Deciding 2.5L / 3L / 5L / 0.4L crackfiller carton count / 0.4L spray-can type.** Pending Smart Flow's physical check of the actual products, "day or two." When ready, these become a small follow-up SQL/code change, not a rebuild.
- **A proper "container type" field on `sku_master_v2`.** Would resolve the permanent Drum-vs-Bag blind spot (§3) at the source instead of relying on a fixed fallback list forever. Not built, just identified as the clean long-term fix if this keeps needing manual list maintenance.
- **Floor Control's repeated-refetch item** (§8) — unrelated, tracked separately by Smart Flow.

## 11. Verification still pending (Smart Flow, manual — Claude Code has no login credentials)

1. Manual SAP upload containing SKU IN28209072 (1L, 306 lines of history) — lines should now carry a tag.
2. Next automatic (auto-json) batch, any order with a 10L/20L SKU (e.g. 5540672, 5575899) — tag should read `"N Drum"`, unchanged from today; check Vercel logs for absence of `[auto-import] articleTag fallback to payload` warnings (a warning would mean `sku_master_v2` has drifted behind the depot's `pack-sizes.txt`).
3. An order with a piece-goods SKU (6457571 / 6472105 / 6028563) — should now read `"N Pcs"` on the picking card. Note: `Pcs` has no abbreviation in `ARTICLE_WORD_ABBR` yet and will render in full — cosmetic only, not a bug.
