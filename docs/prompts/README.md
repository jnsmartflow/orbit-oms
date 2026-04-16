# prompts/
Templates and active workspace for context maintenance.

## Templates (top level)
- `context-update-code-template.md` — paste at end of every Claude Code
  session where something context-worthy changed
- `context-update-web-template.md` — paste at end of every Claude.ai
  planning session where architecture decisions were made
- `consolidation-prompt.md` — used every 2-3 weeks in Claude.ai to
  merge drafts back into the 4 canonical files in docs/

## drafts/
Active workspace. Each session's update draft lands here.
Filename: `{code|web}-update-{YYYY-MM-DD}-{topic}.md`

## archive/
Drafts that have been consumed by consolidation move here.
Keep for audit. Clear periodically.
