# web-update-2026-10-06-challan-orders.md
# Design decision — Challan Orders (Phase 1, non-tint)
# Status: DESIGN — not built. Decisions made in Claude.ai, 3–6 Oct 2026.
# Evidence: docs/prompts/drafts/code-discovery-2026-10-03-challan-first-orders.md (e0c6c321)
#           docs/prompts/drafts/code-discovery-2026-10-03-challan-orders-2.md (69f2ccec)
# Where this draft and live code disagree, the CODE wins. Re-verify every file:line before building.

---

## 1. The problem

Some orders cannot be billed in SAP on the day (mostly credit block), but the depot is pressured to
send the goods anyway on a challan. Three failures follow today:

1. **Stock gap** — goods leave, SAP book stock still shows them.
2. **Forgotten invoice** — nobody notices a challan was never billed.
3. **Double dispatch** — when the bill is finally raised, the OBD lands in Orbit, auto-releases to
   picking, and the goods ship a second time.

## 2. What we are building (plain English)

1. Depot team creates the order in Orbit on desktop Place Order → Orbit number `ORB-2026-00001`.
   **The ORB number IS the challan.**
2. Goods flow: picking supervisor → picker → check done → Floor → Orbit trip → leaves with a
   printed challan. Billing is skipped.
3. Billing's new **Challan Orders** tab lists every unbilled challan, oldest first.
4. When SAP can bill: billing punches SAP, then **pastes the SO number against the ORB number**,
   THEN imports the OBD file (process rule).
5. On import the OBD is linked to the ORB order, gets a new status, and is hidden from every
   dispatch screen. It shows only in the Challan Orders tab. It is recorded on a freight trip for MIS.
6. Orbit compares challan lines vs SAP lines (material code + tins) and flags differences.

## 3. Locked decisions

| # | Decision | Locked as |
|---|---|---|
| D1 | Where the challan order lives | Normal `orders` row. ORB number in the OBD slot + a new challan flag. NOT a separate table (picking/floor/trips read `orders`). |
| D2 | Where created | **Desktop `/place-order` only.** Not `/po`, `/po2`, `/po9`. |
| D3 | Name | Screens: **"Challan orders"**. Badge: **"Challan"**. Button: **"Create challan order"**. Code: `challan_order*` — kept clearly apart from the existing `delivery_challans` (CHN). |
| D4 | Numbering | ORB number only. **No CHN number** for these. The existing CHN challans (Retail Offtake / Decorative Projects) are unchanged. Import must NOT allocate a CHN for a linked SAP OBD. |
| D5 | Phase 1 scope | **Non-tint only.** Tint Manager "Add to Tint" must refuse challan orders. |
| D6 | Goods flow | Straight to picking supervisor. Skips Mail Orders review and billing. After check done it does NOT enter Billing Picking tab or Print tab — status reflects on Floor only. |
| D7 | Paper | **PARKED — not in Phase 1** (owner, 6 Oct). Design kept for later: same Delivery Challan format, ORB number instead of CHN, printed by Floor only, every print logged. Mockup exists at `docs/mockups/challan-orders/challan-paper.html`. |
| D8 | Billing link | ONE shared **Challan orders** screen, built once, mounted in three places: **Billing** tab, **Floor** tab, **Place Order** ("My challan orders" link). Same lists everywhere. Only holders of the edit tick see the paste-SO box, Link and Unlink (hidden, not disabled). Owner confirmed no other screen needs it. |
| D8b | History | The shared screen has four tabs: **Not billed · Waiting for OBD · Billed · History**. History = every challan order ever, date filter + search by ORB / dealer / SO, with current status (in picking → sent → waiting → billed, or cancelled). |
| D9 | Linked SAP OBD | New status (NOT `cancelled` — that lands on Floor's Cancelled tab; NOT hold — that lands on Hold tab). Hidden from picking, Floor (all arms), Orbit trips, tint. Visible only in Challan Orders tab. |
| D10 | Process rule | **Billing pastes the SO BEFORE importing the OBD file.** |
| D11 | Safety net (late paste) | If the SO is pasted and the OBD is already imported: **not yet picked → auto pull-back** into the Challan tab; **picker started / tint touched / on a trip → refuse + red "Double dispatch risk" warning** to supervisor and Floor. Owner: "it won't happen mostly but keep the guard." |
| D12 | Line match | Computed live (not stored): challan lines vs SAP lines by material code + total tins. ✅ match / ⚠ mismatch with per-line detail. |
| D13 | Freight trip | Linked OBD goes on a freight trip **for MIS** (the ORB's real Orbit trip is not visible to MIS). Freight Trips today accepts held bills only (`lib/freight-trips/pool.ts`, `bills.ts`) — must also accept challan-linked bills. **HOW it is added (auto from the ORB trip vs manual) — PARKED, owner to decide later.** |

## 4. Smaller decisions (all confirmed by owner, 6 Oct 2026)

| # | Item | Locked as |
|---|---|---|
| F1a | Bill-to | The dealer **SAP will bill** = the customer picked at the top of Place Order, from master only, never typed. |
| F1b | Dealer-match guard | On SO paste (and again on OBD link), the SAP bill's customer must equal the challan's bill-to. Mismatch → refuse with a clear message ("SO … is for X, challan ORB-… is for Y"). |
| F1c | Ship-to | Where the truck goes — any of: **Same as billing** (default) / **another dealer** picked from master / **typed site address**. Typed site cannot group with other trip stops; Floor groups it under the bill-to dealer. Challan paper prints both Bill to and Ship to. (Earlier draft default "master only, no typing" was REPLACED — sites need free text.) |
| F2 | SKU / material code | **No popup.** Use the SKU mapping Place Order already uses and save the material code silently. For the 10 double-mapped product/pack cells, use whatever the existing mapping picks today (Claude Code to confirm which). A wrong pick surfaces as ⚠ in the line match — nothing breaks. (Earlier draft "user chooses from a list" was REPLACED.) |
| F3 | Ageing on "Not billed" list | Amber at **3 days**, red at **7 days**. |
| F4 | Cancel a challan order | **SUPERSEDED by S5-4 (7 Oct): admin only.** (Earlier: creator or Billing until pick done — tried and replaced; do not revert.) |
| F5 | Part-billing | One challan may link to **several SOs** (e.g. 20 + 16 = 36). One SO links to **one challan only**. Line match sums all linked OBDs. |
| F6 | ORB number | `ORB-{YYYY}-{NNNNN}`, resets each year, allocate + retry once on unique clash (trip-number pattern). Never `$transaction`. |

## 4b. Mockup review decisions (owner "all ok", 6 Oct 2026 — mockups commit dfdd285f)

| # | Locked as |
|---|---|
| M1 | Badge: **CHALLAN**, capitals, purple (UI §3 "Split" purple) — distinct from the grey GIFT chip. |
| M2 | Floor row: badge sits in the Ship-to cell BEFORE the dealer name; on ORB rows the trip tag moves to the date line (ORB number is 14 chars vs OBD 10). No width-array change. |
| M3 | Anyone with the Create-challan tick sees the three-way Ship-to (no separate Ship-to tick needed for challan orders). |
| M4 | After create, only the bill that was sent clears (same as Send Email). |
| M5 | Edit-tick holders can **unlink** a wrong SO while it is still Waiting for OBD. |
| M6 | Half-billed (one SO's OBD in, another still waiting) stays in **Waiting for OBD** until every SO has its OBD. |
| M7 | Age counts from the trip date; if not yet sent, from creation. |
| M8 | NO "Billed:" line on the Picking card. Floor row keeps it. |

## 4c. Slice 3 owner decisions (7 Oct 2026, on code-plan-2026-10-07-challan-slice3.md)

These OVERRIDE anything above that disagrees.

| # | Locked as |
|---|---|
| S3-1 | **Challan mode switch** on desktop /place-order, visible only to holders of `place_order_challan`. OFF = Place Order exactly as today. ON = Bill tabs hidden (ONE bill only), Send Email REPLACED by a single **"Create challan order"** button, "Call" dispatch hidden. Switching ON with 2+ bills in the cart → refuse: "Challan order needs a single bill — remove the extra bills first." (Replaces the earlier "secondary button above Send Email" mockup and M4.) |
| S3-2 | Dispatch: user picks **Normal or Urgent** (NOT fixed). **Call is not allowed** for challan orders (it would hold the order; challans go straight to picking). |
| S3-3 | Ship-to Phase 1: **Same as billing** or **Another dealer** (from master) ONLY. **Typed site address + contact → PARKED to ROADMAP** (no DDL now). Q1 "shares the bill-to stop" is moot until then. |
| S3-4 | ORB numbers must be **GAPLESS**. A failed create must give its number back so the next press reuses it. (Replaces F6 "retry once, gap acceptable".) Mechanism = plan rev 1 **Option B** (build hidden under a temporary key, claim the lowest free ORB number last via the obdNumber unique index, re-key children by row id; stale claims > 10 min released by the next create). **Out-of-order reuse is ACCEPTED** (e.g. 06, 08, 07 by time) — the trip-number precedent; strict ordering would bring back permanent gaps. Owner, 7 Oct. |
| S3-5 | Base / tintable products are **allowed as plain untinted goods** — "Base" does not mean tint. No warning. |
| S3-6 | SMU: copy the bill-to dealer's most recent bill's SMU, else null (web default — owner did not object). |
| S3-7 | One bill at a time, so the "keep or clear other bills' fields" question is moot. After create, the cart resets. |

## 4d. Slice 5 owner decisions (7 Oct 2026, on code-plan-2026-10-07-challan-slice5.md)

| # | Locked as |
|---|---|
| S5-1 | Slice 5 ships on its own (admin-only edit, no grants). Rule stands: NO real challan orders until slice 6 is live. |
| S5-2 | Dealer mismatch at paste (a mail order for that SO names a different customer): **warn and allow** ("Link anyway?"). The authoritative dealer check is at import (slice 6), against the SAP OBD's bill-to. |
| S5-3 | Cancelling an ORB order that has 'waiting' SO links **auto-unlinks them** (status 'unlinked', unlinkedById = canceller, unlinkedAt = now). A later SAP bill for that SO then flows as a normal order — correct, the challan goods never left. |
| S5-4 | **Only ADMIN can cancel or remove a challan (ORB) order once created.** Every cancel / remove path (Floor cancel, picking cancel / pick delete, Tint, admin removed-orders, any other) must refuse a non-admin on an isChallanOrder row, server-side. Admin still obeys the existing stage rules. **Replaces F4** ("creator or Billing until pick done"). |

ROADMAP item to add: "Challan orders — typed site ship-to (address + contact columns, own trip stop question, challan paper Site/Receiver box)".

## 5. Data model (proposed — names settled in the DDL slice, with a CORE schema-version entry)

- **`orders`** — new challan flag (e.g. `isChallanOrder`), and on the SAP row a link back to the ORB
  order (self-relation → must be explicitly NAMED on both sides).
- **SO link table** (e.g. `challan_order_so_links`) — ORB order id, SO number (unique), linked by,
  linked at, status (waiting OBD / linked). Separate table because the SO is pasted before the SAP
  OBD row exists.
- **New status value** for the linked SAP OBD — check whether the column carries a CHECK; if so,
  ALTER first.
- **Print log** for Floor challan prints.
- Creating one challan order = **five writes** (discovery 2, Q2): batch row, order, raw summary, raw
  lines, query summary. Must fill: OBD slot (ORB), batchId, orderType, shipToCustomerId, customer id,
  `dispatchStatus='dispatch'`, non-tint. Prisma requires fields live Postgres allows null — follow
  Prisma.
- Lines must store the **SAP material code** (resolved by natural key — CORE §13 sku_master id-space
  landmine). Customer code → `delivery_point_master` is 1:1 (712/712).

## 6. Screen changes

| Screen | Change |
|---|---|
| Desktop Place Order | "Create challan order" button (tick-gated) beside "Send Email". Bill-to = selected customer. Ship-to box as today (same as billing / other dealer / typed site). Material codes from existing SKU mapping, silently. Shows "ORB-… created". |
| Picking (queue, mobile board, picker face) | ORB order appears with **Challan** badge. Linked SAP OBD never appears. |
| Floor | ORB order on board + trips with badge. Needs customer id or it shows on All tab only. **Print challan** button (tick-gated). Linked SAP OBD never appears (no Hold, no Cancelled tab). |
| Trip lookup | Must find ORB numbers (typed lookup misses them today). |
| Billing Picking / Print tabs | Exclude challan orders: `isChallan:false` in `buildBillingPendingWhere`, and exclude beside the held filter in `loadPrintTrips` (**mandatory** — otherwise a trip carrying a challan bill can never be copied). |
| Billing **Challan Orders** tab (new) | Three bands: Not billed (ageing) · Waiting for OBD · Billed (✅ / ⚠). Paste SO. Click → side-by-side lines. |
| Tint | "Add to Tint" refuses challan orders. |
| Import (all 4 sources) | Check the SO link in BOTH release functions in `app/api/import/obd/route.ts` (mail-order step releases first — a Telephonic-style hook alone is not enough). Linked → new status, no release, no CHN. |
| Challan document | Today cannot render an ORB order (list filters on SAP SMU, detail 404s without a `delivery_challans` row, lines only from SAP). Needs its own path; same layout. Floor's Operations User has no access to the challan screen today. |
| Freight Trips | Accept challan-linked bills (D13, how parked). |

## 7. Access (per user — ACCESS_SOURCE is `user`)

New ticks (page keys named in the DDL slice):
- Place Order · Create challan order
- Challan orders — view (one tick; the same screen in Billing, Floor and Place Order)
- Challan orders — edit (paste SO / link / unlink)
- (Floor · Print challan — parked with D7)

Badges need no tick. **Who gets each tick is decided from a live SELECT of current Place Order /
Billing / Floor holders — never from seed.**

## 8. Proposed build slices (one prompt each; diagnosis and code never mixed)

0. Mockups (`docs/mockups/challan-orders/`) — Place Order button + Challan Orders tab + badge + challan paper.
1. DDL — flag, link table, status value, print log, page keys. CORE version entry in the same pass.
2. Exclusions first (safe, invisible): billing pending + print trips, Add to Tint refusal, trip lookup.
3. Place Order create (5 writes, ORB numbering, ship-to, SKU resolve).
4. ~~Floor print challan~~ — PARKED (D7).
5. Shared Challan orders screen (4 tabs incl. History) — mounted in Billing, Floor, Place Order; edit controls tick-gated.
6. Import catch + hidden status + safety net (pull-back / warn).
7. Line match view.
8. Freight trip acceptance (after owner decides D13 how).
9. Access ticks (SELECT first, then grant named users).

## 9. Doc fix found during discovery

`CLAUDE_FLOOR.md` §4.1 says Floor cancel is not stage-gated. Code refuses bills on a trip,
dispatched, or in the tint room (discovery 2, Q6). Fix at next consolidation.

## 10. Still open

- D13 how the linked OBD gets onto a freight trip.
- The 11 "open questions for owner" in discovery report 2 — not yet reviewed in Claude.ai.
- Tint challan orders — Phase 2.
