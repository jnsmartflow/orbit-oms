import { prisma } from "@/lib/prisma";
import { SalesOfficersTable } from "@/components/admin/sales-officers-table";

export default async function SalesOfficersPage() {
  const officers = await prisma.sales_officer_master.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <SalesOfficersTable
      initialOfficers={officers.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        isActive: o.isActive,
      }))}
    />
  );
}
