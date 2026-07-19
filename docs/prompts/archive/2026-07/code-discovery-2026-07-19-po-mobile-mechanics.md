# Code discovery — `/po` mobile mechanics (for Picking reuse)
# 2026-07-19 · Read-only discovery, no app code touched

Source of truth is the live code, not the docs. Where `CLAUDE_UI.md §55/§59` or
`CLAUDE_PLACE_ORDER.md §25` disagreed with the code (they didn't, materially — the docs
are current), the code wins; discrepancies are called out inline.

Primary file: `app/po/po-page.tsx` (3,824 lines, single-file page). Supporting:
`components/shared/mobile-shell.tsx`, `app/(place-order)/place-order/types.ts`,
`components/picking/picking-board-mobile.tsx` (read for the mapping section).

---

## 1. Sticky + scroll

**Root shell** is a 3-way flex column, not a scroll-padding hack:

```
<main class="fixed inset-0 flex flex-col overflow-hidden">
  [flex-shrink-0 teal brand bar]                     — top, non-scrolling
  <div ref={scrollAreaRef} class="flex-1 min-h-0 overflow-y-auto overscroll-contain">  (line 2345)
    <div class="max-w-[480px] mx-auto flex flex-col min-h-full">                       (line 2346)
      [sticky sub-headers pin WITHIN this scroll container]
    </div>
  </div>
  [flex-shrink-0 footer — footerPill() or reviewFooter() etc.]  — bottom, non-scrolling
</main>
```

Design comment at lines 2339-2344 states the intent directly: the pinned search + every
sticky sub-header pin **inside** the scroll container; the CTA lives in a **non-scrolling
footer sibling below it** — "no sticky-bottom jank, no viewport math."

**Sticky sub-headers** (two instances, identical shape, only bg differs):
- Search/home screen search bar — `sticky top-0 z-30 bg-[#f9fafb] p-4 border-b border-gray-200 shadow-[0_2px_6px_rgba(0,0,0,0.04)]` (line 3161)
- Multi-qty screen header — `sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-[13px] flex items-center gap-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.04)]` (line 3311)

**Gotcha — there is no `pb-[…]` clearance class anywhere for the footer.** Because the
footer is a flex sibling of the scroll area (not `fixed`/`absolute`), content can never be
covered by it — the flex layout itself reserves the space. This is a **different technique**
from `MOBILE_NAV_CLEARANCE`'s `pb-[76px]` approach (§7 below), which exists only because
`mobile-shell.tsx`'s nav is `fixed`, sitting outside the page's own flex tree.

`data-product-section` / `data-field-section` attributes (lines 2870, 2997, 3328) are
**not** a scroll-clearance mechanism — they're anchors the central focusin listener uses to
`scrollIntoView` the right block when a field is focused (§2 below).

---

## 2. Keyboard / overlap

**`keyboardOpen` vs `inputFocused` — two distinct flags, verified strictly separated:**

- `inputFocused` (state, line 662) is set/cleared by a single document-level
  `focusin`/`focusout` listener (lines 838-899) on every managed `<input>`/`<textarea>`
  except the two search inputs. It drives `scrollIntoView` positioning only — it is
  **never** read by any footer/pill visibility check (grep-confirmed).
- `keyboardOpen` (state, line 669) is derived **only** from a real Visual Viewport height
  drop: `(fullH - h) > 120`, debounced ~100ms (lines 935-985). This is the flag that gates
  every floating footer:

```
3742-3744: view === "review"                        → keyboardOpen ? null : reviewFooter()
3748-3754: mode === "multiqty"                       → keyboardOpen ? null : footerPill({...})
3758:      mode === "picking" && activeProduct       → keyboardOpen ? null : pickerFooter()
3762:      mode === "search" && showSelectBar        → keyboardOpen ? null : footerPill({...})
3766:      mode === "search" && !showSelectBar …     → keyboardOpen ? null : footerPill({...})
3784:      draftsEnabled && !selectedCust && …        → !keyboardOpen && (Home/Drafts/Sent bar)
```

Comment at line 3779-3780 states the rule explicitly: gate on `keyboardOpen` like every
other floating footer. **Why this distinction matters (the gotcha):** Android can dismiss
the soft keyboard **without blurring the input** (the "stuck Add button" case) — if a
footer gated on `inputFocused`, it would stay hidden after the keyboard closes. Gating on
the actual measured viewport height fixes this.

**Visual Viewport height write** (lines 935-985): writes `--vvh` CSS var directly to
`document.documentElement.style` — **never** to React state (would cause a render storm).
Guarded by `lastH` so a plain scroll (no keyboard) is a no-op — an earlier unguarded
per-scroll-tick version drifted `<main>`'s height on iPhone (referenced regression commit
`eb3482b1`). Listens to **both** `resize` and `scroll` on `window.visualViewport` — iOS
standalone PWA doesn't always fire a clean `resize` when the keyboard opens; its final
geometry sometimes only arrives via a viewport scroll/offset event.

**iOS auto-zoom prevention:** qty inputs are `text-[16px]` (font-size rule, line ~526) —
below 16px, iOS Safari/WebKit force-zooms on focus. This matches `CLAUDE_UI.md §9`'s
documented rule.

---

## 3. In-page screen navigation (no route change)

**One authority: browser history.** Every forward screen/overlay does exactly one
`window.history.pushState({ poScreen: tag }, "")` via a shared `pushScreen(tag)` helper
(lines 1101-1105); every Back path — hardware Android back, iPhone edge-swipe, or an
in-app Back/Cancel/× button — routes through `window.history.back()`, which is intercepted
by a **single** `popstate` listener (lines 1057-1098).

**The popstate handler** reads a ref (`navStateRef`, kept in sync with live state, lines
730-748 — deliberately a ref and not derived from state directly, "so the handler never
reads a stale closure") and closes exactly the topmost open layer, checked in a fixed
priority order: confirm dialog → cross sheet → call sheet → delete-bill sheet →
delete-draft sheet → delete-sent sheet → receipt (read-only Sent view) → review view →
picking mode → multiqty mode → Drafts/Sent browse screen → build-search (with a discard
guard if the bill has lines) → landing (let the pop through, exit the app).

**Programmatic back()/go() calls set `suppressPopRef = true` first** so their own
popstate doesn't re-trigger the handler's close logic a second time — a raw
`history.back()` call from an in-app button and a real hardware back-press both fire the
same physical popstate event; the ref is what tells the handler "this one was already
handled at the call site, just consume it."

`depthRef` tracks how many entries have been pushed above the base (landing) entry —
incremented in `pushScreen`, decremented on every popstate — used only for bookkeeping
sanity, not for branching logic itself (the branching is state-driven via `navStateRef`).

**Gotcha (documented in the file's own comments, §25 of `CLAUDE_PLACE_ORDER.md`):** every
new screen/overlay MUST (a) call `pushScreen()` on open, (b) close exclusively via
`history.back()`, and (c) be added to both the popstate `if` chain and `navStateRef` — or
Back will skip or strand on it. The Call sheet is called out in the docs as "the worked
example" for adding a new overlay correctly.

**Discard-confirm nuance:** `dismissConfirm()` (lines 1110-1120) branches on whether the
confirm was raised by a Back-press (`backConfirmRef.current === true` → re-push a "build"
entry so Back still has something to pop next time) vs. a button click (New order → let
`history.back()` pop its own pushed entry naturally). This prevents the confirm dialog
itself from silently consuming a history entry when the user backs out of it via Back
rather than Cancel.

**Send-path ordering landmine** (documented at line ~1073 area / `CLAUDE_PLACE_ORDER.md
§25 "iOS/Android keyboard"`): `window.location.href = mailto:...` must fire synchronously
in the same tap-gesture tick; any `history.go()`/reset in the SAME tick cancels the mailto
handoff on mobile. Fix is `setTimeout(…, 0)` around the history reset, with
`depthRef`/`suppressPopRef` still set synchronously so the deferred pop is still absorbed
correctly.

---

## 4. Bottom sheets

**Five confirm/pick sheets share one byte-identical shape:**

```
Backdrop: fixed inset-0 z-50 flex items-end justify-center bg-black/40
          onClick={() => window.history.back()}
Panel:    w-full max-w-[480px] bg-white rounded-t-[18px] p-5
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 20px)" }}
```

| Sheet | Lines | Note |
|---|---|---|
| Cross-depot picker | 3410-3455 | 2×2 depot grid |
| Call (SO/Dealer) picker | 3460-3505 | code comment literally says "CLONE of the Cross-depot sheet" |
| Delete-bill confirm | 3510-3548 | Cancel (gray) / Delete (red) two-button row |
| Delete-draft confirm | 3552-3587 | comment: "same bottom-sheet pattern as delete-bill above" |
| Delete-sent confirm | 3591-3626 | comment: "same bottom-sheet pattern as delete-draft above" |

**Two overlays exist that intentionally do NOT use this shape** — a design decision, not
an inconsistency: the Save-draft/Send success overlay (`fixed inset-0 z-[60] flex
items-center justify-center`, keyframe-animated, lines 3647-3684) and the reset-confirm
dialog (New order / Switch customer — centred card, `rounded-[14px]` not `rounded-t-[…]`,
not bottom-anchored, lines 3687-3726). Both are modal *decisions*, not slide-up *pickers* —
the shape difference signals that semantic distinction.

**Gotcha:** all five sheets dismiss via `onClick={() => window.history.back()}` on the
backdrop — never a direct state setter — so a sheet dismiss always flows back through the
single popstate handler (§3). A sheet built with a raw `setOpen(false)` on backdrop click
would desync history depth from visible state.

---

## 5. Safe-area

Every literal `env(safe-area-inset-…)` usage in `po-page.tsx`, all wrapped in
`max(env(...), <floor>px)` — **never a bare `env()` call** in this file:

| Element | Value | Lines |
|---|---|---|
| All 4 footer builders (`footerPill`/`pickerFooter`/`reviewFooter`/`receiptFooter`) | `max(env(safe-area-inset-bottom, 0px), 16px)` | 2078, 2112, 2149, 2189 |
| Pinned teal brand bar (top) | `max(env(safe-area-inset-top, 0px), 11px)` | 2306 |
| All 5 bottom sheets | `max(env(safe-area-inset-bottom, 0px), 20px)` | 3421, 3471, 3521, 3563, 3602 |
| Home/Drafts/Sent bottom nav bar (page-local, distinct from mobile-shell's nav) | `max(env(safe-area-inset-bottom, 0px), 4px)` | 3787 |

Pattern: footers/nav use a 16px (or 4px) floor, bottom sheets use a taller 20px floor
(more generous — sheets need more resting room from the thumb), the top bar uses an 11px
floor. **`mobile-shell.tsx`'s own fixed nav bar breaks this convention** — it uses a bare
`env(safe-area-inset-bottom)` with no `max(...)` floor (line ~ in that file) — worth
flagging as a minor inconsistency if the two shells are ever merged.

---

## 6. Filter chips / segmented controls / pills

**Dispatch chips** (Normal · Urgent · Call — 3-across grid, lines 2924-2954):
```
container: grid grid-cols-3 gap-2
shared shape: h-[42px] rounded-[10px] border text-[13px] flex items-center justify-center gap-1.5
active:   {per-value "on" class} + font-semibold
inactive: border-gray-200 bg-white text-gray-400 font-medium
  Normal "on" → border-teal-500 bg-teal-50 text-teal-700
  Urgent "on" → border-amber-300 bg-amber-50 text-amber-700
  Call   "on" → border-red-300 bg-red-50 text-red-700
```

**Order Remarks 2×2 grid** (Truck/Cross/Bounce/DTS, lines 2956-2981):
```
container: grid grid-cols-2 gap-2
shared shape: h-[42px] rounded-[10px] border text-[13px] flex items-center justify-center
active:   border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold
inactive: border-gray-200 bg-white text-gray-400 font-medium
```
Cross-depot / Call-target chips inside their sheets (lines 3434-3452, 3484-3502) reuse
this exact indigo active/gray-inactive convention, at a taller `h-[48px] rounded-[10px]
border text-[15px]` shape.

**Bill selector chips** (lines 3066-3125): inactive is a plain text button
(`shrink-0 text-[14px] text-gray-500 px-2 py-[3px]`, no border/bg); active is a filled pill
(`shrink-0 flex items-center gap-1 text-[14px] font-semibold text-teal-700 bg-teal-50
border border-teal-200 rounded-full pl-3 pr-1 py-[3px]`) with an inline circular × delete
button (`w-[19px] h-[19px] rounded-full bg-teal-600 text-white`).

**Multi-select iOS-style switch** (lines 3130-3141):
```
track: relative w-[46px] h-[26px] rounded-full transition-colors shrink-0
       ON → bg-teal-600 / OFF → bg-gray-300
knob:  absolute top-[2px] left-[2px] w-[22px] h-[22px] rounded-full bg-white shadow
       transition-transform, ON → translate-x-[20px]
```
This differs from `CLAUDE_UI.md §11`'s documented `IosToggle` sizes (36×20 / 46×26) — the
46×26 large variant matches here, confirming the doc is accurate for this control.

**Multi-select row checkbox** (lines 3259-3265): `w-5 h-5 rounded-[6px] border-2`;
checked = `bg-teal-600 border-teal-600` + white SVG check; unchecked = `bg-white
border-gray-300`. **This exact shape is already copied verbatim into
`picking-board-mobile.tsx`'s `SelectBox`** (§ mapping section below) — direct precedent
for a Picking selection checkbox.

---

## 7. Anything else reusable

**Shadow tokens** (lines 206-211):
```js
SOFT_CARD_SHADOW    = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)"
ENRICHED_ROW_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 4px 14px rgba(16,24,40,0.05)"
```
Code comment explicitly warns "do not merge with SOFT_CARD_SHADOW" — they read almost
identical but are pixel-matched to two different approved mocks (plain cards vs.
Drafts/Sent "enriched rows"). **`SOFT_CARD_SHADOW` is already lifted verbatim into
`picking-board-mobile.tsx`** with a comment crediting the source.

One-off `boxShadow` literals (not named constants): CTA pill glow
`"0 8px 22px rgba(13,148,136,0.42)"` (used at 3 call sites), customer-search hero shadow
`"0 8px 28px rgba(17,24,39,0.09)"` (matches `CLAUDE_UI.md §55`'s documented landing-search
shadow exactly).

**Header title-swap is two stacked headers, not one morphing element:** (1) a pinned teal
brand bar, always present, swaps its own inline content between a "Purchase Order · Surat
Depot" subtitle and a "New order" button depending on `selectedCust`; (2) a separate white
"customer identity" header block that only renders at all once `selectedCust` is set
(name/code/area + favourite star). Two components, not a single conditionally-restyled
one — worth knowing before trying to build Picking's header as one morphing block.

**Press states are `active:` variants throughout, not `:hover`** — e.g. `active:bg-gray-50`,
`active:bg-teal-700`, `active:opacity-90`, `active:text-gray-600`. No reliance on hover
anywhere in the mobile surface (correct for a touch-only device).

**Floating CTA pill itself** (`footerPill()`, lines 2068-2100) — rounded-full, `padding:
"15px 34px"`, teal `bg-teal-600 active:bg-teal-700`, disabled state
`bg-gray-200 text-gray-400 cursor-not-allowed`, glow shadow when enabled / `none` when
disabled. Three sibling builders share its outer shell exactly (`flex-shrink-0
bg-[#f9fafb] flex justify-center px-4 pt-3` + the 16px-floor safe-area padding) but swap
the inner button(s): `pickerFooter()` (Cancel ghost + "Add to Bill N" teal, 2108-2135),
`reviewFooter()` (single pill OR a two-button Save-draft/Send-order bar depending on
`draftsEnabled`, 2142-2180), `receiptFooter()` (Edit order outline + Resend teal,
2185-2210).

---

## How this maps to the Picking shell

**`components/picking/picking-board-mobile.tsx` already reuses several of these
mechanics directly** — it is not a cold-start rebuild, it is the second known consumer of
this exact pattern language:

- **Already reused as-is:**
  - `MOBILE_NAV_CLEARANCE` imported straight from `mobile-shell.tsx` (rather than
    hand-copying "76px" a fourth time — the file's own comment cites 3 prior drift bugs
    from that hand-copy pattern before centralization, matching `CLAUDE_PICKING.md §7`'s
    landmine note).
  - `SOFT_CARD_SHADOW` lifted verbatim with a sourcing comment.
  - The multi-select checkbox (`SelectBox`) matches `/po`'s `w-5 h-5 rounded-[6px]
    border-2` shape exactly, comment-confirmed "matches exactly."
  - The root shell structure — `fixed inset-0 flex flex-col overflow-hidden` → flex-shrink-0
    teal top bar (`paddingTop: max(env(safe-area-inset-top,0px),12px)`) → `flex-1
    overflow-y-auto` scroll body — is explicitly modelled on `/po`'s same 3-way split (§1
    above), to escape a non-scrolling ancestor chain.
  - A `SHEET_GEOMETRY` constant, composed from `MOBILE_NAV_CLEARANCE`, purpose-built to
    coexist with `mobile-shell.tsx`'s own z-index stack (nav z-40 → scrim z-50 → menu/you
    sheets z-60 → confirm z-70): Picking's sheets use `z-[65]`/`z-[75]` deliberately chosen
    to clear that stack.

- **Diverges deliberately, and should keep diverging — the divergence is not a bug to
  fix:**
  - **Bottom sheet anchoring.** `/po` has no persistent bottom nav, so its sheets use
    `fixed inset-0 flex items-end` (full-viewport backdrop, sheet flush to the true
    bottom). Picking's mobile board sits *under* `mobile-shell.tsx`'s always-on fixed
    Home/Menu/You bar, so its `FilterBottomSheet` instead anchors with `style={{ bottom:
    SHEET_GEOMETRY.bottomOffset }}` — floating *above* the nav bar, not covering it. Do not
    "fix" this to match `/po`'s full-bleed style; the nav bar being persistently reachable
    is the whole point of the shared shell (§59).
  - **No floating CTA pill on the Assign/Check/Checked board.** The picking board's scroll
    body uses a hardcoded `pb-[76px]` and relies purely on the mobile-shell's fixed bottom
    nav for the persistent chrome — unlike `/po`, which layers its OWN footer pill/bar on
    top of (or instead of, when `!selectedCust`) the nav. This is consistent with Picking's
    actual interaction model: selection there triggers a floating **action bar** (Assign
    tab's "N selected → Assign" bar), which is a different, tab-scoped affordance from
    `/po`'s page-level send pill — reroute through the existing floating-bar pattern
    already used for Assign, don't reintroduce `/po`'s exact `footerPill()` shape.
  - **`keyboardOpen`/`inputFocused` split is `/po`-specific and likely N/A for Picking.**
    Picking's mobile board has comparatively little free-text/qty input (search + a route
    filter; the tick screen is boolean taps, not numeric entry) — the elaborate Visual
    Viewport `--vvh` + debounced `keyboardOpen` machinery exists in `/po` specifically to
    protect a *lot* of numeric qty-entry screens from keyboard overlap. Before porting it
    wholesale, confirm Picking actually has a screen with the same problem (the search box
    at the top of the Assign tab is the only real candidate today) — otherwise this is
    over-engineering for a board that barely uses the keyboard.
  - **The popstate in-page navigation model (§3) has NOT been ported to Picking at all** —
    the three-tab board (Assign/Check/Checked) + detail screen currently do not push
    history entries; tab switches and the detail screen are plain state, and Android
    hardware Back on the detail screen has not been verified to behave like `/po`'s
    (unconfirmed — flagged, not solved here). If Picking's detail screen or any future
    overlay needs real Back-button support, `/po`'s single-authority `popstate` pattern
    (§3) is the correct model to copy — but note the "every new screen must update three
    places" gotcha applies immediately on day one, not as later debt.

**Net read:** Picking's mobile board was clearly built by someone who had `/po` open in
a second tab — shadow tokens, nav clearance, and checkbox shape are already shared
verbatim, and the sheet-geometry/z-index adaptation shows deliberate, documented departure
rather than accidental drift. The two mechanics NOT yet ported (`/po`'s exact floating CTA
pill shape, and its popstate back-navigation model) are both plausible future needs but
are open design questions, not blockers — solutions deferred per the task brief.
