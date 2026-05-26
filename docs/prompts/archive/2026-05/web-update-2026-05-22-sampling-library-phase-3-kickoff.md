# Sampling Library Phase 3 — Kickoff Prompt

Paste this as the opening message of the next Claude.ai session. It tells the assistant exactly where Phase 2 stopped and what Phase 3 must deliver.

---

## Session kickoff message (paste this in next session)

> Sampling Library Phase 3 — Data Normalisation + Delivery No + Final Push.
> Phase 2 build is complete but uncommitted. Phase 1 + Phase 2 + FIX-1 all sit on the depot PC, by design. Handoff doc attached: `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-2-handoff.md`. Phase 2 design spec also attached: `docs/prompts/drafts/web-update-2026-05-22-sampling-library-phase-2-design-spec.md`. Phase 1 handoff for context: `docs/prompts/drafts/code-update-2026-05-22-sampling-library-phase-1-handoff.md`.
>
> Read all 7 canonical files + the three handoff/spec docs. Then reply with the 3-line Ready format and wait.
>
> Pending work for Phase 3, in order:
>
> **A. Data normalisation pass.** Legacy Excel data has typo and case-variant duplicates. Same physical entity gets split into multiple rows in USED AT, SKUS USED, and TINTING HISTORY. Need to audit and fix:
> - **SKU codes:** case variants like `IN28109471` and `in28109471` (same SKU)
> - **Dealer names:** `Bajrang Structures LLP` and `BAJRANG STRUCTURES LLP` (same dealer)
> - **Site names:** `Gph-piplod` and `Gph Piplod` and `GPH PIPLOD` (same site, with hyphen/space variants), `Antilia` vs `Antilla` (genuine typo)
>
> Source of truth:
> - SKUs → match against `sku_master.materialCode` (canonical casing)
> - Dealer / Site → match against `delivery_point_master.customerName` (canonical spelling)
>
> Approach: dry-run report first (one file per entity type — sku-collisions.txt, dealer-collisions.txt, site-collisions.txt). Smart Flow reviews. Then commit-mode runs `UPDATE` statements on `sampling_recipes` and `sampling_usage_log`. Sequential awaits, no transactions.
>
> Audit logic — recommend confidence-banded:
> - **High confidence (auto-apply):** case-only variants of an existing master entry. e.g. `IN28109471` matches `sku_master.materialCode = 'IN28109471'` exactly when both uppercased. Apply directly.
> - **Medium confidence (suggest):** trimmed + collapsed-whitespace variants. e.g. `Gph-piplod` and `Gph Piplod` both normalise to `GPH PIPLOD` after uppercasing + removing hyphens. Show in report.
> - **Low confidence (manual review):** Levenshtein distance ≤ 2 between two entries when neither matches master exactly. e.g. `Antilia` vs `Antilla`. Show in report. Smart Flow decides per row.
>
> After Smart Flow approves the report, commit-mode writes back the canonical strings to `sampling_recipes.skuCode`, `sampling_usage_log.skuCodeRaw`, `sampling_usage_log.dealerNameRaw`, `sampling_usage_log.siteNameRaw`. Also re-runs the site → `siteId` match (so newly canonical site names populate the FK).
>
> **B. Delivery No on TINTING HISTORY.**
> Each tinting event has a delivery number (OBD-style identifier) from the source Excel. Schema:
> - New column `deliveryNumber TEXT` on `sampling_usage_log` via Supabase SQL Editor (`04-delivery-no.sql`)
> - Schema version bump v26.6 → v26.7
> - Backfill via repair script: read source Excel by row-index alignment (same pattern as REPAIR-1a in Phase 1), populate where present, leave NULL where absent
> - For forward-going data (post-legacy), `deliveryNumber` will populate from the TI workflow once assignment + TI flow lands real data — not in scope this session
>
> UI update: add DELIVERY NO surface in TINTING HISTORY. Design pass needed first — pick between (1) new column `DELIVERY NO` between SKU and QTY, or (2) sub-line under the DATE column. Decide before code.
>
> **C. Final commit + push.** Phase 1 + Phase 2 + Phase 3 + FIX-1 all go in one logical push to `main`. Vercel auto-deploys. Smoke test on `orbitoms.in/tint/sampling-library` after deploy.
>
> Workflow same as Phase 1 and Phase 2:
> - One Claude Code prompt per turn, plain-English wrapper + code block, `Est:` line on first line
> - Wait for Claude Code output before drafting next
> - Dry-run / preview before any commit-mode action (especially normalisation UPDATEs — irreversible without backup)
> - Local smoke test for every UI change
> - One push at the very end
>
> Start by reading the canonical files + the three handoffs + the Phase 2 spec, then give me the Ready line.

---

## Phase 3 step-by-step plan (for the next session's assistant to follow internally)

1. **Read + Ready** (canonical files + 3 handoff docs)
2. **Decide design** — DELIVERY NO column vs sub-line in TINTING HISTORY. Ask Smart Flow.
3. **SQL schema bump** — Supabase SQL Editor: `ALTER TABLE sampling_usage_log ADD COLUMN "deliveryNumber" TEXT;` (file `docs/plans/sampling-register/04-delivery-no.sql`). Then hand-edit `prisma/schema.prisma` + `npx prisma generate`.
4. **Repair-3 script** — `scripts/repair-sampling-import-deliveryno.ts`. Read source Excel, build `(samplingNo, row_index) → deliveryNumber` map, sequential UPDATE on `sampling_usage_log`. Dry-run first, then commit mode.
5. **API field exposure** — `/api/sampling-library/:samplingNo/usage-log` route already returns full row shape; add `deliveryNumber` to the select / response type.
6. **UI update** — TINTING HISTORY column or sub-line for delivery no.
7. **Smoke test** — verify on #134481 + #133999.
8. **Normalisation audit script** — `scripts/normalise-sampling-data.ts` with `--mode=audit | commit`. Audit mode produces 3 collision reports (`docs/plans/sampling-register/audit-skus.txt`, `audit-dealers.txt`, `audit-sites.txt`). Confidence-banded as described above.
9. **Smart Flow reviews reports** — approve or hand-edit before commit.
10. **Normalisation commit run** — `--mode=commit` executes UPDATEs. Sequential awaits, no transactions. Outputs row counts.
11. **Re-run site → siteId match** — for any sites whose `siteNameRaw` was normalised, attempt master-match again and set `siteId` where possible.
12. **Smoke test** — verify deduped rows in USED AT, SKUS USED, TINTING HISTORY. SO column should populate for newly-matched sites.
13. **Final commit + push** — bundle FIX-1 + Phase 1 + Phase 2 + Phase 3 into two clean commits (FIX-1 separate, sampling library as one feature commit). `git push origin main`. Vercel deploys.
14. **Production verify** — load `orbitoms.in/tint/sampling-library`, search for #134481, confirm 2 variant tabs (not 5), USED AT shows deduped sites, TINTING HISTORY shows delivery numbers where present.
15. **Training note** — short Slack / WhatsApp message for Chandresh / Deepak announcing the new screen.

---

## Open design questions for Phase 3 (decide at kickoff)

1. **Normalisation auto-apply threshold** — should "high confidence" case-only variants apply automatically without review, or always pass through dry-run report first?
2. **DELIVERY NO placement** — new column in TINTING HISTORY table, or sub-line under DATE? Affects column widths.
3. **What if normalisation conflicts with an existing `sampling_recipes` row?** e.g. if `IN28109471` and `in28109471` both exist as separate `sampling_recipes` entries, normalising both to canonical `IN28109471` would create a duplicate. Merge logic needed: combine `usageCount`, prefer `isPrimary`, take latest `lastUsedAt`. Or surface as a manual-review item.
4. **TI workflow integration** — Phase 3 stops short of wiring assignment / TI submits to write live `sampling_usage_log` rows. That's a separate workstream. Confirm scope.

---

*Phase 3 kickoff prompt · Sampling Library · drafted 2026-05-22*
