import { prisma } from "@/lib/prisma";
import { ContactRolesTable } from "@/components/admin/contact-roles-table";

export const dynamic = "force-dynamic";

export default async function ContactRolesPage() {
  const rows = await prisma.contact_role_master.findMany({ orderBy: { name: "asc" } });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Contact Roles</h1>
        <p className="text-sm text-slate-500 mt-1">
          Roles assigned to delivery point contacts (Owner, Contractor, Manager, Site Engineer…).
        </p>
      </div>
      <ContactRolesTable
        initialRows={rows.map((r) => ({ id: r.id, name: r.name, isActive: r.isActive }))}
      />
    </div>
  );
}
