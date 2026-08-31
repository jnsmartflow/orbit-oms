import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { searchCiBills } from "@/lib/ci/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/search?q=… — stage 1: find the bill a return belongs to.
 *
 * Matches on invoice number OR OBD number (spec §4). `q` is normalised by
 * lib/ci/queries.ts (trim, uppercase, and a bare 9 digits gets its `I` prefix),
 * and the normalised term is echoed back so the UI can show what was actually
 * searched.
 *
 * 🔴 ALWAYS RETURNS A LIST. 11 live invoice numbers map to two OBDs each — a
 * split bill fanning out — so a `findFirst` here would file returned goods
 * against the wrong half of a bill and nothing on screen would show it. With
 * exactly one hit the UI opens it directly; that is the UI's shortcut to take,
 * not this route's.
 *
 * READ-ONLY. Not one write in this file.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page-level gating alone is not enough — this route is reachable directly by
  // URL and returns real depot data. Same check + admin bypass shape as the MRN
  // and picking routes.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;

  // `q` is REQUIRED. An absent term must not quietly return every bill in the
  // depot — validate, never coerce.
  if (q === undefined) {
    return NextResponse.json({ error: "`q` is required" }, { status: 400 });
  }

  // A one- or two-character term would scan for nothing useful and invites a
  // fat-finger fetch on every keystroke. Both real shapes are long (OBD 10
  // digits, invoice `I` + 9), so this rejects nothing a supervisor would type.
  if (q.length < 4) {
    return NextResponse.json(
      { error: "`q` must be at least 4 characters" },
      { status: 400 },
    );
  }

  const result = await searchCiBills(q);
  return NextResponse.json(result);
}
