# web-update 2026-07-11 — Picking Assign shipped · Bulk-assign planned

Session summary. What reached main this session, the sort rule as it stands, and the fully-scoped plan for the next session (bulk assign UI). Nothing in the "planned" section is built yet — it's a briefing prompt, not code.

---

## Shipped to main this session

Three commits, all live on orbitoms.in, all browser-verified by Smart Flow.

| Commit | What |
|---|---|
| `560eddd` | Flip Support's done output `closed → pending_picking`. Six write sites (incl. mail-order auto-dispatch at import). No migration — legacy `closed` rows keep their value. |
| `e56d307` | Lock Support out of orders being physically worked (`tint_assigned`, `tinting_in_progress`, `pick_assigned`). Dropped the `orderType==="tint"` narrowing from hold+cancel; closed the bulk-hold gap. |
| *(final SHA — fill in)* | `pick_assigned` stage + Assign/Undo Assign on `/picking`, via the stage ladder that replaces Support's two hand-maintained arrays. |

> **Fill in the third SHA** — the session's final commit hash wasn't captured in chat.

Full technical detail of these three is in the companion doc `code-update-2026-07-10-stage-ladder-and-picking-assign.md` (stage ladder shape, two-write safety rule, the R M Colours bug, cleanup SQL). This doc is the higher-level session record + forward plan.

---

## The sort rule — current state (for reference)

`/picking` orders bills through a modular 7-rule spine. `byAssigned` sits first (assigned rows sink to the tab bottom), then:

1. **Window** — 10:30 → 12:30 → 16:00 → 18:00 (the tab you're on)
2. **Delivery type** — Local → Upcountry → Cross → IGT
3. **Route** — alphabetical (forms the route block)
4. **Area** — alphabetical within route
5. **Priority** — P1 above P3
6. **Key customer** — key dealers float up *within their own area only*

Key insight confirmed this session: **key floats a dealer up inside its area, it does NOT jump the whole route.** A key dealer in Bhagal still waits behind all of Adajan — because a picker walks area by area and shouldn't criss-cross. On a day where every bill is P3 and one route/window, the visible order collapses to: area alphabetical → key-first within area → OBD number. The other rules are silent only because every bill shares their value; they still fire on a mixed day.

Adding a rule requires zero change to `sortPickingQueue()` — proven three times now (`byAssigned` was the third). This is what makes the vehicle/load layer (below) a clean insert, not a rewrite.

---

## Planned — next session: bulk assign UI + picker column

**Not built. A briefing prompt exists to open a fresh chat with.**

Today `/picking` has a per-row "Assign" button that assigns one bill to the logged-in user (self, `notes='test'`). Replace with a Support-style board:

- Checkbox per row + Select All (scoped to current tab, unassigned rows only)
- Bottom action bar mirroring Support: "N selected · assign to [picker ▾] · Assign"
- **One picker per batch** — supervisor ticks bills, picks ONE picker, assigns the lot. Cannot split a selection across pickers. (Confirmed with Smart Flow.)
- **Picker column** on assigned rows so the supervisor sees who holds each bill. Payload already returns `assignedToName`; today it's only inline in the collapsed row — give it its own column.
- assign route changes from single `orderId` to `{ orderIds: number[], pickerId: number }`, `assignedById` = supervisor.
- Partial-failure-safe: each bill is its own sequential two-write pair (row first, stage second, roll back on fail — never `$transaction`). If bill 7 of 20 fails, first 6 stay, batch reports "17 of 20 assigned", queue shows the 3 still unassigned.

Session must start with **discovery** (how picker-role users are identified — reuse `warehouse/pickers` query; how Support's multi-select works — mirror it) and an **approved HTML mock** in `docs/mockups/picking/` before any React, per the CORE UI rule.

The full briefing prompt was drafted in the session chat — copy it into the new chat verbatim.

---

## Planned — later session: vehicle/load sort layer

Smart Flow's throughput idea, parked for its own discovery session. Not designed yet.

Current sort optimises the picker's **walk** (area by area). The bigger goal is truck **throughput**: finish whatever completes a truck first, so that truck rolls and frees a bay. The queue can't sort for this today — it doesn't know how trucks map to areas/routes, truck capacity, or which trucks are assigned/waiting.

This is the "vehicle/load layer" parked at the very start of the picking build — the rule that slides into the modular spine. Next step is **discovery of the vehicle/load data model** (one truck = one area? one truck = several areas? planner-assigned live?), which determines the entire shape of the rule. Do not design the rule before seeing the data.

---

## ROADMAP items surfaced (see companion `roadmap-additions-2026-07-10.md`)

- `/api/trips` API ungated — any authenticated user can pull trip data
- `pick_assignments` shared with a live Warehouse subsystem; unique `orderId` collision risk when Planning/Warehouse and Picking touch the same orders
- Operations dashboard picking tile counts assignments with no filter
- Repo inside OneDrive keeps locking `.next` — move out or exclude
- Follow-on stages: `pick_done` (rank 80), `pick_approved`, `on_hold` as a stage, Tint onto the ladder

---

## Open housekeeping

- **Fill the third commit SHA into this doc and the companion doc** (both have a placeholder).
- `docs/CLAUDE_CORE.md` and `tsconfig.json` show as modified-but-unstaged across the whole session — pre-existing, not authored here. Decide: real edit to commit, or stray change to discard. A context file drifting uncommitted is how version numbers go stale.
- Run the scoped test-row cleanup SQL (`notes='test'`) when done testing — in the companion doc.
