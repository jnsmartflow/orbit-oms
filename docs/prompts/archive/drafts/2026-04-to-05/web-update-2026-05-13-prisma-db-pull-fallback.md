# Web update — 2026-05-13 — schema change workflow (IPv4 fallback)

**Tiny note for the next CLAUDE_CORE.md consolidation pass.**

---

## What changed

The standard schema-change workflow in `CLAUDE_CORE.md §3` says:

> Schema changes via Supabase SQL Editor + `npx prisma db pull` +
> `npx prisma generate`.

In this session (Prompt 1 of the OT workflow backend), `prisma db pull`
failed with **P1001** — couldn't reach
`db.lgtcibgrzhmuhnxmxvmd.supabase.co:5432`.

**Root cause:** Supabase has deprecated free IPv4 on the direct-host
connection. The Surat depot ISP is IPv4-only. The direct host
(`db.*.supabase.co:5432`) is unreachable from the local machine.
This is structural, not transient — it will recur on every future
schema change until either:

- ISP rolls out IPv6 (unknown timeline), or
- An IPv6-capable relay is configured (overkill).

**The pooler (port 6543) is transaction-mode and won't accept
`prisma db pull`** — it returns garbled introspection. Don't try B.

---

## Canonical workaround (option C)

After running the SQL in Supabase SQL Editor:

1. **Hand-edit `schema.prisma`** to mirror the SQL exactly. Every new
   column, model, back-relation, type, default, index, unique constraint.
2. Run `npx prisma generate` (no DB call required — works offline).
3. Run `npx tsc --noEmit` to confirm types are correct.
4. Done.

This is **fully equivalent** to what `db pull` would have produced.
The DB is already migrated; Prisma's job at this point is just to know
the schema shape so the generated client types are correct.

### Type mapping rules for the hand-edit

When mirroring SQL → Prisma:

| SQL                            | Prisma                         |
|--------------------------------|--------------------------------|
| `INTEGER`                      | `Int`                          |
| `TEXT`                         | `String`                       |
| `BOOLEAN`                      | `Boolean`                      |
| `TIMESTAMPTZ(6)`               | `DateTime @db.Timestamptz(6)`  |
| `DECIMAL(10,7)`                | `Decimal @db.Decimal(10, 7)`   |
| `SERIAL PRIMARY KEY`           | `Int @id @default(autoincrement())` |
| `DEFAULT now()`                | `@default(now())`              |
| `DEFAULT 0`                    | `@default(0)`                  |
| `DEFAULT '19:00'`              | `@default("19:00")`            |
| `DEFAULT true`                 | `@default(true)`               |
| nullable (no NOT NULL)         | optional (`?` suffix)          |
| `NOT NULL DEFAULT`             | required field with `@default()` |
| `UNIQUE (a, b)`                | `@@unique([a, b])`             |
| `INDEX (a, b)`                 | `@@index([a, b])`              |

### Back-relations require explicit `@relation("...")` names

`prisma db pull` would auto-generate them. In hand-edit mode, Claude
Code must add them with explicit names to avoid clashes with existing
relations. Use descriptive names like `AttendanceOtApprover`,
`AttendanceOtGraceUser`, etc.

### Recommended verification step

Show the `schema.prisma` diff before running `prisma generate` so a
human can sanity-check the hand-edit matches the SQL. If any column
type or default is wrong, fixing it at this stage is trivial; fixing
it after `prisma generate` regenerates the client is also trivial but
adds noise.

---

## Where to add this to CLAUDE_CORE.md

Suggested location: `§3` (engineering rules) under the existing
schema-change rule. Add a sub-bullet:

> **If `prisma db pull` fails with P1001 (IPv4-only ISP can't reach
> Supabase's IPv6-only direct host), hand-edit `schema.prisma` to
> mirror the SQL and run `prisma generate` only. Equivalent result.
> See `docs/prompts/drafts/web-update-2026-05-13-prisma-db-pull-fallback.md`
> for the type mapping table.**

---

## When this changes

If/when the depot ISP rolls out IPv6 or Smart Flow sets up an IPv6
relay, `prisma db pull` will start working again from the depot
machine. The hand-edit fallback remains correct either way; it just
won't be necessary.
