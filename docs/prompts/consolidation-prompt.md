# Context Consolidation Prompt
# Use this in Claude chat (NOT Claude Code) every 2-3 weeks.
# Purpose: merge drafts from docs/prompts/drafts/ into canonical CLAUDE_* files.

─── GOAL ────────────────────────────────────────────────────────────────────
This is a consolidation session. No code. No feature planning.

Merge all incremental context update drafts into the 4 canonical files:
  - CLAUDE_CORE.md
  - CLAUDE_UI.md
  - CLAUDE_MAIL_ORDERS.md
  - CLAUDE_TINT.md

─── FILES I AM SHARING ──────────────────────────────────────────────────────
I will share:
1. All 4 current canonical CLAUDE_*.md files
2. CLAUDE.md router (for checklist updates)
3. Every draft from docs/prompts/drafts/ — two types will be present:
   - `code-update-*.md` from Claude Code sessions (actual file/schema changes)
   - `web-update-*.md` from Claude.ai planning sessions (decisions, architecture)

Read every file fully. Confirm each by name before writing.

─── DRAFT TYPES ─────────────────────────────────────────────────────────────
- `code-update-*.md` drafts describe CHANGES ALREADY LANDED in the repo.
  Merge directly into canonical files.
- `web-update-*.md` drafts describe DECISIONS that may or may not be
  implemented yet. Check `Implementation status:` field:
    - "not yet started" → only add to pending items, do not bake into
      business rules
    - "partially built" → add to business rules AND pending items
    - "complete" → bake fully into business rules, remove from pending

─── PRINCIPLES ──────────────────────────────────────────────────────────────
1. CURRENT STATE ONLY. No history. Collapse all drafts into final state.
2. TOKEN EFFICIENCY. Every line earns its place.
3. Use the CONSOLIDATION NOTES section from each draft as routing guidance.
4. When drafts conflict (later draft supersedes earlier), honour the later one.
5. Mark completed pendings as done — do not carry forward.
6. Bump version numbers:
   - Schema version if any SCHEMA CHANGES section added a migration
   - Parser version if any parser drafts landed
   - Individual file version on each canonical file that changed

─── OUTPUT ──────────────────────────────────────────────────────────────────
1. Only rewrite canonical files that actually changed. If a draft only
   affected MAIL_ORDERS, do not touch CORE/UI/TINT.
2. Update each file's header with new version + April 2026 date.
3. For each changed file, list the §sections that were updated.
4. Do NOT commit. Share for my review first.

─── ARCHIVE STEP ────────────────────────────────────────────────────────────
After I approve the consolidation:
1. Move all consumed drafts from docs/prompts/drafts/ to docs/prompts/archive/
2. Confirm the drafts/ folder is empty (ready for next cycle)

─── QUALITY CHECK BEFORE SHARING ────────────────────────────────────────────
1. Read each rewritten file as if it's a new Claude Code session.
   Can you understand the current project state from this file alone?
2. Is any rule duplicated across files? Remove duplicates.
3. Is any pending item from a draft missing from the canonical pending list?
4. Is session-start checklist in CLAUDE_CORE.md §14 up to date?
5. Does the new file have fewer tokens than the old version + drafts combined?
   (It should — that is the point of consolidation.)
