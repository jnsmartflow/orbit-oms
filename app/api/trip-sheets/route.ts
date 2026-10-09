import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listTripSheets } from "@/lib/trip-sheet/load";
import { canViewTripSheets } from "@/lib/trip-sheet/access";

export const dynamic = "force-dynamic";

// GET /api/trip-sheets?date=YYYY-MM-DD — the phone list's rows (lib/trip-sheet).
// READ-ONLY. ⚠ NOT /api/trips — that is the NTS mirror (CLAUDE_FLOOR_TRIPS §2).
// Access: trip_sheet OR floor canView (lib/trip-sheet/access.ts).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  if (!(await canViewTripSheets(roles))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const date = new URL(req.url).searchParams.get("date") ?? "";
  if (!DATE_RE.test(date)) return NextResponse.json({ error: "date=YYYY-MM-DD is required" }, { status: 400 });

  try {
    const rows = await listTripSheets(date);
    return NextResponse.json({ date, rows });
  } catch (err) {
    // parseTripDate throws on an impossible calendar date (2026-02-30).
    const message = err instanceof Error ? err.message : "Failed to load trip sheets";
    return NextResponse.json({ error: message }, { status: message.startsWith("Invalid") ? 400 : 500 });
  }
}
