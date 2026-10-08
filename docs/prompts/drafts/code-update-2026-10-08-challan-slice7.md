# code-update-2026-10-08 — Challan Orders slice 7: live line match + clear pointer on ORB cancel after link

**Status:** BUILT. `tsc --noEmit` clean · `npm run build` clean — **414** route-table entries (unchanged: no new
route), 84/84 static pages · `lib/challan-orders/line-match.test.ts` 7/7. No DDL, no grants, no SQL.
**Nothing was imported, pasted or cancelled on live.**
Spec: `code-plan-2026-10-08-challan-slice7.md` (18d78a86), built as written. Owner 8 Oct: order 19110 left as is (no
UPDATE); alternate material codes for the same goods show ⚠ — accepted for now.

## 1. What shipped

| Piece | Where |
|---|---|
| **The match** — pure `computeLineMatch` + `attachLineMatches` (ONE `import_raw_line_items` read per call) | `lib/challan-orders/line-match.ts` (new) |
| Wire shape `ChallanLineMatch` / `ChallanMatchLine`, `ChallanRow.match` (null = no chip) | `lib/challan-orders/board-types.ts` |
| Board: Billed rows get the match (one read per load) · History: the page's billed rows (one read per page) | `lib/challan-orders/board.ts` |
| Billed tab: **Match** column `✅ Match` / `⚠ N lines differ` (mockup ok / warn tokens), Tins `n / m` when they differ, ▸ column, click the row → side-by-side lines (Material code · Product · Challan tins · SAP tins · Diff, diff rows tinted, totals footer). The OBD(s) cell (admin "Cancel OBD") does not toggle the row | `components/challan-orders/challan-orders-screen.tsx` |
| History: a billed row's chip is **`Billed ✅` / `Billed ⚠`** (+ `n / m tins` on ⚠) and opens the same lines; the SO cell (✕ unlink) does not toggle | same |
| **Pointer fix (S6-4)** — ORB cancelled after linking: the returned OBD's `challanOrderId` is cleared in the SAME compare-and-swap write that sends it to Floor (`pending_support`, status null) | `lib/challan-orders/cancel-guard.ts` `releaseChallanOnCancel` (the one owner — every ORB cancel path already calls it) |
| S6-3 unchanged — a linked OBD cancelled by admin KEEPS its pointer (it was billed against the challan; shown struck through) | `lib/challan-orders/linked-cancel.ts` (comment only) |

**The rule (plan §1):** challan side = the ORB order's own raw lines; SAP side = the raw lines of every bill with
`challanOrderId` = the ORB AND `workflowStage = 'challan_linked'`; both `lineStatus = 'active'`; tins = `unitQty`,
**summed per material code, never de-duplicated**; ✅ iff every material's tins are equal; a 0 / 0 material is dropped.
No catalog join (CORE §13 id-space landmine — matched on the code text). Waiting / part-billed / cancelled rows: no chip.
All three mounts (Billing, Floor, Place Order) show it — same component, no mount logic.

**No behaviour change for a non-challan bill:** the match reads only ORB numbers and `challan_linked` bills, on the
Challan screen's own routes. The pointer write runs only inside `releaseChallanOnCancel`, which runs only when the
cancelled bill `isChallanOrder`, and only on bills that are `challan_linked` to it.

**Read-only smoke on live:** board 0 / 0 / 0, no match computed; History (1–8 Oct) 4 cancelled ORB rows, all `match null`;
the one real pair forced through `attachLineMatches` as a synthetic billed row (ORB-2026-00004 vs 7567796328) →
`⚠ 2 lines differ`, 4 / 4 tins, `IN28080071 −4`, `IN28140071 +4` — exactly the plan's dry run.

**Differs from the plan:** none. (The plan's "S6-4 SELECT returns no new row" check is in the test below.)

## 2. Files

New: `lib/challan-orders/line-match.ts`, `lib/challan-orders/line-match.test.ts`,
`docs/test-data/challan-slice7/T11-match-same-tins.xlsx`, `docs/test-data/challan-slice7/T12-one-tin-less.xlsx`, this file.
Edited: `lib/challan-orders/board-types.ts`, `lib/challan-orders/board.ts`, `lib/challan-orders/cancel-guard.ts`,
`lib/challan-orders/linked-cancel.ts` (comment), `components/challan-orders/challan-orders-screen.tsx`.

## 3. OWNER TEST (admin, local — run inside the end-to-end test)

**Files (new, `docs/test-data/challan-slice7/`)** — Template 2 (Combined), same layout as slice 6. Dealer **Mohan Colour
Co `102425`**, SO **`9999000011`**, line `IN28140071` (DN SATIN STAY BRIGHT WHITE 4L):
- `T11-match-same-tins.xlsx` — OBD **`9999999011`**, **2** tins.
- `T12-one-tin-less.xlsx` — OBD **`9999999012`**, **1** tin.
Open each file and set `OBD Email Date` to the day you test. **Import = `/admin/import` → Template 2 — Combined File.**

Pre-check (read-only, expect 0 / 0):
`SELECT (SELECT count(*) FROM orders WHERE "obdNumber" IN ('9999999011','9999999012') OR "soNumber"='9999000011')::text, (SELECT count(*) FROM challan_order_so_links WHERE "soNumber"='9999000011')::text;`

| # | Do | Must show |
|---|---|---|
| 1 | Place Order → challan mode → Mohan Colour Co → **DN SATIN STAY BRIGHT WHITE 4L × 2** → Create challan order (ORB **A**). Billing → Challan orders → A → Paste SO `9999000011` → Link | A in Waiting |
| 2 | Import **T11** | A in **Billed**, Match **✅ Match**, Tins `2`. Click the row → one line `IN28140071` 2 · 2 · `0` |
| 3 | Billed → A → OBD `9999999011` → **Cancel OBD** (reason Other, "TEST") | A back in **Waiting**, no chip (S6-3: link back to waiting) |
| 4 | Import **T12** (re-issued OBD, same SO) | A in **Billed**, **⚠ 1 line differs**, Tins `2 / 1`. Click → `IN28140071` 2 · 1 · **−1**, footer 2 · 1 · −1. History (today) → A's chip **Billed ⚠**, `2 / 1 tins`. Same on Floor's Challan orders tab |
| 5 | **Pointer fix:** cancel ORB **A** as admin (Floor ⋯ Cancel) | `9999999012` returns to Floor's undecided list. The SELECT below shows it `pending_support` with `challanOrderId` **(null)** |
| 6 | Clean up: Floor → cancel `9999999012` | all `99999990 11/12` cancelled, link `unlinked` |

Verify (read-only):
```sql
SELECT o."obdNumber", o."workflowStage", coalesce(o."dispatchStatus",'(null)') AS status,
       coalesce(o."challanOrderId"::text,'(null)') AS "challanOrderId"
  FROM orders o WHERE o."obdNumber" IN ('9999999011','9999999012')
UNION ALL
SELECT 'link ' || l.id, l.status, l."soNumber", coalesce(l."linkedOrderId"::text,'(null)')
  FROM challan_order_so_links l WHERE l."soNumber" = '9999000011';
```
*Expect at the end:* `9999999011` cancelled with `challanOrderId` = A's id (S6-3 keeps it) · `9999999012` cancelled with
`challanOrderId` **(null)** (S6-4 cleared it before the Floor cancel) · link `unlinked`.

## 4. ROADMAP note (to add to `docs/ROADMAP.md` → Challan orders)

- **Challan line match — material equivalence (old/new SAP codes for the same goods).** Today the match keys on the exact
  SAP material code, so a bill raised on an alternate / renumbered code for the same goods shows ⚠ (accepted by the
  owner, 8 Oct 2026). Needs a code-equivalence source before the match can treat them as one.
