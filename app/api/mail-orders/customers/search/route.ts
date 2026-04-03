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
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json(
      { error: "Query must be at least 2 characters" },
      { status: 400 },
    );
  }

  const rows = await prisma.mo_customer_keywords.findMany({
    where: {
      OR: [
        { keyword: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { customerCode: { startsWith: q } },
      ],
    },
    take: 50,
  });

  // Deduplicate by customerCode — keep first per code, max 20
  const seen = new Set<string>();
  const customers: {
    customerCode: string;
    customerName: string;
    area: string | null;
    deliveryType: string | null;
    route: string | null;
  }[] = [];

  for (const row of rows) {
    if (seen.has(row.customerCode)) continue;
    seen.add(row.customerCode);
    customers.push({
      customerCode: row.customerCode,
      customerName: row.customerName,
      area: row.area,
      deliveryType: row.deliveryType,
      route: row.route,
    });
    if (customers.length >= 20) break;
  }

  return NextResponse.json({ customers });
}
