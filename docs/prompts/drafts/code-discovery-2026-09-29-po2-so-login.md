# Code discovery — /po2 → private SO order page (OTP login, prices, PO number, direct submit)
# 2026-09-29 · DISCOVERY ONLY — no code written, no file edited, no SQL run, nothing committed

Files read: CLAUDE.md (router v1.13), docs/CLAUDE_CORE.md (**v112 · Schema v27.42**), docs/CLAUDE_UI.md (v5.35, no schema stamp by design),
docs/CLAUDE_PO2.md (v1.0 · Schema v27.24, all), docs/CLAUDE_PLACE_ORDER.md (v1.9 · Schema v27.24 — §2, §11, §16),
docs/CLAUDE_MAIL_ORDERS.md (v1.14 · Schema v27.24 · Parser v7.3.0 · Enrichment v3 — §1, §2, plus code),
docs/CLAUDE_IMPORT.md (v1.11 · Schema v27.24 — the order-creation/enrichment parts), docs/ROADMAP.md (section "`/po2` — the v2 order page").
Stamp lag (v27.24 vs CORE v27.42) is normal per router §4 item 4; nothing is newer than CORE.

Code read at HEAD `1ccdb84b` (working tree has unrelated uncommitted floor/trips edits from another session; none touch the files below).

**Doc-vs-code disagreements found (code wins):**
1. `CLAUDE_MAIL_ORDERS.md §1` (line 20) and §6 still show `delivery-match.ts (ship-to override)` running at ingest. Since `7a54c8c9` (2026-09-29) ingest hard-codes `shipToOverride: false, shipToOverrideCustomerId: null` (`app/api/mail-orders/ingest/route.ts:310, 342-344`) and `matchDeliveryCustomer` (`lib/mail-orders/delivery-match.ts:41`) has **zero callers** (grep of app/ lib/).
2. `app/api/place-order/data/route.ts:11-14` says it "requires authenticated session". There is **no `auth()` call in the handler**; it is protected only by middleware's "any session" redirect (`middleware.ts:78-80`). Any logged-in account of any role can read it.
3. `CLAUDE_PLACE_ORDER.md §11` mentions "the Resend path `:2034`" in `/po` — that is a **"Resend order" button** (`app/po/po-page.tsx:2027 resendFromReceipt`), not the Resend email library. No email library exists (§B).

---

## A. Current auth

**How login works today**
- `auth.config.ts` (Edge): `providers: []` (`:59`), `session.strategy: "jwt"` (`:61`), Edge `jwt` copies `id/role/roles` (`:64-71`), `session` callback copies id/role/roles, `isSuperuser === true` (`:81`) and the attendance claims (`:72-93`). `signIn` page `/login` (`:96`). Session type augmentation `:7-49`: `user.id: string, role: string, roles: string[], isSuperuser?`.
- `lib/auth.ts` (Node): spreads `authConfig`, overrides `jwt` only (`:90-183`), and adds the single **Credentials** provider (`:184-233`):
  - input `email` accepts email or a 10-digit phone (`:197-203`), looked up in `users` with `role` + `userRoles.role` (`:200-208`);
  - rejects `!user.isActive` (`:210`), bcrypt compare on `users.password` (`:212`);
  - role slugs normalised from `role_master.name` (`:217-221`); returns `{ id: String(users.id), email, name, role, roles, isSuperuser }` (`:223-230`).
  - The Node `jwt` callback **parses `token.id` as a `users.id` integer** and reads that `users` row for `isSuperuser` + attendance flags (`:127-135`, refresh `:154-166`, `fetchUserAttendanceFlags :34-57`).
- `middleware.ts`: builds `auth` from the Edge config (`:6`); public prefixes (`:8-29`, `startsWith` at `:36`); otherwise **any** session passes (`:78-82`). Middleware checks no role and no page key.
- Page/API access: `user_page_access` per (user, page key) when `system_config.ACCESS_SOURCE = 'user'` (CORE §5, `lib/access/source.ts`); superuser = `isSuperuser === true` OR role `admin` (`lib/rbac.ts:104-111`); `requireSuperuser` redirects to `/unauthorized` (`lib/rbac.ts:125-129`).

**Is a sales officer a `users` row?** No. `sales_officer_master` (`prisma/schema.prisma:745-758`) has no password, no role, and no FK to `users`; `users` (`:111-119`) has no FK to SOs. Nothing in code joins `sales_officer_master.email` to `users.email` (only admin CRUD touches SO email: `app/api/admin/sales-officers/route.ts:23-61`, which lowercases and pre-checks uniqueness). The only possible bridge is an email text match.

**Can OTP be added? Two options — owner to choose.**

| | Option 1 — second NextAuth provider (e.g. Credentials `"so-otp"`: email + code) | Option 2 — separate lightweight SO session (own signed cookie, own tables, checked in the new routes only) |
|---|---|---|
| Staff login | Touches `lib/auth.ts` (the file every staff login runs through) and the shared JWT/`session` callbacks | Untouched. Zero edits to `lib/auth.ts` / `auth.config.ts` |
| 🔴 id-space | `token.id` is read as a `users.id` (`lib/auth.ts:127-135, 154-166`). An SO id `5` would pick up **users #5's `isSuperuser` and flags**. Must be namespaced (e.g. `"so:5"` → `parseInt` → NaN → early return at `:128`/`:156`) and every consumer of `session.user.id` must tolerate it | No shared id space |
| Blast radius | A signed-in SO holds a real NextAuth session → **middleware admits them to every non-public route** (`middleware.ts:78-82`), and any route guarded only by middleware (e.g. `/api/place-order/data`, see disagreement 2) is readable. Safety then depends on every page/API gate refusing a role with no ticks — CORE §13's silent-403 and `requireRole` notes show that is not uniformly true | SO cookie is meaningless to NextAuth; SO cannot reach staff pages at all |
| Cookie clash | One NextAuth cookie per browser: an SO and a staff login on one phone overwrite each other | Independent cookies |
| Effort | Less new code; reuses `signIn`/`signOut` | More new code: code issue/verify, cookie signing (`jose` is already a next-auth dependency), expiry, logout |
| Middleware | No change | Final SO page would need a middleware branch (the SO page must not bounce to `/login`). **Not needed for the test phase** — the owner has a staff session |

Recommendation: **Option 2**, with the test page additionally behind the owner's superuser session (two locks). Either option needs new tables (Smart Flow SQL): an OTP table (email, **hashed** code, expiresAt, attempts, usedAt, requestedIp) and, for Option 2, optionally a session table for server-side revocation. There is no rate-limit helper in the repo; attempt/resend limits must live in that table.

## B. Sending the OTP email

**Nothing exists. The server sends no email today.**
- `package.json`: none of nodemailer / resend / @sendgrid / postmark / googleapis / @microsoft/* / @azure/msal-node / aws-sdk / mailgun. Related packages present: `@supabase/supabase-js` (`:24`, storage only, service-role client `lib/supabase.ts:1,32`, no `signInWithOtp` anywhere), `next-auth` v5 beta (`:33`), `web-push` (`:42`).
- Every "send" in the app is a client `mailto:` (`app/po/po-page.tsx:1959,2034`; `app/po2/v2-email.ts:109`; `lib/place-order/email.ts:284`; `app/(mail-orders)/mail-orders/slot-completion-modal.tsx:116`). `mailto:admin@orbitoms.in` in `lib/push/send.ts:36` is only the VAPID subject.
- Env var **names** (values not read): `.env` — DATABASE_URL, DIRECT_URL. `.env.local` — DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET, AUTH_SECRET, NEXTAUTH_URL, IMPORT_HMAC_SECRET, SAP_IMPORT_ENABLED, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. No SMTP/mail variable. (`MAIL_ORDER_HMAC_SECRET`, read at `app/api/mail-orders/ingest/route.ts:23`, is in neither local file — presumably Vercel only.)
- The inbox is read on the depot PC through **Outlook COM/MAPI** (`docs/Parser/Parse-MailOrders-V7.ps1:1159-1197`; `docs/Powershell/0-FrtIngestion.ps1:160-180`). It could `MailItem.Send()` only from that PC while Outlook runs — **not usable from Vercel**.

**What would be needed:** a provider (Resend, AWS SES, SMTP via nodemailer, or Microsoft Graph Mail.Send with an Entra app registration), its secret as a new Vercel env var (e.g. `RESEND_API_KEY` or `SMTP_HOST/PORT/USER/PASS`), and a verified sender domain (SPF + DKIM on `orbitoms.in`, or send from an existing mailbox via Graph/SMTP).
**Unblocker for the first test:** the owner-only test page can issue the code and **show it on screen** (never in a public route) — this tests "does this email exist as an active SO, is the code hashed/expired/attempt-limited, does the session work" before any provider is chosen.

## C. Sales officer data

- `sales_officer_master` (`prisma/schema.prisma:745-758`): `id` PK, `name`, `employeeCode` (NOT unique), **`email String? @unique`** (`:749`), `phone String?` (not unique), **`isActive Boolean @default(true)`** (`:751`), `createdAt`. Relations: `deliveryPoints` (legacy single-SO FK), `groups`, `samplingRegisterEntries`, `customerLinks` ("CustomerSOLinks"), `contactLinks`.
  - ⚠ Postgres `@unique` is **case-sensitive**. Admin writes lowercase (`app/api/admin/sales-officers/route.ts`), but rows written by SQL/import could differ only by case — the SQL below checks `lower(btrim(email))` duplicates. OTP lookup must compare lowercased/trimmed.
- `sales_officer_group` (`:760-769`): `name @unique`, `salesOfficerId`, `isActive`; `delivery_point_master.salesOfficerGroupId` (`:826-827`) is classification-only now (CORE §7.1).
- `customer_sales_officers` (`:876-892`): `customerId` → `delivery_point_master` (Cascade), `salesOfficerId` → SO, `role CustomerSalesOfficerRole @default(PRIMARY)` (enum `PRIMARY|BACKUP|JUNIOR`, `:55-59`), `contactDismissed`, timestamps. `@@unique([customerId, salesOfficerId])`, `@@index([salesOfficerId])`, `@@index([customerId, role])`; DB-only partial unique `customerId WHERE role='PRIMARY'` (`customer_sales_officers_customerId_primary_key`, `lib/customers/so-sync.ts:161`).
- Legacy `delivery_point_master.salesOfficerId` (`:811-812`) is deprecated (`lib/customers/so-sync.ts:15-20`).

**Limiting the dealer picker to the SO's customers — data path only, no decision:**
`sales_officer_master.id` (from the OTP session) → `customer_sales_officers.salesOfficerId` (indexed; optionally filter `role`) → `delivery_point_master.customerCode` (unique, `:805`) → the picker list. Today's picker source `/api/order/data` reads **`mo_customer_keywords`** (`app/api/order/data/route.ts:33-35, 64-79`), which has **no SO column** (`schema.prisma:2308-2317`) and is joined to `delivery_point_master` only by the code string. A customer with no SO link would vanish from a filtered picker — coverage must be measured before filtering (SQL below counts SOs with ≥1 link).

## D. Prices

**No price source exists.** Schema grep for price/rate/mrp/dpl/amount/cost/tariff/value hits only non-catalogue columns: `system_config.value` (`:68`), `dispatch_change_queue.previousValue/newValue` (`:1673-1674`), `TripReport.tRate` (freight, from NTS, `:2582`), `ci_returns.ciValue` (hand-typed return value, `:3186`). Catalogue tables have none: `sku_master` (`:470-488`), `mo_sku_lookup_v2` (`:2240-2258`), `sku_master_v2` (`:2284-2306`), `mo_order_form_index_v2` (`:2387-2412`). The SAP import carries quantity/weight/volume only (`CLAUDE_IMPORT.md:139-187`; import tables `schema.prisma:915-995`). "DPL" appears only as a remark tag ("Share DPL", `lib/mail-orders/customer-match.ts:31-32`, `lib/hide/tag-catalog.ts:69`). docs/SKU files have no price column. **Owner must supply the price source.** Natural key: SAP `material` — every /po2 pack already carries it (`ApiPack.material`, `app/po2/v2-data.ts:164`).

## E. PO number

- **No PO/reference column exists** on `mo_orders` or `orders` (grep for poNumber/reference/customerPo is empty). Nearest: `mo_orders.soNumber` (`:2100`, typed by billing at punch), `mo_orders.emailEntryId String @unique` (`:2124`, Outlook EntryID), `orders.soNumber` (`:1047`, from SAP), `orders.obdNumber @unique` (`:1019`). A PO number needs a **new column** (e.g. `mo_orders.poNumber` UNIQUE) or a new header table — schema change via Smart Flow.
- **Patterns to copy (none use a sequence or counter table; all are highest+1 → UNIQUE index → catch P2002 → retry, sequential awaits, no `$transaction`):**
  - CI — `CI-{YYYY}-{5}` `lib/ci/number.ts:34, 75-95`, clock passed in; `ciNumber @unique` (`:3118`); re-allocate once on P2002 (`app/api/ci/[ciId]/submit/route.ts:54, 294, 338`).
  - MRN — `MRN-{YYYY}-{5}` `lib/mrn/number.ts:81-120` (includes soft-removed rows so numbers are never reused, `:7-23`); whole allocate+insert retried up to 3× then 409 (`app/api/mrn/create/route.ts:144-171`).
  - Floor trips — lowest-free seq per day/type, partial unique + CHECK (`lib/trips/number.ts:33-49, 204, 246-264, 298-313`).
  - Tint challans — `CHN-{YYYY}-{5}` by latest `id` (`app/api/import/obd/route.ts:1543-1553, 764-801`) — **don't copy**: does not restart per year, reads the UTC server clock.
- Best template: `lib/ci/number.ts` allocator + MRN's 3-attempt whole-operation retry.

## F. Direct submit into Orbit

**Today's path**
1. `/po2` `handleSend` (`app/po2/po-v2-page.tsx:1104`) → `buildV2Email` (`app/po2/v2-email.ts:48-100`: `renderOrderBody`, `buildSubject`, `emailLineLabel` from `lib/place-order/email.ts:122-143, 192-209, 154`) → `window.location.href = mailto:ORDER_TO` (`po-v2-page.tsx:1110`; `v2-email.ts:108-110`; `ORDER_TO` `email.ts:61`, no CC).
2. `surat.depot@akzonobel.com` auto-forwards to `surat.order@outlook.com` (`CLAUDE_MAIL_ORDERS.md:12` — docs only, unverifiable from code).
3. **PowerShell parser on the depot PC** (`docs/Parser/Parse-MailOrders-V7.ps1`; live copy outside git): Outlook COM poll (`:1159-1200`); `Classify-Email` (`:1210-1240`); app-format body → `Parse-AppBody` (`:1709-1936`, via `Test-IsAppFormat :1938`); header labels (`:1788-1840`); lines; bill split (`:2414-2476`); dispatch mapping (`:2242-2247`); `Build-BillRemarks` (`:2260`); "Code: NNN" appended to remarks (`:2266-2270`); `Send-ToApi` HMAC POST (`:1975-2108`).
4. **Server** `POST /api/mail-orders/ingest` (`app/api/mail-orders/ingest/route.ts:68-468`, HMAC `:22-33, 73`, middleware bypass `middleware.ts:60`): dedup (`:95-100`) → keyword/SKU maps (`:103-133`) → Table C (`:139`) → `parseSubject` (`:142`) → `matchCustomer` subject then body (`:162, 166-192`) → learned customers (`:195-298`, inline) → remarks (`:311-316`) → junk filter (`:319-324`) → **`mo_orders.create`** (`:327-351`) → per line `enrichLine` + carton multiply + **`mo_order_lines.create`** (`:355-412`) → **`mo_order_remarks`** (`:415-449`) → `matchedLines` update (`:452`).
5. **Ship-to:** not applied at ingest since 2026-09-29 (above). Set only by the Billing pencil or Floor.
6. **Slots are not stored** — computed at render from `receivedAt` (`getSlotFromTime`, `lib/mail-orders/utils.ts:87-110`; `groupOrdersBySlot :539`). **Tags are not stored** — `getOrderSignals` regexes over `remarks + billRemarks + deliveryRemarks` (+ subject for Truck) at render (`utils.ts:724+`), filtered by tag settings.
7. **Billing** reads `mo_orders` by IST day of `receivedAt` (`app/api/mail-orders/route.ts:105-115`); marker keys on `MAX(updatedAt)` (`marker/route.ts:108-111`); SO typed at `[id]/so-number/route.ts:38, 61-67` → `status='punched'`.
8. **Floor**: an `orders` row exists only after SAP/OBD import, which calls the file-private `applyMailOrderEnrichment` (`app/api/import/obd/route.ts:246`; matches `mo_orders.soNumber` newest-first `:258-261`; copies dispatchStatus, priority, remarks, slot intent, orderDateTime, slots `:280-345`, update `:353`; ship-to fill-only `:362-376`; bill-only hold `:378+`; call sites `:1494, 2065, 2622, 3953`).

**Entry point a direct submit would call: there isn't one.** The server half is inline in the ingest `POST` handler (not exported) and HMAC-gated — a browser can't call it without leaking `MAIL_ORDER_HMAC_SECRET`. The other half (pack/qty parse, dispatch→Hold/Urgent, remark typing, `billRemarks`, "Code:" append) exists **only in PowerShell**. Exported helpers it uses, with verified call sites:

| Helper | Defined | Call sites |
|---|---|---|
| `parseSubject` | `lib/mail-orders/customer-match.ts:52` | ingest `:142` |
| `matchCustomer` | `customer-match.ts:294` | ingest `:162, 177`; `backfill-customers/route.ts:41` |
| `enrichLine` | `lib/mail-orders/enrich.ts:380` | ingest `:359`; `backfill-enrich:93`; `debug-enrich:63`; `re-enrich:100` |
| `buildSkuMaps` / `buildProductProfiles` / `buildKeywordRegexes` | `enrich.ts` | ingest `:131-133` |
| `buildTableCContext` | `lib/mail-orders/table-c-context.ts:29` | ingest `:139` |
| `isSignatureJunk` | `lib/mail-orders/note-junk.ts:51` | ingest `:322, 419, 437` |

(`enrich-v2.ts:232` also exports an `enrichLine`; ingest imports `enrich.ts`.)
What a direct submit actually needs, given /po2 already holds structured data: **exact** customer code (no fuzzy match → `customerMatchStatus='exact'`), exact SAP `material` per pack (no `enrichLine` guessing), `receivedAt = submit time` (slot follows), and remark text written in the literal forms `getOrderSignals` recognises (so tags appear). So the likely shape is a **new server function in a new folder** that writes `mo_orders` + `mo_order_lines` + `mo_order_remarks` directly — not a call into ingest. `applyMailOrderEnrichment` runs later at SAP import and needs no change.

**Every field the email carries and where it lands today**

| /po2 field (source) | Today in DB | Status |
|---|---|---|
| Subject `Order/Truck/Bounce/DTS/Cross Billing Order From X — Name Code` (`buildSubject`) | `mo_orders.subject`; subject remarks → `mo_order_remarks` (lineNumber 900+) | kept |
| Bill To `Name (Code)` (`v2-email.ts:57-59`) | input to fuzzy `matchCustomer` → `mo_orders.customerCode/Name/customerMatchStatus`; "Code: NNN" into `remarks` | **exact code not trusted** — re-matched |
| Ship To `Name (Code)` (`:61-64`, only if ≠ bill-to) | free text in `mo_orders.deliveryRemarks`; flag/FK forced false/null (`ingest:342-344`) | **LOST as structure** |
| Dispatch Urgent | `dispatchPriority='Urgent'` → `orders.priorityLevel=1` | kept |
| Dispatch Call to SO/Dealer (`:66-69`) | `dispatchStatus='Hold'`; target only in a `mo_order_remarks` row (`ps1:1818-1823`), not in `mo_orders.remarks` → never reaches `orders.remarks` | **target partly lost** |
| Remark Truck/Bounce/DTS (`:73-78`) | `mo_orders.remarks` + `mo_order_remarks`; Truck & Bounce get badges, **DTS has no badge** | free text |
| **Cross depot** (`:72-74`) | 🔴 **Never ingested**: the parser SKIPS any subject containing "Cross Billing Order" (`ps1:1225` `$badKeywords = @("Site Order","Cross Billing Order")`, used `:1226-1227`) — repo copy; live copy unverified. Even if ingested, the badge regex `cross\s*billing\s*(\w+)` (`utils.ts:745-746`) would read "Cross FROM" | **LOST (whole order)** |
| Notes (`:80`) | `mo_orders.remarks` + `mo_order_remarks` (`ps1:1829-1834`); `mo_orders.notes` stays null | free text |
| Salesman | no body field; `soName` = Outlook SenderName or forwarded "From:" (`ps1:1721-1740`); `soEmail` always null (`ps1:2067`) | **no sender stamp** (`CLAUDE_PO2.md §11`) |
| Order time | `receivedAt` = mail receive / forwarded "Sent:" | kept |
| Lines (`:82-88`) | `mo_order_lines.rawText/packCode/quantity/isCarton`; SKU re-derived by `enrichLine`/Table C | **/po2's exact `material` LOST** |
| Marker (`V2Marker`, `v2-data.ts:1788`) | only as the remark/subject text above | free text |

Always null on this path: `soEmail`, `notes`, `dispatchTargetDate`/`dispatchWindowId`, `shipToOverrideCustomerId`.

**Dedup / double-order risk**
- Server: `mo_orders.emailEntryId @unique` (`schema.prisma:2124`), checked at ingest `:95-100`; value = Outlook EntryID (+`__BillN`/`__SecN`, `ps1:2363-2365, 2439`). Client: `processed_ids_fw.json` (7-day prune, `ps1:131-197`). No content hash, no subject or SO check.
- If one order is both emailed and direct-submitted → **two `mo_orders` rows**, both in Billing; if both punched, two SAP bills; if both carry one SO, import enrichment silently uses the newest (`obd/route.ts:258-261`).
- A direct submit needs its own idempotency key (proposal, not existing: store `"po2:{PO number}"` or `"po2:{client uuid}"` in the required `emailEntryId`), and the page must **not** also send the mail.
- 🔴 **Test writes are production writes.** Any `mo_orders` row the test page creates shows in live Billing for the IST day (there is no staging DB). Needs a decision (see DECISIONS).

## G. Routing for the private test page

- Public prefixes (`middleware.ts:8-29`, raw `startsWith` at `:36`): `/login`, `/unauthorized`, `/not-ready`, `/api/auth`, `/api/health`, `/order`, `/api/order`, `/po`, `/demo`, `/order-demo.html`; plus `/api/cron/` (`:42`), exact `/api/import/obd` + header (`:51-57`), exact `/api/mail-orders/ingest` + header (`:60`), exact `/api/mail-orders/keywords` (`:65`). No segment boundary: `/po` also passes `/po2`, `/pol…`, `/port…`; `/api/order` passes `/api/orders/*`.
- **Proposed: page `/so-lab`, APIs `/api/so-lab/*`.** No public entry is a prefix of either (none starts `/s` or `/api/s`). Existing folders checked (`app/`: (admin), (dispatcher), (floor), (import), (mail-orders), (operations), (ops), (place-order), (tint), api, attendance, ci, login, mrn, not-ready, orders, picking, po, po2, po9, po-v2-8f4kd2, reports, trips, unauthorized; `app/api/`: admin … warehouse) — no collision; nearest is `/admin/so-groups`. Grep 1: char-class `['"\`][/](so|sx|salesorder|so-lab|so-test)` across app/, lib/, middleware.ts, next.config → nothing. Grep 2: `startsWith(` in middleware.ts → only `:36, :42, :70`, none matching `/s`. Also safe: `/sx`, `/salesorder-lab`. **Never** `/po-lab`, `/order-test` (silently public).
- Owner-only gate: page — `const session = await auth(); requireSuperuser(session);` as `app/(admin)/admin/layout.tsx:15-16`; APIs — JSON 401/403 pattern of `app/api/admin/hide/rules/route.ts:18-22` (`isSuperuser(session)`), not `requireSuperuser` (it redirects). Keep it out of `PAGE_NAV_MAP` (`lib/permissions.ts`) — no sidebar row, no tick.
- **Catalogue route:** `/api/place-order/data` returns the same `{customers, products}` shape (`route.ts:193`) and would work for the owner today, but it is gated by middleware only (disagreement 2) and has no prices and no SO filter. **A new route is needed** — `/api/so-lab/data` — gated (superuser now; SO session later), adding prices and the optional SO customer filter. Do not touch `/api/order/data` here: ROADMAP P0 says gate it in its own commit and ship nothing with it.
- For the eventual SO-facing page under Option 2 the SO has no NextAuth session, so middleware (`:78-80`) would bounce it to `/login` — that step needs an exact-segment middleware branch. Not needed while testing.

## H. Reuse vs containment

`CLAUDE_PO2.md §5`: v2 never edits outside `app/po2/`; `/po9` is a mount (`app/po9/page.tsx:6-10, 47`) and says add a prop, never copy.

| | Fork `app/po2/` → `app/so-lab/` | Mount `PoV2Page` with new props (like `/po9`) |
|---|---|---|
| Live /po2, /po9 untouched until the end | ✅ Yes — zero bytes change under `app/po2/` | ❌ Every prop (data URL — hard-coded at `po-v2-page.tsx:557`, auth state, price display, submit-instead-of-mailto) edits live files; each deploy ships to salesmen |
| Drift | ❌ ~12k lines duplicated; board/tile/art fixes must be made twice until cutover | ✅ One codebase |
| Storage | Must rename keys (e.g. `solab_*`) or it shares `po2_*` drafts/favourites with live (same origin, `v2-storage.ts:25-36`) | Same `po2_*` keys unless a prop changes the prefix |
| Email-contract test | Unaffected (`scripts/po-v2-email-fixtures.ts` guards live) | Must be re-run on every change |
| Cutover | Swap `/po2` to the fork (or copy back) at the end — one deliberate step | Flip props |

Owner's constraint ("live stays untouched until the end") favours the **fork** for the test phase.

---

## LIVE-DATA CHECK — read-only, run in Supabase SQL Editor (do not wrap in BEGIN/COMMIT)

```sql
-- READ-ONLY. 2026-09-29 /po2 SO-login discovery. SELECT / information_schema only.
SELECT 'so_total' AS label, COUNT(*)::text AS val FROM sales_officer_master
UNION ALL
SELECT 'so_active', COUNT(*)::text FROM sales_officer_master WHERE "isActive" = true
UNION ALL
SELECT 'so_with_email', COUNT(*)::text FROM sales_officer_master
  WHERE email IS NOT NULL AND btrim(email) <> ''
UNION ALL
SELECT 'so_active_with_email', COUNT(*)::text FROM sales_officer_master
  WHERE "isActive" = true AND email IS NOT NULL AND btrim(email) <> ''
UNION ALL
SELECT 'so_dup_email_groups_case_insensitive', COUNT(*)::text FROM (
  SELECT lower(btrim(email)) AS e FROM sales_officer_master
  WHERE email IS NOT NULL AND btrim(email) <> ''
  GROUP BY lower(btrim(email)) HAVING COUNT(*) > 1
) d
UNION ALL
SELECT 'so_email_not_lowercase', COUNT(*)::text FROM sales_officer_master
  WHERE email IS NOT NULL AND email <> lower(btrim(email))
UNION ALL
SELECT 'so_email_also_in_users', COUNT(*)::text FROM sales_officer_master s
  WHERE s.email IS NOT NULL AND btrim(s.email) <> ''
    AND EXISTS (SELECT 1 FROM users u WHERE lower(btrim(u.email)) = lower(btrim(s.email)))
UNION ALL
SELECT 'so_email_also_in_ACTIVE_users', COUNT(*)::text FROM sales_officer_master s
  WHERE s.email IS NOT NULL AND btrim(s.email) <> ''
    AND EXISTS (SELECT 1 FROM users u WHERE u."isActive" = true
                AND lower(btrim(u.email)) = lower(btrim(s.email)))
UNION ALL
SELECT 'so_with_any_customer_link', COUNT(DISTINCT "salesOfficerId")::text FROM customer_sales_officers
UNION ALL
SELECT 'customer_links_by_role_' || role::text, COUNT(*)::text FROM customer_sales_officers GROUP BY role
UNION ALL
SELECT 'price_like_column', v FROM (
  SELECT table_name || '.' || column_name AS v FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name ~* '(price|rate|mrp|dpl)'
  ORDER BY table_name, column_name LIMIT 100
) p
UNION ALL
SELECT 'po_ref_like_column', v FROM (
  SELECT table_name || '.' || column_name AS v FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name IN ('mo_orders', 'orders')
    AND column_name ~* '(^po|ponum|po_num|ref|number|entryid)'
  ORDER BY table_name, column_name LIMIT 100
) r;
```
Note: `rate` also matches words like `generatedAt` / `separate…` — expect false positives in `price_like_column`; read the list, don't count it.

---

## DECISIONS FOR OWNER

1. **Auth model** — Option 1 (second NextAuth provider) or Option 2 (separate SO session). *Rec: Option 2; staff login untouched, no id-space collision, SOs can never reach staff routes.*
2. **OTP sender** — Resend / SES / SMTP / Microsoft Graph from an existing mailbox. *Rec: Resend on a verified `orbitoms.in` sender; owner supplies the key into Vercel.*
3. **First test without a sender** — show the code on the owner-only `/so-lab` screen to test the SO-email lookup + code/session logic first. *Rec: yes.*
4. **Who may log in** — any SO with an email, or only `isActive = true`; and what to do with SOs whose email also belongs to a staff `users` row. *Rec: active only; allow the overlap (separate sessions).*
5. **OTP rules** — code length, expiry, max attempts, resend cooldown, session length. *Rec: 6 digits, 10 min, 5 attempts, 60 s cooldown, 30-day SO session.*
6. **Dealer picker scope** — all customers, or only the SO's PRIMARY/BACKUP/JUNIOR links. *Rec: decide after the SQL shows link coverage; start unfiltered.*
7. **Price source** — owner to supply (file/table), keyed by SAP `material`; which price (DPL/MRP/net) and GST shown or not. *Rec: a new price table keyed on `material`, loaded via Smart Flow.*
8. **PO number format and home** — e.g. `PO-{YYYY}-{5}` in a new UNIQUE `mo_orders.poNumber` column, allocated like `lib/ci/number.ts`. *Rec: yes; also use `"po2:{poNumber}"` as `emailEntryId` for idempotency.*
9. **Direct-submit shape** — new server function writing `mo_orders`/`mo_order_lines`/`mo_order_remarks` directly with the exact customer code and material, vs. calling the parser-parity path (`enrichLine`/`matchCustomer`). *Rec: direct exact write, with a parity report on the test page comparing against `enrichLine` for the same lines.*
10. **Ship-to on direct submit** — set `shipToOverride`/`shipToOverrideCustomerId` from the SO's explicit pick, given the 2026-09-29 "no auto ship-to at ingest — do not re-enable" rule (`ingest/route.ts:310`). *Rec: allow it — an explicit SO choice is not auto-detection — but owner must confirm.*
11. **Cross-depot orders** — the parser drops them entirely today (`ps1:1225`); should direct submit bring them into Billing, and fix the "Cross FROM" badge? *Rec: owner decides whether Billing should see them at all before the build.*
12. **Test writes land in live Billing** — use a dedicated test customer / tag, write to a separate staging table during the test, or accept and delete. *Rec: separate staging table until parity is proven, then switch to `mo_orders`.*
13. **Fork vs mount** — *Rec: fork `app/po2/` into `app/so-lab/` with its own storage prefix; live `/po2`/`/po9` untouched until cutover.*
14. **Test address** — *Rec: page `/so-lab`, APIs `/api/so-lab/*`, superuser-gated, not in `PAGE_NAV_MAP`.*
15. **Keep email as a fallback** after go-live (send both = duplicates) — *Rec: no; direct submit only, with an on-screen PO number as the receipt.*
