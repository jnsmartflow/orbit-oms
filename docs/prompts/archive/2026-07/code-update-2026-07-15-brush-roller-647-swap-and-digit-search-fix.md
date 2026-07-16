# code-update-2026-07-15 — Brush/Roller 645→647 series swap + bare-digit search fix

**Session date:** 2026-07-15
**Modules touched:** Place Order (`/place-order`, `/po`, `/order`)
**Consolidates into:** `CLAUDE_PLACE_ORDER.md` (§2, §13, §16, §22), `CLAUDE_CORE.md` (§7.7, §13)
**Status:** Shipped + verified live. Two follow-ups open (see §7).

---

## 1. What happened

SAP re-coded the entire brush/roller (TOOLS) range: old `645xxxx` → new `647xxxx`.
The new series is now the only thing visible on all three order surfaces; the old
series is switched OFF, not deleted.

Separately, a search bug surfaced during smoke-testing and was fixed in the same
session: typing `brush 3` returned the 2" brush.

**Commits (both on main):**

| Hash | What |
|---|---|
| `46b500fb` | `place-order: filter mo_sku_lookup_v2 to isPrimary rows (mirror /api/order/data)` |
| `70b90bd6` | `search: bare 1-2 digit query tokens must match at a word start (kills SAP-code digit collisions)` |

---

## 2. DOC CORRECTIONS — read this first

Three things the canonical files currently state incorrectly. **Fix on next consolidation.**

### 2.1 `mo_order_form_index_v2` unique key is `(family, subProduct, baseColour)`

`CLAUDE_CORE.md §7.7` and `CLAUDE_PLACE_ORDER.md §2` both say
`UNIQUE (family, product, baseColour)`. **Wrong.** `prisma/schema.prisma` has:

```prisma
@@unique([family, subProduct, baseColour])
```

This matters: `product` is **nullable**, `subProduct` is **NOT NULL**. Any
menu-row guard (`WHERE NOT EXISTS`, `ON CONFLICT`) must key on `subProduct`.
Guarding on `product` would silently fail to prevent duplicates on null-product rows.

### 2.2 `/api/place-order/data` now filters `isPrimary`

`CLAUDE_CORE.md §7.7`, `CLAUDE_PLACE_ORDER.md §2`, `§16` and `§22` all say the
desktop route is "currently unfiltered on isPrimary (out of scope for this cut)".
**Stale as of `46b500fb`.** Both routes now filter identically. The §22 landmine
bullet ("Desktop will show duplicate twins until the filter is added there too")
should be **deleted**.

Adding the filter also killed a latent bug: the desktop route's first-wins dedupe
(keyed `product|packsize`, no `orderBy`) could let a stale duplicate win. Now it
dedupes from an isPrimary-only pool. **Residual risk, unfixed:** if two
`isPrimary=true` rows ever collide on the same rendered pack, which wins is still
arbitrary (Prisma row order is unspecified without `orderBy`).

### 2.3 `mo_sku_lookup_v2.description` is NOT NULL

Not listed in the column docs. Every insert must supply it.

### 2.4 `/po` fetches `/api/order/data`

Grepped and confirmed (`app/po/po-page.tsx:752`). `/po` shares **both** the data
route **and** the search implementation (`rankProductsForQuery`) with `/order`.
`/place-order` is the only surface with its own route AND its own matcher.
Worth adding to §16 — the docs never stated which route `/po` used.

---

## 3. TOOLS conventions (banked — reuse for any future TOOLS row)

Read live off the table this session. Both v2 tables agree:

**`mo_order_form_index_v2`:**

| Column | TOOLS value |
|---|---|
| `family` | `TOOLS` |
| `subProduct` | UPPERCASE, no inch mark — `SIGNATURE BRUSH DOUBLE 3` |
| `product` | identical to `subProduct` |
| `uiGroup` | `Rollers` \| `Brushes` \| `Stickers` |
| `baseColour` | `''` (empty string, **not** NULL) |
| `displayName` | Title case + `″` (U+2033 double prime) — `Signature Brush Double 3″` |
| `searchTokens` | comma-space list, ends with SAP code(s) |
| `tinterType` | NULL |
| `productType` | `PLAIN` |
| `section` | `UTILITY` |
| `subgroup` | `Tools & accessories` |
| `mobileFamily` | `TOOLS` |
| `region` | NULL, or `Delhi NCR` / `UP Punjab` / `South` / `All India` |
| `sortOrder` | 6001+ (rollers first, then brushes, stickers last) |

**`mo_sku_lookup_v2`:**

| Column | TOOLS value |
|---|---|
| `description` | Title case + `"` (plain ASCII quote) — `Signature Brush Double 3"` — SAP prefix (`Dulux`/`DN`) and suffix (`New`/`N`) stripped |
| `category` | `TOOLS` |
| `product` | UPPERCASE, matches the menu row's `product` exactly |
| `baseColour` | `''` |
| `packCode` | `'12'` brushes, `'25'` rollers (= pieces per carton) |
| `unit` | `PC` |
| `paintType` / `materialType` / `piecesPerCarton` | NULL |
| `isPrimary` | `true` |

⚠️ `displayName` uses `″` (prime) but `description` uses `"` (ASCII). Not a typo —
that's the live convention. Keep both.

**Smart brand quirk:** Smart-brand rows drop the brand word from `displayName`
(`Brush Double 3″`, `Unifiber Int. Roller 4″`) while Signature/Super keep it.
Deliberate, pre-existing. New Smart rows follow it.

---

## 4. What shipped — data

### 4.1 Menu (`mo_order_form_index_v2`)

- **+12 rows**, `sortOrder` 6030–6042
  - 10 brand-new products (9 from the file + `6472101` NUT)
  - 2 All-India brushes (`6474087`, `6474091`)
- **7 rows → `isActive=false`**
  - 4 superseded region rows (Smart/Super 4" UP Punjab + Delhi NCR)
  - 3 discontinued (Signature 4" Delhi NCR / UP Punjab / South — no replacement exists in the new series)
- **18 rows** got the new SAP code appended to `searchTokens` (old code kept — old orders stay findable)

Final: **31 active** TOOLS menu rows (was 26), 7 inactive.

### 4.2 Stock (`mo_sku_lookup_v2`)

- **+30 rows**, all `647xxxx`, `isPrimary=true`
- **25 rows → `isPrimary=false`** (all `645%` TOOLS except STICKERS)

Verified: 30 new primary · 0 old still primary · STICKERS `6028563` untouched ·
gift items `6473320` / `6473743` absent.

### 4.3 Verification (all returned zero rows)

- No active menu row without primary stock behind it (no blank rows)
- No primary stock without an active menu row (§14 menu-must-cover-stock holds)
- No old 645 brush/roller still primary

Browser-confirmed on `/place-order`: Rollers 21 · Brushes 9 · Stickers 1, All
India rendering as the grey region line, pack buttons on every row.

---

## 5. Decisions locked this session

1. **Switch off, never delete.** SKU → `isPrimary=false`; menu → `isActive=false`.
   Fully reversible with one UPDATE. Standard pattern for a SAP re-code.
2. **`6472101` "Smart Unifiber Int. Roller 9\" NUT" = its own sellable item**
   (own menu row + SKU), alongside `6474083` (plain 9").
   *Reasoning, not proof:* the `64721xx` band holds the genuinely-new items
   (refills, combos, 2" brush, NUT rollers); the `6474xxx` band holds the straight
   replacements. `6472101` sits in the new band, `6474083` in the replacement band.
   **Never physically verified against the rack or SAP.**
3. **`6472103` Super Polyacrylic 9" NUT** replaces old `6457571` on the **existing**
   menu row — no separate NUT row, because it's the only new code for that product.
   Hence its `description` says NUT but its `product` string doesn't.
4. **⚠️ Combo carton size = 25 — A GUESS.** `6472118` (Smart Unifiber 4" Combo) and
   `6472119` (Signature Epoxy 4" Combo) were set to `packCode='25'` on the reasoning
   that Unifiber = roller and rollers box in 25s. **Not confirmed against SAP.**
   The briefing originally said `6472118` was brush/12. **If a combo ever bills
   wrong, look here first** — one UPDATE each to correct.
5. **Old 645 codes stay in `searchTokens`** so historical orders remain findable by
   old code. Cost: more digits available to collide (see §6). Revisit if noisy.
6. Gift items (`6473320` Casio watch, `6473743` Philips fan) skipped.
   STICKERS `6028563` untouched — not brush/roller.
7. Old-series South codes present in the source file but absent from v2
   (`6457578`, `6457595`) NOT added — All India supersedes them.

---

## 6. The bare-digit search bug (fixed)

### Symptom

`brush 3` returned the Super Brush Double 2". `brush 2` returned the 2", both 5"
rows, and Signature 3".

### Cause

Both matchers use `indexOf()` substring matching and fold **filter + score into one
function**: score 0 → row excluded; any nonzero → included. `searchTokens` has SAP
material codes baked in by the seed
(`scripts/v2-catalog-seed-from-preview.ts:1009-1019`). A typed `3` matched the digit
**inside** `6472113` and leaked the 2" brush in.

`brush 2` behaved the same way: Signature 3" via old code `645759**2**`, both 5"
rows via `647407**2**` / `647409**2**`. The 4" rows stayed out only because
`6474087` / `6474091` contain no `2` — **luck, not design.** That asymmetry is what
confirmed the diagnosis.

A code-digit hit scores `SCORE_SUBSTRING_INNER = 5` (vs 100 prefix / 20
word-boundary) — the weakest possible signal, but the filter is **boolean, not
threshold-based**, so a 5 survives exactly as well as a 100.

### The rule (locked)

> A query token that is **entirely digits** AND **1–2 characters** long (`3`, `9`,
> `90`, `12`) only scores at a **word start** — index 0, or preceded by a
> non-alphanumeric char. Mid-word occurrence scores 0.

Unchanged: any token containing a letter (`m900`, `3in1`, `2k`, `g20`), and any
all-digit token of 3+ chars (`647`, `6474083`).

### Why not fix the seed

The diagnosis proposed stripping codes out of `searchTokens` at the seed layer.
**Rejected** — that's a reseed and a data-layer change for a search bug. The matcher
already distinguishes word-start (20) from mid-word (5); it just wasn't acting on
it. Matcher-only fix: 2 files, no seed, no DB.

### Impact check (evidence, not judgement)

A read-only query simulated typing **every number 1–99** against **every active menu
row**, reporting any row matching today that wouldn't match under the new rule.
Result: every affected row is a coincidental code-digit hit. Notable:

| Typed | Was found | Now | Verdict |
|---|---|---|---|
| `90` | 12 × M900 Gloss (via M9**00**) | not found | **Improvement** — `90` should find 90 Base, not M900. `m900` still works. |
| `20` | Hydro PU Matt (G**20**) | not found | Nobody types bare `20`; `g20` / `hydro` unaffected. |
| `1` | SuperClean 3in**1**, Damp Protect 2in**1** | not found | Nobody types bare `1`; `3in1` unaffected. |
| `4`, `3`, `2` | 94/93/92 Base paints (digit inside the base number) | not found by bare digit | `94` / `93` / `92` start a word → still work. |

**Numeric base codes 90/92/94/95/96/97/98/99 all sit at word starts → all safe.**

Reusable — this query is the template for any future search-matching change:

```sql
WITH nums AS (SELECT generate_series(1, 99) AS n),
rows AS (
  SELECT id, family, "subProduct", "displayName",
    lower(coalesce(family,'') || ' ' || coalesce("subProduct",'') || ' ' ||
          coalesce("displayName",'') || ' ' || coalesce("baseColour",'') || ' ' ||
          coalesce("searchTokens",'')) AS hay
  FROM mo_order_form_index_v2 WHERE "isActive" = true
)
SELECT n AS typed_number, count(*) AS rows_that_would_disappear,
  left(string_agg(DISTINCT family, ', '), 120) AS families_hit,
  left(string_agg("displayName", ' | ' ORDER BY "displayName"), 250) AS example_rows
FROM nums CROSS JOIN rows
WHERE hay LIKE '%' || n::text || '%'
  AND hay !~ ('(^| )' || n::text)
GROUP BY n ORDER BY count(*) DESC, n;
```

### Implementation notes

Mirrored edit in **two** files — `lib/place-order/mobile-search.ts` (serves `/order`
+ `/po`) and `lib/place-order/queries.ts` (serves `/place-order`). New
`SHORT_DIGIT_TOKEN` regex + `isWordStart` helper.

**The landmine that was explicitly guarded against:** `indexOf()` returns only the
**first** occurrence. If the first hit of a short digit is mid-word but a later hit
is at a word start, the row must still match. The fix scans **all** occurrences and
takes the best score. This is the easiest way to get this change wrong.

Boundary test is **non-alphanumeric**, not space-only — `searchTokens` is
comma-joined (`brush, double, super, 2 inch`).

Not extracted to a shared module: `mobile-search.ts` is client-imported,
`queries.ts` is server-side. Extraction is a separate decision.

---

## 7. Open follow-ups

### 7.1 `/po` app-format order — headers parse, product lines vanish (ACTIVE, next session)

Test order (Ambika Enterprise 3296171, Harsh Patel, 09:23) came back with Bill To /
Ship To / Dispatch all correct — so the fast lane **is** running — but **zero line
items**. The only raw line was the `Bill To:` line itself, marked UNMATCHED. The 6
products landed in the notes strip.

**`CLAUDE_MAIL_ORDERS.md §3.1` says parser v7.2 is "DEPLOY PENDING as of
2026-06-19". That is STALE — the depot PC is clearly running v7.2** (the `Dispatch`
tag is app-only; the human parser couldn't produce it). Correct the doc.

Prime suspect: where `Parse-AppBody` cuts the header block from the product block,
or a divergence between the repo copy and the depot PC copy. Briefing prompt written
and handed off to a fresh session.

**Not an enrichment bug** — Table C (§4.1) is built from `mo_sku_lookup_v2`, which
now has all 30 new codes. The lines never reach enrichment.

### 7.2 Legacy `mo_sku_lookup` top-up (LOW priority)

Legacy has **6** TOOLS rows and **zero** 647 codes. Only affects **human-typed**
emails — app orders go via Table C off v2. Do after 7.1.

### 7.3 `epoxy` search complaint (UNVERIFIED)

Reported: typing `epoxy` shows an epoxy **brush**. There is no epoxy brush in the
catalog — epoxy is rollers only. Screenshot requested, never supplied. May resolve
on its own now that `70b90bd6` is live. Re-test before investigating.

### 7.4 Token-scope idea (RAISED, NOT SPEC'D)

Owner wants brush/roller `searchTokens` narrowed to "SKU code + `roller 3` / `brush`
only — no epoxy, signature, or other brand words". Not designed. Would trade
findability for precision — dropping brand words means `signature` stops finding
Signature rollers. Needs a proper spec before any change.

---

## 8. Reusable pattern — SAP series re-code

Order matters. Each step is safe on its own and reversible.

1. **Arm the switch first (code).** Make sure the surfaces respect `isPrimary`.
   Safe while every row is still primary — nothing changes visually.
2. **Look before writing (SQL, read-only).** Dump the live family's rows from both
   tables. Never invent a convention; copy the siblings.
3. **Menu first (SQL).** New rows + deactivate superseded. New rows render with no
   pack buttons until step 4 — expected, harmless.
4. **Stock second (SQL).** Insert new `isPrimary=true`, flip old to `false`.
   The switch armed in step 1 now does the hiding.
5. **Verify (SQL, read-only).** Three checks, all must return zero rows:
   active menu without primary stock · primary stock without active menu ·
   old codes still primary.
6. **Browser smoke test.** Pack buttons on every new row is the tell — a row with
   no buttons means the `product` string didn't match between the two tables.

Guard inserts with `WHERE NOT EXISTS` on the real unique key — `mo_sku_lookup_v2`
has no unique constraint suitable for `ON CONFLICT` beyond `material`, and
`mo_order_form_index_v2`'s is on `(family, subProduct, baseColour)` (§2.1).

---

*OrbitOMS · Schema v27.9 · session 2026-07-15*
