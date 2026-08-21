import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getMrnBillingBoard, getMrnSupervisorBoard } from "@/lib/mrn/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/mrn/board — both MRN faces off ONE route.
 *
 *   ?face=billing[&date=YYYY-MM-DD]  → MrnBillingBoard  (one mrnDate, srNo DESC)
 *   ?face=supervisor[&tab=…]         → MrnSupervisorBoard (all three phone tabs)
 *
 * READ-ONLY. Not one write in this file — no update, no upsert, no log row.
 * The write paths are their own routes (step 5/6 of the build).
 *
 * 🔴 VALIDATE, NEVER COERCE. An unrecognised `face` or `tab` returns 400; it
 * does NOT fall back to a default. A caller rendering one board while the
 * server answered for another is strictly worse than an error — the same stance
 * app/api/picking/queue/route.ts takes on a malformed `scope`, and the same
 * stance lib/mrn/queries.ts's parseMrnDate() takes on a malformed date (it
 * THROWS rather than quietly answering for today).
 *
 * The WHERE predicates are NOT re-declared here. getMrnBillingBoard() and
 * getMrnSupervisorBoard() own them via the exported builders in
 * lib/mrn/queries.ts, which is what keeps this route and /api/mrn/marker
 * watching the identical set (Picking §10 / Floor §10 landmine).
 */

/** The supervisor's three tabs. Duplicated in app/api/mrn/marker/route.ts on
 *  purpose, so the two routes accept and reject identical values — exactly how
 *  the picking queue and picking marker duplicate their `scope` check. */
const SUPERVISOR_TABS = ["toCheck", "checking", "done"] as const;

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Page-level gating alone is not enough — this route is reachable directly by
  // URL and returns real depot data. Same check + admin bypass shape as the
  // picking routes.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Trim, empty string treated as absent — the convention the picking and
  // support routes already read params with.
  const { searchParams } = new URL(req.url);
  const faceParam = searchParams.get("face")?.trim() || undefined;
  const dateParam = searchParams.get("date")?.trim() || undefined;
  const tabParam = searchParams.get("tab")?.trim() || undefined;

  // `face` is REQUIRED. There is no sensible default: the two faces answer
  // different questions with different shapes, so guessing one would hand a
  // caller a payload it cannot render.
  if (faceParam !== "billing" && faceParam !== "supervisor") {
    return NextResponse.json(
      {
        error:
          faceParam === undefined
            ? '`face` is required — expected "billing" or "supervisor"'
            : `Invalid face "${faceParam}" — expected "billing" or "supervisor"`,
      },
      { status: 400 },
    );
  }

  // Validate `tab` whenever it is present, on either face — a typo must never
  // pass silently just because the face it was sent to ignores it.
  if (tabParam !== undefined && !SUPERVISOR_TABS.includes(tabParam as never)) {
    return NextResponse.json(
      { error: `Invalid tab "${tabParam}" — expected "toCheck", "checking" or "done"` },
      { status: 400 },
    );
  }

  if (faceParam === "supervisor") {
    // Contradictory request: the supervisor tabs span ALL dates (design §11
    // OQ-6 — a truck left unchecked overnight must still be waiting next
    // morning), so a `date` here would be silently ignored. Reject it, exactly
    // as the picking queue rejects `date` alongside scope=openPending.
    if (dateParam !== undefined) {
      return NextResponse.json(
        { error: "`date` is not accepted with face=supervisor (the tabs span all dates)" },
        { status: 400 },
      );
    }

    // ⚠ `tab` is validated above but does NOT narrow this payload, and that is
    // deliberate. getMrnSupervisorBoard() returns all three tabs from ONE read
    // so the cards and the bottom-bar tab counts can never drift — the
    // invariant the picking supervisor board is built on (CLAUDE_PICKING.md
    // §5.1). Narrowing here would mean a second read for the counts, which is
    // the drift that invariant exists to prevent. `tab` IS load-bearing on
    // /api/mrn/marker, where one aggregate watches one tab's predicate.
    const result = await getMrnSupervisorBoard();
    return NextResponse.json(result);
  }

  // face === "billing"
  // A `tab` here is meaningless — billing's rail is one flat list with no tabs
  // (design §3.1). Reject rather than ignore, same reasoning as the `date` rule
  // above.
  if (tabParam !== undefined) {
    return NextResponse.json(
      { error: "`tab` is not accepted with face=billing (the rail has no tabs)" },
      { status: 400 },
    );
  }

  try {
    // Omitted `date` → today IST, resolved inside getMrnBillingBoard(). A
    // malformed or impossible date makes parseMrnDate() throw, surfacing as a
    // clean 400 below instead of a silently-different day. Sequential awaits
    // only — never prisma.$transaction (CORE §3).
    const result = await getMrnBillingBoard(dateParam);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid date" },
      { status: 400 },
    );
  }
}
