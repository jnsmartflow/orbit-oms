import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission, getAllPermissionsForRoles, buildNavItems } from "@/lib/permissions";
import { RoleSidebarProvider } from "@/components/shared/role-sidebar-provider";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import { isBillingV2Enabled } from "@/lib/billing/flag";
import { BillingV2Provider } from "@/components/billing/billing-v2-provider";
import { BillingPickingAccessProvider } from "@/components/billing/billing-picking-access-provider";
import { getNotesFontSize } from "@/lib/mail-orders/notes-font-size";
import { NotesFontSizeProvider } from "@/components/mail-orders/notes-font-size-provider";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";

export const dynamic = "force-dynamic";

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default async function MailOrdersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles       = session.user.roles ?? [session.user.role];
  const primaryRole = session.user.role;

  const allowed = await checkAnyPermission(roles, "mail_orders", "canView");
  if (!allowed) redirect("/unauthorized");

  const allPerms     = await getAllPermissionsForRoles(roles);
  const navItems     = buildNavItems(allPerms, primaryRole, {
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

  // ── Billing Picking tab access (2026-09-11) ─────────────────────────────────
  // Read off the SAME `allPerms` map resolved above for buildNavItems — no
  // second query and no client fetch, so this costs the page nothing. The map
  // already follows ACCESS_SOURCE (user_page_access in `user` mode), and admin /
  // superuser is short-circuited to all-true inside getAllPermissionsForRoles,
  // so both arms of the CORE §5 safety rule are already applied here.
  //
  // 🔴 `billing_picking` — the BILLING Picking tab. NOT `picking`, which is the
  // floor board at /picking. Reading the wrong one here would show the tab to
  // every picker who could reach this screen and hide it from billing.
  //
  // An absent key reads as false, which is what an absent row means everywhere
  // else in the app (`allPerms[key]?.canView === true`).
  //
  // ⚠ KNOWN LIMIT, deliberately not fixed here: someone holding billing_picking
  // but NOT mail_orders still cannot open /mail-orders at all — the guard above
  // redirects them before any of this runs. The Picking tab lives inside the
  // Orders screen today, so a Picking-only grant has nowhere to render. That is
  // the consolidated-shell session's problem, not this one's.
  const pickingPerms = allPerms["billing_picking"];
  const canViewBillingPicking = pickingPerms?.canView ?? false;
  const canEditBillingPicking = pickingPerms?.canEdit ?? false;

  // Billing v2 rollout (Phase 0) — global stage (billing_settings.rolloutStage)
  // AND the per-user opt-in, read FRESH each load (never cached onto the JWT;
  // see lib/billing/flag.ts for why). Read ONCE here and branched from, so the
  // whole module has a single gate rather than a check per screen.
  // `session.user.id` is a string, so Number(...) + the helper's own
  // Number.isFinite guard — the same shape app/picking/page.tsx uses. No extra
  // fetch: the session is already resolved above. Fails closed, so this cannot
  // break the page.
  const billingV2 = await isBillingV2Enabled(Number(session.user.id));

  // Notes-band text size — read FRESH here too, for the same reason and by the
  // same shape (Number(session.user.id) + the helper's own isFinite guard).
  // Sequential await, never $transaction. Fails soft to 11px, so this cannot
  // break the page any more than the flag above can.
  const notesFontSize = await getNotesFontSize(Number(session.user.id));

  return (
    <RoleSidebarProvider>
      <RoleLayoutClient
        role={primaryRole as RoleSidebarRole}
        userName={userName}
        userInitials={userInitials}
        navItems={dedupedNavItems}
      >
        {/* One server-side flag read, couriered to the client tree. Nothing
            below re-fetches it, and page.tsx keeps its bare <ComponentName />
            shape (CORE §3). The size provider nests INSIDE rather than merging
            into the flag provider — a rollout flag and a user preference are
            two concerns with two different defaults. */}
        <BillingV2Provider enabled={billingV2}>
          {/* Nested INSIDE the flag provider rather than merged into it: a
              rollout flag and a page permission are two different questions
              with two different owners, and the flag can be pulled in a hurry
              without touching anybody's grants. Same reasoning that keeps the
              notes-size provider separate below. */}
          <BillingPickingAccessProvider
            canView={canViewBillingPicking}
            canEdit={canEditBillingPicking}
          >
            <NotesFontSizeProvider size={notesFontSize}>{children}</NotesFontSizeProvider>
          </BillingPickingAccessProvider>
        </BillingV2Provider>
      </RoleLayoutClient>
    </RoleSidebarProvider>
  );
}
