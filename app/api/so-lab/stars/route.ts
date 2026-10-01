import { NextResponse } from "next/server";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import { parseCode, parseList, parseText, setStar } from "@/lib/so-order/store";

export const dynamic = "force-dynamic";

// POST /api/so-lab/stars { list, customerCode, name, area, starred }
// One tap = one INSERT … ON CONFLICT DO NOTHING (starred: true) or one DELETE
// (starred: false). Two lists, kept apart; 200 per list (the 201st → 409).
// SO id from the session only.
export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as {
    list?: unknown; customerCode?: unknown; name?: unknown; area?: unknown; starred?: unknown;
  };
  const list = parseList(b.list);
  const customerCode = parseCode(b.customerCode);
  const name = parseText(b.name, 200);
  const blankArea = b.area === null || b.area === undefined || (typeof b.area === "string" && b.area.trim() === "");
  const area = blankArea ? null : parseText(b.area, 200);
  if (
    !list || !customerCode || typeof b.starred !== "boolean" ||
    (b.starred && !name) || (!blankArea && area === null)
  ) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = await setStar(
    gate.so.salesOfficerId, list, { customerCode, name: name ?? customerCode, area }, b.starred,
  );
  if (result === "full") return NextResponse.json({ ok: false, error: "full" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
