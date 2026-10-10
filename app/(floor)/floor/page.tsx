import { FloorPage } from "@/components/floor/floor-page";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { isSuperuser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// `floor` canEdit, resolved HERE on the server and handed down (2026-09-24) —
// the layout has already admitted canView. It only decides what is DRAWN (the
// Hand toggle is hidden without it, UI §10); every route still re-checks.
export default async function Page() {
  const session = await auth();
  const roles = session?.user ? session.user.roles ?? [session.user.role] : [];
  const canEdit = session?.user ? await checkAnyPermission(roles, "floor", "canEdit") : false;
  // The shared Challan orders screen (2026-10-07, slice 5) — its own key, same
  // rule: decides what is DRAWN (the tab; paste / unlink), the routes re-check.
  const canViewChallan = session?.user ? await checkAnyPermission(roles, "challan_orders", "canView") : false;
  const canEditChallan = canViewChallan ? await checkAnyPermission(roles, "challan_orders", "canEdit") : false;
  // Add invoices (2026-10-10) — Floor's first action tick, on top of floor canEdit
  // (the route asks both). Decides what is DRAWN; the route re-checks.
  const canAddInvoices = canEdit ? await checkAnyPermission(roles, "floor_add_invoices", "canEdit") : false;
  return (
    <FloorPage
      canEdit={canEdit}
      canViewChallan={canViewChallan}
      canEditChallan={canEditChallan}
      canAddInvoices={canAddInvoices}
      // S6-7: "Cancel OBD" on a linked bill in the Challan orders tab — admin only.
      isAdminChallan={isSuperuser(session)}
    />
  );
}
