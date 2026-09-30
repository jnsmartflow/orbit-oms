# Code update — 2026-09-30 — Tint live feed, Step 2: the `delivery_challans` trigger (Schema v27.48, PENDING)

**Commit:** the single commit on `main` titled *"live feed tint step 2: delivery_challans trigger SQL (v27.48, pending)"* (`git log --grep "delivery_challans trigger SQL"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md` §B ("Missing triggers"), §G Step 2, decision 5.
**No SQL was run by Claude Code.** Smart Flow runs the files below in the Supabase SQL Editor.

## What
Three statement-level AFTER triggers on `delivery_challans` (INSERT / UPDATE / DELETE), reusing step 4's generic `live_changes_child_{ins,upd,del}()` with arguments `('order', 'parent', 'orderId')`:
- Every challan write records **entity `order`, entityId = the challan's `"orderId"`, op `U`** (the order changed).
- There is no new function and no CHECK change. The `chk_live_changes_entity` constraint already allows `order`.

## Why
This is the plan's challan row:
- The Tint Manager board shows each bill's **challan number and the void pre-warning** (`challan: { challanNumber, isVoided }` in `app/api/tint/manager/orders`).
- A challan edit or void through `app/api/tint/manager/challans/[orderId]` (PATCH) writes `delivery_challans` + `delivery_challan_formulas` and **no** `orders` / `tint_assignments` / `order_splits` row. The feed therefore never saw it.
- There are about 48 challan writes a day.
- The polling marker has seen these since `bc6362d4` (it reads MAX(`delivery_challans."updatedAt"`)). This trigger gives the future feed path the same coverage.

`tinter_issue_entries(_b)` are deliberately not triggered (decision 5).

## Independent of the Billing SQL
`sql/2026-09-30-live-changes-billing.sql` (v27.47, still pending) and this file **can run in either order**, or this one alone:
- this file writes only entity `order`, which is allowed before and after v27.47 widens the CHECK;
- it uses only step 4's functions, which are live and which v27.47 does not change;
- the two files touch different tables.

## Run order (Smart Flow, Supabase SQL Editor)
1. **PRE-CHECK**: the commented block near the top of `sql/2026-09-30-live-changes-tint.sql`. Un-comment it, run it on its own, then re-comment it.
2. **MAIN**: the whole of `sql/2026-09-30-live-changes-tint.sql`, run once. It is re-runnable.
3. **TEST**: `sql/2026-09-30-live-changes-tint-TEST.sql`, run as one statement.

## Expected results
**PRE-CHECK:**
- `table` → `delivery_challans`.
- `order FK column` → `orderId · integer · NO`.
- `required column` → `orderId`, `challanNumber` and `updatedAt` only (the TEST's insert supplies exactly these; anything else → stop).
- **No** `check constraint` rows.
- `rows` → ≈ 2,500.
- **No** `existing trigger` rows (anything → stop).
- 3 `generic function` rows.
- `entity check` → the 3-entity text (Billing not run) or the 5-entity text (Billing run); both are fine.
- `live_changes triggers now` → **72** before the Billing SQL, **81** after it.

**MAIN** (the last result is the verification):
- `triggers · delivery_challans · del=O ins=O upd=O`.
- `all live_changes triggers · count` → **75** if the Billing SQL has not been run, **84** if it has.
- `entity check` → unchanged.

**TEST:**
- The success signal is an **ERROR**: `TEST OK — rolled back (6 checks, 0 failed)`.
- The NOTICE lines above it, in order:
  1. no-op → 0 lines;
  2. updatedAt-only → 0 lines, and the stamp moved;
  3. a real change → an `order` line for that challan's order;
  4. a void → a line;
  5. insert of a throw-away `LCTEST-<txid>` challan on the newest order that has none → a line;
  6. delete of that throw-away challan → a line.
- Nothing persists. The row is rolled back, only sequence gaps remain, and no real challan is inserted or deleted.
- `… 0 failed, N skipped` would mean there were no challans, or no order without one. Report that.
- `TEST FAILED …`, or any other error → stop and report.

## Rollback
Kill switch (instant; challan saves carry on untouched):
```sql
ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_ins;
ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_upd;
ALTER TABLE delivery_challans DISABLE TRIGGER trg_live_changes_delivery_challans_del;
```
Full rollback (removes exactly what v27.48 adds):
```sql
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_ins ON delivery_challans;
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_upd ON delivery_challans;
DROP TRIGGER IF EXISTS trg_live_changes_delivery_challans_del ON delivery_challans;
```

## Canon
`CLAUDE_CORE.md` v118 · Schema v27.48:
- the §7 chain has a v27.48 entry marked **PENDING — not yet applied**;
- the §13 LIVE FEED landmine lists `delivery_challans` (84 triggers on 28 tables once v27.47 and v27.48 are both applied);
- the header and footer match.

When Smart Flow reports the TEST result, mark v27.48 "APPLIED TO LIVE <date/time> …" in the chain.

## Plan vs code
- **No disagreement on the trigger itself.** `delivery_challans."orderId"` is `Int @unique`, NOT NULL, in `schema.prisma`. So the plan's "rows with a NULL order id skipped" can never apply; the step-4 helper would skip a NULL anyway.
- `delivery_challan_formulas` references `delivery_challans`. That is why the TEST never deletes a real challan and only deletes the throw-away row it inserted.
- The plan's challan-save route is PATCH `app/api/tint/manager/challans/[orderId]`. It still uses `prisma.$transaction` (a pre-existing CORE §3 landmine, not touched here). Triggers fire inside that transaction and commit with it.
