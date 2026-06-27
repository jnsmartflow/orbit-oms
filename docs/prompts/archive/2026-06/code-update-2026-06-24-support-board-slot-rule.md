# Support Board-Slot Rule — LOCKED

**Date:** 2026-06-24
**Module:** Support (`/operations/support`) + shared slot helper (also affects Mail Orders)
**Status:** Design locked. Not yet built.

---

## One-line summary

Support's slot is a **board-display rule only** (where to show an order so the
operator can tally + gate it) — NOT a dispatch rule. Punch day decides which
day's board; received time (or punch time, if carried over) decides which slot.
Plus a shared cutoff fix: cutoff time now belongs to its **own** slot, not the next.

---

## Hard boundary: board rule ≠ dispatch rule

- **Support slot** = which day's board + which slot column an order appears in,
  so a human can see it, tally it against the mail order, and gate it
  (dispatch / hold / which slot to forward).
- **Dispatch rule** = when the vehicle physically loads / leaves (same-day waves,
  UPC overnight, volume-based rolling). This lives DOWNSTREAM (Planning / Warehouse),
  NOT in Support.
- The two can differ: an order shown in Support's Morning may be planned by Planning
  for tomorrow's overnight UPC load. Support does not care — its job ends at
  "tallied and gated."

---

## Rule 1 — Which day's board

**Punch / OBD date decides which day's board the order shows on.**

"When did this become my work?" An order punched today is today's work,
regardless of when the mail arrived.

---

## Rule 2 — Which slot

**If received and punched are the SAME day → slot from received time-of-day.**
**If punched on a LATER day than received (carried over) → slot from punch time-of-day.**

Reasoning: a fresh order keeps its mail-arrival wave (kills the manual-drag toil
where a 10:20-received / 10:40-punched order had to be hand-moved back to Morning).
A carried-over order's original wave is already gone, so it honestly joins the wave
it gets punched into.

The board never force-rolls. A yesterday-night order punched tonight at 21:00 lands
in **today's Night** slot (punch time), flagged old-receive. Planning makes the real
dispatch decision, not the board.

### Worked cases (all confirmed)

| Case | Received | Punched | Board day | Slot | Flag |
|---|---|---|---|---|---|
| 1 Normal same-day | today 10:20 | today 10:40 | Today | Morning (received) | none |
| 2 Late-night, next-morning | yest 19:34 | today 10:10 | Today | Morning (punch) | rec. yesterday |
| 3 Mukesh credit-block | 19 Jun 10:26 | 24 Jun 10:15 | Today (24) | Morning (punch) | rec. 19 Jun · 5d |
| 4 Late-night same-night | yest 23:50 | yest 23:55 | Yesterday | Night (received) | none (carry-over if unresolved) |
| Wrap-around | yest 21:00 | today 21:00 | Today | Night (punch) | rec. yesterday |

---

## Rule 3 — Slot cutoffs (SHARED CHANGE: Mail Orders + Support)

**Change:** cutoff time now belongs to its OWN slot, not the next slot.
Comparison flips from `mins < cutoff` to `mins <= cutoff` in `getSlotFromTime()`.

| Slot | Condition (IST minutes) | Default cutoff |
|---|---|---|
| Morning | received **≤ 10:30** | 630 |
| Afternoon | > 10:30 and **≤ 12:30** | 750 |
| Evening | > 12:30 and **≤ 17:00** | 1020 |
| Late-Evening | > 17:00 and **≤ 20:00** | 1200 |
| Night | **> 20:00** | — |

- Exact 10:30 → Morning. Exact 12:30 → Afternoon. Exact 17:00 → Evening.
  Exact 20:00 → Late-Evening. Strictly after 20:00 → Night.
- Cutoffs stay DB-configurable via `system_config`
  (`slot_morning_cutoff` / `slot_afternoon_cutoff` / `slot_evening_cutoff` /
  `slot_late_evening_cutoff`). Hardcoded fallbacks 630 / 750 / 1020 / 1200.
- `getSlotFromTime()` is shared — fixing it once fixes BOTH Mail Orders and Support.
  (Build must confirm it is genuinely one shared function, not two copies.)

---

## Rule 4 — Card display (dual date)

- **Punch / OBD date** shown bold — it's the order's "this is today's work" anchor.
- **Received date** shown as a secondary line, with a ⚠ flag ONLY when it is an
  older calendar day than the punch date (e.g. "⚠ rec. 19 Jun · 5d ago").
- Same-day orders (99%): received-flag hidden, card stays clean.

---

## Rule 5 — Look + feel: mirror Mail Orders

Support board adopts Mail Orders' slot conventions so the two screens feel identical:

- **Full 5 slots** (Support currently has 4 → add Late-Evening) in fixed order:
  Morning → Afternoon → Evening → Late-Evening → Night. Empty slots omitted from list.
- **Dot colours:** Morning amber-400 · Afternoon blue-500 · Evening purple-500 ·
  Late-Evening indigo-500 · Night gray-400.
- **Sort within slot:** received ASC → bill number ASC → split label ASC.
- **Done group:** collapsed by default, `T` key toggles, "N done ▸" divider
  (Support already has this from the gatekeeper session — keep it).
- **Section header:** dot + slot name + "N orders" left; volume + done count right.

---

## What does NOT change

- **Slot stays STORED in `orders.slotId`** (Support keeps storing, not render-time
  computed like Mail Orders). Only HOW it's computed changes (new Rule 1+2 logic).
  This protects downstream workflow that reads `slotId`. Do not move Support to
  render-time slotting in this change.
- Auto-done gatekeeper, carry-over, undo-dispatch — all untouched.
- Dispatch rules / Planning / Warehouse — untouched (different layer).

---

## The original bug this fixes

OBD 9107839329: received yesterday 19:34, punched today 10:10. Old code recalculated
slotId from `receivedAt` (yesterday 19:34 → Night) and auto-closed it → it landed in
Night slot's collapsed Done group while the operator watched Morning. New rule:
carried-over → slot by punch time (10:10 → Morning) → shows correctly on today's
Morning board. Fixed by Rule 2.

---

## Open follow-ups (not in this change)

- `dispatchDeliveryTypeId` is 100% NULL — per-customer delivery override never
  populated. Delivery-type-aware DISPATCH planning is a future Planning-layer build.
- Delivery type (Local/UPC/IGT) is not stamped on orders — only derivable via
  customer→area join. Stamp-at-import is a prerequisite for the Planning layer later.
- Mail Orders slot-email auto-trigger only fires for Morning/Afternoon/Evening
  (Late-Evening + Night excluded) — pre-existing gap, not addressed here.
