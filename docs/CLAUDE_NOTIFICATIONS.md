# CLAUDE_NOTIFICATIONS.md — Push Notifications
# v1.0 · Schema v27.12 · July 2026
# Lives in: orbit-oms/docs/
# Load with: CLAUDE.md (repo root) + docs/CLAUDE_CORE.md

Web Push for depot operations. First (and today only) consumer is **Picking**. Live in production and
verified end-to-end on a real iPhone 13, app fully closed, phone locked.

---

## 1. What it is [LIVE]

Standard **Web Push** (VAPID + the `web-push` npm package + a service worker), so a phone buzzes when
something happens on the floor — **even with the app closed and the phone locked**. This is the layer
above live sync: live sync (`CLAUDE_PICKING.md §10`) only refreshes a screen someone is already
looking at; push reaches a phone in a pocket.

**User-visible behaviour:** assign a bill → that picker's phone buzzes; a picker marks a pick done →
supervisors' phones buzz. Each person controls it with an on/off switch in the mobile avatar menu (§3).

**Event-driven only** — every notification fires *inside the existing API route the moment the action
happens*. No scheduled job, no polling, no infrastructure dependency for the two live triggers.

---

## 2. Triggers [LIVE]

Two, both fired from the existing picking write routes (no new routes, no new `orders.update` — see the
marker landmine, §8):

| Trigger | Fires from | Recipient(s) | Text | Verified? |
|---|---|---|---|---|
| **Assign a bill** | `app/api/picking/assign/route.ts` (after both writes per bill) | that **picker** (`pickerId`) | `New pick assigned` / `{customer} · {obdNumber}` | not yet on device (§6) |
| **Mark a pick done** | `app/api/picking/done/route.ts` (after the writes) | **all supervisors** (`getPickingSupervisorUserIds()`) | `Pick completed` / `{picker} finished {customer} · {obdNumber}` | ✅ on device |

- **Customer** = the effective dealer (`shipToOverrideCustomer ?? customer`, `.customerName`); **bill
  number** = `orders.obdNumber`. Assign is **one notification per bill** (its own tag), never batched.
- **The one rule that matters — a push must NEVER break the action it hangs off.** Both triggers are
  fully wrapped in try/catch and swallowed (log only); the API response body + status are
  **byte-identical** whether push succeeds, fails, or is skipped. Any future trigger must do the same.
- **Response timing:** both `await` before responding (Vercel freezes the function once it returns, so
  un-awaited pushes are unreliable). Assign sends in parallel (`Promise.allSettled`); done sends
  **sequentially** over the small supervisor list.

**Self-suppression rule [LIVE] — never notify the person who performed the action.** The actor
(`session.user.id` → `changedById`/`assignedById`) is skipped: assign skips when the assigner *is* the
picker; done skips the acting user from the supervisor recipient list. Nobody is ever notified about
their own tap.

**Quiet hours [LIVE] — 09:00–20:00 IST only.** Both triggers gate on `isWithinDepotHours(new Date())`
(`lib/push/quiet-hours.ts`). Outside the window the notification is **DROPPED, not queued** — the work
is still on the board next morning, and the 15s live-sync surfaces it. **Timezone is explicit IST
(Asia/Kolkata, UTC+5:30):** Vercel runs in UTC, so the check shifts the instant by the IST offset and
reads the hour off that (never `getHours()` on UTC, which would silence the working day and buzz at
night). Bounds are named constants `DEPOT_HOURS_START_IST` (9) / `DEPOT_HOURS_END_IST` (20) — reuse
them, never hardcode 9/20 elsewhere.

---

## 3. The user toggle [LIVE]

A single **"Notifications"** on/off row directly **above Sign out** in the **"You" sheet** that the
mobile header avatar opens (`components/push/push-toggle.tsx`, mounted in
`components/shared/mobile-shell-context.tsx`). Two taps to reach, a third to toggle. The sheet mechanics
are the shared mobile shell — see **`CLAUDE_UI.md §59`** (and §62 for the toggle's one-teal styling);
not re-documented here.

- **State reflects the TRUTH, never an optimistic guess** — on open it re-probes OS permission AND the
  live browser push subscription. **ON** = permission `granted` AND this device's endpoint is
  subscribed/active; otherwise **OFF**.
- **Turning ON** (must run from the user's real tap — iOS gesture requirement): `Notification.requestPermission()`
  → `pushManager.subscribe(...)` → `POST /api/push/subscribe`. Flips to ON **only after the save
  succeeds**.
- **Turning OFF** (this device only): `POST /api/push/unsubscribe` for this endpoint **and**
  `pushManager.unsubscribe()` on the browser, so DB state and browser state stay in agreement. Never
  touches the user's other devices.
- **Blocked states** — the switch goes gray + non-interactive with one short line: permission denied →
  *"Blocked in your phone settings."* (once the OS denies, the app can never re-prompt — the switch
  cannot help; the user must re-enable in phone Settings); iOS not installed to home screen → *"Add
  OrbitOMS to your home screen first."*; save failed → *"Couldn't turn on. Try again."*; no Push API →
  *"Not available on this browser."*
- **Why a toggle, not a banner** [DEFERRED banner, rejected]: a banner can only turn push ON; a toggle
  can also turn it OFF. On personal phones someone will eventually want the buzzing to stop — without a
  switch their only route is blocking OrbitOMS in phone settings, after which the app can never ask
  again.

---

## 4. Subscription storage [LIVE]

- **Table:** `push_subscriptions` — one row **per device endpoint**. Column block lives in
  **`CLAUDE_CORE.md §7` (schema)**, not restated here.
- **Subscribe** (`app/api/push/subscribe/route.ts`): **`userId` comes from the SESSION only, never the
  request body** (otherwise one user could register a phone against another's account). Upserts on the
  `endpoint` unique index; if the endpoint already exists under a DIFFERENT user (a shared phone), it
  **reassigns to the current session user** so the previous owner stops receiving on that device.
- **Multi-device reality:** one user → many endpoints (phone + tablet + reinstall). `sendToUser(userId, …)`
  (`lib/push/send.ts`) loads **all `isActive` rows for that user** and sends to each, sequentially.
- **Dead-endpoint hygiene** (in `sendToUser`): on push-service **HTTP 404 / 410** the phone is gone for
  good → `isActive = false` immediately; on any other failure → `failureCount + 1`, and at **5** →
  `isActive = false`; on success → `failureCount` reset to 0 and `lastSeenAt` stamped. Every write sets
  `updatedAt` explicitly (see the §8 landmine).
- **`sendToUser` NEVER throws** — it returns a per-endpoint result summary. A failed buzz can't break
  the picking action that triggered it.
- **Diagnostic:** `POST /api/push/test-saved` sends to the session user's own saved devices (no
  subscription in the body — the real proof storage works), used by the push-test page (§8).

---

## 5. Infrastructure

Must exist for push to work in any environment:

- **VAPID keys** — env vars: **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`** (client subscribe + server send),
  **`VAPID_PRIVATE_KEY`** (server send, secret — never committed), **`VAPID_SUBJECT`**
  (`mailto:admin@orbitoms.in`). Set in Vercel (all environments) and `.env.local` (gitignored). The
  public key is read **server-side at request time** and passed to the client, so it takes effect
  without a rebuild.
- **Service worker** — `public/sw.js`, served at `/sw.js`, registered from the client. **`push` +
  `notificationclick` handlers ONLY.**
- **`web-push` npm package** — approved dependency.
- **Manifest / install** — on iOS, Web Push works ONLY from a home-screen-installed PWA (no icon → no
  notifications, ever). All picker/supervisor phones are Android (also install-to-home-screen); the
  test device is an iPhone 13.
- **Key rotation:** rotating the VAPID **private** key (or a mismatched pair) invalidates **every
  existing subscription** — all stored endpoints stop accepting sends and must re-subscribe. Rotate
  only deliberately; expect a full re-subscribe of all devices afterward.

---

## 6. Verified behaviour [LIVE]

Tested end-to-end on iPhone 13 (iOS, installed to home screen):
1. Web Push reaches an installed home-screen PWA. ✅
2. It arrives with the **app fully closed and the phone locked**. ✅
3. The subscription survives in the DB — sends work with nothing held in the browser (via
   `/api/push/test-saved`). ✅
4. A real "Pick completed" from a real order: `Ramesh K. finished Mohan Colour Co · 9108429622`. ✅
5. Toggle OFF → marked a pick done → **no buzz**; toggle ON → marked another done → **buzz**. Both
   directions confirmed. ✅

**NOT yet verified [NEXT]:** the **"New pick assigned"** notification to a picker — same code path as
the working done-trigger, but it cannot be proven until a real picker has a login and a subscribed
phone. Treat as untested.

---

## 7. Deferred / not built [DEFERRED]

**Supervisor "N picks waiting" reminder** — every ~10 minutes, if the count of picks-waiting changed
since the last buzz, notify the supervisor `8 picks waiting · oldest 25 min`. **Not built.**

**Why it is NOT a Vercel cron (state clearly so nobody re-tries one):** it is not event-driven —
something must wake up on its own, count the board, and decide. **Vercel Hobby crons run only ONCE PER
DAY** — any more-frequent expression **fails at deployment**. The binding constraint is **CADENCE, not
count**: the per-project job COUNT cap was lifted to 100 on all plans in **January 2026**, so the old
`CLAUDE_CORE.md §4` "2 cron / Hobby cap" wording is stale (correct it in step 4) — freeing an
Attendance cron slot would NOT help. Hobby timing is also loose (a job set for 08:00 may fire any time
within that hour), which would wreck the intended bookends.

**Chosen trigger — the PowerShell doorbell (option B, decided):** a Windows scheduled task on the depot
PC calls one URL every 10 minutes with the `CRON_SECRET` bearer (~15 lines; all real work — count,
change-detection, quiet hours, send — happens in the Vercel route). The depot PC already runs the mail
parser every 10s, and the failure mode is self-consistent (PC off ⇒ depot closed ⇒ no orders ⇒ no buzz
needed). **Honest limitation:** if the PC is off/asleep, buzzing stops silently. The `.ps1` should be
**committed to `scripts/`** (repo is master; PC holds a copy) — an improvement on the parser precedent,
which lives only on the PC and off git. Alternatives if B disappoints: **A** Vercel Pro (~$20/mo,
minute-level cron, config in repo); **C** free internet scheduler (cron-job.org / GitHub Actions;
Actions drifts 5–15 min). **The notification code is identical whichever presses the doorbell.**

Build order when it resumes: (1) a table to remember the last-sent count (so "only if changed" works
across runs); (2) cron route: count + change check + send (reuse `isCronAuthorized`); (3) PowerShell
doorbell + scheduled task; (4) test on device.

**Also designed, cut to ship faster [DEFERRED]:** a 5-minute "N ready to check" reminder (escalates
because checking is the supervisor's OWN job); a 9:00 opening count + 7:30pm end-of-day sweep; app-icon
badge count. **Tried and REMOVED — do not reintroduce:** age-based escalation on assign (punishes a
capacity problem he can't solve → permanently ringing alarm = no alarm); free-picker gating (needs
attendance to know who's on duty); per-event supervisor buzzes (300+/day); a hard 6/hour cap
(superseded by "only if changed").

---

## 8. Landmines

1. **[LANDMINE] A caching service worker would silently break live sync.** `use-picking-marker.ts`
   polls `/api/picking/marker` every 15s and depends on `Cache-Control: no-store` freshness. `sw.js`
   has **zero fetch listeners and zero Cache-API calls** — keep it that way. Never add caching.
2. **[LANDMINE] Never add a second `orders.update` in a notification trigger.** The live-sync marker
   keys on `MAX(orders.updatedAt)`; an extra write fires a false change on every board. (This is why
   both triggers only READ for names.)
3. **[LANDMINE] `push_subscriptions.updatedAt` has a DB default but NO trigger.** It is a plain
   `@default(now())`, **NOT `@updatedAt`**. Every write must set `updatedAt: new Date()` explicitly, or
   updates carry a stale timestamp.
4. **[LANDMINE] Vercel is UTC; the depot is IST (UTC+5:30).** A naive `getHours()` quiet-hours check
   would silence the working day and buzz at night. `lib/push/quiet-hours.ts` computes in Asia/Kolkata
   — keep it, and reuse the exported constants (§2).
5. **[LANDMINE] Push must never break the action it hangs off.** Both triggers swallow all errors; any
   future trigger must too (§2).
6. **[LANDMINE] Counts are derivable by READING `buildPickingWhere()` — never modify it.** "Waiting to
   assign" = `isStillWaiting` (`lib/picking/queue.ts`), surfaced as `windows[].count`/`totalCount`;
   "ready to check" = rows where `isDone`. The marker route shows the AND-merge pattern. (For the
   future supervisor timer.)
7. **[LANDMINE] Cron routes authenticate via `lib/cron-auth.ts`** — `Authorization: Bearer
   ${CRON_SECRET}`, **fail-closed** when the env var is unset. The future timer route MUST reuse
   `isCronAuthorized`, or it is an open public endpoint.
8. **[LANDMINE — unfinished experiment] `manifest.json` `name` is `"Orbit"` with `short_name` still
   `"OrbitOMS"`.** An experiment to see whether iOS reads the two separately (so a notification's
   "from …" could read *Orbit* while the icon stays *OrbitOMS*). **Result never observed** — it only
   shows after deleting and re-adding the home-screen icon; notifications still display "from OrbitOMS".
   Either finish the check or revert. (Do NOT change manifest `start_url`/`display`/`icons`/`theme`.)
9. **[LANDMINE] iOS install is mandatory; budget hand-holding.** No home-screen install → no push,
   ever. Indian budget Androids (Xiaomi/Vivo/Oppo/Realme) aggressively kill background notifications —
   expect per-device battery-saver exceptions during rollout. **Keep the push-test page** — it's the
   fastest way to answer "why isn't this picker getting alerts" (shows installed? allowed? buzz
   reaches?).

---

## 9. Temporary scaffolding [DEFERRED — remove after rollout]

Both carry `⚠ TEMPORARY SCAFFOLDING` comments in code:
- `app/picking/push-test/page.tsx` — the diagnostic page (subscribe state, saved-device count, "Send to
  saved phone"). Earns its place during rollout.
- The gray **"Push test (temporary)"** pill on `/picking`, visible to **admin OR operations**. Consider
  narrowing to admin-only once rollout is done.

---

## 10. Key files index

| File | Role |
|---|---|
| `public/sw.js` | Service worker — `push` + `notificationclick` ONLY; no fetch, no cache |
| `lib/push/send.ts` | `sendToUser(userId, payload)` + `getVapid()`; dead-endpoint hygiene; never throws |
| `lib/push/quiet-hours.ts` | `isWithinDepotHours()` (IST) + `DEPOT_HOURS_START_IST`/`_END_IST` |
| `lib/push/recipients.ts` | `getPickingSupervisorUserIds()` — floor_supervisor/operations/admin, primary + secondary `user_roles` |
| `app/api/push/subscribe/route.ts` | Upsert on endpoint; `userId` from session; reassigns a shared phone |
| `app/api/push/unsubscribe/route.ts` | `isActive=false` for one endpoint, session-scoped |
| `app/api/push/test-saved/route.ts` | Sends to the session user's saved devices (diagnostic) |
| `app/api/picking/assign/route.ts` | Assign trigger (§2) — after both writes, per bill |
| `app/api/picking/done/route.ts` | Done trigger (§2) — after the writes, to supervisors |
| `components/push/push-toggle.tsx` | The Notifications on/off row in the You sheet (§3) |
| `components/shared/mobile-shell-context.tsx` | Hosts the toggle above Sign out (`CLAUDE_UI.md §59`) |
| `app/picking/push-test/page.tsx` + `push-test-client.tsx` | Diagnostic page (§9) |

---

*CLAUDE_NOTIFICATIONS.md v1.0 · Push Notifications · July 2026*
