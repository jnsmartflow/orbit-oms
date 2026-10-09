import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkAnyPermission } from "@/lib/permissions";
import { ChallanContent } from "@/components/tint/challan-content";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Delivery Challans",
};

// delivery_challans tick, not a job title (2026-10-09). canView opens the
// screen; canEdit draws Edit/Save — PATCH /api/tint/manager/challans/[orderId]
// re-checks the same canEdit. ⚠ The second mount, app/(tint)/challan/page.tsx,
// is still role-gated (not in the sidebar; left on purpose).
export default async function ChallanPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "delivery_challans", "canView");
  if (!allowed) redirect("/unauthorized");

  const canEdit = await checkAnyPermission(roles, "delivery_challans", "canEdit");

  return <ChallanContent canEdit={canEdit} />;
}
