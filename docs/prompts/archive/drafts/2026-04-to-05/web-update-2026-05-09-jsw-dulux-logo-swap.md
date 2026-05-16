# Planning Update — JSW Dulux logo swap with header polish and footer entity update on delivery challan

Session date: 2026-05-09
Session type: design / implementation-coordination
Target files: `components/tint/challan-document.tsx`, `app/globals.css`, `public/jsw-dulux-logo.png`, `docs/CLAUDE_UI.md` §46, `docs/CLAUDE_TINT.md` §4.4
Implementation status: shipped to main (squash-merge, branch deleted)

## DECISION SUMMARY

The delivery challan now uses the JSW Dulux brand mark instead of the legacy AkzoNobel silhouette, in full colour on screen and grayscale on print. The corporate transition from AkzoNobel India to JSW Dulux Limited is acknowledged in the challan footer ("JSW Dulux Limited (formerly Akzo Nobel India Limited)"). Header layout was rebalanced — logo at 34px height with 24px right padding, right column min-width 165px — so "DELIVERY CHALLAN" sits at true page centre. SVG was rejected (only a low-res JPEG screenshot was available); the PNG was hand-prepared from the screenshot via alpha keying + LANCZOS resize to 800×193 (101 KB).

## CONTEXT CHANGES

- Delivery challan logo is `/jsw-dulux-logo.png` (800×193, 101 KB, transparent PNG-24). Old `/akzonobel-logo.png` retained in `public/` (no other code references it).
- Logo filter logic on challan is **inverted** vs. the previous AkzoNobel implementation: web view has **no inline filter** (full colour), print view applies `filter: grayscale(100%) brightness(0) !important` via `@media print`. This is the opposite of what `CLAUDE_UI.md` §46 currently documents.
- Logo sizing on challan: height 34px (web inline + print), width auto (~141px at 4.14:1 aspect). Container has `paddingRight: 24px` for breathing room from the centre title.
- Right column on challan header has `minWidth: 165` to mirror the left column's effective width and keep the centre title at true page centre.
- Footer (S8 Bottom Bar) reads: `Regd. Office: <addr> · www.akzonobel.co.in · JSW Dulux Limited (formerly Akzo Nobel India Limited)`. The new entity name is hardcoded in `challan-document.tsx`, NOT in the `system_config` DB table — acceptable for this brand transition; can move to DB later.
- Branch hygiene observation: `dev` branch is 225 commits behind main and 5 weeks stale. Active flow is now `feat/*` → PR → `main`. `CLAUDE_CORE.md` §4 still says "main (prod), dev" — this is incorrect and needs updating.
- Working tree on local repo has accumulated WIP: ~30 untracked files in `docs/prompts/drafts/`, untracked `app/(place-order)/`, `lib/place-order/`, `lib/mail-orders/taxonomy-mapping.ts`, `pass.tx`, `test/`, plus failed-attempt PNGs `public/JSW DULUX.png` and `public/JSW LOGO.png` (filenames with spaces — should not be in `public/`).

## NEW PENDING ITEMS

- `CLAUDE_UI.md` §46 — flip the documented filter rule (currently says "grayscale on inline / filter:none on print"; should say "no inline filter / grayscale on print") + update logo path to `/jsw-dulux-logo.png` + update height to 34px | owner: Claude Code (next session)
- `CLAUDE_TINT.md` §4.4 — same correction as above (logo CSS filter description) + new logo path | owner: Claude Code (next session)
- `CLAUDE_CORE.md` §4 — branch documentation correction: remove "dev" as the active dev branch, document the actual flow (feature branches → PR → main) | owner: Claude Code (next session, separate prompt)
- Delete or hard-reset stale `dev` branch (225 commits behind main, 5 weeks idle) | owner: Smart Flow (manual GitHub action) | blocker: needs decision — delete vs reset to main
- Local cleanup: delete `public/JSW DULUX.png` and `public/JSW LOGO.png` (failed earlier attempts, filenames with spaces) | owner: Smart Flow (local) or Claude Code (one-line prompt)
- Local cleanup: `pass.tx` at repo root looks like a debug artefact — should be `.gitignore`d or deleted | owner: Smart Flow (local)
- Optional follow-up: delete `public/akzonobel-logo.png` after one stable week on production with no rollback need | owner: Smart Flow (defer 1 week)
- Optional refactor: move "JSW Dulux Limited (formerly Akzo Nobel India Limited)" footer string from hardcoded literal in `challan-document.tsx` to a new row in `system_config` table for single-source-of-truth hygiene | owner: Claude Code (low priority)

## SUPERSEDED DECISIONS

- `CLAUDE_UI.md` §46 — old rule "Logo CSS filter: `grayscale(100%) brightness(0)` for pure black print" inverted by this work. New rule: no filter inline (full colour on web), grayscale filter applied via `@media print` rule.
- `CLAUDE_TINT.md` §4.4 — same supersession: old logo source was already greyscale art so inline grayscale + `filter:none` on print produced black on screen and black on print. New JSW Dulux source is full colour, requiring inverted filter logic.
- Old logo path `/akzonobel-logo.png` is no longer referenced by any code path. File retained in `public/` for one-week rollback safety; will be deleted later.

## MOCKUPS / ARTEFACTS PRODUCED

- `public/jsw-dulux-logo.png` — final production logo, 800×193 transparent PNG, 101 KB, hand-prepared from a 233×116 JPEG screenshot via Python PIL alpha keying (luminance threshold 50–90) + LANCZOS upscale + bbox trim. ChatGPT image generation was attempted but consistently produced JPEG-with-black-background outputs (renamed to `.png`); rejected.

## PROMPTS DRAFTED FOR CLAUDE CODE

Three small follow-up prompts to be written next session:
- `code-update-2026-05-09-claude-ui-filter-rule-correction.md` — fix `CLAUDE_UI.md` §46 logo filter rule
- `code-update-2026-05-09-claude-tint-logo-path-correction.md` — fix `CLAUDE_TINT.md` §4.4 logo path + filter rule
- `code-update-2026-05-09-claude-core-branch-doc-correction.md` — fix `CLAUDE_CORE.md` §4 branch flow documentation

## CONSOLIDATION NOTES

- `CLAUDE_UI.md` §46 — change documented filter rule (web colour, print grayscale), update logo path to `/jsw-dulux-logo.png`, update logo height to 34px
- `CLAUDE_TINT.md` §4.4 — same filter rule correction, update logo path
- `CLAUDE_CORE.md` §4 — replace "Branches: main (prod), dev" with current flow ("Branches: main (prod). Feature branches branch from main, PR → main when ready. dev is stale.") — pending Smart Flow decision on whether to delete or reset dev branch
- `CLAUDE_CORE.md` infrastructure section — note that `system_config` table holds `registeredOffice` and `website` rows used by the challan footer; the JSW Dulux entity string is currently hardcoded in `challan-document.tsx` pending a decision on whether to move it to `system_config`
