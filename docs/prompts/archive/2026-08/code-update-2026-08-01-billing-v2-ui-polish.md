# code-update — Billing v2 UI: finish + full polish (whole session)

**Date:** 2026-08-01
**Purpose:** Handoff of the entire billing-v2 UI session. Everything here is **SHIPPED to `main`** and **audit-verified flag-gated**. This finishes the `code-resume-2026-07-31-billing-v2-ui-batch.md` batch and adds a large polish round on top.
**Pilot scope:** Everything is behind the `billingV2` flag, live for the **operations user (id 20) ONLY**. Discipline held for the whole session and must continue until deliberate rollout.
**Next session:** DATA PLUMBING verification — the data flow **orders → Floor Control** and **Floor → Picking**. Not UI.

---

## 0. Status

- Final **flag-off audit PASSED**. OFF path (non-billing Mail Orders focus view) + all **7 shared-header consumers** + **Table view** are byte-identical to pre-session, verified by mechanical diff (not eyeball).
- **Two leaks were found and fixed mid-session** (see §3) — both confirmed closed by the audit.
- `tsc --noEmit` + clean `next build` green on every commit; all staged by name; all pushed to `main`.

---

## 1. Shipped commits (this session, in order)

Baseline before this session: `f82016f0` and the earlier resume §1 commits (`8b2d9553`, `3b678ad3`, `d41d54e1`, …).

| Commit | What shipped |
|---|---|
| `c8f8d020` | **Operations role can Import.** Added `"operations"` to the client allow-list (`canImportOBDs`, mail-orders-page) **and** the server `requireRole` array (`app/api/import/obd/route.ts`) **and** a live `role_permissions` row (operations / import_obd / canImport=true). NOT flag-gated — a real permission grant. |
| `d08f3870` | Header: `searchLayout` gains `"wide-right"`, new `showShortcutsButton`; Import + search moved to the top-right corner; initial v7 search styling. |
| `15e87e2b` | Extracted the keyboard-shortcuts button+popover into **`components/header-shortcuts.tsx`** (controlled/uncontrolled split mirroring HeaderFilter); billing hides it in the header and renders it on the control row. |
| `f91b94c8` | Rail head gained "Inbox" label + "N orders · X% punched" stats. |
| `f76b4c86` | Control-row reorder (date · Filter · keyboard); removed "updates live as picks are checked" caption; **teal Import** via new `importVariant` prop; search v8 (gray fill + border + teal focus). |
| `69f422be` | Click a **punched** order to reopen it on the right even when "all caught up" (`reopenedPunchedId` state) + dismiss **×**. Last-punch still lands on "All caught up". |
| `471e6808` | Search → pearl-white + narrower; removed the **"Inbox" word** (kept stats); **Notes band → purple** (instructions-strip `tone` prop, reusing Floor's `#f5f3ff`/`#5b21b6`/`#7c3aed`). |
| `e309ac37` | Notes band **violet left-accent bar** (callout cue). |
| `7b4ca75d` | Action-row reorder: **sales officer name on LEFT, all actions on RIGHT**, Punch last. |
| `0a8582e3` | **Green SO pill** (✓+number in one pill, "Punched" tag deleted); **punched-by line on the left**; **divider** before the punch group; **Order No box** styled like the search; rail head **right-aligned + % colored** (green 100 / amber <100). |
| `7f017e88` | Edit pencil → **compact inline editor** (prefilled + ✓/✕), not the full "Order No + Punch" box. |
| `d5a896b3` | **GATE FIX** — green pill + Order No styling had leaked to the non-billing focus view (soNumberSlot is shared); both gated on `billingV2`, OFF path restored byte-identical. |
| `a64c7935` | **Edit-bounce fix** — `handleSaveSoNumber({isEdit})` skips the status flip + the 8s "recently punched" grace on an edit, so an edited order no longer bounces pending→done. Keeps original `punchedAt`. |
| `c9ff6bb5` | Removed **Urgent/Hold/Dispatch chips** from the ship-to card (call-site filter, billing-gated); **Notes button turns purple** when a note exists (teal dot retired). |
| `06a5c904` | Rail head **mail icon + "Inbox" label** (left) with stats (right); ship/bill **card min-height floor** (billing only, steadies stepping); **% blue below 100 / green at 100**. |

---

## 2. Design decisions locked (billing face)

**Color language (one meaning per color):**
- **Teal** `#0d9488` — brand / primary action (Import button, logo, search focus ring).
- **Green** — done (the SO pill, 100% punched).
- **Amber / Red** — urgent / hold — **only on the CTA buttons now** (chips removed from the card).
- **Purple** `#5b21b6` / `#7c3aed` / `#f5f3ff` — notes (band + Notes button). Borrowed verbatim from Floor's tint strip.
- **Blue** — in-progress punch % (<100) and the "local" delivery dot.

**Header:** "Billing" title far left; Import (teal) + search (pearl, `w-[240px]`) at the far-right corner; the keyboard-shortcuts button lives on the **control row** (date · Filter · keyboard), not the header.

**Rail head:** mail icon + "Inbox" (small, muted, uppercase) on the left; `N orders · X% punched` on the right — % blue below 100, green at exactly 100.

**Detail action row:** LEFT = `soName · received · punched by <op> <time>` (small, muted, truncates first). RIGHT = `Urgent · Hold · Slot · Notes │ [Order No + Punch]` (pre-punch) or `… │ [✓ green pill] ✎` (post-punch). **Punch is the rightmost action; future buttons insert immediately left of the Order No / pill group.** Vertical divider (`w-px h-4 bg-gray-200`) only between the toggle group and the punch group — none between individual buttons.

**Punched state:** ✓ + number in **one green pill**, no separate "Punched" tag. Editing is in-place (compact editor) and does **not** re-punch — it keeps the original punch time and does not move the row.

**Empty state:** clicking a punched order reopens it on the right even when caught up; **×** returns to "All caught up"; punching the last order still lands on "All caught up".

**Notes:** band is purple with a violet left-accent bar; the Notes button itself tints purple when the order has a note.

**Ship-to card:** Urgent/Hold/Dispatch chips removed on billing (Urgent/Hold duplicate the CTA buttons; Dispatch was a static meaningless word rendered in the loudest green). **Challan chip kept.** The "captured" ship-to override pill is unaffected (rendered directly by the card, not via signals). Card has a min-height floor so it doesn't wobble.

---

## 3. NEW LANDMINES (add to canon)

- **A `*Slot` prop is rendered by MetaRibbon in BOTH branches.** `meta-ribbon.tsx` renders `contentOverride ?? (fallback)`, and slots (`soNumberSlot`, `actionsSlot`) appear in the fallback too — so they show on the **non-billing** face. Slots are **never automatically billing-only**; gate styling/behaviour *inside* the slot with `billingV2 ? … : …`. **This leaked twice in `0a8582e3` (green pill + Order No box) before being caught and fixed in `d5a896b3`.**
- **Shared cards render on both faces.** `ShipToCard`/`BillToCard` have one consumer (`review-view`) that also renders the non-billing focus view. Don't restyle the card — **filter/gate at the call site** (that's how the chip removal + min-height were done).
- **`grid-cols-2` cards share a row height** (`align-items: stretch`). A `min-h` on one card alone often does nothing — the taller card wins. Floor **both** children (`[&>div]:min-h-[…]`).
- **Auto-punch sets `status:"punched"` with NO `soNumber`** (`handlePunch`). Any "is this an edit?" detector must include `&& !!soNumber`, or it mis-flags a genuine first punch as an edit and drops its grace (row vanishes).

---

## 4. Canon corrections (apply during consolidation)

- **Attendance is NOT a `UniversalHeader` consumer** — it has its own header component. The shared-header roster is **Tint ×5 + Sampling + Trips = 7** (fix wherever the resume/CLAUDE_UI implies 8 incl. Attendance).
- **`billing-header-v7.html` mock does not exist** in the repo — the search spec lived only in the resume text.
- **`components/billing/billing-order-info.tsx` is now ORPHANED** (the ⓘ was removed). Left in place per the no-deletions rule; retire in a cleanup pass.
- **Live RBAC table is `role_permissions`** (seed's `role_page_permissions` is stale); live also has a `user_roles` table. The `operations` role is id 12 ("Operations User"); the billingV2 pilot user is id 20.
- **Import authority lives in THREE places** (all now include operations): the inline `canImportOBDs` allow-list in `mail-orders-page.tsx`, the `requireRole` array in `app/api/import/obd/route.ts`, and the `role_permissions` RBAC grant checked by `checkPermission(..., "import_obd", "canImport")`. (The 5 `components/tint/*` copies of the client allow-list still lack `operation_manager`/`operations` — drift, not touched.)

---

## 5. Deferred (each its own session)

1. **DATA PLUMBING (NEXT SESSION):** verify orders → Floor Control and Floor → Picking end-to-end — the dual-write actually lands, the known Picking data issue on the billing face, and clear the **test-marked bills** created during the pilot.
2. **Widen rollout:** flip the `billingV2` stage from `TEST_USERS_ONLY` → `ALL_USERS` — a flag flip, low risk *because* the gating held. Do the plumbing check first.
3. **Post-rollout flag cleanup:** collapse all the `billingV2 ? new : old` forks down to the new version and delete the preserved OFF-path code; retire `billing-order-info.tsx`.
4. **Table view retirement:** per `archive/RETIREMENT-PLAYBOOK.md` (dependency list first, gates, `git mv`, correct every doc that mentions Table). Its own careful session, after rollout is stable.
5. **108px card floor** is an estimate (couldn't render to measure) — tune once eyeballed. Floor-not-cap, so it can only leave slack or residual wobble on the billing face; it cannot affect the OFF path.
6. **Global rename Mail Orders → Billing** (still gated to the billing face only).

---

## 6. Files touched this session

- `components/universal-header.tsx` — neutral props: `searchLayout: "compact"|"wide"|"wide-right"`, `showShortcutsButton`, `importVariant: "default"|"primary"`. Imports nothing from `components/billing/`, never calls `useBillingV2()`.
- `components/header-shortcuts.tsx` — **NEW**, extracted shortcuts button+popover (controlled/uncontrolled like HeaderFilter).
- `components/mail-orders/instructions-strip.tsx` — `tone: "default"|"violet"` (default = original gray).
- `app/(mail-orders)/mail-orders/review-view.tsx` — the bulk of the billing face (rail head, ribbon row, soNumberSlot arms, reopen behaviour, notes button, signals filter, card min-h).
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — header wiring, `handleSaveSoNumber({isEdit})`, `canImportOBDs`.
- `components/billing/billing-tab-bar.tsx` — caption removed, `ml-auto` moved to keep right-alignment.
- `app/api/import/obd/route.ts` — `requireRole` += `ROLES.OPERATIONS` (permission grant).
- **UNMODIFIED, verified:** `meta-ribbon.tsx`, `ship-to-card.tsx`, `bill-to-card.tsx`, `mail-orders-table.tsx`.

---

## 7. Human hand-checks outstanding (Claude Code cannot log in)

- Operations user actually sees and can use **Import** (permission granted end-to-end, not just the button).
- A **non-billing screen** (Tint Manager / Trips) is unchanged: clock still ticking, compact 180→260 search, plain Import in the right cluster, keyboard button still in its header.
- The billing **punch / edit / reopen** behaviours in situ (no bounce on edit; × returns to "All caught up"; reopened order opens on the right).

---

*Consolidation note: this is a `code-update` (shipped reality) — merge into `CLAUDE_MAIL_ORDERS.md` (and the §3 landmines into CORE, §4 corrections across CLAUDE_UI + the router). Archive `code-resume-2026-07-31-billing-v2-ui-batch.md` once merged; it is fully superseded by this file.*
