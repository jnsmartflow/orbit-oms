# CODE UPDATE — Freight Trips shipped (2026-10-01 → 2026-10-03)
# 2026-10-03 · record · merged into canon in the same pass (see the foot)

## What shipped

A report-only "paper trip" layer over HELD bills, for the future freight / MIS report: ops group held bills
into freight trips (`F-YYMMDD-NN`) with their own vehicle, transporter and driver. Freight never writes
`orders`, `trips`, `trip_drops`, `trip_activity` or `order_status_logs`; the floor never sees it. Built on
the way: who held a mail order + enrichment hold logs, and Floor's shared held-bills table with held from /
held by.

## Commits (confirmed with `git log`)

| Commit | Date | What |
|---|---|---|
| `e1da66f0` | 2026-10-02 | hold logs: who held a mail order (Schema v27.50, `mo_orders.heldAt/heldById`); enrichment hold logs |
| `efd397c4` | 2026-10-02 | floor hold: shared `HoldTable` (invoice, type, L, kg, article, held from, held by) |
| `876acb50` | 2026-10-02 | floor hold: Held from off the default columns; automatic holds read "System" |
| `c430208e` | 2026-10-02 | freight trips: tables in Prisma, page key, server routes (Schema v27.51) |
| `e4115e78` | 2026-10-02 | freight trips: screen, nav entry, access section |
| `6e459c1d` | 2026-10-02 | freight trips: full-height rail; all delivery types by default *(not in the prompt's list — found by git)* |
| `ff5ed9d4` | 2026-10-02 | held pool as route cards per delivery type; drill-in by invoice date |
| `0d0de6a4` | 2026-10-02 | held pool as delivery-type cards (Floor All-tab style, no status) |
| `50048416` | 2026-10-02 | cards-only pool; Floor-style club tabs + route sections drill-in |
| `a3c050cb` | 2026-10-03 | no date stepper / type chips; rail = all active trips; trip date in drawer; invoice-date bands |
| `21aca46e` | 2026-10-03 | title in rail; top bar = search (name / OBD / invoice paste); UniversalHeader dropped |
| `fa6e5c8d` | 2026-10-03 | Billing-style search, top right |

## Live proof (owner hand-test, 2026-10-03)

Two freight trips created: `F-261003-01` (1 bill) and `F-261003-02` (23 bills). The held pool fell
182 → 158. Read-only SQL over all 24 bills: every one still `dispatchStatus = 'hold'`; `tripDropId`
unchanged (0 changed); 0 `orders` rows updated after `addedAt`; 0 `order_status_logs` rows after `addedAt`.
Edit, remove and cancel also tested by the owner.

## Not confirmed

- The page-key grants (`sql/2026-10-02-freight-trips-grants.sql`): the prompt's access line was an unfilled
  placeholder; run status unknown.
- `docs/mockups/freight-trips/held-cards.html` was KEPT: it is no longer byte-identical to
  `docs/mockups/floor-trips/floor-all-tab-final.html` (differs from line 107) and two freight code comments
  cite it.

## Merged into canon in this pass

- NEW `docs/CLAUDE_FREIGHT_TRIPS.md` v1.0 · Schema v27.51.
- `CLAUDE.md` v1.14 (router row; THREE trip systems), `docs/CLAUDE_FLOOR.md` v1.9 (§3 hold row, §4.5 nine
  notes + held from / by, new §4.10 shared table), `docs/CLAUDE_UI.md` v5.36 (§6: `/freight-trips` exception),
  `docs/CLAUDE_CORE.md` v123 (§3 / §10 exceptions, §12 entry), `docs/CLAUDE_FLOOR_TRIPS.md` v1.1 and
  `docs/CLAUDE_CI.md` v1.4 (stale "two trip systems" / "one named exception" wording), `docs/ROADMAP.md`
  (new section: parked hold items P1–P6 + Freight Trips items).
