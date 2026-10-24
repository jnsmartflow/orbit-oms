import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { mergeLoadParts } from "@/lib/order-invoices/load-split";

export const dynamic = "force-dynamic";

// /api/floor/orders/[orderId]/load-merge — SPLIT LOAD MERGE BACK (2026-10-24,
// phase 2, Schema v27.76).
//
//   POST → { rowIds: number[], expectKey } — waiting parts of ONE invoice back
//          into one row (the root when chosen, else the lowest-seq part); back
//          to "seq 1, no lines" when nothing else is left
// Needs floor canEdit AND floor_split_load canEdit (the same gate as
// …/load-split). Allowed on a stale bill — it is the fix. Write order:
// lib/order-invoices/load-split.ts mergeLoadParts.

type Params = { params: { orderId: string } };

async function gate() {
  const session = await auth();
  if (!session?.user) return { res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const roles = session.user.roles ?? [session.user.role];
  const canView = await checkAnyPermission(roles, "floor", "canView");
  if (!canView) return { res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const canEdit =
    (await checkAnyPermission(roles, "floor", "canEdit")) &&
    (await checkAnyPermission(roles, "floor_split_load", "canEdit"));
  if (!canEdit) return { res: NextResponse.json({ error: "You do not have the Split load tick" }, { status: 403 }) };
  const actorId = Number(session.user.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return { res: NextResponse.json({ error: "Invalid session user id" }, { status: 500 }) };
  }
  return { actorId };
}

export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const g = await gate();
  if ("res" in g) return g.res!;
  const orderId = Number(params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: "Invalid order id" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rowIds = body?.rowIds;
  if (!Array.isArray(rowIds) || !rowIds.every((id) => Number.isInteger(id) && (id as number) > 0)) {
    return NextResponse.json({ error: "rowIds must be a list of invoice row ids" }, { status: 400 });
  }
  if (typeof body.expectKey !== "string") {
    return NextResponse.json({ error: "expectKey is required — reopen Split load" }, { status: 400 });
  }

  try {
    const r = await mergeLoadParts(orderId, { rowIds: rowIds as number[], expectKey: body.expectKey, actorId: g.actorId });
    return NextResponse.json(r, { status: r.ok ? 200 : r.status });
  } catch (err) {
    console.error(`[order-invoices] split load merge failed for order ${orderId}`, err);
    return NextResponse.json(
      { ok: false, error: "The merge did not finish — reopen Split load and press Repair" },
      { status: 500 },
    );
  }
}
