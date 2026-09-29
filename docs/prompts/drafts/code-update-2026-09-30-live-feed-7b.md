# Code update — 2026-09-30 — live feed 7b: Floor on the change feed (client, behind `live.feed`)

**Commit:** the single commit on `main` titled *"live feed 7b: Floor on the change feed (behind live.feed, default off) — adaptive glance, lazy tabs, row patches"* (`git log --grep "live feed 7b"`).
**Design of record:** `docs/prompts/drafts/code-discovery-2026-09-29-live-change-feed.md` §G + owner decisions of 2026-09-30 (7b brief).
**Server side it uses:** 7a (`96029631`): `POST /api/floor/rows`, `GET /api/floor/trips?ids=`, `GET /api/floor/counts`, the head cache; steps 1–4: `GET /api/live/changes` + triggers.
**No SQL, no schema change, no DB read or write in this step.** Everything is behind `app_settings 'live.feed'` (absent/false = OFF, which is today).

## What shipped
| File | What |
|---|---|
| `lib/live/feed-core.ts` (new, pure) | `LiveFeedController` — cursor, mode (unknown / live / off / fallback), adaptive glance, backoff, accumulation of order/trip/config ids, the full-load triggers, `take()` / `requeue()` / `noteFullLoad()` / `noteDisabled()`. Plus pure helpers: `jitter`, `glanceDelay`, `backoffDelay`, `createThrottle`, `configReloadAt`, `msToNextIstMidnight`, `chunk`. All clocks/timers/fetch injected. |
| `lib/live/feed-core.test.ts` (new) | 23 tests — `npm run test:live-client` |
| `lib/live/use-live-feed.ts` (new, shared) | React wrapper: fetch, timers, `pointerdown/pointermove/keydown/touchstart/wheel`, `visibilitychange`, `focus`, the IST-midnight timer (server clock + 0–120 s jitter), the "was on last time" hint, the debug log. Knows nothing about Floor. |
| `lib/floor/live-merge.ts` (new, pure) | `mergeFloorRows` (place by tab, `tab null` removes, re-sort each list with its feed's rule, soFlags on every board row with that SO, previous trip numbers), `tripIdsToRefresh`, `boardIdsOnTrips`, `mergeTrips` (createdAt desc, id desc), `withBoardRows` (window counts + total), `isDateMismatch` |
| `lib/floor/live-merge.test.ts` (new) | 13 tests — `npm run test:floor-live` |
| `lib/floor/sort.ts` | `compareHoldRows` / `compareCancelledRows` moved here from inline in `queries.ts`, so the feed and the client merge share one rule |
| `lib/floor/queries.ts` | `getFloorHold` / `getFloorCancelled` sort with those two (identical logic). **Proven:** `scripts/parity-floor-rows.ts compare-snapshot` before/after → board, hold, cancelled, trips **byte-identical** (2026-09-30 02:00 IST). |
| `components/floor/floor-page.tsx` | Wired behind the switch — see below |
| `components/floor/detail-panel.tsx` | Optional `changeSignal` prop → quiet re-read → "Changed elsewhere · Reload" bar only if the bill really differs. Undefined (feed off) → nothing runs. |
| `components/floor/trip-desk.tsx` | Optional `delayed` prop → "Delayed · last update HH:MM" chip while connected. Absent → unchanged. |
| `package.json` | `test:live-client`, `test:floor-live` |

## How the OFF path stays what it was
1. **The two old hooks are the same calls with the same arguments**, moved into `<LegacyFloorSync>` (bottom of `floor-page.tsx`), rendered when mode is `off`, `fallback`, or `unknown` on a browser that never saw the feed on. With the switch off that is from the first render onwards, so the 15 s marker (and its connection chip) and the 30 s rail reload run exactly as before.
2. **`load()` is unchanged when not live.** Every new branch is gated on `lazy = feedModeRef.current === "live" && viewMode === "live"`, which is false with the switch off: the same four requests, the same failure rules, the same setters. The fifth Promise.all slot is `null` (no request).
3. **Mount load:** skipped only when the browser's hint says the feed was on last time (`localStorage "orbit.live.floor" = "1"`). The hint is never written unless the feed has answered `enabled: true`, so today every browser loads on mount exactly as before.
4. **Tab labels:** counts are used only while `feedLive && isLive` and the tab's rows are null. Otherwise `filteredX?.length ?? 0` as before.
5. **Chip:** `connected={feedLive ? feed.connected : connected}` — off → the marker's value as before. `delayed` false.
6. **Detail panel / TripDesk:** new props are optional and undefined/false when off.
7. **What OFF does add (honest list):** one `GET /api/live/changes` at open and one every 60 s ± jitter (answers `{enabled:false}` from a 30 s-cached switch read); passive input/visibility/focus listeners that do arithmetic only; the legacy hooks now mount one component level down, so their first probe fires in the same commit as the mount load, just before it instead of just after.

## What Floor does when ON
1. Opens: head cursor first, then Board + trips + counts (On hold / Cancel & CI wait for a click).
2. Glances `GET /api/live/changes` every 15 s while you're active, every 60 s when idle 2 min+, and immediately on first input after idle, tab visible, or window focus (at most one extra glance per 3 s); nothing while the tab is hidden.
3. Changed bills are re-read by id (`POST /api/floor/rows`, ≤ 300 per call), placed on the right tab or removed, re-sorted, soFlags spread; their trips (now and before) re-read by id.
4. Nothing moves under a hand: panel/forms/menus/writes/typing/History queue the changes; ticks keep rows still but trips refresh and ticked bills that left are unticked.
5. Full loads only when needed: reset / backlog / > 300 ids / other day, config change (5 s, ≤ 1 per 2 min), lag > 120 s (≤ 1 per 2 min, "Delayed" chip), IST midnight (+0–120 s), 3 failed patches in a row.
6. Switch off (seen at the next glance, ≤ 15 s active / 60 s idle, plus the server's 30 s switch cache) or 3 feed errors → the old hooks come back without a page reload; switch on again → back to live at the next 60 s re-check (+ ≤ 30 s cache).

## Debug log
Browser console: `localStorage.setItem("orbit.live.debug","1")` → `[live:floor] HH:MM:SS …` lines (mode changes, glances, ids, patches, full-load reasons). `localStorage.removeItem("orbit.live.debug")` → off. Read on every line, no reload.

## Changes from the design (and why)
1. **Loaded lazy tabs are patched, never marked stale.** Once On hold / Cancel & CI have been opened, their rows are patched like the board (same by-id answer, the answer already says `tab`). "Stale" was only needed for tabs that are not loaded — and those show server counts, refreshed when a patch sends a bill to that tab or brings one from somewhere the page cannot see.
2. **The trip pane updates in place when nothing is paused; the reload bar is on the bill panel only.** The trip pane is not an overlay; its stops were already refetched on every trips change under the old path. It is frozen with everything else while the panel/forms/menus are open.
3. **One extra load at open when the hint is off but the feed is on** (first open after switching on, or a new browser): the mount load started before the head cursor, so the feed asks for one more. From then on the hint makes the page wait for the cursor.
4. **Selection:** rows are held still, but trips keep refreshing and ticked bills that left the board are unticked with the old toast — the 2026-09-22 rule (rail must not freeze while bills are ticked) and the old `reconcileSelection` rule, by id instead of a whole-board read.
5. **"Changed elsewhere · Reload"** appears only if a quiet re-read of the bill actually differs from what is on screen. The panel's own writes refetch it first, so their echo in the feed raises nothing.
6. **Pick gate:** a `config` full load also re-reads `/api/floor/pick-gate` (app_settings is a config table, so a flip made elsewhere now reaches the switch; before, only on next page load).
7. **Recovery:** if a full load fails in live mode, a full load is retried at most every 30 s (the old rail poll's pace), driven by the 30 s render tick.

## Tests / checks run
- `npx tsc --noEmit` — clean.
- `npm run build` — exit 0 (`/floor` 62.3 kB). (`.next` had to be renamed aside twice — OneDrive placeholder `readlink EINVAL` / `EBUSY`, not a code error; folders `.next-stale-20260930`, `.next-stale-20260930b`.)
- Unit: `test:load-plan` 12, `test:access-notebook` 23, `test:live` 18, `test:live-client` 23 (new), `test:floor-live` 13 (new), `load-plan-check` + `load-plan-v2` 55 — all pass.
- Parity: sort move — full feeds byte-identical before/after (`compare-snapshot`, read-only).

## Still owed
- Re-run `npx tsx scripts/parity-floor-rows.ts` during a working day after a cancel (7a note: cancelled by-id is proven only on an empty set).
- Config measurement after one working day (7a §Config).
- Step 8: the two-PC hand test (checklist in the 7b reply), then decide the switch.

## Rollback
Switch: `UPDATE app_settings SET "isEnabled"=false,"updatedAt"=now() WHERE "settingKey"='live.feed';` → every open Floor returns to the old hooks at its next glance (≤ ~45 s active, ≤ ~90 s idle, incl. the 30 s switch cache), no reload. Code: `git revert` this commit.
