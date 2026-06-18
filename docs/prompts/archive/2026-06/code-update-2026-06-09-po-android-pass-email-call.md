# Code update — 2026-06-09 — /po Android pass + email & Call edits

Session covered the Android "world-class" pass on the `/po` Purchase Order page,
plus two small order edits and one deferred feature. All commits to `main`.
Continues from the two earlier drafts this build:
`code-update-2026-06-06-po-mobile-redesign.md` (redesign + iOS keyboard chain +
grey range line + delete/duplicate bill) and
`code-update-2026-06-06-po-recents-orbit-keyboard.md` (recents, Orbit bar, universal
keyboard handler, picker keyboard). This draft does **not** re-document those.

Save to `docs/prompts/drafts/code-update-2026-06-09-po-android-pass-email-call.md`.
Consolidate at the next pass.

Commits this session (oldest → newest):

| Commit | What |
|---|---|
| `d8336c29` | Android PWA shell (manifest `display_override`, root `overscroll-behavior:none`) |
| `4acb5c06` | Footers gate on real keyboard state (`keyboardOpen`), not input focus |
| `b7420e62` | Android Back / iPhone swipe-back steps through screens (browser history) |
| `3fe5cac7` | Polish: scroll-chaining, reset-on-screen-change, tap-delay, bottom inset |
| `e45bfdf3` | Order email recipient → `surat.depot@akzonobel.com` (both surfaces) |
| `7a86d9a8` | Dispatch reorder Normal·Urgent·Call + "Call" SO/Dealer popup |
| `d129247c` | Fix: Send mailto fires before the history reset (was cancelled on mobile) |

All files touched are `app/po/po-page.tsx` unless stated. `app/order/*` frozen
throughout. No schema changes. No new API endpoints. No DB touched.

---

## 1. Android PWA shell (`d8336c29`)

Files: `public/po.webmanifest`, `app/globals.css`.

- Manifest: added `"display_override": ["standalone"]` (`display` was already
  `standalone`).
- `globals.css`: added `html, body { overscroll-behavior: none; }` — kills Android
  pull-to-refresh / bounce.

**Diagnosis correction (for the record):** the manifest `display` and the
`width=device-width, initial-scale=1` viewport were *already* correct. The earlier
hypothesis that bad config caused the "browser feel / zoom" on Android was **wrong**.
Real cause = a stale / shortcut-type install (or viewing in a Chrome tab). A **clean
reinstall** of the PWA fixed it. Lesson: when a config hypothesis doesn't hold, the
install state is the more likely culprit on Android.

---

## 2. Footers gate on real keyboard state — `keyboardOpen` (`4acb5c06`)

The floating footers used to hide on `inputFocused`. On Android, dismissing the
soft keyboard with the down-caret does **not** blur the input, so the Add button
stayed stuck-hidden until a page tap. Fixed by tracking the actual keyboard.

- New `keyboardOpen` state + `kbDebounceRef`, computed inside the existing `--vvh`
  updater (height read only — §22-safe):
  - Track `fullH` = tallest no-keyboard viewport height seen (grows on rotation /
    iOS URL-bar expand).
  - `kbOpen = (fullH - h) > 120` — the 120px threshold filters iOS URL-bar noise.
  - `setKeyboardOpen(kbOpen)` debounced ~100ms (anti-flicker on the open/close ramp).
  - The `--vvh` write, `lastH` no-churn guard, `focusedInputRef`, and the
    shrink-re-scroll are all untouched.
- **All** floating footers now gate on `keyboardOpen ? null` instead of
  `inputFocused`: picker Cancel/Add, multiqty Add-products, review Send, **and** the
  search-mode "Review order" / "Set quantities" pills (these now hide while typing a
  product search so results fill the space, and return on keyboard close).
- `inputFocused` is still set by the focus listener but is **no longer read by any
  footer**.

---

## 3. Browser-history back navigation (`b7420e62`)

**Browser history is the single back authority.** Android hardware Back and iPhone
edge-swipe now step *back through screens* instead of exiting the app.

**State machine (customer locked), back-target:**

| From | Back goes to |
|---|---|
| landing (`selectedCust === null`) | exit app |
| build-search | landing (switch customer) |
| picking | build-search (`cancelPicking`) |
| multiqty | build-search (`closeMultiQty`) |
| review | build-search (`closeReview`) |
| any overlay (confirm / cross / delete / **call**) | close that overlay only |

**Mechanism (refs + one effect):**
- `depthRef` — count of entries pushed above the base (landing) entry. `+1` per
  forward push, `−1` in popstate. New-order syncs to base via
  `history.go(-depthRef.current)`.
- `suppressPopRef` — set before any programmatic `history.back()/go()` so the
  resulting popstate is ignored (no double-handling); cleared inside popstate.
- `backConfirmRef` — distinguishes a back-raised discard confirm from a button one.
- `navStateRef` — refreshed each render with the live screen `{selectedCust, view,
  mode, overlay flags, hasLines}` so the single popstate handler never reads a stale
  closure.
- One mount effect adds the popstate listener (cleaned up on unmount). **Initial
  page load = base entry = landing → never pushed.**

**Forward = one `pushState({ poScreen }, "")`** each: `selectCustomer`→build,
`pickProduct`→picking, `openMultiQty`, `openReview`, and on opening each overlay
(confirm / cross / delete / call). `depthRef++`.

**Back = the one popstate handler** (never pushes): if `suppressPopRef` → clear &
return; else `depthRef--` and close the topmost live layer via the existing pure
handler — overlay → close that overlay only; else review→`closeReview`,
picking→`cancelPicking`, multiqty→`closeMultiQty`; else build-search→landing path;
else landing→exit.

**In-app back buttons route through `window.history.back()`** so they flow through
the one authority (no double entries, no divergence): picker Cancel + sub-header
Back, multiqty/review ChevronDown, cross/delete/call ×/backdrop/Cancel, confirm
backdrop/Cancel, and Esc.

**Depth-reducing completions pop their own entry** (`suppressPopRef` +
`history.back()`): `commitLine` (full → suppress+back; empty → plain back),
`commitMultiSelect`, `confirmCross`, `confirmDeleteBill`, `confirmCall`,
`editBill` / `addAnotherBill` (review→build). `editLine` stays **depth-preserving**
(no history op; rides the review entry) — per Q1 flat rule.

**Discard guard (no silent order loss):** back-on-build-with-lines raises the
existing change-customer confirm. **Cancel** → re-push a build entry (stay in build,
order intact). **Discard** → `clearCustomer` → landing.

**Reset to base:** `confirmProceed` (New order button) and `handleSend` do
`history.go(-depthRef)` (suppressed) → base, then `clearCustomer`. Draft-restore on
load seats **one** build entry so a restored order's back → landing, not exit.

**Owner decisions baked in:**
- **Q1 = flat rule.** Back after a review-initiated edit (`editLine` / `editBill` /
  `addAnotherBill`) heads toward landing, **not** back to review. (Return-to-review
  is a possible future polish; would need a small "came-from" context.)
- **Q2 = accept "double-back exits, draft saved".** The back-raised discard confirm
  sits at base, so a second back while it shows exits `/po`; the order is preserved
  in the localStorage draft and restores on reopen.

---

## 4. Polish batch (`3fe5cac7`)

Files: `app/po/po-page.tsx`, `app/globals.css`.

- **Scroll chaining:** `overscroll-behavior: contain` on the single
  `flex-1 min-h-0 overflow-y-auto` scroll container (inner over-scroll no longer
  drags the document; root `overscroll:none` from §1 still handles pull-to-refresh).
- **Reset scroll on screen change:** `scrollAreaRef` + effect
  `useEffect(() => scrollAreaRef.current?.scrollTo({ top: 0 }), [mode, view])`.
  Deps `[mode, view]` never change on input focus, so it can't race the on-focus
  `scrollIntoView` or the `--vvh` re-scroll. The picker's own rAF `scrollIntoView`
  runs after this sync `scrollTo`, so it still governs the picker landing position;
  every other screen now opens at the top.
- **Tap delay:** `.po-page` class on `<main>` + scoped rule in `globals.css`:
  `.po-page button, a, input, textarea, label, [role="button"] { touch-action:
  manipulation; }` (scoped so the rest of the app incl. `/order` is untouched). The
  one non-button interactive row (multi-select `<div onClick>`) got the
  `touch-manipulation` Tailwind class. Zoom-lock (`maximumScale` / `userScalable`)
  left as-is.
- **Android bottom inset:** verified, **no change** — `footerPill` and `pickerFooter`
  already use `paddingBottom: max(env(safe-area-inset-bottom, 0px), 16px)`, and the
  search-mode pills render through `footerPill`. Every pinned footer already clears
  the Android gesture bar and iPhone home indicator.

---

## 5. Order email recipient → AkzoNobel (`e45bfdf3`)

Files: `app/po/po-page.tsx` (`ORDER_TO`), `lib/place-order/email.ts` (`ORDER_TO`).

- Recipient changed from `surat.order@outlook.com` → **`surat.depot@akzonobel.com`**
  in both LIVE constants. The `/po` mailto and the desktop `/place-order` mailto +
  send-confirm "To" preview all read from these (the overlay imports the lib const,
  so it updates automatically). No env / config indirection exists.
- **Pipeline unchanged:** the AkzoNobel inbox **auto-forwards to
  `surat.order@outlook.com`**, which the Mail Orders parser still watches. So the
  parser / `OutlookAccount` config is **not** changed — orders still reach Mail
  Orders.
- **Not touched:** `app/order/*` (frozen — keeps old address), `public/order-demo.html`
  (static demo), all docs/archive.

---

## 6. Dispatch reorder + "Call" SO/Dealer popup (`7a86d9a8`)

`/po` review only.

- **Dispatch pills reordered** to **Normal · Urgent · Call** (Call last).
- **"Call to SO" → "Call"** (red dot kept).
- New state: `callTarget: "SO" | "Dealer" | null`, `callSheetOpen`. Both **persisted**
  (PoDraft + snapshot + `selectCustomer` save + restore validation; `clearCustomer`
  resets them).
- **"Call to?" sheet** = exact clone of the Cross-depot bottom sheet (SO / Dealer
  buttons + × close, same markup/styling/inset).
- **Behaviour mirrors Cross 1:1:** tapping Call opens the sheet *without* committing
  dispatch; `confirmCall(target)` sets `callTarget` + `dispatch="Call"` + closes;
  cancel (× / backdrop / back) makes no state change so dispatch reverts (never
  "Call" with no target); switching to Normal/Urgent clears `callTarget`
  (`chooseDispatch`).
- **Pill label:** "Call" normally; "Call · SO" / "Call · Dealer" once
  `dispatch === "Call" && callTarget`.
- **Email:** `buildEmailParts` takes `callTarget`; Dispatch line — Normal → omitted,
  Urgent → "Dispatch: Urgent", Call → "Dispatch: Call to SO" / "Call to Dealer".
- **History wiring (mirrors Cross 1:1):** `openCallSheet` =
  `setCallSheetOpen(true) + pushScreen("call")`; × / backdrop / close →
  `history.back()`; `confirmCall` → `suppressPopRef + history.back()`; popstate adds
  `if (s.callOpen) { cancelCallSheet(); return; }` after the cross branch;
  `navStateRef` gains `callOpen`.

---

## 7. Send mailto fix — fires before the history reset (`d129247c`)

**Regression introduced by the back-nav (§3).** `handleSend` ran a synchronous
`window.history.go(-depthRef)` in the **same tick, right after** the mailto. On
mobile, `window.location.href = mailto:` schedules an external-scheme handoff but
doesn't unload the page; a synchronous `history.go` in the same task **aborts that
pending handoff before it commits**, so the mail app never opened. Desktop
`/place-order` was unaffected (no back-nav history code) — which is how the cause
was isolated.

Send-path order is now:

1. guard (`!canSend` → return)
2. build mailto URL from current state
3. `addRecent` (state / localStorage only — no navigation)
4. **`window.location.href = url` — mailto fires first, unconditionally, in the tap gesture**
5. `clearCustomer` (pure state reset — never touches `location` / `history`)
6. `setTimeout(() => window.history.go(-depthRef), 0)` — history-to-base reset
   deferred to a later macrotask (`depthRef` / `suppressPopRef` still set
   synchronously so the deferred pop's popstate is absorbed)

Mirrors the working frozen `/order` (sets `location.href`, nothing navigational
after). Post-send end state unchanged: user on landing (cleared), history at base,
Back exits cleanly. The New-order path (`confirmProceed`) keeps its **synchronous**
`history.go` — it has no competing mailto, so it is correct and untouched.

---

## BUSINESS RULES ADDED / INVARIANTS

- **Browser history is the single back authority on `/po`.** Every forward screen and
  every overlay pushes exactly one history entry; every back (hardware, swipe, or
  in-app button) goes through `history.back()` → one popstate handler closes the
  topmost layer. Adding any new screen or overlay **must** push on open, close via
  `history.back()`, and be added to both the popstate branch and `navStateRef` — or
  Back will skip/strand. (The Call sheet is the worked example.)
- **Footers gate on `keyboardOpen` (real keyboard), never on `inputFocused`.** New
  floating footers follow the same rule.
- **`keyboardOpen` is derived from viewport height only** (`fullH - h > 120`,
  debounced) inside the `--vvh` updater — still §22-compliant.
- **Send-path ordering (`/po`): the mailto must fire first.**
  `window.location.href = mailto:` must execute before any history navigation — a
  synchronous `history.go()` in the same tick cancels the external handoff on
  mobile. Any send-path history reset is deferred via `setTimeout(…, 0)`.
- Order recipient is **`surat.depot@akzonobel.com`**, which forwards to the Outlook
  parser inbox. The Mail Orders `OutlookAccount` stays `surat.order@outlook.com`.
- Dispatch options are ordered **Normal · Urgent · Call**; "Call" requires an
  SO/Dealer target chosen via its sheet, surfaced in the email as "Call to SO/Dealer".

## BUSINESS RULES CHANGED / SUPERSEDED

- Footer visibility was `inputFocused`-driven → now `keyboardOpen`-driven.
- Order recipient was `surat.order@outlook.com` on `/po` and `/place-order` → now
  `surat.depot@akzonobel.com` (the frozen `/order` page still sends to the old
  address until cutover).
- Dispatch label "Call to SO" → "Call" (+ SO/Dealer choice).

## PENDING ITEMS

- **Dispatch slot (date + time window)** — design agreed, build **deferred by owner**:
  - Optional "Dispatch slot" section on `/po` review, under Dispatch.
  - Date: Today / Tomorrow / Pick date (native date picker).
  - Time window: **9–12 / 12–3 / 3–6** — *windows pending final owner confirm* (may
    add 6–9 or "Any time").
  - Tap a selected chip again to clear. Email line: `Dispatch slot: <date>, <window>`,
    omitted when unset.
  - Mockup: `docs/mockups/dispatch-slot/` (delivered for approval).
- **Android device verification** of the full pass (footer / back-nav / polish) —
  owner testing on device; iPhone swipe-back confirmed working.
- **Orbit-bar collapse-on-scroll** — mockup approved, not built (still parked).
- **Login → real per-SO recents** — deferred ~weeks; recents are device-local
  (localStorage) for now.
- **`/po` → `/order` cutover rename** — eventual.

## CONSOLIDATION NOTES

- **CLAUDE_PLACE_ORDER.md** —
  - Add the browser-history back-nav architecture (state machine, refs, popstate
    authority, in-app buttons via `history.back()`, discard guard, New-order history
    sync, Q1 flat / Q2 accept) as a new subsection. New screens/overlays must follow
    the push/back/navStateRef pattern.
  - Add `keyboardOpen` footer-gate rule (supersedes the `inputFocused` gate).
  - Add Dispatch order (Normal·Urgent·Call) + Call SO/Dealer sheet + `callTarget`.
  - Add Android shell (manifest `display_override`, globals `overscroll:none`) +
    polish (scroll-container `overscroll:contain`, reset-scroll-on-`[mode,view]`,
    `touch-action:manipulation`).
  - **Update §6 and §290: order recipient `surat.order@outlook.com` →
    `surat.depot@akzonobel.com`.**
  - Add the **send-path ordering rule**: the Send mailto fires first; any history
    reset on send is deferred via `setTimeout(…, 0)` (`d129247c`).
- **CLAUDE_UI.md** — Dispatch pill order; Call sheet = Cross-sheet clone; Dispatch
  slot section design (deferred — mark as planned).
- **CLAUDE_CORE.md** — order recipient now `surat.depot@akzonobel.com` (forwards to
  Outlook parser inbox); reaffirm §22 (height read + `scrollIntoView` only — all
  keyboard work this session stayed inside it); learnings: *Android keyboard-dismiss
  does not blur the input* (drove `keyboardOpen`); *Android browser-feel/zoom is a
  stale-install symptom — clean reinstall fixes it.*; *on mobile a synchronous
  `history.go()` in the same tick as a `mailto:` (or any external-scheme) navigation
  cancels the handoff — fire the external navigation first, defer history after.*
- **CLAUDE_MAIL_ORDERS.md** — **no** `OutlookAccount` change (AkzoNobel forwards into
  it). Optionally note the AkzoNobel front-door address. ?(merge-time decision)
