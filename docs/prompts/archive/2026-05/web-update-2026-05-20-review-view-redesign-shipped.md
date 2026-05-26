# Web Update — Review View Right Panel Redesign (SHIPPED)

**Session date:** 2026-05-20
**Status:** Live on production at `https://orbitoms.in/mail-orders`
**Commit:** `6dafad8e` on `main`
**Scope:** Mail Orders → Focus / Review view → right panel
**Net code delta:** +915 / −1787 lines across 11 files (−872 net)

---

## 1. What shipped

The Review View right-panel was rewritten from a single verbose detail-header into a clean composable structure:

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐   ┌─────────────────┐                      │
│  │ BILL TO         │   │ SHIP TO  [⚑]    │  ← amber bar         │
│  │ ● Customer Name │   │ ● Customer Name │    if override       │
│  │   [code] · area │   │   [code] · area │                      │
│  │   [bill pills]  │   │   [ship pills]  │                      │
│  └─────────────────┘   └─────────────────┘                      │
├─────────────────────────────────────────────────────────────────┤
│  SO name · time · vol · ✓ 7/7 · punched · actions · SO# · Punch│
├─────────────────────────────────────────────────────────────────┤
│  ● delivery — "leave at gate"   ← gray-200 attention band      │
│  ● bill     — "split into 2"                                   │
│  ● notes    — "spoke to Mahesh"                                │
├─────────────────────────────────────────────────────────────────┤
│  Manual split banner (unchanged)                               │
├─────────────────────────────────────────────────────────────────┤
│  [ SKU TABLE — inside white wrapper on gray-50 page ]          │
└─────────────────────────────────────────────────────────────────┘
```

Page background tint: `bg-gray-50`. Cards + SKU table sit as white islands.

---

## 2. Files in the final commit

| File | Action | Net lines |
|---|---|---|
| `app/(mail-orders)/mail-orders/review-view.tsx` | Major rewrite + polish | -131 net (after final state) |
| `app/(mail-orders)/mail-orders/focus-mode-view.tsx` | Deleted (orphan) | -1283 |
| `app/(mail-orders)/mail-orders/mail-orders-table.tsx` | Use SignalPill import | -16 |
| `app/api/mail-orders/route.ts` | Ship-to lookup batch | +37 |
| `lib/mail-orders/utils.ts` | OrderSignal.card field, splitDeliveryRemarks, status emit, truck-order | +~80 |
| `lib/mail-orders/types.ts` | shipToArea, shipToDeliveryType, ParsedDeliveryRemarks | +5 |
| `components/mail-orders/signal-pill.tsx` | NEW | +49 + edits |
| `components/mail-orders/bill-to-card.tsx` | NEW (+ 3 prompt-7a/b.0 extensions) | +108 |
| `components/mail-orders/ship-to-card.tsx` | NEW (+ polish: mirror behaviour) | +~90 |
| `components/mail-orders/meta-ribbon.tsx` | NEW | +122 |
| `components/mail-orders/instructions-strip.tsx` | NEW | +58 |

---

## 3. Key locked decisions (source of truth for future sessions)

### 3.1 OrderSignal data model

`OrderSignal` interface now carries a mandatory `card` field that determines which card a signal renders inside:

```ts
export interface OrderSignal {
  label: string;
  type: "blocker" | "attention" | "info" | "split" | "bill" | "status" | "truck-order";
  card: "bill" | "ship";
  dot?: string;
}
```

**Routing rules:**

| Signal | Type | Card |
|---|---|---|
| OD, CI, Bounce | blocker | bill |
| Bill N | bill | bill |
| Bill Tomorrow, Cross XYZ | attention | bill |
| ✂ Bill X-Y, ⚠ Split | split | bill |
| 7 Days, Extension, DPL | info | bill |
| Truck Order (renamed from "Truck") | truck-order | bill |
| Urgent | attention | ship |
| Challan | info | ship |
| Hold / Dispatch / any dispatchStatus value | status | ship |

**Removed entirely:** `→ Ship-to` (was attention/bill in pre-redesign — replaced by amber left-bar + captured pill on ShipToCard).

**Why mandatory `card` field, not label filter:** classification belongs at the emit site (one place: `utils.ts`), consumers stay dumb (many places). New signals added later get TypeScript-enforced card routing.

### 3.2 Dispatch / Hold pill semantics

`dispatchStatus` on `mo_orders` defaults to `"Dispatch"` at parser ingest. Operators can't change it from the UI today — only the PowerShell parser sets it based on email keywords.

**Pill rendering rule (matches pre-redesign behaviour exactly):**

- `dispatchStatus === "Hold"` → red Hold pill
- Any other truthy value → green Dispatch pill (label = the raw string)
- Falsy → no pill

This was a deliberate choice during planning — the Dispatch pill is a "parser detected no Hold keyword" confirmation, not noise. Don't redesign this without re-reading the planning rationale.

### 3.3 splitDeliveryRemarks helper

New helper in `lib/mail-orders/utils.ts`:

```ts
splitDeliveryRemarks(
  deliveryRemarks: string | null | undefined,
  shipToOverride: boolean
): {
  shipToName: string | null;
  shipToCode: string | null;
  deliveryInstruction: string | null;
}
```

**Parses the `[→ Name (Code)]` suffix appended by `matchDeliveryCustomer()`.** Returns parsed identity + leftover instruction text. Used in two places:
1. Review-view caller to derive Ship-to card props
2. Could be reused elsewhere (e.g. dispatch screen if it shows ship-to)

### 3.4 Loader extension

`GET /api/mail-orders` now does **two sequential Prisma queries** (NOT `$transaction` — per CORE §3):

1. Existing bill-to batch against `mo_customer_keywords` by `customerCode`
2. NEW: ship-to batch against `mo_customer_keywords` by ship-to codes parsed from `deliveryRemarks` of orders where `shipToOverride === true`

Response now includes:
```ts
shipToArea: string | null
shipToDeliveryType: string | null
```

Always attached (null when not applicable). Behaviour:
- `shipToOverride === false` → both null
- `shipToOverride === true` + parseable suffix + code in `mo_customer_keywords` → populated
- `shipToOverride === true` + code not in `mo_customer_keywords` → both null (clean fallback)

### 3.5 Bill-to card — three optional props for picker preservation

The customer code chip on Bill-to card supports the existing customer-resolution picker workflow via three optional props:

```ts
interface BillToCardProps {
  // ...mandatory props...
  onCodeClick?: () => void;
  popoverSlot?: React.ReactNode;
  chipFallbackLabel?: string;
}
```

**Rules:**
- `onCodeClick` set → chip becomes a `<button>` (else `<span>`, read-only)
- `popoverSlot` set → renders absolute-positioned panel below chip
- `chipFallbackLabel` set + `customerCode` null → chip shows the fallback label instead

**Usage in review-view.tsx:**

- `customerMatchStatus === "exact"` → all three props undefined, chip is read-only
- `customerMatchStatus === "multiple"` → `chipFallbackLabel = "N found ▾"`, `onCodeClick` toggles `codePopoverOpen`, `popoverSlot` carries the existing candidate-list popover JSX
- `customerMatchStatus === "unmatched"` → `chipFallbackLabel = "Search…"`, same toggle, `popoverSlot` carries the existing search popover JSX

The popover content (candidate list, search input, click-outside-to-close, all handlers) lives in `review-view.tsx` and is passed verbatim as `popoverSlot`. Only the positioning wrapper moved into BillToCard.

### 3.6 Ship-to card behaviour

**When `isOverride === false` (most orders):**
- Card mirrors Bill-to fully: code chip (default gray, NOT match-status modulated) · area · region
- No italic "Ships to billing address" tagline (removed in polish phase)
- Cards look symmetric — the *difference* on override orders pops more clearly

**When `isOverride === true`:**
- 3px amber left-edge bar via `before:` pseudo-element
- Small amber `⚑ captured` pill inline with "SHIP TO" label
- Identity from `splitDeliveryRemarks(...)` parse: shipToName + shipToCode + shipToArea + shipToDeliveryType (resolved via new loader batch)

### 3.7 Instructions strip

Renders below MetaRibbon. Returns `null` when all three values are null/empty.

**Visual spec (final, polished):**
- Outer: `bg-gray-200 border-t border-gray-100 pt-3 pb-3` (darker band, more padding)
- Label: `text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500 w-16` (darker)
- Dots:
  - delivery: `bg-amber-600` (darker)
  - bill: `bg-blue-700` (darker)
  - notes: `bg-gray-600` (notably darker — was barely visible at gray-400)

**Notes collapse rule:** Caller in review-view.tsx pre-collapses the 5 typed remark sub-types (contact, instruction, cross, customer, unknown) into one notes string via `" · "` join. Strip itself only knows 3 rows: delivery, bill, notes.

### 3.8 MetaRibbon

Single horizontal line below the cards. Pure presentational, all data + slots from caller.

```ts
interface MetaRibbonProps {
  soName: string | null;
  receivedAt: string;            // pre-formatted "HH:MM"
  volume: string;                // e.g. "152L"
  matchedLines: number;
  totalLines: number;
  punchedByName: string | null;
  punchedAt: string | null;      // pre-formatted "HH:MM" or null
  actionsSlot: React.ReactNode;       // existing copy/reply/flag/print JSX
  soNumberSlot: React.ReactNode;      // existing SO input + punched-display ternary
  punchButtonSlot: React.ReactNode;   // null in current usage (Punch is inside soNumberSlot)
}
```

**Match chip thresholds:**
- `totalLines === 0` → no chip
- `matchedLines === totalLines` → green `✓ N/N`
- `matchedLines === 0` → red `✗ 0/N`
- Partial → amber `⚠ M/N`

**Punched-by segment** only renders when both `punchedByName && punchedAt` truthy.

### 3.9 Page background hierarchy (right panel)

Locked tonal layers:

```
gray-50 (page tint on mo-print-area)
  ↓
white (Bill-to card, Ship-to card, MetaRibbon, SKU table wrapper)
  ↓
gray-200 (Instructions strip — attention band)
```

MetaRibbon does NOT have explicit `bg-white` — it sits on the gray-50 page tint deliberately. Ribbon is infrastructure, not primary content. If operators report the ribbon feels lost, adding `bg-white` to its wrapper is a one-line follow-up.

### 3.10 SKU table wrapper (critical CSS)

The SKU table needed a defensive white wrapper to survive the page tint AND a specific flex setup to scroll correctly inside it:

```html
<div className="bg-white border border-gray-200 rounded-lg mx-4 mt-3 mb-3 flex flex-col flex-1 min-h-0 overflow-hidden">
  {renderSkuTable(selectedOrder)}
</div>
```

**Why every class matters:**
- `bg-white border border-gray-200 rounded-lg` — visual white island on gray-50 page
- `mx-4 mt-3 mb-3` — alignment with cards grid padding
- `flex flex-col` — gives inner `flex-1 overflow-y-auto` a vertical flex context
- `flex-1 min-h-0` — wrapper claims allocated space, can shrink below content height
- `overflow-hidden` — contains height to allocated flex space (prevents page-level scroll)

Removing any one breaks scroll. Took two iterations (7d → 7e) to land the right combo. Do not touch this without understanding all 5 classes.

---

## 4. Removed / deprecated

- `RemarkSection` module-level helper (only used by deleted 4-column footer)
- `handleCopyCode` function + `codeFlash` state (chip-click copy redundant with page-level Ctrl+C smart-copy)
- Old `metaParts` array construction
- Old inline `signalStyles` map (now lives inside `SignalPill` component)
- `→ Ship-to` signal label (replaced by ShipToCard's amber bar + captured pill)
- `focus-mode-view.tsx` (orphan, was marked deleted in `CLAUDE_MAIL_ORDERS.md §19` since prior session)

---

## 5. Known small regression (acceptable)

**Unmatched picker: one extra click.**

Pre-redesign: "unmatched" orders rendered an amber-bordered search INPUT directly as the chip-replacement. Operators could start typing immediately.

Post-redesign: "unmatched" orders show a red "Search…" chip. Operators click it first, then the popover opens with the search input (with `autoFocus`).

One extra click. Discussed during planning, accepted. Worth re-evaluating after a week of operator use — if Deepanshu/Bankim complain, restore inline-input behaviour via BillToCard extension or a new render branch.

---

## 6. Deferred follow-up items

| Item | Priority | Notes |
|---|---|---|
| Add `.claude/settings.local.json` to `.gitignore` | Low | Already on prior roadmap. Today's session re-confirmed it. Trivial one-liner. |
| Mail Orders Table view consistency | Medium | This redesign was Focus view only. Decide if/how Table view adopts similar visual treatment. |
| MetaRibbon `bg-white` (Interpretation β) | Optional | If operators feel the ribbon looks lost on the gray tint, wrap it in `bg-white border rounded-lg` like the cards. Currently α (no wrapper). |
| Unmatched picker inline-input restore | Medium | See §5. Pending operator feedback. |
| Live multi-line `chipFallbackLabel` width handling | Low | If a customer has 12+ candidates, the "12 found ▾" chip still fits, but text could wrap on very narrow screens. Not seen yet. |
| Stale section header comments in `getOrderSignals()` | Low | Comments like `// ── ATTENTION ──` are slightly out of date now that Urgent (under ATTENTION) routes to ship card. Cosmetic only. |

---

## 7. Process learnings from this session

1. **Big edits benefit from staged "X.0 / X.a / X.b" sub-prompts.** Prompt 7 had to be split into 7a (add picker props), 7b.0 (add fallback label), then 7b (wire-up) when blockers surfaced mid-planning. Catching design gaps during planning, not implementation, saved an estimated 2 rollback rounds.

2. **"Don't modify component" rules need an explicit override path.** The "Option C" override (extend BillToCard mid-wire-up) was the right call but tested the rule. Sessions should explicitly document when component extension is approved, separately from sneaky silent edits.

3. **Visual mockups before page-background changes pay off.** The mockup tool round before Prompt 7c caught zero surprises but built confidence — and forced articulation of the tonal hierarchy (gray-50 page → white cards → gray-200 strip).

4. **SKU table wrapper took 2 polish iterations (7d, 7e).** Lesson: when wrapping an existing component that has its own `flex-1 overflow-y-auto`, the wrapper MUST provide both (a) a flex column context AND (b) height containment. Either alone fails. Worth noting in CLAUDE_UI.md if similar wrapping happens elsewhere.

5. **Picker preservation was the highest-value catch.** A daily workflow was 1 prompt away from silent regression. The "stop and surface blockers" pattern from Claude Code at the planning step is the most valuable safety net we have.

---

## 8. Consolidation target

This file should be folded into the canonical context files at next consolidation:

- `docs/CLAUDE_MAIL_ORDERS.md` — update §10 (Review View) with the new card layout, picker behaviour, and instructions strip
- `docs/CLAUDE_UI.md` — add the SKU table wrapper CSS pattern (§5 or new section), the page tonal hierarchy (gray-50 / white / gray-200), and the OrderSignal `card` field convention
- `docs/CLAUDE_CORE.md` — no changes needed (schema version unchanged, engineering rules followed)

After consolidation, move this draft to `docs/archive/drafts/2026-05/`.

---

**End of session-end context update.**
