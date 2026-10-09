import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission } from "@/lib/permissions";
import { TintManagerContent } from "@/components/tint/tint-manager-content";

export const dynamic = "force-dynamic";

// The board's OWN gate (2026-10-09). The layout also admits delivery_challans
// holders (for /tint/manager/challan), so it no longer guards this page.
export default async function TintManagerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) redirect("/unauthorized");

  return <TintManagerContent />;
}
