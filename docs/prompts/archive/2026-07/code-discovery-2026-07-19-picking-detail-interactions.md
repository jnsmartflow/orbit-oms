# Code discovery — Picking detail-screen interactions (back-nav, swipe, tab-hide)
# 2026-07-19 · Read-only discovery, no app code touched

Source of truth is the live code. Files read in full for this task:
`components/picking/picking-mobile-shell.tsx` (174 lines),
`components/picking/picking-board-mobile.tsx` (1704 lines, full),
`components/shared/workflow-tab-bar.tsx` (86 lines),
`app/api/picking/order/[orderId]/route.ts` (84 lines, the on-demand line-items
route CLAUDE_PICKING §5 references). No disagreement found between the docs
and the code — post-Stage-4 line numbers below are current as of this read.

---

## Q1 — Detail open/close today

**Open — `openDetail(orderId: number)`**, `picking-board-mobile.tsx:715-724`:
```ts
function openDetail(orderId: number): void {
  setDetailOrderId(orderId);
  setDetailOpen(true);
  setDetailSearching(false);
  setDetailQuery("");
  setActivePackFilter("ALL");
  setCheckedLineIds(new Set());
}
```
**Only a single `orderId` (number) is passed in — never the whole row
object.** Called from four tap sites, all `() => openDetail(row.orderId)`:
Assign-tab card (line 1117), "Needs check" `CheckCard` (line 1197), "Still
picking" `CheckCard` (line 1216), Checked-tab `CheckCard` (line 1257).

The detail screen then re-derives the row itself via `useMemo`
(`detailRow`, lines 707-713): `data.rows.find(r => r.orderId ===
detailOrderId)` — looked up **fresh from the shared `data` on every render**,
not a captured snapshot, so it reflects the latest fetch. Line items are a
**separate on-demand fetch**, `useEffect` keyed on `detailOrderId`
(lines 481-507) hitting `GET /api/picking/order/${detailOrderId}` — confirmed
via the route file: session + `canView(picking)` gate, resolves
`orders.obdNumber` from the id, reads `import_raw_line_items` WHERE
`obdNumber` matches AND `lineStatus: "active"`, maps to
`{id, name, sku, pack, qty}`.

**Close — `closeDetail()`**, lines 726-728: plain `setDetailOpen(false)`.
Called from the header Back button (line 1328, `onClick={closeDetail}`).
**Two OTHER exit paths bypass `closeDetail()` entirely** — `handleAssign`
(line 818) and `handleApprove` (line 891) both call `setDetailOpen(false)`
directly as a side effect of a successful API call, not via the named
function. **`handleUndo` (lines 833-866) does NOT close the detail at all**
— after an Undo, the screen stays open and `detailRow` simply re-resolves
against the freshly-refetched `data` (the row still exists, just with
`isAssigned`/`assignedToName` changed).

**No `history.pushState`/`popstate` anywhere** — confirmed by grep across
`components/picking/**`: zero matches for `history.`, `popstate`, or
`pushState`. This verifies the `/po` discovery file's "maps to Picking" note
that this mechanic has not been ported. Concretely: Android hardware back or
an iOS edge-swipe on an open detail screen today does **not** close it — it
navigates the browser itself (away from `/picking`, or to whatever the
browser's actual previous history entry is), not the in-app overlay. None of
the five other overlays in this file (route sheet, Check-tab picker filter
sheet, Checked-tab picker filter sheet, the shared Assign-to-picker sheet
opened from either the bulk bar or the detail screen) push history either —
same gap, same scope.

**Detail screen z-index vs. the shared bottom bar:** the detail root is
`fixed inset-0 z-[35]` (line 1318). The shared bar — whether `WorkflowTabBar`
(`workflow-tab-bar.tsx:38`) or the default nav (`mobile-shell.tsx`, not
re-quoted here, unchanged since Stage 2) — is `z-40` in both cases. **`35 <
40`, so yes, the shared bar currently paints OVER the open detail screen.**
This is not incidental — it's exactly why the detail's own three bottom CTAs
read `paddingBottom: MOBILE_NAV_CLEARANCE` (lines 1542, 1565, 1586), with an
explicit comment (1534-1538) recounting the bug this fixed: before that
padding existed, the CTA rendered *behind* the fixed bar with only a sliver
visible above it.

---

## Q2 — Ordered-list availability (for swipe between bills)

**No dedicated "current index" state exists today** — only `detailOrderId`
(identity) is tracked; the row is re-found by `.find()`, never by index.

But the ORDERED lists themselves are already fully computed and in scope
inside `PickingBoardMobile`, one per tab/section, all `useMemo`-derived
straight from the shared `data` (no refetch needed for a next/prev):

| List variable | Lines | Rendered by |
|---|---|---|
| `filteredWaiting` | 565-572 | Assign tab (`.map()` at line 1096) |
| `filteredNeedsCheck` | 636-643 | Check tab, "Needs check" section (line 1191) |
| `filteredStillPicking` | 627-634 | Check tab, "Still picking" section (line 1210) |
| `filteredChecked` | 652-664 | Checked tab (re-sorted newest-first, line 1250) |

Since the Check tab has **two** sections sharing one `activeTab === "check"`
state, "the current tab's list" is ambiguous for bills opened from Check —
building next/prev requires knowing not just `activeTab` but which SPECIFIC
section (`filteredNeedsCheck` vs `filteredStillPicking`) the tapped card came
from. Nothing today captures that at open time — `openDetail()` only takes
`orderId`.

**Why filter changes can't invalidate the list while detail is open:** the
detail screen is `fixed inset-0` with an opaque `bg-[#f9fafb]` — it fully
covers and blocks interaction with the board's filter chips underneath, so a
user cannot change `activeType`/`activeRoute`/search while detail is open.
The only thing that can change the underlying list while detail is open is a
background `refetchQueue()` — and the only handler that both mutates data
AND leaves the detail open is `handleUndo` (per Q1) — worth a defensive note
for #3 below (recompute the index from the live list on each navigation, not
a frozen array captured at open time).

---

## Q3 — Hiding the tabs while detail is open

**`PickingMobileShell`'s `SupervisorPickingShell`** (`picking-mobile-shell.tsx`)
computes `workflowTabs` unconditionally from `data` (lines 140-151) and feeds
it straight into `<RoleLayoutClient workflowTabs=... activeTabKey=...
onTabChange=...>` (lines 158-166). **It has no visibility into `detailOpen`
at all today** — that boolean lives entirely inside `PickingBoardMobile`
(line 434, `const [detailOpen, setDetailOpen] = useState(false);`), a
descendant rendered via `{children}` deep inside
`<PickingBoardContext.Provider>` (line 168). Context in this codebase flows
one direction (provider → descendants); nothing today lets a descendant
report state back up to `SupervisorPickingShell`.

**Cleanest hook, mirroring the exact pattern already used for `activeTab` in
Stage 3:** lift `detailOpen` into `SupervisorPickingShell`'s own state (or
add `detailOpen`/`setDetailOpen` to the existing shared
`PickingBoardContextValue`, the same object `data`/`activeTab`/`refetchQueue`
already travel through) so `PickingBoardMobile` writes to it via context
instead of a fully local `useState`, and `SupervisorPickingShell` can read it
when deciding what to pass to `<RoleLayoutClient>`.

**The gap this surfaces — passing `workflowTabs={[]}` does NOT hide the
bar.** `MobileShell`'s own branch (`mobile-shell.tsx`, unchanged since
Stage 2): `const hasWorkflowTabs = workflowTabs !== undefined &&
workflowTabs.length > 0;` — an empty array is falsy here, so the bar falls
back to rendering the **default Home/Menu/You nav**, not nothing. Making the
bar disappear entirely (not revert to the default) requires a genuinely new
third branch in `mobile-shell.tsx` — e.g. an explicit `hideBar?: boolean`
prop checked before the `hasWorkflowTabs` check. This is the one item in
this whole interaction set that touches a file outside `components/picking/`.

**Detail's own CTA is structurally independent of the shared bar and is
unaffected either way.** The three CTAs (Assign to picker / Undo / Approve,
lines 1539-1602) are `shrink-0` flex children living **inside the detail
screen's own `fixed inset-0 z-[35]` container** — not part of
`WorkflowTabBar` or `MobileShell` at all. Hiding the shared bar changes
nothing about where or whether the CTA renders. The only side effect: the
CTA's `paddingBottom: MOBILE_NAV_CLEARANCE` (currently necessary because the
bar paints on top, per Q1) would become excess reserved space once the bar is
confirmed hidden — a cosmetic follow-up, not a functional break.

---

## Step 3 — The plan map

### #1 — Back-stays-in-module (detail closes via history.back())
**Mechanism:** the `/po` model exactly — `openDetail()` also calls a new
`pushScreen("detail")` (a `window.history.pushState` + depth-ref increment,
copied from `po-page.tsx`'s pattern per the earlier discovery), every close
path routes through `window.history.back()` instead of calling `setDetailOpen`
directly, and ONE `popstate` handler closes whichever overlay is topmost.
**Every existing open/close point must join this, not just the header Back
button** — per the `/po` discovery's own rule ("every new screen/overlay MUST
push on open, close via history.back(), and be added to both the popstate
branch and navStateRef — or Back skips/strands"), this includes:
- `openDetail()` (push) / `closeDetail()` (Back button, close)
- `handleAssign`'s `setDetailOpen(false)` (line 818) and `handleApprove`'s
  (line 891) — both success-path closes that bypass `closeDetail()` today;
  each needs to become (or trigger) a `history.back()` too, or its pushed
  entry is orphaned and a later real Back press pops to the wrong depth.
- The five sheets (route, Check-picker, Checked-picker, and the shared
  Assign-to-picker sheet from both its bulk-bar and detail-CTA entry points)
  if they're brought into scope at the same time — same "no history today"
  gap, same fix shape.
**Files touched:** `components/picking/picking-board-mobile.tsx` only — every
piece of relevant state already lives there.

### #3 — Swipe left/right between bills
**Mechanism:** capture which list + index at open time (`openDetail` needs to
know not just `orderId` but which of the four lists in the Q2 table it came
from — Check tab is ambiguous between two sections, so the call sites at
lines 1197/1216 need to pass a discriminator, e.g. `openDetail(row.orderId,
"needsCheck")` vs `openDetail(row.orderId, "stillPicking")`). Derive
`currentIndex = list.findIndex(r => r.orderId === detailOrderId)` **live on
each render** (not frozen at open time — per Q2's Undo staleness note) and
wire `goNext()`/`goPrev()` to `setDetailOrderId(list[currentIndex ± 1].orderId)`,
resetting the same per-open state `openDetail()` already resets. No new
fetch — the line-items effect (keyed on `detailOrderId`) already re-fires
automatically on an id change.
**Conflict with back-swipe:** iOS intercepts a left-edge, left-to-right swipe
as the system "go back" gesture. A custom swipe-to-navigate recognizer on the
detail screen needs to either exclude touches starting within an edge margin
(~20-30px is the common convention) or accept that edge-swipes will trigger
the browser's own back instead of prev/next — a genuine, common conflict
class; flagged here, not solved.
**Files touched:** `components/picking/picking-board-mobile.tsx` only.

### #4 — Collapse the bottom bar to just the CTA in detail
**Mechanism:** per Q3 — lift/share `detailOpen` from `PickingBoardMobile` up
to `SupervisorPickingShell` via the existing `PickingBoardContextValue`
(additive field, same pattern as `activeTab`), then have
`SupervisorPickingShell` pass a new `hideBar` (or equivalent) signal into
`<RoleLayoutClient>` → `<MobileShell>` when `detailOpen` is true.
**`mobile-shell.tsx` needs a genuinely new third branch** — today's binary
`hasWorkflowTabs` check treats an empty/undefined `workflowTabs` as "show the
DEFAULT bar," not "show nothing," so hiding the bar during detail is not
already possible with the current prop shape.
**Files touched:** `components/picking/picking-mobile-shell.tsx` (lift +
forward the flag), `components/picking/picking-board-mobile.tsx` (write
`detailOpen` into context), `components/shared/mobile-shell.tsx` (new hide
branch — the one shared-file touch in this whole plan). Once hidden, the
detail's CTA (already structurally independent, per Q3) keeps working as-is;
its `MOBILE_NAV_CLEARANCE` padding becomes excess space worth trimming in a
follow-up polish pass, not a blocker.

### #2 — Tabs-from-detail (mistap risk)
**Fully resolved by #4.** Once the shared bar renders nothing while
`detailOpen` is true, there is no tab strip visible to mistap at all — the
underlying concern (accidentally switching Assign/Check/Done while looking at
one bill) disappears as a side effect of #4 shipping. No separate work item.

### #5 — Slide-to-done (naming the target for the separate Build B)
**Current button:** the "Approve" CTA, `picking-board-mobile.tsx:1583-1602`
— `<button onClick={() => void handleApprove(detailRow)} disabled={!allLinesChecked
|| approving}>`.
**Underlying call:** `handleApprove` (lines 870-900) — `POST
/api/picking/approve` with `{ orderId: row.orderId }`, 409-aware refetch,
`toast.success`, `setDetailOpen(false)`, `refetchQueue()`.
**For Build B:** a slide/drag-to-confirm control would replace the static
`<button>`'s tap trigger with a drag-release trigger, but should fire the
exact same `handleApprove(detailRow)` call already defined — the
`allLinesChecked` gate and the API call itself need no changes, only the
input mechanism wrapping them changes. Named here per the task's ask; not
built in this discovery pass.

---

## Risk flags

1. **The Back-navigation gap is live today, not hypothetical.** Every
   overlay in this file (detail + 5 sheets) currently ignores Android
   hardware back / iOS edge-swipe entirely — those gestures navigate the
   *browser*, not the in-app overlay. This is the direct precondition for
   #1 and is worth knowing independent of whether #1 ships.
2. **Three non-header exit paths for the detail screen** (`handleAssign`,
   `handleApprove` success side effects, plus `handleUndo` which doesn't
   close it at all) — any history-based closing scheme (#1) must account for
   all of them or risk an orphaned history entry / a stuck extra Back-stop.
3. **`workflowTabs={[]}` is not "hidden," it's "default bar."** Anyone
   reaching for the seemingly-obvious quick fix for #4 (just pass an empty
   array) will get the WRONG bar (Home/Menu/You) rather than no bar — the
   real fix needs a new explicit hide signal in `mobile-shell.tsx`.
4. **Swipe-to-navigate (#3) vs. system back-gesture (#1/iOS)** — both features
   want the same physical gesture region (a left-to-right drag near the
   screen edge). If both ship, their touch-start exclusion zones need to be
   designed together, not independently, or one will eat the other's
   gesture depending on drag start position.
5. **Check tab's two-section ambiguity** (needsCheck vs stillPicking) means
   `openDetail`'s signature itself needs to grow a discriminator for #3 to
   work correctly — a small but real API change to a function called from
   four sites today.
