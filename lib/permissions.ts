import { prisma } from "@/lib/prisma";
import type { RolloutStage } from "@/auth.config";

// ── Nav config ─────────────────────────────────────────────────────────────────

export interface NavItemConfig {
  pageKey: string;
  label:   string;
  href:    string;
}

export interface NavUserFlags {
  attendanceTestUser?: boolean;
  rolloutStage?:       RolloutStage;
}

const PAGE_NAV_MAP: NavItemConfig[] = [
  // 2026-07-27 — Support retired (steps 3-5/8), replaced by Floor Control (/floor).
  // Both of its page keys, "support_queue" (→ /support) and "operations_support"
  // (→ /operations/support), are gone from this file entirely: the nav entries
  // here, the PageKey union, and ALL_PAGE_KEYS. Their seed grants are gone from
  // prisma/seed.ts, and the dead ICON_MAP + admin-Permissions rows went with them
  // (components/shared/role-sidebar.tsx, components/admin/permissions-manager.tsx).
  // The screens and API routes live at archive/2026-07-support/ — see the README
  // there for what was retired, what replaced it, and what is still in the DB.
  { pageKey: "operations_tinting",       label: "Tinting",       href: "/operations/tinting" },
  { pageKey: "operations_tint_operator", label: "Tint Operator", href: "/operations/tint-operator" },
  // "operations_dispatch" (→ /operations/dispatch) and "operations_warehouse"
  // (→ /operations/warehouse) removed 2026-07-27: both were alternate mounts of
  // the Planning and Warehouse boards and are archived at
  // archive/2026-07-operations-pages/. The boards themselves stay live at
  // /planning and /warehouse (their own retirement is a separate, later step).
  { pageKey: "picking",       label: "Picking",       href: "/picking" },
  { pageKey: "floor",         label: "Floor",         href: "/floor" },
  { pageKey: "import_obd",    label: "Import OBDs",   href: "/import" },
  // "planning_board" (→ /planning) and "dispatcher" (→ /dispatcher) removed
  // 2026-07-28: both archived to archive/2026-07-planning-board/. The Planning
  // board filtered workflowStage 'dispatch_confirmation' (live count 0) and its
  // showDispatched branch was never set by any client, so it always rendered
  // empty. /dispatcher was a 4-line stub redirecting into it. ⚠ The dispatcher
  // ROLE and its four master-data pages (/dispatcher/customers, /skus, /routes,
  // /vehicles) are UNAFFECTED — they gate on their own page keys.
  { pageKey: "tint_manager",   label: "Tint Manager",    href: "/tint/manager" },
  { pageKey: "tint_operator", label: "Tint Operator",  href: "/tint/operator" },
  // "warehouse" (→ /warehouse) removed 2026-07-28: the board was archived to
  // archive/2026-07-warehouse-board/. It filtered on workflowStage
  // 'dispatch_confirmation', which nothing in this codebase ever writes, so it
  // always rendered empty. No successor — Picking and Floor were built on a
  // different track. ⚠ app/api/warehouse/pickers/route.ts was NOT archived: it
  // is called by the live Picking boards. Never archive app/api/warehouse/ whole.
  { pageKey: "customers",     label: "Customers",      href: "/admin/customers" },
  { pageKey: "skus",          label: "SKUs",           href: "/admin/skus" },
  { pageKey: "routes_areas",  label: "Routes",         href: "/admin/routes" },
  { pageKey: "vehicles",      label: "Vehicles",        href: "/admin/vehicles" },
  { pageKey: "trip_report",   label: "Trip Report",     href: "/trips" },
  { pageKey: "place_order",        label: "Purchase Order (PO)", href: "/place-order" },
  { pageKey: "mail_orders",        label: "Billing",       href: "/mail-orders" },
  // MRN — Material Receipt Note (2026-08-20). Inbound goods receipt; one route,
  // two faces branching by ROLE (billing desktop / floor_supervisor phone).
  //
  // ⚠ THIS POSITION IS BEHAVIOUR, NOT COSMETICS. MobileShell's phone Home
  // target is navItems[0]?.href (components/shared/mobile-shell.tsx), and
  // buildNavItems below preserves this array's order — so an entry becomes
  // Home for any role whose first GRANTED entry it displaces.
  //
  // Sitting here after mail_orders, it displaces nobody. Verified 2026-08-20
  // by computing navItems[0] against the LIVE grants: billing_operator
  // place_order, floor_supervisor picking, operations operations_tinting —
  // all three unchanged.
  //
  // The role actually at risk is ONE, not three: billing_operator, whose
  // first granted entry (place_order) sits at index 12, so any insertion
  // BEFORE that would take its Home button. floor_supervisor and operations
  // are insensitive — picking and operations_tinting already sit at indices 2
  // and 0. Re-derive it against the grants, never from this comment, before
  // moving this line.
  { pageKey: "mrn",                label: "MRN",           href: "/mrn" },
  { pageKey: "delivery_challans",  label: "Delivery Challans", href: "/tint/manager/challan" },
  { pageKey: "shade_master",       label: "Shade Master",      href: "/tint/manager/shades" },
  { pageKey: "sampling_library",   label: "Sampling Library",  href: "/tint/sampling-library" },
  // "Reports" hub (/reports) — holds Tint Summary + TI Report under one rail.
  // Reuses the ti_report permission so the same roles that had TI Report keep access.
  { pageKey: "ti_report",          label: "Reports",           href: "/reports" },
  { pageKey: "attendance",         label: "Attendance",        href: "/attendance" },
  { pageKey: "attendance_admin",   label: "Attendance",        href: "/admin/attendance" },
  // NOTE: no "settings_hide" entry here — the Hide page is admin-only and lives
  // in the dedicated admin sidebar (components/admin/admin-sidebar.tsx). The
  // "settings_hide" PageKey stays in ALL_PAGE_KEYS so that sidebar's gating
  // (allPerms["settings_hide"]) resolves to ALL_TRUE for admin.
];

// Per-role href overrides: non-admin roles access shared pages via their own route group
const ROLE_HREF_OVERRIDES: Record<string, Record<string, string>> = {
  // The "support" overrides (→ /support/customers, /support/skus, /support/routes,
  // /support/vehicles) were removed 2026-07-27, Support retirement step 4/8: those
  // four pages were archived with the board (archive/2026-07-support/). The role
  // now falls through to the default admin hrefs, which render the same data —
  // /admin/customers uses the richer split view, the other three the same tables.
  tint_manager: {
    customers:    "/tint/manager/customers",
    skus:         "/tint/manager/skus",
    routes_areas: "/tint/manager/routes",
    vehicles:     "/tint/manager/vehicles",
  },
  dispatcher: {
    customers:    "/dispatcher/customers",
    skus:         "/dispatcher/skus",
    routes_areas: "/dispatcher/routes",
    vehicles:     "/dispatcher/vehicles",
  },
  operation_manager: {
    customers:    "/tint/manager/customers",
    skus:         "/tint/manager/skus",
    routes_areas: "/tint/manager/routes",
    vehicles:     "/tint/manager/vehicles",
  },
};

export function buildNavItems(
  allPerms:   Record<string, PagePermissions>,
  roleSlug?:  string,
  userFlags?: NavUserFlags,
): NavItemConfig[] {
  const overrides = roleSlug ? (ROLE_HREF_OVERRIDES[roleSlug] ?? {}) : {};
  return PAGE_NAV_MAP
    .filter((item) => {
      // The attendance nav item is gated on user-level flags + rollout stage,
      // not on role_permissions (no row exists for "attendance" — visibility
      // is intentionally per-user). Admin always sees it for self-test.
      if (item.pageKey === "attendance") {
        if (roleSlug === "admin") return true;
        // ops_admin reaches the user-facing /attendance flow via the gate
        // redirect, not the sidebar — they get /admin/attendance via the
        // separate attendance_admin pageKey. Suppress this entry to avoid a
        // duplicate "Attendance" nav item.
        if (roleSlug === "ops_admin") return false;
        return (
          (userFlags?.attendanceTestUser ?? false) ||
          userFlags?.rolloutStage === "ALL_USERS"
        );
      }
      return allPerms[item.pageKey]?.canView === true;
    })
    .map((item) =>
      overrides[item.pageKey] !== undefined
        ? { ...item, href: overrides[item.pageKey] }
        : item,
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PageKey =
  | "operations_tinting"
  | "operations_tint_operator"
  | "picking"
  | "floor"
  | "dashboard"
  | "users"
  | "system_config"
  | "permissions"
  | "customers"
  | "skus"
  | "routes_areas"
  | "vehicles"
  | "import_obd"
  | "tint_manager"
  | "tint_operator"
  | "place_order"
  | "trip_report"
  | "mail_orders"
  | "mrn"
  | "delivery_challans"
  | "shade_master"
  | "sampling_library"
  | "ti_report"
  | "attendance"
  | "attendance_admin"
  | "settings_hide";

export type ActionKey =
  | "canView"
  | "canImport"
  | "canExport"
  | "canEdit"
  | "canDelete";

export interface PagePermissions {
  canView:   boolean;
  canImport: boolean;
  canExport: boolean;
  canEdit:   boolean;
  canDelete: boolean;
}

const ALL_TRUE: PagePermissions = {
  canView:   true,
  canImport: true,
  canExport: true,
  canEdit:   true,
  canDelete: true,
};

const ALL_FALSE: PagePermissions = {
  canView:   false,
  canImport: false,
  canExport: false,
  canEdit:   false,
  canDelete: false,
};

const ALL_PAGE_KEYS: PageKey[] = [
  "attendance", "attendance_admin",
  "operations_tinting", "operations_tint_operator",
  "picking", "floor",
  "dashboard", "users", "system_config", "permissions",
  "customers", "skus", "routes_areas", "vehicles",
  "import_obd", "tint_manager", "tint_operator",
  "place_order", "trip_report", "mail_orders", "mrn",
  "delivery_challans", "shade_master", "sampling_library", "ti_report",
  "settings_hide",
];

// ── Functions ─────────────────────────────────────────────────────────────────

export async function checkPermission(
  roleSlug: string,
  pageKey: PageKey,
  action: ActionKey,
): Promise<boolean> {
  if (roleSlug === "admin") return true;

  const perm = await prisma.role_permissions.findUnique({
    where: { roleSlug_pageKey: { roleSlug, pageKey } },
  });

  if (!perm) return false;
  return perm[action];
}

export async function checkAnyPermission(
  roleSlugs: string[],
  pageKey: PageKey,
  action: ActionKey,
): Promise<boolean> {
  if (roleSlugs.includes("admin")) return true;
  if (roleSlugs.length === 0) return false;

  const rows = await prisma.role_permissions.findMany({
    where:  { roleSlug: { in: roleSlugs }, pageKey },
    select: { canView: true, canEdit: true, canImport: true, canExport: true, canDelete: true },
  });

  return rows.some(r => r[action] === true);
}

export async function getPagePermissions(
  roleSlug: string,
  pageKey: PageKey,
): Promise<PagePermissions> {
  if (roleSlug === "admin") return ALL_TRUE;

  const perm = await prisma.role_permissions.findUnique({
    where: { roleSlug_pageKey: { roleSlug, pageKey } },
  });

  if (!perm) return ALL_FALSE;

  return {
    canView:   perm.canView,
    canImport: perm.canImport,
    canExport: perm.canExport,
    canEdit:   perm.canEdit,
    canDelete: perm.canDelete,
  };
}

export async function getAllPermissionsForRole(
  roleSlug: string,
): Promise<Record<string, PagePermissions>> {
  if (roleSlug === "admin") {
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }

  const rows = await prisma.role_permissions.findMany({
    where: { roleSlug },
  });

  const result: Record<string, PagePermissions> = {};
  for (const row of rows) {
    result[row.pageKey] = {
      canView:   row.canView,
      canImport: row.canImport,
      canExport: row.canExport,
      canEdit:   row.canEdit,
      canDelete: row.canDelete,
    };
  }
  return result;
}

/**
 * Multi-role variant of getAllPermissionsForRole.
 * Returns a permission map representing the UNION of permissions across
 * all roles passed in: a page action is `true` if ANY role grants it.
 *
 * Admin short-circuits to ALL_TRUE (same as single-role variant).
 */
export async function getAllPermissionsForRoles(
  roleSlugs: string[],
): Promise<Record<string, PagePermissions>> {
  if (roleSlugs.length === 0) return {};
  if (roleSlugs.includes("admin")) {
    return getAllPermissionsForRole("admin");
  }

  const rows = await prisma.role_permissions.findMany({
    where: { roleSlug: { in: roleSlugs } },
  });

  const merged: Record<string, PagePermissions> = {};
  for (const row of rows) {
    const existing = merged[row.pageKey];
    if (!existing) {
      merged[row.pageKey] = {
        canView:   row.canView,
        canImport: row.canImport,
        canExport: row.canExport,
        canEdit:   row.canEdit,
        canDelete: row.canDelete,
      };
    } else {
      merged[row.pageKey] = {
        canView:   existing.canView   || row.canView,
        canImport: existing.canImport || row.canImport,
        canExport: existing.canExport || row.canExport,
        canEdit:   existing.canEdit   || row.canEdit,
        canDelete: existing.canDelete || row.canDelete,
      };
    }
  }
  return merged;
}
