# CLAUDE_NOTIFICATIONS.md — Push Notifications
# v1.4 · Schema v27.24 · September 2026 · updated 2026-09-18
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
supervisors' phones buzz; a supervisor cancels a bill → the picker holding it buzzes. Each person controls it with an on/off switch in the mobile avatar menu (§3).

**Event-driven only** — every notification fires *inside the existing API route the moment the action
happens*. No scheduled job, no polling, no infrastructure dependency for the three live triggers.

---

## 2. Triggers [LIVE]

Three, all fired from picking write routes (no new `orders.update` — see the marker landmine, §8).
**Caller sweep 2026-09-18: `sendToUser` has exactly four callers** — the three trigger routes below
(`assign/route.ts:208`, `done/route.ts:177`, `cancel/route.ts:266`) + the `test-saved` diagnostic.
Nothing else calls it: not the approve route, not any Floor route (Floor's own cancel,
`/api/floor/actions`, does NOT push — only `/api/picking/cancel` does), not the Billing mark-done.
⚠ A caller sweep on `sendToUser` alone misses one more sending path: `POST /api/picking/push-test`
calls `web-push`'s `sendNotification` directly (§9). **Floor DOES fire the assign trigger
indirectly** — its detail panel's reassign (`onReassign`, `components/floor/floor-page.tsx:1241-1251`)
calls the same `POST /api/picking/assign` (the trigger is route-level, caller-agnostic), so an assign
from `/floor` buzzes the picker exactly like one from the supervisor board.

| Trigger | Fires from | Recipient(s) | Text | Verified? |
|---|---|---|---|---|
| **Assign a bill** | `app/api/picking/assign/route.ts` (after both writes per bill) | that **picker** (`pickerId`) | `New pick assigned` / `{customer} · {obdNumber}` | not yet on device (§6) |
| **Mark a pick done** | `app/api/picking/done/route.ts` (after the writes) | **all supervisors** (`getPickingSupervisorUserIds()`) | `Pick completed` / `{picker} finished {customer} · {obdNumber}` | ✅ on device |
| **Cancel a bill** | `app/api/picking/cancel/route.ts` (after the writes; 00d7da22 / af075572, 2026-08-20) | the **picker holding the bill** (`pickAssignment.pickerId`); skipped when nobody held it | `Bill cancelled` / `{customer} · {obdNumber} — stop picking this bill` | not recorded on device |

- **Customer** = the effective dealer, same fallback chain in all three bodies:
  `shipToOverrideCustomer?.customerName ?? customer?.customerName ?? shipToCustomerName ?? "(Unmatched)"`
  (`assign/route.ts:203-207`, `done/route.ts:169-173`, `cancel/route.ts:261-265`). No data-quality
  marker in a push body (`assign/route.ts:201`). **Bill number** = `orders.obdNumber`. Assign is **one notification per bill** (its own tag), never batched.
- **The one rule that matters — a push must NEVER break the action it hangs off.** All three triggers are
  fully wrapped in try/catch and swallowed (log only); the API response body + status are
  **byte-identical** whether push succeeds, fails, or is skipped. Any future trigger must do the same.
- **Response timing:** all three `await` before responding (Vercel freezes the function once it returns, so
  un-awaited pushes are unreliable). Assign sends in parallel (`Promise.allSettled`); done sends
  **sequentially** over the small supervisor list; cancel sends one.

**Self-suppression rule [LIVE] — never notify the person who performed the action.** The actor
(`session.user.id` → `changedById`/`assignedById`) is skipped: assign skips when the assigner *is* the
picker; done skips the acting user from the supervisor recipient list; cancel skips when the
cancelling supervisor is the picker holding the bill (`heldByPickerId !== changedById`,
`cancel/route.ts:259`). Nobody is ever notified about
their own tap.

**Quiet hours — REMOVED 2026-08-12. There is NO time-of-day gate.** Every trigger sends **at any
hour**, every day. Until 2026-08-12 both gated on `isWithinDepotHours(new Date())` (09:00–20:00 IST,
`lib/push/quiet-hours.ts`), dropping anything outside the window; that check, its two call sites and
the whole file are **gone** — the file was deleted once the grep showed nothing else referenced it.
Do not reintroduce a time gate without being asked, and do not "restore" the constants
`DEPOT_HOURS_START_IST` / `DEPOT_HOURS_END_IST` — they no longer exist anywhere in the repo.
⚠ The IST-vs-UTC reasoning that made that check correct is still worth reading before writing **any**
new time-of-day rule on the server — it survives as landmine 4 (§8).

---

## 3. The user toggle [LIVE]

A single **"Notifications"** on/off row directly **above Sign out** in the **"You" sheet** that the
mobile header avatar opens (`components/push/push-toggle.tsx`, mounted in
`components/shared/mobile-shell-context.tsx`). Two taps to reach, a third to toggle. The sheet mechanics
are the shared mobile shell — see **`CLAUDE_UI.md §59`** (and §62 for the toggle's single-accent styling — `bg-brand-600`, `push-toggle.tsx:156`, violet since c96157ea);
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
  **`CLAUDE_CORE.md §7.12`** (schema-verified against live 2026-08-04 in the CORE pass — 11 cols,
  `endpoint` UNIQUE, the plain-`@default(now())` `updatedAt`), not restated here.
- **Subscribe** (`app/api/push/subscribe/route.ts`): **`userId` comes from the SESSION only, never the
  request body** (otherwise one user could register a phone against another's account). Upserts on the
  `endpoint` unique index; if the endpoint already exists under a DIFFERENT user (a shared phone), it
  **reassigns to the current session user** so the previous owner stops receiving on that device.
- **Multi-device reality:** one user → many endpoints (phone + tablet + reinstall). `sendToUser(userId, …)`
  (`lib/push/send.ts`) loads **all `isActive` rows for that user** and sends to each, sequentially.
- **`urgency: "high"` on every send** (`lib/push/send.ts:78-87`, 1448c7e6, 2026-08-14) — the options
  argument to `sendNotification`, asking the push service to deliver now rather than batch behind the
  phone's power saving (the budget-Android problem, landmine 9). A delivery hint only: payload, hygiene
  and error swallowing are unchanged.
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
the working done-trigger. **The blocker has since changed shape** (updated 2026-08-04): real picker
test accounts now EXIST (ids 35/36, active — `CLAUDE_PICKING.md §7`), and the 2026-07-29 first-login
test plan's Round 4 covers exactly this check — but **no result was ever recorded**, so it stays
untested until Smart Flow runs it (or reports it ran).

---

## 7. Deferred / not built [DEFERRED]

**Supervisor "N picks waiting" reminder** — every ~10 minutes, if the count of picks-waiting changed
since the last buzz, notify the supervisor `8 picks waiting · oldest 25 min`. **Not built.**

**Why it is NOT a Vercel cron (state clearly so nobody re-tries one):** it is not event-driven —
something must wake up on its own, count the board, and decide. **Vercel Hobby crons run only ONCE PER
DAY** — any more-frequent expression **fails at deployment**. The binding constraint is **CADENCE, not
count**: the per-project job COUNT cap was lifted to 100 on all plans in **January 2026**, so the old
`CLAUDE_CORE.md §4` "2 cron / Hobby cap" wording WAS stale — corrected there 2026-07-22; the "correct it in step 4" note that sat here is done (2026-08-04) — freeing an
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

1. **[LANDMINE] A caching service worker would silently break live sync.** `lib/hooks/use-picking-marker.ts`
   polls `/api/picking/marker` every 15s and depends on `Cache-Control: no-store` freshness. The same
   hook now also polls other boards' markers (callers: `components/floor/floor-page.tsx:1372`,
   `components/billing/billing-marker-provider.tsx:129`, `components/ci/billing-board.tsx:156`,
   `components/mrn/mrn-shell.tsx:263`, `components/tint/manager/use-tint-manager-sync.ts:56`,
   `app/(mail-orders)/mail-orders/mail-orders-page.tsx:366`), so the rule protects all of them. `sw.js`
   has **zero fetch listeners and zero Cache-API calls** — keep it that way. Never add caching.
2. **[LANDMINE] Never add a second `orders.update` in a notification trigger.** The live-sync marker
   keys on `MAX(orders.updatedAt)`; an extra write fires a false change on every board. (This is why
   every trigger only READS for names.)
3. **[LANDMINE] `push_subscriptions.updatedAt` has a DB default but NO trigger.** It is a plain
   `@default(now())`, **NOT `@updatedAt`**. Every write must set `updatedAt: new Date()` explicitly, or
   updates carry a stale timestamp.
4. **[LANDMINE] Vercel is UTC; the depot is IST (UTC+5:30).** A naive `getHours()` check would read
   the UTC hour — silencing the real working day and firing at night. This bit the quiet-hours gate,
   which computed in Asia/Kolkata to avoid it. ⚠ **That gate and its file were removed 2026-08-12**
   (§2), so there is no longer any implementation here to copy — but **the hazard is unchanged** and
   applies to the next server-side time-of-day rule anyone writes (e.g. the deferred supervisor timer,
   §7). Shift the instant by the IST offset and read the hour off that; IST has no DST, so it is exact
   year-round. Related and still live: CORE §3's `Date.parse()` offset-less-string landmine.
5. **[LANDMINE] Push must never break the action it hangs off.** All three triggers swallow all errors; any
   future trigger must too (§2).
6. **[LANDMINE] Counts are derivable by READING `buildPickingWhere()` — never modify it.** "Ready to
   check" = rows where `isDone`. For "waiting to assign", `getPickingQueue()` no longer hands you a
   number: its payload is `PickingQueueResult` (`lib/picking/queue.ts:255`), documented in
   `CLAUDE_PICKING.md` and not restated here; the four aggregate counters it used to carry
   (`windows[]`/`totalCount`/`unmatchedCount`/`assignedCount`) plus the `isStillWaiting` predicate
   were removed on 2026-07-28 with the Picking desktop board, their only consumer.
   **The rule itself was deliberately preserved, verbatim, as a tombstone comment above
   `PickingQueueResult` in `lib/picking/queue.ts` — read it there and count off `rows`.** It is not
   restated here, and it is worth reading rather than guessing: it excludes future-dated rows, which
   is the non-obvious part. The marker route shows the AND-merge pattern. (For the future supervisor
   timer.)
7. **[LANDMINE] Cron routes authenticate via `lib/cron-auth.ts`** — `Authorization: Bearer
   ${CRON_SECRET}`, **fail-closed** when the env var is unset. The future timer route MUST reuse
   `isCronAuthorized`, or it is an open public endpoint.
8. ✅ **RESOLVED — manifest name.** `public/manifest.json` `name` and `short_name` are both `"Orbit"`
   (4a2f763f, 2026-08-12); `theme_color` is `#7C3AED` (740a9a21, rebrand 2026-09-09).
9. **[LANDMINE] iOS install is mandatory; budget hand-holding.** No home-screen install → no push,
   ever. Indian budget Androids (Xiaomi/Vivo/Oppo/Realme) aggressively kill background notifications —
   expect per-device battery-saver exceptions during rollout. **Keep the push-test page** — it's the
   fastest way to answer "why isn't this picker getting alerts" (shows installed? allowed? buzz
   reaches?).

---

## 9. Temporary scaffolding [DEFERRED — remove after rollout]

Only the mobile link carries a `⚠ TEMPORARY SCAFFOLDING` comment in code
(`picking-mobile-shell.tsx:227`); the page says "Throwaway test" on screen (`push-test-client.tsx:179`)
and its API route calls itself a "THROWAWAY proof" (`app/api/picking/push-test/route.ts:9`):
- `app/picking/push-test/page.tsx` — the diagnostic page (subscribe state, saved-device count, "Send to
  saved phone"). Earns its place during rollout.
- `POST /api/picking/push-test` (`app/api/picking/push-test/route.ts`, 7f041c95) — called by
  `push-test-client.tsx:155`. Gated picking `canView`; sends one push to the subscription **in the
  request body** via `web-push`'s `sendNotification` directly, **not** `sendToUser`; stores nothing and
  surfaces errors verbatim. The one sending path a `sendToUser` caller sweep does not see (§2).
- The **"Push test (temporary)"** link in `picking-mobile-shell.tsx` (`:233-241`) — **mobile-only**,
  shown to **admin OR operations** (`canSeePushTest`, `app/picking/page.tsx:73`; the shell's own
  comment at `:228` still says "Admin-only" and is stale). It is also the ONLY way to reach
  `/picking/push-test` from an installed PWA (manifest `start_url` is `/`). ⚠ The old DESKTOP pill this section used to
  describe went with the desktop board (archived 2026-07-28) — only this mobile link survives.

---

## 10. Key files index

| File | Role |
|---|---|
| `public/sw.js` | Service worker — `push` + `notificationclick` ONLY; no fetch, no cache |
| `lib/push/send.ts` | `sendToUser(userId, payload)` + `getVapid()`; dead-endpoint hygiene; never throws |
| `lib/push/recipients.ts` | `getPickingSupervisorUserIds()` — `PICKING_SUPERVISOR_ROLE_SLUGS = ["floor_supervisor","operations","admin"]`, matches PRIMARY role AND any secondary `user_roles` row, **`isActive` users only**, one sequential query (verified 2026-08-04) |
| `app/api/push/subscribe/route.ts` | Upsert on endpoint; `userId` from session; reassigns a shared phone |
| `app/api/push/unsubscribe/route.ts` | `isActive=false` for one endpoint, session-scoped |
| `app/api/push/test-saved/route.ts` | Sends to the session user's saved devices (diagnostic) |
| `app/api/picking/assign/route.ts` | Assign trigger (§2) — after both writes, per bill |
| `app/api/picking/done/route.ts` | Done trigger (§2) — after the writes, to supervisors |
| `app/api/picking/cancel/route.ts` | Cancel trigger (§2) — after the writes, to the picker holding the bill |
| `app/api/picking/push-test/route.ts` | Throwaway proof endpoint — direct `sendNotification`, body-supplied subscription (§9) |
| `components/push/push-toggle.tsx` | The Notifications on/off row in the You sheet (§3) |
| `components/shared/mobile-shell-context.tsx` | Hosts the toggle above Sign out (`CLAUDE_UI.md §59`) |
| `app/picking/push-test/page.tsx` + `push-test-client.tsx` | Diagnostic page (§9) |

---

## Change log — v1.4 (2026-09-18, canon sweep reconciliation)

- §1/§2: **three triggers, four `sendToUser` callers** — "Bill cancelled" (`app/api/picking/cancel/route.ts`, 00d7da22/af075572) added to the trigger table: held-by picker, self-cancel skipped, awaited + swallowed, no `orders` write; Floor's own cancel does not push. Dealer fallback chain now includes `shipToCustomerName → "(Unmatched)"` in all three bodies. Floor's assign path re-pointed to the detail panel's `onReassign`.
- §3: toggle styling cited as `bg-brand-600` (violet) instead of "one-teal".
- §4: `urgency: "high"` on every send (1448c7e6).
- §8: landmine 1 lists the other marker callers of the shared hook; landmine 6 points at `PickingQueueResult` / `CLAUDE_PICKING.md` instead of restating the payload; landmine 8 (manifest name) RESOLVED (4a2f763f; theme `#7C3AED`, 740a9a21).
- §9/§10: `POST /api/picking/push-test` recorded (direct `sendNotification`, the fifth sending path); push-test link visible to admin OR operations (`app/picking/page.tsx:73`); scaffolding-comment claim corrected (only the mobile link carries one); cancel + push-test routes added to the key-files index.
- Schema stamp v27.13 → v27.24 — reconciled against CORE v27.24 in this pass (no table this module owns changed).

## Change log — v1.3 (2026-08-12, quiet-hours removal)

- NTF-7 (§2): **quiet hours REMOVED.** The 09:00–20:00 IST gate is gone from both triggers — assign and done now send at any hour. Grep first confirmed §2's caller claim was CORRECT (only those two routes ever called it); `lib/push/quiet-hours.ts` was therefore unreferenced and **deleted** (`git rm`), taking `isWithinDepotHours` + `DEPOT_HOURS_START_IST`/`_END_IST` with it. Self-suppression, the try/catch swallow, and await-before-respond are **untouched** in both routes.
- NTF-8 (§8 landmine 4): rewritten — it pointed at the now-deleted file. The IST-vs-UTC hazard is restated as a rule for the NEXT server-side time rule (e.g. §7's deferred timer) rather than as a description of live code.
- NTF-9 (§10): `lib/push/quiet-hours.ts` row dropped from the key-files index.
- ⚠ Left deliberately: §7's deferred supervisor timer still lists "quiet hours" among the work its future route would do. That is unbuilt design, not live code — whoever builds it decides whether a time gate comes back.

## Change log — v1.2 (2026-08-04 reconciliation pass, method v1.1)

- NTF-1 (§2): caller sweep — `sendToUser` has exactly 3 callers (assign, done, test-saved); Floor fires the assign trigger via the shared route; Billing mark-done pushes nothing. Trigger table verified CORRECT.
- NTF-2 (§6): the assign-notification blocker restated — picker test accounts exist (ids 35/36); the 07-29 test plan covers it; result unrecorded.
- NTF-3 (§7): the "correct CORE §4 in step 4" parenthetical resolved (done 2026-07-22).
- NTF-4 (§9): scaffolding list corrected — the desktop pill went with the archived board; the surviving mobile link is admin-only per its own comment.
- NTF-5 (§4/§10): `push_subscriptions` cited to CORE §7.12 (live-verified); recipients row states slugs + isActive + primary/secondary precisely.
- NTF-6 (footer): form drift fixed — footer now carries the schema stamp + date like the header.
- Verified CORRECT, no change: quiet-hours constants (9/20 IST), self-suppression, toggle contract, dead-endpoint hygiene, VAPID env set, all 9 landmines.

- Schema stamp -> v27.13 (final-pass 12b, 2026-08-05).

---

*CLAUDE_NOTIFICATIONS.md v1.4 · Schema v27.24 · Push Notifications · OrbitOMS · updated 2026-09-18*
