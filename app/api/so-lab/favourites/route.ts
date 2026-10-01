import { NextResponse } from "next/server";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import { addFavProduct, parseTileKey, removeFavProduct } from "@/lib/so-order/store";

export const dynamic = "force-dynamic";

// /api/so-lab/favourites { tileKey } — favourite board tiles, cap 8.
// The 9th is REFUSED (409 "full"), never evicted — /po2's rule.
// SO id from the session only.

async function readTileKey(req: Request): Promise<string | null> {
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  return parseTileKey((body as { tileKey?: unknown } | null)?.tileKey);
}

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const tileKey = await readTileKey(req);
  if (!tileKey) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  const result = await addFavProduct(gate.so.salesOfficerId, tileKey);
  if (result === "full") return NextResponse.json({ ok: false, error: "full" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const tileKey = await readTileKey(req);
  if (!tileKey) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  await removeFavProduct(gate.so.salesOfficerId, tileKey);
  return NextResponse.json({ ok: true });
}
