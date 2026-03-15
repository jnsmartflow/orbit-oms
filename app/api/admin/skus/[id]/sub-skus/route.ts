import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { error: "sub-skus removed in schema v10 — colour variants are separate sku_master rows" },
    { status: 410 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "sub-skus removed in schema v10 — colour variants are separate sku_master rows" },
    { status: 410 }
  );
}
