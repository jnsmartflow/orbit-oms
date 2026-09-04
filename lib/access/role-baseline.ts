import { getRolePermissionsForRoles, allPageKeys } from "@/lib/permissions";
import type { PagePermissions } from "@/lib/permissions";

/**
 * What the ROLE system grants a person right now — the baseline /admin/access
 * compares stored per-user ticks against.
 *
 * 🔴 THIS IS A READER, NOT A REPLACEMENT. It shares the role-table merge with
 * the live resolvers rather than reimplementing it — the whole value of the
 * "differs" banner is that it reports what the ROLE system actually grants, so
 * a second local copy of the merge rule would make it confidently wrong the
 * first time the two drifted.
 *
 * ⚠ IT CALLS getRolePermissionsForRoles(), NOT getAllPermissionsForRoles(),
 * AND THAT IS DELIBERATE (changed in step 4, when ACCESS_SOURCE landed). The
 * five switch-aware resolvers answer about the LOGGED-IN user, because that is
 * the only user whose id they can obtain. This file asks about 39 OTHER people,
 * so in user mode those resolvers would hand back the viewing admin's own
 * permissions 39 times and the screen would report every person as differing.
 * getRolePermissionsForRoles() is pinned to role_permissions and ignores the
 * switch, which is exactly what a "what would their job title give them"
 * baseline means.
 *
 * Nothing here changes access — this file only ever reads.
 */

/** A user row shaped for slug derivation. */
export interface UserForRoles {
  id: number;
  role:      { name: string };
  userRoles: { role: { name: string } }[];
}

/**
 * The effective role slugs for a person, reproduced from lib/auth.ts:204-208 —
 * the ONLY place this normalisation is defined:
 *
 *   const primaryRole = user.role.name.toLowerCase().replace(/\s+/g, "_");
 *   const allRoles    = user.userRoles.map((ur) =>
 *                         ur.role.name.toLowerCase().replace(/\s+/g, "_"));
 *   const roles       = allRoles.length > 0 ? allRoles : [primaryRole];
 *
 * 🔴 Note the last line: when a user has ANY user_roles rows, `roles` is
 * EXACTLY those rows — the primary from users.roleId is NOT appended. A user
 * whose user_roles rows omit their own primary would lose that primary's
 * access, in the app as well as here. Verified read-only 2026-09-04: no user is
 * in that state today. Reproduced anyway, because this must match the app
 * rather than match what we wish the app did.
 */
export function effectiveRoleSlugs(user: UserForRoles): string[] {
  const slug = (name: string) => name.toLowerCase().replace(/\s+/g, "_");
  const primary  = slug(user.role.name);
  const allRoles = user.userRoles.map((ur) => slug(ur.role.name));
  return allRoles.length > 0 ? allRoles : [primary];
}

export function primaryRoleSlug(user: UserForRoles): string {
  return user.role.name.toLowerCase().replace(/\s+/g, "_");
}

/**
 * Role-granted permissions for many users, as a map keyed by user id.
 *
 * Deduplicated by role-set: 39 users share ~14 distinct effective role sets, so
 * this makes ~14 resolver calls rather than 39. Sequential awaits, never
 * $transaction (CORE §3).
 *
 * Every one of ALL_PAGE_KEYS is present in each returned record — the resolver
 * OMITS keys no role grants, and an absent key means all-false to every
 * consumer (`allPerms[key]?.canView === true`), so it is filled in explicitly
 * here rather than left for each caller to remember.
 */
export async function roleBaselineByUser(
  users: UserForRoles[],
): Promise<Map<number, Record<string, PagePermissions>>> {
  const ALL_FALSE: PagePermissions = {
    canView: false, canImport: false, canExport: false, canEdit: false, canDelete: false,
  };

  const cache = new Map<string, Record<string, PagePermissions>>();
  const out   = new Map<number, Record<string, PagePermissions>>();

  for (const user of users) {
    const slugs = effectiveRoleSlugs(user);
    const key   = [...slugs].sort().join("|");

    let merged = cache.get(key);
    if (!merged) {
      const raw = await getRolePermissionsForRoles(slugs);
      // Densify: absent key ≡ all false, everywhere in the app.
      const dense: Record<string, PagePermissions> = {};
      for (const pageKey of allPageKeys()) {
        dense[pageKey] = raw[pageKey] ?? { ...ALL_FALSE };
      }
      merged = dense;
      cache.set(key, merged);
    }
    out.set(user.id, merged);
  }

  return out;
}

/** The five flags, in the order the screen shows them. */
export const FLAGS = ["canView", "canEdit", "canImport", "canExport", "canDelete"] as const;
export type Flag = (typeof FLAGS)[number];

/**
 * Page keys where the stored ticks differ from the role baseline, for one user.
 *
 * ⚠ Compares ALL FIVE flags on ALL 27 keys, deliberately ignoring
 * isActionAvailable(). The dash map is cosmetic (see its header in
 * lib/permissions.ts); a difference hidden behind a dash is still a difference,
 * and step 4 will apply it. Filtering here is exactly how a stale dash map
 * would turn into silent data loss.
 */
export function differingPageKeys(
  stored: Record<string, PagePermissions>,
  baseline: Record<string, PagePermissions>,
  pageKeys: readonly string[],
): string[] {
  const out: string[] = [];
  for (const pageKey of pageKeys) {
    const s = stored[pageKey];
    const b = baseline[pageKey];
    if (!s || !b) { out.push(pageKey); continue; }
    if (FLAGS.some((f) => s[f] !== b[f])) out.push(pageKey);
  }
  return out;
}
