# code-resume — Billing v2 UI batch (Mail Orders → Billing face)

**Date:** 2026-07-31
**Purpose:** Full handoff so a FRESH session can finish the remaining items without re-deciding anything. Everything here is either SHIPPED (live) or a LOCKED design ready to build.
**Pilot scope:** Everything is behind the `billingV2` flag, live for the **operations user (id 20) ONLY**. Current version is untouched for all other users. This discipline is CRITICAL and must continue.

---

## 0. How to read this doc
- **§1 Shipped & live** — done, with commit hashes. Do NOT rebuild.
- **§2 Remaining to-do** — the few items left, each with its LOCKED design/spec.
- **§3 Open question** — Import permission (needs a read-only check + a decision).
- **§4 Deferred** — explicitly out of scope for now (separate future sessions).
- **§5 Technical reference** — flag mechanics, files, gating pattern, verification gotchas, landmines. Read before building.

---

## 1. SHIPPED & LIVE (do not rebuild)

All commits on `main`, pushed, Vercel-built. In order:

| Commit | What shipped |
|---|---|
| `8b2d9553` | Left rail label "Mail Orders" + hide the rail's own search box (billing face) |
| `f5ccdd11` | Flat order list — bypass the Morning/Afternoon slot filter AND the auto-select-first-slot effect |
| `33d944d2` | Date stepper + Filter moved onto the Orders/Picking tab row; extracted `HeaderFilter` + `HeaderDateStepper` out of UniversalHeader; hid the empty filter band (focus mode only) |
| `298f038d` | Orders tab shows PENDING count (`status !== "punched"`), not total |
| `0cf27cb2` | Order ribbon redesign — Urgent·Hold·Slot left, Punch right, ⓘ metadata popover, readiness→SKU caption (via MetaRibbon `contentOverride`) |
| `101387ae` | Ribbon polish — Notes moved beside Slot, print on caption row, caption trimmed |
| `8dd5d0ca` | Caption = "N lines · ✓N/N" (green chip) on the LEFT, volume+Droplet icon on the RIGHT, **printer removed**, Notes button **labeled**, ⓘ tidied to a clean Info icon-button |
| `1f589d51` | Export `BTN_BASE`/`BTN_OFF` from billing-action-ribbon (fixed a Vercel build that failed because this file's edit was left uncommitted — see §5 landmine) |
| `c2914bf1` | Empty states — rail "No new orders" above the punched divider + right pane green-✓ "All caught up"; filtered-vs-empty aware; no more stale order shown when nothing pending |
| `e545af29` | Ship-to override blank-name FIX — Mail Orders now resolves the override dealer via the `shipToOverrideCustomer` FK relation (like Floor), not by parsing `deliveryRemarks` text. Option (a): name/code/area/deliveryType all from master data |
| `f82016f0` | Header — title → "Billing", Table/Focus toggle hidden (Focus only; Table code intact), wide search layout, clock dropped (JSX + the 1-sec interval), stats removed from header |
| `d41d54e1` | Wide search styled white/thin-border/subtle-radius (Outlook-ish) — SUPERSEDED by the v7 styling in §2 |
| `3b678ad3` | Header layout — Billing · Import · left search · keyboard far right — **layout SUPERSEDED by §2.1** (search is moving to the top-right corner, keyboard moving down) |

**Empty-state copy (live, keep verbatim):**
- Rail genuinely empty: "**No new orders**" / "New orders appear here on their own."
- Rail filtered to nothing: "No orders match."
- Right pane genuinely empty: green ✓ "**All caught up**" / "Every order is punched. New ones show up here as they come in."
- Right pane filtered to nothing: "No orders match your filter."

---

## 2. REMAINING TO-DO (locked designs, ready to build)

### 2.1 Header — final layout (SUPERSEDES `3b678ad3` layout)
Reference mock: `billing-header-v7.html`.

**Top header (wide/billing face), left → right:**
```
[ "Billing" title ] ————————— flex-1 spacer ————————— [ Import ] [ search ]
```
- Billing alone on the far LEFT.
- Import + search at the far-RIGHT corner, Import to the LEFT of search.
- Keyboard-shortcuts button is NO LONGER in the top header — it moves DOWN (see 2.2).

**Search styling (v7 — soft, borderless, white, smaller):**
```
flex items-center gap-2.5 w-[300px] max-w-full min-w-0 h-[36px] rounded-[10px]
bg-white border-0 px-3.5
shadow-[0_0_0_1px_rgba(17,24,39,0.05),0_1px_3px_rgba(17,24,39,0.10)]
transition-shadow
hover:shadow-[0_0_0_1px_rgba(17,24,39,0.06),0_2px_6px_rgba(17,24,39,0.12)]
focus-within:shadow-[0_0_0_1px_rgba(13,148,136,0.35),0_2px_8px_rgba(17,24,39,0.13)]
```
No border — definition comes from the soft shadow. Icon ~14px gray-400; input `text-[13px]`; "/" chip logic unchanged. Same search state/handlers (the existing 19-field `searchQuery`).

### 2.2 Keyboard-shortcuts button → down to the Filter/date control row
The keyboard button (the `shortcutsRef` button + its popover, currently in UniversalHeader) moves to the **Orders/Picking control row**, at the far right, beside Filter + date:
```
Control row:   Orders · Picking            [Filter]  [‹ Today · 31 Jul ›]  [⌨]
```
This is the one item with real plumbing: the shortcuts button + popover live in UniversalHeader, but the control row's right side is composed in `mail-orders-page.tsx` as `billingHeaderSlot` (passed to `BillingTabBar.rightSlot`). Next session should first do a READ to decide whether to (a) extract the shortcuts button into a small shared component both header and the control row can use, or (b) pass it through. Keep the OFF path + other 7 screens byte-identical.

### 2.3 Left rail → "Inbox" + stats
- Rename the left-rail label from "Mail Orders" to **"Inbox"** (billing face).
- Put the stats back on the Inbox rail header: **"N orders · % punched"** (they were removed from the top header in `f82016f0` and currently show NOWHERE — this returns them, on the rail where they belong).
- File: `review-view.tsx` rail head (billing branch). Gated `billingV2`.

### 2.4 Final flag-off byte-identical audit
A full audit passed through `c2914bf1` (OFF path byte-identical: yes). RE-RUN it for the header commits (`f82016f0` onward) + 2.1/2.2/2.3. Confirm the other 7 UniversalHeader consumers (Tint ×5, Sampling, Trips, Attendance) are untouched.

### 2.5 Human hand-checks still outstanding (Claude Code cannot log in)
- Billing header renders correctly (Import permission aside — see §3).
- **Non-billing screen (Tint Manager or Trips) still shows the clock ticking + the compact 180→260px search + Import in the right cluster.** This proves the shared-header changes didn't regress 7 screens and has NOT been eyeballed yet across any header commit. Do this.

---

## 3. OPEN QUESTION — Import button permission

On the billing header, the **Import button does not show for the operations user**. Strong hypothesis: it's permission-gated (`showImport = canImportOBDs`, a role-derived flag) and the operations user simply lacks import rights — in which case the layout is correct and it's a permission decision, NOT a bug.

**Read-only check to settle it (run first):**
1. In `universal-header.tsx`, wide mode: confirm the hoisted `importButton` renders in its cluster whenever `showImport` is true (not double-gated).
2. Trace how `canImportOBDs` (passed as `showImport` from `mail-orders-page.tsx`) is derived — which permission/role — and whether the `operations` role gets it.

Then decide: if operations should be able to Import, grant the permission (small SQL/role change, SELECT-first per CORE); if importing is someone else's job, it's correct that it's hidden.

---

## 4. DEFERRED (out of scope now — separate future sessions)

- **Full data-audit / pipeline plumbing / testing session.** Includes the known "data issue in the Picking module of billing", verifying the dual-write actually reaches Floor Control end-to-end, and then WIDENING rollout beyond the operations user. Smart Flow explicitly wants this as its own dedicated session.
- **Clear the test-marked "done" bills** created during the operations pilot before real rollout.
- **Ship-to fix caveat (option a):** on the billing face, area/deliveryType now come from master data (`area_master`/`delivery_type_master`), while Table view still reads the `mo_customer_keywords` cache — they can disagree for a dealer. Also: non-billing users still see a blank ship-to name for pencil-set overrides until they're on billingV2 (self-heals at full rollout; Floor/dispatch already correct). Consider ungating (fix for everyone) in the data session after verifying legacy id/text agreement with a SELECT.
- **Global rename Mail Orders → Billing** (currently gated to the billing face only).
- **Table view retirement is hide-only** — the Table/Focus toggle is hidden on the billing face but the Table code (MailOrdersTable, ColumnPicker, ~20 viewMode branches) is fully intact and live for non-billing users. A proper archive per `archive/RETIREMENT-PLAYBOOK.md` is deferred and must not be done casually.
- **Universal search**: no separate work needed — the header search already IS the 19-field order search (`searchQuery`), reused. The old "batch-2 universal search" is effectively satisfied.

---

## 5. TECHNICAL REFERENCE (read before building)

### Flag mechanics
- `billingV2`: global stage in `billing_settings` (OFF | TEST_USERS_ONLY | ALL_USERS) + per-user `users.billingV2TestUser`. `isBillingV2Enabled()` in `lib/billing/flag.ts`, resolved server-side in `app/(mail-orders)/mail-orders/layout.tsx`, couriered by `BillingV2Provider` (`components/billing/billing-v2-provider.tsx`). Context default `false` → fail-closed. Client reads via `useBillingV2()`.

### Gating pattern (do not violate)
- The **page** reads the flag; the **shared `UniversalHeader` takes only NEUTRAL boolean/enum props** and must NEVER import from `components/billing/` or call `useBillingV2()`. Existing neutral props: `suppressFilterBar`, `searchLayout: "compact" | "wide"`, `showClock`. New header behaviour arrives the same way — optional prop, default = today's behaviour, so the other 7 consumers stay byte-identical.
- New nodes wrapped `{billingV2 && …}` or `billingV2 ? … : <today/>`. OFF path must be byte-identical (verified by diff each time).

### Key files
- `components/universal-header.tsx` — SHARED by 8 screens (Mail Orders, Tint Manager, Tint Challan, Tint Shades, TI Report, Tint Operator, Sampling Library, Trips, Attendance). Handle with the neutral-prop pattern.
- `components/header-filter.tsx`, `components/header-date-stepper.tsx` — extracted from the header (behaviour-preserving) so the billing tab row can reuse them.
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — owns `billingV2` (`useBillingV2()`), `viewMode` (default "focus"), `activeSlot`, `focusedId`, `headerFilters`, `searchQuery`, `MO_FILTER_GROUPS`. Composes `title` node, `searchLayout`, `showClock`, `billingHeaderSlot`.
- `app/(mail-orders)/mail-orders/review-view.tsx` — the Focus/Review screen: rail (pending/punched split with ~8s `recentlyPunchedIds` grace), ribbon via `MetaRibbon` `contentOverride`, SKU caption, empty states, ship-to resolution (`billingV2 && order.shipToOverride ? order.shipToOverrideCustomer : parse`).
- `components/mail-orders/meta-ribbon.tsx` — SHARED but only consumer is review-view; new prop `contentOverride?: ReactNode` (undefined → original); `getMatchChip` is exported.
- `components/billing/*` — `flag.ts`, `billing-v2-provider.tsx`, `billing-tab-bar.tsx` (`rightSlot`), `billing-action-ribbon.tsx` (renders Urgent·Hold·Slot; **exports `BTN_BASE`/`BTN_OFF`**), `billing-order-info.tsx` (the ⓘ popover), `billing-ship-to-pencil.tsx`, `billing-picking-tab.tsx`.
- `app/api/mail-orders/route.ts` — added `shipToOverrideCustomer` FK select (additive) for the ship-to fix.

### Empty-state semantics
- `pendingOrders` includes a just-punched row for ~8s (`recentlyPunchedIds` grace) so it doesn't vanish mid-action. Empty states key on `pendingOrders.length === 0` (so they appear a beat after the last punch) with a `hasActiveFilter` fork (search non-empty OR any header filter) → "No orders match" instead of "all caught up".
- The right pane blanks purely by not rendering when pending is empty — it does NOT touch `focusedId`/auto-select (that logic is shared with Table view). Accepted tradeoff: when all-done you can't click a punched order to reopen it (matches Floor/Picking).

### Verification gotchas / landmines (all bit us this session)
- **Local `tsc`/`next build` validate the WORKING TREE, not the commit.** Always run `git diff HEAD --stat -- '*.ts' '*.tsx'` after committing and confirm it's EMPTY (HEAD == working tree) BEFORE pushing. An uncommitted file (the `BTN_BASE`/`BTN_OFF` export) once passed local checks but broke Vercel because it wasn't in the commit.
- **Stage files by name**, never `git add .` (repo has ~195 untracked scratch entries + pre-existing tracked changes).
- **Claude Code has no login** → cannot verify rendered/login behaviour. The BUILD ROUTE TABLE is its evidence. All render/login/permission checks are Smart Flow's by hand.
- **Import is permission-gated** — absence of the Import button is likely permission, not a layout bug (see §3).
- Commit style: direct to `main`, `tsc --noEmit` green + clean `next build` (rm .next first) before push.

### Design tokens
Plus Jakarta Sans; JetBrains Mono for OBD/SO numbers; teal `#0d9488`; fixed-table standard. Search v7 spec in §2.1. Caption: line count + green `getMatchChip` ✓N/N on the left, volume + Droplet icon on the right.

---

## 6. Suggested order for the fresh session
1. Run the §3 Import read-only check → decide permission.
2. Build 2.1 (header: Import+search to top-right corner, v7 search styling).
3. Build 2.2 (keyboard → control row) — READ first for the plumbing.
4. Build 2.3 (Inbox label + stats on rail).
5. Run 2.4 (flag-off audit) + get Smart Flow to do 2.5 (non-billing hand-check).
6. Then this whole batch can be consolidated into the canonical `CLAUDE_MAIL_ORDERS.md` (a Claude Code consolidation job, per project workflow) and this resume archived.
