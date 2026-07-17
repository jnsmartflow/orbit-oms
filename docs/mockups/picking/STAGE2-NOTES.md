# Stage 2 Mockup Notes — v2 (de-weight pass)

2026-07-17 · Static HTML mockups, not wired to app code. Grounded in
`docs/prompts/drafts/code-discovery-2026-07-17-picking-stage2.md` and
`components/picking/picking-board-mobile.tsx`.

v1 was too heavy — too many boxes/bands/badges/borders per idea. This pass
subtracted; nothing was added to compensate. v1's three open questions are
now settled (see below); this version only carries what's still genuinely open.

**v3 (small edits):** picker-my-bills.html renamed "My Bills" → "My Picks"
everywhere. supervisor-check-split.html: green left accent removed —
sections now carry the "needs check" vs "still picking" distinction alone.
supervisor-check-ticks.html: tick shrunk to normal checkbox size.

---

## 1. `picker-my-bills.html`

**Changed:** two plain-text tabs (Pending/Done) replace the flat list.
Search cut entirely. Card cut to three lines — OBD+window, dealer name,
area+articleTag — no flags, no elapsed pill, no avatar. Done-tab card is the
same shell, muted, with a done-time string where line 1's right side would
otherwise be empty.

**Why:** a picker doesn't triage by key-customer/priority flags or age —
those are supervisor signals for deciding who gets what. His job is binary:
not done yet, or done. The tabs say that directly.

---

## 2. `picker-detail-done.html`

**Changed:** the bottom-sheet confirm is gone. Mark done fires immediately
— toast, then back to the list. Added a Pending/Done variant switch so one
file shows both the live (CTA) and read-only (done-time, no CTA) states.

**Why (settled, was open in v1):** fire-and-forget matches the existing
assign/unassign pattern already live in this codebase — neither has a
confirm dialog today. The Done tab is now the actual safety net (he can go
look and see it landed); a confirm sheet was solving a problem the Done tab
already solves.

---

## 3. `supervisor-check-split.html`

**Changed:** card is one block, not two. Footer (avatar/name/meta/Undo)
deleted; picker's name folds into the existing area line: "Adajan ·
Ramesh K." Section headers are plain text + count, no dot, no filled badge.
Green left accent removed entirely (v3) — both sections now use the
identical card; the section header and "still picking" muting are the only
signals, and that's sufficient.

**Why (settled, was open in v1):** Undo doesn't belong on every card — it's
a rare exception, not the tab's primary job (checking is). It moved to the
detail/tick screen as a secondary action instead of a full-width card
element.

**Still open:** with Undo off the card and not replaced with new
navigation, "Still picking" cards currently have no tap target and no Undo
— there is no supervisor-facing way to unassign a bill before it reaches
"Needs check." Not patched here; flagging rather than inventing a new
control the brief didn't ask for.

---

## 4. `supervisor-check-ticks.html`

**Changed:** progress bar/track/hint deleted, replaced by one small "4 / 9
checked" line under the volume in the stat strip. Tick column's border
deleted. Ticked card's teal ring deleted — the filled circle is the only
signal now; SKU/name mute slightly instead.

**Why (settled, was open in v1):** ticks stay freely toggleable. A one-way
tick was considered and rejected — this is a forcing function, not a lock;
locking a tick just adds a trap for an honest re-check, with no schema or
build-cost benefit either way (both are pure client state).

**Undo — designed, then deliberately dropped (2026-07-17 build session).**
A small text button in the header (opposite the back arrow) was designed
and mocked in v2/v3 of this file. The build brief for this screen settled
on **no Undo here at all**: a picked bill goes forward only — if the pick
is wrong, the supervisor tells the picker to fetch the rest, then approves.
The mockup file has been edited to match (button, CSS, and JS removed). A
later session must not rediscover this as new scope — it was considered and
rejected, not overlooked.

---

## Cross-cutting

- All four still share one visual system pulled from
  `picking-board-mobile.tsx` — no new colors, radii, or shadows introduced
  in this pass, only removals.
- Same click-through links between files as v1; each still opens and
  renders sensibly standalone.
- Nothing here touches the `pick_assignments.status` CHECK-constraint
  question from the discovery (§C2) — unchanged, not relitigated.
