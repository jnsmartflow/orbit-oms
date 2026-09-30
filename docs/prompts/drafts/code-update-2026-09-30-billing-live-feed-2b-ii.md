# Code update — 2026-09-30 — live feed billing 2b-ii: the Billing desk on the change feed (client)

**Commit:** the single commit on `main` titled *"live feed billing 2b-ii: Billing desk on the change feed (behind live.feed.billing, default off)"* (`git log --grep "billing 2b-ii"`).
**Plan:** `docs/prompts/drafts/code-plan-2026-09-30-billing-live-feed.md` §D ("Client — the smallest diff"), §E, decisions 5, 8, 9, 10. Server side: 2b-i (`4183f494`). Pick delete bounded: `29ae80a7`.
**Switch:** Billing is on the feed only when `app_settings 'live.feed'` AND `'live.feed.billing'` are ON. `live.feed.billing` stays absent (OFF). **Prerequisite for turning it on: the 2b-i SQL applied** (`sql/2026-09-30-live-changes-billing.sql` + TEST) — without it, mail-order and tag changes never reach the feed.
**No server predicate change, no DB, no Floor / Picking / Tint edit.**

## What shipped
| File | Change |
|---|---|
| `components/billing/billing-live.tsx` (new) | `BillingLiveRoot` — ONE `useLiveFeed` (`screen=billing`, topics `order,trip,config,mail_order,so_tag`, hint `orbit.live.billing`), mounted by the page ABOVE the `!loading` gate. Per glance with changes: ONE `POST /api/billing/sync` (changed ids + `shown`); fires each touched arm's subscribers through the providers' registered handles; merges counts; a `mail_order` change → `loadOrders()` at most once per glance, held while `ordersPaused()`; a full-work reason (reset / backlog / > 1000 ids / config / lag / 3 failed syncs) → re-read the four markers + fire every arm + reload Orders; `start` / `switch-on` → counts only (the page is already fresh). Hooks: `useBillingLiveMode`, `useBillingLiveCounts`, `useBillingShownIds`, `useBillingLiveTick` (no-network 30 s re-render, live only). |
| `lib/billing/live-rule.ts` (pure) + `.test.ts` (7 tests, `npm run test:billing-live`) | sync body from a feed patch, too-many rule, arms to fire, counts merge, the initial marker reads, marker count parse, `PausedFire` (fire now / once on release). |
| `components/billing/billing-marker-provider.tsx` | The provider keeps its context and pause keys in BOTH modes. Its `usePickingMarker` call moved, unchanged, into a child `<MarkerPoll>` rendered only when NOT live (a sibling before `children`, so toggling never remounts the tabs). New: `arm` prop; registers a handle with the root (`requestFire` honours the pause — held changes fire once on release; `setValue` publishes the pick-delete count to the popup's value context). |
| `components/billing/billing-tab-bar.tsx` | While live: pills show the root's counts; the three count fetches return early (no marker call). Leaving live: re-reads each count once (the legacy polls only take a silent baseline). Off: unchanged. |
| `components/billing/billing-pick-delete-popup.tsx` | While live: the focus check is skipped (the feed glances on focus); Import finished → `glanceNow("import-done")` instead of a marker call. Mount check and History-Undo check unchanged. |
| `billing-picking-tab.tsx` (+ live tick), `billing-print-tab.tsx`, `billing-pick-delete-queue.tsx` | `useBillingShownIds(…)` — the ids on screen (no-op off the feed). |
| `app/(mail-orders)/mail-orders/mail-orders-page.tsx` | `<BillingLiveRoot>` around the gate; the Orders-tab `usePickingMarker` moved unchanged into `<LegacyOrdersMarker>`, rendered when not live; `ordersPaused` (plan §E); `billingLive` state (initialised from the hint so the marker does not start and stop at once). |
| `lib/live/feed-core.ts` (+3 tests) | Additive: entities beyond order/trip/config accumulate in `extra` and ride the patch — **present only when non-empty, so Floor's work objects and its 23 existing tests are unchanged**; `requeue(…, extra?)`; public `glanceNow(why)`. |
| `lib/live/use-live-feed.ts` | Optional `screen` → `?screen=` (Floor passes none → identical URL); `onChanges` type carries `extra`. |
| `package.json` | `test:billing-live` |

## How the OFF path stays what it was (same method as Floor 7b)
1. **The legacy polls are the same calls with the same arguments**, moved into child components: each provider's `usePickingMarker` → `<MarkerPoll>`; the Orders marker → `<LegacyOrdersMarker>`. They are rendered whenever the feed is not live — always on the non-billing face (the root is a pass-through there), and on the billing face while the feed is off / unknown on a browser that never saw it on / in fallback.
2. **The providers' contexts, subscribe and pause keys are unchanged**; the live handle only calls the same `fireSubscribers` the poll's `onChange` calls, and its pending flag is never set off the feed.
3. **Tab bar / popup**: every new branch is gated on the root's `live` flag, which is false off the feed (and absent on the non-billing face).
4. **What OFF does add on the billing face (honest list):** one `GET /api/live/changes?screen=billing` at open and one every 60 s ± jitter (answers `{enabled:false}` from the 30 s-cached switches); the feed's passive input / visibility / focus listeners; the polls now start one component level down (same commit, microseconds apart).

## What Billing does when ON
1. One adaptive glance (15 s active / 60 s idle, instant on input-after-idle / visible / focus ≤ 1 per 3 s, nothing while hidden, backoff) replaces the five timers and the focus probe.
2. At start it reads the four markers once for the pills; after that counts come only from sync answers.
3. Each glance with changes makes one `POST /api/billing/sync`; touched tabs re-read their lists (unless held), their pills update, the popup gets the pick-delete count.
4. A mail-order change reloads the Orders list once — held while typing, smart-copying, a popover / panel or any dialog is open.
5. Nothing reloads under a selection, a copy, a typed tag or a pick-delete decision — held changes apply once on release.
6. Switch off (or errors) → the old polls come back without a reload; switch on → back to live within ~60 s.

## Changes from the plan
1. **`shown` is reported by Picking, Print and the pick-delete queue only.** Telephonic's rows are tags (their bills' changes are caught by the `so_tag_matches` rule) and History lists decisions, not open groups; the 2b-i rules do not depend on `shown`.
2. **The queue is fired like today** when pick-delete is touched (it keeps its cursor on the group on screen; held while a decision / confirmation is up). Decision 9's "only N left moves" holds for the popup chrome; a group decided elsewhere still refreshes, as today.
3. **"Live" includes "unknown with the hint on"**, Floor's start-up rule, so the legacy polls do not start and stop within the first second on a browser that saw the feed on.
4. **Orders holds use what the page can see** (focused field, any `role="dialog"` / `aria-modal`, smart copy, code popover, SKU panel) with a 2 s no-network re-check — `review-view.tsx` (shared with the non-billing face) is not edited.
5. **Render tick:** the Picking tab's "Xm ago" column needed one — a no-network 30 s tick, live only.
6. **No midnight reload** — the page signs out at IST midnight (`mail-orders-page.tsx`).

## Checks
`npx tsc --noEmit` clean · `npm run build` exit 0 (`/mail-orders` 68.8 kB) · unit: load-plan 12, access-notebook 23, live 22, live-client 26 (+3), floor-live 13, pick-delete 4, billing-sync 6, billing-live 7 (new), load-plan-check + v2 55 — all pass.

## Rollback
Switch: `UPDATE app_settings SET "isEnabled"=false,"updatedAt"=now() WHERE "settingKey"='live.feed.billing';` → every open Billing desk returns to its polls at its next glance (≤ ~45 s active / ~90 s idle incl. the 30 s switch cache), no reload. Code: `git revert <hash>`.
