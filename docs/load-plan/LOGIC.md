# Upcountry load plan — the rules

*Locked 2026-09-21 by the owner. The code is `lib/trips/load-plan-v2.ts` (`V2_LOCKED`, `planLoadsV2`); the screen is the Upcountry tab → **Load plan**. No rates or rupee amounts appear here or in anything the plan shows.*

## The numbers

| | Ace | Big | GC |
|---|---|---|---|
| Ideal weight → hard max | 2,000 → 2,300 kg | 3,000 → 3,500 kg | 1,500 → 1,650 kg |
| Stops: ideal / max | 6 / 8 (10 on a light milk run) | 6 / 7 | 4 / 4 (hard) |
| Per day | 2 | as needed | 3 |

- **Soft charges:** the plan adds a charge for each stop above the ideal and for each 100 kg above the ideal weight. It uses them only to choose between plans and never shows them. There is no "direct Big".
- **Light milk run:** an Ace may do up to 10 stops when its load is 1,500 kg or less. A truck's stops are always on one side.
- **Pairs:** two places share a truck only if they have gone together **at least 3 times** before or are on the **same route**. At most 6 places per truck.
- **Near places (GC):** a GC goes only where every place is marked near. **Every Surat-side place counts as near.**
- **Ride-along:** a stop under 300 kg may ride along with a truck on its side (any side) if it has gone with that truck's places **at least once** (or shares a route), within the truck's stop limit. A light stop that never went with them does not ride; it holds.
- **Bulk dealer:** a dealer over 3,000 kg. **One bill of 3,500–4,500 kg** goes on a Big on its own ("Big (heavy)"). **One bill over 4,500 kg:** "hire truck — about N Bigs of load".

## The order it plans in

1. **Direct:** IGT / Cross / Transport bills each get their own Direct card, never mixed.
2. **Bulk:** a dealer over 3,000 kg is split by bill into Bulk cards of up to 3,000 kg (one Big each); the leftover bills join the plan.
3. **Sides:** South, North and Surat are never mixed on one truck.
4. **Aces first** (milk runs, many small dealers), **then Bigs** (heavy loads, fewer stops), **then GCs** (near places, max 4 stops). With Bigs unlimited, a load a GC carries more cheaply is kept for a GC and goes on a Big only when the GCs run out.
5. **Merge:** two trucks become one when that saves, only if their places have gone together at least 3 times or share a route.
6. **Stop order:** farthest place first, back toward Surat.
7. **Leftovers:** a small order that isn't overdue and has no room becomes a **Hold** card, **one per place** ("hold for tomorrow"). Anything else without a vehicle becomes a **Waiting** card, one per side. Every card says why, naming the places.

## What amber and red mean

- **Amber:** over the ideal weight or ideal stops. It only happens when stops **joined** (so it saved a truck), always under the hard max. A single stop never goes over a vehicle's ideal; it takes a bigger vehicle.
- **Red:** over the hard max. The plan never does this; only a planner's pin or move can, and it is allowed.
- A Bulk card is a dealer's own truck and is never amber.

## Replan — "Vehicles I have"

- Enter how many Ace / Big / GC you have, each with an optional **driver max kg** ("+ add limit"), then press **Replan**. The header then says **"Using:"**.
- Only those vehicles are used, never more. A driver max is a hard limit with no bend, and the card shows "driver max X kg". A vehicle without one may bend to its hard max, shown amber.
- Order: **overdue orders first**, then the oldest, then the heaviest. Aces, then Bigs, then GCs. **Bulk cards get vehicles last** unless they are overdue.
- Leftover stops fill any space left. An overdue stop may push a smaller, newer stop out of a truck.
- What still has no vehicle goes to **Waiting**, with one line such as **"Short 800 kg — add 1 Ace"**: kilos and vehicle types only, never a cost. It never asks for more Aces than the day allows (2 minus the Aces you entered); past that it asks for Bigs.
- Vehicles nothing needed are listed as **unused**, e.g. "1 GC not needed".
- **Back to suggested** clears the vehicles, pins and moves.

## The planner decides

- **Pin** a card (📌): it comes back exactly as it is on every Replan, and its vehicle counts as used.
- **Move to…** on any stop: send it to another truck or to Waiting. It stays where you put it (the target truck is pinned as it now stands). A stop moved to Waiting asks for no vehicle.
- **Make trip** hands the card's bills to the floor's usual New trip flow.
- Pins and moves live on the screen only. A reload starts from the suggestion again.
