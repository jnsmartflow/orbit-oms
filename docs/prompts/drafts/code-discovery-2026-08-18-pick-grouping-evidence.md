# Code discovery — the evidence behind the pick-grouping rules
# 2026-08-18 · TRANSCRIPTION of prior read-only measurements · no analysis re-run for this file
# Draft record, not canon. No canonical CLAUDE_*.md was edited.

> **Purpose. This is the evidence behind the pick-grouping rules. It exists so nobody
> re-measures any of it, and so the rejected ideas stay rejected.**
>
> Every figure below was measured in an earlier read-only session and is reproduced here
> **as-dated**. Nothing was re-derived to write this file — re-running it would take hours and
> risk contradicting a committed draft. If you need a number that is not here, check whether
> it is in one of the source drafts before measuring anything.

**Source drafts** (all committed, all read-only):

| Draft | Measured | What it owns |
|---|---|---|
| `code-discovery-2026-08-15-import-overlap-baseline.md` | 2026-08-15 | The first (reversed) verdict, the arrival anchor, the rarity non-event |
| `code-discovery-2026-08-15-overlap-window-ladder.md` | **2026-08-16** (see ⚠ below) | The window ladder, containment, the single-SKU finding, chaining |
| `code-update-2026-08-18-floor-oil-grouping.md` | 2026-08-18 | The two rules as shipped, the shared-SKU mistake |
| `code-update-2026-08-18-picking-grouping.md` | 2026-08-18 | The phone board, the two-readers landmine |

---

## ⚠ THREE DISCREPANCIES FOUND WHILE TRANSCRIBING — recorded, not silently resolved

**1. The no-observable-exit count: 1,106, not 1,093.**
The brief for this file gave **1,106** in its reachability section and **1,093** in its roadmap
section, for the same quantity. The measured value is **1,106** — printed by
`scripts/_rule2-check.ts` on 2026-08-18 as `1907 waiting spells; 1106 (58%) have NO observable
exit`, and consistent with `scripts/_waiting-pool.ts`'s own header (58%). **1,106 is used
throughout this file.** 1,093 appears to be a transcription slip and is recorded here only so
the next reader who meets it knows which one to trust.

**2. The window ladder's date: 2026-08-16, not 2026-08-15.**
The ladder draft's FILENAME says `2026-08-15`, but its own header line says
`# 2026-08-16` and its body is explicit: *"The control is the same method one day later. Scope
rolled with the clock: 6,375 bills (6,366 with lines) vs yesterday's 6,484 (6,475)… the window
slid by one day."* The **baseline** run is 2026-08-15; the **ladder** run is 2026-08-16. This
file dates every ladder figure **2026-08-16**, following the committed draft's content over its
filename. Do not "fix" the filename — the CSVs share the same stamp and the pair is coherent as
long as this note exists.

**3. The chemistry split cannot be read off the `paintType` column.**
The brief gives **water ~53% · oil/solvent ~35% · stainer ~10%**. The raw `paintType` tallies
from the 2026-08-17 live-set read are:

| paintType | pick lines | % of 21,004 |
|---|---|---|
| oil | 6,433 | 30.6% |
| water | 6,330 | 30.1% |
| **(blank)** | **4,907** | **23.4%** |
| stainer | 2,211 | 10.5% |
| wood | 902 | 4.3% |
| solvent | 149 | 0.7% |
| putty | 72 | 0.3% |

**Stainer matches exactly (10.5% ≈ ~10%). Water and oil do not**, because **23.4% of lines carry
no `paintType` at all** — concentrated in WS (1,803 lines), Velvet Touch (1,374) and Tools (261),
all of which are water-based or non-paint. The ~53/35/10 split is consistent with those blanks
**assigned by family**; the table above is the same data **unassigned**. Both are recorded so a
future reader does not mistake one for a refutation of the other. **If a number matters, say
which of the two derivations you mean.**

---

## §1 — Reachability: is there ever anything to group?

*Measured 2026-08-18 · 14 days to 2026-08-17 · 5-minute samples, 08:00–20:00 IST ·
`scripts/_waiting-pool.ts`, `scripts/_rule2-check.ts`*

**1,907 waiting spells** reconstructed from `order_status_logs`.

> 🔴 **1,106 of them (58%) have NO OBSERVABLE EXIT** — no later status log, no
> `pick_assignments` row. Those bills now sit at `dispatched`, and their `updatedAt` values
> cluster on **nine dates**: bulk sweeps, not per-bill exits.
>
> **Everything in this section is therefore a BOUND, not a measurement.** The lower bound
> assumes those bills left instantly; the upper bound holds them to their sweep. The truth is
> between. Do not quote a single figure from this section without its bound.

| | lower bound | upper bound |
|---|---|---|
| samples with **at least one group available** | **41.9%** | **75.7%** |
| waiting-pool size — median | 7 | 21 |
| — p75 | 18 | 78 |
| — p90 | 21 | 229 |
| — max | 42 | 282 |

**Dwell in waiting** (exact spells only): median **23.5 min** · p75 **196 min** · p90 **880 min**
· **28% under 5 minutes**.

### 🔴 Bursts do not help — do not propose "group the burst"

**236 release bursts over 14 days** (16.9/day, median 4 bills, biggest 35). **Three of the five
biggest left a pool of ZERO one minute later.** Bills released together are assigned away
together, so a burst never becomes a standing pool. The pool is what grouping needs; a burst is
not a pool.

---

## §2 — 🔴 CLOSED QUESTION: grouping on the rail is worthless

*Measured 2026-08-18*

**241 groups** from the day's rail bills vs **234** from whole-day pooling — indistinguishable.

**Cause:** enrichment auto-dispatches bills to `pending_picking` **in the same second they are
created**, so the rail never holds anything. The rail population **IS** the day's population.

> **The gain in all of this comes from pooling across TIME, not from moving to a different
> stage.** Moving grouping earlier in the workflow buys nothing, because there is no earlier
> stage that holds bills.
>
> **Do not revisit this as a new idea.** It reads like an obvious improvement and it is not.

---

## §3 — The window ladder

*Measured **2026-08-16** (see discrepancy 2) · 60 days · 6,366 bills carrying at least one
active line · `scripts/analysis/import-overlap-baseline.ts` §2*

Containment = `shared / min(distinctA, distinctB)`. A "free bill" is containment **1.0** — every
one of its SKUs is already on a partner.

| cohort width | free-bill rate | avg bills per bucket |
|---|---|---|
| W0 — same import batch (control) | 19.8% | 4.2 |
| **W1 — same half-day** | **50.4%** | 63.7 |
| W2 — same day | 62.8% | 124.8 |
| W3 — same 3 days | 77.9% | 303.1 |
| W4 — same week | 88.1% | 707.3 |

> **The single big step is batch → half-day** (19.8% → 50.4%). Everything wider buys only
> ~10–15 points for a whole extra day of holding — and the capped shelf-visit saving actually
> **peaks at W1 (1,533 visits avoided over 60 days, ~26/day)** and falls at every wider window,
> because groups merge into fewer, larger blobs.

### 🔴 The finding that reversed the first verdict

> **3,267 bills — 51.3% of the population — carry exactly ONE distinct SKU.**
>
> A **"must share ≥ 2 SKUs"** test is **arithmetically unreachable for half the depot.** The
> first run used exactly that test, excluded half the population by construction, and then
> reported the result as "overlap is thin". It was not thin; the test could not see it.
>
> Under containment, **2,104 of those 3,267 single-SKU bills (64.4%) are fully covered by a
> same-day partner.** That population alone is larger than everything the first run found.

### 🔴 Connected components are NOT pick groups

Components are transitive: A–B and B–C merge even when A and C share nothing.

**The largest same-day (W2) component was 276 bills across 14 routes.** By W2, **79%** of the
"bills in a 3+ cluster" figure sits inside blobs of 10+.

> **Any grouping must use a bounded rule — never a raw connected component.** This is why both
> shipped rules cap at 4 bills. The pair-level columns (containment, free-bill rate) are
> unaffected by chaining and are the trustworthy half of the ladder; cluster size bands and
> route purity are not.

---

## §4 — The catalog

*Live set measured **2026-08-17** · 60 days to 2026-08-17 · **1,075 distinct SKU codes**,
**21,004 pick lines**, matched `sku_master_v2.material` = `import_raw_line_items.skuCodeRaw`
(CORE §13 — never `skuId`, never old `sku_master`)*

### 🔴 There is no storage-location field anywhere in the schema

A full `information_schema` sweep for `warehouse|zone|location|bin|rack|aisle|shelf|section|
area|storage` found **no storage field on any table**. Every hit was something else:

- `orders.warehouse` / `import_raw_summary.warehouse` — the **SAP depot code**, one depot
- `area_master`, `sub_area_master`, `delivery_point_master.areaId` — **delivery geography**
- `mo_order_form_index_v2.section` — an **order-form tab label**
- `attendance_records.location*` — **GPS check-in**

**Zoning cannot be read from the database. It has to come from a rule over product fields, or
from someone walking the floor.**

### Field coverage on the live set

| field | distinct values | coverage | verdict |
|---|---|---|---|
| **`category`** | **22** | **811 of 1,075 SKUs = 95.1% of pick lines** | ⬅ **USE THIS** |
| `displayCategory` | 40 | finer, but carries mislabels (§8c) | secondary |
| `product` | 124 | too granular to zone by | — |
| `paintType` | 6 | semantically ideal, **blank on 23.4% of pick lines** | qualifier only |

**Only `PRIMER` and `SATIN` straddle oil/water**, and `paintType` splits both cleanly — which is
exactly why the oil rule is `category` **plus** `paintType` for those two and `category` alone
for the rest.

### The catalog gap is a gap, not junk

**264 live SKU codes (24.6% of codes, but only 4.9% of pick lines) are NOT in `sku_master_v2`.**
They are **overwhelmingly real paint** — WS Prima E900/E1000 machine-tint bases, PS Sealer 800,
PS Interior A700, WS Elastomeric. **Only 23 codes / 32 lines are genuinely non-paint** (ceiling
fan, watches, bags, a desktop, mixers, shakers, spray guns).

> **This is a CATALOG GAP, not a zoning problem.** Fixing it is §8d. Do not design around it as
> if those bills were unclassifiable.

### Chemistry split of picking

**water ~53% · oil/solvent ~35% · stainer ~10%** — *with blanks assigned by family.* See
discrepancy 3 above for the unassigned `paintType` tallies; the two are the same data counted
two ways.

### The reference table — all 22 categories on the live set

*Measured 2026-08-17. This is the reference table for any future zoning work. Do not re-run it.*

| category | live SKUs | pick lines | % of lines | paintType breakdown |
|---|---|---|---|---|
| GLOSS | 124 | 3,042 | 14.5% | oil 113 · — 9 · solvent 2 |
| PROMISE | 90 | 2,716 | 12.9% | water 89 · — 1 |
| STAINER | 64 | 2,211 | 10.5% | stainer 64 |
| WS | 90 | 2,162 | 10.3% | — 60 · water 30 |
| SATIN | 41 | 1,766 | 8.4% | oil 27 · water 14 |
| PRIMER | 36 | 1,647 | 7.8% | oil 16 · water 15 · wood 5 |
| VELVET TOUCH | 53 | 1,435 | 6.8% | — 50 · water 3 |
| SADOLIN | 96 | 1,126 | 5.4% | wood 77 · solvent 11 · — 8 |
| AQUATECH | 44 | 1,059 | 5.0% | water 43 · — 1 |
| PROMISE ENAMEL | 41 | 1,006 | 4.8% | oil 41 |
| SUPERCOVER | 18 | 904 | 4.3% | water 13 · — 5 |
| SUPERCLEAN | 23 | 268 | 1.3% | water 22 · — 1 |
| TOOLS | 35 | 261 | 1.2% | — 35 |
| TEXTURE | 3 | 97 | 0.5% | — 3 |
| PUTTY | 5 | 88 | 0.4% | putty 4 · water 1 |
| VT SPECIALTY | 12 | 78 | 0.4% | — 6 · water 6 |
| SPRAY PAINT | 8 | 48 | 0.2% | oil 8 |
| PU ENAMEL | 14 | 39 | 0.2% | oil 14 |
| METALLIC | 4 | 13 | 0.1% | water 4 |
| FLOOR PLUS | 4 | 12 | 0.1% | water 4 |
| TILE | 4 | 4 | 0.0% | — 4 |
| LUSTRE | 2 | 3 | 0.0% | water 2 |
| **(uncatalogued)** | **264** | **1,019** | **4.9%** | n/a — no catalog row |

`—` = blank `paintType`.

### Zone quality = pick lines per SKU

**A small busy area is a good zone; a big quiet one is not.** Density, not size, is what makes a
zone worth walking to.

| category | lines per SKU |
|---|---|
| Supercover | 50 |
| Primer | 46 |
| Satin | 43 |
| Stainer | 34.5 |
| Promise | 30 |
| Gloss | 25 |
| Sadolin | 12 |
| PU Enamel | 3 |

Sadolin is the caution: **96 SKUs for 1,126 lines** — a wide, slow range. PU Enamel at 3 is not
a zone at all.

---

## §5 — Zoning: proposed, NOT confirmed

> 🔴 **NOTHING HAS BEEN BUILT ON ANY OF THIS.** The eight zones below were proposed from the
> data. **None are confirmed.** They need someone to walk the floor.

**The depot is ONE connected warehouse** with two areas:

- a **~10,000** area holding **Gloss, Promise Enamel, OB Satin and oil Primer**
- a **~25,000** area where **emulsions are scattered**

**Pickers work both.** The area names are the depot's own shorthand, not a schema value —
§4 establishes there is no storage field to read.

### The eight candidate zones — unconfirmed

1. Gloss
2. Promise Enamel
3. OB Satin (oil)
4. Primer (oil)
5. Emulsions — Promise
6. Emulsions — WS
7. Emulsions — Velvet Touch
8. Stainer / tinting machine

### The three open questions — a person must answer these

1. **Does the emulsion zone split?** Are Promise, WS and Velvet Touch on separate racks, or one
   run of shelving? Zones 5–7 collapse to one if not.
2. **Where do the WS Prima tint bases live** — with the emulsions, or by the tinting machine?
   These are the same codes as the §4 catalog gap and §8d.
3. **Is Sadolin next to the oil paints or far from them?** Its 96 SKUs / 12 lines-per-SKU
   density (§4) makes this expensive either way.

---

## §6 — The oil threshold

*Measured 2026-08-18 · 30 days to 2026-08-17 · 2,808 bills · `scripts/_oil-threshold.ts`*

### Oil share per bill

| oil share | bills | % of bills |
|---|---|---|
| 100% | 478 | 17.0% |
| 51–99% | 190 | 6.8% |
| exactly 50% | 91 | 3.2% |
| 1–49% | 210 | 7.5% |
| **0%** | **1,839** | **65.5%** |

> **Two-thirds of bills have no oil paint at all. That is the hard ceiling on Rule 2** and the
> reason it will never be the main rule. Anyone surprised that Rule 2 produces single-digit
> groups per day should read this row first.

**2-SKU bills = 472 (16.8% of all bills):** 110 all-oil · **50 one-oil-one-other** · 312 no oil.

### The threshold choice

| threshold | groups/day |
|---|---|
| oil share = 100% | 0.60 |
| oil share > 50% | 1.67 |
| **oil share ≥ 50%** | **2.30** ⬅ chosen |

**≥50% was chosen because 13 of its 69 groups exist ONLY because a 2-SKU bill at exactly one oil
plus one other was allowed in.** Those 13 groups are invisible to `>50%`.

### Then the shared-SKU requirement was removed

| | groups/day | bills/day |
|---|---|---|
| Rule 2 with the shared-SKU requirement | 2.20 | 5.03 |
| **Rule 2 without it (shipped)** | **4.17** | **12.67** |

Groups nearly doubled; **bills grouped went up 2.5×** — more than groups did, because the
packing fills to 4 where the old rule rarely got past 2. The full reasoning and the live
counter-example are in `code-update-2026-08-18-floor-oil-grouping.md` §3.

---

## §7 — Ideas tried and REJECTED, with the reason, so they stay rejected

> Every one of these looks like an improvement. Each was measured or reasoned through and
> rejected. **Read the reason before proposing it again.**

| Idea | Why rejected |
|---|---|
| **"shared ≥ 2 SKUs" as the match test** | **Arithmetically unreachable for half the depot** — 51.3% of bills carry exactly one distinct SKU (§3). This is the test that produced the first, wrong verdict |
| **Grouping at release time on the rail** | **No gain** — 241 rail groups vs 234 whole-day. Enrichment auto-dispatches in the same second, so the rail holds nothing (§2) |
| **Excluding any bill that carries an emulsion** | **Too strict.** A bill already crossing to the big area was crossing anyway. Replaced by the ≥50% oil-share test (§6) |
| **A hard same-route restriction** | **Would cost ~40% of the saving.** Route is displayed on both screens, never enforced |
| **Raising the group cap past 4** | **4 saves 74/day, 5 saves 76.** Not worth the trolley |
| **A rarity / noise weighting for common SKUs** | **Measured and unnecessary here.** The single most common SKU is on only **3.4%** of bills; the >30% test matched **zero** codes. There is no ubiquitous-primer floor to filter out (baseline, 2026-08-15) |
| **Per-group Assign buttons on the phone, and MAIN / FREE / "+N steps" chips** | **Rejected for the phone deliberately.** The stripe and the heading carry the whole message, and a second call-to-action would compete with the Assign bar that already exists (`code-update-2026-08-18-picking-grouping.md` §4) |

---

## §8 — For ROADMAP, not part of this feature

**a. 1,106 waiting spells over 14 days have no observable exit** (§1 — and see discrepancy 1;
the brief also gave 1,093 for this figure, which is not the measured value). Something writes
`dispatched` with **no status log and no `pick_assignments` row**, so **the board's own history
cannot be reconstructed**. Related to the open *"no automatic drain `pick_checked` →
`dispatched`"* gap in `CLAUDE_PICKING.md §7`. Until this is closed, every reachability figure
stays a bound.

**b. `CLAUDE_CORE.md §7.1.c` is STALE on `displayCategory`.** It says the column is *"EMPTY, no
readers yet"*. It is **populated — 45 distinct values, 46 blanks** (measured 2026-08-17).
`displayName` is still genuinely empty.

**c. `displayCategory` carries at least two wrong labels** (2026-08-17): **`IN34220072`** (DN SB
CEMENT PRIMER 1L) and **`5540669`** (DN Zinc Yellow Metal Primer 1L) are **both tagged "Promise
Exterior"**. Both are primers. Two found without looking; a sweep is warranted before anything
reads this column.

**d. 264 live SKU codes are missing from `sku_master_v2`** (§4) — mostly **WS Prima machine-tint
bases**. Real paint, not junk. Connected to §5's second open question.

**e. 🟡 PACK SIZES ARE TREATED AS DIFFERENT PRODUCTS — the biggest unmeasured idea here.**
1 L and 4 L of the same paint share **nothing** under a `skuCodeRaw` match (`IN28140072` vs
`IN28140071`), though they are almost certainly **the same shelf**. Several real Rule 2 groups
turned out to be **the same product in different tins**. **A pack-family key would let Rule 1 —
the exact rule, the one that costs the picker nothing — absorb them for free**, which is a
better outcome than any Rule 2 group. **Not measured.** The ladder draft flags the same gap in
its *"What this still cannot see"* §3.

---

## What this file does NOT establish

- **No zone is confirmed** (§5). Eight are proposed; a person must walk the floor.
- **Every §1 figure is a bound**, because 58% of spells have no observable exit.
- **No picker was timed.** "Shelf visits avoided" is a proxy for effort, never a measured time
  saving. One tin and forty tins of a SKU are identical to every measure here.
- **Route purity is measured, never enforced.** Whether a cross-route group is worth picking
  together is an operations question none of this answers.
- **60 days, one depot, June–August.** No seasonality.

---

*Transcription only — no analysis was re-run to produce this file. Every figure carries the date
it was measured. Read-only throughout: no app file modified, no row written.*
