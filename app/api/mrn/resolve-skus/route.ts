import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { resolveMrnSkus } from "@/lib/mrn/resolve-lines";

export const dynamic = "force-dynamic";

/**
 * POST /api/mrn/resolve-skus — resolve a set of raw SAP codes to name + pack.
 *
 * Body: { codes: string[] }  →  { entries: { [code]: { description, pack } } }
 *
 * READ-ONLY. Not one write, and none may be added — this is a lookup, not a
 * step in the paste.
 *
 * ⚠ WHY THIS EXISTS. The paste modal's preview has to answer "what did Orbit
 * match?" BEFORE anything is saved — that is the entire point of a preview, and
 * the reason the operator gets to see 2 unknown codes named before agreeing to
 * replace 36 lines. resolveMrnSkus() is a Prisma call, so it cannot run in the
 * browser, and the write route only reports `unmatchedCodes` in its RESPONSE —
 * which is after the fact. Hence one small endpoint.
 *
 * ⚠ IT DOES NOT RE-DECLARE THE LOOKUP. It calls the same resolveMrnSkus() the
 * detail feed and the lines write both call, so the preview and the saved rows
 * can never disagree about which codes are catalogued. Matching is on
 * `sku_master_v2.material` and NEVER on any catalog row id — that file owns the
 * rule and carries the id-space warning (CORE §13).
 *
 * POST rather than GET because a truck's paste runs to 40+ codes, which is an
 * unreasonable query string. Nothing is mutated.
 *
 * canView, not canEdit: this reads master data and writes nothing. The write it
 * precedes is gated on canEdit by its own route.
 */

/** Refuses a runaway list rather than building an unbounded IN clause. A real
 *  truck's STI runs to a few dozen lines; 500 is far above that and far below
 *  anything that would hurt. */
const MAX_CODES = 500;

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { codes?: unknown };
  if (!Array.isArray(body.codes)) {
    return NextResponse.json({ error: "`codes` must be an array" }, { status: 400 });
  }
  if (body.codes.length > MAX_CODES) {
    return NextResponse.json(
      { error: `Too many codes — ${MAX_CODES} at a time.` },
      { status: 400 },
    );
  }

  const codes = body.codes.filter((c): c is string => typeof c === "string");

  // De-dupes and drops blanks itself; ONE query for the whole set, never per
  // code. A code missing from the result is NORMAL, not an error — roughly 27%
  // of distinct active SAP codes resolve in neither catalog table (CORE §7.1.c).
  const catalog = await resolveMrnSkus(codes);

  const entries: Record<string, { description: string; pack: string }> = {};
  catalog.forEach((v, k) => {
    entries[k] = v;
  });

  return NextResponse.json({ entries });
}
