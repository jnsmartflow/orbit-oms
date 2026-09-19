# Code update — Floor History rows open a READ-ONLY detail panel

**Date:** 2026-08-25 · **Module:** Floor Control (`/floor`) · **Canon touched:** `docs/CLAUDE_FLOOR.md` §4.7
**Files:** `lib/floor/types.ts` · `components/floor/floor-table.tsx` · `components/floor/floor-page.tsx` · `components/floor/detail-panel.tsx`

Sibling to `code-update-2026-08-25-floor-history-checked-arm.md`, which made the bill *appear* in
History. This makes it *readable*.

---

## 1. The defect

A row in Floor History could not be opened. The user could see that OBD 9109086370 was Done at
18:34 on 24 Aug, and could not read its SKU lines or its Activity log.

The cause was not a guard and not a read-only flag — **the handler was wired and had no trigger.**
`onOpenDetail` reached the history table intact (`floor-page.tsx` → `floor-board.tsx`'s `selProps`,
spread into every `<FloorTable>`, no mode term anywhere in that chain), but `floor-table.tsx`'s
`statusCell` is a three-way branch on `variant` and the ⋯ button existed only in the `live` arm.
`grep -n onClick components/floor/floor-table.tsx` returned two hits, both inside that arm; there
was no `<tr onClick>` and no clickable OBD cell. A prop is not a trigger.

The data was never the problem: `app/api/floor/order/[orderId]/route.ts` keys on `id` +
`isRemoved` only — no stage, date or mode term.

## 2. Why simply opening it would have been dangerous

The panel gates every action on `source`, **never** on live-vs-history, and the board passed
`"floor"` unconditionally. On a `pick_checked`, already-invoiced bill opened from a past day, this
was reachable:

| Control | Old gate | Would have written |
|---|---|---|
| Update slot | `source !== "cancelled"` | `change-slot` — re-slot a dispatch that already happened |
| Change ship-to | **ungated** ("Never disappears") | `/api/floor/ship-to` — redirect a delivered bill |
| ⋯ Hold | `source === "floor" \|\| "rail"` | `/api/floor/actions` hold |
| ⋯ Cancel | `source === "floor" \|\| "rail"` | `/api/floor/actions` cancel |

Release, Restore, Assign/Reassign and Unassign were excluded only by *stage* accidents, not by any
history rule — change the bill's stage and they return.

## 3. The change

**Default-closed, by extending the existing vocabulary.** `FloorDetailSource` gains `"history"`.
Every gate in `detail-panel.tsx` is phrased `source === "floor" | "rail" | "hold" | "cancelled"`, so
a **new** member matches none of them and each action disappears on its own. That default-closed
property is the whole reason this is a union member rather than a separate `readOnly` prop — a new
prop would have to be threaded into every gate by hand, and the next control added would be
reachable until someone remembered.

Only two things needed touching, because only two were not phrased that way:

1. **The header slot chip** — gated by NEGATION (`source !== "cancelled"`), so it would have
   rendered. Now `source !== "cancelled" && !readOnly`.
2. **The whole action row** — suppressed wholesale (`readOnly ? null : editingShipTo ? … : …`).
   One gate, not five: the row is the only host of Release, Restore, Ship-to, Assign/Reassign and
   the ⋯ menu, **and** `setEditingShipTo(true)` — the only trigger for the ShipToEditor — is a
   button inside it, so the editor branch becomes unreachable too. Removing the container is what
   makes the claim hold *by construction*; gating each control would leave the next one silently
   reachable.

`readOnly = source === "history"` is the one derived boolean, deliberately the same shape as
`interactive = variant === "live" && !!onToggleRow` in `floor-table.tsx`. **No third read-only
concept.**

Plus the trigger: history rows get a ⋯ on hover — **⋯ only, never the live arm's ⚡**, which is
`onMarkUrgent`, a write.

### Zero-write proof — one grep

`grep -n "actions\.on" components/floor/detail-panel.tsx` yields 10 call sites. Every one sits
inside a guarded region:

| Line | Action | Enclosed by |
|---|---|---|
| 380 / 382 / 383 / 385 | Unassign / Hold / Cancel | `source === "floor"\|"rail"\|"hold"` → no match **and** inside the action row |
| 437 | `onUpdateSlot` | `source !== "cancelled" && !readOnly` (:434) |
| 521 | `onChangeShipTo` | the `editingShipTo` branch of `readOnly ? null : …` (:515) |
| 535 | `onRelease` | action row (:515) + `source === "rail"\|"hold"` |
| 556 | `onRestore` | action row (:515) + `source === "cancelled"` |
| 603 | `onReassign` | action row (:515) + `canReassign` (`source === "floor"`) |

Reachable write endpoints from a history panel: **none** — not hold, cancel, restore, release,
mark-urgent, change-slot, assign, unassign, ship-to save or update slot.

## 4. The two traps, answered

**(a) `load()` refetches in the current viewMode.** *Proven unreachable, not assumed.*
`detailActions` is built once (`floor-page.tsx:594`) and consumed at exactly one place —
`actions={detailActions}` on `<DetailPanel>` (:1053). `grep -rn DetailActions components/floor/`
returns only the interface, the two prop declarations and that one construction: nothing else holds
the object. Every function in it calls `load()`, and every one is invoked **only** through
`actions.on*` inside `detail-panel.tsx` — all 10 sites guarded per the table above. With no handler
callable, `load()` cannot fire from a history panel. `load()` itself is read-only (three GETs).

**(b) `headerStatus` reads live `dispatchStatus`.** *Chosen: a history header describes the WORK,
from that day's facts, and is never rewritten by anything that happened afterwards.*
An explicit `source === "history"` case is placed **first — specifically above the
`d.dispatchStatus === "hold"` term**, which is the line that would otherwise stamp "On hold" across
the record of a day on which the bill was picked and checked. It reads `isChecked` → **Done**,
`isDone` → **Needs check**, `isAssigned` → **With picker**, else **Not completed** — the same ladder
and the same colours as the `"floor"` branch, so one bill reads the same in both views. Without the
case it would have fallen through to the *rail* branch and rendered "Waiting for you".

This is the rule already canonised for the Billing day-record in `lib/billing/picking-where.ts`
("a later hold must not retroactively erase the fact that the bill was checked that day").

Reading the stage facts here is safe: `getFloorBoard`'s history predicate admits only
`PICKING_ACTIVE_STAGES`, so a row that reaches this panel is at `pending_picking` / `pick_assigned` /
`pick_done` / `pick_checked` — never cancelled, and `pick_checked` is terminal for picking.

## 5. Prev/Next — verified against `detailList`

`case "history"` shares the `case "floor"` branch, and that branch is already correct for both:
`filteredFloor` derives from `scopedData.floor.rows`, which **is** the history payload in history
mode. Prev/Next therefore steps through the viewed day's rows and can never reach a live row — the
two never coexist in one payload.

## 6. Not changed

`lib/floor/queries.ts` (today's history WHERE fix — correct and live), `floor-board.tsx`, the API
route, the schema. No new API route, no SQL, no writes added anywhere. The panel keeps its header,
tabs, Details / Items / Activity and Prev/Next — only the ability to change anything is gone.

---

*Draft record · 2026-08-25 · canon updated in `docs/CLAUDE_FLOOR.md` §4.7*
