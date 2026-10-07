# code-update-2026-10-07 — Challan Orders slice 3: Place Order challan mode + create route (gapless ORB)

**Status:** BUILT. `tsc --noEmit` clean · `npm run build` clean — 406 route-table entries (was 405), 84/84 static
pages, `ƒ /api/place-order/challan-orders` in the table. **No ORB order was created** — no test POST against live.
Spec: `code-plan-2026-10-07-challan-slice3.md` rev 1 + web-update §4c (S3-1…S3-7, S3-4 Option B, out-of-order
reuse accepted). Schema unchanged (v27.60) — no DDL, no grants, no SQL.

## 1. What shipped

- **Gate** — `place_order_challan` registered with its first reader (the `place_order_ship_to` precedent):
  `ALL_PAGE_KEYS`, `ACTION_PAGES.canEdit`, `ACCESS_SECTIONS` "Operations" (after `place_order_ship_to`), and the
  rollback editor row. Resolved once in `app/(place-order)/layout.tsx` → `PlaceOrderAccessProvider.canCreateChallan`.
  **No grants** — only admin / superuser see the switch until slice 9. `challan_orders` stays unregistered.
- **Challan mode switch** (desktop `/place-order` only) — mockup rev 1 states 1–6:
  OFF = the page as before. Turning ON with 2+ bills → red line *"Challan order needs a single bill — remove the
  extra bills first."*, switch stays OFF. ON = no Bill bar, ship-to **Same as billing / Another dealer** (dealer
  picked from the customer list), Dispatch **Normal / Urgent** (a stored Call becomes Normal on switching in),
  footer button **"Create challan order"** in place of Send Email (one brand button, grey when the cart is empty).
- **Confirm dialog** (`challan-confirm-overlay.tsx`, UI §13 — `bg-black/40`, gray-900 confirm, Enter / Esc) →
  busy lock ("Creating…", keys and buttons dead) → error shown inside the dialog, or on success the toast
  **"ORB-2026-00001 created — sent to picking"**, the draft clears and the cart resets; the switch stays ON.
- **Server** `POST /api/place-order/challan-orders` (thin, `force-dynamic`, `maxDuration 60`) →
  `lib/challan-orders/create.ts`. Checks before ANY write: session; `place_order` canView + `place_order_challan`
  canEdit (403); `CALL_NOT_ALLOWED`; ship-to mode same|dealer; bill-to and dealer are **active**
  `delivery_point_master` rows; ≥ 1 line; tins whole 1–10,000; every line's product an active
  `mo_order_form_index_v2` row and its material an `isPrimary` `mo_sku_lookup_v2` row matching
  product/base/packCode/unit (natural key, CORE §13) and present in `sku_master_v2` (`UNRESOLVED_LINE`, 422).
- **Guard** — `/api/admin/removed-orders` never lists a challan order or a dark challan staging row
  (NULL-safe on `removalReason`, CORE §13); its Restore refuses them (409).

## 2. Option B — the write sequence as built (`lib/challan-orders/create.ts`)

Sequential awaits only, no `$transaction`, no hard delete. `TMP` = `CO-TMP-<uuid>`.

| # | Write | Notes |
|---|---|---|
| 0 | `releaseStaleClaims(now)` | dark CLAIMED rows (`isChallanOrder`, `isRemoved`, `removalReason = CHALLAN_STAGING`) created > 10 min ago are moved to `CO-DEAD-<id>` with their children re-keyed by id — the number is free again |
| 1 | `import_batches.create` | `batchRef = TMP`, `headerFile [challan-order] <bill-to code>`, `processing`, importedBy = session user |
| 2 | `orders.create` DARK | `obdNumber TMP`, `isChallanOrder false`, `isRemoved true`, `removalReason CHALLAN_STAGING`, `customerId` = bill-to, `shipToCustomerId/Name` = bill-to, `shipToOverride(+CustomerId)` = dealer when chosen, `non_tint`, `pending_picking`, `dispatch`, legacy slot + arrival slot + engine slot, `priorityLevel` (Urgent or key dealer/site → 1), `remarks`, `smu` (dealer's latest bill), totals |
| 3 | `import_raw_summary.create` | bill-to + effective ship-to, smu, IST date/time, totals |
| 4 | `import_raw_line_items.createMany` | lineId 10, 20…, SAP material + `sku_master_v2.description`, tins, litres, `isTinting false`, article/articleTag; **count checked** |
| 5 | `import_obd_query_summary.create` | totals, `hasTinting false`, SKU-grouped article roll-up |
| 6 | **CLAIM** `orders.update` | `obdNumber` = **lowest free** `ORB-{IST year}-NNNNN` (every ORB number of the year, dark or visible, counts as taken) + `isChallanOrder true` in one write. P2002 on `obdNumber` → re-read, retry ONCE → else 409 `NUMBER_BUSY`, nothing claimed |
| 7 | re-key children **by row id** | raw summary (by id), raw lines (`rawSummaryId`), query summary (`orderId`) |
| 8 | `orders.update` | `isRemoved false`, `removalReason null` — the ONE write that makes it visible |
| 9 | `order_status_logs.create` | null → `pending_picking`, session user, `Created as challan order ORB-… (Place Order)` |
| 10 | `import_batches.update` | `completed`, `headerFile [challan-order] ORB-… · <code>` |

**Failures:** before 6 → nothing holds a number; batch `failed`; dark rows stay under `TMP`, invisible. 6–8 → the
catch gives the number back at once (`releaseClaim`); if that also fails, write 0 of the next create frees it after
10 min. 9–10 → the bill is live and stays live; the error is logged (a missing log is not a missing bill).

## 3. Files

New: `app/api/place-order/challan-orders/route.ts` · `lib/challan-orders/create.ts` · `lib/challan-orders/number.ts`
· `lib/challan-orders/types.ts` · `app/(place-order)/place-order/components/challan-confirm-overlay.tsx` · this file.
Edited: `lib/challan-orders/orb-number.ts` (+`formatOrbNumber`, `orbYearPrefix`) · `lib/permissions.ts` ·
`components/admin/permissions-manager.tsx` · `app/(place-order)/layout.tsx` ·
`components/place-order/place-order-access-provider.tsx` · `app/(place-order)/place-order/place-order-page.tsx` ·
`app/(place-order)/place-order/components/cart-panel.tsx` · `lib/place-order/email.ts` (remark text lifted into
`orderRemarkText`, used by `buildEmail` unchanged and by the create — one owner) ·
`app/api/admin/removed-orders/route.ts` · `app/api/admin/removed-orders/[id]/restore/route.ts`.

## 4. Differs from the plan

1. **`batchRef` is NOT re-keyed to the ORB number** (plan §1.2 write 7). It stays `TMP`; the ORB number goes into
   `headerFile` at completion. Re-keying it would put a second unique index on the number and a second thing for
   `releaseClaim` to undo — the number already lives on the order, where the lock is.
2. **Challan mode is not saved in the draft** (plan §8). A reload or a customer change returns to OFF, so a
   restored multi-bill draft can never land in challan mode.
3. **The engine's delivery type is the EFFECTIVE delivery point's** (the chosen dealer, else the bill-to) — the
   import's `customer` is SAP's ship-to party, which is what the truck actually serves.
4. **`resolveSlot` is copied** into `create.ts` as `legacySlot` (a route file cannot export it; the import route
   was not edited). Comment points at `route.ts:153`.
5. Dark staging rows that failed BEFORE the claim keep `CO-TMP-…` (never `CO-DEAD-…`) — they never held a number.

Read-only checks run (no writes): next number on live data = `ORB-2026-00001`; all **1,354** rendered grid cells'
materials pass the server's natural-key re-check (0 failures).

## 5. HAND-TEST LIST (owner, signed in as admin / superuser — the only people with the switch)

⚠ Every created challan order is REAL: it goes to the picking supervisor. Use a test dealer, then Floor-cancel it.

1. **Switch hidden without the tick.** Sign in as a non-admin Place Order user → `/place-order`, pick a customer.
   *Expect:* no "Challan order" row in the cart; the page is exactly as before; Send Email works as before.
2. **OFF is untouched.** As admin, pick a customer, add a line, add Bill 2. *Expect:* Bill tabs, Ship-to box,
   Normal / Urgent / Call, Send Email — all as today.
3. **Refusal.** With 2 bills, click the switch. *Expect:* red line "Challan order needs a single bill — remove the
   extra bills first."; switch stays OFF. Delete Bill 2 → the red line disappears.
4. **Switch ON.** One bill → click the switch. *Expect:* lilac row with CHALLAN chip; no Bill tabs; Ship to shows
   "Same as billing / Another dealer" with the dealer's name, code, area; Dispatch shows Normal and Urgent only (if
   Call was picked it is now Normal); footer reads "Total · Challan order" and the brand button reads
   "Create challan order". Empty the cart → the button is grey.
5. **Another dealer.** Click "Another dealer", type 4+ letters of a dealer → pick one. *Expect:* the dealer card
   with an × to change it; Create is grey until a dealer is picked.
6. **Confirm.** Click Create challan order. *Expect:* "Send goods WITHOUT a bill?" dialog, amber band, Bill to /
   Ship to / Dispatch / Goods rows. Esc closes it; nothing created.
7. **Create.** Open it again, press Enter once. *Expect:* "Creating…", then the toast "ORB-2026-00001 created — sent
   to picking"; cart empty; switch still ON.
8. **Picking.** `/picking` Assign tab. *Expect:* the ORB order waiting, with the dealer, litres and its lines.
9. **Floor.** `/floor`. *Expect:* the ORB order on the board under the right route / dealer (the chosen dealer when
   "Another dealer" was used); it is NOT on Billing's Picking or Print tabs. Search box: type `ORB-2026-00001` →
   it is found.
10. **Clean up.** Floor → the bill → ⋯ → Cancel (while it is not on a trip).

**Verify the created rows (read-only — Smart Flow / SQL Editor; replace the ORB number):**
```sql
SELECT 'order'::text AS what, o.id::text AS id, o."obdNumber"::text AS num, o."isChallanOrder"::text AS a,
       o."workflowStage"::text AS b, o."dispatchStatus"::text AS c, o."orderType"::text AS d,
       o."isRemoved"::text AS e, o."customerId"::text AS f, o."shipToOverrideCustomerId"::text AS g,
       o."priorityLevel"::text AS h, coalesce(o.smu,'(null)')::text AS i, coalesce(o.remarks,'(null)')::text AS j
  FROM orders o WHERE o."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'raw summary', s.id::text, s."obdNumber"::text, s."billToCustomerId"::text, s."shipToCustomerId"::text,
       s."totalUnitQty"::text, s.volume::text, s."rowStatus"::text, s."batchId"::text, '', '', '', ''
  FROM import_raw_summary s WHERE s."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'raw line', l.id::text, l."obdNumber"::text, l."lineId"::text, l."skuCodeRaw"::text, l."unitQty"::text,
       coalesce(l."volumeLine",0)::text, l."isTinting"::text, coalesce(l."articleTag",'(null)')::text, l."lineStatus"::text, '', '', ''
  FROM import_raw_line_items l WHERE l."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'query summary', q.id::text, q."obdNumber"::text, q."orderId"::text, q."totalLines"::text,
       q."totalUnitQty"::text, q."totalVolume"::text, q."hasTinting"::text, coalesce(q."articleTag",'(null)')::text, '', '', '', ''
  FROM import_obd_query_summary q WHERE q."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'status log', g.id::text, g."toStage"::text, coalesce(g."fromStage",'(null)')::text, g."changedById"::text,
       g.note::text, '', '', '', '', '', '', ''
  FROM order_status_logs g JOIN orders o ON o.id = g."orderId" WHERE o."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'batch', b.id::text, b."batchRef"::text, b.status::text, b."headerFile"::text, b."totalObds"::text,
       '', '', '', '', '', '', ''
  FROM import_batches b JOIN orders o ON o."batchId" = b.id WHERE o."obdNumber" = 'ORB-2026-00001'
UNION ALL
SELECT 'dark rows left', count(*)::text, '', '', '', '', '', '', '', '', '', '', ''
  FROM orders WHERE "removalReason" = 'challan order — being created';
```
*Expect:* order — `true`, `pending_picking`, `dispatch`, `non_tint`, `false`, the bill-to id, the dealer id or
null, 1 or 3, an SMU or `(null)`; one raw summary and one line per pack, every line `isTinting false`, `active`;
one query summary (`hasTinting false`); one status log `null → pending_picking` by you; batch `completed`; **dark
rows left = 0**.
