# Context Update v63

## NEW/MODIFIED FILES

- `app/(mail-orders)/mail-orders/review-view.tsx` — **NEW** — Review View component. Master-detail split panel for SKU confirmation workflow. 320px left panel (order list) + right panel (detail header, SKU table, remarks footer, nav footer). ~900 lines.
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — **MODIFIED** — viewMode widened to `"table" | "review" | "focus"`. Three-button toggle. Review renders outside padded wrapper (full-bleed split). Ctrl+C/V and single-key keyboard handlers extended to review mode. ↑↓ skipped in review mode (owned by review-view). `/` focuses left panel filter in review mode. ColumnPicker hidden in review mode.

## BUSINESS RULES ADDED

**Review View** is a third view mode for /mail-orders alongside Table and Focus. Toggle: `Table | Review | Focus` in header title. Design locked.

**Layout:** 320px left panel (order list, earliest-first sort) + flex-1 right panel (detail header 2 rows, SKU table, remarks footer, nav footer).

**Left panel:** Search input, order rows (delivery dot + customer name + time / SO name). Punched orders behind collapsible "▸ N punched" divider. Row states: selected (teal-50 + teal left border), flagged (amber left border), punched (opacity 0.4).

**Detail header Row 1:** Delivery dot (6px) → Customer name (17px bold) → Code chip (exact/multiple/unmatched — reuses CodeCell picker pattern) → Match chip (green/amber) → Dispatch badge → Signal badges → Order No. input group (label + 120px mono input + Punch button). Punched state: ✓ + SO number + edit icon + "Punched" label.

**Detail header Row 2:** Meta (SO name · time · area · delivery type · volume · lines) → 3 icon-only action buttons (28×28, Copy/Reply/Flag, no text labels).

**SKU table:** `table-layout: fixed` with `<colgroup>` percentages: 4/24/11/26/5.5/5.5/5.5/12/6.5%. Header 32px, data rows 36px, 14px cell padding, borders #ebebeb/#f0f0f0. Four row states: normal, partial (amber + PARTIAL tag), not-found (gray-300 text, reason label in Status), unmatched (italic "No match found" + UNMATCHED tag + "Resolve →" link).

**Found/not-found toggle:** 28×14px, green-600 ON / gray-300 OFF, 10×10px white knob. Toggle OFF → reason dropdown (148px, numbered 1-5: out_of_stock, wrong_pack, discontinued, other_depot, other). API: `saveLineStatus()` expects snake_case reason values.

**Active line highlight:** Yellow-50 bg (`#fefce8`) + yellow-500 left border (`#eab308`) on first cell. No outline.

**Line status overrides:** Local `Map<lineId, {found, reason}>` for optimistic UI. Resolved line overrides: `Map<lineId, {skuCode, skuDescription, productName, baseColour, packCode, matchStatus}>`. Both reset on order change.

**Resolve popover:** Fixed-position 480px modal. Search input (debounced 300ms) + pack filter chips (1L/4L/10L/20L) + results list. Calls `searchSkus()` + `resolveLine()`. Updates local resolved overrides.

**Remarks footer:** Sticky, bg-gray-50. 4 columns: Delivery / Bill / Notes / Received (60px fixed).

**Nav footer:** 36px, ← Prev / "N of M" / Next → buttons. Keyboard hints text.

**Review mode keyboard:**

| Key | Action |
|---|---|
| ↑↓ | Navigate SKU lines (active line highlight) |
| Tab / Shift+Tab | Next / previous order |
| Space | Toggle found/not-found on active line |
| 1-5 | Quick-pick reason (when dropdown open) |
| Ctrl+C | Smart copy (code → SKUs) |
| Ctrl+V | Auto-focus Order No. input (falls back to `input[placeholder="Enter number"]`) |
| R | Reply (when punched) |
| F | Flag |
| N | Next unmatched order |
| T | Toggle punched visibility |
| E | Slot email modal |
| Esc | Close dropdown → close popover → cascade |

**Auto-advance:** After punch + 8s grace period, auto-focuses next pending order.

**Sort order:** Left panel orders sorted ascending by receivedAt (earliest first). NavigationList matches visible left panel order.

## PENDING ITEMS

1. **SO name "(jsw)" prefix** — `cleanSubject` should strip "(jsw)" but still showing in left panel and meta row. Cosmetic.
2. **SKU code "IN" prefix** — some codes show without "IN" prefix (e.g. `5948786` instead of `IN5948786`). Data issue, not rendering.
3. **Remark type badges in Notes footer** — currently shows raw text joined. Could add colored type badges like expanded footer in table view.
4. **Customer picker popover polish** — multiple/unmatched picker works but could be refined for edge cases.

## CHECKLIST UPDATES

- **Review View:** `review-view.tsx`. Third view mode. viewMode = `"table" | "review" | "focus"`. ↑↓ = lines, Tab = orders, Space = toggle.
- **Review mode keyboard ownership:** ↑↓ handled by review-view.tsx (parent skips). Ctrl+C/V handled by parent. Tab/Space/1-5 handled by review-view.tsx.
- **saveLineStatus API:** Expects snake_case reason values (out_of_stock, wrong_pack, discontinued, other_depot, other). NOT display labels.
- **Active line state:** `activeLineIndex` resets to 0 on order change. Yellow-50 bg + yellow-500 left border.
