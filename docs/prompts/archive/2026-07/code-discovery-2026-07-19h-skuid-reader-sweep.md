# Code Discovery — `skuId` reader sweep (is the bookmark still read?)
# 2026-07-19h · READ-ONLY sweep · No code, no schema edit, no DB writes
# Schema v27.11 (`prisma/schema.prisma`) · CORE header still reads v27.10

**The one question:** does anything still READ
`import_enriched_line_items.skuId` (the Int? FK → OLD `sku_master.id`
row-number bookmark), or is it now write-only and therefore safe for the
write sites to stop feeding?

**VERDICT, up front: `skuId` is WRITE-ONLY. No live reader remains.**
Evidence below, four independent search vectors, every hit classified.

---

## 0. Note on the missing `...19f...` sweep — this file supersedes it

An earlier session (2026-07-19f) ran essentially this sweep and found two live
readers, but its report was **never written to disk**. That session was stopped
at its Task 1 the moment the live-reader stop condition fired, so its Task 4
("save the report") never executed — `docs/prompts/drafts/code-discovery-2026-07-19f-retire-skuid-bookmark.md`
does not exist and never did. Its findings survived only in the conversation
transcript. Both readers it identified (`app/api/orders/[id]/detail/route.ts`
and `app/api/support/orders/[id]/route.ts`) have since been repointed in commit
`a227fb13`, so its conclusions are now historical. **This file (19h) is the
authoritative, re-verified-from-source sweep and supersedes 19f entirely.**
Nothing here was carried over on trust; every hit below was re-grepped and
re-read this session.

---

## 1. Method — four search vectors

Run across `app/`, `lib/`, `components/` (live surface) with `scripts/`
swept separately and reported apart, per the brief.

| # | Vector | What it catches |
|---|---|---|
| V1 | `skuId` | direct column reads/writes + every false positive |
| V2 | `sku: {` · `include: { sku` · `select: { sku` · `.sku` | the relation pulled off an enriched line |
| V3 | `enrichedLineItem` / `enrichedLineItems` | includes that traverse to the catalog, incl. the back-relation |
| V4 | `import_enriched_line_items` | every Prisma query against the table |

Plus two targeted checks: raw SQL (`$queryRaw` / `$executeRaw`) touching
`sku_master`, and a `where: { skuId: ... }` filter anywhere in live code.

---

## 2. LIVE surface — every hit, classified

### 2a. The four already-repointed routes — CONFIRMED SAFE

Their only remaining `skuId` / `.sku` occurrences are **comments** warning
future sessions not to reintroduce the relation. Zero code hits.

| Route | line | nature |
|---|---|---|
| `app/api/picking/order/[orderId]/route.ts` | `:25`, `:74-75` | comment only; resolves by `material` at `:88` |
| `app/api/orders/[id]/removed-lines/route.ts` | `:45`, `:67` | comment only; resolves by `material` at `:77`. Still reads `enrichedLineItem` at `:60`/`:91` but selects **`lineWeight` only** — a scalar, not the catalog relation |
| `app/api/orders/[id]/detail/route.ts` | `:104`, `:127-128` | comment only; resolves by `material` at `:138` (commit `a227fb13`) |
| `app/api/support/orders/[id]/route.ts` | `:81-82` | comment only; resolves by `material` at `:97` (commit `a227fb13`) |

Note `removed-lines` is the one route that still touches the `enrichedLineItem`
relation at all — but only for `lineWeight`, which has no catalog equivalent and
is unaffected by the bookmark. Not a reader of `skuId`.

### 2b. The enrichment WRITE sites — noted, left alone (next step)

| File · line | What |
|---|---|
| `app/api/import/obd/route.ts:1338` | **WRITE** `skuId: sku?.id ?? null` (manual SAP confirm) |
| `app/api/import/obd/route.ts:3143` | **WRITE** `skuId: sku?.id ?? null` (auto confirm) |
| `app/api/import/obd/route.ts:1066` | feeder read — `prisma.sku_master.findMany` for the `id` that `:1338` writes |
| `app/api/import/obd/route.ts:2879` | feeder read — mirror of `:1066`, feeds `:3143` |
| `app/api/import/obd/route.ts:800`, `:1060-1061`, `:1330`, `:2876` | comments describing the above |

Important distinction: `:1066` / `:2879` read the **old `sku_master` table** to
obtain an id. They do **not** read `import_enriched_line_items.skuId`. So the
bookmark column itself is never read on this path either — it is written and
never consulted.

### 2c. Tint `skuId` — CONFIRMED false positive, re-verified

The `skuId` identifiers throughout tint code alias **`rawLineItemId`**, not a
catalog id. Re-proven this session at three independent points:

```
components/tint/tint-operator-content.tsx:2479   skuId: li.rawLineItemId as number,
components/tint/tint-operator-content.tsx:2503   skuId: li.rawLineItemId as number,
components/tint/tint-operator-content.tsx:1728   progressArr.find(p => p.skuId === (li.rawLineItemId ?? -1))
```

The value round-trips into `tint_assignments.currentProgress` /
`lastProgressSnapshot` JSONB as `{ items: [{ skuId, doneQty }] }` and is only
ever compared back against `rawLineItemId`.

**Corroborating negative:** `app/api/tint/operator/done/route.ts`,
`app/api/tint/operator/pause/route.ts` and `app/api/tint/manager/orders/route.ts`
contain **zero** `sku_master` / `prisma.sku*` references — grepped, empty. No
catalog join exists on any tint path. Files in this family:
`MarkDoneConfirmModal.tsx`, `PauseJobModal.tsx`, `PauseHistoryModal.tsx`,
`tint-manager-content.tsx`, `tint-operator-content.tsx`, the two operator routes,
the manager orders route. **Do not repoint any of these.**

### 2d. Other `.sku` matches — all different objects, none are the bookmark

| File · line | What `sku` actually is | Reader? |
|---|---|---|
| `lib/mail-orders/enrich.ts:789-841`, `enrich-v2.ts:492-517` | an **`mo_sku_lookup`** row — fields `material`/`product`/`baseColour`/`refMaterial`/`paintType`/`materialType`. `sku_master` has none of those column names. Grep for `sku_master` in both files: **empty** | no |
| `lib/import-upsert.ts:391` | `r.sku` on a line-plan remove object, interpolated into an audit-note string. Parser data, not a Prisma relation | no |
| `components/picking/picking-board-mobile.tsx:1056`, `:1819`, `components/picking/picker-my-picks-board.tsx:435` | `li.sku` — the **API response field** from the picking detail route, which is `skuCodeRaw` (a string) | no |
| `components/admin/sub-skus-manager.tsx:18,24,43` | a `sku_master.id` passed to `/api/admin/skus/[id]/sub-skus` — the admin CRUD surface, its own table. That endpoint is dead (returns an error string, "removed in schema v10") | no |

### 2e. Raw SQL — clean

`$queryRaw` / `$executeRaw` call sites across the live surface:
`orders/[id]/detail:93` (reads `soNumber` from `import_raw_summary`),
`sampling-library/route.ts:154,180`, `tint/operator/split/start:66`,
`tint/operator/start:57`, `tint/operator/_lib/sampling-resolution.ts:20`.

**None reference `sku_master`, `import_enriched_line_items`, or `skuId`.**
A repo-wide grep for `sku_master` inside any raw-SQL/SELECT/JOIN context
returns a single hit — `app/api/import/obd/route.ts:681`, which is a **comment**.

### 2f. `where: { skuId: ... }` filters in live code — none

No live query filters on the column. The only such filters
(`where: { skuId: { not: null } }`) are in a scratch diagnostic script (§3).

### 2g. `sku_master.enrichedLineItems` back-relation — never traversed

Declared at `prisma/schema.prisma:246`. Zero live consumers (V3 sweep returned
no non-comment hits outside the schema).

---

## 3. `scripts/` — reported separately, NOT runtime

Underscore-prefixed files are excluded from the `tsc --noEmit` gate (CORE §15)
and are never imported by the app.

| File · line | Reads | Nature |
|---|---|---|
| `scripts/_diagnose-sku-5961032.ts:27`, `:41` | `skuId: true`, and `enrichedLineItem: { select: { sku: { select: { packSize } } } }` | **A genuine reader of the relation — but a scratch diagnostic.** Not runtime. Will break only if the relation is removed from the schema, which is a LATER step, not this one |
| `scripts/_diagnose-skuid-collision.ts:19,73-74,84,93` | `where: { skuId: { not: null } }`, `select: { skuId }` | scratch diagnostic — the script that originally proved the id-space collision |
| `scripts/_smoke-order-detail-repoint.ts:30` | queries `import_enriched_line_items`, selects **no** `sku`/`skuId` | scratch smoke check from `a227fb13`; already bookmark-free |
| `scripts/repair-sampling-import.ts:223,231-232` | `skuIdx` — a **column-index variable** | pure substring false positive |
| `scripts/normalise-sampling-data.ts:313` | `prisma.sku_master.findMany({ select: { skuCode } })` | reads the old table directly; never touches the bookmark |

**Consequence for planning:** the two `_diagnose-*` scripts are the only things
in the repo that read the bookmark. They are scratch, uncommitted-in-spirit, and
outside the compile gate. They do **not** block cutting the writer. They would
only matter at the eventual `DROP COLUMN` / relation-removal step, and per CORE §3
("never delete files unless instructed") they stay on disk regardless.

---

## 4. Parked / excluded

`docs/dhruv-review/**` mirrors the import route (`route-Dhruv.ts:468,959,968,1626`)
and `sub-skus-manager-Dhruv.tsx`. A parked, untracked review snapshot, excluded
from `tsconfig.json` (CORE §15). Not live, not built, not deployed. Ignored.

---

## 5. VERDICT

> **`skuId` is WRITE-ONLY — no live reader remains.**

- **0** live runtime paths read `import_enriched_line_items.skuId`.
- **0** live runtime paths traverse the `sku` relation off an enriched line.
- **0** live raw-SQL statements touch `sku_master` or the bookmark.
- **0** live queries filter on `skuId`.
- The only remaining live references are **2 write sites** (`:1338`, `:3143`),
  their **2 feeder reads** of the old table (`:1066`, `:2879`), and **comments**.
- The only readers anywhere are **2 scratch diagnostic scripts**, outside the
  compile gate and outside the runtime.

**This clears the precondition for the next step** (stop the write sites
depending on the old `sku_master` id). It does NOT authorise dropping the
column or removing the relation — that stays bundled with the future
"retire old `sku_master` + 3 FK tables + rename v2" session, and the two
scratch scripts are the only things that would need a glance at that point.

### Confidence note

The 19f sweep reached the opposite verdict two sessions ago because two readers
existed then. Both were repointed in `a227fb13` — verified in this sweep by
reading the current source, not by trusting the commit message. The difference
between then and now is real and accounted for, not a re-classification of the
same hits.

---

*Sweep only · No code written · No schema edited · No DB writes · 2026-07-19h*
