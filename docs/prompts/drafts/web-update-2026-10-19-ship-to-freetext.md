# web-update-2026-10-19 — Free-text ship-to + dealer challan copy (LOCKED DESIGN)

Status: **decision, NOT BUILT.** Mockup: `docs/mockups/ship-to-freetext/ship-to-freetext-mockup.html`.
Evidence: Claude Code read-only diagnosis, 2026-10-17 (file:line refs below are from that report — re-verify at build time; code wins).

> **Supersedes `web-update-2026-09-24-billing-mo-actions.md` §5** (v3 free-text table and the v4 "Orbit delivery points" idea in §5.0).
> v4 shipped separately on 2026-10-05 as **Orbit customers** (`ORB-NNNNN`, prefix is the marker, no flag column). This draft does NOT rebuild it.
> Archive the 2026-09-24 draft's §5 as history at consolidation; do not merge it.

---

## 1. Scope and ownership

- **New:** a typed ship-to (name + area) and an uploaded dealer/SO challan copy, for one-off places that are NOT in `delivery_point_master`.
- **Not new (owned elsewhere):** dealer/ORB ship-to search and save (`CLAUDE_FLOOR.md` ship-to section, `CLAUDE_BILLING.md` ✎ pencil), drop-key logic (`CLAUDE_FLOOR_TRIPS.md`), the system tint DC (`CLAUDE_TINT.md` §9).
- Fixed non-SAP places (godowns, transporters) are **ORB customers**, picked from the dealer list. Free text is only for true one-offs.

## 2. The modal (one shared component)

| | Decision |
|---|---|
| Opens from | Billing ✎ pencil (Orders tab ship-to card) and Floor detail panel **Ship-to** button. Replaces today's small popover (Billing) and inline search (Floor). |
| Size | Centred modal, ~720px wide, dark backdrop. Full width below 640px. |
| Top | **Current ship-to** card (name, code, area, delivery type; `typed` chip + "billed to …" when typed). **↺ Reset to customer** on the right, disabled when there is no change. |
| Tabs | **Search dealer** (default) · **Type name**. |
| Search dealer | Dealer list only (incl. ORB). **No upload on this tab.** Hint: "Dealer not in the list? Use Type name." |
| Type name | Name box · **As per challan** chip · **Area dropdown, required, NO default** — starts empty ("Select area…"); the user must pick. Reopening a bill that already has a typed ship-to shows its saved area · challan copy upload. |
| As per challan | Name box locks to "As per challan"; copy becomes **required**; Save disabled until a file is attached. **Area is still REQUIRED, with no default** — the user must pick; it decides route / tab / trip. Expected to be the most-used path: tick As per challan → pick area → attach copy. *(Owner, 2026-10-19; an earlier same-day note hid the area for As per challan — reversed, do not re-hide it.)* *(Owner 2026-10-20: area default to customer's area removed after hand test — do not re-add.)* |
| Tag | Every typed ship-to (named or As per challan) carries the **existing ship-to-changed tag**, same as a dealer redirect — `isShipToOverride` true. No separate `typed` chip. *(Owner, 2026-10-19; replaces the `typed` chip in the mockup.)* |
| Upload | Optional (unless As per challan). Up to 3 files, JPG / PNG / PDF. Images shrunk in the browser; server cap under Vercel's ~4.5 MB request limit; a PDF over the cap is refused with a clear message. |
| Scope line | Billing: "Applies to all bills of this SO, including ones that import later." Floor: "Applies to this bill only." |
| Last save wins | Typed name clears the dealer pick; dealer pick clears the typed name. Reset clears both. |
| Copy on clear | Picking a dealer or Reset **hides** the copy (soft-remove). The file stays in storage. No purge. |
| Access | Billing: `billing_ship_to` tick (existing). Floor: `floor` canEdit (existing). No new page keys. |
| Refusals | Unchanged: bill on a trip (incl. partial invoice-trip), dispatched or cancelled is refused (`lib/billing/refusal.ts`, `lib/floor/ship-to.ts`). |

## 3. Who it applies to

- **Billing** writes the mail order **and** every bill on the SO (per bill, refusals apply), and later imports inherit it through the existing fill-only carry (`app/api/import/obd/route.ts` ~399-416) — widened to carry the typed fields.
- **Floor** writes **one bill only** (`orders`), never `mo_orders`. Same as today.

## 4. Data (proposed — gate confirms names)

- `mo_orders.shipToText text NULL`, `mo_orders.shipToAreaId int NULL` → FK `area_master(id)`.
- `orders.shipToText text NULL`, `orders.shipToAreaId int NULL` → FK `area_master(id)`.
  - Named relations `"MoOrderShipToArea"` / `"OrderShipToArea"`, named back-arrays, never Cascade.
  - Typed text set → `shipToOverrideCustomerId = null`, `shipToOverride = true`. Dealer pick → text + area null.
- `trip_drops.shipToText text NULL`; **`chk_trip_drops_key` rewritten** with the `t:` branch first (dealer-scoped, normalised text; empty → today's `c:`/`s:`). Exact form from the 2026-09-24 §5 table, re-gated.
- New table **`ship_to_copies`**: id, `soNumber`, `orderId` NULL, `moOrderId` NULL, `storagePath` unique, `contentType`, `sizeBytes`, `uploadedById`, `createdAt`, `removedAt` NULL, `removedById` NULL.
  - **Billing upload → `moOrderId` set, `orderId` NULL** (every bill of that mail order's SO shows it). **Floor upload → `orderId` = that bill** (only that bill shows it).
  - `soNumber` is **NULL-able** — a snapshot filled when known. Billing can save before the SO is punched (`billing-ship-to-pencil.tsx` "ALWAYS ACTIVE — punched or not"), and a re-punch can change the SO. Readers find Billing copies via `moOrderId → mo_orders.soNumber`, never the snapshot. CHECK: `orderId IS NOT NULL OR moOrderId IS NOT NULL`. *(Gate finding 2026-10-19; spec first said NOT NULL — do not revert.)*
  - *Correction to the 2026-10-17 chat: "kept against the SO number" alone would make a Floor copy show on the SO's other bills. The `orderId` column fixes that.*
- Private bucket **`ship-to-challans`** (made by hand, no RLS policies). Copy MRN's pattern (`lib/mrn/photo.ts`): row per file, undo upload if the row write fails, signed URL 300 s, extension from a type map (jpg/png/pdf), never from the file name. Do NOT reuse `attendance-photos` (its purge deletes files).
- Every DDL commit mints its schema version in CORE in the same pass.
- **No backfill.** The ~393 mail orders and ~174 open bills with flag-true / id-null stay as they are.

## 5. What each screen shows

Two kinds of typed ship-to:
- **Named** — e.g. "Site, Pal Gam, Tower B", area Pal.
- **As per challan** — no name, but an **area is picked**; a copy is always attached.
- **Area is required for every typed ship-to.** DB: `shipToText` set ⇒ `shipToAreaId` NOT NULL (add as a CHECK).

🔴 **Rule (owner, 2026-10-19):**
- **Desk screens (Billing, Floor)** may show **"As per challan"** as the ship-to name, with "billed to {dealer}" underneath — except the Billing Orders-tab ship-to card, which has no "billed to" line (the Bill To card beside it shows the dealer; owner, 2026-10-20). Desk users know what it means.
- **Picking screens (supervisor board, picker card, queue, push) and the trip sheet** never show "As per challan" as a name. They show the **bill-to dealer name** first, plus a tag:
  - named typed ship-to → dealer name + ship-to-changed tag + small "→ {site name}" line
  - As per challan → dealer name + **As per challan** tag

| Screen | Named typed ship-to | As per challan |
|---|---|---|
| Billing · Orders tab ship-to card | Same look as a dealer redirect: `changed` pill + site name, then Pal · type. No code, **no "billed to"** | Same look: `changed` pill + **As per challan**, then Udhna · type. No code, **no "billed to"** (the Bill To card shows the dealer) |
| Billing · Picking list / Print tab / Telephonic | Site name | As per challan · billed to dealer |
| Floor board, Hold, Cancelled | SHIP TO = site name + tag + "billed to {dealer}". Area = Pal. Sits on the **Pal route tab / card**. | SHIP TO = **As per challan** + tag + "billed to {dealer}". Area = **picked area (Udhna)**. Sits on the **Udhna route**. |
| Floor DC column | Violet 📎 if a copy exists (grey 📎 as today for tint DC) | Violet 📎 always |
| Floor detail panel | Site name, Pal, billed to, 📎 copy | As per challan, Udhna, billed to, 📎 copy |
| Floor search | Finds by site name or dealer name | Finds by dealer name |
| Picking queue / picker card / supervisor board / push | **Dealer name** + ship-to tag + "→ Site, Pal Gam" (small) | **Dealer name** + As per challan tag |
| Trips | Own stop (`t:` key), named by site name, Pal route | Own stop (`t:` key, text "as per challan", dealer-scoped), named by **dealer name** + tag, **Udhna route** |
| Load plan, snapshot, day check, route-card kg/L | Counted under Pal | Counted under Udhna |
| Trip sheet (driver A4) | Stop = **site name · Pal**, small "billed to {dealer}", 📄 if copy | Stop = **dealer name · Udhna**, "As per challan — carry dealer copy 📄" |

The **Floor DC column** is one column holding a **plain 📎 pin, no text label** (owner, 2026-10-19 — the ship-to cell's tag already says why). System tint challan pin = grey, prints as today. Uploaded copy pin = violet, opens the file to view/print. A row with both shows two pins. It shows on **every Floor tab incl. main** when a row has either.

## 6. Out of scope v1 (→ ROADMAP)

- **System tint DC document** still prints the dealer as ship-to (it never rendered overrides).
- **Slot engine** keeps using the dealer's area (`lib/dispatch/completion-slot.ts`), so the slot is not re-worked for a typed area.
- **Tint Manager** screens, shared order-detail panel, CI detail, Mail Orders Table view keep reading the dealer.
- Printing the uploaded copy inside the trip sheet.
- The stale `[→ …]` suffix in `deliveryRemarks`.

## 7. Fixes in the same build

1. Split route (`app/api/mail-orders/[id]/split/route.ts` ~99-104) copies `shipToOverrideCustomerId` + `shipToText` + `shipToAreaId`.
2. `lib/floor/ship-to.ts` ~113: saving a dealer clears typed text; it must not reset a typed ship-to's flag.
3. Tint shop-delivery route (`app/api/tint/manager/shop-delivery/route.ts` ~110-114) must not wipe a typed ship-to.
4. Free text needs its own "redirected" marker: billing list and FloorDetail decide redirect from the id today (`lib/billing/order-detail.ts` ~166, `lib/floor/queries.ts` ~1372).

## 8. Build order

1. ✅ Diagnosis (2026-10-17) · ✅ Mockup · ✅ This draft
2. Gate: re-verify every read site in §5 + the `chk_trip_drops_key` live text + live SELECT counts
3. SQL (columns, `trip_drops` check, `ship_to_copies`) + bucket by hand
4. Prisma + CORE schema entry
5. Shared modal + save routes + upload route (Billing + Floor)
6. Read sites in §5 (incl. trip drop key + trip sheet)
7. §7 fixes
8. Verify (owner smoke test by hand) + `code-update` draft + canon fixes

Each code step: diagnosis prompt, then implementation prompt. `tsc --noEmit`, stage by name, commit to main.
