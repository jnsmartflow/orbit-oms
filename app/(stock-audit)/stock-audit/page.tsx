import { StockAuditPage } from "@/components/stock-audit/audit-page";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// `stock_audit_manage` canEdit + canExport, resolved ONCE here on the server
// and handed down — the layout has already admitted canView. They decide only
// what is DRAWN (New audit / Counters / Close, and Export XLS); every
// /api/stock-audit route re-checks. The Freight Trips page pattern.
export default async function Page() {
  const session = await auth();
  const roles = session?.user ? session.user.roles ?? [session.user.role] : [];
  const canEdit = session?.user ? await checkAnyPermission(roles, "stock_audit_manage", "canEdit") : false;
  const canExport = session?.user ? await checkAnyPermission(roles, "stock_audit_manage", "canExport") : false;
  return <StockAuditPage canEdit={canEdit} canExport={canExport} />;
}
