# Code update — 2026-10-01 — Tint live feed, Step 5: the Tint Operator on the change feed (client)

**Commit:** the single commit on `main` titled *"live feed tint 5: Tint Operator on the change feed (behind live.feed.tint, default off)"* (`git log --grep "live feed tint 5"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-tint-live-feed.md` §D (operator face), §E, Step 5. The owner answered "agree all".
**Server:** step 3, `acf0ba0b` (`?screen=tint&face=operator&held=`, narrowed to the SESSION user's my-orders set ∪ held).
**Switch:** `app_settings 'live.feed'` AND `'live.feed.tint'` (an absent row = OFF). It stays absent. This is the same switch as the Manager (step 4).
**Operator only.** The Manager, the server rule and the SQL are untouched. No DB.

## What shipped
| File | Change |
|---|---|
| `components/tint/operator/use-tint-operator-live.ts` (new) | `useTintOperatorLive`: one `useLiveFeed({ scope: "tint-operator", screen: "tint", topics: "order,config", params: face=operator & held=<his order ids, cap 100> })`. A hit, a config change or a reset → **one** my-orders refetch that **keeps his selected job**. Everything is held while `hold` and applied **once** on release. IST midnight → one refetch. Hint key `orbit.live.tint-operator`. The "Changed — Reload" strip (below). |
| `components/tint/tint-operator-content.tsx` | `fetchOrders(opts?: { keepSelection })`. **Only the feed passes `keepSelection: true`**; every own-action call still passes nothing and re-selects exactly as before. It computes `holdLive` (list below), `tiTyped` and `heldIds`, calls the hook, and renders the strip when live. `CompletedAssignment` gains an optional `orderId` type field: the route already returns it, because Prisma `include` returns every scalar. |
| `components/tint/operator/use-tint-operator-live.test.ts` (new, 10 tests) | Same fake-React / fake-browser / mock-timer harness as the Manager's test. |
| `package.json` | `test:tint-live` += the new test file |

The strip reuses `DetailChangedStrip` from `components/picking/picking-live.tsx` unchanged: the Picking 4b pattern, a slim fixed bar at the top reading "This bill changed elsewhere · Reload".

## Holds (the feed keeps glancing, applies nothing, then ONE refetch on release)
| Hold | State |
|---|---|
| Skip Job modal | `skipModalJob !== null` (`SkipJobModal`) |
| Pause Job modal | `pauseModalJob !== null` (`PauseJobModal`) |
| Mark Done confirm | `markDoneModalJob !== null` (`MarkDoneConfirmModal`) |
| Same-formula reuse modal | `formulaModalOpen` (`FormulaMatchModal`) |
| Save-TI result popup | `samplingPopup !== null` (`SaveSamplingPopup`) |
| Queue dropdown | `queueDropdownOpen` |
| Split action in flight (start / done) | `splitActionLoading !== null` |
| Order action in flight (start / done) | `orderActionLoading !== null` |
| Resume in flight | `resumingId !== null` |
| TI save in flight | `tiActionLoading` |
| Formula lookup in flight | `formulaLoading` |
| A held TI save waiting on a reuse pick | `pendingSaveAfterApply` |

**Not held:**
- **A running job's timer.** The 1 s timer is render-only, and a test asserts the hold expression never mentions it. A manager's cancel or reassign of his running job applies at once.
- The History view.
- The paused-card accordion.
- The TI-incomplete banner (inline, not a modal).
- Toasts.

**There is no re-order or drag on this screen.** The sequence is the manager's (▲▼ on the Manager board) and the operator only reads it.

**The strip ("This bill changed elsewhere · Reload")** shows when his **open** job's order is in a change and either:
- a hold is active (a modal is open over it), so nothing is swapped and the release refetch applies it; or
- he has **typed unsaved TI input** on that job: a shade value, a shade name or a picked sampling number. The auto-filled view of an existing entry does not count. That change is **not applied** until he saves or clears the form, or taps Reload.

A change to **another** job (for example a new assignment) still applies while he types.

## Differences from the plan / brief (the code wins)
1. **`fetchOrders()` re-selects a job on every call** (the running job, else the first by sequence). A background refetch with that behaviour would jump him off the job he chose and **reset its TI form** (the reset effect keys on `selectedJobId` / `selectedJobType`). So the feed refetches with `keepSelection: true`: the selection is kept while that job is still in his list, and moves exactly as today only when it is gone. Own actions are unchanged.
2. **The TI form is inline, not a modal.** The plan named "TI" among the modals. The only TI overlays are `FormulaMatchModal` and `SaveSamplingPopup`, and both are holds. The inline form is protected by the `tiTyped` rule above rather than by a blanket hold, because a blanket hold would freeze his list all day: a single-line job auto-fills the form, and new sites auto-open the new-shade form.
3. **A full reload (config / reset / lag) while he has typed TI input is parked behind the strip**, as is any later work. A refetch is all-or-nothing. It applies when he saves or clears, or taps Reload. Page load is unaffected, because the form is empty then.
4. **There is no re-order or drag** on the operator screen (see above).
5. **The OFF path adds only the switch check.** The screen had **no** background sync, and with the switch off it still has none. The feed makes one `GET /api/live/changes?screen=tint&face=operator&held=…` at page open and one a minute while visible, each answered `{ enabled: false }` from the 30 s-cached switch (≈ 0 DB statements), and none while hidden. This is the same cached switch check Floor / Billing / Picking / the Manager make.
6. **The strip reuses Picking's component** (fixed top bar). The operator screen has no detail-panel layout to host Floor's in-panel bar.

## OFF-path proof
- `live = mode === "live" || (mode === "unknown" && hint)`. With the switch absent, the first answer is `{ enabled: false }`: the mode goes to `off` and the hint is cleared. From then on the hook never calls `refetch`; it only runs the off re-check.
- The test pins this: over 2 min OFF, **0 refetches**, ≤ 3 switch checks, and nothing else fetched.
- The page's own fetches (mount, after each action, the modals' success handlers, history, TI entries) are **unchanged** call for call. `fetchOrders()` with no argument behaves byte-identically.
- A static test confirms `keepSelection: true` appears exactly once (the feed) and the own-action `await fetchOrders();` calls are intact.
- The strip renders only when `live`.

## Checks
`npx tsc --noEmit` is clean. `npm run build` exit 0 (stale `.next` moved to `.next-stale-20261001a-tint`; the one Tailwind warning, `duration-[6000ms]`, is pre-existing in `components/billing/billing-pick-delete-queue.tsx`). All 18 test files: **226 tests pass**.

The 10 new tests cover:
- **ON** → `screen=tint`, `face=operator`, `held=11,12`, `topics=order,config`, no `missing`; one start refetch; **one** refetch per hit; hint written;
- "nothing for you" → no refetch;
- **hold** → the glance keeps running (3 hits), no refetch while held, **exactly one** on release, none after;
- a **running job doesn't hold**: a change to his open job applies at once with no typed TI;
- typed TI + a change to **that** job → strip, no refetch; applied once when the form clears;
- typed TI + a change to **another** job → applied;
- the strip under a modal, and Reload applies at once;
- **hidden** → no requests for 5 min, one glance on visible;
- **OFF** → not live, 0 refetches, hint cleared, ≤ 3 switch checks;
- the static page checks (own actions plain, `keepSelection` only in the feed, the hold never mentions the timer, no `router.refresh()`).

**No screen was tested by hand** (no login in this session).

## Hand test (Smart Flow) — switch ON; Manager window (desk) + the operator's device on `/tint/operator`
To switch on:
```sql
INSERT INTO app_settings ("settingKey","isEnabled","updatedAt") VALUES ('live.feed.tint', true, now())
  ON CONFLICT ("settingKey") DO UPDATE SET "isEnabled" = true, "updatedAt" = now();
```
`live.feed` must also be on. Optional on the operator device: `localStorage.setItem("orbit.live.debug","1")` → `[live:tint-operator]` lines.

1. **Manager assigns a new job to him** → it appears in his queue within ~15 s (≤ ~70 s if idle 2 min+), without a tap.
2. **Manager re-sequences his queue (▲▼)** → his order updates; his selected job stays selected.
3. **Manager sends his NOT-running job back to Pending** → it leaves his list. If it was selected, the selection moves on, as today.
4. **Manager reassigns or cancels his RUNNING job (no TI typed)** → his screen drops it within ~15 s. The timer does not block it.
5. **He types TI values on the open job, and the manager cancels that job** → the strip "This bill changed elsewhere · Reload" appears; his typing is not wiped. Reload (or clearing the form) applies it.
6. **He types TI values on job A, and the manager assigns a new job B** → B appears; A's form is untouched.
7. **Open Skip / Pause / Mark Done / the formula modal / the queue dropdown, while the manager changes his list** → nothing moves until it closes, then one refresh. If his open job changed, the strip shows over it.
8. **His own actions** (start, pause, resume, skip, done, TI save) → his list refreshes at once, as today.
9. **Lock the device or background the browser for 5 min** → no `/api/live/changes` calls; return → one glance.
10. **Other operators' jobs** → never wake his screen (the debug log shows no `his list:` line).
11. **Switch OFF** (`UPDATE app_settings SET "isEnabled"=false,"updatedAt"=now() WHERE "settingKey"='live.feed.tint';`) → within ~1 min the screen is back to today's behaviour (no background refresh). The Manager returns to its marker at the same time.

## Rollback
Switch off (above). Code: `git revert <hash>`.
