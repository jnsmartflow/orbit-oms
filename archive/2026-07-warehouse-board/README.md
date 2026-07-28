# The Warehouse board — retired 28 July 2026

**No successor.** This board was removed, not replaced.

*This file is the STORY of one retirement. The METHOD it followed — reusable for the
next screen — is in [`../RETIREMENT-PLAYBOOK.md`](../RETIREMENT-PLAYBOOK.md).*

---

## 🔴 READ THIS FIRST — THE FILE THAT DID **NOT** MOVE

**`app/api/warehouse/pickers/route.ts` WAS NOT ARCHIVED. IT IS LIVE.**

It has a warehouse name and it lives in a warehouse folder, but it belongs to
**Picking**. The live Picking boards call it to fetch the picker list for Assign:

- `components/picking/picking-board-mobile.tsx:936`
- `components/picking/picking-queue.tsx:686`

**Archiving it breaks the Picking board on the floor team's phones.**

> ### ⚠ NEVER ARCHIVE `app/api/warehouse/` AS A FOLDER.
> Move named files only. The folder still holds live code.

`app/api/warehouse/assign/route.ts` also stayed — see "Left behind on purpose" below.

---

## What it was

The **original post-picking dispatch board**. The design: once a bill had been picked,
it would appear here so the warehouse could group it by picker, mark it done, and hand
it to a vehicle. It had a picker-lane layout, unassigned/assigned panels, slot tabs and
delivery-type tabs — a complete screen, carefully built.

It lived at `/warehouse`, with two extra addresses that were only redirect stubs:
`/warehouse/supervisor` and `/warehouse/picker`, both four lines long, both forwarding
to `/warehouse`.

## Why it went — it never worked, and could not have

The board fetched orders at `workflowStage = 'dispatch_confirmation'`
(`app/api/warehouse/board/route.ts:76`, a read filter inside `findMany`).

**Nothing in this codebase has ever written that stage.** Verified again on 2026-07-28
before archiving: a repo-wide search finds no `prisma.orders.update`, `updateMany` or
`create` that sets it. The live count of orders at `dispatch_confirmation` is **0**.

So the board opened, drew its frame, and showed nothing — every time, for everyone,
since it was built. The step that would have filled it was designed but never
implemented.

## No successor — and why that is not a loss

**Picking (`/picking`) and Floor (`/floor`) were built on a different track**, using a
different set of workflow stages (`pending_picking` → `pick_assigned` → `pick_done` →
`pick_checked`). They do not share a single stage value with this board. They are not
a replacement for it; they are what actually got built and used while this screen sat
empty.

Nothing that worked has been taken away.

## Who held the key, and what changed for them

The `warehouse` pageKey was granted, live (SELECT 2026-07-27), to:

| roleSlug | canView | canEdit |
|---|---|---|
| `admin` | true | true |
| `floor_supervisor` | true | true |
| `picker` | true | true |

All three lose it. **In practice they lose access to an empty screen.**

**Their landing pages were already moved before this.** Step 5
(commit `c4323cd4`, 2026-07-28) repointed `ROLE_REDIRECTS` so `floor_supervisor` and
`picker` now land on **`/picking`** — the supervisor board and the picker's own
"My Picks" board respectively. Before that they landed on `/warehouse/supervisor` and
`/warehouse/picker`, i.e. on the empty board, at every single login. Nothing lands here
any more, which is why archiving it now is safe.

`admin` keeps `/admin` and can reach every board.

## What moved here

```
app/(warehouse)/                          the whole route group — nothing else lived in it
  layout.tsx
  warehouse/layout.tsx                    the permission gate (warehouse canView)
  warehouse/page.tsx
  warehouse/supervisor/page.tsx           4-line redirect stub
  warehouse/picker/page.tsx               4-line redirect stub
app/api/warehouse/board/route.ts          the board feed — the ONLY api/warehouse file moved
components/warehouse/                     all 10 files
```

`components/warehouse/` was verified self-contained before moving: exactly **one**
import in the entire repo resolved into it (`app/(warehouse)/warehouse/page.tsx:1`),
and its other nine files import only each other.

⚠ **A near-miss worth recording.** A first sweep appeared to show
`components/planning/planning-page.tsx` importing `unassigned-panel` from this folder.
It does not — `planning-page.tsx:7` imports `"./unassigned-panel"`, which resolves to
**`components/planning/unassigned-panel.tsx`**, Planning's own file. Planning has a
complete parallel set of similarly-named components. A relative import that *looks*
shared is not shared; resolve the path before believing it.

## Left behind on purpose

- **`app/api/warehouse/pickers/route.ts`** — live, see the top of this file.
- **`app/api/warehouse/assign/route.ts`** — its only caller was
  `components/warehouse/warehouse-page.tsx:171`, which is now archived, so it has
  **zero callers**. It was NOT on the approved removal list for this step, so it was
  left exactly where it is. It is dead code, not a dependency. Remove it deliberately
  in its own pass.
- **`lib/slot-cascade.ts` and `lib/day-boundary.ts`** — still imported by
  `app/api/planning/board/route.ts:5-6`, which survives this step. Both are
  *imported but never called* (every invocation commented out, headed
  `// DISABLED`). Left untouched. See `CLAUDE_CORE.md §13`.
- **`components/shared/carried-over-badge.tsx` and `cascade-badge.tsx`** — used by
  `components/planning/` too, which stays.

## /planning is a SEPARATE decision

`/planning`, `/dispatcher` and `app/api/planning/*` are **step 7** and are untouched
here. Do not read this retirement as implying theirs. Planning differs in one material
way: its *history* view reads `workflowStage = 'dispatched'`, of which there were
**1,546 rows** on 2026-07-27 — so unlike this board, Planning can actually display
data.

## What is still in the DATABASE

This commit changed only **code**. No SQL ran with it.

Three live `role_permissions` rows for `pageKey = 'warehouse'` (admin,
floor_supervisor, picker — all `canView=true canEdit=true`, SELECT 2026-07-27) now
point at a page key the code no longer knows about, so they do nothing.

**They are cleared by a separate, reviewed SQL statement AFTER this commit — not in
it.** Deleting rows from a live database is not something to bundle into a file move.

The matching **seed** rows *were* removed in this commit (`prisma/seed.ts` had two:
`floor_supervisor` and `picker`; live additionally had `admin`, which was never
seeded). Seed is code; the live table is not.

## Nothing in this folder runs

**Nothing under `archive/` is compiled, deployed, or reachable.** The folder is in
`tsconfig.json`'s exclude list, so the type-checker skips it and Next.js never builds
it. No web address leads to it.

## Honest note on reinstating this

Moving these files back would compile, and the board would render — as an empty frame,
exactly as it always did. Restoring it means also restoring the `warehouse` page key,
its `PAGE_NAV_MAP` entry, its sidebar icon, its seed rows and its permission grants.

**And it still would not show anything**, because the thing it waits for — an order at
`dispatch_confirmation` — is still never written.

**If the depot needs a post-picking dispatch view, build it on the stages that are
actually live** (`pick_checked` and beyond), in Floor or Picking. Do not revive this
folder; it is a design that was never connected.
