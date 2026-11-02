import { NextResponse } from "next/server";
import { saError, stockCountGate } from "@/lib/stock-audit/gate";
import { searchSkus } from "@/lib/stock-audit/queries";
import type { SkuHit } from "@/lib/stock-audit/types";

export const dynamic = "force-dynamic";

// GET /api/stock-count/skus?q= — catalog search for the counter's phone.
// Gate: stock_audit_count canView. q is trimmed + upper-cased, min 4 chars,
// letters / digits / "-" only; matched ANYWHERE in sku_master_v2.material (so
// 01033071 finds IN01033071), active only, tagged codes (^[0-9]+-) excluded,
// isPrimary first then material, max 20. Matches on `material` only — never a
// catalog row id (CORE §13).
export async function GET(req: Request): Promise<NextResponse> {
  const gate = await stockCountGate();
  if (!gate.ok) return gate.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toUpperCase();
  if (q.length < 4) return saError(400, "INVALID", "Type at least 4 characters");
  if (q.length > 40 || !/^[A-Z0-9-]+$/.test(q)) return saError(400, "INVALID", "Letters, digits and - only");

  const skus: SkuHit[] = await searchSkus(q);
  return NextResponse.json({ skus }, { headers: { "Cache-Control": "no-store" } });
}
