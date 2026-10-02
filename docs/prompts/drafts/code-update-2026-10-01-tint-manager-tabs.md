# code-update-2026-10-01 — Tint Manager tabs, round 1 (SHIPPED)

> Draft for the consolidation job. **Not canon.** `CLAUDE_TINT.md` (v2.2, Schema v27.24) still
> describes the 2026-09-06 board; fold this in during the next reconciliation pass.
> Read against `CLAUDE_CORE.md` v121 · Schema v27.50. **No schema change in this round**
> (page keys are rows in `user_page_access`, written by the grant SQL drafts below).
> Every commit listed here was confirmed on `origin/main` on 2026-10-02.

Plan and discovery: `code-discovery-2026-10-01-tint-manager-tabs.md`,
`code-discovery-2026-10-01-tint-manager-build-plan.md`,
`code-discovery-2026-10-01-tint-manager-base-tab.md`, `code-discovery-2026-10-02-bulk-tinter-issue.md`.
Grants: `sql-2026-10-01-tint-manager-tabs-live.sql`, `sql-2026-10-01-tint-shop-delivery-grant.sql`,
`sql-2026-10-02-tint-urgent-grant.sql`, `sql-2026-10-02-tint-ti-bulk-grant.sql`.
Mockups: `docs/mockups/tint-manager/` (`tint-manager-tabs-mockup.html`, `tint-manager-FINAL_2.html`,
`tint-manager-ti-bulk-mockup.html`, `tint-manager-tinting-tab-mockup.html`).

---

## 1. Commits

| Commit | What |
|---|---|
| `048e9874` | tabs 2 — the first seven `tint_*` action ticks; tint-gated hold / hand / slot / ship-to routes over libs extracted from Floor |
| `9c993471` | tabs 3 — Stop & cancel (assignment → splits → cancel), tint-aware restore, TM raise CI; `splits/cancel` no longer un-cancels |
| `ed95227d` | tabs 4 — pick delete: all-74/77 SO groups belong to Tint Manager; Billing's list / marker / popup exclude them |
| `2b099b07` | tabs 5 — tab bar, redesigned rail cards, TI tab; board + challan honour the ship-to override |
| `0c68d3b6` | tabs 6 — bottom bar (Slot · Assign ▾ · More), Slot column on Floor's picker, click-to-select rail + rows, Stop & cancel dialog |
| `fd202884` | tabs 7 — Floor-layout detail panel on a shared detail payload; Hold (Release = unhold) and CI (Restore) tabs; desk cancel reasons for Floor + Tint |
| `066b34c2` | tabs 8 — TM pick-delete blocking popup + decision history (Billing's components via a `base` prop) |
| `a8e76ee7` | tabs 9 — marker covers held / cancelled tint bills, tint CIs, pick-delete decisions, Base — No Tint TI entries; tab badges load on open |
| `745af671` | Shop delivery (own tick `tint_shop_delivery`) — bulk ship-to = each bill's bill-to dealer; Change ship-to moves to the detail panel only |
| `aaa229cf` · `65075320` · `d788a2d1` | Base 4A — Base bill rule + Floor board `extraWhere` + Base feed with trip cut-off; actions widened to Base bills; marker arms 6–8 |
| `f61ae9f4` | Base 4B — the Base tab UI |
| `972349f0` | OBD date line + Invoice column (Floor's cells), Slot → Due, bulk Urgent (own tick `tint_urgent`), tabs renamed/reordered |
| `0a28784a` | `lib/tint/ti-save.ts` + `lib/sampling/pack-code.ts` shared by both TI routes; ACOTONE challan sync; usage log on the last line |
| `e31c0df4` | bulk white-shot TI (own tick `tint_ti_bulk`) |
| `f165e509` | Tint tab redesign — summary, operator board with day lanes, Now & next grouped by operator |

---

## 2. The tabs

**Tint · Base · TI · Hold · CI · Delete** (`components/tint/manager/board-tabs.tsx`; keys
`tinting · base · ti · hold · ci · pick` — the keys did not change when the labels were renamed and
reordered in `972349f0`). The rail ("Needs assignment") stays on the left for every tab.

- **Tint** — the tint room's own board (rail → operators). See §8 for the redesign.
- **Base** — non-tint SMU 74/77 bills, mirrored from Floor (§5).
- **TI** — "Base — No Tint" bills that still owe a Tinter Issue (`/api/tint/manager/base-pending`).
- **Hold** — held tint ∪ Base bills (`/api/tint/manager/hold`). Viewable with `tint_hold` canView.
- **CI** — today's cancelled tint ∪ Base bills + their CIs (`/api/tint/manager/cancelled`, built on
  Floor's `getFloorCancelled`). Viewable with `tint_ci` OR `tint_cancel` canView.
- **Delete** — pick-delete decision history (Billing's component, `base` prop). Viewable with
  `tint_pick_delete` canView. The blocking pick-delete popup is separate and unchanged.

One bottom bar (`board-bottom-bar.tsx`, built on Floor's `FloorActionBar` shell, not a copy). What is
selected decides the single primary: rail → **Assign ▾** (operators + "Base — No Tint"; the
customer-missing interceptor runs first, `CLAUDE_TINT.md §1.5`); table → **Re-assign ▾**; Hold →
**Release**; Base → **🕑 Slot** (the picker IS the primary). The selections never mix. TI has its own
bar (`BoardTiBottomBar`, §7).

---

## 3. One brain, two doors

Tint Manager routes **re-gate** on the tint ticks and then call **the same shared libs** Floor and
Billing call. No business rule is re-implemented on the tint side.

| Behaviour | Shared lib (the ONE owner) | TM door |
|---|---|---|
| hold / release / hand / unhand / change slot / cancel / restore / urgent | `lib/floor/bill-actions.ts` `applyBillAction` (with `source: "tint"`) | `/api/tint/manager/actions`, `/restore` |
| ship-to override + Shop delivery | `setShipToOverride` (optional `note` since `745af671`) | `/api/tint/manager/ship-to`, `/shop-delivery` |
| raise CI | the shared raise-CI lib (`CLAUDE_CI.md`) | `/api/tint/manager/ci` |
| stop the tint room's work before a cancel | `lib/tint/stop-work.ts` `stopTintWork` | Stop & cancel |
| bill detail | `lib/floor/order-detail.ts` (one payload) | `/api/tint/manager/order/[orderId]` |
| dispatch windows / slot picker | Floor's `dispatch-slot-picker` + windows route | `/api/tint/manager/dispatch-windows` |

**Cross-references, not re-descriptions:** hold, release, slot, cancel and restore semantics →
`CLAUDE_FLOOR.md`; ship-to override → `CLAUDE_FLOOR.md §4.9`; CI → `CLAUDE_CI.md`; pick delete →
`CLAUDE_BILLING.md`; picking stages → `CLAUDE_PICKING.md`.

`lib/tint/manager-bill.ts` `tintManagerBillRefusal` decides which bills a TM route will touch (a tint
bill, or a Base bill for the actions in `BASE_ACTIONS`).

---

## 4. The ten tint ticks

**Gate** — `checkTintAction` (`lib/tint/manager-bill.ts`): `tint_manager` **canEdit** AND the action's
key **canEdit**. Set and clear share one key so nobody can create a state they cannot undo.
**Tab views** use the key's **canView**. `ACCESS_SOURCE = user`, so the source is `user_page_access`;
the admin role and the superuser flag pass every gate (`lib/permissions.ts`).

| Key | Actions (`TINT_ACTION_KEY`) |
|---|---|
| `tint_hold` | hold · release (= unhold) · views the Hold tab |
| `tint_hand` | hand · unhand |
| `tint_slot` | change slot |
| `tint_ship_to` | change ship-to (detail panel only since `745af671`) |
| `tint_cancel` | cancel · Stop & cancel · restore · Remove OBD · views the CI tab |
| `tint_ci` | raise CI · views the CI tab |
| `tint_pick_delete` | pick-delete decisions · views the Delete tab |
| `tint_shop_delivery` | Shop delivery (bulk) — own tick, independent of `tint_ship_to` |
| `tint_urgent` | bulk mark urgent — own tick |
| `tint_ti_bulk` | bulk white-shot TI — own tick |

**Who holds them (read-only SELECT, 2026-10-02):** all ten keys are held **canView + canEdit** by
exactly **#21 Chandresh Kolgha** and **#32 Prakash**. `tint_manager` canEdit is held by #1 Harsh,
#21, #25 Deepanshu Thakur, #32 — so Deepanshu sees the screen but runs no tint action. #1 Harsh is the
only superuser and passes every gate by the flag arm.

---

## 5. Actions

- **Hold / Release** — Release is unhold (owner decision 9). A Base bill's hold is refused once a
  picker has it (`pick_assigned` / `pick_done`, `BASE_PICKER_HOLD_REFUSAL`); since `8b448344` the same
  applies to a "Base — No Tint" bill (round 2).
- **Hand** — the dealer collects (Floor's Hand, `CLAUDE_FLOOR.md`).
- **Slot** — Floor's own picker, in the Slot / Due column and as the Base bar's primary.
- **Ship-to** — Change ship-to lives in the detail panel only. **Shop delivery** is a bulk action:
  ship-to = each bill's own bill-to dealer, with a note (`board-shop-delivery-dialog.tsx`).
- **Urgent** — bulk mark urgent (`priorityLevel` 1) from the bar's More menu.
- **CI + Stop & cancel** — a bill still in the tint room cannot be cancelled from Floor; the routes
  refuse with `TINT_ROOM_REFUSAL` = **"In the tint room — use Stop & cancel on Tint Manager"**
  (`lib/floor/off-floor.ts:51`). Stop & cancel stops the assignment, then the splits
  (`stopTintWork`), then cancels.
- **Restore (tint-aware)** — a tint bill cancelled **before** any finished tinting returns to the
  tint room (`pending_tint_assignment`); one cancelled **after** finishing returns to the floor
  (`pending_support`). Same restore as Floor (`applyBillAction("restore")`).
- **Pick-delete owner split** — `lib/billing/pick-delete-rule.ts` `ownerOfSmus`: an SO group whose
  bills are **all** SMU 74/77 belongs to the Tint Manager; anything else stays with Billing. Billing's
  list, marker and popup exclude the tint-owned groups.

---

## 6. Base tab

- **Rule** — `BASE_BILL_WHERE` (`lib/tint/manager-bill.ts:146`): `orderType ≠ "tint"` AND SMU in
  `PROJECT_SMU_NAMES` (74 Decorative Projects, 77 Retail Offtake). Round 2 widened the set to
  "Base — No Tint" bills (`lib/tint/base-bills.ts`).
- **Feed** — `lib/tint/base-feed.ts` `getTintBaseRows`: Floor's own board (`getFloorBoard` with an
  `extraWhere`) ∩ the Base set, plus a **trip cut-off** — a bill on a trip shows only if it joined
  that trip today (`trip_activity` `bills_added`). Parity checked by `scripts/parity-tint-base.ts`.
- **Columns** — Floor's row: Local / Upcountry, trip number as the status when on a trip.
- **Actions** — Slot · Hold · Shop delivery · Raise CI (`BASE_ACTIONS`). No Hand, no Cancel.

---

## 7. Bill-ref cells, Due, bulk TI

- **Bill-ref cells** — `components/floor/bill-ref-cells.tsx` (`ObdDateLine`, `InvoiceLines`,
  `fmtDateTime`), shared with Floor: the OBD with its date line, and an Invoice column.
- **Slot → Due** — the column is named Due.
- **Bulk white-shot TI** (`e31c0df4`) — the TI tab's bar offers **WHT 5 / 20 / 25**. `WHITE_SHOTS`
  (`lib/tint/white-shots.ts`) maps each dose to ONE fixed sampling number: **5 → 26-0315,
  20 → 26-0318, 25 → 26-0319**, TINTER pigment WHT = the dose, every other pigment 0, **unscaled**
  for the pack, recorded as a new pack variant (`lib/sampling/pack-code.ts`). Route
  `/api/tint/manager/ti-bulk`, dialog `board-ti-bulk-dialog.tsx`.
- **`lib/tint/ti-save.ts`** (`0a28784a`) — `saveTinterIssue` + `owedLinesForAssignment`, used by both
  TI routes: usage log on the last line, and the ACOTONE challan formula synced from the TI.

---

## 8. Marker arms 4–8 (`/api/tint/manager/marker`)

Arms 1–3 are the original tint block (`CLAUDE_TINT.md §1.9`). New:

| Arm | Covers |
|---|---|
| 4 | held tint bills in ANY stage (Hold tab) |
| 5 | tint bills cancelled with an `orders` write today (CI tab) |
| 6 | Floor's own live predicate (`floorBoardWhere`) ∩ the Base set — the Base tab (a superset: no trip cut-off) |
| 7 | `floorHoldWhere()` ∩ `BASE_BILL_WHERE` — held Base bills |
| 8 | Base bills cancelled (or edited after the cancel) today |

Plus stamps in the GREATEST statement: tint/Base `ci_returns`, `pick_delete_decisions`, and the
"Base — No Tint" placeholder's `tinter_issue_entries` / `_b` (`createdAt`).

⚠ `live.feed.tint` must mirror these before it is turned on — ROADMAP "Tint feed must learn the new tabs".

---

## 9. Tint tab redesign (`f165e509`)

`components/tint/manager/board-tint-tab.tsx`:
1. **Summary cards** — Tinted today · Still to tint · Pace (litres / hour since the first job start
   today) · Average job. Articles read "2 Drum · 3 Tin".
2. **Operator board** — one lane per operator across the day, running blocks, a "now" line.
3. **Now & next** — the table, grouped by operator (columns unchanged; `BoardColGroup`,
   `BoardHeadRow`, `TintBoardRow` exported from `board-table.tsx`).
4. **Done today** — finished jobs.

The "Base — No Tint" placeholder is excluded from the done set (orders route Set E,
`assignedToId ≠ getBaseOperatorId()`), so a bypass never counts as tinting.

---

*Draft · 2026-10-02 · for the Tint Manager consolidation pass. Round 2 → `code-update-2026-10-02-tint-manager-round2.md`.*
