================================================================
CONTEXT UPDATE — v53 → v54
================================================================

Add these to CLAUDE_CONTEXT_v54.md:

================================================================
## 66. Session v54 Changes (NEW — April 2026)
================================================================

### Focus Mode + SKU Line Status — Full Build Session

Built Focus Mode end-to-end for Deepanshu's speed punching
workflow. Added SKU line status tracking (found/not-found)
with schema, API, and UI. Redesigned header. Multiple
iteration rounds on card layout, progress bar, navigation,
and SKU panel design.

================================================================
### Schema Change (v26.1 → v26.2)
================================================================

New table created via Supabase SQL Editor:

```sql
CREATE TABLE mo_line_status (
  id SERIAL PRIMARY KEY,
  "lineId" INTEGER NOT NULL UNIQUE REFERENCES mo_order_lines(id) ON DELETE CASCADE,
  "found" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "altSkuCode" TEXT,
  "altSkuDescription" TEXT,
  "note" TEXT,
  "updatedBy" INTEGER REFERENCES users(id),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX idx_line_status_line ON mo_line_status("lineId");
```

Prisma schema updated manually (prisma db pull fails — port
5432 blocked by ISP). Model added by hand + `npx prisma generate`.

Relations:
- mo_line_status → mo_order_lines: 1:1 via lineId (UNIQUE)
- mo_line_status → users: many:1 via updatedBy
- mo_order_lines has `lineStatus mo_line_status?` reverse relation
- users has `lineStatuses mo_line_status[]` reverse relation

Reason values (not DB-enforced, validated in API):
'out_of_stock', 'wrong_pack', 'discontinued', 'other_depot', 'other'

================================================================
### 1. Focus Mode View (focus-mode-view.tsx)
================================================================

**Component:** `FocusModeView` — single card per order view.

**Props received from mail-orders-page.tsx:**
```typescript
interface FocusModeViewProps {
  orders: MoOrder[];
  activeSlot: string | null;
  flaggedIds: Set<number>;
  onFlag: (id: number) => void;
  onSaveSoNumber: (orderId: number, value: string) => Promise<boolean>;
  onCopy: (id: number, lines: MoOrderLine[], batchIndex?: number) => void;
  batchStates: Record<number, number>;
  onAdvanceBatch: (orderId: number) => void;
}
```

**Queue logic:**
- Builds from orders filtered by activeSlot
- Pending first (receivedAt ASC), punched last (punchedAt DESC)
- currentIndex state tracks position in queue
- Queue re-sorts when parent updates order status (e.g. after punch)

**Card layout (top to bottom):**
1. Identity: SO name (11px gray) + time (10px gray)
2. Customer name: text-xl font-bold + delivery dot + flag icon
3. Meta: code chip (mono bg-gray-100) · area · delivery type · volume · lines
4. Signal badges (same 3-tier system as table view)
5. Copy buttons: Q (Copy code) + W (Copy SKUs) — grid-cols-2
6. SO input: h-44, mono text-lg, placeholder "SO number (E to focus)"
7. Action button: "Enter SO number first" (dimmed) or "Save SO & punch" (teal)
8. SKU summary row: "✓ N SKU lines" or "⚠ N SKU lines · M not found" + S shortcut badge + chevron

**Card states:**
- Active (pending): normal card, all actions enabled
- Flagged: amber border + amber accent bar + flag icon (F key toggles, still punchable)
- Just Done (8s grace): teal border, "Done" badge, R button primary, countdown, auto-advance
- Punched (browsing back): SO number visible in meta, R button enabled, SO input disabled

**Card sizing:** max-w-2xl (672px), rounded-xl, padding 20-24px. Card sits at top of content area, no vertical centering, no empty void.

**Slide animation:** 150ms ease-out translateX(±40px) + opacity fade on card change. Direction-aware (left for forward, right for backward). All shortcuts blocked during animation.

**No expanded SKU lines in card.** SKU details live entirely in the right panel (see §6).

================================================================
### 2. Navigation
================================================================

**Inline nav below card (not floating/fixed):**
- flex items-center justify-center gap-4 py-4
- ← Prev button | "N of M" text | Next → button
- Buttons: text-xs, px-3.5 py-2, rounded-lg, border
- Disabled: text-gray-300 border-gray-100
- Active: text-gray-600 border-gray-200 bg-white hover:bg-gray-50

**Keyboard navigation:**
- ←/→ or ↑/↓: navigate between orders (animated)
- N: jump to next unmatched (pending + matchedLines < totalLines)
- F: toggle flag on current order
- L: open order list popover
- S: open SKU panel (list view)
- Escape: cascading close (detail panel → list panel → order list → blur)

**Order list popover (L key):**
- Dropdown from List button in progress strip
- Shows all orders: status dot (green/gray/amber) + customer name + SO number
- Keyboard navigable: ↑/↓ move highlight, Enter selects, L/Esc closes
- Highlighted item gets bg-teal-50, scrolls into view

**Auto-advance after punch:**
- 8-second grace period with countdown
- R button becomes primary CTA during grace ("Copy reply & go next")
- "Go now →" link to skip countdown
- After 8s or R press → advances to next pending order

================================================================
### 3. Grace Period Fix (justDoneIdRef)
================================================================

**Problem:** When parent updates order status to "punched",
the queue re-sorts (punched moves to end). currentIndex
points to a different order. Grace period card disappears.

**Fix:** justDoneIdRef (useRef) tracks the done order ID
independently of queue position.

```typescript
const justDoneIdRef = useRef<number | null>(null);
```

- Set alongside setJustDoneId in handleSoSubmit
- useEffect watches queue changes: if justDoneIdRef is set,
  finds the done order's new position and re-pins currentIndex
- ALL setJustDoneId(null) sites also clear justDoneIdRef.current
- ALL setJustDoneId(id) sites also set justDoneIdRef.current
- advanceToNextPending searches from beginning if nothing
  found after current position (handles wrap-around)

================================================================
### 4. Progress Bar
================================================================

**Single smart bar** replaces both dot strip (≤20 orders)
and segment bar (>20 orders). All queue sizes use the same bar.

```
Container: flex-1 h-1.5 bg-gray-200 rounded-full relative
Green fill: absolute inset-y-0 left-0 bg-green-400 rounded-full
  width = (punchedCount / totalCount * 100)%
Teal dot: absolute top-50% bg-teal-500 w-2.5 h-2.5 ring-2 ring-white
  left = clamp(5px, currentIndex%, calc(100% - 5px))
  transform: translate(-50%, -50%)
```

**No overflow-hidden** on container (would clip the dot).
Clamp prevents dot from going off edges.

**Text row above:** "N/M" (left) + "N done" (center-right) + List button (right)

================================================================
### 5. SKU Line Status — Types + API
================================================================

**Types (lib/mail-orders/types.ts):**

```typescript
export interface LineStatus {
  found: boolean;
  reason: string | null;
  altSkuCode: string | null;
  altSkuDescription: string | null;
  note: string | null;
}

export const LINE_STATUS_REASONS = [
  { value: "out_of_stock", label: "Out of stock" },
  { value: "wrong_pack", label: "Wrong pack" },
  { value: "discontinued", label: "Discontinued" },
  { value: "other_depot", label: "Other depot" },
  { value: "other", label: "Other" },
] as const;

export type LineStatusReason = typeof LINE_STATUS_REASONS[number]["value"];
```

lineStatus field added to MoOrderLine interface:
```typescript
lineStatus?: LineStatus | null;
```

**API endpoint:**
```
PATCH /api/mail-orders/lines/[lineId]/status
Body: { found, reason?, altSkuCode?, altSkuDescription?, note? }
Response: { success: true, lineStatus: { ... } }
```
- Auth required (session check)
- Validates reason against allowed values
- Upserts mo_line_status (prisma.mo_line_status.upsert)
- If found=true: clears reason/alt/note (sets to null)
- Sets updatedBy = session.user.id, updatedAt = now()

**GET /api/mail-orders** updated to include lineStatus:
```typescript
lines: {
  include: {
    lineStatus: {
      select: { found, reason, altSkuCode, altSkuDescription, note }
    }
  }
}
```

**Client function (lib/mail-orders/api.ts):**
```typescript
export async function saveLineStatus(lineId, data): Promise<{ success: boolean }>
```

================================================================
### 6. SKU Line Status — UI (Right Panel)
================================================================

**Trigger:** S key or click SKU summary row in card.

**activeLineId state (three modes):**
- `null` = panel closed
- `-1` = list view (all lines)
- `> 0` = detail view (specific line ID)

**List view (activeLineId === -1):**
- Right panel: fixed inset-0, backdrop bg-black/10, panel w-[360px]
- Header: "SKU LINES (N)" + × close button
- Each line row:
  - Toggle switch (28×16px): green=found, red=not found
  - rawText as primary name (12px font-medium)
  - Subtitle: skuCode (mono) or "unmatched" (amber badge) · pack · ×qty
  - Reason badge (red) + ALT badge (teal) if not found
  - Chevron → opens detail view
- Toggle click: calls handleQuickToggle (saves immediately)
- Row/chevron click: sets activeLineId to line.id
- Summary footer: "N found · M not found"

**handleQuickToggle logic:**
```typescript
- Toggle off (not found): auto-sets reason to "out_of_stock"
- Toggle on (found): clears reason, altSkuCode, altSkuDescription, note
- Optimistic update → API call → revert on error
```

**Detail view (activeLineId > 0):**
- Uses LineStatusPanel component (line-status-panel.tsx)
- Right panel: w-[360px], border-l-3px teal
- "← All lines" back button at top (goes to list, not close)
- Header: rawText (15px), SKU · pack × qty
- Status toggle: full-width rounded-lg button
  - Found: bg-green-50, green check icon, "Found in SAP"
  - Not found: bg-red-50, red × icon, "Not found in SAP"
  - "Tap to mark as found/not found" hint
- Reason chips: grid-cols-2, single select
  - Active: border-red-400 bg-red-50 text-red-700
  - "Other" spans 2 columns
- Alternate SKU search: debounced 300ms, reuses searchSkus()
  - Results: max 4, mono code + desc + pack
  - Selected: teal border, ALT badge, "Change" link
- Note input
- Found + no changes: single "Close" button
- Not found or changes: "Cancel" + "Save" buttons
- Escape calls onCancel (goes back to list)

**Null handling in line rows:**
- rawText always shown as primary name (never skuCode)
- No skuCode → "unmatched" amber badge (not "—")
- No packCode → skip entirely (not "—")
- Quantity always shown as "×N"

**W copy respects lineStatuses:**
```typescript
const matched = currentOrder.lines.filter((l) => {
  if (l.matchStatus !== "matched" || !l.skuCode) return false;
  const status = lineStatuses[l.id];
  if (status && !status.found) return false;
  return true;
});
```

**R reply template includes not-found section:**
```
SO No.   : 42001894 (3 of 4 lines)

Not available:
- Weathercoat Adv 92 Base 10L × 5
  Reason: Out of stock
  Alt: 4821455 Weathercoat Adv 92 Base 20L
  Note: Only 20L available, adjusted qty
```

================================================================
### 7. Header Redesign
================================================================

**UniversalHeader change:**
- components/universal-header.tsx: title prop type changed
  from `string` to `React.ReactNode`
- No other changes to the shared component
- All other pages pass string titles — string is valid ReactNode

**mail-orders-page.tsx header props:**

Title area (row 1):
```tsx
title={
  <div className="flex items-center gap-2.5">
    <span>Mail Orders</span>
    {/* Table/Focus toggle */}
    <div className="flex border border-gray-300 rounded-[5px] overflow-hidden">
      <button className={viewMode === "table" ? "bg-gray-800 text-white" : "bg-white text-gray-500"}>
        Table
      </button>
      <button className={viewMode === "focus" ? "bg-gray-800 text-white" : "bg-white text-gray-500"}>
        Focus
      </button>
    </div>
    {/* % badge */}
    <span className="w-px h-[18px] bg-gray-200" />
    <span className={punchPct >= 50 ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}>
      {punchPct}% punched
    </span>
  </div>
}
```

Toggle styling: gray-800 active (dark, navigation), NOT teal (teal = action).
Toggle size: text-[10px] px-2.5 py-[3px] font-medium.

Stats: simplified to totalOrders + punchedOrders count.

Slot completion checkmarks:
```typescript
const slotPunchStatus = useMemo(() => {
  // Returns Record<string, boolean> — true if all orders in slot are punched
}, [orders]);

// Segments:
{ label: slotPunchStatus.Morning ? "✓ Morning" : "Morning", count: ... }
```

Shortcuts updated: Q/W/E/R/F/N (removed old C/S/P).

Removed from header: SO Summary button, Auto toggle.
(SO Summary = A key shortcut, Auto = inside slot completion modal)

**Same header for both views.** Header does not change when
switching Table ↔ Focus. Only content area below changes.

================================================================
### 8. Conditional Rendering (Table vs Focus)
================================================================

mail-orders-page.tsx content area:
```typescript
const [viewMode, setViewMode] = useState<"table" | "focus">("table");

// In render:
{viewMode === "table" && <MailOrdersTable ... />}
{viewMode === "focus" && <FocusModeView ... />}
```

Table keyboard handler wrapped in:
```typescript
if (viewMode !== "table") return;
```
Prevents double-firing with Focus Mode's own handler.

Auto-select first slot with orders when switching to focus
mode with no slot selected.

================================================================
### Files Created
================================================================

- app/(main)/mail-orders/focus-mode-view.tsx
  (major — 1000+ lines, entire Focus Mode)
- app/(main)/mail-orders/line-status-panel.tsx
  (SKU line detail right panel component)
- app/api/mail-orders/lines/[lineId]/status/route.ts
  (PATCH endpoint for line status upsert)

### Files Modified

- app/(main)/mail-orders/mail-orders-page.tsx
  - viewMode state + toggle in title
  - stats with % badge
  - slot checkmarks (slotPunchStatus)
  - conditional render Table/Focus
  - table keyboard handler gated by viewMode
  - shortcuts updated Q/W/E/R/F/N
  - removed SO Summary + Auto from header
- components/universal-header.tsx
  - title: string → React.ReactNode
- lib/mail-orders/types.ts
  - LineStatus interface
  - LINE_STATUS_REASONS const
  - LineStatusReason type
  - lineStatus field on MoOrderLine
- lib/mail-orders/api.ts
  - saveLineStatus() function
- app/api/mail-orders/route.ts
  - GET includes lineStatus in lines query via Prisma include
- prisma/schema.prisma
  - mo_line_status model
  - Reverse relations on mo_order_lines and users

### Files NOT Modified

- mail-orders-table.tsx (table view untouched this session)
- lib/mail-orders/utils.ts (no changes)
- resolve-line-panel.tsx (no changes)
- Parse-MailOrders-v5.ps1 (no changes)
- Ingest route /api/mail-orders/ingest (no changes)
- so-summary-panel.tsx (no changes)
- slot-completion-modal.tsx (no changes)

================================================================
## Update CLAUDE_UI_v4_6.md → v4.7
================================================================

Add these new sections:

### §35. Focus Mode Card (NEW v4.7)

Card layout for single-order speed punching view:
- Container: max-w-2xl mx-auto
- Card: bg-white border border-gray-200 rounded-xl
- Padding: 20px 24px (roomy, not cramped)
- Customer name: text-xl font-bold text-gray-900
- Meta: text-[11px] text-gray-500
- Code chip: px-1.5 py-0.5 rounded bg-gray-100 font-mono text-[10px]
- Delivery dot: same colors as table view (§22)
- Signal badges: same 3-tier system (§32)
- Q/W buttons: grid-cols-2 gap-8, py-10, rounded-lg, border
  border-gray-200, text-xs font-semibold
- Key badges: w-5 h-5 rounded bg-gray-100 text-[10px] font-bold
- SO input: h-44, border-[1.5px] border-gray-200, rounded-lg,
  font-mono text-lg, focus:border-teal-500
  With value: border-teal-500 bg-teal-50/50
- Action button: w-full py-2.5 rounded-md text-sm font-semibold
  Dimmed: bg-gray-100 text-gray-400
  Active: bg-teal-600 text-white hover:bg-teal-700
- SKU summary row: border-t border-gray-100, flex justify-between,
  py-3 mt-3, cursor-pointer
  S shortcut badge: text-[9px] px-1.5 py-0.5 border rounded
- Card does NOT contain expanded SKU lines

Slide animation: transition transform 150ms ease-out, opacity 150ms
- Forward (→): translateX(-40px) + opacity 0.3
- Backward (←): translateX(40px) + opacity 0.3
- Settled: translateX(0) + opacity 1

### §36. Focus Mode Progress Bar (NEW v4.7)

Single bar for all queue sizes (replaces dot strip + segment bar):
- Container: flex-1 h-1.5 bg-gray-200 rounded-full relative
  NO overflow-hidden (would clip the dot)
- Green fill: absolute inset-y-0 left-0 bg-green-400 rounded-full
  width = (punchedCount / totalCount) * 100%
  transition-all duration-300
- Teal position dot: absolute bg-teal-500 w-2.5 h-2.5 rounded-full
  ring-2 ring-white
  left = clamp(5px, position%, calc(100% - 5px))
  top: 50%, transform: translate(-50%, -50%)
  transition-all duration-300

Text row: "N/M" left, "N done" center-right, "List L" button far right

### §37. Focus Mode Navigation (NEW v4.7)

Inline nav below card (normal flow, not fixed):
- Container: flex items-center justify-center gap-4 py-4 max-w-2xl mx-auto
- Prev/Next buttons: text-xs font-medium px-3.5 py-2 rounded-lg
  border transition-colors
  Disabled: text-gray-300 border-gray-100 cursor-default
  Active: text-gray-600 border-gray-200 bg-white hover:bg-gray-50
- Position text: text-xs text-gray-400 font-medium "N of M"

### §38. Focus Mode SKU Panel (NEW v4.7)

Right side panel with two views controlled by activeLineId:
- null = closed
- -1 = list view (all lines)
- >0 = detail view (specific line)

**List view panel:**
- Overlay: fixed inset-0 z-50 flex
- Backdrop: flex-1 bg-black/10, click to close
- Panel: w-[360px] bg-white border-l border-gray-200 h-full overflow-y-auto
- Header: "SKU LINES (N)" text-[10px] uppercase + × close button
- Line rows: flex items-center gap-2 py-2.5 px-2 rounded-lg mb-1
  Not found: bg-red-50 hover:bg-red-100
  Normal: hover:bg-gray-50
- Toggle: w-7 h-4 rounded-full, green-500 or red-500
  Dot: w-3 h-3 bg-white, left:0.5 (off) or left:[14px] (on)
- Line info: rawText (12px font-medium), subtitle (10px gray-400)
  Unmatched: amber badge instead of SKU code
  Not found: strikethrough, reason badge (red), ALT badge (teal)
- Summary: flex justify-between py-2 border-t text-[11px]

**Detail view:**
- Uses LineStatusPanel component
- ← All lines back button: text-[11px] text-teal-600 font-medium
- onCancel goes to -1 (list), not null (close)

### §39. Header — Table/Focus Toggle (NEW v4.7)

Toggle rendered inside UniversalHeader title (ReactNode):
- Container: border border-gray-300 rounded-[5px] overflow-hidden
- Buttons: text-[10px] px-2.5 py-[3px] font-medium
- Active: bg-gray-800 text-white (DARK — navigation, not teal)
- Inactive: bg-white text-gray-500 hover:bg-gray-50

% punched badge after separator:
- Separator: w-px h-[18px] bg-gray-200
- Badge: text-[10px] font-semibold px-1.5 py-0.5 rounded
  ≥50%: bg-green-50 text-green-600
  <50%: bg-amber-50 text-amber-600

Completed slot labels: "✓ Morning" prefix when all orders
in slot have status "punched".

================================================================
## Update Session Start Checklist (add to §55)
================================================================

55. **Focus Mode (v54):** focus-mode-view.tsx. Table/Focus
    toggle in header title (gray-800, not teal). S key opens
    SKU panel. Card max-w-2xl, inline nav below, slide anim.
    activeLineId: null=closed, -1=list, >0=detail.
56. **SKU Line Status (v54):** mo_line_status table (UNIQUE
    on lineId, CASCADE delete). PATCH /api/mail-orders/lines/
    [lineId]/status. LineStatus interface + LINE_STATUS_REASONS
    in types.ts. saveLineStatus() in api.ts.
57. **Focus Mode keyboard (v54):** Q=code, W=SKUs, E=SO input,
    R=reply, F=flag, N=next unmatched, S=SKU panel, L=order
    list, ←→↑↓=navigate, Esc=cascade close. All card shortcuts
    blocked when panel is open.
58. **Header (v54):** UniversalHeader title accepts ReactNode.
    Toggle gray-800 dark. Stats show N% badge. Completed slots
    ✓ prefix. Shortcuts Q/W/E/R/F/N. SO Summary + Auto removed
    from header.
59. **Progress bar (v54):** Single smart bar for all queue
    sizes. Green fill (punched %) + teal dot (current position
    with clamp). No dot strip. No segment bar.
60. **Grace period fix (v54):** justDoneIdRef pins currentIndex
    when queue re-sorts after punch. Cleared alongside
    setJustDoneId(null) everywhere.

================================================================
## Pending Items (carry forward to v55)
================================================================

### From v53 (still pending):
1. OBD date parsing — DD-MM-YYYY causes null obdEmailDate
2. CustomerMissingSheet styling not matching admin form
3. CustomerMissingSheet area/route dropdown 403 verify
4. Tinter code space-variant keywords (NO 1, BU 1, etc.)
5. Unicode × parser fix
6. paintType column on mo_sku_lookup
7. WhatsApp notification Option C
8. MIS override layer (mis_dispatch_overrides table)
9. Barcode/QR label printing
10. Sentry error monitoring (OneDrive EPERM issue)
11. Customer master coordinate enrichment

### From v54 (new pending):
12. **SKU panel keyboard shortcuts:** ↑↓ navigate lines in
    panel, -/+ toggle found/not-found, Enter open detail,
    1-5 select reason in detail view. Design approved, not
    yet built.
13. **Table view line status integration:** Wire LineStatusPanel
    into mail-orders-table.tsx expanded view. Add status icon
    per line row. (Implementation plan Prompt 5 — not run)
14. **buildReplyTemplate update in utils.ts:** Update shared
    buildReplyTemplate to accept lineStatuses and include
    "Not available" section. Currently reply template is
    built inline in focus-mode-view.tsx handleReplyAndNext.
    (Implementation plan Prompt 6 — not run)
15. **Slot completion in Focus Mode:** Wire slot-completion-modal
    to Focus Mode view. Currently only triggers in table view.
16. **Focus Mode search integration:** Make header search
    filter the Focus Mode queue (currently ignored).
17. **Focus Mode filter integration:** Make header filters
    (Status/Match/Dispatch) apply to Focus Mode queue.
18. **Next Slot button:** Wire onSlotChange prop in slot
    complete card to switch activeSlot from parent.
19. **SO input + action button on same row:** Discussed but
    not implemented. Would save vertical space in card.

================================================================
