# Upcountry load plan — the rules

*Locked 2026-09-21 by the owner. The code is `lib/trips/load-plan-v2.ts` (`V2_LOCKED`, `planLoadsV2`). No rates or rupee amounts appear here or in anything the plan shows.*

## The numbers

| | Ace | Big | GC |
|---|---|---|---|
| Ideal weight → hard max | 2,000 → 2,300 kg | 3,000 → 3,500 kg | 1,500 → 1,650 kg |
| Stops: ideal / max | 6 / 8 | 6 / 8 | 4 / 4 (hard) |
| Per day | 2 | as needed | 3 |

- **Soft charges:** the plan adds a charge for each stop above the ideal and for each 100 kg above the ideal weight. It uses them only to choose between plans and never shows them. There is no "direct Big": a Big with one or two stops still stops at 3,500 kg.
- **Pairs:** two places share a truck only if they have gone together before (at least once) or are on the same route. A truck carries at most 6 places.
- **Ride-along:** a load under 300 kg may ride along with any truck on its side.
- **Bulk dealer:** any dealer over 3,000 kg.

## The order it plans in

1. **Direct:** IGT / Cross / Transport bills each get their own Direct card, never mixed.
2. **Bulk:** a dealer over 3,000 kg is split by bill into Bulk cards of up to 3,000 kg each, one Big per card. A single bill over 3,000 kg is its own Bulk card. A bill no vehicle can carry is a Bulk card marked "hire". The dealer's leftover bills join the plan like any other stop.
3. **Sides:** South, North and Surat are never mixed on one truck.
4. **Aces first:** the two Aces take the milk runs (many small dealers).
5. **Then Bigs:** Bigs take the heavy loads with fewer stops.
6. **Then GCs:** GCs go only where every place is marked near, and never carry more than 4 stops. With Bigs unlimited, a load a GC carries more cheaply is kept for a GC, and goes on a Big only when the GCs run out.
7. **Merge:** two trucks become one when that saves, and only if their places have gone together before or share a route.
8. **Stop order:** each truck goes to its farthest place first and works back toward Surat.
9. **Leftovers:** a small order that isn't overdue and has no room becomes a **Hold** card ("hold for tomorrow"). Anything else without a vehicle becomes a **Waiting** card, one per side. Every card says why, naming the places.

## What amber means

A truck is **amber** when it is over its ideal weight or ideal stops. That only happens when stops **joined** (so it saved a truck), and it always stays under the hard max. A single stop never goes over a vehicle's ideal. It takes a bigger vehicle instead. A Bulk card is a dealer's own truck and is never amber.

## Replan — when the vehicles are entered

- The plan uses **only the vehicles entered**, never more.
- A vehicle entered with a **max kg** (the driver's limit) is hard-capped there, with no bend. A vehicle without one may bend up to its hard max, shown amber.
- **Pinned** cards stay exactly as they are, and their vehicle counts as used.
- Bulk cards get vehicles first. Then Aces, Bigs and GCs fill in that order. Overdue orders go first, then the oldest, then the heaviest.
- Leftover stops fill any space left, most important first. An overdue stop may push a smaller, newer stop out of a truck.
- Whatever still has no vehicle goes to **Waiting**, with one line such as **"Short 800 kg — add 1 Ace"**. The line gives the kilos and the cheapest vehicle type that would carry them, never a cost.
- Vehicles nothing needed are listed as **unused**, for example "1 GC not needed".
