# Web Update — Review View Right Panel Redesign

**Draft date:** 2026-05-20
**Scope:** Mail Orders → Focus / Review view → right panel only. Table view untouched.
**Status:** Design locked. Ready to execute in a future web → Claude Code session.
**Estimated effort:** 4–6 Claude Code prompts · 2–3 hours total · mostly Opus.

---

## 1. Why we are doing this

The current right panel in the Focus view buries critical information below the SKU table in a low-contrast remarks footer. Operators (Deepanshu, Bankim) routinely miss delivery and bill instructions. Ship-to overrides surface only as a small "→ Ship-to" badge with no inline detail.

This redesign restructures the right panel into a **two-card model** that maps to how a billing operator actually thinks: **Bill-to** (who pays) and **Ship-to** (where it goes). Every signal, tag, and remark gets a deterministic home. Nothing lives below the SKU table.

---

## 2. The locked design — visual model

```
┌────────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────┐   ┌───────────────────────────┐     │
│  │ BILL TO                   │   │ SHIP TO  [⚑ captured]      │    │ ← left bar
│  │ ● Customer Name           │   │ ● Customer Name           │     │   if override
│  │   [code] · City           │   │   [code] · City · LOCAL   │     │
│  │   [bill tags...]          │   │   [delivery tags...]      │     │
│  └───────────────────────────┘   └───────────────────────────┘     │
├────────────────────────────────────────────────────────────────────┤
│  SO name · time · volume · ✓ 7/7 · (punched by · time)             │
│                          [📋] [↩] [⚑]  [SO Number ___] [ Punch ]   │
├────────────────────────────────────────────────────────────────────┤
│  ● delivery — "deliver at godown side"      ← amber dot            │
│  ● bill     — "split into 2 bills"          ← blue dot             │ ← conditional
│  ● notes    — "spoke to Mahesh"             ← gray dot             │
├────────────────────────────────────────────────────────────────────┤
│  [ SKU TABLE — unchanged this session ]                            │
└────────────────────────────────────────────────────────────────────┘
```

Reference HTML mockup: `right-panel-redesign-A3-v3.html` (session output, 2026-05-20).

---

## 3. Tag distribution — the source of truth

Every signal `getOrderSignals()` returns must be routed to **one** of three zones: Bill-to card, Ship-to card, or meta ribbon. Nothing goes in two places.

### 3.1 Bill-to card

| Tag | Class | Colour | Notes |
|---|---|---|---|
| OD | blocker | red | Customer overdue |
| CI | blocker | red | Credit issue |
| Bounce | blocker | red | Cheque bounce history |
| Bill 1 / Bill 2 / Bill N | bill | blue | Order numbering |
| Bill Tomorrow | attention | amber | Billing timing |
| Cross XYZ | attention | amber | Cross-billing flag |
| ✂ Bill X-Y | split | purple | Confirmed bill split (`splitLabel` set) |
| ⚠ Split | split | purple | Volume warning |
| 7 Days | info | gray | Payment terms |
| Extension | info | gray | Credit extension granted |
| DPL | info | gray | Delivery point list flag |
| **Truck Order** (renamed from Truck) | **truck-order** | **violet, icon-only** | Punch when material received |

### 3.2 Ship-to card

| Tag | Class | Colour | Notes |
|---|---|---|---|
| Dispatch | status | green | Go-ahead |
| Hold | blocker | red | Don't dispatch |
| Urgent | attention | amber | Delivery priority |
| Challan | info | gray | Special challan |
| Slot override | attention | amber | Slot change (verify spec when implementing) |
| ⚑ captured | provenance | amber pill | Only when `shipToOverride=true` |

Plus: 3px **amber left-edge bar** on the card when `shipToOverride=true`.

### 3.3 Meta ribbon (below cards)

Single horizontal row, dot-separated:

```
(jsw) SO name · 09:36 · 152L · ✓ 7/7 · punched by Bankim · 10:22
```

- `(jsw)` prefix kept for SO source clarity (matches current spec)
- `7 lines` text **removed** — `✓ 7/7` chip already communicates lines + match
- Match chip colours: green `✓ 7/7` (all matched) · amber `⚠ 5/7` (partial) · red `✗ 0/7` (unmatched)
- Punched-by + time only appears when `status='punched'`

### 3.4 Instructions strip (conditional)

Renders below meta ribbon **only when at least one remark exists**.

| Category | Dot | Source field | Examples |
|---|---|---|---|
| delivery | 🟡 amber `#f59e0b` | `deliveryRemarks` minus `[→ Name (Code)]` suffix | "deliver at godown", "leave at gate" |
| bill | 🔵 blue `#2563eb` | `billRemarks` | "split into 2 bills", "bill tomorrow" |
| notes | ⚪ gray `#9ca3af` | `remarks` (free-text) | "spoke to owner" |

Empty categories don't render. If all three empty → strip collapses entirely.

### 3.5 Removed entirely

- `→ Ship-to` badge — redundant with two-card layout + amber bar
- Footer remarks bar (DELIVERY / BILL / NOTES / RECEIVED columns at bottom of panel)
- "exact 7/7" chip inline with customer name — moved to meta ribbon
- "Lines: 7 lines" text in meta — match chip carries that info

### 3.6 Match status colour on code chip

Match status (`customerMatchStatus`) modifies the code chip background colour inside the Bill-to card:

- `exact` → gray (`bg-gray-100 border-gray-200 text-gray-700`) — default
- `multiple` → amber (`bg-amber-50 border-amber-200 text-amber-700`)
- `unmatched` → red (`bg-red-50 border-red-200 text-red-700`)

---

## 4. New Truck Order pill — colour spec

| State | CSS class | Hex |
|---|---|---|
| bg | `bg-violet-50` | `#f5f3ff` |
| border | `border-violet-200` | `#ddd6fe` |
| text | `text-violet-700` | `#6d28d9` |

**Icon:** Lucide truck SVG, 12×12, stroke-width 2. Icon-only pill (no text label). Tooltip `title="Truck Order — punch when material received"`.

**Behaviour:** purely informational, no button-blocking. Operator learns the convention.

---

## 5. Ship-to data extraction

Ship-to is **not stored as structured columns** on `mo_orders`. Today it lives:

- Free text in `deliveryRemarks` (e.g. "Shree Rang Bhandar")
- Optionally with a resolved `[→ Name (Code)]` suffix appended by `matchDeliveryCustomer()`
- Trigger flag: `shipToOverride: boolean`

**Extraction rule for the Ship-to card content:**

```ts
if (shipToOverride && deliveryRemarks has "[→ Name (Code)]" suffix) {
  shipToName = parse Name from suffix
  shipToCode = parse Code from suffix
  shipToCity = ""  // no city available unless join to delivery_point_master
} else if (shipToOverride && no suffix) {
  shipToName = raw deliveryRemarks text (before any "—" or "/")
  shipToCode = null
  shipToCity = ""
} else {
  // shipToOverride === false → mirror Bill-to
  shipToName = customerName
  shipToCode = customerCode
  shipToCity = customerArea
  showItalicTagline = "Ships to billing address"
}
```

After ship-to identity is extracted from `deliveryRemarks`, the **remaining delivery-instruction text** (anything that isn't a customer identifier) becomes the `delivery` row in the instructions strip. So a `deliveryRemarks` value of `"Shree Rang Bhandar — leave at gate by 6pm [→ Shree Rang Bhandar (447636)]"` splits into:

- Ship-to card: name = "Shree Rang Bhandar", code = "447636"
- Instructions strip delivery row: "leave at gate by 6pm"

This split logic lives in a helper, not inline in JSX.

---

## 6. Files this redesign touches

| File | Change | Risk |
|---|---|---|
| `components/mail-orders/review-view.tsx` (or `focus-mode-view.tsx`) | Major rewrite of right panel JSX | High — every order goes through this |
| `lib/mail-orders/utils.ts` | Add Truck Order to `getOrderSignals()` classification; add `splitDeliveryRemarks()` helper | Medium |
| `lib/mail-orders/types.ts` | No schema change. May add helper type for `ParsedDeliveryRemarks` | Low |
| `components/mail-orders/signal-pill.tsx` (if exists) | Add `truck-order` variant with violet styling + truck icon | Low |
| `mail-orders-page.tsx` | Likely untouched — review-view is mounted as child component | Low |

**Database:** not touched. Pure UI restructure. No SQL needed.

---

## 7. Out of scope for this redesign

- Mail Orders **Table view** — leave as-is. Decide consistency rollout in a later session.
- SKU table itself — unchanged. Only the surrounding header/footer/cards change.
- Parser changes — ship-to comes from existing `deliveryRemarks` field. No new fields captured.
- Schema changes — no Prisma changes, no SQL, no migration.
- Keyboard shortcuts — all preserved (↑↓, Space, Ctrl+C, Ctrl+V, /, Q, W, R, F, A, P, T).

---

## 8. Execution plan — ordered prompts

The future web → Claude Code session should send these prompts to Claude Code **one at a time**, waiting for "All files read" + completion confirmation between each.

### Prompt 1 — Audit + scope confirmation (no code)

**Goal:** Diagnose. Confirm Claude Code has the right files identified and understands the redesign scope. No code written this round.

**Model:** Sonnet ok (read-only).

**Files Claude Code must read and confirm:**
- `CLAUDE.md` (router)
- `docs/CLAUDE_CORE.md`
- `docs/CLAUDE_UI.md`
- `docs/CLAUDE_MAIL_ORDERS.md`
- `components/mail-orders/review-view.tsx` (or `focus-mode-view.tsx` — whichever exists)
- `components/mail-orders/signal-pill.tsx` (or equivalent badge component)
- `lib/mail-orders/utils.ts`
- `lib/mail-orders/types.ts`
- `app/(mail-orders)/mail-orders/page.tsx`

**Output expected:**
- File path of the actual Focus view component (review-view vs focus-mode-view)
- Current location of `getOrderSignals()` and its return shape
- Location of any existing signal/badge pill component
- Confirmation that no schema change is needed
- One-paragraph plain-English summary of what the redesign will replace

**Constraints to enforce in prompt:**
- "Do not write code yet"
- "Confirm 'All files read' before proceeding"

---

### Prompt 2 — Helper functions (Truck Order classification + deliveryRemarks split)

**Goal:** Extend `lib/mail-orders/utils.ts` with two helpers needed by the new UI. Pure functions, easy to test, no UI yet.

**Model:** Sonnet ok.

**Changes:**
1. In `getOrderSignals()`: rename existing `truck` signal type to `truck-order`, no behaviour change otherwise (still triggered by same source). Card destination logic moves to UI — utils.ts just classifies.
2. Add new exported helper `splitDeliveryRemarks(deliveryRemarks: string | null, shipToOverride: boolean): { shipToName: string | null, shipToCode: string | null, deliveryInstruction: string | null }`.
   - Parses `[→ Name (Code)]` suffix when present
   - Returns name, code, and the leftover text after stripping the suffix
   - Returns null fields when `shipToOverride=false`
3. Add unit-style sanity comment block in the file showing 4–5 input/output examples.

**Exit criteria:** `tsc --noEmit` passes. Existing usages of the `truck` signal type updated to `truck-order` across the codebase.

---

### Prompt 3 — Signal pill component: add truck-order variant

**Goal:** Add the violet truck-icon-only variant to the existing pill component.

**Model:** Sonnet ok.

**Changes:**
- Add `truck-order` to the pill type union
- Map it to violet tokens: `bg-violet-50 border-violet-200 text-violet-700`
- Render as icon-only (Lucide `Truck` icon, 12×12) with `title="Truck Order — punch when material received"` for accessibility
- Match the existing pill height (18px), border-radius (4px), padding adjusted to 5px horizontal for icon-only

**Exit criteria:** `tsc --noEmit` passes. Render preview the pill on the existing Mail Orders page to confirm visual match with mockup.

---

### Prompt 4 — Build the two new card components

**Goal:** Create two presentational components — `BillToCard` and `ShipToCard` — in `components/mail-orders/`. No wiring yet, just the components.

**Model:** Opus recommended (multi-file, careful Tailwind work).

**Files to create:**
- `components/mail-orders/bill-to-card.tsx`
- `components/mail-orders/ship-to-card.tsx`

**Props for BillToCard:**
```ts
{
  customerName: string | null;
  customerCode: string | null;
  customerArea: string | null;
  customerMatchStatus: "exact" | "multiple" | "unmatched" | null;
  deliveryType: string | null;  // for the dot colour
  signals: OrderSignal[];        // only bill-class signals — filtered by caller
}
```

**Props for ShipToCard:**
```ts
{
  shipToName: string;          // either captured or mirrored from bill-to
  shipToCode: string | null;
  shipToArea: string | null;
  deliveryType: string | null;
  isOverride: boolean;         // drives amber left-bar + captured pill + tagline
  signals: OrderSignal[];      // only delivery-class signals — filtered by caller
}
```

**Visual contract:** Both cards must render pixel-faithful to `right-panel-redesign-A3-v3.html`. Use the existing Tailwind tokens from CLAUDE_UI.md. No new colours invented.

**Exit criteria:** `tsc --noEmit` passes. Both components render in isolation (preview page) matching the mockup.

---

### Prompt 5 — Build meta ribbon + instructions strip components

**Goal:** Create the meta ribbon and instructions strip components.

**Model:** Sonnet ok (presentational, single-purpose).

**Files to create:**
- `components/mail-orders/meta-ribbon.tsx`
- `components/mail-orders/instructions-strip.tsx`

**MetaRibbon props:**
```ts
{
  soName: string;
  receivedAt: string;
  volume: string;            // e.g. "152L"
  matchedLines: number;
  totalLines: number;
  punchedByName: string | null;
  punchedAt: string | null;
  onCopy: () => void;
  onReply: () => void;
  onFlag: () => void;
  soNumberInput: React.ReactNode;  // the existing SO Number input passed through
  punchButton: React.ReactNode;    // the existing Punch button passed through
}
```

**InstructionsStrip props:**
```ts
{
  delivery: string | null;
  bill: string | null;
  notes: string | null;
}
```

Returns null when all three are null. Dot-prefixed rows per category.

**Exit criteria:** `tsc --noEmit` passes. Components render in preview matching mockup.

---

### Prompt 6 — Wire everything into review-view.tsx, remove old header/footer

**Goal:** Replace the current right-panel JSX in `review-view.tsx` with the new card-based layout. Delete the old remarks footer.

**Model:** Opus recommended.

**Steps inside the prompt:**
1. Read `review-view.tsx` fully
2. Identify the right-panel section (between order list and SKU table)
3. Replace with: `<div className="grid grid-cols-2 gap-3 px-4 pt-3"><BillToCard ... /><ShipToCard ... /></div>` + `<MetaRibbon ... />` + `<InstructionsStrip ... />`
4. Remove the existing remarks footer entirely
5. Filter `signals` into bill-class vs delivery-class arrays before passing into each card
6. Call `splitDeliveryRemarks()` to derive ship-to data + delivery instruction text
7. Wire SO Number input + Punch button through MetaRibbon's slot props (don't rebuild them — pass the existing JSX through)
8. Confirm keyboard handlers all still work — they live at the page level, not the right-panel level

**Exit criteria:**
- `tsc --noEmit` passes
- Local dev server runs without errors
- Visual smoke check on at least 3 real orders: one clean, one with ship-to override, one with multiple remarks
- All keyboard shortcuts still respond

---

### Prompt 7 — Local smoke test checklist (manual, no code)

**Goal:** Run through the test checklist before pushing to main.

**Test scenarios on local dev server:**

1. **Clean order** — no ship-to override, no remarks, no blockers. Should see: two cards same content, no instructions strip, no extra tags. Meta ribbon shows `✓ 7/7`.
2. **Ship-to override** — different customer in `[→ Name (Code)]` suffix. Should see: Ship-to card with amber left bar + captured pill + different name.
3. **Bill-to blockers** — order from a customer with OD or CI flag. Should see: red OD pill inside Bill-to card.
4. **Truck Order** — order tagged for truck delivery. Should see: violet truck icon pill inside Bill-to card.
5. **All three remark categories** — order with delivery instruction + bill remark + free-text note. Should see: instructions strip with three dot-prefixed rows.
6. **Punched order** — order with `status='punched'`. Should see: SO Number stamp + green Punched pill, meta ribbon shows `punched by Bankim · 10:22`.
7. **Partial match** — order with `matchedLines < totalLines`. Should see: amber `⚠ 5/7` chip in meta ribbon, amber code chip in Bill-to card if `customerMatchStatus='multiple'`.
8. **Keyboard navigation** — Q/W between orders, ↑↓ between SKU lines, Space toggles found/not-found, Ctrl+C copies, Ctrl+V pastes into SO Number input, / focuses search.

**Bug log:** any issues → diagnose with one more Sonnet prompt before pushing.

---

### Prompt 8 — Commit to main + verify on orbitoms.in

**Goal:** Ship.

**Model:** Sonnet ok.

**Steps inside the prompt:**
1. `tsc --noEmit` — must pass
2. `git status` — review files touched
3. `git add` — quoted paths for `app/(mail-orders)/...` due to PowerShell parentheses
4. Commit message: `feat(mail-orders): redesign review view right panel — twin Bill-to/Ship-to cards + instructions strip`
5. `git push origin main`
6. Wait ~60 seconds for Vercel deploy
7. Open `https://orbitoms.in/mail-orders` and confirm visual match with mockup on at least one real order

**Rollback plan:** if anything looks wrong on production, `git revert HEAD` immediately and re-push. Smoke test was local — production should match.

---

## 9. Notes for the future web session

When you (Smart Flow) open the next web session to execute this:

1. **Attach this file** along with the standard 7 context files.
2. **Tell Claude.ai:** "Use `web-update-2026-05-20-review-view-redesign.md` to draft prompts. Give me prompt 1 only. Wait for me to confirm Claude Code finished before giving prompt 2."
3. The HTML mockup `right-panel-redesign-A3-v3.html` is the visual contract. Attach it too if Claude needs to reference the exact look.
4. **Do not let Claude.ai skip the audit prompt.** Even if it seems redundant, prompt 1 forces Claude Code to read the actual review-view file path — which might be either `review-view.tsx` or `focus-mode-view.tsx` and we don't want to guess.

---

## 10. Open questions to verify during execution

- **`slotToOverride` semantics** — flag exists in types but UI spec doesn't detail when it fires. Verify what triggers it before deciding final pill copy.
- **`(jsw)` prefix** — kept in meta ribbon per current spec, but confirm this is still desired. Some operators may prefer dropping the prefix now that SO name is more prominent.
- **Truck Order icon-only legibility** — if operators struggle to learn the violet truck icon, add small "TO" letter label after 1–2 weeks.

---

**End of spec.**
