import { prisma } from "@/lib/prisma";
import { TransportersTable } from "@/components/admin/transporters-table";

export const dynamic = "force-dynamic";

export default async function TransportersPage() {
  const rows = await prisma.transporter_master.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { vehicles: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Transporter Master</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage transporter companies. A transporter with active vehicles cannot be deactivated.
        </p>
      </div>
      <TransportersTable
        initialRows={rows.map((r) => ({
          id:            r.id,
          name:          r.name,
          contactPerson: r.contactPerson,
          phone:         r.phone,
          email:         r.email,
          isActive:      r.isActive,
          _count:        { vehicles: r._count.vehicles },
        }))}
      />
    </div>
  );
}
