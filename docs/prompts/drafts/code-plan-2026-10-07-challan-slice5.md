# code-plan-2026-10-07 — Challan Orders slice 5: the shared "Challan orders" screen

**Status:** PLAN ONLY. No code, no DDL. Read-only SELECTs against production, 2026-10-07. Not committed.
Builds on slices 1–4 (live: `e9143c1f` … `4770969f`). Design: web-update-2026-10-06-challan-orders.md D8, D8b,
D11, F1b, F3, F4, F5, M5, M6, M7, §4c. Targets: `docs/mockups/challan-orders/billing-challan-orders.html` +
`view-only.html` (v2, `b4f2d7f0`).

**What was read.** In full: the design draft, slice-1 plan + DDL file (link table, CHECKs, partial unique, live
triggers), slice-3 and slice-4 update notes, both mockups (body text), `components/billing/billing-tab-bar.tsx`,
`billing-telephonic-access-provider.tsx`, `lib/billing/telephonic.ts` add / remove / marker,
`app/api/billing/telephonic/marker/route.ts`, `lib/billing/telephonic-so.ts` (SO rule), the `challan_order_so_links`
and `orders` Prisma models, `lib/live/use-live-feed.ts` (options) and `/api/live/changes` (gate). **NOT read end to
end:** `CLAUDE.md` (router, read earlier this session), `CLAUDE_CORE.md`, `CLAUDE_UI.md`, `CLAUDE_BILLING.md`,
`CLAUDE_FLOOR.md`, `CLAUDE_PLACE_ORDER.md`, `CLAUDE_FLOOR_TRIPS.md`, `billing-telephonic-tab.tsx` (843 lines — its
access/marker pattern only), `floor-page.tsx` (its `TopTab` + `tabPill` only), `mail-orders-page.tsx` /
`review-view.tsx` (the tab-routing lines only), the Place Order top bar (read in full in slice 3). Sections used
are cited where they matter.

**Live (read-only, 2026-10-07):** 1 ORB order (cancelled) · 0 link rows · `upa` canView: mail_orders 7,
floor 8, place_order 12, billing_telephonic 5.

---

## 1. DATA — one loader

New `lib/challan-orders/queries.ts`. **One read** for the three working tabs, **one paged read** for History.

### 1.1 The working read (`loadChallanBoard(now)`)

```ts
prisma.orders.findMany({
  where: { isChallanOrder: true, isRemoved: false },          // dark staging rows (slice 3) are isRemoved → never shown
  include: {
    customer:               { select: { customerCode, customerName, area: { select: { name } } } },   // bill-to
    shipToOverrideCustomer: { select: { customerCode, customerName, area: { select: { name } } } },   // ship-to dealer
    querySnapshot:          { select: { totalUnitQty, totalVolume } },                                 // tins, L
    tripDrop:               { select: { trip: { select: { tripNumber, tripDate, status } } } },
    challanSoLinks: {
      where:   { status: { in: ["waiting", "linked"] } },     // 'unlinked' rows are history only (status NOT NULL — no null arm)
      orderBy: { linkedAt: "asc" },
      select:  { id, soNumber, status, linkedAt, obdLinkedAt, linkedBy: { select: { name } },
                 linkedOrder: { select: { obdNumber, invoiceNo, totalUnitQty } } },
    },
  },
  orderBy: { createdAt: "asc" },
})
```
Then filtered in memory (the set is tiny — a few challans a day; F3 ageing caps "Not billed" in practice). Per row:
`live = challanSoLinks` (already waiting|linked only), `waiting = live.filter(status='waiting')`,
`linked = live.filter(status='linked')`, `cancelled = workflowStage === 'cancelled'`.

| Tab | Filter | Order |
|---|---|---|
| **Not billed** | `!cancelled && live.length === 0` (incl. still in picking — the mockup's ORB-…10 "In picking") | oldest **age anchor** first |
| **Waiting for OBD** | `!cancelled && waiting.length > 0` — M6: a part-billed challan (1 linked + 1 waiting) stays here | oldest paste first |
| **Billed (7 days)** | `!cancelled && live.length > 0 && waiting.length === 0` AND `max(obdLinkedAt) ≥ IST today − 6 days` (`getISTDayRange`) | newest billed first |
| **History** | §1.2 | newest created first |

⚠ **Cancelled ORB orders are in History only** — the `!cancelled` term above. A cancelled ORB with a still-`waiting`
link is a real case (F4 allows cancel before pick done) — see §7 R2.

**Age anchor (M7, F3):** the trip's `tripDate` when the row is on a trip whose `status <> 'cancelled'`
(`trip_drops.tripId` → `trips`); else `orders.createdAt`. Days = IST calendar days between anchor and today
(`tripDate` is `@db.Date` — UTC getters, as `lib/trips/number.ts` warns; `createdAt` → IST day). Chip: neutral
`< 3`, amber `3–6`, red `≥ 7` (`lib/challan-orders/age.ts`, pure, one owner — Floor/Billing/Place Order read the
same number). "Sent on" column = trip number + trip date; else "In picking · created DD Mon HH:mm".

**Counts for the pills:** the three working tabs' lengths from the same read (no second query). The Billing /
Floor tab pill shows **Not billed** (work outstanding — the Billing tab-bar rule "count = work, not rows").
History has no count.

**NULL handling (CORE §13):** `isChallanOrder`, `isRemoved`, `workflowStage`, link `status` are all NOT NULL —
plain equality, no null arm. `shipToOverrideCustomer` / `tripDrop` / `querySnapshot` / `linkedOrder` are optional
relations — null-checked in the mapper (no ship-to override = "Same as billing"; no snapshot = tins "—").

### 1.2 History (`loadChallanHistory({ from, to, q, page })`)

`orders WHERE isChallanOrder AND isRemoved = false AND createdAt ∈ [from, to)` (IST day range, default last 30
days), **all** link rows (incl. `unlinked`, shown struck through), same includes, `orderBy createdAt desc`,
`take 50, skip (page-1)*50`, plus `count()` for the pager. Search `q` (trimmed, ≥ 3 chars):
`OR [ { obdNumber: { contains: q, mode: insensitive } }, { customer: { customerName contains } },
{ customer: { customerCode: q } }, { challanSoLinks: { some: { soNumber: { contains: q } } } } ]`.
Status chip, first match wins: **Cancelled** (`workflowStage = 'cancelled'`) · **Billed ✅/⚠** (live links, none
waiting — Match shows "—" until slice 7) · **Waiting** (any waiting) · **Sent** (on a non-cancelled trip, or stage
`dispatched`) · **In picking**.

---

## 2. PASTE SO — insert a `waiting` link

`POST /api/challan-orders/links` → `lib/challan-orders/links.ts` `pasteSo({ orbOrderId, soNumber, userId, now })`.
Body `{ orbOrderId: number, soNumber: string }`. Checks, in order, nothing written before all pass:

1. session; `challan_orders` **canEdit** (403).
2. `normaliseSoNumber` (`lib/billing/telephonic-so.ts` — the same 10-digit rule as the live CHECK
   `chk_challan_order_so_links_so_shape`) → 400 "SO must be 10 digits". ⚠ The mockups show 7-digit SOs — the code
   follows the CHECK.
3. ORB order: exists, `isChallanOrder`, `isRemoved = false`, `workflowStage <> 'cancelled'` → else 404 / 409
   "ORB-… is cancelled — nothing to link".
4. **F5 one SO → one ORB (non-unlinked):** read `challan_order_so_links WHERE soNumber AND status <> 'unlinked'`;
   if found → 409 **"SO 1234567890 already linked to ORB-2026-00007."** (same ORB → "already on this challan").
   The live partial unique `challan_order_so_links_soNumber_live_key` is the real lock: a P2002 on insert (a race) is
   re-read and mapped to the same message (the Telephonic `addTelephonicTags` pattern, `lib/billing/telephonic.ts`).
5. **Late paste (§3):** `orders WHERE soNumber AND isRemoved = false AND isChallanOrder = false` exists → refuse.
6. **Dealer guard (F1b) — what CAN be checked at paste:**
   - An imported OBD with that SO → its bill-to (`import_raw_summary.billToCustomerId`) vs the ORB bill-to code. But
     step 5 already refuses every such paste, so in slice 5 this never decides anything; it lands in slice 6 (§3).
   - **A mail order with that SO** (`mo_orders.soNumber`, newest; `customerCode` not null) → compare with the ORB
     bill-to code; differ → 409 **"SO … is for {mo customer}, challan ORB-… is for {bill-to}."** Live evidence
     (90 days, SO pairs with both a mail order and an imported OBD): mail-order code = SAP bill-to on **6,943**,
     differs on **116** (1.6%), mail-order code null on 86. So it is a good signal, not a certainty — see Q2.
   - **No mail order and no OBD** (the normal challan case — billing punched SAP directly): the SO's customer is
     UNKNOWN at paste. Nothing is checked; the import check in slice 6 (SAP bill-to vs ORB bill-to, at link time) is
     the real guard. The UI says nothing extra — no fake check.
7. Insert `{ orbOrderId, soNumber, status: 'waiting', linkedById: userId, linkedAt: now }` (the DDL's
   `chk_challan_order_so_links_shape` requires `linkedOrderId`/`obdLinkedAt`/`unlinked*` null — the defaults).
   One row. The link table's `live_changes` triggers (v27.60, parent = `orbOrderId`) announce it.

Response `{ ok: true, link }` / `{ ok: false, code, error }`. Several SOs per challan (F5 part-billing) = several
pastes, one row each.

---

## 3. LATE PASTE (the SO's OBD is already imported)

**Recommendation: REFUSE in slice 5** — 409 *"SO … already has OBD 9109… in Orbit ({stage}). Linking it now could
ship the goods twice — tell the floor supervisor; this is handled once the import safety net is live."*

Why refuse rather than insert `waiting`: slice 6's import catch runs only on NEW OBDs at import. An OBD that is
already in Orbit would never be revisited, so a `waiting` row would sit forever while that OBD is picked and
loaded — exactly the double dispatch D11 exists to stop, with nothing on screen saying so. Refusing writes nothing
and loses nothing: slice 6 replaces this refusal with D11's pull-back / refuse-and-warn.

⚠ **The bigger gap is the opposite order, and refusing cannot close it:** a paste made BEFORE the OBD is imported
is correct per D10 — but until slice 6 ships, the import does not check the link table, so that OBD is released to
picking like any other bill and the goods ship twice. **Slice 5 must not be used for real pastes before slice 6 is
live.** Options in Q1.

---

## 4. UNLINK (M5)

`POST /api/challan-orders/links/[id]/unlink` → `unlinkSo({ id, userId, now })`. Checks: session; `challan_orders`
**canEdit**; the row exists; `status = 'waiting'` (only while waiting — a `linked` row is refused 409
"SO … already has its OBD — it cannot be unlinked here"). Write — a guarded `updateMany` so a row that turned
`linked` between read and write is not touched (the `removeTelephonicTag` pattern):
`updateMany({ where: { id, status: 'waiting' }, data: { status: 'unlinked', unlinkedById: userId, unlinkedAt: now } })`;
`count 0` → re-read and answer "already unlinked" / "already linked". The partial unique then frees the SO for a
correct re-paste. Idempotent; no row deleted.

---

## 5. MOUNTS + ACCESS

**One component** `components/challan-orders/challan-orders-screen.tsx` — `{ canEdit: boolean; mount: "billing" |
"floor" | "place_order"; onBack?: () => void }`. It owns its four inner tabs (grey segmented switch, UI §… the
Billing pill row is NOT reused inside it), its fetches, its marker poll and its two write calls. `canEdit = false`
→ no Paste SO column, no Link, no ✕ (not rendered, never disabled — UI §10) and the chip **"view only — Billing
links SOs"**. Mount only decides chrome: `place_order` adds "← Back to order · your cart is kept".

| Mount | Where | canView / canEdit from | No tick |
|---|---|---|---|
| Billing | new `BillingTab` "challan_orders" after Pick delete (`billing-tab-bar.tsx`, `showChallanOrders`, count = Not billed); rendered in `review-view.tsx` beside the other tab bodies | `app/(mail-orders)/mail-orders/layout.tsx` off its `allPerms` (`allPerms["challan_orders"]`), a courier provider like `BillingTelephonicAccessProvider` | pill not drawn; a stored tab falls back to Orders (`mail-orders-page.tsx:299` pattern) |
| Floor | new `TopTab` "challan" after Cancel & CI (`floor-page.tsx` `tabPill`), body = the screen in place of the table | `app/(floor)/floor/page.tsx` — two more `checkAnyPermission` calls beside `canEdit`, passed as props | pill not drawn |
| Place Order | top-bar link "Challan orders" (`place-order-page.tsx` header); swaps the LEFT work area only — the cart panel and all cart state stay mounted, so the cart is kept | `app/(place-order)/layout.tsx` off its `allPerms` → `PlaceOrderAccessProvider` (+ `canViewChallanOrders`, `canEditChallanOrders`) | link not drawn |

Server routes (all `force-dynamic`): `GET /api/challan-orders/list` (working tabs + counts), `GET
/api/challan-orders/history`, `GET /api/challan-orders/marker` — `challan_orders` **canView**; `POST
/api/challan-orders/links`, `POST …/links/[id]/unlink` — **canEdit**. One key for all three mounts (D8), so the
routes do not care which mount called.

**Register `challan_orders` now** (the `place_order_challan` precedent, `lib/permissions.ts`): `ALL_PAGE_KEYS`
(beside `place_order_challan`), `ACTION_PAGES.canEdit` (canView needs no entry — it is always a checkbox),
`ACCESS_SECTIONS` "Operations" (after `place_order_challan`), the rollback row in
`components/admin/permissions-manager.tsx`, and update the union comment. The label already exists
("Challan orders"). **No grants, no SQL** — admin / superuser only until slice 9. Not in `PAGE_NAV_MAP` (a tab,
not a route).

---

## 6. LIVE SYNC

**A marker poll owned by the screen, not the host's live feed.** `GET /api/challan-orders/marker` → one statement:
`count(*)` of ORB orders + `max(updatedAt)` over ORB orders + `max(updatedAt)` over `challan_order_so_links` +
`max(t."updatedAt")` over trips joined through ORB orders' drops → `{ count, latest, signature }` (the shape the
hook compares; `signature` = live-link count, so an unlink that leaves `latest` unchanged still fires). Polled by the
shared `usePickingMarker` hook with its `url` option (`lib/hooks/use-picking-marker.ts` — tab-hidden pause, no
overlap, silent failure; the Telephonic tab's pattern) every 30 s; the list refetches only when the signature moves, and immediately after the
screen's own paste / unlink.

Why not `/api/live/changes`: the feed's gate admits only floor / mail_orders / picking / tint holders, and a Place
Order user may hold none of them — one screen must refresh the same way on all three mounts. The link table's
`live_changes` triggers (v27.60, parent `orbOrderId`) already make every paste/unlink visible to Floor's and
Billing's own feeds as an `order` change, so a later step can let the Floor / Billing mounts skip the poll while
their feed is live (Billing does exactly this for its other pills) — noted, not needed for slice 5.

---

## 7. RISKS

1. **Pasting before slice 6 is live ships twice** (§3) — the one that matters. See Q1.
2. **A cancelled ORB order can hold a `waiting` SO** — Floor cancel (F4) does not touch the link table, so the SO
   stays claimed (partial unique) and, once slice 6 lands, its OBD would link to a cancelled challan. Slice 5 shows
   it in History with the SO still "waiting" and lets an editor Unlink it there (Unlink checks `status = waiting`,
   not the order's stage). Whether cancel should auto-unlink is Q3.
3. **Mail-order dealer check has false refusals** (~1.6% of SO pairs differ) — Q2.
4. **Mockup SOs are 7 digits; live CHECK is 10.** Code follows the CHECK.
5. **Ageing off `tripDate`** — a trip planned for tomorrow ages from tomorrow (negative → shown 0d).

## 8. OWNER QUESTIONS

1. **Slices 5 and 6 together?** Until slice 6 is live, an SO pasted before its OBD arrives does NOT stop that OBD
   reaching picking. Ship 5 and 6 in one deploy — or ship 5 with nobody granted `challan_orders` edit (admin only)
   and no real pastes until 6 is live?
2. **Mail order says a different dealer for the pasted SO** (happens on ~1.6% of SOs): refuse the paste, or warn
   and let billing paste anyway?
3. **Cancelling an ORB order that has a waiting SO:** should the cancel unlink the SO automatically (a Floor-cancel
   change), or leave it for billing to unlink by hand from History?
