import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { createChallanOrder } from "@/lib/challan-orders/create";
import type { CreateChallanOrderRequest } from "@/lib/challan-orders/types";

export const dynamic = "force-dynamic";
// The create is ~15 sequential writes; 60 s is far past it and well under the
// 10-minute stale-claim window (lib/challan-orders/number.ts STALE_CLAIM_MS).
export const maxDuration = 60;

/**
 * POST /api/place-order/challan-orders — create ONE challan order (ORB-YYYY-NNNNN)
 * from the desktop /place-order cart in Challan mode (Challan orders slice 3,
 * 2026-10-07). Thin: every check and every write is lib/challan-orders/create.ts.
 *
 * Gate: `place_order` canView AND `place_order_challan` canEdit — the tick that
 * draws the Challan order switch. The real session user, never a body claim.
 *
 * Body: CreateChallanOrderRequest (lib/challan-orders/types.ts).
 * 200 { ok: true, orderId, orbNumber, lines, tins, litres } · 4xx/500 { ok: false, code, error }.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const canView = await checkAnyPermission(roles, "place_order", "canView");
  const canCreate = canView && (await checkAnyPermission(roles, "place_order_challan", "canEdit"));
  if (!canCreate) {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", error: "You do not have access to create challan orders." },
      { status: 403 },
    );
  }

  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as CreateChallanOrderRequest | null;
  if (!body || typeof body !== "object" || !body.shipTo) {
    return NextResponse.json({ ok: false, code: "BAD_REQUEST", error: "Invalid request body" }, { status: 400 });
  }

  const result = await createChallanOrder(body, actorId);
  const { status, ...payload } = result;
  return NextResponse.json(payload, { status });
}
