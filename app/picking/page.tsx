import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { PickingMobileShell } from "@/components/picking/picking-mobile-shell";
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

// isPickedTodayIST + the pending/done split left this file on 2026-07-29 for
// lib/picking/picker-split.ts (splitPickerRows), and the CALLER is now
// PickerPickingShell, not this page: the picker face fetches its own rows
// because a router.refresh() is discarded by the history pop that closes a
// bill. This page still resolves the FIRST paint — it just hands over rows
// instead of two pre-split lists.

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

  // Gates the temporary push-test link (scaffolding, removed after the push
  // rollout). admin OR operations — operations already has picking.canView and
  // is the account actually used to test on mobile; admin's surface isn't
  // mobile-friendly. Reuses the same `roles` array the gate above uses.
  const canSeePushTest = roles.includes("admin") || roles.includes("operations");

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
  // always mounted; a role face needs an actual branch).
  //
  // ⚠ CORRECTED 2026-07-28. This comment used to say `isPickerRole` was "a dead
  // path in practice: `picker` has no `role_permissions` row for `picking` yet",
  // and that the test hook was the only way in. BOTH ARE FALSE and have been
  // since 2026-07-20, when the grants were seeded (prisma/seed.ts) — confirmed
  // against live on 2026-07-27: picker canView=true canEdit=false,
  // floor_supervisor canView=true canEdit=true. `isPickerRole` is now THE LIVE
  // PATH: a real picker passes the canView gate above and lands here. Step 5
  // (commit c4323cd4) made it his login destination.
  //
  // The `?view=picker&as=<id>` hook below is admin-OR-operations only and is
  // now purely a PREVIEW for people who are not pickers — it is no longer
  // load-bearing for real access. Scaffolding; safe to narrow or remove.
  const canUseTestHook  = roles.includes(ROLES.ADMIN) || roles.includes(ROLES.OPERATIONS);
  const isPickerRole    = primaryRole === "picker";
  const showPickerFace  = isPickerRole || (canUseTestHook && searchParams?.view === "picker");

  let pickerFaceData: {
    rows: PickingQueueRow[];
    pickers: PickerRosterEntry[];
    activePickerId: number | null;
  } | null = null;

  if (showPickerFace) {
    // Sequential awaits only — never prisma.$transaction (CORE §3).
    const pickers = canUseTestHook ? await getActivePickers() : [];

    // viewerName was dropped 2026-07-29 with the hand-rolled teal strip that
    // was its only render site (the shared ModuleMobileHeader carries a title
    // and an avatar, no subtitle). Identity is still visible: a real picker
    // sees his own name in the You sheet, and an admin previewing someone
    // else's board reads the name off the "view as" dropdown below, which is
    // the authoritative control for that state anyway.
    let viewerId: number | null;
    if (isPickerRole) {
      viewerId = Number(session.user.id);
    } else {
      const requestedId = searchParams?.as ? Number(searchParams.as) : null;
      const viewedPicker =
        (requestedId !== null ? pickers.find((p) => p.id === requestedId) : undefined) ?? pickers[0];
      viewerId = viewedPicker?.id ?? null;
    }

    // Scoped server-side, BEFORE anything reaches the client — filtering on
    // pickerId (a real FK), never on assignedToName (a display string, not
    // a scope boundary). No new API route; getPickingQueue() is the exact
    // function app/api/picking/queue/route.ts already calls.
    // scope=openPending (2026-07-20 date-zones redesign) — the picker's own
    // board is a mobile face too, so his Pending tab must show carry-over
    // bills from earlier days, not just today's.
    // Done = today only (daily receipt), fenced on pickedAt IST — see picking
    // design 2026-07-20.
    // Narrowed to HIS bills in the query itself (2026-07-29) rather than
    // fetched board-wide and filtered after: the shell refetches this same
    // shape client-side, where the whole board would be ~202 KB per fetch and
    // would put every other picker's work on his phone. splitPickerRows still
    // filters by pickerId on top — idempotent here, and it must keep doing so
    // because it is the rule, not an optimisation.
    const queue = await getPickingQueue({
      scope: "openPending",
      pickerId: viewerId ?? undefined,
    });

    pickerFaceData = {
      // Rows, not the split: the shell owns the split now (one rule, both
      // sides) and needs the raw rows to re-split after each refetch. This is
      // his handful of bills, so the RSC payload is unchanged in practice.
      rows: queue.rows,
      pickers,
      activePickerId: viewerId,
    };
  }

  return (
    <RoleSidebarProvider>
      <PickingMobileShell
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
        showPickerFace={showPickerFace}
        canSeePushTest={canSeePushTest}
        /* Seed data for the picker face — first paint only. The shell splits
           these rows with splitPickerRows (the same rule this file used to
           apply) for both lists AND the tab counts, then owns them: every
           later update is its own fetch, not a re-render of this page. */
        pickerRows={pickerFaceData?.rows}
        pickerViewerId={pickerFaceData?.activePickerId}
      >
        {/* ONE face at every width — the card board (2026-07-28). The desktop
            table that used to render here behind `hidden md:block` is retired;
            it sits at archive/2026-07-picking-desktop/. A supervisor who wants
            a desk screen uses /floor. Only the role branch is left: supervisor
            board vs. the picker's own "My Picks". */}
        <div className="block">
          {showPickerFace && pickerFaceData ? (
            <PickerMyPicksBoard
              isAdmin={canUseTestHook}
              pickers={pickerFaceData.pickers}
              activePickerId={pickerFaceData.activePickerId}
            />
          ) : (
            <PickingBoardMobile />
          )}
        </div>
      </PickingMobileShell>
    </RoleSidebarProvider>
  );
}
