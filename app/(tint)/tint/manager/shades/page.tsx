import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { ShadeMasterContent } from "@/components/tint/shade-master-content";

export const dynamic = "force-dynamic";

export default async function ShadesPage() {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN, ROLES.TINT_MANAGER, ROLES.TINT_OPERATOR]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Shade Master</h1>
        <p className="text-sm text-slate-500 mt-1">
          View and manage all saved shade formulas.
        </p>
      </div>
      <ShadeMasterContent />
    </div>
  );
}
