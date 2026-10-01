# Code update — sales-officer OTP login, test page `/so-lab` (Schema v27.43)
# 2026-09-29 · step 1 of the /po2 → private SO order page plan

> **2026-09-29 — SO login is deliberately separate from NextAuth — do not merge into lib/auth.ts.**
>
> **2026-09-30: on-screen test code removed — do not re-enable outside a superuser-only page.**

## Update 2026-09-30 — the code is now sent by email

- **Provider: Zoho ZeptoMail** (now "Zoho CPaaS"), **India data centre**, `https://api.zeptomail.in/v1.1/email`.
  Domain `orbitoms.in` verified in ZeptoMail (DKIM + CNAME). **Sender `noreply@orbitoms.in`** ("Orbit").
- **Env var `ZEPTOMAIL_TOKEN`** (Vercel, Production + Preview; name only — the value carries its own
  `Zoho-enczapikey ` prefix and is sent as-is in `Authorization`). Missing → `sendCodeEmail` returns
  `no-token` without touching the network.
- **`lib/so-auth/send-code-email.ts`** — `sendCodeEmail({ to, name, code })`: `fetch` only (no SDK), 8 s
  `AbortController` timeout, subject "Orbit login code", Outlook-safe HTML (tables, inline styles, no images)
  + plain text. Failure reason = `http-<status> <Zoho error code>` / `timeout` / `network` / `no-token` —
  never the response body, never the token.
- **`TEST_MODE_SHOW_CODE = false`** (`lib/so-auth/constants.ts`); the route adds `testCode` only when it is
  true, so the API no longer returns it and the page's amber box no longer draws. Code screen now reads
  "We sent a 6-digit code to {email}. Check your inbox and spam folder."
- **request-code**: after the `so_login_codes` insert it awaits `sendCodeEmail`. A failed send logs ONE line,
  `[so-auth] code email failed: <reason> soId=<id>` (no address, no code) and the response is unchanged —
  same message, same status, same shape.
- **Timing floor**: every request-code answer (allowed, not allowed, cooldown, IP limit, send failed) is held
  until at least **1,500 ms + 0–300 ms random jitter** after the request arrived (`REQUEST_CODE_MIN_MS`,
  `REQUEST_CODE_JITTER_MS`). The allowed path does an insert plus an email round-trip that a disallowed email
  skips; the floor hides it in the usual case. A ZeptoMail send slower than the floor still shows as a slower
  answer — accepted, noted here.
- Cooldown, IP limit, verify, logout, me: unchanged. `/so-lab` and every `/api/so-lab/*` route are still
  superuser-gated.
- ⚠ **ZeptoMail credits:** one free credit (10,000 emails) expires **31 Oct 2026**. If credits run out, SO
  login stops (the page still says "sent"; the log shows `code email failed`). Tracked in ROADMAP → `/po2`.

Discovery: `docs/prompts/drafts/code-discovery-2026-09-29-po2-so-login.md` (§A Option 2, §G).
SQL (run live 2026-09-29 by Smart Flow, verified): `sql/2026-09-29-so-login-tables.sql`.

## Update 2026-10-01 (b) — middleware: exact-segment bypass for the SO surface (checklist H5)

> **2026-10-01: /so-lab + /api/so-lab/* bypass NextAuth in middleware by exact segment — they carry their own SO session; never widen to a prefix.**

- `middleware.ts` gains ONE branch, right after the `PUBLIC_PATHS` check: `if (isSoSurfacePath(pathname))
  return NextResponse.next();`. `PUBLIC_PATHS`, `/po`, `/order` and every other branch are untouched.
- `lib/so-auth/surface-path.ts` (`isSoSurfacePath`, no imports — Edge-safe): TRUE only for `/so-lab`,
  `/so-lab/`, `/api/so-lab`, and `/api/so-lab/…`. A throwaway check (not committed) printed:
  `/so-lab=YES /so-lab/=YES /so-labx=no /so-lab-old=no /api/so-lab/catalogue=YES /api/so-lab/auth/verify=YES
  /api/so-labx=no /admin/so-access=no /api/admin/so-access=no /po2=no /floor=no /login=no`.
- `/so-lab/manifest.webmanifest` contains a dot, so the middleware matcher (`middleware.ts` `config.matcher`)
  never runs on it — confirmed against the matcher regex.
- `/admin/so-access` and `/api/admin/so-access/*` do NOT match, so they stay behind middleware's NextAuth
  redirect AND their own superuser gates (admin layout `requireSuperuser`; `isSuperuser` JSON 401/403).

**Gate table after the bypass** (middleware no longer redirects these; each enforces its own gate):

| Route | `so.page.open` OFF (absent / false / read error) | `so.page.open` ON |
|---|---|---|
| `/so-lab` (layout + page) | superuser staff session (`requireSuperuser` → `/unauthorized`) | none to SEE the login screen; the board needs a live SO session (`getSoSession`) |
| `POST /api/so-lab/auth/request-code` | superuser staff (JSON 401/403) | none — it IS the login; rate-limited (below), answer never reveals eligibility |
| `POST /api/so-lab/auth/verify` | superuser staff | none — it IS the login; 5 tries per code, 10-min codes |
| `POST /api/so-lab/auth/logout` | superuser staff | none — only revokes the session in the caller's OWN cookie; no cookie = no-op |
| `GET /api/so-lab/auth/me` | superuser staff | SO session, else 401 `no_so_session` |
| `GET /api/so-lab/catalogue` | superuser staff, then SO session (`requireSoApi`) | SO session (`requireSoApi`) |

No route is fully open in a way that exposes data: with the switch ON the only session-less routes are the
login pair and logout. Nothing opens until the owner flips the switch.

**Rate limits = the only guard on the OTP sender once ON** (all apply with no session — they are keyed on the
SO and the IP, not on any login):
- **60 s cooldown per sales officer** (`RESEND_COOLDOWN_MS`): at most one code — one email — per SO per minute.
- **10 codes per IP per hour** (`IP_LIMIT` / `IP_WINDOW_MS`), counting codes actually issued.
- An email that is not an active, granted SO creates no row and sends nothing, so the sender can only ever
  mail the granted SO addresses.
- ⚠ Residual risk to decide before real SOs: the IP limit counts per IP, so a distributed caller could still
  make one email a minute to a granted SO (≤ 60/h each), and guessing is bounded by 5 tries × one code a
  minute ≈ 300 guesses/h per SO against 1,000,000 codes. A per-SO hourly cap on issued codes / failed tries
  would close both; not built.

**Switch SQL (owner, Smart Flow — NOT RUN):**
- ON: `INSERT INTO app_settings ("settingKey","isEnabled") VALUES ('so.page.open', true) ON CONFLICT ("settingKey") DO UPDATE SET "isEnabled" = true, "updatedAt" = now();`
- OFF: `UPDATE app_settings SET "isEnabled" = false, "updatedAt" = now() WHERE "settingKey" = 'so.page.open';`
- Takes effect within ~30 s (per-instance cache).

## Update 2026-10-01 — C.2a: the /po2 board behind SO login (local storage only)

> **2026-10-01: lastSeenAt throttled to 10 min — do not write on every call.**

Plan: `docs/prompts/drafts/code-discovery-2026-09-30-so-lab-order-page.md`, as amended by the owner's
2026-10-01 decisions (`web-update-2026-09-30-so-order-pipeline.md`): final address = the SAME `/po2` link at
go-live (no `/sales`), NO import of old `po2_*` phone data, lock = an `app_settings` switch.

- **Fork location: `app/so-lab/_board/`** (underscore = private, never a route). 13 files, all NEW; `app/po2/`,
  `app/po9/`, `app/po/`, `lib/place-order/`, `/api/order/data` untouched (git diff empty).
  - As-is copies: `v2-data.ts`, `product-drawer.tsx`, `product-search.tsx`, `customer-list.tsx`,
    `review-screen.tsx`, `order-sheet.tsx`, `v2-sheet.tsx`, `v2-search-input.tsx` (only the storage type import
    is repointed in `customer-list` / `order-sheet`).
  - Changed: `po-v2-page.tsx` (SO prop, `setStorageScope(so.id)`, catalogue URL, SO name + Log out in the
    masthead, no sent log, Send stamps the SO), `so-storage.ts` (was `v2-storage.ts`), `v2-email.ts`,
    `drafts-sent.tsx` (Sent = "Coming soon" placeholder), `v2-manifest.ts` (mount `/so-lab`).
  - Read-only imports from outside, as /po2: `lib/place-order/pack`, `lib/place-order/mobile-search`,
    `lib/place-order/email` (`buildSubject`, `emailLineLabel`, `renderOrderBody` — NOT `ORDER_TO`),
    `components/shared/orbit-wordmark`.
- **One URL, server decides** (`app/so-lab/page.tsx`): lock → `getSoSession()` → login screen or
  `<SoBoard so={{ id, name, email }} />`. Login success and Log out → `window.location.reload()`. The lock is
  checked in the layout AND the page (they render in parallel).
- **Lock switch: `app_settings` `settingKey = 'so.page.open'`** (`lib/so-auth/lock.ts`). Absent / false /
  read error = LOCKED (superuser staff session required on the page and every `/api/so-lab/*`, as before);
  cached 30 s per instance. **The row is NOT created.** Go-live SQL (owner, Smart Flow — NOT RUN):
  `INSERT INTO app_settings ("settingKey","isEnabled") VALUES ('so.page.open', true) ON CONFLICT ("settingKey") DO UPDATE SET "isEnabled" = true, "updatedAt" = now();`
  ⚠ Opening it does not by itself admit an SO without a staff login: `middleware.ts:78-80` still redirects to
  `/login` — the go-live middleware branch (checklist H) is separate.
- **`requireSoApi()`** (`lib/so-auth/require-so-api.ts`): lock gate → `getSoSession()` → 401
  `{ reason: "no_so_session" }`. SO id from the session only.
- **Catalogue: `GET /api/so-lab/catalogue`** → `lib/so-order/catalogue.ts` (`buildSoCatalogue`, a third copy of
  the `/api/order/data` payload builder — same shape). Gate first, then `unstable_cache` (key
  `so-lab-catalogue-v1`, tag `so-lab-catalogue`, revalidate 600 s). Throws on error or an empty catalogue →
  **503**, never cached, never 200-with-empty; the board shows its Retry screen on any non-200. One call per page
  load, no polling.
- **Storage = LOCAL ONLY in C.2a**, keys `sopage_{soId}_draft` / `_saved` / `_favs` / `_stars_dealer` /
  `_stars_shipto` — per SO, so a shared phone keeps salesmen apart. /po2's rules kept: 24 h live draft, 20 saved
  drafts, 8 favourites (9th refused), two star lists (200 fuse). **No `po2_*` key is ever read or written**; the
  /po2 star-seed chain is dropped (an absent list is empty). No sent log. The DB tables of v27.48-designed
  `sql/2026-09-30-so-drafts-favourites.sql` are NOT used yet — that is C.2b.
- **Send (until phase D):** mailto to **`SO_TEST_ORDER_TO = "harsh.jnenterprise@outlook.com"`**
  (`_board/v2-email.ts`, "phase D replaces this"), subject = `buildSubject` as today, body = `renderOrderBody`
  + a final line `Sent by {SO name}`. No CC.
- **`getSoSession()` lastSeenAt throttle:** `LAST_SEEN_THROTTLE_MS = 10 min` (`lib/so-auth/constants.ts`); the
  bump is a conditional `updateMany … WHERE "lastSeenAt" < now − 10 min`, so at most one write per session per
  10 min however many board calls run.
- ⚠ **Schema-version clash to resolve in C.2b:** the SO drafts SQL was drafted as **v27.48**, but commit
  `81925d52` (another session, 2026-09-30) also claims v27.48 for the `delivery_challans` live-feed trigger. The
  C.2b chain entry must take the next free number at the time it is written.

## Update 2026-09-30 (b) — shared `lib/otp/` + the `/admin/so-access` screen

> **2026-09-30: SO order-access grant is deliberately NOT a PageKey — do not add one.**

**The split (refactor — no change a user can see).** Channel-neutral pieces moved to `lib/otp/`
(`git mv`, history kept); everything SO-specific stayed in `lib/so-auth/`, which imports from `lib/otp/`.
Prepared for a possible **staff OTP later — not built.**

| `lib/otp/` (no SO names, tables or imports — grep for `so_` / `salesOfficer` / `so-auth` is empty) | `lib/so-auth/` |
|---|---|
| `code.ts` (was `lib/so-auth/crypto.ts`): `normaliseEmail`, `generateCode`, `hashCode(label, subject, code)`, `codeMatches(label, subject, code, hash)` — the HMAC label is now a PARAMETER | `constants.ts`: session TTL, IP limit, cookie, **`SO_OTP_HMAC_LABEL = "orbit-so-otp:v1"`** (unchanged, frozen — changing it kills live codes; a staff channel gets its own), `TEST_MODE_SHOW_CODE`, timing floor, generic message |
| `constants.ts` (new): `CODE_LENGTH`, `CODE_TTL_MS`, `MAX_ATTEMPTS`, `RESEND_COOLDOWN_MS` — values unchanged | `eligibility.ts`, `session.ts` (session-token generation + hashing now private here), `staff-gate.ts` |
| `send-code-email.ts` (was `lib/so-auth/send-code-email.ts`, unchanged apart from its header comment) | `access.ts` (new): `listSoAccess`, `grantSoAccess`, `revokeSoAccess` |

Hash equivalence was checked by script: the old formula and `hashCode("orbit-so-otp:v1", "19", code)` give
the identical digest, so codes issued before the split still verify.

**`/admin/so-access` — "Order access"** (`app/(admin)/admin/so-access/page.tsx` +
`components/admin/so-access-table.tsx`).
- **Superuser only, three ways:** the `/admin` layout's `requireSuperuser`; every API route's `isSuperuser`
  JSON 401/403; and the sidebar entry is **keyless**, which `visibleItems()` in `admin-sidebar.tsx` shows
  to a superuser alone (the same rule as "Access"). **No PageKey, no `PAGE_NAV_MAP` row, no tick** — a tick
  could be handed to anyone through `/admin/access`. Editing `sales_officer_master` (Sales Officers screen)
  grants nothing: access lives only in `so_order_access`.
- Table (CLAUDE_UI §27 fixed layout): name (+ "{n} past grants/revokes") · employee code · email (grey
  "No email — add it in Sales Officers") · Active · Access (Granted / Not granted) · granted by + date
  (IST) · last login = `MAX(so_sessions.lastSeenAt)` or "Never" · action. Loads once, reloads after each
  action — **no polling**.
- **Grant** (`POST /api/admin/so-access/grant {salesOfficerId}`): disabled with a tooltip when the SO has no
  email or is inactive; the server re-checks both (404 / 422). Inserts a NEW `so_order_access` row with
  `grantedById` = the superuser; a P2002 on `so_order_access_live_key` → **409 "Already granted."**
- **Revoke** (`POST /api/admin/so-access/revoke {salesOfficerId}`): confirm dialog "Revoke order access for
  {name}? They will be logged out now." → `updateMany` the live row (`revokedAt` now, `revokedById`), never
  a delete; **then `updateMany` every open `so_sessions` row of that SO → `revokedAt` now**, answering
  `sessionsEnded`. Belt and braces: `getSoSession` also re-checks eligibility on every read. A later
  **re-grant is a new row** and the SO must log in again.
- `GET /api/admin/so-access` — the list. Three reads, sequential, no `$transaction`.

## What shipped

- **Schema v27.43** — Prisma models `so_order_access`, `so_login_codes`, `so_sessions` hand-mirrored in
  `prisma/schema.prisma`, with back-relations on `sales_officer_master` (`orderAccess`, `loginCodes`,
  `soSessions`) and `users` (`soAccessGranted` / `soAccessRevoked` — named `SoOrderAccessGrantedBy` /
  `SoOrderAccessRevokedBy` on both sides). The partial unique `so_order_access_live_key` is a model
  comment, never `@@unique`. CORE → v113 · Schema v27.43 (chain entry + change log).
- **`lib/so-auth/`** (server-only by use; no client file imports it)
  - `constants.ts` — 6 digits · 10 min · 5 tries · 60 s cooldown · 30-day session · 10 codes per IP per
    hour · cookie `orbit_so_session` · **`TEST_MODE_SHOW_CODE = true`**.
  - `crypto.ts` — `normaliseEmail` (lower + trim), `generateCode` (`crypto.randomInt`, zero-padded),
    `hashCode` = HMAC-SHA256 of `"{salesOfficerId}:{code}"` under a key derived from `AUTH_SECRET` with the
    fixed label `orbit-so-otp:v1` (no new env var), `codeMatches` (`timingSafeEqual`), session token =
    32 random bytes base64url, stored as SHA-256 hex only.
  - `eligibility.ts` — THE rule, used at request-code, verify, and every session read: SO row by email
    (case-insensitive, exactly one match), `isActive`, AND a `so_order_access` row with `revokedAt IS NULL`.
  - `session.ts` — `createSoSession` (row + httpOnly / secure-in-prod / sameSite lax / path "/" / 30-day
    cookie), `getSoSession` (cookie → hash → not revoked, not expired → eligibility → `lastSeenAt`),
    `revokeCurrentSoSession`, `clearSoSessionCookie`. **A session whose SO has lost eligibility is revoked
    on its next read.**
  - `staff-gate.ts` — `soLabStaffGate()` (superuser staff session, JSON 401/403 — the
    `app/api/admin/hide/rules` pattern, never `requireSuperuser`), `requestIp()`.
- **API** — every route `force-dynamic`, every route runs the staff gate FIRST:
  - `POST /api/so-lab/auth/request-code` — always 200 with the same `{ ok, message, cooldownSeconds }`
    ("If this email is allowed, a code has been sent.") whether the email is unknown, inactive, ungranted,
    inside the cooldown, or over the IP limit; `testCode` added only when a code was created and
    `TEST_MODE_SHOW_CODE` is on.
  - `POST /api/so-lab/auth/verify` — checks the SO's **latest** code only (a newer request supersedes older
    codes; a used latest code = "request a new one"). An attempt is claimed with `updateMany … attempts < 5`
    before the compare, and a correct code is consumed with `updateMany WHERE id AND usedAt IS NULL`; a session
    is created only when that count is 1. No `$transaction`. Every failure: 401, same error text, plus a
    `reason` (`wrong` / `expired` / `too_many`) for the page's hint. An email that is not allowed always
    answers `wrong`.
  - `POST /api/so-lab/auth/logout` — revokes the session row, clears the cookie.
  - `GET /api/so-lab/auth/me` — `{ name, email }` or 401 `reason: "no_so_session"`.
- **Page `/so-lab`** — `app/so-lab/layout.tsx` (`auth()` + `requireSuperuser`, as the admin layout; `noindex`),
  `page.tsx`, `so-lab-login.tsx` (client): email → code (numeric, `one-time-code`, 60 s Resend countdown,
  Change email, amber "TEST MODE — your code" box) → "Logged in as {name}" + Log out; `/me` on load skips to
  the logged-in screen. Linked from nowhere; not in `PAGE_NAV_MAP` / `PageKey` / any sidebar.

Not touched: `lib/auth.ts`, `auth.config.ts`, `middleware.ts` (git diff empty), `lib/permissions.ts`,
`app/po/`, `app/po2/`, `app/po9/`, `lib/place-order/`, `/api/order/data`. No new npm package.

## 🔴 Must happen later

1. ~~**`TEST_MODE_SHOW_CODE` must flip to `false` at step 7**~~ — **DONE 2026-09-30** with email sending
   (above). Never turn it back on outside a superuser-only page: with the staff gate lifted it would hand any
   caller a valid code for any allowed email.
2. **Deactivate the TEST sales officer, `sales_officer_master` id 19** ('TEST — Smart Flow') after testing,
   and revoke `so_order_access` id 1. While active it appears in the SO dropdowns on `/admin/customers`,
   `/tint/manager/customers` and `/dispatcher/customers` — do not assign it to a customer.
3. **Eligibility leak to decide before any public launch:** `expired` / `too_many` can only come back for an
   allowed email, so an attacker who requests a code and then guesses 5 times learns the email is allowed.
   Harmless behind the staff gate; decide (generic-only messages vs. this hint) before SOs use it.
4. The per-IP limit counts codes actually ISSUED, so requests for unknown emails never count toward it.
   Revisit when the page goes public (e.g. a separate request log).
5. The final SO-facing page has no NextAuth session, so `middleware.ts:78-80` will bounce it to `/login` —
   that step needs an exact-segment middleware branch (discovery §G). Not needed while testing.

## Verified

- `npx tsc --noEmit` — clean.
- `npm run build` — exit 0; route table lists `/so-lab`, `/api/so-lab/auth/logout`, `/me`,
  `/request-code`, `/verify`.
- `git diff --stat lib/auth.ts auth.config.ts middleware.ts` — empty.
- **NOT verified: the login flow itself.** No credentials were used (the dev server points at the production
  database). The owner runs the manual test list below.

## Manual test (owner, logged in as admin)

1. Open `/so-lab` → "Sales Officer Login". Enter `harsh.jnenterprise@outlook.com` → Send code → amber TEST box
   shows a 6-digit code; Resend counts down from 60.
2. Type the code → Verify → "Logged in as TEST — Smart Flow" + the email.
3. Reload `/so-lab` → lands straight on the logged-in screen (`/me`).
4. Log out → back to the email screen; reload → still the email screen.
5. Send code again; enter a WRONG code 4× → "That code is not right"; the 5th wrong → "Too many wrong tries";
   now even the right code is refused. Wait out Resend → Resend → the new code works.
6. Resend before 60 s → the button is disabled with the countdown.
7. Enter an email that is not an SO → the same "If this email is allowed…" message, no TEST box; any code →
   "That code is not right".
8. Private/incognito window, no admin login → `/so-lab` redirects to `/login`; `/api/so-lab/auth/me` does not
   answer with SO data.
9. (Optional revoke check) set `so_order_access` id 1 `revokedAt = now()` via Smart Flow while logged in →
   reload `/so-lab` → back to the email screen; restore by inserting a new grant row.
