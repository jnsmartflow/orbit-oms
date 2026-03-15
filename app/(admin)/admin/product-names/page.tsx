import { prisma } from "@/lib/prisma";
import { ProductNamesTable } from "@/components/admin/product-names-table";

export const dynamic = "force-dynamic";

export default async function ProductNamesPage() {
  const [rows, categories] = await Promise.all([
    prisma.product_name.findMany({
      orderBy: { name: "asc" },
      include: {
        category: { select: { id: true, name: true } },
        _count:   { select: { skus: true } },
      },
    }),
    prisma.product_category.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Product Names</h1>
        <p className="text-sm text-slate-500 mt-1">
          Product brand/line names within each category (Aquatech, Weathercoat, WS…). Each belongs to one category.
        </p>
      </div>
      <ProductNamesTable
        initialRows={rows.map((r) => ({
          id:         r.id,
          name:       r.name,
          categoryId: r.categoryId,
          category:   r.category,
          isActive:   r.isActive,
          _count:     { skus: r._count.skus },
        }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
