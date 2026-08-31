import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getCiDetail } from "@/lib/ci/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/[ciId] — one CI: header + returned lines + everything billing's
 * right pane shows (docs/mockups/ci/billing.html).
 *
 * Every line arrives with its snapshot values as they were written at submit,
 * and the header totals derived on the way out by lib/ci/derive.ts, so NO client
 * recomputes tins or litres. That is the point of deriving here: the desk pane
 * and the eventual print sheet cannot drift into disagreeing about the same
 * return.
 *
 * ⚠ TWO FIELDS ARE READ LIVE THROUGH `orderId`, NOT from the snapshot, and the
 * asymmetry is deliberate:
 *
 *   invoiceNo — 5% of dispatched bills have no invoice number when the CI is
 *   raised and SAP sends it later (spec §4). The LIVE value wins and the
 *   snapshot is the fallback, never the reverse, so the number simply appears
 *   once SAP has it. There is no back-fill job and there must not be one — it
 *   would rewrite a closed document.
 *
 *   area — NOT A COLUMN on ci_returns at all. The pane's
 *   "102492 · OBD 9109145575 · Ghod Dod" reads it through
 *   customerId → delivery_point_master.area. BLANK for an unmastered dealer,
 *   which is a normal state, not an error.
 *
 * READ-ONLY. Not one write in this file.
 *
 * 404 covers "no such id", "voided" AND "still a draft" alike, deliberately
 * undistinguished: telling a caller that an id it cannot see does exist leaks
 * the row. A draft is an in-flight write, not a record.
 *
 * ⚠ Static siblings win: /api/ci/board, /api/ci/marker, /api/ci/search and
 * /api/ci/bill resolve to their own routes and never reach this one.
 */
export async function GET(
  _req: Request,
  { params }: { params: { ciId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "ci", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Validate, never coerce. Digits only — a PATH segment has no reason to accept
  // "1e3", "+1" or " 1". The upper bound keeps a 20-digit URL a clean 400 rather
  // than a Prisma int4 overflow surfacing as a 500.
  const raw = params.ciId?.trim() ?? "";
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n <= 0 || n > 2147483647) {
    return NextResponse.json(
      { error: `Invalid ciId "${params.ciId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // Three sequential awaits inside (the CI, the live order, the bill's line
  // count) — never prisma.$transaction (CORE §3).
  const detail = await getCiDetail(n);
  if (!detail) {
    return NextResponse.json({ error: "CI not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
