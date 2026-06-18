# Context update — Mail Orders 5-slot display change

**Save to:** `docs/prompts/drafts/code-update-2026-06-18-mail-order-5-slots.md`
**Date:** 2026-06-18
**Source:** Claude Code session (planning in Claude.ai)
**Status:** Shipped to `main`, live on orbitoms.in
**Consolidate into:** `CLAUDE_MAIL_ORDERS.md`, `CLAUDE_UI.md` (pointers in §"Doc edits needed" below)

---

## What changed

Mail Orders display slots went from **4 → 5**. New slot **"Late Evening"** sits between Evening and Night.

### New boundaries (by `receivedAt`, IST — cutoff time belongs to the NEXT slot)

| Received time | Slot |
|---|---|
| before 10:30 | Morning |
| 10:30 – before 12:30 | Afternoon |
| 12:30 – before 17:00 | Evening |
| 17:00 – before 20:00 | **Late Evening (NEW)** |
| 20:00 – 23:59 | Night |

Edge moments: 10:30 → Afternoon, 17:00 → Late Evening, 20:00 → Night.

No data migration — slots are computed at render from `receivedAt`, so all existing orders re-bucket automatically.

### Boundary value changes

- **Evening cutoff moved 15:30 → 17:00.** (Note: the old docs said Evening ended 16:30 in §9.1, but the live code default was actually 15:30. Both were stale; 17:00 is now the real value.)
- **New cutoff added: 20:00** (Late Evening → Night line).
- Morning (10:30) and Afternoon (12:30) unchanged.

---

## Database

Cutoff times are DB-configurable via `system_config` (values stored as `"HH:MM"` strings, parsed by `parseHHMM()` in `utils.ts`). Four keys now:

| key | value |
|---|---|
| `slot_morning_cutoff` | 10:30 |
| `slot_afternoon_cutoff` | 12:30 |
| `slot_evening_cutoff` | 17:00  *(was 15:30)* |
| `slot_late_evening_cutoff` | 20:00  *(NEW row)* |

SQL run in Supabase: UPDATE evening → '17:00', INSERT late-evening = '20:00' (idempotent ON CONFLICT). `slot_master` table NOT touched.

---

## Files changed (4)

1. **`app/api/system-config/slot-cutoffs/route.ts`** — SELECTs the 4th key; response returns `lateEvening` (default `"20:00"`); evening default aligned to `"17:00"`. `"HH:MM"` contract + `force-dynamic` preserved.
2. **`lib/mail-orders/utils.ts`** —
   - `SlotCutoffs` interface gains `lateEvening: string`.
   - `getSlotFromTime()` return union adds `"Late Evening"`; 4th cutoff + 5th branch added; hardcoded fallbacks now `630 / 750 / 1020 / 1200`.
   - `groupOrdersBySlot()` fixed-order array inserts `"Late Evening"` before `"Night"`.
3. **`app/(mail-orders)/mail-orders/mail-orders-page.tsx`** — `"Late Evening"` added (in order, before Night) to: `slotCounts` init, `headerSegments` (5th pill), Focus auto-select array, `flatOrders` array, E-key target-slot array, `slotPunchStatus` loop.
4. **`app/(mail-orders)/mail-orders/mail-orders-table.tsx`** — `SLOT_DOTS` gains `"Late Evening": "bg-indigo-500"` (neutral, not teal); `slotOrder` inserts `"Late Evening"` before `"Night"`.

### Not changed (confirmed unnecessary)

- `lib/mail-orders/api.ts` — `fetchSlotCutoffs()` forwards the whole object; new cutoff rides along automatically.
- `review-view.tsx`, `slot-completion-modal.tsx`, `email-template.ts` — receive slot as a label/prop only.
- `universal-header.tsx` renderer + the "jump to slot" key handler — already segment-count driven, scale to 5 on their own.

---

## Known gap left in place (by owner instruction)

`mail-orders-page.tsx` `slotDefs` slot-email trigger array (~lines 269–273) has only 3 entries — Morning / Afternoon / Evening. It omits Night, and now also omits Late Evening. **Result: slot-summary emails do NOT auto-fire for Late Evening or Night.** Owner chose to leave email behaviour untouched this session. Flag for a future fix if auto-emails for those slots are wanted.

---

## Scope / architecture note for next session

Mail-orders slot bucketing is a **separate system** from the depot-wide `slot_master` (CORE §9) used by Support / Planning / Warehouse:

- Mail orders: computed at render from `receivedAt`, hardcoded names in `utils.ts`, cutoffs from `system_config`. No stored slot column on `mo_orders` (`slotToOverride` is dead/write-only — no reader).
- Depot-wide: `slot_master` (rows 1–5), `resolveSlot()` on `orderDateTime`, stored on `orders.slotId`. Uses DIFFERENT boundaries. Untouched this session.

So the two never share numbers — changing one does not affect the other.

---

## Doc edits needed (for consolidation)

- **`CLAUDE_MAIL_ORDERS.md` §9.1** — rewrite the slot-sections sentence (was: "Morning (<10:30), Afternoon (10:30-13:30), Evening (13:30-16:30), Night (>16:30)") to the 5-slot table above.
- **`CLAUDE_MAIL_ORDERS.md` §10** — "1-4 | Jump to slot segment" → "1-5" (descriptive only; handler already scales).
- **`CLAUDE_UI.md` §6** — Mail Orders row "Slots (4)" → "Slots (5)". (Support / Planning / Warehouse stay 4 — they're `slot_master`-driven and unchanged.)
- Consider documenting the 4 `system_config` cutoff keys somewhere central (CORE), since `slot_late_evening_cutoff` is new.

---

## Deferred — Change 2 (dispatch cutoffs) NOT done

Local vs Upcountry dispatch cutoffs were scoped but deferred to a separate session. Latent infrastructure already exists and should anchor that work:

- `delivery_type_master` — Local | Upcountry | IGT | Cross
- `delivery_type_slot_config` — table exists, marked UNUSED
- `orders.dispatchSlotDeadline` — column exists, write status unconfirmed
- `delivery_point_master.deliveryTypeOverride` — per-customer delivery type

Recommend a dedicated discovery session before building. → add to ROADMAP.
