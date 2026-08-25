import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getMrnDetail } from "@/lib/mrn/queries";
import { reportFilename } from "@/lib/mrn/report";
import { buildMrnWorkbook } from "@/lib/mrn/workbook";

export const dynamic = "force-dynamic";

/**
 * GET /api/mrn/[mrnId]/export — the MRN as an .xlsx workbook.
 *
 * The thing this whole module exists to replace: today billing prints the XLS
 * template, the supervisor writes on the paper, and billing types it all back
 * into Excel. This route is the retype, gone.
 *
 * READ-ONLY. Not one write in this file.
 *
 * ── canExport, NOT canView ──────────────────────────────────────────────────
 *
 * 🔴 `floor_supervisor` and `operations` both hold `mrn.canView` TRUE and
 * `mrn.canExport` FALSE, and that is DESIGNED, not an oversight in the grant
 * (design §11 OQ-11). They can open a truck and record what arrived; the
 * REPORT is billing's deliverable. A future session tidying "why is this route
 * stricter than the detail route" is about to hand the supervisor billing's
 * output — the two gates differ on purpose.
 *
 * ── 409 unless done ─────────────────────────────────────────────────────────
 *
 * A half-checked truck has no report. On an `open` MRN nothing has been
 * counted; on a `checking` one the supervisor still holds it and the physical
 * quantities do not land in billing's copy until he taps End unloading (design
 * §5, "no live sync into billing" — the same reason the desktop table renders
 * the checking state locked). Exporting either would produce a document full of
 * blanks wearing the word MATERIAL RECEIPT NOTE across the top, which is worse
 * than no document.
 *
 * ⚠ THE WORKBOOK ITSELF IS BUILT IN lib/mrn/workbook.ts, NOT HERE. This file is
 * the gate, the lookup and the response; buildMrnWorkbook() is the document.
 * Two reasons it sits there rather than inline: a Next route handler may not
 * export a helper, so a builder living here is one nothing else can import or
 * exercise; and it has to share the column order with the A4 sheet, which is
 * what stops the two outputs drifting. That order, the row-17-not-row-16
 * correction and the sub-row rule are documented in lib/mrn/report.ts's header.
 * Read it before changing either output.
 */
export async function GET(
  _req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canExport");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Validate, never coerce — same shape as the detail route next door. Digits
  // only: a PATH segment has no reason to accept "1e3", "+1" or " 1", and the
  // upper bound keeps a 20-digit URL a clean 400 rather than a Prisma int4
  // overflow surfacing as a 500.
  const raw = params.mrnId?.trim() ?? "";
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n <= 0 || n > 2147483647) {
    return NextResponse.json(
      { error: `Invalid mrnId "${params.mrnId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // Two sequential awaits inside (the MRN, then the catalog for its codes) —
  // never prisma.$transaction (CORE §3).
  const detail = await getMrnDetail(n);
  if (!detail) {
    return NextResponse.json({ error: "MRN not found" }, { status: 404 });
  }

  if (detail.status !== "done") {
    return NextResponse.json(
      {
        error:
          detail.status === "checking"
            ? "This truck is still being checked. The report is available once the supervisor taps End unloading."
            : "This MRN has not been checked yet. The report is available once unloading is finished.",
        status: detail.status,
      },
      { status: 409 },
    );
  }

  const filename = reportFilename(detail, "xlsx");
  const body = buildMrnWorkbook(detail);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // `filename` is [A-Za-z0-9.-] only by construction (reportFilename), so it
      // is safe unquoted-adjacent here. No `filename*` form: every character is
      // already ASCII.
      "Content-Disposition": `attachment; filename="${filename}"`,
      // The report is a snapshot of a `done` MRN and a done MRN does not change
      // — but a proxy holding one truck's workbook and serving it for the next
      // is the kind of bug nobody debugs for a week.
      "Cache-Control": "no-store",
    },
  });
}
