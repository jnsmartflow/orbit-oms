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

🔴 **Rule (owner, 2026-10-20 — final):**
*(Owner 2026-10-20: detail only on Floor; picking = dealer + tag; trip sheet plain; area in stop key — replaces the 2026-10-19 table.)*

- **Redirected / tag rule everywhere:** dealer id set **OR** `shipToText` set. Never the bare `shipToOverride` flag (~393 mail orders / ~174 open bills carry it with no id and no text).
- **Routing follows the typed area EVERYWHERE** — a typed bill's area, route and delivery type come from `shipToAreaId`, not the dealer's.
- **Floor — full detail.** Title = the typed name, or **As per challan** · the existing **"→ ship-to changed"** chip · **"billed to {dealer}"** · violet 📎. Reuses the dealer-redirect row exactly (`ShipToBlockHeader` / `buildBlock`, the "{dealer} → {target}" table line) — no new design. Hold and Cancelled show the same title + chip.
- **Picking** (supervisor board, picker card, queue): **dealer name + the ship-to-changed tag only.** No site line, no "As per challan" text. **Push text unchanged.**
- **Trip sheet, A4 and phone:** named → **site name · area**; As per challan → **dealer name · area**. No "As per challan", no "carry copy", no "billed to" on A4 (keeps the 2026-10-09 rule).
- **Billing lists** (Picking list / Print tab / Telephonic): display unchanged. Billing's Orders-tab ship-to card keeps its 2026-10-20 look (`changed` pill + typed name, area · type, no code, no "billed to"); only its pill moves to "id or text" (step 7C).

| Screen | Named typed ship-to | As per challan |
|---|---|---|
| Floor board / route cards / trip stops | Site name · "→ ship-to changed" · billed to {dealer} · violet 📎 | **As per challan** · chip · billed to {dealer} · violet 📎 |
| Floor Hold / Cancelled | Site name + chip (no DC column) | As per challan + chip (no DC column) |
| Floor DC column | Violet 📎 if a copy shows (grey 📎 = tint DC, as today) | Violet 📎 |
| Floor search | Finds by site name or dealer name | Finds by dealer name |
| Picking queue / picker card / supervisor board | Dealer name + ship-to-changed tag | Dealer name + ship-to-changed tag |
| Push | Unchanged (dealer name) | Unchanged (dealer name) |
| Trips | Own stop (`t:` key), named by **site name**, typed area's route | Own stop (`t:` key), named by **dealer name**, typed area's route |
| Load plan, snapshot, day check, route-card kg/L | Counted under the typed area | Counted under the typed area |
| Trip sheet (A4 + phone) | Stop = **site name · area** | Stop = **dealer name · area** |
| Billing lists | Unchanged | Unchanged |

**Stop key (owner, 2026-10-20):** a typed bill is a stop of its own — `dropKey = 't:' || shipToText` (live `chk_trip_drops_key`), where `trip_drops.shipToText = '<scope>/<shipToAreaId>/<normalised text>'`. `scope` = the bill's `customerId`, else SAP's `shipToCustomerId`. Only the text part is normalised: lower-case, whitespace (newlines too) collapsed, `|` and `#` stripped, trimmed, capped at 80; empty → today's `c:` / `s:`. **The area is in the key: same text + different area = different stop.** A typed stop's snapshot: `customerName` = the site name (named) or the dealer name (As per challan); `areaName` / `routeName` from the typed area. Code: `lib/ship-to/effective.ts` `typedDropText` → `lib/trips/drop-key.ts` / `drop.ts` (step 7A).

The **Floor DC column** is one column holding a **plain 📎 pin, no text label** (owner, 2026-10-19 — the ship-to cell's tag already says why). System tint challan pin = grey, prints as today. Uploaded copy pin = violet, opens the file to view/print. A row with both shows two pins. It shows on **every Floor tab incl. main** when a row has either — **except Hold and Cancelled** (owner, 2026-10-20 → §6).

## 6. Out of scope v1 (→ ROADMAP)

- **System tint DC document** still prints the dealer as ship-to (it never rendered overrides).
- **Slot engine** keeps using the dealer's area (`lib/dispatch/completion-slot.ts`), so the slot is not re-worked for a typed area.
- **Tint Manager** screens, shared order-detail panel, CI detail, Mail Orders Table view keep reading the dealer.
- Printing the uploaded copy inside the trip sheet.
- The stale `[→ …]` suffix in `deliveryRemarks`.
- **DC column on Floor Hold and Cancelled** (their own tables, no DC column today) — owner, 2026-10-20.

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
