# Trip Report (NTS) — Build Log · 2026-07-04

Read-only mirror of Nagadhiraj Trans Service (NTS) trip data into OrbitOMS. Standalone — NOT connected to Orbit orders/OBD logic, even where delivery numbers overlap. Live in daily use.

---

## What it does

External trip software (Nagadhiraj) → PowerShell puller (depot PC) → standalone Supabase table → OrbitOMS shows read-only trip list, per-trip details, A4 printable trip sheet, and WhatsApp image share. One-way flow. "Photocopy on the wall, not a wire into the brain."

---

## 1. Data source

- **Source site:** `nagadhirajtransservice.com`
- **Login (GET, session cookie):** `/nts/API/chk_login.php?txt_mobile=<m>&txt_pwd=<p>&webpushid=`
- **Report (GET, needs cookie):** `/nts/API/get_trip_report.php?txt_filterdate=MM/DD/YYYY%20-%20MM/DD/YYYY`
  - URL filter is **MM/DD/YYYY** (slashes).
  - Response `dis_date` field is **dd-MM-yyyy** (e.g. `03-07-2026` = 3 July). ⚠️ URL format and response format differ — do not conflate.
- One row = one delivery drop. A trip = many drops sharing `tripno1` on the same `dis_date`. `tripno1 = "0"` = loose/non-trip drops (excluded from trip list).
- Cookie persists after one login — no re-login each pull.

---

## 2. Supabase table `trip_report`

- 38 columns, all `text` except `disDate` (date) and `fetchedAt` (timestamptz default now()).
- PK = `sourceId` (source row `ID`) → upsert by this, so re-pulling a day updates instead of duplicating.
- `disDate` stored as real date (date-picker filter key).
- Indexes: `(disDate)` and `(disDate, tripNo)`.
- Prisma model `TripReport`, `@@map("trip_report")`, camelCase, no `@map` on columns. Added by hand-editing schema.prisma + `npx prisma generate` (no db pull/push).

---

## 3. PowerShell puller (depot PC)

**Location:** moved OUT of the repo (holds secrets). Was `docs/Powershell/nts trip report/`, now outside — runs from its own folder, NOT repo root.

Files: `Pull-TripReport.ps1`, `settings.txt` (secrets — gitignored + moved out), `settings.example.txt`, `README.txt`.

**Behaviour:**
- Reads secrets from `settings.txt` (same folder): SUPABASE_URL, SUPABASE_SERVICE_KEY, LOGIN_URL, REPORT_URL_BASE. Split on FIRST `=` only (values contain `=`/`&`).
- Login once → hold cookie in WebSession → every **60 sec**: fetch today, filter, upsert.
- **Date built with escaped slashes** `Get-Date -Format 'MM\/dd\/yyyy'` — depot PC regional separator is `-`, so plain `/` produced dashes → malformed URL → 0 rows. Escaped slashes force literal `/`.
- **Convert-Date** parses source `dd-MM-yyyy` → stores `yyyy-MM-dd`.
- **Transporter filter:** keep only rows where `transporter` (trimmed, lowercased) == `nagadhiraj`. Drops MRC/HAND/deleted.
- Writes via Supabase REST (PostgREST) UPSERT: POST `/rest/v1/trip_report`, headers apikey + Bearer service_role, `Prefer: resolution=merge-duplicates,return=minimal`, body = JSON array of mapped rows.
- Logs to `log.txt`, masks secrets. PS 5.1 compliant (no ternary/??/ToHexString).

**Field mapping (source → column):** ID→sourceId, tripno1→tripNo, delivert_type→deliveryType, dis_date→disDate (converted), vehicle_no→vehicleNo, driver_name→driverName, mobileno→driverMobile, dl_route→dlRoute, deliveryno→deliveryNo, cust_name→custName, cust_area_name→custAreaName, sitename→siteName, site_area→siteArea, no_article→noArticle, dis_qty→disQty, net_weight→netWeight, tot_distibutor→totDistributor (source misspelling — read as-is), transporter→transporter, admin_name→adminName, diesel_amt→dieselAmt, etc.

⚠️ Puller must be RUNNING on the depot PC for live data. Not yet set up as a Task Scheduler job (parked).

---

## 4. API routes (login-gated, read-only, force-dynamic)

- `GET /api/trips?date=YYYY-MM-DD` → groups drops into trips (in JS, not SQL); excludes tripNo null/"0"; returns `{date, tripCount, trips[]}` with per-trip totals (qty, weight, dropCount, deliveryAreas). Defensive numeric parse (strings → 0 on blank/NaN). Includes `dieselAmt`.
- `GET /api/trips/[tripNo]?date=YYYY-MM-DD` → `{tripNo, disDate, header, drops[], totals}`. Header from first row; totals summed. Returns raw dlRoute/siteName/siteArea (page formats).
- Both require session (401 if none), no role gate on the routes themselves. Not in middleware public paths.

---

## 5. Pages

**`/trips`** (`app/trips/page.tsx` + `components/trip-report/trip-report-page.tsx`):
- Desktop: full-width table (matches shade-master board), date filter, Local/Up-Country segment.
  - Summary row order (text then numbers): Trip · Type · Time · Vehicle · Driver · Delivery Areas ‖ Drops · Qty · Weight · Diesel.
  - Details drops: # · Delivery No · Customer · Cust Area · Delivery Area/Site · Route · Tag(INV/PROMO) ‖ Articles · Qty · Net kg.
- Mobile: app-style — sticky teal bar, big 16px search (driver/trip/vehicle/area), day pill, Local/UPC pills, driver-first rounded cards (no vehicle no), Drops·Qty·Weight·Diesel strip. `block md:hidden` / `hidden md:block` split; desktop untouched.
- **Sidebar shell:** `/trips` wrapped in RoleLayoutClient (inlined into page.tsx, NOT a layout.tsx — a layout would cascade into the print sheet). Sidebar on desktop only; mobile full-width app style. Fixed the shared RoleLayoutClient phantom mobile gutter → `md:ml-[72px]` (only offsets where sidebar is visible — benefits all shell pages).

**`/trips/[tripNo]/sheet`** — A4 printable trip sheet (see §6). Full-page, NO sidebar (print).

---

## 6. A4 Trip Sheet (challan-matched, world-class)

Shared component `components/trip-report/trip-sheet-document.tsx` — prop-driven, used by BOTH the print route and the image-capture path (so they never drift).

Design = Delivery Challan's sibling (matched to real challan `components/tint/challan-document.tsx`):
- Header: JSW logo (real `/jsw-dulux-logo.png`, height 34, colour — NOT blacked out; the challan's greyscale rule targeted a stale class that never fired) in a bordered box · "TRIP SHEET" centered · trip no (mono) + date/time right.
- Dark slate address bar (#334155): "JSW Dulux · Surat Depot · Paint Distribution · Shiv Logistics Park…".
- Meta strip (bordered, order): Type · Vehicle No · Driver · Driver Mobile. NO diesel.
- Enclosed grid deliveries table: # · Delivery No · Customer · Delivery Area/Site · Qty · Net kg. NO Received column. Challan border weights (heavy #111827 top/bottom rules, faint #f0f0f0 blank-row borders). Blank filler rows to **MIN_ROWS = 20** (challan technique — table body).
- Totals row inside grid ("Total · N drops" + Qty + Net kg, real drops only).
- Bottom band (3 cells): Transport Details (Transporter Nagadhiraj + Vehicle + Driver, info only) | Dispatched By (sign) | Received By (sign). Transporter is a detail, not a signer (standing contractor).
- Footer: "Generated by OrbitOMS · JSW Dulux Surat Depot · This is a dispatch record, not a tax invoice." No registered-office line.

**Print rules (hard-won):**
- `@page trip-sheet { size: A4; margin: 10mm }` — TOP-LEVEL, never nested in @media print. Even 10mm all round (balanced margins).
- Print isolation via `visibility:hidden` on non-sheet, visible on sheet.
- Footer in NORMAL FLOW + blank rows fill table to ~one page = footer lands connected at bottom, no gap, no page-2 spill. (Fixed-position footer was tried and abandoned — caused a detached gap. The challan's real trick is blank-row fill, not positioning.)
- `break-inside: avoid` on ack band + footer (long trips: 0 blanks, table flows, band attaches at end, never splits).

---

## 7. WhatsApp image share (single trip)

- `lib/trip-report/share-sheet-image.ts` + `html-to-image` (only new dep).
- Renders `<TripSheetDocument>` into a hidden SAME-DOCUMENT div from in-memory `detail` data (NOT an iframe — iframe capture failed: html-to-image can't reliably capture cross-realm nodes). Awaits logo `.decode()` so it's not blank. Captures `.trip-sheet-inner` at pixelRatio 2.
- Mobile: `navigator.canShare({files})` → `navigator.share` with PNG + caption → user picks WhatsApp group.
- Desktop: downloads PNG (`TripSheet-{tripNo}-{date}.png`) + copies caption. (WhatsApp desktop needs install; phone-first feature.)
- Caption: `Trip {tripNo} · {date}\n{vehicle} · {driver}\n{dropCount} drops · Qty {qty} · {weight} kg`.
- Real errors now `console.error` + surfaced in toast (not swallowed).
- Image confirmed pixel-identical to print sheet.

---

## 8. Nav registration + access

- `trip_report` added as PageKey + PAGE_NAV_MAP entry ("Trip Report" → `/trips`, Route icon) in `lib/permissions.ts` + `components/shared/role-sidebar.tsx`. Flows via `buildNavItems()` + `role_permissions.canView` — no hardcoded roles.
- `logistics: "/trips"` added to ROLE_REDIRECTS in `lib/rbac.ts` (landing page).

**Live DB schema learned:**
- Roles table = `role_master` (id integer, NOT auto-increment — must specify id manually; next was 16). Columns: id, name, description. NO slug column.
- `role_permissions` links by `roleSlug` (text) = the role NAME. Columns: roleSlug, pageKey, canView/canEdit/canDelete/canImport/canExport, updatedAt.
- `user_roles` = many-to-many (userId, roleId, isPrimary). Users can hold multiple roles; extra rows add nav items without disturbing primary.
- `users`: app id is integer (also has Supabase-auth uuid + auth columns). Login = NextAuth credentials (email OR 10-digit phone), password **bcrypt** in `users.password`. Phone CHECK `^[0-9]{10}$`. Not Supabase Auth passwords.

**Access granted (live SQL):**
- New role **logistics** (id 16), granted `trip_report` canView only.
- 4 existing users added to logistics via `user_roles` (non-primary, keep their roles): Ajay Vansiya (29, dispatcher · 9099726849), Dhanraj Shah (30, dispatcher · 9727567705), Priya Chaudhari (31, support · 9978447358), Operations User (20, operations · operations@orbitoms.in).
- New user **Praveen** (id 33, praveen@orbitoms.in, phone 7600267202, bcrypt of `praveen7600`, primary role logistics) → sees ONLY Trip Report.
- Operations *role* NOT granted (only the 5 named users for now).

---

## 9. Mobile login fix (app-wide)

- **Cause:** `middleware.ts` had an attendance gate (lines ~69-96) that redirected EVERY authenticated request to `/attendance` until check-in. Not mobile-specific — fired right after login's ROLE_REDIRECTS redirect, so it looked mobile. No viewport/PWA check anywhere.
- **Fix:** removed the entire attendance-gate `if` block + unused `istDateString` import from middleware.ts. Login (mobile + desktop) now goes straight to the role's landing page via ROLE_REDIRECTS.
- Attendance module itself untouched — reachable directly, just no forced detour. Only 3 test accounts (admin/ops_admin) had the flag; no operational role relied on it. **This retires attendance auto-check-in app-wide.**

---

## Commits (all to main)

1. `Add Trip Report: read-only NTS trip mirror, /trips pages, A4 trip sheet, WhatsApp image share, nav registration` (15 files)
2. `Add logistics role login redirect to /trips`
3. `Wrap /trips in sidebar shell (desktop), fix phantom mobile gutter`
4. `Remove attendance check-in gate from middleware; login lands on role page`

---

## Parked / TODO

- **Puller as Task Scheduler job** (currently only runs while PowerShell window open).
- **Multi-select trips → combined PDF share** (single = image, done).
- **`.gitignore` UTF-16 `node_modules/` line** — saved wrong encoding, not matching. One-line fix.
- **Operations-role grant** — if widening access beyond the 5 named users.
- **Seed scripts** — trip_report not seeded; reseed won't affect it (puller-fed), but note it's puller-sourced.
- **Mobile app polish** — navigation + app-feel (next session; see separate doc).
