import { prisma } from "@/lib/prisma";
import { ROLE_REDIRECTS } from "@/lib/rbac";
import {
  ACCESS_SECTIONS,
  allPageKeys,
  isActionAvailable,
  pageLabel,
} from "@/lib/permissions";
import {
  differingPageKeys,
  effectiveRoleSlugs,
  primaryRoleSlug,
  roleBaselineByUser,
  FLAGS,
} from "@/lib/access/role-baseline";
import { AccessManager } from "@/components/admin/access-manager";
import type { PagePermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// Admin-only by inheritance: app/(admin)/admin/layout.tsx calls
// requireRole(session, [ROLES.ADMIN]) for everything under /admin. No second
// gate here — a duplicate would be one more place to forget.

const ALL_FALSE: PagePermissions = {
  canView: false, canImport: false, canExport: false, canEdit: false, canDelete: false,
};

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/** "tint_manager" → "Tint Manager". Display only. */
function prettyRole(slug: string): string {
  return slug.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export default async function AccessPage() {
  const pageKeys = allPageKeys();

  // Every ALL_PAGE_KEYS entry must appear in exactly one section. Asserted
  // rather than assumed: adding a key to ALL_PAGE_KEYS and forgetting
  // ACCESS_SECTIONS would otherwise silently hide a row, and a hidden row is a
  // permission nobody can see or set.
  const sectioned = ACCESS_SECTIONS.flatMap((s) => s.keys);
  const missing   = pageKeys.filter((k) => !sectioned.includes(k));
  const extra     = sectioned.filter((k) => !pageKeys.includes(k));

  const users = await prisma.users.findMany({
    select: {
      id: true, name: true, email: true, isActive: true,
      role:      { select: { name: true } },
      userRoles: { select: { role: { select: { name: true } } } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  const accessRows = await prisma.user_page_access.findMany({
    select: {
      userId: true, pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
  });

  // Role baseline via the LIVE resolver — see lib/access/role-baseline.ts.
  const baselines = await roleBaselineByUser(users);

  const storedByUser = new Map<number, Record<string, PagePermissions>>();
  for (const row of accessRows) {
    let rec = storedByUser.get(row.userId);
    if (!rec) { rec = {}; storedByUser.set(row.userId, rec); }
    rec[row.pageKey] = {
      canView:   row.canView,
      canImport: row.canImport,
      canExport: row.canExport,
      canEdit:   row.canEdit,
      canDelete: row.canDelete,
    };
  }

  const people = users.map((u) => {
    const slugs    = effectiveRoleSlugs(u);
    const primary  = primaryRoleSlug(u);
    const baseline = baselines.get(u.id) ?? {};
    const storedRaw = storedByUser.get(u.id) ?? {};

    // A key with no stored row reads as all-false, matching what an absent
    // role_permissions row means everywhere else in the app. It also makes the
    // screen honest if a future user is created before being back-filled: the
    // row shows unticked rather than blank, and differs from the baseline.
    const stored: Record<string, PagePermissions> = {};
    for (const k of pageKeys) stored[k] = storedRaw[k] ?? { ...ALL_FALSE };

    return {
      id:        u.id,
      name:      u.name,
      email:     u.email,
      isActive:  u.isActive,
      initials:  initials(u.name),
      roleLabel: prettyRole(primary),
      extraRoles: Math.max(0, slugs.filter((s) => s !== primary).length),
      // ROLE_REDIRECTS is keyed on the PRIMARY role and falls back to
      // /unauthorized at both call sites (app/page.tsx, app/login/page.tsx) —
      // reproduced, not guessed.
      landsOn:   ROLE_REDIRECTS[primary] ?? "/unauthorized",
      missingRows: pageKeys.filter((k) => !storedRaw[k]).length,
      stored,
      baseline,
      differs:   differingPageKeys(stored, baseline, pageKeys),
    };
  });

  // Row descriptors are built HERE, on the server, and passed down as plain
  // props. lib/permissions.ts imports prisma at module scope, so a "use client"
  // component must never import a value from it — today every client import of
  // that file is type-only, and this keeps it that way.
  const sections = ACCESS_SECTIONS.map((s) => ({
    label: s.label,
    rows: s.keys.map((key) => ({
      key,
      label: pageLabel(key),
      available: {
        canView:   isActionAvailable(key, "canView"),
        canEdit:   isActionAvailable(key, "canEdit"),
        canImport: isActionAvailable(key, "canImport"),
        canExport: isActionAvailable(key, "canExport"),
        canDelete: isActionAvailable(key, "canDelete"),
      },
    })),
  }));

  return (
    <AccessManager
      people={people}
      sections={sections}
      flags={[...FLAGS]}
      keyCountWarning={
        missing.length > 0 || extra.length > 0
          ? `Section map out of step with ALL_PAGE_KEYS — missing: ${
              missing.join(", ") || "none"
            }; unknown: ${extra.join(", ") || "none"}`
          : null
      }
    />
  );
}
