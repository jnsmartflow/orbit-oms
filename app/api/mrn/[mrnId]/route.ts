import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getMrnDetail } from "@/lib/mrn/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/mrn/[mrnId] — one MRN: header + lines + batches.
 *
 * Every line arrives SKU-resolved (matched on `sku_master_v2.material`, never
 * an id — lib/mrn/resolve-lines.ts owns that rule) and with the derived fields
 * from lib/mrn/derive.ts already applied, so NO client recomputes Short/Excess.
 * That is the point of deriving on the way out: the card, the table, the XLS
 * and the print sheet cannot drift into disagreeing about the same truck
 * (design §11 OQ-2).
 *
 * READ-ONLY. Not one write in this file.
 *
 * 404 covers BOTH "no such id" and "soft-removed": a removed MRN is gone from
 * both faces (design §11 OQ-8), and getMrnDetail() returns null for either. The
 * two cases are deliberately NOT distinguished in the response — telling a
 * caller that an id it cannot see does exist leaks the row.
 *
 * ⚠ Static siblings win: /api/mrn/board and /api/mrn/marker resolve to their
 * own routes and never reach this one. Nothing to guard against here.
 */
export async function GET(
  _req: Request,
  { params }: { params: { mrnId: string } },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same gate + admin bypass as app/api/mrn/board/route.ts and the picking
  // routes — reachable directly by URL, returns real depot data.
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Validate, never coerce. Digits only — stricter than the picking routes'
  // Number()-based check on `pickerId` because a PATH segment has no reason to
  // accept "1e3", "+1" or " 1". The upper bound keeps a 20-digit URL a clean
  // 400 rather than a Prisma int4 overflow surfacing as a 500.
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

  return NextResponse.json(detail);
}
