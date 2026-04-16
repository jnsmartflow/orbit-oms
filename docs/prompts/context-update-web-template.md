# Context Update Draft — Claude.ai Planning Session End
# Use this in Claude.ai (browser), NOT in Claude Code.
# Paste at the end of a planning/design/decision session where no code
# was written but architectural or UX decisions were made.

─── WHAT I WANT ─────────────────────────────────────────────────────────────
This planning session is ending. No code was written — but decisions were
made that future Claude Code sessions need to know about. Produce a
planning update draft capturing those decisions.

Give me the draft as a code block I can copy. I will save it manually to:
  docs/prompts/drafts/web-update-{YYYY-MM-DD}-{topic}.md

Where:
  - {YYYY-MM-DD} is today's date.
  - {topic} is 2-4 words describing the main decision in kebab-case.
  - Example: web-update-2026-04-17-split-dispatch-module.md
  - The `web-` prefix marks this as originating from a planning session
    (distinct from `code-` drafts that come from Claude Code sessions
    where real files changed).

─── WHAT A PLANNING UPDATE CAPTURES ─────────────────────────────────────────
Unlike a code update, a planning update is about intent and decisions,
not about files that changed. Use this exact structure:

# Planning Update — {One-line summary of the decision}
Session date: {YYYY-MM-DD}
Session type: planning / design / consolidation-prep / architecture
Target files: {which canonical files this decision eventually affects}
Implementation status: not yet started / prompt drafted / partially built

## DECISION SUMMARY
{2-4 sentences. What was decided. Why. What alternatives were rejected.}

## CONTEXT CHANGES
{New business rules, architectural constraints, or workflow changes that
emerged from this session. One bullet per item. Each in current-state
language ("X works this way") not narrative ("we realised X").}

## NEW PENDING ITEMS
{Work that now needs to happen as a result of this decision.
Each pending item: title | owner (me / Claude Code / depot / Chandresh etc.) | blocker if any}

## SUPERSEDED DECISIONS
{Past decisions this one overrides. Cross-reference the canonical file
section if known.}
{If none: omit section.}

## MOCKUPS / ARTEFACTS PRODUCED
{HTML mockups, spec docs, diagrams created during this session.
File name | one-line purpose.}
{If none: omit section.}

## PROMPTS DRAFTED FOR CLAUDE CODE
{Prompts written during this session that Claude Code should receive
in a future session. Can be a reference to a separate file or inline.}
{If none: omit section.}

## CONSOLIDATION NOTES
{Where this update should merge during next consolidation:}
{- CLAUDE_CORE.md §N — {what to change}}
{- CLAUDE_UI.md §N — {what to change}}
{- CLAUDE_MAIL_ORDERS.md §N — {what to change}}
{- CLAUDE_TINT.md §N — {what to change}}
{- Nothing yet (pure planning, revisit after implementation)}

─── PRINCIPLES ──────────────────────────────────────────────────────────────
- Decisions only, not process. "We will use Option B" not "We debated A vs B".
- Future-proof. A Claude Code session 2 months from now should be able to
  act on this draft without me re-explaining.
- Link to mockups by path: `docs/mockups/{name}/`.
- If the decision is tentative ("probably this way, revisit after testing"),
  mark it explicitly with `STATUS: tentative` so consolidation doesn't
  bake it into canonical files prematurely.
- If the decision is still in debate and unresolved, DO NOT write a draft.
  Instead just summarise the open questions for future sessions.

─── WHEN TO SKIP ────────────────────────────────────────────────────────────
Do not write a draft if:
- The session was purely exploratory with no landed decision
- The session was social/casual with no project impact
- Everything discussed was already documented in canonical files
- The output was just a prompt for Claude Code (save the prompt separately,
  don't wrap it as a context update)

─── AFTER YOU WRITE ─────────────────────────────────────────────────────────
1. Output the draft as a single fenced code block (```markdown ... ```)
   so I can copy-paste cleanly into my editor.
2. Confirm the filename I should save it as.
3. Tell me: "Save to docs/prompts/drafts/ and commit. Consolidation will
   merge it into canonical files next cycle."
