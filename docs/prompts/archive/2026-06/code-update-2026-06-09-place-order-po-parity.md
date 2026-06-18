# Context Update — Desktop /place-order brought to /po feature parity
Session date: 2026-06-09
Target files: CLAUDE_PLACE_ORDER.md (§6, §10, §11, + new recents section), CLAUDE_UI.md (§41, §45), CLAUDE_CORE.md (§8)

## SCHEMA CHANGES
None. All work is client-side localStorage + the mailto email builder. No DB writes, no new tables/columns, no API routes.

## NEW/MODIFIED FILES

| File | Purpose |
|---|---|
| `lib/place-order/recents.ts` (new) | Device-local recent customers. `getRecents` / `addRecent`. Key `place_order_recent_customers` (distinct from /po's `po_recent_customers`). Entry `{name, code, area, stamp}`. Dedupe by code, newest-first, cap 10. SSR-guarded + try/catch. |
| `app/(place-order)/place-order/components/recent-customers.tsx` (new) | Landing recent-dealers grid (2-col, borderless soft-fill rows, neutral gray avatars, medium-weight names, relative recency). Row click → existing `handleSelectCustomer`. |
| `app/(place-order)/place-order/components/cart-panel.tsx` (mod) | Bill bar always renders when a customer is selected (add / duplicate / delete + inline delete-confirm). "More options" collapse removed → always-open Ship-to / Dispatch / Remarks / Notes. Dispatch dots Normal/Urgent/Call + on-click SO/Dealer. Remarks 2×2 Truck/Cross/Bounce/DTS (re-tap clears) + on-click Cross depot picker. Notes + Quick-add. |
| `app/(place-order)/place-order/place-order-page.tsx` (mod) | Recents save-on-send; `customerQuery` state. `renumberBills()` + `addBill`/`duplicateBill`/`deleteBill`. Order-level `dispatch`/`callTarget`/`remark`/`crossDepot`/`notes`/`shipTo` state wired into email build, autosave, beforeunload, reset. `applyDraft` renumbers bills, clamps `activeBillId`, coerces stale `"Hold"` → `"Normal"`. |
| `lib/place-order/email.ts` (mod) | `EmailDispatch` = `Normal\|Urgent\|Call` (Hold removed); add `EmailCallTarget`; `EmailMarker` adds `Bounce`. `buildEmail` accepts `callTarget`/`crossDepot`/`notes`/`shipTo` and emits unified /po-format lines. Single shared builder; desktop consumes it now. |
| `lib/place-order/draft-storage.ts` (mod) | `DraftSnapshot` carries `callTarget`/`crossDepot`/`notes`; defaults keep old drafts valid. |
| `app/(place-order)/place-order/components/customer-search.tsx` (mod) | Additive `onQueryChange?` prop (drives landing-recents visibility). No behaviour change. |

Commits (all on `origin/main`): `797dae37` recents · `ccb4612e` recents styling · `bac6432d` multi-bill · `c4cc6dba` options parity + unified email.

## BUSINESS RULES ADDED

- **Desktop recents.** Saved on Send (not on select). Device-local localStorage `place_order_recent_customers`, dedupe by code, newest-first, cap 10. Grid shows only when no customer is selected AND the search box is empty AND recents are non-empty; otherwise the existing "Type a customer name… N loaded" hint is shown verbatim. `area` shown when present, code-only when null (never fabricated).
- **Multi-bill.** Bill bar is always visible once a customer is selected — Add is reachable from the single-bill state (previously the only Add control was gated behind `bills.length > 1`, a dead end). `id === index+1` is enforced by `renumberBills()` after every add/delete/duplicate AND on draft restore. `activeBillId` is never dangling (repointed on delete, clamped on restore). Delete requires confirm only when the bill has lines; empty bills delete immediately; delete is disabled when one bill remains. Duplicate deep-copies each line and its nested `packQtys` into new objects (no shared references), inserts after the source, and becomes active.
- **Unified email builder.** `lib/place-order/email.ts` is the single builder; desktop uses it. Emits, only when set: `Dispatch: Urgent` / `Dispatch: Call to SO|Dealer`; `Truck order` / `Cross billing from {depot}` / `Bounce order` / `DTS order`; a Notes line; a Ship To line. A plain order (Normal + no remark + no notes + ship-to same) is byte-identical to the prior email output.
- **Options panel.** Ship-to / Dispatch / Remarks / Notes are always open (no collapse). Ship-to autocompletes (reuses CustomerSearch filter) and is omitted from the email when left "same as billing". Marker re-tap clears (no explicit "None"). Cross opens a depot picker (Dahisar/Ahmedabad/Rajkot/Pune) and Call opens an SO/Dealer picker — both rendered only while their parent option is active.

## BUSINESS RULES CHANGED / SUPERSEDED

- Desktop dispatch set: **Normal/Hold/Urgent → Normal/Urgent/Call** (CLAUDE_PLACE_ORDER + `email.ts`).
- Desktop marker set: **Truck/Cross Delivery/DTS/None → Truck/Cross/Bounce/DTS** with re-tap-to-clear.
- Email marker/dispatch text: raw `Marker: X` / `Dispatch: X` → humanized /po wording (see ADDED).
- Cart panel "More options" is no longer a collapsible — the options are permanently visible (CLAUDE_UI §45).

## BUSINESS RULES REMOVED / DEPRECATED

- **"Hold" dispatch removed** from desktop (was CORE §8 "punch but don't dispatch"; mobile /po never had it). Stale "Hold" drafts coerce to "Normal" on restore. Commit `c4cc6dba`.
- **"None" marker button removed** — re-tapping the active marker clears it instead.

## PENDING ITEMS

- **/po → shared email builder.** Migrate `app/po/po-page.tsx` to import `lib/place-order/email.ts` (decision d). Verify byte-identical to current /po email before cutover.
- **Parser update** to read the new humanized desktop dispatch/remark/notes/ship-to lines (owner to handle; /po already sends this format to the same parser).
- **Server-side per-user recents** — deferred; currently device-local. ROADMAP.
- **Dispatch/remark/notes scope** — currently order-level (one set per email, applies to all bills in a multi-bill send). Confirm acceptable.

## CONSOLIDATION NOTES

- CLAUDE_PLACE_ORDER.md §6/§10 — document the always-visible bill bar + add/delete/duplicate + `renumberBills` invariant + delete-confirm gating.
- CLAUDE_PLACE_ORDER.md §10 — cart panel now hosts the always-open options sections (no "More options" collapse).
- CLAUDE_PLACE_ORDER.md §11 — record the unified /po line formats. NOTE: §11 (and §1) still say the recipient is `surat.order@outlook.com`; live builders use `surat.depot@akzonobel.com` — correct at merge? (predates this session).
- CLAUDE_PLACE_ORDER.md — add a new "Desktop recents" subsection (localStorage key, save-on-send, cap 10, render gate).
- CLAUDE_UI.md §41/§45 — add the bill-bar visual, the always-open options panel (dispatch dots teal/amber/red, remark icons, on-click SO/Dealer + Cross-depot pickers), and the landing recent-dealers grid spec.
- CLAUDE_CORE.md §8 — "Hold" no longer applies to /place-order. Confirm whether Hold survives as a concept anywhere else; if not, deprecate. (?)

Mockups (in `docs/mockups/place-order/`): `recents-light.html`, `multibill-cart-panel.html`, `options-parity-mobile-styled.html`.
