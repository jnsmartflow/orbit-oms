# /operations/warehouse and /operations/dispatch — retired 27 July 2026

Superseded by the boards they always were: **`/warehouse`** and **`/planning`**.

*This file is the STORY of one retirement. The METHOD it followed — reusable for the
next page — is in [`../RETIREMENT-PLAYBOOK.md`](../RETIREMENT-PLAYBOOK.md).*

---

## What they were

**Two doors into rooms that already had doors.** Neither page was a screen of its own.
Each was ten lines that checked who you were and then rendered a component belonging to
somewhere else:

| Address | Rendered | Which is also rendered by |
|---|---|---|
| `/operations/warehouse` | `<WarehousePage />` — `components/warehouse/warehouse-page.tsx` | **`/warehouse`** |
| `/operations/dispatch` | `<PlanningPage />` — `components/planning/planning-page.tsx` | **`/planning`** |

**Zero props, no wrapper, no variant** — the component call was byte-identical to the
one on the surviving page. They existed so an `operations` user could reach the
Warehouse and Planning boards from inside the `/operations/*` area of the app.

The only real difference was **how they let you in**, and that turned out to matter —
see the next section.

## Why they went

Nobody used them. Both boards are reachable at their own addresses, and the operations
landing page (`app/(operations)/operations/page.tsx`) sends users to `/floor` anyway.
Keeping two addresses for one screen is the standing tax the playbook describes.

## ⚠ The accepted loss — read this before wondering why operations lost a board

**These two mounts were the `operations` role's ONLY route to both boards.** The owner
accepted losing that, knowingly, on 2026-07-27. Recording it so nobody rediscovers it
as a surprise.

The two mounts and their twins used **different kinds of gate**:

| Address | Gate | Where |
|---|---|---|
| `/operations/warehouse`, `/operations/dispatch` | **role** is `operations` or `admin` | `app/(operations)/operations/layout.tsx:25`, plus an inline check on each page |
| `/warehouse` | permission **`warehouse` canView** | `app/(warehouse)/warehouse/layout.tsx:26` |
| `/planning` | permission **`planning_board` canView** | `app/(planning)/planning/layout.tsx:26` |

A role check and a permission check are not the same thing. `operations` passed the
role check but holds **neither permission**, so with these mounts gone it can no longer
open either board — it gets "not allowed" instead.

**The live permission picture (SELECT 2026-07-27):**

| pageKey | roleSlug | canView | canEdit |
|---|---|---|---|
| `warehouse` | `admin` | true | true |
| `warehouse` | `floor_supervisor` | true | true |
| `warehouse` | `picker` | true | true |
| `planning_board` | `floor_supervisor` | true | true |
| `planning_board` | `dispatcher` | **false** | false |

`operations` appears in neither list. In `prisma/seed.ts` it has exactly two grants —
`picking` and `floor` — so this is not a live-vs-seed drift; it never had them.

**Why the loss was accepted: both boards are themselves scheduled for retirement.**
`/warehouse` (with its two redirect stubs and its board API) is step 6; `/planning`
(with `/dispatcher`) is step 7. Preserving a path to screens that are about to be
archived would have been pointless work. **No new permission was granted to
`operations`** — deliberately.

Note for whoever does steps 6 and 7: **`floor_supervisor` can still reach `/planning`
directly**, and `admin` / `floor_supervisor` / `picker` can still reach `/warehouse`.
Those routes are unaffected by this retirement.

## 🔴 What was NOT archived — and must never be archived with these pages

These pages owned **no component and no API route**. Everything they rendered belongs
to somewhere else and is still live:

| Still live | Why it must stay |
|---|---|
| `components/warehouse/warehouse-page.tsx` | `/warehouse` renders it |
| `components/planning/planning-page.tsx` | `/planning` renders it |
| `app/api/warehouse/*` | feeds `/warehouse`; **`/api/warehouse/pickers` is also called by the live Picking boards** |
| `app/api/planning/*` | feeds `/planning` |
| `app/(operations)/operations/layout.tsx` | **shared** with the three surviving children below |
| `app/(operations)/operations/page.tsx` | redirects to `/floor` |
| `/operations/tinting`, `/operations/tint-operator` | live, unrelated |

**Archive the doors, not the rooms.** Removing the two child folders left the
`(operations)` route group with three children, so the shared layout is still valid and
still reachable.

## What is still in the DATABASE — and why

This commit changed only **code**. No SQL ran with it.

Neither `operations_warehouse` nor `operations_dispatch` was **ever** in
`prisma/seed.ts`. But each had **exactly one live `role_permissions` row** (SELECT
2026-07-27):

| pageKey | roleSlug | canView | canEdit |
|---|---|---|---|
| `operations_warehouse` | `operations` | true | true |
| `operations_dispatch` | `operations` | true | true |

Both were hand-made at some point and existed only in the live database — the same
shape as `operations_support` during the Support retirement. They now point at page
keys the code no longer knows about, so they do nothing at all.

**They are cleared by a separate, reviewed SQL statement AFTER this commit — not in
it.** Deleting rows from a live database is not something to bundle into a file move.

## When, and which commit

| Step | Commit | What it did |
|---|---|---|
| — | *(discovery)* | `docs/prompts/drafts/code-discovery-2026-07-27-page-retirement-sweep.md` §2/§3 |
| 1 | *(this commit)* | Moved both page files here; removed the two page keys from `lib/permissions.ts` (union, `ALL_PAGE_KEYS`, `PAGE_NAV_MAP`) and their two icons from `components/shared/role-sidebar.tsx` |
| 2 | *(SQL, separate)* | Clear the two orphaned `role_permissions` rows |

## Nothing in this folder runs

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is listed
in `tsconfig.json`'s exclude list, so the type-checker skips it and Next.js never builds
it. No web address leads to it.

## Honest note on reinstating this

Moving these two files back would compile — they import only `auth`, `redirect` and a
component, and all three still exist.

**But it would not give you what you think.** The two page keys are gone from
`lib/permissions.ts`, so the nav entries that pointed at these addresses no longer
exist; the pages would be reachable only by typing the URL. And the boards they render
are themselves being retired in steps 6 and 7 — restoring a door to a room that is
about to be demolished.

**If an `operations` user genuinely needs the Warehouse or Planning board, grant the
`warehouse` or `planning_board` permission instead.** That is one database row and it
works with the surviving addresses.
