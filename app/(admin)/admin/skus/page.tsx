import { prisma } from "@/lib/prisma";
import { SkusTable } from "@/components/admin/skus-table";

export default async function SkusPage() {
  const [skus, total] = await Promise.all([
    prisma.sku_master.findMany({
      take: 25,
      orderBy: { skuCode: "asc" },
    }),
    prisma.sku_master.count(),
  ]);

  return (
    <SkusTable
      initialSkus={skus.map((s) => ({
        id: s.id,
        skuCode: s.skuCode,
        skuName: s.skuName,
        packSize: s.packSize,
        containerType: s.containerType,
        unitsPerCarton: s.unitsPerCarton,
        grossWeightPerUnit: s.grossWeightPerUnit,
        isActive: s.isActive,
      }))}
      initialTotal={total}
    />
  );
}
