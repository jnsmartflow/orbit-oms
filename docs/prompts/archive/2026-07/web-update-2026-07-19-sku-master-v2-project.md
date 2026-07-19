# Session Update — sku_master_v2 project (flat SKU catalog)
# 2026-07-19 · Drafted from the web planning chat (depot PC shut down mid-session; Claude Code lost context)
# Status: core work SHIPPED & LIVE. Friendly-name feature DESIGNED + PROVEN but DEFERRED.

---

## 0. Why this doc exists

The depot PC restarted, so Claude Code no longer holds this session's context.
This doc reconstructs the entire session from the web side so any future Claude Code
session can resume without re-discovering anything. Nothing here needs re-proving —
the discovery was done and verified read-only against production.

---

## 1. The project in one line

The app had **three** SKU-ish tables that had drifted apart. Goal: give the operational
modules ONE clean flat catalog, sourced from the good `mo_sku_lookup_v2` data, without
touching the email parser.

The three tables (keep them straight):
1. `mo_sku_lookup` (v1) + keyword tables — the parser's engine for NORMAL typed emails.
   **OUT OF SCOPE. Never touched. Keep it.**
2. `mo_sku_lookup_v2` — clean FLAT catalog read by `/po`, `/place-order`, `/order` +
   app-email fast lane.
3. `sku_master` (OLD) — a NORMALISED table (+ 3 FK helper tables: `product_category`,
   `product_name`, `base_colour`) read by the operational modules. ~56% populated,
   scaffolding, only import-enrichment + picking read it.

Decision (locked, do not re-litigate): the normalised design is NOT kept. The catalog is
maintained by a SINGLE admin via SQL/CSV, not by form dropdowns, so the 3 FK helper tables
buy nothing and add friction. Go FLAT.

Chosen path: build a NEW flat table `sku_master_v2` (mirror of `mo_sku_lookup_v2`), prove
it, and — in a SEPARATE future session — drop the old `sku_master` + its 3 FK tables and
rename the new table to `sku_master`. That final swap is NOT done yet.

---

## 2. WHAT IS LIVE (shipped this session)

### 2a. New table built + filled — DONE
`sku_master_v2` created in Supabase and filled from `mo_sku_lookup_v2`.
- SQL file: `docs/prompts/drafts/build-sku-master-v2-2026-07-19.sql` (run manually in Supabase).
- 17 columns = v2's 15, MINUS `containerType` (dead, no reader), PLUS `isActive` (lifecycle
  flag, NEW) and `updatedAt` (NEW). Kept surrogate `id` Int PK + `material` unique (v2 pattern).
- Verified: 1743 rows in / 1743 out, difference 0. isPrimary carried across unchanged
  (1391 primary / 352 non-primary both sides). 0 blank required fields, 0 v2 materials missing.
- Discontinued: the 25 retired TOOLS 645xxxx brush/roller codes set `isActive = false`
  (they were previously flagged via `isPrimary = false` only because v2 had no lifecycle flag).
  `isPrimary` left as-is on those 25 (untangling isPrimary is a separate reversible follow-up).

### 2b. Prisma model added — DONE
`model sku_master_v2` added to `prisma/schema.prisma`. Column names match the table exactly
(no `@map`). Both date columns carry `@db.Timestamptz(6)` (the table uses `timestamptz`;
without this Prisma would silently mismatch). `updatedAt` is `DateTime?` with NO `@updatedAt`
(hand-maintained by SQL, not auto-stamped).
- Commit: **916fcd39** (schema bumped to v27.11 in the commit message).

### 2c. Catalog pipeline repointed — DONE (Option B)
The user-facing catalog reads were repointed to `sku_master_v2` **by `material`** (the SAP
code), NOT by the internal FK id. This is "Option B" from the repoint diagnosis.
- Commit: **8f606a88** (4 files, staged by name).
- Files changed: `app/api/import/obd/route.ts` (the 4 warning-gate reads #1/#4/#5 only),
  `app/api/picking/order/[orderId]/route.ts`, `app/api/orders/[id]/removed-lines/route.ts`,
  `app/(admin)/admin/page.tsx` (isActive count tile).
- Rollback = `git revert 8f606a88` (one commit; no data/schema/FK touched).
- Smoke-tested read-only: order id=9909 resolved 14/14 lines, no blanks. The documented
  blank-pack landmine (SKU `5961032`, DN WS Metallic Gold 0.5L) now resolves to 500ML —
  fixed, not just reduced.
- Tested on the live picker phone by Smart Flow: no visible change (correct — both tables
  hold the same long description for shared codes; the change is under the hood).

### 2d. CRITICAL COUPLING — why import #2/#6/#3/#7 were LEFT on the old table
`import_enriched_line_items.skuId` is an `Int?` FK → `sku_master.id`. When `sku_master_v2`
was poured, rows got FRESH serial ids. Verified against production: there is ZERO overlap —
at NO id do the old and new tables hold the same material code (0 same-id-same-code across
the whole id space; a naive FK repoint would mispoint 2065 and dangle 2935 of a 5000-row
sample). So the FK must NOT be repointed.

Consequence for import enrichment (all in `app/api/import/obd/route.ts`):
- Reads #2 (:1055-1058) and #6 (:2861-2864) are the ONLY source of the id that write sites
  #3 (:1327) and #7 (:3125) write into `skuId`. They are coupled — you cannot move #2/#6 to
  the new table while #3/#7 still write into the old-table FK, or you create NEW mispointing
  rows on every future import.
- Therefore #2/#6 STAY reading old `sku_master`, and #3/#7 keep writing the OLD skuId.
  Only the pure warning-gate reads (#1/#4/#5, which build a `Set<string>` on skuCode and
  write nothing) moved to the new table.
- `skuId` is now effectively vestigial (written, not read for display) but LEFT INTACT —
  it preserves the audit trail and keeps rollback a one-commit revert. Decommission it in
  the same future session that drops old `sku_master`. **Do NOT "finish the migration" by
  moving #2/#6 — that is the corruption trap.** Inline warnings were left at :1055 and :2861.

---

## 3. Coverage reality (important expectation-setting)

The "~99% coverage" figure quoted early on is WRONG for the import population — it belongs
to Table C's coverage of app-format EMAIL lines (`CLAUDE_MAIL_ORDERS.md §4.1`), a different
population. Measured against distinct ACTIVE raw SAP import codes (1,152 total):
- resolvable in OLD `sku_master`   : 660 (57%)
- resolvable in NEW `sku_master_v2`: 843 (73%)
- in NEITHER                        : 309 (27%)

So the repoint is a real **+16% (+183 codes)** improvement, but **309 codes (27%) still
resolve to nothing** and fall back to raw SAP text. The blank-pack symptom is REDUCED, not
eliminated. Those 309 codes are the catalog-cleanup backlog (see §6).

---

## 4. FRIENDLY NAME ON PICKING CARD — DESIGNED + PROVEN, then DEFERRED

**Smart Flow deferred this on 2026-07-19.** Reason: unwilling to risk ANY misleading product
name on the picking card. Until the catalog odd-rows (§6) are cleaned, picking keeps showing
the long `description` as-is. **Nothing was built — no column added, no picking code changed.**

The design and recipe are fully proven, so a future session can build without re-deriving:

### 4a. Design (locked)
On the picking detail card the **SKU code is the HERO** (big, mono — it's the matching key).
The friendly name is ONE small muted REFERENCE line beneath it. Confirmation, not headline.
(Matches `CLAUDE_PICKING.md §5` "SKU is the matching key; product name is confirmation after".)

### 4b. Intended column
`skuDisplayName String?` on `sku_master_v2` — a STORED column, filled once via reviewable SQL
(so every name is eyeballed before it shows; picker stays a simple read). NOT built live.

### 4c. The proven naming recipe
Build from columns ALREADY on the row (`category` = family, `product`, `baseColour`).
**NO menu-table join** (that avoids the `mo_order_form_index_v2` mis-join landmines entirely).

- Caser: **`emailCase()`** from `lib/place-order/email.ts` — NOT `smartTitleCase()`.
  smartTitleCase is built for customer names and lowercases paint codes (Ws/Vt/Pu/Gva);
  emailCase keeps WS/VT/PU/GVA/YOX uppercase and handles 1K/5IN1/5MM. Gets ~1 row wrong in
  the whole catalog vs ~a third for smartTitleCase.
- Format: `"{shortFamily} {product} {base}"` — space-separated, ONE line, **no dot/separator**.
  (The `·` dot is a `/po` thing, not used here.)
- Prefix skipped if `product` already contains the short family code (de-dup guard).
- STAINER: `"{product} {base}"` — NO prefix, KEEP the base (base is the pickable colour).
- TOOLS: `"{product}"` only (baseColour is ''); append `″` when the final token is pure digits.
- GENTLE de-double: collapse ONLY an EXACT adjacent repeated word (e.g. "Promise Promise" →
  "Promise"), and NEVER if the removal would make two different rows share a name.
  **Do NOT reinstate the aggressive rule** — it collided the two PROMISE FREEDOM 2IN1 PRIMER
  rows into one identical name. The gentle rule keeps distinct SKUs distinct.
- NEVER put the SAP material code in the name.

### 4d. Approved family → short-code map (26 families, 1,718 active rows)
Only 5 prefixes actually change output (the rest de-dup to a no-op because the family word is
already inside the product). The 5 that matter: **Sadolin** (all 33 products), **Aquatech**
(19/20), **VT** on VT SPECIALTY (4/9), **Distemper** (Magik), **Texture** (Matt).

| family | short code / treatment |
|---|---|
| WS | WS (no-op — products already start WS) |
| PROMISE | Promise (no-op) |
| GLOSS | Gloss (no-op) |
| SADOLIN | Sadolin (FIRES — all products) |
| VELVET TOUCH | VT (no-op) |
| SUPERCLEAN | SuperClean (no-op) |
| SUPERCOVER | SuperCover (no-op) |
| SATIN | Satin (no-op) |
| STAINER | *(no prefix, keep base)* |
| AQUATECH | Aquatech (FIRES — 19/20) |
| PRIMER | Primer (no-op) |
| PROMISE ENAMEL | Promise Enamel → renders "Promise Enamel {base}" |
| FLOOR PLUS | Floor Plus (no-op) |
| VT SPECIALTY | VT (FIRES — 4/9) |
| TOOLS | *(product only + inch mark)* |
| PU ENAMEL | PU (no-op) |
| LUSTRE | Lustre (no-op) |
| PROMISE INTERIOR | Promise (no-op) |
| DISTEMPER | Distemper (FIRES — Magik) |
| SPRAY PAINT | Spray (no-op) |
| TILE | WS (renders "WS Tile {base}") |
| TEXTURE | Texture (FIRES — Matt) |
| METALLIC | WS (renders "WS Metallic {base}") |
| PUTTY | Putty (no-op) |
| PROMISE EXTERIOR | Promise (no-op) |
| SMOOTHOVER | Smoothover (no-op) |

Note: no `WEATHERSHIELD` family exists — the live token is `WS`.

### 4e. Verified output quality
1,718 active rows → 499 distinct product identities → 496 distinct names. Reads clean across
all families. Only failures are pre-existing catalog data quirks (see §6), which the SKU-code
hero covers on screen. TOOLS inch mark fires on 20/31 (only when final token is pure digits).

### 4f. Resume plan when un-deferred
1. Clean the catalog odd-rows (§6).
2. Re-run the 2026-07-19d sample generation to confirm zero misleading names.
3. Build in two steps: (1) add + fill `skuDisplayName` via reviewable SQL, then Prisma model
   + `npx prisma generate`; (2) show it on the picking card as a muted reference line under
   the SKU-code hero, fallback to `description`.

---

## 5. Discovery docs produced this session (all in docs/prompts/drafts/)
- `code-discovery-2026-07-19-flat-sku-master.md` — v2 vs sku_master field/column diff, readers.
- `code-discovery-2026-07-19b-catalog-repoint.md` — the id-space collision finding + Option B.
- `code-discovery-2026-07-19d-picking-name-samples.md` — the name recipe + per-family samples.
- `build-sku-master-v2-2026-07-19.sql` — the CREATE + POUR + discontinue SQL (already run).
- (A `19c` /po-name-tracing discovery was superseded by the build-from-columns approach and
  is not needed — the friendly name is built from sku_master_v2 columns, NOT a /po join.)

---

## 6. CATALOG-CLEANUP BACKLOG (blocks the friendly-name build)
Fix these as a SEPARATE data pass (editing live catalog rows — its own careful job, its own
rollback). They are why the friendly name was deferred.

**A. 309 unknown SAP codes** — active on bills but in NEITHER catalog table (see §3). Overlaps
the existing `CLAUDE_PICKING.md §7` backlog. Smart Flow to review which are obsolete vs
never-mastered (needs Chandresh/depot input). Export prompt provided separately.

**B. 7 odd Promise/duplicate rows** (surfaced by the name generation):
- 3 pre-existing Promise SmartChoice DUPLICATE identities (same product modelled twice → the
  names collide): Int Primer, Ext Primer, Acrylic Distemper.
- Bare "Promise" (PROMISE INTERIOR / product PROMISE / base PROMISE) — no product identity.
- Stutter rows: "Promise Primer Promise Primer", "Acrylic Distemper Duwel Acrylic Distemper".

---

## 7. Other landmines / notes captured
- **Doc drift:** `CLAUDE_CORE.md` header/§7 chain still reads **v27.10**; the `sku_master_v2`
  model landed as **v27.11** (commit 916fcd39). Fold into a CORE pass at next consolidation.
- **`CLAUDE_SAMPLING_LIBRARY.md §3` is wrong:** cites `sku_master.materialCode` as a source of
  truth. No such column (it's `skuCode`), and no live Sampling code reads `sku_master` at all
  (only the offline `scripts/normalise-sampling-data.ts`). Fix in a docs pass.
- **Tint is NOT a catalog reader** — the `skuId` in tint code aliases `rawLineItemId`, not a
  catalog id (`components/tint/tint-operator-content.tsx:2479`). Do NOT repoint tint.
- **Confirmed non-readers of the catalog:** Tint Manager/Operator, Delivery Challan, Sampling,
  Support board, Warehouse, Trip Report. They read the raw imported line (`skuDescriptionRaw`).
- Scratch scripts left on disk (read-only, underscore-prefixed, outside tsc gate, uncommitted):
  `_diagnose-tools-645.ts`, `_diagnose-skuid-collision.ts`, `_smoke-picking-detail.ts`.
  Delete anytime.

---

## 8. Current backlog snapshot
```
[x] sku_master_v2 built + verified (SQL run)
[x] Prisma model added (916fcd39, schema v27.11)
[x] Catalog pipeline repointed by material — Option B (8f606a88, live, tested)
[ ] Catalog cleanup: 309 unknown codes  +  7 odd Promise/dup rows
[ ] Friendly name on picking card (DEFERRED — recipe in §4, resume after cleanup)
[ ] FUTURE: drop old sku_master + 3 FK tables, rename sku_master_v2 → sku_master,
    decommission the vestigial skuId, docs pass (CORE v27.11, sampling §3 fix)
```

*Drafted from the web planning chat, 2026-07-19. No code or DB state was changed by writing this doc.*
