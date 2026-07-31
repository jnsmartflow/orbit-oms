# Billing v2 — Phase 2 build decisions
# 2026-07-30 · revised 2026-07-31 (§2-§3: the punch gate became a dual-write)
# Lives in: orbit-oms/docs/prompts/drafts/

**Why this file exists.** The Phase 2 design spec
(`design-spec-2026-07-30-billing-picking.md`) is a **planning-project doc and is NOT in this repo** —
it was named twice in build prompts and both times could not be read (the same trap
`code-discovery-2026-07-30-billing-picking-dataflow-FINDINGS.md §0.1` recorded for an earlier doc).
This file records the decisions that were actually built, so a future session does not go looking for
a spec that was never here. **Code wins over both.**

---

## 1. Columns added (Supabase SQL Editor, never `db push`)

Only the SLOT INTENT, on `mo_orders`:

| Column | Type | Notes |
|---|---|---|
| `dispatchTargetDate` | `date` NULL | `@db.Date` in Prisma — a calendar day, not a timestamp |
| `dispatchWindowId` | `integer` NULL | FK → `dispatch_slot_master(id)` ON DELETE SET NULL |

Plus `mo_orders_slot_intent_idx` — a PARTIAL index (`WHERE "dispatchTargetDate" IS NOT NULL`), so it is
**not expressible in Prisma** and is deliberately not modelled as `@@index`.

⚠ **The live FK is named `mo_orders_dispatchwindowid_fkey` — all lowercase.** Postgres folded the
unquoted identifier in `ADD CONSTRAINT`. A verification query searching for the camelCase name returns
**nothing and looks like a missing FK**. It is not missing. (This cost one false alarm on build day.)

Ship-to, hold and urgent needed **no new column** — `shipToOverrideCustomerId`, `dispatchStatus` and
`dispatchPriority` already exist on `mo_orders` and already carry.

## 2. The write target rule

**All four actions write `mo_orders` — and, since 2026-07-31, `orders` as well. See §3.** When the
operator is working the OBD may not exist yet: mail → `mo_orders` → punch → SAP export → `orders`. The
edit is recorded as INTENT on the mail order, and `applyMailOrderEnrichment`
(`app/api/import/obd/route.ts`) carries it at import for bills whose OBD is still to come.

| Action | `mo_orders` field | Carry line |
|---|---|---|
| Ship-to | `shipToOverrideCustomerId` + `shipToOverride` | `:269-274` |
| Hold | `dispatchStatus` (`"Hold"` → lowercased at the boundary) | `:250-252` |
| Urgent | `dispatchPriority` (`"Urgent"` → `priorityLevel 1`, else 3) | `:256-258` |
| Slot | `dispatchTargetDate` + `dispatchWindowId` | **Phase 2 block, before `:313`** |

**A field written to `mo_orders` with no carry line is silently dropped.** That is the rule.

### The slot carry is position-sensitive

It lands in `updateData`, written by the `updateMany` at `:313` — i.e. **before** the dispatch-engine
loop at `:318`. The carry sets `dispatchSlotSource: "manual"`, and the engine's guard at **`:344`**
(`if (ord.dispatchSlotSource === "manual") continue;`) then skips those rows. Moving the block after
the loop, or dropping `dispatchSlotSource`, hands the slot silently back to the rules engine.

Both slot fields are written **together or not at all** — a target date with no window is not a slot,
and the guard keys on `dispatchSlotSource`, not on the date, so a half-set state would not self-heal.

## 3. 🔴 Post-import edits WORK — the actions dual-write

**SUPERSEDED 2026-07-31.** This section previously specified the opposite: a 409 `ALREADY_PUNCHED`
refusal plus disabled controls reading *"Punched — manage on Floor Control."* **That rule is gone** —
no punch gate, no disabled state, no "manage on Floor" text. Design spec §4.5 carries the same change.
Do not reintroduce any of it.

### Why the old rule existed, and why it wasn't good enough

`applyMailOrderEnrichment` is **fire-once-per-import, not a sync** (it runs only inside import handlers:
`:1182`, `:1731`, `:2992`). Once the OBD exists, editing `mo_orders` alone changes nothing downstream
unless that OBD is re-imported, which normally never happens. Refusing was the honest response to that —
but it left the actions usable only in the pre-punch window, and **every bill on the Picking tab is at
`pick_checked`, so its OBD certainly exists.** The actions were unusable exactly where they were wanted.

### The rule now: two writes, sequential, never `$transaction` (CORE §3)

`/api/billing/mail-order/actions` writes **both sides** on every action:

| # | Table | Where | Covers |
|---|---|---|---|
| 1 | `mo_orders` | `id = moOrderId` | the intent; carried at import for a bill with no OBD yet |
| 2 | `orders` | `updateMany WHERE soNumber, isRemoved: false` | an OBD that **already exists**, updated in place |

`orders` is written **second on purpose**: if it fails, the intent is already recorded on the mail order
and a re-import would still carry it. The reverse order would leave `orders` changed with no record of
why. The response returns `ordersUpdated` — **0 before import, 1 normally, >1 for a split bill** — which
is information, not an error.

### 🔴 The `soNumber`-blank guard is LOAD-BEARING

The `orders` write is **skipped entirely** when `soNumber` is null or blank. `where: { soNumber: null }`
matches **every un-punched order in the table** and would rewrite all of them from a single click. This
guard is not defensive tidiness — without it the route is a mass-update bug.

### ⚠ The field mapping DIFFERS between the two tables

Both payloads are built in one block so a divergence is visible in review:

| Action | → `mo_orders` | → `orders` |
|---|---|---|
| Slot (set) | `dispatchTargetDate` + `dispatchWindowId` | same **+ `dispatchSlotSource: "manual"`** |
| Slot (clear) | both `null` | both `null` **+ `dispatchSlotSource: null`** — hands the bill back to the rules engine; leaving it `"manual"` would make the engine skip it forever |
| Hold | `"Hold"` / `"Dispatch"` — **Capitalised** | `"hold"` / `"dispatch"` — **lowercase** |
| Urgent | `dispatchPriority` — the **word** | `priorityLevel` — **1 / 3** |
| Ship-to | `shipToOverride` + `shipToOverrideCustomerId` | identical |

The hold case mapping is the one that bites: Floor's feeds filter on lowercase `dispatchStatus:
"dispatch"`, so writing the wrong case to `orders` **silently drops the bill off the live floor board**.
Same mapping `CLAUDE_CORE.md §13` warns about and enrichment performs at `:250-252`.

### Split bills fan out, intended

One `soNumber` can map to several OBDs. `updateMany` writes **all** of them — confirmed intended
2026-07-31.

### `heldAt` is NOT written — v1 decision, confirmed

Floor's own hold anchors `heldAt` to each order's `obdEmailDate` (`floor/actions/route.ts:120`), which
`updateMany` cannot do per row — enrichment needs a separate loop for exactly this reason. Rather than
turn one write into N for a timestamp, billing holds leave `heldAt` alone. **Consequence:** Floor's
"held since" falls back to `heldSinceSource: "unknown"` (`lib/floor/queries.ts:501`) for
billing-originated holds. **Display only — the hold itself works.** Do NOT add the per-row N-write loop
just for the timestamp; revisit only if the floor team asks.

### Marker note

The `orders` write moves `orders.updatedAt`, so the picking / floor / billing markers see a change and
refetch. That is correct — the bill genuinely changed — and it is ONE write on a NEW path, not a second
write bolted onto an existing one, which is what the marker landmine in `CLAUDE_CORE.md §3` forbids.

## 4. Ship-to search is Billing's own route, not Floor's

Floor's `/api/floor/ship-to-search` gates on the **`floor`** pageKey (`:23`). Measured against
production 2026-07-30:

- `operations` (the pilot account) **has** `floor` canView — Floor's route would have worked.
- `billing_operator` — **Deepanshu (25) and Bankim (26), who actually do this job — have no `floor`
  permission row at all.**

Reusing Floor's route would have gone green in the pilot and **403'd for every real user at rollout** —
the worst failure shape there is. Hence `GET /api/billing/ship-to-search`, same query, gated on
`mail_orders/canView`. Same reasoning produced `GET /api/billing/dispatch-windows` (Floor embeds its
windows in the board response, which a billing screen has no business fetching).

Floor's ship-to **write** route is not reusable at all — it writes `orders`, and Phase 2 writes
`mo_orders`.

## 5. Flag-gating discipline (the top constraint)

Every Phase 2 element renders only under `billingV2`. Three rules held throughout:

1. **No wrapper divs.** New nodes are siblings inside existing containers. Wrapping existing JSX would
   change the DOM even when the new part is empty.
2. **`undefined`, never `null` or `<></>`** for optional slot props — React emits nothing for
   `undefined`: no element, no comment node, no layout shift.
3. **No existing `className`, style object or grid definition was edited.** `ShipToCard` already had
   `relative` in both of its class variants, so the pencil's absolute positioning needed no change.

The dispatch-windows fetch is inside `if (!billingV2) return;` — flag-off issues **no request**.

## 6. What is NOT built

- **CROSS / delivery-type flag** on the Picking list — needs widening the list route through
  `delivery_point_master → area → deliveryType`. Add only if operators ask.
- **`order_status_logs`** for mark-done/undo — deliberate v1 omission; `invoicedAt`/`invoicedById` are
  the who and when, and `updateMany` returns a count, not ids.
- **Table-mode tabs.** The Orders|Picking bar lives at the top of the RIGHT PANE (Floor's structure), so
  it exists only in focus mode, where that pane exists.

---

*Phase 2 · 2026-07-30, §2-§3 revised 2026-07-31 (punch gate → dual-write) · decisions as built.
Verify against the code before trusting any line here.*
