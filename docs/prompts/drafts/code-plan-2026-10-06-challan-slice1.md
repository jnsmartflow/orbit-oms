# code-plan-2026-10-06 — Challan Orders · slice 1 (DDL)

**Status:** DDL RUN LIVE 2026-10-06 by the owner (verification passed, 12 rows); slice 1b (schema.prisma, workflow-stages, permissions, CORE v27.60) committed with this file.
**SQL:** `sql/2026-10-06-challan-orders-ddl.sql` (one block, re-runnable, ends in a read-back).
**Design:** `docs/prompts/drafts/web-update-2026-10-06-challan-orders.md` (§3 D1–D13, §4 F1–F6, §4b M1–M8).
**Evidence:** discovery `e0c6c321` (report 1) and `69f2ccec` (report 2); live read-only SELECTs 2026-10-06 (below).
**Schema:** this plan was written against CORE v131 · Schema v27.58 and said "v27.59"; v27.59 was minted the same day for `mo_orders_soNumber_idx` (`222913d2`), so this slice is **v27.60** (CORE v133).

---

## 1. New objects — one line each, with why

| # | Object | Why |
|---|---|---|
| 1 | `orders."isChallanOrder"` boolean NOT NULL DEFAULT false | Marks the ORB order (the challan). NOT NULL so every predicate is `{ isChallanOrder: false }` with no NULL arm (CORE §13). Billing Picking/Print exclude on it (slice 2). |
| 2 | `orders."challanOrderId"` integer NULL | On the SAP OBD: points at its ORB order. Self-relation. The **per-OBD** link — one SO can yield several OBDs (225 such SOs in 90 days, live). |
| 3 | `orders_challanOrderId_fkey` → `orders(id)` ON DELETE RESTRICT | Orders are soft-deleted; a hard delete of a linked ORB order must fail, not orphan. |
| 4 | `orders_challanOrderId_idx` | FK referencing side + "the OBDs of this challan" (Billed / History rows). Prisma-default name. |
| 5 | `chk_orders_challan_role` | A row is a challan OR a linked SAP bill, never both. |
| 6 | `chk_orders_challan_not_self` | `challanOrderId <> id`. |
| 7 | `chk_orders_orb_number` | Flag ⇔ number: challan ⇒ `^ORB-[0-9]{4}-[0-9]{5}$` (F6); any other bill never starts `ORB-`. Makes the ORB space impossible to collide with SAP's. |
| 8 | table `challan_order_so_links` (12 cols) | The SO is pasted BEFORE the SAP OBD exists (D10), so it cannot live on `orders`. One ORB → many SOs (F5). |
| 9 | `chk_challan_order_so_links_status` | `waiting` · `linked` · `unlinked` (M5 adds `unlinked` to the draft's two). |
| 10 | `chk_challan_order_so_links_so_shape` | `^[0-9]{10}$` — a real SAP SO. Live: 17,086 of 17,161 `orders.soNumber` are 10 digits; the other 75 are free text and could never match an import. Same rule as `normaliseSoNumber`. |
| 11 | `chk_challan_order_so_links_shape` | Each status carries exactly its columns; `unlinked` only from `waiting` (no OBD on an unlinked row). |
| 12 | `chk_challan_order_so_links_not_self` | `linkedOrderId <> orbOrderId`. |
| 13 | 4 FKs: `orbOrderId`/`linkedOrderId` → orders RESTRICT, `linkedById` → users RESTRICT, `unlinkedById` → users SET NULL | Prisma-default names. Who pasted is the record (RESTRICT, the `so_tags.addedById` rule); who unlinked is an optional stamp. |
| 14 | `challan_order_so_links_soNumber_live_key` UNIQUE (`soNumber`) WHERE `status <> 'unlinked'` | **F5** — one SO → one challan among live rows; an unlinked row frees the SO and stays as audit (M5). Also the import's lookup index. PARTIAL → a model comment, never `@@unique`. |
| 15 | `challan_order_so_links_orbOrderId_idx`, `_linkedOrderId_idx` | FK referencing sides; the screen reads by ORB order. |
| 16 | `trg_live_changes_challan_order_so_links_{ins,upd,del}` → `live_changes_child_*('order','parent','orbOrderId')` | CORE §13: a table a screen reads needs its trigger in the same commit. The `so_tag_matches` pattern, read live. A paste/link/unlink writes no `orders` row. |

**No DDL, on purpose:** the linked-OBD status (§2 — no CHECK on `orders.workflowStage` or `order_status_logs`, live); page keys (§4 — TypeScript only); ORB numbering (§5); the print log (D7 parked); user rows (slice 9).

## 2. The status-column choice

**`orders.workflowStage = 'challan_linked'`** — a new TERMINAL stage (rank null, like `cancelled`), with `dispatchStatus` left NULL.

Why this one needs the fewest predicate changes:
- **Every dispatch surface already filters on a STAGE SET a new value is not in** — exactly how `cancelled` vanishes (report 1 Q3): picking `buildPickingWhere`, Floor arms 1/2/3 (stage sets / `RAIL_STAGES`), arm 4 (pins `'dispatch'`; NULL status fails it), Billing pending (`pick_checked`), Tint Manager (tint stages), Floor Cancelled (keys on `'cancelled'`). **Zero board predicate edits.**
- **Import's R2 skips it for free**: `applyNoMailOrderFallback` takes only `workflowStage = 'pending_support'` (IMPORT §2.1). R1's auto-done block is pinned to `pending_support` too. A re-import cannot move it back: the patch path locks stage (`lib/import-upsert/header.ts:6`, report 2 Q7).
- **No CHECK to widen** — live: the only constraint on `orders` is `orders_obdNumber_key`; `order_status_logs` has no CHECK.

Why NOT the others:
- **`dispatchStatus` (new value)** — it is written **by SO number** from three places that run after the link: enrichment (`applyMailOrderEnrichment`), Billing's ⚑Hold/actions route (`orders.updateMany WHERE soNumber`, CLAUDE_BILLING §5) and Telephonic `applySoTagHolds`. Any of them would OVERWRITE the hidden value with `dispatch`/`hold`, putting the bill back on picking — the double dispatch this feature exists to stop. A tint SAP OBD would also stay on Tint Manager (it filters on stage, not status). And the schema comment rules it out (`schema.prisma:1254`).
- **A new column as the flag** — every predicate (~10 feeds) gains a term; the most edits.

**Predicates the later slices must still touch** (the stage choice does not cover these):

| Slice | Where | Change |
|---|---|---|
| 6 | R1 `applyMailOrderEnrichment` + the catch | Look up a live link by SO **before** the auto-done block; write `workflowStage='challan_linked'`, `challanOrderId`, `dispatchStatus=null`, no slot/priority, one log row. Its general `updateMany WHERE soNumber` must exclude `challan_linked` rows, or it writes `hold` onto them. |
| 6 | Import CHN creation (`createChallanForOrder` + the inline loops, report 1 Q4) | Skip a linked OBD (D4). |
| 6 | Billing actions route (`app/api/billing/mail-order/actions`) `orders.updateMany WHERE soNumber` | Exclude `challan_linked`. |
| 6 | Telephonic `applySoTagHolds` (`lib/billing/telephonic-apply.ts`) | Exclude `challan_linked`. |
| 6 | `floorHoldWhere` (`lib/floor/queries.ts:1230`) | Belt-and-braces `workflowStage: { not: 'challan_linked' }` — it has no stage term, so any stray hold would surface the bill on the Hold tab. (`workflowStage` is NOT NULL — no NULL arm needed.) |
| 6 | Pull-back writer (D11) | New writer; refuses `tripDropId` set / picker / tint (report 2 Q6). |
| 2 | Trip add route + `billLookupWhere` (`lib/trips/find-bill.ts`) | Refuse `challanOrderId` set. ⚠ FLOOR_TRIPS §13 says "do not add a stage guard" — this is a link guard, owner to confirm the wording. |
| 2 | `buildBillingPendingWhere`, `loadPrintTrips` | `isChallanOrder: false` / exclude (ORB orders, report 2 Q4). |
| 2 | Tint manual entry (Add to Tint) | Refuse `isChallanOrder` (the linked OBD is already refused: not in `MANUAL_TINT_PULLABLE_STAGES`). |
| 6 | Same-SO rules: `lib/picking/duplicate-so.ts`, `lib/billing/pick-delete.ts` | Leave `challan_linked` out of the SO group — verify by reading. |
| 6 | `lib/workflow-stages.ts` | Register `{ stage: "challan_linked", rank: null, terminal: true, supportMayEdit: false }`; sweep rank comparisons for an `undefined` rank. |
| 8 | Freight pool / add (`lib/freight-trips/pool.ts`, `bills.ts:81`) | Only once D13 is decided. |

## 3. `schema.prisma` edits for slice 1b (exact)

`orders` — add (comments as in the house style):
```prisma
  // Challan orders (2026-10-06, Schema v27.60). TRUE = an ORB order (the challan).
  // Live CHECKs not expressible here: chk_orders_challan_role,
  // chk_orders_challan_not_self, chk_orders_orb_number (sql/2026-10-06-challan-orders-ddl.sql).
  isChallanOrder      Boolean   @default(false)
  // On the SAP OBD: the ORB order it was billed against. SELF-relation — named on
  // both sides. onDelete Restrict MUST be spelled out: Prisma's default for an
  // optional relation is SetNull, the live FK is RESTRICT.
  challanOrderId      Int?
  challanOrder        orders?   @relation("OrderChallanOrder", fields: [challanOrderId], references: [id], onDelete: Restrict)
  challanLinkedOrders orders[]  @relation("OrderChallanOrder")
  challanSoLinks          challan_order_so_links[] @relation("ChallanSoLinkOrbOrder")
  challanSoLinksAsLinked  challan_order_so_links[] @relation("ChallanSoLinkLinkedOrder")
  ...
  @@index([challanOrderId])
```

New model:
```prisma
// Challan orders (2026-10-06, Schema v27.60). One row per SO pasted against an ORB order.
// 🔴 PARTIAL unique, not expressible in Prisma — never @@unique:
//   challan_order_so_links_soNumber_live_key ("soNumber") WHERE status <> 'unlinked'
// Live CHECKs: chk_challan_order_so_links_status (waiting|linked|unlinked),
//   _so_shape (^[0-9]{10}$), _shape, _not_self.
// Live-feed triggers trg_live_changes_challan_order_so_links_{ins,upd,del}.
model challan_order_so_links {
  id            Int       @id @default(autoincrement())
  orbOrderId    Int
  orbOrder      orders    @relation("ChallanSoLinkOrbOrder", fields: [orbOrderId], references: [id], onDelete: Restrict)
  soNumber      String
  status        String    @default("waiting")
  linkedOrderId Int?
  linkedOrder   orders?   @relation("ChallanSoLinkLinkedOrder", fields: [linkedOrderId], references: [id], onDelete: Restrict)
  obdLinkedAt   DateTime? @db.Timestamptz(6)
  linkedById    Int
  linkedBy      users     @relation("ChallanSoLinkLinkedBy", fields: [linkedById], references: [id], onDelete: Restrict)
  linkedAt      DateTime  @default(now()) @db.Timestamptz(6)
  unlinkedById  Int?
  unlinkedBy    users?    @relation("ChallanSoLinkUnlinkedBy", fields: [unlinkedById], references: [id], onDelete: SetNull)
  unlinkedAt    DateTime? @db.Timestamptz(6)
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([orbOrderId])
  @@index([linkedOrderId])
}
```

`users` — add the two back-relations (two FKs → both named, CORE §7.3):
```prisma
  challanSoLinksLinked   challan_order_so_links[] @relation("ChallanSoLinkLinkedBy")
  challanSoLinksUnlinked challan_order_so_links[] @relation("ChallanSoLinkUnlinkedBy")
```

Every constraint and index name in the SQL is Prisma's default → **no `map:` anywhere**. Then `npx prisma generate` + `npx tsc --noEmit`.

## 4. Page keys

Stored **in TypeScript only** — the `PageKey` union + `ALL_PAGE_KEYS` in `lib/permissions.ts`; `user_page_access."pageKey"` is free text with no FK and no key table (CORE §7.14; live: no `page_keys`/`pages` table). **The union touched is `PageKey`, not `RoleSidebarRole`.** Two keys cover the three ticks:

| Key | Tick(s) | Notes |
|---|---|---|
| `place_order_challan` | canEdit = "Place Order · Create challan order" | Like `place_order_ship_to`: canEdit is its only meaning. M3: it also shows the three-way Ship-to. |
| `challan_orders` | canView = "Challan orders — view", canEdit = "— edit" | One key for the ONE shared screen (D8) in Billing, Floor and Place Order. Not in `PAGE_NAV_MAP` (a tab, not a page). |

Both go into `ACTION_PAGES.canEdit`, `PAGE_LABEL_OVERRIDES`, `ACCESS_SECTIONS`. Live: 0 `user_page_access` and 0 `role_permissions` rows for either name. **No rows in this slice**; slice 9 decides grants from a live SELECT and whether to write all-false rows first (the `billing_telephonic` precedent, so `/admin/access` raises no "rows missing" banner).

## 5. ORB numbering — no DDL

`ORB-{YYYY}-{NNNNN}` in `orders."obdNumber"`. Allocate MAX+1 over `obdNumber >= 'ORB-2026-' AND obdNumber < 'ORB-2026.'` ordered DESC (a btree range — `LIKE 'ORB-…%'` may not use the index under the default collation), insert, on P2002 re-allocate and retry once (trip-number pattern), never `$transaction`. The live `orders_obdNumber_key UNIQUE ("obdNumber")` catches the clash; `chk_orders_orb_number` guarantees the shape and that no SAP row can ever hold an ORB number. 0 live rows start `ORB-`.

## 6. CORE entry for slice 1b (v27.60)

> - **v27.60** · 2026-10-06 · SQL `sql/2026-10-06-challan-orders-ddl.sql` (Prisma fields + model in the same commit) · **RUN LIVE <date> by Smart Flow and verified** by the file's own PART 5 read-back. **Challan Orders, Phase 1** — design `docs/prompts/drafts/web-update-2026-10-06-challan-orders.md`, plan `code-plan-2026-10-06-challan-slice1.md`. **`orders`** gains `"isChallanOrder"` boolean NOT NULL DEFAULT false (an ORB order — the challan) and `"challanOrderId"` integer NULL → `orders(id)` ON DELETE RESTRICT (`orders_challanOrderId_fkey`; on the SAP OBD billed against a challan), index `orders_challanOrderId_idx`; self-relation **`OrderChallanOrder`**, named on both sides. 🔴 **The FIRST CHECK constraints on `orders`**, none expressible in Prisma: `chk_orders_challan_role` (`NOT ("isChallanOrder" AND "challanOrderId" IS NOT NULL)`), `chk_orders_challan_not_self`, `chk_orders_orb_number` (challan ⇒ `^ORB-[0-9]{4}-[0-9]{5}$`, any other bill never `^ORB-`). New table **`challan_order_so_links`** (12 columns) — an SO pasted against an ORB order before its OBD exists: `status` `waiting|linked|unlinked` (`chk_…_status`), `soNumber` 10 digits (`chk_…_so_shape`), `chk_…_shape`, `chk_…_not_self`; FKs `orbOrderId`/`linkedOrderId` → orders RESTRICT, `linkedById` → users RESTRICT, `unlinkedById` → users SET NULL — relations **`ChallanSoLinkOrbOrder`** / **`ChallanSoLinkLinkedOrder`** / **`ChallanSoLinkLinkedBy`** / **`ChallanSoLinkUnlinkedBy`**, named on both sides; 🔴 PARTIAL unique `challan_order_so_links_soNumber_live_key ("soNumber") WHERE status <> 'unlinked'` (F5, recorded as a model comment); indexes `_orbOrderId_idx`, `_linkedOrderId_idx`; live-feed triggers `trg_live_changes_challan_order_so_links_{ins,upd,del}` (`live_changes_child_*('order','parent','orbOrderId')`, the `so_tag_matches` pattern). **No DDL for the linked-OBD status:** it is `workflowStage = 'challan_linked'` (terminal, rank null) — `orders` has no CHECK on that column and `order_status_logs` none on `toStage`. Page keys `place_order_challan` / `challan_orders` are code only. No data written. ✅ Recorded in this chain on the day.

Plus, same pass: §7.3 `orders` block gains a CHALLAN block and the relation count; §13 trigger list gains `challan_order_so_links`.

## 7. Risks

1. **First CHECKs on `orders`.** Any writer that breaks one fails its write — including a hand SQL fix. Validation takes an ACCESS EXCLUSIVE lock for a 17k-row scan (milliseconds). Run outside import hours.
2. **`CREATE INDEX` on `orders`** takes a SHARE lock (blocks order writes) for the build — sub-second at this size, still: off-hours.
3. **SO-keyed `dispatchStatus` writers** (enrichment, Billing actions, Telephonic) can still stamp `hold` on a `challan_linked` bill and surface it on the Hold tab until slice 6's guards land. Slice 6 must ship the import catch and those guards together.
4. **Out-of-repo hand SQL.** FLOOR_TRIPS §14 records hand sweeps that moved thousands of bills' stage with no repo trace. Any such sweep must exclude `challan_linked`.
5. **Rank arithmetic.** A terminal stage has `rank: null`; any code that does `rank >= n` on an unregistered stage reads `undefined`. Register the stage before the first row exists (slice 6) and sweep.
6. **`linkedOrderId` is the FIRST OBD only.** The per-OBD truth is `orders.challanOrderId`; "every SO has its OBD" (M6) reads the link rows' `status`. Do not read `linkedOrderId` as "the" bill.
7. **10-digit SO CHECK.** If SAP ever changes SO length, the paste is refused until an ALTER.
8. **Prisma relation defaults.** An optional relation defaults to `onDelete: SetNull`; the live FKs are RESTRICT. Spell `onDelete` out (§3) or the model lies about the database.
9. **`'ORB-'` prefix is shared** with Orbit customer codes in `delivery_point_master` (`ORB-00001`, v27.57; 5 live). Different table and shape, but a typed search or lookup that accepts `ORB-` must say which it means.
10. **Location.** First written to `docs/sql/`; moved to `sql/` with every other repo SQL file once run.

## 8. Live checks (read-only, 2026-10-06, via the pooler; script `_challan-slice1-live.ts`, untracked)

orders 17,175 rows · constraints: only `orders_obdNumber_key UNIQUE ("obdNumber")` · `workflowStage` text NOT NULL DEFAULT `'order_created'` · `dispatchStatus` text NULL (dispatch 14,660 · null 2,355 · hold 160) · `obdNumber` text NULL · ids integer · 0 `obdNumber` LIKE `'ORB-%'` · no `%challan_order%` table/column/constraint · `order_status_logs` no CHECK, 0 `toStage` like `%challan%` · `user_page_access` 10 columns, `place_order_ship_to` 6 rows / 6 view / 5 edit, 0 rows for the new keys, no page-key table · `live_changes_child_*` present, `chk_live_changes_entity` = order|trip|config|mail_order|so_tag.

Surprises: (a) `orders."obdNumber"` has TWO indexes — the unique `orders_obdNumber_key` and a plain `orders_obdNumber_idx`, the second in neither Prisma nor CORE; (b) **75 SAP SO numbers are free text, among them `CHALLAN - 1790`, `88 - CHALLAN`, `CHN-2026-00088`** — the depot already records challan references in SAP's SO field; (c) `chk_live_changes_entity` already admits `mail_order`/`so_tag`, so **v27.47 IS applied live** while CORE still says "pending"; (d) 5 Orbit customer codes already use `ORB-`.
