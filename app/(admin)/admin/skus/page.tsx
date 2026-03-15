import { prisma } from "@/lib/prisma";
import { SkusTable } from "@/components/admin/skus-table";

export const dynamic = "force-dynamic";

const include = {
  productCategory: { select: { name: true } },
  productName:     { select: { name: true } },
  baseColour:      { select: { name: true } },
} as const;

export default async function SkusPage() {
  const [skus, total, categories, productNames, baseColours] = await Promise.all([
    prisma.sku_master.findMany({
      take:    25,
      orderBy: { skuCode: "asc" },
      include,
    }),
    prisma.sku_master.count(),
    prisma.product_category.findMany({ orderBy: { name: "asc" } }),
    prisma.product_name.findMany({ orderBy: { name: "asc" } }),
    prisma.base_colour.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">SKU Master</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage all SKUs. Weight is captured from the OBD import file — it is not stored here.
        </p>
      </div>
      <SkusTable
        initialSkus={skus.map((s) => ({
          id:                s.id,
          skuCode:           s.skuCode,
          skuName:           s.skuName,
          packSize:          s.packSize,
          containerType:     s.containerType,
          unitsPerCarton:    s.unitsPerCarton,
          productCategoryId: s.productCategoryId,
          productCategory:   s.productCategory,
          productNameId:     s.productNameId,
          productName:       s.productName,
          baseColourId:      s.baseColourId,
          baseColour:        s.baseColour,
          isActive:          s.isActive,
        }))}
        initialTotal={total}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        productNames={productNames.map((n) => ({ id: n.id, name: n.name }))}
        baseColours={baseColours.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
