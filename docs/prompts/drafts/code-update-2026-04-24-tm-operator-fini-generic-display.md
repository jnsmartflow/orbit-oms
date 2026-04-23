# Context Update — TM / Operator / Challan Fini/Generic display toggle
Session date: 2026-04-24
Session type: code — DB index + API enrichment + shared types + frontend toggle wiring
Target files: new `lib/fini-resolver.ts`, new `types/sku-display.ts`, new `lib/hooks/use-sku-display-mode.ts`, new `components/tint/sku-display-toggle.tsx`, modified 3 API routes + 4 frontend components
Implementation status: complete — `npx tsc --noEmit` passes zero errors, deployed to production 2026-04-24

## DECISION SUMMARY
Tint Manager and Tint Operator screens now default to showing Fini SKU codes/descriptions (the actual shipping SKU that operators pick in the warehouse) with an in-memory toggle to flip to the SAP-sent Generic (master) code. Delivery Challan document is Fini-always with no toggle — the printed document must always show Fini. All three screens receive a new `skuDisplay: { sap, fini | null }` payload per line from the API. Toggle state is in-memory only and resets to Fini on every page load. Fallback is automatic: when a Generic code has no Fini mapping in `mo_sku_lookup`, the display stays on SAP regardless of toggle position.

## DB CHANGES

One index. Run in Supabase SQL Editor this session:

```sql
CREATE INDEX IF NOT EXISTS idx_mo_sku_lookup_ref_material
  ON mo_sku_lookup ("refMaterial");
```

No schema changes (additive index only). Not declared in `prisma/schema.prisma` — Prisma client does not need index declarations to function. Schema remains at v26.5.

## FILES CREATED

- `lib/fini-resolver.ts` — `resolveFiniMap(genericCodes[]) → Map<generic, { material, description }>`. Dedupes, skips DB on empty, `orderBy: material asc` for deterministic first-wins when one Generic maps to multiple Finis.
- `types/sku-display.ts` — `SkuDisplay` type (with `sap` always present + `fini` nullable), `buildSkuDisplay()` for API route construction, `pickSkuDisplay(skuDisplay, mode)` for component render. New `types/` directory at repo root; `tsconfig.json` `@/*` alias resolves it automatically.
- `lib/hooks/use-sku-display-mode.ts` — React hook. In-memory state only. Default mode `"fini"` on every mount. Same-page fan-out via custom `orbitoms:sku-display-mode` event. One-time legacy localStorage cleanup on mount.
- `components/tint/sku-display-toggle.tsx` — 2-segment control `Fini | Generic`. Styling mirrors the Mail Orders view toggle (`flex border border-gray-300 rounded-[5px] overflow-hidden`, active = `bg-gray-800 text-white`, inactive = `bg-white text-gray-500 hover:bg-gray-50`).

## FILES MODIFIED

- `app/api/tint/manager/orders/route.ts` — single `resolveFiniMap()` call per request; `skuDisplay` attached on flat `rawLineItems[]`, nested `o.splits[].lineItems[].rawLineItem`, `activeSplits[].lineItems[].rawLineItem`, `completedSplits[].lineItems[].rawLineItem`.
- `app/api/tint/operator/my-orders/route.ts` — same pattern; `skuDisplay` on flat `rawLineItemsRows[]` + nested `assignedSplits[].lineItems[].rawLineItem`.
- `app/api/tint/manager/challans/[orderId]/route.ts` — `skuDisplay` attached to each `order.lineItems[]` entry.
- `components/tint/tint-manager-content.tsx` — hook called in `TintManagerContent` + `SplitDetailSheet` (sub-component, needs its own call). Toggle placed in `rightExtra` to the LEFT of the card/table view icons, with a thin gray divider. SKU render sites (card split rows, split detail, split kanban) + client-side search filter all routed through `pickSkuDisplay()`.
- `components/tint/split-builder-modal.tsx` — hook called in component body; 4 render-site pairs (8 total code/description renders) routed through `pickSkuDisplay()`. No toggle UI in modal — it reads the global toggle state via custom event.
- `components/tint/tint-operator-content.tsx` — hook called in `TintOperatorContent`. Toggle placed in `rightExtra` to the LEFT of the progress bar with a thin gray divider. 4 primary sites wired (left panel tinting + non-tinting line cards, active TI header, SKU select dropdown, missing-lines warning dialog). Missing-lines dialog (server-returned payload lacks `skuDisplay`) falls back to a client-side lookup against `tintingLines` to resolve the display; if not found, falls through to the raw SAP fields.
- `components/tint/challan-document.tsx` — `LineItem` type extended with `skuDisplay: SkuDisplay`. Table cell uses `li.skuDisplay.fini ?? li.skuDisplay.sap` (Fini-always with SAP fallback). No hook, no toggle.

## TOGGLE STATE CONTRACT

- **Storage:** In-memory only. No localStorage persistence, no DB persistence, no cookies.
- **Default:** `"fini"` on every page load — refresh, new tab, and navigation all reset to Fini.
- **Generic mode:** Temporary peek only. Dies on refresh.
- **Same-page sync:** Cross-component via custom `orbitoms:sku-display-mode` event (TM header ↔ SplitDetailSheet ↔ split-builder-modal ↔ Operator header).
- **No cross-tab sync.** Each tab holds its own state, both start at Fini.
- **Legacy cleanup:** Hook mount removes any pre-existing `orbitoms.displayMode.skuCode` key from earlier build. One-time, idempotent.
- **No Context, no global store.** Each consuming component reads independently.

## DELIVERY CHALLAN DECISION

Fini-always, no toggle, no hook call. The printed challan is the document the customer signs and the warehouse ships against — showing the Generic (SAP) code there would be actively wrong. The API still returns both pairs for consistency with the other two screens; the frontend just uses `fini ?? sap` inline.

## FALLBACK BEHAVIOUR

When `skuDisplay.fini` is `null` (i.e. `mo_sku_lookup` has no row whose `refMaterial` equals the SAP `skuCodeRaw`):

- Toggle=Fini → displays SAP code/description (no visual indication that Fini was unavailable — deliberate; ~26.5% of rows are mapped today, so absence is common)
- Toggle=Generic → displays SAP code/description
- Challan document → displays SAP code/description

No blank cells, no placeholder strings. The operator sees something meaningful in every row regardless of toggle state or mapping coverage.

## OUT OF SCOPE / KNOWN FOLLOW-UPS

- **TI Report** (`components/tint/ti-report-content.tsx`, `app/api/tint/manager/ti-report/route.ts`) still shows Generic — explicitly out of scope. Future session to wire `skuDisplay` there.
- **OrderDetailPanel** (`components/shared/order-detail-panel.tsx`) uses a different mapping (`sku_master` fallback via `app/api/orders/[id]/detail/route.ts`) — not unified with the Fini/Generic toggle. Decide later whether to merge patterns.
- **Support order detail** (`app/api/support/orders/[id]/route.ts`) still selects raw fields. Support board is Phase-1 blocked; revisit when unblocking.
- **`/api/tint/operator/done` + `/split/done` `missingLines` payload** still returns raw SAP fields without `skuDisplay`. Frontend works around this via client-side lookup against `tintingLines`. If the dialog ever renders a line not in the current job's `tintingLines`, it falls back to SAP. Could be fixed by updating those two API routes to attach `skuDisplay` via `resolveFiniMap`.
- **Search strictness.** Client-side TM search now matches only the *displayed* code. Typing a Generic code while in Fini mode won't find it. A future "search both codes always" pass is a small change — one `||` in `filteredOrders`.
- **Column rename** (`material` → `finiCode`, `refMaterial` → `genericCode`) still deferred — 15-20 file blast radius. Separate dedicated session.
- **Pre-existing `prisma.$transaction`** in `app/api/tint/manager/challans/[orderId]/route.ts:450` violates CORE §3. Noted for future cleanup, not introduced by this session.

## SCHEMA VERSION NOTE

Schema stays at v26.5 from the DB-schema-row perspective. The `refDescription` column added in the previous session (2026-04-23) was the last schema-affecting change. Context files should bump to v26.6 at the next consolidation to reflect that column. This session added no columns and no model changes — only an index and additive API response fields.

## CONSOLIDATION NOTES

- **CLAUDE_TINT.md** — Add Fini/Generic toggle mechanics under TM §1, Operator §2, Challan §4. Document the `skuDisplay` payload shape and where the toggle lives in each header.
- **CLAUDE_CORE.md §7.6** — Note that `mo_sku_lookup.refMaterial` is now a JOIN lookup column used by three tint API routes. Index name `idx_mo_sku_lookup_ref_material`.
- **CLAUDE_UI.md** — Add the 2-segment Fini/Generic toggle to the component inventory, styled after MO view toggle.
- **Schema version** — Bump context files to v26.6 at next consolidation (covers `refDescription` column from 2026-04-23 + no-op from this session).

*End of context update.*
