# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v4 · Teal Brand System · April 2026

---

## 1. Design Philosophy

- **Neutral first.** White backgrounds, gray borders, minimal color. Color is reserved for semantic meaning and brand actions only.
- **Teal is the brand color.** `teal-600` (#0d9488) is the single brand accent. It appears on CTAs, focus rings, active nav, sidebar accent bar, logo button, user avatars, and the login dot. Nowhere else.
- **The old indigo theme (#1a237e) is FULLY DEPRECATED.** Do not use indigo fills, indigo borders, or indigo text anywhere. No exceptions.
- **Three color roles — memorize these:**
  - **Teal** = brand action (CTA buttons, focus rings, toggles ON, nav active, avatars, logo)
  - **Gray** = structure (borders, text hierarchy, slot pills, filter chips, page bg)
  - **Semantic** = status only (green=done, red=urgent/error, amber=waiting — never for decoration)
- **Minimal chrome.** Maximize content area. Header + controls in 2 rows max. No stat cards unless explicitly requested.
- **Text hierarchy drives scannability.** Darkest = primary identifier, medium = data, lightest = context.

---

## 2. Brand Color — Teal System

| Token | Tailwind | Hex | Usage |
|---|---|---|---|
| Brand | `teal-600` | #0d9488 | CTAs, focus borders, active nav icon, sidebar accent bar, logo button, user avatars, login dot, IosToggle ON |
| Brand dark | `teal-700` | #0f766e | Hover state on brand elements |
| Brand tint bg | `teal-50` | #f0fdfa | Active nav item background, input focus ring wash |
| Brand tint border | `teal-200` | #99f6e4 | Active nav item border accent |
| Brand text | `teal-700` | #0f766e | Active nav item text, active tab text |

### Logo mark — Orbit symbol
```svg
White (on teal bg — sidebar, login):
  <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6"/>
  <circle cx="11" cy="11" r="2.2" fill="white"/>
  <circle cx="18" cy="11" r="2" fill="white"/>

Teal (on white bg — if needed inline):
  Same shapes, stroke/fill="#0d9488"
```
Three circles: orbit ring (r=7 stroke), centre dot (r=2.2 fill), orbiting dot (r=2 fill at cx=18).
ViewBox: `0 0 22 22`. Render at 22×22 (sidebar) or 18×18 (mobile).

### Brand usage rules
- ONE primary CTA per screen — always teal-600
- Focus ring on all inputs: `focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10`
- IosToggle ON: `bg-teal-600` (replaces old green-500)
- Operator avatars: `bg-teal-600` (replaces old gray-700)
- Sidebar logo button: `bg-teal-600 hover:bg-teal-700` with orbit SVG inside
- Sidebar accent: `borderLeft: "3px solid #0d9488"` on the aside shell
- Active nav item: `bg-teal-50 text-teal-700 border-l-2 border-teal-600`
- Tooltip bg: `bg-gray-900` (not teal — tooltips are neutral)
- OBD numbers: `text-gray-800 font-mono` (NOT teal — neutral monospace)

---

## 3. Color Palette — Full System

### Core colors (structure — use everywhere)
| Token | Tailwind | Usage |
|---|---|---|
| Page background | `bg-white` | Body, page wrapper, sidebar bg |
| App background | `bg-[#f9fafb]` | Login page, full-page board backgrounds |
| Surface | `bg-gray-50` | Info grids, column backgrounds, input backgrounds |
| Border default | `border-gray-200` | Cards, dividers, inputs, table rows, sidebar border |
| Border hover | `border-gray-300` | Card hover |
| Border active (structure) | `border-gray-900` | Active filter pill, active slot pill |
| Text primary | `text-gray-900` | Customer names, headings, active states |
| Text secondary | `text-gray-600` | SMU, articles, volume, operator names, data values |
| Text muted | `text-gray-400` | Timestamps, slots, dates, labels, placeholders |
| Text hint | `text-gray-300` | Placeholder text, disabled states, footer text |

### Semantic colors (status meaning — never for decoration)
| Purpose | Background | Border | Text |
|---|---|---|---|
| Urgent priority | `bg-red-50` | `border-red-200` | `text-red-600` |
| Normal priority | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Done / Dispatch | `bg-green-50` | `border-green-200` | `text-green-700` |
| Hold | `bg-red-50` | `border-red-200` | `text-red-700` |
| Waiting | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Customer Missing | — | — | `text-amber-500` (icon only) |
| Split indicator | — | — | `text-amber-600` (text only) |
| Split badge | `bg-purple-50` | `border-purple-200` | `text-purple-700` |
| SMU badge (table) | plain text | — | `text-gray-600 font-medium` |
| Active status | `bg-green-50` | `border-green-200` | `text-green-700` |
| Inactive status | `bg-gray-50` | `border-gray-200` | `text-gray-500` |
| Pending (generic) | `bg-gray-100` | `border-gray-200` | `text-gray-600` |
| Pending Support | `bg-amber-50` | `border-amber-200` | `text-amber-700` |
| Error text | — | — | `text-red-600 text-[11px]` |
| Error input border | `border-red-300` | — | — |
| Error input ring | `ring-2 ring-red-500/6` | — | — |

### Delivery type dot colors
| Type | Tailwind | Hex |
|---|---|---|
| Local | `bg-blue-600` | #2563eb |
| Upcountry (UPC) | `bg-orange-600` | #ea580c |
| IGT | `bg-teal-600` | #0d9488 |
| Cross Depot | `bg-rose-600` | #e11d48 |
| Unknown/null | no dot shown | — |

Dot size: 5px (`w-[5px] h-[5px] rounded-full`). Placed before OBD number in both card and table views.

Note: IGT dot is teal-600 — same as brand. This is intentional and reinforces brand consistency.

### Tinter type dot colors (TI Report)
| Type | Tailwind |
|---|---|
| TINTER | `bg-blue-600` |
| ACOTONE | `bg-orange-500` |

Same 5px dot pattern. Placed before OBD number in TI Report table.

### Operator avatar colors
| Stage | Color |
|---|---|
| Assigned | `bg-teal-600` |
| In Progress | `bg-teal-600` |
| Completed | `bg-green-600` |

Note: Assigned and In Progress avatars changed from gray-700 → teal-600 in v4.
Completed stays green-600 — green = done is a semantic meaning, not brand.

### Column header dots (kanban)
| Column | Color |
|---|---|
| Pending | `bg-amber-500` (or stage-specific) |
| Assigned | `bg-blue-500` |
| In Progress | `bg-purple-500` |
| Completed | `bg-green-500` |

These are the ONLY non-semantic non-brand colors allowed. 6px dots in column headers for visual identification only.

---

## 4. Typography

| Element | Classes |
|---|---|
| Page title | `text-[14px] font-semibold text-gray-900` |
| Inline stats (header) | `text-[11px] text-gray-400` with `text-gray-900 font-semibold` for numbers |
| Card customer name | `text-[13.5px] font-bold text-gray-900` |
| Card info grid label | `text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400` |
| Card info grid value | `text-[12px] font-semibold text-gray-600` |
| OBD code (card) | monospace, `text-[10.5px] text-gray-800` |
| OBD code (table) | `font-mono text-[11px] text-gray-800` |
| Table header | `text-[10px] font-medium text-gray-400 uppercase tracking-wider` |
| Table data (primary) | `text-[11px] text-gray-900 font-medium` (customer name) |
| Table data (secondary) | `text-[11px] text-gray-600` (SMU, articles, volume, operator) |
| Table data (muted) | `text-[11px] text-gray-400` (slot, time, date) |
| Badge text | `text-[10.5px] font-semibold` |
| Button text (table) | `text-[11px] font-medium` |
| Button text (card/primary) | `text-[13px] font-medium` |
| Section header | `text-[13px] font-semibold text-gray-900` |
| Section volume | `text-[13px] font-semibold text-gray-700` (right-aligned) |
| Timestamp / clock | `text-[11px] text-gray-400` |
| Form label | `text-[11px] font-medium text-gray-500` |
| Form input value | `text-[13px] text-gray-900` |
| Footer / internal tag | `text-[11px] text-gray-300` |

### Text color hierarchy (table view)
| Priority | Color | Examples |
|---|---|---|
| Darkest | `text-gray-900 font-medium` | Customer name |
| Dark | `text-gray-800 font-mono` | OBD number |
| Medium | `text-gray-600` | SMU, Articles, Volume, Operator name |
| Light | `text-gray-400` | Slot, Time, Date, Priority "Normal" |
| Brand | `text-teal-700` | Active nav item text, active tab |
| Semantic | red/amber/green/purple | Urgent, Missing, Done, Split |

---

## 5. Borders & Spacing

| Element | Classes |
|---|---|
| Card border | `border border-gray-200 rounded-lg` |
| Card hover | `hover:border-gray-300` |
| Card padding | `p-[10px_12px]` or `px-3.5 pt-3 pb-3` |
| Column container | `bg-gray-50 border border-gray-200 rounded-lg` |
| Column header | `bg-white border-b border-gray-200 px-[14px] py-[10px]` |
| Info grid | `bg-gray-50 border border-gray-200 rounded-md p-[7px_10px]` |
| Modal border | `border border-gray-200 rounded-lg` |
| Table row | `border-b border-gray-50 hover:bg-gray-50/50` |
| Table header row | `border-b border-gray-100` |
| Table wrapper | `rounded-lg border border-gray-200 overflow-hidden` with `px-4 py-3` outer spacing |
| Section divider | `border-b border-gray-200` |
| Dropdown panel | `border border-gray-200 rounded-lg shadow-lg` |
| Login card | `border border-gray-200 rounded-2xl` |
| Sidebar shell | `bg-white` + `borderLeft: "3px solid #0d9488"` + `borderRight: "1px solid #e5e7eb"` |

### NO accent bars on cards
Cards do NOT have colored top accent bars. No `h-[3px]` gradient divs.

### NO zebra striping
Table rows are white (`bg-white`). No alternating row colors. Hover only: `hover:bg-gray-50/50`.

---

## 6. Page Layout — 2 Row Header

All board screens follow this layout:

```
Row 1 (42px, sticky top-0):
  Left:  Title · Count stats
  Right: Clock OR Download button OR Search (screen-specific)

Row 2 (36–40px, sticky top-[42px]):
  Left:  Primary filter (slot pills OR date range picker OR search)
  Right: [Filter ▾] dropdown

Content starts immediately after Row 2.
```

No stat cards. No separate filter bar row. No collapsible workload bar row.

### Row 1 height: 42px
### Row 2 height: 36px (slot pills) or 40px (filter controls)

### Slot pills (Row 2)
```
Style: px-2.5 py-0.5 border rounded-md text-xs h-7
Active: border-gray-900 text-gray-900 font-medium   ← gray-900, NOT teal
Inactive: border-gray-200 text-gray-500 hover:border-gray-300
Closed: bg-gray-50 border-gray-100 text-gray-400
Done (0 pending): checkmark icon + slot name
```

Note: Slot pills use gray-900 active state — NOT teal. Slot selection is a
structural/navigation control, not a brand CTA.

### Filter dropdown
- Button: `border border-gray-200 rounded-md text-[11px] font-medium h-7`
- Active: `border-gray-900 text-gray-900` with count badge (`bg-gray-900 text-white rounded-full w-4 h-4`)
- Panel: `bg-white border-gray-200 rounded-lg shadow-lg z-50 p-3`
- Groups: labeled sections with `text-[10px] font-bold uppercase tracking-wider text-gray-400`
- Active chip: `bg-gray-900 text-white border-gray-900`
- Inactive chip: `bg-white text-gray-500 border-gray-200 hover:border-gray-300`
- Clear all: `text-[11px] text-gray-400 hover:text-gray-600 border-t border-gray-100 pt-1`
- Close on outside click via `useRef` + `mousedown` listener

---

## 7. Sidebar — White + Teal Accent (v4)

### Shell
```
bg-white
borderLeft: "3px solid #0d9488"   ← teal accent bar
borderRight: "1px solid #e5e7eb"
shadow-sm
```

### Logo button (collapsed toggle)
```
bg-teal-600 hover:bg-teal-700 text-white rounded-xl
```

### Brand text (expanded)
```
Product name:  text-[14px] font-bold text-gray-900
Subtitle:      text-[10px] text-gray-400
```

### Nav items
```
Active:   bg-teal-50 text-teal-700 font-semibold border-l-2 border-teal-600
Inactive: text-gray-500 hover:bg-gray-50 hover:text-gray-900
```

### Collapsed active icon
```
bg-teal-50 text-teal-600
```

### Collapsed inactive icon
```
text-gray-400 hover:bg-gray-50 hover:text-gray-700
```

### Section header labels (expanded)
```
text-[9px] font-bold uppercase tracking-widest text-gray-400
```

### Section divider (collapsed)
```
border-t border-gray-200
```

### Tooltip
```
bg-gray-900 text-white text-[11px] px-2.5 py-1 rounded-md
```

### User block
```
Border top: border-t border-gray-200
Avatar:     bg-teal-600 hover:bg-teal-700 text-white rounded-full
Name:       text-[12px] font-semibold text-gray-800
Role:       text-[10px] text-gray-400
Sign out:   text-[10px] text-red-500 hover:text-red-700
```

### Role nav tabs (horizontal)
```
Container:    bg-white border-b border-gray-200
Active tab:   text-teal-600 border-b-2 border-teal-600
Inactive tab: text-gray-500 hover:text-gray-900
```

---

## 8. Card Components

### Card structure (top to bottom)
```
1. Icon row — h-[24px], justify-between
   Left: split indicator (if applicable): "✂ 1 · 6 left" in text-amber-600
   Right: action icons [Eye] [+] [⋯]

2. Badge row — flex-wrap gap-1.5 mb-[6px]
   Priority badge (Normal=gray / Urgent=red)
   + any semantic badges (Split #N, Done, Dispatch)

3. Customer name — text-[13.5px] font-bold text-gray-900
   + inline ⚠ icon (AlertCircle 14px, text-amber-500) if customerMissing

4. OBD row — text-[11px] text-gray-400
   [delivery type dot 5px] OBD · Area · Date

5. Info grid — 2×2, bg-gray-50 border-gray-200

6. Operator row (if assigned) — avatar bg-teal-600, name text-gray-600
```

### NO accent bars
Cards do NOT have colored top accent bars.

---

## 9. Form Inputs — Full Spec

```
Default:
  height:        h-[38px]
  padding:       px-3
  font-size:     text-[13px]
  text:          text-gray-900
  bg:            bg-white
  border:        border border-gray-200 rounded-lg
  placeholder:   placeholder:text-gray-300

Focus:
  border:        focus:border-teal-500
  ring:          focus:ring-2 focus:ring-teal-500/10
  outline:       outline-none

Error:
  border:        border-red-300
  ring:          ring-2 ring-red-500/6

Disabled:
  opacity:       disabled:opacity-50

Label:
  text-[11px] font-medium text-gray-500 mb-1.5 tracking-[0.1px]

Password toggle:
  text-[11px] font-medium text-gray-400 hover:text-teal-600 transition-colors
```

---

## 10. Buttons — Full Spec

### Primary CTA
```
bg-teal-600 hover:bg-teal-700 active:scale-[0.99]
text-white text-[13px] font-medium
h-[38px] rounded-lg w-full (forms) or px-4 (inline)
disabled:opacity-55 disabled:cursor-not-allowed
transition-all
```

### Secondary / Ghost
```
bg-white border border-gray-200 hover:bg-gray-50
text-gray-600 text-[11px] font-medium
h-7 rounded-md px-3
```

### Destructive
```
bg-red-600 hover:bg-red-700 text-white
(use only for delete/remove actions)
```

### Disabled save (modal footer)
```
bg-gray-100 text-gray-400 cursor-not-allowed
```

### Enabled save (modal footer)
```
bg-gray-900 hover:bg-gray-800 text-white
```

Note: Modal save/confirm buttons use gray-900, not teal.
Teal is reserved for the primary board-level CTA only.

---

## 11. iPhone-style Toggle (IosToggle)

```tsx
function IosToggle({ checked, onChange, disabled }: {
  checked:  boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[20px] w-[36px] flex-shrink-0 cursor-pointer
        rounded-full border-2 border-transparent transition-colors duration-200
        focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed
        ${checked ? "bg-teal-600" : "bg-gray-300"}`}
    >
      <span className={`pointer-events-none inline-block h-[16px] w-[16px] transform
        rounded-full bg-white shadow-md transition-transform duration-200
        ${checked ? "translate-x-[16px]" : "translate-x-0"}`}
      />
    </button>
  );
}
```

- On: `bg-teal-600` (changed from green-500 in v4)
- Off: `bg-gray-300`, thumb at left
- Size: 36×20px compact. Use 46×26px for larger contexts.

---

## 12. Login Page — Full Spec (v4)

```
Page bg:       bg-[#f9fafb]
Max width:     max-w-[340px] centered

Branding:
  Logo mark:   Orbit symbol in 36×36 teal rounded-[9px] container
               SVG (white version): circle r=7 stroke, circle r=2.2 fill centre,
               circle r=2 fill at cx=18 cy=11 (orbiting dot)
  Wordmark:    text-[22px] font-semibold text-gray-900 tracking-[-0.5px]
               Inline with logo mark, gap-2.5
  Tagline:     text-[12.5px] text-gray-400 mt-1
               Current: "One system. Zero chaos."
               Future (when pitching externally): "Every order in orbit."
  No heading:  Card starts directly with form inputs (no "Sign in" heading)

Card:
  bg-white border border-gray-200 rounded-xl p-6 shadow-sm

Input autofill override:
  style={{ WebkitBoxShadow: "0 0 0 1000px white inset" }}
  Applied to both email and password inputs to prevent browser blue tint.

Button:        bg-teal-600 hover:bg-teal-700 (primary CTA spec above)

Footer:        text-[11px] text-gray-400 text-center mt-6
               "OrbitOMS · Internal Use Only"
```

---

## 13. Modal Pattern

```
Container: fixed inset-0 z-50, centered
Backdrop: bg-black/40, click to close
Panel: bg-white border border-gray-200 rounded-lg shadow-xl w-[400px]
Header: px-5 pt-5 pb-4 border-b border-gray-200
Footer: px-5 pb-5 pt-3 border-t border-gray-200 flex justify-end gap-2
Cancel button: border border-gray-200 text-gray-600 hover:bg-gray-50
Confirm button: bg-gray-900 text-white hover:bg-gray-800
```

---

## 14. Date Range Picker

Standalone dropdown component for date range selection. Used in TI Report.

### Trigger button
```
h-7 px-3 border border-gray-200 rounded-md text-[11px] font-medium
Shows: "02 Apr" (single day) or "25 Mar – 02 Apr" (range)
Active: border-teal-500 text-teal-700   ← teal in v4, was gray-900
```

### Dropdown panel (240px wide)
```
Section 1 — Presets:
  Active preset: bg-teal-600 text-white rounded-md   ← teal in v4
  Inactive: text-gray-600 hover:bg-gray-50

Section 2 — Calendar:
  Selected (from/to): bg-teal-600 text-white font-semibold   ← teal in v4
  In range: bg-teal-50 text-teal-700
  Today: font-semibold text-gray-900
  Future: text-gray-200 cursor-not-allowed
  Normal: text-gray-700 hover:bg-gray-50
```

### Download button
```
bg-teal-600 hover:bg-teal-700 text-white   ← teal in v4
Range text: text-white/70 text-[10px]
```

---

## 15. Interaction Patterns

| Interaction | Behaviour |
|---|---|
| Eye icon click | Opens OrderDetailPanel |
| Assign button | Opens operator picker modal |
| Create Split button | Opens Split Builder modal |
| + button | Opens status popover (fixed position) |
| ⋯ button | Opens dropdown menu |
| Slot pill click | Filters board by slotId. Click again deselects. |
| Filter dropdown | Opens panel with filter groups |
| Workload dropdown | Opens panel with operator chips |
| Customer ⚠ icon click | Opens CustomerMissingSheet |
| Delivery type dot | Tooltip on hover (title attribute) |
| Table row click (TI Report) | Toggles inline shade expand row |
| Date range button click | Opens DateRangePicker dropdown |

---

## 16. Screen-Specific Notes

### Login (REDESIGNED v4, updated v41)
- Orbit logo mark in teal container + wordmark. See §12 for full spec.
- No "Sign in" heading — form card starts directly with inputs.
- WebkitBoxShadow autofill override on inputs.
- Tagline: "One system. Zero chaos." (internal phase)
- Future tagline: "Every order in orbit." (when pitching externally)

### Sidebar (REDESIGNED v4, updated v41)
- White bg + 3px teal left accent bar. See §7 for full spec.
- Logo button: teal-600 with orbit SVG mark. Active nav: teal-50/teal-700. Avatars: teal-600.

### Tint Manager (REDESIGNED v39, palette swept v41)
- Full neutral theme applied
- 2-row header layout
- OrderDetailPanel instead of SkuDetailsSheet
- Delivery type dots on all cards and table rows
- Operator avatars: bg-teal-600 (done in v41 sweep)
- Pending Support badge: bg-amber-50 text-amber-700 (fixed v41)

### Shade Master (REDESIGNED v40, palette swept v41)
- Full neutral theme applied
- IosToggle ON: bg-teal-600 (done in v41 sweep)

### TI Report (REDESIGNED v40, palette swept v41)
- DateRangePicker selected/preset: bg-teal-600 (done in v41 sweep)
- Download button: bg-teal-600 (done in v41 sweep)

### Support Board (palette swept v41)
- CTA buttons, focus rings, avatars all updated to teal

### Planning Board (palette swept v41)
- Avatars, indigo remnants all updated

### Warehouse Board (palette swept v41)
- Avatars, picker lane colours updated

### Tint Operator (partially swept v41)
- IosToggle ON: bg-teal-600
- SKU table, TI coverage merged in earlier session

---

## 17. Palette Sweep — COMPLETED v41

All changes below have been implemented across ~45 files. Zero deprecated patterns remain.
Verified via grep across full codebase.

| Component | Before | After | Status |
|---|---|---|---|
| IosToggle ON state | `bg-green-500` | `bg-teal-600` | ✓ Done |
| Operator avatars (all boards) | `bg-gray-700` | `bg-teal-600` | ✓ Done |
| Primary CTA buttons (all boards) | various indigo/gray | `bg-teal-600 hover:bg-teal-700` | ✓ Done |
| DateRangePicker selected day | `bg-gray-900` | `bg-teal-600` | ✓ Done |
| DateRangePicker active preset | `bg-gray-900` | `bg-teal-600` | ✓ Done |
| DateRangePicker in-range | `bg-gray-100` | `bg-teal-50 text-teal-700` | ✓ Done |
| Download button | `bg-gray-900` | `bg-teal-600` | ✓ Done |
| All `#1a237e` family | indigo hex | teal or gray equivalent | ✓ Done |
| All `slate-*` classes | slate variants | gray equivalents | ✓ Done |
| OBD code colour | `text-[#1a237e]` → `text-teal-700` (wrong) | `text-gray-800 font-mono` | ✓ Fixed |
| Pending Support badge | `bg-[#eff6ff] text-[#1e40af]` | `bg-amber-50 text-amber-700` | ✓ Fixed |
| Pending status badge | `bg-teal-50 text-teal-700` | `bg-gray-100 text-gray-600` | ✓ Fixed |
| Logo mark | "O" letter | Orbit SVG symbol | ✓ Done |
| Login heading | "Sign in to your account" | Removed (form starts directly) | ✓ Done |
| Input autofill | Browser blue tint | WebkitBoxShadow white override | ✓ Done |

---

## 18. DEPRECATED — Do Not Use

| Deprecated | Replacement |
|---|---|
| `bg-[#1a237e]` | `bg-teal-600` (brand) or `bg-gray-900` (structure) |
| `bg-[#283593]` | `bg-teal-700` (brand hover) |
| `bg-[#e8eaf6]` | `bg-teal-50` (active nav bg) |
| `border-[#e2e5f1]` | `border-gray-200` |
| `bg-[#f7f8fc]` | `bg-gray-50` |
| `bg-[#f0f2f8]` | `bg-white` or `bg-[#f9fafb]` |
| `text-[#1a237e]` | `text-teal-700` (active) or `text-gray-900` (heading) |
| `text-[#3C3489]` | `text-gray-700` |
| `border-[#AFA9EC]` | `border-gray-300` |
| `bg-[#EEEDFE]` | `bg-teal-50` (active nav) or `bg-gray-50` (neutral) |
| Card accent bars (`h-[3px]` gradients) | Removed — no accent bars |
| `bg-green-500` (IosToggle) | `bg-teal-600` |
| `bg-gray-700` (operator avatars) | `bg-teal-600` |
| shadcn `Switch` | Custom `IosToggle` with `bg-teal-600` |
| Zebra striping | White rows, hover only |
| `hover:bg-[#eef0fb]` | `hover:bg-gray-50/50` |
| shadcn `Badge` variant default/secondary | Custom inline `span` |
| `text-slate-*` | `text-gray-*` equivalent |
| `border-slate-*` | `border-gray-*` equivalent |
| `bg-slate-*` | `bg-gray-*` equivalent |
| Dark sidebar (`bg-gray-900` on sidebar) | `bg-white` + teal accent bar |
| Full teal sidebar | `bg-white` + teal accent bar |

---

*Version: v4.1 · Teal Brand System · Context v41 · April 2026*
*Login redesigned · Sidebar redesigned · Full palette sweep DONE · Orbit logo mark*
