# Cron Notes
# Lives in: orbit-oms/docs/ · Created: P10

Vercel Cron schedules for the attendance feature. JSON has no comments,
so the explanation lives here.

## Current schedules (UTC → IST)

| Path                                  | UTC schedule    | IST equivalent | Purpose |
|---------------------------------------|-----------------|----------------|---------|
| `/api/cron/attendance-rollover`       | `35 18 * * *`   | 00:05 daily    | Insert ABSENT rows for users who never checked in yesterday; flag yesterday's INCOMPLETE summaries with `hasMissingCheckout=true`. |
| `/api/cron/attendance-purge`          | `30 20 * * *`   | 02:00 daily    | Delete selfies from Supabase Storage older than `attendance_settings.photoRetentionDays` (default 90); clear `photoPath` in DB. |

UTC + 5:30 = IST. India does not observe DST, so the schedule is stable
year-round.

## Hobby tier 2-cron cap — IMPORTANT

Vercel Hobby allows **2 cron jobs total**. We are at the cap.

If a third scheduled job is ever needed (e.g. weekly digest, monthly
report, anomaly detector), you have two options:

1. **Upgrade to Pro** — bumps the limit substantially.
2. **Merge into a single dispatcher endpoint** — one cron path that
   branches by query param:

   ```
   { "path": "/api/cron/dispatcher?job=rollover", "schedule": "35 18 * * *" },
   { "path": "/api/cron/dispatcher?job=purge",    "schedule": "30 20 * * *" }
   ```

   Then `/api/cron/dispatcher/route.ts` reads `?job=` and delegates.
   Trades clarity (2 dedicated paths) for slot count.

The merge approach is preferred over the upgrade if the third job is
also small and infrequent.

## Authentication

Every cron endpoint validates `Authorization: Bearer ${CRON_SECRET}`.

`CRON_SECRET` must be set in:

- `.env.local` for dev
- Vercel → Settings → Environment Variables (Production + Preview + Development)

The helper `lib/cron-auth.ts:isCronAuthorized` fail-closes: if
`CRON_SECRET` is missing or empty, every request returns 401. An
undefined env var must NEVER auth as `Bearer undefined`.

### Generating CRON_SECRET

Generate a 32-byte random hex string. Examples:

- macOS / Linux: `openssl rand -hex 32`
- Windows PowerShell: `-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`

Do NOT commit the value. Do NOT include it in code or docs as an
"example" — sample values get copy-pasted into production.

## Local testing

Cron jobs only fire on Vercel deployments. To test the endpoints
locally during dev:

```powershell
$env:CRON_SECRET = "<your-value>"
Invoke-WebRequest -UseBasicParsing `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" } `
  http://localhost:3000/api/cron/attendance-rollover
```

```bash
# bash equivalent
CRON_SECRET="<your-value>"
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/attendance-rollover
```

Both endpoints return `{ ok: true, ... }` JSON with per-job counts.

## Failure handling

- Per-item errors are logged via `console.error` with a route-prefix
  string and pushed into the response's `errors` array. They do NOT
  abort the run.
- Top-level unexpected errors return 500. Vercel does not auto-retry
  crons — a 500 means a human should check the next day's logs.
- No alerting layer (Sentry / email) yet. Vercel function logs are
  the source of truth for v1.

## Cron jitter

Vercel Cron has minute-level precision. The rollover endpoint anchors
its `yesterdayIST` computation on `now + 1 hour` to absorb ±60min of
jitter — see the inline comment in `app/api/cron/attendance-rollover/route.ts`.
The purge endpoint is jitter-insensitive (it scans by absolute cutoff
date, not "today").
