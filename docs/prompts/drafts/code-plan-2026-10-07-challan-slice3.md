# code-plan-2026-10-07 — Challan Orders slice 3: "Create challan order" on desktop /place-order

> **Revision 1 — owner decisions 7 Oct (web-update §4c, S3-1…S3-7).** Applied throughout; they override the
> first draft. **Challan MODE SWITCH** (tick holders only) replaces the secondary button (S3-1, §8) · Dispatch
> **Normal / Urgent** only, Call refused (S3-2, §5) · ship-to **Same as billing / Another dealer** only, typed site
> PARKED, no new columns (S3-3, §4) · **gapless ORB numbers** — §2 redesigned, which also changes the write order
> in §1 (S3-4) · base/tintable products allowed as plain goods (S3-5) · SMU from the dealer's latest bill (S3-6,
> §5) · one bill, cart resets after create (S3-7, §8). First-draft owner questions 1–7 are all answered; §10 holds
> only what is new. Mockup `docs/mockups/challan-orders/place-order.html` redrawn to the switch design.

**Status:** PLAN ONLY. No code, no DDL. Read-only SELECTs against production, 2026-10-07.
Builds on: slice 1 `e9143c1f` (Schema v27.60), slice 2 `f59a7f17`, slice 2b `ab8ddc13` (exclusions live).
Design: `web-update-2026-10-06-challan-orders.md` (§4c present). Evidence: `code-discovery-2026-10-03-challan-orders-2.md` Q2–Q7.

**What was read (rev 1).** In full: the design draft incl. §4c, this plan, the place-order mockup,
`place-order-page.tsx`, `cart-panel.tsx`, CORE §1 and §3, UI §10 and §13. CORE §13 was read for the parts that
bear on this slice (NULL logic, id-space, live feed, hard-delete notes) — not every entry. First-draft reading list
(unchanged): the place-order layout/provider/types/overlay, `lib/place-order/email.ts`, `pack-buckets.ts`,
`app/api/place-order/data/route.ts`, `lib/trips/number.ts`, `lib/ci/number.ts`, `lib/trips/drop-key.ts`, and the
import route's helpers + both live create paths (`handleConfirm` :1332–1775, `processAutoImportRows` :3379–4215).

---

## 0. The answer in one line

An ORB order is written at **`workflowStage = 'pending_picking'`** (`SUPPORT_DONE_OUTPUT`) with
**`dispatchStatus = 'dispatch'`** — where an imported non-tint bill lands once the import's release runs — built
**dark under a temporary key**, then given the **lowest free ORB number** and made visible in ONE update.

---

## 1. THE WRITES

### 1.1 Where an imported non-tint bill enters picking (unchanged)

Both live create paths write the order at `pending_support`, `dispatchStatus` NULL (`route.ts:1448-1450`,
`:3912`), then release it in the same request — mail-order enrichment auto-done (`:561-603`) or
`applyNoMailOrderFallback` (`:667-780`): `{ dispatchStatus: 'dispatch', workflowStage: SUPPORT_DONE_OUTPUT }` +
engine slot in ONE update, plus a log. `SUPPORT_DONE_OUTPUT = "pending_picking"` (`lib/workflow-stages.ts:64`).
An ORB order is written straight there (no mail order, no release to wait for — D6; a null status would strand it
in Floor arm 2, discovery risk 12). One status log instead of two.

### 1.2 The sequence (rev 1 — sequential awaits, never `$transaction`, no hard delete)

`TMP` = a per-press temporary key, e.g. `CO-TMP-<uuid>` — never starts `ORB-`, so `chk_orders_orb_number` admits
it on a row with `isChallanOrder = false`.

| # | Write | Columns → source |
|---|---|---|
| 1 | **`import_batches.create`** | `batchRef` = `TMP` (unique, carries no number) · `importedById` session user · `headerFile` `[challan-order] <bill-to code>` (IMPORT §4: the prefix is the source) · `lineFile` `""` · `status` `processing` |
| 2 | **`orders.create`** — DARK | `obdNumber` = `TMP` · **`isChallanOrder` false** (the CHECK forbids true on a non-ORB number) · **`isRemoved` true**, `removalReason` `CHALLAN_STAGING` (one exported constant) · `batchId` · `customerId` = bill-to dpm id · `shipToCustomerId`/`Name` = bill-to code/name · ship-to override (§4) · `orderType` `non_tint` · `workflowStage` `pending_picking` · `dispatchStatus` `dispatch` · `dispatchSlot`/`slotId`/`originalSlotId` = `resolveSlot(IST HH:mm)` · `arrivalSlotId` = `resolveArrivalSlotId(now)` · engine slot from `evaluateDispatchSlot` (same call as the fallback `:711-740`; a decline leaves it null = "no slot", as for an imported bill) · `priorityLevel`, `remarks`, `smu` (§5) · `obdEmailDate` = `orderDateTime` = now · `totalUnitQty`/`volume` Σ · `grossWeight` 0 · `materialType` null · `soNumber`/`invoiceNo` null |
| 3 | **`import_raw_summary.create`** | `batchId` · `obdNumber` `TMP` · `smu` · `obdEmailDate`/`obdEmailTime` · `totalUnitQty` · `grossWeight` 0 · `volume` · `billToCustomerId`/`Name` = bill-to · `shipToCustomerId`/`Name` = effective delivery point (§4) · `rowStatus` `valid` |
| 4 | **`import_raw_line_items.createMany`** + count check (Auto-Import GUARD 1, `:3743`) | per cart pack with tins > 0: `rawSummaryId` · `obdNumber` `TMP` · `lineId` 10, 20, … · `skuCodeRaw` = SAP material (§3) · `skuDescriptionRaw` = `sku_master_v2.description` · `unitQty` tins · `volumeLine` = `packToLitres × tins` (KG → 0, cart policy C1) · `isTinting` false (S3-5) · `article`/`articleTag` via `computeArticleInfo` · `rowStatus` `valid` |
| 5 | **`import_obd_query_summary.create`** | `orderId` · `obdNumber` `TMP` · `totalLines` · `totalUnitQty` · `totalWeight` 0 · `totalVolume` · `hasTinting` false · `totalArticle`/`articleTag` via `rollupArticleTagsBySku` |
| 6 | **CLAIM** — `orders.update` | `obdNumber` = lowest free ORB (§2) · `isChallanOrder` **true** (both in ONE write, so the CHECK holds). Still `isRemoved` true. P2002 on `orders_obdNumber_key` → re-read, retry ONCE |
| 7 | **Re-key children to the ORB number** | `import_raw_summary.update` by **id** · `import_raw_line_items.updateMany` **where `rawSummaryId`** · `import_obd_query_summary.update` **where `orderId`** · `import_batches.update` `batchRef` → the ORB number. Every re-key is by an id, never by the number |
| 8 | **MAKE VISIBLE** — `orders.update` | `isRemoved` false, `removalReason` null. ONE write (markers key on `MAX(updatedAt)`, FLOOR §10) |
| 9 | `order_status_logs.create` | null → `pending_picking`, session user, `"Created as challan order ORB-2026-00001 (Place Order)"` |
| 10 | `import_batches.update` | `status` `completed` |

**Not written:** `import_enriched_line_items` (no reader), `delivery_challans` (D4/D7), `mo_orders` (D6), trips,
`pick_assignments`. **No push** (NOTIFICATIONS §2: only assign/done/cancel). **Live feed free** — `orders` and
`import_obd_query_summary` triggers fire; every board filters `isRemoved: false`, so the dark row never shows.

### 1.3 Failure at each point — see §2.3 (one table for failures and number safety).

---

## 2. ORB NUMBER — GAPLESS (S3-4, redesigned)

### 2.1 What CORE actually says about deleting

CORE §1 is "What this app is" — it holds no rule about deletion. The rule people quote is **CORE §3 "Never delete
files unless explicitly instructed"** (and router §1 repeats it) — it is about **files in the repo, not database
rows**. For rows, CORE §3 says: soft-delete **reads** (`orders` lists add `isRemoved: false`), and every data write
outside app code goes through Smart Flow. App code already hard-deletes rows in places (`pick_assignments.deleteMany`
on cancel, `deleteTripDropIfEmpty`, `lib/ci/auto.ts`, the MRN photo route — CORE §13 notes the last two record no
actor). So **CORE does not forbid deleting a never-visible staging row.** The brief does, so no option below deletes.

### 2.2 The options

**A. Number first, re-park on failure.** Claim = `orders.create` with the lowest free ORB number (dark,
`isChallanOrder` true); children written under the ORB number; flip visible. On failure, re-park: rename the order
to a non-ORB tombstone with `isChallanOrder` false, and re-key its raw summary / lines / query summary to the
tombstone — because lines join to a bill **by `obdNumber`** (`lib/picking/queue.ts`, `lib/floor/queries.ts`,
`app/api/picking/order/[orderId]/route.ts`), dead lines left under `ORB-…07` would appear on the NEXT bill to take 07.
- Claim: the order insert (unique). Two presses: both read the same free N, one insert wins, the loser retries once.
- Failure: every failure after the claim needs a 4–5-write re-park; if the re-park itself fails, the number is held
  by a dark row AND dead lines sit under it → a gap until healed, and a **duplicate-lines risk** if anything reuses
  the number before the lines move. Worst failure profile of the three.

**B. Build dark under a temporary key, claim last (RECOMMENDED).** §1.2 as written: everything is built under
`TMP`; the ORB number is taken in ONE `orders.update` (write 6) after every child exists, then the children are
re-keyed **by id**, then the row is made visible.
- Claim: write 6 — `orders_obdNumber_key` is the lock. Two presses read the same lowest free N; one update wins,
  the other gets P2002, re-reads, takes the next free number (retry once; a second clash → "Please try again",
  nothing claimed).
- Duplicate: impossible — the unique index guards the number, and children are re-keyed by `rawSummaryId` /
  `orderId`, so no row is ever matched or moved by a number another press could also hold.
- Gap: only while a claimed-but-not-visible row exists (failure between 6 and 8) — healed by §2.4.

**C. Counter row with compare-and-swap.** A one-row-per-year counter advanced by
`updateMany where value = n` (atomic without a transaction). Needs DDL, and giving a number back works only if no
one has advanced past it — otherwise the hole stays. **Not gapless; rejected.**

### 2.3 Option B — every failure point

| Fails at | What exists | Number state | Response / cleanup |
|---|---|---|---|
| 1 batch | nothing | none held | 500, nothing to clean |
| 2–5 (order, summary, lines, query summary) | dark rows under `TMP` | **none held** | batch → `failed`; dark rows stay (no delete), invisible |
| 6 claim, 2nd clash | dark rows under `TMP` | none held | "Please try again" (409), batch → `failed` |
| 7 re-key | dark order holds N, children partly re-keyed | **N held, dark** | best-effort un-claim in the catch: order back to `TMP` + `isChallanOrder` false, children back to `TMP` by id; if that fails too → §2.4 heals it |
| 8 flip visible | dark order + children all under N | **N held, dark** | same un-claim; else §2.4 |
| 9 log / 10 batch | the bill is LIVE | N used | the bill stands; log the error (a missing log is not a missing bill). No rollback of a visible bill |

### 2.4 Allocation + self-heal

- **Lowest free, not MAX+1** (the trips rule, `lib/trips/number.ts`): read every `orders.obdNumber LIKE
  'ORB-{YYYY}-%'` — visible AND dark — and take the first missing seq ≥ 1. A number given back (un-claimed or
  healed) is the next one handed out. Year = IST year of the press (`lib/ci/number.ts`'s rule); 1 Jan starts at
  00001. Owner: `lib/challan-orders/number.ts` + `formatOrbNumber` in the slice-2 `orb-number.ts`.
- **Self-heal before every allocation:** dark rows (`isChallanOrder` true, `isRemoved` true, `removalReason =
  CHALLAN_STAGING`) older than **10 minutes** are un-claimed first (order → its tombstone `CO-DEAD-<id>`,
  `isChallanOrder` false; children re-keyed by id), so a number stuck by a failed un-claim is free again for the
  very press that needs it. 10 min is far past any live create (the route sets `maxDuration = 60`; no other
  challan path runs longer), so a create still in flight is never touched.
- **Can a gap still appear?** Only transiently — a number held by a dark row between a failure and the next press
  (≤ 10 min, or immediately if the catch's un-claim worked). Never permanent. A burned number is impossible
  because nothing visible ever carried it.
- **Can a duplicate appear?** No — `orders_obdNumber_key` UNIQUE; `chk_orders_orb_number` forbids an ORB number on
  a non-challan row and a non-ORB number on a challan row.
- ⚠ **Known cost of gapless:** a reused number can be LOWER than one handed out minutes earlier (07 fails, 08
  succeeds, the next press gets 07). See §10 Q1.
- The admin **removed-orders** list and Restore (`app/api/admin/removed-orders/route.ts`,
  `…/[id]/restore/route.ts`) must skip `CHALLAN_STAGING` rows — a dark row must never be restored by hand.

---

## 3. LINES — material codes (unchanged)

- The grid's pack carries `material` (`/api/place-order/data` → `RawPack.material`; dedup on the rendered pack,
  first row wins, no `orderBy` — PLACE_ORDER §22). The cart keeps only `packKey(packCode, unit)`.
- At Create the client looks each pack up in the `products` it already holds (`productId` + `packKey`) and sends
  that pack's `material` — the code the cell showed, i.e. "whatever the mapping picks today" (F2). No popup.
- Server re-check: a `mo_sku_lookup_v2` row with `isPrimary` matching `product`/`baseColour`/`packCode`/`unit`
  (natural key — CORE §13), present in `sku_master_v2`.
- **The 10 double-mapped cells** (live 2026-10-07; same winners on two reads, order not guaranteed):

| Cell | Picked today | Other primary |
|---|---|---|
| PROMISE EXTERIOR · 94 BASE · 1L | 5853608 | 5838923 |
| PROMISE EXTERIOR · 95 BASE · 1L | 5853611 | 5838935 |
| PROMISE EXTERIOR · BRILLIANT WHITE · 1L | 5838872 | 5853604 |
| PROMISE EXTERIOR · BRILLIANT WHITE · 20L | 5838875 (20L) | 5883497 (**22L**) |
| PROMISE EXTERIOR · 98 BASE · 20L | 5838934 (20L) | 5883562 (**22L**) |
| PROMISE INTERIOR · 92 BASE · 20L | **5883496 (22L)** | 5838863 (20L) |
| PROMISE INTERIOR · BRILLIANT WHITE · 20L | 5838855 (20L) | 5882951 (**22L**) |
| VT DIAMOND GLO · 94 BASE · 1L | IN30709472 | IN30709423 |
| VT DIAMOND GLO · 94 BASE · 4L | IN30709471 | 5915416 |
| WS MAX · BRILLIANT WHITE · 10L | 5948206 | IN46359082 |

- **Unresolvable line → block the create**, naming the line. Base / tintable products are plain goods (S3-5): every
  line `isTinting = false`, no warning.

---

## 4. SHIP-TO (rev 1 — two modes, S3-3)

Today's box (switch OFF) is untouched: one free string, `place_order_ship_to` canEdit, reaching an order only via
the email → parser → enrichment. Floor and trips read the **effective customer** `shipToOverrideCustomerId ??
customerId` (Floor feeds `lib/floor/queries.ts` :1047/:1459/:1704; drop key `lib/trips/drop-key.ts`); the bill-to
line reads `import_raw_summary.billToCustomerName`.

| Mode (switch ON) | `customerId` | `shipToOverride` / `…CustomerId` | raw summary `shipTo*` | Stop on Floor |
|---|---|---|---|---|
| Same as billing | bill-to id | false / null | bill-to | `c:<bill-to>` |
| Another dealer (picked from the same customer list, server resolves the code to an **active** dpm row) | bill-to id | **true / dealer id** | the dealer | `c:<dealer>`, bill-to line under it |

`customerId` is always the bill-to (F1b's dealer match). "Another dealer" writes the same two columns the Floor
ship-to pencil and the mail-order carry write. **Typed site + contact: PARKED to ROADMAP — no columns, no code.**
In challan mode the ship-to control shows whether or not the user holds `place_order_ship_to` (M3).

---

## 5. PRIORITY / REMARKS / NOTES / SMU (rev 1)

| Control | Imported bill today | ORB order |
|---|---|---|
| Normal | `priorityLevel` 3 | 3 |
| Urgent | `priorityLevel` 1 (`route.ts:289-291`) | **1** |
| Key dealer / key site | 1 (`:1458`) | **1** (bill-to `isKeyCustomer` / `isKeySite`) |
| Call | held (parser: Call → Hold) | **NOT ALLOWED** (S3-2) — hidden in challan mode; the server refuses `dispatch: "Call"` |
| Truck / Cross / Bounce / DTS + Notes | `orders.remarks`, joined `" \| "` (`:293-300`) | same strings as the email's Remark / Note lines, joined `" \| "` |

`orders.remarks` has no reader on Picking or Floor today (stored for the slice-5 Challan orders screen).
**SMU (S3-6):** the bill-to dealer's most recent bill's `smu` (`orders WHERE customerId = bill-to AND isRemoved =
false ORDER BY createdAt DESC LIMIT 1`), else null. Live: 862 of 886 customers in 90 days carry one SMU. Only
`Deco Retail` gets an engine slot; anything else shows "no slot", as for an imported bill.

---

## 6. GATE — `place_order_challan` (unchanged)

- `canEdit` only, read once in `app/(place-order)/layout.tsx` off the same `allPerms` as `canShipTo`, carried by
  `PlaceOrderAccessProvider` as `canCreateChallan`; the route re-checks with `checkAnyPermission`.
- Slice 1 left the key out of `ALL_PAGE_KEYS`, so even admin/superuser would read `undefined` → the switch would be
  drawn for nobody. **In slice 3:** add it to `ALL_PAGE_KEYS` (beside `place_order_ship_to`),
  `ACTION_PAGES.canEdit`, `ACCESS_SECTIONS` "Operations", and the rollback row in
  `components/admin/permissions-manager.tsx` — the `place_order_ship_to` precedent. Admin/superuser can test at
  once; **no grants, no SQL** until slice 9.

---

## 7. SERVER ROUTE (rev 1)

**`POST /api/place-order/challan-orders`** — `dynamic = 'force-dynamic'`, `maxDuration = 60`; logic in
`lib/challan-orders/create.ts`.

```
{ customerCode: string,
  shipTo: { mode: "same" } | { mode: "dealer", customerCode: string },
  dispatch: "Normal" | "Urgent",
  marker: "Truck" | "Cross Delivery" | "Bounce" | "DTS" | null, crossDepot: string | null,
  notes: string,
  lines: [{ productId: number, packCode: string, unit: string | null, material: string, tins: number }] }
```
Re-checks (all before write 1; each a 4xx `{ ok: false, code, error }`):
1. session; `place_order` canView + `place_order_challan` canEdit → 403.
2. `dispatch` ∈ {Normal, Urgent} — **"Call" → 400 `CALL_NOT_ALLOWED`** ("Call is not allowed on a challan order").
   Any other `shipTo.mode` (incl. a stale "site") → 400.
3. bill-to and ship-to dealer → **active** `delivery_point_master` rows (4 keyword codes map only to an inactive one).
4. ≥ 1 line; `tins` positive integers (cap 10,000); `productId` an active `mo_order_form_index_v2` row.
5. every material resolves (§3) → else 422 `UNRESOLVED_LINE` naming the line.
Response `200 { ok: true, orderId, orbNumber, lines, tins, litres }`. Client: confirm dialog (UI §13: `bg-black/40`,
gray-900 confirm, Enter / Esc) → busy lock (no double post) → toast **"ORB-… created — sent to picking"**.

---

## 8. THE SWITCH (rev 1 — replaces "multi-bill", S3-1 / S3-7)

- A **Challan order** switch at the top of the cart panel, drawn only when `canCreateChallan`. Page state
  `challanMode`, saved in the draft beside the other order-level fields.
- **OFF** = Place Order exactly as today (Bill tabs, ship-to box, Normal/Urgent/Call, Send Email).
- **Turning ON** with `bills.length > 1` → refused, switch stays OFF, inline red line: *"Challan order needs a
  single bill — remove the extra bills first."* With one bill it switches in, lines kept.
- **ON:** Bill bar hidden (add / duplicate / delete unreachable), ship-to = two modes (§4), Call hidden (a stored
  Call becomes Normal on switching in), and **"Create challan order" REPLACES Send Email** as the one brand button
  (UI §10); empty cart → grey disabled. The keyboard's send path (`sendButtonRef`, `/` and Enter in the overlay)
  points at Create while ON — Send Email is unreachable in challan mode.
- **After create:** `resetCart()`, the draft clears (S3-7). Switch stays ON.

---

## 9. RISKS

1. **Dark staging rows accumulate** after failures (never deleted, by the brief). Harmless to every board; findable
   by `removalReason = CHALLAN_STAGING` / `CO-DEAD-…`; hidden from admin Restore (§2.4).
2. **Double press** → client busy lock; no idempotency key.
3. **No weight** — `totalWeight` 0 (discovery Q2/Q8).
4. **The 20L/22L cell pairs** (§3).
5. **Pick gate** live OFF; if ON, a waiting ORB order reaches pickers only on a shown trip.
6. **A dark row at write 2 is `pending_picking` + `dispatch` but `isRemoved`** — any reader that forgets the CORE §3
   `isRemoved: false` rule would see it. Slice 3 greps the live boards' predicates for it before shipping.

---

## 10. NEW OWNER QUESTIONS

1. **Gapless can issue numbers out of order:** if 07 fails and 08 succeeds, the next challan is 07, created after
   08. Accept that (it is the trip-number rule), or prefer "never reuse below the highest issued" — which reopens
   the gap?
