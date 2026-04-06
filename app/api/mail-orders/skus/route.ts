import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(isNaN(limitParam) ? 20 : limitParam, 50);

  if (q.trim().length < 2) {
    return NextResponse.json({ error: "Query too short" }, { status: 400 });
  }

  const words = q.trim().toUpperCase().split(/\s+/).filter((w) => w.length > 0);

  const skus = await prisma.mo_sku_lookup.findMany({
    where: {
      AND: words.map((word) => ({
        OR: [
          { material: { contains: word, mode: "insensitive" as const } },
          { description: { contains: word, mode: "insensitive" as const } },
          { product: { contains: word, mode: "insensitive" as const } },
          { baseColour: { contains: word, mode: "insensitive" as const } },
        ],
      })),
    },
    orderBy: { description: "asc" },
    take: limit,
    select: {
      material: true,
      description: true,
      category: true,
      product: true,
      baseColour: true,
      packCode: true,
      unit: true,
      refMaterial: true,
    },
  });

  const pack = searchParams.get("pack") ?? "";

  const results = skus.map((s) => ({
    material: s.material,
    description: s.description,
    category: s.category ?? "",
    product: s.product,
    baseColour: s.baseColour,
    packCode: s.packCode,
    unit: s.unit ?? "",
    refMaterial: s.refMaterial ?? "",
    packMatch: pack ? s.packCode === pack : true,
  }));

  // Sort: pack matches first, then alphabetical within each group
  results.sort((a, b) => {
    if (a.packMatch !== b.packMatch) return a.packMatch ? -1 : 1;
    return a.description.localeCompare(b.description);
  });

  return NextResponse.json({ skus: results });
}
