import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { PackCode } from "@prisma/client";
import { buildSuggestPayload } from "../_lib/suggest";
import { isValidPackCode } from "../_lib/validate";

export const dynamic = "force-dynamic";

// ── GET /api/sampling-library/suggest?siteId=&skuCode=&packCode= ────────────
// Powers the operator-screen SuggestionCard: exact (site + sku + pack)
// matches on top, other samplings at the same site beneath, plus a site
// history summary. Auth: sampling_library:canView.
export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "sampling_library", "canView");
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const siteIdRaw   = searchParams.get("siteId");
  const skuCodeRaw  = searchParams.get("skuCode");
  const packCodeRaw = searchParams.get("packCode");

  if (!siteIdRaw || !/^\d+$/.test(siteIdRaw)) {
    return NextResponse.json({ error: "siteId is required and must be a positive integer", field: "siteId" }, { status: 400 });
  }
  const siteId = parseInt(siteIdRaw, 10);
  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: "siteId must be a positive integer", field: "siteId" }, { status: 400 });
  }

  if (!skuCodeRaw || skuCodeRaw.trim() === "") {
    return NextResponse.json({ error: "skuCode is required", field: "skuCode" }, { status: 400 });
  }
  const skuCode = skuCodeRaw.trim();

  if (!packCodeRaw || !isValidPackCode(packCodeRaw)) {
    return NextResponse.json({ error: "packCode is required and must be a valid PackCode enum value", field: "packCode" }, { status: 400 });
  }
  const packCode: PackCode = packCodeRaw;

  try {
    const payload = await buildSuggestPayload({ siteId, skuCode, packCode });
    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    console.error("[sampling-library/suggest]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
