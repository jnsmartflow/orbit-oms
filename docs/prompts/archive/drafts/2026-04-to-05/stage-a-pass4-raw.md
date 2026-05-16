# Stage A — Pass 4 raw findings — String-content matching on the `product` field

Generated: 2026-05-07

---

## Summary

- Direct string operation hits (Step 1): 5 (all in `lib/mail-orders/taxonomy-mapping.ts`, LEGACY-MAP)
- Equality/inequality hits (Step 2): ~100 total
  - 98 in `lib/mail-orders/taxonomy-mapping.ts` (LEGACY-MAP) — full inventory in Step 6 table
  - 2 in `lib/mail-orders/enrich.ts` (KW)
- Switch/case statements (Step 3): 0
- Filter/find/some/every callbacks (Step 4): 1 (`lib/mail-orders/enrich.ts:772`, KW)
- Regex test/match against `product` (Step 5): 22 (all in `lib/mail-orders/taxonomy-mapping.ts`, LEGACY-MAP) — full inventory in Step 6 table
- Total literal strings tested against SKU-shape `.product` (deduplicated, LEGACY-MAP): 99 string literals + 22 regex patterns
- SKU-shape (LEGACY-MAP) hits vs other-table hits: ~125 LEGACY-MAP : 3 KW (~ 42 : 1)

---

## Variable type categorisation key

- **SKU** — direct read from `mo_sku_lookup.product` (in scope for Stage B)
- **LEGACY-MAP** — the `legacy: LegacyKey` and its `prod` alias inside `lib/mail-orders/taxonomy-mapping.ts`. The file's opening comment (lines 1–3) declares `LegacyKey.product` IS `mo_sku_lookup.product`. Treated as SKU-shape for Stage B purposes.
- **KW** — from `mo_product_keywords.product` (`pk.product`) or types derived from it (`ProductMatch.product`, `ScoredCandidate.product`)
- **PARSER** — from `EnrichResult.productName` or `mo_order_lines.productName`
- **FORM-INDEX** — from `mo_order_form_index.subProduct`
- **UNKNOWN** — couldn't determine

The only files in scope that perform string-content matching on `.product` are:
- `lib/mail-orders/taxonomy-mapping.ts` (LEGACY-MAP — bulk of findings)
- `lib/mail-orders/enrich.ts` (KW — three hits)

No matches found in any of the other 8 in-scope files.

---

## Step 1 — Direct string operations

### lib/mail-orders/taxonomy-mapping.ts

**Line 161** — `legacy.product.toUpperCase().trim()` — variable type: LEGACY-MAP

Variable: `legacy.product` (function param `legacy: LegacyKey`)
Argument: none — chained `.toUpperCase().trim()` to normalise before comparisons in `getSkipReason()`

```
158:
159: export function getSkipReason(legacy: LegacyKey): string | null {
160:   const cat  = legacy.category.toUpperCase().trim();
161:   const prod = legacy.product.toUpperCase().trim();
162:   if (HIDDEN_BY_CATEGORY[cat]) return HIDDEN_BY_CATEGORY[cat];
163:   for (const [c, p, reason] of SKIPPED_PAIRS) {
164:     if (cat === c && prod === p) return reason;
```

**Line 467** — `legacy.product.toUpperCase().trim()` — variable type: LEGACY-MAP

Variable: `legacy.product`
Argument: none — chained `.toUpperCase().trim()` to produce the master `prod` alias used throughout `mapLegacyToNew()`

```
464:   if (getSkipReason(legacy)) return null;
465:
466:   const cat  = legacy.category.toUpperCase().trim();
467:   const prod = legacy.product.toUpperCase().trim();
468:   const bc   = normalizeBase(legacy.baseColour);
469:
470:   // ── WOODCARE (Round 1) — pattern-based SADOLIN dispatch ──────────────
```

**Line 748** — `prod.includes("CONCRETE")` — variable type: LEGACY-MAP (alias `prod` of `legacy.product`)

Variable: `prod`
Literal: `"CONCRETE"`
Used inside the `cat === "VT"` branch as a fall-through after exact matches against `"VT CONCRETE FINISH"` and `"VT FINISH"`.

```
745:     if (prod === "VT CLEAR COAT")    return [row("VT SPECIALTY", "VT CLEAR COAT", bc)];
746:     if (prod === "VT MARBLE")        return [row("VT SPECIALTY", "VT MARBLE", bc)];
747:     if (prod === "VT VELVETINO" || prod === "VELVETINO") return [row("VT SPECIALTY", "VELVETINO", bc)];
748:     if (prod === "VT CONCRETE FINISH" || prod === "VT FINISH" || prod.includes("CONCRETE"))
749:                                      return [row("VT SPECIALTY", "VT CONCRETE FINISH", bc)];
750:     if (prod === "AMBIANCE")         return [row("VT SPECIALTY", "AMBIANCE", bc)];
751:     return null;
```

**Line 760** — `legacy.product.trim().toUpperCase()` — variable type: LEGACY-MAP

Variable: `legacy.product`
Used as the `subProduct` value when an AQUATECH product has no specific rule — preserves the raw legacy string, normalised.

```
757:     if (prod === "WATERPROOF PUTTY") return [row("PUTTY", "WATERPROOF PUTTY", bc)];
758:     // All other AQUATECH products preserved under AQUATECH family with
759:     // their existing product name as the sub-product.
760:     return [row("AQUATECH", legacy.product.trim().toUpperCase(), bc)];
761:   }
762:
763:   if (cat === "FLOOR PLUS")            return [row("FLOOR PLUS", "FLOOR PLUS", bc)];
```

**Line 825** — `legacy.product.trim()` — variable type: LEGACY-MAP

Variable: `legacy.product`
Used as the colour value (passed as `baseColour`) under STAINER → UNIVERSAL STAINER mapping. The legacy `product` field carries the colour name in this category.

```
822:   // STAINER — collapse 10 colour-shade sub-products into UNIVERSAL STAINER
823:   // with colour as baseColour. legacy.product carries the colour name.
824:   if (cat === "STAINER") {
825:     const colour = legacy.product.trim();
826:     return [row("STAINER", "UNIVERSAL STAINER", colour)];
827:   }
828:
```

---

## Step 2 — Equality/inequality

### lib/mail-orders/enrich.ts

**Line 360** — `pk.product !== prodName` — variable type: KW

Variable: `pk` (`ProductKeyword` from `mo_product_keywords`)
Other side: `prodName` (a local string from `productProfiles.entries()`)

Used inside `buildProductProfiles()` to detect the "product name IS itself a base colour" case (e.g. BLACK stainer where product BLACK has base BLACK).

```
357:       if (theBase && allBaseColours.has(theBase)) {
358:         // Check if any product keyword for this product matches a base keyword
359:         for (const pk of productKeywords) {
360:           if (pk.product !== prodName) continue;
361:           for (const bk of baseKeywords) {
362:             if (pk.keyword === bk.keyword) {
363:               profile.isBaseProduct = true;
```

**Line 751** — `second.product === top.product` — variable type: KW (`ScoredCandidate.product`, originally sourced from `pm.product` which comes from `ProductKeyword`)

Variable: `second` and `top` are `ScoredCandidate` objects (built from `ProductMatch` which is built from `ProductKeyword`).
Other side: variable comparison — not a string literal.

Used in tie-detection: if two top candidates have the same product, same primary-pack flag, same base presence, but different SKU material → return `partial`.

```
748:   if (
749:     second &&
750:     second.score === top.score &&
751:     second.product === top.product &&
752:     second.isPrimaryPack === top.isPrimaryPack &&
753:     (!!second.base) === (!!top.base) &&
754:     second.sku.material !== top.sku.material
```

### lib/mail-orders/taxonomy-mapping.ts

98 hits — see consolidated Step 6 table below for full inventory.

---

## Step 3 — Switch/case

No `switch (...product)` statements found in any in-scope file.

---

## Step 4 — Filter/find/some/every

### lib/mail-orders/enrich.ts

**Line 772** — `prodMatches.find(pm => pm.product === top.product)` — variable type: KW (`ProductMatch.product`)

Variable: `pm` (from `prodMatches: { keyword, product, len }[]`, populated from `productKeywords: ProductKeyword[]`)
Compared against: `top.product` (`ScoredCandidate.product`, also KW-derived)

Used in the fallback unrecognised-base check: locate the `ProductMatch` whose product equals the winning candidate's product, then compute the unmatched residue text after the keyword.

```
769:
770:   // ── Step 6b: Check for unrecognized base text when using fallback ──
771:   if (top.isFallback) {
772:     const matchedProdKw = prodMatches.find(pm => pm.product === top.product);
773:     if (matchedProdKw) {
774:       const kwEnd = text.indexOf(matchedProdKw.keyword) + matchedProdKw.keyword.length;
775:       const afterKw = text.substring(kwEnd).trim();
```

---

## Step 5 — Regex tests

### lib/mail-orders/taxonomy-mapping.ts

22 regex tests against `prod` (LEGACY-MAP). Full inventory in the Step 6 regex table below.

No regex tests against any other `.product` field were found in the in-scope files.

---

## Step 6 — Taxonomy-mapping.ts deep scan

The file matches against `prod` (= `legacy.product.toUpperCase().trim()`, derived from `mo_sku_lookup.product`) using:

1. **`SKIPPED_PAIRS` array loop** — line 164 runs `prod === p` against each entry in the `SKIPPED_PAIRS` table (lines 141–157). Listed below as data, not code.
2. **Direct `prod === "..."` if-chains** — gated by an outer `cat === "..."` branch.
3. **Direct `prod.includes(...)`** — line 748.
4. **Regex `/.../.test(prod)`** — for prefix/suffix/shape-based fallthroughs in SADOLIN and TINTER branches.

### `SKIPPED_PAIRS` literals tested via `prod === p` at line 164

| (Category, Product) | Match operator | Routes to | Source line |
|---|---|---|---|
| ("DULUX", "5IN1") | === | skip — Hidden DULUX/5IN1 | 142 |
| ("DULUX", "SILK FINISH") | === | skip — Skipped orphan | 143 |
| ("DULUX", "IAE PROJECT") | === | skip — Skipped orphan | 144 |
| ("DUWEL", "DUWEL ENAMEL") | === | skip — Skipped orphan | 145 |
| ("SADOLIN", "EPOXY INSULATOR") | === | skip — Deferred industrial | 146 |
| ("SADOLIN", "EPOXY INSULATOR HARDNER") | === | skip — Deferred industrial | 147 |
| ("WEATHERCOAT", "WS ELASTOMERIC") | === | skip — Deferred specialty | 151 |
| ("WEATHERCOAT", "WS FLASH") | === | skip — Deferred specialty | 152 |
| ("WEATHERCOAT", "WS PRIMA E900") | === | skip — Deferred specialty | 153 |
| ("WEATHERCOAT", "WS PROJECT") | === | skip — Deferred specialty | 154 |
| ("WEATHERCOAT", "WS TR E2000") | === | skip — Deferred specialty | 155 |
| ("WEATHERCOAT", "WS ULTRACLEAN") | === | skip — Deferred specialty | 156 |

### Direct `prod === "literal"` dispatch — full inventory

(Each row applies inside the surrounding `cat === "..."` branch, indicated in column 4.)

| Literal/Pattern | Match operator | Routes to | Outer cat | Line |
|---|---|---|---|---|
| `"LUXURIO PU MATT"` | === | row("LUXURIO", "MATT", bc) | SADOLIN | 486 |
| `"LUXURIO PU GLOSS"` | === | row("LUXURIO", "GLOSS", bc) | SADOLIN | 487 |
| `"LUXURIO PU SEALER"` | === | row("LUXURIO", "SEALER", bc) | SADOLIN | 488 |
| `"MULTI PURPOSE THINNER"` | === | row("PU PRIME", "MULTI PURPOSE THINNER", bc) | SADOLIN | 500 |
| `"NC 1KPU GLOSS"` | === (in `||` with regex) | row("NC", "NC 1KPU GLOSS", bc) | SADOLIN | 519 |
| `"NC NECOL"` | === | row("NC", "NC NECOL", bc) | SADOLIN | 530 |
| `"NC NECOL CLEAR"` | === | row("NC", "NC NECOL CLEAR", bc) | SADOLIN | 531 |
| `"NC NECOL THINNER"` | === | row("NC", "NC NECOL THINNER", bc) | SADOLIN | 532 |
| `"NC SANDING SEALER"` | === | row("NC", "NC SANDING SEALER", bc) | SADOLIN | 536 |
| `"NC WOOD THINNER"` | === | row("NC", "NC WOOD THINNER", bc) | SADOLIN | 537 |
| `"EPOXY 1K PRIMER"` | === | row("PRIMER", "EPOXY PRIMER", bc) | SADOLIN | 541 |
| `"WOOD STAINER"` | === | row("WOOD STAIN", "WOOD STAIN", …) | SADOLIN | 544 |
| `"WOOD STAIN"` | === | row("WOOD STAIN", "WOOD STAIN", …) | SADOLIN | 544 |
| `"WOOD FILLER"` | === | row("WOOD FILLER", "WOOD FILLER", …) | SADOLIN | 545 |
| `"PU ENAMEL"` | === | row("GLOSS", "GLOSS", bc) | PU | 556 |
| `"SUPER SATIN"` | === | row("SATIN", "SUPER SATIN", bc) | SATIN | 559 |
| `"SATIN STAY BRIGHT"` | === | row("SATIN", "SATIN STAY BRIGHT", bc) | SATIN | 560 |
| `"GLOSS"` | === | row("GLOSS", "GLOSS", bc) | DULUX | 567 |
| `"LUSTRE"` | === | row("LUSTRE", "LUSTRE", bc) | DULUX | 568 |
| `"SATIN STAY BRIGHT"` | === | row("SATIN", "SATIN STAY BRIGHT", bc) | DULUX | 569 |
| `"SUPER SATIN"` | === | row("SATIN", "SUPER SATIN", bc) | DULUX | 570 |
| `"PU ENAMEL"` | === | row("GLOSS", "GLOSS", bc) | DULUX | 571 |
| `"SUPERCLEAN"` | === | row("SUPERCLEAN", "SUPERCLEAN", bc) | DULUX | 572 |
| `"3IN1"` | === | row("SUPERCLEAN", "SUPERCLEAN 3IN1", bc) | DULUX | 573 |
| `"INTERIOR DISTEMPER"` | === | row("DISTEMPER", "ACRYLIC DISTEMPER", …) | DULUX | 574 |
| `"ALKALI BLOC PRIMER"` | === | row("PRIMER", "ALKALI BLOC PRIMER", bc) | DULUX | 575 |
| `"SMOOTHOVER"` | === | row("SMOOTHOVER", "SMOOTHOVER", bc) | DULUX | 576 |
| `"SUPERCOVER"` | === | row("SUPERCOVER", "SUPERCOVER", bc) | DULUX | 580 |
| `"PROMISE ENML"` | === | 2 rows (PROMISE ENAMEL + PROMISE umbrella) | PROMISE ENML / PROMISE | 588 |
| `"MAX"` | === | row("MAX", "MAX", bc) | WS | 597 |
| `"POWERFLEXX"` | === | row("POWERFLEXX", "POWERFLEXX", bc) | WS | 598 |
| `"PROTECT"` | === | row("PROTECT", "PROTECT", bc) | WS | 599 |
| `"PROTECT RAINPROOF"` | === | row("RAINPROOF", "RAINPROOF", bc) | WS | 600 |
| `"HISHEEN"` | === | row("HISHEEN", "HISHEEN", bc) | WS | 601 |
| `"TILE"` | === | row("TILE", "TILE", bc) | WS | 602 |
| `"TEXTURE"` | === | row("TEXTURE", "RUSTIC", …) | WS | 603 |
| `"WS METALLIC"` | === | row("METALLIC", "METALLIC", bc) | WS | 604 |
| `"MAX"` | === | row("MAX", "MAX", bc) | WEATHERCOAT | 609 |
| `"POWERFLEXX"` | === | row("POWERFLEXX", "POWERFLEXX", bc) | WEATHERCOAT | 610 |
| `"PROTECT"` | === | row("PROTECT", "PROTECT DUSTPROOF", bc) | WEATHERCOAT | 611 |
| `"PROTECT RAINPROOF"` | === | row("RAINPROOF", "RAINPROOF", bc) | WEATHERCOAT | 612 |
| `"TEXTURE"` | === | row("TEXTURE", "MATT", …) | WEATHERCOAT | 613 |
| `"WS METALLIC"` | === | row("METALLIC", "METALLIC", bc) | EMULSION | 618 |
| `"VT VELVETINO"` | === | row("VT SPECIALTY", "VELVETINO", …) | TEXTURE | 624 |
| `"PROMISE EXTERIOR"` | === | 2 rows (PROMISE EXTERIOR + PROMISE umbrella) | PROMISE | 630 |
| `"PROMISE INTERIOR"` | === | 2 rows (PROMISE INTERIOR + PROMISE umbrella) | PROMISE | 636 |
| `"PROMISE SHEEN INTERIOR"` | === | 2 rows | PROMISE | 642 |
| `"PROMISE SHEEN EXTERIOR"` | === | 2 rows (re-routed to PROMISE EXTERIOR) | PROMISE | 648 |
| `"PROMISE PRIMER"` | === | 3 rows (PRIMER + PROMISE INTERIOR + PROMISE) | PROMISE | 655 |
| `"PROMISE SHEEN EXTERIOR"` | === | 2 rows | PROMISE SHEEN | 667 |
| `"PROMISE SHEEN INTERIOR"` | === | 2 rows | PROMISE SHEEN | 673 |
| `"PROMISE SMARTCHOICE EXT"` | === | 2 rows | PROMISE SMARTCHOICE | 683 |
| `"PROMISE SMARTCHOICE EXT PRIMER"` | === | 3 rows | PROMISE SMARTCHOICE | 689 |
| `"PROMISE SMARTCHOICE INT"` | === | 2 rows | PROMISE SMARTCHOICE | 696 |
| `"PROMISE SMARTCHOICE INT PRIMER"` | === | 3 rows | PROMISE SMARTCHOICE | 702 |
| `"PROMISE SMARTCHOICE ACRYLIC DISTEMPER"` | === | 3 rows | PROMISE SMARTCHOICE | 709 |
| `"SUPERCOVER"` | === | row("SUPERCOVER", "SUPERCOVER", bc) | SUPERCOVER | 721 |
| `"SUPERCOVER SHEEN"` | === | row("SUPERCOVER", "SUPERCOVER SHEEN", bc) | SUPERCOVER | 722 |
| `"SUPERCOVER ULTRA"` | === | row("SUPERCOVER", "SUPERCOVER ULTRA", bc) | SUPERCOVER | 723 |
| `"SUPERCLEAN"` | === | row("SUPERCLEAN", "SUPERCLEAN", bc) | SUPERCLEAN | 728 |
| `"3IN1"` | === | row("SUPERCLEAN", "SUPERCLEAN 3IN1", bc) | SUPERCLEAN | 729 |
| `"PEARL GLO"` | === | row("VT GLO", "PEARL GLO", bc) | VT | 734 |
| `"PLATINUM GLO"` | === | row("VT GLO", "PLATINUM GLO", bc) | VT | 735 |
| `"DIAMOND GLO"` | === | row("VT GLO", "DIAMOND GLO", bc) | VT | 736 |
| `"ETERNA"` | === | row("VT ETERNA", "ETERNA", bc) | VT | 737 |
| `"ETERNA MATT"` | === | row("VT ETERNA", "ETERNA MATT", bc) | VT | 738 |
| `"ETERNA HI-SHEEN"` | === | row("VT ETERNA", "ETERNA HI-SHEEN", bc) | VT | 739 |
| `"ETERNA BASECOAT"` | === | row("VT ETERNA", "ETERNA BASECOAT", bc) | VT | 740 |
| `"VAF"` | === | row("VT SPECIALTY", "VAF", bc) | VT | 741 |
| `"VT FIN"` | === | row("VT SPECIALTY", "VT FIN", bc) | VT | 742 |
| `"LUXURY FINISHES"` | === | row("VT SPECIALTY", "LUXURY FINISHES", bc) | VT | 743 |
| `"VT METALLICS"` | === | row("VT SPECIALTY", "VT METALLICS", bc) | VT | 744 |
| `"VT CLEAR COAT"` | === | row("VT SPECIALTY", "VT CLEAR COAT", bc) | VT | 745 |
| `"VT MARBLE"` | === | row("VT SPECIALTY", "VT MARBLE", bc) | VT | 746 |
| `"VT VELVETINO"` | === | row("VT SPECIALTY", "VELVETINO", bc) | VT | 747 |
| `"VELVETINO"` | === | row("VT SPECIALTY", "VELVETINO", bc) | VT | 747 |
| `"VT CONCRETE FINISH"` | === | row("VT SPECIALTY", "VT CONCRETE FINISH", bc) | VT | 748 |
| `"VT FINISH"` | === | row("VT SPECIALTY", "VT CONCRETE FINISH", bc) | VT | 748 |
| `"AMBIANCE"` | === | row("VT SPECIALTY", "AMBIANCE", bc) | VT | 750 |
| `"WATERPROOF PUTTY"` | === | row("PUTTY", "WATERPROOF PUTTY", bc) | AQUATECH | 757 |
| `"DUWEL WOOD PRIMER"` | === | row("PRIMER", "WOOD PRIMER", bc) | DUWEL | 766 |
| `"DUWEL FARCO WHITE PRIMER"` | === | row("PRIMER", "WOOD PRIMER", bc) | DUWEL | 766 |
| `"DUWEL RED OXIDE METAL PRIMER"` | === | row("PRIMER", "RED OXIDE METAL PRIMER", bc) | DUWEL | 768 |
| `"DUWEL WB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER WB", bc) | DUWEL | 770 |
| `"ICI DUWEL SB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER SB", bc) | DUWEL | 772 |
| `"IP DUWEL SB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER SB", bc) | DUWEL | 772 |
| `"DUWEL SB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER SB", bc) | DUWEL | 772 |
| `"DUWEL INTERIOR ACRYLIC PRIMER"` | === | row("PRIMER", "INTERIOR ACRYLIC PRIMER", bc) | DUWEL | 774 |
| `"DUWEL ACRYLIC DISTEMPER"` | === | row("DISTEMPER", "ACRYLIC DISTEMPER", …) | DUWEL | 776 |
| `"DUWEL MAGIK"` | === | row("DISTEMPER", "MAGIK", …) | DUWEL | 778 |
| `"DUWEL POLYPUTTY"` | === | row("PUTTY", "POLYPUTTY", …) | DUWEL | 779 |
| `"PROMISE FREEDOM 2IN1"` | === | 3 rows (PRIMER + PROMISE INTERIOR + PROMISE) | PRIMER | 784 |
| `"PROMISE 2IN1"` | === | 3 rows | PRIMER | 791 |
| `"PROMISE PRIMER"` | === | 3 rows | PRIMER | 798 |
| `"ZINC YELLOW METAL PRIMER"` | === | row("PRIMER", "ZINC YELLOW METAL PRIMER", bc) | PRIMER | 805 |
| `"DULUX WB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER WB", bc) | PRIMER | 807 |
| `"SB CEMENT PRIMER"` | === | row("PRIMER", "CEMENT PRIMER SB", bc) | PRIMER | 809 |
| `"EXTERIOR ACRYLIC PRIMER"` | === | row("PRIMER", "EXTERIOR ACRYLIC PRIMER", bc) | PRIMER | 810 |
| `"ALKALI BLOC PRIMER"` | === | row("PRIMER", "ALKALI BLOC PRIMER", bc) | PRIMER | 812 |
| `"ROM"` | === | row("PRIMER", "QUICK DRYING PRIMER", bc) | PRIMER | 813 |
| `"ACRYLIC PUTTY"` | === | row("PUTTY", "ACRYLIC PUTTY", …) | PUTTY | 818 |
| `"GVA"` | === | row("STAINER", "PU STAINER", …) | TINTER | 841 |
| `"ACOTONE"` | === | row("STAINER", "ACOTONE TINTER", …) | TINTER | 845 |
| `"DEALER"` | === | row("STAINER", "MACHINE TINTER", …) | TINTER | 846 |
| `"MACHINE TINTER"` | === | row("STAINER", "MACHINE TINTER", …) | TINTER | 846 |
| `"JSW DEALER"` | === | row("STAINER", "MACHINE TINTER", …) | TINTER | 846 |
| `"COLORANT"` | === | row("STAINER", "HP COLORANT", …) | OTHER | 852 |

### `prod.includes(...)` dispatch

| Literal | Match operator | Routes to | Outer cat | Line |
|---|---|---|---|---|
| `"CONCRETE"` | .includes() | row("VT SPECIALTY", "VT CONCRETE FINISH", bc) | VT | 748 |

### Regex patterns tested against `prod`

| Regex | Tested against | Routes to | Outer cat | Line |
|---|---|---|---|---|
| `/^PU\s+PRIME\b/` | prod | enters PU PRIME sub-dispatch | SADOLIN | 491 |
| `/THINNER/` | prod | row("PU PRIME", "MULTI PURPOSE THINNER", bc) | SADOLIN/PU PRIME | 492 |
| `/SEALER/` | prod | row("PU PRIME", "SEALER", bc) | SADOLIN/PU PRIME | 493 |
| `/MATT/` | prod | row("PU PRIME", "MATT", bc) | SADOLIN/PU PRIME | 494 |
| `/GLOSS/` | prod | row("PU PRIME", "GLOSS", bc) | SADOLIN/PU PRIME | 495 |
| `/\b2K?\s*PU\b/` (positive) | prod | enters 2K PU sub-dispatch | SADOLIN | 508 |
| `/LUXURIO\|\bPU\s+PRIME\b\|1\s*KPU\|1K\s*PU/` (negative guard) | prod | suppresses 2K PU branch | SADOLIN | 508 |
| `/THINNER/` | prod | row("2K PU", "2K PU THINNER", bc) | SADOLIN/2K PU | 510 |
| `/PRIMER\s+SURFACER/` | prod | row("2K PU", "PRIMER SURFACER", bc) | SADOLIN/2K PU | 511 |
| `/SEALER/` | prod | row("2K PU", "SEALER", bc) | SADOLIN/2K PU | 512 |
| `/MATT/` | prod | row("2K PU", "MATT", bc) | SADOLIN/2K PU | 513 |
| `/GLOSS/` | prod | row("2K PU", "GLOSS", bc) | SADOLIN/2K PU | 514 |
| `/INT\s+CLR\s+1\s*K\s*PU\s+GLOSS/` | prod | row("NC", "NC 1KPU GLOSS", bc) | SADOLIN | 519 |
| `/MELAMINE\s+GLOSS/` | prod | row("MELAMINE", "MELAMINE GLOSS", bc) | SADOLIN | 524 |
| `/MELAMINE\s+MATT/` | prod | row("MELAMINE", "MELAMINE MATT", bc) | SADOLIN | 525 |
| `/MELAMINE\s+SEALER/` | prod | row("MELAMINE", "MELAMINE SEALER", bc) | SADOLIN | 526 |
| `/MELAMINE\s+THINNER/` | prod | row("MELAMINE", "MELAMINE THINNER", bc) | SADOLIN | 527 |
| `/^NC(\s+CLEAR)?\s+LACQUER/` | prod | row("NC", "NC LACQUER", bc) | SADOLIN | 533 |
| `/^NC\s+OPAQUE/` | prod | row("NC", "NC OPAQUE", bc) | SADOLIN | 534 |
| `/SYNTHETIC.*VARNISH/` | prod | row("NC", "SYNTHETIC VARNISH", bc) | SADOLIN | 535 |
| `/^[A-Z]{2}[0-9]$/` | prod | row("STAINER", "ACOTONE TINTER", …) | TINTER | 842 |
| `/^[A-Z]{3}$/` | prod | row("STAINER", "MACHINE TINTER", …) | TINTER | 843 |

---

## Deduplicated catalogue of literal strings tested against `mo_sku_lookup.product`

(LEGACY-MAP only — combines SKIPPED_PAIRS, `prod === "..."`, and `prod.includes("...")` literals; deduplicated.)

| Literal | Files | Lines |
|---|---|---|
| `"3IN1"` | taxonomy-mapping.ts | 573, 729 |
| `"5IN1"` | taxonomy-mapping.ts | 142 (data), 164 (test site) |
| `"ACOTONE"` | taxonomy-mapping.ts | 845 |
| `"ACRYLIC PUTTY"` | taxonomy-mapping.ts | 818 |
| `"ALKALI BLOC PRIMER"` | taxonomy-mapping.ts | 575, 812 |
| `"AMBIANCE"` | taxonomy-mapping.ts | 750 |
| `"COLORANT"` | taxonomy-mapping.ts | 852 |
| `"CONCRETE"` (substring via .includes) | taxonomy-mapping.ts | 748 |
| `"DEALER"` | taxonomy-mapping.ts | 846 |
| `"DIAMOND GLO"` | taxonomy-mapping.ts | 736 |
| `"DULUX WB CEMENT PRIMER"` | taxonomy-mapping.ts | 807 |
| `"DUWEL ACRYLIC DISTEMPER"` | taxonomy-mapping.ts | 776 |
| `"DUWEL ENAMEL"` | taxonomy-mapping.ts | 145 (data) |
| `"DUWEL FARCO WHITE PRIMER"` | taxonomy-mapping.ts | 766 |
| `"DUWEL INTERIOR ACRYLIC PRIMER"` | taxonomy-mapping.ts | 774 |
| `"DUWEL MAGIK"` | taxonomy-mapping.ts | 778 |
| `"DUWEL POLYPUTTY"` | taxonomy-mapping.ts | 779 |
| `"DUWEL RED OXIDE METAL PRIMER"` | taxonomy-mapping.ts | 768 |
| `"DUWEL SB CEMENT PRIMER"` | taxonomy-mapping.ts | 772 |
| `"DUWEL WB CEMENT PRIMER"` | taxonomy-mapping.ts | 770 |
| `"DUWEL WOOD PRIMER"` | taxonomy-mapping.ts | 766 |
| `"EPOXY 1K PRIMER"` | taxonomy-mapping.ts | 541 |
| `"EPOXY INSULATOR"` | taxonomy-mapping.ts | 146 (data) |
| `"EPOXY INSULATOR HARDNER"` | taxonomy-mapping.ts | 147 (data) |
| `"ETERNA"` | taxonomy-mapping.ts | 737 |
| `"ETERNA BASECOAT"` | taxonomy-mapping.ts | 740 |
| `"ETERNA HI-SHEEN"` | taxonomy-mapping.ts | 739 |
| `"ETERNA MATT"` | taxonomy-mapping.ts | 738 |
| `"EXTERIOR ACRYLIC PRIMER"` | taxonomy-mapping.ts | 810 |
| `"GLOSS"` | taxonomy-mapping.ts | 567 |
| `"GVA"` | taxonomy-mapping.ts | 841 |
| `"HISHEEN"` | taxonomy-mapping.ts | 601 |
| `"IAE PROJECT"` | taxonomy-mapping.ts | 144 (data) |
| `"ICI DUWEL SB CEMENT PRIMER"` | taxonomy-mapping.ts | 772 |
| `"INTERIOR DISTEMPER"` | taxonomy-mapping.ts | 574 |
| `"IP DUWEL SB CEMENT PRIMER"` | taxonomy-mapping.ts | 772 |
| `"JSW DEALER"` | taxonomy-mapping.ts | 846 |
| `"LUSTRE"` | taxonomy-mapping.ts | 568 |
| `"LUXURIO PU GLOSS"` | taxonomy-mapping.ts | 487 |
| `"LUXURIO PU MATT"` | taxonomy-mapping.ts | 486 |
| `"LUXURIO PU SEALER"` | taxonomy-mapping.ts | 488 |
| `"LUXURY FINISHES"` | taxonomy-mapping.ts | 743 |
| `"MACHINE TINTER"` | taxonomy-mapping.ts | 846 |
| `"MAX"` | taxonomy-mapping.ts | 597, 609 |
| `"MULTI PURPOSE THINNER"` | taxonomy-mapping.ts | 500 |
| `"NC 1KPU GLOSS"` | taxonomy-mapping.ts | 519 |
| `"NC NECOL"` | taxonomy-mapping.ts | 530 |
| `"NC NECOL CLEAR"` | taxonomy-mapping.ts | 531 |
| `"NC NECOL THINNER"` | taxonomy-mapping.ts | 532 |
| `"NC SANDING SEALER"` | taxonomy-mapping.ts | 536 |
| `"NC WOOD THINNER"` | taxonomy-mapping.ts | 537 |
| `"PEARL GLO"` | taxonomy-mapping.ts | 734 |
| `"PLATINUM GLO"` | taxonomy-mapping.ts | 735 |
| `"POWERFLEXX"` | taxonomy-mapping.ts | 598, 610 |
| `"PROMISE 2IN1"` | taxonomy-mapping.ts | 791 |
| `"PROMISE ENML"` | taxonomy-mapping.ts | 588 |
| `"PROMISE EXTERIOR"` | taxonomy-mapping.ts | 630 |
| `"PROMISE FREEDOM 2IN1"` | taxonomy-mapping.ts | 784 |
| `"PROMISE INTERIOR"` | taxonomy-mapping.ts | 636 |
| `"PROMISE PRIMER"` | taxonomy-mapping.ts | 655, 798 |
| `"PROMISE SHEEN EXTERIOR"` | taxonomy-mapping.ts | 648, 667 |
| `"PROMISE SHEEN INTERIOR"` | taxonomy-mapping.ts | 642, 673 |
| `"PROMISE SMARTCHOICE ACRYLIC DISTEMPER"` | taxonomy-mapping.ts | 709 |
| `"PROMISE SMARTCHOICE EXT"` | taxonomy-mapping.ts | 683 |
| `"PROMISE SMARTCHOICE EXT PRIMER"` | taxonomy-mapping.ts | 689 |
| `"PROMISE SMARTCHOICE INT"` | taxonomy-mapping.ts | 696 |
| `"PROMISE SMARTCHOICE INT PRIMER"` | taxonomy-mapping.ts | 702 |
| `"PROTECT"` | taxonomy-mapping.ts | 599, 611 |
| `"PROTECT RAINPROOF"` | taxonomy-mapping.ts | 600, 612 |
| `"PU ENAMEL"` | taxonomy-mapping.ts | 556, 571 |
| `"ROM"` | taxonomy-mapping.ts | 813 |
| `"SATIN STAY BRIGHT"` | taxonomy-mapping.ts | 560, 569 |
| `"SB CEMENT PRIMER"` | taxonomy-mapping.ts | 809 |
| `"SILK FINISH"` | taxonomy-mapping.ts | 143 (data) |
| `"SMOOTHOVER"` | taxonomy-mapping.ts | 576 |
| `"SUPER SATIN"` | taxonomy-mapping.ts | 559, 570 |
| `"SUPERCLEAN"` | taxonomy-mapping.ts | 572, 728 |
| `"SUPERCOVER"` | taxonomy-mapping.ts | 580, 721 |
| `"SUPERCOVER SHEEN"` | taxonomy-mapping.ts | 722 |
| `"SUPERCOVER ULTRA"` | taxonomy-mapping.ts | 723 |
| `"TEXTURE"` | taxonomy-mapping.ts | 603, 613 |
| `"TILE"` | taxonomy-mapping.ts | 602 |
| `"VAF"` | taxonomy-mapping.ts | 741 |
| `"VELVETINO"` | taxonomy-mapping.ts | 747 |
| `"VT CLEAR COAT"` | taxonomy-mapping.ts | 745 |
| `"VT CONCRETE FINISH"` | taxonomy-mapping.ts | 748 |
| `"VT FIN"` | taxonomy-mapping.ts | 742 |
| `"VT FINISH"` | taxonomy-mapping.ts | 748 |
| `"VT MARBLE"` | taxonomy-mapping.ts | 746 |
| `"VT METALLICS"` | taxonomy-mapping.ts | 744 |
| `"VT VELVETINO"` | taxonomy-mapping.ts | 624, 747 |
| `"WATERPROOF PUTTY"` | taxonomy-mapping.ts | 757 |
| `"WOOD FILLER"` | taxonomy-mapping.ts | 545 |
| `"WOOD STAIN"` | taxonomy-mapping.ts | 544 |
| `"WOOD STAINER"` | taxonomy-mapping.ts | 544 |
| `"WS ELASTOMERIC"` | taxonomy-mapping.ts | 151 (data) |
| `"WS FLASH"` | taxonomy-mapping.ts | 152 (data) |
| `"WS METALLIC"` | taxonomy-mapping.ts | 604, 618 |
| `"WS PRIMA E900"` | taxonomy-mapping.ts | 153 (data) |
| `"WS PROJECT"` | taxonomy-mapping.ts | 154 (data) |
| `"WS TR E2000"` | taxonomy-mapping.ts | 155 (data) |
| `"WS ULTRACLEAN"` | taxonomy-mapping.ts | 156 (data) |
| `"ZINC YELLOW METAL PRIMER"` | taxonomy-mapping.ts | 805 |

Distinct literal count: **99**.

Plus 22 distinct regex patterns (full list in Step 6 regex table above).

---

## Findings against non-SKU `.product` fields (for completeness, NOT in scope for Stage B)

- **`mo_product_keywords.product`** (`pk.product`) — 1 hit
  - `lib/mail-orders/enrich.ts:360` — `pk.product !== prodName` (variable comparison, no string literal)

- **Derived from `mo_product_keywords.product` via `ProductMatch.product` / `ScoredCandidate.product`** — 2 hits
  - `lib/mail-orders/enrich.ts:751` — `second.product === top.product` (variable comparison)
  - `lib/mail-orders/enrich.ts:772` — `prodMatches.find(pm => pm.product === top.product)` (variable comparison, in `.find()`)

- **`EnrichResult.productName`** — 0 hits in scope (used in composite-key construction in Pass 3, not in string-content matching)

- **`mo_order_form_index.subProduct`** — 0 string-content matches found in `lib/`/`app/` against `.subProduct` literal strings. The field appears in composite keys (Pass 3) and in projection mapping but no `.includes`/`.startsWith`/`=== "literal"` patterns.

- **`mo_order_lines.productName` (PARSER)** — 0 string-content matches found.

No string literals found in tests against any non-SKU `.product` field — those tests are all variable-to-variable comparisons.

---

## End of Pass 4
