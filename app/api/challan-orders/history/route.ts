import { NextResponse } from "next/server";
import { challanOrdersGate } from "@/lib/challan-orders/access";
import { loadChallanHistory } from "@/lib/challan-orders/board";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/challan-orders/history?from=YYYY-MM-DD&to=YYYY-MM-DD&q=&page=1 — every
 * challan order created in the IST-day range, cancelled ones included (Challan
 * orders slice 5, 2026-10-07). READ-ONLY. Gate: challan_orders canView.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const gate = await challanOrdersGate("canView");
  if (!gate.ok) return gate.res;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "from / to must be YYYY-MM-DD, from ≤ to" }, { status: 400 });
  }
  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const history = await loadChallanHistory({
    from,
    to,
    q: url.searchParams.get("q") ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    now: new Date(),
  });
  return NextResponse.json(history, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
