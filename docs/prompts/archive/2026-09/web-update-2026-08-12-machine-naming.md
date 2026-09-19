---
Type: web-update
Date: 2026-08-12
Topic: Infrastructure terminology — dev laptop vs server PC
Status: Stated by Smart Flow, not yet verified against CLAUDE_CORE.md's actual current text
---

# Machine naming clarification

## What was said (Smart Flow, 12 Aug 2026, chat session)

Past sessions/docs have used "depot PC" as a single blanket term. Smart Flow clarified there are actually two separate physical machines:

- **Dev laptop** — where Orbit is built/developed. This is where Claude Code sessions run for coding work (schema changes, feature builds, the Kiosk/TWA build work discussed this session, etc.).
- **Server PC** — the machine used day-to-day, where PowerShell scripts run (e.g., the NTS trip-report PowerShell puller referenced in CLAUDE_TRIP_REPORT.md).

Smart Flow's instruction: stop using "depot PC" generically going forward; use whichever of the two terms actually fits the context.

## Action for next consolidation pass (Claude Code job, not web)

1. Open CLAUDE_CORE.md's Infrastructure section (current header version at time of this note: v94 · Schema v27.15) and check what it currently says — do NOT assume it says "depot PC" everywhere, read the real text first, per this project's own "code/file wins over prose" rule.
2. If it does use a single "depot PC" term, split the references into "dev laptop" and "server PC" as appropriate, matching what each machine is actually used for.
3. Specifically re-check the PowerShell 5.1 / `[BitConverter]` landmine in CORE §3 — confirm whether that note is about the server PC (since that's the machine running PowerShell daily) and correct its label if it currently says "depot PC."
4. Grep every other canonical file for "depot PC" too — per this project's own rule, an imprecise/stale term is rarely in only one file.

## Not yet done
This note has not been merged into CORE. It's a decision to carry into the next consolidation pass, or apply sooner if convenient.
