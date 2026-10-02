import { NextResponse } from "next/server";
import { freightGate } from "@/lib/freight-trips/gate";
import { getFreightOptions } from "@/lib/freight-trips/options";

export const dynamic = "force-dynamic";

/**
 * GET /api/freight-trips/options — active vehicles (with the driver to copy) and
 * transporters. `transportersFallback: true` = no transporter is marked
 * isRealTransporter yet, so every active one is listed. Read-only.
 */
export async function GET(): Promise<NextResponse> {
  const gate = await freightGate("canView");
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getFreightOptions());
}
