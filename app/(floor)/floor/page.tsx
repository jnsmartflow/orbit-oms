import { FloorPage } from "@/components/floor/floor-page";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// `floor` canEdit, resolved HERE on the server and handed down (2026-09-24) —
// the layout has already admitted canView. It only decides what is DRAWN (the
// Hand toggle is hidden without it, UI §10); every route still re-checks.
export default async function Page() {
  const session = await auth();
  const roles = session?.user ? session.user.roles ?? [session.user.role] : [];
  const canEdit = session?.user ? await checkAnyPermission(roles, "floor", "canEdit") : false;
  return <FloorPage canEdit={canEdit} />;
}
