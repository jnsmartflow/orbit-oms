import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { TIReportContent } from "@/components/tint/ti-report-content";

export const dynamic = "force-dynamic";

export const metadata = { title: "TI Report" };

export default async function TIReportPage() {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN]);

  return <TIReportContent />;
}
