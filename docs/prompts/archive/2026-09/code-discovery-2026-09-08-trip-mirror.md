# Code discovery — Trip Report mirror, machine + dependency reality
# 2026-09-08 · discovery only, no code written, no schema touched, no SQL executed against
# a write path. Every DB fact below came from a read-only SELECT / pg_catalog query on
# production (CORE §3: SELECT allowed and encouraged; the queries are quoted inline).

**Read for this pass:** `CLAUDE.md` (router v1.12) · `docs/CLAUDE_CORE.md` (v102, Schema v27.23)
§3 · `docs/CLAUDE_UI.md` (v5.20, no schema stamp by design) · `docs/CLAUDE_TRIP_REPORT.md`
(v1.1, Schema v27.13) · `prisma/schema.prisma` · `app/api/trips/route.ts` ·
`app/api/trips/[tripNo]/route.ts`.

> ⚠ **The file the prompt calls item 3 does not exist.**
> `docs/prompts/drafts/web-update-2026-09-08-trip-report-mirror-optimisation.md` is not on
> disk, is not untracked-but-present, and has never been committed
> (`git log --all -- 'docs/prompts/drafts/web-update-2026-09-08*'` → empty). A repo-wide
> search for `mirror.optimisation|mirror.optimization`, `rowHash|row_hash`,
> `unchanged rows`, `stops rewriting` returns **zero hits anywhere**, including
> `docs/_backup_2026-08-04/`. **Section 5 therefore scores only the three claims the prompt
> itself quotes**, not the draft's full text, which I have never seen.

---

## 1. Puller machine reality

### 1.1 The documented path is wrong

`CLAUDE_TRIP_REPORT.md` §2, §7 and §8 all name
`F:\VS Code\nts trip report\Pull-TripReport.ps1`.

**`F:\` on this machine has no `VS Code` folder at all.** Its root is
`$RECYCLE.BIN`, `Call of Duty 4`, `DCIM`, `HARSH + ZALAK WEDDING`, `Pantum M7105DN`,
`System Volume Information`, one NVIDIA installer and a Win11 ISO. The doc's path resolves
to nothing.

A recursive search of **C:, D:, E: and F:** for `Pull-TripReport*` returns exactly three hits:

| Path | Size | Last write | What it is |
|---|---|---|---|
| `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1` | 12,169 B | **2026-08-30 20:53** | **the current script** |
| `C:\Users\HP\OneDrive\VS Code\nts trip report\nts trip report\Pull-TripReport.ps1` | 10,759 B | 2026-07-03 23:30 | **obsolete pre-mirror copy — landmine, see §1.7** |
| `C:\Users\HP\AppData\Roaming\Microsoft\Windows\Recent\Pull-TripReport.lnk` | 1,069 B | 2026-08-31 11:50 | shortcut; target = the Automation copy |

A content search of **every `.ps1` on all four drives** for the string
`mirror_trip_report_today` returns **one** file — the Automation copy. So there is exactly
one live script on this machine and one dead one.

**→ CORRECTION for `CLAUDE_TRIP_REPORT.md` §2 / §7 / §8:** the path is
`C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1`. It is still
outside the repo (the repo is `C:\Users\HP\OneDrive\VS Code\orbit-oms`; `git check-ignore`
answers *"is outside repository"*), but it is **not** on `F:` and it **is** inside a synced
OneDrive tree — which is a different risk profile from "a folder on a local drive": the
service-role key in `settings.txt` is replicated to Microsoft's cloud.

### 1.2 The loop interval — the doc says 60s; the real cadence is 61–62s

The literal line, `Pull-TripReport.ps1:320`:

```powershell
    Start-Sleep -Seconds 60
```

It is `Start-Sleep` **after** the work, not a fixed-period timer, so the true period is
`60s + fetch + push`. Measured directly against production over a 300-second window
(read-only poll of `max("fetchedAt") WHERE "disDate" = CURRENT_DATE`, 2026-09-08 05:17–05:23 UTC):

```
  NEW STAMP 2026-09-08T05:17:40.249Z  rows=44
  NEW STAMP 2026-09-08T05:18:41.837Z  rows=44
  NEW STAMP 2026-09-08T05:19:43.802Z  rows=44
  NEW STAMP 2026-09-08T05:20:45.810Z  rows=44
  NEW STAMP 2026-09-08T05:21:48.017Z  rows=44
  NEW STAMP 2026-09-08T05:22:49.397Z  rows=44

  intervals: 62s, 62s, 62s, 62s, 61s
```

Local `log.txt` agrees for a busy day (`19:08:45 → 19:09:49 → 19:10:53 → 19:11:57 →
19:13:00 → 19:14:04 → 19:15:09 → 19:16:13` = 64s, 64s, 64s, 63s, 64s, 65s, 64s), and for an
idle day is 61s (`08:54:12 → 08:55:13 → 08:56:14 …`).

**→ "60 seconds" is the sleep constant, not the cadence. Use ~62s (idle) to ~64s (busy).**
Any outage or write-volume arithmetic built on 60s over-counts by 3–7%.

### 1.3 What it POSTs, and where — quoted

`Pull-TripReport.ps1:229-244`:

```powershell
    $payload = @{ rows = $arr }
    $json = ConvertTo-Json $payload -Depth 6

    $url = $SupabaseUrl + "/rest/v1/rpc/mirror_trip_report_today"
    $headers = @{
        "apikey"        = $ServiceKey
        "Authorization" = "Bearer $ServiceKey"
        "Content-Type"  = "application/json"
    }
    ...
        $resp = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -Body $json -UseBasicParsing
        $insertedCount = $mapped.Count
        try { $insertedCount = [int]($resp.Content) } catch { }
        Write-Log ("mirrored " + $insertedCount + " rows for today")
```

Body is `{ "rows": [ … ] }`; each element is the 37-field object built by `Map-Row`
(`:165-203`) — every column **except** `fetchedAt`. Auth is the Supabase **service-role**
key in both `apikey` and `Authorization`. The doc's account of this is correct.

### 1.4 The transporter filter — the doc is incomplete

`CLAUDE_TRIP_REPORT.md` §2 says only: *"keeps only rows where `transporter` (trimmed,
lowercased) `== "nagadhiraj"`. Drops MRC/HAND/deleted rows."*

The live filter, `Pull-TripReport.ps1:300-304`, has a **second condition the doc never
mentions**:

```powershell
        $kept = @($rows | Where-Object {
            $_.transporter -ne $null -and
            ($_.transporter.Trim().ToLower() -eq 'nagadhiraj') -and
            (($_.modi_inv -eq $null) -or ($_.modi_inv.ToString().Trim().ToLower() -ne 'frt'))
        })
```

An **`modi_inv = 'FRT'` exclusion**. It is counted separately (`:308-312`) and logged
(`:315`): `fetched 117, kept 98 (Nagadhiraj, FRT skipped 0), pushed 97`. The obsolete
2026-07-03 copy has no such clause (`:287` is transporter-only), so the FRT rule was added
between then and 2026-08-30 and never reached canon.

**→ CODE WINS. `CLAUDE_TRIP_REPORT.md` §2's transporter-filter line is wrong by omission.**

That same log line exposes a second undocumented fact: **`kept 98 … pushed 97`**. One row
per cycle is being silently swallowed by the function's in-batch dedupe on
`(deliveryNo, disDate)` — NTS is sending a duplicate delivery number. That is the designed
behaviour, but nothing surfaces it; the log's two numbers are the only trace.

### 1.5 Change detection — confirmed absent

**Correct: there is none.** No hashing, no comparison, no conditional push. `Push-Rows`
(`:209-267`) has exactly one early return, `if ($Rows.Count -eq 0) { Write-Log "0 rows"; return 0 }`
(`:212-215`). Every non-empty cycle POSTs the full mapped array unconditionally. A repo-wide
search for `rowHash|row_hash` returns zero hits; the live `trip_report` has no hash-ish
column (§4); `pg_proc` has no other function touching `trip_report`; `pg_trigger` on
`public.trip_report` returns **(none)**.

Production evidence of the waste, `pg_stat_user_tables` (stats had been reset ≈2.75h before
the read):

```
n_tup_ins 7020 · n_tup_del 6976 · n_tup_upd 0 · n_live_tup 6749 · n_dead_tup 652
autovacuum_count 5 · last_autovacuum 2026-09-08T05:10:08Z · last_autoanalyze 05:20:08Z
total size 3592 kB (heap 2464 kB)
```

`n_tup_upd = 0` is the shape of the thing: it is never an update, always a delete-and-insert.
Autovacuum has fired 5 times in under three hours on a 6,749-row table.

### 1.6 Secrets — where they live, and they are NOT in the repo

`settings.txt` sits beside the script at
`C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\settings.txt` (703 B). Keys present
(values withheld):

```
SUPABASE_URL         = https://<project-ref>.supabase.co
SUPABASE_SERVICE_KEY = <MASKED, 219 chars — service-role JWT>
LOGIN_URL            = https://www.nagadhirajtransservice.com/nts/API/chk_login.php?txt_mobile=<MASKED>&txt_pwd=<MASKED>&webpushid=
REPORT_URL_BASE      = https://www.nagadhirajtransservice.com/nts/API/get_trip_report.php
```

**Confirmed not in the repo.** The folder is outside the repository entirely. A repo-wide
search for `nagadhirajtransservice|chk_login|get_trip_report|txt_pwd` returns only
documentation lines carrying **placeholder** URL shapes (`txt_mobile=<m>&txt_pwd=<p>`) in
`docs/CLAUDE_TRIP_REPORT.md:27-28` and two archived 2026-07 drafts. No NTS credential and no
service-role key value appears anywhere in the tree.

Two adjacent notes, both outside this module's scope but found on the same sweep:
- `README.txt`'s line *"settings.txt and log.txt are both in .gitignore"* is **moot, not
  true** — neither file is in the repo, so `.gitignore` never applies to them. (The repo's
  `.gitignore` is still the UTF-16 file §7's landmine list already records; `file` reports it
  as `data`.)
- ⚠ **Unrelated but real:** `docs/dhruv-review/-Dhruv.env` (and its twin under
  `docs/_backup_2026-08-04/`) holds a **plaintext production DB password** inside the working
  tree. Both are **untracked** (`git ls-files docs/dhruv-review/` is empty), so nothing has
  been pushed — but they are inside the OneDrive-synced repo folder. Flagged, not touched.

### 1.7 Task Scheduler: NO. And this machine is NOT running the puller.

**Scheduler — settled: it is not a scheduled task.**

`schtasks /query /fo LIST /v | findstr /i "TripReport nts trip"` produces output, but every
line is a **false positive**: `findstr` treats the quoted string as OR'd substrings, so `nts`
matches *"clie**nts**"*, *"compone**nts**"*, *"eve**nts**"*, *"Setti**nts**"*-style words in
unrelated task comments. Not one hit is a task **name**. The precise check:

```
Get-ScheduledTask | Where-Object { $_.TaskName -match 'Trip|Orbit|NTS|Pull|Import' }

TaskName              TaskPath      State
--------              --------      -----
OrbitOMS Auto Import  \             Disabled
OrbitOMS Auto Import  \Orbit OMS\   Disabled
```

Two tasks, both belonging to the **Import** module, both **Disabled**. **There is no
scheduled task for the trip puller.** Nor any autostart: the Startup folders hold only
`AnyDesk.lnk` and `Temp Remover`, and the `Run` keys hold only OneDrive, Adobe, Edge,
SecurityHealth and a Pantum monitor. `README.txt` states the intended operation plainly:

> HOW TO RUN — Open PowerShell in this folder and run:
>     powershell -ExecutionPolicy Bypass -File ".\Pull-TripReport.ps1"
> Close the PowerShell window to stop it. There is no "stop" command — just close the window.

**→ `CLAUDE_TRIP_REPORT.md` §7's "[NEXT] Puller as a Task Scheduler job" item still stands,
and the "only runs while its PowerShell window stays open" claim is now VERIFIED, not
unverifiable.**

**Instance count on this machine — zero.**

```
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'"   →  (no output)
Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'"         →  4 VS Code terminals + my own
Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'TripReport|nts trip' }  →  only my own query
```

**There is not one powershell.exe process on this box.** The local `log.txt` stops at
`[09:05:24]` with a file mtime of **2026-09-01 09:05:24** — seven days ago.

**And yet production is live.** Read-only SELECT, 2026-09-08:

```sql
-- read-only
SELECT count(*)::int, max("fetchedAt"), min("fetchedAt") FROM trip_report;
--> total 6748 · newest 2026-09-08T05:12:29.048Z · oldest 2026-07-03T18:03:23.915Z
--  server now() = 2026-09-08T05:13:21.759Z   → the mirror was 52 seconds old
```

and it kept advancing on a 62-second beat throughout §1.2's five-minute sample.

🔴 **Therefore: the machine this session is running on is NOT the machine running the
puller.** The prompt's premise ("You are running ON the depot PC now") does not hold for this
module. This PC holds a *stopped* copy that last cycled on 2026-09-01 and an *obsolete* copy
from 2026-07-03; the live puller is on some other host, with a copy that is not on any drive
here. OneDrive is running (`OneDrive.exe` pid 12740, started 2026-09-06) and the folder is
pinned-and-synced, so if the live host ran from *this same* OneDrive folder its `log.txt`
would have synced back — it has not, and there are no conflict copies. So the live host has
its own out-of-band copy.

**Instance count, answered the way that actually matters.** Counting processes here cannot
answer it, because the puller is not here. The production data can, and does: because the
function does a full delete-and-reinsert, **every surviving row of a cycle carries one
identical `fetchedAt`**, so each running instance contributes one distinct stamp per ~62s.
Over 300 seconds there were exactly **6 distinct stamps at 61–62s spacing** — a clean single
series with no interleaving. A second instance would have produced ~12 stamps, or pairs
seconds apart.

**→ ONE instance. The outage/volume arithmetic does not need doubling.**

*(Confirming detail, same shape: `SELECT "fetchedAt", count(*) … GROUP BY 1` over the last 35
minutes returned exactly **one** row — `2026-09-08T05:17:40.249Z, rows=44` — because the
previous cycle's rows no longer exist. That is the delete-and-reinsert signature in one
query.)*

### 1.8 `log.txt` — cadence, error handling, and two defects

- **57,131 lines, 3,123,709 bytes, never rotated or truncated.** It grows forever; nothing
  in the script trims it.
- **No date, only `HH:mm:ss`** (`Write-Log`, `:16` — `Get-Date -Format "HH:mm:ss"`). You
  cannot tell which day a line belongs to from the file. The *only* reason I can date the
  last line is the filesystem mtime. For a monitoring conversation this is the single most
  disabling property of the log.
- **It does log errors, in three shapes**, and the loop survives all of them:
  - `:317` `Write-Log ("cycle error: " + $_.Exception.Message)` — present in the real tail:
    `[08:53:10] cycle error: Unable to read data from the transport connection: An existing connection was forcibly closed by the remote host.`
  - `:264` `Write-Log ("mirror failed: status=" + $statusCode + " body=" + $bodySnippet)` —
    the Supabase-side failure, body truncated to 300 chars.
  - `:83/:87/:96/:98` login failures.
- **A silent-failure hole:** `Push-Rows` returns `0` on a mirror failure (`:265`), and the
  cycle line then reads `… pushed 0`, which is **the same text a genuinely empty NTS pull
  produces**. `pushed 0` is ambiguous between "nothing to send" and "the send failed" — the
  `mirror failed:` line is the only discriminator, and it is a *separate* line.
- **Real tail** (Sept 1, the day it stopped): a busy stretch at `19:08–19:16` doing
  `fetched 117, kept 98 (Nagadhiraj, FRT skipped 0), pushed 97`, then a transport error at
  `08:53:10`, then twelve consecutive `0 rows / pushed 0` cycles to the final
  `[09:05:24] fetched 0, kept 0 (Nagadhiraj, FRT skipped 0), pushed 0`.

---

## 2. `fetchedAt` dependency list — every read site

Swept three ways, per the prompt's cross-check rule: `rg` over the whole tree including
hidden files (excluding `node_modules`, `.next`, `.git`); MSYS `grep -rin` over
`app components lib prisma scripts hooks types`; and a filename-typed `grep -ril` for
`fetchedat` over `*.ts,*.tsx,*.js,*.jsx,*.sql,*.ps1,*.mjs,*.cjs` across the whole repo.
Also swept for `fetched_at`.

### The result: **there are ZERO code reads of `fetchedAt` in this repository.**

| file:line | What it is | Read? |
|---|---|---|
| `prisma/schema.prisma:2274` | `fetchedAt  DateTime @default(now())` — the **declaration** | ✗ not a read |
| `.next/static/chunks/9799-79b41c98e0ac32b6.js` | build output. Context is `…custsoName:"custsoName",createdOn:"createdOn",fetchedAt:"fetchedAt"},t.Prisma.MrnScalarFieldEnum=…` — the generated `TripReportScalarFieldEnum`, **not** a read | ✗ generated artefact |
| `docs/CLAUDE_TRIP_REPORT.md:44,56,110,208` | prose | ✗ |
| `docs/_backup_2026-08-04/CLAUDE_TRIP_REPORT.md:42,54,108` | prose (backup) | ✗ |
| `docs/prompts/archive/2026-07/code-update-2026-07-06-…md:102,112` | prose (archive) | ✗ |
| `docs/prompts/archive/2026-07/code-update-2026-07-04-trip-report.md:27` | prose (archive) | ✗ |
| `docs/_backup_2026-08-04/prompts/archive/2026-07/…` ×3 | prose (backup of archive) | ✗ |
| `grep` for `fetched_at` (snake) anywhere | **no hits** | — |

For completeness, the three places that read the **table** at all — none of which projects,
filters, sorts on, or returns `fetchedAt`:

| file:line | Query |
|---|---|
| `app/api/trips/route.ts:49` | `prisma.tripReport.findMany({ where: { disDate, tripNo: { not: null }, NOT: { tripNo: "0" } }, orderBy: [{ disTime: "asc" }, { tripNo: "asc" }] })` — the response object built at `:93-111` names 15 fields; `fetchedAt` is not among them |
| `app/api/trips/[tripNo]/route.ts:55` | `findMany({ where: { tripNo, disDate }, orderBy: [{ deliveryNo }, { sourceId }] })` — `drops` (`:71-85`) projects 13 named fields; `fetchedAt` is not among them |
| `app/trips/[tripNo]/sheet/page.tsx:65` | `findMany({ where: { tripNo, disDate }, orderBy: [{ deliveryNo }, { sourceId }] })` — feeds `<TripSheetDocument>` totals only |

All three use a bare `findMany`, so Prisma *selects* the column, but no consumer reads it.
`components/trip-report/trip-report-page.tsx` has no freshness, "last synced", "stale" or
"live" indicator of any kind — swept for `fetched|updated|stale|live|sync|refresh` and every
hit is a `deliveryType`/`deliveryAreas`/`fetchList`/`fetchDetail` false positive.

**→ Verdict for the redesign: nothing in the application would break if `fetchedAt` stopped
moving every 62 seconds. Nothing treats it as "is the puller alive" — because nothing treats
it as anything at all.**

**→ But note the flip side, which is the actual finding here:** `fetchedAt` is *currently*
the only liveness signal that exists anywhere in the system, and it is used **exclusively by
humans running ad-hoc SELECTs** — including `CLAUDE_TRIP_REPORT.md:50`'s own 2026-08-04
liveness proof, and including §1.7 of this report. Making it stop moving on unchanged data
removes the *only* method anyone has ever used to answer "is the puller running", and
`CLAUDE_TRIP_REPORT.md §7` already lists **"No alert if the puller stops"** as a live
landmine. The redesign would deepen an already-open hole, not break a caller.

---

## 3. Other callers of `mirror_trip_report_today`

Searched with `rg` (hidden, excluding `node_modules`/`.next`/`.git`) and cross-checked with
MSYS `grep -rn` — 16 hits, all accounted for. The RPC path was searched separately with a
slash-safe char class (`[/]rest[/]v1[/]rpc`) **and** a plain-`grep` re-run, per the prompt's
Git Bash caveat; both agree.

| Hit | Verdict |
|---|---|
| `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1:232` (outside repo) | **CALLED** — the only real invocation. `POST $SupabaseUrl + "/rest/v1/rpc/mirror_trip_report_today"` inside `Push-Rows`, which is invoked from the main loop at `:313` on every cycle. Verified running against production, §1.2. |
| `docs/CLAUDE_TRIP_REPORT.md:40, 46, 189, 190` | **NOT CALLED** — prose + the §8 key-files table. |
| `docs/CLAUDE_CORE.md:300, 939` | **NOT CALLED** — the v27.8 schema-chain entry and the §7.11 pointer. |
| `docs/prompts/archive/2026-07/code-update-2026-07-06-tripreport-mobileshell-puller-mirror.md:107, 114` | **NOT CALLED** — historical build record. |
| `docs/_backup_2026-08-04/CLAUDE_TRIP_REPORT.md:38, 44, 187, 188` | **NOT CALLED** — backup copy of the doc. |
| `docs/_backup_2026-08-04/CLAUDE_CORE.md:199` | **NOT CALLED** — backup copy. |
| `docs/_backup_2026-08-04/prompts/archive/2026-07/…:107, 114` | **NOT CALLED** — backup of archive. |

**Zero TypeScript, JavaScript, SQL or API-route callers exist in the repo.** No
`$queryRaw`/`$executeRaw` anywhere mentions trips. Server-side confirmation: `pg_proc` holds
exactly **one** `mirror_trip_report_today` (`mirror_trip_report_today(jsonb)`), and
`public.trip_report` carries **no triggers** (`pg_trigger … NOT tgisinternal` → none), so
nothing inside the database calls it either.

⚠ **One near-miss worth naming.** The obsolete
`C:\Users\HP\OneDrive\VS Code\nts trip report\nts trip report\Pull-TripReport.ps1`
(2026-07-03) does **not** call the RPC — it POSTs to the raw table:

```powershell
:221    $url = $SupabaseUrl + "/rest/v1/trip_report"
:226        "Prefer"        = "resolution=merge-duplicates,return=minimal"
:287        $kept = @($rows | Where-Object { $_.transporter -ne $null -and ($_.transporter.Trim().ToLower() -eq 'nagadhiraj') })
```

That is the exact pre-2026-07-06 code whose `ON CONFLICT DO UPDATE command cannot affect row
a second time` failure the mirror function was written to fix — and it has no FRT filter. It
still carries a working `settings.txt` beside it. **Verdict: NOT CALLED today, but it is a
loaded gun**: opening the wrong folder resurrects a known-broken sync path.

---

## 4. Schema truth

Read from `prisma/schema.prisma:2236-2280` and verified against production
`information_schema` / `pg_indexes` (read-only).

- **Field count: 38.** `sourceId, tripNo, deliveryType, fixedType, tRate, disDate, disTime,
  vehicleNo, vehType, vModal, driverName, driverMobile, dlRoute, deliveryNo, custCode,
  custName, custAreaName, siteName, siteArea, noArticle, disQty, volLt, netWeight, totQty,
  totWeight, totDistributor, otherDelAreaName, modiInv, remark, promoType, isManual,
  transporter, tranTransporterName, adminName, dieselAmt, custsoName, createdOn, fetchedAt`.
  **Live table: 38 columns, same names, same order.** `CLAUDE_TRIP_REPORT.md §3`'s 38-column
  claim holds exactly.
- **`@@unique` map name:** `trip_report_delivery_no_dis_date_key`, on `([deliveryNo, disDate])`
  — `prisma/schema.prisma:2276`. Live:
  `CREATE UNIQUE INDEX trip_report_delivery_no_dis_date_key ON public.trip_report USING btree ("deliveryNo", "disDate")`. ✅ matches.
- **`rowHash`: DOES NOT EXIST.** Not in the Prisma model, not in the live table (no column
  matching `hash` in any casing), and `rowhash|row_hash` returns zero hits repo-wide.
- **`mirror_heartbeat`: DOES NOT EXIST**, on either side. Repo search for
  `mirror_heartbeat|heartbeat` → zero hits (including docs). Live:
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%heartbeat%' OR '%mirror%' OR '%puller%')` → **(none)**.
- **PK:** `sourceId`, `trip_report_pkey`. Confirmed — and confirmed still meaningless for
  matching, since NTS re-issues it every pull.
- ⚠ **Index-name drift found (new, not in any doc).** `schema.prisma:2277-2278` declares
  `@@index([disDate])` and `@@index([disDate, tripNo])` **with no `map:`**, so Prisma
  believes they are named `trip_report_disDate_idx` and `trip_report_disDate_tripNo_idx`.
  The live names are:
  ```
  CREATE INDEX trip_report_disdate_idx ON public.trip_report USING btree ("disDate")
  CREATE INDEX trip_report_tripno_idx  ON public.trip_report USING btree ("disDate", "tripNo")
  ```
  The **columns are right**; only the names differ, so nothing is broken at query time. But
  by CORE §7's own convention (an index whose live name is not Prisma's default needs an
  explicit `map:`) these two are under-specified, and `CLAUDE_TRIP_REPORT.md §3`'s
  *"Indexes: (disDate), (disDate, tripNo)"* records the shapes without the names.
- **Live function, complete.** `mirror_trip_report_today(jsonb) RETURNS integer`, LANGUAGE
  plpgsql, **4,049 characters**, `provolatile = v`, `prosecdef = false` (so it runs as
  whatever role calls it — the service role). Body, read end to end via
  `pg_get_functiondef`, is: empty-array guard → `create temporary table _incoming on commit
  drop` from a `parsed` CTE that `->>`-extracts all 37 fields (with
  `nullif(r->>'disDate','')::date`) plus `ordinality`, then a `deduped` CTE doing
  `select distinct on ("deliveryNo","disDate") … order by "deliveryNo","disDate", ord desc`
  → `select max("disDate") into target_date from _incoming`
  → `delete from trip_report where "disDate" = target_date`
  → `insert into trip_report (…37 columns…) select … from _incoming`
  → `get diagnostics inserted_count = row_count; return inserted_count`.
  `fetchedAt` is absent from the insert column list, so Postgres stamps `now()` — matching
  `CLAUDE_TRIP_REPORT.md §2`. **The doc's description of this function is accurate.**

  Two properties of that body that no document records, and that any redesign has to survive:
  1. **`target_date` is `max("disDate")` of the incoming batch, but the INSERT is
     unconditional.** If a single pull ever returns rows for two dates — which is exactly
     what a cycle spanning IST midnight could produce — only the newer date's rows are
     deleted while **both** dates' rows are inserted, and the older date's rows then collide
     with `trip_report_delivery_no_dis_date_key`. There is no `ON CONFLICT` clause. The whole
     cycle would error and log `mirror failed: status=…`. Never observed (53 distinct
     `disDate`s held, no anomaly), but it is unguarded.
  2. **A row whose `disDate` parses to NULL is insertable but never deletable** —
     `delete … where "disDate" = target_date` cannot match NULL, and the unique index treats
     NULLs as distinct, so such rows would accumulate forever. Currently harmless:
     `SELECT count(*) FROM trip_report WHERE "disDate" IS NULL` → **0**.

---

## 5. Draft corrections

**The draft file does not exist** (see the banner at the top). What follows scores the three
claims the prompt attributes to it. I cannot confirm or contradict anything else in it.

| Claim | Verdict | Evidence |
|---|---|---|
| **The loop interval is 60 seconds** | **PARTLY WRONG — correct as a constant, wrong as a cadence.** `Start-Sleep -Seconds 60` is real (`:320`), but it sleeps *after* the work. Measured production cadence is **61–62s idle**, and `log.txt` shows **63–65s** on a 117-row day. | §1.2 — six consecutive stamps at 62/62/62/62/61s |
| **Single instance** | **TRUE — and now proven, not assumed.** But the reasoning has to change: process-counting on this machine proves nothing, because the puller is not on this machine. The proof is that production receives exactly one mirror write per ~62s with no interleaving. | §1.7 |
| **The full live function body matches what the draft quotes (draft saw only the first ~3000 chars)** | **UNVERIFIABLE against the draft, but the function is bigger than 3000.** It is **4,049 characters**. A 3000-char read stops inside the `parsed` CTE's column list and **misses the entire operative tail**: the `deduped` `distinct on`, `select max("disDate") into target_date`, the `delete`, the `insert`, and `get diagnostics`. Anything the draft asserts about dedupe order, the delete predicate, or the return value was inferred, not read. The full body is transcribed in §4. | §4 |

### Claims in the canonical file that this pass contradicts

These are doc-vs-code findings, independent of the missing draft. **Code wins; the doc is
wrong.**

1. **`CLAUDE_TRIP_REPORT.md` §2 / §7 / §8 — the puller path.** `F:\VS Code\nts trip
   report\Pull-TripReport.ps1` does not exist. Real path:
   `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1`.
2. **§2 — the transporter filter.** Documented as transporter-only; the live filter also
   excludes `modi_inv = 'FRT'`.
3. **§2 / §8 — "Loops every 60 sec".** 61–65s in practice.
4. **§2 (⚠ block) — "the script has NO repo copy (searched)".** True in the strict sense —
   it is not *in the repo* — but the 2026-08-04 search evidently did not find either of the
   two on-disk copies, and the sentence has since been read as "the script is not on this
   machine". It is: twice.
5. **§7 [NEXT] — "Whether it is a Task Scheduler job yet or still a hand-opened window is
   unverifiable from here."** Now **verified**: not a scheduled task, not an autostart entry,
   and `README.txt` documents the close-the-window stop. The item stands, upgraded from
   suspected to confirmed.
6. **§2 ⚠ — "the mirror's DB rows are the ground truth of whether it runs."** Sound as far as
   it goes, and it is why I could settle the instance count. But this pass shows the sharper
   version: the DB proves *a* puller runs **somewhere**, and says nothing about *which host*.
   That distinction is the whole finding of §1.7.
7. **§3 — "Indexes: (disDate), (disDate, tripNo)"** and `schema.prisma:2277-2278` — the live
   index **names** are `trip_report_disdate_idx` / `trip_report_tripno_idx`, neither of which
   is Prisma's default, and neither carries a `map:`.

---

## 6. Open questions for Smart Flow

1. 🔴 **Which machine is actually running the puller?** This is the blocking one. Production
   is being written every 62 seconds, and it is not coming from this PC — no PowerShell
   process, no scheduled task, no autostart, and a local log that stopped on 2026-09-01. A
   redesign that ships a new script to the wrong host changes nothing and leaves the old one
   running. **Any deployment plan is unsafe until this is answered.** Related: does that host
   run from this same OneDrive folder (in which case its `log.txt` should have synced back —
   it has not), or from an out-of-band copy?
2. **What stopped this machine's copy on 2026-09-01 at 09:05?** It ended on twelve
   consecutive `0 rows` cycles after a transport error — a graceful window-close, or
   something else. Matters, because whatever it was is the failure mode a heartbeat would
   need to catch.
3. **Is the FRT exclusion (`modi_inv = 'FRT'`) intended and permanent?** It is undocumented,
   was added after 2026-07-03, and silently drops rows. If it is intended, canon needs it; if
   it is a hot fix, it needs a decision. Live counts show `FRT skipped 0` on the days
   sampled, so its blast radius is currently unknown.
4. **What should replace `fetchedAt` as the liveness signal?** Today it is the *only* one, it
   is used only by humans running SELECTs, and the redesign's core move is to stop it moving.
   `CLAUDE_TRIP_REPORT.md §7` already lists "No alert if the puller stops" as an open
   landmine — so this is the moment to close it, not to widen it. (No `mirror_heartbeat`
   table or model exists today; a design decision is owed, not an assumption.)
5. **Should `log.txt` carry a date and a size cap?** 57,131 lines / 3.1 MB, `HH:mm:ss` only,
   never rotated. Right now the file cannot tell you which day any line belongs to — the sole
   reason its last entry is datable is the filesystem mtime.
6. **Should `pushed 0` be disambiguated?** It currently means both "NTS had nothing" and "the
   mirror POST failed". Any monitoring built on the log has to parse a *different* line to
   tell those apart.
7. **The `kept 98 → pushed 97` gap:** NTS is sending a duplicate `deliveryNo` every cycle and
   the function's `distinct on` is silently absorbing it. Expected, or a source-data problem
   worth raising with NTS?
8. **Should the two midnight/NULL edges in the live function be closed** (§4) — a
   two-`disDate` batch would violate the unique index and fail the whole cycle, and a
   NULL-`disDate` row would be permanently undeletable? Both are currently theoretical (0
   NULL rows, no observed failure), and both would be cheap to guard while the function is
   open for other reasons.
9. **Delete the obsolete `C:\Users\HP\OneDrive\VS Code\nts trip report\` copy?** It POSTs to
   the raw table with `resolution=merge-duplicates` — the exact pre-2026-07-06 path whose
   `ON CONFLICT` failure the mirror function exists to fix — and it has a live
   `settings.txt`. **Not deleted; CORE §3 forbids deleting without instruction.** Needs an
   explicit call.
10. **Out of scope but flagged:** `docs/dhruv-review/-Dhruv.env` and its `_backup_2026-08-04`
    twin hold a plaintext production DB password inside the working tree. Untracked, so
    nothing is pushed — but they sit in a OneDrive-synced folder.
11. **Should the two index `map:` names be added to `schema.prisma`** (§4), or is the drift
    accepted? Purely cosmetic today; it becomes real the first time anyone diffs the schema.

---

*Discovery only. No code written, no schema changed, no data written. Every production query
above was a `SELECT` / `information_schema` / `pg_catalog` read, per `CLAUDE_CORE.md §3`.*
