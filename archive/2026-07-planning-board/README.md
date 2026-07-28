# The Planning board — retired 28 July 2026

**No successor.** This board was removed, not replaced.

*This file is the STORY of one retirement. The METHOD it followed — reusable for the
next screen — is in [`../RETIREMENT-PLAYBOOK.md`](../RETIREMENT-PLAYBOOK.md).*

---

## 🔴 READ THIS FIRST — THE FILE THAT DID **NOT** MOVE

**`app/api/warehouse/pickers/route.ts` WAS NOT ARCHIVED. IT IS LIVE.**

It has a warehouse name, but it belongs to **Picking**. The live Picking boards call it
for the Assign picker list:

- `components/picking/picking-board-mobile.tsx:936`
- `components/picking/picking-queue.tsx:686`

After this commit, **`app/api/warehouse/` contains that one route and nothing else**.

> ### ⚠ NEVER ARCHIVE `app/api/warehouse/` AS A FOLDER.
> It looks empty of purpose. It is not. Move named files only.

---

## What it was

The **dispatch planning screen** — and the only screen in this whole family that could
**create** something rather than merely display it. Its API could build a dispatch plan,
add orders to it, assign a vehicle, mark loading complete, and remove an order again:
eight routes, a real write surface.

The idea: once bills were picked, a planner would group them into vehicle trips here and
send them out. It had a trips panel, an unassigned panel, customer cards, slot bars and
a detail panel — a complete, carefully-built screen.

It lived at `/planning`, with a second address `/dispatcher` that was a four-line stub
doing `redirect("/planning")`.

## Why it went

**It was never used end to end.** The workflow that would feed it was never finished, so
the plans it could create were never part of a live process. The owner chose to clear it
now and rebuild properly later if the need returns, rather than keep a half-built write
surface alive against a workflow that does not exist yet.

## 🔴 THE DATA NOTE — read this before believing any older document

The board's default query filtered `workflowStage = 'dispatch_confirmation'`
(`app/api/planning/board/route.ts:30`). **Live count of that stage: 0.** Nothing in the
codebase has ever written it. So the board rendered an empty frame, every time.

Its API *did* have a second branch. `showDispatched=true` widened the filter to
`['dispatch_confirmation', 'dispatched']` (`board/route.ts:28-29`), and there are
**1,546 orders at `'dispatched'`** (SELECT 2026-07-27). That looks like a window onto
real data.

**It never was one.** `showDispatched` appears in exactly three places, all inside that
one route file. **No client code ever set it** — `components/planning/planning-page.tsx:137`
fetched `/api/planning/board?date=${d}` and nothing else. A repo-wide sweep of every
`.tsx` found no caller. The branch was **capability, never reachability**.

> ⚠ **An earlier discovery draft claimed the opposite** — that "Planning is NOT always
> empty" because its history view reads `'dispatched'`. That was **wrong**, and it was
> wrong in an instructive way: it checked what the API *could* do and never checked
> whether any screen *asked*. Recorded here so a future session does not rediscover the
> false version and reverse this decision on it. **Capability is not reachability.**

### The 1,546 rows are UNTOUCHED

They remain in the `orders` table. Nothing in this retirement reads, writes or deletes a
single row — only screens were archived.

**They are, however, currently invisible in every screen in the app.** Verified
2026-07-28 across `/floor`, `/picking`, `/trips`, Tint Manager, Tint Summary, the admin
dashboard and Mail Orders: every order-listing surface either filters to stages that stop
at `pick_checked`, or reads a different table entirely. The three surfaces with no stage
filter reach them only by accident — Hidden Orders (only if hidden), Removed Orders (only
if removed), and the order-detail panel (only if something links to it, and nothing does).

**This predates the retirement and is not caused by it.** `/planning` was not showing
them either.

**Stated intention:** the owner intends to build a proper lookup for these as a **report
feature**, once the workflow is complete end to end. It is parked deliberately, not
forgotten. (The ROADMAP entry is written separately.)

Related and still open: **~500 rows moved into `'dispatched'` between 2026-07-24 (1,051)
and 2026-07-27 (1,546), by a route nobody has explained.** Nothing in this codebase
automatically drains `pick_checked → dispatched`. That question is owned by ROADMAP's
drain item and was **not** investigated here.

## What moved here

```
app/(planning)/                        the whole route group — nothing else lived in it
  planning/layout.tsx                  the permission gate (planning_board canView)
  planning/page.tsx
app/(dispatcher)/dispatcher/page.tsx   the 4-line redirect stub — ONLY this file
app/api/planning/                      all 8 routes
components/planning/                   all 10 files
lib/slot-cascade.ts                    see below
lib/day-boundary.ts                    see below
app/api/warehouse/assign/route.ts      see below
```

### Why the two libs came along

`lib/slot-cascade.ts` and `lib/day-boundary.ts` had exactly two importers:
`app/api/planning/board/route.ts` and `app/api/warehouse/board/route.ts`. The second went
in step 6; the first goes here. **Zero importers remain**, so they came with it.

Note they had already been **dormant for a long time**: every call to them was commented
out, headed `// DISABLED: slot cascade removed — slots are fixed by obdEmailTime`. They
were imported but never called — a distinction that cost an earlier session a wrong entry
in the canon. Archiving them changes no behaviour whatsoever.

### Why the assign route came along

`app/api/warehouse/assign/route.ts` lost its only caller in step 6 (the archived Warehouse
board). It has had **zero callers since**, so it was archived here rather than left as
dead code in a live folder.

## 🔴 What did NOT move, and must not be confused with what did

| Stayed live | Why |
|---|---|
| `app/api/warehouse/pickers/route.ts` | see the top of this file |
| `app/(dispatcher)/layout.tsx` | shared with four surviving pages |
| `/dispatcher/customers`, `/dispatcher/skus`, `/dispatcher/routes`, `/dispatcher/vehicles` | **unaffected** — they gate on their own page keys (`customers`, `routes_areas`, `skus`, `vehicles`), never on `dispatcher` |
| `lib/slot-history.ts` | separately orphaned already; **not in scope**, deliberately untouched |
| `components/shared/carried-over-badge.tsx`, `cascade-badge.tsx` | `cascade-badge` is still used by `components/shared/order-detail-panel.tsx`; `carried-over-badge` is now unused but was not in scope |
| `/picking`, `/floor`, `/po`, `/place-order`, `/trips`, `/tint/*` | untouched |

⚠ **The `dispatcher` ROLE and the `dispatcher` PAGE KEY are different things that share a
word.** Only the page key was removed. The role still exists in `role_master`, still has
its other grants, and its four master-data pages still work.

⚠ **Planning had its own parallel set of similarly-named components** — e.g.
`components/planning/unassigned-panel.tsx` alongside a different
`components/warehouse/unassigned-panel.tsx`. Every import path was resolved before moving,
because a name that *looks* shared is not shared.

## What is still in the DATABASE

This commit changed only **code**. No SQL ran with it.

Live `role_permissions` rows now pointing at page keys the code no longer knows:

| pageKey | live rows |
|---|---|
| `dispatcher` | **7** — admin (canView+canEdit), floor_supervisor (canView); dispatcher, picker, support, tint_manager, tint_operator all false |
| `planning_board` | **2** — floor_supervisor (canView+canEdit), dispatcher (both false) |

**They are cleared by a separate, reviewed SQL statement AFTER this commit — not in it.**

Seed differed from live, as it usually does: `prisma/seed.ts` held **one** `dispatcher`
page-key row (`dispatcher` role) and **zero** `planning_board` rows. The one row was
removed in this commit; the other five `roleSlug: "dispatcher"` rows are the *role*
granting other pages and were left alone.

## Nothing in this folder runs

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is in
`tsconfig.json`'s exclude list, so the type-checker skips it and Next.js never builds it.

## Honest note on reinstating this

The files would compile if moved back, and the board would render — empty, as it always
did. Restoring it means also restoring two page keys, their nav entries, their sidebar
icons, the seed row and the permission grants.

**And it still would not show anything**, because `dispatch_confirmation` is still never
written and no client sets `showDispatched`.

**If dispatch planning is needed again, build it against the stages that are actually
live** (`pick_checked` and beyond) — and give the 1,546 `dispatched` bills a real report
while you are there. Do not revive this folder; it is a design that was never connected.
