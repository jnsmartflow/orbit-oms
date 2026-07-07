# Session update — 2026-07-06 · Mobile shell + Trip Report overhaul + Puller mirror

Big session. Four workstreams, all shipped to main (except where noted). Read this before the
next Trip Report / puller session.

---

## 1. Mobile app shell (shipped, commit 1cace417)

Shared, role-aware mobile shell mounted once in `role-layout-client.tsx`, so **every** role page
inherits it on phones. Desktop sidebar untouched (`hidden md:flex`); shell is `block md:hidden`.

- **Bottom bar, 3 fixed anchors, identical for every user:** Home · Menu · You.
  - Home → `navItems[0]?.href` (user's primary page), teal-active on that path.
  - Menu → slide-up sheet listing every page the user can view, with a "Find a page" filter.
  - You → profile + Sign out (reuses the sidebar's existing `signOut({ callbackUrl: "/login" })`).
- Reuses the desktop `ICON_MAP` / `DEFAULT_ICON` (exported from `role-sidebar.tsx`) so icons match.
- Files: `components/shared/mobile-shell.tsx` (new), `role-layout-client.tsx` (mount + `pb-[76px] md:pb-0`),
  `role-sidebar.tsx` (export icon map).
- Approved mockup: `docs/mockups/mobile/index.html` (v3 — the Home/Menu/You version; the grey role
  switcher in it is a demo aid, not part of the app).
- Design history this session: rejected per-role bottom tabs → rejected drawer-only → landed on
  fixed Home/Menu/You anchors (variable pages live behind Menu). Reference mobile user: Praveen (logistics).

### Deferred (next mobile session)
- Shared minimal header + big search component (rolled in page by page later; each page keeps its own
  header for now, which is why `/trips` still looks right and wasn't disturbed).
- Shell rollout/polish across other role pages.
- PWA install (add-to-home-screen). Manifest + icons + root-layout metadata already exist;
  **no service worker exists** (never built). Do NOT reintroduce a middleware redirect to `/attendance`
  (the retired attendance gate) when building it.

---

## 2. Trip Report overhaul (shipped, several commits)

All in `components/trip-report/*`, `app/api/trips/*`, `app/trips/[tripNo]/sheet/page.tsx`,
`lib/trip-report/display.ts` (new shared helpers).

**Fixes shipped:**
- **Up-Country filter** — segment label "Up-Country" now maps to DB value `UPC` (was comparing label
  text to data; Local worked by luck). Nagadhiraj is mainly UPC + Local; IGT/Cross are rare and only
  show when no filter is active (accepted).
- **WhatsApp share caption redesigned** — clock emoji (calendar emoji showed a misleading baked-in
  number), driver **first name only** + mobile, unique-customer drops, **route/areas last** (comma-joined,
  unique). Vehicle no / qty / weight / diesel removed from caption. Null mobile → name only.
- **Drops = unique customers** (by `custCode`), not bill rows. Applied to list, detail, printed sheet,
  caption. Blank custCode rows each count as their own drop.
- **Delivery-area resolution rule** (`resolveDeliveryArea`): first non-empty of
  **Other Delivery Area → Site Area → Customer Area**. `Delivery Route` is ignored everywhere (Route
  column removed). Site Area matters only when there's a site and no other-delivery override.
- **Site with customer**: when `siteName` present, customer cell shows `"{siteName} · {custName}"`
  (detail table, mobile card, printed sheet).
- **INV/PROMO tag fix** — tag reads `promoType` value (`"PROMO"` only when it equals PROMO, else INV).
  Was showing PROMO on every row because the old code returned PROMO whenever the field was non-empty.
  Real split: ~72 INV / ~8 PROMO.
- **LT / KG column rename** (was Qty / Weight) everywhere.
- **LT + KG totals exclude PROMO rows** (INV-only). Drops + Articles totals still count ALL rows.
- **Articles column added to the printed trip sheet** (per-row + footer total, all rows).
- **Name casing** — customer + site names run through `smartTitleCase` (was mixed ALL-CAPS / proper).
- **Transporter label** on trip sheet: "Nagadhiraj Trans Service" → "Nagadhiraj Transport Service" (hardcoded).
- **Trip sheet address band** now matches the Delivery Challan: "Decorative Paints · Shiv Logistics Park,
  Block No.244, Kosmada, Surat, Gujarat 395006". NOTE: this is hardcoded on the sheet, but the challan
  pulls it from `system_config` (DB). They will DRIFT if the depot address is edited in admin. Wiring the
  sheet to the same DB source is deferred (bigger change — thread systemConfig into sheet page + share capture).
- **Sorting:**
  - Trip list = **newest first**: `disTime` DESC, tiebreak trip-no numeric part DESC (L42 above L41).
  - Detail rows (one shared helper `sortTripDropRows`, used by table + mobile + sheet + share image):
    **Delivery Area A–Z → Customer (custCode, adjacent) → Delivery No ASC.** A customer whose rows span
    two areas correctly splits across those areas (intended — different drop locations).

---

## 3. WhatsApp share logo — fixed (shipped)

Symptom: JSW Dulux logo missing **only** from the WhatsApp share image (fine on screen + PDF).
Root cause: the logo `<img>` used `width: "auto"` (only height set). html-to-image's foreignObject
serialization does NOT preserve intrinsic width on **mobile WebKit** (the `navigator.share` path), so it
collapsed to ~0 width = invisible. This failed for BOTH a URL src and a base64 data URI — which is why an
earlier data-URI attempt AND its revert both failed; they chased the wrong layer.

Fix: explicit **`width: 141, height: 34`** on the logo img (141 ≈ 34 × 800/193, same proportion as before,
screen/PDF unchanged) + `cacheBust: false` in `share-sheet-image.ts`. Confirmed working on real phone.
Lesson for future capture bugs: set explicit pixel dimensions on images inside html-to-image nodes.

---

## 4. NTS Puller → true mirror (fixed; DB + external script)

**The external puller** (`F:\VS Code\nts trip report\Pull-TripReport.ps1`, outside the repo, loops every 60s)
had two problems:
1. It only added/updated, never deleted — stale rows if NTS removed a delivery.
2. After we added a `(deliveryNo, disDate)` unique constraint, a plain upsert hit
   `ON CONFLICT DO UPDATE command cannot affect row a second time` because NTS sometimes sends the SAME
   delivery no multiple times in one batch → the whole push failed, **pushed 0 rows** (data stopped syncing).

**Root cause of the original duplicates:** the puller upserted on `sourceId` (NTS `ID`), which changes every
pull — so re-pulls inserted fresh copies instead of overwriting. A double-run on 2026-07-06 left 16 duplicate
rows (cleaned).

**What we did (all done):**
- **DB cleanup** (Supabase SQL Editor): deleted 16 older duplicate rows, keeping newest `fetchedAt` per
  `(deliveryNo, disDate)`.
- **Unique constraint** added: `trip_report_delivery_no_dis_date_key UNIQUE (deliveryNo, disDate)`.
  Mirrored into `prisma/schema.prisma` as `@@unique([deliveryNo, disDate], map: "...")` (hand-edited +
  `prisma generate`, per CORE §3 — no db push/pull). Committed.
- **Atomic mirror function** in Supabase: `mirror_trip_report_today(rows jsonb) returns integer`.
  - Guards: if incoming array is empty → does nothing (protects against an NTS glitch wiping today).
  - Dedupes incoming by `(deliveryNo, disDate)` keeping last occurrence.
  - Deletes today's rows (`disDate = target_date`) and inserts the new set **in one transaction** — so the
    trip list is never momentarily blank. Only today's date is ever touched.
  - `fetchedAt` omitted on insert (Postgres stamps `now()`); `sourceId` supplied from NTS.
- **Puller rewritten** (`Push-Rows`): now POSTs `{ rows: [...] }` to
  `/rest/v1/rpc/mirror_trip_report_today` instead of the table. Logs "mirrored N rows for today".
  Deployed on depot PC; verified: "mirrored 72 rows for today", duplicate check returns empty, 74→72 gap =
  dedupe working. **This .ps1 lives outside the repo — not in git.**

**Net result:** OrbitOMS `trip_report` is now an exact mirror of today's NTS data — adds, updates, and
deletions all sync every 60s; duplicates impossible; list never blank.

---

## 5. Environment / housekeeping (carried from 2026-07-05, still open)

- **Backup dev machine:** the depot/server PC is now a working dev machine (Node, git, VS Code, Claude Code).
  Git identity set global: `jnsmartflow` / `jnsmartflow@gmail.com`. Laptop (primary dev) still broken.
- **OneDrive git risk:** the `orbit-oms` folder is OneDrive-synced and shared with the (returning) laptop.
  Wait for the green check before running git; do NOT have both machines syncing the same folder long-term.
  `npm install` was needed after sync (OneDrive syncs `node_modules` incompletely).
- **~130 `-Dhruv` duplicate files + 3 stale deletions** are sitting untracked in the working tree
  (old copies from when this PC was Dhruv's machine). **Never `git add .` in this folder** — always add by
  explicit filename. Folder cleanup is still PARKED (do carefully: back up first, respect the OneDrive/laptop
  sync, decide if Dhruv's old work is needed). Deferred by Smart Flow until data + features settle.
- Pre-existing unrelated tsc errors in `app/trips/page.tsx:29-30` (attendanceTestUser/rolloutStage) fire
  across ~15 untouched files, rooted in `auth.config.ts` + the `-Dhruv` scratch files. Not ours; left alone.

---

## Open / next-session candidates
1. **Folder cleanup** — the `-Dhruv` duplicates + 3 deletions (parked, do carefully).
2. **Mobile shell rollout** — shared header + big search, page-by-page; then PWA install.
3. **Trip sheet address band** — wire to `system_config` so it doesn't drift from the challan (deferred).
4. Keep an eye on the puller first few days: confirm deletions mirror correctly and the "mirrored N" count
   tracks NTS.
