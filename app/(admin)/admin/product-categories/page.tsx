import { prisma } from "@/lib/prisma";
import { ProductCategoriesTable } from "@/components/admin/product-categories-table";

export const dynamic = "force-dynamic";

export default async function ProductCategoriesPage() {
  const rows = await prisma.product_category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { skus: true } } },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Product Categories</h1>
        <p className="text-sm text-gray-500 mt-1">
          Top-level product groupings (Emulsion, Primer, Tinter…). Referenced by product names and SKUs.
        </p>
      </div>
      <ProductCategoriesTable
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
