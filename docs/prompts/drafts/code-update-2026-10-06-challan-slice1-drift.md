# code-update-2026-10-06 — Challan Orders slice 1: drift found, NOT fixed

**Status:** RECORD ONLY. Found during Challan Orders slice 1a (live read-only SELECTs 2026-10-06) and the
mockup work before it. Canon is deliberately left as it is — each item is for the next consolidation pass.
Slice of record: `docs/prompts/drafts/code-plan-2026-10-06-challan-slice1.md`, Schema v27.60.

| # | Where canon says | What is true | Evidence | Fix at consolidation |
|---|---|---|---|---|
| 1 | CORE §7 chain v27.47 and its change log: "APPLIED TO LIVE: pending"; §13 live-feed list "v27.47 still pending" | **v27.47 is live.** `chk_live_changes_entity` admits `mail_order` and `so_tag` | Live `pg_get_constraintdef`, 2026-10-06: `CHECK ((entity = ANY (ARRAY['order'::text, 'trip'::text, 'config'::text, 'mail_order'::text, 'so_tag'::text])))` | Mark v27.47 applied; date the apply if Smart Flow can say when; recount the trigger total (84 on 28 tables + the 3 of v27.60). |
| 2 | Neither `schema.prisma` nor CORE §7.12 (which lists the secondary indexes on `orders`) | **`orders_obdNumber_idx` exists live** — a plain btree on `("obdNumber")`, beside the unique `orders_obdNumber_key`, so the column carries two indexes | Live `pg_indexes`, 2026-10-06: `CREATE INDEX "orders_obdNumber_idx" ON public.orders USING btree ("obdNumber")` | Record it in §7.12 and as `@@index([obdNumber], map: "orders_obdNumber_idx")` (or decide it is redundant with the unique and drop it — owner, Smart Flow SQL). |
| 3 | — (no canon) | **75 `orders.soNumber` values are free text**, not SAP SOs: `CHALLAN - 1790`, `88 - CHALLAN`, `CHALLAN - 104`, `CHN-2026-00088`, `Challan`, `J2/GST-0057` (≈30 such), `POTLI` (22), `SAMPLE` (5), `1787 - MANUAL`, a timestamp string. 17,086 of 17,161 are 10 digits | Live `orders` read, 2026-10-06 | **Owner question, parked:** the depot already marks manual challans in SAP's SO field. Does that process continue alongside Challan Orders, and should those bills ever be linked? Record the answer in the Challan Orders design. |
| 4 | `CLAUDE_FLOOR.md §4.1`: Floor cancel is "not stage-gated" | Code refuses a bill **on a trip**, **dispatched**, or **in the tint room** (`offFloorRefusal`, `lib/floor/off-floor.ts`) | Discovery 2 Q6 (`69f2ccec`); also design §9 | Reword §4.1 from the code. |
| 5 | CORE §3: fixed-table standard → "`CLAUDE_UI.md §40`" | The fixed-table standard is **`CLAUDE_UI.md §27`** (§40 is the OT prompt screens) | `docs/CLAUDE_UI.md` headings | Repoint the reference. |
| 6 | `CLAUDE_UI.md §27` ("Challan line items: 5/13/35/15/8/12/12%") and `§32` (same) | `components/tint/challan-document.tsx` colgroup is **5/13/30/22/8/10/12** (Shade 22%, Volume 10%) | The component's `<colgroup>`, read 2026-10-06 (mockup `docs/mockups/challan-orders/challan-paper.html` follows the code) | Update both UI sections to the live widths — code wins. |

Also noted, not drift but worth carrying: `'ORB-'` is now the prefix of TWO number spaces — Orbit customer codes
in `delivery_point_master` (`ORB-00001`, v27.57; 5 live) and challan order numbers in `orders.obdNumber`
(`ORB-YYYY-NNNNN`, v27.60, enforced by `chk_orders_orb_number`). Any typed search that accepts `ORB-` must say
which one it means.
