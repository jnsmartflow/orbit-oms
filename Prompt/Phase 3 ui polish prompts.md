# PHASE_3_UI_POLISH_PROMPTS.md — Orbit OMS
# UI/UX Polish — Support Queue · Tint Kanban · Admin Panel
# Paste each STEP as a single message into Claude Code.
# Read CLAUDE_CONTEXT.md before starting. Run `npx tsc --noEmit` after each step.

---

## PRIMER — paste this first in every new Claude Code session

```
Read CLAUDE_CONTEXT.md fully before doing anything else.

This session is about UI/UX polish only — no schema changes, no new API routes,
no new DB tables. You are restyling existing components and pages.

Confirm you understand:
1. Stack: Next.js 14 App Router · TypeScript strict · Tailwind + shadcn/ui
2. Font to use: Plus Jakarta Sans (already added to globals or add via next/font/google)
3. Monospace font for codes/weights: JetBrains Mono (add via next/font/google)
4. Brand color: --navy #1a237e (already in use — keep it)
5. Theme: light, clean, warm-white background #f0f2f8
6. DO NOT change any API routes, Prisma queries, or business logic
7. DO NOT install new packages — use only Tailwind + shadcn/ui + existing deps
8. Read every file before editing it

State what you understand before writing any code.
```

---

## STEP 1 — Design tokens + global styles

**What this builds:** A shared CSS token layer and font setup that all polish steps will inherit.
No functional changes — purely visual foundation.

```
Apply global design token and font changes to Orbit OMS.
Read /app/globals.css and /app/layout.tsx before making any changes.

── Fonts ──────────────────────────────────────────────────────────────────────
In /app/layout.tsx, add two Google Fonts via next/font/google:

  import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'

  const jakarta = Plus_Jakarta_Sans({
    subsets: ['latin'],
    variable: '--font-sans',
    display: 'swap',
  })

  const mono = JetBrains_Mono({
    subsets: ['latin'],
    variable: '--font-mono',
    display: 'swap',
    weight: ['400', '500'],
  })

Apply both CSS variables to the <body> tag:
  className={`${jakarta.variable} ${mono.variable} font-sans`}

── CSS Variables ──────────────────────────────────────────────────────────────
In /app/globals.css, inside :root {}, ADD (do not remove existing vars):

  /* Orbit design tokens */
  --bg:          #f0f2f8;
  --surface:     #ffffff;
  --surface2:    #f7f8fc;
  --border:      #e2e5f1;
  --border2:     #cdd1e8;
  --t1:          #111827;
  --t2:          #374151;
  --t3:          #6b7280;
  --t4:          #9ca3af;
  --navy:        #1a237e;
  --navy-mid:    #283593;
  --navy-50:     #e8eaf6;
  --navy-100:    #c5cae9;

  /* Semantic status */
  --red:         #dc2626;   --red-bg:    #fef2f2;  --red-bd:    #fecaca;
  --green:       #16a34a;   --green-bg:  #f0fdf4;  --green-bd:  #86efac;
  --amber:       #d97706;   --amber-bg:  #fffbeb;  --amber-bd:  #fcd34d;
  --violet:      #7c3aed;   --violet-bg: #f5f3ff;  --violet-bd: #ddd6fe;
  --blue:        #2563eb;   --blue-bg:   #eff6ff;  --blue-bd:   #bfdbfe;

  /* Elevation */
  --sh0: 0 1px 2px rgba(0,0,0,.04);
  --sh1: 0 1px 4px rgba(17,24,39,.06), 0 2px 8px rgba(17,24,39,.04);
  --sh2: 0 4px 16px rgba(17,24,39,.08), 0 2px 6px rgba(17,24,39,.04);

── tailwind.config ────────────────────────────────────────────────────────────
In tailwind.config.ts, extend the fontFamily section:
  fontFamily: {
    sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
    mono: ['var(--font-mono)', 'monospace'],
  }

Also set the background color default:
  backgroundColor: { DEFAULT: 'var(--bg)' }

── Body background ────────────────────────────────────────────────────────────
In globals.css set body background: var(--bg)

Run: npx tsc --noEmit
Fix any TypeScript errors before stopping.
```

**Test:** npm run dev → pages load with Plus Jakarta Sans font. Body background is #f0f2f8 (slightly blue-grey).

---

## STEP 2 — Shared badge + status components

**What this builds:** Reusable typed badge and status components used across all screens.
Create once, import everywhere.

```
Create the following shared components. Do not modify any existing components.
Read /components/ui/ to understand what shadcn primitives are already available.

── /components/shared/status-badge.tsx ───────────────────────────────────────
A typed React component for all status/tag badges used in the app.

Props interface:
  type StatusBadgeVariant =
    | 'hold' | 'dispatch' | 'waiting'
    | 'tint' | 'non-tint'
    | 'urgent' | 'normal'
    | 'key' | 'key-site'
    | 'active' | 'inactive'
    | 'pending' | 'in-progress' | 'done'

  interface StatusBadgeProps {
    variant: StatusBadgeVariant
    size?: 'sm' | 'md'     // default 'md'
    showDot?: boolean      // default true for status variants
  }

Color map (Tailwind classes — use inline style for CSS vars if needed):
  hold:        bg-red-50    text-red-700    border border-red-200
  dispatch:    bg-green-50  text-green-700  border border-green-200
  waiting:     bg-amber-50  text-amber-700  border border-amber-200
  tint:        bg-violet-50 text-violet-700 border border-violet-200
  non-tint:    bg-gray-100  text-gray-500   border border-gray-200
  urgent:      bg-red-50    text-red-700    border border-red-200
  normal:      bg-blue-50   text-blue-700   border border-blue-200
  key:         bg-yellow-50 text-yellow-700 border border-yellow-200
  key-site:    bg-blue-50   text-blue-700   border border-blue-200
  active:      bg-green-50  text-green-700  border border-green-200
  inactive:    bg-gray-100  text-gray-500   border border-gray-200
  pending:     bg-indigo-50 text-indigo-700 border border-indigo-200
  in-progress: bg-amber-50  text-amber-700  border border-amber-200
  done:        bg-green-50  text-green-700  border border-green-200

Label map (what text to render for each variant):
  hold → 'Hold'
  dispatch → 'Dispatch'
  waiting → 'Waiting'
  tint → 'Tint'
  non-tint → 'Non-Tint'
  urgent → 'Urgent'
  normal → 'Normal'
  key → '★ Key'
  key-site → '★ Key Site'
  active → 'Active'
  inactive → 'Inactive'
  pending → 'Pending'
  in-progress → 'In Progress'
  done → 'Done'

Size variants:
  sm: text-[10px] px-1.5 py-0.5 rounded font-semibold
  md: text-[11px] px-2 py-0.5 rounded-md font-semibold

Dot: a 5px circle of matching color to the left of the label.
Show dot by default for: hold, dispatch, waiting, urgent, normal, active, inactive.
Hide dot for: tint, non-tint, key, key-site, pending, in-progress, done.

Export as: export function StatusBadge({ variant, size = 'md', showDot }: StatusBadgeProps)

── /components/shared/obd-code.tsx ───────────────────────────────────────────
Small inline component for monospace OBD number display.

  interface ObdCodeProps { code: string; className?: string }
  export function ObdCode({ code, className }: ObdCodeProps) {
    return (
      <span className={cn('font-mono text-[11.5px] font-medium text-[#1a237e]', className)}>
        {code}
      </span>
    )
  }

── /components/shared/stat-card.tsx ──────────────────────────────────────────
Reusable stat card for dashboards and page headers.

  interface StatCardProps {
    label: string
    value: string | number
    sub?: string
    iconBg?: string       // Tailwind bg class e.g. 'bg-indigo-50'
    iconColor?: string    // Tailwind text class e.g. 'text-indigo-600'
    icon: React.ReactNode // SVG element
    valueColor?: string   // Tailwind text class for the number
  }

Renders: white card, rounded-xl, border, shadow-sm.
Inside: icon block (left) + label/value/sub (right).
Label: text-[10.5px] font-bold uppercase tracking-wide text-gray-400
Value: text-[20px] font-extrabold leading-tight
Sub: text-[10.5px] text-gray-400

Export as: export function StatCard(props: StatCardProps)

Run: npx tsc --noEmit — fix all type errors before stopping.
```

**Test:** No errors. Components importable from '@/components/shared/status-badge', etc.

---

## STEP 3 — Admin layout redesign

**What this builds:** Replaces the current dark #111 sidebar + header with the new light-theme admin shell.
Sidebar becomes icon+label format (240px expanded). Background becomes #f0f2f8.

```
Restyle the admin panel layout. Do not change any auth logic or routing.
Read these files before editing:
  - /components/admin/admin-sidebar.tsx
  - /components/admin/admin-header.tsx
  - /app/(admin)/admin/layout.tsx

── New sidebar design (/components/admin/admin-sidebar.tsx) ──────────────────
Keep all existing nav items and hrefs. Only change the visual design.

Background: white (#fff) not #111
Border: right border 1px solid #e2e5f1
Width: 240px on desktop, slide-in drawer on mobile (keep existing mobile logic)
Shadow: shadow-sm

Logo block at top:
  - 36px square, rounded-xl, bg-[#1a237e], white text "O" — 14px font-weight-800
  - Next to it: "Orbit OMS" 14px font-bold text-gray-900, "Admin Panel" 10px text-gray-400

Nav section labels (e.g. "MASTER DATA", "OPERATIONS"):
  Group items into sections with a tiny section header label:
    Section "OVERVIEW":     Dashboard
    Section "MASTER DATA":  System Config · Users · Roles · Delivery Types · Routes · Areas · Sub-areas
    Section "OPERATIONS":   Sales Officers · Customers · SKUs · Vehicles

  Section label style: text-[9px] font-bold uppercase tracking-widest text-gray-400 px-4 pt-4 pb-1

Nav item style (inactive):
  flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] font-medium text-gray-500
  hover:bg-gray-50 hover:text-gray-900 transition-colors mx-2

Nav item style (active):
  bg-[#e8eaf6] text-[#1a237e] font-semibold
  left border accent: border-l-2 border-[#1a237e] (achieved via pl-[10px] on active and pl-3 on inactive)

Icons: Add a small Lucide icon before each nav label. Map:
  Dashboard → LayoutDashboard
  System Config → Settings2
  Users → Users
  Roles → ShieldCheck
  Delivery Types → Truck
  Routes → MapPin
  Areas → Map
  Sub-areas → Layers
  Sales Officers → UserCheck
  Customers → Building2
  SKUs → Package
  Vehicles → Truck (same as delivery types is fine)

Bottom of sidebar:
  User avatar block: show user initials in a 32px circle (bg-[#1a237e] text-white)
  userName below in 12px font-semibold text-gray-800
  userRole in 10px text-gray-400

── New header design (/components/admin/admin-header.tsx) ────────────────────
Background: white. Border-bottom: 1px solid #e2e5f1. Height: 52px. Shadow: shadow-sm.

Left: breadcrumb — "Admin" › current page name (derive from pathname)
Right: live time display (client component, updates every minute):
  font-mono text-[11px] text-gray-400 bg-gray-50 border border-gray-200 px-3 py-1 rounded-md
Right: sign-out button (keep existing signOut logic):
  text-[12px] text-gray-500 hover:text-red-600 flex items-center gap-1.5

── Layout background ──────────────────────────────────────────────────────────
In /app/(admin)/admin/layout.tsx:
  Change the outer div background from bg-slate-50 to bg-[#f0f2f8]
  Change the main content area to bg-[#f0f2f8]

Run: npx tsc --noEmit — fix all errors.
```

**Test:** /admin loads with white sidebar, navy active state, Plus Jakarta Sans font, #f0f2f8 main background.

---

## STEP 4 — Admin dashboard redesign

**What this builds:** Replaces the basic 4-card dashboard with stat cards (using new StatCard component)
and an improved recent-activity table.

```
Restyle /app/(admin)/admin/page.tsx — Admin Dashboard.
Read the file fully before editing. Do not change any Prisma queries.
Import StatCard from '@/components/shared/stat-card'.

── Page header ────────────────────────────────────────────────────────────────
Add a page header section:
  <div className="mb-6">
    <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">Dashboard</h1>
    <p className="text-[12px] text-gray-400 mt-0.5">Depot overview — {today's date in "Mon 16 Mar 2026" format}</p>
  </div>

── Stat cards (replace existing cards) ────────────────────────────────────────
Replace the existing Card grid with 4 StatCard components in a grid-cols-4 grid.
Keep the same Prisma queries — only change the presentation.

  StatCard 1: Active Users
    icon: <Users /> iconBg="bg-indigo-50" iconColor="text-indigo-600"
    value: activeUsers  valueColor: text-indigo-600

  StatCard 2: Active Routes
    icon: <MapPin /> iconBg="bg-blue-50" iconColor="text-blue-600"
    value: activeRoutes  valueColor: text-blue-600

  StatCard 3: Active SKUs
    icon: <Package /> iconBg="bg-violet-50" iconColor="text-violet-600"
    value: activeSkus  valueColor: text-violet-600

  StatCard 4: Active Customers
    icon: <Building2 /> iconBg="bg-emerald-50" iconColor="text-emerald-600"
    value: activeCustomers  valueColor: text-emerald-600

── Recent users table (replace existing list) ─────────────────────────────────
Wrap in a white card: bg-white rounded-xl border border-[#e2e5f1] shadow-sm overflow-hidden

Header row inside card:
  px-5 py-3.5 border-b border-[#e2e5f1]
  Left: "Recent Users" text-[13px] font-bold text-gray-900
  Right: Link to /admin/users — "View all →" text-[12px] text-[#1a237e] font-medium

Table (replace <ul> with a proper <table>):
  Columns: Name · Role · Created
  thead: bg-[#f7f8fc], text-[10.5px] font-bold uppercase tracking-wide text-gray-400, py-2.5 px-5
  tbody rows: border-b border-[#e2e5f1], py-3 px-5, hover:bg-[#f7f8fc]
  Name cell: font-semibold text-[13px] text-gray-900
  Role cell: use StatusBadge with variant derived from role name:
    Admin → use a gray badge
    Support → use a blue badge (use 'normal' variant or add 'role' variant)
    For role badges use a simple inline badge: text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-semibold
  Created cell: font-mono text-[11.5px] text-gray-400

Run: npx tsc --noEmit — fix all errors.
```

**Test:** /admin shows redesigned stat cards and recent users table with proper typography.

---

## STEP 5 — Admin table screens polish

**What this builds:** Applies consistent table styling, filter bars, and page headers to all admin
CRUD screens. This covers: Routes, Areas, Sub-areas, Sales Officers, Customers, SKUs, Users.

```
Polish all admin table screens. Read each component file before editing.
The goal is visual consistency — do not change any data-fetching or API logic.

Apply these patterns to ALL admin table screens:
  /admin/routes, /admin/areas, /admin/sub-areas,
  /admin/sales-officers, /admin/customers, /admin/skus, /admin/users

── Page header pattern (add to top of each page) ──────────────────────────────
  <div className="flex items-start justify-between mb-5">
    <div>
      <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">{Page Title}</h1>
      <p className="text-[12px] text-gray-400 mt-0.5">{count} total · {activeCount} active</p>
    </div>
    <div className="flex gap-2">
      {/* existing action buttons — keep logic, just restyle */}
      {/* Primary button: bg-[#1a237e] hover:bg-[#283593] text-white text-[12.5px] font-semibold
          px-4 py-2 rounded-lg flex items-center gap-1.5 */}
      {/* Secondary button: bg-white border border-[#cdd1e8] text-gray-600 text-[12.5px]
          font-medium px-3 py-2 rounded-lg flex items-center gap-1.5 hover:bg-gray-50 */}
    </div>
  </div>

── Filter bar pattern ──────────────────────────────────────────────────────────
  Wrap existing filters in:
  <div className="flex items-center gap-2.5 mb-4 flex-wrap">
    {/* Search Input: */}
    {/* bg-white border border-[#e2e5f1] rounded-lg px-3 py-2 text-[12.5px]
        placeholder:text-gray-400 focus:border-[#1a237e] focus:ring-2 focus:ring-[#1a237e]/10
        font-sans w-[240px] */}
    {/* Select dropdowns: same border/bg, rounded-lg, text-[12.5px] */}
    {/* Right side: result count in text-[11.5px] text-gray-400 */}
  </div>

── Table card pattern ──────────────────────────────────────────────────────────
  Wrap existing Table in:
  <div className="bg-white border border-[#e2e5f1] rounded-xl overflow-hidden shadow-sm">
    <table> ... </table>
  </div>

  thead: bg-[#f7f8fc]
  thead th: text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400
            py-2.5 px-4 text-left border-b border-[#e2e5f1]
  tbody tr: border-b border-[#e2e5f1] hover:bg-[#f5f7ff] transition-colors last:border-0
  tbody td: py-3 px-4 text-[12.5px] text-gray-700

── Badge updates ───────────────────────────────────────────────────────────────
  Replace all existing Badge components in table cells with StatusBadge:
  - Active/Inactive status: StatusBadge variant="active" | "inactive"
  - isKeyCustomer=true: StatusBadge variant="key"
  - isKeySite=true: StatusBadge variant="key-site"

── Customer code / SKU code cells ─────────────────────────────────────────────
  Wrap customer codes and SKU codes with ObdCode component (same styling).
  These should render in font-mono text-[#1a237e].

── Action buttons in table rows ────────────────────────────────────────────────
  Replace "Edit" buttons with:
  <button className="text-[11.5px] font-medium text-gray-500 border border-[#e2e5f1]
    bg-white hover:bg-[#f5f7ff] hover:text-[#1a237e] hover:border-[#c5cae9]
    px-3 py-1.5 rounded-lg transition-colors">
    Edit →
  </button>

── Sheet (slide-over) header area ─────────────────────────────────────────────
  Update all Sheet headers to have:
  - Title: text-[15px] font-bold text-gray-900
  - Subtitle (OBD or entity code): font-mono text-[11.5px] text-[#1a237e]
  - Close button: 28px square, rounded-lg, bg-gray-100 hover:bg-red-50 hover:text-red-600

  Sheet section titles (inside form):
  - text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400
    pb-2 mb-3 border-b border-[#e2e5f1]

  Form labels inside sheets:
  - text-[11.5px] font-semibold text-gray-600

  Form inputs inside sheets:
  - border-[1.5px] border-[#cdd1e8] rounded-lg px-3 py-2 text-[12.5px]
    focus:border-[#1a237e] focus:ring-2 focus:ring-[#1a237e]/10
    font-sans w-full outline-none transition

── Pagination ──────────────────────────────────────────────────────────────────
  Update pagination in Customers and SKUs pages:
  <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e5f1] bg-[#f7f8fc]">
    <span className="text-[11.5px] text-gray-400">Page {page} of {totalPages} · {total} items</span>
    <div className="flex gap-1.5">
      {/* Prev/Next buttons: 28px height, rounded-lg, border, text-[11.5px] font-medium */}
      {/* Active page: bg-[#1a237e] text-white */}
    </div>
  </div>

Run: npx tsc --noEmit — fix all errors. Do not change any data or API logic.
```

**Test:** All admin table screens load with consistent card/table/badge styling.

---

## STEP 6 — Support Queue redesign

**What this builds:** Full visual redesign of /support page.
Adds stat bar, redesigned filter row, polished table, and improved edit sheet.

```
Restyle the Support Queue screen at /app/(support)/support/page.tsx
and all components it uses.

Read these files before editing:
  /app/(support)/support/page.tsx
  /app/(support)/support/layout.tsx
  All components imported by the support page

DO NOT change: API fetch logic, order mutation logic, audit trail writes,
requireRole guard, pagination logic, or any server actions.

── Support layout (/app/(support)/support/layout.tsx) ─────────────────────────
  Background: bg-[#f0f2f8]
  Sidebar (if applicable): apply same white sidebar pattern from admin (Step 3).
  If support uses a different layout, ensure it has:
    - A fixed topbar: height 52px, bg-white, border-b border-[#e2e5f1], shadow-sm
    - Topbar left: page title "Support Queue" text-[17px] font-extrabold text-gray-900
      + count badge: bg-[#f7f8fc] border border-[#e2e5f1] text-gray-400 text-[12px]
        font-semibold px-2 py-0.5 rounded-full ml-2
    - Topbar right: time display (font-mono) + Export button (outline style)
    - A tab strip below topbar: height 44px, bg-white, border-b, tabs for
      "Support Queue" and "Tint Manager" (keep existing routing)

── Tab strip styling ──────────────────────────────────────────────────────────
  Tab strip sits below topbar (top: 52px if fixed).
  Tabs: flex items-center gap-1.5 px-4 py-0 h-full text-[12.5px] font-medium
  Inactive tab: text-gray-400 border-b-2 border-transparent hover:text-gray-700
  Active tab: text-[#1a237e] border-b-2 border-[#1a237e] font-semibold
  Count pill on tab: text-[10px] font-bold px-1.5 py-0.5 rounded-full
    Active: bg-[#e8eaf6] text-[#1a237e]
    Inactive: bg-gray-100 text-gray-400

── Filter row ─────────────────────────────────────────────────────────────────
  Add a filter row between tab strip and stat bar:
  bg-white border-b border-[#e2e5f1] px-6 py-2.5 flex items-center gap-2 flex-wrap

  Status filter chips (replace existing filter UI):
  <div className="flex gap-1.5">
    {['All','Hold','Dispatch','Waiting','Urgent','Tint'].map(label => (
      <button key={label}
        className={cn(
          'text-[11.5px] font-medium px-2.5 py-1 rounded-md border transition-colors',
          active ? 'bg-[#1a237e] text-white border-[#1a237e]'
                 : 'bg-white text-gray-500 border-[#e2e5f1] hover:border-[#c5cae9] hover:text-gray-800'
        )}>
        {label}
      </button>
    ))}
  </div>

  Divider: w-px h-5 bg-[#e2e5f1] mx-1

  Route select + Slot select: keep existing logic, restyle to:
    bg-white border border-[#cdd1e8] rounded-lg px-2.5 py-1.5 text-[12px] text-gray-500
    font-sans cursor-pointer

  Right side: result count text-[11.5px] text-gray-400 + "Bulk Action" outline button

── Stat bar ───────────────────────────────────────────────────────────────────
  Below filter row, a horizontal strip: px-6 py-3 flex gap-2.5 flex-wrap
  Use StatCard (imported from @/components/shared/stat-card) for each stat:
    Total orders · Hold · Dispatch · Waiting · Urgent · Total Weight

  Icons for each:
    Total: ClipboardList iconBg="bg-indigo-50" iconColor="text-indigo-600"
    Hold: AlertCircle iconBg="bg-red-50" iconColor="text-red-600"
    Dispatch: CheckCircle2 iconBg="bg-green-50" iconColor="text-green-600"
    Waiting: Clock iconBg="bg-amber-50" iconColor="text-amber-600"
    Urgent: Zap iconBg="bg-red-50" iconColor="text-red-600"
    Weight: Weight iconBg="bg-gray-50" iconColor="text-gray-600"

  These are DISPLAY ONLY — derive counts from the existing fetched orders data.

── Table ──────────────────────────────────────────────────────────────────────
  Wrap in: px-6 pb-6

  Table card: bg-white rounded-xl border border-[#e2e5f1] shadow-sm overflow-hidden

  thead: bg-[#f7f8fc]
  thead th: text-[10.5px] font-bold uppercase tracking-[.5px] text-gray-400
            py-2.5 px-4 border-b border-[#e2e5f1]
  Add a checkbox column as first column (keep existing select logic if any, add if not)

  Columns: ☐ · OBD No. · Customer · Route · Area · Weight · Slot · Type · Dispatch Status · Priority · Action

  tbody rows: border-b border-[#e2e5f1] hover:bg-[#f5f7ff] cursor-pointer transition-colors

  OBD cell: use ObdCode component from @/components/shared/obd-code
  Customer cell:
    <div>
      <div className="font-semibold text-[12.5px] text-gray-900 flex items-center gap-1.5">
        {customer.name}
        {isKey && <StatusBadge variant="key" size="sm" />}
      </div>
      <div className="text-[11px] text-gray-400 font-mono mt-0.5">{customer.code}</div>
    </div>
  Route·Area cell: text-[12px] text-gray-500
  Weight cell: font-mono text-[12px] text-gray-500
  Slot cell:
    <div>
      <div className="text-[12px] text-gray-700">{slotName}</div>
      <div className="text-[10.5px] text-gray-400 mt-0.5">{Today/Tomorrow}</div>
    </div>
  Type cell: StatusBadge variant="tint" | "non-tint"
  Dispatch Status cell: StatusBadge variant="hold" | "dispatch" | "waiting"
  Priority cell: StatusBadge variant="urgent" | "normal"
  Action cell (right-aligned): "Edit →" button (outline style from Step 5)

  Table footer:
  <div className="flex items-center justify-between px-5 py-3 border-t border-[#e2e5f1] bg-[#f7f8fc]">
    <span className="text-[11.5px] text-gray-400">Showing {n} of {total}</span>
    {/* pagination buttons */}
  </div>

── Edit Sheet redesign ────────────────────────────────────────────────────────
  Keep all existing form logic, mutation logic, and audit trail writes.
  Only restyle the visual layout.

  Sheet width: w-[500px]

  Sheet header:
    <div className="px-6 py-5 border-b border-[#e2e5f1] flex items-start gap-3">
      <div className="flex-1">
        <h2 className="text-[15px] font-bold text-gray-900">{customerName}</h2>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <ObdCode code={obdNumber} />
          <StatusBadge variant="tint|non-tint" size="sm" />
          <StatusBadge variant="hold|dispatch|waiting" size="sm" />
          <StatusBadge variant="urgent|normal" size="sm" />
        </div>
      </div>
      <button onClick={onClose} className="w-7 h-7 rounded-lg bg-gray-100
        hover:bg-red-50 hover:text-red-500 flex items-center justify-center
        text-gray-400 text-[14px] transition-colors flex-shrink-0">✕</button>
    </div>

  Sheet section titles: text-[10px] font-extrabold uppercase tracking-[.7px] text-gray-400
    border-b border-[#e2e5f1] pb-2 mb-3

  Order details info grid: grid grid-cols-2 gap-3
    Each cell:
      label: text-[10.5px] font-semibold text-gray-400 mb-1
      value: text-[13px] font-medium text-gray-900

  Dispatch Status — 3-option toggle:
    Replace existing Select or radio with a visual 3-button toggle row.
    Each option is a full-width-flex-1 button:
      Unselected: border border-[#cdd1e8] rounded-lg py-2 text-center text-[12px] font-semibold text-gray-400
      Selected Hold: border border-red-300 bg-red-50 text-red-700
      Selected Dispatch: border border-green-300 bg-green-50 text-green-700
      Selected Waiting: border border-amber-300 bg-amber-50 text-amber-700

  Priority — 2-option toggle (same pattern):
      Selected Normal: border border-blue-300 bg-blue-50 text-blue-700
      Selected Urgent: border border-red-300 bg-red-50 text-red-700

  Slot Override: keep existing Select, restyle to new input style.
  Support Note: keep existing Textarea, restyle to new input style.

  Line items table: inside a rounded-lg border overflow-hidden
    Tint rows: bg-violet-50/50
    Tint badge cell: use StatusBadge variant="tint" size="sm"

  Audit trail:
    Each row: flex gap-2.5 items-start p-2.5 bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg text-[11.5px]
    Dot: 8px circle of appropriate color
    Action text: font-semibold text-gray-800
    Meta line: text-[10.5px] text-gray-400 mt-0.5

  Sheet footer:
    <div className="px-6 py-4 border-t border-[#e2e5f1] flex gap-2.5 bg-white">
      Cancel: flex-1 outline style
      Save: flex-2 bg-[#1a237e] text-white font-semibold rounded-lg
    </div>

Run: npx tsc --noEmit — fix all errors.
```

**Test:** /support loads with stat bar, filter chips, polished table, and redesigned edit sheet.

---

## STEP 7 — Tint Manager Kanban redesign

**What this builds:** Full visual redesign of /tint/manager Kanban board with card-style layout
matching the reference design (2×2 meta grid, progress bars, SKU lines per card).

```
Restyle the Tint Manager Kanban at /app/(tint)/manager/page.tsx
and all components it uses.

Read these files before editing:
  /app/(tint)/manager/page.tsx (or /tint/manager/page.tsx depending on routing)
  All Kanban card and column components
  The operator assignment modal/sheet

DO NOT change: API mutations (assign, start, done), requireRole guard,
tint_logs insert logic, or any server actions.

── Layout + controls row ─────────────────────────────────────────────────────
  Same topbar + tabstrip pattern as Support Queue (Step 6).
  Tab strip shows: "Support Queue" and "Tint Manager" tabs with counts.

  Below tab strip — filter row:
    bg-white border-b border-[#e2e5f1] px-6 py-2.5 flex items-center gap-2

    Slot filter chips (same style as Step 6):
      'All Slots', 'Morning 10:30', 'Afternoon 12:30', 'Evening 15:30'

    Operator filter:
      bg-white border border-[#cdd1e8] rounded-lg px-2.5 py-1.5 text-[12px] text-gray-500

    Right: result count + "Auto-assign" outline button

  Stat bar (same as Step 6, using StatCard):
    Pending · In Progress · Done · Total Tint SKUs
    Same StatCard layout.

── Kanban board layout ────────────────────────────────────────────────────────
  Container: overflow-x-auto px-6 pb-6
  Board grid: grid grid-cols-3 gap-4 min-w-[960px]

── Column styling ─────────────────────────────────────────────────────────────
  Each column: bg-[#f7f8fc] border border-[#e2e5f1] rounded-[14px] overflow-hidden

  Column header:
    bg-white border-b border-[#e2e5f1] px-4 py-3.5 flex items-center gap-2.5

    Dot: 10px circle — indigo for Pending, amber for In Progress, green for Done
    Title: text-[13px] font-bold text-gray-900 flex-1
    Count pill (right):
      Pending: bg-red-50 text-red-600 border border-red-200 text-[11.5px] font-bold px-2.5 py-0.5 rounded-full
      In Progress: bg-amber-50 text-amber-600 border border-amber-200
      Done: bg-green-50 text-green-600 border border-green-200
    Action buttons (⋮ and +): 26px square, rounded-lg, text-gray-400, hover:bg-gray-100

  Card list area: p-3 flex flex-col gap-2.5 overflow-y-auto max-h-[calc(100vh-320px)]

── Kanban card styling ────────────────────────────────────────────────────────
  Card: bg-white border border-[#e2e5f1] rounded-xl overflow-hidden
    shadow-sm cursor-pointer
    transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 hover:border-[#cdd1e8]

  Urgent card: add border-t-[3px] border-t-red-500
  Key customer card: add border-t-[3px] border-t-amber-400
  Done card: opacity-80

  Top accent bar (3px height, full width):
    Pending col:    background: linear-gradient(90deg, #6366f1, #818cf8)
    In Progress col: background: linear-gradient(90deg, #d97706, #fbbf24)
    Done col:       background: linear-gradient(90deg, #16a34a, #4ade80)
  Render this as: <div className="h-[3px] w-full" style={{background: '...'}} />

  Card header (inside padding px-3.5 pt-3 pb-0):
    flex items-start justify-between gap-2

    Left: customer name text-[13.5px] font-bold text-gray-900 leading-snug
    Right: badges stack (flex flex-col gap-1 items-end)
      StatusBadge variant="urgent" size="sm" (if urgent)
      StatusBadge variant="key" size="sm" (if key customer)
      StatusBadge variant="normal" size="sm" (if normal)

  OBD + area row (below header, px-3.5 pt-1.5 pb-0):
    <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
      <ObdCode code={obd} />
      <span>·</span>
      <span>{route} · {area}</span>
    </div>

  Meta grid (px-3.5 pt-2.5 pb-0):
    Render as: bg-[#f7f8fc] border border-[#e2e5f1] rounded-lg p-2.5 grid grid-cols-2 gap-2

    Each meta cell:
      <div>
        <div className="text-[9.5px] font-bold uppercase tracking-[.4px] text-gray-400 mb-0.5">
          {label}
        </div>
        <div className="text-[12px] font-semibold text-gray-900">{value}</div>
      </div>

    Cells for PENDING cards:
      Due Slot | Weight | Assigned To (shows "Unassigned" in italic gray) | Delivery Type

    Cells for IN PROGRESS cards:
      Due Slot | Weight | Assigned To (avatar+name) | Started At

    Cells for DONE cards:
      Due Slot | Weight | Completed By (avatar+name) | Completed At

  Tint SKU lines (px-3.5 pt-2 pb-0):
    Each SKU: flex items-center justify-between
      bg-violet-50 border border-violet-200 rounded-md px-2.5 py-1.5 mb-1.5
      SKU code: font-mono text-[10.5px] font-medium text-violet-700 flex-1
      SKU name: text-[10.5px] text-gray-500 flex-[2] px-2 truncate
      Qty pill: text-[11px] font-bold text-violet-700 bg-white border border-violet-200
                px-1.5 py-0.5 rounded-md flex-shrink-0

    Done column: swap violet for green (bg-green-50 border-green-200 text-green-700)

  Progress bar (px-3.5 pt-2 pb-0):
    Label row: flex justify-between mb-1
      "Tinting Progress" text-[10.5px] font-semibold text-gray-400
      "{pct}%" text-[11px] font-bold — gray if 0, red if <25, amber if <75, green if ≥75

    Bar: h-[5px] bg-gray-100 rounded-full overflow-hidden
    Fill: transition-[width] duration-500 rounded-full
      0%: bg-gray-200
      1–24%: bg-red-400
      25–74%: bg-amber-400
      75–99%: bg-green-400
      100%: bg-green-500

    Values from existing order data — keep same derivation logic.

  Card footer (mt-2.5 px-3.5 pb-3.5 pt-2.5 border-t border-[#e2e5f1] bg-[#f7f8fc]):
    flex items-center justify-between

    Left — operator display:
      If assigned: flex items-center gap-2
        Avatar: 24px circle, bg-[#1a237e] text-white text-[9px] font-bold
        Name: text-[11.5px] font-medium text-gray-600
      If unassigned: italic text-[11px] text-gray-400

    Right — action button:
      Pending (unassigned):
        "Assign →" bg-[#e8eaf6] text-[#1a237e] border border-[#c5cae9]
        hover:bg-[#1a237e] hover:text-white
        text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors
        Keep existing onClick → opens assignment modal

      In Progress:
        "⏳ In Progress" bg-amber-50 text-amber-600 border border-amber-200
        pointer-events-none (display only, no action needed here)

      Done:
        "✓ Completed" bg-green-50 text-green-600 border border-green-200
        pointer-events-none

── Operator assignment modal/sheet redesign ──────────────────────────────────
  Keep all existing mutation logic (assignOperator API call, optimistic update).
  Only restyle visually.

  Modal: bg-white rounded-[14px] shadow-xl w-[400px] overflow-hidden
    border border-[#e2e5f1]

  Header: px-5 pt-5 pb-4 border-b border-[#e2e5f1]
    Title: text-[15px] font-bold text-gray-900
    Subtitle: text-[12px] text-gray-400 mt-1 (OBD + customer name)

  Operator option rows: flex items-center gap-3 p-3.5 border-[1.5px] rounded-xl
    mb-2 cursor-pointer transition-all
    Default: border-[#e2e5f1] hover:border-[#c5cae9] hover:bg-[#f7f8fc]
    Selected: border-[#1a237e] bg-[#e8eaf6]

    Avatar: 36px circle, bg-[#1a237e] text-white text-[12px] font-bold
    Name: text-[13px] font-semibold text-gray-900
    Workload: text-[11px] text-gray-400 mt-0.5
    Checkmark (right): 20px circle bg-[#1a237e] text-white text-[10px]
      opacity-0 when not selected, opacity-100 when selected, transition-opacity

  Footer: px-5 pb-5 pt-3 border-t border-[#e2e5f1] flex justify-end gap-2
    Cancel: outline button
    Confirm: bg-[#1a237e] text-white

Run: npx tsc --noEmit — fix all errors.
```

**Test:** /tint/manager shows 3-column Kanban. Cards have meta grid, SKU lines, progress bars.
Urgent cards have red top border. Assign button opens modal. Done cards show green.

---

## STEP 8 — Tint Operator screen polish

**What this builds:** Polishes the Tint Operator personal queue screen.

```
Restyle /app/(tint)/operator/page.tsx — Tint Operator screen.
Read the file before editing. Do not change any mutation logic.

── Layout ─────────────────────────────────────────────────────────────────────
  Topbar: same pattern (52px, bg-white, border-b)
  Title: "My Tint Jobs" text-[17px] font-extrabold
  Right: operator name + time display

── Stat bar (add above job list) ──────────────────────────────────────────────
  3 StatCards: My Queue · In Progress · Completed Today

── Job card list ──────────────────────────────────────────────────────────────
  Replace existing list/card rendering.
  Each job card: bg-white border border-[#e2e5f1] rounded-xl p-4 shadow-sm mb-3
    cursor-pointer hover:shadow-md hover:border-[#cdd1e8] transition-all

  Card layout:
    Top row: OBD (ObdCode component) + status badge (StatusBadge) + slot/date (right)
    Customer name: text-[14px] font-bold text-gray-900 mt-1
    Area: text-[12px] text-gray-400

    Meta grid (same 2-col pattern): Weight · SKU Count · Slot · Delivery Type

    SKU list (same violet rows pattern from Step 7)

    Progress bar (same pattern from Step 7)

    Action button row (bottom, pt-3 border-t border-[#e2e5f1] mt-3):
      If status = pending_tint_assignment:
        "Start Job" bg-[#1a237e] text-white w-full py-2.5 rounded-lg font-semibold text-[13px]
        Keep existing onClick
      If status = tinting_in_progress:
        "Mark as Done ✓" bg-green-600 text-white w-full py-2.5 rounded-lg font-semibold text-[13px]
        Keep existing onClick
      If status = tinting_done:
        "Completed" bg-green-50 text-green-600 border border-green-200 w-full py-2.5 rounded-lg
        pointer-events-none

Run: npx tsc --noEmit — fix all errors.
```

**Test:** /tint/operator shows styled job list with action buttons. Start/Done still work.

---

## STEP 9 — Shared role sidebars

**What this builds:** Applies the new sidebar design to Support and Tint layouts.
Each role gets a minimal icon sidebar (collapsible) matching the prototype design.

```
Create a shared role sidebar component and apply it to Support and Tint layouts.

── /components/shared/role-sidebar.tsx ────────────────────────────────────────
A reusable sidebar for non-admin roles.

Props:
  interface RoleSidebarProps {
    role: 'support' | 'tint_manager' | 'tint_operator'
    userName: string
    userInitials: string
  }

Nav items per role:
  support: [{ label: 'Support Queue', href: '/support', icon: ClipboardList }]
  tint_manager: [
    { label: 'Tint Kanban', href: '/tint/manager', icon: Layers },
    { label: 'Operator View', href: '/tint/operator', icon: User }
  ]
  tint_operator: [{ label: 'My Jobs', href: '/tint/operator', icon: Zap }]

Visual design: same as admin sidebar (Step 3) but narrower icon version when on mobile.
Width: 220px desktop, icon-only (64px) on tablet, hidden on mobile.

Sidebar shows:
  - Logo block (same as admin)
  - "Role" label: e.g. "Support Team" in text-[10px] uppercase tracking text-gray-400 px-4 pt-4 pb-1
  - Nav items (same active/inactive style)
  - Bottom: user initials avatar + name + role

── Apply to layouts ────────────────────────────────────────────────────────────
  Update /app/(support)/support/layout.tsx:
    Use RoleSidebarProps role="support"
    Replace any existing sidebar with RoleSidebar
    Background: bg-[#f0f2f8]

  Update /app/(tint)/tint/layout.tsx (or manager/layout.tsx):
    Use RoleSidebarProps role="tint_manager" (for Tint Manager)
    Use RoleSidebarProps role="tint_operator" (for Tint Operator)
    Background: bg-[#f0f2f8]

Run: npx tsc --noEmit — fix all errors.
```

**Test:** Support and Tint screens have matching white sidebar. Nav links work.

---

## STEP 10 — Final polish + consistency pass

**What this builds:** Fixes any remaining inconsistencies, ensures all loading/empty/error states
are styled, and does a final TypeScript check.

```
Final UI consistency pass for Orbit OMS Polish phase.
Read every changed file before making fixes.

── Loading states ──────────────────────────────────────────────────────────────
Find all loading states (places where loading=true and data hasn't loaded).
Apply this consistent loading pattern:
  - Table loading: tbody shows 5 skeleton rows
    <tr><td colSpan={n}><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
  - Card loading: show a shimmer card div:
    <div className="bg-gray-100 rounded-xl h-32 animate-pulse" />
  - Button loading: "Saving…" text + disabled state + opacity-60

── Empty states ────────────────────────────────────────────────────────────────
Find all empty states (zero results after loading).
Apply this consistent empty state pattern:
  <div className="flex flex-col items-center py-16 text-center">
    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mb-3">
      {/* relevant icon, text-gray-400 */}
    </div>
    <p className="text-[13px] font-semibold text-gray-500">{No items found title}</p>
    <p className="text-[12px] text-gray-400 mt-1">{helpful subtitle}</p>
  </div>

── Error states ────────────────────────────────────────────────────────────────
Find all error states (API failed, fetch error).
Apply this consistent error pattern:
  <div className="flex items-center gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-[12.5px]">
    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
    <span className="text-red-700 font-medium">{error message}</span>
    <button className="ml-auto text-[12px] text-red-600 underline" onClick={retry}>Retry</button>
  </div>

── Toast styling ────────────────────────────────────────────────────────────────
All existing toast calls (Sonner) stay as-is. Just verify they fire correctly.

── Final TypeScript check ────────────────────────────────────────────────────
Run: npx tsc --noEmit
Fix every error. List all files changed.

── Final visual checklist ───────────────────────────────────────────────────────
Verify:
1. Font is Plus Jakarta Sans on all pages
2. Body background is #f0f2f8 everywhere
3. All badges use StatusBadge component
4. All OBD/code cells use ObdCode component
5. Admin sidebar is white with navy active state
6. Support and Tint layouts have RoleSidebar
7. No dark #111 backgrounds remain (except login page which can stay as-is)
8. All tables have consistent thead/tbody styling
9. All sheets have consistent header/section/footer styling
10. No TypeScript errors

Report: list of all files changed in this entire polish phase.
```

**Test:** All screens consistent. npm run build passes with no errors.

---

## TROUBLESHOOTING

**TypeScript error in new component:**
```
I have a TypeScript error: [paste error]. Read the component file and fix the type
mismatch without changing the component's behavior. Run npx tsc --noEmit after fixing.
```

**Tailwind class not applying:**
```
The Tailwind class [class] is not applying on [component]. Check if it uses a dynamic
string (which Tailwind can't tree-shake). If so, replace with a static mapping object
or use a CSS variable via style={{}} instead. Do not add arbitrary values unless needed.
```

**shadcn component styling conflict:**
```
The shadcn [component name] is not picking up my Tailwind overrides. Read the component
in /components/ui/[name].tsx. Use the cn() utility to merge classNames correctly.
Add className prop to the component call and ensure cn() is used inside.
```

**Sheet/Modal not opening:**
```
The [Sheet/Modal] is not opening after the style change. Read the state management in
[component file]. Confirm the open state variable and the onOpenChange handler are still
correctly wired. Do not change any logic — only check that JSX structure changes didn't
break prop threading.
```

---
*UI Polish Phase · Orbit OMS · March 2026*
*Steps 1–10 · Support Queue + Tint Kanban + Admin Panel*
*Prototype reference: orbit_oms_v2.html*