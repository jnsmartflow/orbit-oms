# Tint Manager — "Base — No Tint" bypass (shipped)

**Date:** 2026-09-06
**Module:** Tint (CLAUDE_TINT.md)
**Status:** Built, committed, pushed to production (orbitoms.in), smoke-tested by Smart Flow — confirmed working.
**Context read this session:** CLAUDE.md Router v1.12 · CLAUDE_CORE.md v102 · Schema v27.23 · CLAUDE_UI.md v5.20 · CLAUDE_TINT.md v2.1 · Schema v27.13 (TINT intentionally lags CORE — nothing in v27.14–v27.23 touches a tint table, per CORE §4 item 4).

No schema/migration was run. No new tables or columns. One new data row (placeholder operator) and one code-level `isBase` flag on an in-memory report type.

---

## 1. The problem

Chandresh (Tint Manager) also holds a Tint Operator login. Roughly 2–3 orders in 10 land in his queue tagged "needs tinting" because the SKU (e.g. "White Base 20L") is a tintable product — but the dealer actually wants it plain, no colour. The system had no way to say "this one needs no tinting" without faking real tinting work.

Chandresh's workaround: assign the order to his own operator ID, open the Tint Operator screen, enter a made-up Tinter Issue (TI) entry just to satisfy the "Mark Done" gate, then mark it done. That fake TI entry was also silently landing inside the real Tint Summary report, inflating Deepak's/Chandrasing's numbers.

Discovery ruled out the original theory (that he was faking TI entries routinely) — live data showed zero evidence of that pattern; the actual wall was the Operator screen refusing to let a job start without a TI entry already existing. The fix needed to remove the fake-operator step entirely, not patch around it.

## 2. What shipped

**Left rail, Tint tab (`/tint/manager`):**

1. On any pending card's **Assign ▾** dropdown, a new choice sits below a divider under the two real operators (Chandrasing Valvi, Deepak Vasava): **"Base — No Tint"** — "No tinting needed — close this bill without an operator."
2. Clicking it closes the bill immediately, no Start/Pause/timer/operator lifecycle at all — the same effect as a real operator hitting "Mark Done." The order leaves Tint Manager's "Needs assignment" list and moves ahead in the workflow (to Floor Control or straight to Picking's Assign board, depending on whether a dispatch slot was already set).
3. The order does **not** appear on "On the floor" (the completed-today table) as a normal job. Instead it drops into a new section at the bottom of the same left rail: **"Tinter Issue Pending"** — a count of bills sent through Base that still owe their paperwork.
4. Clicking a card there swaps the left rail to that bill's line items (SKU/description/qty/pack, each with a green check or amber "Pending"), with a "← Back to queue" link. Clicking a line opens the real Tinter Issue form on the right — same shade search, TINTER/ACOTONE toggle, pigment grid, reuse-shade flow Deepak and Chandrasing already use. No invented fields (an earlier "Plain — no colour" checkbox idea was explicitly dropped — not confirmed as wanted, so it was never built).
5. Saving a line auto-advances to the next pending line on the same bill; when the last line is saved, the bill disappears from "Tinter Issue Pending" on its own.
6. **Undo** — a grey ↺ next to each "Tinter Issue Pending" card. Click it and the bill returns to "Needs assignment," exactly as if Base was never clicked. Refuses (red toast, nothing changes) if: any paperwork has already been saved on it ("Paperwork has already been started on this order — can't undo, contact admin"), if it's already been picked, if Floor has already released it, or if the card is stale (already undone in another tab).
7. **Customer-missing guard** — Base behaves identically to Assign: if the bill's ship-to customer master data is missing, the same helper sheet opens (not a plain error), the manager fixes it there, and the bypass resumes automatically once resolved.

**Reports (`/reports?r=tint-summary`):**

- Every site-wide total/KPI (today's Completed jobs+litres, Workload cleared %, movement, pace-by-hour, trend-per-day, the SMU/Area completed fills) now excludes Base bills — they no longer inflate real tinting numbers.
- Per-operator and per-customer breakdowns (operator cards, the Completed register) still show "Base / No Tint" as its own named line — visible, just never folded into a real operator's count. This is deliberate: a KPI total and the register can legitimately disagree by design (commented in code so it isn't "corrected" back later).

**Housekeeping:**

- Chandresh's `tint_operator` role was removed (`DELETE FROM user_roles WHERE "userId" = 21 AND "roleId" = 5`) — he no longer needs to appear as a fake operator now that Base exists. Assign now shows exactly three choices: Chandrasing, Deepak, and Base — No Tint. His `tint_manager` role is untouched.
- A placeholder worker row was created to hold Base assignments: `users` id **54**, name "Base / No Tint", email `base-notint@system.invalid`, `isActive: false`, `roleId: 5` (tint_operator) — switched off everywhere a real operator picker (`users.findMany`) filters on active users, so it never leaks into Assign dropdowns, the Attendance clock-in list, or anywhere else operators are listed. Confirmed via a full grep of every `users.findMany` call site before this pattern was reused (the same "flip isActive off" pattern was already proven safe by 7 old test accounts).

## 3. Commits (in order, all on `main`, all live)

| Commit | What |
|---|---|
| `c9ef1c31` | Base bypass route + Assign dropdown option |
| `d5fd1b58` | Customer-missing guard on the bypass route (400, same message shape as Assign) |
| `99175a99` | Base opens the same CustomerMissingSheet popup as Assign (parity fix, not a lesser version) |
| `88f1dcfb` | Backend: `lib/tint/base-operator.ts` helper, `base-pending` GET list, placeholder excluded from "On the floor" (Set E) and the marker/completion routes, narrow TI-ownership exception for Base-assigned jobs |
| `4b9d321b` | Frontend: "Tinter Issue Pending" section, line drilldown, `base-ti-panel.tsx` (reused TI-saving logic, no operator lifecycle), auto-advance between lines |
| `b93d9424` | Undo button + guarded undo route (refuses if paperwork started / picked / released by Floor / stale) |
| `e12ce9e9` | Tint Summary report: totals split into `completedObds` (all) vs `realCompletedObds` (Base excluded) via new `isBase` flag; also fixed an unrelated pre-existing stale `"done"` status literal in the same file (5th copy of a bug already fixed elsewhere per CLAUDE_TINT.md §1.4) |

All seven commits are on production. `tsc --noEmit` passed clean at every step. Files were staged by name throughout, never `git add -A`.

## 4. One test-order round-trip, done live tonight

Order 14833 / OBD 9109352324 (Rajhans Unica) was bypassed as a live test before Undo existed, confirmed showing correctly under "Base / No Tint" (separate from real operators, marked Done), then reverted by hand via a guarded SQL script (checked first that nothing downstream — Picking, Floor — had touched it; confirmed clean; then deleted only the one test assignment). Once the real Undo button shipped, it was used to reverse a second, later test bypass on the same order for real, as its first live proof.

## 5. Known limitations (accepted, not defects)

- A saved Tinter Issue entry cannot be edited afterward if there's a typo — true for real operators too, nothing new. A fix would need its own scoping if it comes up often.
- The marker route's "splits" exclusion arm (arm 3) is inert — the bypass only ever writes whole-OBD assignments, and the splits code path has had no caller since the board rebuild. Added for symmetry, flagged in a comment as dead.
- `assignedToId` is nullable in Prisma but has zero NULL rows live — the `{ not: baseOperatorId }` filters would silently drop NULL rows if that ever changed (CORE §13 three-valued-logic trap). Flagged, not fixed, since there's nothing to fix yet.

## 6. Confirmed by Smart Flow

Ran the live Reports check: bypassed a bill, confirmed today's Completed jobs/litres and Workload cleared % did not move, confirmed the same bill still appeared in the Completed register and its own operator card labelled "Base / No Tint." Result: **"ALL OK."**

---

## 7. Deferred to next session — NOT built tonight

**Tint Manager History view.** Smart Flow asked for a way to look back at previous days' completed tinting (Tint Manager currently only shows today, same gap the Tint Operator screen already solved for individual operators with its own History). Proposed shape, agreed in principle, not scoped or mocked:

- A small "History" option on Tint Manager — pick a date, see everything completed that day.
- No complication flagged: every historical completed job was done by a real operator (Base didn't exist before tonight), so old data needs no reclassifying.
- Once Base bills exist going forward, they'd show by name in a History day's list the same way they do in today's Completed register — excluded from that day's totals, visible in the list. No new handling needed beyond what tonight's report split already does.

This needs its own Discover → Plan → Mock → Build pass in a future session — not scoped here.

---

## For consolidation (future pass)

- CLAUDE_TINT.md should gain a section documenting the Base — No Tint bypass, the Tinter Issue Pending flow, Undo, the placeholder operator (id 54), and the Tint Summary `isBase`/`realCompletedObds` split — this is genuinely new module behaviour, not a rename of something existing.
- No router row change needed — no new page/route was added; everything lives inside the existing `/tint/manager` screen.
- The Tint Manager History idea belongs in ROADMAP.md as a planned item, not merged as shipped — it wasn't built.
