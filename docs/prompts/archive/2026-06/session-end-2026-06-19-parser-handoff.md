# Session Handoff — 2026-06-19

## Done & live this session
- **Alt-SKU feature SHIPPED + pushed to main (live on orbitoms.in).**
  - Backend: `/api/mail-orders` attaches `altSkus` per line from `mo_sku_lookup_v2` (combo siblings), display-time, additive, ~99.7% v2 coverage, `[]` on miss. No engine/billing change.
  - Frontend (`review-view.tsx`, **Focus mode only**): "ALT SKU" column + click modal listing billed (primary) + alternates with per-row copy-to-clipboard. Chip recoloured to neutral **grey** (no teal/amber).
  - Mockup (locked + synced): `docs/mockups/mail-order/alt-sku-modal-mockup.html`.
  - Commits: `7451c1e9` (table-c builder + dump), `ba808762` (loader/altSkus), `eeff7d2a` (ALT UI), + colour/modal/header polish commit. All pushed.
- **Table C built but NOT wired** — `lib/mail-orders/table-c.ts`: `buildTableC()` (exact-match dict, dormant), `tableCKey()`, `cleanPackCode()`, `buildComboSiblings()` (live, feeds alt list). Dump verified: 1343 keys, 0 orphans, 15 collisions (13 real double-primaries + 2 pack-rounding artifacts).

## The plan in plain terms
Goal: every order email → correct SKU. **App orders 100%** (clean door = exact-match dictionary). **Typed emails best-effort** (messy door = keyword/shorthand map). Build one shared lookup, then switch to it. Stage 1 done; in Stage 2; Stage 3 = the final switch (explicit go-ahead).

## Remaining threads (priority order)
1. **Parser format + keyword health** (next session — see below).
2. **Table C fast-path wiring** — switch on the exact-match dict in `enrichLineCore` (after material-code check, before keyword mode), exclude the 15 collisions. App orders → 100%.
3. **13 double-primary fix** — pick keeper per pair → add loser material to `SET_FALSE` in `scripts/v2-sku-seed-from-legacy.ts` + flip in Supabase. Precursor to a clean fast-path.
4. **Table-mode parity** — add ALT SKU column to the "Table" view (`mail-orders-table.tsx`); only Focus has it. Small/optional.
5. **Housekeeping** — uncommitted working-tree junk (`.claude/settings.local.json`, docs/ deletions/xlsx) — review/clean deliberately.

---

## NEXT SESSION — Parser: app format + current format (both)
The parser must handle the **new app format AND every current format** — additive, nothing old breaks (hard rule: zero silent email disappearance).

**App format reference:**
- Header block at top (skip-as-product, capture as fields): `Customer:` (always), `Dispatch:`, `Remark:`, `Ship To:`, `Note:` — closed set, all optional except Customer.
- `Bill N` markers for multi-bill orders (single-bill has no marker).
- Product line: `NAME [BASE] PACK*QTY, PACK*QTY, …` (multi-pack per line, raw uppercase names).

**Two doors (keep distinct):**
- Table C = exact match, app orders only.
- Keyword map = shorthand for typed emails. Already exists in legacy tables (`mo_product_keywords` ~1,076, `mo_base_keywords` ~267). Must be preserved into the v2/shared layer at Stage 3, and topped up with newly-observed shorthand.

**Checklist:**
```
[ ] 1. Health-check: current parser vs new app format + find missing shorthand (read-only)
[ ] 2. Teach parser the app layout — skip/capture headers, split Bill N (additive)
[ ] 3. Top up the shorthand/keyword map with gaps found
[ ] 4. Test on real sample emails — app + typed — nothing old breaks
[ ] 5. Deploy updated script to depot PC + verify a Task Scheduler run
```

**To share at session start:**
1. Mail parser PowerShell script — path on depot PC (not in repo) or pasted.
2. 2–3 real app-format emails (with Note/Dispatch/Remark; include one multi-bill).
3. 2–3 real typed/dealer emails (messy human kind) for regression.
4. `CLAUDE_MAIL_ORDERS.md` (already in project).

**Workflow note:** parser is NOT in the repo. Step 5 = manual copy to depot PC (no Vercel deploy); runs via Task Scheduler every 10 min — test before swap.
