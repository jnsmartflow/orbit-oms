# code-update-2026-10-07 — Challan Orders slice 4: CHALLAN badge + full ORB number

**Status:** BUILT. `tsc --noEmit` clean · `npm run build` clean — 406 route-table entries (unchanged, no new
route), 84/84 static pages. Display only: no behaviour change, no write, no query predicate change.
Design: web-update-2026-10-06-challan-orders.md §4b M1 (badge), M2 (Floor row), M8 (no "Billed:" on Picking).
Target look: `docs/mockups/challan-orders/badges.html` (v2).

## 1. The atom

`components/shared/challan-badge.tsx` — `ChallanBadge`: pill, "CHALLAN", capitals, CLAUDE_UI §3 "Split" purple
(`bg-purple-50` / `border-purple-200` / `text-purple-700`), the same size and shape as `GiftBadge` / `HandBadge`.
One owner; every surface imports it. The one exception is Floor's By-route ship-to-block table, which draws ALL its
per-bill tags (URGENT / TINT / GIFT / HAND / SAME) as its own square tags by design (2026-10-06) — CHALLAN joins
that run first, in the badge's purple without the border, exactly as HAND does there.

## 2. Surfaces (every one rendered by a live route)

| Surface | File | Live route | Where |
|---|---|---|---|
| Picking — supervisor card (Assign / Picking / Done, all five variants) | `components/picking/picking-board-mobile.tsx` | `/picking` (the card board renders at every width) | caption, first pill after the number |
| Picking — picker "My Picks" card | `components/picking/picker-my-picks-board.tsx` | `/picking` (picker role) | caption, after the number |
| Picking — detail header (both faces) | `components/picking/bill-symbols.tsx` (+ its `hasBillSymbols` gate) | `/picking` detail sheet | first pill in the symbol run |
| Floor — Flat view + every trip stop on the trip desk (one `FloorTable` per stop) | `components/floor/floor-table.tsx` | `/floor` Floor tab | Ship-to cell, BEFORE the dealer name (M2) |
| Floor — By route view (ship-to blocks) | `components/floor/floor-table.tsx` `blockTags` | `/floor` Floor tab → By route → a route card | first square tag after the number |
| Floor — Hold tab (shared `HoldTable`; also Tint Manager Hold, Freight Trips pool) | `components/floor/hold-table.tsx` | `/floor` Hold, `/tint/manager`, `/freight-trips` | Ship-to cell, before the dealer name |
| Floor — Cancel & CI tab | `components/floor/cancelled-tab.tsx` | `/floor` Cancel & CI | Ship-to cell, before the dealer name |
| Floor — detail panel header | `components/floor/detail-panel.tsx` | `/floor` (any tab, and History rows) | first in the tag row |

**Not changed (M8 / out of scope):** no "Billed: SO · OBD · Inv" line anywhere (slice 6/7), no Print challan
(parked). The desktop picking queue row (`picking-queue.tsx`) was RETIRED 2026-07-28 — `/picking` renders the
card board at every width, so the supervisor card above is that surface. Re-delivery rows on the trip desk and the
hold PDF are not touched.

## 3. Feeds — `isChallanOrder` added to the row shape (no select change; every one is an `include` read)

| Row type | Built in | Note |
|---|---|---|
| `PickingQueueRow` (`lib/picking/types.ts`) | `lib/picking/queue.ts` | inherited by `FloorBoardRow` |
| `FloorBoardRow` | `lib/floor/queries.ts` (board builder) | Flat, By route, trip stops |
| `FloorPartyFields` → `FloorHoldRow`, `FloorCancelledRow` (`lib/floor/types.ts`) | `lib/floor/queries.ts` (hold + cancelled builders), `lib/freight-trips/queries.ts` `plainRows` | |
| `FloorDetail` | `lib/floor/order-detail.ts` | read off the payload, not passed down, so History panels show it too |

## 4. Full ORB number (M2)

On an ORB row only, the trip tag leaves the number's line and rides the date line (`ObdDateLine` gained an optional
`trailing` slot in `components/floor/bill-ref-cells.tsx`; absent = byte-identical for every other caller, incl. the
Tint Manager tables). The four width arrays are untouched. Non-ORB rows render exactly as before (same class string).

**Measured case (computed, not seen on a screen):** `ORB-2026-00001` is 14 monospace characters at 11.5px ≈ 97px +
28px cell padding ≈ **125px**. The OBD track is 13% on the Floor tab's own arm (interactive + invoice), 14% / 15% on
the read-only arms, 18% on By route. So the number fits whole when the table is at least **~960px** wide on the
Floor tab (≈ 890px read-only, ≈ 700px By route); narrower than that, the cell's existing ellipsis cuts the last
digits. Widths were NOT changed — eyeball it at the depot screen (eyeball item 3).

## 5. EYEBALL LIST (owner)

Live today: exactly one ORB order, **ORB-2026-00001**, Floor-cancelled 7 Oct.

**Checkable now, on the cancelled order:**
1. `/floor` → **Cancel & CI** tab (it lists TODAY's cancels — on a later day, use item 2): the row reads
   `CHALLAN Mohan Colour CO`, purple pill before the name.
2. `/floor` search box → type `ORB-2026-00001` → Enter. It jumps to the Cancel & CI row (any date). Open it:
   the **detail panel** header shows the CHALLAN pill.
3. While that row is on screen: the **OBD cell shows the whole `ORB-2026-00001`** — no "…" — at the depot screen's
   normal window size.

**Only after the next test order** (cancelled bills are on no live board):
4. `/picking` (supervisor, phone or desk) → Assign tab: the card caption reads `ORB-2026-0000N · <time>` then
   **CHALLAN**; no "Billed:" line. Open it: CHALLAN first in the header's pill run.
5. Assign it to a picker → the picker's **My Picks** card shows CHALLAN after the number.
6. `/floor` → Floor tab, **Flat** view: CHALLAN before the dealer name in Ship to; full ORB number in the OBD cell.
7. **By route** → open the route card: a square purple **CHALLAN** tag first after the number.
8. Put it on a trip: in the trip's stop the trip tag (e.g. `L-02`) sits on the **date line**, not beside the
   number; a normal bill on the same stop still has it beside its OBD.
9. Hold it (⋯ → Hold) → **Hold** tab row shows CHALLAN before the name. Release it again afterwards.
10. Clean up: Floor-cancel the test order as before.
