# /order — Mobile keyboard fix + empty-state row

**Date:** 2026-05-21
**Commits:** `a9137435` (Phase 1), `2a7d248e` (Phase 3)
**Files touched:** `app/layout.tsx`, `app/order/page.tsx`, `app/globals.css`
**Target file for consolidation:** `CLAUDE_PLACE_ORDER.md`

---

## Why this work happened

Real-device Android Chrome test of `/order` failed: user typed "ws 90" in
the product search, search ran, results rendered in the DOM, but were
hidden under the keyboard. User had to dismiss the keyboard to see them,
which made the type → see → tap loop unusable.

iPhone Safari/Chrome already worked because iOS shrinks the layout viewport
when the keyboard opens. Android Chrome does not. The app must do it
manually via the Visual Viewport API.

A second bug surfaced during diagnosis: zero-match queries (e.g. "xyz")
rendered absolutely nothing — no message, no count, no spinner. User
could not tell if search was broken or just empty.

---

## Path note — /order page location

The `/order` route lives at **`app/order/page.tsx`**, NOT
`app/(public)/order/page.tsx` or `app/(public)/order/place-order-page.tsx`.
Earlier prompts mistakenly referenced the `(public)` path; the canonical
file is `app/order/page.tsx`. Whitelist for the public route lives in
middleware, not in a route group.

---

## Pattern 1 — Visual Viewport keyboard-aware sizing

### Problem solved
`min-h-screen` (= `100vh`) ignores the keyboard on Android Chrome.
Result: anything in the bottom half of the page hides under the keyboard.

### The pattern

**`app/order/page.tsx`** — add a mount-time effect that writes the real
visible height to a CSS custom property:

```ts
useEffect(() => {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const root = document.documentElement;

  const write = () => {
    const h = vv ? vv.height : window.innerHeight;
    root.style.setProperty("--vvh", `${h}px`);
  };

  write(); // synchronous first write before first paint of <main>

  if (vv) {
    vv.addEventListener("resize", write);
    vv.addEventListener("scroll", write);
    return () => {
      vv.removeEventListener("resize", write);
      vv.removeEventListener("scroll", write);
    };
  }
}, []);
```

**`<main>` element** — drop `min-h-screen`, add inline style + scroll:

```tsx
<main
  style={{ height: "var(--vvh, 100vh)" }}
  className="... overflow-y-auto ..."
>
```

**`app/globals.css`** — fallback so `--vvh` is never unset before JS runs:

```css
html { --vvh: 100vh; }
```

### Rules to remember

1. **Write `--vvh` directly to the DOM, not React state.** `resize` fires
   on every animation frame while the keyboard slides in. Going through
   `setState` causes a render storm. `documentElement.style.setProperty`
   is the right tool.
2. **No rate-limiting needed.** iOS Safari fires `resize` during URL-bar
   collapse on scroll too — `--vvh` shifts a few px, cosmetically harmless.
3. **`overflow-y-auto` on `<main>`** so scrolling happens inside `<main>`
   (which is keyboard-aware), not on the document body (which is not).
4. **Don't pin the search input with sticky/fixed.** Normal document flow
   inside the keyboard-aware container is enough — pinning creates a
   second scroll surface and complicates keyboard nav.

### Same pattern applies to customer search

The fix to `<main>` automatically fixes both screens because `<main>` is
the parent of both customer-pick and product-search. Verified on real
Android device — 3 customer results visible above keyboard after fix.

---

## Pattern 2 — Viewport meta export (Next.js 14 App Router)

**`app/layout.tsx`** — Next.js typed `Viewport` export. Next.js 14.2.29's
`Viewport` type already declares `interactiveWidget`, so a raw `<meta>` tag
is NOT needed:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: "resizes-content",
};
```

### Rules to remember

1. **`maximumScale: 1` + `userScalable: false`** prevents iOS zoom-on-focus
   for any `<16px` input that might slip in later. Today all `/order`
   inputs are 16px+, but this is the guard.
2. **`interactiveWidget: "resizes-content"`** is the Chromium 108+ hint
   that asks the browser to shrink the layout viewport on keyboard open —
   a belt-and-braces measure that does at the meta level what our
   `visualViewport` JS does. Silently ignored on older browsers.
3. **Pick ONE mechanism — typed export OR raw `<meta>` — never both.**
   Next.js warns on duplicate viewport meta tags.
4. **Confirm the Next.js `Viewport` type supports new keys before
   shipping.** Check
   `node_modules/next/dist/lib/metadata/types/extra-types.d.ts`.

---

## Pattern 3 — Empty-state row for in-memory filter search

### Problem solved
Search filter is a synchronous in-memory array scan (no async loading).
Render gate was `inMultiSel && suggestions.length > 0` — zero-match
queries fell out of the gate entirely and rendered nothing.

### The pattern

**Mode flip logic** (`setBillQuery`, around L403):
Originally only flipped mode to `multi-select` when `matched.length >= 1`.
Adjust so the flip happens whenever `query.trim().length >= 2`,
regardless of match count. This lets the empty branch reach the render.

**Render gate** (around L1637):

```tsx
{inMultiSel && bill.searchQuery.trim().length >= 2 && (
  <div className="...same container as result rows...">
    {suggestions.length > 0 ? (
      // existing result rows
    ) : (
      <div className="px-4 py-3 bg-gray-50 text-gray-500 text-base italic">
        No products match &quot;{bill.searchQuery.trim()}&quot;
      </div>
    )}
  </div>
)}
```

### Rules to remember

1. **Escape user input via React text nodes**, never
   `dangerouslySetInnerHTML`. The query is rendered inside the message.
2. **Read query from state, not a frozen snapshot.** Message must update
   live as user keeps typing.
3. **No loading spinner needed for synchronous in-memory filter.** Adding
   one suggests async work that isn't happening — misleading UX.
4. **No results-count chip needed** — pagination dots already hint at
   set size.
5. **Audit `bill.mode` consumers before flipping mode logic.**
   For this fix, 15 mode reference sites were checked. Only the render
   gate (L1361 `inMultiSel`) needed adjustment; all picking-only
   consumers were safely gated by separate conditions (e.g.
   `activeProduct !== null`, `selectedProducts.length === 0` early
   returns).

---

## Diagnostic procedure used (replicable for future mobile bugs)

1. **Get a real-device screenshot.** Don't trust desktop browser
   responsive mode — Android Chrome's keyboard behaviour cannot be
   simulated.
2. **Identify what is page vs what is browser chrome.** The "wasted
   whitespace" in the first Android screenshot turned out to be the
   keyboard's autofill bar, not page space. Clarify before designing
   fixes.
3. **Compare iPhone behaviour as a control.** If iPhone works and Android
   doesn't with the same code, the bug is almost always
   layout-viewport-related (Visual Viewport API, `vh` units, or sticky
   positioning).
4. **Diagnose root cause before any fix.** Five-problem audit
   (P1–P5) was generated before any code touched. Two problems (P2, P3)
   shared the same root cause — Visual Viewport API missing — so one fix
   resolved both.
5. **Real-device test after each phase.** Phase 1 worked so well that
   Phase 2 (scroll-to-top on focus) became unnecessary — skipped without
   shipping.

---

## What was deliberately NOT done

- **No row compaction.** Smart Flow chose to keep result rows at current
  height. 3 results visible above keyboard is acceptable.
- **No scroll-to-top on search input focus.** Phase 1 sizing made this
  redundant.
- **No results count chip.** Pagination dots already convey set size.
- **No loading spinner.** Filter is synchronous.

These can be revisited if real-world depot use surfaces a need.

---

## Acceptance evidence

- Android Chrome real-device: typing "ws 90" → WS Hi-Sheen and WS Max
  visible above keyboard, scrollable to WS Powerflexx without dismissing
  keyboard.
- Android Chrome real-device: typing "xyz" → "No products match 'xyz'"
  row visible above keyboard.
- iPhone Safari real-device: no regression. Same code path uses
  `visualViewport.height` which iOS already shrinks correctly.
- Desktop Chrome: no layout shift. `--vvh` resolves to `window.innerHeight`
  which equals `100vh` when no keyboard.
- `npx tsc --noEmit`: zero errors after both commits.
- `npm run build`: passed both commits. `/order` route 9.3 kB → 9.36 kB.
