import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems, canViewAnyReport } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { TintManagerAccessProvider } from "@/components/tint/manager/tint-manager-access-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function TintManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  // tint_manager OR delivery_challans (2026-10-09): the Delivery Challans screen
  // lives under this layout, and its own tick must be enough to reach it. 🔴 So
  // this layout is NOT the board's gate — every page under it carries its own
  // (page.tsx = tint_manager; challan = delivery_challans; the master-data pages
  // their own keys; shades + ti-report requireRole). A new page here needs one.
  const allowed =
    (await checkAnyPermission(roles, "tint_manager", "canView")) ||
    (await checkAnyPermission(roles, "delivery_challans", "canView"));
  if (!allowed) redirect("/unauthorized");

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  // Job-panel tabs (2026-09-17). Read off the SAME `allPerms` map — no second
  // query. Admin / superuser are all-true inside getAllPermissionsForRoles;
  // everyone else needs the matching canView tick. Absent row reads as false.
  const canPanelItems    = allPerms["tint_panel_items"]?.canView    ?? false;
  const canPanelDetails  = allPerms["tint_panel_details"]?.canView  ?? false;
  const canPanelActivity = allPerms["tint_panel_activity"]?.canView ?? false;
  // Header "Reports" pill (2026-09-17): any report tick — the hub's own rule.
  const canReports       = canViewAnyReport(allPerms);

  // Action + tab ticks (2026-10-01, tabs build step 2 — plan §B). Same map, no
  // second query. An action = tint_manager canEdit AND its key's canEdit — the
  // exact rule lib/tint/manager-bill.ts checkTintAction enforces on the routes,
  // so a button is never drawn for a write the route would refuse. A tab = its
  // key's canView. Nothing consumes these yet (build steps 5-8).
  const hostEdit = allPerms["tint_manager"]?.canEdit ?? false;
  const edit = (k: string) => hostEdit && (allPerms[k]?.canEdit ?? false);
  const view = (k: string) => allPerms[k]?.canView ?? false;

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter(item => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName     = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        <TintManagerAccessProvider
          access={{
            canPanelItems,
            canPanelDetails,
            canPanelActivity,
            canReports,
            canEdit:           hostEdit,
            canHold:           edit("tint_hold"),
            canHand:           edit("tint_hand"),
            canSlot:           edit("tint_slot"),
            canShipTo:         edit("tint_ship_to"),
            canCancel:         edit("tint_cancel"),
            canCi:             edit("tint_ci"),
            canPickDelete:     edit("tint_pick_delete"),
            canShopDelivery:   edit("tint_shop_delivery"),
            canUrgent:         edit("tint_urgent"),
            canTiBulk:         edit("tint_ti_bulk"),
            canViewHoldTab:    view("tint_hold"),
            canViewCiTab:      view("tint_ci") || view("tint_cancel"),
            canViewPickDelete: view("tint_pick_delete"),
            // The customer save's own gate (POST /api/admin/customers) — the tag.
            canAddCustomer:    allPerms["customers"]?.canEdit ?? false,
          }}
        >
          {children}
        </TintManagerAccessProvider>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
