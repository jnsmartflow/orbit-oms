# Context Update Draft — Claude Code Session End
# Use this in Claude Code (VS Code extension), NOT in a browser.
# Paste at the end of a session where something changed in the repo.

─── WHAT I WANT ─────────────────────────────────────────────────────────────
This session is ending. Before I close it, produce a context update draft
capturing every change that affects the project's canonical context files
(CLAUDE_CORE.md, CLAUDE_UI.md, CLAUDE_MAIL_ORDERS.md, CLAUDE_TINT.md).

Save the draft to:
  docs/prompts/drafts/code-update-{YYYY-MM-DD}-{topic}.md

Where:
  - {YYYY-MM-DD} is today's date.
  - {topic} is 2-4 words describing the main change in kebab-case.
  - Example: code-update-2026-04-17-review-view-sort-fix.md
  - The `code-` prefix marks this as originating from a Claude Code session
    (distinct from `web-` drafts that come from planning sessions).

─── WHAT TO INCLUDE ─────────────────────────────────────────────────────────
Use this exact structure — no prose preamble, no filler:

# Context Update v{N} — {One-line summary}
Session date: {YYYY-MM-DD}
Target files: {which canonical files this affects, e.g. CLAUDE_MAIL_ORDERS.md §10}

## SCHEMA CHANGES
{SQL run via Supabase SQL Editor this session, if any. Bump schema version.}
{If none: write "None."}

## NEW/MODIFIED FILES
{Table: File | Purpose}
{Only files actually touched this session. Not speculation.}

## NEW API ENDPOINTS
{Table: Method | Path | Auth | Purpose}
{If none: omit section.}

## BUSINESS RULES ADDED
{Bullet points. Each rule is one line or one short paragraph.}
{Only rules that change existing behaviour or add new invariants.}
{No restating what was already true.}

## BUSINESS RULES CHANGED / SUPERSEDED
{What used to be true that is no longer true. Which file/section.}
{If none: omit section.}

## BUSINESS RULES REMOVED / DEPRECATED
{Features or rules removed entirely. Cross-reference the removal commit.}
{If none: omit section.}

## PENDING ITEMS
{New pendings that came up this session.}
{Pendings from previous drafts that are NOW DONE — mark as completed.}

## CHECKLIST UPDATES
{New lines to add to CLAUDE_CORE.md §14 session-start checklist.}
{If none: omit section.}

## CONSOLIDATION NOTES
{Where this update should merge during next consolidation:}
{- CLAUDE_CORE.md §N — {what changes}}
{- CLAUDE_MAIL_ORDERS.md §N — {what changes}}
{- CLAUDE_UI.md §N — {what changes}}

─── PRINCIPLES ──────────────────────────────────────────────────────────────
- CURRENT STATE ONLY. Do not write "in this session we tried X first then Y".
  Write only what IS true at the end of the session.
- Every line must earn its place. No filler. No padding.
- If a change is purely cosmetic or already covered by an existing rule,
  do not include it.
- If you are unsure whether something rose to the level of a context rule
  (vs just a bug fix), note it in CONSOLIDATION NOTES with a question mark
  so I can decide at merge time.
- Use tables over prose where data is structured.
- Use code blocks for SQL, file paths, interface signatures.

─── DO NOT ──────────────────────────────────────────────────────────────────
- Do not edit CLAUDE_CORE.md / CLAUDE_UI.md / CLAUDE_MAIL_ORDERS.md /
  CLAUDE_TINT.md directly. Those files are consolidated manually in a
  dedicated session, not mid-work.
- Do not include code diffs. Describe what changed, not line-by-line.
- Do not speculate about future changes unless they are already planned
  and belong in PENDING ITEMS.

─── AFTER YOU WRITE ─────────────────────────────────────────────────────────
1. Confirm the file path you saved to.
2. Report: "Draft saved to docs/prompts/drafts/. {N} drafts total in folder.
   Consider consolidating when count exceeds 10 or 3 weeks have passed."
3. Do not commit the draft. I will review before committing.
