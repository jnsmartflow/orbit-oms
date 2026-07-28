# The Picking DESKTOP board — retired 28 July 2026

Superseded by **Floor Control** (`/floor`).

*This file is the STORY of one retirement. The METHOD it followed — reusable for the
next one — is in [`../RETIREMENT-PLAYBOOK.md`](../RETIREMENT-PLAYBOOK.md).*

---

## 🔴 READ THIS FIRST — `/picking` IS STILL LIVE

**This was NOT a route retirement.** Every previous entry in this folder removed a whole
screen at a whole web address. This one removed **one branch from inside a route that is
still running**.

`/picking` was a single address with two faces chosen by screen width. The wide-screen
table is gone; the card board it shared the route with now renders at **every** width.
So:

- **No page key was removed.** `picking` is still in `lib/permissions.ts`.
- **No permission row was cleared.** Nothing in `role_permissions` changed.
- **No orphaned database rows.** There is no step 5b here, because there is nothing to
  clean up.
- **NO SQL WAS RUN AT ALL** — not even a delete. The only query in the whole programme
  was a read-only `SELECT` to confirm who holds what.
- **No login landing moved.** `floor_supervisor` and `picker` still land on `/picking`
  (`lib/rbac.ts`), and it still works for them.
- **No API route was deleted.**

If you came here expecting the usual shape, that is why it is missing.

---

## What it was

The **desk supervisor's picking queue** — a wide table of the day's bills waiting to be
picked, on a PC screen. Eight columns: a checkbox, a running `#`, the OBD number with its
date-time underneath, the dealer, the route, litres, flag icons (★ key customer, ⚡
urgent) and a status pill reading Waiting / Assigned / Picked / Ready.

Around the table sat a filter panel (route, status, delivery type), a search box, a
List ⇄ By Route toggle, slot bands under the "All" tab, per-slot header badges with
counts, a date stepper for looking back at a past day, and a collapsed "🔒 Upcoming"
section holding future-dated bills that could be read but not assigned. Selecting rows
raised a sticky bar at the bottom to assign them all to one picker.

It lived at `/picking` behind `hidden md:block` — it only ever appeared on a screen wider
than the `md` breakpoint. It had been redesigned as recently as 22 July 2026.

## Why it went

Three reasons, in this order:

1. **Floor Control does the desk job on one screen.** `/floor` was built in July 2026
   specifically to merge the Support board and this one. Keeping both meant two places to
   look and two places to fix — and in practice only Floor was being kept current.
2. **The floor team is Android-only.** ~3 supervisors and ~9-10 pickers, all working from
   phones. The card board is not a small-screen convenience; it is the real working
   surface, and always was.
3. **Nobody was using the desktop table.** Confirmed by the owner, out loud, before any
   file moved — the same gate the playbook demands.

A written parity analysis was done first rather than assuming Floor covered everything:
`docs/prompts/drafts/code-discovery-2026-07-28-picking-desktop-retirement.md`. It found
real gaps, listed below, which were accepted knowingly.

## What moved OUT before the archive

Two extractions, both in their own commits, both **before** anything was removed. This is
the step that stops live knowledge dying with a file.

| What | Where it lives now | Commit |
|---|---|---|
| Six visual rules that were never desktop-only — age tags (`1d`/`{n}d`), the locked/Upcoming treatment, route-as-plain-text and why, the rejected-feature list, and the "status pill is never teal" rule | `CLAUDE_UI.md` **§62.1-§62.4** and **§1** | `90c9a865` |
| The `pick_checked → dispatched` workflow-hole note — an open, unrelated gap that happened to be documented in the desktop board's section | `CLAUDE_PICKING.md` **§7** | `561368da` |

The first mattered because `CLAUDE_UI.md §62` (the mobile card spec) literally pointed at
§61 for two of those rules. Collapsing §61 first would have left a dangling reference to a
section that no longer said anything.

The second mattered more: that note is a **live, open problem** — nothing automatically
moves an order from `pick_checked` to `dispatched` — and it had nothing to do with this
board. Collapsing the section around it would have quietly deleted a known gap.

## What was REMOVED with it

All of this existed only to serve the desktop table, and all of it was proven caller-less
before deletion:

| Removed | Was | Commit |
|---|---|---|
| `components/picking/picking-queue.tsx` | the board itself, 1,217 lines | `21a73212` |
| The `rolling` queue scope | a third date-scope arm in `lib/picking/queue.ts`, added 2026-07-21 for this board | `47cc99f9` |
| `windows[]`, `totalCount`, `unmatchedCount`, `assignedCount` | four aggregate counters on the queue payload — the slot badges and the header stats | `b51cd14f` |
| `isStillWaiting` | the predicate behind those counters | `b51cd14f` |
| `PickingWindowSummary` | the interface for `windows[]` | `b51cd14f` |
| A `prisma.dispatch_slot_master.findMany()` | a **database round-trip** whose only purpose was building `windows[]`. Every queue fetch now makes one query fewer | `b51cd14f` |
| `scripts/_chk-scope-parity.ts` | an **untracked** local scratch script — the last thing reading those four counters | `b51cd14f` |

`getPickingQueue()` now returns `{ date, rows }`. Every surviving surface counts what it
needs off `rows`.

⚠ **The "still needs a picker" rule was NOT deleted.** It is preserved verbatim as a
tombstone comment above `PickingQueueResult` in `lib/picking/queue.ts`, because it
excludes future-dated rows — the non-obvious part — and because
`CLAUDE_NOTIFICATIONS.md §7` points a future supervisor-reminder timer straight at it.

## What SURVIVED — the must-not-touch list

> ### 🔴 `app/api/warehouse/pickers/route.ts` IS LIVE. NEVER ARCHIVE `app/api/warehouse/`.
> It has a warehouse name and sits in a warehouse folder, but it belongs to **Picking**.
> It had two callers; the archived board was one of them. The other —
> `components/picking/picking-board-mobile.tsx:936` — is the live supervisor board on the
> floor team's phones. **The route survived precisely because the surviving caller was
> checked before anything moved.** It is still the only file under `app/api/warehouse/`.

| Survived | Why |
|---|---|
| `lib/picking/sort.ts` | The server sorts **every** queue with it, and `lib/floor/sort.ts` imports its five rule objects to build `FLOOR_SPINE`. Shared with a live screen |
| `lib/hooks/use-picking-marker.ts` | Four call sites became three. The supervisor board, the picker board and **Floor** all still use it. Only the dead `"rolling"` value left its type |
| `POST /api/picking/assign` · `/unassign` | Called by the surviving board **and by Floor** |
| The `single` scope | **Kept deliberately, owner decision.** It has no caller in app code — but it is what a request with no `?scope=` resolves to, and both public routes still accept it by name. Removing it would change a live API contract for no benefit. **Do not re-derive it as dead code.** The only thing that ever exercised it was the scratch script deleted above |
| `openPending` | The scope every live board uses |
| The picker "My Picks" split in `app/picking/page.tsx` | Untouched, and verified byte-identical by diff after the edit |
| Both mobile boards | Never in scope. Not retired, not superseded, not changed |

## Known gaps — accepted on the record

Floor Control is **not** a like-for-like replacement. These were found by the parity
analysis and accepted knowingly, which is the point of doing it:

- **The `#` number means something different.** The desktop table numbered the whole day
  1..N and the number never moved. Floor restarts at 1 inside every slot band and every
  route group. If anyone calls out "do number 14 next", that phrase no longer identifies
  one bill.
- **The slot and header counts answer a different question.** Desktop counted *bills that
  still need a picker*. Floor counts *all bills in that slot, whatever their state*.
- **No desktop home for unmatched bills.** The desktop board had an "Unmatched" tab
  listing bills whose customer never resolved. Floor shows "(Unmatched)" on a row but
  offers no way to find them. Tint Manager's resolver can still fix one — nothing now
  *lists* them.
- **Approve is phone-only.** There is no way to approve a picked bill from a PC. This was
  already true before the retirement — the desktop board never had Approve either — but it
  is worth stating plainly now that it is the only option.
- **The push-test link is unreachable at desktop width.** Its two doors were the desktop
  pill (archived here) and a mobile-only link that is `md:hidden`. The page still answers
  at its URL. Removing that scaffolding was already planned.

Also gone, and deliberately not rebuilt: the whole-day By-Route view, the arbitrary-date
stepper, the board-wide Select-All, and the header stats line (which Floor's own design
had removed on purpose).

## How it was done — six steps

| Step | Commit(s) | What |
|---|---|---|
| 1 | `90c9a865` | Extract the six live rules out of `CLAUDE_UI.md §61` **before** collapsing anything |
| — | `bd251ee7` | Commit the discovery report as a dated record |
| 2 | `e08dc10e` | Fix two stale code comments **before** touching the code they described |
| 3 | `21a73212` | Remove the desktop face; `git mv` the board here; the card board loses its breakpoint |
| 4 | `50e997f0` | Hide Picking from the **desktop sidebar only** — the phone Menu sheet keeps it |
| — | *(by hand)* | Owner tested both surfaces on a real PC and a real phone |
| 5 | `816f9150`, `47cc99f9`, `b51cd14f` | Five more stale comments; then remove `rolling`; then the counters and their scratch reader |
| 6 | `561368da`, `af72075a`, *(this commit)* | Correct every document; write this README |

Full range: **`90c9a865` → this commit.**

⚠ **Step 5 was deliberately AFTER step 4's hand test.** While `rolling` and the counters
still existed, step 3 could be reverted with one `git revert`. Cleanup and removal were
kept as separate commits for exactly that reason.

## Nothing in this folder runs

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is in
`tsconfig.json`'s `exclude` list, so the type-checker skips it and Next.js never builds
it. No web address leads here. A visitor to orbitoms.in cannot reach any of it, and
neither can a logged-in member of staff.

It is text on disk, kept so a person can read it.

`mockups/` holds the nine approved desktop designs that led to the 22 July redesign. The
**mobile** mockups stayed in `docs/mockups/picking/` — they are live references for boards
that are still running, cited by name in `CLAUDE_PICKING.md §8` and by fidelity comments
throughout `picking-board-mobile.tsx`.

⚠ **Those nine were moved with a plain `mv`, not `git mv`, and this commit is the first
time they enter git at all.** They had never been committed — `docs/mockups/picking/` holds
39 files of which only 10 were tracked. There was no history to preserve, so the playbook's
"`git mv`, never copy-and-delete" rule had nothing to protect here. Worth knowing before
you go looking for their past: they do not have one.

## Honest note on reinstating this

Moving `picking-queue.tsx` back would not compile. It imports `PickingQueueResult`
expecting four counter fields that no longer exist, and calls the queue with
`scope: "rolling"`, which is no longer a valid value. Restoring it means restoring the
scope arm, the four counters, `isStillWaiting`, `PickingWindowSummary` and the
`dispatch_slot_master` read as well — and then re-adding the `hidden md:block` wrapper and
un-hiding the sidebar entry.

**Treat this folder as reference, not a rollback plan.** If the desk needs something the
card board cannot give it, **build it into `/floor`** — that is where the desk work
already lives, and two screens doing one job is the problem this retirement solved.

One caveat if you do: `/floor` is granted to **admin and operations only**.
`floor_supervisor` and `picker` hold `picking` but **not** `floor` (SELECT, 2026-07-28).
That is why this retirement kept `/picking` live instead of redirecting desktop visitors
to Floor — a redirect would have landed both roles on a permission denial.
