# Context Update v70

## NEW/MODIFIED FILES

- `lib/mail-orders/utils.ts` — Added `getOrderSignals()` shared signal builder (returns `OrderSignal[]` with type `blocker|attention|info|split|bill`), `getBillLabel()` helper for extracting "Bill N" from remarks. Multi-bill capture via `matchAll` with ascending sort. `getOrderFlags()` unchanged (still used by reply template).
- `lib/mail-orders/email-template.ts` — `buildSlotSummaryHTML()` appends `· Bill N` plain text suffix to customer name in processed, pending, and not-available sections.
- `app/(mail-orders)/mail-orders/mail-orders-table.tsx` — Inline signal builder replaced with `getOrderSignals()` call. `signalStyles` object now includes `bill` type. No rendering changes.
- `app/(mail-orders)/mail-orders/review-view.tsx` — Header Row 1 uses `getOrderSignals()` for all 15+ badge types. Left panel rows show Bill N (blue) badges only. Left panel sort: `receivedAt ASC → bill number ASC → split label ASC`. Reply template includes Bill N suffix in customer name.
- `app/(mail-orders)/mail-orders/mail-orders-page.tsx` — R key reply handler includes Bill N suffix in customer name via `getBillLabel()`.

## BUSINESS RULES ADDED

**Signal badge system — shared `getOrderSignals()`:** Single source of truth in `utils.ts`. Returns `OrderSignal[]` with 6 type tiers: `blocker` (red), `attention` (amber), `info` (gray), `split` (purple), `bill` (blue). Both Table View and Review View consume it.

**Bill N badge — new `bill` type (blue):** `bg-blue-50 text-blue-700 border-blue-200`. Extracted from remarks via `/\bbill\s+(\d+)\b/g`. Multiple bill numbers captured, deduplicated, sorted ascending. Bill 1 before Bill 2 before Bill 10.

**Review View header Row 1:** Shows ALL signal badges (blocker, attention, info, split, bill) plus dispatch badge. No filtering — same signals as Table View.

**Review View left panel badges:** Bill N (blue) badges ONLY — no blockers, no other signals. Purpose: let Deepanshu identify which bill is which when same customer has multiple bills.

**Review View left panel sort:** `receivedAt ASC → bill number ASC → split label ASC`. Bill number extracted from remarks via `getBillNumber()` local helper. Orders with no bill number sort as 0 (before Bill 1).

**Email Bill N suffix:** `buildSlotSummaryHTML()` and reply template append `· Bill N` as plain text after customer name. No HTML styling — survives OWA paste sanitizer. Applied to processed, pending, and not-available sections. Normal orders (no bill number) show no suffix.

**Outlook email constraints (confirmed):** OWA paste strips text `color:` on `<td>` — Hold order dimming (`#cbd5e1`) does not render. Only the `*` suffix survives. All email additions must be plain text, no `<span>` styling.

## PENDING ITEMS

1. **Hold order dimming in email** — `color:#cbd5e1` stripped by OWA paste. Hold orders appear same color as normal orders. Only `*` suffix distinguishes them. Needs alternative approach (e.g. strikethrough, or `[HOLD]` text prefix).
2. **Email sort order** — Processed section sorts by `punchedAt` descending. Should sort by `receivedAt ASC → bill number ASC` to match left panel order. Currently Bill 1 and Bill 10 from same customer appear scattered.

## CHECKLIST UPDATES

- **Signal badges:** `getOrderSignals()` in `utils.ts` is the single source. Never build signal logic inline — import the shared function.
- **Bill type:** 6th signal type `'bill'` with blue style. Added to `OrderSignal` union type.
- **getBillLabel():** Returns `"Bill N"` or `""`. Used in email template and reply template customer name suffix.
- **Left panel badges:** Bill N only. No blockers in left panel.
- **Left panel sort:** Three-tier: receivedAt → bill number → split label. All ascending.
- **Email plain text only:** Never add HTML styling to email template customer names. OWA paste strips it.
