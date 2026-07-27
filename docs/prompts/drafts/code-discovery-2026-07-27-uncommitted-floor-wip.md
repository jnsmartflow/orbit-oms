# Uncommitted Floor work — what is it
# 2026-07-27 · read-only

Nothing was staged, committed, pushed or edited to produce this report. The dev server was
left running. Every claim is from `git diff HEAD` against the four files.

---

## 1. Verdict

It is **one finished piece of work**, not four loose edits: a **redesign of the three places on
`/floor` where the operator takes an action** — the bulk action bar, the detail-panel header, and
the date/time slot picker — done **25–26 July 2026** against approved mockups and a written brief.
It is **screen-only**: no database column, no API route, no data shape changed anywhere in it.
It looks **complete** — no leftover TODOs, no debug printing, no dead buttons, no unused props.
**Safe to ship**, with two things to tell people first (§8): three bulk buttons were deliberately
removed, and one tap in the slot picker now means something slightly different.

**Why nobody remembers it as pending:** the work has its own written record,
`docs/prompts/drafts/web-update-2026-07-26-floor-action-surfaces.md`, and that document says
**"Status: SHIPPED — all changes committed to main and live."** Git disagrees: the code was written
but the commit never happened. The brief itself is also untracked. So the work was finished and
then simply never saved into version control.

---

## 2. `detail-panel.tsx` — the slide-out bill panel

[The panel that slides in from the right when you click a bill.]

**1. What changed, in plain English.** The top strip of the panel was rebuilt.
- The **dispatch slot moved up to the top line**, next to the bill number, and became a **clickable
  chip with a pencil icon** reading e.g. `27-07 · 16:00`, or a dashed **"No slot"** when none is set
  (`:348-364`). Before, it sat lower down behind a small grey "Slot" label.
- The **customer name got bigger and bolder** (14px → 16px, semibold → bold, `:372`).
- The **action row was reordered and restyled**. Buttons grew from 30px to 34px tall, sit on a grey
  band, and the **one coloured (teal) button now changes with the situation**: on a bill waiting for
  a decision or on hold, **Release** is teal; on a bill already on the floor, **Ship-to** is teal.
- **Restore to decisions** (for a cancelled bill) moved to the front of the row.
- The **⋯ menu keeps exactly the same contents** (`:491`, comment says so) — it just moved to the
  right-hand end and became a square button.
- A line of text that used to read *"This bill is closed — ship-to still editable"* was **removed**.
- The panel **stopped listening for the Escape key itself** (`:192-194`); Escape is now handled in
  one place only (see `floor-page.tsx` below).

**2. Visual or behavioural?** **Both**, but mostly visual. The only behaviour changes are: the slot
chip is now clickable from the top line, and Escape is handled elsewhere. No new action was added,
and no existing action was removed.

**3. Finished or half-done?** **Finished.** No `TODO`, no `FIXME`, no `console.log`, no
commented-out code, no button wired to an empty function. It also *cleans up* as it goes: a unused
variable (`isDoneBill`) was deleted rather than left behind (`:317` in the old version).

**4. Database or API?** **Neither.** It calls exactly the same handlers it called before. No new
address, no new field sent.

**5. Risky for a real user tomorrow?** No. The worst case is a moment of "where did the slot control
go" — it moved up, it did not disappear.

---

## 3. `dispatch-slot-picker.tsx` — the date + time popup

[The little pop-up where you choose a delivery day and a time window.]

**1. What changed, in plain English.**
- **Restyled from teal to neutral.** The chosen day and the chosen time are now near-black instead
  of teal green; the surrounding chrome is grey (`:212-215`, `:260`, `:314`).
- **The six day tiles became one joined strip** with hairline dividers, instead of six separate
  rounded pills (`:244-270`). A month label (`Aug`) now appears only on tiles that fall in a new
  month, so "1 Aug" cannot be misread as "1 July".
- The **"WINDOW" caption above the time buttons was deleted** — the four time buttons stand alone
  (`:305`).
- **The popup now flips itself to fit.** If there is not enough room below the button it opens
  upward, and if there is not enough room either way it caps its height and scrolls inside
  (`:107-147`). It also **re-positions while you scroll** the list behind it, so it stays glued to
  its button instead of drifting away (`:164`).
- **The most consequential change: what gets highlighted when the popup opens.** It used to always
  highlight **today**, even for a bill promised for a different day. Now it highlights **the bill's
  own day** if that day is one of the six visible; and if the bill's day is not visible (in the past,
  or far ahead) it highlights **nothing at all**, rather than pointing at a day that is not the
  bill's (`:220-228`).
- A small invisible marker, `data-slot-popover="open"`, was added to the popup (`:236`) purely so the
  rest of the screen can tell when a picker is open. It has no appearance and no behaviour of its own.

**2. Visual or behavioural?** **Both.** The colours and layout are visual. The auto-flip and the
highlight rule are behavioural.

**3. Finished or half-done?** **Finished.** No leftovers of any kind. (One tiny pre-existing untidiness
is unrelated to this work and was already in the committed version: a helper computes a `tomorrow`
date that nothing uses, `:38-44`.)

**4. Database or API?** **Neither.** The moment a value is actually saved is untouched — the brief
records `handleSelect` as byte-identical, and the diff confirms it.

**5. Risky for a real user tomorrow?** **One thing to know, and the brief flags it as the change to
watch.** Tapping **only a time**, without first tapping a day, used to move the bill to **today** at
that time. It now keeps the bill on **its own day** and changes only the time. That is the more
correct behaviour — "move this from 16:00 to 12:30" should not silently drag the date too — but it is
a genuine change to what one tap does. Because this control is shared, **`/support` gets this change
too**, without any Support file having been edited.

---

## 4. `assign-bar.tsx` — the bar that rises when you tick bills

[The strip along the bottom that appears once you select one or more bills.]

**1. What changed, in plain English.** The bar went from **eight controls down to four**.
- **Removed: "Mark urgent", "Hold", and "Unassign".** The replacements already exist elsewhere —
  urgent is the ⚡ on each row, Hold and Unassign are in the bill's own ⋯ menu.
- **"Change slot" became one proper button** with a calendar icon, instead of a grey label sitting
  next to a small pill (`:76-105`).
- **The picker dropdown and the Assign button are now joined** into a single control that reads as
  one unit (`:110-133`).
- **The summary line is richer.** It now reads e.g. *"3 selected · 1,240 L · 2 routes · 1 already
  assigned"*, or for a single bill the customer's name and its volume (`:53-59`). A small ✕ next to
  the count clears the selection.
- The Assign button says **"Reassign all 3"** when every ticked bill already has a picker.
- The bar now **renders nothing at all when nothing is selected** (`:47`), rather than relying on the
  page to hide it.

**2. Visual or behavioural?** **Both** — and this is the only file of the four that **removes
capabilities** a person could use.

**3. Finished or half-done?** **Finished.** The three removed buttons were removed *cleanly* — the
matching handlers were deleted from `floor-page.tsx` and the props deleted from both the component's
signature and the call site, so there is no half-connected wiring left. The brief records that a
repo-wide search was done first to confirm nothing else used them.

**4. Database or API?** **Neither** — but note the three deleted buttons were the only screen path to
two things the server can still do: *hold many bills at once* and *unassign many bills at once*. The
server endpoints are untouched and still work; nothing on screen calls them in bulk any more.

**5. Risky for a real user tomorrow?** **This is the one to check with the depot.** If anyone was
using "select 12 bills → Hold" or "select 12 bills → Unassign", that is now twelve separate actions
through each bill's ⋯ menu. The brief acknowledges bulk-unassign as the weakest of the three
removals: *"it fell out of the four-control layout and was accepted after the fact."*

---

## 5. `floor-page.tsx` — the screen's control room

[The file that holds the whole Floor screen together.]

**1. What changed, in plain English.** Two things.
- **Three bulk actions were deleted** — `bulkMarkUrgent`, `bulkHold`, `bulkUnassign` (`:226-228`,
  `:250-251`) — matching the bar above. Explanatory comments were left in their place so a future
  session does not "restore" them thinking they went missing by accident.
- **One Escape-key handler now owns the whole screen** (`:432-451`). Press Escape and exactly one
  thing happens, in this order: if a bill panel is open, close it; otherwise, if bills are ticked,
  untick them; otherwise nothing. It deliberately **does nothing while you are typing** in a search
  box or a date field, so Escape can never wipe a selection mid-type, and **does nothing while a slot
  picker is open** — that is what the invisible marker in §3 is for.

**2. Visual or behavioural?** **Behavioural only.** Nothing on this screen looks different because of
this file.

**3. Finished or half-done?** **Finished.** No leftovers; the removed handlers are gone from both
sides of the wiring.

**4. Database or API?** **Neither.** Removing the bulk handlers removes *calls to* existing endpoints;
no endpoint was added, changed or deleted.

**5. Risky for a real user tomorrow?** No. The Escape rule is strictly safer than before — the old
version fired on every Escape press regardless of what the operator was doing.

---

## 6. One piece or several?

**One piece.** The evidence:

- All four files serve the same three surfaces, and each references the others in its comments.
- Three approved mockups sit alongside it, untracked (never committed either):
  `docs/mockups/floor-control/bulk-bar-v2.html` (25 Jul 12:27) and `slot-picker-v2.html`
  (25 Jul 12:55) — both named by filename inside the new code comments.
- A written brief covers exactly these three surfaces and no others:
  `docs/prompts/drafts/web-update-2026-07-26-floor-action-surfaces.md` (26 Jul 21:52), titled
  *"Floor Control — action surfaces redesign"*.
- The four files are **mechanically interlocked** — you cannot keep one and drop another. The bar no
  longer accepts the three props the page no longer sends; the panel relies on a helper built for the
  bar; the page relies on the marker added to the picker. Reverting any single file on its own would
  fail to compile or silently break the Escape key.

### When was it done?

| Signal | Date |
|---|---|
| Mockups written | **25 Jul 2026**, 12:27 and 12:55 |
| Slot-picker code last written | **26 Jul 2026, 20:58** (its file timestamp; untouched by today's move) |
| Brief written | **26 Jul 2026, 21:52** |
| Last actual commit to these files | **23–24 Jul 2026** — `34fad163` (Step 5), `8d87914a` (Step 7), `d476cf0e` (Step 9). The picker's last commit is older still: `8e39539c`, **27 Jun 2026** |

So: built on **25–26 July 2026**, one to two days after the last committed Floor work, and never
committed. The other three files' timestamps now read today only because this morning's step-1 move
touched one import line in each.

---

## 7. Does the build depend on it?

**Yes — and specifically, yes on the Escape key.**

`floor-page.tsx:442` contains this line:

```js
if (document.querySelector('[data-slot-popover="open"]')) return;
```

It looks for the invisible marker `data-slot-popover="open"`. That marker exists **only** in the
uncommitted version of the slot picker (`dispatch-slot-picker.tsx:236`). It is **not** in the
committed version.

Plainly: **reverting this uncommitted work would break the Escape key** — but it is worse than a
single break, because the two halves fail in opposite directions:

- **Revert the picker but keep the page** → the marker vanishes, so Escape stops noticing that a slot
  picker is open. Pressing Escape to dismiss the date popup would also close the whole bill panel, or
  wipe the operator's ticked selection.
- **Revert the page but keep the picker** → Escape stops working entirely on `/floor`. The old
  Escape handler that lived inside the detail panel was deleted as part of this same work, so there
  would be no handler left anywhere.
- **Revert the bar but keep the page** → the code will not compile at all: the page no longer passes
  three props the old bar requires.

The safe options are therefore **keep all four, or revert all four together** — not a file-by-file
choice. Keeping all four is what is on disk today, and it is what `npx tsc --noEmit` and the full
production build both passed on this morning.

---

## 8. Anything risky for a real user

Two items, neither a bug, both worth saying out loud before it goes live:

1. **Three bulk buttons are gone from `/floor`** — Mark urgent, Hold, and Unassign for many bills at
   once. Single-bill replacements exist for all three (the ⚡ on each row, and each bill's ⋯ menu).
   Worth one question to the depot: *did anyone use hold-many or unassign-many?* If yes, it is now
   one bill at a time.

2. **One tap in the slot picker means something different — and `/support` inherits it.** Tapping
   just a time, without tapping a day first, used to move the bill to **today**. It now keeps the
   bill on **its own day**. This is the safer behaviour, but Support operators use this control
   constantly and nothing on screen announces the change. (Note this is only relevant while Support
   is still live; it is being retired.)

Everything else is appearance: bigger buttons, neutral instead of teal, a joined day strip, a slot
chip that moved to the top of the panel.

**Not risky, for the record:** nothing in this work writes to the database differently, calls a
different address, or changes what is saved. No schema, no API route, no data shape — confirmed by
reading all four diffs end to end, and stated the same way in the work's own brief.
