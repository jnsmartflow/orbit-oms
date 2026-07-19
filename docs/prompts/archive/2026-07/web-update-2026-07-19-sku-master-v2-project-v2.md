# Session Update — sku_master_v2 project (flat SKU catalog) — REFRESHED
# 2026-07-19 · Drafted from the web planning chat · supersedes the earlier same-day draft
# Status: OPERATIONAL MIGRATION COMPLETE. Old sku_master now dead to all live operational code.
# For the consolidation pass: this is the single source of truth for this project.

---

## 0. Why this doc exists
The depot PC restarted mid-session; Claude Code lost context. This doc reconstructs the whole
project from the web side so a future Claude Code session can resume and consolidate into the
canonical `docs/CLAUDE_*.md` files without re-discovering anything. Everything here was
verified read-only against production or shipped + tested.

---

## 1. The project in one line
The app had **three** SKU-ish tables that had drifted apart. Goal: give the operational modules
ONE clean flat catalog, sourced from the good `mo_sku_lookup_v2` data, WITHOUT touching the
email parser.

The three tables (keep them straight — a recurring point of confusion):
1. `mo_sku_lookup` (v1) + keyword tables — the parser's engine for NORMAL typed emails.
   **OUT OF SCOPE. Never touched. Stays.** (The user sometimes calls the OLD `sku_master`
   "version one" — that is NOT this table. This one is the email parser's.)
2. `mo_sku_lookup_v2` — clean FLAT catalog read by `/po`, `/place-order`, `/order` + the
   app-email fast lane.
3. `sku_master` (OLD) — a NORMALISED table (+ 3 FK helper tables `product_category`,
   `product_name`, `base_colour`) formerly read by the operational modules. ~56% populated,
   scaffolding. **This is the table the project replaced.**

Locked decisions (do NOT re-litigate):
- Do NOT keep the normalised design. Single admin maintains the catalog via SQL/CSV, not form
  dropdowns, so the 3 FK helper tables add friction for no benefit → go FLAT.
- Build a NEW flat table `sku_master_v2` (mirror of `mo_sku_lookup_v2`), prove it, migrate all
  live readers, then — in a SEPARATE future session — drop old `sku_master` + its 3 FK tables
  and rename `sku_master_v2` → `sku_master`. That final swap is NOT done yet.
- The stable natural key everywhere is the SAP **material code** (`material` / `skuCodeRaw`),
  NOT any internal row-number id. This is the spine of every repoint.

---

## 2. WHAT IS LIVE (all shipped + tested this session, in order)

### 2a. Table built + filled — DONE
`sku_master_v2` created in Supabase and filled from `mo_sku_lookup_v2`.
- SQL: `docs/prompts/drafts/build-sku-master-v2-2026-07-19.sql` (run manually in Supabase).
- 17 columns = v2's 15, MINUS `containerType` (dead, no reader), PLUS `isActive` (NEW lifecycle
  flag) and `updatedAt` (NEW). Surrogate `id` Int PK + `material` unique (v2 pattern).
- Verified: 1743 in / 1743 out, diff 0. isPrimary carried unchanged (1391 primary / 352 not).
  0 blank required fields, 0 v2 materials missing.
- 25 retired TOOLS 645xxxx codes set `isActive = false` (they had only been flagged via
  `isPrimary = false` because v2 had no lifecycle flag). Their `isPrimary` left as-is.

### 2b. Prisma model added — DONE · commit 916fcd39 (schema → v27.11)
`model sku_master_v2` in `prisma/schema.prisma`, columns match the table exactly (no `@map`).
Both date columns carry `@db.Timestamptz(6)` (table uses `timestamptz`). `updatedAt` is
`DateTime?` with NO `@updatedAt` (hand-maintained by SQL).

### 2c. Catalog pipeline repoint — Option B · commit 8f606a88
User-facing catalog reads repointed to `sku_master_v2` BY `material` (SAP code), NOT by the FK id.
- Files: `app/api/import/obd/route.ts` (warning-gate reads #1/#4/#5 only),
  `app/api/picking/order/[orderId]/route.ts`, `app/api/orders/[id]/removed-lines/route.ts`,
  `app/(admin)/admin/page.tsx` (isActive tile).
- Smoke: order 9909 resolved 14/14, no blanks. Documented blank-pack landmine (SKU `5961032`,
  DN WS Metallic Gold 0.5L) now resolves to 500ML — FIXED.
- Tested on live picker phone: no visible change (correct — same descriptions for shared codes).

### 2d. Order-detail + support-order readers repointed — commit a227fb13
Found via a fresh sweep: TWO more live readers of the skuId bookmark that the earlier pass
missed — the shared **order-detail panel** (used by BOTH Tint Manager and Support) and its
unused twin route.
- Files: `app/api/orders/[id]/detail/route.ts` (real reader),
  `app/api/support/orders/[id]/route.ts` (live GET, no UI caller — repointed for consistency,
  shape PRESERVED per "Option A": still returns nested `sku:{skuCode,skuName}`, sourced from v2).
- Pattern: batched `sku_master_v2.findMany({ where:{ material:{ in: codes } } })`, resolve by
  `skuCodeRaw`, raw fallback preserved (incl. the `"—"` literal). isPrimary NOT filtered.
- Smoke: 49/49 recent lines resolved; a 4,000-line pass found 171 unresolved → all fell back to
  raw text, 0 blanks, 0 crashes. **Tested live by Smart Flow on both Tint Manager + Support —
  line items render correctly.**
- This also made the detail panel internally consistent (active + removed lines now both from v2).

### 2e. Enrichment cut off old sku_master — Option B · commit b91b7381
The two enrichment WRITE sites stopped depending on old `sku_master`. `prisma.sku_master` no
longer appears anywhere in `app/api/import/obd/route.ts`.
- Removed both old-table feeder reads + their maps (`skuByCode` :1073, `confirmSkuByCode` :2886 —
  confirmed used ONLY at the write object). `confirmSkuCodes` also removed as newly-dead.
- The `:1338` "manual confirm" site is the LEGACY `?action=confirm` handler (CLAUDE_IMPORT §9,
  "kept for backwards compat"); the live manual-SAP path (`handleManualSapConfirm`) delegates to
  `upsertObd()` and never wrote the bookmark. Both legacy + auto paths were cut.
- THREE fields keyed off the old-table lookup, not two: `skuId`, `lineWeight`, AND `note`
  ("Unknown SKU — manual mapping required"). All three now key off a single v2 truthiness:
    * `skuId: null` outright (column stays in schema for now; dropped in the future step).
    * `lineWeight: v2match ? 0 : null`  (NB: lineWeight is NOT a real weight — a matched line
      always stored literal 0, never a mass; `grossWeightPerUnit` was never in the schema. It is
      effectively a "recognised?" flag. Readers are display-only, tolerate null, no math/aggregation.)
    * `note: v2match ? null : "Unknown SKU — manual mapping required"`.
- BONUS FIX: preview gates already used v2, but confirm used old table → they disagreed on
  "Unknown SKU". Now both use v2 → preview and confirm AGREE for the first time.
- Auto path reuses the in-scope v2 `existingSkuSet` (no new query). Legacy path adds ONE
  `sku_master_v2.findMany` inside the existing `Promise.all` (no extra round trip, no $transaction).
- Verification across 703 distinct active SAP codes: 492 known by both, 92 by neither,
  **119 GAINED (v2 knows, old didn't → lineWeight null→0, note cleared), 0 LOST.** v2 is a strict
  superset here — nothing that resolved before stops resolving. Change is purely additive.

---

## 3. CURRENT STATE of old `sku_master` (the headline answer)
- **Import enrichment:** OFF it ✅
- **All operational screens** (picking, tint manager, support, removed-lines, order-detail): OFF it ✅
- **Admin SKU-edit CRUD pages** (`/api/admin/skus/*` + the 4 `skus/page.tsx` browse pages in
  admin/support/tint-manager/dispatcher): **STILL read it** ❌ — their own table, never the bookmark.

So old `sku_master` is **DEAD to all operational code**; the ONLY remaining live readers are the
admin catalog-edit pages (which the flat design retires anyway). The `skuId` column + relation
still physically exist (written null going forward, read by nothing live except 2 scratch scripts).

---

## 4. Coverage reality (expectation-setting)
The "~99%" figure quoted early is WRONG for imports — it's Table C's coverage of app-format EMAIL
lines (`CLAUDE_MAIL_ORDERS §4.1`), a different population. Against distinct ACTIVE raw SAP import
codes (~1,152): old sku_master ~57%, sku_master_v2 ~73%, ~27% (~309) in NEITHER. The repoint is a
real +16% gain; 309 codes still fall back to raw text. See §6 backlog.

---

## 5. FRIENDLY NAME ON PICKING CARD — DESIGNED + PROVEN, DEFERRED
Deferred by Smart Flow: unwilling to risk any misleading name until catalog odd-rows are cleaned.
Nothing built. Full recipe preserved so a future session builds without re-deriving:
- Intended column: `skuDisplayName String?` on `sku_master_v2`, STORED (filled once, reviewable).
- Built from columns already on the row (`category`, `product`, `baseColour`) — NO menu-table join.
- Caser: **`emailCase()`** (`lib/place-order/email.ts`) — NOT `smartTitleCase` (lowercases WS/VT/PU).
- Format: `"{shortFamily} {product} {base}"`, space-separated, ONE line, NO dot.
  * prefix skipped if product already contains the short family (de-dup guard)
  * STAINER: `{product} {base}` — no prefix, KEEP the base (colour is the pickable identity)
  * TOOLS: `{product}` only; append `″` when the final token is pure digits
- GENTLE de-double: collapse ONLY an exact adjacent repeat, and NEVER if it makes two different
  rows share a name (the aggressive rule collided the two PROMISE FREEDOM 2IN1 PRIMER rows — do
  not reinstate it).
- Approved family→short-code map (26 families): only 5 prefixes change output — Sadolin,
  Aquatech, VT on VT SPECIALTY, Distemper, Texture. PROMISE ENAMEL renders "Promise Enamel {base}".
  TILE + METALLIC → WS. STAINER/TOOLS = no prefix. No WEATHERSHIELD family exists (token is WS).
- Verified quality: 1,718 active rows → 499 identities → 496 distinct names. Only failures are
  the pre-existing catalog data quirks in §6B (SKU-code hero covers them on screen).
- Reference doc: `docs/prompts/drafts/code-discovery-2026-07-19d-picking-name-samples.md`.
- Resume plan: clean §6B rows → re-run 19d sampling to confirm zero misleading names → build in
  two steps: (1) add + fill `skuDisplayName` via reviewable SQL + Prisma model, (2) show it on the
  picking card as a muted reference line UNDER the SKU-code hero, fallback to `description`.
  Design locked: SKU code is hero, friendly name is reference only.

---

## 6. CATALOG-CLEANUP BACKLOG (separate data pass — its own careful job, own rollback)
**A. 309 unknown SAP codes** — active on bills, in NEITHER catalog table (§4). Overlaps
`CLAUDE_PICKING §7`. Smart Flow to review (obsolete vs never-mastered; needs Chandresh input).
Export prompt was drafted (unknown-sku-codes CSV export, sorted by frequency). Smart Flow chose to
pull this AFTER bills settle, at review pace.

**B. 7 odd Promise/duplicate rows** (surfaced by name generation; harmless clumsy names today):
- 3 pre-existing Promise SmartChoice DUPLICATE identities (same product modelled twice → names
  collide): Int Primer, Ext Primer, Acrylic Distemper.
- Bare "Promise" (PROMISE INTERIOR / product PROMISE / base PROMISE) — no product identity.
- Stutters: "Promise Primer Promise Primer", "Acrylic Distemper Duwel Acrylic Distemper".

---

## 7. Discovery / build artifacts produced (all in docs/prompts/drafts/)
- `build-sku-master-v2-2026-07-19.sql` — CREATE + POUR + discontinue (already run).
- `code-discovery-2026-07-19-flat-sku-master.md` — v2 vs old sku_master field/reader diff.
- `code-discovery-2026-07-19b-catalog-repoint.md` — id-space collision finding + Option B.
- `code-discovery-2026-07-19d-picking-name-samples.md` — friendly-name recipe + per-family samples.
- `code-discovery-2026-07-19g-detail-panel-repoint.md` — (if saved) detail-panel repoint spec.
- `code-discovery-2026-07-19h-skuid-reader-sweep.md` — the authoritative "skuId is write-only" sweep.
- NOTE: `code-discovery-2026-07-19f-...` was NEVER saved (session stopped at its stop-condition);
  19h supersedes it. A `19c` /po-name-tracing discovery was superseded by the build-from-columns
  approach and is not needed.

---

## 8. Landmines / gotchas to preserve into canonical docs
- **DO NOT "finish the migration" by repointing the `skuId` FK to sku_master_v2.** The two tables
  have DIFFERENT id numbers for the same code (verified ZERO overlap; a naive FK repoint mispoints
  ~2065 and dangles ~2935 of a 5000-row sample). The bookmark is retired by RESOLVING VIA `material`,
  never by moving the FK. Inline warning comments were left at the former read sites.
- **`import_enriched_line_items.skuId` is now written `null` and read by nothing live.** Two scratch
  scripts (`_diagnose-sku-5961032.ts`, `_diagnose-skuid-collision.ts`) are the only readers — outside
  the tsc gate, not runtime. They only matter at the eventual DROP COLUMN step.
- **`lineWeight` is not a weight** — it's a "recognised?" flag storing literal 0/null; display-only.
- **Tint `skuId` is a FALSE POSITIVE** — it aliases `rawLineItemId`, not a catalog id
  (`tint-operator-content.tsx:2479/2503`). Never repoint tint.
- **Confirmed non-readers of the catalog** (read the raw imported line, `skuDescriptionRaw`):
  Tint Manager/Operator, Delivery Challan, Sampling, Support board list, Warehouse, Trip Report.
- **Doc drift:** `CLAUDE_CORE.md` header/§7 chain still reads **v27.10**; the model landed as
  **v27.11** (916fcd39). Fold into the CORE pass at consolidation.
- **`CLAUDE_SAMPLING_LIBRARY §3` is wrong:** cites `sku_master.materialCode` (no such column — it's
  `skuCode`); no live Sampling code reads sku_master (only offline `scripts/normalise-sampling-data.ts`).
- **Admin SKU CRUD uses `prisma.$transaction`** (`app/api/admin/skus/route.ts:61`) — a pre-existing
  CORE §3 violation; retires with the admin surface, not fixed here.
- Scratch scripts left on disk (read-only, underscore-prefixed, outside tsc gate, uncommitted):
  `_diagnose-tools-645.ts`, `_diagnose-skuid-collision.ts`, `_smoke-picking-detail.ts`,
  `_smoke-order-detail-repoint.ts`, `_smoke-order-detail-fallback.ts`, `_smoke-enrichment-v2-recognition.ts`,
  `_diagnose-sku-5961032.ts`. Delete anytime.

---

## 9. Backlog snapshot
```
[x] sku_master_v2 built + verified (SQL run)
[x] Prisma model added (916fcd39, schema v27.11)
[x] Catalog pipeline repoint by material — Option B (8f606a88)
[x] Order-detail + support-order readers repointed (a227fb13, tested live)
[x] Enrichment cut off old sku_master (b91b7381) — old sku_master now DEAD to operations
[ ] Admin SKU-edit CRUD pages still read old sku_master — retire with the table
[ ] Catalog cleanup: 309 unknown codes + 7 odd Promise/dup rows
[ ] Friendly name on picking card (DEFERRED — recipe in §5, resume after cleanup)
[ ] FINAL retire-old-table session: drop old sku_master + 3 FK tables, drop skuId column+relation,
    retire admin CRUD surface, rename sku_master_v2 → sku_master, docs pass
    (CORE → v27.11, sampling §3 fix, remove the two _diagnose scripts that read skuId)
```

---

## 10. Consolidation guidance (for the canonical-file merge)
When consolidating into `docs/CLAUDE_*.md`:
- **CLAUDE_CORE.md:** add a "SKU catalog" note — `sku_master_v2` is the live operational catalog
  (flat, keyed by `material`); old `sku_master` + 3 FK tables are dead to operations, pending drop;
  bump the schema/version chain to reflect v27.11. Record the id-space landmine (§8) prominently.
- **CLAUDE_IMPORT.md:** enrichment now resolves recognition/lineWeight/note via `sku_master_v2` by
  `material`; writes `skuId: null`; no longer reads old `sku_master`. Preview + confirm now agree.
- **CLAUDE_PICKING.md:** picking detail resolves names/pack via `sku_master_v2` by `material`
  (fallback to raw). Blank-pack §7 landmine reduced (not eliminated — 309 unknowns remain).
  Note the deferred friendly-name feature + its recipe pointer.
- **CLAUDE_SAMPLING_LIBRARY.md:** fix the §3 `materialCode`→`skuCode` error; note no live reader.
- Archive the superseded first same-day draft; this refreshed doc is the one to consolidate from.

*Refreshed from the web planning chat, 2026-07-19. No code or DB state changed by writing this doc.*
