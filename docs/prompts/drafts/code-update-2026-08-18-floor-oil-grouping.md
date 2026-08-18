# Floor — Rule 2: bundling bills of the same product family

**2026-08-18 · commit `3fadb0c7` · pushed to `main` · Floor only**

> Draft record, not canon. Nothing in `docs/CLAUDE_*.md` was edited for this change —
> the corrections below are staged here for the next FLOOR reconciliation pass to fold in.

---

## 1. What shipped

A **second grouping rule** on Floor's By-group view (`/floor`, `mode="group"`), behind a
kill switch. Rule 1 — the exact-match bundler that shipped in `3e989cb5` — is untouched in
behaviour and still runs first.

| File | What changed |
|---|---|
| `lib/floor/grouping.ts` | `OIL_PAINT_RULES`, `isOilPaint()`, `buildOilSkuSet()`, `buildOilGroups()`. `buildPickGroups` (Rule 1) not touched. |
| `lib/floor/types.ts` | `FloorOilSkus`, `OilGroup`, `oilSkus` on `FloorBoardResult` |
| `lib/floor/queries.ts` | `RULE2_ENABLED` + one extra sequential await against `sku_master_v2` |
| `lib/floor/scope.ts` | `scopeBoard` narrows `oilSkus` exactly as it narrows `waitingSkus` |
| `components/floor/group-row.tsx` | `variant: "free" \| "oil"`, the three labels, the quiet non-oil line |
| `components/floor/floor-board.tsx` | order of play, count line, `SINGLE PICKS` |

**The flag.** `RULE2_ENABLED` in `lib/floor/queries.ts`, beside `RAIL_SUGGESTIONS_ENABLED`
and deliberately the same shape. **False removes Rule 2 completely** — the catalog query is
inside the branch so it is never issued, `oilSkus` ships as `[]`, and `buildOilGroups`
against an empty set produces nothing by construction (no bill can reach a 50 % oil share
against an empty set). The FIELD is always present, so no caller's type changes with the
flag and no downstream branch was needed.

**No schema change, no new column, no new table, no new API route, no `orders.update`.**
The oil-paint definition is a constant over the catalog's own columns, not a stored
attribute — there is no warehouse / zone / area field anywhere in the schema, and adding one
would mean hand-tagging 1,743 SKUs and keeping them tagged.

**Floor only.** The phone board (`/picking`) is next and is **deliberately not in this
commit** — see §10.

---

## 2. The two rules, and the order of play

### ⚠️ RULE 1 ALWAYS RUNS FIRST

Rule 1 runs over the **whole** waiting pool. Rule 2 is handed **only** `ungrouped` — the
bills Rule 1 left behind. **A bill can never appear in both, and Rule 1 always wins a
contested one.** This is asserted in the preview script, not assumed.

### Rule 1 — exact (unchanged, shipped `3e989cb5`)

> A bill joins another only if **every SKU it needs is already on the other**. Not "mostly
> overlapping", not a percentage: zero new SKUs. Max 4 bills (1 main + 3 riders).

Rule 1 has a genuine main bill and genuine riders, because for Rule 1 that is a true
description: the riders ride a walk the main bill was making anyway.

### Rule 2 — family (new)

> A bill **qualifies** when at least **50 %** of its distinct SKUs are oil paint, and it has
> at least one distinct SKU.
>
> Oil paint = `category = 'GLOSS'` · `category = 'PROMISE ENAMEL'` ·
> `category = 'SATIN' AND paintType = 'oil'` · `category = 'PRIMER' AND paintType = 'oil'`.
> Resolved on **`sku_master_v2.material` = `import_raw_line_items.skuCodeRaw`** — never
> `skuId`, never old `sku_master` (CORE §13 id-space landmine).
> **Uncatalogued or blank is NOT oil paint. Unknown is never inside.**
>
> **Bills need nothing in common with each other.**
>
> **Packing**, one deterministic walk: sort by oil share DESC → distinct-SKU count DESC →
> `obdNumber` ASC (locale `"en"`; `obdNumber` is `@unique`, so this is a total order). Walk
> it, adding each bill to the open group while it has **fewer than 4 bills** and the group's
> **total distinct SKUs stays ≤ 10**. When neither holds, close and start again. **A group
> of one is not a group** — it goes to `ungrouped`.

Measured over 30 complete IST days (2026-07-19 → 2026-08-17, day pools, Rule 1 first):

| | groups/day | bills/day | 30-day totals |
|---|---|---|---|
| Rule 1 (baseline) | 17.67 | 47.90 | 530 g / 1,437 b |
| Rule 2 (extra) | **4.17** | **12.67** | 125 g / 380 b |

53 % of Rule 2 groups have every member at 100 % oil; 47 % have at least one member between
50 % and 99 %.

---

## 3. The mistake this corrected — read this first

**Rule 2 originally required each rider to share at least one SKU with the main** (and that
at least one shared SKU be oil paint). That condition was wrong, and it was wrong in an
instructive way: **it is Rule 1's logic applied to a rule about a different thing.**

- **Rule 1 saves a repeated SHELF.** Two bills want the same tin; one man picks it once. Its
  unit of saving *is* a shared SKU code, so "adds zero new SKUs" is exactly right for it.
- **Rule 2 saves a repeated JOURNEY.** Several bills want material from the same end of the
  depot; one man walks there once instead of three men walking there three times. **A
  journey is saved whether or not the bills want the same tin.**

### The live counter-example, 18 Aug

Two bills waiting at the same moment:

```
9108973203   IN28916072  DN GLOSS SKY BLUE 1L
             IN28905772  DN GLOSS BUS GREEN 1LT

9108973205   IN28209272  DN GLOSS INTERMEDIATE BASE NEW 0.9L
             IN28912273  DN GLOSS DARK BROWN 500ML
```

Both **100 % Gloss**, both **2 items**, plainly **one man's trip to the Gloss racks** — and
Rule 2 refused them, because **not one code matched**. Codes in common: zero.

### What removing the condition was worth

| | groups/day | bills/day |
|---|---|---|
| Rule 2 with the shared-SKU condition | 2.20 | 5.03 |
| Rule 2 without it (shipped) | **4.17** | **12.67** |

Groups nearly doubled; **bills grouped went up 2.5×** — more than groups did, because the
packing now fills to 4 where the old rule rarely got past 2.

> **Anyone whose instinct says "surely they must have something in common" should read this
> section before acting on it.** The thing they have in common is **the area**, and the
> qualifier already tests for exactly that. A comment to this effect sits above
> `OIL_PAINT_RULES` in `grouping.ts` so the bug cannot be reintroduced quietly.

---

## 4. Why there is no main bill in a Rule 2 group

Members are **peers**. There is no main and there are no riders.

`OilGroup` therefore **lost `main`, `riders`, `savedTrips` and `addedSteps`**. Those were
not renamed or redefined — they were arithmetic about *a rider relative to a main*, and with
no main they measure nothing. Redefining them into something plausible-looking would have
been worse than deleting them. What remains: `members`, `totalSkus`, `hasNonOil`, `allPure`,
and `id` (the first member's `orderId`, documented explicitly as **identity, not a main**).

**Rule 2 rows draw NO per-row chip at all.** `chipFor` is optional on `FloorTable`, so oil
groups pass nothing. Every chip the component can draw — `MAIN BILL`, `FREE`,
`+N steps · shares M` — describes a bill's position *relative to a main*. Drawing any of
them would assert a relationship that does not exist, and **`MAIN BILL` on an arbitrary
first member is the most believable of the available lies** — the operator would simply
believe it.

Rule 1 rows keep `MAIN BILL` / `FREE` unchanged, because there they are true.

---

## 5. The zero-SKU guard, in its ratio form

`buildPickGroups` step 1 drops zero-SKU bills because **the empty set is a subset of every
set**, so such a bill satisfies "adds zero new SKUs" against every main on the board.

Rule 2 has the **same landmine wearing a different face**: "at least half of this bill's SKUs
are oil paint" is **vacuously true of a bill with no SKUs**. Without a guard it would qualify
at a perfect 100 %, sort to the very front of the packing order (oil share DESC), and be
packed into a group as a bill to fetch — with nothing on it to fetch at all.

`oilShare()` guards first and divides second. **This is not hypothetical**: roughly 9
zero-line bills appeared in the preceding 60 days, which is why Rule 1 carries the same
guard. `0/0` is not 100 %, and it is not a `NaN` worth reasoning about either — every
`NaN >= x` is false, so an unguarded version would behave correctly *by accident* and wrongly
the first time someone sorted on the value.

---

## 6. Determinism

**Per load:** identical input gives byte-identical output, same contract as Rule 1. Every
sort ends on `obdNumber` (`@unique` on `orders`) with the locale pinned to `"en"` exactly as
`lib/picking/sort.ts` pins it, so the depot PC and Vercel cannot disagree. Asserted by
running the engine twice on the same input and comparing JSON.

**Across loads — this is better than what it replaced, and the old warning is retired.** The
shared-SKU version was deterministic per load but *not stable across loads*: a rider needing
one shared code could legitimately attach to several different mains, so which main won
depended on the pool's exact composition at that instant. The 30-day read caught the same
main bill offering a 2-bill group at one moment and a 3-bill group at another, and the board
has no pause of its own (FLOOR §5 — the 15 s marker pauses only on history / detail-open), so
an operator could watch a group recompose under his hand.

**That is gone.** Membership is now a straight walk down one total order. **Nothing attaches
to a main, so nothing competes for a partner.** An arriving bill can still move packing
boundaries *downstream of where it lands* — any packing has that — but it cannot make two
settled bills change their minds about each other.

---

## 7. The `variant` → `tableVariant` rename on `group-row.tsx`

`GroupRow` already had a prop called `variant`: the `FloorTableVariant` (`"live" | "history"`)
which it forwards verbatim to `FloorTable`. It was renamed to **`tableVariant`** so `variant`
could carry the group KIND (`"free" | "oil"`).

The rename is not cosmetic tidying — **the old name was simply wrong**, and it was wrong in a
way that blocked the correct name for the new prop. `tableVariant` describes what the value
actually is. One call site, mechanical, `tsc`-verified; no JSX moved because of it, proven by
the render diff in §9.

---

## 8. Labels — one vocabulary, and it must survive to the phone

Three labels, used identically by the group pill, the count line and the section header:

| Kind | Label |
|---|---|
| Rule 1 group | **SAME MATERIAL** (teal — costs the picker nothing) |
| Rule 2 group | **MOSTLY SAME** (amber, outlined not filled — a different offer, not a free one) |
| Ungrouped | **SINGLE PICKS** |

Count line: `{n} waiting · {a} same material · {b} mostly same`. The "mostly same" clause
shows **even at zero**, so the operator learns the second kind exists on the days it produces
none rather than meeting it by surprise on the one day it fires. With `RULE2_ENABLED` false
the clause is dropped entirely — naming something that cannot appear is worse than silence.

Quiet line, unchanged, when a group holds anything outside the oil set:

> Some items here are outside the oil paint area

Grey, no red, no badge, no block. He decides.

**Neither pill carries a number.** Rule 2 has no arithmetic to offer. Rule 1 still *has* one
(`savedTrips`, which still orders its groups) but it is no longer drawn: showing a number on
one pill and not the other would make the two kinds read as different sorts of thing rather
than two answers to the same question.

> ⚠️ **The same three words must be used on the phone board when it is built.** A supervisor
> moves between the desk screen and his phone during one shift; two vocabularies for the same
> two ideas is a defect, not a detail.

**Why "oil paint" and never "small warehouse" / "10K":** the rule is defined by **product**,
and the operator can verify a product from the row in front of him. Which building the
material sits in is *our* reasoning, not his evidence — naming the building would ask him to
trust a mapping he cannot see.

---

## 9. Still unverified — do not treat this as proven on the floor

- 🔴 **No Rule 2 group has ever been seen rendered on a live board.** The waiting pool was
  empty for the whole build window (it was 4 bills at one point on 18 Aug and 0 an hour
  later), and every history day checked was fully picked. The render proofs used **synthetic
  SKU lists on real board rows** — dealer, route, slot and litres real; stage flags and SKU
  lists fabricated. Without that the oil markup would have shipped never having rendered once.
- 🔴 **The two named bills were verified against their real lines, not on the board.** By the
  time the rewrite was proved, `9108973203` and `9108973205` were both at `pick_checked`. The
  engine was run against their actual `import_raw_line_items` rows and grouped them (4 SKUs,
  all-pure). That proves the rule; it does not prove the screen.
- 🔴 **The double-press assign race is untested.** Two quick presses of "Assign all N to X" on
  a group have not been exercised.
- ✅ **Proven:** `tsc` clean; six asserts (no bill in both rules, every member ≥ 50 % oil,
  2-4 bills, ≤ 10 distinct SKUs and `totalSkus` correct, identical-input-identical-JSON,
  empty oil set yields zero groups); and **Rule 1's rendering byte-identical to `HEAD`** via a
  `git stash` baseline diff — zero differences.
- ⚠️ **One promise was deliberately retired.** Before the relabel, `RULE2_ENABLED=false`
  rendered a screen byte-identical to pre-Rule-2 `HEAD`. This commit relabels Rule 1's own
  pill and the ungrouped header, so a flag-off screen is intentionally **not** the old screen
  any more. What the flag still guarantees is the part that matters: no second engine pass, no
  catalog query, no groups, no clause.

**What Smart Flow should eyeball first:** the two group kinds looking different at a glance;
then the quiet non-oil line against the expanded table; then sitting on a live board through
several 15 s marker ticks to watch for reshuffling.

---

## 10. Next

**The phone board.** `/picking`'s mobile supervisor face has no grouping at all today. When it
gets one it must use §8's three words verbatim.

**⚠️ The engine must move out of `lib/floor/` when that happens.** `lib/floor/grouping.ts` is
pure — no prisma, no clock, no I/O — but it lives in a Floor-named folder, and a second
consumer under `components/picking/` importing from `lib/floor/` is exactly the cross-module
reach that goes stale. Follow the **`use-bill-pager.ts` precedent**: when a second surface
needs it, the shared thing moves to a neutral home and both import from there, rather than one
screen reaching into the other's folder. (Same reasoning that moved `parseArticleTag` /
`aggregateArticleTags` out of `lib/article-tag.ts` into the dependency-free
`lib/article-tag-parse.ts` for the By-picker card — FLOOR §11.)

**Also open, not scheduled:**

- No section divider between the SAME MATERIAL and MOSTLY SAME blocks — the count line is the
  only thing naming the two kinds. Deliberate (it was not asked for), but in a long list the
  operator meets the tone change with no heading.
- `allPure` now drives no copy. It is kept because `scripts/_rule2-preview.ts` reports the
  53/47 split as a measurement, and because it is a pure-function return value rather than a
  payload field crossing the wire (unlike the `totalArticle` precedent on `FloorBoardRow`).
  **Do not resurrect a label from it** — a purity distinction on screen is a fresh design
  decision, not a field waiting to be re-used.
- The 30-day figures come from **day pools**, which are an upper bound: not all of a day's
  bills are waiting at the same moment. Real pools are smaller and the real groups/day will
  be lower.

---

## Corrections owed to canon (for the next FLOOR reconciliation pass)

Nothing below has been written into `docs/CLAUDE_FLOOR.md` — it is listed here so the pass
that owns that file can fold it in.

| § | What needs saying |
|---|---|
| FLOOR §3 | The By-group view now has TWO rules; `getFloorBoard` carries a second sibling array (`oilSkus`) beside `waitingSkus`, built by one extra sequential await and narrowed by `scopeBoard` |
| FLOOR §8 / §10 | `RULE2_ENABLED` joins `RAIL_SUGGESTIONS_ENABLED` as a live Floor kill switch — same shape, same file |
| FLOOR §11 | `lib/floor/grouping.ts` now exports `buildOilGroups` / `buildOilSkuSet` / `isOilPaint` beside `buildPickGroups` |
| FLOOR §10 | Add: the shared-SKU condition is a **retired** approach, not an unimplemented one — §3 above is the reason it must not come back |

---

*Draft · 2026-08-18 · commit `3fadb0c7` · Floor · OrbitOMS*
