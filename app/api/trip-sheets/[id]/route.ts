import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTripSheet } from "@/lib/trip-sheet/load";
import { canViewTripSheets } from "@/lib/trip-sheet/access";

export const dynamic = "force-dynamic";

// GET /api/trip-sheets/[id] — one Orbit trip's sheet (`id` = trips.id).
// READ-ONLY. 404 for an unknown or cancelled trip. ⚠ NOT /api/trips/[tripNo].

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid trip id" }, { status: 400 });

  const sheet = await getTripSheet(id);
  if (!sheet) return NextResponse.json({ error: "Trip not found" }, { status: 404 });
  return NextResponse.json({ sheet });
}
