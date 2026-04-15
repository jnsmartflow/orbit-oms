# context-update-v71.md

## NEW/MODIFIED FILES

- `components/tint/tint-operator-content.tsx` — Bug fixes from live testing: left panel card colours simplified, post-save form refresh, timer calculation, active shade display, multi-line save flow, auto-load existing TI entries on line selection.

## BUSINESS RULES ADDED

### Left panel card states (final — simplified)
- Selected card: `bg-gray-100 border-l-[3px] border-l-gray-900` — no other coloured borders
- Unselected card (all statuses): `bg-white border-gray-200 hover:bg-gray-50` — status communicated via ✓ checkmark or Pending badge only
- No amber or green left borders on unselected cards — removed to reduce colour noise competing with shade grid

### Active shade values display
- "ACTIVE SHADE VALUES" mode shows ONLY shades with value > 0 — no extra empty columns
- If no values entered: full grid shown ("SHADE QUANTITIES (TINTER/ACOTONE)")
- Toggle: "+ Show all 13" expands to full grid; "− Show active only" collapses back (only when active values exist)

### Post-save form behaviour
- After successful Save TI or Update TI Entry: do NOT reset tiEntries to defaultTIFormEntry()
- Instead: fetchOrders → loadExistingTIEntries → the selectedLineIdx effect repopulates form from updated existingTIEntries map
- existingTIEntries must create new Map reference on update (not mutate in place) to trigger React re-render
- selectedLineIdx effect depends on: selectedLineIdx, selectedJob?.id, existingTIEntries
- After saving NEW entry: auto-advance to next uncovered line if any

### Auto-load existing TI entry on line selection
- When operator clicks a line card (or line auto-selected on load), the selectedLineIdx effect checks existingTIEntries map
- Line HAS existing entry → form populated with saved values, "ACTIVE SHADE VALUES" mode, editingEntryId set, tinterType set
- Line has NO entry → fresh empty form, full shade grid, editingEntryId null

### Timer calculation
- Elapsed timer uses: `Math.max(0, now.getTime() - new Date(startedAt).getTime())`
- Guard against negative values (timezone/parsing issues)
- Timer reads from the job that is `tinting_in_progress` (not just selectedJob)
- Prisma DateTime comes as ISO string with Z suffix — parsed correctly by `new Date()`
- setInterval ticks every 1000ms with immediate first tick
- Timer displays in both Row 2 (next to pill) and footer

### Multi-line Save TI + Start flow
- Current job (assigned, not in progress): ALWAYS shows [Save TI] + [Save TI & Start] regardless of how many lines are covered
- Operator decides when to start — no prerequisite of "all lines covered"
- "Save TI" saves current line only, auto-advances to next uncovered line
- "Save TI & Start" saves current line AND starts job timer

## PENDING ITEMS

1. Post-save form blank reset — Prompt 20 addresses this; verify after execution that updating TI entry preserves shade values without page refresh
2. Shade suggestion strip — renders between TI header and form when saved shades exist for the SKU+pack combination; needs shade master data to test
3. Full end-to-end re-test after Prompts 17-20: assign → fill TI → save → auto-advance → fill next → save & start → update entry → mark done
4. Mobile layout testing — left panel hidden on <md, needs verification

## CHECKLIST UPDATES

- After any save/update handler changes: verify tiEntries is NOT reset to default after success — the selectedLineIdx effect handles repopulation
- existingTIEntries must always be set with `new Map(...)` (new reference), never mutated in place
- Timer: always use Math.max(0, diff) guard — never display negative elapsed values
