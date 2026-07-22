# Picking Push Notifications — LIVE

**Date:** 2026-07-22
**Status:** Event notifications LIVE in production and verified on device.
One piece remains: the supervisor 10-minute "picks waiting" timer.
**Save to:** `docs/prompts/drafts/web-update-2026-07-22-picking-push-notifications.md`

> **Replaces an earlier draft of the same name** written mid-session, which said the whole
> feature was parked and inert. That is no longer true — the assign/done triggers and the
> notification toggle shipped after it was written. The earlier file was deleted, not
> archived, to avoid duplication at consolidation time. This file is the only record.

---

## 1. Why this exists

Live sync (shipped 2026-07-22, see `web-update-2026-07-22-picking-live-sync.md`) only
updates a screen someone is already looking at. Nothing reached a phone in a pocket.

- A picker did not know a bill was assigned to him until he opened the app.
- A supervisor did not know a pick was finished unless he was watching the board.

This work makes the phone tell them.

---

## 2. WHAT IS LIVE NOW

Commits: `7f041c95` → `146b8245` → `20cbd447` → (storage) → `a439da3f` → `1def8c57`

### Notifications that fire today

| Trigger | Who gets it | Text |
|---|---|---|
| Supervisor assigns a bill | That picker | `New pick assigned` / `{customer} · {obdNumber}` |
| Picker marks a pick done | All supervisors | `Pick completed` / `{picker} finished {customer} · {obdNumber}` |

Both are **event-driven** — they fire inside the existing API route the moment the action
happens. No scheduled job, no infrastructure dependency.

Both are gated on `isWithinDepotHours()` — 09:00 to 20:00 IST. Outside that window the
notification is **dropped, not queued**. The work is still on the board next morning.

The actor is always skipped — nobody is notified about their own tap.

### Verified on device (iPhone 13, iOS, installed to home screen)

1. Web Push reaches an installed home-screen PWA. ✅
2. It arrives with the app **fully closed and the phone locked**. ✅
3. The subscription survives in the database — sends work with nothing held in the
   browser. ✅
4. Real "Pick completed" notification from a real order:
   `Ramesh K. finished Mohan Colour Co · 9108429622` ✅
5. Toggle OFF → marked a pick done → **no buzz**. Toggle ON → marked another done →
   **buzz**. Both directions confirmed. ✅

**Still unverified:** the "New pick assigned" notification to a picker. Same code path as
the one that works, but it cannot be proven until a picker has a real login and a
subscribed phone. Treat as untested.

### The notification toggle

Lives in the **"You" sheet** that the mobile header avatar opens
(`components/shared/mobile-shell-context.tsx:167-195`, opened from
`components/picking/picking-board-mobile.tsx:1714`).

One row, "Notifications", directly above Sign out. Two taps to reach, a third to toggle.

- **ON** = permission granted AND this device's endpoint saved and active. Never an
  optimistic guess — it re-probes permission and the live browser subscription on open.
- **OFF** = `isActive=false` on this device's row AND the browser subscription removed, so
  DB and browser state stay in agreement.
- **Per-device.** Turning it off on one phone does not affect the user's other devices.
- The ON switch is the sheet's **only teal element** — the avatar circle was recoloured
  teal → gray-800 to keep the one-teal rule.

Blocked states go gray and non-interactive with one short line:
- Permission denied → "Blocked in your phone settings."
- iOS not installed to home screen → "Add OrbitOMS to your home screen first."
- Save failed → "Couldn't turn on. Try again."
- No Push API → "Not available on this browser."

### Supporting pieces

| Thing | Notes |
|---|---|
| `public/sw.js` | Push + notificationclick ONLY. **No fetch handler, no Cache API.** |
| `push_subscriptions` table | Created by hand in Supabase. 11 columns, 4 indexes. |
| `lib/push/send.ts` | `sendToUser(userId, payload)`. Sequential awaits. Never throws. |
| `lib/push/quiet-hours.ts` | `isWithinDepotHours()`, computed in Asia/Kolkata. |
| `lib/push/recipients.ts` | `getPickingSupervisorUserIds()` — floor_supervisor, operations, admin. Handles secondary `user_roles`. |
| `app/api/push/subscribe` | Auth-gated. userId from SESSION only. Upserts on endpoint. |
| `app/api/push/unsubscribe` | Sets isActive=false for one endpoint. |
| `app/api/push/test-saved` | Sends to the session user's saved devices. |
| `app/picking/push-test/page.tsx` | Diagnostic page + gray pill link on `/picking` (admin OR operations). |
| `web-push` npm package | Approved addition. |
| VAPID keys | Vercel env: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |

**Response-blocking choice:** both triggers `await` before responding, because Vercel
freezes the function once it returns and un-awaited pushes are unreliable. Assign sends in
parallel (`Promise.allSettled`); done sends sequentially over the small supervisor list.
Both are fully wrapped in try/catch and swallowed — the API response body and status are
byte-identical whether push succeeds, fails, or is skipped.

---

## 3. THE ONE REMAINING PIECE

**Supervisor timer:** every 10 minutes, if the number of picks waiting has changed, buzz
the supervisor with `8 picks waiting · oldest 25 min`.

### Why it is not built

It is not event-driven. Nothing happens — something must wake up on its own, count the
board, and decide. **Vercel Hobby cannot schedule that.** Confirmed:

- <https://vercel.com/docs/cron-jobs/usage-and-pricing> — Hobby crons run **once per day**;
  any more frequent expression **fails at deployment**.
- Hobby timing is loose anyway: a job set for 08:00 may fire any time before 08:59, which
  would wreck even the 9 AM / 7:30 PM bookends.
- The per-project job cap was lifted to 100 on all plans in January 2026, so the old
  "2 jobs on Hobby" limit in CLAUDE_CORE §4 is stale. **Cadence is what bites, not count.**
  Freeing an Attendance cron slot would not help.
- `vercel.json:2-4` currently holds two daily crons:
  `/api/cron/attendance-rollover` (`35 18 * * *`) and `/api/cron/attendance-purge`
  (`30 20 * * *`).

### The chosen approach — PowerShell doorbell (option B)

**Decision made this session.** A scheduled task on the depot PC calls one URL every
10 minutes with the `CRON_SECRET` bearer. That is all the script does — roughly 15 lines.
All real work (counting, change detection, quiet hours, sending) happens in the Vercel
route.

Why B: the depot PC is already the beating heart (the mail parser polls every 10 s), and
the failure mode is self-consistent — PC off means depot closed means no orders arriving
means no buzz needed.

**Honest limitation:** if the PC is off or asleep, buzzing stops with no error and no
warning. Silent failure, not loud.

**Improvement on the Parse-MailOrders precedent:** that script lives only on the depot PC
and is not in git, which makes replacing it a manual chore. The new `.ps1` should be
**committed to the repo under `scripts/`** even though it runs from the depot PC. Repo is
the master copy; the PC holds a copy.

Alternatives if B ever disappoints: **A** — Vercel Pro (~$20/mo, minute-level cron, config
stays in repo). **C** — free internet scheduler (cron-job.org / GitHub Actions; Actions
drifts 5-15 min, which partly defeats a 10-minute timer).

**Whichever is chosen, the notification code is identical.** The trigger is just a
doorbell — switching later means changing who presses it, not rebuilding anything.

### Build order when it resumes

```
[ ] 1. Table to remember the last-sent count
[ ] 2. Cron route: count + change check + send
[ ] 3. PowerShell doorbell + Windows scheduled task
[ ] 4. Test on device
```

Step 1 exists so "only buzz if the number changed" works **across runs** — the job is
stateless otherwise and would have nothing to compare against.

---

## 4. LOCKED DESIGN — do not re-litigate

Argued through several rounds. Reasoning recorded so a future session does not "improve"
it back into a worse design.

### Supervisor timer (not yet built)
```
8 picks waiting · oldest 25 min
```
- At most every **10 minutes**.
- **Only buzzes if the COUNT CHANGED since the last buzz.** Still 8 and nothing moved →
  silent.
- No age escalation. No capacity logic. No free-picker logic.

### Events (live)
- Assign → picker, immediate, one per bill, never batched. ~10-20/day, each a personal
  instruction.
- Done → supervisors, immediate.

### Always
- Nothing outside 09:00–20:00 IST. Dropped, not queued.
- Never notify the actor about their own tap.

### DROPPED IN SCOPE — designed, not built

Cut deliberately to ship faster. Design notes kept so they can be picked up without
re-deciding:

- **"4 ready to check · oldest 12 min"** — 5-minute timer. Faster than assign because
  checking is the supervisor's OWN job; nobody else can do it, so aging is genuinely on
  him. Needs the same scheduler as the waiting timer.
- **9:00 AM opening count and 7:30 PM end-of-day sweep** — the anti-spillover guard.
- **Badge count on the app icon** — always live, quiet, no sound.

### IDEAS TRIED AND REMOVED — do not reintroduce

1. **Age-based escalation on assign** (buzz faster as the oldest ages).
   Removed: punishes the supervisor for a capacity problem he cannot solve. If 40 picks
   wait and only 10 pickers exist, the board never clears, the phone never shuts up, he
   mutes it, the system is dead. A permanently ringing alarm equals no alarm.
   **Kept for CHECK only**, where he is the capacity.

2. **Free-picker gating** (only buzz when a picker is idle AND work waits).
   Removed: needs to know who is on duty. An absent picker looks "free" forever and would
   buzz all day. Would have required an Attendance dependency. The "only if count changed"
   guard solves the same noise problem far more simply.

3. **Per-event notifications for the supervisor** (one buzz per pick arriving).
   Removed: 100-200 OBDs/day means 300+ buzzes. He does not care that pick #14 arrived; he
   cares how many are stacked up.

4. **Hard cap of 6 buzzes/hour.** Superseded by the "only if changed" guard.

5. **In-app consent banner.** Replaced by the settings toggle. A banner can only turn
   notifications ON; a toggle can also turn them OFF. On personal phones someone will
   eventually want to stop the buzzing, and without a switch their only route is blocking
   OrbitOMS in phone settings — after which the app can never ask again. The usual argument
   for a banner is discovery, which does not apply here because rollout is hand-held.

---

## 5. Device + rollout reality

Confirmed with Smart Flow:

| Question | Answer |
|---|---|
| Picker phones | All Android |
| Supervisor phones | All Android |
| How opened | Added to home screen |
| Ownership | **Personal** phones, not depot-issued |
| Test device | iPhone 13 (admin/ops phone) |

**Rollout is a hand-held job.** Each person must (a) add the app to their home screen and
(b) tap Allow once. Neither can be done remotely or forced. On iPhone the home-screen
install is mandatory — no icon, no notifications, ever. Budget an afternoon to walk
~10 pickers through it in person; the install step is what people get wrong alone.

Indian budget Androids (Xiaomi/Vivo/Oppo/Realme) aggressively kill background
notifications. Expect per-device battery-saver exceptions during rollout.

**Keep the push-test page.** During rollout it is the fastest way to answer "why isn't this
picker getting alerts" — it shows in plain words whether he installed, whether he allowed,
and whether a buzz reaches him.

---

## 6. Landmines

1. **A caching service worker would silently break live sync.**
   `use-picking-marker.ts` polls `/api/picking/marker` every 15 s and depends on `no-store`
   freshness. The current `sw.js` has zero fetch listeners and zero Cache-API calls.
   **Keep it that way.**

2. **Never add a second `orders.update` in a notification trigger.** The marker keys on
   `MAX(orders.updatedAt)` — an extra write fires a false change on every board.

3. **`push_subscriptions.updatedAt` has a DB default but no trigger.** Every write must set
   it explicitly (`updatedAt: new Date()`). The model deliberately does NOT use
   `@updatedAt`.

4. **Vercel runs in UTC; the depot is IST (UTC+5:30).** A naive `getHours()` quiet-hours
   check would silence the working day and buzz at night. `lib/push/quiet-hours.ts`
   computes in `Asia/Kolkata` — keep it that way, and reuse the exported constants rather
   than hardcoding 9 and 20 anywhere else.

5. **Push must never break the action it hangs off.** Both triggers swallow all errors. Any
   future trigger must do the same.

6. **Counts are derivable by READING `buildPickingWhere()` — never modify it.**
   "Waiting to assign" = `isStillWaiting` (`lib/picking/queue.ts:508`), surfaced as
   `windows[].count/totalCount` (`:515`/`:525`). "Ready to check" = rows where `isDone`.
   The marker route demonstrates the AND-merge pattern.

7. **Cron routes authenticate via `lib/cron-auth.ts:9-13`** —
   `Authorization: Bearer ${CRON_SECRET}`, **fail-closed** when the env var is unset. The
   new timer route must reuse `isCronAuthorized`, or it is an open public endpoint.

8. **`manifest.json` name is currently `"Orbit"` with `short_name` still `"OrbitOMS"`.**
   An unfinished experiment to see whether iOS reads the two separately, so the
   notification's "from …" line could read Orbit while the icon label stays OrbitOMS.
   **Result never observed** — it only shows after deleting and re-adding the home-screen
   icon. Notifications still display "from OrbitOMS". Either finish the check or revert.

---

## 7. Stale docs to correct at consolidation

- **`CLAUDE_PICKING.md` §1 and §7 are WRONG.** They claim `picker` and `floor_supervisor`
  have zero `picking` rows. **They do**, added 2026-07-20 (`seed.ts:110-112`):
  floor_supervisor (view+edit), picker (view only), operations (view+edit).
  Not SELECT-verified against live production — worth confirming.

- **`CLAUDE_ATTENDANCE.md:462` and §14 are WRONG.** They claim `manifest.json` start_url is
  `/attendance`. The real file says `/`. Code wins.

- **`CLAUDE_CORE.md` §4 is stale** on the Vercel cron limit — it says "2 cron schedules,
  Hobby tier cap". The count cap was lifted to 100 in January 2026. The real constraint is
  once-per-day cadence.

- **A new canonical file is warranted** — push notifications are now a live production
  feature spanning picking, the mobile shell, and infrastructure. Consider
  `CLAUDE_NOTIFICATIONS.md` plus a router row, rather than scattering this across
  CLAUDE_PICKING and CLAUDE_UI.

---

## 8. Temporary scaffolding still in place

Both marked with `⚠ TEMPORARY SCAFFOLDING` comments:

- `app/picking/push-test/page.tsx` — the diagnostic page.
- The gray "Push test (temporary)" pill on `/picking`, visible to **admin OR operations**.
  Dhruv and Kuldeep will see it and may wonder what it is.

Recommendation: **keep both** through the floor rollout, then decide. The page earns its
place as a diagnostic. The pill could be narrowed to admin-only once rollout is done.
