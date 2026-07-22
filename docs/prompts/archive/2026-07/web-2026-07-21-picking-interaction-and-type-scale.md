# Picking — Interaction Redesign + Mobile Card Type Scale
**Date:** 2026-07-21 · **Drafted in:** claude.ai · **Built via:** Claude Code
**Status:** SHIPPED to `main`, live on production (`orbitoms.in/picking`)
**Consolidate into:** `CLAUDE_UI.md` (the TYPE SCALE below is the priority — it kills future discovery) + `CLAUDE_PICKING.md` (interaction behaviour).

Companion earlier doc same day: `docs/mockups/picking/web-update-2026-07-21-picking-card-redesign.md` (card structure / Option G). This doc adds the interaction model + the type scale.

---

## 1. What shipped (this batch)

Three Claude Code commits refined the Assign board interaction and the card type:

- `9546428c` — tap-to-select + "View items" link opens detail + first sharper-type pass.
- (final) — **remove checkbox → full-width name**, **"View items" text → soft round arrow (arrow-only)**, **/po-matched lighter type** across all card variants.

Result: a checkbox-free Assign card where **tapping anywhere selects**, a small **arrow opens the line-item detail**, the **name uses full width**, and **all text is lightened to match /po's refined feel.**

---

## 2. The interaction model (Assign tab) — RECORD IN CLAUDE_PICKING.md

**One rule, no modes:**
- **Tap anywhere on an unlocked Assign card = toggle select.** The whole card is the target (no precise checkbox aiming — that was the floor pain point). Selecting works for 1 or many identically.
- **Selected visual:** card teal tint (`bg-teal-50` / `border-teal-600`) + a small teal check badge, top-left corner, only when selected. Unselected = clean, no box, no placeholder.
- **Soft round arrow (right of the family chips) = open line-item detail.** Arrow-only, no words (the depot team is told once; words are then noise). `~30px` circle, `bg #eceff3`, chevron `#8b93a0`, `stopPropagation` then opens detail. Pinned; families scroll to its left; **always rendered on Assign cards even with zero families** so detail is always reachable.
- **Bottom floating bar** appears when ≥1 selected: `N bills · N L selected · Clear · Assign →`. Assign opens the picker sheet and assigns the whole batch.

**Variant gating (one shared `PickingCard`):**
- Only `variant === "assign"` (unlocked) gets tap-to-select + the arrow.
- `assignLocked` cards: NOT selectable, keep the lock affordance, tap = open detail.
- `picking`, `doneCheck`, `doneChecked`: **tap = open detail** (unchanged). No arrow, no select.

**Why not the alternatives (don't re-litigate):** no long-press (unintuitive for the non-technical Android supervisor); no swipe-to-open (Android users read swipe as delete/archive, and hidden gestures get forgotten — a visible arrow is self-explanatory). Checkbox removed because precise tapping was slow when assigning many.

**Untouched by this work:** selection `Set` + toggle, the `selectedRows`/`filteredWaitingDue` chokepoint (locked/upcoming bills can't enter the assign payload), floating bar, Clear, picker sheet, `handleAssign`, and the detail overlay path (`openDetail`/`switchDetailTo`/`pushScreen`/popstate).

---

## 3. MOBILE CARD TYPE SCALE — RECORD IN CLAUDE_UI.md (stops future discovery)

**App font (shared everywhere):** `Plus Jakarta Sans` via `--font-sans` (next/font/google, `app/layout.tsx`). Mono = `JetBrains Mono` via `--font-mono` (used for OBD numbers only). **The picking card and /po already share this font — there is no family difference. Weight is the lever for "heavy vs refined," not the typeface.**

**The /po refinement principle:** ONE line carries weight (the hero), everything else stays light (400–500). Making every line heavy (700 name + 600 area + 700 volume + 700 chips) is what made the old picking card read dense. Keep the hero modest and the rest light.

**Mobile card type tokens (as shipped — the picking card, matched to /po):**

| Element | Size | Weight | Colour | Notes |
|---|---|---|---|---|
| Customer name (hero) | 16px | 600 | `#1d2939` | letter-spacing ~0 (NOT negative), line-height 1.25, `truncate` |
| Slot / time | 15px | 600 | `#475467` | **keep `tabular-nums`** |
| Area | 12px | 500 | `#667085` | |
| Volume count | 12px | 600 | `#667085` | `tabular-nums` |
| Volume "L" unit | 10.5px | 500 | `#98a2b3` | |
| Caption date | 11.5px | 400 | `#98a2b3` | middot `#d8dce1` |
| Caption OBD | 11.5px | 400 | `#98a0aa` | **mono** (`--font-mono`) |
| Family chips | 10.5px | 600 | `#667085` on `#eef1f5` | |
| Route dot | 8px | — | Local `#2563eb` / Upcountry `#ea580c` / Cross `#e11d48` / else grey | colour only, no text |

**/po reference values (for anyone matching a new mobile card to /po):**
- /po drafts/list hero name: 15px / 500 / `#1d2939`; secondary `code · area`: 12px / 400 / `#9ca3af`; meta chips: 11px / 500; date: 11px / 400 / `#9ca3af`.
- /po selected-customer header (the one heavier case): 16px / 700 / `#111827`, but its secondary still stays 12px / 400.

**Hard rules (carry these so discovery isn't needed again):**
- **Never CSS-uppercase customer names.** Uppercase names (e.g. "AMBIKA ENTERPRISE") come from SAP source data, NOT `text-transform`. Forcing uppercase breaks the app's `smartTitleCase` convention.
- **Keep `tabular-nums`** on slot + volume (numbers align across stacked cards).
- **Weight, not colour, is the "heavy" dial.** Name hex is already ~matched (`#1d2939` ≈ `#1e2733`); if a card reads heavy, drop weights (700→600/500) and remove negative tracking before touching colour.
- Chips/volume/area cap at 600; only the hero name is 600, nothing on the card is 700.

---

## 4. MOBILE VIEWPORT — RECORD IN CLAUDE_UI.md

- Design + phone-verify target: **390px wide** (iPhone reference used all session). Must also stay **320px-safe** (smallest supported) — the name `truncate min-w-0` handles overflow; the slot and arrow are `shrink-0` and never clip.
- Tap targets: **min 44–48px** for the arrow / interactive controls.
- One-teal rule holds on the card: the only teal is the selected tint/check; arrow + chips are slate.

---

## 5. Follow-ups / housekeeping

- **Save session mockups into the repo** — Claude Code flagged 3×  that these aren't committed. Drop into `docs/mockups/picking/`: `picking-arrow-nocheckbox.html`, `picking-tap-select.html`, `picking-viewitems-selection.html`, plus the card ones (`picking-card-simplified.html`, `picking-card-g-breakdown.html`). The repo has the specs but no pictures.
- **Container breakdown** (`5 Drum, 2 Carton, 3 Tin`) remains intentionally OFF the card face (on the detail screen) — revisit after floor use only if needed. (From the Option G doc.)
- **Catalog cleanup with Chandresh** — family chips fill in as codes are added; `displayCategory`/`displayName` columns already scaffolded for friendly names (pure data entry, no code).
- At the next consolidation cycle, fold §2 into `CLAUDE_PICKING.md` and §3+§4 into `CLAUDE_UI.md`, then archive this draft.
