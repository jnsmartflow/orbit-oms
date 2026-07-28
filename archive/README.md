# Archive — retired modules

Modules removed from the running app but kept for reference. Nothing in here is
compiled or deployed.

**Retiring something? Read [`RETIREMENT-PLAYBOOK.md`](RETIREMENT-PLAYBOOK.md) first** — the order to
do it in, the checks that stop you breaking the app, and the mistakes already made once.

| Module | Retired | Superseded by | Folder |
|---|---|---|---|
| Support board — screens *and* API routes | 2026-07-27 | Floor Control (`/floor`) | `2026-07-support/` |
| `/order` — public no-login mobile order page | 2026-07-27 | `/po` (also public) | `2026-07-order/` |
| `/operations/warehouse` + `/operations/dispatch` — alternate mounts only | 2026-07-27 | `/warehouse` and `/planning` (both still live) | `2026-07-operations-pages/` |
| Warehouse board — `/warehouse` + 2 stubs + board API + components | 2026-07-28 | **none** — always rendered empty; Picking/Floor built on a different track | `2026-07-warehouse-board/` |
| Planning board — `/planning` + `/dispatcher` stub + 8 API routes + components | 2026-07-28 | **none** — never used end to end; always rendered empty | `2026-07-planning-board/` |

**How this folder works.** Everything here was moved with `git mv`, so each file
keeps its full history — `git log --follow` on any archived file still shows every
change ever made to it. The whole `archive/` directory is listed in
`tsconfig.json`'s `exclude`, so TypeScript never checks it and Next.js never builds
it. Adding a folder here does not delete anything; removing it from `tsconfig`
would bring it back into the build, which is almost never what you want (see the
per-module README for why).
