import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscribe — store (or refresh) the caller's push subscription.
 *
 * userId comes from the SESSION only, NEVER the request body — otherwise one
 * user could register a phone against another user's account.
 *
 * Upsert on the endpoint unique index. If the endpoint already exists under a
 * DIFFERENT userId (a shared phone), the update branch REASSIGNS it to the
 * current session user, so the previous owner stops receiving on that device.
 * updatedAt is set explicitly (DB default has no trigger; plain field).
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

  const sub = (body as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } } } | null)
    ?.subscription;
  const userAgent =
    (body as { userAgent?: string } | null)?.userAgent ?? req.headers.get("user-agent") ?? null;

  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "Missing or malformed subscription" }, { status: 400 });
  }

  const now = new Date();
  const row = await prisma.push_subscriptions.upsert({
    where: { endpoint: sub.endpoint },
    create: {
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
      isActive: true,
      failureCount: 0,
      lastSeenAt: now,
      updatedAt: now,
    },
    update: {
      // Reassign to the session user on a shared phone; refresh keys + revive.
      userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
      isActive: true,
      failureCount: 0,
      lastSeenAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });

  const savedDeviceCount = await prisma.push_subscriptions.count({
    where: { userId, isActive: true },
  });

  return NextResponse.json({ ok: true, id: row.id, savedDeviceCount });
}
