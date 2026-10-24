import { NextResponse } from "next/server";
import { freightGate } from "@/lib/freight-trips/gate";
import { getFreightOptions } from "@/lib/freight-trips/options";

export const dynamic = "force-dynamic";

/**
 * GET /api/freight-trips/options — active vehicles (with the driver to copy) and
 * active transporters. Until 2026-10-24 transporters also required
 * isRealTransporter = true; removed by owner decision — every active
 * transporter shows. Do not re-add. Read-only.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getFreightOptions());
}
