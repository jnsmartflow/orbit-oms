# Split load — plan (web decision draft) · 2026-10-24

Status: **DECISIONS ACCEPTED 2026-10-24 (owner: "all ok") — not built.** Decisions 1, 2, 4–9
accepted as recommended. #3 (who gets the tick) is decided at phase 6. #10 and #11 are owner
follow-ups (billing / NTS) and do not block the build.
Mockup: `docs/mockups/split-load/split-load-mockup.html` (v2 — split, trip, dispatch, hold, next day, release, split again).

---

## 1. What Split load is (plain English)

One SAP invoice is too big for one truck. The planner divides the bill's **tins** between trucks.
The bill becomes **parts** ("part 1 of 2", "part 2 of 2"). Each part has its own tins per product,
its own litres and kg, and goes on its own trip. Same invoice number on every part.

NOT Add invoices (several SAP invoices for one OBD — paperwork). Split load is a loading decision.

## 2. The user flow

1. Floor (`/floor`) → tick **one** bill → **··· More → Split load** (placed under Add invoices).
2. Dialog: one row per product. Truck A typed, Truck B = the rest (auto). **+ Add truck** for more
   (rare); the last truck always takes the rest. Live tins · litres · kg per truck. Split evenly button.
3. Save → the bill shows as one row per part on the board. **"part 1 of 2" is a TAG (chip) next to
   the invoice number — NOT a separate column.** No new column on the board. Unsplit bills show no tag.
4. Each part goes on a trip with the normal Add to trip. Each part is held, released, dispatched,
   re-delivered on its own.
5. A waiting part can be **split again** later (any number of times). Labels renumber ("of 2" → "of 3").
6. **Merge back** joins waiting parts into one again.
7. Bill is **done** when every part is dispatched (rule exists today).

### Detail panel (Items tab) for a part
- Header `9110326967 · part 1 of 2`, with a small Part 1 | Part 2 switch.
- All lines of the bill stay. This part's tins in black. Other parts' tins as a grey note under the
  line: `2× part 2 · L-261024-04` — **trip number only**; "waiting" or "on hold" when not on a trip.
- A line with 0 tins in this part is greyed whole, with the note.
- Footer: this part's lines · tins · litres · kg, then the whole bill total.

## 3. Every case, and the rule for it

| # | Case | Rule |
|---|---|---|
| 1 | Bill not on a trip | All parts come out "Not on a trip" |
| 2 | Bill already on a trip | Part 1 stays on that trip; new parts wait |
| 3 | Bill on hold | Split allowed; every new part comes out held; release the one to send |
| 4 | Part dispatched | Locked: no split, hold, move or merge |
| 5 | Split a waiting part again | Only that part's tins are divided; dispatched parts untouched |
| 6 | Two parts on one trip | Refused ("Part 1 is already on this trip") |
| 7 | Held part to a trip | Refused (rule exists today) |
| 8 | Part 2 goes days later | Allowed; part 2 waits on the board with an amber "part 1 gone" chip |
| 9 | Only one product line | Split that line's tins; whole tins only |
| 10 | A line has 1 tin | It goes whole on one truck |
| 11 | Every truck | Must carry at least 1 tin; the bill needs ≥ 2 tins to split |
| 12 | **No SAP invoice number yet** (planning happens before billing) | **Allowed.** Parts are made with no number; when SAP's number arrives every part takes it automatically |
| 13 | Bill already split by Add invoices | Split load splits ONE invoice row (one paper) into parts |
| 14 | Add invoices after a split load | **Locked** — merge back first (avoids two features editing the same rows) |
| 15 | Invoice pairs (one SAP invoice on two OBDs) | Untouched — Split load works inside one OBD only |
| 16 | Merge back | Only waiting, same-hold-state parts. Blocked if a part has a CI, a billing copy or a re-delivery record (those rows cannot be deleted) |
| 17 | SAP re-import changes a line's qty after split | Existing "stale" check fires → banner "Re-check split"; dispatch blocked until fixed |
| 18 | Two people split the same bill at once | Second save refused ("bill changed, reopen") |
| 19 | Picking | Stays **per bill** — the whole bill is picked at once. Part 2's tins sit picked until its truck |
| 20 | Pick shortage / CI | CI on a part is **PARTIAL** (a part is never the full invoice). Auto-CI stays whole-bill |
| 21 | Search an invoice number | Shows and lights **all** parts (today it finds only the first) |
| 22 | Billing Print | Each part copied on its own trip. Parts show "part k of n · needs DC + e-way bill"; original invoice goes with the last part |
| 23 | Freight report / trip sheet / trip detail | One row per truck with that part's own tins · litres · kg · articles |
| 24 | Freight paper trips (whole-OBD only) | A split-load bill cannot go on a freight paper trip (v1) |
| 25 | Tint bill | Split allowed any time; picking gate unchanged |
| 26 | Cancel the whole bill | Existing cancel rules (blocked once anything dispatched) |
| 27 | Kg accuracy | SAP line kg ÷ line tins × tins (exact). No line kg → learned kg per tin (exact). Else "~" share |
| 28 | NTS mirror | If NTS sends one delivery on two trucks the same day, the mirror keeps one. Outside Orbit — ask NTS |
| 29 | E-way bill script | One IRN → one vehicle today. Parts need DC + e-way bill per extra truck — later phase |

## 4. How it is stored (design, for Claude Code to verify)

- Uses the existing `order_invoices` + `order_invoice_lines`. Unique stays `(orderId, seq)` — no change.
- **New `source` value `'load'`** — a load part. Needs `chk_order_invoices_source` altered FIRST.
- **New column `loadParentId`** (int, self-FK → `order_invoices.id`, RESTRICT) — the original row
  whose number this part shares. Re-splitting a part points new parts at the SAME original row
  (one flat group, so "part k of n" is simple). New CHECK: `source = 'load'` ⇔ `loadParentId` set.
- **Invoice number on a load part = a copy of its parent's number**, may be NULL until SAP sends
  it. One writer keeps it in step (extend `sap-row.ts` / the Add invoices save). Copying, not
  joining, keeps the 125 files that read `invoiceNo` working.
- `chk_order_invoices_manual_has_no` stays for `'manual'` only.
- On first split of an unsplit bill, seq 1 gets line rows for its share (Model A: on a split OBD
  every row carries lines). So every existing "split OBD" branch (`seq > 1`) switches on by itself.

## 5. What must NOT change for normal bills

Unsplit bill = one seq-1 `sap` row, no lines, `orders` columns are the truth, byte-for-byte the
same payloads. One `orders.update` per OBD per trip press. Counts per OBD. Picking/tint/cancel per
OBD. Invoice pairs untouched. (Full list: discovery report §7.)

## 6. Phased build — each phase ships alone

Nobody gets the tick until phases 1–5 are live, so no real bill is split before the breaks are fixed.

| Phase | What | Gate before it ships |
|---|---|---|
| 0 | Housekeeping: router row for `CLAUDE_ORDER_INVOICES.md`; push `bf91c1ea` | `git log origin/main..main` clean |
| 1 | **Schema** — `source` CHECK + `'load'`, `loadParentId` + FK + CHECK + index; Prisma; CORE version | Read-only SELECT first (0 rows violate new CHECKs); SQL reviewed before run; schema version minted same commit |
| 2 | **Writers** — `lib/order-invoices/load-split.ts`: split / re-split / merge; number copy; Add invoices locked when load parts exist; API route; new tick `floor_split_load` | Pure plan functions checked on sample bills; **parity**: board payload of unsplit bills identical before/after |
| 3 | **Floor UI** — More menu item, dialog, part labels, detail Items with grey trip no., part switch, Merge back | Mockup approved; `tsc` + build; owner smoke test by hand |
| 4 | **Fix the breaks** — search all parts (Floor, re-delivery, /ci); CI per part = PARTIAL; selection label; activity text with part label; freight report per truck; articles per part; freight-trip block | Re-run the discovery sweep: every BREAKS row closed |
| 5 | **Print + trip sheet** — part label, "needs DC + e-way bill" marker, original-with-last note | Billing person checks one printed set |
| 6 | **Canon + grant** — `CLAUDE_ORDER_INVOICES.md` Split load section, CORE, router; then grant the tick | Query-speed check (EXPLAIN on board feed); SELECT grant blast radius |
| Later | E-way bill script: DC + Part-B per part; NTS same-day question | — |

## 7. Open decisions — one line each

1. Split before the SAP invoice number exists — allow (recommended: yes)?
2. New tick `floor_split_load`, separate from Add invoices (recommended: yes)?
3. Who gets the tick?
4. Lock Add invoices once a bill has load parts (recommended: yes, merge back first)?
5. Merge back only waiting, same-hold parts (recommended: yes)?
6. CI on a part = PARTIAL (recommended: yes)?
7. Block split-load bills from freight paper trips in v1 (recommended: yes)?
8. Print marks parts "needs DC + e-way bill" (recommended: yes)?
9. Picking stays per bill (recommended: yes)?
10. Ask billing / CA how DC + e-way bill per extra truck is done today.
11. Ask NTS whether one delivery on two trucks the same day ever happens.
