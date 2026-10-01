import { prisma } from "@/lib/prisma";

// The /so-lab STAFF LOCK as a switch (C.2a, 2026-10-01).
//
// app_settings "settingKey" = 'so.page.open'. The page is OPEN only when that
// row exists with isEnabled = true. Absent, false, or a READ ERROR → LOCKED
// (fail CLOSED — the opposite default to the live-feed switch in
// lib/live/feed.ts, because this one guards data, not an optimisation).
// While LOCKED, /so-lab and every /api/so-lab/* require a superuser staff
// session exactly as before. Go-live flips the row; no code edit.
//
// ⚠ Opening it is NOT enough on its own: without a NextAuth session,
// middleware.ts:78-80 still sends /so-lab to /login. The go-live middleware
// branch is a separate, deliberate commit (pipeline checklist H).
//
// Cached per server instance for 30 s (same shape as lib/live/feed.ts
// isSwitchOn), so a flip lands everywhere within ~30 s and costs at most one
// read per instance per 30 s.

export const SO_PAGE_OPEN_KEY = "so.page.open";
const TTL_MS = 30_000;

let cache: { open: boolean; at: number } | null = null;

export async function isSoPageOpen(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.open;
  let open = false;
  try {
    const row = await prisma.app_settings.findUnique({
      where: { settingKey: SO_PAGE_OPEN_KEY },
      select: { isEnabled: true },
    });
    open = row?.isEnabled === true;
  } catch (err) {
    console.error(`[so-auth] could not read the ${SO_PAGE_OPEN_KEY} switch; treating it as LOCKED:`, err);
    open = false;
  }
  cache = { open, at: now };
  return open;
}
