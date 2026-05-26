# /order Mobile UX Overhaul — Session Close

**Date:** 2026-05-15
**Scope:** Public `/order` page (file: `app/order/page.tsx`)
**Status:** Shipped to production via direct-to-main commits
**Tested on:** iPhone 13 Chrome + Safari, real-device flow

---

## TL;DR

Started with iPhone 13 real-device testing that revealed the public `/order` page was broken for mobile use: iOS auto-zoom on qty inputs, keyboard covering inputs, picker action bar disappearing during scroll, no auto-keyboard control, packs hidden behind previously-added products on next-product transitions, and a generally amateur visual layer that didn't feel like a production tool.

Ended with a calm, professional-grade mobile order form Sales Officers can use one-handed to enter 7+ products without thinking about the UI. Page header collapses sensibly between three states. Picker bar always visible during qty entry. Auto-scroll lands the user on the right packs for the current product. Bill summary chip gives at-a-glance order size. Qty entry works both with +/− buttons (no keyboard) and direct number tap (keyboard opens then).

---

## Diagnosis-first approach used throughout

Every fix went through:
1. **Real-device recording captured by user** → reviewed frame-by-frame
2. **Read-only Claude Code diagnosis prompt** → confirmed root cause with file:line evidence
3. **Single-step Claude Code fix prompt** → one concern per commit
4. **Real-device verification** → confirmed fix before next step
5. **Revert when wrong** → e.g. Phase 3 sticky-bar lift was reverted when it broke the qty card

Phases were intentionally small and sequential. When a phase made things worse (Phase 3), it was reverted via `git revert` (no force-push) and the diagnosis was redone before the next attempt.

---

## Phases shipped (in order, all on `main`)

### Phase 1 — iOS auto-zoom fix (qty input 16px)

**Root cause:** Qty input on Set Quantities screen had `text-[14px]`. iOS WebKit (Safari + Chrome on iOS) auto-zooms any input below 16px on focus. The zoom shifted the layout left, pushing pack labels (1L, 4L, 10L, 20L + "per N" subtitles) off-screen.

**Fix:** Single class change at `app/order/page.tsx:1750` — `text-[14px]` → `text-[16px]`.

**Commit:** `fix(/order): bump qty input to 16px to stop iOS auto-zoom`

**Note:** Every other input on the page (customer search, ship-to, product search) was already 16px. Only the qty input shrank below the iOS threshold. Android Chrome does NOT auto-zoom — fix is iOS-only impact, no Android regression.

### Phase 2 — scrollIntoView on qty input focus

**Root cause:** When user tapped a qty input near the bottom of the pack list (e.g. 20L), the keyboard would open and cover the focused row. No auto-scroll was wired.

**Fix:** Extended the qty input's onFocus handler at `app/order/page.tsx:1748`:
```tsx
onFocus={(e) => {
  e.target.select();
  requestAnimationFrame(() => {
    e.target.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}}
```

`requestAnimationFrame` defers the scroll one frame so iOS has begun the keyboard reflow before measurement.

**Commit:** `fix(/order): scroll qty input into view on focus (iOS keyboard)`

### Phase 3 (REVERTED) — visualViewport-aware sticky bottom bar

**Attempted fix:** Hook that listened to `window.visualViewport.resize` and translated sticky bottom bars by the keyboard height to "lift" them above the iOS keyboard.

**Result on iPhone:** Bar lifted UP THROUGH the qty rows and ended up covering the focused row. Worse than no fix.

**Reverted with:** `git revert <hash>` (no force-push, no history rewrite). Standard direct-to-main workflow per CLAUDE_CORE.md §3.

**Lesson:** Don't fight iOS's sticky-position quirks with JS math. Move the bar to a place that doesn't need lifting in the first place.

### Phase 4 — Move action bar to TOP of qty card

**Root cause of Phase 3 failure:** The Skip / Next bar was at the bottom of the qty card and the keyboard kept covering it. Trying to lift it didn't work.

**Fix:** Moved the Skip / Next bar from the bottom of the qty card to the top, immediately under the product name header. Removed `sticky bottom-0` and the Phase 3 useKeyboardOffset hook.

**Commit:** `fix(/order): move qty action bar to top of card, revert keyboard offset hack`

### Phase 5 — Sticky bar at top of card (partial; superseded)

**Fix:** Added `sticky top-0 z-10` to the relocated bar so it'd stay visible during in-card scroll.

**Result:** Worked when keyboard closed. Failed when keyboard open AND user tapped bottom packs — the whole card slid past viewport top, taking the sticky bar with it.

**Commit:** `fix(/order): pin qty card action bar sticky to card top`

This was later superseded by Phase B's unified header.

### Phase A — Skip auto-focus on mobile (Concern 2 fix)

**Root cause:** The mode-transition focus effect at `app/order/page.tsx:1346` called `packInputsRef.current[0].focus()` whenever picking started or a Next → advance happened. This forced the iOS keyboard up immediately on entering Set Quantities, hiding half the screen and triggering the iOS-Safari scrollIntoView race that was making the picker bar disappear.

**Fix:** Guard the focus call with a desktop check:
```tsx
const isDesktop =
  typeof window !== "undefined" &&
  window.matchMedia("(min-width: 768px)").matches;
if (isDesktop) {
  packInputsRef.current[0]?.focus();
}
```

Desktop users (hardware keyboard) keep their auto-focus. Mobile users get a calm Set Quantities screen with no keyboard. They tap +/− buttons OR tap the qty number to bring up the keyboard on demand.

**This single fix solved two concerns at once:**
- Picker bar reliably visible at top during picking (no more iOS race)
- Skip auto-focus on mobile (user-facing intent)

**Commit:** `fix(/order): skip qty input auto-focus on mobile`

### Phase B — Unified sticky header (3 states)

**Design problem:** Three separate top-of-page elements (Place Order page header, the rounded customer card tile, the picker bar) were competing for sticky top-0 and creating an unprofessional "stacked tiles" look.

**Fix:** Collapsed all three into ONE unified `<header>` element that swaps content based on state:

| State | Trigger | Header content |
|---|---|---|
| 1 — No customer | `selectedCust === null` | `[logo] Place Order / JSW Dulux · Surat Depot` |
| 2 — Customer locked, browsing | `selectedCust && !anyBillInPicking` | `{customerName}` (16px semibold) / `{customerCode}` (12px gray) / `Change` button |
| 3 — Customer locked, picking | `selectedCust && anyBillInPicking` | Row A: `{customerName}` (small gray) · `N of M`<br>Row B: `{productName}` (17px semibold, with `border-b border-gray-200`)<br>Row C: `[Skip ghost] [Next → {nextName} / + Add All to Bill]` |

**Header is edge-to-edge** (no margin, no rounded corners on the outer header), `sticky top-0 z-30`, `bg-white border-b border-gray-200`. Looks like real app chrome.

**Key UX rule established:** *Once a customer is locked, the page header ("Place Order · JSW Dulux · Surat Depot") disappears.* The customer header IS the page identity from that point. Hides redundant branding chrome and frees vertical space.

**Commit:** `feat(/order): unified sticky header — branding / customer / picker states`

### Phase C — Auto-scroll packs to top on picking entry/advance

**Root cause:** When user advanced to next product via Next →, the new product's pack rows weren't at the top of the body. Above them sat previously-added products and the search query that brought the user there. User had to scroll past clutter to find the packs.

**Fix:** Added a useEffect inside BillCard:
```tsx
useEffect(() => {
  if (bill.mode !== "picking" || !bill.activeProduct) return;
  const id = requestAnimationFrame(() => {
    const firstPack = packInputsRef.current[0];
    if (!firstPack) return;
    const row = firstPack.closest("[data-pack-row]") as HTMLElement | null;
    const target = row ?? firstPack;
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  return () => cancelAnimationFrame(id);
}, [bill.mode, bill.activeProduct?.id]);
```

Fires once on picking entry AND once per `activeProduct.id` change. Plus added `scroll-mt-[140px]` to each pack row so the scroll target lands cleanly below the sticky header. Plus added `data-pack-row` attribute to the pack row wrapper as a stable scroll-target marker.

NO focus call (so no keyboard pops up). Just a scroll.

**Commit:** `feat(/order): auto-scroll packs to top on picking entry/advance`

### Polish batch — Final visual pass

Five small visual improvements in one commit:

1. **(REMOVED in cleanup)** Thin teal progress strip between Row B and Row C of picker header. Filled by `((idx+1)/total) * 100%` width on a `bg-gray-100` track. Removed because it looked like a decorative separator, not progress info — the "N of M" text already conveys progress.

2. **Skip button demoted to ghost** in picker Row C. From `bg-gray-100 text-gray-700 text-[14px] font-medium` to `text-gray-500 text-[13px] font-medium` (no background). Visual weight now strongly favors the green Next button.

3. **Single-pack sizing.** When `sortedPacks.length === 1`, pack row uses `py-[18px]` instead of `py-[10px]`, and pack label uses `text-[16px]` instead of `text-[14px]`. Single-pack products (Acotone tinters, etc.) feel comfortable, not dwarfed by surrounding page chrome.

4. **Dashed underline qty hint.** When qty is 0, the qty input has `border-b border-dashed border-gray-300`. When user enters a value, underline disappears. Subtle "tap to type" cue without verbose helper text.

5. **Bill summary chip.** Above the cart lines, the BILL label now reads `BILL N · X products · Y units` where:
   - `X products` = `cart.length` (with pluralisation)
   - `Y units` = sum of all `packQtys` values across all cart lines (with pluralisation)
   Gives at-a-glance order size for operators handling 5+ product orders.

**Commit:** `polish(/order): progress strip, summary chip, single-pack sizing, ghost skip, qty hint`

### Cleanup commit — Remove progress strip, strengthen Row B border

**Real-device feedback:** Progress strip looked like a heavy decorative teal line, not actual progress information. The "N of M" text in the corner already does the job better.

**Fix:**
- Removed the `<div className="h-[3px] bg-gray-100 mx-[14px]">...</div>` block entirely.
- Re-added `border-b border-gray-200` to Row B's wrapper (had been removed when the strip was added). Slightly darker than the previous gray-100 to give clearer visual separation between product name and Skip/Next buttons.

**Commit:** `polish(/order): remove progress strip, strengthen product name border`

---

## Engineering rules respected throughout

Per CLAUDE_CORE.md §3:

- All commits directly to `main` (no feature branches, no PR workflow).
- `git revert` used for the Phase 3 rollback — no force-push, no history rewrite.
- `npx tsc --noEmit` passed clean before every commit.
- No new npm packages added.
- No new files created.
- No `prisma.$transaction`, no `prisma db push` (this session was UI-only, no schema changes).
- No body or html overflow rules added.
- Single file edited throughout: `app/order/page.tsx`.

---

## Files / structure changes

**File touched:** `app/order/page.tsx`

**Structural changes inside the file:**

| Before | After |
|---|---|
| Page header sticky `top-0 z-10` ALWAYS rendered | Page header sticky `top-0 z-10` rendered ONLY when `!selectedCust` (no customer) |
| Customer card rendered as rounded white tile inside `CUSTOMER` section | Customer info rendered INSIDE the unified header (STATE 2). Tile in section deleted. |
| Picker bar (Skip/Next) sticky-bottom inside qty card | Picker bar rendered INSIDE the unified header (STATE 3, Row C) |
| Progress dots + product header rendered inside qty card | Moved INTO unified header (Row A / Row B). In-card duplicates deleted. |
| `<main>` had no explicit top child | `<header>` is now the first child of `<main>`, always present, content swaps by state |

**No DB changes. No API changes. No new endpoints. No new hooks (except internal useEffects added inline).**

---

## Key UX decisions (for future maintainers)

1. **Header collapses when customer is locked.** Mental model: header chrome is only useful as page identity for first-time visitors. Once you have a customer locked, you're inside a task — the customer name IS the new page identity.

2. **No keyboard auto-open on Set Quantities (mobile).** Mobile is touch-first. Forcing the keyboard up the moment a user enters qty entry breaks the "tap to interact" promise. Users choose: +/− buttons (no keyboard) or tap qty number (keyboard).

3. **Auto-scroll on picker entry/advance is scroll-only, not focus.** Avoids the iOS-Safari scrollIntoView + keyboard race that broke earlier attempts.

4. **Sticky bar lives at page level (inside `<header>`), not inside cards.** Pinning to a card top fails when the card itself scrolls off-screen. Page-level sticky is reliable.

5. **No visualViewport listeners. No CSS env(keyboard-inset-height).** All keyboard-related behavior is either (a) prevented by skipping auto-focus on mobile, or (b) handled by the standard sticky positioning that works once the auto-focus race is removed. Phase 3 proved that fighting iOS keyboard math with JS creates more bugs than it solves.

6. **Edge-to-edge header, no rounded corners.** Rounded cards = content tiles. Edge-to-edge bar = app chrome. The customer/product context is chrome, not content.

7. **Skip button is intentionally low-visual-weight.** Skip is used <5% of the time. Next is the primary action. Visual hierarchy should reflect that.

8. **Dashed underline only on zero qty.** A subtle "tap to type" affordance that disappears once filled — no visual noise on a filled bill.

---

## Phase 1 → Phase 2 → Phase A: the corrected ordering

For the record, the *correct* fix order (in retrospect) for "qty input UX on iPhone" was:

1. Phase 1 — Stop iOS auto-zoom (16px input)
2. Phase A — Skip auto-focus on mobile (prevents keyboard race AND keeps picker bar reliably visible)
3. Phase 2 — scrollIntoView on manual qty tap (belt-and-suspenders when user does choose to type)

Phase 3's "fight iOS sticky math with JS" was the wrong path. The right path was "stop triggering the situation that breaks iOS sticky math."

---

## What was NOT done (deferred)

- **Slim customer chip in STATE 2** (originally "Concern 3"). Resolved naturally by Phase B's edge-to-edge customer header. No longer needed.
- **Progress strip / visual progress indicator.** Tried, removed. The "N of M" text in the corner is enough.
- **Confirmation dialog when tapping "Change" customer.** Decided against — would slow the 95% case for the 5% case.
- **Animation on header state transitions.** iOS Safari sticky + animation often glitches. Instant snaps are safer.
- **Qty input pill background variations** (alternating, transparent when inactive, etc.). Deeper UX rework, deferred.
- **`/place-order` (desktop, auth'd) parity.** Out of scope this session. The `<1024px` viewport guard still redirects to `/order` so depot operators on phones get the fixed page either way.

---

## To consolidate into CLAUDE_PLACE_ORDER.md

The following points should be added to `CLAUDE_PLACE_ORDER.md` during the next consolidation pass:

- `/order` page now uses a single unified sticky header with 3 states (branding / customer-locked / picking).
- Page header ("Place Order · JSW Dulux · Surat Depot") is hidden when `selectedCust` is non-null.
- Qty input is `text-[16px]` (iOS auto-zoom prevention).
- Mode-transition auto-focus to first qty input is desktop-only (`matchMedia("(min-width: 768px)")`).
- Pack row has `data-pack-row` attribute + `scroll-mt-[140px]` for the picker-entry auto-scroll target.
- Picker Skip button is ghost styling (text-only, gray-500); Next button is the primary teal.
- Single-pack products render with `py-[18px]` and `text-[16px]` label (vs default `py-[10px]` and `text-[14px]`).
- Qty input has dashed underline when value is 0.
- Bill label renders as `BILL N · X products · Y units` when cart is non-empty.

---

**End of session close doc.**
