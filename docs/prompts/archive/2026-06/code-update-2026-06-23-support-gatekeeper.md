# Session — Support View: Gatekeeper Build

**Date:** 2026-06-23
**Module:** Support (`/operations/support`)
**Status:** All work pushed to main. Support now functions as a gatekeeper.

---

## One-line summary

Support was turned into a proper gatekeeper: enriched OBDs (with a dispatch status from Mail Orders) now auto-complete into a visible "Done" group, while the operator's pending list shows only the un-enriched orders that actually need manual work. Along the way: header counter fixed, mail-received time surfaced, dispatch-status casing normalized system-wide.

---

## What we built (in order)

### 1. Header dispatched counter — fenced to today
**Problem:** Dispatched header tile counted every `dispatchStatus = "dispatch"` order ever, with no date fence — inflated to 363+, never reset.
**Decision:** Option A — fence the **dispatched** tile only on `obdEmailDate` (today, IST). Pending + tinting tiles stay **unfenced** so they keep matching the carry-over slot list below (carry-over is intentional in Support).
**Why not fence pending too:** A Monday order still pending on Tuesday is real workload and must show + count. Fencing pending would make the tile mismatch the list.
**Built:**
- New shared helper `getISTDayRange(dateStr?)` in `lib/dates.ts` — IST midnight-to-midnight as UTC half-open interval. Mirrors the private helper in `app/api/mail-orders/route.ts` (which fences on `receivedAt`).
- `app/api/support/slots/route.ts` — today-path `dispatchedCount` now adds `obdEmailDate: { gte, lt }` from `getISTDayRange()`. No workflowStage fence (closed-today still counts). Pending/tinting untouched. History path untouched.
**Files:** `lib/dates.ts`, `app/api/support/slots/route.ts`
**Result:** Dispatched tile resets daily, matches reality (showed 2 in test).

### 2. Done group — dispatched orders stay visible (collapsed)
**Problem:** Clicking Done sent the order to `closed`, which is excluded from every Support query → it vanished instantly. No review, no undo, no confirmation.
**Decision:** Keep `closed` as the final stage (no new `support_done` stage now). Instead, make the Support **list** include today's `closed` orders and render them collapsed under a green "N done ▸" bar at the bottom of each slot — mirrors the Mail Orders "N punched" divider (UI ~§388). Approved via mockup Option A (`docs/mockups/support/done-group.html`).
**Strategy context (important for future):** `closed` is the safe "parking" stage. While building/testing one screen at a time, Done writes `closed` so test orders never leak into unbuilt Planning/Warehouse. Pattern: build a screen → flip the previous screen's "done" output forward to feed it → test → flip again. Future flow once Warehouse exists:
`Import → Pending Support → (later: Support Done →) Warehouse/Planning → Close`.
For now: `Import → Pending Support → Close`.
**Diagnosis confirmed:** closed-exclusion filter is **Support-only and inline** (no shared helper). Planning uses allowlist `["dispatch_confirmation"]`, Warehouse uses `="dispatch_confirmation"` — neither can ever surface `closed`. Safe to loosen Support without leaking.
**Built:**
- `app/api/support/orders/route.ts` (today path, section=slot): replaced the flat `notIn` with an `OR` — (a) non-closed pending/tinting stages, no date fence (carry-over preserved) **OR** (b) `closed` fenced to today's `obdEmailDate` range. Added `isDone = workflowStage === "closed"` to each response order.
- `components/support/support-orders-table.tsx`: splits rows into pending vs done; done render below pending under a collapsible green "N done" bar; done rows read-only (DONE badge, no checkbox/dropdown/popover); `T` key toggles all done groups; excluded from Select All + bulk.
- `components/support/support-page-content.tsx`: splits API array into active/done by `isDone`, returns `[...active, ...done]`; counts derive from pending only.
**Result:** Dispatched orders collapse under Done, reviewable, don't vanish.

### 3. Undo-dispatch — return a done order to pending
**Problem:** No way to reverse a mis-click / wrong dispatch.
**Decision:** Full clean reset (Option 1) → back to `pending_support`, dispatch flags cleared. Hard-coded target `pending_support` (not log-read) — simpler, can't fail, harmless even for ex-tint orders since splits aren't touched. Audit log keeps the trail regardless.
**Built:**
- New route `app/api/support/orders/[id]/undo-dispatch/route.ts` — POST. Guard: only if `workflowStage === "closed"` (else 409). Writes: each non-cancelled split `dispatchStatus → null` + log; order `workflowStage → "pending_support"`, `dispatchStatus → null` + log (`fromStage: "closed", toStage: "pending_support"`). Sequential awaits, no transaction, force-dynamic, same requireRole as dispatch.
- `components/support/support-orders-table.tsx`: muted `RotateCcw` button on done rows only (after slot name), `window.confirm`, row spinner + refresh + toast. Not on history rows.
**Result:** Undo (↺) returns order to pending; round-trips cleanly.

### 4. Mail-received time on the table
**Problem:** OBD/DATE column showed SAP/import time (e.g. 10:24), not the actual mail-received time (10:06).
**Diagnosis:** The mail time is **already stored** — enrichment copies `mo_orders.receivedAt → orders.orderDateTime`. The table just read the wrong field (`obdEmailDate`).
**Built (Piece 1 — display only, no schema):**
- `components/support/support-orders-table.tsx`: OBD/DATE column and Age pill now read `orderDateTime ?? obdEmailDate` (fallback to SAP time if no mail match, never blank). Added `orderDateTime` to the `SupportOrder` interface. API already returns it (full row via `include`).
**Deferred (Piece 2 — not built):** Storing/showing the **mail punched time** (`mo_orders.punchedAt`, e.g. 10:21) on the order. Needs a new column + enrichment copy + display spot. Placement of SAP time + punched time (detail panel vs tooltip) deferred.

### 5. mailMatched flag — envelope only on true mail orders
**Problem:** After Piece 1, the "mail time" envelope icon showed on **every** row, because `orderDateTime` is **never null** (it's set to the SAP time at import, only *overwritten* by enrichment on match) — so truthiness couldn't distinguish source.
**Decision:** Add a permanent boolean (Option 2) rather than a per-load batch query — Smart Flow explicitly didn't want repeated server queries for a small thing.
**Schema change:**
- SQL: `ALTER TABLE orders ADD COLUMN IF NOT EXISTS "mailMatched" boolean NOT NULL DEFAULT false;`
- Prisma: added `mailMatched Boolean @default(false)` after `slotToOverride` in orders model. `npx prisma generate`. (No db push.)
**Built:**
- Enrichment (`app/api/import/obd/route.ts`): sets `mailMatched: true` in the updateMany payload on match (line ~237). Shared by all 3 import paths. No-match orders stay false (default).
- Envelope condition in `support-orders-table.tsx`: now gates on `order.mailMatched` (was `order.orderDateTime`). Added `mailMatched?: boolean` to interface. API returns it via spread.
**Backfill:** `UPDATE orders SET "mailMatched" = true WHERE "soNumber" IS NOT NULL AND EXISTS (mo_orders with same soNumber)`. Verified: 3488 = 3488 (mailMatchedTrue = shouldBeMatched).
**Result:** Envelope shows only on genuinely mail-sourced orders; SAP-only rows bare.

### 6. Earliest-first sort within each slot
**Problem:** List sorted by `priorityLevel ASC → obdEmailDate ASC` (backend) but **displayed** `orderDateTime` — so positions looked random (sorted by 10:24 but showing 10:06).
**Decision:** Pure earliest-first (priority dropped — priority belongs to Planning later, not Support). Sort within each slot (page already shows one slot at a time).
**Built:**
- `components/support/support-page-content.tsx`: frontend comparator `(orderDateTime ?? obdEmailDate)` ASC, `obdNumber` ASC tiebreaker, null-times sink to bottom (Infinity). Applied to BOTH active and done slices (each sorted internally; `[...active, ...done]` grouping preserved). Backend ORDER_BY left as-is. **No mutation** of order objects (local consts only).
**Result:** List reads earliest → latest by the visible time. Carry-overs (older date) float to top — correct.

### 7. Mail indicator design — DEFERRED (envelope shipped as-is)
Explored placements (envelope after time, leading envelope, teal edge accent, teal dot, source column, tinted time, dotted underline, cell wash, envelope-as-separator). Key finding: **teal edge accent collides with the existing row-selection bar** (teal left edge = selected row). Recommended **Option A (leading gray envelope)** as the safe fix. Smart Flow chose to **ship current state and polish placement later.** Mockups: `docs/mockups/support/mail-time-symbol.html`, `docs/mockups/support/mail-indicator-placement.html`, `docs/mockups/support/mail-indicator-options-EFGH.html`.

### 8. dispatchStatus casing — normalized system-wide
**Problem (CORE §13 documented):** Mail orders store `"Dispatch"`/`"Hold"` (capital). The orders table + Support board use lowercase `"dispatch"`/`"hold"`. Enrichment copied the capital value as-is → enriched orders slipped past every board filter (e.g. enriched holds invisible to the Hold tab).
**Decision:** Normalize **everywhere** to lowercase. Translate **once** at the crossing point (enrichment), not by rewriting the mail parser / Mail Orders UI (huge blast radius for no gain). Mail side stays capital; the moment a value crosses into `orders`, it's lowercased. Analogy: plug adapter at the border, not rewiring every building.
**Diagnosis:** Only ONE writer used capital — enrichment (`route.ts:240`). Zero readers expect capital. Pure-benefit fix, no regressions.
**Built:**
- Enrichment: `updateData.dispatchStatus = mailOrder.dispatchStatus.toLowerCase()` (was as-is copy).
**Backfill:** `UPDATE orders SET "dispatchStatus" = LOWER("dispatchStatus") WHERE "dispatchStatus" IN ('Dispatch','Hold');` — 3136 rows (2980 Dispatch + 156 Hold). After: distribution clean — `dispatch` 3380, `null` 1864, `hold` 161, zero capital.
**Result:** Hold tab now catches enriched holds; dispatched orders render resolved and flow to Planning/Warehouse correctly.

### 9. Auto-done gatekeeper (the main task)
**Concept:** Support = gatekeeper deciding which OBDs flow to Planning. The 4 decisions are dispatch status, priority, slot override, ship override — but enrichment already fills dispatch status + priority from the mail order at import. So enriched OBDs arrive **already decided** and should auto-complete; the operator only handles the **un-enriched** leftovers.
**Rule (confirmed):** Dispatch status is the gate. If enrichment sets `dispatchStatus`, the OBD is "complete."
**Scope decisions:**
- **Only `"dispatch"` auto-dones** → `closed` (Done group). `"hold"` does NOT auto-done this task — Hold ≠ done; Hold gets its own rework task later (Smart Flow wants enriched holds to auto-route into the Hold tab with no human, but that's a separate build). For now enriched holds keep `dispatchStatus="hold"` and show in the Hold tab as before.
- **Stage written:** `workflowStage = "closed"` (same as manual Done; the parking stage).
- **Critical guard:** only auto-done orders already at `workflowStage = "pending_support"`. This prevents closing un-tinted / mid-tint / upstream orders (enrichment can run before tinting finishes — closing early would skip paint mixing entirely). The guard also inherently excludes cancelled, removed, and already-closed (no double-log on re-enrichment).
- **Log actor:** `changedById: 1` + note `"Auto-dispatched by enrichment"` — established system-action convention (matches `lib/day-boundary.ts`, `lib/slot-cascade.ts`). No schema change, no system-user row.
**Built (mirrors `dispatch/route.ts` exactly):**
- `app/api/import/obd/route.ts`, inside `applyMailOrderEnrichment` after the updateMany, gated on `updateData.dispatchStatus === "dispatch"`: fetch `pending_support` + `isRemoved:false` orders for that soNumber (with non-cancelled splits); per order — set splits `dispatchStatus: "dispatch"` + split log; order `workflowStage: "closed"`, `dispatchStatus: "dispatch"` + order log (`pending_support → closed`). Sequential awaits, no transaction. Shared by all 3 import paths.
**Backfill (existing enriched-pending → done):** SQL mirroring the code — logged splits + orders, then closed orders where `dispatchStatus='dispatch' AND workflowStage='pending_support' AND isRemoved=false`. Verified: remainingPendingDispatch **0**, autoDispatchLogs **43**, untintedClosedShouldBeZero **0**.
**Result:** Enriched-dispatch OBDs auto-land in Done (logged as system); un-enriched OBDs stay in pending as the operator's worklist. Gatekeeper working.

---

## Schema changes this session

| Change | How | Status |
|---|---|---|
| `orders.mailMatched Boolean NOT NULL DEFAULT false` | Supabase SQL Editor + hand-edit schema.prisma + `prisma generate` | Live, backfilled (3488) |

No other schema changes. `closed` reused as parking stage — no new `support_done` enum value added.

## Backfills run this session (all verified, all idempotent)

1. `mailMatched = true` for orders with a matching mo_orders soNumber → 3488 rows.
2. `dispatchStatus` lowercased (`Dispatch`/`Hold` → `dispatch`/`hold`) → 3136 rows.
3. Auto-done sweep: enriched-dispatch pending_support orders → closed + system logs → 43 orders.

## Files changed this session

- `lib/dates.ts` — added `getISTDayRange()`
- `app/api/support/slots/route.ts` — dispatched counter today-fence
- `app/api/support/orders/route.ts` — include today's closed (OR clause) + `isDone`
- `app/api/support/orders/[id]/undo-dispatch/route.ts` — NEW route
- `app/api/import/obd/route.ts` — `mailMatched: true`; `dispatchStatus.toLowerCase()`; auto-done block
- `components/support/support-orders-table.tsx` — Done group, undo button, mail-time read, envelope (mailMatched), interface fields
- `components/support/support-page-content.tsx` — pending/done split, earliest-first sort

Mockups added: `docs/mockups/support/done-group.html`, `mail-time-symbol.html`, `mail-indicator-placement.html`, `mail-indicator-options-EFGH.html`

---

## Key learnings / principles established this session

- **Support carry-over is intentional & passive** — no cron. Pending counters stay unfenced (live workload); only "dispatched/done today" style counters get an IST date fence on `obdEmailDate`.
- **`closed` = parking stage during incremental build.** Each new downstream screen (Planning, Warehouse) gets fed by flipping the prior screen's "done" output forward only once that screen is ready to catch orders. Test orders never leak into unbuilt screens.
- **`orderDateTime` is never null** — set to SAP time at import, only *overwritten* by enrichment. Cannot be used as a "came from mail" signal. Use the dedicated `mailMatched` boolean.
- **dispatchStatus canonical = lowercase** on the orders side everywhere. Mail-orders pipeline keeps capital `Dispatch`/`Hold`; enrichment is the single `.toLowerCase()` translation point.
- **Auto-done guard = `pending_support` stage only.** Non-negotiable: prevents closing un-tinted orders (enrichment can precede tinting completion).
- **System-action log convention:** `changedById: 1` + descriptive note (matches day-boundary, slot-cascade).
- **Priority is NOT a Support concern** — dropped from Support sort; belongs to Planning.

---

## Open / deferred items for next session

### Immediate next candidates
1. **Hold rework (Smart Flow flagged "need to change that too").** Goal: enriched holds auto-route into the Hold tab with zero human touch (mirror auto-done but for hold). Currently enriched holds set `dispatchStatus="hold"` and appear in Hold tab but also still sit in the pending list (Hold is an overlay, doesn't remove from pending). Needs its own diagnose → decide → build, same pattern as auto-done.
2. **Mail indicator placement polish** — ship a clearer indicator than the trailing gray envelope. Leading gray envelope (Option A) recommended; teal options ruled out (collide with row-selection bar). Mockups already drafted.
3. **Mail punched time (Piece 2)** — store `mo_orders.punchedAt` on the order (new column) + decide where SAP time + punched time display (detail panel vs tooltip).

### Known issues still open (from earlier sessions, not addressed)
- `prisma.$transaction` still used in 2 Support PATCH routes (`orders/[id]/route.ts:173`, `splits/[id]/route.ts:100`) — CORE §3 violation, pooler-timeout risk. Low traffic but should be fixed.
- History view excludes `closed` → a completed day's dispatched orders aren't reviewable in history (only carry-over candidates show). May want history to include closed/done.
- `dispatch_change_queue` only written by the inline PATCH path, NOT the Hold button or bulk-hold → most holds aren't logged to the queue.
- Hold tab silently switches off in history mode with no message.
- Next Day Morning slot (isNextDay) counts in header tiles but isn't clickable as a segment.

### Future (Warehouse phase)
- When Warehouse is built: introduce the forward stage (likely `support_done` or `dispatch_confirmation`), flip Done to write it instead of `closed`, and Warehouse reads it. Then ghost-stage counters and delivery-challan stage handling get addressed.
