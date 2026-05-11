import { NextResponse } from "next/server";
import { QUICK_TILES_V1 } from "@/lib/place-order/quick-tiles-config";

// Returns the active 9-tile speed-dial config consumed by the /place-order
// page. v1 is hardcoded; the contract is designed to support future
// volume-driven, per-user, or family-filtered modes without frontend
// changes (see lib/place-order/quick-tiles-config.ts).

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(QUICK_TILES_V1);
}
