# Context Update v74 — Review View overhaul, print, split reform, description toggle, bill rename
Session date: 2026-04-17
Target files: CLAUDE_MAIL_ORDERS.md §9, §10, §11, §17; CLAUDE_UI.md §41, §42, §43; CLAUDE_CORE.md §15

## SCHEMA CHANGES
None.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `app/(mail-orders)/mail-orders/review-view.tsx` | Review View: punched nav, print, punched-by, desc toggle, split banner, bill rename, badge filter |
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` | Wire onSplitComplete with pooler retry, bill rename import |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | Email-order default, SAP_PASTE_SORT config, bill rename |
| `app/api/mail-orders/ingest/route.ts` | Removed server-side auto-split block |
| `app/globals.css` | MO print styles (landscape, auto layout, B&W) inside existing @media print |
| `lib/mail-orders/utils.ts` | `getSplitDisplayLabel()`, `SAP_PASTE_SORT` config, getOrderSignals bill badge guard |
| `lib/mail-orders/email-template.ts` | splitPartLabel wording: "Part 1 of 2" → "Bill 1" |

## BUSINESS RULES ADDED

- **Punched orders navigable in Review View.** Clicking a punched order in the left panel stays focused on it. The force-advance useEffect that kicked users off punched orders has been removed.
- **Punched orders sorted DESC.** In the left panel punched section, most-recently-received orders appear first. Pending orders remain ASC (earliest first).
- **Punched-by attribution.** Punched orders show "✓ {Name} {HH:MM}" in two places: prepended as first meta item in Row 2, and as a third line in left panel rows. Color: text-gray-400. 24h time via formatTime(). Name via smartTitleCase().
- **Print button in Review View.** 4th icon-only button (Printer, 28×28) in Row 2 action cluster. Calls `window.print()`. Print CSS: `#mo-print-area` revealed, everything else hidden. Landscape A4, auto table layout, B&W, no truncation. Nav footer, action buttons, and SkuToggle hidden via `.mo-print-hide`. Print footer: "OrbitOMS · JSW Dulux Surat Depot · Printed {date} IST". All rules scoped under `#mo-print-area` to avoid leaking into challan print.
- **Server-side auto-split disabled.** Ingest endpoint no longer checks volume/line thresholds or calls `splitLinesByCategory()`. Every incoming email = exactly one `mo_orders` row. Imports removed: `getLineVolume`, `SPLIT_VOLUME_THRESHOLD`, `SPLIT_LINE_THRESHOLD`, `splitLinesByCategory` from ingest route. Exports preserved in utils.ts for client-side banner.
- **Manual split suggestion banner.** Amber banner appears in Review View between detail header and SKU table when order exceeds 1500L volume OR 20 lines. Shows Group A/B line counts and volumes. Split button POSTs to `/api/mail-orders/{id}/split`. Dismiss button hides banner until focus change. Only for unpunched, non-split orders with >1 line. Hidden in print via `mo-print-hide`.
- **Split refresh with pooler retry.** After successful split POST, `handleSplitComplete` polls `fetchMailOrders` up to 5 times × 400ms checking for `splitLabel === "A"` and `splitFromId === orderAId` before accepting fresh data. Falls back to regular `loadOrders()` after 2s.
- **Table view defaults to email order.** Expanded lines sorted by `lineNumber ASC` (parser extraction order) by default. Toggle button flips to picker-sorted view. Label: "📧 Email Order" / "📦 Picker-Sorted View". Toggle visible for all multi-line orders (no more `SORT_DISPLAY_THRESHOLD` gate for visibility).
- **SAP paste sort config.** `SAP_PASTE_SORT: SapPasteSort = "email"` in utils.ts. Controls whether the SKU copy button in table view copies lines in email order or picker order. Currently "email". Change to "picker" to flip site-wide.
- **Description toggle in Review View.** SKU table Description column defaults to long form (`skuDescription` from SAP master). Tiny "LONG"/"SHORT" toggle button in column header. Persisted to `localStorage` key `mo-review-desc-mode`. Falls back to short form (productName · baseColour) when `skuDescription` is null.
- **Split labels renamed A/B → Bill 1/Bill 2.** `getSplitDisplayLabel(order)` in utils.ts: simple split → "Bill 1"/"Bill 2"; compound (parser Bill N + split) → "Bill N-1"/"Bill N-2". DB `splitLabel` column unchanged ("A"/"B"). All UI display sites use the helper. Email reply template and slot summary email preserve the suffix for recipient context.
- **Single bill badge per order.** `getOrderSignals()` suppresses blue parent "Bill N" badges when `order.splitLabel` is set — the purple "✂ Bill X-Y" badge carries the info. Non-split orders with parser-level bills keep blue badge.
- **Left panel shows split badges.** Badge filter in `renderOrderRow` accepts `type === "bill" || type === "split"`. Purple split badge style: `bg-purple-50 text-purple-600 border-purple-200`.
- **Customer name suffix stripped in UI.** Split orders no longer append "(Bill X-Y)" to customer name in left panel, detail header, or table cell. The badge carries that info. Reply template (R key) preserves the suffix for email output.

## BUSINESS RULES CHANGED / SUPERSEDED

- **Auto-split on ingest (CLAUDE_MAIL_ORDERS.md §11):** Was: server auto-splits orders > 1500L or > 20 lines at ingest. Now: disabled. Split is user-initiated from Review View banner or manual API call. §11 algorithm description remains accurate for manual splits — only the auto-trigger is removed.
- **Review View auto-advance (CLAUDE_MAIL_ORDERS.md §9.2):** Was: "Auto-advance: after punch + 8s grace period, auto-focuses next pending order." The force-advance useEffect that ran after grace period expiry is removed. The 8s grace period itself (keeping recently-punched orders in pending section) is unchanged.
- **Punched sort order (CLAUDE_MAIL_ORDERS.md §9.2):** Was: punchedOrders sorted `receivedAt ASC`. Now: `receivedAt DESC` (most recent first). Bill number and splitLabel tiebreakers unchanged.
- **Table expanded view sort default:** Was: lines sorted by `sortLinesForPicker()` when > 5 lines, email order otherwise. Now: always email order (lineNumber ASC) by default, picker-sorted on toggle.
- **Left panel badges (CLAUDE_UI.md §41):** Was: "Badges: Bill N (blue) only." Now: Bill N (blue) for non-split orders, ✂ Bill X-Y (purple) for split orders.
- **Split badge label (CLAUDE_UI.md §32):** Was: "✂ A/B". Now: "✂ Bill 1" / "✂ Bill 2" / "✂ Bill N-1" / "✂ Bill N-2".
- **Email template split label:** Was: "(Part 1 of 2)" / "(Part 2 of 2)". Now: "(Bill 1)" / "(Bill 2)".

## BUSINESS RULES REMOVED / DEPRECATED

- **Force-advance useEffect** in review-view.tsx — deleted in commit `b96a3743`. Was the block that auto-switched focus off punched orders after grace period.
- **Server-side auto-split in ingest** — deleted in commit `cbe9b7f7`. ~118 lines removed including insertedLines fetch, totalVolume calculation, and entire splitLinesByCategory call + Group B creation + line reassignment + renumbering.

## PENDING ITEMS

- **Email sort order (existing, unchanged):** Processed section sorts by `punchedAt DESC`. Should sort `receivedAt ASC → bill number ASC`.
- **SAP_PASTE_SORT flip:** Currently "email". May flip to "picker" after user testing. One-line change in utils.ts.
- **Focus Mode cleanup (existing, unchanged):** `focus-mode-view.tsx` still has raw `order.splitLabel` display sites. Cleanup deferred to Focus Mode removal task (§17).

## CONSOLIDATION NOTES

- CLAUDE_MAIL_ORDERS.md §9.2 — Remove "Auto-advance" sentence. Add: punched orders sorted DESC. Add: punched-by attribution (✓ Name HH:MM) in meta row and left panel. Add: print button in action cluster. Add: description toggle (long/short) in SKU table header. Add: manual split suggestion banner.
- CLAUDE_MAIL_ORDERS.md §11 — Change: "Auto-split at ingest" → "Auto-split disabled. Split is user-initiated from Review View banner or `/api/mail-orders/{id}/split`." Keep algorithm description for manual splits.
- CLAUDE_MAIL_ORDERS.md §8 — Add: `getSplitDisplayLabel()` and `SAP_PASTE_SORT` to utils.ts description.
- CLAUDE_UI.md §32 — Update split badge label: "✂ A/B" → "✂ Bill 1" / "✂ Bill N-Y". Add: split badge now shows in left panel (not just detail header).
- CLAUDE_UI.md §41 — Update left panel badges: "Bill N (blue) only" → "Bill N (blue) for non-split, ✂ Bill X-Y (purple) for split". Update sort: punched section DESC. Add: punched-by third line. Remove customer name suffix for split orders.
- CLAUDE_UI.md §41 — Add: Print button (4th icon). Add: description toggle in SKU table header. Add: split suggestion banner between header and table.
- CLAUDE_UI.md §42 — Add: description rendering uses `descriptionText()` helper with long/short mode.
- CLAUDE_CORE.md §15 — Add: `SAP_PASTE_SORT` config in utils.ts (currently "email", flip to "picker" when ready).
- ? Whether `SAP_PASTE_SORT` rises to a CORE rule or stays as a MO-specific note in CLAUDE_MAIL_ORDERS.md.
