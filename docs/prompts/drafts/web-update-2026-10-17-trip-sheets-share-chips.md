# web-update-2026-10-17 — Trip Sheets: per-group WhatsApp share chips

**Type:** web-update, written by Claude.ai after a working session. The work is **shipped and owner-tested on a phone** (2026-10-17). Before merging, confirm both commits with `git log`.
**Commits:** `ce7ec8b6` (chips, share log, schema v27.71) · `43eaedd7` (plain caption + list refresh). Pushed together with `4ea1b1e2`, which is unrelated (floor trips stop numbers, other session).
**Schema:** v27.71 is already minted in CORE (v147) by `ce7ec8b6`. The SQL is `docs/prompts/drafts/code-update-2026-10-17-trip-share-groups.sql`, RUN LIVE 2026-10-17.
**Owner file when consolidated:** none exists yet (see §8).

---

## 1. What it is

On the `/trip-sheets` list (Orbit's own trips, **not** the NTS `/trips` Trip Report mirror), each trip card shows one **chip per group** that has bills on that truck. Tapping a chip shares a trip sheet image to WhatsApp that holds **only that group's bills**. After a successful share the chip turns green with a ✓.

- The chip row **replaced** the salesman-names line on the card. Driver name, call button, vehicle · area, stops/bills/kg and the Picking/Ready badge are unchanged.
- No bill counts on chips. Earlier "City 1 · 2" read as "City 12", so counts were removed.
- Tapping the **card** still opens the full trip, and the detail page's full-trip "Share on WhatsApp" is unchanged.
- The user's job is keeping each group's WhatsApp updated. It is group-first, not trip-first. A daily per-group digest (one image per group, all trips) was discussed and **not built**. Revisit only if per-trip sharing becomes too many taps.

## 2. Group rules (owner-confirmed 2026-10-17)

Module: `lib/trip-sheet/share-groups.ts`. It is pure and browser-safe.

Group keys: `city1`, `city2`, `upc`, `project`, `other`. Labels: City 1, City 2, UPC, Project, Other.

The **trip's stored type** decides first (the L/U/I/C letter, via `tripInScope`), then the bill.

| Bill | Local trip | UPC trip |
|---|---|---|
| `smu = 'Decorative Projects'` OR SO `shareGroup = 'project'` | Project | Project |
| SO `shareGroup = 'city1'` | City 1 | UPC |
| SO `shareGroup = 'city2'` | City 2 | UPC |
| Telecaller mailbox bill (no SO id) | City 1 | UPC |
| Bill with no salesman | City 1 | UPC |
| SO `shareGroup = 'upc'`, or a named SO with NULL group | Other | UPC |

- **IGT / Cross trips and Hand trips get no chips.** Only the full-trip share applies.
- The bill set is the same as the sheet: held bills are left out and re-deliveries are included.
- **City 2 comes ONLY from SO `shareGroup = 'city2'`** (Rahul Pal, Nirav). No other path yields City 2.
- History (2026-10-17 → 2026-10-20): Telecaller and no-salesman bills went to **both** City 1 and City 2. The owner changed them to **City 1 only** on 2026-10-20, so City 2 holds only Rahul Pal / Nirav bills. Do not revert.

**The SO comes from the bill, not the customer.** It comes from `salesOfficerByOrder` (`lib/floor/queries.ts`, owned by Floor and untouched here):
- Projects (74) and Retail Offtake (77) bills use the customer master.
- Every other bill uses the newest `mo_orders.soName` for the bill's `soNumber`, resolved through `sales_officer_aliases`.

So for most bills the "SO" is **whoever sent the mail order**. Example: Pravesh has 0 rows in `customer_sales_officers` but is a top SO on trip bills.

## 3. Data

- `sales_officer_master."shareGroup"` text NULL, with CHECK `chk_sales_officer_master_share_group` allowing `'city1','city2','upc','project','city_both'`. NULL means not mapped.
- Mapping as of 2026-10-17, by id:
  - **city1:** 10 Shiv Pal, 11 Ravi Patel, 22 Roopesh, 23 Sunil, 24 Pravesh, 28 Kundan, 31 Zubin, 33 Aman, 34 Bhaven, 35 Divanshu
  - **city2:** 12 Rahul Pal, 26 Nirav
  - **project:** 9 Ajay, 13 Ravi Dedania, 14 Lakhan, 15 Tejas, 16 Vishal, 17 Narendra, 20 Pushpendra
  - **upc:** 18 Abhishek, 25 Vijendra, 27 Bharat, 29 Karan, 30 Chirag, 32 Anand
  - **NULL:** 19 (TEST), 21 (blank name), 36 Neev
- History (2026-10-17): Kundan (28) was first set to `city_both` (both City sheets) and then changed by the owner to **`city1`** by a data UPDATE. `city_both` is still allowed by the CHECK but is **unused**, and since 2026-10-20 the code maps it to `city1` only. Do not remove it without checking that no row uses it.
- History (2026-10-17): Bhaven (34) was first listed as UPC. Live data showed all 24 of his trip bills on Local trips, so the owner moved him to **city1**.
- **New table `trip_share_log`:**
  - Columns: id, `tripId` → trips (CASCADE), `groupKey` (CHECK city1/city2/upc/project/other), `sharedAt`, `sharedById` → users (SET NULL), `orderIds` int[].
  - Index on (`tripId`, `groupKey`).
  - Three trip-child live triggers (`live_changes_child_*('trip','parent','tripId')`).
  - RLS off, which is consistent with `trip_redeliveries` and `order_invoices`.

Live distribution, 14 days to 2026-10-17: 2,687 bills on trips. 469 (about 17%) have no salesman; about 300 of those are on Local trips and go to City 1 (since 2026-10-20). "Telecaller" (depot mailbox Surat Akzonobel) had 122 bills.

## 4. Share flow

- **List API** (`GET /api/trip-sheets`): returns per trip `chips` = [{ key, label, billCount, shared, stale }], ordered City 1, City 2, UPC, Project, Other, listing only groups with bills. It also returns the full sheet payload, so a chip can share with **no fetch after the tap**, which protects the iPhone tap window.
- **Filtering:** `filterSheet(sheet, key)` renumbers stops and recomputes totals and areas through `lib/trip-sheet/totals.ts` → `summariseStops`. That is the ONE totals implementation, shared with the loader.
- **Share-log API:** `POST /api/trip-sheets/[id]/share-log` with `{ groupKey, orderIds }`. It is called after `navigator.share` resolves, or after the desktop download. A cancelled share (AbortError) writes nothing. The gate is `canViewTripSheets`, so anyone who can see the page can log a share.
- **Tick / stale:**
  - The latest log row for (trip, group) whose `orderIds` set equals the group's current bills shows ✓.
  - If the set changed, the chip drops back to "not shared" so the user re-shares.
- **iPhone gesture:** the share-image module is preloaded when the list mounts. On `NotAllowedError` the captured file is kept and the chip shows **"Tap to send"**; the next tap shares it.
- **Freshness (`43eaedd7`):**
  - The list refetches in place when the page becomes visible and every 60 s while visible.
  - If a chip's data is over 60 s old when tapped, it refetches that trip, captures the image and goes to "Tap to send".
  - If the group has no bills left, it shows a message instead of sharing.
- **Caption:** byte-identical to the full-trip format. Its numbers come from the filtered sheet. The group label is **only in the file name** (`TripSheet-L-261017-04-City-1.png`), not in the caption, the share title or the image.
  - History (2026-10-17): `ce7ec8b6` put " · City 1" etc. in the caption's first line. The owner rejected it and `43eaedd7` removed it. **Do not re-add a group label to the caption or the image.**

## 5. Verified

- Diagnosis 2026-10-17: a read-only run of the real loader over all 29 trips on 16–17 Oct found **0 total mismatches**. It checked filtered sheets against direct sums, and the full trip against the pre-change loop.
- A reported "wrong totals" turned out to be the intended overlap (shared bills on both City sheets) plus a stale-list risk. The stale-list risk was fixed in `43eaedd7`.
- The owner phone-tested on live 2026-10-17: chips, filtered images, ✓, plain caption, and Kundan on City 1 only. All OK.

## 6. Known gaps (not bugs, parked)

- **Ticks are not live across phones.** The list doesn't subscribe to the live feed. Another phone's share shows on the next refetch (≤60 s or on return to the page). The trigger already exists if live ticks are wanted later.
- **Share-log validation:** the endpoint checks that the bills are on the trip, but not that they belong to the group.
- **Payload size:** the list response now carries every trip's full sheet. There are no extra DB reads, but the payload is bigger.

## 7. Canon mismatches found (fix at consolidation)

- **No canonical file documents `/trip-sheets`.** FLOOR_TRIPS, UI and FLOOR never mention it, and CORE mentions it once, in the v27.62 entry. Files are below.
- **CORE §7** says `sales_officer_master.displayName` and `sales_officer_aliases` are "read by nothing yet". The code reads both (`masterShownName`, `lib/sales-officer/resolve.ts`).
- The `sales_officer_master.updatedAt` Prisma drift is already recorded and unchanged here.

## 8. Consolidation note

Trip Sheets is a live production module with no owner file. It should get its own canonical file (e.g. `CLAUDE_TRIP_SHEETS.md`) plus a router row in `CLAUDE.md`. This draft becomes its share-chips section. It should cross-reference rather than re-tell:
- `CLAUDE_FLOOR_TRIPS.md` for trips, drops and numbering;
- Floor for `salesOfficerByOrder`;
- CORE for v27.71.

**Files:**
- **Routes:** `/trip-sheets`, `/trip-sheets/[id]`, `/trip-sheets/[id]/sheet`, `GET /api/trip-sheets`, `GET /api/trip-sheets/[id]`, `GET /api/trip-sheets/search`, `POST /api/trip-sheets/[id]/share-log`.
- **Page key:** `trip_sheet`, with `canViewTripSheets` (`lib/trip-sheet/access.ts`) letting in `trip_sheet` OR floor view. Logistics users land here (`lib/rbac.ts`).
- **Logic:** `lib/trip-sheet/` — load, types, share-image, caption, tabs, access, search, share-groups, totals.
- **UI:** `components/trip-sheet/` — trip-sheets-list, trip-sheet-screen, trip-sheet-document, card-bits.
- **No NTS code is reused:** `types.ts` forbids importing `components/trip-report/*` and `lib/trip-report/*`.
- Search results show chips too (same row builder).
- **Mockup:** `docs/mockups/trip-sheet/trip-sheets-share-chips.html` (singular `trip-sheet/` folder, next to `trip-sheet-mockup.html`). Committed with this draft on 2026-10-20.
