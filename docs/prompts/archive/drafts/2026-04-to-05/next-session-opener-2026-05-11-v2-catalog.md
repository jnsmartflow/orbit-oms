# Next-session opener — v2 catalog table for /place-order

**Save as:** `docs/prompts/drafts/next-session-opener-2026-05-11-v2-catalog.md`

**Use:** paste contents into a fresh Claude.ai chat at the start of the next session.

---

## OPENER PROMPT (paste this into the new chat)

```
We're building a parallel v2 product catalog table for /place-order, based on the locked May 6 taxonomy redesign. Goal: ship the new 33-family taxonomy on /place-order without touching the live mo_order_form_index, SKU table, parser, or enrichment.

This approach was decided in the 2026-05-10 recovery session after a paused 4-day workstream (Stages A → C designed but unbuilt). The full Stage D-G plan is now deferred indefinitely.

─── READ THESE FILES FIRST — NO OUTPUT UNTIL DONE ──────────────────

Read fully and silently:

1. CLAUDE.md (repo root, auto-loaded)
2. docs/CLAUDE_CORE.md
3. docs/CLAUDE_UI.md
4. docs/CLAUDE_MAIL_ORDERS.md
5. docs/prompts/drafts/session-end-2026-05-10-recovery-and-branch-hygiene.md (THIS is the primary context — read end to end)
6. docs/prompts/drafts/web-update-2026-05-06-master-taxonomy-redesign.md (the 33-family locked design)
7. docs/prompts/drafts/taxonomy-preview.json (read summary block + a few sample family entries; don't load the full 6,800 lines)
8. docs/prompts/drafts/session-end-2026-05-06-taxonomy-phase1-summary.md (background on why Phase 1 rolled back)

After reading, confirm in one short message:

- "Files read"
- Schema version, parser version, UI version
- The 5 decisions locked in the 2026-05-10 session (from session-end TL;DR)
- The single open sub-question parked for this session

Then wait. Do NOT propose anything until I say "go".

─── DECISIONS ALREADY LOCKED — DO NOT REOPEN ────────────────────────

1. Approach: parallel v2 table mo_order_form_index_v2; live mo_order_form_index untouched.
2. First consumer: /place-order only. /order migrates later, after operator approval.
3. Schema columns: same shape as mo_order_form_index (id, family, subProduct, baseColour, displayName, searchTokens, tinterType, productType, sortOrder, isActive, createdAt). NO subVariant column. NO variant column.
4. Sub-product naming: clean names (MATT, GLOSS, SEALER). No legacy compound names.
5. Stages D-G: deferred. Do not propose them.

─── SUB-QUESTION TO RESOLVE FIRST ──────────────────────────────────

The 3 woodcare families (LUXURIO, 2K PU, PU PRIME) will have empty pack panels in /place-order because their SKU rows still use compound product names that don't match the clean v2 sub-product names. The cross-table join in /api/order/data won't bridge them.

Two options:
- A — Show families with empty pack grids visible, label them clearly (e.g. "no packs configured yet" placeholder).
- B — Hide these 3 families from /place-order entirely until a future SKU-side fix.

I'll choose A or B in chat. Have a recommendation ready with reasoning, but don't lead with it.

─── SESSION OUTPUT ─────────────────────────────────────────────────

After A/B is locked, produce ONE Claude Code prompt covering:

1. Create mo_order_form_index_v2 table via Supabase SQL (NOT prisma db push). Same columns + same unique constraint as the live table.
2. Add Prisma model. Run npx prisma generate.
3. Seed v2 from docs/prompts/drafts/taxonomy-preview.json (already produced in May 6 session — 512 rows, 0 warnings).
4. Switch /place-order's data feed (app/api/order/data/route.ts has the cross-table join — check if it powers /place-order, or if /place-order has its own data route) to read from v2 instead of live table.
5. Verify /place-order renders correctly in dev and on Vercel preview.
6. tsc --noEmit clean.
7. Single commit on feat/place-order-page; push triggers Vercel preview rebuild.

Constraints to enforce in that prompt:
- All engineering rules from CLAUDE_CORE.md §3 (no $transaction, all API routes export const dynamic = 'force-dynamic', etc.)
- No edits to lib/mail-orders/ (parser/enrichment untouched)
- No edits to live mo_order_form_index, mo_sku_lookup, mo_product_keywords, or any orders table
- No edits to /order public mobile page
- "Do not write code yet" gate before any file creation
- Single-step approval gates between phases

If the prompt grows beyond ~300 lines, split into two prompts (schema/seed first, page-wire second). Don't combine into one mega-prompt.

─── WHAT NOT TO DO ─────────────────────────────────────────────────

- Do not propose Stage D, E, F, or G work.
- Do not propose touching mo_sku_lookup or mo_product_keywords.
- Do not propose subVariant column — that approach is deferred.
- Do not propose moving /order to v2 in this session — only /place-order.
- Do not consolidate any CLAUDE_*.md context files this session — separate consolidation session.
- Do not start drafting the prompt before A/B is locked.

─── ENVIRONMENT REMINDERS ──────────────────────────────────────────

- Branch in use: feat/place-order-page (already has all May 6 code committed as of 2026-05-10)
- Vercel preview building green on commit fec69017
- Production untouched on main
- Backup at C:\Users\HP\OneDrive\VS Code\orbit-oms-backup-2026-05-10-1104

─── WHAT TO DO FIRST ───────────────────────────────────────────────

1. Read the 8 files listed above silently.
2. Confirm with: "Files read · v72/v5.1/v1.0 confirmed · 5 locks understood · sub-question ready."
3. Wait for me to say "go".
4. I'll lock A or B.
5. Then draft the Claude Code prompt per the spec above.
```

---

## NOTES FOR FUTURE-SMART-FLOW

- This opener inherits the recovery work and assumes branches are already clean. If the next session is delayed by weeks, run `git status` first to confirm `feat/place-order-page` is still healthy before starting.
- The v2 approach makes the entire Stage D-G plan (subVariant column, parser updates, etc.) optional. If `/place-order` works well on v2 with clean names, the SKU table never needs to change. The 3 woodcare families are the only outstanding edge case.
- If A is chosen (show empty-pack families), operators get a visual cue that those families exist but aren't ready. If B is chosen (hide them), operators won't see them at all — cleaner UI but easier to forget.
- If `/place-order` data feed turns out NOT to use `app/api/order/data/route.ts` (it might query directly via Prisma server-side), the table-switch becomes simpler. Verify in Step 4.

---

*Next-session opener · 2026-05-10 · Smart Flow*
