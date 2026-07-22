import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { PickingMobileShell } from "@/components/picking/picking-mobile-shell";
import { PickingQueue } from "@/components/picking/picking-queue";
import { PickingBoardMobile } from "@/components/picking/picking-board-mobile";
import { PickerMyPicksBoard } from "@/components/picking/picker-my-picks-board";
import { ROLES } from "@/lib/rbac";
import { getISTDayRange } from "@/lib/dates";
import { getPickingQueue } from "@/lib/picking/queue";
import { getActivePickers, type PickerRosterEntry } from "@/lib/picking/picker-roster";
import type { PickingQueueRow } from "@/lib/picking/types";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/**
 * Did the picker finish this bill during TODAY in IST?
 *
 * The window comes from lib/dates.ts's getISTDayRange() — the same
 * Date.now()+IST-offset → read-UTC-parts → Date.UTC(...) derivation
 * lib/picking/queue.ts:getISTTodayDate() uses, never a naive local midnight.
 * That helper is preferred here over queue.ts's own (which is private, and
 * returns a date-ONLY anchor shaped for @db.Date equality): `pickedAt` is a
 * timestamptz, so it needs a half-open INSTANT window [start, end), not a
 * calendar-day value. Half-open also means a bill finished exactly at IST
 * midnight lands in the new day only — never counted twice.
 *
 * `pickedAt` is typed `Date | string | null` because PickingQueueRow crosses
 * a JSON boundary on the client path; on this server path it arrives as a
 * real Date. Both are handled. Date.parse() here operates on a full ISO
 * timestamp (spec-defined), NOT a bare "YYYY-MM-DD" — that is the parse
 * queue.ts warns against, and it is not this one.
 *
 * Returns FALSE on null or unparseable input. A done bill always has
 * pickedAt (POST /api/picking/done stamps it), so null means something is
 * wrong — and a bill we cannot date must not silently drift into a receipt
 * that claims it was finished today.
 */
function isPickedTodayIST(pickedAt: Date | string | null, start: Date, end: Date): boolean {
  if (pickedAt === null) return false;
  const ms = pickedAt instanceof Date ? pickedAt.getTime() : Date.parse(pickedAt);
  if (Number.isNaN(ms)) return false;
  return ms >= start.getTime() && ms < end.getTime();
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
    // scope=openPending (2026-07-20 date-zones redesign) — the picker's own
    // board is a mobile face too, so his Pending tab must show carry-over
    // bills from earlier days, not just today's.
    // Done = today only (daily receipt), fenced on pickedAt IST — see picking
    // design 2026-07-20.
    const queue = await getPickingQueue({ scope: "openPending" });
    const { start: istDayStart, end: istDayEnd } = getISTDayRange();
    const myRows = viewerId === null ? [] : queue.rows.filter((r) => r.pickerId === viewerId);

    pickerFaceData = {
      // PENDING — all dates, unchanged. isChecked excluded alongside isDone
      // (2026-07-18): without it an approved (PICK_CHECKED) bill has
      // isDone: false and would fall back into "pending" with a live-looking
      // Mark Done CTA on a bill the supervisor already finished. A bill he
      // has not finished carries over here indefinitely — deliberately NOT
      // date-fenced, so work left mid-shift is still waiting next morning.
      pending: myRows.filter((r) => !r.isDone && !r.isChecked),
      // DONE — today only. The stage test is unchanged (either finished
      // state counts, so a bill does not vanish from his own history the
      // moment a supervisor approves it); the new fence is on WHEN he
      // finished it. Fenced on pickedAt, NOT dispatchTargetDate: this tab is
      // his daily receipt — "what did I finish today" — so the day he did
      // the work is the only thing that decides membership. A bill he picked
      // yesterday evening for today's dispatch therefore belongs to
      // YESTERDAY's receipt, even though it is dispatching today.
      done: myRows.filter(
        (r) => (r.isDone || r.isChecked) && isPickedTodayIST(r.pickedAt, istDayStart, istDayEnd),
      ),
      viewerName,
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
      >
        {/* Same route, two faces — desktop table vs. mobile card board.
            Desktop is untouched regardless of role; only the mobile slot
            branches to the picker face. */}
        <div className="hidden md:block">
          <PickingQueue canSeePushTest={canSeePushTest} />
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
      </PickingMobileShell>
    </RoleSidebarProvider>
  );
}
