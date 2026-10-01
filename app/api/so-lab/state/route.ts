import { NextResponse } from "next/server";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import { getSoState } from "@/lib/so-order/store";

export const dynamic = "force-dynamic";

// GET /api/so-lab/state — everything the board keeps per SO, in ONE call:
// { liveDraft, savedDrafts, favProducts, stars: { dealer, shipto } }.
// Called once per board load; never polled. SO id from the session only.
export async function GET(): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const state = await getSoState(gate.so.salesOfficerId);
  return NextResponse.json({ ok: true, ...state });
}
