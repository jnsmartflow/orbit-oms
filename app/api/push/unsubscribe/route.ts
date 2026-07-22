import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/unsubscribe — deactivate the given endpoint for the CALLER.
 *
 * Scoped to the session user (where: { endpoint, userId }) so one user can
 * never deactivate another user's device. userId from the session only.
 * updatedAt set explicitly (DB default has no trigger; plain field).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.user.id);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid session user" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const endpoint =
    (body as { endpoint?: string } | null)?.endpoint ??
    (body as { subscription?: { endpoint?: string } } | null)?.subscription?.endpoint;
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const result = await prisma.push_subscriptions.updateMany({
    where: { endpoint, userId },
    data: { isActive: false, updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, deactivated: result.count });
}
