# Planning Update — GLOSS Brilliant White Generic-as-Fini cleanup + full mo_sku_lookup audit
Session date: 2026-04-28
Session type: planning + diagnosis + data UPDATE/DELETE
Target files: docs/CLAUDE_MAIL_ORDERS.md §17 (pending items), docs/web-update-2026-04-23-generic-code-backfill.md (29-rows-pending list)
Implementation status: complete — 4 wrong rows deleted, 4 Fini rows updated with Generic refs, 2 pending lines re-pointed, 56 historical punched lines intentionally left as-is

## DECISION SUMMARY
Diagnosed and fixed a production enrichment bug where "Gloss Brilliant White" emails were returning IN28401xxx (Generic codes) instead of IN28301xxx (Fini codes). Root cause was 4 Generic codes mistakenly inserted as standalone rows in `mo_sku_lookup.material` instead of being stored as `refMaterial` values against the corresponding Fini rows — same pattern as the "63 conflicts" wiped in the April-23 generic-code-backfill session, but unlike those, these rows had survived as full standalone rows. Fix: deleted 4 IN28401xxx rows, populated `refMaterial` + `refDescription` on the 4 matching IN28301xxx Fini rows. Also ran a full table-wide audit on the CSV export (1,603 rows) which surfaced 131 combo-key collisions in 5 distinct pattern types — 9 of them T1 Generic-as-Fini (4 fixed today, 5 deferred pending Fini direction confirmation), 11 T2 WHITE BASE base-classification confusion (deferred), 81 T3 product rebadges (large bucket, business decision needed per family), plus T4 baseColour-empty multi-colour catalogues and 23 OTHER mixed cases.

## CONTEXT CHANGES

### Production table counts are now
- mo_sku_lookup: 1,599 rows (was 1,603; −4 from the 4 IN28401xxx Generic-as-Fini deletions)
- mo_product_keywords: unchanged
- mo_base_keywords: unchanged

### GLOSS Brilliant White rows now correctly structured
7 IN28301xxx Fini rows survive (1L, 4L, 10L, 20L, 100ML, 200ML, 500ML). Of those, 4 now have refMaterial populated with the IN28401xxx Generic code:
- IN28301072 (1L) → refMaterial IN28401072
- IN28301071 (4L) → refMaterial IN28401071
- IN28301081 (20L) → refMaterial IN28401081
- IN28301073 (500ML) → refMaterial IN28401073

3 still have null refMaterial (10L IN28301082, 100ML IN28301098, 200ML IN28301074) — Generic codes for these packs not yet supplied by depot.

### "29 rows pending Generic codes" list drops from 29 → 25
Per web-update-2026-04-23-generic-code-backfill.md NEW PENDING ITEMS section. The 4 GLOSS rows that were sitting on that list (Brilliant White 1L/4L/20L/500ML) are now resolved — the Generic codes existed all along, they were just stored in the wrong column. Remaining 25 rows still pending: GLOSS 10L/100ML/200ML, plus SUPERCLEAN (5), WS MAX (5), SADOLIN INT CLR 2KPU SEALER (3), and 12 other singletons.

### Re-enrich endpoint scope confirmed: recent/active orders only
`/api/mail-orders/re-enrich` reported `{total: 227, updated: 6, unchanged: 221, ordersRecalculated: 5}` against 58 historical lines that referenced the wrong skuCodes. The 6 updated lines were unrelated. Of the 58 affected lines: 56 belonged to already-punched orders (status='punched', endpoint deliberately skips), 2 belonged to pending orders that the endpoint missed for reasons unclear. The 2 pending lines (id 1081 Ravi Patel, id 3407 Surat Order) were fixed via targeted UPDATE. The 56 punched lines were intentionally left untouched — SAP is the source of truth for what was actually punched/dispatched, rewriting mo_order_lines retroactively could create reconciliation mismatches.

### mo_sku_lookup has no composite uniqueness on (product, baseColour, packCode)
Schema only enforces UNIQUE on `material`. Two rows can legally share the same combo key. enrich.ts buildSkuMaps (L270–286) deduplicates these into byCombo (first-seen wins) and byComboAlt (loser, never selected as candidate). Without `ORDER BY` on the SKU fetch, fetch order is non-deterministic — winner depends on Postgres physical-row ordering. This is the structural root cause for any combo-key collision: the engine cannot disambiguate, the schema doesn't prevent the collision in the first place.

### refMaterial is informational-only in enrich.ts
Confirmed at L466 and L803 — refMaterial is read into output as refSkuCode, never used for filtering, dedup, or candidate selection during scoring. Adding/changing refMaterial has zero impact on which SKU enrichment returns. Same finding as April-23 backfill.

### Audit pattern taxonomy (full table-wide combo-collision survey)
Ran combo-key collision detection on full CSV export (1,603 rows). Found 131 collisions affecting 302 rows. Classified into 5 patterns:
- T1 Generic-as-Fini standalone duplicates: 9 combos. Identical normalised description, both refMaterial empty, single-digit material-code typo pattern. The GLOSS pattern. 4 fixed today; 5 deferred (ALKALI BLOC PRIMER, DIAMOND GLO BW 1L, DUWEL INTERIOR ACRYLIC PRIMER, PROMISE PRIMER, PROTECT YELLOW BASE 18L, WOOD FILLER) pending Fini direction confirmation per combo. SAP convention seems to be xxx72 (Fini) vs xxx23 (Generic) for IN-prefix codes, but needs verification.
- T2 WHITE vs WHITE BASE base-classification confusion: 11 combos. Rows describing tint-machine 90 BASE incorrectly assigned baseColour='BRILLIANT WHITE'. Fix path: reclassify to baseColour='90 BASE'. Affected products: 5IN1, GLOSS, IAE PROJECT, LUSTRE (4 packs), MAX, PROMISE EXTERIOR, WS PRIMA E900, WS PROJECT.
- T3 Old vs New product rebadge: 81 combos, 162 rows. SAP issued new material codes for refreshed product lines, both old and new coexist as legitimate Finis. Major rebadges: MAX→MAX 10YR (14 combos), POWERFLEXX→PF 15YR (23), PROTECT RAINPROOF→RP 8YR (9), AQUATECH WBC→WBC NEW (4), SCN 3IN1→3IN1 MARK RESISTANT (7), SUPERCLEAN→SUPERCLEAN NEW (~13), PROMISE EXT/INT (~5), FLOOR PLUS→WS FLOORPLUS (4), LUSTRE white shades (~3), other (~2). Each requires a depot-side decision per product family on which code engine should return. Recommend separate session: query last 30 days of import_raw_line_items to see which codes dispatch actually uses today, then choose primary per family.
- T4 baseColour='' multi-colour catalogue: 7 combos. AUTO STAR (29 rows base=''), COLORANT (4 rows), VAF (3 rows), BRUSH (2 rows), ROLLER (4 rows). Not duplicates — base classification gap. AUTO STAR has named whites (Casablanca/Crystal/Francoise/Milky/etc.) all collapsed under BRILLIANT WHITE. Out of scope for Generic-vs-Fini cleanup.
- OTHER 23 combos: mixed bag — case-by-case review needed. Notable: DIAMOND GLO 92/94 BASE has T1 shape but with one side already linked; PROMISE EXTERIOR/INTERIOR mixes T1 and T3; FLOOR PLUS DULUX vs DULUX WS may be genuine product variants (solvent vs water-based).

### CHECK D (single-digit material-code typo) signal is too noisy on its own
Ran in audit, returned 62 hits — most were AUTO STAR sequential SAP codes for genuinely different colours (each colour gets the next material code), not typos. Only useful when intersected with combo-collision + identical-description (refined CHECK D), which produced 5 high-confidence T1 candidates: 4 GLOSS + 1 PROTECT YELLOW BASE 18L + 1 SADOLIN WOOD FILLER WHITE 1KG.

## NEW PENDING ITEMS

### T1 cleanup — 5 remaining Generic-as-Fini combos | owner: next reference-data session | blocker: need Fini direction per combo
Combos awaiting Fini-vs-Generic confirmation before SQL:
- ALKALI BLOC PRIMER 1L: id 275 IN32600023 (LT) vs id 1216 IN32600072 (L)
- DIAMOND GLO BRILLIANT WHITE 1L: id 801 IN30700072 (LT) vs id 1312 IN30700023 (L)
- DUWEL INTERIOR ACRYLIC PRIMER 1L: id 65 IN32316872 (LT) vs id 1265 IN32316823 (L)
- PROMISE PRIMER 1L: id 286 IN84500072 (LT) vs id 1287 IN84500023 (L)
- PROTECT YELLOW BASE 18L: id 1390 IN36309881 vs id 1400 IN36409881
- WOOD FILLER BRILLIANT WHITE 1L: id 599 IN35203003 vs id 1309 IN35202003

If the SAP convention "xxx72 = Fini, xxx23 = Generic" holds for IN-prefix codes, that resolves 4 of the 5 (DIAMOND GLO, DUWEL, PROMISE PRIMER, ALKALI BLOC). PROTECT and WOOD FILLER use different code shapes and need explicit confirmation.

### T2 cleanup — 11 WHITE BASE base-classification reclassifications | owner: next reference-data session | blocker: none
Update baseColour from 'BRILLIANT WHITE' to '90 BASE' on 11–14 rows where description says "WHITE BASE" (the tint-machine 90 base, not finished white). After reclassification, combo collisions for these rows disappear and enrich.ts BW→90 BASE equivalence handles the matching. Specific rows listed in audit findings under T2.

### T3 product-rebadge resolution — 81 combos, 162 rows | owner: depot-side business decision per product family | blocker: business input needed
Each product family that has both old and new SAP codes needs a primary chosen for enrichment to return. Process: pull last 30 days of dispatched material codes from import_raw_line_items per product family, present to Prakashbhai, decide. Output is per-family — keep one, mark the other inactive somehow (likely add isActive column to mo_sku_lookup first, or keep the chosen one and remove the loser via DELETE if depot confirms it's no longer used). Estimated 10+ product families.

### Add isActive column to mo_sku_lookup | owner: schema-change session | blocker: none
Constraints repeatedly want "mark inactive, never delete" but column doesn't exist. Add `isActive Boolean @default(true)` via Supabase SQL Editor → schema.prisma → prisma generate. Defer DELETE on T3 losers until isActive lands. Pattern matches the April-23 refDescription column add — additive nullable column, fully safe, no migrate needed.

### Composite uniqueness on (product, baseColour, packCode) | owner: future schema decision | blocker: none — but high blast radius
Adding UNIQUE (product, baseColour, packCode) would prevent any future combo collision at schema level. But the existing 131 collisions would have to be cleaned up first or the constraint would fail to apply. Worth discussing once T1, T2, T3 are resolved.

## SESSION ARTEFACTS
- Audit script (Python on CSV export) — kept locally, not in repo. Methodology: combo-key collision detection + 5-pattern classifier (T1 normalised-desc match + empty refs, T2 WHITE BASE regex, T3 rebadge keywords list, T4 multi-colour product list, OTHER catch-all).
- SQL run: 4 UPDATEs on mo_sku_lookup (populate refMaterial + refDescription on 283 Fini rows), 1 DELETE removing 4 IN28401xxx rows, 2 targeted UPDATEs on mo_order_lines (line 1081 + 3407 pending lines re-pointed to Fini code).
- Re-enrich invocation: from logged-in browser console, response {total: 227, updated: 6, unchanged: 221, ordersRecalculated: 5}.

## NEXT SESSION CANDIDATES
1. T1 batch cleanup — confirm Fini direction for remaining 5 combos, run SQL, update web-update-2026-04-23-generic-code-backfill.md "29 rows pending" list accordingly
2. T2 WHITE BASE batch reclassification — UPDATE baseColour='90 BASE' on 11–14 rows
3. Add isActive column to mo_sku_lookup before tackling T3
4. T3 first family — pick MAX (most rows, 14 combos) and resolve old vs new codes via dispatch-data pull

---

*Draft saved to docs/prompts/drafts/web-update-2026-04-28-gloss-bw-generic-cleanup.md*
