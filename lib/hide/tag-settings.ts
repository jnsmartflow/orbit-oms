import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Tag on/off switches (Feature B) — read-only helpers.
//
// app_tag_settings holds one row per tagKey with an isEnabled flag. Tags default
// to ON: a key that has no row is treated as enabled, so nothing disappears from
// the UI before an admin explicitly disables it.
// ─────────────────────────────────────────────────────────────────────────────

/** Map of every persisted tag setting: { tagKey: isEnabled }. Missing keys absent. */
export async function getTagSettings(): Promise<Record<string, boolean>> {
  const rows = await prisma.app_tag_settings.findMany({
    select: { tagKey: true, isEnabled: true },
  });
  const map: Record<string, boolean> = {};
  for (const row of rows) {
    map[row.tagKey] = row.isEnabled;
  }
  return map;
}

/** Resolve a tag's enabled state. Default-on: absent key → true. */
export function isTagEnabled(map: Record<string, boolean>, key: string): boolean {
  return key in map ? map[key] : true;
}
