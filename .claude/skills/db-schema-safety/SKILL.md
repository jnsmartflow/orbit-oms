---
name: db-schema-safety
description: Apply before ANY database, Prisma, or SQL work in OrbitOMS — creating or altering tables and columns, editing prisma/schema.prisma, adding a relation, writing a migration, or running SQL in the Supabase SQL Editor. Loads the non-negotiable rules that prevent schema corruption, Prisma relation-ambiguity errors, the id-space mispoint, and permission mistakes. Trigger words: database, schema, prisma, migration, SQL, table, column, relation, foreign key, Supabase, ALTER, seed, permission.
---

# Database & Schema Safety (OrbitOMS)

Apply every rule here before touching the database, `prisma/schema.prisma`, or any SQL.
Each rule exists because breaking it has already corrupted production or blocked commits.
If a request asks you to break one of these, STOP, name the rule, explain the risk, propose the
safe path, and wait — do not comply silently.

## The schema-change workflow — never deviate
- **Never `prisma db push`.** Change the schema in the Supabase SQL Editor (`ALTER ...`), then
  hand-edit `prisma/schema.prisma` to match, then run `npx prisma generate`.
- **Never `prisma db pull`.** It fails here (P1001 — the direct Supabase host is IPv6-only, the depot
  line is IPv4-only). Hand-edit the schema file to match what you ran in SQL.
- **Never `prisma.$transaction`.** Use sequential `await`s. (A handful of legacy `$transaction` calls
  exist and are deliberately left in place — do not add new ones.)
- After any schema change: `npx prisma generate`, then `npx tsc --noEmit` must pass before any commit.

## Schema conventions
- Columns are **camelCase with no `@map`**. Exception: the `pick_assignments` table predates this rule
  and uses `@map` snake_case — match the table you are actually editing.
- New timestamp columns MUST carry `@db.Timestamptz(6)`, or Prisma emits a plain `timestamp` that
  mismatches the live Postgres column.
- Every API route needs `export const dynamic = 'force-dynamic'`.

## Relations — the ambiguity trap
- When a table has **two or more foreign keys pointing at the same target table**, EVERY relation
  between them must be explicitly named with `@relation("Name")` on BOTH sides. An unnamed relation
  here is a hard Prisma error, not a warning.
- Known live cases: `orders` → `delivery_point_master` (`customer` + `shipToOverride`),
  `pick_assignments` → `users` (`picker` + `assignedBy` + `checkedBy`). Any NEW foreign key to a
  target the table already points at must follow the same explicit-naming pattern.

## The id-space landmine — read before ANY SKU-catalog work
- **Never repoint a foreign key between two tables that hold the same logical rows under different
  ids.** `sku_master` and `sku_master_v2` assign completely different id numbers to the same material
  code (zero overlap, verified against production). Repointing the FK would silently turn every
  historical line into a confidently WRONG product on live picking bills.
- Resolve by the **natural key** — `material`, the SAP code — never by an internal row id.

## "Auto" columns that are NOT automatic
- A column named `updatedAt` is only auto-stamped if it has the `@updatedAt` directive. Some tables
  here (`push_subscriptions`, `sku_master_v2`) use a plain `@default(now())`, which fires on INSERT
  only. Every UPDATE to those tables MUST set `updatedAt: new Date()` explicitly, or the timestamp
  goes stale. The name misleads — check the directive.

## SEED IS NOT LIVE
- The seed file describes what a FRESH database would contain. Live holds years of hand edits, and the
  two disagree — permissions especially.
- **Before any permission change or data assumption, SELECT the live rows first.** Never plan from the
  seed file. This has bitten at least three times in one week.

## Supabase SQL Editor limits
- No `BEGIN`/`COMMIT` wrappers. A `LIMIT` inside `UNION ALL` must be wrapped in a subquery. `check` is
  a reserved word — use `chk`. `ON CONFLICT` needs a real, already-existing unique constraint.
- The editor shows only the LAST statement's result — join multiple results with `UNION ALL` to see
  them together.
- Comment out any `DELETE` or other destructive statement and say so, so the `SELECT` above it can be
  reviewed before anything is removed. When clearing permission rows, SELECT both the rows to delete
  AND the rows that must survive, labelled, in the same block.

## Soft-delete reads
- Every `orders` list/find adds `where: { isRemoved: false }`. Every `delivery_challans` list adds
  `where: { isVoided: false }` — EXCEPT challan sequence-number allocation, which MUST include voided
  rows to avoid number collisions.
