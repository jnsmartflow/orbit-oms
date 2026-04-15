# context-update-v70.md

## NEW/MODIFIED FILES

- `app/api/tint/operator/my-orders/route.ts` — Added billToCustomerId, billToCustomerName, areaName, routeName, deliveryTypeName per order/split. Added totalAssignedToday, totalDoneToday top-level counts. Extended existing rawSummaries + customer includes, no new DB queries.
- `components/tint/tint-operator-content.tsx` — Full redesign. Outlook-style 2-panel split (320px SKU lines left, TI form right). Job queue as dropdown from teal segment pill in UniversalHeader Row 2. Bill To / Ship To full-width cards. Pigment-coloured shade grid. Separated Save TI from Start workflow.
- `TINT_OPERATOR_REDESIGN_v4.html` — Initial locked design mockup (project root, reference only)
- `TINT_OPERATOR_REDESIGN_v7.html` — Final design mockup with dark bar exploration (project root, reference only)
- `TINT_OPERATOR_REDESIGN_SPEC.md` — Design spec for the redesign (project root, reference only)

## BUSINESS RULES ADDED

### Layout hierarchy (3 levels)
- Row 1: UniversalHeader — title "My Jobs", stats (queue/active/done counts), clock, search
- Row 2: Job filter as teal-600 segment pill (leftExtra in UniversalHeader). Click opens 400px dropdown with scoreboard + queue cards. Progress bar (rightExtra) shows done/total with colour: amber <25%, teal 25-75%, green >75%
- Below Row 2: Bill To / Ship To as equal-width cards (grid-cols-2). Full customer names, no truncation

### Job queue sequence enforcement
- TM (Chandresh) controls job sequence via assignment order. Operator cannot start a future job — only "Save TI" available for non-current jobs
- Current job = first assigned in queue with no other job in_progress, OR the job that is tinting_in_progress
- Future jobs show "Save TI" only (gray-900). After TI saved: "TI saved — waiting in queue" status text, no action buttons

### CTA button rules
- Save actions (Save TI, Update TI Entry): bg-gray-900 text-white
- Workflow actions (Save TI & Start, Start Job, Mark as Done): bg-green-600 text-white
- NO teal on any CTA button. Teal exists only in sidebar + job pill
- handleSubmitTI(andStart: boolean) — refactored to support save-only mode (andStart=false skips the start endpoint call)
- Buttons use natural width (no max-w), whitespace-nowrap, flex-shrink-0. Never truncate

### Pigment-coloured shade cells (TINTER — 13 shades)
- Each shade input has tinted background + 3px top border in actual pigment colour
- border-radius: 0 0 6px 6px (flat top, rounded bottom)
- Filled cells (value > 0): deeper background + darker border
- Colour constants: TINTER_SHADE_COLORS and ACOTONE_SHADE_COLORS maps with bg/bgFill/border/top/topFill/label hex values per shade code
- Pigment sources: YOX=Yellow Oxide PY42 (#b8860b), LFY=Light Fast Yellow PY3 (#cccc00), GRN=Phthalocyanine Green PG7 (#2e7d32), TBL=Thalo Blue PB15 (#1565c0), WHT=Titanium White PW6 (#757575), MAG=Magenta PR122 (#c2185b), FFR=Fast Fire Red PR254 (#d32f2f), BLK=Carbon Black PBk7 (#37474f), OXR=Oxide Red PR101 (#8d3c1a), HEY=Hansa Yellow PY1 (#c9a800), HER=Hansa Red PR9 (#e53935), COB=Cobalt Blue PB28 (#283593), COG=Cobalt Green PG50 (#00695c)

### ACOTONE shade colours (14 shades)
- Same Option C pattern. Codes decode by naming convention: two-letter colour + strength number (2=strong, 1=standard)
- YE2/YE1=yellows, XY1=amber, XR1=deep red, WH1=white, RE2/RE1=reds, OR1=orange, NO2/NO1=blacks, MA1=magenta-violet, GR1=green, BU2/BU1=blues

### Left panel card states (no teal)
- Selected: bg-gray-100 + border-l-gray-900 (neutral, selection overrides status)
- Pending (unselected): bg-white + border-l-amber-300
- Done (unselected): bg-white + border-l-green-300

### Colour budget for entire page
- Teal: sidebar + job pill ONLY (navigation/identity)
- Gray-900: save CTAs + TINTER/ACOTONE toggle + selected card border
- Green-600: workflow CTAs (start, done)
- Amber: pending status accents (left border, coverage text, progress bar <25%)
- Pigment colours: shade grid cells ONLY (the visual centrepiece)
- Everything else: white, gray-50, gray-100, gray-200, gray-400

### Removed elements
- Old 240px left panel job queue cards
- Old bottom sheet queue overlay
- "+ Add Another Entry" button (left panel navigation replaces multi-entry creation)
- Base SKU dropdown for first entry (driven by left panel selection)
- Entry header when single entry
- Purple TINT badge from TI header (redundant on tinting-only screen)

## PENDING ITEMS

1. Full end-to-end workflow testing: assign from TM → fill TI → save → start → add entry → mark done → auto-advance
2. Suggestion strip verification — needs saved shade data to render; test with customer that has shade history
3. Queue dropdown keyboard navigation (↑↓ + Esc) — designed but may not be implemented
4. Mobile layout — left panel hidden on <md, TI form full width. Needs proper mobile testing
5. Timer display in footer during in-progress state — verify it renders correctly
6. ACOTONE shade grid — verify colour mapping renders when switching to ACOTONE tab

## CHECKLIST UPDATES

- Before any tint-operator changes: read TINT_OPERATOR_REDESIGN_SPEC.md + v7 mockup
- TINTER_SHADE_COLORS and ACOTONE_SHADE_COLORS constants live at top of tint-operator-content.tsx — update if shade codes change
- handleSubmitTI now takes boolean param (andStart) — any changes to TI save flow must preserve this gate
- Left panel selection uses gray-100/gray-900 — do NOT reintroduce teal on line cards
- CTA colours: gray-900 = save, green-600 = workflow. Do NOT use teal on buttons
