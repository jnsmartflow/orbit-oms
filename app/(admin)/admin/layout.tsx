import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";

export const dynamic = 'force-dynamic';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  requireRole(session, [ROLES.ADMIN]);

  const userName = session!.user.name ?? "Admin";
  const userRole = session!.user.role;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar userName={userName} userRole={userRole} />

      <div className="flex flex-col flex-1 min-w-0">
        <AdminHeader userName={userName} userRole={userRole} />
        {/* Push content below mobile header */}
        <main className="flex-1 overflow-y-auto p-6 md:pt-6 pt-20">
          {children}
        </main>
      </div>
    </div>
  );
}
