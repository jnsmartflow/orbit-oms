# web-update-2026-07-14 — /po Favourites + polish pass + full launch

Status: **BUILT · POLISHED · LAUNCHED to production** (gate removed, live for all users).
Module: CLAUDE_PLACE_ORDER.md (/po mobile), CLAUDE_UI.md §55.
This doc continues the same session as the Save-Draft/Sent feature — read that
draft (web-update-2026-07-14-po-save-draft-sent-feature.md) first for the
Drafts/Sent/receipt build. This one covers Favourites, the visual polish pass,
and the launch (removal of the ?draft=on gate).

Final HEAD on main: `33b9b42e` (after the launch flip `5b520304`).

---

## 1. Favourites (replaces Recent on /po Home)

**Why:** 80-90% of a Sales Officer's orders come from the same ~8 dealers. A
shuffling "Recent" list didn't help quick access; a curated, stable Favourites
list does.

**Behaviour (locked):**
- Home "Recent" section replaced by "Favourites" — section label is the word
  "Favourites" followed by a small gold star (text-led, matching other section
  labels).
- Favourites listed **one column, sorted A-Z** by name.
- **Star toggle in the customer BUILD header** (right of the name row): filled
  gold star = favourite, outline grey = not. Present the whole time an order is
  built for that customer (header persists across build/search/quantities).
  Tap toggles add/remove.
- **Cap 8.** Adding a 9th is BLOCKED (not silently evicted) — a calm amber
  "Favourites full (8 of 8) — remove one first" message near the header,
  auto-dismiss. Remove one to free a slot.
- Tapping a favourite starts an order instantly, no network lookup (the fav
  entry stores enough customer data).
- Empty state for zero favourites: soft icon + "No favourites yet" + prompt.
- **Recents machinery left intact but unrendered** — getRecents/addRecent still
  run in the background (recents still written on Send), just not shown on Home.
  Restorable later by re-rendering.

**Storage:** new `lib/place-order/fav-customers.ts`, key `po_fav_customers` —
`{ version:1, favs:[{ id, name, code, area }] }`, id === customer `code`
(matches how recents key customers — Customer has no numeric id). Helpers:
loadFavs (A-Z), addFav (blocks at 8), removeFav, isFav. Same per-phone /
per-browser localStorage nature as Drafts/Sent.

**Star asset:** reused the exact Mail Orders star — lucide-react `Star`, filled,
`amber-500`, no background box (matches review-view.tsx StarGlyph). Gold, never
teal.

**Star alignment fix:** star was optically off-center — set the header row to
items-center (centers against the two-line name+meta block, not just the name
line), and nudged the star glyph ~3px right to correct the optical gap from the
5-point star's inset drawn shape vs its bounding box.

---

## 2. Fold-fit tuning (Favourites list height)

8 full-width cards overflowed on short phones (Galaxy S8+, 740px) once the
bottom bar was present; taller phones (S20 Ultra 915px, iPhone 12 Pro) fit all 8.
Decisions:
- **Cap stays 8** — accepted that the S8+ scrolls one card. A quick-access list
  you scroll a hair beats losing a dealer.
- Reclaimed space from **empty gaps only, never card height**: header→search top
  padding pt-16 → pt-8 (tuned so it still breathes on tall phones, not jammed
  under the header). Cards untouched.
- Measured against real device viewports via headless render, not guessed.

---

## 3. Visual polish pass (all three lists + receipt)

Overall direction: **soft and light** (Things / Apple Notes feel), NOT bold or
hard. Disciplined palette.

**Palette discipline:**
- **Teal = actions only** (primary buttons, active tab, the favourite star).
  NOT used for avatars/chips/decoration — that was diluting the brand colour.
- Near-black `#1d2939` = primary text (softened from pure black `#111827`).
- Greys (`#667085`, `#98a2b3`, `#d0d5dd`) = everything secondary.
- Status accents: **amber** = Urgent, **green** = Normal, **red** = Call
  (matches the build-screen Dispatch dots).

**Cards (all lists):** soft two-layer low-opacity shadow, no hard border,
radius 14, roomier padding, subtle pressed state on tap.

**Customer name — unified across Home/Drafts/Sent/receipt:** `15px / 500 /
#1d2939`. (Drafts & Sent were previously `14px / 600 / #111827` — smaller and
harder; unified to the Home reference.)

**Favourites cards:** neutral grey **rounded-square initials avatar** (not a
circle — businesses, not people; not teal), name + code·area, chevron.

**Drafts / Sent cards (no avatar):** name + code·area + a chip row showing the
FULL signal (per Smart Flow's call — an earlier "hide Normal / drop remark"
restraint was reversed):
- **Bills** chip — soft teal `#f0fdfa / #0f766e`.
- **Dispatch** chip, ALWAYS shown: Normal green `#f0fdf4 / #15803d`; Urgent amber
  `#fef3e2 / #b45309` with a bolt icon; **Call red `#fef2f2 / #dc2626`** (matches
  the build-screen red Call dot).
- **Remark** chip (only if set) — grey pill with the Order-Remarks emoji + SHORT
  name only: "🚛 Truck", "🔄 Cross", "🔁 Bounce", "📦 DTS". Never the long
  "Cross billing from {depot}" text on the row.
- Bills count as plain grey text; time light-grey, right-aligned; delete bin
  top-right.

**Sent receipt — two clear sections (redesign):**
- **ORDER SUMMARY** block: label-value rows — Sent time, Dispatch (amber chip if
  Urgent), Remarks (full detail incl. "Cross billing from…" — long form kept
  HERE only), Ship to (if override), Notes (if present), Total, divided off.
  Rows hidden when empty.
- **ITEMS** block: grouped by bill, product rows with pack breakdown (grey mono).
  Read-only.

**Unified footer buttons (Build/Review AND receipt):** one system — secondary =
soft grey-outline pill LEFT; primary = solid teal pill RIGHT, wider, soft teal
shadow; both rounded-full, ~50px, weight 600. Build/Review = [Save draft] ·
[Send order]; receipt = [Edit order] · [Resend order].

---

## 4. Review & send — back affordance (Option B)

Added a clear back control on the "Review & send" section row: soft-grey rounded
back arrow + "Review & send" on the left, "Back to products" teal hint on the
right. onClick stays `window.history.back()` — pure restyle of the EXISTING back
button, no new nav path (§25-safe; hardware back and this button both funnel into
the same popstate → closeReview → build). Verified round-trip: Review → tap →
lands on the exact build/search screen.

---

## 5. "Opening mail" timing — investigated, left as-is

Reported feeling faster than the "Draft saved" tick. Root cause: they already
share ONE overlay function with identical timing (~1.4s). The "fast" feel is the
OS app-switch to Mail cutting off the view — the mailto must fire synchronously
in the user gesture (deferring it risks some phones silently blocking the email).
**Decision: no change.** The Mail app opening is itself the confirmation;
touching mailto timing on a live page for a cosmetic gain isn't worth the risk.

---

## 6. Launch — ?draft=on gate removed

- Everything (Drafts, Sent, receipt, Favourites, polish) was built and tested
  behind `?draft=on`, then verified on local + live phone.
- **Launch flip:** `draftsEnabled` changed from a useState reading
  `window.location.search` to a plain `const draftsEnabled = true`; the
  query-reading effect deleted. Single-point flip — all ~20 `draftsEnabled && …`
  checks still gate on the one constant, so no call-site churn. (commit
  `5b520304` "po: launch drafts/sent/favourites — remove ?draft=on gate")
- Plain `/po` now shows the full feature to all users.
- **Favourites was ALWAYS on the shared Home** (never behind the flag) — it went
  live to everyone the moment it was pushed, before the gate flip.

**PWA note:** "Add to Home Screen" strips the `?draft=on` query, so during
testing the installed icon opened plain /po. Now that the gate is gone, the
installed PWA shows everything automatically.

---

## Files touched (this half of the session)

- `app/po/po-page.tsx` — Favourites list + star toggle, fold tuning, full polish
  pass (cards/chips/names/buttons/receipt), Review back arrow, launch gate flip.
- `lib/place-order/fav-customers.ts` (new) — favourites store, cap 8, A-Z, helpers.

No schema, no API, no DB. Client state + localStorage only.

---

## Known follow-ups / deferred

- **openedDraftId lost on mid-session page reload** (from the Drafts build) — a
  reopened draft's overwrite-link is plain React state; a reload before the next
  Save would create a duplicate draft instead of overwriting. Narrow. Fix by
  persisting openedDraftId if real use shows duplicates.
- **Favourites are per-phone/per-browser** — lost on browsing-data clear or new
  phone; a Sales Officer must re-star their 8. For a "follows the login
  everywhere" list, move favourites to the server/DB — only if the "lost on new
  phone" pain becomes real.
- **"Opening mail" polish (option b)** — a bounded pre-delay so the overlay
  settles before the app-switch — deferred; only revisit later on local with
  heavy Android+iOS testing, never rushed onto the live page.
- Consolidate this + the Save-Draft/Sent draft into CLAUDE_PLACE_ORDER.md; add
  the Favourites + receipt + 3-anchor bar to §25/§55; note the deferred items.

---

## Post-launch

Demo video + WhatsApp announcement (two messages, senior-SO tone) prepared for
the group. The top-8-dealers SQL result was used only to source real dealer
names for the demo.
