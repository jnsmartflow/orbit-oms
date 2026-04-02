import { prisma } from "@/lib/prisma";
import { SOGroupsTable } from "@/components/admin/so-groups-table";

export const dynamic = "force-dynamic";

export default async function SOGroupsPage() {
  const [groups, salesOfficers] = await Promise.all([
    prisma.sales_officer_group.findMany({
      orderBy: { name: "asc" },
      include: {
        salesOfficer: { select: { id: true, name: true, employeeCode: true } },
        _count:       { select: { customers: true } },
      },
    }),
    prisma.sales_officer_master.findMany({
      where:   { isActive: true },
      orderBy: { name: "asc" },
      select:  { id: true, name: true, employeeCode: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Sales Officer Groups</h1>
        <p className="text-sm text-gray-500 mt-1">
          Customer portfolios assigned to sales officers. Use &quot;Reassign SO&quot; to bulk-move all customers in a group to a new officer.
        </p>
      </div>
      <SOGroupsTable
        initialRows={groups.map((g) => ({
          id:             g.id,
          name:           g.name,
          salesOfficerId: g.salesOfficerId,
          salesOfficer:   g.salesOfficer,
          isActive:       g.isActive,
          _count:         { customers: g._count.customers },
        }))}
        salesOfficers={salesOfficers}
      />
    </div>
  );
}
