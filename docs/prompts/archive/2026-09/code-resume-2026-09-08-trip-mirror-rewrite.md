# Code resume — Trip mirror rewrite, PHASE A (Supabase side only)
# 2026-09-08 · PLAN ONLY. No SQL executed, no schema edited, no commit, no .ps1 touched.
# Companion: docs/prompts/drafts/code-discovery-2026-09-08-trip-mirror.md

**Read for this pass:** `docs/prompts/drafts/code-discovery-2026-09-08-trip-mirror.md` ·
`docs/CLAUDE_TRIP_REPORT.md` (v1.1, Schema v27.13) · `docs/CLAUDE_CORE.md` (v102, Schema
v27.23) §3 · `prisma/schema.prisma` `model TripReport` (2236-2280).

Four premises this design rests on were **verified against production by read-only SELECT
during this planning pass**, not inferred. One of them contradicts the canonical file and
changes the design — see §1 and §7.

---

## 1. What changes and why

1. `mirror_trip_report_today` stops deleting and re-inserting the whole day every ~62s. It
   upserts, gated on a new `trip_report."rowHash"`, so an unchanged row is **not written at all**.
2. The `CREATE TEMPORARY TABLE _incoming` goes; two CTE statements replace it. That removes
   ~1,390 catalogue create/drop cycles a day.
3. Deletions still mirror — rows absent from the batch are removed, scoped to **every** date in
   the batch, not `max()`. That closes the IST-midnight collision (R8a).
4. Rows with a NULL `disDate` — or a NULL/empty `deliveryNo`, which the upsert newly makes
   dangerous — are skipped and counted rather than silently accumulating (R8b, extended).
5. New `mirror_heartbeat` + `trip_mirror_ping` give the puller a liveness signal, because R6
   deliberately stops `fetchedAt` moving and that was the only signal anyone had.
6. The return value stays the **deduped row count**, so the puller's untouched log line keeps
   its present meaning (R10).
7. ⚠ **Honest framing of the motive.** The 2026-09-07 outage message was *"Timed out fetching
   a new connection from the connection pool (limit: 1)"* — `limit: 1` is **Prisma's per-lambda
   pool**, not Postgres's. That the mirror churn caused it is a **plausible, unproven** chain.
   This rewrite is worth doing on its own arithmetic (≈99% fewer row writes); it must **not** be
   reported as the outage fix until G0 says so.

---

## 2. Verified premises (read-only, this session)

| Premise | Result | Consequence |
|---|---|---|
| Does NTS reissue `sourceId` every pull, as `CLAUDE_TRIP_REPORT.md §2/§3` states? | **NO.** Two consecutive live cycles: **74 of 74** `sourceId`s identical. Globally: 6,779 rows / 6,779 distinct ids, `137457 … 160757`, ranges strictly ascending by `disDate` and never overlapping — a real global autoincrement. | **Load-bearing.** If ids *were* reissued per pull, a new delivery could draw an id a frozen unchanged row still holds → `trip_report_pkey` violation with no `ON CONFLICT` to catch it, and the upsert design would be unsafe. It is safe. The doc is wrong (§7). |
| Is `deliveryNo` ever NULL or empty? | **No** — 0 NULL, 0 empty of 6,779. | The `ON CONFLICT ("deliveryNo","disDate")` target is always populated today. Guarded anyway, because the unique index treats NULLs as distinct and the *upsert* would duplicate where the old delete-and-refill wiped. |
| Is `md5((r - 'sourceId')::text)` stable? | **Yes.** jsonb canonicalises key order (`{"b":"2","a":"1"} - 'sourceId'` and `{"a":"1","b":"2"} - 'sourceId'` hash identically); a null-valued key is preserved (`{"a": null}` ≠ `{}`), and `Map-Row` always emits every key. | Hash is a true content fingerprint. |
| Table/server facts | `fetchedAt` = `timestamptz(6) NOT NULL DEFAULT now()`; `disDate` = `date`; **no RLS** on `trip_report`; owner `postgres`; PostgreSQL **17.6**. | `mirror_heartbeat` matches: no RLS, `timestamptz(6)`. |

---

## 3. The ONE SQL block — Supabase SQL Editor, single paste

No `BEGIN`/`COMMIT` wrapper. No `UNION ALL`, so no `LIMIT`-subquery rule to observe. No
identifier named `check`. Distinct dollar-quote tags (`$ping$`, `$mirror$`) so the two bodies
cannot terminate each other. Runs start to finish; every step is idempotent and re-runnable.

```sql
-- ============================================================================
-- PHASE A — trip mirror: stop rewriting unchanged rows
-- 2026-09-08 · Smart Flow · Supabase SQL Editor · single paste, no transaction wrapper
--
-- Output contract: trip_report's CONTENT after this runs is byte-for-byte what the
-- old function produced. Only the amount of WRITING changes, plus two additive objects.
--
-- Order matters: the column and the heartbeat table must exist before the function
-- that writes them.
-- ============================================================================


-- ── 1. rowHash on trip_report ───────────────────────────────────────────────
-- Nullable, no default, no backfill. Existing rows stay NULL on purpose (R5):
-- NULL IS DISTINCT FROM <any hash> is TRUE, so the FIRST run after deploy refreshes
-- every row of the current day exactly once and then settles to near-zero writes.
-- No index: the gate is a per-row comparison inside ON CONFLICT, resolved through the
-- existing trip_report_delivery_no_dis_date_key. An index on rowHash would be pure cost.
alter table public.trip_report
  add column if not exists "rowHash" text;


-- ── 2. mirror_heartbeat ─────────────────────────────────────────────────────
-- Closes the CLAUDE_TRIP_REPORT.md §7 landmine "No alert if the puller stops".
-- camelCase columns, no @map (CORE §3). timestamptz(6) to match trip_report.fetchedAt,
-- or Prisma emits a plain `timestamp` and mismatches the live column.
-- No RLS, matching trip_report.
create table if not exists public.mirror_heartbeat (
  id              text primary key,
  "lastRunAt"     timestamptz(6),
  "lastChangedAt" timestamptz(6),
  "rowsSeen"      integer,
  "rowsChanged"   integer,
  "rowsRemoved"   integer,
  "rowsSkipped"   integer
);

comment on table public.mirror_heartbeat is
  'Liveness for external mirrors. One row per mirror. lastRunAt moves on EVERY call; '
  'lastChangedAt only when data actually changed. Written by mirror_trip_report_today '
  'and trip_mirror_ping. Read by humans and by any future alerting.';

insert into public.mirror_heartbeat (id) values ('trip_report')
on conflict (id) do nothing;


-- ── 3. trip_mirror_ping — for PHASE B, unused in Phase A ────────────────────
-- Lets the puller say "I am alive" on a cycle that did no mirror work at all
-- (an NTS fetch that legitimately returned zero rows, or a fetch that failed).
-- It does NO mirror work and never touches trip_report.
-- NOTE ON p_rows: R9 says this "only stamps lastRunAt". It is written here to
-- rowsSeen as well, because otherwise the parameter has no purpose. Nothing depends
-- on that line — delete it if Smart Flow wants R9 read literally.
create or replace function public.trip_mirror_ping(p_rows integer)
returns void
language sql
as $ping$
  insert into public.mirror_heartbeat as h (id, "lastRunAt", "rowsSeen")
  values ('trip_report', now(), p_rows)
  on conflict (id) do update
     set "lastRunAt" = now(),
         "rowsSeen"  = coalesce(excluded."rowsSeen", h."rowsSeen");
$ping$;


-- ── 4. mirror_trip_report_today — same signature, CREATE OR REPLACE (R1) ────
-- A DROP would leave the mirror broken between the DROP and the CREATE; the puller
-- fires every ~62s, so that window is not theoretical.
create or replace function public.mirror_trip_report_today(rows jsonb)
returns integer
language plpgsql
as $mirror$
declare
  v_seen    integer := 0;   -- deduped, mirrorable rows in this batch  → RETURNED
  v_changed integer := 0;   -- rows actually inserted or updated       → heartbeat
  v_removed integer := 0;   -- rows deleted as absent from the batch   → heartbeat
  v_skipped integer := 0;   -- rows dropped as unmirrorable            → heartbeat
begin

  -- ── R2. Empty / glitched pull ────────────────────────────────────────────
  -- Behaviour preserved exactly: trip_report is NOT touched and 0 is returned, so an
  -- NTS glitch can never wipe the day.
  -- The heartbeat IS still stamped. A cycle that fetched zero rows is a LIVE puller,
  -- and telling those apart from a DEAD one is the entire point of the heartbeat.
  -- Only lastRunAt moves — rowsSeen/rowsChanged keep the last real cycle's numbers
  -- rather than being zeroed by a quiet night.
  if rows is null or jsonb_array_length(rows) = 0 then
    insert into public.mirror_heartbeat as h (id, "lastRunAt")
    values ('trip_report', now())
    on conflict (id) do update set "lastRunAt" = now();
    return 0;
  end if;

  -- ── R7 + R8(a). Mirror deletions ─────────────────────────────────────────
  -- Removes rows that NTS no longer sends. Two guards, both deliberate:
  --   * scoped to EVERY distinct disDate present in the batch, not max(disDate).
  --     R8(a): a pull spanning IST midnight returns two dates. The old body cleared
  --     only the newer one and then INSERTed both unconditionally, so the older date's
  --     rows collided with trip_report_delivery_no_dis_date_key — no ON CONFLICT
  --     existed — and the whole cycle failed. Scoping to all dates removes the cause.
  --   * only rows ABSENT from the incoming set are deleted.
  -- This reads only deliveryNo and disDate out of the jsonb, not all 37 fields.
  -- Deduping is irrelevant here: dedupe picks WHICH occurrence of a key wins, never
  -- which keys exist, so the raw batch and the deduped batch have the identical key set.
  --
  -- ORDERING — see the plan's R7 note. This DELETE is its own statement and runs
  -- BEFORE the upsert, deliberately. The two touch disjoint row sets (absent-from-batch
  -- vs present-in-batch), so the result is identical to running them as sibling CTEs;
  -- running the delete first additionally makes a deliveryNo edit in NTS safe.
  delete from public.trip_report t
   where t."disDate" in (
           select distinct nullif(e.r->>'disDate','')::date
             from jsonb_array_elements(rows) as e(r)
            where nullif(e.r->>'disDate','') is not null
         )
     and not exists (
           select 1
             from jsonb_array_elements(rows) as e2(r)
            where nullif(e2.r->>'disDate','')::date = t."disDate"
              and e2.r->>'deliveryNo' is not distinct from t."deliveryNo"
         );
  get diagnostics v_removed = row_count;

  -- ── R3 + R5 + R6 + R8(b). Parse → dedupe → hash-gated upsert ─────────────
  -- One statement, one jsonb parse, no temporary table (R4).
  with parsed as (
    select
      (e.r->>'sourceId')            as "sourceId",
      (e.r->>'tripNo')              as "tripNo",
      (e.r->>'deliveryType')        as "deliveryType",
      (e.r->>'fixedType')           as "fixedType",
      (e.r->>'tRate')               as "tRate",
      nullif(e.r->>'disDate','')::date as "disDate",
      (e.r->>'disTime')             as "disTime",
      (e.r->>'vehicleNo')           as "vehicleNo",
      (e.r->>'vehType')             as "vehType",
      (e.r->>'vModal')              as "vModal",
      (e.r->>'driverName')          as "driverName",
      (e.r->>'driverMobile')        as "driverMobile",
      (e.r->>'dlRoute')             as "dlRoute",
      (e.r->>'deliveryNo')          as "deliveryNo",
      (e.r->>'custCode')            as "custCode",
      (e.r->>'custName')            as "custName",
      (e.r->>'custAreaName')        as "custAreaName",
      (e.r->>'siteName')            as "siteName",
      (e.r->>'siteArea')            as "siteArea",
      (e.r->>'noArticle')           as "noArticle",
      (e.r->>'disQty')              as "disQty",
      (e.r->>'volLt')               as "volLt",
      (e.r->>'netWeight')           as "netWeight",
      (e.r->>'totQty')              as "totQty",
      (e.r->>'totWeight')           as "totWeight",
      (e.r->>'totDistributor')      as "totDistributor",
      (e.r->>'otherDelAreaName')    as "otherDelAreaName",
      (e.r->>'modiInv')             as "modiInv",
      (e.r->>'remark')              as "remark",
      (e.r->>'promoType')           as "promoType",
      (e.r->>'isManual')            as "isManual",
      (e.r->>'transporter')         as "transporter",
      (e.r->>'tranTransporterName') as "tranTransporterName",
      (e.r->>'adminName')           as "adminName",
      (e.r->>'dieselAmt')           as "dieselAmt",
      (e.r->>'custsoName')          as "custsoName",
      (e.r->>'createdOn')           as "createdOn",
      -- R5. The change fingerprint, taken over the RAW incoming object.
      -- sourceId is REMOVED from the hash. The documented reason is that NTS reissues
      -- it on every pull, which would mark every row changed on every cycle and defeat
      -- the whole exercise. Measured 2026-09-08, NTS does NOT reissue it — ids are
      -- global and stable (74/74 identical across two live cycles). Excluding it is
      -- still correct and is kept: sourceId is functionally dependent on
      -- (deliveryNo, disDate), so it adds nothing to a content hash, and excluding it
      -- keeps this gate working if NTS ever DOES start churning ids.
      -- jsonb canonicalises key order, so the hash is stable across pulls.
      md5((e.r - 'sourceId')::text) as "rowHash",
      e.ord                          as ord
    from jsonb_array_elements(rows) with ordinality as e(r, ord)
  ),
  -- R3. Load-bearing, not decoration. NTS sends one duplicate deliveryNo per cycle
  -- (the puller's own log reads "kept 98 ... pushed 97"). Without this, the INSERT
  -- below hits the same conflict key twice and Postgres raises
  -- "ON CONFLICT DO UPDATE command cannot affect row a second time" — the exact error
  -- the 2026-07-06 rewrite was built to escape. LAST occurrence wins, by ordinality.
  deduped as (
    select distinct on ("deliveryNo", "disDate") *
      from parsed
     order by "deliveryNo", "disDate", ord desc
  ),
  -- R8(b). Unmirrorable rows are SKIPPED AND COUNTED, not inserted.
  --   * disDate NULL  — insertable but never deletable: the delete above matches on
  --     equality and NULL never equals, so such a row would live in the table forever.
  --   * deliveryNo NULL or ''  — NOT in R8(b), added deliberately. The unique index
  --     treats NULLs as distinct, so ON CONFLICT would never fire and the row would be
  --     re-inserted every cycle, growing without bound. The OLD delete-and-refill wiped
  --     it each pass and hid this; the upsert does not. Zero such rows exist today
  --     (0 NULL / 0 empty of 6,779, checked 2026-09-08) — this is a guard, not a fix.
  eligible as (
    select * from deduped
     where "disDate" is not null
       and "deliveryNo" is not null
       and "deliveryNo" <> ''
  ),
  -- R6. Upsert gated on the hash. An unchanged row is not written AT ALL: no heap
  -- tuple, no index entry, no dead tuple for autovacuum. fetchedAt moves only on a
  -- real change, which is exactly why R9's heartbeat exists.
  ups as (
    insert into public.trip_report (
      "sourceId","tripNo","deliveryType","fixedType","tRate","disDate","disTime",
      "vehicleNo","vehType","vModal","driverName","driverMobile","dlRoute","deliveryNo",
      "custCode","custName","custAreaName","siteName","siteArea","noArticle","disQty",
      "volLt","netWeight","totQty","totWeight","totDistributor","otherDelAreaName",
      "modiInv","remark","promoType","isManual","transporter","tranTransporterName",
      "adminName","dieselAmt","custsoName","createdOn","rowHash","fetchedAt"
    )
    select
      "sourceId","tripNo","deliveryType","fixedType","tRate","disDate","disTime",
      "vehicleNo","vehType","vModal","driverName","driverMobile","dlRoute","deliveryNo",
      "custCode","custName","custAreaName","siteName","siteArea","noArticle","disQty",
      "volLt","netWeight","totQty","totWeight","totDistributor","otherDelAreaName",
      "modiInv","remark","promoType","isManual","transporter","tranTransporterName",
      "adminName","dieselAmt","custsoName","createdOn","rowHash", now()
      from eligible
    on conflict ("deliveryNo", "disDate") do update set
      -- deliveryNo and disDate are omitted: they ARE the conflict key and already match.
      "sourceId"            = excluded."sourceId",
      "tripNo"              = excluded."tripNo",
      "deliveryType"        = excluded."deliveryType",
      "fixedType"           = excluded."fixedType",
      "tRate"               = excluded."tRate",
      "disTime"             = excluded."disTime",
      "vehicleNo"           = excluded."vehicleNo",
      "vehType"             = excluded."vehType",
      "vModal"              = excluded."vModal",
      "driverName"          = excluded."driverName",
      "driverMobile"        = excluded."driverMobile",
      "dlRoute"             = excluded."dlRoute",
      "custCode"            = excluded."custCode",
      "custName"            = excluded."custName",
      "custAreaName"        = excluded."custAreaName",
      "siteName"            = excluded."siteName",
      "siteArea"            = excluded."siteArea",
      "noArticle"           = excluded."noArticle",
      "disQty"              = excluded."disQty",
      "volLt"               = excluded."volLt",
      "netWeight"           = excluded."netWeight",
      "totQty"              = excluded."totQty",
      "totWeight"           = excluded."totWeight",
      "totDistributor"      = excluded."totDistributor",
      "otherDelAreaName"    = excluded."otherDelAreaName",
      "modiInv"             = excluded."modiInv",
      "remark"              = excluded."remark",
      "promoType"           = excluded."promoType",
      "isManual"            = excluded."isManual",
      "transporter"         = excluded."transporter",
      "tranTransporterName" = excluded."tranTransporterName",
      "adminName"           = excluded."adminName",
      "dieselAmt"           = excluded."dieselAmt",
      "custsoName"          = excluded."custsoName",
      "createdOn"           = excluded."createdOn",
      "rowHash"             = excluded."rowHash",
      "fetchedAt"           = now()
    where trip_report."rowHash" is distinct from excluded."rowHash"
    returning 1
  )
  select (select count(*) from eligible),
         (select count(*) from ups),
         (select count(*) from deduped) - (select count(*) from eligible)
    into v_seen, v_changed, v_skipped;

  -- ── R9. Heartbeat ────────────────────────────────────────────────────────
  -- lastRunAt moves on every call. lastChangedAt moves ONLY on a real change, so
  -- "the puller is alive" and "the data is moving" become two separate questions.
  insert into public.mirror_heartbeat as h (
    id, "lastRunAt", "lastChangedAt", "rowsSeen", "rowsChanged", "rowsRemoved", "rowsSkipped"
  )
  values (
    'trip_report', now(),
    case when (v_changed + v_removed) > 0 then now() else null end,
    v_seen, v_changed, v_removed, v_skipped
  )
  on conflict (id) do update set
    "lastRunAt"     = now(),
    "lastChangedAt" = case when (v_changed + v_removed) > 0 then now()
                           else h."lastChangedAt" end,
    "rowsSeen"      = excluded."rowsSeen",
    "rowsChanged"   = excluded."rowsChanged",
    "rowsRemoved"   = excluded."rowsRemoved",
    "rowsSkipped"   = excluded."rowsSkipped";

  -- ── R10. Return the DEDUPED row count, not the changed count ─────────────
  -- The puller is UNCHANGED in Phase A and logs:
  --     Write-Log ("mirrored " + $insertedCount + " rows for today")
  -- Returning "rows changed" would print "mirrored 0 rows for today" on every quiet
  -- cycle — which is exactly what a real failure prints, and the operator reading
  -- log.txt has no way to tell them apart. Returning the deduped count preserves the
  -- log line's present meaning byte for byte: it still answers "how many rows does
  -- today's mirror hold". Changed / removed / skipped go to mirror_heartbeat.
  return v_seen;

end;
$mirror$;


-- ── 5. R11. Make PostgREST see the new column and the new function ──────────
notify pgrst, 'reload schema';
```

### Notes the reviewer should read before pasting

- **R7, the CTE-snapshot question, answered directly.** Had the DELETE and the INSERT been
  sibling data-modifying CTEs in one statement, they would share **one snapshot taken at
  statement start**: every sub-statement in a `WITH` sees the same table image, cannot see
  another's output, and their execution order is explicitly not guaranteed. So the delete
  could not have seen — and therefore could not have removed — rows the upsert had just
  inserted. **That is true, and it is not what this design relies on.** The DELETE is its own
  statement, run first, so it provably cannot see the upsert's output. Two reasons for the
  split: (a) the two statements touch **disjoint** row sets — absent-from-batch versus
  present-in-batch — so the outcome is identical either way and the stronger guarantee is
  free; (b) the single-statement form has a real hazard this one does not. If NTS **edits a
  deliveryNo**, the old key must go and a new key must arrive carrying the *same* `sourceId`;
  in one statement the INSERT's uniqueness check can still see the same-command dead tuple
  and raise a `trip_report_pkey` violation, failing the cycle. Delete-first removes the old
  row before the insert and the collision cannot occur.
- **Atomicity is unchanged.** A PostgREST RPC call is one transaction, so both statements
  commit together. No reader ever sees the intermediate state, and
  `CLAUDE_TRIP_REPORT.md §2`'s promise — *"the trip list is never momentarily blank"* — still
  holds.
- **`sourceId` freezes on unchanged rows.** Because the row is not written, its `sourceId`
  stays as first stored. Verified harmless: nothing displays it, and its only use is a
  tiebreak sort key in `app/api/trips/[tripNo]/route.ts:60` and
  `app/trips/[tripNo]/sheet/page.tsx:65`, where a frozen value makes the ordering *more*
  stable. And the measurement in §2 shows NTS does not change it anyway.
- **Two jsonb parses per call**, one for the delete's two-field scan and one for the upsert.
  Against a temp table plus a full-day rewrite, that is noise.

---

## 4. Prisma hand-edit — exact

CORE §3: ALTER in the Supabase SQL Editor → hand-edit `schema.prisma` → `npx prisma generate`.
**Never `db push`, never `db pull`** (the latter also fails P1001 on this machine).

**Edit 1 — `prisma/schema.prisma`, `model TripReport`.** Insert one line **after**
`fetchedAt` (line 2274). `ALTER TABLE … ADD COLUMN` appends, so `rowHash` becomes live
ordinal 39, after `fetchedAt`; keeping the model in live column order:

```prisma
  createdOn           String?
  fetchedAt           DateTime  @default(now())
  rowHash             String?

  @@unique([deliveryNo, disDate], map: "trip_report_delivery_no_dis_date_key")
```

**Edit 2 — new model.** Add immediately after the closing `}` of `model TripReport`
(line 2280), before the `// MRN — MATERIAL RECEIPT NOTE` banner:

```prisma
// ─────────────────────────────────────────────
// MIRROR HEARTBEAT
// ─────────────────────────────────────────────

// Liveness for external mirrors — one row per mirror, seeded with id='trip_report'.
// Created BY HAND in the Supabase SQL Editor and hand-mirrored here; never db push,
// never db pull (CORE §3). camelCase columns, NO @map. Every timestamp carries
// @db.Timestamptz(6) or Prisma emits a plain `timestamp` and mismatches the live column.
// Zero relations. Written only by mirror_trip_report_today() and trip_mirror_ping();
// nothing in the app writes it, and as of this change nothing in the app reads it either.
// It exists because R6 stops trip_report.fetchedAt moving on unchanged data, and that was
// the only signal anyone had for "is the puller alive" — CLAUDE_TRIP_REPORT.md §7.
model MirrorHeartbeat {
  id            String    @id
  lastRunAt     DateTime? @db.Timestamptz(6)
  lastChangedAt DateTime? @db.Timestamptz(6)
  rowsSeen      Int?
  rowsChanged   Int?
  rowsRemoved   Int?
  rowsSkipped   Int?

  @@map("mirror_heartbeat")
}
```

**Then, in order:**

```
npx prisma generate
npx tsc --noEmit
```

`tsc` must pass before any commit (CORE §3). Nothing in `app/`, `lib/` or `components/`
references either new field, so no call-site changes are expected — if `tsc` reports
anything, stop and read it rather than adjusting the schema.

⚠ **Do NOT also add `@db.Timestamptz(6)` to `TripReport.fetchedAt` in this pass.** The live
column *is* `timestamptz(6)` and the model omits the attribute, so that is a genuine
pre-existing drift — but it is unrelated to this work and belongs in the §7 list, not here.

**Schema version.** `trip_report.rowHash` + the `mirror_heartbeat` table is a new schema
version, **v27.24**, and owes an entry in `CLAUDE_CORE.md`'s chain (§300). That chain has
been silently skipped twice already — v27.16/17 (MRN) and v27.21 (CI), both recorded late and
both flagged in the chain itself as a repeating failure. Write the entry in the same pass as
the ALTER, not afterwards.

---

## 5. Gates — write them, do not run them

### G0 — has the temp table actually bloated the catalogue? (READ-ONLY, run BEFORE deploy)

🔴 **State plainly: this has NEVER been run. Until it has, "the temporary table bloated the
catalogue and caused the outage" is a THEORY, not a finding.** The discovery pass measured
`trip_report`'s own churn, never `pg_catalog`'s. And the outage string —
*"Timed out fetching a new connection from the connection pool (limit: 1)"* — names
**Prisma's per-lambda pool of 1**, not a Postgres limit, so even a bloated catalogue is only
one candidate link in an unproven chain.

```sql
-- READ-ONLY. pg_catalog + pg_stat only. CORE §3.
-- G0.a — size and estimated tuple count of the catalogue tables a CREATE TEMPORARY TABLE
-- churns: one pg_class row, one pg_type row (two, with the rowtype), and 37 pg_attribute
-- rows, created and dropped ~1,390 times a day.
select c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
       pg_size_pretty(pg_relation_size(c.oid))       as heap_size,
       c.reltuples::bigint                           as est_rows
  from pg_class c
 where c.oid in ('pg_attribute'::regclass, 'pg_class'::regclass, 'pg_type'::regclass,
                 'pg_depend'::regclass,    'pg_index'::regclass)
 order by pg_total_relation_size(c.oid) desc;

-- G0.b — dead-tuple pressure and whether autovacuum is keeping up on those catalogues.
-- A large n_dead_tup, or a last_autovacuum that is old while n_dead_tup is high, is the
-- signature that would support the bloat theory.
select relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) as dead_pct,
       last_autovacuum, last_autoanalyze, autovacuum_count
  from pg_stat_all_tables
 where schemaname = 'pg_catalog'
   and relname in ('pg_attribute','pg_class','pg_type','pg_depend','pg_index')
 order by n_dead_tup desc;

-- G0.c — is anything holding a snapshot open long enough to block catalogue vacuuming?
select count(*) filter (where state = 'idle in transaction')            as idle_in_txn,
       count(*)                                                          as total_conns,
       max(now() - xact_start) filter (where xact_start is not null)     as longest_txn
  from pg_stat_activity
 where datname = current_database();
```

**How to read it.** `dead_pct` above roughly 20% on `pg_attribute` or `pg_class`, or an
`est_rows` on `pg_attribute` far larger than the real column count of the database, supports
the theory and justifies a **one-off `VACUUM FULL pg_attribute, pg_class, pg_type;`** after
deploy — which takes an ACCESS EXCLUSIVE lock on the catalogue and must be run in a quiet
window, by Smart Flow, deliberately. If `dead_pct` is low and autovacuum is recent, **the
bloat theory is dead** and the rewrite must be reported as a write-volume reduction only,
with the outage still unexplained. Say which of the two happened.

**What would actually settle the outage** — not obtainable from SQL, and worth asking for:
the Supabase dashboard's connection/CPU graph and the Postgres log for
**2026-09-07 17:23–17:48 UTC** (= 22:53–23:18 IST).

### G1 — baseline, taken IMMEDIATELY before deploying (READ-ONLY)

Take this and **paste the output into the deploy record**, so the improvement is measured
rather than asserted. Note the `taken_at`: the deltas, not the absolutes, are the evidence,
and `pg_stat` counters reset on restart.

```sql
-- READ-ONLY. CORE §3.
select now()                                              as taken_at,
       n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
       n_live_tup, n_dead_tup,
       autovacuum_count, last_autovacuum, last_autoanalyze,
       pg_size_pretty(pg_total_relation_size('public.trip_report')) as total_size
  from pg_stat_user_tables
 where schemaname = 'public' and relname = 'trip_report';

-- the mirror's current beat, for the "did it stay live" half of G2
select max("fetchedAt") as newest_mirror_write,
       now()            as server_now,
       now() - max("fetchedAt") as mirror_age,
       count(*)::int    as rows_today
  from trip_report
 where "disDate" = current_date;
```

Reference values from the discovery pass, for shape only — the counters had been reset
roughly 2.75h earlier, so these are **not** a 24h baseline:
`n_tup_ins 7020 · n_tup_del 6976 · n_tup_upd 0 · n_dead_tup 652 · autovacuum_count 5 ·
total 3592 kB`.

### G2 — post-deploy verification

**Run 1 after deploy is expected to look like a full rewrite, and that is correct.** Every
existing row has `rowHash IS NULL`, and `NULL IS DISTINCT FROM <hash>` is TRUE, so run 1
updates every row of the current day once. Expect `rowsChanged = rowsSeen`. That is R5's
one-time settle, not a failure.

**The SECOND run is the test.** Wait for two `lastRunAt` movements (~2 minutes), then:

```sql
-- READ-ONLY. CORE §3.
select id, "lastRunAt", "lastChangedAt", "rowsSeen", "rowsChanged", "rowsRemoved", "rowsSkipped",
       now() - "lastRunAt"     as run_age,
       now() - "lastChangedAt" as change_age
  from mirror_heartbeat
 where id = 'trip_report';
```

| Reading | Means |
|---|---|
| `rowsChanged = 0`, `rowsRemoved = 0`, `rowsSeen` unchanged from before, `lastRunAt` moving, `lastChangedAt` frozen | ✅ **It worked.** Static data is no longer being rewritten. |
| `rowsChanged = rowsSeen` on run 2, run 3, run 4 … | ❌ **The hash is unstable.** Something in the incoming JSON varies between pulls. Diagnose before anything else: `select "rowHash", count(*) from trip_report where "disDate"=current_date group by 1` across two cycles, and check whether the puller emits any per-pull-varying field. Do **not** ship on top of this. |
| `rowsChanged` small and non-zero on a working day | ✅ Normal — NTS genuinely changed those rows. Cross-check against real activity. |
| `rowsSkipped > 0` | ⚠ A row arrived with NULL `disDate` or blank `deliveryNo`. Never seen (0 of 6,779). Investigate the source row; nothing is lost, it is simply not mirrored. |
| `lastRunAt` stops moving | ❌ The puller died. **This is the signal that did not exist before**, and the whole reason R9 is in this change. |

**Also verify, on the same pass:**

```sql
-- READ-ONLY — the write volume actually fell. Compare to the G1 baseline; use DELTAS.
select now() as taken_at, n_tup_ins, n_tup_upd, n_tup_del, n_dead_tup,
       autovacuum_count, last_autovacuum
  from pg_stat_user_tables
 where schemaname='public' and relname='trip_report';
```
After ~30 quiet minutes (≈29 cycles), the deltas should be **near zero** — where the old
design would have added roughly `29 × rows_today` to both `n_tup_ins` and `n_tup_del`.
`n_tup_upd` will now be non-zero where it was always 0; that is the design working, not
regressing.

**And the one check that is not SQL — R10's whole purpose.** The puller's `log.txt` must
still read `mirrored 44 rows for today` (the deduped count), **not** `mirrored 0 rows for
today`. If it reads 0 on a cycle that mirrored real rows, the return value is wrong and R10
was violated. ⚠ Reading that log means reaching the host that runs the puller — see §6.

---

## 6. Rollback

`rowHash` and `mirror_heartbeat` are **additive and harmless if the old function returns**.
The old body never mentions either: it will simply insert rows with `rowHash` NULL, and the
heartbeat will freeze at whatever the last new-function call wrote. Nothing reads either
object — no app code, no route, no query. **Do not drop them on rollback**; if the new
function is later re-deployed, the NULL hashes simply cause one more full-refresh settle,
exactly as on first deploy.

Rollback is therefore one paste. This is the **current live body, transcribed verbatim** from
`pg_get_functiondef` on 2026-09-08 (4,049 characters):

```sql
CREATE OR REPLACE FUNCTION public.mirror_trip_report_today(rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  inserted_count integer;
  target_date date;
begin
  -- Nothing came in → do nothing (guard against an empty/glitched NTS pull wiping today)
  if rows is null or jsonb_array_length(rows) = 0 then
    return 0;
  end if;

  -- Dedupe incoming rows by (deliveryNo, disDate): keep the LAST occurrence in the array
  create temporary table _incoming on commit drop as
  with parsed as (
    select
      (r->>'sourceId')            as "sourceId",
      (r->>'tripNo')              as "tripNo",
      (r->>'deliveryType')        as "deliveryType",
      (r->>'fixedType')           as "fixedType",
      (r->>'tRate')               as "tRate",
      nullif(r->>'disDate','')::date as "disDate",
      (r->>'disTime')             as "disTime",
      (r->>'vehicleNo')           as "vehicleNo",
      (r->>'vehType')             as "vehType",
      (r->>'vModal')              as "vModal",
      (r->>'driverName')          as "driverName",
      (r->>'driverMobile')        as "driverMobile",
      (r->>'dlRoute')             as "dlRoute",
      (r->>'deliveryNo')          as "deliveryNo",
      (r->>'custCode')            as "custCode",
      (r->>'custName')            as "custName",
      (r->>'custAreaName')        as "custAreaName",
      (r->>'siteName')            as "siteName",
      (r->>'siteArea')            as "siteArea",
      (r->>'noArticle')           as "noArticle",
      (r->>'disQty')              as "disQty",
      (r->>'volLt')               as "volLt",
      (r->>'netWeight')           as "netWeight",
      (r->>'totQty')              as "totQty",
      (r->>'totWeight')           as "totWeight",
      (r->>'totDistributor')      as "totDistributor",
      (r->>'otherDelAreaName')    as "otherDelAreaName",
      (r->>'modiInv')             as "modiInv",
      (r->>'remark')              as "remark",
      (r->>'promoType')           as "promoType",
      (r->>'isManual')            as "isManual",
      (r->>'transporter')         as "transporter",
      (r->>'tranTransporterName') as "tranTransporterName",
      (r->>'adminName')           as "adminName",
      (r->>'dieselAmt')           as "dieselAmt",
      (r->>'custsoName')          as "custsoName",
      (r->>'createdOn')           as "createdOn",
      ordinality as ord
    from jsonb_array_elements(rows) with ordinality as t(r, ordinality)
  ),
  deduped as (
    select distinct on ("deliveryNo", "disDate") *
    from parsed
    order by "deliveryNo", "disDate", ord desc
  )
  select * from deduped;

  -- All incoming rows should share one dispatch date (the puller only pulls "today")
  select max("disDate") into target_date from _incoming;

  -- Atomic replace of that date's rows
  delete from trip_report where "disDate" = target_date;

  insert into trip_report (
    "sourceId","tripNo","deliveryType","fixedType","tRate","disDate","disTime",
    "vehicleNo","vehType","vModal","driverName","driverMobile","dlRoute","deliveryNo",
    "custCode","custName","custAreaName","siteName","siteArea","noArticle","disQty",
    "volLt","netWeight","totQty","totWeight","totDistributor","otherDelAreaName",
    "modiInv","remark","promoType","isManual","transporter","tranTransporterName",
    "adminName","dieselAmt","custsoName","createdOn"
  )
  select
    "sourceId","tripNo","deliveryType","fixedType","tRate","disDate","disTime",
    "vehicleNo","vehType","vModal","driverName","driverMobile","dlRoute","deliveryNo",
    "custCode","custName","custAreaName","siteName","siteArea","noArticle","disQty",
    "volLt","netWeight","totQty","totWeight","totDistributor","otherDelAreaName",
    "modiInv","remark","promoType","isManual","transporter","tranTransporterName",
    "adminName","dieselAmt","custsoName","createdOn"
  from _incoming;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;
```

⚠ Rolling back restores both edges R8 closes: the `max("disDate")` midnight collision and the
undeletable NULL-`disDate` row. Restore only to stop a live problem, and note both.

---

## 7. Phase B — BLOCKED

**Phase B is the PowerShell side, and it cannot start.** The 2026-09-08 discovery established
that the machine this work is being done on is **not** the machine running the puller: there
is no `powershell.exe` process on it, no Task Scheduler job (only two Disabled *OrbitOMS Auto
Import* tasks, a different module), no autostart entry, and its local
`C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\log.txt` stops at `[09:05:24]` with a
file mtime of 2026-09-01 — seven days stale — while production keeps taking a mirror write
every 61–62 seconds. A content search of every `.ps1` on C:, D:, E: and F: found the RPC name
in exactly one file, that stopped copy. **The live puller is on an unidentified host with a
copy that is not on any drive here**, and OneDrive has not synced its log back, so that host
is not running from this same folder. Until that host is named, nothing about a `.ps1` can be
planned, written or deployed: a script edited here would reach no running process, the real
one would keep running the old code, and — worse — the plan would *look* shipped. Phase A is
deliberately built to need none of it: the signature, the payload shape and the return value
are all unchanged, so **the existing puller keeps working untouched**, and `trip_mirror_ping`
sits ready but unused until a host can be reached. Reading G2's `log.txt` check also requires
that host. **Naming the machine is the blocker and the only Phase B task that matters.**

---

## 8. Canonical-file corrections this work must carry

List only — **no canonical file edited in this pass.** Each is doc-vs-live, verified by
reading code or by read-only SELECT; the file on disk is wrong.

1. **`CLAUDE_TRIP_REPORT.md` §2, §7 [LANDMINE], §8 — puller path.**
   `F:\VS Code\nts trip report\Pull-TripReport.ps1` does not exist on this machine.
   Real path: `C:\Users\HP\OneDrive\Automation\Orbit\nts trip report\Pull-TripReport.ps1` —
   still outside the repo, but inside a **OneDrive-synced** tree, so `settings.txt`'s
   service-role key is replicated to the cloud. Add that risk note.
2. **`CLAUDE_TRIP_REPORT.md` §2 — transporter filter is incomplete.** The live filter also
   excludes `modi_inv = 'FRT'` (`Pull-TripReport.ps1:300-304`), counted and logged separately.
   Undocumented, added after 2026-07-03.
3. **`CLAUDE_TRIP_REPORT.md` §2, §8 — "Loops every 60 sec".** `Start-Sleep -Seconds 60` sleeps
   *after* the work. Measured: **61–62s idle, 63–65s on a 117-row day**.
4. 🔴 **`CLAUDE_TRIP_REPORT.md` §2 and §3 — "`sourceId` … changes on every pull".** **False.**
   74/74 `sourceId`s identical across two consecutive live cycles; 6,779 rows / 6,779 distinct
   ids spanning `137457…160757`, ascending by date with no cross-day overlap — a global
   autoincrement. This is not cosmetic: it is the stated justification for the whole
   2026-07-06 atomic-mirror rewrite, and it is the premise that decides whether an upsert
   design is safe. §3's `PK: sourceId (NTS's own row ID — changes per pull …)` needs the same
   fix.
5. **`CLAUDE_TRIP_REPORT.md` §3 and `prisma/schema.prisma:2277-2278` — index names.** Live:
   `trip_report_disdate_idx` (disDate) and `trip_report_tripno_idx` (disDate, tripNo). Neither
   is Prisma's default for its shape, and neither `@@index` carries a `map:`. Columns are
   correct; only the names drift. Add `map:` to both, and the names to §3.
6. **`prisma/schema.prisma:2274` — `fetchedAt` lacks `@db.Timestamptz(6)`.** Live column is
   `timestamp with time zone`, `datetime_precision 6`, `NOT NULL DEFAULT now()`. Pre-existing,
   unrelated to this change, deliberately **not** fixed in §4's edit.
7. **`CLAUDE_TRIP_REPORT.md` §7 [NEXT] "Puller as a Task Scheduler job" — upgrade from
   suspected to VERIFIED.** Not a scheduled task, not an autostart entry; `README.txt`
   documents *"Close the PowerShell window to stop it."* The item stands; the uncertainty does
   not. Same section's **"No alert if the puller stops"** is what §3's R9 closes — mark it once
   this ships, not before.
8. **`CLAUDE_TRIP_REPORT.md` §2's ⚠ block — "the script has NO repo copy (searched)".** True
   strictly, but it has been read as "not on this machine". There are **two** copies on disk;
   the second, `C:\Users\HP\OneDrive\VS Code\nts trip report\nts trip report\`, is the
   **pre-2026-07-06 version that POSTs to the raw table** with
   `Prefer: resolution=merge-duplicates` — the exact broken path the mirror function exists to
   replace — and it still has a working `settings.txt`. Record it as a landmine. Not deleted
   (CORE §3).
9. **`CLAUDE_CORE.md` schema chain (§300) — mint v27.24** for `trip_report.rowHash` +
   `mirror_heartbeat`, in the same pass as the ALTER. The chain was skipped for v27.16/17 and
   again for v27.21; the chain itself flags that as a repeating failure.
10. **`CLAUDE_TRIP_REPORT.md` §2's closing claim — "adds, updates, and deletions all sync
    every 60s".** After this change it stays true, but the mechanism is no longer
    delete-and-refill. §2's "Fix" block needs rewriting to describe the hash-gated upsert, the
    heartbeat, and the return-value reasoning (R10).

---

*Plan only. No SQL executed, no schema edited, no file committed, no `.ps1` touched. The four
premises in §2 were established by read-only SELECT / `pg_catalog` queries against production,
per `CLAUDE_CORE.md §3`.*
