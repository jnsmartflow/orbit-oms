// The SO surface's address test (2026-10-01) — imported by middleware.ts, so it
// must stay EDGE-SAFE: no imports, no Prisma, no Node APIs. Pure string checks.
//
// 🔴 2026-10-01: /so-lab + /api/so-lab/* bypass NextAuth in middleware by exact
// segment — they carry their own SO session; never widen to a prefix.
// A bare startsWith("/so-lab") would also open "/so-labX", "/so-lab-old" and
// anything later named that way — the exact landmine "/po" already is
// (CLAUDE_PO2.md §4). Every route this admits enforces its own gate:
// lib/so-auth/lock.ts (staff superuser while 'so.page.open' is off) and
// requireSoApi / getSoSession once it is on.

/** True ONLY for the SO page and the SO API tree — segment-exact. */
export function isSoSurfacePath(pathname: string): boolean {
  if (pathname === "/so-lab" || pathname === "/so-lab/") return true;
  if (pathname === "/api/so-lab" || pathname.startsWith("/api/so-lab/")) return true;
  return false;
}
