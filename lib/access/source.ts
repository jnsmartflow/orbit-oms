import { prisma } from "@/lib/prisma";

/**
 * ACCESS_SOURCE — the runtime switch that decides where permissions are read
 * from. Step 4 of the role → user access conversion.
 *
 *   "role"  → role_permissions, keyed on the user's role slug(s). TODAY.
 *   "user"  → user_page_access, keyed on the user's id.
 *
 * ── THE FAILURE DIRECTION IS NOT NEGOTIABLE ────────────────────────────────
 * A missing row, an unreadable row, a database error, an unexpected value, a
 * value with odd whitespace or casing — every one of them resolves to "role".
 * The ONLY thing that turns the new source on is the exact string "user"
 * (trimmed, lower-cased) read successfully from the row. Falling back to the
 * OLD behaviour is always safe: it is what production has been doing for
 * months. Falling forward to the new one on an error would silently change
 * every person's access at the exact moment the database is unhappy.
 *
 * ── CACHING ────────────────────────────────────────────────────────────────
 * There can be many permission checks per request, and none of them may cost a
 * system_config round trip. The value is cached in module scope for TTL_MS.
 *
 * 30 SECONDS, and here is the trade-off it settles. The cache lives per
 * serverless instance, so after flipping the row the fleet converges within one
 * TTL — half a minute, no deploy, no restart. That is short enough that the
 * owner can flip it, count to thirty, and reload; and long enough that a busy
 * page load costs at most one query instead of dozens. Shortening it buys
 * responsiveness nobody needs (this is flipped by hand, rarely); lengthening it
 * means a bad flip takes minutes to undo, which is the wrong thing to be slow.
 *
 * ⚠ The cache is per instance, NOT global. Different Vercel lambdas can
 * disagree for up to TTL_MS after a flip, so during that window one request may
 * read roles and the next read ticks. That is why step 2 proved the two sources
 * byte-identical before this switch existed: while they agree, a split fleet is
 * invisible. Once someone edits a tick they no longer agree, and a flip is
 * genuinely a 30-second transition, not an instant one.
 */

export type AccessSource = "role" | "user";

const TTL_MS = 30_000;
const CONFIG_KEY = "ACCESS_SOURCE";

let cached: { value: AccessSource; at: number } | null = null;

/**
 * The live access source. Cheap: one query per instance per TTL, then memory.
 * Never throws — every failure path returns "role".
 */
export async function getAccessSource(): Promise<AccessSource> {
  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.value;

  let value: AccessSource = "role";
  try {
    const row = await prisma.system_config.findUnique({
      where:  { key: CONFIG_KEY },
      select: { value: true },
    });
    // Only the exact string "user" flips it. Anything else — absent row, null,
    // "USER ", "1", "true", a typo — stays on "role".
    if (row?.value?.trim().toLowerCase() === "user") value = "user";
  } catch (err) {
    // Cache the SAFE answer for a full TTL rather than hammering a database
    // that is already failing. A transient error therefore pins role mode for
    // at most 30s, which is the direction that cannot hurt anyone.
    console.error("[access] could not read ACCESS_SOURCE; falling back to role mode:", err);
    value = "role";
  }

  cached = { value, at: now };
  return value;
}

/**
 * Drop the cache. For tests and for the admin screen after a deliberate flip —
 * NOT something a request path should call.
 */
export function clearAccessSourceCache(): void {
  cached = null;
}

/** The TTL, so the UI can tell the owner how long a flip takes to land. */
export const ACCESS_SOURCE_TTL_MS = TTL_MS;
