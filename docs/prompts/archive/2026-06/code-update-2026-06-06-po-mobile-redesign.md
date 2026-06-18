# /po Mobile Redesign + iOS Keyboard Fix + Bill Tools — 2026-06-06

Draft for consolidation into `docs/CLAUDE_PLACE_ORDER.md` (and a line or two into `docs/CLAUDE_UI.md`).
Save location: `docs/prompts/drafts/code-update-2026-06-06-po-mobile-redesign.md`

All work is in **`app/po/po-page.tsx` only**. `app/order/*` is the frozen backup and was read for reference but never modified.

---

## Summary

This session finished the mobile redesign of the new Purchase Order page (`/po`): a minimal landing, a merged customer header, a one-line Bill/Multi row, unified floating CTA buttons, and review-screen content changes. It then closed out a long iOS-keyboard saga (blank-on-focus / empty grey void in the installed PWA), and added three follow-up features: the grey product range line on search results, deleting a bill, and duplicating a bill.

`/po` is the going-forward Purchase Order page; `/order` stays frozen. The `/po` email intentionally diverges from `/order` now (it carries the new review fields).

---

## Commits (local `main`, chronological)

| Hash | What |
|------|------|
| `0e3663fa` | Minimal fresh/landing page (single elevated search field); customer-block avatar removed |
| `f592a45d` | Bottom safe-area inset on the floating bars; hide bars on input focus (first iOS keyboard attempt) |
| `eb3482b1` | `--vvh` updated on **resize only** (dropped scroll listener) — *this later caused the void; see Keyboard section* |
| `03ea47f1` | Merged header (customer name becomes the page title) + one-line Bill / Multi switch row |
| `1305b7c8` | Floating CTA + always-at-bottom footer (`<main>` height `var(--vvh)`, one flex-1 scroll area, one flex-shrink-0 footer sibling) |
| `4abf7a88` | Unified "Set quantities" + "Add N products" into the floating footer pill; review Send hidden on Ship To/Notes focus; removed Preview email |
| `ff88596d` | **Review screen content** — Order remarks (2×2), Cross-depot sheet, Dispatch → "Call to SO", Notes, email additions, Ship-to omission |
| `920ade08` | Multi-qty band fix attempt 1 — stop hiding the Add footer on qty focus |
| `17c7f9eb` | Review: scrollIntoView on Ship To/Notes focus; Send pinned |
| `f5a9bd59` | `--vvh` updater restored to resize **+ scroll** with a height-change guard (`lastH`) — fixes keyboard re-measure without re-introducing search drift |
| `8707f82` | **Tap-a-pack lands the product at the top** + hide "Add products" while a qty box is focused; same scroll-to-top + hide on review Ship To/Notes |
| `0f1ced7c` | Grey product **range line** restored on search results (`?? p.family` fallback) |
| `d5e58977` | **Delete a bill** (× on selected chip + confirm sheet + renumber) |
| `3ac8a430` | **Duplicate a bill** (Duplicate control on review → clone lines into a new bill) |

Push status at session end: the keyboard fixes were tested on-device; the last three (`0f1ced7c`, `d5e58977`, `3ac8a430`) were committed locally and pushed as a batch for device verification.

---

## 1. Landing / fresh page (`0e3663fa`)

Fresh page is just one elevated, shadowed search field (rounded-16, shadow `0 8px 28px rgba(17,24,39,.09)`, `pt-16`), under the "Purchase Order" banner. No label/heading/logo/recent list. (Rejected: dark Attendance-style header; search-on-top reorder.)

## 2. Customer header — merged (`03ea47f1`)

Once a customer is selected, the customer **name becomes the page title** (≈16px bold-equivalent in app), with `code · area` below, and a single "New order" button (refresh icon + text, teal, vertically centred) top-right. Removed: the separate "Purchase Order" banner, the gray-50 customer block, and the "Change" button (New order = full reset covers it). Landing still shows the Purchase Order banner.

## 3. Bill + Multi — one line (`03ea47f1`)

Single row: left = `Bill {n}` + "+ Add bill" (collapses to "+" icon at 2+ bills); right = "Multi" label + the switch toggle.

## 4. Unified floating CTA pill (`1305b7c8`, `4abf7a88`)

One `footerPill` helper: teal, rounded-full, padding ≈`15px 34px`, white 15px bold, shadow `0 8px 22px rgba(13,148,136,.42)`, safe-area inset. The same pill renders "Review order" / "Send order" / "Set quantities (N)" / "Add N products" depending on state. Layout: `<main>` is `height: var(--vvh); flex flex-col overflow-hidden`; **one** `flex-1 min-h-0 overflow-y-auto` scroll area; **one** `flex-shrink-0` footer pill as a direct sibling of the scroll area at `<main>` level.

## 5. Review & send content (`ff88596d`)

- **Order remarks** — 2×2 grid: Truck / Cross / Bounce / DTS.
- **Cross** — opens a bottom-sheet depot picker (Dahisar / Ahmedabad / Rajkot / Pune); stores `crossDepot`; shows "Cross billing from {depot} · change"; dismissing without picking cancels Cross.
- **Dispatch** — "Hold" replaced by plain **"Call to SO"** (no code word).
- **Notes** — free text + "Quick add" presets ("Pls share DPL" / "Pls send stickers"); stores `notes`.
- **Email** — adds the Dispatch value, a Remark line (Cross → "Cross billing from {depot}", Truck → "Truck order", Bounce → "Bounce order", DTS → "DTS order"), a Note line, and **omits the Ship-to line when "Same as billing"** (only included for a custom ship-to). Email is assembled inline (no `cartToMailtoBody`); recipient `surat.order@outlook.com`; line format `{label}*{qty}` keyed off `b.id`.

---

## 6. iOS keyboard saga — root cause + fix (the important one)

**Platform note:** all of these bugs are **iPhone-only**, and only really in the **installed PWA (standalone)**. Android (≈99% of Sales Officers) handles the keyboard cleanly via `interactiveWidget: "resizes-content"` and is unaffected.

**Symptom A — empty grey void.** With the keyboard open on multi-qty / review, the bottom showed a large grey void with the floating pill stranded mid-screen.

- Root cause: `<main>` is sized to `var(--vvh)` (space above the keyboard). After `eb3482b1` the `--vvh` updater listened to **resize only**. In the iOS standalone PWA, the keyboard opening does **not** fire a clean `resize` — geometry arrives via `scroll`/offset (or not until a later interaction). So `--vvh` stayed at the full pre-keyboard height → `<main>` too tall → the flex-1 area + bottom footer overshot below the keyboard → surplus page-bg + footer-bg merged into one grey void.
- Fix (`f5a9bd59`): restore **both** `resize` and `scroll` listeners on the `--vvh` updater, **with a height-change guard** so a plain scroll (keyboard up) is a no-op and the sticky search doesn't drift:

```js
const vv = window.visualViewport;
let lastH = -1;
function update() {
  const h = vv ? vv.height : window.innerHeight;
  if (h === lastH) return;            // guard: unchanged height (plain scroll) → no-op
  lastH = h;
  document.documentElement.style.setProperty("--vvh", `${h}px`);
}
update();
if (!vv) return;
vv.addEventListener("resize", update);
vv.addEventListener("scroll", update);
return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
```

The guard is what prevents the `eb3482b1`-era search drift (per-tick rewrite) while still capturing the keyboard's height change.

**Symptom B — blank on focus.** After Symptom A was fixed, tapping a quantity box showed blank (just the green pill + empty space); only when typing started did the product list snap into view. Cause: at the instant of tap, `--vvh` hadn't re-measured yet (iOS reports the keyboard late in the PWA), so the auto-scroll landed behind where the keyboard would sit. Typing forced a re-measure that snapped it in.

- Fix (`8707f82`): stop depending on the late re-measure. On qty-input focus, scroll the **whole product section** (name + all pack rows) to the **top** of the scroll area, on the next animation frame:
  - Tag each product wrapper with `data-product-section`.
  - `onFocus`: `setQtyFocused(true)` → `requestAnimationFrame(() => requestAnimationFrame(() => el.closest("[data-product-section]")?.scrollIntoView({ block: "start", behavior: "auto" })))`. Double-rAF lets the footer-hide reflow commit before the scroll.
  - `onBlur`: `setQtyFocused(false)` (150 ms timeout to avoid flicker between inputs).
  - While `qtyFocused`, the "Add N products" pill is **not rendered** (Smart Flow's request: no button while typing).
  - Same pattern on the review screen for Ship To and Notes (`data-field-section`, scroll-to-top, hide the Send pill while `shipFocused || notesFocused`). `shipFocused` still gates the ship-to suggestions dropdown.

The top of the scroll area is always above the keyboard regardless of iOS timing, so the product is visible immediately on tap. **No `window.visualViewport` offset / translateY / scroll-tick position math was added (PLACE_ORDER §22 holds).** `scrollIntoView` is the only mechanism used.

---

## 7. Grey product range line restored (`0f1ced7c`)

`/po` search rows were rendering the grey second line only when `getSecondLine(...)` returned non-null, so plain products (e.g. "VELVET TOUCH" family) showed no grey line. `/order` uses a `?? p.family` fallback. Fix: one shared `second` computation feeds both `/po` search rows (multi-select checkbox row + single-add button row):

```js
const second = getSecondLine(p.family, p.subProduct, getBaseAliasDisplay(p.product, p.baseColour)) ?? p.family;
```

Styling unchanged (`text-[12px] text-gray-400 truncate mt-0.5`); the `{second && …}` guard means an empty family still renders nothing. Display-only — `p.family` is already in the v2 search payload (`/api/order/data → rankProductsForQuery`).

---

## 8. Delete a bill (`d5e58977`)

- **Bills model:** `bills: Bill[]` where `Bill = { id, lines }`; `activeBillId`; `billCounter`. Invariant maintained: **`id === position + 1`**.
- **UI:** the **selected** bill chip is a teal pill containing the label + a 19px `bg-teal-600` circle with a white × button. Inactive chips are plain (no ×). The × only renders inside `bills.map` (2+ bills), so the last bill never shows one.
- **Handlers:**
  - `requestDeleteBill(index)` — guards `bills.length <= 1`; if the bill has `lines.length >= 1` → open confirm sheet (`setBillToDelete(index)`), else delete immediately.
  - `deleteBillAt(index)` — `bills.filter(i !== index).map((b,i) => ({ ...b, id: i+1 }))` (renumber 1..n, no gaps), `setActiveBillId(renumbered[Math.max(0, index-1)]?.id ?? 1)`, update `billCounter`, persist, clear `billToDelete`.
  - `cancelDeleteBill()`.
- **Confirm sheet** reuses the Cross-depot bottom-sheet pattern (`fixed inset-0 flex items-end`, `bg-black/40` backdrop, `max-w-[480px] bg-white rounded-t-[18px] p-5`, safe-area `paddingBottom`): title "Delete Bill {n}?", body "{count} product(s) in this bill will be removed.", buttons Cancel (`bg-gray-100 text-gray-700`) + Delete (`bg-red-600 text-white`). Empty bill = no sheet, instant delete.
- `billToDelete` reset in `clearCustomer`.

## 9. Duplicate a bill (`3ac8a430`)

- **No max-bill cap exists** in the codebase → Duplicate is always available.
- **Review per-bill render:** `reviewBills = bills.filter(b => b.lines.length > 0)` → `.map(...)`; each bill is a white card whose header holds `Bill {b.id}` + the Edit pencil. The **Duplicate** control sits in that header (right side), grouped with Edit (`flex items-center gap-3`). Quiet grey button: `<Copy className="w-[15px] h-[15px]" /> Duplicate`, `text-[14px] text-gray-500`, `active:text-gray-700`.
- **Handler** takes the **source `Bill` object** (not a `reviewBills` index → avoids the filtered-vs-full array mismatch):

```js
function duplicateBill(source: Bill): void {
  const id = billCounter + 1;
  const copiedLines: CartLine[] = source.lines.map((l) => ({ ...l, packQtys: { ...l.packQtys } })); // deep copy
  const nextBills: Bill[] = [...bills, { id, lines: copiedLines }];
  setBills(nextBills);
  setBillCounter(id);
  persist(nextBills, id, activeBillId); // active bill unchanged → stays on review
}
```

- Deep copy is sufficient because `CartLine` is scalar fields + the one nested `packQtys` map; spread + fresh `packQtys` object means editing the copy can't mutate the source.
- No "copied from" tag; new bill reads simply "Bill {n}". Does **not** switch the active bill or navigate — stays on review.

---

## Engineering notes / learnings

- **PLACE_ORDER §22 reaffirmed:** never use `window.visualViewport` offset / `translateY` / per-scroll-tick position math to place sticky bars. Writing the measured **height** into `--vvh` is the only sanctioned write, and only behind a height-change guard. `element.scrollIntoView` is allowed for focus handling.
- **Bills invariant:** `id === position + 1`. Both delete (renumber) and duplicate (`billCounter + 1`) preserve it; `billCounter` tracks the count. Anything touching the bills array must keep this.
- **Deep copy rule for bills:** `CartLine` has one nested field (`packQtys`) — spread the line and spread `packQtys` separately. Don't shallow-copy (would share the qty map).
- **OneDrive `.next` lock:** `npm run dev` can throw transient EBUSY / 500 because OneDrive locks `.next`. Clear `.next` and recompile before trusting a local failure.
- **iOS vs Android:** keyboard/viewport bugs are iPhone-PWA-only; Android is fine via `resizes-content`. Visual changes (header, one-line row, colour, grey line, bill tools) show on both.
- **`/po` email now intentionally diverges from `/order`** (carries Dispatch / Remark / Note / conditional Ship-to). Sanctioned — new features.

---

## Pending / on horizon

- **On-device verification** of grey line (`0f1ced7c`), delete bill (`d5e58977`), duplicate bill (`3ac8a430`) on the installed iPhone PWA.
- Optional cosmetic: give the footer a top divider / distinct surface so a content-shorter-than-strip gap reads as a bar, not a void.
- Eyeball the selected-chip styling (indigo vs teal) on Dispatch / Remarks chips — confirm no clash.
- Eventual cutover rename `/po` → `/order` (replacing the frozen backup) once `/po` is fully signed off.
