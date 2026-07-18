import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { PickingQueue } from "@/components/picking/picking-queue";
import { PickingBoardMobile } from "@/components/picking/picking-board-mobile";
import { PickerMyPicksBoard } from "@/components/picking/picker-my-picks-board";
import { ROLES } from "@/lib/rbac";
import { getPickingQueue } from "@/lib/picking/queue";
import { getActivePickers, type PickerRosterEntry } from "@/lib/picking/picker-roster";
import type { PickingQueueRow } from "@/lib/picking/types";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

interface PickingPageProps {
  searchParams: { view?: string; as?: string };
}

export default async function PickingPage({ searchParams }: PickingPageProps) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) redirect("/unauthorized");
  }

  const allPerms = await getAllPermissionsForRoles(roles);
  const navItems = buildNavItems(allPerms, primaryRole, {
    attendanceTestUser: session.user.attendanceTestUser,
    rolloutStage:       session.user.rolloutStage,
  });

  const seen = new Set<string>();
  const dedupedNavItems = navItems.filter(item => {
    if (seen.has(item.pageKey)) return false;
    seen.add(item.pageKey);
    return true;
  });

  const userName     = session.user.name ?? "User";
  const userInitials = getInitials(userName);

  // ── Picker face — real conditional rendering, not a third CSS breakpoint
  // (discovery §F2: the existing hidden/block switch below has both boards
  // always mounted; a role face needs an actual branch). `isPickerRole` is
  // currently a dead path in practice: `picker` has no `role_permissions`
  // row for `picking` yet (deliberate — see the gate above, which already
  // redirects a real picker to /unauthorized before this line ever runs).
  // The only live way in this stage is the admin-only `?view=picker` test
  // hook (discovery §E5), mirroring the `?draft=on`-style gating already
  // used elsewhere in this codebase (CLAUDE_UI.md §55).
  // TEST HOOK — temporary. Widened 2026-07-17 from admin-only to admin OR
  // operations so both can preview the picker face without a real grant.
  // Narrow this back (or remove it) once picker/floor_supervisor get actual
  // role_permissions rows for "picking" — this is scaffolding, not the
  // real access model.
  const canUseTestHook  = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATIONS);
  const isPickerRole    = primaryRole === "picker";
  const showPickerFace  = isPickerRole || (canUseTestHook && searchParams?.view === "picker");

  let pickerFaceData: {
    pending: PickingQueueRow[];
    done: PickingQueueRow[];
    viewerName: string;
    pickers: PickerRosterEntry[];
    activePickerId: number | null;
  } | null = null;

  if (showPickerFace) {
    // Sequential awaits only — never prisma.$transaction (CORE §3).
    const pickers = canUseTestHook ? await getActivePickers() : [];

    let viewerId: number | null;
    let viewerName: string;
    if (isPickerRole) {
      viewerId = Number(session.user.id);
      viewerName = userName;
    } else {
      const requestedId = searchParams?.as ? Number(searchParams.as) : null;
      const viewedPicker =
        (requestedId !== null ? pickers.find((p) => p.id === requestedId) : undefined) ?? pickers[0];
      viewerId = viewedPicker?.id ?? null;
      viewerName = viewedPicker?.name ?? "—";
    }

    // Scoped server-side, BEFORE anything reaches the client — filtering on
    // pickerId (a real FK), never on assignedToName (a display string, not
    // a scope boundary). No new API route; getPickingQueue() is the exact
    // function app/api/picking/queue/route.ts already calls.
    const queue = await getPickingQueue();
    const myRows = viewerId === null ? [] : queue.rows.filter((r) => r.pickerId === viewerId);

    pickerFaceData = {
      // isChecked excluded from pending / included in done (2026-07-18) —
      // without this, an approved (PICK_CHECKED) bill has isDone: false and
      // would fall back into "pending" with a live-looking Mark Done CTA on
      // a bill the supervisor already finished. It stays in his own Done
      // tab regardless of what the supervisor does with it afterward.
      pending: myRows.filter((r) => !r.isDone && !r.isChecked),
      done: myRows.filter((r) => r.isDone || r.isChecked),
      viewerName,
      pickers,
      activePickerId: viewerId,
    };
  }

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        {/* Same route, two faces — desktop table vs. mobile card board.
            Desktop is untouched regardless of role; only the mobile slot
            branches to the picker face. */}
        <div className="hidden md:block">
          <PickingQueue />
        </div>
        <div className="block md:hidden">
          {showPickerFace && pickerFaceData ? (
            <PickerMyPicksBoard
              pending={pickerFaceData.pending}
              done={pickerFaceData.done}
              viewerName={pickerFaceData.viewerName}
              isAdmin={canUseTestHook}
              pickers={pickerFaceData.pickers}
              activePickerId={pickerFaceData.activePickerId}
            />
          ) : (
            <PickingBoardMobile />
          )}
        </div>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
