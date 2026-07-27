# Archive — retired modules

Modules removed from the running app but kept for reference. Nothing in here is
compiled or deployed.

| Module | Retired | Superseded by | Folder |
|---|---|---|---|
| Support board — screens *and* API routes | 2026-07-27 | Floor Control (`/floor`) | `2026-07-support/` |

**How this folder works.** Everything here was moved with `git mv`, so each file
keeps its full history — `git log --follow` on any archived file still shows every
change ever made to it. The whole `archive/` directory is listed in
`tsconfig.json`'s `exclude`, so TypeScript never checks it and Next.js never builds
it. Adding a folder here does not delete anything; removing it from `tsconfig`
would bring it back into the build, which is almost never what you want (see the
per-module README for why).
