# code-discovery-2026-10-06-floor-so-column

**Classification:** `code-discovery-*` — DIAGNOSIS ONLY. No code written, no file edited except this one, nothing committed.
**Goal (owner):** a "Sales Officer" column on the `/floor` table. Normal bills → the SO who sent the mail order (`mo_orders.soName`, by `soNumber`). Division 74 (Decorative Projects) and 77 (Retail Offtake) → the SO from customer master, the same person the delivery challan prints.
**Code read at:** HEAD `9ee92a8b` (clean for `components/floor`, `lib/floor`).
**Live data:** read-only SELECTs against production on 2026-10-06 (CORE §3). Two methods: (a) a scratch script that called the board's **own** `getFloorBoard({mode:"live"})` and then read the SO sources for exactly those rows — **262 rows**; (b) the SQL in §3, run once to validate it — **246 rows** (it approximates arm 4, see §3). Both scripts lived in the session scratchpad, outside the repo.

**What was read.** `docs/CLAUDE_FLOOR.md` in full (v1.9). `docs/CLAUDE_CORE.md` (v131 · Schema v27.58) §1–§4, §7.1, §7.1.b, §7.2, §7.3, §7.5, §7.6 and the v27.43 / v27.49 chain entries — **not every line**: the file is 308 KB and several of its lines alone exceed the reader's limit. `docs/CLAUDE_TINT.md` §9.6 and the table at :120-125. `docs/CLAUDE_MAIL_ORDERS.md` §11 (manual split). `docs/CLAUDE_UI.md`, `docs/CLAUDE_IMPORT.md` and the rest of MAIL_ORDERS were **not** read in full; the code they describe (`applyMailOrderEnrichment`, `applyNoMailOrderFallback`) was read directly instead. 
⚠ The prompt's path `docs/prompts/drafts/code-update-2026-08-31-floor-invoice-column.md` does not exist; the file is at **`docs/prompts/archive/2026-09/code-update-2026-08-31-floor-invoice-column.md`** (read in full).

---

## 0. The three findings that shape everything

1. **The mail-order SO and the master SO cannot be linked by id. Today they are two separate groups of people.** `mo_orders` has no FK to `sales_officer_master`: only free-text `soName String` and `soEmail String?` (`prisma/schema.prisma:2170-2171`). `soEmail` is **NULL on 3,029 of 3,029** mail orders in the last 30 days. The parser writes `soEmail = $null` (`docs/Parser/Parse-MailOrders-V7.ps1:2069`). Only **1 of 12** `sales_officer_master` rows has an email, and that one is the TEST row (id 19). The names do not line up either. Master has "Shivkumar Pal", "Narendra Hadiyal" and "Abhishek Aghera"; mail has "(JSW) Pal Shiv Kumar", "(JSW) Narendra Suresh Hadiyal" and "Aghera Abhi". The two lists cover mostly different people: the master's 11 real SOs serve projects and offtake, and the mail SOs serve Deco Retail. So the source has to be picked **by division**, not by "try one, then the other".
2. **The owner's split matches the data exactly.** On today's board, **0 of 79** division-74/77 bills have a mail order. The import route records the same thing as an owner statement (`app/api/import/obd/route.ts:626-631`: Projects, Offtake and Distributor "do not order by mail at all and never will"). **0 of 172** Deco Retail bills resolve an SO from customer master: 0 of 3,183 Deco Retail bills in 30 days have a PRIMARY link. So using customer master as a fallback for normal bills costs little and finds nobody today.
3. **The cascade's second source is dead, and its third source is not optional.** Live, `sales_officer_group` has **0 rows** and **0** customers have `salesOfficerGroupId` set. The "SO contact" source (source 3) is the only thing that resolves **13 of 54** division-74 and **9 of 25** division-77 bills on today's board. A Floor column that read only `customer_sales_officers` would go blank on 22 bills that the challan prints a name for. **For parity with the challan, the column has to run the whole cascade.**

---

## 1. Answers A1–E11

### A. Floor row

**A1. How `getFloorBoard()` builds a row.**
- One `prisma.orders.findMany({ where: { AND: boardTerms }, include: FLOOR_BOARD_INCLUDE })` (`lib/floor/queries.ts:853-856`). It is an **`include`, not a `select`**, so every `orders` scalar is already on the row for free. That covers `smu`, `soNumber`, `customerId`, `shipToOverrideCustomerId`, `invoiceNo`, `handAt`, etc.
- `FLOOR_BOARD_INCLUDE` (`:654-687`) contains:
  - `customer` and `shipToOverrideCustomer`, both `select: FLOOR_DEALER_SELECT` (`:333-345`: `id`, `customerName`, `isKeyCustomer`, `area{name, primaryRoute{id,name,bayNumber}, deliveryType{name}}`)
  - `dispatchWindow`
  - `querySnapshot{articleTag,totalVolume,totalWeight}`
  - `pickEarlyReleasedBy{name}`
  - `directLoadedBy{name}`
  - `tintAssignments` (splitId null, take 1, `completedAt`)
  - `pickAssignment{… articleCount, checkedBy, picker, assignedBy}`

  **Nothing SO-related is in it.**
- The awaits that follow the main read are all sequential:
  1. `dispatch_slot_master` (`:858`)
  2. `billToByObd` (`:864`)
  3. `getDuplicateSoNumbers` (`:873`)
  4. `getColourWorkByOrder` (`:879`)
  5. `trip_drops` (`:914`, skipped when there are no drops)
  6. `trips` (`:922`, skipped likewise)
  7. `skusByObd` and `oilSkusByOrder` (`:1200`, `:1219`, both skipped on subset calls)
- The row literal is built at `:956-1151`. The effective dealer is `order.shipToOverrideCustomer ?? order.customer` (`:937`). **Floor already takes the ship-to redirect into account, which is the same rule the challan uses (C7).**
- **Five callers** pay for anything added inside `getFloorBoard`:
  - `app/api/floor/board/route.ts:54`
  - `lib/floor/rows.ts:69` (`onlyIds`, the delta merge)
  - `lib/floor/load-plan-snapshot.ts:64`
  - `lib/tint/base-feed.ts:99-100`
  - `lib/trips/queries.ts:1055`

**A2. `floor-table.tsx` columns and widths.** The FLOOR §4.9 column list is **stale**: the code has moved on twice since (2026-10-06 `25a89ee2` Article tag + Article; `094506d0` ship-to block arm). What the code says:
- Cell order (`components/floor/floor-table.tsx:644-653`): ☐ (when `interactive`) · OBD · Invoice/Operator (when `hasExtra`) · Ship to (not on `shipToBlock`) · Route/Area · Due · Vol/KG · Article tag · Article · Status.
- **Five** positional width arms, each summing to 100 (`:690-698`):
  - `shipToBlock` → `[18,14,12,13,10,11,6,16]`
  - interactive + extra → `[3,13,9,13,9,11,7,11,6,18]`
  - interactive, no extra → `[3,14,17,9,12,7,12,6,20]`
  - read-only + extra → `[14,10,15,9,11,7,11,6,17]`
  - read-only, no extra → `[15,19,10,13,8,12,6,17]`
- Three lists must agree entry for entry: the colgroup (`:715-719`), the `<th>` row (`:722-768`) and the `<td>`s in `renderRow`. One condition is tested in all three places (`hasExtra`, `:681`). A new column adds **one entry to all five arms**, plus one `<th>` and one `<td>`, all in the same commit.
- Constraints already recorded in code:
  - Status (16–20) must not shrink. The 2026-09-10 measurement of "Needs check · 16m" plus the hover buttons is the reason.
  - Ship to is the agreed donor, because it ellipsises by design.
  - The duplicate-SO bar rides the **first** cell (OBD) and must stay there.
- `<FloorTable>` has **10 call sites** across `trip-desk.tsx` (4), `route-cards.tsx` (3), `route-row.tsx`, `load-plan.tsx` and `load-plan-v2.tsx`. They all share the one width matrix.

**A3. Is the division on the row?** **Yes, already, at no cost.** `orders.smu` is a scalar that the include brings. The row carries `smu` (`queries.ts:1090`) and `smuCode` (`:1085`, `SMU_CODE_BY_NAME[order.smu]`). The map is `lib/import-upsert/types.ts:243-249` (Deco Retail 70 · Decorative Projects 74 · Distributor 76 · Retail Offtake 77 · Deco 10). There is already a client-side helper, `divisionOf(row)` → `"70"|"77"|"74"|"other"` (`lib/floor/division-blocks.ts:46-48`), which the route-card division bands use. **No join to `import_raw_summary.smuCode` is needed.** `billToByObd` (`:504-516`) is one `import_raw_summary.findMany({ obdNumber in … })` and does not need to change. `orders.smu` comes from the same import (TINT :120 measured `smuCode` coverage at 926/926 on tint bills).

### B. Mail order → bill link

**B4. The link path.** It is `orders.soNumber = mo_orders.soNumber`, a plain string with no FK.
- **Enrichment's rule is "newest wins":** `mo_orders.findFirst({ where: { soNumber }, orderBy: { createdAt: "desc" } })` (`app/api/import/obd/route.ts:259-262`). `getFloorHold`'s "Auto (mail order)" lookup also keeps the first row per SO from a `createdAt desc` read (`lib/floor/queries.ts:1318-1326`). **Use the same rule.**
- **One SO → several `mo_orders`:** this happens. 36 soNumbers in the last 60 days have more than one mail order. **71 soNumbers (all time) carry more than one distinct `soName`.** Examples:
  - `1046599924` → "Surat Akzonobel" + "(JSW) Pravesh Chitre"
  - `1046505884` → "Bharat Upadhyay" + "(JSW) Nirav Jayeshbhai Tailor"
  - `1046790109` → "(JSW) Anand Tripathi" + "(JSW) Shukla Aman Dinesh"
- **Splits do not cause it.** A manual split copies `soName` and `soEmail` onto half B (`app/api/mail-orders/[id]/split/route.ts:89-92`), and **0 of 3,029** mail orders in 30 days carry a `splitLabel`.
- **One SO → several bills:** 64 soNumbers in 30 days have more than one live `orders` row. All bills on an SO get the same mail order, and so the same name. Harmless.
- On today's board: 0 bills match more than one mail order.

**B5. A real SO id on `mo_orders`?** **No.** The model has `soName String` and `soEmail String?` only (`schema.prisma:2168-2266`), with no `salesOfficerId`. The SO-login work (v27.43 `so_order_access` / `so_login_codes` / `so_sessions`, v27.49 `so_saved_drafts` / `so_live_drafts` / `so_fav_products` / `so_starred_dealers`) keys every table on `salesOfficerId`, but **none of them touches `mo_orders` or `orders`**. `/so-lab` writes no mail order: `app/so-lab/_board/so-storage.ts:15`, "NO SENT LOG. Phase E reads sent orders from mo_orders", is a plan and not code. **A real id link would have to come from a future phase, for example `/po2` → `mo_orders` carrying the logged-in SO's id. ROADMAP, owner decision.**

**B6. Does `applyMailOrderEnrichment` copy anything SO-related onto `orders`?** **No.** These are the actual writes (`route.ts:281-360`, `:385-388`): `mailMatched`, `dispatchStatus`, `priorityLevel`, `remarks` (delivery, remarks and bill remarks joined), `slotToOverride`, `dispatchTargetDate`/`dispatchWindowId`/`dispatchSlotSource`, `orderDateTime`, `slotId`/`originalSlotId`, `arrivalSlotId`. Then come the ship-to carry (`:394-407`), the CI hold (`:409-447`), the engine slot (`:510-518`), `heldAt` plus the hold log (`:526-556`), and auto-advance (`:561-603`). `soName` and `soEmail` are never read for a write. **So the column cannot read anything off `orders`; it has to look up `mo_orders` at read time.** That is better anyway: copying the name would mean adding a column and changing a write path.

### C. Customer master → bill (74/77)

**C7. The challan's cascade.** It is an **inline block, not a helper**: `resolvedSalesOfficer` at `app/api/tint/manager/challans/[orderId]/route.ts:325-357`.
- **All sources key on the SHIP-TO** (`resolvedShipTo`), never the bill-to. The ship-to is chosen in this order:
  1. a ship-to redirect `orders.shipToOverrideCustomerId` wins (`:278-288`)
  2. else `import_raw_summary.shipToCustomerId ?? orders.shipToCustomerId` by `customerCode` (`:158`, `:183-222`, `:228-267`)
- The bill-to point (`:164-181`) selects contacts only and is never used for the SO.
- The four sources, all on the ship-to:

| # | Source | Read | Notes |
|---|---|---|---|
| 1 | `salesOfficerLinks` where `role:"PRIMARY", contactDismissed:false`, take 1 → `salesOfficer{name,phone}` | `:203-209`, `:335-338` | |
| 2 | `salesOfficerGroup.salesOfficer{name,phone}` | `:197-201`, `:342-345` | **0 rows live — dead** |
| 3 | first ship-to contact with `contactRole.name === "Sales Officer"` (contacts ordered `id asc`) | `:211-219`, `:349-354` | |
| 4 | `null` | `:356` | |

- `sales_officer_master.isActive` is not filtered at any step.
- **Floor's dealer is the same customer.** `orders.customerId` is resolved at import from `shipToCustomerId` → `delivery_point_master.customerCode` (`app/api/import/obd/route.ts:1439-1440`, `:1479`), and Floor's `dealer = shipToOverrideCustomer ?? customer` (`queries.ts:937`). So `(shipToOverrideCustomerId ?? customerId)` is the challan's ship-to id. ⚠ One edge: when `orders.customerId` is null (`customerMissing`), the challan can still resolve by code and Floor would show nothing. Same on both sides in practice, because the master lookup needs the code to exist anyway.
- **Copies elsewhere:** the Tint Manager orders route fetches sources 1 and 2 on `orders.customer` (`app/api/tint/manager/orders/route.ts:187-200`, and four more sites at `:330`, `:404`, `:453`, `:520`). A grep of `components/tint` found **no render site**, only the types (`components/tint/manager/types.ts:98-99`). It is fetched, apparently not shown, and it ignores the redirect. `lib/customers/so-sync.ts` and the admin routes **write** the links.

**C8. Tables and fields (as in `schema.prisma`):**

| Table / field | Line | Notes |
|---|---|---|
| `sales_officer_master` | `:766-790` | `id`, `name`, `employeeCode`, `email String? @unique`, `phone`, `isActive` |
| `customer_sales_officers` | `:908-924` | `customerId` → `delivery_point_master` CASCADE, `salesOfficerId` → relation `"CustomerSOLinks"`, `role CustomerSalesOfficerRole @default(PRIMARY)`, `contactDismissed`. `@@unique([customerId, salesOfficerId])`, `@@index([customerId, role])`. Live partial unique `customer_sales_officers_customerId_primary_key` on `("customerId") WHERE role='PRIMARY'` (verified in `pg_indexes`). 354 rows, 352 PRIMARY |
| `sales_officer_group` | `:792-801` | `name @unique`, `salesOfficerId`. **0 rows live** |
| `delivery_point_master.salesOfficerGroupId` | `:855-856` | **0 non-null live** |
| `delivery_point_master.salesOfficerId` | `:843-844` | DEPRECATED per CORE §7.1; not in the cascade |
| `delivery_point_contacts` | `:893-906` | `deliveryPointId` (⚠ not `customerId`), `name`, `phone`, `isPrimary`, `contactRoleId` → `contact_role_master.name`, `linkedSalesOfficerId`. 1,844 rows. **No index on `deliveryPointId`** (only pk + `linkedSalesOfficerId`); the table is 336 kB, so a scan costs nothing that matters |

### D. Gaps

**D9. Bills with no mail order outside 74/77.** Today: **32 bills** (Deco Retail 21 — telephonic, or a mail order that never matched — plus Deco 6, Distributor 3, no SMU 2). The column would show **"—"** for every one of them. The customer-master cascade **could** serve as their fallback at almost no cost (same batched read, see E11), but **today it resolves 0 of 32**. Deco Retail customers have no PRIMARY links (0 of 3,183 bills in 30 days), and none of today's 32 have an SO contact. Worth wiring anyway, so the column fills in as the master is backfilled. That is an owner question.

**D10. Where the two could disagree, and which wins.**
- **74/77:** cannot disagree today, because there is no mail order to disagree with (0/79). If one ever appears, the owner's rule makes **master win**, which is the challan's name.
- **Deco Retail:** cannot disagree today, because master has nothing. If master is later backfilled for retail dealers, the mail order should win, because it names the person who actually sent *this* order.
- **Within the mail-order side itself** (the real disagreement):
  - (a) a soNumber with several mail orders under different names (71 all time). Newest wins, as enrichment does.
  - (b) **depot forwarder mailboxes recorded as the SO**: "Surat Akzonobel" 149, "Surat Depot" 44, "Surat Order" 5, which is **198 of 3,029 (6.5%)** of mail orders in 30 days. These are not people.
  - (c) spelling drift for one person: "(JSW) Ravi Patel" 156 vs "Ravi Patel" 413; "Babariya Karan" vs "(JSW) Babariya Karan Kanubhai".

  (c) needs a display normaliser. The mail-reply template already strips the prefix: `soName.replace(/^\([^)]*\)\s*/, "")` + `smartTitleCase` (`lib/mail-orders/utils.ts:925`). Reuse it rather than writing a second one. (b) is an owner decision (§4 Q2).

### E. Cost

**E11. Proposed fetch shape.** It is post-fetch enrichment inside `getFloorBoard`, written like `billToByObd`. Each read is batched once per page and keyed by `IN (...)`. There are no per-row queries, no predicate term and no write, so `floorBoardWhere` and `getFloorLiveMarkerWhere` stay untouched and the marker cannot drift (FLOOR §3/§5/§10).

| # | Read | Keyed by | Skipped when |
|---|---|---|---|
| +1 | `mo_orders.findMany({ where: { soNumber: { in } }, select: { soNumber, soName, createdAt }, orderBy: { createdAt: "desc" } })` → first per SO wins | distinct `soNumber` of rows **not** in 74/77 | the list is empty |
| +1 | `delivery_point_master.findMany({ where: { id: { in } }, select: SO_CASCADE_SELECT })`. `SO_CASCADE_SELECT` = the challan's three sources (PRIMARY link → `salesOfficer{name}`, `salesOfficerGroup.salesOfficer{name}`, contacts `orderBy id asc` with `contactRole{name}`) | distinct `shipToOverrideCustomerId ?? customerId` of rows that need master (74/77, plus fallback rows if the owner says yes) | the list is empty |

- **Added awaits: 2.** Prisma turns read 2 into several SQL statements (one per nested relation: links, link→SO, group, group→SO, contacts, contact→role, so about 6–7 statements on ~100 ids). This is the measured house rule in `lib/picking/queue.ts:537-554`. Fine here, because it is **one** id list, not two include chains. An alternative, three flat reads (`customer_sales_officers`, then `delivery_point_contacts` only for ids still unresolved, skipping the dead group), costs **3** awaits but fewer statements. Pick one when building; parity is better served by sharing one select with the challan.
- **Do NOT** add `salesOfficerLinks` / `salesOfficerGroup` / `contacts` to `FLOOR_DEALER_SELECT`. It is used twice in `FLOOR_BOARD_INCLUDE` (customer + override), so that would run every chain twice for every row, including the ~170 Deco Retail rows that need none of it.
- 🔴 **Index gap, Disk-IO relevant.** `mo_orders` has **no index on `"soNumber"`**. The only one is the partial `mo_orders_billOnly_soNumber_idx … WHERE "billOnlyAt" IS NOT NULL` (verified in `pg_indexes`). `mo_orders` is **15,404 rows / 14 MB**. Read 1 would sequentially scan it on **every board load**: the 30 s whole-desk refetch × every open desk, plus the 4 other callers. Enrichment (`route.ts:259`) and `getFloorHold` (`queries.ts:1318`) already make the same unindexed lookup, but far less often. **Recommend a plain `mo_orders_soNumber_idx ON mo_orders ("soNumber")` via Smart Flow (`CREATE INDEX CONCURRENTLY`) before this ships.** That is a schema change, so it is the owner's call and goes through the Supabase SQL Editor plus a model comment.
- No new polling. The column rides the existing 30 s refetch and 15 s marker. ⚠ An SO-name change (a re-punched mail order, or a master edit) does not bump `orders.updatedAt`, so the marker will not fire for it. It appears on the next 30 s refetch. Acceptable; do not add a write to make it immediate (FLOOR §10).
- Callers: `lib/floor/rows.ts:69` (`onlyIds` delta merge) **must** carry the field, or a merged row loses its SO. Gate the two reads behind a new opt (e.g. `withSalesOfficer`, default true) only if the tint base-feed, load-plan snapshot or trips caller turns out not to want them. They are cheap either way.

---

## 2. Bill type → SO source

| Bill type (`orders.smu` → `divisionOf`) | Today on board (262) | SO source | Link key | Fallback |
|---|---|---|---|---|
| **70 Deco Retail**, mail-matched | 151 | `mo_orders.soName` (newest `createdAt` per SO), display-normalised | `orders.soNumber = mo_orders.soNumber` | master cascade (resolves 0 today) → "—" |
| **70 Deco Retail**, no mail order (telephonic / unmatched) | 21 | — | — | master cascade (0 today) → "—" |
| **74 Decorative Projects** | 54 | Challan cascade: PRIMARY link → SO group → ship-to "Sales Officer" contact | `shipToOverrideCustomerId ?? customerId` → `delivery_point_master.id` | "—" (7 bills today) |
| **77 Retail Offtake** | 25 | Same challan cascade | same | "—" (1 bill today) |
| **76 Distributor / 10 Deco / no SMU** | 11 | — (no mail, no master today) | — | master cascade if wired → "—" |

Measured coverage today (getFloorBoard method): 74 → PRIMARY 34 · contact-only 13 · neither 7. 77 → PRIMARY 15 · contact-only 9 · neither 1. 70 → mail 151 · neither 21. Others → neither 11. Group source: 0 everywhere.

---

## 3. Owner SQL — live coverage (read-only)

⚠ **An approximation of `floorBoardWhere`.** It omits the hide **rules** (only `isHidden` is applied), and arm 4 counts only trips dated today, not carried open drafts. Validated against production 2026-10-06: **246 rows** vs the real board's **262**, with the same proportions (70: 142 mail / 19 neither · 74: 45 master / 7 neither · 77: 23 master / 0 neither · other: 10 neither). `pick_assignments` columns are snake_case (`order_id`, `checked_at`) — CORE v27.58.

```sql
-- READ-ONLY. SELECT only. Sales Officer coverage on today's live /floor board, by division.
WITH rng AS (
  SELECT d,
         (d::timestamp       AT TIME ZONE 'Asia/Kolkata') AS s,
         ((d + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS e
  FROM (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS d) x
),
board AS (                     -- ≈ floorBoardWhere (lib/floor/queries.ts), 4 arms
  SELECT o.id, o.smu, o."soNumber",
         COALESCE(o."shipToOverrideCustomerId", o."customerId") AS cust
  FROM orders o
  LEFT JOIN pick_assignments pa ON pa.order_id = o.id
  CROSS JOIN rng
  WHERE o."isRemoved" = false
    AND o."isHidden"  = false  -- hide RULES (obd_visibility_rules) not applied: approximation
    AND (
      -- arm 1: open, or checked / direct-loaded today
      (o."dispatchStatus" = 'dispatch' AND (
          o."workflowStage" IN ('pending_picking','pick_assigned','pick_done')
       OR (o."workflowStage" = 'pick_checked' AND (
             (pa.checked_at   >= rng.s AND pa.checked_at   < rng.e)
          OR (o."directLoadedAt" >= rng.s AND o."directLoadedAt" < rng.e)))))
      -- arm 2: no dispatch decision
   OR (o."dispatchStatus" IS NULL AND o."workflowStage" IN
         ('order_created','pending_tint_assignment','tint_assigned','tinting_in_progress','pending_support'))
      -- arm 3: checked, on no truck
   OR (o."dispatchStatus" = 'dispatch' AND o."workflowStage" = 'pick_checked' AND o."tripDropId" IS NULL)
      -- arm 4 (approx): on a non-cancelled trip dated today; carried open drafts not counted
   OR (o."dispatchStatus" = 'dispatch' AND o."tripDropId" IS NOT NULL AND EXISTS (
         SELECT 1 FROM trip_drops td JOIN trips t ON t.id = td."tripId"
         WHERE td.id = o."tripDropId" AND t.status <> 'cancelled' AND t."tripDate" = rng.d))
    )
),
c AS (
  SELECT b.id,
    CASE b.smu WHEN 'Deco Retail' THEN '70' WHEN 'Decorative Projects' THEN '74'
               WHEN 'Retail Offtake' THEN '77' ELSE 'other' END AS div,
    EXISTS (SELECT 1 FROM mo_orders m WHERE m."soNumber" = b."soNumber") AS via_mo,
    EXISTS (SELECT 1 FROM customer_sales_officers so
            WHERE so."customerId" = b.cust AND so.role = 'PRIMARY' AND so."contactDismissed" = false) AS m_primary,
    EXISTS (SELECT 1 FROM delivery_point_master d JOIN sales_officer_group g ON g.id = d."salesOfficerGroupId"
            WHERE d.id = b.cust) AS m_group,
    EXISTS (SELECT 1 FROM delivery_point_contacts k JOIN contact_role_master r ON r.id = k."contactRoleId"
            WHERE k."deliveryPointId" = b.cust AND r.name = 'Sales Officer') AS m_contact
  FROM board b
)
SELECT div::text AS division, '1 bills'::text AS metric, count(*)::text AS n FROM c GROUP BY div
UNION ALL SELECT div, '2 via mail order (soName)',            count(*) FILTER (WHERE via_mo)::text FROM c GROUP BY div
UNION ALL SELECT div, '3 via master only (no mail order)',    count(*) FILTER (WHERE NOT via_mo AND (m_primary OR m_group OR m_contact))::text FROM c GROUP BY div
UNION ALL SELECT div, '4 via neither',                        count(*) FILTER (WHERE NOT via_mo AND NOT (m_primary OR m_group OR m_contact))::text FROM c GROUP BY div
UNION ALL SELECT div, '5 both mail order AND master',         count(*) FILTER (WHERE via_mo AND (m_primary OR m_group OR m_contact))::text FROM c GROUP BY div
UNION ALL SELECT div, '6 master src: PRIMARY link',           count(*) FILTER (WHERE m_primary)::text FROM c GROUP BY div
UNION ALL SELECT div, '7 master src: SO group (no PRIMARY)',  count(*) FILTER (WHERE NOT m_primary AND m_group)::text FROM c GROUP BY div
UNION ALL SELECT div, '8 master src: SO contact only',        count(*) FILTER (WHERE NOT m_primary AND NOT m_group AND m_contact)::text FROM c GROUP BY div
ORDER BY 1, 2;
```

---

## 4. Proposed build plan (files, no code) and open owner questions

**Build plan:**

0. **(Owner / Smart Flow, before shipping)** `CREATE INDEX CONCURRENTLY mo_orders_soNumber_idx ON mo_orders ("soNumber");` plus a comment on the `mo_orders` model in `prisma/schema.prisma`, plus a CORE §7.6 / chain entry. Read-only verify block afterwards.
1. **NEW `lib/customers/sales-officer.ts`.** Exports `SO_CASCADE_SELECT` (the three-source select) and a pure `resolveSalesOfficer(point)` → `{ name, phone } | null` in the challan's locked order. The pure normaliser `displaySoName(soName)` reuses the `(JSW)`-strip + `smartTitleCase` rule from `lib/mail-orders/utils.ts:925`; move that rule there or import it, but do not copy it.
2. **`app/api/tint/manager/challans/[orderId]/route.ts`** — replace the inline `resolvedSalesOfficer` block (`:325-357`) and the SO parts of the three ship-to selects (`:197-209`, `:242-254`, `SHIP_TO_POINT_SELECT :477-488`) with the shared select and resolver. Behaviour must be byte-identical, so the challan and Floor can never print two names for one bill. *(Optional; skip it if the owner wants this change to touch Floor only, and note the duplication instead.)*
3. **`lib/floor/types.ts`** — `FloorBoardRow` gains `salesOfficerName: string | null` and `salesOfficerSource: "mail" | "master" | null` (the source is for a tooltip and for auditing).
4. **`lib/floor/queries.ts`** — a new exported batched helper `salesOfficerByOrder(orders)` next to `billToByObd`, doing the two reads from E11 with the division rule (74/77 → master; otherwise mail, then the master fallback if the owner approves). Called once in `getFloorBoard` after `billToByObd` (`:864`) and mapped in the row literal. No predicate, marker or `FLOOR_BOARD_INCLUDE` change.
5. **`components/floor/floor-table.tsx`** — one `<th>`, one `<td>`, and **one entry in all five width arms** (`:690-698`). Ship to is the donor in arms that have one; the `shipToBlock` arm needs its own donor (Article tag or Area). Status is not touched. Update the cell-order comment (`:644-660`). Blank cell: render "—" or empty (Q4).
6. **(If wanted)** `lib/floor/search.ts` matches the SO name. Detail panel (`app/api/floor/order/[orderId]/route.ts` + `detail-details.tsx`) shows the SO with the phone.
7. **Docs:** a `code-update-*` draft → FLOOR §4.9 (and fix its stale column list), §3 (the new post-fetch reads), §10 (landmines: division rule, no id link, index); TINT §9.6 (source 2 is 0 rows live; the shared helper); CORE §7.6 (index), §15 (`lib/customers/sales-officer.ts`).
8. `tsc --noEmit`; a scratch check that board row count and order are unchanged; live eyeball at depot width.

**Open owner questions:**

1. **Fallback for normal bills.** For a Deco Retail or other bill with no mail order, should the column also try customer master? It is free to wire, but resolves **0 of 32** today, so it would only start to help once retail dealers get PRIMARY links.
2. **Mailbox "SOs".** 6.5% of mail orders name "Surat Akzonobel" / "Surat Depot" / "Surat Order" as the SO. Show as-is, show blank, or prefer an older real-name mail order on the same SO when the newest is a mailbox?
3. **Name display.** Strip "(JSW) " and title-case (the reply-template rule) so that "(JSW) Ravi Patel" and "Ravi Patel" read the same? Full name or first name only, given the column width?
4. **Placement and blank.** Where in the cell order (suggest after Ship to, since the two describe whose bill it is)? "—" or empty when unresolved? (Invoice is deliberately empty-when-blank; an SO that *should* exist suggests "—".)
5. **Scope.** Floor table only, or also the Hold tab (`HoldTable`, shared with Freight Trips; FLOOR §4.10 says do not edit it for one caller), the detail panel, and search?
6. **Challan refactor (plan step 2).** Share one resolver now, or ship Floor-only and record the duplication?
7. **Index.** Approve `mo_orders_soNumber_idx` (plan step 0)?
8. **ROADMAP.** A real SO id on `mo_orders` (from `/po2` / `/so-lab` phase E, or by matching `soName` to `sales_officer_master`) would replace the free-text join. Park it?

---

## 5. Doc drift found (fix while merging; code wins)

- **FLOOR §4.9** column list ("☐ · OBD · Invoice|Operator · Ship to · Route · Due · Vol / KG · Article · Status") is stale. The code has Article tag + Article (`25a89ee2`) and a fifth `shipToBlock` width arm (`094506d0`). See A2.
- **TINT §9.6** says the SO-group source is "still used for customers not yet migrated". Live: `sales_officer_group` has 0 rows and 0 customers have `salesOfficerGroupId`. CORE §7.1 ("classification-tag only, no longer drives SO") is closer, but the challan still reads it as source 2.
- **TINT §9.6** lists ship-to `SITE_ROLES` as Site Engineer / Contractor / Supervisor; the code has `"Receiver"` first (`challans/[orderId]/route.ts:316`, 2026-10-02). It also omits the redirect-wins rule (`:269-288`, 2026-10-01).
- **Tint Manager orders route** fetches PRIMARY link + group on five includes (`app/api/tint/manager/orders/route.ts:187-200` et al.) with no render site found by grep. Possibly dead payload; verify before calling it that.
- The invoice-column note referenced by this prompt moved to `docs/prompts/archive/2026-09/`.
- `mo_orders.soEmail` is a column that is never written (parser `$null`, `Parse-MailOrders-V7.ps1:2069`; 0/3,029 in 30 days). Worth a line in MAIL_ORDERS so nobody plans an email-based join.

*Draft written 2026-10-06 · diagnosis only · target on build: `CLAUDE_FLOOR.md` (+ TINT §9.6, CORE §7.6)*
