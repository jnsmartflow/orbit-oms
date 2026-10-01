import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import { buildSoCatalogue } from "@/lib/so-order/catalogue";

export const dynamic = "force-dynamic";

// GET /api/so-lab/catalogue — { customers, products } for the /so-lab board
// (C.2a, 2026-10-01). Never /api/order/data, never /api/place-order/data.
//
// 1. GATE FIRST: requireSoApi() (staff lock + a live SO session). The cache is
//    read only after the gate, so a cached payload never leaks past it.
// 2. CACHED 10 MIN in the Vercel Data Cache (shared across instances): the
//    catalogue is identical for every SO, so the whole depot costs at most ~6
//    builds an hour (3 reads, ~2,600 rows each) however many SOs are on.
//    🔴 Keep DB load tiny — the 2026-09-29 outage was Disk IO exhaustion.
// 3. ERRORS ARE 503, NEVER 200-with-empty: buildSoCatalogue throws on an error
//    or an empty catalogue, unstable_cache does not store a throw, and the board
//    treats any non-200 as a failure with a Retry.
const getCachedCatalogue = unstable_cache(
  () => buildSoCatalogue(),
  ["so-lab-catalogue-v1"],
  { revalidate: 600, tags: ["so-lab-catalogue"] },
);

export async function GET(): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  try {
    const payload = await getCachedCatalogue();
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[so-lab/catalogue] build failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ ok: false, error: "Catalogue unavailable" }, { status: 503 });
  }
}
