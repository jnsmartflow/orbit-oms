import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewTripSheets } from "@/lib/trip-sheet/access";
import { SEARCH_MIN_CHARS, searchTripSheets } from "@/lib/trip-sheet/search";

export const dynamic = "force-dynamic";

// GET /api/trip-sheets/search?q= — Orbit trips from the last 14 days matching
// trip no, vehicle, driver, stop, billed dealer, SO, invoice or OBD
// (lib/trip-sheet/search.ts). READ-ONLY. Same access check as the list.

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < SEARCH_MIN_CHARS) return NextResponse.json({ q, hits: [] });
  const hits = await searchTripSheets(q);
  return NextResponse.json({ q, hits });
}
