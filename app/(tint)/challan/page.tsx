import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { ChallanContent } from "@/components/tint/challan-content";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Delivery Challans",
};

export default async function ChallanPage() {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

  return <ChallanContent />;
}
