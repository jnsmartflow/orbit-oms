import { NextResponse } from "next/server";
import { stockCountGate } from "@/lib/stock-audit/gate";
import { buildCatalog } from "@/lib/stock-audit/catalog";

export const dynamic = "force-dynamic";

// GET /api/stock-count/catalog?have=<version> — the whole searchable SKU list
// for the counter's phone, which stores it (localStorage stock_count_catalog_v3)
// and searches it locally (lib/stock-audit/sku-search.ts). Gate:
// stock_audit_count canView — NOT public (the /api/order/data P0 is not copied).
//
//   have === current version → { version, unchanged: true }   (~60 bytes)
//   otherwise                → { version, skus: CatalogRow[] } (compact 5-slot arrays: material, description, pack, isPrimary, isActive)
//
// The list is catalogue data only — no quantity of any kind (blind count). The
// server still validates the material on every line POST / PATCH.
export async function GET(req: Request): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;

  const have = new URL(req.url).searchParams.get("have");
  const { version, rows } = await buildCatalog();
  const headers = { "Cache-Control": "no-store" };
  if (have === version) return NextResponse.json({ version, unchanged: true }, { headers });
  return NextResponse.json({ version, skus: rows }, { headers });
}
