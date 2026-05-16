# Code Update — Mail Orders: Manual Split, Bill-Label Rename, Review View Polish
Session date: 2026-04-17
Session type: code (10+ commits deployed to production)
Target files: CLAUDE_MAIL_ORDERS.md, CLAUDE_UI.md, CLAUDE_CORE.md
Implementation status: shipped and tested in production

## CHANGE SUMMARY
Ten-plus commits shipped to main and live on orbitoms.in. Auto-split removed from ingest; split is now a user-initiated action via an amber banner in Review View (and existing suggestion in Table view). Split labels renamed A/B → Bill 1/Bill 2 in UI only, with compound labels (Bill 2-1, Bill 2-2) when a parser-level bill is manually sub-split. Review View gained print button, punched-by display, long/short description toggle, and navigable punched orders. Table view SKU lines now default to email order with a picker-view toggle; SAP paste sort controlled by a new `SAP_PASTE_SORT` constant. UI collapsed to one bill-related badge per order (no more redundant customer-name suffix and parent-bill badge on split orders).

## COMMITS LANDED (in order)

1. `fix(mail-orders): allow navigating punched orders in review view, sort punched desc` — deleted auto-advance useEffect at lines 803-815 and flipped punched sort ASC→DESC in `review-view.tsx`.
2. `feat(mail-orders): show punched by and time in review view` — prepends `✓ {name} {HH:MM}` to Row 2 meta on punched orders via `unshift()`; adds third line to left panel punched rows. Uses existing `MoOrder.punchedBy`, `punchedAt`.
3. `feat(mail-orders): print order button in review view` — `Printer` icon as 4th action button. `window.print()` via `id="mo-print-area"` + `.mo-print-hide` class. No keyboard shortcut. Print footer: `OrbitOMS · JSW Dulux Surat Depot · Printed {IST date time}`.
4. `fix(mail-orders): print table uses landscape + auto layout to prevent truncation` — A4 landscape, table-layout auto, overflow visible, 10px base / 9px headers — follow-up to (3).
5. `fix(mail-orders): disable server-side auto-split on ingest, split becomes user-initiated` — SHA cbe9b7f7 — removed ~118 lines (the `insertedLines` fetch + `totalVolume` reduce + entire auto-split if-block) from `app/api/mail-orders/ingest/route.ts`. Large orders now arrive as a single `mo_orders` row.
6. `feat(mail-orders): manual split suggestion banner in review view` — amber banner between detail header and SKU table when `!splitLabel && (totalVol > 1500 || lines > 20)`. Shows Group A/B line-count + volume preview. Split button posts to existing `/api/mail-orders/{id}/split`. Dismiss is local state (resets on focus change).
7. `fix(mail-orders): refresh order list instantly after split, focus group A` — SHA f915a980 — added `onSplitComplete` prop to ReviewView, wired to `loadOrders` via `handleSplitComplete` wrapper in `mail-orders-page.tsx` that also sets focus to Group A.
8. `fix(mail-orders): poll for split visibility after supabase pooler eventual consistency` — SHA d2f88eb6 — retry-poll loop (5 × 400ms) in `handleSplitComplete` to handle Supabase transaction-pooler read-after-write lag. Brought post-split UI refresh from ~30s down to ~2s.
9. `feat(mail-orders): email-order default in table, swappable SAP_PASTE_SORT config` — SHA a491279d — new `SAP_PASTE_SORT: "email" | "picker"` constant in `lib/mail-orders/utils.ts` (currently `"email"`). Table ExpandRow defaults to email order; toggle → picker view. Constant controls clipboard (SAP) sort across both views.
10. `feat(mail-orders): review view defaults to long description, toggle to short` — `descMode: "long" | "short"` state persisted to `localStorage` key `mo-review-desc-mode`. Tiny `[long]`/`[short]` button in Description column header. Long = `skuDescription` from SAP master. Short = `productName · baseColour`. Falls back to short when `skuDescription` is null.
11. `feat(mail-orders): rename split labels A/B to Bill 1/Bill 2 in UI` — SHA cd154d60 — new `getSplitDisplayLabel(order)` helper in utils. Basic mapping `A→Bill 1`, `B→Bill 2`. Compound mapping for sub-splits of parser-level bills: parent `Bill 2` + splitLabel `A` → `Bill 2-1`. DB `splitLabel` column unchanged. `email-template.ts` splitPartLabel updated ("Part 1 of 2" → "Bill 1").
12. `fix(mail-orders): single bill badge per order in UI, keep suffix in email text` — SHA a67494ab — `getOrderSignals` no longer emits parent `Bill N` blue badge when `splitLabel` set (purple `✂ Bill X-Y` already carries the info). Customer name suffix `(Bill X)` stripped from all UI display sites (left panel, detail header, table cell). Email reply template + slot summary preserve suffix for external communication.
13. `fix(mail-orders): show split badge in left panel rows, not just bill` — follow-up to (12). Left panel row renderer now filters `type === "bill" || type === "split"`, styling each appropriately (blue for bill, purple for split).

## NEW CONSTRAINTS

- **Auto-split is no longer a server behaviour.** `app/api/mail-orders/ingest/route.ts` does not split orders by volume/line-count. Every email = one `mo_orders` row. Parser-level splits (`__Bill{N}`, `__Sec{N}` in `emailEntryId`) still happen — those are legitimate multi-bill / multi-customer emails, not volume-based.
- **Manual split endpoint (`POST /api/mail-orders/{id}/split`) is now the ONLY split path.** Both Table view's existing banner (post-resolve) and Review View's new banner POST here.
- **Supabase transaction pooler has read-after-write lag** visible at single-digit seconds. Any flow that commits and immediately re-fetches needs a retry loop. Pattern shown in `handleSplitComplete` in `mail-orders-page.tsx` (5 × 400ms = 2s max).
- **DB `splitLabel` column stores `"A" | "B"` forever.** The UI rename to Bill 1/Bill 2/Bill N-X is a display transform via `getSplitDisplayLabel()`. Never rename the stored value.
- **`getOrderSignals()` emits at most one bill-related badge per order.** `!order.splitLabel` guards the parser-bill loop. Split orders carry info via the `✂ Bill X-Y` purple badge; non-split orders carry it via the blue `Bill N` badge.
- **Customer name never carries the bill suffix in UI.** Left panel, detail header, table cell all render the plain customer name. The badge carries the bill info. Reply template and email template DO carry the suffix (external comms, no visual badges).
- **`SAP_PASTE_SORT` constant** in `lib/mail-orders/utils.ts` controls clipboard sort across both views. Currently `"email"`. Change to `"picker"` later without code surgery — one-line edit + deploy.
- **Review View SKU description mode** controlled by `mo-review-desc-mode` localStorage key. Default `"long"` uses `skuDescription` from SAP master; `"short"` falls back to `productName · baseColour`.
- **Print via `window.print()` requires `#mo-print-area` + `.mo-print-hide`.** Integrated into existing `@media print` block in `globals.css` alongside challan rules. Scoped by ID so print targets don't leak into each other.
- **Print uses A4 landscape** via `@page mo-landscape { size: A4 landscape; margin: 10mm; }` inside `@media print`. Table `colgroup` hidden and `table-layout: auto` in print context to bypass §40 fixed-table widths and prevent truncation.

## NEW PENDING ITEMS

- **`focus-mode-view.tsx` deletion** | Claude Code | has 2 stale `splitLabel` display references that were not updated because the file is flagged for removal in `CLAUDE_MAIL_ORDERS.md §17`.
- **Parser double-forwarded body diagnostic** | depot PC | when a forwarded email is re-forwarded with a subject tweak, product extraction fails and zero-skip fallback fires. Check `mail_order.log` for `CRASH-TRACE` or `PARSED products=0` entries to isolate root cause. Not business-critical — zero-skip keeps the email visible.
- **Natural-traffic verification of (5) server auto-split removal** | me | a large order from a real SO tomorrow should land as one row. Already functionally verified via TEST forwards of historical auto-split orders.
- **Consider `SAP_PASTE_SORT = "picker"`** | me | once operators are used to the email-order display, flip SAP paste to picker order. One-line change. No logic work.
- **Test data cleanup — 9 rows deleted from `mo_orders`** | done | deleted on 2026-04-17 IST via Supabase SQL Editor. Parser dedup state (`processed_ids_fw.json` on depot PC) still has test email IDs; re-testing requires a new subject marker.

## SUPERSEDED DECISIONS

- **`CLAUDE_MAIL_ORDERS.md §11 (Auto-split system v47)`** — auto-split is no longer automatic on ingest. The algorithm (`splitLinesByCategory` with category-first + dominant-block sub-split + greedy bin-pack) still exists and is used client-side by the suggestion banners. Threshold values (`SPLIT_VOLUME_THRESHOLD = 1500`, `SPLIT_LINE_THRESHOLD = 20`) unchanged. Section needs rewrite from "Thresholds trigger split at ingest" to "Thresholds trigger suggestion banner; user confirms split".
- **`CLAUDE_MAIL_ORDERS.md §10 (Keyboard shortcuts)`** — no Ctrl+P shortcut for print (explicitly declined per operator preference; icon-click only).
- **`CLAUDE_UI.md §32 (Signal badges)`** — split badge label was `✂ A`/`✂ B`; now `✂ Bill 1`/`✂ Bill 2`/compound `✂ Bill N-X`. One badge per order (bill OR split, never both) is a new constraint not previously documented.
- **`CLAUDE_UI.md §23 (Customer column)`** — name no longer includes `(A)`/`(B)` suffix. Badge replaces suffix. Reply template and slot summary email still carry the suffix in output text.
- **`CLAUDE_UI.md §42 (Review View — SKU table row states)`** — Description column now has a `[long]`/`[short]` toggle button in the header. Column renders `skuDescription` by default (SAP master text) with fallback to `productName · baseColour`.

## PROMPTS DRAFTED FOR CLAUDE CODE

None. All prompts written during this session were consumed — Claude Code executed each and shipped.

## CONSOLIDATION NOTES

Where this update should merge on next consolidation cycle:

- **`CLAUDE_CORE.md §3`** — no change (rules held throughout: no `prisma.$transaction`, no `prisma db push`, all API routes dynamic, bom1 region, tsc clean).
- **`CLAUDE_CORE.md §15`** — update "One-time backfill endpoints" list if any of those were touched (they were not this session).
- **`CLAUDE_MAIL_ORDERS.md §4`** — document `splitLinesByCategory` as client-only now. Remove reference to its use during ingest.
- **`CLAUDE_MAIL_ORDERS.md §7`** — document new flows: `POST /api/mail-orders/{id}/split` is now user-initiated via both Table banner and Review banner.
- **`CLAUDE_MAIL_ORDERS.md §8`** — remove any remaining mention of Focus Mode as a separate view (Review View absorbed all punching behaviour).
- **`CLAUDE_MAIL_ORDERS.md §9`** — add Review View subsections: print button, long/short description toggle, split suggestion banner.
- **`CLAUDE_MAIL_ORDERS.md §11`** — rewrite Auto-split section: from "triggers on ingest" to "triggered from Review or Table banner by user; threshold logic and split algorithm unchanged, only trigger point moved to client".
- **`CLAUDE_MAIL_ORDERS.md §17`** — add pending items: parser double-forward diagnostic, `focus-mode-view.tsx` deletion (existing item still open), SAP_PASTE_SORT flip opportunity.
- **`CLAUDE_UI.md §6`** — no change (UniversalHeader unchanged).
- **`CLAUDE_UI.md §23`** — remove customer-name bill suffix; note badge carries info.
- **`CLAUDE_UI.md §32`** — update split badge spec: `✂ Bill 1`/`✂ Bill 2`/compound `✂ Bill N-X`. Add constraint: one bill-related badge per order (bill XOR split).
- **`CLAUDE_UI.md §41`** — Review View detail header Row 2 meta row now prepends `✓ Punched by {name} {time}` on punched orders.
- **`CLAUDE_UI.md §42`** — Description column gains long/short toggle button in header.
- **`CLAUDE_UI.md §50 (new section needed)`** — Print from Review View spec: target `#mo-print-area`, hide class `.mo-print-hide`, A4 landscape via `@page mo-landscape` inside `@media print`, print footer line format, integrated with existing challan print block in `globals.css` — one shared `body * { visibility: hidden }` base, two scoped reveal targets.
