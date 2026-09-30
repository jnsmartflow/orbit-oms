# Code update — 2026-09-30 — live feed picking 4b: supervisor + picker on the change feed, instant update on push (client)

**Commit:** the single commit on `main` titled *"live feed picking 4b: supervisor + picker on the change feed, instant update on push (behind live.feed.picking, default off)"* (`git log --grep "picking 4b"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-picking-live-feed.md` §G steps 4, 5, 6 + canon (7); all 11 decisions approved, decision 7 (push → instant) promoted. Server: 4a `dd20a0a0`.
**Switch:** `app_settings 'live.feed'` AND `'live.feed.picking'` (absent = OFF). Stays absent. **Prerequisite before switching on:** the 2b-i SQL applied (`pick_findings` trigger).
**No DB, no server predicate change, no Floor / Billing / Tint edits.**

## What shipped
| File | Change |
|---|---|
| `components/picking/picking-mobile-shell.tsx` | **Supervisor shell:** one `useLiveFeed` (`screen=picking`, topics `order,trip,config`); per glance with changes ONE `POST /api/picking/sync { orderIds, tripIds, shownIds, tintShownIds }` → `applyPickingSync`; `tintTouched` → tint refetch; full work (reset / backlog / config / > 1000 ids) → full queue + tint refetch; held while `detailOpen \|\| overlayBusy`, applied once on release; own writes: `refetchQueue({ ids })` → one sync, applied at once; push (`pick-done-<id>` etc.) → `syncIds([id])` (queued if held); open bill changed elsewhere → quiet sync of that id, strip only if its row differs; IST midnight → full reload. **Picker shell:** one `useLiveFeed` (`screen=picking`, topics `order,config`, params `face=picker&held=<his ids ≤ 100>`); any work → his list refetched; push (assigned / cancelled) → his list at once (queued while a bill is open or a Mark done is in flight); changed-elsewhere check on his open bill; midnight reload. Both: `live` also true while "unknown" on a phone that saw the feed on (the hint), so the legacy polls do not start and stop. Context gains `live`, `reportDetailId`, `detailChanged`, `reloadDetail`, `detailReloadNonce` (+ picker `setPickerBusy`); supervisor `refetchQueue(opts?: { ids })`. |
| `components/picking/picking-live.tsx` (new) | `LegacySupervisorMarkers` (the two old `usePickingMarker` calls, UNCHANGED, + resync registration), `LegacyPickerMarker` (the picker's narrowed marker, UNCHANGED), `useOrbitPushMessages`, `DetailChangedStrip`, hint key `orbit.live.picking`. |
| `components/picking/picking-board-mobile.tsx` | Five write handlers pass their acted-on ids to `refetchQueue`; reports the open bill; Reload nonce → lines re-read; **live-only** tick pruning (`pruneSelection`); the strip. |
| `components/picking/picker-my-picks-board.tsx` | Its marker call → `<LegacyPickerMarker>` rendered when not live; reports `marking \|\| markingAll`, the open bill; Reload nonce; the strip. |
| `lib/picking/live-merge.ts` + `.test.ts` (7) | `applyPickingSync` (replace / insert / remove, `sortPickingQueue` — the queue's own spine, siblings in row order, held-back and pick-deleted only when returned, date mismatch), `pruneSelection`, `patchRowFor`, `sameRow`. |
| `public/sw.js` | After showing a picking notification: `postMessage({ type: "orbit-push", tag, kind, orderId })` to every open window. `SW_VERSION 2026-09-30.2` line (byte change → browsers install it). No fetch handler, no Cache API (a test enforces both). |
| `lib/push/sw-message.ts` + `.test.ts` (3) | Page-side parser; the tag pattern, tested byte-equal to `sw.js`'s. |
| `lib/live/use-live-feed.ts` | Optional `params()` read at each glance (the picker's `face` + `held`). Floor / Billing pass none → identical requests. |
| `docs/CLAUDE_PICKING.md` v1.19 | §10.0 (two paths, one switch — feed path, push trigger, pause, fallback); §10.1 = the old marker path, unchanged; §5.6 live-sync line. |
| `docs/CLAUDE_NOTIFICATIONS.md` v1.5 | §5 the SW message; landmine 10 (tag pattern lives twice); key files. |
| `package.json` | `test:picking-live` |

## How the OFF path — and the SW change — stay harmless
1. **Legacy polls unchanged:** the supervisor's two `usePickingMarker` calls and the picker's narrowed marker are the same calls with the same arguments, moved into components rendered whenever the feed is not live (switch off, fallback after errors, or unknown on a phone that never saw it on). Their `resync` registration moved with them.
2. **Every new branch is gated on `live`** (false off the feed): no sync, no prune, no strip, no push handling. `refetchQueue({ ids })` ignores `ids` off the feed → the same full refetch + resync as before.
3. **The SW change** only ADDS a `postMessage` after `showNotification`; the notification, its tag / body / click behaviour are unchanged. A page not listening (every page while `live.feed.picking` is OFF) ignores the message. No fetch handler, no caches (NOTIFICATIONS landmine 1) — `lib/push/sw-message.test.ts` fails if either appears. `skipWaiting` + `clients.claim` were already there: the new worker takes over on the next page load after it is fetched.
4. **What OFF does add:** one `GET /api/live/changes?screen=picking` at open and every 60 s ± jitter per phone (answers `{enabled:false}` from the 30 s-cached switch; nothing while the screen is off), plus passive listeners.

## Changes from the plan
1. **Own writes apply at once** (not held by the pause): the detail / sheet they came from is closing in the same tick, and the legacy full refetch never waited either.
2. **The strip is a fixed bar at the top of the screen**, not placed inside the detail overlay's layout (the overlay is a large always-mounted block; a fixed strip needs no edit there).
3. **Tick pruning is live-only** — the phone board never pruned ticks (the rule was the archived desktop board's); OFF stays as today.
4. **Held-back recount skip (optional cost cut) not implemented** — it would change 4a's proven sync; revisit if phones feel the ~1.3 s.
5. **Push kinds:** the supervisor handles any picking push it receives (it receives `pick-done`); the picker ignores `pick-done` (never sent to the actor).
6. NOTIFICATIONS records that quiet hours were REMOVED on 2026-08-12 — my 4a note listing "quiet hours" among push gaps was wrong; the gaps are the device toggle, permission, and iOS installed-app only.

## Checks
`npx tsc --noEmit` clean · `npm run build` exit 0 (`/picking` 36.7 kB) · unit: load-plan 12, access-notebook 23, live 26, live-client 26, floor-live 13, pick-delete 4, billing-sync 6, billing-live 7, picking-sync 2, picking-live 10 (new), load-plan-check + v2 55 — all pass.

## Rollback
Switch: `UPDATE app_settings SET "isEnabled"=false,"updatedAt"=now() WHERE "settingKey"='live.feed.picking';` → phones return to the marker path at their next glance (≤ ~45 s active / ~90 s idle), no reload. Code: `git revert <hash>` (the SW message goes with it; the worker updates on the next page load).
