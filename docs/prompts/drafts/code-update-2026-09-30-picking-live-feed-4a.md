# Code update — 2026-09-30 — live feed picking 4a: queue by id + /api/picking/sync + changes?screen=picking (server only)

**Commit:** the single commit on `main` titled *"live feed picking 4a: queue by id + /api/picking/sync + changes?screen=picking (behind live.feed.picking)"* (`git log --grep "picking 4a"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md` §C, §D.1, §D.2, §G steps 1–3 (owner approved all 11 decisions; decision 7 — push → instant check — promoted into 4b).
**Scope:** server only; no client/UI change; `app_settings 'live.feed.picking'` stays ABSENT (= OFF). No SQL, no schema change. **Prerequisite before Picking goes live (not before this build):** the 2b-i SQL (`pick_findings` trigger) applied.

## What changed
| File | Change |
|---|---|
| `lib/picking/queue.ts` | `getPickingQueue({ onlyIds })` — `{ id: { in: onlyIds } }` AND-ed (as a sibling, never merged into the builder's keys) onto the SAME `buildPickingWhere({ …, gateOn })` + the same `pickerId` narrowing; bundling siblings built for those rows; held-back triple still the whole board's; the by-id path skips `pickDeleted` (the sync reads it itself when relevant). Without `onlyIds`: unchanged. |
| `lib/picking/sync.ts` (new) + `app/api/picking/sync/route.ts` (new) | `POST /api/picking/sync` (below). |
| `lib/picking/picker-feed.ts` (new) | `filterPickerOrderIds(ids, pickerId, held)` — one read on `uq_pick_assignments_order`. |
| `lib/live/cursor.ts` | `LIVE_FEED_PICKING_KEY`; `LIVE_SCREENS` + `picking`; `parseFace`, `parseHeldIds` (`HELD_MAX` = 100), `narrowOrderIds`. |
| `lib/live/feed.ts` | `isPickingFeedOn()` = `live.feed` AND `live.feed.picking` (global read first). |
| `app/api/live/changes/route.ts` | `?screen=picking`; page gate = session AND (`floor` OR `mail_orders` OR `picking` canView); `&face=picker&held=` (picking only) narrows the ORDER ids to the session user's (see below). No screen / billing: unchanged. |
| `lib/live/live.test.ts` (+4, 26 total), `lib/picking/sync.test.ts` (new, 2) | screen / face / held parsing; Floor and Billing unchanged; narrowing; sync body validation. |
| `scripts/parity-picking-rows.ts` (new) | Read-only parity (below). |
| `package.json` | `test:picking-sync` |

## POST /api/picking/sync
- **Gates:** session → `picking` canView (the queue route's gate) → `live.feed` AND `live.feed.picking` (`{enabled:false}`, nothing else read) → body (`orderIds`, `tripIds` ≤ 1000; `shownIds`, `tintShownIds` ≤ 2000).
- **Steps:** trips → their bills (`trip_drops`; "Show to floor" writes only `trips` but moves the gate's waiting set) → ONE classify statement (`orders` ⟕ `pick_assignments.checked_at`, parameterised `$queryRaw`): an id goes to the heavy read only if the client shows it or its stage is a board stage (waiting / assigned / picked, or checked TODAY) → `getPickingQueue({ scope:"openPending", onlyIds })` → patches `[{ id, row | null }]` in the caller's order, siblings, the whole board's held-back triple (same `countHeldBackWaiting`, same `gateOn`, read once inside `getPickingQueue`) → `pickDeleted` (`getPickDeletedToday`) only when a changed bill is one of today's pick-delete decisions → `tintTouched` (a tint bill at a tint-room stage, or in `tintShownIds`).
- **Answer:** `{ enabled, date, patches, waitingSkus, oilSkus, heldBack?, heldBackTrucks?, heldBackUnplanned?, pickDeleted?, tintTouched }` — held-back present only when rows were re-read.
- **Cost (measured wall from the dev PC):** unrelated ids **~210 ms** (1–2 tiny statements) · 5 board ids **~1.3–1.6 s** (the builder's fixed reads — gate, held-back, dealers, users, duplicate-SO, colour work, lines, catalog — for a handful of rows) · full queue ~1.8–2.5 s.

## The picker filter
`GET /api/live/changes?screen=picking&face=picker&held=<≤100 ids>` → after the normal read, the ORDER group keeps only ids assigned to the **session user** now (`pick_assignments` by `order_id`, `picker_id` = session user id — a client picker id is never accepted) or in `held` (his phone's ids, so a bill leaving him still wakes it). Other entities pass through (the client chooses its topics). The cursor still advances over everything. `face` without `screen=picking`, or a bad `held` → 400.

## Parity — run 2026-09-30 ~11:45–12:10 IST, production, read-only
**Snapshot around the refactor:** old `queue.ts` snapshot → new `queue.ts` compare, seconds apart: **SNAPSHOT MATCH** (board + 7 pickers byte-identical). Two earlier attempts differed, and both differences were diffed field by field: every one was a real floor write inside the window (order 17891 assigned to picker 44 at 06:12:38Z by Hitesh Patel; 17878 picked by picker 47 at 06:12:29Z) — none from the refactor; the next quiet-window run matched.
**Parity mode: 18 comparisons, 0 differences** — (1) full queue vs `onlyIds` = every board id: rows in the same order; siblings + held-back triple + date · (2) three chunks of ≤ 20 ids · (3) `syncPicking` over every board id = full rows, siblings, held-back · (4) an off-board (cancelled) id → null patch · (5) three shown trips (5, 1, 3 bills) via `tripIds` → their bills' full-queue rows / null · (6) the picker filter for all 7 pickers over 100 live order ids = an independent SQL answer · (7) five off-board ids → no patches, no held-back read. (First run: 1 difference — patch ORDER only, database order vs input order; fixed to the caller's order. The same run showed old pick_checked bills taking the heavy path; the classify step now checks `checked_at` is today.)

## Checks
`npx tsc --noEmit` clean · `npm run build` exit 0 · unit: load-plan 12, access-notebook 23, live 26, live-client 26, floor-live 13, pick-delete 4, billing-sync 6, billing-live 7, picking-sync 2, load-plan-check + v2 55 — all pass.

## For 4b (phone screens + push-triggered instant check)
1. **Pushes already name their bill** — tags `pick-assigned-<orderId>` (to the picker), `pick-done-<orderId>` (to supervisors), `pick-cancelled-<orderId>` (to the picker). **But `public/sw.js` only shows the notification** — 4b must add `clients.matchAll()` + `postMessage({ tag })` in the SW `push` handler (a service-worker change: it reaches phones only after the new SW activates — plan `skipWaiting` / a version bump, NOTIFICATIONS domain).
2. **For 1–2 s, do NOT route a push through the feed glance**: the changes route's per-instance head cache can answer "no changes" for up to 5 s and the xid horizon can lag a commit. On a push: picker → refetch his own list directly (`?pickerId=me`, ~1.5 s from here); supervisor → `POST /api/picking/sync { orderIds:[id] }` (~1.3 s). The glance then sees the same change and re-reads it harmlessly.
3. Pushes never go to the actor, are best-effort (quiet hours, iOS only as an installed PWA, permission off) — the 15 s / 60 s glance remains the guarantee.
4. Held-back numbers arrive only when rows were re-read; the client keeps the last value otherwise. `pickDeleted` present → replace the list.
5. The heavy path's fixed cost (~1.3 s for a few ids from the dev PC) is mostly the whole-board held-back count and batched lookups — acceptable for now; if phones feel it, skip the held-back read when no waiting bill or trip is among the ids.

## Rollback
`git revert <hash>` — nothing reads the new routes while `live.feed.picking` is absent; the full queue is byte-identical either way (proven above).
