# CLAUDE_UI.md — Orbit OMS UI Design System
# Load alongside CLAUDE_CONTEXT.md for all UI implementation sessions.
# This is the SINGLE SOURCE OF TRUTH for visual styling across all screens.
# Version: v4.2 · Teal Brand System · April 2026

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
- **Smart Title Case for display.** All user-facing text from DB (customer names, SO names, remarks) rendered with smartTitleCase(). DB data stays as-is (usually ALL CAPS). See §19 for rules.

---

## 2-18. [Unchanged from v4]

(All sections 2 through 18 remain unchanged — refer to v4 for full content)

---

## 19. Smart Title Case (NEW v4.2)

All text from the database is stored as ALL CAPS (SAP convention). For display, apply `smartTitleCase()` from `lib/mail-orders/utils.ts`.

### Function location
`lib/mail-orders/utils.ts` — exported, reusable across pages.

### Rules

**Keep UPPERCASE always:**
CO, CO., LLP, PVT, LTD, PVT., LTD., II, III, IV, HW, H/W, JSW, SAP, OBD, IGT, UPC

**Keep lowercase (except first word):**
and, of, the, for, in, at, to, by, an, or, on, with

**Preserve special characters:**
Words with `/` or `&` that are ≤5 chars stay uppercase (e.g. "H/W", "HARD.&")

**Title case everything else:**
First letter uppercase, rest lowercase.

### Apply to
| Field | Apply? |
|---|---|
| Customer name | ✓ Yes |
| SO name | ✓ Yes (also strip "(JSW)" prefix first) |
| Remarks | ✓ Yes |
| Area (subtext) | ✓ Yes |
| Route (subtext) | ✓ Yes |
| Candidate/search result names | ✓ Yes |
| Customer codes | ✗ No (numeric) |
| Subject codes | ✗ No (numeric) |
| Badges (Dispatch/Hold/etc) | ✗ No (fixed labels) |
| Column headers | ✗ No (already styled) |

### SO Name cleanup
Strip "(JSW)" prefix before title casing:
```
soName?.replace(/^\(JSW\)\s*/i, '').trim()
```

---

## 20. Lock Column (NEW v4.2)

Replaces the former "OD/CI" / "Flag" column. Uses lucide-react icons.

### Two states

**Unlocked (default):**
```
Icon: LockOpen from lucide-react, size 14px
Style: text-gray-300 hover:text-gray-400 cursor-pointer
```

**Locked (active):**
```
Icon: Lock from lucide-react, size 14px
Style: text-red-500 bg-red-50 rounded p-1
```

Click toggles between states. Currently local state only (not persisted to DB).

### Inline badge (in Customer column when locked)
```
Icon: Lock from lucide-react, size 12px, text-red-500
```

---

## 21. Mail Order Code Column (NEW v4.2)

The Code column on /mail-orders has three visual states:

### Exact match (copyable badge)
```
font-mono text-[11px] text-gray-800 bg-gray-50
border border-gray-200 rounded px-1.5 py-0.5
cursor-pointer hover:bg-gray-100 hover:border-gray-300
transition-colors
```
Click → copies to clipboard.
Flash feedback: bg-teal-50 border-teal-200 for 1.5s, then revert.
Pencil icon (14px text-gray-400) on hover → opens search popover for re-pick.

### Multiple matches (picker badge)
```
text-[10px] font-medium text-amber-700 bg-amber-50
border border-amber-200 rounded px-1.5 py-0.5
cursor-pointer hover:bg-amber-100
```
Text: "N found". Click → candidate picker popover.

### Unmatched (search trigger)
```
text-[10px] text-gray-400 cursor-pointer hover:text-gray-600
```
Text: "Search". Click → search popover.

### Popovers
```
Container: bg-white border border-gray-200 rounded-lg shadow-lg z-50
Candidate picker: w-[280px] max-h-[240px] overflow-y-auto p-2
Search popover: w-[320px] p-3
  Input: text-[12px] h-[32px] border-gray-200 rounded-md focus:border-teal-500
  Results: max-h-[180px] overflow-y-auto mt-2
Candidate row: code (font-mono) | name (truncated) | area+route (muted)
  hover:bg-gray-50, full row clickable
Close on outside click (useRef + mousedown)
Only one popover open at a time across all rows.
```

---

## 22. Delivery Type Dot — Normalization Rule (NEW v4.2)

Always normalize deliveryType with `.toUpperCase()` before matching dot color. The DB stores mixed case ("LOCAL", "Local", "UPC", "Upc").

```typescript
function getDeliveryDotColor(deliveryType: string | null | undefined) {
  if (!deliveryType) return null
  switch (deliveryType.toUpperCase()) {
    case 'LOCAL': return { color: 'bg-blue-600', title: 'Local' }
    case 'UPC': return { color: 'bg-orange-600', title: 'Upcountry' }
    case 'IGT': return { color: 'bg-teal-600', title: 'IGT' }
    case 'CROSS':
    case 'CROSS DEPOT': return { color: 'bg-rose-600', title: 'Cross Depot' }
    default: return null
  }
}
```

Dot size: `w-[5px] h-[5px] rounded-full flex-shrink-0`. Placed inline before customer name.

This applies to all boards (TM, Support, Planning, Warehouse, Mail Orders).

---

## 23. Mail Order Customer Subtext (NEW v4.2)

Below the customer name in the /mail-orders table, show a subtext line:

```
Line 1: [dot] Customer Name (bold, smart title case)
Line 2: {subjectCode} · {Area} · {Route}
```

**Order:** Subject code first, then area, then route.

**Formatting:**
- Subject code: `font-mono text-[10px] text-gray-400`
- Area + Route: `text-[10px] text-gray-400` (smart title case)
- Separator "·": `text-gray-300`

**Show only what's available:**
- All three: `109725 · Katargam · Varachha`
- Code + area: `109725 · Katargam`
- Area + route (no code): `Katargam · Varachha`
- Only area: `Katargam`
- Only code: `109725`
- Nothing: no subtext line

---

*Version: v4.2 · Teal Brand System · Context v45 · April 2026*
*Smart Title Case · Lock icons · Code column · Delivery dot normalization*
