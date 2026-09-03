import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getCiRegisterRows } from "@/lib/ci/queries";
import { buildCiRegisterWorkbook } from "@/lib/ci/workbook";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/export?from=YYYY-MM-DD&to=YYYY-MM-DD — billing's CI register as
 * an .xlsx.
 *
 * The thing this replaces: billing keeps "CI DATA NEW FILE2.xlsm" by hand,
 * sheet "CI DATA BELOW 10000RS", seventeen columns, one row per CI, retyped
 * off this very screen. This route is that retype, gone.
 *
 * ⚠ .xlsx, NOT .xlsm. We do not reproduce their VBA — billing PASTES these rows
 * into their own macro workbook, which is why the seventeen header strings are
 * copied character for character (typos included; see lib/ci/workbook.ts) and
 * why five columns come out deliberately empty for them to type into.
 *
 * READ-ONLY. Not one write in this file.
 *
 * ── canExport, NOT canView ──────────────────────────────────────────────────
 *
 * 🔴 `floor_supervisor` holds `ci.canView` TRUE and `ci.canExport` FALSE, and
 * that split is DESIGNED — it is the same one MRN documents at
 * app/api/mrn/[mrnId]/export/route.ts, verified live in role_permissions on
 * 2026-09-03 (billing_operator and operations carry canExport; the floor does
 * not). He raises the return; the REGISTER is billing's deliverable. Gating
 * this on canView — which is what the board next door enforces — would hand
 * billing's outward-going document to the floor. A future session tidying "why
 * is this route stricter than the board" is about to do exactly that.
 *
 * ⚠ STATIC SIBLING. /api/ci/export resolves here and never reaches
 * /api/ci/[ciId], the same way board, marker, search and bill do.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canExport");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from")?.trim() ?? "";
  const to = searchParams.get("to")?.trim() ?? "";

  // Both REQUIRED, and validated rather than defaulted. There is no sensible
  // default range: a register handed back for a period the operator did not ask
  // for is worse than a 400, because he would paste it.
  if (from === "" || to === "") {
    return NextResponse.json(
      { error: "`from` and `to` are both required — expected YYYY-MM-DD" },
      { status: 400 },
    );
  }

  try {
    // Validation (shape, real calendar date, from <= to) lives in
    // getCiRegisterRows via the shared assertCiDate, so the board and this route
    // cannot disagree about what a date is. A throw surfaces as a clean 400.
    //
    // 🔴 ONE await. Never prisma.$transaction (CORE §3).
    const rows = await getCiRegisterRows(from, to);

    // 🔴 AN EMPTY RANGE IS A 200 WITH A HEADER-ONLY WORKBOOK. Not a 404 and not
    // an error: "no CIs were closed that month" is an ANSWER, and billing needs
    // the same file shape back whether or not it has rows in it.
    const body = buildCiRegisterWorkbook(rows);

    // The range is IN the filename so two downloads never collide in the
    // browser's Downloads folder — "CI-2026-08-01_2026-08-31.xlsx". Both halves
    // are already [0-9-] by construction (assertCiDate ran above), so nothing
    // operator-typed reaches this header; the sanitiser is belt and braces
    // against the day one of these becomes free text.
    const safe = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-");
    const filename = `CI-${safe(from)}_${safe(to)}.xlsx`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A register is a snapshot of a moving set — a CI closed a minute after
        // this ran belongs in the next download. A proxy holding one month's
        // workbook and serving it for another is the kind of bug nobody debugs
        // for a week.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid range" },
      { status: 400 },
    );
  }
}
