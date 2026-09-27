# web-update-2026-09-27 — Billing "Pick delete" (same-SO decision)

Status: DECISIONS LOCKED, not built. Owner answers to the build plan's open questions recorded 2026-09-27 (build plan §11). Discovery: `docs/prompts/drafts/code-discovery-2026-09-27-billing-duplicate-so.md`.
Mockup: `docs/mockups/billing/pick-delete-review.html` (also published as an artifact, "Billing Pick Delete").

## 1. The problem

When two or more live bills share one SO number, Picking shows them solid red and Floor shows a soft tag
(`getDuplicateSoNumbers()`, `lib/picking/duplicate-so.ts`, computed live, nothing stored). It is a warning
only. Nobody can clear it, and nothing in the data tells a real SAP split from a double punch.

**Ownership decision:** the BILLING operator decides, because only billing knows which bill is genuine.
The duplicate-SO RULE stays Picking's (Picking owns it, Floor imports it). The DECISION becomes Billing's.
Floor and supervisors keep their existing cancel; they do not get "All OK".

## 2. Live data at decision time (SELECT, 2026-09-27)

- 247 same-SO groups all time, 538 bills; 521 already dispatched or closed. 17 bills still open, all older than 7 days. 0 groups in the last 7 days.
- Rough line comparison: ~181 groups look like splits, ~66 like double punches. All OK will be the common answer.
- 255 of the twins are invoiced.
- `idx_orders_sonumber` EXISTS live. `schema.prisma` does not list it — canon drift, record at consolidation.
- Cancelled bills sitting on hold (the enrichment re-hold bug): 0 live.

**Step-2 SELECT, 2026-09-27 (build plan §10):** no table or index named like `pick_delete_decisions`
exists; `orders.id` and `users.id` are `integer`; `ACCESS_SOURCE = user`; under the new rule there are
**10 open groups / 21 bills, 10 of those bills on a trip**. `billing_print`, `billing_telephonic` and
`billing_ci` are held by the same five users: Deepanshu Thakur, Prakash, Bankim, Chandresh Kolgha,
Operations User.

## 3. Decisions (locked)

| | Decision |
|---|---|
| Name | **Pick delete.** Never "Same SO" in the Billing UI. |
| Where | A pill in the Billing tab row after Telephonic: `Orders · Picking · Print · Telephonic · Pick delete N`. Yellow (warn tokens) when 1 or more groups wait, grey at 0. |
| Tab view | Click the pill → the tab shows open groups INLINE, **ONE GROUP AT A TIME** ("Group 1 of N", ‹ Prev / Next ›). After a decision a short **confirmation panel** replaces the group — keep the text minimal: ✓ **All OK** + customer name, or ✕ **Pick deleted** + customer name · Correct pick {OBD}. Buttons: **Undo**, **Next group ›**. The panel **closes by itself after 6 seconds** (a small countdown bar shows it) and opens the next group, or shows "Nothing to decide" after the last one. Next group › skips the wait; Undo cancels it. No Review button, no popup. Each group: customer, SO, bill count, first punch, the double-punch/split hint, **All OK** (brand). Bills side by side: OBD, stage, punched, volume, article, lines count, **Show lines** toggle (identical lines highlighted), **Pick delete this bill** (danger). |
| History | "Decided" list under the groups: SO, OBD, customer, decision (Pick deleted / All OK / Undone), by, when, **Undo**. Month picker. |
| Undo | Two places: the confirmation panel right after deciding, and the Decided list any time. |
| Which groups show | Groups where at least one bill is still before dispatch (not `dispatched`, not `closed`, not `cancelled`, not removed). History is not shown as work. |
| All OK | Saved against the SET of bill ids. The group stays cleared while **every current twin is in an approved set**; a **new bill joining** the SO brings the flag back (a twin that later leaves does not). Red clears on Picking and Floor. Floor/supervisors cannot All OK. |
| Pick delete | Cancels that one bill in Orbit: stage `cancelled`, hold cleared, picker assignment removed, one log line, reason = Picking's existing **`duplicate_bill`**. **No CI raised, no SAP warning, no invoice check.** SAP is cancelled by hand. |
| Refused | Floor cancel's refusals (`off-floor.ts`): already cancelled, dispatched, on a trip, in the tint room — **plus** a bill at the legacy **`closed`** stage, and a bill with a **live CI** (same as Picking cancel, `findLiveCi`). Picked / checked bills CAN be pick deleted. |
| Picker push | Yes, to the picker who held the bill (not to the one who pressed it). Text: **"Bill {OBD} pick deleted. Correct pick {OBD(s)}"** — not "stop picking". |
| Picker + supervisor phones | Deleted bill STAYS visible until end of day (IST), like every other daily list, at the **FOOT of the list** — supervisor **Done** tab, picker **Pending** tab. Its red "Same SO" tag becomes a **Pick delete** tag with one line: **Correct pick: {OBD}** (all surviving OBDs if more than one). Plain text, no button, no jump. |
| Correct bill | No tag at all anywhere (it has no live twin any more). |
| Floor | Deleted bill goes to the **Cancel & CI** tab, as a Floor cancel does today. Correct bill: no tag. |
| Undo of Pick delete | Bill returned to **`pending_picking` with `dispatchStatus = 'dispatch'`** (ready to assign, slot kept) — the import fallback's release shape. Refused while the bill carries a live CI. The old picker assignment is gone, so a supervisor re-assigns. The red returns on both bills. **Exception (owner, 2026-09-27): a bill deleted while waiting for tint (`deletedFromStage = 'pending_tint_assignment'`) returns to the TINT queue — `pending_tint_assignment`, `dispatchStatus` null — where Tint Manager's pending rail picks it up (`app/api/tint/manager/orders/route.ts:127`); tint completion releases it as usual.** *History: `pending_support` was proposed first and rejected — it strands the bill (no Release button for an unheld bill, `detail-panel.tsx:631`). Refusing the tint-bill undo was proposed first and rejected.* |
| Live refresh | Every decision refreshes every open board once (the decisions clock is folded into the Picking/Floor markers). Accepted. |
| Grants | `billing_pick_delete` canView + canEdit to exactly five users: Deepanshu Thakur, Prakash, Bankim, Chandresh Kolgha, Operations User (the holders of `billing_print` / `billing_telephonic` / `billing_ci`, live SELECT 2026-09-27). Written as data in step 9, never from seed. |
| Undo of All OK | Decision marked undone; the red returns; group back in "Needs your decision". |
| Permission | New page key **`billing_pick_delete`**, label "Billing · Pick delete" — same pattern as `billing_print` / `billing_telephonic` (canView = see the pill/tab, canEdit = All OK / Pick delete / Undo). No View tick → no pill. Not in `PAGE_NAV_MAP`. Grant list decided by SELECT at build time — never from seed. |
| Line items | A new billing read route gated on `billing_pick_delete` canView (do not borrow the `billing_picking` gate). |

## 4. Scope notes

- **Enrichment re-hold bug — FIXED IN THIS BUILD** (owner, 2026-09-27; no longer a ROADMAP item), as its own small commit between build steps 5 and 6. `applyMailOrderEnrichment` (`app/api/import/obd/route.ts`) writes every bill on the SO with no stage/removed filter: the `orders.updateMany` at `:368-371`, and the `heldAt` loop at `:490-501` (a `findMany` at `:491` + per-bill `orders.update`, not an `updateMany`). Both gain `isRemoved: false` + `workflowStage` not `cancelled` (line numbers verified at HEAD `d66bfb20`). 0 live hits today; Pick delete makes cancelled twins more common.
- **Not in scope:** stale docs listed in the discovery (BILLING tabs/keys, FLOOR §4.1, PICKING §5.3, NOTIFICATIONS §2, CI §3) and stale comments (`duplicate-so.ts:49`, `floor/queries.ts:847`, `floor/types.ts:95-96`) → next consolidation.

## 5. Known build traps (from discovery)

- `getDuplicateSoNumbers()` is the ONE place an "acknowledged" filter goes; it currently reads counts only, so it must read bill ids to compare against the saved set.
- Billing's existing actions act on EVERY bill on the SO (`actions/route.ts:278-282`). Pick delete needs its own one-bill route.
- Billing staff do not hold the floor tick, so do not call Floor's cancel route; reuse its helpers.
- An All OK changes no order row, so Picking/Floor markers will not see it. Either touch the orders' `updatedAt` or accept the 30 s Floor poll; decide in the build plan.
- Picking queue currently drops cancelled bills; keeping today's pick-deleted bills visible is a Picking change and needs its own predicate — do not widen the queue for all cancelled bills.
- New table needs a schema version entry in CORE in the same commit, citing the live constraint text.
