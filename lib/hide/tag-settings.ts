import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Tag on/off switches (Feature B) — read-only helpers.
//
// app_tag_settings holds one row per (tagKey, audience). `scope` says who the
// row is about: 'everyone', one 'role' (by slug), or one 'user' (by id).
//
// 🔴 DEFAULT-ON, AND IT IS THE WHOLE CONTRACT. A tag with no row that applies to
// this person is SHOWN. Every fallback below returns "shown" — an empty table, a
// missing row, a user with no roles, a scope nobody matches. Nothing disappears
// from anyone's screen until an admin deliberately makes it.
//
// 🔴 NO ADMIN / SUPERUSER BYPASS. Unlike the permission resolvers
// (lib/permissions.ts, which short-circuit to ALL_TRUE for a superuser), these
// switches apply to the admin exactly as written. That is deliberate: the admin
// is the person who sets them, and a bypass would make the one reader who needs
// to verify a switch the one reader who can never see it.
// ─────────────────────────────────────────────────────────────────────────────

/** One stored audience row, as the admin screen edits it. */
export interface TagSettingRow {
  id:        number;
  tagKey:    string;
  scope:     string;
  roleSlug:  string | null;
  userId:    number | null;
  isEnabled: boolean;
}

/**
 * EVERY row, unfiltered — for the admin Tags screen only.
 *
 * ⚠ NOT a permission check and never a render input. The screen shows what is
 * stored for all audiences; a rendering surface must ask getTagSettings() about
 * one specific person instead.
 */
export async function getAllTagRows(): Promise<TagSettingRow[]> {
  return prisma.app_tag_settings.findMany({
    select: { id: true, tagKey: true, scope: true, roleSlug: true, userId: true, isEnabled: true },
    orderBy: [{ tagKey: "asc" }, { scope: "asc" }, { id: "asc" }],
  });
}

/**
 * The DISABLED tag keys for one person — what the client suppresses.
 *
 * Returns the same `string[]` shape the payload has always carried, so no
 * consumer downstream of /api/mail-orders changes: the page still stores it as a
 * Set and drills it into review-view and the table view.
 *
 * ── THE RESOLUTION RULE (owner-locked 2026-09-11) ──────────────────────────
 *
 *   1. A user-scoped row for THIS user decides, full stop. Most specific wins.
 *   2. Otherwise, per role the user holds: that role's row if present, else the
 *      everyone value. The person SEES the tag if ANY held role says show.
 *      🔴 SHOW WINS. A role-level hide therefore bites only when EVERY role the
 *      person holds hides it. This mirrors the OR-merge the permission system
 *      already does across roles (lib/permissions.ts mergeRolePerms), and it
 *      fails in the safe direction: a badge shown in error is noise, a badge
 *      hidden in error is a fact the operator never learns.
 *   3. A user holding no roles at all falls straight to the everyone value.
 *   4. No everyone row → shown.
 *
 * ── ONE QUERY ──────────────────────────────────────────────────────────────
 * Three OR arms, each index-backed, then the fold happens in memory. This runs
 * on GET /api/mail-orders, which every open board polls, so it must not become a
 * query per tag. Sequential await at the call site, never $transaction (CORE §3).
 *
 * Never throws: a failed read logs and returns an empty array, i.e. every badge
 * shows. Same direction as every other fallback here.
 *
 * @param userId     the viewer, or null when no usable session id is available
 * @param roleSlugs  session.user.roles — already slugified by lib/auth.ts:217-221
 */
export async function getTagSettings(
  userId: number | null,
  roleSlugs: string[],
): Promise<string[]> {
  // Arms are built conditionally: `roleSlug: { in: [] }` matches nothing but
  // still costs a scan, and a null userId must not become `userId: null`, which
  // would match every everyone/role row.
  const arms: Record<string, unknown>[] = [{ scope: "everyone" }];
  if (roleSlugs.length > 0) arms.push({ scope: "role", roleSlug: { in: roleSlugs } });
  if (userId !== null)      arms.push({ scope: "user", userId });

  let rows: { tagKey: string; scope: string; roleSlug: string | null; isEnabled: boolean }[];
  try {
    rows = await prisma.app_tag_settings.findMany({
      where:  { OR: arms },
      select: { tagKey: true, scope: true, roleSlug: true, isEnabled: true },
    });
  } catch (err) {
    console.error("[tags] could not read app_tag_settings; showing every badge:", err);
    return [];
  }

  // Bucket by tag. `everyone` is one value per tag; `role` is a value per slug;
  // `user` is one value per tag (the WHERE already pinned it to this user).
  const everyoneVal = new Map<string, boolean>();
  const roleVal     = new Map<string, Map<string, boolean>>();
  const userVal     = new Map<string, boolean>();

  for (const row of rows) {
    if (row.scope === "user") {
      userVal.set(row.tagKey, row.isEnabled);
    } else if (row.scope === "role" && row.roleSlug) {
      let byRole = roleVal.get(row.tagKey);
      if (!byRole) { byRole = new Map(); roleVal.set(row.tagKey, byRole); }
      byRole.set(row.roleSlug, row.isEnabled);
    } else if (row.scope === "everyone") {
      everyoneVal.set(row.tagKey, row.isEnabled);
    }
    // An unrecognised scope is IGNORED rather than guessed at. The live CHECK
    // constraint makes one impossible; if one ever appears, the tag keeps its
    // default and shows.
  }

  const tagKeys = new Set<string>([
    ...Array.from(everyoneVal.keys()),
    ...Array.from(roleVal.keys()),
    ...Array.from(userVal.keys()),
  ]);

  const disabled: string[] = [];
  for (const tagKey of Array.from(tagKeys)) {
    let shown: boolean;

    if (userVal.has(tagKey)) {
      shown = userVal.get(tagKey)!;                     // rule 1
    } else if (roleSlugs.length > 0) {
      const byRole    = roleVal.get(tagKey);
      const fallback  = everyoneVal.get(tagKey) ?? true;
      shown = roleSlugs.some((slug) => byRole?.get(slug) ?? fallback);   // rule 2
    } else {
      shown = everyoneVal.get(tagKey) ?? true;          // rule 3
    }

    if (!shown) disabled.push(tagKey);                  // rule 4 is the ?? true above
  }

  return disabled;
}
