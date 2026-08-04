# Reconciliation method — locked 2026-08-04
Read this file fully before reconciling any canonical file. One canonical file (or one approved pair) per session.

## Ground rules
- Live data > seed data > migrations > shipped drafts > older doc claims.
- Never trust the doc when code disagrees; never trust code when live DB disagrees.
- Claude Code has NO database access. Every DB check = output ONE combined SELECT block (Supabase editor rules: no BEGIN/COMMIT; multiple results joined with UNION ALL; LIMIT inside UNION ALL subquery-wrapped) → Smart Flow runs it and pastes results back → pasted results are the DB truth.
- Claude Code has NO login credentials. Never claim a login journey or screen render was verified — the build route table is the evidence for what exists.
- SELECT only. No DB writes in any reconciliation session.
- STOP and wait for Smart Flow: after Phase C (verdicts) and after Phase D diff (before saving).

## Phase A — Claim extraction
Read the target doc top to bottom. List every checkable claim with an ID ({FILE}-{n}, e.g. CORE-14). Categories: SCHEMA / CODE-PATH / BEHAVIOUR / DATA-STATE / CROSS-REF.

## Phase B — Verify
- SCHEMA → information_schema + pg_enum SELECTs (via Smart Flow).
- CODE-PATH → open the file. AN IMPORT IS NOT A CALL: find the call site, confirm it is not commented or DISABLED. CAPABILITY IS NOT REACHABILITY: a handler branch only counts if a caller actually exercises it.
- BEHAVIOUR → trace the entry point to completion.
- DATA-STATE → diagnostic SELECT (via Smart Flow). Cron claims → read vercel.json / the real config, remembering Hobby crons fire at most once per day.
- CROSS-REF → open the linked doc; note contradictions, do not fix them.
- Drafts touching this file → classify: code-update = shipped ONLY if git log confirms the commit; code-discovery = findings merge only where a shipped update acted on them; web-update = decision, check implementation status; code-resume = history if shipped, never merged as current. A "SHIPPED" line is a claim, not a fact.
- Stale code comments count as claims too — verify a comment's factual claim against data before repeating it.

## Phase C — Verdicts
Table: Claim ID | Category | Doc says | Reality | Verdict (CORRECT / STALE / MISSING / CONTRADICTS-OTHER-FILE / OBSOLETE). Present it. STOP. Wait.

## Phase D — Rewrite
Apply approved corrections in place. Preserve the doc's structure and voice. Bump version in header AND footer (they drift). Update last-updated date. Add a change-log block at the bottom (claim ID + one-line rationale each). Show before/after excerpts for significant changes. STOP for approval, then save.

## Phase E — Cross-doc sweep
Plain-text grep ALL of docs/ plus repo-root CLAUDE.md for every phrase changed or removed. Char-class every slash branch ([/]warehouse|[/]planning); a suspiciously clean sweep gets re-run a second way and reconciled; watch word boundaries (char-class prefix matches /warehouse/pickers). FLAG hits in other docs for their own session — never fix them here.

## Phase F — Wrap up
- Router: check the repo-root CLAUDE.md row for this file; FLAG needed changes (router is fixed in the final session, not here).
- Drafts fully merged by this session → git mv (never copy-delete) to docs/prompts/archive/2026-08/.
- Stop dev server → npx tsc --noEmit (if errors appear only under .next/types for moved routes, clear .next and re-run) → git add ONLY the named files (never git add .) → commit to main → push.
- Output a change-log summary: claims examined / correct / stale / missing / obsolete, drafts folded in, contradictions flagged, version X→Y.
