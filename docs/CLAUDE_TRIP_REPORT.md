# CLAUDE_TRIP_REPORT.md — Trip Report Module
# v1.0 · Schema v27.10 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Read-only mirror of Nagadhiraj Trans Service (NTS) trip/delivery data into OrbitOMS — a "photocopy on the wall, not a wire into the brain." Standalone: not connected to Orbit's orders/OBD workflow logic, even where delivery numbers overlap.

---

## 1. What Trip Report is [LIVE]

External trip software (Nagadhiraj) → PowerShell puller (depot PC) → standalone Supabase table (`trip_report`) → OrbitOMS shows a read-only trip list, per-trip detail, an A4 printable trip sheet, and a WhatsApp image share. One-way flow only — nothing in OrbitOMS writes back to NTS.

**Routes:**
- `/trips` — list (desktop full-width table; mobile app-style cards)
- `/trips/[tripNo]/sheet` — A4 printable trip sheet (full-page, no sidebar)

**Access:** `trip_report` page key, view-only. Granted to the **`logistics`** role (new — see §7 CORE flag) plus 4 existing users individually added to `logistics` as a secondary role (primary roles untouched): Ajay Vansiya (dispatcher), Dhanraj Shah (dispatcher), Priya Chaudhari (support), Operations User (operations). One new user, **Praveen**, has `logistics` as his primary (and only) role — sees only Trip Report. The `operations` role itself is **not** granted — only these 5 named users, for now.

---

## 2. Data source + mirror model [LIVE]

**Source:** `nagadhirajtransservice.com`.
- Login (GET, session cookie): `/nts/API/chk_login.php?txt_mobile=<m>&txt_pwd=<p>&webpushid=`. Cookie persists after one login — no re-login each pull.
- Report (GET, needs cookie): `/nts/API/get_trip_report.php?txt_filterdate=MM/DD/YYYY%20-%20MM/DD/YYYY`.
  - ⚠️ **Date-format gotcha:** the URL filter is **MM/DD/YYYY** (literal slashes). The response's `dis_date` field is **dd-MM-yyyy** (e.g. `03-07-2026` = 3 July). URL format and response format differ — do not conflate them.
- One row = one delivery drop. A trip = many drops sharing `tripno1` on the same `dis_date`. `tripno1 = "0"` = loose/non-trip drops, excluded from the trip list.

**PowerShell puller (depot PC):** `F:\VS Code\nts trip report\Pull-TripReport.ps1` — lives entirely **outside the repo** (holds secrets in `settings.txt`, gitignored). Loops every 60 sec: fetch today, filter, mirror.
- Date built with escaped slashes (`Get-Date -Format 'MM\/dd\/yyyy'`) — the depot PC's regional separator is `-`, so a plain `/` produced dashes → malformed URL → 0 rows. Escaped slashes force literal `/`.
- Source `dis_date` (`dd-MM-yyyy`) is converted and stored as `yyyy-MM-dd`.
- **Transporter filter:** keeps only rows where `transporter` (trimmed, lowercased) `== "nagadhiraj"`. Drops MRC/HAND/deleted rows.
- PS 5.1 compliant (no ternary/`??`/`ToHexString`). Logs to `log.txt`, secrets masked.

**Atomic mirror rewrite (2026-07-06) — why it exists:** the original puller upserted by `sourceId` (NTS's own row `ID`, which **changes on every pull**) — so a re-pull inserted fresh duplicate rows instead of overwriting. After a `(deliveryNo, disDate)` unique constraint was added to close that gap, a plain multi-row upsert could then hit Postgres error `ON CONFLICT DO UPDATE command cannot affect row a second time` whenever NTS sent the same delivery number twice in one batch — silently failing the **entire** push (0 rows written, sync stopped).

**Fix — `mirror_trip_report_today(rows jsonb) returns integer`** (Supabase Postgres function):
- Guards: an empty incoming array does nothing (protects against an NTS glitch wiping today's list).
- Dedupes incoming rows by `(deliveryNo, disDate)`, keeping the last occurrence.
- Deletes today's rows (`disDate = target_date`) and inserts the new set **in one transaction** — the trip list is never momentarily blank. Only today's date is ever touched.
- `fetchedAt` omitted on insert (Postgres stamps `now()`); `sourceId` supplied from NTS as-is.

The puller now POSTs `{ rows: [...] }` to `/rest/v1/rpc/mirror_trip_report_today` instead of upserting the raw table. **Net result:** `trip_report` is an exact mirror of today's NTS data — adds, updates, and deletions all sync every 60s; duplicates are impossible; the list is never blank.

**Unique constraint:** `trip_report_delivery_no_dis_date_key UNIQUE(deliveryNo, disDate)` — prevents a delivery from duplicating within a day; mirrored in `prisma/schema.prisma` via `@@unique([deliveryNo, disDate], map: "...")` (hand-edited + `npx prisma generate`, no `db push`/`db pull`, per CORE §3).

⚠ **Puller must be RUNNING on the depot PC for live data.** Not yet a Task Scheduler job — see §7.

---

## 3. `trip_report` table

Standalone Supabase table. All columns `TEXT` except `disDate` (`DATE`) and `fetchedAt` (`TIMESTAMPTZ DEFAULT now()`). Prisma model `TripReport`, `@@map("trip_report")`, camelCase, no `@map` on individual columns. ~38 columns total; the ones the build sessions actually touch are itemized below (full list: `prisma/schema.prisma`).

```
PK:  sourceId          (NTS's own row ID — changes per pull; NOT used for dedup, see §2)
UQ:  (deliveryNo, disDate)   -- trip_report_delivery_no_dis_date_key

Full model, all 38 columns (verified against prisma/schema.prisma — the columns below are the
authoritative live list, superseding any earlier partial account):

Identity / grouping
  tripNo              (source tripno1; "0" = loose/non-trip, excluded from trip list)
  deliveryNo
  disDate             DATE  — date-picker filter key
  disTime             — drives newest-first list sort (§4)

Delivery detail
  deliveryType        (source delivert_type)
  fixedType
  tRate
  vehicleNo           (source vehicle_no)
  vehType
  vModal
  driverName
  driverMobile        (source mobileno)
  dlRoute             (source dl_route — ignored by display rules, see §4)
  custCode            — drives unique-customer drop counting (§4)
  custName
  custAreaName
  siteName
  siteArea
  otherDelAreaName    — highest-priority input to resolveDeliveryArea (§4, "Other Delivery Area")
  modiInv
  remark
  promoType           — drives the INV/PROMO tag (§4)
  isManual

Quantities
  noArticle
  disQty
  volLt               — the "LT" total in the LT/KG rename (§4)
  netWeight
  totQty
  totWeight
  totDistributor      (source tot_distibutor — source's own misspelling, read as-is, do not "fix")
  dieselAmt

Misc
  transporter
  tranTransporterName
  adminName
  custsoName
  createdOn

Meta
  fetchedAt           TIMESTAMPTZ DEFAULT now()
```

**Indexes:** `(disDate)`, `(disDate, tripNo)`.

Columns without a confirmed display-rule meaning in either build session (`fixedType`, `tRate`, `vehType`, `vModal`, `modiInv`, `remark`, `isManual`, `tranTransporterName`, `custsoName`, `createdOn`) are listed as-is from the live schema, not interpreted — they exist in the mirror but neither session's drafts assign them a UI/business meaning yet.

---

## 4. Display rules [LIVE]

Rules as the code implements them, not as generic description:

- **Drops = unique customers**, not bill rows — counted by `custCode`. Applied uniformly to the list, detail table, printed sheet, and share caption. A blank `custCode` row counts as its own drop.
- **Delivery-area resolution** (`resolveDeliveryArea`): first non-empty of **Other Delivery Area → Site Area → Customer Area**. `Delivery Route` (`dlRoute`) is ignored everywhere — the Route column was removed from the UI. Site Area only matters when there's a site AND no other-delivery override.
- **Site + customer display:** when `siteName` is present, the customer cell shows `"{siteName} · {custName}"` — in the detail table, the mobile card, and the printed sheet.
- **INV/PROMO tag:** reads `promoType` — shows "PROMO" only when it equals `PROMO`, else "INV" (fixed bug: the old code returned PROMO whenever the field was merely non-empty, painting nearly every row PROMO). Real split on live data: ~72 INV / ~8 PROMO.
- **LT / KG columns** (renamed from Qty/Weight everywhere). LT + KG **totals exclude PROMO rows** (INV-only); Drops + Articles totals still count **all** rows.
- **Articles column** — added to the printed trip sheet (per-row + footer total, all rows).
- **Up-Country filter:** the "Up-Country" segment label maps to DB value `UPC` (fixed bug: previously compared the label text directly to the data — "Local" only worked by luck). Nagadhiraj is mainly UPC + Local; IGT/Cross rows are rare and show only when no filter is active (accepted).
- **Name casing:** customer + site names run through `smartTitleCase` (was mixed ALL-CAPS/proper-case).
- **Sorting:**
  - Trip list = **newest first** — `disTime` DESC, tiebreak trip-no numeric part DESC (so trip L42 sits above L41).
  - Detail rows use one shared helper, `sortTripDropRows` (used by the table, mobile card, print sheet, AND the share image — never drifts): **Delivery Area A–Z → Customer (`custCode`, kept adjacent) → Delivery No ASC**. A customer whose rows genuinely span two delivery areas correctly splits across those areas — intended.
- **WhatsApp caption redesign:** clock emoji (a calendar emoji previously showed a misleading baked-in number), driver **first name only** + mobile (null mobile → name only), unique-customer drop count, route/areas last (comma-joined, unique). Vehicle no / qty / weight / diesel were removed from the caption.
- **Transporter label** on the trip sheet: hardcoded "Nagadhiraj Trans Service" → "Nagadhiraj Transport Service".
- **Trip sheet address band** now matches the Delivery Challan's text ("Decorative Paints · Shiv Logistics Park, Block No.244, Kosmada, Surat, Gujarat 395006") — **but is hardcoded on the sheet**, whereas the challan pulls the same text from `system_config` (DB). These WILL drift if the depot address is ever edited in admin. Wiring the sheet to the same DB source is deferred — see §7.

---

## 5. A4 print sheet [LIVE]

`components/trip-report/trip-sheet-document.tsx` — prop-driven, shared verbatim by both the print route (`/trips/[tripNo]/sheet`) and the WhatsApp image-capture path (§6), so the two can never drift apart.

**Design = the Delivery Challan's sibling**, matched to the real challan (`components/tint/challan-document.tsx`): JSW logo in full colour (not blacked out — the challan's own greyscale rule was targeting a stale class that never fired), dark slate address bar, a bordered meta strip (Type · Vehicle No · Driver · Driver Mobile — no diesel), an enclosed deliveries grid with challan border weights and blank filler rows to `MIN_ROWS = 20`, a totals row, and a 3-cell bottom band (Transport Details info-only · Dispatched By · Received By — the transporter is a detail, not a signer, since it's a standing contractor). Footer: dispatch-record disclaimer, no registered-office line.

**Print CSS follows the same hard-won pattern as the Delivery Challan** (`CLAUDE_TINT.md §9.8`, `CLAUDE_UI.md §32`) — cross-referenced, not re-derived: `@page` rules top-level in `globals.css`, never nested in `@media print`; `visibility: hidden`/`visible` isolation (not `display: none`); footer kept in **normal document flow** with blank-row table filling doing the work of landing it flush at the bottom (a fixed-position footer was tried and abandoned — it left a detached gap). `break-inside: avoid` on the ack band + footer so long trips (0 blank rows) never split across pages. Trip Sheet's own values: `@page trip-sheet { size: A4; margin: 10mm }` (even margins all round).

---

## 6. WhatsApp image share [LIVE]

`lib/trip-report/share-sheet-image.ts` + `html-to-image` (the only new dependency this module introduced).

Renders `<TripSheetDocument>` into a hidden **same-document** div from in-memory trip-detail data — deliberately **not** an iframe, because `html-to-image` cannot reliably capture cross-realm nodes (an earlier iframe attempt failed for this reason). Awaits the logo's `.decode()` so it isn't captured blank; captures `.trip-sheet-inner` at `pixelRatio: 2`.

- **Mobile:** `navigator.canShare({ files })` → `navigator.share` with the PNG + caption → user picks a WhatsApp group.
- **Desktop:** downloads the PNG (`TripSheet-{tripNo}-{date}.png`) + copies the caption (WhatsApp desktop needs its own install; this is a phone-first feature).

**Logo capture fix (2026-07-06):** the logo `<img>` used `width: "auto"` (only height set). `html-to-image`'s foreignObject serialization does **not** preserve intrinsic width on mobile WebKit specifically — the `navigator.share` path — so it silently collapsed to ~0 width (invisible). This failed identically for both a URL `src` and a base64 data URI, which is why an earlier data-URI attempt AND its revert both failed — both were chasing the wrong layer. **Fix:** explicit `width: 141, height: 34` on the logo `<img>` (141 ≈ 34 × 800/193, same proportion as before — screen/PDF rendering unchanged) + `cacheBust: false`. Confirmed working on a real phone.

**Lesson for future capture bugs:** always set explicit pixel dimensions on images inside any `html-to-image` node — intrinsic/auto sizing is not trustworthy across capture paths.

---

## 7. Open / deferred + landmines

**[NEXT]**
- **Puller as a Task Scheduler job** — currently only runs while its PowerShell window stays open on the depot PC.
- **Operations-role grant** — if Trip Report access is ever widened beyond the 5 named users in §1.
- **Multi-select trips → combined PDF share** — single-trip image share is done; a multi-trip combined export is not built.
- **Puller mirror monitoring** — watch the puller's first few days post-rewrite (§2): confirm NTS-side deletions actually mirror away, and that the "mirrored N rows" log count keeps tracking NTS's true row count.

**[DEFERRED]**
- **Trip sheet address band drift** — hardcoded on the sheet (§4) vs. `system_config`-sourced on the real Delivery Challan. Wiring the sheet to the same DB source is a bigger change (thread `systemConfig` into the sheet page + the share-capture path) — not done.
- **Mobile app polish** (navigation + app-feel) — tracked as a separate, non-Trip-Report-specific effort.
- **Seed scripts** — `trip_report` is not seeded; a reseed won't touch it (the table is puller-fed, not seed-fed), but note the distinction if a future seed script ever needs to reason about this table.

**[LANDMINE]**
- **Puller lives entirely outside the repo** (`F:\VS Code\nts trip report\Pull-TripReport.ps1`, secrets in `settings.txt`, gitignored) — not tracked in git; any change must be manually deployed to the depot PC.
- **No alert if the puller stops.** If the depot PC's PowerShell window is closed, `trip_report` silently goes stale — no monitoring/alerting exists for this today.
- **`.gitignore` has a UTF-16-encoded `node_modules/` line** that doesn't actually match (wrong encoding saved) — a one-line fix, parked, unrelated to the mirror rewrite but noticed during this work.

---

## 8. Key files index

| File | Role |
|---|---|
| `F:\VS Code\nts trip report\Pull-TripReport.ps1` (outside repo) | Depot-PC puller — loops every 60s, filters by transporter, POSTs to `mirror_trip_report_today` |
| `mirror_trip_report_today` (Supabase Postgres function) | Atomic daily mirror: dedupe incoming → delete today's rows → insert new set, one transaction |
| `app/trips/page.tsx` | `/trips` route entry, wraps `RoleLayoutClient` inline (not a `layout.tsx` — would cascade into the print sheet) |
| `components/trip-report/trip-report-page.tsx` | Main list UI — desktop table + mobile app-style cards, date filter, Local/Up-Country segment |
| `app/api/trips/route.ts` | `GET /api/trips?date=` — groups drops into trips (in JS, not SQL), per-trip totals; session-gated, no route-level role gate |
| `app/api/trips/[tripNo]/route.ts` | `GET /api/trips/[tripNo]?date=` — trip header + drops + totals |
| `app/trips/[tripNo]/sheet/page.tsx` | A4 print route, full-page, no sidebar |
| `components/trip-report/trip-sheet-document.tsx` | Shared print/share document (§5) — single source for both render paths |
| `lib/trip-report/display.ts` | Shared display helpers: `resolveDeliveryArea`, `sortTripDropRows`, and related formatting (§4) |
| `lib/trip-report/share-sheet-image.ts` | WhatsApp/PNG image capture via `html-to-image` (§6) |
| `lib/permissions.ts` / `components/shared/role-sidebar.tsx` | `trip_report` PageKey + nav entry ("Trip Report" → `/trips`, Route icon) |
| `lib/rbac.ts` | `ROLE_REDIRECTS["logistics"] = "/trips"` |

---

*Trip Report v1.0 · Schema v27.10 · OrbitOMS*
