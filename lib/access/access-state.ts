// lib/access/access-state.ts — PURE interpretation of the three access keys in
// system_config. lib/access/source.ts does the (cached) read and hands the rows
// here; lib/access/notebook.test.ts tests this with no database.
//
// The rules, each deliberately the SAFE direction:
//   ACCESS_SOURCE  → "user" ONLY for the exact string "user" (trimmed, lower-
//                    cased); anything else, a missing row or a failed read →
//                    "role". Unchanged since 2026-09-04.
//   ACCESS_VERSION → the trimmed value, or null (unknown) when missing, blank
//                    or unreadable. Unknown never extends trust past 30 s
//                    (lib/access/notebook.ts).
//   ACCESS_CACHE   → ON only for the exact string "on"; a missing row or any
//                    other value → OFF (the pre-notebook code path). A FAILED
//                    READ keeps this instance's last successfully read value,
//                    else OFF.

export type AccessSource = "role" | "user";

export interface AccessState {
  /** Identical semantics to getAccessSource(). */
  source: AccessSource;
  /** ACCESS_VERSION, or null when missing / unreadable. */
  version: string | null;
  /** ACCESS_CACHE === "on". */
  cacheOn: boolean;
  /** The read succeeded. */
  ok: boolean;
}

export const ACCESS_SOURCE_KEY = "ACCESS_SOURCE";
export const ACCESS_VERSION_KEY = "ACCESS_VERSION";
export const ACCESS_CACHE_KEY = "ACCESS_CACHE";

/**
 * @param values           key → value for the rows read, or null when the read FAILED.
 * @param lastKnownCacheOn this instance's last successfully read ACCESS_CACHE (null = never).
 */
export function parseAccessState(
  values: Map<string, string | null> | null,
  lastKnownCacheOn: boolean | null,
): AccessState {
  if (values === null) {
    return { source: "role", version: null, cacheOn: lastKnownCacheOn ?? false, ok: false };
  }
  const source: AccessSource =
    values.get(ACCESS_SOURCE_KEY)?.trim().toLowerCase() === "user" ? "user" : "role";
  const rawVersion = values.get(ACCESS_VERSION_KEY)?.trim();
  const cacheOn = values.get(ACCESS_CACHE_KEY)?.trim().toLowerCase() === "on";
  return { source, version: rawVersion ? rawVersion : null, cacheOn, ok: true };
}
