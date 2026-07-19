# Session update — Mobile shell → Direction A + Picking detail interactions
# 2026-07-19 · Web-drafted · For consolidation into CLAUDE_UI.md §59 + CLAUDE_PICKING.md §5
# Save to: docs/prompts/drafts/web-update-2026-07-19-picking-direction-a-shell.md

Design + build session. Redesigned the mobile app shell to **Direction A**
(module-native bottom bar), proved it on **Picking**, then added phone-native
navigation to the Picking detail screen. All changes live on `main` and pushed
to production. One approved item (**slide-to-done**) is designed but **not built**.

---

## 1. What shipped (commits on `main`, in order)

| # | Commit | What |
|---|---|---|
| Stage 1 | `5eb0fd7e` | Lift Menu/You/confirm/scrim out of the bottom bar into a provider so they can be opened from anywhere. New `components/shared/mobile-shell-context.tsx`. No visual change. |
| Stage 2 | `b9c7731c` | Give the shared bottom bar an optional "workflow tabs" slot. New `components/shared/workflow-tab-bar.tsx`. Default-safe: no tabs → today's Home/Menu/You. No visual change. |
| Stage 3 | `39c3902c` | Picking adopts Direction A: tabs move to the bottom slot, You-avatar + grid + search move into the header. New `components/picking/picking-mobile-shell.tsx`. First visible change, Picking only. |
| Stage 4 | `37b0b358` | Bottom bar polish: icon-on-top layout matching /po height, per-tab icons, rename **Checked → Done**, count badge (hidden at 0). |
| Build A | `30fbb9fc` | Detail screen phone-nav: in-module back (edge-swipe/hardware back no longer exits Picking), swipe between bills, collapse the bottom bar to just the CTA while a detail is open. Also touched `role-layout-client.tsx` (hideBar pass-through) + `mobile-shell.tsx` (hide branch). |
| Build B | `6bdaff19` | Detail polish: drop the CTA flush to the bottom, Option-1 slide animation on bill paging (finger-tracking), and the "‹ N of M ›" counter in the summary row. |

Files that now make up the shared shell:
`components/shared/mobile-shell.tsx`, `mobile-shell-context.tsx`,
`workflow-tab-bar.tsx`, `role-layout-client.tsx`.
Picking-specific: `components/picking/picking-mobile-shell.tsx`,
`picking-board-mobile.tsx`.

---

## 2. The new reusable architecture (the point of this session)

The mobile shell is now **three separable pieces** instead of one welded block:

1. **`MobileShellProvider`** (in `mobile-shell-context.tsx`, mounted once in
   `role-layout-client.tsx`) — owns the Menu sheet, You sheet, sign-out confirm,
   and scrim. Exposes `openMenu()` / `openYou()` (via `useMobileShell()`) so **any
   descendant** — including a page's own custom header — can open them.
2. **The bottom-bar SLOT** (in `mobile-shell.tsx`) — renders one of three things:
   - **default** Home / Menu / You (when a page supplies nothing),
   - a per-module **`WorkflowTabBar`** (when a page supplies `workflowTabs`),
   - **nothing** (when a page passes `hideBar`).
3. **`WorkflowTabBar`** (`workflow-tab-bar.tsx`) — a generic
   `{key,label,count,icon}[]` + `activeKey` + `onChange` bar. Reusable by any
   future module.

### How a FUTURE module plugs in (Tint Operator, Support, Warehouse, Trip…)
- Supply `workflowTabs` + `activeTabKey` + `onTabChange` through
  `<RoleLayoutClient>` (same threading `navItems` already uses).
- For a Direction-A header, call `openMenu()` / `openYou()` from
  `useMobileShell()` on the header's grid icon / avatar.
- The module only builds its **own tabs + page contents**. The frame, the two
  sheets, and the wiring already exist. **Do not rebuild the shell.**

---

## 3. LANDMINES — do NOT rediscover these

1. **`workflowTabs={[]}` does NOT hide the bar** — an empty array is falsy in
   `hasWorkflowTabs`, so it falls back to the **default Home/Menu/You** bar. To
   hide the bar entirely, use the explicit **`hideBar`** prop — a third branch in
   `mobile-shell.tsx` checked BEFORE `hasWorkflowTabs`. (This is why Build A
   added `hideBar` threading through `role-layout-client.tsx`.)

2. **`WorkflowTabBar` height is copied from the default nav ON PURPOSE.** Its
   buttons reuse the default nav's exact classes (`flex-col items-center gap-1
   py-2` + `h-6 w-6` icon + bare `env(safe-area-inset-bottom)`), so the two bars
   match by construction. The old `min-h-[58px]` guess was **removed** — do not
   reintroduce a fixed height number.

3. **"Done" is a LABEL only.** The third tab's visible text is "Done", but the
   state key / `activeTab` literal / any `workflowStage` value stays **`"checked"`**.
   Renaming the KEY breaks tab switching, the Check-tab split, and the Done-list
   render. Label ≠ key.

4. **`/po` is NOT a consumer of the shared shell.** Grep = zero matches; `/po`
   builds its own Home/Drafts/Sent bar inline in `po-page.tsx`. Shell changes
   never touch `/po`. Do not add "protect /po" guards — it is not on the circuit.

5. **Detail back-nav is a MINIMAL subset of /po's popstate model.** One history
   entry per detail *session* — paging through bills (swipe or counter) does NOT
   stack entries, so a single Back returns to the list, not through every bill.
   `suppressPopRef` was deliberately NOT ported (every close converges on the
   same outcome: close detail, stay on /picking). `depthRef`/`navStateRef` are
   present.

6. **Three non-header detail exits must all be handled by any future nav work:**
   `handleAssign` success (guarded on `detailOpen` so the bulk-bar path doesn't
   misfire a `history.back()`), `handleApprove` success (unconditional
   `history.back()`), and `handleUndo` (unchanged — leaves detail open). Orphan
   one and Back depth desyncs.

7. **Nested picker-sheet during detail:** a back-press while the Assign-to-picker
   sheet floats over the detail closes the **sheet first** (guard on
   `pickerSheetOpen && detailOpen`, then re-push to keep the single detail entry),
   NOT the detail underneath. The other 4 detail-area sheets (route filter,
   check-picker, checked-picker, and the bulk-bar assign sheet) STILL lack history
   support — same known gap, deferred (see §5).

8. **Swipe gesture rules (Build A) — #1 back and #3 swipe SHARE the gesture region:**
   24px edge exclusion (edge = system back, never a bill change), 10px deadzone +
   1.5× axis-dominance lock (vertical scroll coexists), 80px commit threshold, no
   wrap at boundaries. Do not touch one without the other — they were designed
   together to avoid collision.

9. **Detail CTAs no longer use `MOBILE_NAV_CLEARANCE` padding.** Since the bar is
   hidden in detail (Build A), the three CTAs use `max(env(safe-area-inset-bottom,
   0px), 16px)` (the /po footer convention) so they sit flush. `MOBILE_NAV_CLEARANCE`
   is **still** imported and used by `SHEET_GEOMETRY` (list-view sheets) — do NOT
   remove it.

10. **`openDetail` signature is now `(orderId, listKey)`** where `listKey ∈
    waiting | needsCheck | stillPicking | checked`. Needed because the Check tab
    has two sections; prev/next must page the RIGHT list. All 4 call sites pass
    the key. The counter (N of M) reuses the live `detailIndex` / `activeDetailList`
    — do not compute a parallel index. Counter hidden when list length === 1.

---

## 4. Design decisions LOCKED this session (don't re-litigate)

- **Direction A** (module-native bottom bar) chosen over B (split) and C (floating
  FAB). Rationale: workflow tabs belong in the thumb zone; Menu/You demote to the
  header because module-switching is a less-frequent action.
- **Bottom tabs:** Assign · Check · **Done**; icons `Inbox` / `ClipboardCheck` /
  `CheckCircle2` (lucide); count badge hidden at 0; teal only on the active tab.
- **Swipe animation:** Option 1 "slide across" (~260ms, ~0.65× finger-follow).
  Option 3 "card deck" rejected — reads as "dismissed this bill" on a work tool.
- **Bill counter:** Option F — merged into the existing "packs · volume" summary
  row (which is already pinned and never scrolls). NOT a second bar; explicitly
  rejected: header counter (D), pinned strip above Assign (E), arrows flanking
  Assign (crowds/mis-taps).
- **Slide-to-done:** green (not teal — separates "finish" from teal "assign"),
  drag-to-confirm.

### Note for CLAUDE_UI §59 "design history"
§59 currently records that **per-ROLE** bottom tabs were rejected. That still
holds. This session shipped **per-MODULE workflow tabs** (a different idea) via
the reusable slot, for Picking. When consolidating, clarify: per-role rejected;
per-module workflow tabs are the sanctioned pattern, opt-in per page, default
stays Home/Menu/You. Do not let a future reader think module-native tabs were
rejected.

---

## 5. NOT built / open items (future sessions)

- **Slide-to-done (#5) — DESIGNED + APPROVED, NOT BUILT.** Replace the detail
  screen's **Approve** button (`picking-board-mobile.tsx`, the `handleApprove`
  CTA) with a drag-to-confirm control that fires the **same** `handleApprove(detailRow)`
  call (`POST /api/picking/approve`, `{orderId}`). The `allLinesChecked` gate and
  the API are unchanged — only the input mechanism (tap → slide-release) changes.
  Green slide, drag knob fully right to confirm. This was the last planned build
  of the batch; stopped before it by choice.
- **The other 4 detail-area sheets lack Back support** (landmine 7) — same gap
  class the detail had pre-Build-A. Deferred; the /po single-authority popstate
  model is the pattern to copy if/when they need it.
- **`floor_supervisor` still cannot open `/picking`** — pre-existing access gap
  (SQL + seed row prepared, not run — see CLAUDE_PICKING §7). Untouched by this
  session; still open. The whole Direction-A board is currently reachable by
  admin + operations only.
- **Feel-tuning pending real-device confirmation:** the 0.65× drag-follow ratio
  and ~260ms slide are subjective — one-number tweaks if the floor wants
  faster/stiffer.
- **Cosmetic:** the excess CTA padding was already fixed in Build B (landmine 9),
  so nothing outstanding there.

---

## 6. Mockups produced (reference)

- `docs/mockups/picking/mobile-shell-v1.html` — the approved Direction-A shell
  (6 states: Assign/Check/Checked, search, Menu sheet, You sheet). Built in-repo.
- Interaction/animation/counter mocks (swipe options, slide-to-done, counter F)
  were web-side design aids; their **decisions** are captured in §4 above rather
  than the throwaway HTML.

---

## 7. Consolidation guidance (when Claude Code merges drafts)

- **CLAUDE_UI.md §59** — rewrite the mobile-shell section: it's now
  provider + slotted bar (`hideBar` / `workflowTabs` / default) + reusable
  `WorkflowTabBar`. The old "[DEFERRED] shared minimal header + search" is now
  partly realized as Picking's Direction-A header. Add the per-role-vs-per-module
  clarification (§4 note). Carry landmines 1, 2, 3.
- **CLAUDE_PICKING.md §5** — update the mobile board: Direction-A shell, bottom
  workflow tabs (Assign/Check/Done), and the detail screen's in-module back-nav,
  swipe-between-bills, F counter, and collapsed bar. Carry landmines 5–10 and the
  §5 slide-to-done open item.
- This draft supersedes nothing prior; it EXTENDS the shell story. Archive it to
  `docs/prompts/archive/2026-07/` after consolidation.
