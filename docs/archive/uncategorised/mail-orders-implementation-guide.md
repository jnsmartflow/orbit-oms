# PROMPT GUIDE: Mail Order Frontend — `/mail-orders`
# Version: v43 implementation
# Run these prompts sequentially in Claude Code (Opus for all steps)
# TSC check required between every step
# Design reference: mail-orders-mockup-v3.html (LOCKED)

---

## PRE-FLIGHT CHECKLIST
Before starting any prompt, confirm in Claude Code:
- Read CLAUDE_CONTEXT_v42.md fully
- Read CLAUDE_UI_v4.md fully
- Schema is v22 (6 mo_* tables live)
- Backend APIs are live: /api/mail-orders, /api/mail-orders/[id]/punch, etc.

---

## STEP 1 — DB: Add billing_operator role + users + permissions
## Model: Sonnet (simple SQL, no code changes)

Run the following SQL in Supabase SQL Editor in this exact order.

### 1A — Insert billing_operator into role_master
```sql
INSERT INTO role_master (name, "displayName", description)
VALUES ('billing_operator', 'Billing Operator', 'SAP billing operator — punches mail orders into SAP')
ON CONFLICT (name) DO NOTHING;
```

### 1B — Get the new role ID (note it down)
```sql
SELECT id, name FROM role_master WHERE name = 'billing_operator';
```

### 1C — Insert route permission for billing_operator
```sql
-- Replace <BILLING_ROLE_ID> with the id from 1B
INSERT INTO role_permissions ("roleId", route, "canAccess")
VALUES
  (<BILLING_ROLE_ID>, '/mail-orders', true)
ON CONFLICT DO NOTHING;
```

### 1D — Also give tint_manager access to /mail-orders
```sql
INSERT INTO role_permissions ("roleId", route, "canAccess")
SELECT id, '/mail-orders', true
FROM role_master WHERE name = 'tint_manager'
ON CONFLICT DO NOTHING;
```

### 1E — Insert users (hashed passwords)
```sql
-- Use bcrypt hash for a temp password you set
-- Replace <BCRYPT_HASH> with actual hash
-- Replace <BILLING_ROLE_ID> with id from 1B

INSERT INTO users (name, email, password, "roleId", "isActive")
VALUES
  ('Deepanshu Thakur', 'deepanshu@orbitoms.in', '<BCRYPT_HASH>', <BILLING_ROLE_ID>, true),
  ('Bankim', 'bankim@orbitoms.in', '<BCRYPT_HASH>', <BILLING_ROLE_ID>, true)
ON CONFLICT (email) DO NOTHING;
```

Note: To generate bcrypt hash, run this in Claude Code terminal:
```bash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('YourTempPassword123', 10).then(h => console.log(h));"
```

### 1F — Verify
```sql
SELECT u.name, u.email, r.name as role
FROM users u
JOIN role_master r ON u."roleId" = r.id
WHERE r.name = 'billing_operator';
```

---

## STEP 2 — Sidebar nav: add Mail Orders link for billing_operator + tint_manager
## Model: Sonnet (small targeted edit)

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md and CLAUDE_UI_v4.md fully before starting.

Find the sidebar navigation component (likely `components/layout/sidebar.tsx`
or similar). Read it fully before making any changes.

The sidebar currently shows role-specific nav links. Add Mail Orders as a
nav item that appears for roles: `billing_operator` and `tint_manager`.

Nav item spec:
- Label: "Mail Orders"
- Route: /mail-orders
- Icon: use an envelope/inbox icon (Lucide `Mail` or `Inbox`)
- Position: first item in the nav list for billing_operator
  (tint_manager: add after their existing TM links)

Follow the exact same pattern as existing nav items — same className,
same active state logic (teal-50 bg, teal-700 text, teal-600 border-l-2),
same collapsed tooltip behaviour.

Do not touch any other nav items or roles.

After editing, run: npx tsc --noEmit
Report any errors before proceeding.
────────────────────────────────────────────────────────────────

---

## STEP 3 — Post-login redirect for billing_operator
## Model: Sonnet (small targeted edit)

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md fully before starting.

Find where post-login redirects are handled (likely middleware.ts or
the auth callback / signIn redirect logic in auth.config.ts or
lib/auth.ts).

Currently the app redirects each role to their home route after login.
Add billing_operator to this redirect map:

  billing_operator → /mail-orders

Do not change any other role redirects.

After editing, run: npx tsc --noEmit
Report any errors.
────────────────────────────────────────────────────────────────

---

## STEP 4 — Types: mail order TypeScript interfaces
## Model: Sonnet

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md §57 fully before starting.

Create file: lib/mail-orders/types.ts

Define these TypeScript interfaces based on the mo_* DB schema:

```typescript
export type MatchStatus = 'matched' | 'partial' | 'unmatched'
export type OrderStatus = 'pending' | 'punched'

export interface MoOrderLine {
  id: number
  moOrderId: number
  lineNumber: number
  rawText: string
  packCode: string | null
  quantity: number
  productName: string | null
  baseColour: string | null
  skuCode: string | null
  skuDescription: string | null
  refSkuCode: string | null
  matchStatus: MatchStatus
  createdAt: string
}

export interface MoOrder {
  id: number
  soName: string
  soEmail: string
  receivedAt: string        // ISO string
  subject: string
  customerName: string | null
  customerCode: string | null
  deliveryRemarks: string | null
  remarks: string | null
  billRemarks: string | null
  status: OrderStatus
  punchedById: number | null
  punchedAt: string | null
  punchedBy: { name: string } | null
  emailEntryId: string
  totalLines: number
  matchedLines: number
  createdAt: string
  lines: MoOrderLine[]
}

export interface MoOrdersResponse {
  orders: MoOrder[]
  date: string
  totalOrders: number
  totalLines: number
  matchedLines: number
  punchedOrders: number
}
```

No other files to touch. Just create this types file.
Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 5 — API client: mail orders fetch helpers
## Model: Sonnet

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md §57 (API endpoints section) fully.
Read lib/mail-orders/types.ts that was created in Step 4.

Create file: lib/mail-orders/api.ts

This file contains client-side fetch helpers for the mail order APIs.
All functions are async, throw on non-OK responses.

Functions to implement:

1. fetchMailOrders(date?: string, status?: string): Promise<MoOrdersResponse>
   → GET /api/mail-orders?date=YYYY-MM-DD&status=pending|punched
   → date defaults to today in IST (YYYY-MM-DD)

2. punchOrder(id: number): Promise<void>
   → PATCH /api/mail-orders/[id]/punch
   → body: {}

3. resolveLine(lineId: number, skuCode: string, saveKeyword: boolean): Promise<void>
   → POST /api/mail-orders/lines/[lineId]/resolve
   → body: { skuCode, saveKeyword }

4. searchSkus(q: string): Promise<{ material: string, description: string, packCode: string }[]>
   → GET /api/mail-orders/skus?q=...

Helper: getTodayIST(): string
   → Returns today's date as YYYY-MM-DD in IST timezone
   → Use: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

No default exports. Named exports only.
Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 6 — Utility: slot assignment + clipboard helpers
## Model: Sonnet

────────────────────────────────────────────────────────────────
Create file: lib/mail-orders/utils.ts

Implement these pure utility functions:

1. getSlotFromTime(receivedAt: string): 'Morning' | 'Afternoon' | 'Evening' | 'Night'
   Rules (IST time from receivedAt ISO string):
   - Before 10:30 → Morning
   - 10:30–13:30 → Afternoon
   - 13:30–16:30 → Evening
   - After 16:30  → Night

2. formatTime(receivedAt: string): string
   → Returns HH:MM in 24h format in IST
   → e.g. "09:41"

3. buildClipboardText(lines: MoOrderLine[]): string
   → Filters lines where matchStatus === 'matched'
   → Returns tab-separated "skuCode\tquantity" per line, one per \n
   → Example output:
      IN28301071\t6
      IN30600071\t9

4. groupOrdersBySlot(orders: MoOrder[]): Record<string, MoOrder[]>
   → Groups orders by slot name using getSlotFromTime
   → Slot order: Morning → Afternoon → Evening → Night
   → Preserves chronological order within each slot (by receivedAt)

5. isOdCiFlagged(order: MoOrder): boolean
   → Checks if remarks or subject contains keywords (case-insensitive):
     'od', 'ci', 'credit hold', 'block', 'overdue'
   → Returns true if any keyword found

Note: isOdCiFlagged is auto-detection only for initial flag state.
The operator can manually toggle flag via UI regardless of this.

Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 7 — Main page component (shell + header + slot pills)
## Model: Opus

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md fully.
Read CLAUDE_UI_v4.md fully — follow neutral theme exactly.
Read lib/mail-orders/types.ts, lib/mail-orders/api.ts, lib/mail-orders/utils.ts

DESIGN REFERENCE: mail-orders-mockup-v3.html — match this exactly.

Create these files:
- app/mail-orders/page.tsx  (bare: just <MailOrdersPage />)
- app/mail-orders/mail-orders-page.tsx  (main client component)

### page.tsx
```tsx
import MailOrdersPage from './mail-orders-page'
export default function Page() { return <MailOrdersPage /> }
```

### mail-orders-page.tsx

'use client' component. Implements:

**State:**
- orders: MoOrder[] (fetched)
- loading: boolean
- activeSlot: 'All' | 'Morning' | 'Afternoon' | 'Evening' | 'Night'
- statusFilter: 'all' | 'pending' | 'punched'
- clock: string (HH:MM:SS updated every second)
- flaggedIds: Set<number> (local — operator flags orders)
- expandedId: number | null (one expanded row at a time)

**Data fetch:**
- useEffect on mount: call fetchMailOrders() → set orders
- Auto-refresh every 60 seconds

**Derived stats (useMemo):**
- totalOrders, totalLines, matchedLines, punchedOrders from orders array
- groupedOrders: groupOrdersBySlot filtered by activeSlot + statusFilter

**Layout — 2-row sticky header (exact spec from CLAUDE_UI.md §6):**

Row 1 (42px):
- Left: "Mail Orders" title · stats (N orders · X/Y lines · N/N punched)
- Right: Shortcuts button (opens tooltip) · live clock HH:MM:SS monospace

Row 2 (36px):
- Left: Slot pills — All / Morning / Afternoon / Evening / Night with counts
- Right: Search input (filters by soName/customerName/subject) · Filter button

**Slot pills styling (exact from CLAUDE_UI.md §6):**
- Active: border-gray-900 text-gray-900 font-medium
- Inactive: border-gray-200 text-gray-500
- Count shown as muted text after slot name

**Content area:**
- Renders <MailOrdersTable> component (built in Step 8)
- Passes: orders (filtered+grouped), flaggedIds, expandedId,
  onFlag, onExpand, onPunch, onCopy

**DO NOT implement the table rows here — that is Step 8.**
Just render the shell, header, slot pills, and a placeholder div
for the table.

Constraints:
- export const dynamic = 'force-dynamic' on page.tsx
- No inline styles where Tailwind classes exist
- Follow page.tsx pattern: bare component, no wrapper div, no title

Run: npx tsc --noEmit after creating both files.
────────────────────────────────────────────────────────────────

---

## STEP 8 — Table component: rows, section headers, expand
## Model: Opus

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md and CLAUDE_UI_v4.md fully.
Read all files created in Steps 4-7.
DESIGN REFERENCE: mail-orders-mockup-v3.html — match exactly.

Create: app/mail-orders/mail-orders-table.tsx

'use client' component. Props:
```typescript
interface Props {
  groupedOrders: Record<string, MoOrder[]>   // slot → orders
  flaggedIds: Set<number>
  expandedId: number | null
  onFlag: (id: number) => void
  onExpand: (id: number | null) => void
  onPunch: (id: number) => Promise<void>
  onCopy: (id: number, lines: MoOrderLine[]) => void
  copiedId: number | null   // shows "Copied ✓" state for 2s
}
```

**Table structure:**
Outer: border border-gray-200 rounded-lg overflow-hidden bg-white
Table: width 100%, border-collapse collapse, table-layout fixed

**Column widths (colgroup):**
- Time:     72px
- SO Name:  130px
- Customer: flex (auto)
- Lines:    70px
- Remarks:  220px
- OD/CI:    80px
- Copy:     118px
- Status:   106px

**Column headers (thead):**
- Height 34px, bg-white, border-bottom border-gray-200 (not gray-100 — make it visible)
- font-size 10px, font-medium, uppercase, tracking-wider, text-gray-400
- Padding 0 14px

**Section header rows (between slot groups):**
- bg-gray-50, border-top + border-bottom border-gray-200
- Height 36px, padding 0 18px
- Left: colored dot (amber=Morning, blue=Afternoon, purple=Evening, gray=Night) + slot name font-semibold text-gray-700 + order count text-gray-400
- Right: matchedLines/totalLines for that slot

**Data rows:**
- Height 52px (match TM table)
- border-bottom border-gray-100 (subtle between rows)
- hover: bg-gray-50/50
- Padding 0 14px per cell

**Cell content per column:**

TIME:
  font-mono text-[12px] font-semibold text-gray-900
  Show HH:MM from receivedAt (formatTime utility)

SO NAME:
  text-[11px] text-gray-500 (secondary — muted intentionally)

CUSTOMER / SUBJECT:
  Customer name: text-[12.5px] font-semibold text-gray-900
  Subject snippet: text-[11px] text-gray-400 ml-1.5 truncate
  OD/CI badge inline: bg-red-50 text-red-600 border-red-200 text-[10px] font-semibold rounded px-1.5 py-0.5

LINES:
  text-center
  All matched: text-[12px] font-semibold text-green-600
  Has unmatched: text-[12px] font-semibold text-amber-600
    → clicking the count triggers expand (onExpand)
    → show small chevron icon before count when has unmatched

REMARKS:
  deliveryRemarks + billRemarks truncated, text-[11px] text-gray-400
  If OD/CI flagged: show remarks in text-red-400 instead
  If punched: show "✓ Punched by {name} · {time}"

OD/CI:
  If not flagged: <button> "⚑ Flag" — border-gray-200 text-gray-400, hover: border-red-300 text-red-500
  If flagged: <button> "⚑ Flagged" — bg-red-50 border-red-300 text-red-600
  If punched: show "—"
  Clicking toggles flaggedIds via onFlag(id)

COPY:
  If 0 matched lines: disabled gray
  If flagged (OD/CI): disabled gray
  If punched: disabled gray
  If copied (copiedId === id): green "Copied ✓" state (bg-green-50 border-green-200 text-green-700)
  Otherwise: "Copy N" where N = matched line count
  On click: onCopy(id, lines) — parent handles clipboard + copiedId state

STATUS:
  If punched: green badge "Done" (bg-green-50 border-green-200 text-green-700, checkmark icon)
  If flagged: disabled btn-punch (gray, cursor-not-allowed)
  Otherwise: "Punched" button — border-gray-200 text-gray-600
    On click: calls onPunch(id) → optimistic update

**OD/CI row treatment:**
  border-left: 3px solid #f87171 on the TR
  First TD padding-left: 11px to compensate

**Punched row:**
  opacity-50 on the TR
  Copy disabled, Status shows Done badge

**Expanded sub-row:**
  Rendered as a <tr> immediately after the data row when expandedId === id
  Full colspan=8
  Contains:
  1. Line items table (see below)
  2. Remarks footer

Line items table columns:
  # (38px) | Raw Text (flex) | SKU Code (150px) | Pk (48px center) | Qty (52px right) | Status (76px center)

  Matched rows: ✓ in text-green-600 font-semibold text-[13px]
  Unmatched rows: bg-amber-50/40, "⚠ Fix" button (amber border, text-amber-600)
  Row height: 36px, padding 9px 14px
  Header: bg-gray-50, 10px uppercase, text-gray-400

Remarks footer (below line table):
  bg-gray-50/80, border-top border-gray-100
  Grid: 3 equal cols + 1 right-aligned col (160px)
  Cols: Delivery Remarks | Body Remarks | Bill Remarks | Received (datetime, right)
  Label: 9.5px uppercase tracking font-bold text-gray-400
  Value: 11.5px text-gray-600

Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 9 — Wire copy + punch + flag logic into page
## Model: Sonnet

────────────────────────────────────────────────────────────────
Read all files created so far.

Update mail-orders-page.tsx to implement the action handlers
that were placeholders in Step 7.

**onCopy handler:**
```typescript
const [copiedId, setCopiedId] = useState<number | null>(null)

async function handleCopy(id: number, lines: MoOrderLine[]) {
  const text = buildClipboardText(lines)
  await navigator.clipboard.writeText(text)
  setCopiedId(id)
  setTimeout(() => setCopiedId(null), 2000)
}
```

**onPunch handler (optimistic update):**
```typescript
async function handlePunch(id: number) {
  // Optimistic: update local state immediately
  setOrders(prev => prev.map(o =>
    o.id === id
      ? { ...o, status: 'punched', punchedAt: new Date().toISOString() }
      : o
  ))
  try {
    await punchOrder(id)
  } catch {
    // Revert on failure — re-fetch
    fetchMailOrders().then(data => setOrders(data.orders))
  }
}
```

**onFlag handler (local only — not persisted to DB in v43):**
```typescript
function handleFlag(id: number) {
  setFlaggedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
}
```

**onExpand handler:**
```typescript
function handleExpand(id: number | null) {
  setExpandedId(prev => prev === id ? null : id)
}
```

Pass copiedId to MailOrdersTable as a prop.

Also wire the search filter:
- searchQuery state (string)
- filteredOrders = orders filtered by searchQuery matching
  soName, customerName, or subject (case-insensitive)
- Pass filteredOrders to groupOrdersBySlot

Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 10 — Keyboard shortcuts
## Model: Sonnet

────────────────────────────────────────────────────────────────
Read mail-orders-page.tsx and mail-orders-table.tsx.

Add keyboard navigation to mail-orders-page.tsx.

**Focused row state:**
- focusedId: number | null (which row is keyboard-focused)
- Initialize to first pending order's id on load

**Key bindings (useEffect with keydown listener):**

ArrowDown / j → move focusedId to next order in current filtered list
ArrowUp / k   → move focusedId to previous order
Enter         → toggle expand for focusedId (handleExpand)
c / C         → copy focusedId's matched lines (handleCopy)
d / D         → punch focusedId (handlePunch) — only if not flagged

**Guard:** Only fire if no input/textarea is focused
  (check document.activeElement?.tagName)

**Focused row visual:**
Pass focusedId to MailOrdersTable.
In the table, focused row gets: background #f0fdfa (teal-50) on all TDs.
This is the keyboard cursor — not teal border, just subtle bg wash.

**Shortcuts tooltip:**
Clicking the "Shortcuts" button in Row 1 toggles a small panel:
- Positioned absolute below the button (not fixed)
- White bg, border-gray-200, rounded-lg, shadow-lg, p-3, w-[196px]
- Shows the 5 shortcuts in the same style as the mockup

Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 11 — Resolve unmatched flow (⚠ Fix inline panel)
## Model: Opus

────────────────────────────────────────────────────────────────
Read CLAUDE_CONTEXT_v42.md §57 (resolve API endpoint) fully.
Read all existing mail-orders files.

Create: app/mail-orders/resolve-line-panel.tsx

This is an inline panel that appears when operator clicks "⚠ Fix"
on an unmatched line. It replaces the line's table row with an
expanded inline form — no modal.

**Props:**
```typescript
interface Props {
  line: MoOrderLine
  onResolved: (lineId: number, skuCode: string) => void
  onCancel: () => void
}
```

**Panel layout (replaces the unmatched TR):**
- Full colspan row, bg-amber-50/30, border-amber-100
- Left side: raw text + pack code (read-only context)
- Right side: SKU search input + dropdown + "Save keyword" checkbox + Save/Cancel buttons

**SKU search behaviour:**
- Input: text field, placeholder "Search SKU or description…"
- On input change (debounced 300ms): call searchSkus(q)
- Results dropdown: material code + description + pack code
  shown as list items (max 8 results, scrollable)
- Select item → fills skuCode state
- "Save keyword" checkbox (default checked):
  "Learn this match for future auto-enrichment"

**Save button:**
- Calls resolveLine(line.id, skuCode, saveKeyword)
- Optimistic: calls onResolved(line.id, skuCode) immediately
- Shows loading state during API call

In mail-orders-table.tsx:
- Add resolveLineId: number | null state
- When ⚠ Fix clicked → set resolveLineId to that line's id
- Render <ResolveLinePanel> instead of the normal unmatched TR
- onResolved: update the line in local orders state to show matched + SKU code
- onCancel: clear resolveLineId

Run: npx tsc --noEmit
────────────────────────────────────────────────────────────────

---

## STEP 12 — Final checks + production deploy
## Model: Sonnet

────────────────────────────────────────────────────────────────
Read all mail-orders files created in Steps 4-11.

Do the following checks and fixes:

1. **Route protection:** Confirm /mail-orders is protected by middleware
   (requires auth). billing_operator and tint_manager should be able
   to access. All other roles should redirect to their home route.
   Check middleware.ts — add /mail-orders to the protected routes list
   if not already there.

2. **Empty state:** If orders array is empty after fetch, show:
   "No mail orders received today. Orders appear here automatically
   as emails arrive." — centered, text-gray-400, text-[13px].

3. **Loading state:** While fetching, show a simple skeleton:
   3 rows of gray placeholder bars (animate-pulse), same height as
   data rows (52px). No spinner.

4. **Error state:** If fetch fails, show:
   "Could not load orders. Retrying…" — and retry every 30s.

5. **TSC final check:** Run npx tsc --noEmit — must pass with 0 errors.

6. **Git commit:**
   git add -A
   git commit -m "feat: mail-orders frontend — billing_operator role, table view, copy/punch/flag/resolve"
   git push

7. **Verify on production (orbitoms.in):**
   - Login as deepanshu@orbitoms.in → redirects to /mail-orders ✓
   - Table shows today's orders ✓
   - Copy button copies SKU+Qty to clipboard ✓
   - Punched button marks order done ✓
   - TM login → Mail Orders appears in sidebar ✓

Report any failures before closing the session.
────────────────────────────────────────────────────────────────

---

## EXECUTION ORDER SUMMARY

| Step | What | Model | Gate |
|------|------|-------|------|
| 1 | DB: role + users + permissions | Sonnet (SQL only) | Verify SQL output |
| 2 | Sidebar nav links | Sonnet | TSC pass |
| 3 | Post-login redirect | Sonnet | TSC pass |
| 4 | TypeScript types | Sonnet | TSC pass |
| 5 | API client helpers | Sonnet | TSC pass |
| 6 | Utility functions | Sonnet | TSC pass |
| 7 | Page shell + header | Opus | TSC pass |
| 8 | Table component | Opus | TSC pass |
| 9 | Copy/punch/flag wiring | Sonnet | TSC pass |
| 10 | Keyboard shortcuts | Sonnet | TSC pass |
| 11 | Resolve unmatched panel | Opus | TSC pass |
| 12 | Final checks + deploy | Sonnet | Live verify |

Total: 12 steps. Steps 1-6 are fast (Sonnet, targeted).
Steps 7, 8, 11 are the heavy lifts (Opus).

One prompt at a time. Do not batch.
