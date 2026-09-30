# Code update — 2026-09-30 — Tint live feed, Step 4: the Tint Manager on the change feed (client)

**Commit:** the single commit on `main` titled *"live feed tint 4: Tint Manager on the change feed (behind live.feed.tint, default off)"* (`git log --grep "live feed tint 4"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md` §D, §E, Step 4. The owner answered "agree all".
**Server:** step 3, `acf0ba0b` (`?screen=tint&held=&missing=`, `missingTouched`).
**Switch:** `app_settings 'live.feed'` AND `'live.feed.tint'` (an absent row = OFF). It stays absent.
**Manager only.** The Operator screen is untouched. No DB, no server change.

## What shipped
| File | Change |
|---|---|
| `components/tint/manager/use-tint-manager-live.ts` (new) | `useTintManagerLive`: one `useLiveFeed({ scope: "tint-manager", screen: "tint", topics: "order,config", params })`. `params` is read at each glance: `held` = every order id on the board (rail + table + splits + completed, capped at HELD_MAX 100) and `missing` = the side-list ids (cap 100). On a hit it does **one** `fetchBoard()` (decision 2, a full reload). A config / reset / start → the board plus the side list. `missingTouched` → the side list only. Everything is **held** while `hold` and applied **once** on release. IST midnight → board + side list. The open panel's bill in a batch → `onPanelBillChanged`. Hint key `orbit.live.tint` (read/write wrapped in try/catch by `use-live-feed`). |
| `components/tint/manager/use-tint-manager-sync.ts` | + `LegacyTintManagerSync`: a component that makes today's single `useTintManagerSync` call with the same props. |
| `components/tint/tint-manager-content.tsx` | The page calls `useTintManagerLive` with the hold list below. It renders `<LegacyTintManagerSync paused={panelKey !== null \|\| selection.size > 0} onProbe={setConnected} onChange={() => { void fetchBoard(); }} />` **only when `!feedLive`**; those are exactly the props it passed before. When live, `ConnectionStrip` reads the feed's `connected`. The "Changed — Reload" check: a quiet board read, then `panelSnapshot` compares only the panel's bill; the strip shows only if it differs, and Reload applies that read. |
| `components/tint/manager/board-detail-panel.tsx` | Optional `changedElsewhere` / `onReloadChanged`: Floor's slim "Changed elsewhere · Reload" bar at the top of the panel. It is false with the feed off, so nothing renders. |
| `components/tint/manager/board-rail.tsx` | Optional `onMenuOpenChange`: the rail's operator menu reports open/closed, so the feed can hold on it. |
| `lib/live/use-live-feed.ts` | Optional `onAnswer(answer)`: the raw answer, for Tint's top-level `missingTouched`. Floor / Billing / Picking don't pass it, so they are unchanged. |
| `components/tint/manager/use-tint-manager-live.test.ts` (new, 9 tests) | Fake React, window/document/localStorage, scripted fetch and mock timers (Date too). See Checks. |
| `package.json` | `test:tint-live` += the new test file |

## Holds (the feed waits, then applies ONCE on release)
| Hold | State |
|---|---|
| Detail panel open | `panelKey !== null` |
| Rows ticked | `selection.size > 0` |
| Re-sequence in flight (▲▼) | `reorderBusy.size > 0`, from the click until the PATCH and its own refetch finish |
| Any write in flight | `writeBusy` (assign, Base — No Tint, re-assign, split re-assign, send back, bulk re-assign) and `baseUndoBusyId !== null` (bypass undo) |
| Rail operator menu open | `railMenuOpen` (new `BoardRail.onMenuOpenChange`) |
| Missing-customers popover open | `missingBadgeOpen` |
| Customer-missing sheet | `missingSheetOpen` |
| Add to Tint (manual entry) | `pullModalOpen` (`ManualTintEntryModal`) |
| Revert a manual entry | `revertOrder !== null` (`ManualTintRevertModal`) |
| Remove OBD | `removeModalOrder !== null` (`RemoveObdModal`) |
| Hide OBD | `hideModalOrder !== null` (`HideObdModal`) |
| Skip history | `skipHistoryFor !== null` (`SkipHistoryModal`) |
| Pause history | `pauseHistoryFor !== null` (`PauseHistoryModal`) |

**Not held, checked in the code:**
- **Search / filter typing.** Filters run client-side over the payload. The header input is controlled by `searchQuery`, which a reload never touches, and the header is not remounted, so focus stays.
- **The Base — No Tint TI form** (`BaseTiPanel`). It is keyed by assignment + line, and its state is its own, not the board payload's, so a reload does not reset it.
- **The two "Pending bill actions" native selects** (`value=""`). A reload can only change their options.
- The panel's own re-assign menu is covered by "panel open".

## Differences from the plan / brief (the code wins)
1. **There is no drag-reorder.** Re-sequencing is the ▲▼ arrows (`PATCH /api/tint/manager/reorder`). The hold covers the click through to the PATCH and its refetch (`reorderBusy`).
2. **There is no split builder on this page.** `split-builder-modal.tsx` was retired and is not mounted. Every modal that *is* mounted is in the table above, plus two holds the plan did not name: the rail operator menu and the missing-customers popover.
3. **There is no per-bill read endpoint for Tint** (Floor's strip re-reads one bill). The strip check does one quiet board read (~40 statements), and only when the open bill is in a change batch, then compares just that bill.
4. **The OFF path adds the switch re-check.** The brief asked for "no extra requests". As on Picking 4b and Billing 2b-ii, with the switch off the feed makes **one `GET /api/live/changes?screen=tint` at page open and one a minute** while visible. Each is answered `{ enabled: false }` from the 30 s-cached switch, so it costs about 0 DB statements, and there are none while hidden.
   - Everything else on the OFF path is byte-identical: the same marker, props, pause and board / side-list fetches, which the tests and the static check pin.
   - Zero extra requests would need the switch state carried on the existing marker response. That is a server change and out of this step's scope; it is offered as a follow-up.
5. **The feed's first answer is a full load** ("start", after the head cursor, by design). A page that opens live reads the board twice at open: the page's init, then the feed's start.
6. **Own writes still reload at once, as today.** The feed then also sees that write and reloads once more within ~15 s. Today the marker does exactly the same, so the count is unchanged.
7. **`held` is capped at 100** (the route's HELD_MAX). The board had 35 bills on 2026-09-30. On a day above 100, a bill leaving the board from beyond the first 100 ids would wait for the next other change.

## OFF-path proof
- **Mode.** `live = mode === "live" || (mode === "unknown" && hint)`. With the switch absent, the first answer is `{ enabled: false }`: the mode goes to `off`, the hint is cleared, and `<LegacyTintManagerSync>` mounts.
  - With no hint it is mounted from the first render.
  - A browser that saw the feed on last time mounts it after the first answer (≤ a second).
- **Props.** `LegacyTintManagerSync` makes the same single `useTintManagerSync({ paused, onProbe, onChange })` call the page made, with the same three values. A test pins the JSX: the page no longer calls the hook directly.
- **No board or side-list fetch comes from the feed while OFF** (test: over 2 min OFF, 0 board and 0 side-list fetches from the hook, ≤ 3 switch re-checks, nothing else).
- The strip props default to `false` / undefined, so nothing renders off the feed. `BoardRail.onMenuOpenChange` only feeds the hold.

## Checks
`npx tsc --noEmit` is clean. `npm run build` exit 0 (stale `.next` moved to `.next-stale-20260930g-tint`). All 17 test files: **216 tests pass**.

The 9 new tests cover:
- the pure helpers (live rule, board ids, cap, hint key);
- **ON** → `screen=tint`, `topics=order,config`, `held=3,5,9`, `missing=42`; one start reload; **one** reload per hit; **no marker probe**; the hint written;
- a "nothing for you" glance → no reload;
- **hold** → the glance keeps running (3 hits delivered), no reload while held, **exactly one** on release, none after;
- the strip → only when the **open** bill is in the batch;
- `missingTouched` → the side list once (no board reload), held until release;
- **hidden** → no feed requests over 5 min;
- **OFF** → not live, hint cleared, no board / side-list fetch, ≤ 3 re-checks in 2 min;
- a static check that the legacy marker mounts only under `!feedLive`, with today's props and no `router.refresh()`.

**No screen was tested by hand** (no login in this session). The hand-test list is below.

## Hand test (Smart Flow) — switch ON, two windows A and B, both on the Tint Manager
To switch on:
```sql
INSERT INTO app_settings ("settingKey","isEnabled","updatedAt") VALUES ('live.feed.tint', true, now())
  ON CONFLICT ("settingKey") DO UPDATE SET "isEnabled" = true, "updatedAt" = now();
```
`live.feed` must also be on. Optional: `localStorage.setItem("orbit.live.debug","1")` in A's console shows `[live:tint-manager]` lines.

1. **Assign in B** → A shows it within ~15 s (≤ ~70 s if A has been idle 2 min+), without a click.
2. **Operator pause / resume / start / done** (phone) → A updates within ~15 s.
3. **Challan save / void** → A's row updates.
4. **Panel open in A**, change that bill from B → A shows "Changed elsewhere · Reload" at the top of the panel and does **not** swap under you. Reload applies it. Close the panel → one reload.
5. **Panel open in A, change a different bill** from B → no strip. Close the panel → one reload.
6. **Tick rows in A**, change from B → nothing moves until you untick, then one reload.
7. **Open each modal in A** (Add to Tint, Remove, Hide, Revert, Skip / Pause history, the customer sheet, the missing popover, the rail operator menu) while B changes something → nothing moves until it closes.
8. **Type in A's search** while B changes things → no focus loss; the filtered list refreshes under the same search.
9. **Customer fix** (resolve a missing customer in B) → A's "N missing" badge drops within ~15 s.
10. **A non-tint change** (a Floor / picking action on a non-tint bill) → A does not reload (the debug log shows no `board:` line).
11. **Hide A's tab** for 5 min → no `/api/live/changes` calls in DevTools; show it → one glance, then one reload if anything changed.
12. **Switch OFF** (`UPDATE app_settings SET "isEnabled"=false,"updatedAt"=now() WHERE "settingKey"='live.feed.tint';`) → within ~1 min A goes back to the 15 s `/api/tint/manager/marker` probe, with no page reload.

## Rollback
Switch off (above): the page returns to the legacy marker at its next glance, with no reload. Code: `git revert <hash>`.
