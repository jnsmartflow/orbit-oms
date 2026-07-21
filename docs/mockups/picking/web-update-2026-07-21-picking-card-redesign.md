# Picking Card + Line-item Header Redesign — Locked Design Spec
**Drafted:** 2026-07-21 (claude.ai design session) · **Status:** design locked, not yet built
**For:** future Claude Code discovery + build sessions
**Module:** Picking (`/picking`, `CLAUDE_PICKING.md`)

Mockups (HTML, saved separately from this session):
- `picking-card-final-v2.html` — Assign / Picking / Done card family (the source of truth)
- `lineitem-header-v2.html` — line-item detail screen header

---

## 1. What was redesigned

Two surfaces on the mobile Picking module:
1. **The OBD card** — shared visual language across all three tabs (Assign / Picking / Done), with a few slots swapping per tab.
2. **The line-item detail header** — the header above the pack-rail line rows.

Everything follows `CLAUDE_UI.md`: neutral slate palette, teal reserved for the one primary CTA per screen, amber/semantic for status only.

---

## 2. Card anatomy — one skeleton, tab-specific slots

All cards share the same top zone. Only a few slots change per tab.

### Shared top zone (every tab)
- **Caption line:** `OBD` (mono, muted) · a secondary time · right side = tab-specific marks/badge
- **Name line:** customer name (hero, 18px 600) · right side = tab-specific primary signal
- **Where line:** route colour-dot + area · **volume `· {N} L` inline after the area (rich cards only)** · right side = picker name (when assigned)

### Route dot (no text — colour only)
- Local = blue `#2563eb`
- Upcountry = orange `#ea580c`
(Matches CORE §3 delivery-type dots. The words "Local/Upcountry" are NOT written — dot only.)

### Flags (only the meaningful three)
- ⭐ **Key dealer** (gold) — the star means key dealer; there is NO separate favourite anymore
- ⚡ **Urgent**
- 🎨 **Tint** (the same tint indicator used in Support)
Rendered small, top-right of the caption. No age/other icons on the card face.

### ASSIGN card (rich) — Option G (2026-07-21)
- Lead: **checkbox** (bulk select)
- Caption: `OBD · order date-time` + flags
- Name-right: **slot time** (e.g. `18:00`) — the hero (when it dispatches = the decision)
- Where: route dot + area **· `{N} L` inline after the area** (12.5px/700 `#6b7480`; `L` unit 10.5px `#a2aab4`; separator middot `#d3d8de`; volume `shrink-0`, never clipped — the area truncates first when tight)
- **Shelf** (tonal `#f6f8fa`, no divider line): **FAMILY CHIPS ONLY** — the old goods/breakdown line (`articleTag` + volume) above the chips is REMOVED from the card face (see Deferred note below; volume moved up to the where-line). Chips on ONE horizontally-scrollable line (never wrap — keeps every card the same height; fade cue on the right edge). `+N unlisted` trailing chip when `unresolvedLineCount > 0`. The shelf renders nothing when a card has no chips at all.
- States: default · **selected** (teal ring + filled teal check) · **assigned** (checkbox → picker avatar, picker pill on where-line) · **locked/upcoming** (lock glyph replaces checkbox, card desaturated)

### PICKING card (same rich card, read-only)
Identical to Assign **including the family-chip shelf + inline volume**, minus:
- **No checkbox** (full-width content)
- Caption-right = **elapsed badge** instead of flags: grey `<30m`, amber `30m+`, red `60m+` (e.g. red `1h 12m`)
- Where-right = **picker name**
- **Why the shelf stays here:** so a supervisor seeing a slow pick can read the *actual family names* (e.g. 6 families) and understand why it's taking long — without opening detail.

### DONE card (lean — no shelf)
Check-now and Checked. No goods/families (the checker opens line items anyway).
- **No checkbox**, full width
- Caption: `OBD · slot`
- **Check now:** name-right (or caption-right) = green `Picked 0m` badge; where-right = picker
- **Checked:** caption clean (no time in header); where-right = picker; then a dedicated line `✓ Checked by {name} · 7:12 PM` — checker + time TOGETHER on one line, never split, its own row (long area + long checker must never collide)

---

## 3. Field list per surface (for discovery to source)

| Field | Assign | Picking | Done | Likely source / risk |
|---|---|---|---|---|
| OBD number | ✓ | ✓ | ✓ | queue row (exists) |
| Slot time (10:30/18:00) | ✓ | ✓ | ✓ | window tag (exists) |
| Order date-time | ✓ | ✓ | — | `obdEmailDate` (stores OBD punch date+time) — confirm |
| Customer name | ✓ | ✓ | ✓ | queue row (exists) |
| Route type (dot) | ✓ | ✓ | ✓ | delivery type (exists — pills already use it) |
| Area | ✓ | ✓ | ✓ | queue row (exists) |
| Key dealer / Urgent flags | ✓ | ✓ | — | `isKeyCustomer` / `priorityLevel===1` (exist) |
| Tint flag | ✓ | ✓ | — | **CONFIRM — is there a tint indicator on the order row?** |
| Load (Carton/Tin/Drum) | ✓ | ✓ | — | **RISK — doc says card renders articleTag verbatim, no drum/carton parsing. Need the parsed aggregate.** |
| Volume (litres) | ✓ | ✓ | — | **RISK — total L may not be on the queue row. NOTE landmine: `lineWeight` is a "recognised?" flag, not real weight.** |
| Distinct product families | ✓ | ✓ | — | **RISK — derived from line items (family per SKU), not on queue row today. Likely backend work.** |
| Elapsed time | — | ✓ | — | `pick_assignments` timestamp (exists on Check tab today) |
| Picked time / picker | — | ✓ | ✓ | exists |
| Checked time + checker | — | — | ✓ | `pick_assignments.checkedAt` / `checkedById` (exist) |

**Three fields to prove out first:** total **volume (L)**, **distinct families**, **tint flag**. These are the ones most likely to need API/backend changes.

---

## 4. Line-item detail header

> **SHIPPED 2026-07-21.** Values below are the built ones. Layout source of truth:
> `docs/mockups/picking/lineitem-header-v2.html` (recreated at build time — the
> original claude.ai mockup was never committed).

- **Teal identity bar** (`bg-teal-600`), three rows top to bottom:
  - Row 1 — back · customer name (16px/800 white, truncates) · search.
  - Row 2 — subline `OBD · area · slot` (12px white/75).
  - Row 3 — **flag chips UNDER the subline**: frosted `bg-white/16` pills,
    `rounded-full`, ~11px, each = glyph + **full label** (`⭐ Key dealer`,
    `⚡ Urgent`, `🎨 Tint`). Reuses the card's EXACT glyphs — amber star, amber
    urgent bolt (**not red** — avoids clashing with any red), Support's purple
    `🎨`. Each shown only when its field is true (`isKeyCustomer` /
    `priorityLevel === 1` / `isTint`); the whole row is omitted when none are,
    so no empty gap. All fields come from the tapped `PickingQueueRow` already
    in memory — **no detail-route/data change.**
- **White scope strip:** load (`articleTag` **verbatim**) · volume
  (`volumeLitres`) on the left, softened to the polish palette (`15px/700`
  `#2a323c`; volume `#8a929c`; `L` `10.5px #aab2bb`); `‹ N of M ›` OBD pager on
  the right. **No line count.** (The check-mode `N/M checked` sub-line stays —
  it is tick progress, not a bill line-count.)
- **Pack filter chips** (`All / 20L / …`): dark selected pill `#2a323c`,
  inactive `#6b7480` on white. **Logic unchanged** (restyle only).
- **Line rows unchanged** except the **pack tile recoloured teal → slate
  `#3d4650`** (missing pack stays muted `#9ca3af`) — so the teal `Assign to
  picker` CTA is the only teal element on the screen (one-teal rule). The
  check-mode tick control stays teal (it is a control, not chrome).
- Header is shared across assign / check / picker-done; only the bottom CTA changes.

---

## 5. Design tokens used

> **Final shipped values after the 2026-07-21 Option G refinement** (volume on
> the route line, family-only gray partition, softened name + slot). Do NOT
> revert to the heavier originals from the earlier `picking-cards-final-v2` mock
> or the interim `picking-card-polish2.html` goods-line values — Option G
> superseded them.

- Card: white, `border #eceef2`, radius 20, soft diffused shadow
- Name: `#3b4450` **600**, `18px`, tracking −0.022em (was `#2a323c` 700; before that `#0f151c` 800 / 19px)
- Slot hero: `#4c5661` **600**, `16px`, tabular (was `#3d4650` 700; before that `#242c35` 800 / 17px)
- Caption: `#aab2bb`; OBD mono `#98a0aa`
- Area: `#7e8792` 600 · Picker: `#8a929c` 700
- **Volume (route line, rich cards only):** count `12.5px/700 #6b7480`; `L` unit
  `10.5px/600 #a2aab4`; separator middot `#d3d8de`; count group `shrink-0` so it
  is never clipped (area truncates first)
- Shelf: bg `#f6f8fa`, top border `#eef1f4`, padding `9/15/10/14` — **family
  chips only**, no goods line
- Family chip: `10.5px/700`, padding `3px 8px`, radius 7, text `#6b7480`, bg `#eef1f5`
- `+N unlisted` chip: `11.5px`, dashed `#d8dce1` border, text `#9aa2ac`
- Detail scope strip: load `15px/700 #2a323c`; volume `#8a929c`; `L` `10.5px #aab2bb`
- Detail pack tile: slate `#3d4650` (missing `#9ca3af`); pack-filter selected `#2a323c`
- Badges: elapsed grey `#7c8590/#f3f5f7`, red `#dc2626/#fef2f2`; picked green `#1a8f52/#eefaf1`; checked plain `#9aa2ac`
- Age (if used elsewhere): amber `#b06a0a/#fdf3e3`

### Deferred
- **Full container breakdown (`articleTag`, e.g. `5 Drum, 2 Carton, 3 Tin`) intentionally
  removed from the card face 2026-07-21** — available on the detail screen; revisit adding it
  back as its own line after floor use if the container count proves needed at assign-time. The
  value is still carried on the queue row / payload (nothing was removed from the data), only the
  card-face render was dropped.

---

## 6. Open questions for Smart Flow (carry into build)
- Tint flag: does an order-level tint indicator exist, or must it be derived?
- Family chip overflow cap: show all + scroll (current), or cap at N + `+X`?
- Selected/assigned/locked interaction: tap card body = open detail, tap checkbox = select — confirm.

---

## 7. Next steps (NOT this session)
1. **Discovery (read-only):** trace each field in §3 to its code/DB source; confirm what the Picking queue API already returns vs what's missing; flag volume / families / tint specifically.
2. **Code:** update the Picking API response shape for any missing fields → rebuild the card component per the mockup → verify on Assign + Picking + Done + detail on a real device.
