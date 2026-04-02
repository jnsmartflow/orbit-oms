import { prisma } from "@/lib/prisma";
import { BaseColoursTable } from "@/components/admin/base-colours-table";

export const dynamic = "force-dynamic";

export default async function BaseColoursPage() {
  const rows = await prisma.base_colour.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { skus: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Base Colours</h1>
        <p className="text-sm text-gray-500 mt-1">
          Tint base variants (White Base, Deep Base, Clear…). &quot;N/A&quot; is the protected fallback for non-tint SKUs.
        </p>
      </div>
      <BaseColoursTable
        initialRows={rows.map((r) => ({
          id:       r.id,
          name:     r.name,
          isActive: r.isActive,
          _count:   { skus: r._count.skus },
        }))}
      />
    </div>
  );
}
