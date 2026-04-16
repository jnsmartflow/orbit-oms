================================================================
CONTEXT UPDATE — v52 → v53
================================================================

Add these to CLAUDE_CONTEXT_v53.md:

================================================================
## 65. Session v53 Changes (NEW — April 2026)
================================================================

### Mail Order Frontend Redesign — Pure UI Session

Complete redesign of the Mail Orders page around Deepanshu's
daily billing workflow. No schema changes except isLocked.

### Changes Summary

**1. Footer Remark Deduplication**
ORDER NOTES column now filters out remarkType "delivery" and
"billing" — those show in their dedicated columns only. No
duplication.

**2. Reply Template System**
- `buildReplyTemplate()` in utils.ts — generates professional
  email reply templates with aligned label:value format
- `getOrderFlags()` in utils.ts — extracts OD/CI/Bounce/Hold
  flags from order remarks
- Single order template: aligned Customer/Code/Area/SO No.
  fields + JSW Dulux Ltd signature
- Multi order template: numbered list with customer + code +
  area on line 1, SO number on line 2. Clean/flagged sections
  separated.
- `cleanSubject()` moved from mail-orders-table.tsx to utils.ts
  (shared export)

**3. R Key Quick Reply**
Press R on focused punched row → copies single-order reply
template to clipboard instantly. Toast confirms. Only works
on punched orders with SO number.

**4. SO Summary Panel**
Right slide-out panel (so-summary-panel.tsx). Groups all
orders by SO name. Features:
- SO name filter (search input at top)
- Checkboxes per order (punched checked by default)
- "SO Nos." button — copies SO numbers for SAP
- "Reply" button — copies email template
- One-click copy (no preview Copy button needed)
- Keyboard nav: A opens, ↑↓ navigate groups, W=SO nos,
  R=reply, Esc=close
- Focused group highlight with teal ring

**5. Global Search (19 fields)**
Search expanded to cover all data: soName, soEmail,
customerName, customerCode, subject, soNumber, remarks,
billRemarks, deliveryRemarks, customerArea, customerRoute,
splitLabel, punchedBy.name, line.rawText, line.skuCode,
line.skuDescription, line.productName, line.baseColour,
remarks_list.rawText.

**6. Filters**
Added Priority (Urgent/Normal) and Lock (Locked/Unlocked)
filter groups. Lock filter uses isOdCiFlagged() + isLocked DB
field.

**7. Resolve Panel Smart Search**
- Auto-populates search from rawText on panel open
- Shows detected context (product, base, pack, qty)
- Pack filter chip (teal when active, defaults ON)
- Pack-matching results shown first with teal indicator
- API accepts optional pack parameter for ranking

**8. Column Visibility Toggle**
- ALL_COLUMNS config exported from mail-orders-table.tsx
- 4 always-visible: Time, Customer, SKU, SO No.
- 8 toggleable with localStorage persistence
- "Columns" button in header rightExtra
- Hidden column width redistributed to Customer column
- Dispatch column defaultVisible: false

**9. Fix Propagation**
- SKU: resolving one line auto-resolves siblings with same
  rawText + packCode in same order (backend + frontend)
- Customer: saving customer on split order A propagates to
  sibling B (same emailEntryId)

**10. Keyboard Shortcuts Redesign**
Q=code, W=SKUs, E=focus SO input, R=reply, F=flag/lock,
A=SO Summary, /=search, N=next unmatched (auto-expand),
P=pick customer, T=toggle punched, ←→=navigate (focus mode),
↑↓=navigate orders, Enter=expand, Esc=cascading close
(modal→panel→popover→blur input→collapse).
Removed: C, S, j, k.

**11. 3-Tier Badge System**
- Blocker (red): OD, CI, Bounce
- Attention (amber): Bill Tomorrow, Cross, Ship-to, Urgent
- Info (gray): Truck, Challan, DPL, Bill N, 7 Days, Extension
- Split (purple): ✂ A/B, ⚠ Split
- Dot pattern: ⚠ Split gets amber dot on gray badge
- Hold removed from remarks (dispatch column only)
- Emojis removed from Challan/Truck badges

**12. Dispatch Column Simplified**
Shows original colored badges (Hold=red, Urgent=amber,
Dispatch=green). defaultVisible: false — hidden by default
for billing operators.

**13. UI Polish**
- Focused row: bg-amber-50/70 (was /40)
- Volume moved from Customer subtext to Lines column
- Customer subtext: area + route only (volume removed)
- Lines column width: 56→68px, Customer: 220→208px
- Avatar (18px teal circle, initials) in Punched By column

**14. Stats**
Header: orders · punched · pending (3 numbers only).
Slot headers: volume + punched progress (lines count removed).
All stats from full day (orders), not filteredOrders.

**15. Punched Orders Collapsed**
- Pending orders on top, punched sink to bottom per slot
- "N punched ▸/▾" divider with teal count badge (clickable)
- Punched rows: same OrderRow, same columns, opacity 0.5
- Sort: latest punched first
- punchedSection prop on OrderRow for dimming
- Default: collapsed (hidden). T key toggles globally.
- separatePunched prop: only separates when slot is selected.
  No slot = old mixed style.

**16. Auto-Refresh**
- Polling: 60s→30s
- Tab focus refresh via visibilitychange listener

**17. Lock Persistence**
- isLocked Boolean on mo_orders (DB)
- PATCH /api/mail-orders/[id]/lock endpoint
- toggleLock() in api.ts
- Local flaggedIds replaced with DB-backed state
- Both operators see same locks

**18. Punch Grace Period**
- recentlyPunchedIds Set with 8s timeout
- Recently punched orders stay in pending section during grace
- Allows R key reply copy before order sinks to bottom

**19. Slot Completion Modal**
- Auto-detects when all orders in a slot are punched
- Modal: green check, slot stats, SO list with SAP + Reply
- "Copy All SAP" footer button
- "Next Slot" button to continue
- Auto/Manual toggle in header (Auto default)
- Dismissed per slot per session, resets on date change
- Re-triggers if new orders arrive and all punched again

### Schema Change (v26 → v26.1)
```sql
ALTER TABLE mo_orders ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
```
Prisma schema updated. No version bump (minor addition).

### Files Created
- so-summary-panel.tsx
- slot-completion-modal.tsx
- app/api/mail-orders/[id]/lock/route.ts

### Files Modified
- mail-orders-page.tsx (major — all features wired)
- mail-orders-table.tsx (major — badges, columns, punched collapse)
- lib/mail-orders/utils.ts (template functions, cleanSubject moved)
- lib/mail-orders/api.ts (toggleLock, searchSkus pack param)
- lib/mail-orders/types.ts (isLocked field)
- resolve-line-panel.tsx (smart search)
- app/api/mail-orders/skus/route.ts (pack param)
- app/api/mail-orders/lines/[lineId]/resolve/route.ts (propagation)
- app/api/mail-orders/[id]/customer/route.ts (propagation)
- prisma/schema.prisma (isLocked)

================================================================
## Update Session Start Checklist (add to §55)
================================================================

48. **Mail Order keyboard shortcuts (v53):** Q=code, W=SKUs,
    E=SO input, R=reply, F=flag, A=SO Summary, /=search,
    N=next unmatched, P=pick, T=toggle punched, Esc=cascade.
    Old C/S/j/k removed.
49. **Mail Order 3-tier badges (v53):** blocker(red),
    attention(amber), info(gray), split(purple). Hold removed
    from remarks. Dot pattern for ⚠ Split.
50. **Mail Order column toggle (v53):** ALL_COLUMNS in
    mail-orders-table.tsx. localStorage "mo-column-visibility".
    Dispatch defaultVisible:false.
51. **Mail Order lock persistence (v53):** isLocked on
    mo_orders. PATCH /api/mail-orders/[id]/lock. No more
    local flaggedIds state.
52. **Mail Order SO Summary (v53):** so-summary-panel.tsx.
    Right slide-out. A key opens. Filter + checkboxes + copy.
53. **Mail Order slot completion (v53):** slot-completion-modal.tsx.
    Auto-popup when slot 100% punched. Auto/Manual toggle.
54. **Mail Order Focus Mode:** NOT YET BUILT. Design approved.
    Single card view for speed punching. See next session.

================================================================
