import { prisma } from "@/lib/prisma";

// ── Nav config ─────────────────────────────────────────────────────────────────

export interface NavItemConfig {
  pageKey: string;
  label:   string;
  href:    string;
}

const PAGE_NAV_MAP: NavItemConfig[] = [
  { pageKey: "import_obd",    label: "Import OBDs",   href: "/import" },
  { pageKey: "support_queue",  label: "Support Queue",   href: "/support" },
  { pageKey: "planning_board", label: "Planning Board",  href: "/planning" },
  { pageKey: "tint_manager",   label: "Tint Manager",    href: "/tint/manager" },
  { pageKey: "tint_operator", label: "Tint Operator",  href: "/tint/operator" },
  { pageKey: "dispatcher",    label: "Dispatcher",     href: "/dispatcher" },
  { pageKey: "warehouse",     label: "Warehouse",       href: "/warehouse" },
  { pageKey: "customers",     label: "Customers",      href: "/admin/customers" },
  { pageKey: "skus",          label: "SKUs",           href: "/admin/skus" },
  { pageKey: "routes_areas",  label: "Routes",         href: "/admin/routes" },
  { pageKey: "vehicles",      label: "Vehicles",        href: "/admin/vehicles" },
];

// Per-role href overrides: non-admin roles access shared pages via their own route group
const ROLE_HREF_OVERRIDES: Record<string, Record<string, string>> = {
  support: {
    customers:    "/support/customers",
    skus:         "/support/skus",
    routes_areas: "/support/routes",
    vehicles:     "/support/vehicles",
  },
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
};

export function buildNavItems(
  allPerms:  Record<string, PagePermissions>,
  roleSlug?: string,
): NavItemConfig[] {
  const overrides = roleSlug ? (ROLE_HREF_OVERRIDES[roleSlug] ?? {}) : {};
  return PAGE_NAV_MAP
    .filter((item) => allPerms[item.pageKey]?.canView === true)
    .map((item) =>
      overrides[item.pageKey] !== undefined
        ? { ...item, href: overrides[item.pageKey] }
        : item,
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type PageKey =
  | "dashboard"
  | "users"
  | "system_config"
  | "permissions"
  | "customers"
  | "skus"
  | "routes_areas"
  | "vehicles"
  | "import_obd"
  | "support_queue"
  | "tint_manager"
  | "tint_operator"
  | "planning_board"
  | "dispatcher"
  | "warehouse";

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
  "dashboard", "users", "system_config", "permissions",
  "customers", "skus", "routes_areas", "vehicles",
  "import_obd", "support_queue", "planning_board", "tint_manager", "tint_operator",
  "dispatcher", "warehouse",
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
