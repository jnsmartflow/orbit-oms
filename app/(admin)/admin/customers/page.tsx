import { prisma } from "@/lib/prisma";
import { CustomersTable } from "@/components/admin/customers-table";

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const [customers, total, areas, subAreas] = await Promise.all([
    prisma.delivery_point_master.findMany({
      take: 25,
      orderBy: { customerName: "asc" },
      include: {
        area: { select: { id: true, name: true } },
        subArea: { select: { id: true, name: true } },
      },
    }),
    prisma.delivery_point_master.count(),
    prisma.area_master.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.sub_area_master.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, areaId: true },
    }),
  ]);

  return (
    <CustomersTable
      initialCustomers={customers.map((c) => ({
        id: c.id,
        customerCode: c.customerCode,
        customerName: c.customerName,
        area: c.area,
        subArea: c.subArea,
        isKeyCustomer: c.isKeyCustomer,
        isKeySite: c.isKeySite,
        isActive: c.isActive,
      }))}
      initialTotal={total}
      areas={areas}
      subAreas={subAreas}
    />
  );
}
