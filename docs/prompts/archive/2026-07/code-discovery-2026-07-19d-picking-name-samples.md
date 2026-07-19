# Discovery 2026-07-19d — Picking friendly-name SAMPLES (reference sheet)

**Session type:** sample generation, read-only. No code, no schema, no DB writes.
**Source:** `sku_master_v2` only — `category` / `product` / `baseColour`. **No join to any menu table.**
**Scope:** `WHERE isActive = true` → **1,718 rows** of 1,743 total (25 retired TOOLS `645xxxx` rows excluded).
**Deliverable:** this file. Smart Flow reads the samples and decides if the naming reads well BEFORE any code is written.

---

## Display-name rule applied

| Treatment | Rule |
|---|---|
| **prefix** (normal paint) | `{shortFamily} {product} {base}` |
| **stainer** | `{product} {base}` — no family prefix, **colour/base always kept** |
| **product** (TOOLS) | `{product}` — `baseColour` is `''`, contributes nothing |

**De-dup guard** — the prefix is skipped when the product already carries it. Fires when *any* of:
1. normalised `product` **starts with** the normalised short code (`VT DIAMOND GLO` vs `VT`), or
2. the short code appears as a **whole token** in `product` (`5IN1 GLOSS` vs `Gloss`), or
3. normalised `product` **contains** the normalised family (`FLOOR PLUS` vs `FLOOR PLUS`).

The SAP material code never appears in a display name.

---

## ⚠️ Casing — the headline finding, needs your decision

The brief specified `smartTitleCase()` (`lib/mail-orders/utils.ts:599-612`). Applied literally, **it damages paint names**, because its `KEEP_UPPER` set is built for *customer* names — `{CO, LLP, PVT, LTD, II, III, IV, HW, H/W, JSW, SAP, OBD, IGT, UPC}` — and knows no paint codes:

| Raw | smartTitleCase ❌ | emailCase ✅ |
|---|---|---|
| `WS POWERFLEXX 90 BASE` | **Ws** Powerflexx 90 Base | **WS** Powerflexx 90 Base |
| `VT PEARL GLO 94 BASE` | **Vt** Pearl Glo 94 Base | **VT** Pearl Glo 94 Base |
| `PU ENAMEL BLACK` | **Pu** Enamel Black | **PU** Enamel Black |
| `1K PU GLOSS Clear` | Sadolin **1k Pu** Gloss Clear | Sadolin **1K PU** Gloss Clear |
| `GVA BLUE` | **Gva** Blue | **GVA** Blue |
| `MACHINE TINTER GRN` | Machine Tinter **Grn** | Machine Tinter **GRN** |
| `5IN1 GLOSS BLACK` | **5in1** Gloss Black | **5IN1** Gloss Black |
| `GLOSS DA GREY` | Gloss **Da** Grey | Gloss **DA** Grey |
| `TEXTURE 2MM 94 BASE` | Texture **2mm** 94 Base | Texture **2MM** 94 Base |

**`emailCase()` (`lib/place-order/email.ts:102-115`) is the helper actually built for this job** — the /po email builder solves this exact problem. Its rules: token has a digit → UPPER; ≤2 letters → UPPER; in `KEEP_CAPS_3` (`GVA FBC IBC WBC FFR GRN LFY MAG OXR TBL YOX NCR VAF WRP`) → UPPER; else title-case. It is already the single name source for all three order surfaces (PLACE_ORDER §11).

**Recommendation: use `emailCase()`, not `smartTitleCase()`.** Both columns are shown in every table below so you can compare. `emailCase` gets **1 wrong** in the whole catalog (`HI-SHEEN` → `HI-Sheen`, because `HI` is ≤2 letters); `smartTitleCase` mis-cases roughly a third of the families.

---

## TASK 1 — Column reality check

Five verbatim rows, `isActive = true`, `ORDER BY id ASC LIMIT 5`:

| category | product | baseColour | packCode | unit |
|---|---|---|---|---|
| `SADOLIN` | `EPOXY INSULATOR` | `""` | `1` | `L` |
| `SADOLIN` | `EPOXY INSULATOR` | `""` | `4` | `L` |
| `SADOLIN` | `EPOXY INSULATOR HARDENER` | `""` | `500` | `ML` |
| `GLOSS` | `GLOSS` | `DA GREY` | `10` | `L` |
| `TOOLS` | `SIGNATURE BRUSH DOUBLE 3` | `""` | `12` | `PC` |

**Confirmed:**
- `category` **does** hold the family — `SADOLIN`, `GLOSS`, `TOOLS` are the same 26 tokens the /po speed dial uses. It is a plain TEXT family label, not a product-type.
- `product` **is** the SAP-clean name and matches `mo_order_form_index_v2.product` conventions.
- `baseColour` is `''` (**empty string, never NULL**) where there is no base — matches the TOOLS convention in PLACE_ORDER §14. Zero NULLs across all 1,718 active rows.

**Casing is NOT uniform** — this matters for any rule that string-matches:
- **Mostly ALL-CAPS**: `WS PROTECT DUSTPROOF`, `90 BASE`, `BRILLIANT WHITE`.
- **Mixed-case pockets exist in `baseColour` only**: SADOLIN uses `90 Base`, `Int Clear`, `Clear`, `Teak`; PROMISE uses `2in1 Primer`, `Ext Primer`, `Acrylic Distemper`; PRIMER has `White` (mixed) alongside `PINK` (caps) and `""`.
- `product` is ALL-CAPS everywhere — no exceptions found.

⇒ **Any comparison must be case-normalised.** Do not assume caps.

---

## TASK 2 — Family list + proposed short codes

26 distinct `category` values, active rows only. Blank short code = deliberately left for Smart Flow.

| family | rows | products | proposed short | treatment | justification (from the data) |
|---|---|---|---|---|---|
| `WS` | 243 | 6 | `WS` | prefix | all 6 products start `WS …` → de-dup always fires; prefix is a no-op but keeps the rule uniform |
| `PROMISE` | 222 | 6 | `Promise` | prefix | all 6 products start `PROMISE …` → de-dup fires |
| `GLOSS` | 218 | 3 | `Gloss` | prefix | `GLOSS`, `5IN1 GLOSS`, `M900 GLOSS` — all carry the token → de-dup fires |
| `SADOLIN` | 157 | 33 | `Sadolin` | prefix | **no product contains "Sadolin"** → prefix genuinely applies on all 33; brand is otherwise invisible |
| `VELVET TOUCH` | 140 | 6 | `VT` | prefix | all products start `VT …` → de-dup fires (the brief's own example) |
| `SUPERCLEAN` | 112 | 2 | `SuperClean` | prefix | products `SUPERCLEAN`, `SUPERCLEAN 3IN1` → de-dup fires |
| `SUPERCOVER` | 91 | 2 | `SuperCover` | prefix | products `SUPERCOVER`, `SUPERCOVER SHEEN` → de-dup fires |
| `SATIN` | 71 | 2 | `Satin` | prefix | `SUPER SATIN`, `SATIN STAY BRIGHT` both carry the token → de-dup fires |
| `STAINER` | 68 | 5 | — | **stainer** | products are `ACOTONE / GVA / HP COLORANT / MACHINE TINTER / UNIVERSAL STAINER`; **43 distinct bases, every one a colour or tint code** (`YELLOW OXIDE`, `FAST RED`, `YOX`, `FFR`, `BU1`, `XY1`). The base IS the identity — a stainer without its colour is unpickable. Only 1 of 5 products even contains "STAINER", so a prefix would read `Stainer Machine Tinter YOX`. |
| `AQUATECH` | 63 | 20 | `Aquatech` | prefix | **all 63 rows have `baseColour = ''`** → name is family + product only; products (`WRP`, `LW PLUS`, `FBC NEO`) are meaningless without the brand |
| `PRIMER` | 52 | 10 | `Primer` | prefix | all 10 products end in `PRIMER` → de-dup fires; 44 of 52 rows have empty base |
| `PROMISE ENAMEL` | 45 | 1 | `Promise` | prefix | single product `PROMISE ENAMEL` → de-dup fires |
| `FLOOR PLUS` | 43 | 1 | `Floor Plus` | prefix | single product = the family → de-dup fires; 12 colour bases |
| `VT SPECIALTY` | 33 | 9 | `VT` | prefix | **mixed** — `VT CLEAR COAT`/`VT FIN`/`VT MARBLE` de-dup, but `AMBIANCE`/`VELVETINO`/`VAF`/`LUXURY FINISHES` do get the `VT` prefix. Confirm you want `VT Ambiance`. |
| `TOOLS` | 31 | 31 | — | **product** | 31 rows / 31 products, **every `baseColour = ''`**, `unit = PC`. Products are self-describing (`SIGNATURE BRUSH DOUBLE 3`). Nothing to prefix, no base to keep. |
| `PU ENAMEL` | 30 | 1 | `PU` | prefix | single product `PU ENAMEL` → de-dup fires |
| `LUSTRE` | 22 | 1 | `Lustre` | prefix | single product = family → de-dup fires |
| `PROMISE INTERIOR` | 20 | 4 | `Promise` | prefix | all 4 start `PROMISE …` → de-dup fires. **Near-duplicate of the `PROMISE` family — see messy names.** |
| `DISTEMPER` | 13 | 2 | `Distemper` | prefix | `ACRYLIC DISTEMPER` de-dups; **`MAGIK` does not** → `Distemper Magik 90 Base`. Confirm. |
| `SPRAY PAINT` | 11 | 1 | `Spray` | prefix | single product `SPRAY PAINT` → de-dup fires (contains family) |
| `TILE` | 8 | 1 | `WS` | prefix | single product `WS TILE` → de-dup fires. **`category` is `TILE` but the product is a WS line** — the family token here is not the brand. |
| `TEXTURE` | 8 | 4 | `Texture` | prefix | `TEXTURE`/`2MM`/`3MM` de-dup; **`MATT` does not** → `Texture Matt Black`. Confirm. |
| `METALLIC` | 6 | 1 | `WS` | prefix | single product `WS METALLIC` → de-dup fires. Same brand/category mismatch as `TILE`. |
| `PUTTY` | 6 | 2 | `Putty` | prefix | `ACRYLIC PUTTY` + `POLYPUTTY` both contain "PUTTY" → de-dup fires; all bases empty |
| `PROMISE EXTERIOR` | 4 | 1 | `Promise` | prefix | de-dup fires; all 4 bases empty |
| `SMOOTHOVER` | 1 | 1 | `Smoothover` | prefix | single row, de-dup fires |

**STAINER-type identified: `STAINER` only.** Justification is above and is data-driven, not assumed — it is the one family whose base column is a 43-value colour vocabulary rather than a tint-base ladder.

**TOOLS-type identified: `TOOLS` only.** `AQUATECH`, `PUTTY`, `PROMISE EXTERIOR`, `SMOOTHOVER` also have 100% empty bases, but their products are *not* self-describing (`WRP`, `FBC NEO`), so they keep the family prefix rather than becoming product-only.

---

## TASK 3 — Sample display names, every family

Format: `raw product | raw base | => smartTitleCase | => emailCase`.
The **emailCase column is the recommended output**.

### Normal paint — prefix genuinely applied (de-dup does NOT fire)

**SADOLIN** — `short="Sadolin"` · 157 rows · 33 products

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `EPOXY INSULATOR` | `""` | Sadolin Epoxy Insulator | **Sadolin Epoxy Insulator** |
| `EPOXY INSULATOR HARDENER` | `""` | Sadolin Epoxy Insulator Hardener | **Sadolin Epoxy Insulator Hardener** |
| `WOOD FILLER` | `White` | Sadolin Wood Filler White | **Sadolin Wood Filler White** |
| `1K PU GLOSS` | `Clear` | Sadolin 1k Pu Gloss Clear ❌ | **Sadolin 1K PU Gloss Clear** |

**AQUATECH** — `short="Aquatech"` · 63 rows · 20 products · all bases empty

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `RP LATEX` | `""` | Aquatech Rp Latex ❌ | **Aquatech RP Latex** |
| `CRACKFILLER 5MM` | `""` | Aquatech Crackfiller 5mm ❌ | **Aquatech Crackfiller 5MM** |
| `FBC ADVANCE` | `""` | Aquatech Fbc Advance ❌ | **Aquatech FBC Advance** |
| `FBC NEO` | `""` | Aquatech Fbc Neo ❌ | **Aquatech FBC Neo** |

**DISTEMPER** — `short="Distemper"` · prefix fires on `MAGIK` only

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `MAGIK` | `90 BASE` | Distemper Magik 90 Base | **Distemper Magik 90 Base** |
| `MAGIK` | `BRILLIANT WHITE` | Distemper Magik Brilliant White | **Distemper Magik Brilliant White** |
| `ACRYLIC DISTEMPER` | `DUWEL ACRYLIC DISTEMPER` | Acrylic Distemper Duwel Acrylic Distemper ⚠ | **Acrylic Distemper Duwel Acrylic Distemper** ⚠ |

**TEXTURE** — `short="Texture"` · prefix fires on `MATT` only

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `TEXTURE` | `90 BASE` | Texture 90 Base | **Texture 90 Base** |
| `MATT` | `BLACK` | Texture Matt Black | **Texture Matt Black** |
| `TEXTURE 2MM` | `94 BASE` | Texture 2mm 94 Base ❌ | **Texture 2MM 94 Base** |
| `TEXTURE 3MM` | `92 BASE` | Texture 3mm 92 Base ❌ | **Texture 3MM 92 Base** |

**VT SPECIALTY** — `short="VT"` · mixed de-dup

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `VT FIN` | `""` | Vt Fin ❌ | **VT Fin** *(de-dup fired)* |
| `AMBIANCE` | `94 BASE` | Vt Ambiance 94 Base ❌ | **VT Ambiance 94 Base** *(prefixed)* |
| `VAF` | `MARBLE` | Vt Vaf Marble ❌ | **VT VAF Marble** *(prefixed)* |
| `LUXURY FINISHES` | `MARMORINO` | Vt Luxury Finishes Marmorino ❌ | **VT Luxury Finishes Marmorino** *(prefixed)* |

### De-dup guard working (product already contains the family / short code)

**VELVET TOUCH** — `short="VT"`, every product starts `VT` → **no "VT VT Diamond Glo"**

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `VT PEARL GLO` | `94 BASE` | Vt Pearl Glo 94 Base ❌ | **VT Pearl Glo 94 Base** |
| `VT PLATINUM GLO` | `92 BASE` | Vt Platinum Glo 92 Base ❌ | **VT Platinum Glo 92 Base** |
| `VT DIAMOND GLO` | `BRILLIANT WHITE` | Vt Diamond Glo Brilliant White ❌ | **VT Diamond Glo Brilliant White** |
| `VT ETERNA` | `BASECOAT` | Vt Eterna Basecoat ❌ | **VT Eterna Basecoat** ⚠ |

**WS** — `short="WS"`, every product starts `WS`

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `WS POWERFLEXX` | `90 BASE` | Ws Powerflexx 90 Base ❌ | **WS Powerflexx 90 Base** |
| `WS PROTECT DUSTPROOF` | `ELECTRIC BLUE PLUS` | Ws Protect Dustproof Electric Blue Plus ❌ | **WS Protect Dustproof Electric Blue Plus** |
| `WS PROTECT RAINPROOF` | `94 BASE` | Ws Protect Rainproof 94 Base ❌ | **WS Protect Rainproof 94 Base** |
| `WS PROTECT HI-SHEEN` | `BRILLIANT WHITE` | Ws Protect Hi-sheen Brilliant White ❌ | **WS Protect HI-Sheen Brilliant White** ⚠ |

**GLOSS** — `short="Gloss"`, token match

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `GLOSS` | `DA GREY` | Gloss Da Grey ❌ | **Gloss DA Grey** |
| `5IN1 GLOSS` | `BLACK` | 5in1 Gloss Black ❌ | **5IN1 Gloss Black** |
| `M900 GLOSS` | `BRILLIANT WHITE` | M900 Gloss Brilliant White | **M900 Gloss Brilliant White** |
| `GLOSS` | `BRILLIANT WHITE` | Gloss Brilliant White | **Gloss Brilliant White** |

**PROMISE** — `short="Promise"`

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `PROMISE EXTERIOR` | `90 BASE` | Promise Exterior 90 Base | **Promise Exterior 90 Base** |
| `PROMISE SHEEN EXTERIOR` | `94 BASE` | Promise Sheen Exterior 94 Base | **Promise Sheen Exterior 94 Base** |
| `PROMISE SHEEN INTERIOR` | `BRILLIANT WHITE` | Promise Sheen Interior Brilliant White | **Promise Sheen Interior Brilliant White** |
| `PROMISE SMARTCHOICE` | `Ext Primer` | Promise Smartchoice Ext Primer | **Promise Smartchoice Ext Primer** |

**SUPERCLEAN / SUPERCOVER / SATIN / LUSTRE**

| family | raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|---|
| SUPERCLEAN | `SUPERCLEAN 3IN1` | `BRILLIANT WHITE` | Superclean 3in1 Brilliant White ❌ | **Superclean 3IN1 Brilliant White** |
| SUPERCLEAN | `SUPERCLEAN` | `97 BASE` | Superclean 97 Base | **Superclean 97 Base** |
| SUPERCOVER | `SUPERCOVER SHEEN` | `92 BASE` | Supercover Sheen 92 Base | **Supercover Sheen 92 Base** |
| SUPERCOVER | `SUPERCOVER` | `BRILLIANT WHITE` | Supercover Brilliant White | **Supercover Brilliant White** |
| SATIN | `SUPER SATIN` | `BLACK` | Super Satin Black | **Super Satin Black** |
| SATIN | `SATIN STAY BRIGHT` | `WALNUT` | Satin Stay Bright Walnut | **Satin Stay Bright Walnut** |
| LUSTRE | `LUSTRE` | `96 BASE` | Lustre 96 Base | **Lustre 96 Base** |

**PU ENAMEL / PROMISE ENAMEL / FLOOR PLUS / SPRAY PAINT / TILE / METALLIC / PRIMER / PUTTY / SMOOTHOVER**

| family | raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|---|
| PU ENAMEL | `PU ENAMEL` | `BRILLIANT WHITE` | Pu Enamel Brilliant White ❌ | **PU Enamel Brilliant White** |
| PU ENAMEL | `PU ENAMEL` | `SMOKE GREY` | Pu Enamel Smoke Grey ❌ | **PU Enamel Smoke Grey** |
| PROMISE ENAMEL | `PROMISE ENAMEL` | `CLASSIC WHITE` | Promise Enamel Classic White | **Promise Enamel Classic White** |
| PROMISE ENAMEL | `PROMISE ENAMEL` | `BUS GREEN` | Promise Enamel Bus Green | **Promise Enamel Bus Green** |
| FLOOR PLUS | `FLOOR PLUS` | `FOREST GREEN` | Floor Plus Forest Green | **Floor Plus Forest Green** |
| FLOOR PLUS | `FLOOR PLUS` | `GOLDEN YELLOW` | Floor Plus Golden Yellow | **Floor Plus Golden Yellow** |
| SPRAY PAINT | `SPRAY PAINT` | `PHIROZA` | Spray Paint Phiroza | **Spray Paint Phiroza** |
| TILE | `WS TILE` | `WHITE BASE` | Ws Tile White Base ❌ | **WS Tile White Base** |
| TILE | `WS TILE` | `YELLOW BASE` | Ws Tile Yellow Base ❌ | **WS Tile Yellow Base** |
| METALLIC | `WS METALLIC` | `GOLD` | Ws Metallic Gold ❌ | **WS Metallic Gold** |
| PRIMER | `RED OXIDE METAL PRIMER` | `""` | Red Oxide Metal Primer | **Red Oxide Metal Primer** |
| PRIMER | `WOOD PRIMER` | `White` | Wood Primer White | **Wood Primer White** |
| PUTTY | `POLYPUTTY` | `""` | Polyputty | **Polyputty** |
| PUTTY | `ACRYLIC PUTTY` | `""` | Acrylic Putty | **Acrylic Putty** |
| SMOOTHOVER | `SMOOTHOVER` | `""` | Smoothover | **Smoothover** |

**PROMISE INTERIOR / PROMISE EXTERIOR**

| family | raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|---|
| PROMISE INTERIOR | `PROMISE SMARTCHOICE INT PRIMER` | `""` | Promise Smartchoice Int Primer | **Promise Smartchoice Int Primer** |
| PROMISE INTERIOR | `PROMISE FREEDOM 2IN1 PRIMER` | `""` | Promise Freedom 2in1 Primer ❌ | **Promise Freedom 2IN1 Primer** |
| PROMISE INTERIOR | `PROMISE` | `PROMISE` | Promise Promise ⚠ | **Promise Promise** ⚠ |
| PROMISE EXTERIOR | `PROMISE SMARTCHOICE EXT PRIMER` | `""` | Promise Smartchoice Ext Primer | **Promise Smartchoice Ext Primer** |

### ★ STAINER — colour retained, no family prefix

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `MACHINE TINTER` | `GRN` | Machine Tinter Grn ❌ | **Machine Tinter GRN** |
| `GVA` | `BLUE` | Gva Blue ❌ | **GVA Blue** |
| `ACOTONE` | `WH1` | Acotone Wh1 ❌ | **Acotone WH1** |
| `HP COLORANT` | `YELLOW` | Hp Colorant Yellow ❌ | **HP Colorant Yellow** |

Further real bases in this family, to show the colour is never dropped: `MACHINE TINTER YOX`, `MACHINE TINTER FFR`, `UNIVERSAL STAINER YELLOW OXIDE`, `UNIVERSAL STAINER BURNT SIENNA`, `GVA ORGANIC LEMON YELLOW`, `ACOTONE XY1`.

**Open question:** the 3-letter codes (`YOX`, `FFR`, `GRN`, `TBL`) are opaque to a picker. `base-aliases.ts:254-264` already holds the full colour names for exactly these 9 MACHINE TINTER bases (`YOX → Yellow Oxide`). Expanding them here would need that map — a code dependency, not a pure `sku_master_v2` read. **Flagged, not decided.**

### ★ TOOLS — product only

| raw product | raw base | smartTitleCase | **emailCase** |
|---|---|---|---|
| `SIGNATURE BRUSH DOUBLE 3` | `""` | Signature Brush Double 3 | **Signature Brush Double 3** |
| `SIGNATURE BRUSH DOUBLE 5` | `""` | Signature Brush Double 5 | **Signature Brush Double 5** |
| `SIGNATURE FOAM INT ROLLER 6` | `""` | Signature Foam Int Roller 6 | **Signature Foam Int Roller 6** |
| `SIGNATURE ACRYLIC INT ROLLER 9` | `""` | Signature Acrylic Int Roller 9 | **Signature Acrylic Int Roller 9** |

Both casers agree on all 31 TOOLS rows. Note the trailing number is the **inch size** with the `″` stripped in `sku_master_v2` — `/po` renders `3″` from the menu table's `displayName`, which we are not reading. Picking would show a bare `3`. **Flagged — cosmetic, your call.**

---

## Messy names — full sweep of all 1,718 active rows

Only **5 distinct problems** exist across the entire catalog. Every other row produces a clean name.

| family | product | base | resulting name | problem |
|---|---|---|---|---|
| `DISTEMPER` | `ACRYLIC DISTEMPER` | `DUWEL ACRYLIC DISTEMPER` | `Acrylic Distemper Duwel Acrylic Distemper` | **base repeats the product verbatim.** Same doubling PLACE_ORDER §11 rule 2 fixes for email. |
| `PROMISE INTERIOR` | `PROMISE` | `PROMISE` | `Promise Promise` | product == base == family. Reads as a stutter. |
| `PROMISE` | `PROMISE PRIMER` | `Promise Primer` | `Promise Primer Promise Primer` | base repeats product (differs only in case). |
| `SADOLIN` | `NC NECOL CLEAR` | `Clear` | `Sadolin NC Necol Clear Clear` | **doubled trailing word** — base duplicates the product's last token. |
| `VELVET TOUCH` | `VT ETERNA` | `BASECOAT` | `VT Eterna Basecoat` | base is a *finish/layer* word, not a colour. Reads fine, but it is not a base — flagging so you know the base column is not colour-pure. |

**A general de-double rule would fix 4 of the 5** — the same shape as `emailLineLabel` rule 2 (PLACE_ORDER §11): *if the normalised base contains the normalised product (or the product's last token), drop the duplicated part.* That would give `Acrylic Distemper Duwel`, `Promise`, `Promise Primer`, `Sadolin NC Necol Clear`. Recommended, but it is a rule change beyond the brief — **your call.**

### Other data notes (not name defects)

- **`PROMISE INTERIOR` / `PROMISE EXTERIOR` overlap `PROMISE`.** `PROMISE SMARTCHOICE EXT PRIMER` (family `PROMISE EXTERIOR`) and `PROMISE SMARTCHOICE` + base `Ext Primer` (family `PROMISE`) both render **`Promise Smartchoice Ext Primer`** — two SAP codes, one display name. Not fixable in the naming rule; it is a catalog-shape overlap.
- **No missing products.** Zero rows have a null/empty `product`.
- **No over-long names.** Longest is 40 chars (`WS Protect Dustproof Electric Blue Plus`), under the 42-char flag threshold. Nothing needs truncation on a phone-width muted line.
- **Empty-base families** (base contributes nothing): `AQUATECH` 63/63, `TOOLS` 31/31, `PUTTY` 6/6, `PROMISE EXTERIOR` 4/4, `SMOOTHOVER` 1/1, `PRIMER` 44/52, `SADOLIN` 21/157, `PROMISE INTERIOR` 11/20, `VT SPECIALTY` 7/33, `VELVET TOUCH` 2/140, `WS` 1/243.

---

## What Smart Flow needs to decide

1. **Caser: `emailCase()` (recommended) or `smartTitleCase()` as briefed?** This is the single biggest quality lever.
2. **Short codes** — confirm or overwrite the proposed column in Task 2. The ones that actually change output are `Sadolin`, `Aquatech`, `Distemper` (→`Magik`), `Texture` (→`Matt`), `VT` (→ VT Specialty's 4 non-VT products).
3. **De-double rule** — add it (fixes 4 messy names) or ship without.
4. **STAINER 3-letter codes** — leave as `Machine Tinter GRN`, or expand via `base-aliases.ts` to `Machine Tinter Green`?
5. **TOOLS inch mark** — leave `Signature Brush Double 3`, or re-append `″`?

---

## Provenance

- Every figure and every raw string above came from live `SELECT`s against `sku_master_v2` (`isActive = true`). No writes, no schema touch, no code changed.
- Sample generation ran from a throwaway script in the session scratchpad (not the repo), using **byte-copies** of the two real helpers — `smartTitleCase` (`lib/mail-orders/utils.ts:599-612`) and `emailCase` (`lib/place-order/email.ts:102-115`). The eventual build must **import** them, not re-copy.
- `sku_master_v2` is schema **v27.11** (`prisma/schema.prisma:1504`), one version ahead of `CLAUDE_CORE.md`'s v27.10 header.

*Discovery 2026-07-19d · read-only · OrbitOMS*
