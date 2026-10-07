import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { PlaceOrderAccessProvider } from "@/components/place-order/place-order-access-provider";
import { ChallanOrdersAccessProvider } from "@/components/challan-orders/challan-orders-access-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

// Place Order layout — role-based sidebar + auth gate.
//
// Was previously a full-bleed wrapper (no sidebar) so the photo-grid + cart
// panel could use every pixel. Restored to the shared role-sidebar pattern
// (same as /mail-orders, /tint/manager, etc.) so dispatcher/support users
// landing here can navigate to their other permitted pages. The sidebar is
// 72px collapsed, expands to 220px on hover as an overlay (no content shift).

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function PlaceOrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "place_order", "canView");
  if (!allowed) redirect("/unauthorized");

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  // Ship To block on the cart panel (2026-09-17). Read off the SAME `allPerms`
  // map — no second query. Admin / superuser are all-true inside
  // getAllPermissionsForRoles; everyone else needs a place_order_ship_to canEdit
  // tick. Absent row reads as false. canEdit only — canView means nothing here.
  const canShipTo = allPerms["place_order_ship_to"]?.canEdit ?? false;
  // The Challan order switch (2026-10-07, Challan orders slice 3). Same map, same
  // canEdit-only meaning. Drawing only — POST /api/place-order/challan-orders
  // re-checks the tick on every create.
  const canCreateChallan = allPerms["place_order_challan"]?.canEdit ?? false;
  // The shared Challan orders screen (2026-10-07, slice 5) — the top-bar link
  // (canView) and paste / unlink (canEdit). Same map; the routes re-check.
  const canViewChallanOrders = allPerms["challan_orders"]?.canView ?? false;
  const canEditChallanOrders = allPerms["challan_orders"]?.canEdit ?? false;

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
        <PlaceOrderAccessProvider canShipTo={canShipTo} canCreateChallan={canCreateChallan}>
          <ChallanOrdersAccessProvider canView={canViewChallanOrders} canEdit={canEditChallanOrders} isAdmin={isSuperuser(session)}>
            {children}
          </ChallanOrdersAccessProvider>
        </PlaceOrderAccessProvider>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
