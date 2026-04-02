import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { ShadeMasterContent } from "@/components/tint/shade-master-content";

export const dynamic = "force-dynamic";

export default async function ShadesPage() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR]);

  return <ShadeMasterContent />;
}