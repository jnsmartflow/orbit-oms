# Session-end summary — 2026-05-08 — Stage B (schema migration design)

**Save to:** `docs/prompts/drafts/session-end-2026-05-08-stage-b-design.md`

---

## TL;DR for fast context restore

Stage B of the OrbitOMS taxonomy migration is **complete**. All 11 open questions from Stage A's final report (§11) were walked through one at a time, locked with explicit approval, and consolidated into a single planning document.

Stage B was design-only. **Zero DB writes, zero code changes, zero schema changes** this session. The deliverable is a planning doc that captures the locked decisions and serves as Stage C's primary input.

The single artifact Stage C needs to read is `docs/prompts/drafts/stage-b-design-2026-05-08.md`.

Stage C (data migration design) is the next stage. It is **NOT started** — explicitly deferred to a fresh session per the multi-stage plan.

---

## What was decided this session

All 11 questions from Stage A's §11 are now locked. Compact summary:

| # | Question | Decision |
|---|---|---|
| Q1 | Implicit FK reliability between `mo_product_keywords.product` and `mo_sku_lookup.product` | **Reliable.** SQL audit showed 1 forward-drift case (VT). No design change; cleanup deferred to Stage G. |
| Q2 | What happens to `mo_product_keywords.product` after the split | **Mirror the SKU side.** Add `subVariant TEXT NULL` to keyword table. NULL = wildcard. |
| Q3 | What lands in `mo_order_lines.productName` after the split | **Compound string.** `${product} ${subVariant}` with single space, NULL-safe. No new column on `mo_order_lines`. |
| Q4 | Typeahead behaviour after the split | **Add `subVariant` to `where` field list.** One-line change in `app/api/mail-orders/skus/route.ts`. |
| Q5 | `mo_product_keywords.category` | **Out of scope. Don't touch.** Defer to Stage G after non-Next.js audit. |
| Q6 | Re-evaluating 99 literals + 22 regexes in `taxonomy-mapping.ts` | **Rewrite in Stage F.** Mechanical translation; ~15-18 of 22 regexes collapse to exact equality. |
| Q7 | Composite key shape | **4-part:** `${product}|${subVariant ?? ""}|${baseColour ?? ""}|${packCode}`. |
| Q8 | Cross-table join — does form-index align with `product` or `subVariant`? | **Form-index gets its own `variant` column.** Three-field exact-match join. Tile granularity preserved. |
| Q9 | `EnrichResult` shape | **Carries `subVariant` separately.** Optional rename `productName` → `product`. Caller composes compound for persistence. |
| Q10 | Parser `carryProduct` hint | **Stays as one string.** Server-side split on entry. PowerShell parser unchanged. |
| Q11 | Alignment with `sku_master.subSku` | **Stay independent forever.** No FK, no naming alignment, no data-sync. |

---

## Critical mid-session correction (Q8)

My initial Q8 recommendation (Option A — collapse tiles to "product only" and push variant into the pack panel) was **wrong**. Smart Flow caught it via real screenshots showing how operators search today.

The screenshots demonstrated that operators need fully-disambiguated tiles ("Luxurio PU Matt — 90", "WS Max — 92") to identify which item to pick. Collapsing tiles would have made operator workflow worse, not better.

Revised Q8 (Option C — split form-index columns with three-field join) is the locked answer:
- Tile granularity stays at today's level
- Three-field exact-match join replaces the May 2026 string-equality match
- `displayName` becomes a free-form display label, fully decoupled from the join
- Future taxonomy redesigns can rename display strings freely without breaking pack-panel rendering

This was the structural fix the migration was always aiming at — but the path through tile granularity required Smart Flow's domain knowledge to course-correct.

---

## Schema changes locked

Three new columns. That's the entire schema change.

| Table | Column | Type | Nullable |
|---|---|---|---|
| `mo_sku_lookup` | `subVariant` | TEXT | YES |
| `mo_product_keywords` | `subVariant` | TEXT | YES |
| `mo_order_form_index` | `variant` | TEXT | YES |

Plus matching unique-constraint widening on each (verify exact constraint shape in Stage E).

**No new tables. No dropped columns. No FK constraints added.** Implicit string-FK between keyword and SKU tables stays unenforced (Q1 lock).

---

## Files generated this session

All under `docs/prompts/drafts/`:

- `stage-b-design-2026-05-08.md` — **Stage B planning document. Stage C's primary input.** All 11 locks, schema column shape, rollback plan, Stage C scoping note, decision log.
- `session-end-2026-05-08-stage-b-design.md` — this file
- `next-session-opener-stage-c-2026-05-09.md` — Stage C opener prompt

---

## Files referenced but not modified this session

From Stage A (read for context):
- `docs/prompts/drafts/stage-a-final-report-2026-05-07.md`
- `docs/prompts/drafts/session-end-2026-05-07-stage-a-audit.md`

From the 2026-05-06 Phase 1 attempt (preserved on disk, untouched):
- `lib/mail-orders/taxonomy-mapping.ts`
- `scripts/phase1-seed-mo-order-form-index.ts`
- `scripts/phase1-restore-from-backup.ts`
- `docs/prompts/drafts/taxonomy-preview.json`
- `docs/prompts/drafts/mo_order_form_index-backup-2026-05-06.json`
- `docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md`

---

## Cleanup items surfaced this session (housekeeping, not Stage C)

Independent of the migration. Can be addressed any time:

- **Single VT keyword row** (Q1 forward drift) — confirm with Chandresh before deleting; Stage G cleanup
- **AUTO STAR (58 SKU rows, no keyword)** — likely operator pain point, worth asking Deepanshu; Stage G enrichment-coverage review
- **5IN1 (26 SKU rows, no keyword)** — same as above
- **Five WS-prefixed orphans** (PRIMA E900, PROJECT, TR E2000, FLASH, ULTRACLEAN) — possible WS keyword regex fragility; Stage G grep
- All cleanup items inherited from Stage A (enrich-v2.ts, category column, phantom temp files, CATEGORY_KEYWORDS comment)

---

## Multi-stage workstream — where we are

- ✅ **Stage A — Read-only audit** (2026-05-07)
- ✅ **Stage B — Schema design** (2026-05-08, this session)
- ⏳ **Stage C — Data migration design** (next session)
- ⏳ **Stage D — Update parser/enrichment**
- ⏳ **Stage E — Apply SKU migration to live DB**
- ⏳ **Stage F — Re-apply taxonomy redesign to `mo_order_form_index`** (reuses 2026-05-06 scripts)
- ⏳ **Stage G — Phase 2 hygiene** (T3 rebadge, drift fixes, code grep, operator walkthrough)

Estimated 3-5 sessions across the next week or two. One stage per session with state checks between.

---

## Engineering rules respected throughout (CLAUDE_CORE.md §3)

- Zero `prisma db push` (none would have been valid — design only)
- Zero `prisma.$transaction` use
- Zero schema changes (Stage B explicitly forbidden)
- Zero process executions
- All planning written via `create_file` to `docs/prompts/drafts/` only
- Production unchanged from session start to session end

---

## Current production state

- DB: `mo_order_form_index` 481 rows, 15 legacy families (rolled-back state)
- Schema: `mo_order_form_index` unique constraint on `(family, subProduct, baseColour)` — ready for Stage F redesign
- `mo_sku_lookup`: 1,599 rows, untouched
- `mo_product_keywords`: 1 forward-drift case (VT), otherwise clean FK
- `/order` and `/place-order`: live on legacy 15-family taxonomy, fully functional

---

## Next session

Open with the prompt at `docs/prompts/drafts/next-session-opener-stage-c-2026-05-09.md`. That prompt:
- Lists the 4 pre-flight checks
- Locks the scope (Stage C = data migration design only — splitter helper draft + preview JSON shape, no DB writes, no production code changes)
- Names `stage-b-design-2026-05-08.md` as the primary input
- Specifies Stage C deliverables (splitter helper, preview script, review JSON, manual-review queue spec)

Stage B is complete. End of session.

---

*Session-end · 2026-05-08 · Stage B*
