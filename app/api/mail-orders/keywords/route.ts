import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [productRows, baseRows] = await Promise.all([
    prisma.mo_product_keywords.findMany({ select: { keyword: true } }),
    prisma.mo_base_keywords.findMany({ select: { keyword: true } }),
  ]);

  const productKeywords = Array.from(new Set(productRows.map((r) => r.keyword.toUpperCase())));
  const baseKeywords = Array.from(new Set(baseRows.map((r) => r.keyword.toUpperCase())));

  return NextResponse.json({ productKeywords, baseKeywords });
}
