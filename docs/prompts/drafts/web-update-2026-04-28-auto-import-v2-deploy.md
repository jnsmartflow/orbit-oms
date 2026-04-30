# Planning Update — Auto-Import v2.0 deployed and operational
Session date: 2026-04-28
Session type: implementation + diagnosis
Target files: CLAUDE_CORE.md (§ on Auto-Import / OBD pipeline / Task Scheduler)
Implementation status: fully deployed, running in production via Task Scheduler

## DECISION SUMMARY
Auto-Import.ps1 was rewritten end-to-end to v2.0 to fix four issues in v1: silent OBD loss from a "page 1 only" pagination shortcut, no recovery mechanism for missed OBDs from prior days, fragile session handling that re-logged in on every cycle (~70 logins/day), and 20+ hard `exit` points that crashed on transient errors. v2.0 ships tally-based pagination with random page order and refetch, lazy session reuse with 4-hour cookie cache, automatic yesterday-recovery on first cycle of new day, retry-with-backoff on every API call, and a structured cycle summary block. A new watcher script (Watch-Import-V2.ps1) replaces the old log tailer with full visibility into breakwalls/folder/match/duration per cycle plus a `-Today` summary mode and `-Date YYYY-MM-DD` historical mode.

## CONTEXT CHANGES
- OBD-Import tool is deployed at `F:\VS Code\OBD-Import Tool v2\` (NOT `C:\Users\HP\OneDrive\VS Code\orbit-oms` as previously memorised — that's the Orbit web repo).
- v2.0 pipeline order: Cleanup+daily-reset → Login (cached) → Yesterday recovery → Spec prime → Pending upload retry → Tally-based pagination → Download missing → Retry prior failures → Header → Merge → Upload → Cycle summary.
- Yesterday recovery mechanism: on first cycle of new day, script flags previous date (from `daily-state.txt`) as pending in `yesterday-recovery-state.txt`, then every cycle compares breakwalls' OBD list for that date against `LineItem File\<date>\*.xlsx`, downloads the gap, uploads, marks done. Self-healing — retries every 10 min until success.
- Tally-based pagination: page 1 is fetched every cycle. Total count is read from breakwalls' `numrowsInfo` field (regex-extracted from "Showing records between 1 and 20 of total N records"). If both total count AND page 1 OBD list are unchanged from prior cycle's stored tally (`obd-tally-<date>.txt`), pagination is skipped entirely. Otherwise all pages are fetched in random order with 3-retry backoff, then page 1 is refetched to catch arrivals during pagination.
- Session reuse: cookie cached up to 4 hours in `session-cookie.txt`. Lazy re-login fires only on detected login redirect or expired cookie. Today's stats: 34 cycles, 1 fresh login, 33 cached reuses (was 31/31 fresh under v1).
- Spec prime is cached for 2 hours via `last-spec-call.txt`. Fires on first cycle, after re-login, after yesterday-recovery, or when stale. Today: 3 actual /spec calls vs 31 in v1 era.
- All `Invoke-RestMethod` calls in upload path replaced with `Invoke-WebRequest -UseBasicParsing` (PowerShell 5.1 compatibility).
- New state files in `Master\`: `yesterday-recovery-state.txt`, `pending-upload.txt`, `last-spec-call.txt`, `last-noise-call.txt`, `obd-tally-<date>.txt`. `last-page1.txt` from v1 is replaced by `obd-tally-<date>.txt`.
- ExecutionTimeLimit on the `2_Auto_Import` scheduler task is now `PT5M` (was 72H). Task uses `LogonTrigger` with `Repetition Interval=PT10M` and `StopAtDurationEnd=false` (no duration cap). Re-registered via `Register-ScheduledTask -Xml` after GUI editing corrupted the prior trigger.
- Background "human noise" GET to the report page fires every 30-60 min (random) to mimic browser refresh patterns.
- AppVersion header: live-parsed from login HTML when available; falls back to hardcoded `VmRhZP4kZj==`. If breakwalls rotates this, the script attempts to refresh on next login.
- Stealth posture: full pagination uses random page order on pages 2+. Variable 1-3s delays between page fetches and downloads. 2-5s delays around login. Tally caching reduces /data calls when nothing changes.

## NEW PENDING ITEMS
- Update CLAUDE_CORE.md OBD-Import section to reflect v2.0 architecture and correct deploy path | Claude Code | none
- Tomorrow morning: verify yesterday recovery for 2026-04-28 fires correctly on first cycle | depot (just observe) | requires logon at start of next day
- Optional: harden `Watch-Import-Log.ps1` against transient `Get-Content` file-lock crashes (race condition when v2 is appending while watcher reads) | Claude Code | low priority, watcher just needs restart when it happens
- Optional: `Watch-Import-V2.ps1 -Last 7` mode (last-N-days summary table) — not built, deferred unless requested
- Risk to monitor: AppVersion header value (`VmRhZP4kZj==`) breaks instantly if breakwalls rotates it. Live-parse fallback exists but regex may need updating | depot to flag if logins start failing
- Tinting-keywords list discovered to contain typo: `GENRIC` (should be `GENERIC`). Both currently present so it works either way, but cleanup needed | depot | trivial

## SUPERSEDED DECISIONS
- v1 Auto-Import.ps1 page-1-shortcut pagination (Page1MatchMin=10 heuristic) — silently dropped OBDs on pages 2+ when ≥10 page 1 OBDs matched prior run. Replaced by tally-based pagination with refetch.
- v1 fresh login every cycle (caused by `(Get-Date - $savedAt)` syntax bug throwing exception → catch fell through to fresh login) — replaced by lazy reuse with proper `((Get-Date) - $savedAt)` parentheses.
- v1 `prisma.$transaction`-style hard exits on errors — replaced by retry-with-backoff and graceful skip-to-next-cycle.
- Old `last-page1.txt` state file — replaced by `obd-tally-<date>.txt` which adds total_count and status fields.

## MOCKUPS / ARTEFACTS PRODUCED
- F:\VS Code\OBD-Import Tool v2\Auto-Import.ps1 (v2.0, ~1611 lines) | full pipeline rewrite, deployed
- F:\VS Code\Scripts\Watch-Import-V2.ps1 (~454 lines) | replacement watcher, deployed via tasks.json
- 2_Auto_Import_FIXED.xml | XML import for Task Scheduler trigger fix (used via Register-ScheduledTask, can be deleted)

## PROMPTS DRAFTED FOR CLAUDE CODE
None directly. The pipeline was implemented in this session via PowerShell paste-and-run rather than Claude Code, so no prompts were drafted. Future Claude Code consolidation should pull from this draft + `Auto-Import.ps1` source comments.

## CONSOLIDATION NOTES
- CLAUDE_CORE.md — Update OBD-Import / Auto-Import section: correct deploy path to F:\, document v2.0 pipeline phases, list new state files, note Task Scheduler trigger correction, note that `prisma.$transaction` rule (already documented for Vercel) parallels the script's no-hard-exit rule.
- CLAUDE_CORE.md — Add "watcher: Watch-Import-V2.ps1 with -Today / -Date modes" to monitoring tools list.
- CLAUDE_CORE.md — Update Smart Flow stats: "v1→v2 reduced login frequency 31x and /spec frequency 8x; tally-based pagination eliminates silent OBD loss".
- CLAUDE_MAIL_ORDERS.md — No changes (mail orders pipeline unaffected).
- CLAUDE_UI.md — No changes (no UI work).
- CLAUDE_TINT.md — No changes.
