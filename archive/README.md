# Archive — retired modules

Modules removed from the running app but kept for reference. Nothing in here is
compiled or deployed.

**Retiring something? Read [`RETIREMENT-PLAYBOOK.md`](RETIREMENT-PLAYBOOK.md) first** — the order to
do it in, the checks that stop you breaking the app, and the mistakes already made once.

| Module | Retired | Superseded by | Folder |
|---|---|---|---|
| Support board — screens *and* API routes | 2026-07-27 | Floor Control (`/floor`) | `2026-07-support/` |
| `/order` — public no-login mobile order page | 2026-07-27 | `/po` (also public) | `2026-07-order/` |
| `/operations/warehouse` + `/operations/dispatch` — alternate mounts only | 2026-07-27 | `/warehouse` and `/planning` — **both retired the next day, see below** | `2026-07-operations-pages/` |
| Warehouse board — `/warehouse` + 2 stubs + board API + components | 2026-07-28 | **none** — always rendered empty; Picking/Floor built on a different track | `2026-07-warehouse-board/` |
| Planning board — `/planning` + `/dispatcher` stub + 8 API routes + components | 2026-07-28 | **none** — never used end to end; always rendered empty | `2026-07-planning-board/` |
| **Picking DESKTOP board** — the wide-screen table only. 🔴 **NOT a route retirement:** `/picking` is STILL LIVE and renders the card board at every width. No page key removed, no permission row cleared, no SQL run | 2026-07-28 | Floor Control (`/floor`) | `2026-07-picking-desktop/` |

**Commits, in order.** `bc42a948`→`63164ed2` Support · `9dce858b`+`de48357d` `/order` ·
`83ec3fc1` the two operations mounts · **`c4323cd4` login landings repointed to `/picking`** ·
`207e2a5c` Warehouse · `639f8139` Planning · `90c9a865`→ Picking desktop (six steps).

⚠ **The last row is a different shape from the rest of this table.** Everything above it
removed a whole screen at a whole address. The Picking desktop board was **one branch
removed from inside a route that is still running** — so it has no page key to remove, no
permission rows to clear and no step 5b. If you are using it as a template, read its README
first: most of the usual checklist does not apply.

⚠ **Note the position of `c4323cd4`.** `floor_supervisor` and `picker` were moved off the
Warehouse stubs and onto `/picking` **before** those boards were archived — people were
walked out of the building before it came down. **That ordering is the default this
playbook recommends**, not an accident of scheduling: repoint every landing, redirect and
link first, verify, and only then archive.

**How this folder works.** Everything here was moved with `git mv`, so each file
keeps its full history — `git log --follow` on any archived file still shows every
change ever made to it. The whole `archive/` directory is listed in
`tsconfig.json`'s `exclude`, so TypeScript never checks it and Next.js never builds
it. Adding a folder here does not delete anything; removing it from `tsconfig`
would bring it back into the build, which is almost never what you want (see the
per-module README for why).
