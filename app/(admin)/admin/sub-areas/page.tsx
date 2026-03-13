import { prisma } from "@/lib/prisma";
import { SubAreasTable } from "@/components/admin/sub-areas-table";

export default async function SubAreasPage() {
  const [subAreas, areas] = await Promise.all([
    prisma.sub_area_master.findMany({
      orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
      include: { area: { select: { id: true, name: true } } },
    }),
    prisma.area_master.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <SubAreasTable
      initialSubAreas={subAreas.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
      }))}
      areas={areas}
    />
  );
}
