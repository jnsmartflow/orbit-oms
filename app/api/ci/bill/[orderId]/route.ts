import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getCiBill } from "@/lib/ci/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/ci/bill/[orderId] — the bill the supervisor is returning against,
 * with its lines. Frames 3-5 of docs/mockups/ci/supervisor.html.
 *
 * ⚠ KEYED ON `orders.id`, NOT on the OBD number. `orderId` is the identity of
 * the bill (spec §4) — invoiceNo is not unique and obdNumber, though unique, is
 * a business key that a redirect or a re-import can in principle be made to
 * disagree about. The search route hands the client an `orderId`; this route
 * takes that back.
 *
 * Every line arrives SKU-resolved (matched on `sku_master_v2.material`, never an
 * id — lib/ci/resolve-lines.ts owns that rule) and carries its `litresPerTin`
 * already derived, so NO client recomputes litres. That is the point of deriving
 * on the way out: the phone, the desk pane and the eventual print sheet cannot
 * drift into disagreeing about the same return.
 *
 * ⚠ THESE ARE SOURCE LINES, NOT ci_return_lines. The submit route (step 3c)
 * snapshots them; a re-import patches the raw line in place, so a closed CI must
 * not read through to them.
 *
 * READ-ONLY. Not one write in this file.
 *
 * 404 covers BOTH "no such id" and "soft-removed", deliberately undistinguished
 * — telling a caller that an id it cannot see does exist leaks the row.
 */
export async function GET(
  _req: Request,
  { params }: { params: { orderId: string } },
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
  // than a Prisma int4 overflow surfacing as a 500. Same shape as
  // app/api/mrn/[mrnId]/route.ts.
  const raw = params.orderId?.trim() ?? "";
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n <= 0 || n > 2147483647) {
    return NextResponse.json(
      { error: `Invalid orderId "${params.orderId}" — expected a positive integer` },
      { status: 400 },
    );
  }

  // Three sequential awaits inside (order, lines, catalog) — never
  // prisma.$transaction (CORE §3).
  const bill = await getCiBill(n);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  return NextResponse.json(bill);
}
