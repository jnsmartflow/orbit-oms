import { FreightTripsPage } from "@/components/freight-trips/freight-trips-page";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// `freight_trips` canEdit, resolved HERE on the server and handed down — the
// layout has already admitted canView. It decides only what is DRAWN (every
// write control is hidden without it); every /api/freight-trips route re-checks.
export default async function Page() {
  const session = await auth();
  const roles = session?.user ? session.user.roles ?? [session.user.role] : [];
  const canEdit = session?.user ? await checkAnyPermission(roles, "freight_trips", "canEdit") : false;
  return <FreightTripsPage canEdit={canEdit} />;
}
