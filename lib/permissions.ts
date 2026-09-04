import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getAccessSource } from "@/lib/access/source";
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
  // CI — Goods Return Note (2026-09-01). Stock coming BACK from a customer; the
  // return counterpart to MRN directly above. One route, two faces branching by
  // ROLE (floor_supervisor phone / billing desk), same as MRN.
  //
  // ⚠ THIS POSITION IS BEHAVIOUR, NOT COSMETICS — the same warning MRN's line
  // carries, for the same reason. MobileShell's phone Home target is
  // navItems[0]?.href (components/shared/mobile-shell.tsx) and buildNavItems
  // preserves this array's order, so an entry becomes Home for any role whose
  // first GRANTED entry it displaces.
  //
  // Sitting here after mrn, it displaces nobody. VERIFIED 2026-09-01 by deriving
  // navItems[0] against the LIVE grants, before and after this line:
  //   floor_supervisor  /picking            (idx 2,  picking)            unchanged
  //   billing_operator  /place-order        (idx 12, place_order)        unchanged
  //   operations        /operations/tinting (idx 0,  operations_tinting) unchanged
  // Re-derive that comparison before moving this line; do not trust this comment.
  { pageKey: "ci",                 label: "CI",            href: "/ci" },
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
  // CI — Goods Return Note (2026-09-01). Live `role_permissions` rows exist for
  // billing_operator / floor_supervisor / operations, and prisma/seed.ts carries
  // them, so the key is real — the API routes gate on it today.
  // ⚠ DELIBERATELY NOT IN PAGE_NAV_MAP YET. There is no /ci page until step 5;
  // a nav entry now would put a sidebar link in front of three roles that 404s.
  // It joins the nav in step 6, and its POSITION there is behaviour, not
  // cosmetics — see the PAGE_NAV_MAP comment above `mrn`.
  | "ci"
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
  "place_order", "trip_report", "mail_orders", "mrn", "ci",
  "delivery_challans", "shade_master", "sampling_library", "ti_report",
  "settings_hide",
];

// ── Which actions the code actually ASKS about, per page ──────────────────────
//
// 🔴 WHAT THIS IS FOR, AND WHAT IT MUST NEVER DO.
// The /admin/access screen greys a cell to a DASH where the app has no such
// check for that page — so an admin cannot switch on a flag that gates nothing.
// That already happened without it: eight canExport grants are true in the
// database right now and not one of them does anything.
//
// ⚠ THIS MAP IS ADVISORY AND COSMETIC. Every user_page_access row still stores
// all five booleans, and every read and write handles all five. The map only
// decides whether a cell renders as a checkbox or a dash. A stale entry here
// must therefore degrade to "the screen showed a dash it should not have" —
// never to a value being dropped, skipped or overwritten. NEVER use it to
// filter what is read, saved, compared, or seeded.
//
// SOURCE: docs/prompts/drafts/code-discovery-2026-08-30-permission-actions.md
// §2 (per-flag call-site census) and §5 (Export and Delete, settled). Verified
// by call site, not by intent: canExport and canDelete are each read in exactly
// ONE module (MRN), and canImport in two helper call sites plus the CSV buttons
// on the four master-data screens.
//
// 🔴 UPDATE THIS WHENEVER A NEW ACTION CHECK IS ADDED ANYWHERE. If you write a
// new `checkPermission(..., "<key>", "<action>")` or `checkAnyPermission(...)`,
// or start reading a flag off a PagePermissions object to gate a control, and
// the (key, action) pair is not listed below, ADD IT — otherwise /admin/access
// shows a dash for a switch that now does something, and nobody can turn it on.
// The reverse is just as true: if a check is deleted, remove its entry.

/** Actions that are NOT asked on every page, and the pages that do ask them. */
const ACTION_PAGES: Record<Exclude<ActionKey, "canView">, readonly PageKey[]> = {
  // 38 live call sites — every write route on Floor / MRN / Picking /
  // Sampling / Tint / master data (§2.2).
  canEdit: [
    "mrn", "picking", "tint_manager", "tint_operator", "mail_orders", "floor",
    "sampling_library", "routes_areas", "customers", "skus", "vehicles",
  ],
  // Two helper call sites — import/obd:3796 and sampling-library:253 — plus the
  // CSV import buttons on the four master-data screens, which read canImport
  // off PagePermissions to show or hide themselves (§2.1 direct field reads).
  canImport: [
    "import_obd", "sampling_library",
    "customers", "skus", "routes_areas", "vehicles",
  ],
  // MRN ONLY: api/mrn/[mrnId]/export:58 and mrn/[mrnId]/sheet/page:41.
  // ⚠ The attendance CSV export does NOT read canExport — it is a hardcoded
  // admin role check (§5), so attendance_admin gets a dash here even though
  // ops_admin holds canExport = true live. The dash is telling the truth.
  canExport: ["mrn"],
  // MRN ONLY: api/mrn/[mrnId]/delete:53. Every other delete path uses a role
  // check instead (§5).
  canDelete: ["mrn"],
};

const ACTION_PAGE_SETS = {
  canEdit:   new Set<string>(ACTION_PAGES.canEdit),
  canImport: new Set<string>(ACTION_PAGES.canImport),
  canExport: new Set<string>(ACTION_PAGES.canExport),
  canDelete: new Set<string>(ACTION_PAGES.canDelete),
} as const;

/**
 * Does the app ask this question for this page? `canView` is asked on every
 * page (75 call sites); the other four only where ACTION_PAGES lists them.
 * Advisory only — see the block above.
 */
export function isActionAvailable(pageKey: string, action: ActionKey): boolean {
  if (action === "canView") return true;
  return ACTION_PAGE_SETS[action].has(pageKey);
}

// ── Display metadata for the /admin/access screen ─────────────────────────────
//
// Friendly names come from PAGE_NAV_MAP wherever the key appears there. FIVE of
// the 27 ALL_PAGE_KEYS are not in it and are labelled here instead:
// dashboard, users, system_config, permissions, settings_hide.
// (`attendance` IS in PAGE_NAV_MAP — but it and `attendance_admin` both carry
// the label "Attendance" there, which is fine in a sidebar where only one is
// ever shown and useless in a list where both appear, so both are overridden.)

const PAGE_LABEL_OVERRIDES: Record<string, string> = {
  dashboard:        "Dashboard",
  users:            "Users",
  system_config:    "System Config",
  permissions:      "Permissions (role grid)",
  settings_hide:    "Hide Rules",
  attendance:       "Attendance — their own",
  attendance_admin: "Attendance — everyone",
};

/** Friendly name for a page key: PAGE_NAV_MAP first, override, then the key. */
export function pageLabel(pageKey: string): string {
  const override = PAGE_LABEL_OVERRIDES[pageKey];
  if (override) return override;
  return PAGE_NAV_MAP.find((i) => i.pageKey === pageKey)?.label ?? pageKey;
}

/**
 * The 27 keys grouped for display. Every key in ALL_PAGE_KEYS appears exactly
 * once — ACCESS_SECTIONS is asserted against it by the access page, so adding a
 * key to ALL_PAGE_KEYS without adding it here is caught rather than silently
 * hiding a row.
 */
export const ACCESS_SECTIONS: { label: string; keys: PageKey[] }[] = [
  { label: "Operations", keys: [
    "picking", "floor", "mrn", "ci", "mail_orders", "place_order",
    "trip_report", "import_obd",
  ] },
  { label: "Tinting", keys: [
    "tint_manager", "tint_operator", "operations_tinting",
    "operations_tint_operator", "delivery_challans", "shade_master",
    "sampling_library", "ti_report",
  ] },
  { label: "Master data", keys: ["customers", "skus", "routes_areas", "vehicles"] },
  { label: "Admin panel", keys: [
    "dashboard", "users", "system_config", "permissions", "settings_hide",
  ] },
  { label: "Attendance", keys: ["attendance", "attendance_admin"] },
];

/** Every key in ALL_PAGE_KEYS, for callers that need the flat list. */
export function allPageKeys(): PageKey[] {
  return [...ALL_PAGE_KEYS];
}

// ── WHERE PERMISSIONS COME FROM — the ACCESS_SOURCE switch ────────────────────
//
// Step 4 of the role → user access conversion. The five resolvers below are the
// ONLY things that changed: each now asks getAccessSource() where to read from.
//
//   "role" (the default, and what ships)  → role_permissions, by role slug
//   "user"                                → user_page_access, by user id
//
// Everything else is untouched by design: signatures, return shapes, the admin
// short-circuits, ROLE_HREF_OVERRIDES, buildNavItems' attendance special case,
// every requireRole/hasRole gate, and role_permissions itself, which the old
// screen still writes and role mode still reads.
//
// 🔴 HOW THE userId REACHES A RESOLVER THAT TAKES ROLE SLUGS.
// It does not arrive as an argument — the signatures had to stay as they are,
// and threading a new parameter through 139 call sites would be a far larger
// change than the one being made. Instead user mode calls auth() and reads
// session.user.id, which is already on the JWT and is already what every one of
// those call sites derived its role slugs from. Same request, same session, so
// the id and the slugs always describe the same person.
//
// ⚠ THE ONE PLACE THAT ASSUMPTION DOES NOT HOLD is a caller asking about
// SOMEBODY ELSE — /admin/access computing what each of 39 people is granted.
// Such a caller must use getRolePermissionsForRoles() below, which is pinned to
// the role table and never consults the switch. If a future caller needs
// another person's EFFECTIVE permissions, it needs a by-id resolver; do not
// reach for these five, because they will answer about the logged-in admin.
//
// If auth() yields no usable id — no session, or a non-request context such as
// a script — user mode falls back to the ROLE path for that call. Same
// direction as every other failure here: back to what production already does.

/**
 * The two things every resolver needs off the session, read in ONE auth() call.
 * Kept together deliberately: the superuser short-circuit and the user-mode id
 * both come from the same session, and fetching them separately would double
 * the auth() cost of every permission check.
 *
 * Never throws — an unavailable session yields "no id, not a superuser", which
 * sends the caller down the role path. Same failure direction as everything
 * else in this file.
 */
interface SessionAccess { userId: number | null; isSuperuser: boolean }

async function sessionAccess(): Promise<SessionAccess> {
  try {
    const session = await auth();
    const raw = session?.user?.id;
    const id = raw ? parseInt(raw, 10) : NaN;
    return {
      userId: Number.isFinite(id) ? id : null,
      // ⚠ Only the flag arm here. The ROLE arm of the safety rule is the
      // pre-existing `roleSlug === "admin"` test each resolver already does
      // BEFORE calling this, which is why that test is still there and must
      // stay — see lib/rbac.ts for the rule in full.
      isSuperuser: session?.user?.isSuperuser === true,
    };
  } catch {
    return { userId: null, isSuperuser: false };
  }
}

/**
 * Should this call read user_page_access? The id if so, else null (take the
 * role path). Takes the already-fetched session so no second auth() happens.
 */
async function userModeId(access: SessionAccess): Promise<number | null> {
  if ((await getAccessSource()) !== "user") return null;
  if (access.userId === null) {
    console.error("[access] user mode is on but no session user id is available; using role mode for this call");
  }
  return access.userId;
}

/** One user's stored ticks for one page. Absent row ≡ all false. */
async function userPagePerms(userId: number, pageKey: PageKey): Promise<PagePermissions> {
  const row = await prisma.user_page_access.findUnique({
    where:  { userId_pageKey: { userId, pageKey } },
    select: { canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true },
  });
  if (!row) return ALL_FALSE;
  return {
    canView:   row.canView,
    canImport: row.canImport,
    canExport: row.canExport,
    canEdit:   row.canEdit,
    canDelete: row.canDelete,
  };
}

/** All of one user's stored ticks, as the same map shape the role path returns. */
async function userAllPerms(userId: number): Promise<Record<string, PagePermissions>> {
  const rows = await prisma.user_page_access.findMany({
    where:  { userId },
    select: {
      pageKey: true,
      canView: true, canImport: true, canExport: true, canEdit: true, canDelete: true,
    },
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
  // Deliberately NOT densified to all 27 keys. The role path omits keys no role
  // grants, and every consumer reads an absent key as false
  // (`allPerms[key]?.canView === true`). Leaving the shapes as close as they are
  // keeps the two modes indistinguishable to callers.
  return result;
}

/**
 * The OR-merge across roles, straight from role_permissions — the role path,
 * factored out so both getAllPermissionsForRoles() and the switch-independent
 * getRolePermissionsForRoles() share one body rather than two copies that can
 * drift.
 */
async function mergeRolePerms(roleSlugs: string[]): Promise<Record<string, PagePermissions>> {
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

/**
 * What the ROLE system grants these slugs — ALWAYS, whatever ACCESS_SOURCE
 * says. This is not a permission check and must never be used as one.
 *
 * It exists for /admin/access, which shows each person's stored ticks against
 * what their job title would give them. That comparison is meaningless if it
 * follows the switch, and actively wrong in user mode: the five resolvers
 * answer about the LOGGED-IN user, so a screen asking about 39 other people
 * would get the admin's own permissions 39 times.
 */
export async function getRolePermissionsForRoles(
  roleSlugs: string[],
): Promise<Record<string, PagePermissions>> {
  if (roleSlugs.length === 0) return {};
  if (roleSlugs.includes("admin")) {
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }
  return mergeRolePerms(roleSlugs);
}

// ── Functions ─────────────────────────────────────────────────────────────────

export async function checkPermission(
  roleSlug: string,
  pageKey: PageKey,
  action: ActionKey,
): Promise<boolean> {
  // SAFETY RULE (lib/rbac.ts): flag OR role. The ROLE arm is first because it
  // is free — no session read — and short-circuits before auth() is touched.
  if (roleSlug === "admin") return true;

  const access = await sessionAccess();
  if (access.isSuperuser) return true;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    return (await userPagePerms(userId, pageKey))[action];
  }

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
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlugs.includes("admin")) return true;
  if (roleSlugs.length === 0) return false;

  const access = await sessionAccess();
  if (access.isSuperuser) return true;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    // No merge in user mode — one person, one row. The OR across roles that
    // this function exists to do has already happened, once, when the ticks
    // were written.
    return (await userPagePerms(userId, pageKey))[action];
  }

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
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlug === "admin") return ALL_TRUE;

  const access = await sessionAccess();
  if (access.isSuperuser) return ALL_TRUE;   // flag arm

  const userId = await userModeId(access);
  if (userId !== null) {
    return userPagePerms(userId, pageKey);
  }

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
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlug === "admin") {
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }

  const access = await sessionAccess();
  if (access.isSuperuser) {   // flag arm
    return Object.fromEntries(ALL_PAGE_KEYS.map((key) => [key, ALL_TRUE]));
  }

  const userId = await userModeId(access);
  if (userId !== null) {
    return userAllPerms(userId);
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
  // SAFETY RULE (lib/rbac.ts): flag OR role. Role arm first — see above.
  if (roleSlugs.includes("admin")) {
    return getAllPermissionsForRole("admin");
  }

  const access = await sessionAccess();
  if (access.isSuperuser) {   // flag arm
    return getAllPermissionsForRole("admin");
  }

  const userId = await userModeId(access);
  if (userId !== null) {
    return userAllPerms(userId);
  }

  return mergeRolePerms(roleSlugs);
}
