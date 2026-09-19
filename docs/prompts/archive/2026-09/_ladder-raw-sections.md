
## THE LADDER — 6366 bills with >= 1 active line, 60 days

| W | cohort | a. avg bills/bucket | b. >=1 shared SKU | c. containment >=0.5 | d. containment =1.0 (free bill) | e. best containment median / p75 |
|---|---|---|---|---|---|---|
| W0 | same import batch (control) | 4.2 | 29.5% | 24.4% | 19.8% | 0.00 / 0.33 |
| W1 | same half-day (IST, split 13:00) | 63.7 | 66.5% | 61.0% | 50.4% | 1.00 / 1.00 |
| W2 | same day (IST) | 124.8 | 75.9% | 72.7% | 62.8% | 1.00 / 1.00 |
| W3 | same 3 days (IST blocks) | 303.1 | 86.1% | 85.0% | 77.9% | 1.00 / 1.00 |
| W4 | same week (IST, Mon-Sun) | 707.3 | 92.5% | 91.9% | 88.1% | 1.00 / 1.00 |

| W | f. clusters 2 / 3-4 / 5-9 / 10+ | f. bills in a 3+ cluster | g. saving median / p75 | g. SKU-visits avoided | h. single-route (of 3+ clusters) |
|---|---|---|---|---|---|
| W0 | 326 / 125 / 52 / 13 | 904 (14.2%) | 50.0% / 66.7% | 754 | 46.4% of 179 |
| W1 | 355 / 190 / 81 / 59 | 3175 (49.9%) | 36.0% / 50.0% | 1,533 | 17.8% of 287 |
| W2 | 317 / 132 / 65 / 55 | 3996 (62.8%) | 38.9% / 60.0% | 1,246 | 14.3% of 210 |
| W3 | 201 / 90 / 27 / 26 | 5007 (78.7%) | 50.0% / 66.7% | 799 | 11.5% of 113 |
| W4 | 100 / 71 / 22 / 14 | 5653 (88.8%) | 66.7% / 66.7% | 555 | 14.5% of 83 |

Chaining check — a connected component is NOT an operational group:

| W | largest component | bills in a 10+ component | share of the 3+ population |
|---|---|---|---|
| W0 | 42 | 198 | 21.9% |
| W1 | 203 | 2060 | 64.9% |
| W2 | 276 | 3156 | 79.0% |
| W3 | 491 | 4541 | 90.7% |
| W4 | 892 | 5279 | 93.4% |

## W2 (day) — the 15 largest clusters

| # | bills | IST day | distinct SKUs together (all members) | distinct SKUs separate (all members) | saving % (capped 4) | routes |
|---|---|---|---|---|---|---|
| 1 | 276 | 2026-08-06 | 348 | 1655 | 60.7% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · IGT / CROSS · Kamrej · Navsari · No Route · Olpad · Udhana · Vapi · Varachha |
| 2 | 256 | 2026-07-10 | 259 | 964 | 33.8% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Udhana · Vansda · Vapi · Varachha |
| 3 | 243 | 2026-07-06 | 374 | 1775 | 35.1% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · IGT / CROSS · Kamrej · Navsari · Udhana · Vansda · Vapi · Varachha |
| 4 | 187 | 2026-08-12 | 281 | 803 | 17.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Parvat · Udhana · Vansda · Vapi · Varachha |
| 5 | 160 | 2026-07-15 | 218 | 600 | 13.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Olpad · Parvat · Udhana · Vansda · Vapi · Varachha |
| 6 | 147 | 2026-06-25 | 226 | 658 | 67.2% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · IGT / CROSS · Kamrej · Navsari · Olpad · Udhana · Vapi · Varachha |
| 7 | 130 | 2026-06-22 | 206 | 549 | 23.1% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Parvat · Udhana · Vansda · Vapi · Varachha |
| 8 | 113 | 2026-06-29 | 194 | 424 | 14.4% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Parvat · Udhana · Vansda · Vapi · Varachha |
| 9 | 100 | 2026-07-25 | 161 | 371 | 36.7% | (unknown) · Adajan · Bardoli · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 10 | 99 | 2026-06-20 | 163 | 387 | 8.3% | (unknown) · Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · Parvat · Udhana · Vansda · Vapi · Varachha |
| 11 | 96 | 2026-07-13 | 146 | 300 | 6.3% | (unknown) · Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · No Route · Udhana · Vapi · Varachha |
| 12 | 72 | 2026-08-14 | 147 | 279 | 19.0% | (unknown) · Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 13 | 70 | 2026-08-10 | 123 | 281 | 22.9% | Adajan · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Udhana · Vapi · Varachha |
| 14 | 65 | 2026-06-18 | 115 | 235 | 17.9% | (unknown) · Adajan · Bardoli · Bharuch · Chikhli · Ghod Dod · Kamrej · Navsari · Olpad · Udhana · Vapi · Varachha |
| 15 | 63 | 2026-08-08 | 110 | 269 | 47.0% | Adajan · Bardoli · Bharuch · Ghod Dod · Kamrej · Navsari · No Route · Udhana · Vapi · Varachha |

## W2 — the early-fetch case among 3+ clusters
- 3+ clusters at W2: **252**
- of those, DECIDABLE (>= 2 members carrying a dispatchWindowId or dispatchTargetDate): **158** (62.7%)
- of the decidable ones, members DISAGREE on window/date: **127** (80.4%)
- undecidable (0 or 1 slotted member — the previous run's null trap, excluded not assumed): **94**

## Single-distinct-SKU bills
- bills with exactly ONE distinct skuCodeRaw: **3267** (51.3% of bills with lines)
- of those, fully covered by a same-day (W2) partner carrying that SKU: **2104** (64.4%)
