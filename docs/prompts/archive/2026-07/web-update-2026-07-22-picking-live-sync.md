# web-update-2026-07-22-picking-live-sync.md
# Session draft · 2026-07-22 · Source: Claude.ai planning chat + 5 Claude Code sessions
# Target on consolidation: CLAUDE_PICKING.md (new section) + CLAUDE_CORE.md (§3 note) + CLAUDE_UI.md (no change)
# Status: SHIPPED to main. Commits adefc030, a8c36566, 258674b5, 7a8fed9f, 7513ed00

---

## 1. What shipped

Picking now live-updates on all three surfaces without any manual refresh, pull-to-refresh
or app restart. Previously every surface fetched once and never again — the acting device
saw its own change, every other device stayed stale until the user closed and reopened the app.

| Surface | File | Refresh path | Marker scope |
|---|---|---|---|
| Supervisor desktop | `components/picking/picking-queue.tsx` | `refetchAfterAction()` | `rolling` + `selectedDate` |
| Supervisor mobile | `components/picking/picking-mobile-shell.tsx` | `refetchQueue()` | `openPending` |
| Picker "My Picks" | `components/picking/picker-my-picks-board.tsx` | `router.refresh()` | `openPending` + `pickerId` |

Poll interval: **15s**, single constant `PICKING_MARKER_POLL_MS` in `lib/hooks/use-picking-marker.ts`.

**Confirmed working on the floor:** supervisor mobile, 2026-07-22 — Support-done and
picker mark-done both appeared without touching the screen.
**Not yet floor-tested:** desktop and picker board (pushed same day, awaiting real order flow).

---

## 2. The design, and why it is NOT a copy of Mail Orders

Mail Orders (`app/(mail-orders)/mail-orders/mail-orders-page.tsx:219-236`) uses a plain
30s `setInterval` + `visibilitychange` that refetches the **entire day's list every tick**,
whether anything changed or not, and **does not pause when the tab is hidden**.

That pattern was rejected for Picking on load grounds:

- Mail Orders has ~2 concurrent users on desktops. Picking has ~3 supervisors + 9-12 pickers,
  mostly on phones.
- `getPickingQueue()` rebuilds and re-runs the **entire `PICKING_SPINE` sort**
  (`lib/picking/sort.ts`) plus ~10 joined relations on every call. A blind 15s poll across
  13 clients would recompute the whole board ~3,100 times an hour, most of it for screens
  nobody is looking at.

**What was built instead — the two-stage check:**

1. Every 15s the client asks a cheap endpoint: *has anything changed?*
   Response is two numbers: `{ count, latest }`.
2. Only when that pair differs from the last seen value does the client fetch the real queue.

Measured (Claude Code, verification session): the marker is **~50-100× cheaper** than a
full `getPickingQueue()` on DB work and ~100-1000× smaller on payload; with the
`updatedAt` index, the gap widens toward ~1000×.

**Net result: polling at 15s is cheaper than what Mail Orders does at 30s today.**

> If Mail Orders is ever revisited for load, this is the pattern to port back to it —
> not the other way round.

---

## 3. Why the marker is TWO numbers, not one

`latest` alone is not sufficient. When a bill is **unassigned or reassigned away** from a
picker, `unassign/route.ts` deletes the `pick_assignments` row. The bill then no longer
matches the picker-scoped `where` at all — so its `updatedAt` is outside the aggregated set
and `MAX(updatedAt)` does not move. The bill would silently stay on his phone.

`COUNT(*)` catches it: his set shrinks from N to N-1.

**Rule: departures are caught by count, in-place changes by latest. Both are load-bearing.**

Verified against all four transitions (assign-to, mark-done, approve, unassign-away) in the
picker-narrowing session. No blind window mid-operation: the two-write order
(`orders.update` then `pick_assignments` delete, per §4) leaves the row still matching with a
freshly bumped `updatedAt` between the writes, so either write order is safe.

---

## 4. Files added / changed

**New:**
- `app/api/picking/marker/route.ts` — `GET /api/picking/marker?scope=…[&date=…][&pickerId=…]`
  → `{ count, latest, scope, pickerId }`. `force-dynamic`, `Cache-Control: no-store`,
  same auth check as the queue route. Param validation mirrors the queue route 1:1
  (unknown scope → 400, `date` + `openPending` → 400, malformed date → 400,
  non-positive-integer `pickerId` → 400).
- `lib/hooks/use-picking-marker.ts` — the shared poll hook (repo convention: hooks live in
  `lib/hooks/`).

**Extracted:**
- `lib/picking/queue.ts` — the inline `where` construction became an exported
  `buildPickingWhere(options)`. `getPickingQueue()` now calls it; return value byte-identical.

**Wired:** the three surface components listed in §1.

**DB:** one index, created in Supabase SQL Editor and hand-mirrored into `schema.prisma`:

```sql
CREATE INDEX IF NOT EXISTS "orders_updatedAt_idx" ON orders ("updatedAt" DESC);
ANALYZE orders;
```
```prisma
@@index([updatedAt(sort: Desc)])   // mirrors orders_updatedAt_idx, created in Supabase
```

---

## 5. Hook contract

```ts
export const PICKING_MARKER_POLL_MS = 15_000;

export function usePickingMarker(opts: {
  scope: "single" | "openPending" | "rolling";
  date?: string;
  pickerId?: number;
  onChange: () => void;
  paused?: boolean;
}): void
```

Behaviour:
- First response is stored as baseline — **never** fires `onChange` on first load.
- Fires `onChange` once per change of `{count, latest}`.
- `visibilitychange → hidden`: clears the interval entirely. `→ visible`: one immediate
  check, then resumes.
- Skips a tick while a previous request is in flight (`inFlightRef`) — no overlapping requests.
- **Fails silently.** No toast, no error UI, no console spam. A blip skips one tick.
- While `paused`, keeps polling and tracking but defers `onChange`; fires once on unpause
  if the marker moved.
- Baseline resets when `[scope, date, pickerId]` change, so stepping the desktop date
  re-baselines instead of firing a spurious change.

---

## 6. Per-surface pause conditions

A background refresh must never move the ground under a user's hand.

| Surface | `paused` resolves to |
|---|---|
| Desktop | `unassigningOrderId !== null \|\| bulkAssigning \|\| chosenPickerId !== null` |
| Supervisor mobile | `detailOpen \|\| overlayBusy` (= `pickerSheetOpen \|\| releaseTarget !== null`) |
| Picker | `detailOpen \|\| marking` |

Notes:
- Desktop has no detail screen or modal; the picker chooser is a native `<select>` whose
  open state a refetch cannot disturb, so `chosenPickerId` ("armed to assign") is the
  correct proxy.
- Supervisor mobile's line-tick / Approve screen lives **inside** the detail overlay
  (`checkedLineIds`/`approving` are its state), so `detailOpen` already covers it —
  it does not need a separate flag.
- Board-local pause state on supervisor mobile (`pickerSheetOpen`, `releaseTarget`) is
  bridged up to the shell via a `setOverlayBusy` context signal — same lift-to-context
  pattern the shell already uses for `detailOpen`. Ownership was deliberately not lifted
  (that state is entangled with the popstate/`navStateRef` machinery).
- View-only filter sheets are deliberately **excluded** from pause — a refresh behind them
  is harmless, and pausing would only starve updates.

---

## 7. Behaviour changed as a side effect: silent background failures

Both supervisor surfaces previously set `error` on a failed refetch, and both render a
full-screen "Couldn't load the picking queue" on `error` — so a single network blip on a
board refreshing every 15s all day would eventually **wipe the board to an error screen**
in front of a supervisor.

`refetchQueue()` (mobile shell) and `refetchAfterAction()` (desktop) now swallow the error
and keep last-good data. The error screen is owned **solely by the initial `load()`**.

This also improved the pre-existing foreground callers: a persisted assign/undo/approve no
longer risks blanking the board on its follow-up refresh.

---

## 8. Landmines and hidden invariants (READ BEFORE TOUCHING PICKING)

**8.1 — `pick_assignments` has no `updatedAt`.**
The marker watches `orders.updatedAt` only. It is a complete proxy **today** solely because
every picking mutation pairs its `pick_assignments` write with an `orders.update`
(assign :131, done :114, approve :73, unassign :58, release :124).

> **Any future assignment-only write — editing a note, a sequence, a picker swap that does
> not touch `orders` — will silently escape the marker and never reach any screen.**
> If such a write is added, either bump `orders.updatedAt` alongside it or add
> `updatedAt @updatedAt` to `pick_assignments` and fold it into the marker.

This is recorded in the marker route's own doc comment as well.

**8.2 — `detailOrderId` on the picker board is never reset to null.**
`setDetailOrderId` is called only in `openDetail` (:158); `closeDetail` flips `detailOpen`
only. Gating anything on `detailOrderId !== null` therefore **pauses forever** after the
picker opens his first bill. Use `detailOpen`. (This was caught during review — the
original instruction specified the wrong flag.)

**8.3 — the picker's refresh is the expensive one.**
`router.refresh()` re-runs the **entire** server page `app/picking/page.tsx`: `auth()` (:57),
`checkAnyPermission` (:64), `getAllPermissionsForRoles` (:68), `buildNavItems` (:69),
`getActivePickers()` (:112), `getISTDayRange` (:137) and `getPickingQueue` (:136) — not
just the queue. This is why the picker marker is narrowed to his own `pickerId`: a
board-wide marker would fire this heavy path on ~10 idle phones for work that never
touches their rows. Do not widen it back.

**8.4 — marker and queue MUST share one filter.**
`buildPickingWhere()` exists so the marker cannot watch a different set than the queue
displays. A marker watching a wider set = harmless extra refetches. A marker watching a
**narrower** set = missed updates on the dispatch floor. Never let the two drift; never
re-declare the filter in the marker.

**8.5 — desktop selection is pruned, not frozen.**
On each background refresh, `selected` is pruned to ids that still exist in the waiting set.
Rejected alternative: pausing the refresh while `selected.size > 0` — a supervisor ticking
10 bills over a minute would blind the control-tower view for that whole minute. Pruning
keeps the "N selected" count honest and stops Assign targeting a now-unassignable bill.

---

## 9. Corrected stale doc (commit 7513ed00)

`CLAUDE_PICKING.md §7` and the `getPickingQueue` JSDoc both still described the
`windows[].count` / `totalCount` miscount as an **open** landmine. It was fixed 2026-07-21
(step 5B): `isStillWaiting` (`queue.ts:508-509`) excludes assigned, done, checked **and**
`zone === "upcoming"` — the fix went beyond what §7 described. Both notes now record it as
`[WAS LANDMINE 2026-07-18 → FIXED 2026-07-21]` rather than being deleted, so the history
survives.

---

## 10. Known-good tuning knobs

- **Interval:** one constant, `PICKING_MARKER_POLL_MS`. 15s was chosen as the balance point,
  not measured. If the floor reports lag, 10s or 5s is a one-line change — the marker is
  cheap enough to absorb it.
- **Index:** only `orders(updatedAt DESC)` was added. `orders` has **no other indexes at all**
  beyond its PK and the `obdNumber` unique — worth a separate look some day, but out of
  scope for this work.
- Not measured on production: live `orders` row count, actual planner behaviour
  (index vs seq scan), and whether any non-picking writer bumps a picking-scoped
  `orders` row often enough to cause harmless false-positive refetches.

---

## 11. Explicitly NOT built this session

- **Push notifications.** No phone buzzes. Live sync only updates a screen someone is
  already looking at. Notifications are a separate arc — device/OS survey, trigger list,
  quiet hours, batching, consent flow, service worker, subscription storage.
- **Supabase Realtime.** Considered and rejected for now: true sub-second push, but a new
  technology in the stack, connection limits, RLS work, and nothing else in Orbit uses it.
  Not worth first-of-its-kind risk on a live dispatch floor when 15s meets the need.
  Revisit only if the floor genuinely needs sub-second.
- **Optimistic mutations.** The acting device already refreshes immediately; not needed.
