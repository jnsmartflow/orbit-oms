# CLAUDE_TRIP_REPORT.md — Trip Report Module
# v1.2 · Schema v27.24 · September 2026 · updated 2026-09-08
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Read-only mirror of Nagadhiraj Trans Service (NTS) trip/delivery data into OrbitOMS — a "photocopy on the wall, not a wire into the brain." Standalone: not connected to Orbit's orders/OBD workflow logic, even where delivery numbers overlap.

---

## 1. What Trip Report is [LIVE]

External trip software (Nagadhiraj) → PowerShell puller (depot PC) → standalone Supabase table (`trip_report`) → OrbitOMS shows a read-only trip list, per-trip detail, an A4 printable trip sheet, and a WhatsApp image share. One-way flow only — nothing in OrbitOMS writes back to NTS.

**Routes:**
- `/trips` — list (desktop full-width table; mobile app-style cards)
- `/trips/[tripNo]/sheet` — A4 printable trip sheet (full-page, no sidebar)

**Visual-spec ownership (locked 2026-08-04):** `/trips`' visual spec lives **in THIS file by design** — a named delegation from the UI design system (like `/floor`'s in `CLAUDE_FLOOR.md`); `CLAUDE_UI.md` carries only the wiring-table row. This closes the UI-pass MISSING flag.

**Access:** `trip_report` page key, view-only. Granted to the **`logistics`** role (new — see §7 CORE flag) plus 4 existing users individually added to `logistics` as a secondary role (primary roles untouched): Ajay Vansiya (dispatcher), Dhanraj Shah (dispatcher), Priya Chaudhari (support), Operations User (operations). One new user, **Praveen**, has `logistics` as his primary (and only) role — sees only Trip Report. The `operations` role itself is **not** granted — only these 5 named users, for now.

---

## 2. Data source + mirror model [LIVE]

**Source:** `nagadhirajtransservice.com`.
- Login (GET, session cookie): `/nts/API/chk_login.php?txt_mobile=<m>&txt_pwd=<p>&webpushid=`. Cookie persists after one login — no re-login each pull.
- Report (GET, needs cookie): `/nts/API/get_trip_report.php?txt_filterdate=MM/DD/YYYY%20-%20MM/DD/YYYY`.
  - ⚠️ **Date-format gotcha:** the URL filter is **MM/DD/YYYY** (literal slashes). The response's `dis_date` field is **dd-MM-yyyy** (e.g. `03-07-2026` = 3 July). URL format and response format differ — do not conflate them.
- One row = one delivery drop. A trip = many drops sharing `tripno1` on the same `dis_date`. `tripno1 = "0"` = loose/non-trip drops, excluded from the trip list.

**PowerShell puller:** `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1` — lives entirely **outside the repo** (holds secrets in `settings.txt`). ⚠ **Path corrected 2026-09-08.** This file said `F:\VS Code\nts trip report\…` from 2026-07 until then; `F:\` has no `VS Code` folder at all, and a recursive search of C:, D:, E: and F: found the script at the path above. A content search of every `.ps1` on all four drives for `mirror_trip_report_today` matched that one file and no other.
- 🔴 **It is inside a OneDrive-synced tree.** `settings.txt` holds the Supabase **service-role** key and the NTS login credentials, and OneDrive replicates all of it to Microsoft's cloud. That is a materially different risk from "a folder on a local drive", and it is the reason the old `F:\` framing mattered — it described somewhere unsynced. (`README.txt` beside it claims "settings.txt and log.txt are both in .gitignore"; that is **moot, not true** — the folder is outside the repository, so `.gitignore` never applies to it.)
- **Cadence: 61-62s idle, 63-65s on a busy day — NOT 60s.** The script's only timer is `Start-Sleep -Seconds 60` at `:320`, and it sleeps *after* the fetch and the push, so the real period is `60s + work`. Measured against production over a 300-second window on 2026-09-08: six consecutive mirror writes at 62, 62, 62, 62, 61s. `log.txt` on a 117-row day shows 63-65s. Any outage or write-volume arithmetic built on 60s over-counts by 3-7%.
- Date built with escaped slashes (`Get-Date -Format 'MM\/dd\/yyyy'`) — the depot PC's regional separator is `-`, so a plain `/` produced dashes → malformed URL → 0 rows. Escaped slashes force literal `/`.
- Source `dis_date` (`dd-MM-yyyy`) is converted and stored as `yyyy-MM-dd`.
- **Row filter — TWO conditions, not one** (`:300-304`). Keeps rows where `transporter` (trimmed, lowercased) `== "nagadhiraj"` **AND** `modi_inv` is not `FRT` (also trimmed/lowercased). Drops MRC/HAND/deleted rows via the first; freight rows via the second. ⚠ **The FRT exclusion was undocumented until 2026-09-08** — it is absent from the obsolete 2026-07-03 copy, so it was added some time before 2026-08-30 and never reached canon. It is counted and logged separately: `fetched 117, kept 98 (Nagadhiraj, FRT skipped 0), pushed 97`.
- ⚠ **`kept 98 → pushed 97` is normal, not a bug.** NTS sends one duplicate `deliveryNo` per cycle and the mirror function's dedupe absorbs it. Those two log numbers are the only trace it leaves.
- PS 5.1 compliant (no ternary/`??`/`ToHexString`). Logs to `log.txt`, secrets masked. ⚠ `log.txt` timestamps carry **`HH:mm:ss` only, no date**, and the file is never rotated (57,131 lines / 3.1 MB as of 2026-09-08) — you cannot tell which day a line belongs to without the filesystem mtime. Also: `pushed 0` means *both* "NTS sent nothing" and "the push failed"; only a separate `mirror failed:` line tells them apart.

### 2.1 History — how the mirror got its shape [KEEP: this is why the design looks odd]

**The July 2026 problem, and it was real.** The original puller upserted by `sourceId`, the row `ID`
NTS supplies. Re-pulls inserted fresh duplicate rows instead of overwriting. A
`(deliveryNo, disDate)` unique constraint was added to close that, and then a plain multi-row upsert
began hitting Postgres error `ON CONFLICT DO UPDATE command cannot affect row a second time` whenever
NTS sent the same delivery number twice in one batch — silently failing the **entire** push (0 rows
written, sync stopped). **The in-batch dedupe below is the fix for that, it is still load-bearing, and
it must never be removed.**

🔴 **CORRECTED 2026-09-08 — `sourceId` does NOT change on every pull. That claim was false, and it was
the premise the whole delete-and-refill design rested on.** This file asserted it in §2 and again in
§3 from 2026-07-06 onward. Measured against production:

- **74 of 74** `sourceId`s identical across two consecutive live mirror cycles.
- **6,779 rows carry 6,779 distinct ids**, spanning `137457…160757`, **ascending by `disDate` with no
  cross-day overlap** — the shape of a real global autoincrement, not a per-report sequence.
- Had ids genuinely been per-pull, the table could not have held 53 days of rows under a `sourceId`
  primary key without constant collisions. It has, from the beginning.

**Why this matters and is not a footnote.** The July diagnosis mistook "a re-pull inserts duplicates"
(true — it had no unique key yet) for "the id changes" (false), and delete-and-refill was chosen to
route around an id nobody could trust. Every later reader inherited that. It also decides whether an
**upsert** design is safe at all: if ids really were reissued, a new delivery could draw an id that an
unchanged — and therefore unwritten, therefore frozen — row still held, and collide on
`trip_report_pkey` with nothing to catch it. It cannot. **Do not rebuild on the old claim.**

### 2.2 The mirror function today — `mirror_trip_report_today(rows jsonb) returns integer`

Supabase Postgres function; the puller POSTs `{ rows: [...] }` to
`/rest/v1/rpc/mirror_trip_report_today`. One RPC call is one transaction, so all of the below commits
together and **the trip list is never momentarily blank**.

- **Empty guard.** A null or empty incoming array touches `trip_report` not at all and returns 0 — an
  NTS glitch can never wipe the day. It still stamps the heartbeat, because a cycle that legitimately
  fetched zero rows is a *live* puller.
- **Dedupe**, `DISTINCT ON ("deliveryNo","disDate")` keeping the LAST occurrence by ordinality. See
  §2.1 — this is the July fix and it is why the upsert below cannot raise "cannot affect row a second
  time".
- **Delete only what the batch no longer contains**, scoped to **every distinct `disDate` present in
  the batch**. Runs first, as its own statement.
- **Hash-gated upsert.** `ON CONFLICT ("deliveryNo","disDate") DO UPDATE … WHERE trip_report."rowHash"
  IS DISTINCT FROM EXCLUDED."rowHash"`. An unchanged row is **not written at all** — no heap tuple, no
  index entry, no dead tuple. `rowHash` is `md5` of the incoming JSON row **minus `sourceId`**
  (excluded because it is functionally dependent on `(deliveryNo, disDate)` and adds nothing to a
  content hash — *not* for the false reason in §2.1).
- **`fetchedAt` is set to `now()` only on a real change.** See §7's rule: it no longer answers "is the
  puller alive".
- **Skipped and counted**, never inserted: a row whose `disDate` is NULL (insertable but never
  deletable — equality never matches NULL) or whose `deliveryNo` is NULL/blank (the unique index
  treats NULLs as distinct, so the upsert would duplicate it every cycle where delete-and-refill used
  to wipe it). Zero such rows exist today; this is a guard.
- **Returns the DEDUPED ELIGIBLE ROW COUNT — deliberately NOT the changed count.** The puller is
  unchanged and logs `mirrored N rows for today`. Returning "changed" would print `mirrored 0 rows` on
  every quiet cycle, which is exactly what a real failure prints and indistinguishable from it to
  anyone reading `log.txt`. Changed / removed / skipped go to `mirror_heartbeat` instead.

**⚠ Delete-and-refill was the July 2026 answer and was REMOVED on 2026-09-08 for cost — do not
rediscover it as a fresh idea.** It worked, and it wrote every row of the day every ~62s round the
clock: measured 13,555 inserts / 13,438 deletes / **0 updates** on a ~100-row table, plus a 37-column
`CREATE TEMPORARY TABLE` built and dropped ~1,390 times a day. Over the first 8 live hours of the
replacement: **+110 inserts, +63 updates, +32 deletes**, against roughly 46,500 / 46,500 for the old
design. Steady state writes nothing. Schema version **v27.24**; plan of record
`docs/prompts/drafts/code-resume-2026-09-08-trip-mirror-rewrite.md`, evidence
`docs/prompts/drafts/code-discovery-2026-09-08-trip-mirror.md`.

The same pass closed two edges that had been unguarded since July: a batch spanning IST midnight
returns two dates, and the old `target_date := max("disDate")` cleared only the newer one while the
INSERT was unconditional — the older date then collided with `trip_report_delivery_no_dis_date_key`,
which had no `ON CONFLICT`, failing the **whole cycle**; and the NULL-`disDate` row described above.

**Net result, unchanged in substance:** `trip_report` is an exact mirror of today's NTS data — adds,
updates and deletions all sync every ~62s; duplicates are impossible; the list is never blank.

**Unique constraint:** `trip_report_delivery_no_dis_date_key UNIQUE(deliveryNo, disDate)` — prevents a delivery from duplicating within a day; mirrored in `prisma/schema.prisma` via `@@unique([deliveryNo, disDate], map: "...")` (hand-edited + `npx prisma generate`, no `db push`/`db pull`, per CORE §3).

### 2.3 Machine reality — re-established 2026-09-08

⚠ **Puller must be RUNNING on its host for live data**, and the mirror's DB rows remain the ground
truth of whether it is. **The mirror is live**: on 2026-09-08 it took a write every 61-62s throughout
a five-minute sample.

🔴 **But the host is NOT this machine, and it is not identified.** The 2026-09-08 sweep found: **no
`powershell.exe` process at all**, **no scheduled task** (`Get-ScheduledTask` matching
`Trip|Orbit|NTS|Pull|Import` returns only two *OrbitOMS Auto Import* tasks, both **Disabled**), no
autostart entry, and a local `log.txt` whose last line is `[09:05:24]` with a file mtime of
**2026-09-01** — seven days stale — while production stayed 60 seconds fresh the whole time. OneDrive
is running and the folder is synced, so a second machine working out of *this* folder would have
synced its log back; it has not, and there are no conflict copies. **The live puller runs elsewhere,
from a copy that is on none of this machine's drives.** See §7 [LANDMINE].

**Instance count: ONE.** Counting processes here cannot answer it, because the puller is not here.
Production can: the mirror stamps one identical `fetchedAt` per cycle, so each running instance
contributes one distinct stamp per ~62s. Six stamps in 300 seconds at 61-62s spacing, no interleaving
— a single series. Two instances would have produced twelve.

**The older framing, kept for the record:** this file said from 2026-08-04 that the script had "NO
repo copy (searched)" and that host-PC claims were "unverifiable from the depot PC". The first is true
in the strict sense — it is not *in the repo* — but it has been read as "not on this machine", and
there are in fact **two** copies on disk (§7 [LANDMINE]). The second is now settled, not unverifiable.

---

## 3. `trip_report` table

Standalone Supabase table. All columns `TEXT` except `disDate` (`DATE`) and `fetchedAt` (`TIMESTAMPTZ DEFAULT now()`). Prisma model `TripReport`, `@@map("trip_report")`, camelCase, no `@map` on individual columns. **39 columns** as of v27.24 — it was 38 until `rowHash` was added on 2026-09-08; the ones the build sessions actually touch are itemized below (full list: `prisma/schema.prisma`).

```
PK:  sourceId          NTS's own row ID. STABLE and globally unique — see the 2026-09-08
                       correction in §2.1. This line said "changes per pull" until then; it
                       does not. Still NOT used for dedup: (deliveryNo, disDate) is the
                       business key, and that is correct for its own reasons.
UQ:  (deliveryNo, disDate)   -- trip_report_delivery_no_dis_date_key

Full model, all 39 columns (verified against prisma/schema.prisma and information_schema — the
columns below are the authoritative live list, superseding any earlier partial account):

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
  fetchedAt           TIMESTAMPTZ DEFAULT now()  — since v27.24 this moves ONLY when the row
                                                   actually CHANGED. It is no longer a liveness
                                                   signal. See §7.
  rowHash             TEXT NULL  (v27.24, column 39) — md5 of the incoming JSON row MINUS
                                                   sourceId. The change gate for the upsert
                                                   (§2.2). NULL on any row written before
                                                   2026-09-08 and on any rollback; a NULL hash
                                                   simply forces one refresh and re-settles.
```

**Indexes — live names, and NEITHER is Prisma's default for its shape:**

| Live name | Columns | Note |
|---|---|---|
| `trip_report_pkey` | `(sourceId)` | PK |
| `trip_report_delivery_no_dis_date_key` | `(deliveryNo, disDate)` | UNIQUE; modelled WITH `map:` — correct |
| `trip_report_disdate_idx` | `(disDate)` | ⚠ Prisma's default would be `trip_report_disDate_idx` |
| `trip_report_tripno_idx` | `(disDate, tripNo)` | ⚠ Prisma's default would be `trip_report_disDate_tripNo_idx` — and the name says `tripno` while the index leads on `disDate` |

⚠ **Recorded 2026-09-08.** `prisma/schema.prisma` declares both as bare `@@index([disDate])` /
`@@index([disDate, tripNo])` **with no `map:`**, so Prisma believes names that do not exist. Columns
are right and nothing breaks at query time — Prisma does not read index names when querying — but by
CORE §7's own convention an index whose live name is not Prisma's default needs an explicit `map:`.
Adding those two `map:` arguments is **outstanding** (§7 [NEXT]); this pass is documentation only.

**Related objects (v27.24, both outside this table):** `mirror_heartbeat` — 7 columns
(`id` TEXT PK seeded with one row `'trip_report'`, `lastRunAt` / `lastChangedAt` Timestamptz(6),
`rowsSeen` / `rowsChanged` / `rowsRemoved` / `rowsSkipped` Int), Prisma model `MirrorHeartbeat`,
`@@map("mirror_heartbeat")`, zero relations, no RLS. And `trip_mirror_ping(p_rows integer) returns
void` — stamps liveness only, does no mirror work, **written for Phase B and currently uncalled** (the
puller cannot be changed until its host is named, §7).

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
- 🔴 **Name the host that runs the puller.** Blocks everything else on this list that touches the
  `.ps1`. See [LANDMINE] below.
- **Puller as a Task Scheduler job — the window-only claim is VERIFIED, no longer "unverifiable".**
  Checked 2026-09-08: **not** a scheduled task (`Get-ScheduledTask` matching `Trip|Orbit|NTS|Pull|Import`
  returns only two *OrbitOMS Auto Import* tasks, both **Disabled**), **not** an autostart entry
  (Startup folders hold only AnyDesk and a temp cleaner; `Run` keys hold only OneDrive, Adobe, Edge,
  SecurityHealth, Pantum), and its own `README.txt` says so in words: *"Close the PowerShell window to
  stop it. There is no 'stop' command — just close the window."* The item stands; only the uncertainty
  is gone. ⚠ Converting it to a scheduled task requires the host from the item above.
  *(Method note: `schtasks /query /v | findstr /i "TripReport nts trip"` LOOKS like it finds matches —
  `findstr` ORs space-separated terms, so `nts` matches "clie**nts**", "compone**nts**", "eve**nts**"
  in unrelated task comments. Not one hit is a task name. Use `Get-ScheduledTask` with `-match`.)*
- **Add `map:` to the two `@@index` lines in `prisma/schema.prisma`** so they name the indexes that
  actually exist — `trip_report_disdate_idx` and `trip_report_tripno_idx` (§3). Cosmetic today,
  real the first time anyone diffs the schema.
- **Operations-role grant** — if Trip Report access is ever widened beyond the 5 named users in §1.
- **Multi-select trips → combined PDF share** — single-trip image share is done; a multi-trip combined export is not built.
- **Puller mirror monitoring** — watch the first few days after the v27.24 rewrite (§2.2): confirm
  NTS-side deletions still mirror away (`mirror_heartbeat."rowsRemoved"`), that `rowsChanged` stays at
  0 on static data rather than equalling `rowsSeen` every cycle (which would mean the hash is
  unstable), and that the `mirrored N rows` log count keeps tracking NTS's true row count.
- **Wire an actual alert to `mirror_heartbeat`.** The table now answers "is the puller alive"; nothing
  yet *asks*. Until something does, the signal exists but only a human running a SELECT sees it.

**[DEFERRED]**
- **Trip sheet address band drift** — hardcoded on the sheet (§4) vs. `system_config`-sourced on the real Delivery Challan. Wiring the sheet to the same DB source is a bigger change (thread `systemConfig` into the sheet page + the share-capture path) — not done.
- **Mobile app polish** (navigation + app-feel) — tracked as a separate, non-Trip-Report-specific effort.
- **Seed scripts** — `trip_report` is not seeded; a reseed won't touch it (the table is puller-fed, not seed-fed), but note the distinction if a future seed script ever needs to reason about this table.

**[LANDMINE]**

- 🔴 **THE LIVE PULLER'S HOST IS UNKNOWN. Nothing may be deployed to the `.ps1` until it is named.**
  Established 2026-09-08. Production takes a mirror write every ~62 seconds, so *a* puller is running.
  It is **not** this machine: no `powershell.exe` process, no scheduled task, no autostart entry, and
  a local `log.txt` dead since **2026-09-01 09:05** while production stayed 60 seconds fresh. A
  content search of **every `.ps1` on C:, D:, E: and F:** for `mirror_trip_report_today` matched
  exactly one file — that stopped copy. OneDrive is running and the folder is synced, so a second
  machine working out of *this* folder would have synced its log back; it has not, and there are no
  conflict copies. **The consequence is the point:** a script edited here reaches no running process,
  the real one keeps running the old code, and the change *looks* shipped. This is why the 2026-09-08
  rewrite was built entirely on the Supabase side, with the puller's signature, payload and return
  value all unchanged. `trip_mirror_ping()` sits ready and uncalled for the same reason.
- ⚠ **An OBSOLETE SECOND COPY of the puller is still on disk, and it is the broken one.**
  `C:\Users\HP\OneDrive\VS Code\nts trip report\nts trip report\Pull-TripReport.ps1` (2026-07-03,
  10,759 B). It is the **pre-2026-07-06 version**: it POSTs to the raw table
  (`$url = $SupabaseUrl + "/rest/v1/trip_report"`, `Prefer: resolution=merge-duplicates`) — the exact
  path whose `ON CONFLICT DO UPDATE command cannot affect row a second time` failure the mirror
  function exists to replace (§2.1) — and it has **no FRT filter**. It still has a working
  `settings.txt` beside it. Opening the wrong folder resurrects a known-broken sync path. **Not
  deleted** (CORE §3: never delete files unless explicitly instructed) — an owner decision is owed.
- **Puller lives entirely outside the repo** —
  `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1`, secrets in
  `settings.txt`. Not tracked in git; any change must be manually deployed to whichever host actually
  runs it (see above). 🔴 And the folder is **OneDrive-synced**, so the Supabase service-role key and
  the NTS credentials replicate to Microsoft's cloud (§2).
- ✅ **CLOSED 2026-09-08 — "No alert if the puller stops".** `mirror_heartbeat` now records it.
  **THE NEW RULE, and it inverts what everyone has done until now:**
  > **`mirror_heartbeat."lastRunAt"` means THE PULLER RAN.**
  > **`trip_report."fetchedAt"` means THE DATA CHANGED.**

  Before v27.24 every row was rewritten every cycle, so `fetchedAt` moved constantly and doubled as a
  liveness signal — that is how this file's own 2026-08-04 note proved the puller was running, and how
  the 2026-09-08 discovery did. **From now on that check is WRONG**: on a quiet day nothing changes,
  `fetchedAt` legitimately stops moving, and a stale `fetchedAt` no longer implies a dead puller.
  Anything judging staleness by `fetchedAt` must be repointed at `lastRunAt`. `lastChangedAt` is the
  separate question — "is the data moving" — and `rowsSeen`/`rowsChanged`/`rowsRemoved`/`rowsSkipped`
  carry the per-cycle counts that no longer fit in the return value (§2.2).
  ⚠ Still only *recordable*, not *alerting* — nothing polls it yet ([NEXT]).
- **`.gitignore` has a UTF-16-encoded `node_modules/` line** that doesn't actually match (wrong encoding saved) — a one-line fix, parked, unrelated to the mirror rewrite but noticed during this work.

---

## 8. Key files index

| File | Role |
|---|---|
| `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1` (outside repo, OneDrive-synced) | The puller — cadence **61-65s**, not 60s; filters on transporter **AND** `modi_inv != FRT`; POSTs `{rows:[…]}` to `mirror_trip_report_today`. 🔴 **The host that actually runs it is UNKNOWN** — §7 [LANDMINE] |
| `C:\Users\HP\OneDrive\VS Code\nts trip report\nts trip report\Pull-TripReport.ps1` | ⚠ **OBSOLETE, DO NOT RUN** — pre-2026-07-06 copy that POSTs to the raw table with `resolution=merge-duplicates`, the broken path the mirror function replaced. Still has a live `settings.txt`. Not deleted — §7 [LANDMINE] |
| `mirror_trip_report_today` (Supabase Postgres function) | **v27.24, rewritten 2026-09-08.** Dedupe → delete only rows absent from the batch (scoped to every date in it) → hash-gated upsert on `rowHash` → stamp heartbeat. One transaction. Returns the deduped eligible count, NOT the changed count (§2.2) |
| `mirror_heartbeat` (Supabase table) | Liveness. `lastRunAt` = the puller ran; `lastChangedAt` = the data changed; plus `rowsSeen`/`rowsChanged`/`rowsRemoved`/`rowsSkipped` |
| `trip_mirror_ping(p_rows integer)` (Supabase function) | Stamps liveness only, no mirror work. Built for Phase B; **uncalled** until the puller's host is named |
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

## Change log — v1.2 (2026-09-08, the v27.24 mirror rewrite + a machine-reality pass)

Evidence: `docs/prompts/drafts/code-discovery-2026-09-08-trip-mirror.md` (machine sweep + read-only
SELECTs) and `docs/prompts/drafts/code-resume-2026-09-08-trip-mirror-rewrite.md` (the plan, §8 of
which is the correction list this pass applies). Shipped as commit `88bf9926`.

- 🔴 **TRP-6 (§2.1, §3): "`sourceId` changes on every pull" is FALSE and is now corrected in both
  places it appeared.** 74/74 identical across two consecutive live cycles; 6,779 rows / 6,779
  distinct ascending ids, no cross-day overlap. Recorded loudly because it was the stated premise of
  the entire 2026-07-06 delete-and-refill design, and because it decides whether an upsert is safe at
  all. The same false claim also sat in `CLAUDE_CORE.md §7.11` and was fixed there in this pass.
- **TRP-7 (§2): §2 split into §2.1 history / §2.2 the function today / §2.3 machine reality.** The
  July history is KEPT deliberately — the in-batch dedupe only makes sense next to the
  "cannot affect row a second time" failure it was written for. Delete-and-refill is explicitly
  recorded as the July answer, removed 2026-09-08 for cost, so it is not rediscovered as a new idea.
- **TRP-8 (§2, §7, §8): puller path corrected** to
  `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1`. `F:\VS Code\…` does not
  exist. Added the OneDrive-sync risk note — the service-role key replicates to Microsoft's cloud.
- **TRP-9 (§2): the row filter has TWO conditions**, not one — `modi_inv != 'FRT'` was undocumented.
  Plus the `kept 98 → pushed 97` dedupe trace and the `log.txt` defects (no date, never rotated,
  ambiguous `pushed 0`).
- **TRP-10 (§2, §8): cadence is 61-62s idle / 63-65s busy**, not 60s — `Start-Sleep` runs *after* the
  work. Measured against production.
- **TRP-11 (§3): 38 columns → 39** (`rowHash`, column 39). `mirror_heartbeat` and `trip_mirror_ping`
  recorded. **Live index names added** — `trip_report_disdate_idx` and `trip_report_tripno_idx`,
  neither of which is Prisma's default; the missing `map:` arguments are logged as [NEXT].
- **TRP-12 (§7): "No alert if the puller stops" CLOSED**, with the rule stated in the strongest form —
  `lastRunAt` means the puller ran, `fetchedAt` now means the data changed. Every prior staleness
  check, including this file's own 2026-08-04 proof, used `fetchedAt` and is wrong from now on.
- **TRP-13 (§7): Task Scheduler item upgraded from "unverifiable" to VERIFIED** (not a task, not an
  autostart entry, README says close the window), with the `findstr` false-positive trap recorded.
- **TRP-14 (§7): two new landmines** — 🔴 the live puller's host is UNKNOWN and blocks every `.ps1`
  change; and an obsolete pre-2026-07-06 copy is still on disk with a working `settings.txt`, POSTing
  to the raw table. Not deleted (CORE §3).
- Verified CORRECT, no change: §1 access, §4 display rules, §5 print sheet, §6 share mechanism.
- Schema stamp v27.13 → **v27.24** — earned by this reconciliation, not a tidy-up (router §4).

---

## Change log — v1.1 (2026-08-04 reconciliation pass, method v1.1)

Evidence: read-only SELECT (freshness + column count), globals.css + share/display files, CORE v91 §5. Claim IDs from the session report.

- TRP-1 (§2/§7): puller machine-reality framed — no repo copy exists; host-PC claims marked unverifiable; the mirror proven RUNNING by SELECT (116 rows today, seconds-fresh `fetchedAt`).
- TRP-2 (§1): the visual-spec ownership line added (named delegation, like `/floor`) — closes the UI-pass flag.
- TRP-3 (§3): 38-column claim verified exact against `information_schema` (38/38).
- TRP-4 (§5): `@page trip-sheet` verified top-level in `globals.css` (`:24`) with id-scoped visibility isolation (`:642`) — never nested in `@media print`.
- TRP-5 (header/footer): dates added at both ends (the file had none).
- Verified CORRECT, no change: §1 access (logistics + 4 secondary users + Praveen — CORE §5 re-verified 2026-08-04; the dispatcher mentions are the live ROLE, kept), §4 display rules, §6 share mechanism + logo-capture fix, §7 landmines.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*Trip Report v1.2 · Schema v27.24 · OrbitOMS · updated 2026-09-08 — the v27.24 mirror rewrite recorded and ten corrections applied. 🔴 Two things a future session must not re-learn the hard way: **`sourceId` does NOT change per pull** (that was the false premise the whole 2026-07-06 delete-and-refill design rested on, §2.1), and **`fetchedAt` is no longer a liveness signal** — `mirror_heartbeat."lastRunAt"` is (§7). Delete-and-refill was the July answer and was removed 2026-09-08 for cost; the July history is kept in §2.1 because the dedupe rule only makes sense beside the failure it was written for. Puller path, the undocumented `modi_inv='FRT'` filter, the real 61-65s cadence, the 39th column and the two live index names all corrected. 🔴 **The host running the live puller is UNKNOWN and blocks every `.ps1` change** (§7). Prior, v1.1 (2026-08-04): reconciliation pass — machine reality framed, visual-spec ownership locked, 38-column claim verified, `@page trip-sheet` verified top-level.*
