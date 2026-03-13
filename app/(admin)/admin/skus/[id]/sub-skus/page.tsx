import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SubSkusManager } from "@/components/admin/sub-skus-manager";

interface Props {
  params: { id: string };
}

export default async function SubSkusPage({ params }: Props) {
  const skuId = parseInt(params.id, 10);
  if (isNaN(skuId)) notFound();

  const sku = await prisma.sku_master.findUnique({
    where: { id: skuId },
    include: { subSkus: { orderBy: { subCode: "asc" } } },
  });
  if (!sku) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-5">
        <Link href="/admin/skus" className="hover:text-slate-800 transition-colors">
          SKUs
        </Link>
        <span>/</span>
        <span className="text-slate-800 font-medium">{sku.skuCode}</span>
        <span>/</span>
        <span>Sub-SKUs</span>
      </div>

      <SubSkusManager
        skuId={sku.id}
        skuCode={sku.skuCode}
        skuName={sku.skuName}
        initialSubSkus={sku.subSkus.map((s) => ({
          id: s.id,
          subCode: s.subCode,
          description: s.description,
          createdAt: s.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
