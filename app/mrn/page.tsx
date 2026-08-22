import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { MrnShell } from "@/components/mrn/mrn-shell";

export const dynamic = "force-dynamic";

// /mrn — one route, two faces, branched on primaryRole.
//
// ⚠ NO layout.tsx, and that is forced rather than stylistic. RoleLayoutClient
// carries `workflowTabs` / `activeTabKey` / `onTabChange` / `hideBar`, all four
// owned by client state inside MrnShell (the active tab, the fetch driving the
// counts, whether a detail screen is open). A server layout.tsx cannot supply
// them, and a layout rendering a bare RoleLayoutClient would permanently lock
// the supervisor to the default Home/Menu/You bar. /floor gets away with a
// layout because it is desktop-only and supplies none of the four.
//
// Copies app/picking/page.tsx, deliberately — the reference server page for a
// role-branched module shell (CLAUDE_UI.md §59.4).
//
// NO first-paint data is seeded here. Step 9 can decide whether it wants any;
// adding it now would mean writing a prop the placeholder does not use.

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function MrnPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  // canView + admin bypass, the same shape as the picking page and the MRN API
  // routes. The page gate and the route gates are separate on purpose: this
  // one stops the SCREEN rendering, and app/api/mrn/* stop the DATA, which is
  // reachable directly by URL.
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage: session.user.rolloutStage,
  });

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter((item) => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  // The role branch — NEVER a viewport branch. There is no `md:` switch here:
  // /picking removed its width switch in July 2026 and MRN never had one.
  //
  // floor_supervisor gets the phone face with its own bottom tabs; everyone
  // else who can see MRN (billing_operator, operations, admin) gets billing's
  // desktop rail. Roles beyond floor_supervisor could be added to this test
  // later, but that is a product decision, not a default.
  const showSupervisorFace = primaryRole === "floor_supervisor";

  // What this role may DO, resolved from the same map buildNavItems already
  // read — no second query.
  //
  // ⚠ THIS IS FOR HIDING CONTROLS, NEVER FOR AUTHORISATION. Every MRN route
  // re-checks the permission server-side and that is what actually stops a
  // write; this only stops the screen offering a button the server would
  // refuse. Defence in depth: if these two ever disagree, the ROUTE is right.
  //
  // `operations` was the case that exposed the gap — it holds canEdit true but
  // canDelete FALSE, so Delete rendered, was clickable, and came back
  // "Forbidden". Correct refusal, wrong screen.
  const perms = allPerms["mrn"];
  const mrnPerms = {
    // admin has no role_permissions rows at all — getAllPermissionsForRoles
    // short-circuits it to all-true, but an absent entry must still fail
    // CLOSED for everyone else rather than opening every control.
    canEdit: perms?.canEdit ?? false,
    canExport: perms?.canExport ?? false,
    canDelete: perms?.canDelete ?? false,
  };

  // session.user.id is a string (lib/auth.ts). The supervisor card compares it
  // against `unloadingStartById` so a truck he holds reads "you" rather than his
  // own name back at him. Null rather than 0 on a garbage id — a 0 would match
  // nothing, but it would also read as a real id to anything downstream.
  const parsedViewerId = Number(session.user.id);
  const viewerId =
    Number.isInteger(parsedViewerId) && parsedViewerId > 0 ? parsedViewerId : null;

  return (
    <RoleSidebarProvider>
      <MrnShell
        perms={mrnPerms}
        viewerId={viewerId}
        // `floor_supervisor` and `picker` are not in the RoleSidebarRole union;
        // app/picking/page.tsx casts here for the same reason. Widening the
        // union is a shared-component change and belongs in its own commit.
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
        showSupervisorFace={showSupervisorFace}
      />
    </RoleSidebarProvider>
  );
}
