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
