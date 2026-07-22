import { NextResponse } from "next/server";
import { setVapidDetails, sendNotification, WebPushError, type PushSubscription } from "web-push";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * POST /api/picking/push-test — THROWAWAY proof. Sends exactly one Web Push to
 * the subscription in the request body. Nothing is stored (no DB). Same auth
 * gate as app/picking/page.tsx. Errors are surfaced verbatim, never swallowed.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "picking", "canView");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@orbitoms.in";
  if (!publicKey || !privateKey) {
    return NextResponse.json(
      { error: "VAPID keys not configured on the server (set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in Vercel)." },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const subscription = (body as { subscription?: PushSubscription } | null)?.subscription;
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return NextResponse.json({ error: "Missing or malformed subscription in body" }, { status: 400 });
  }

  setVapidDetails(subject, publicKey, privateKey);

  const payload = JSON.stringify({
    title: "OrbitOMS test",
    body: "Push is working",
    tag: "orbit-test",
    url: "/picking",
  });

  try {
    const result = await sendNotification(subscription, payload);
    return NextResponse.json({ ok: true, statusCode: result.statusCode });
  } catch (err: unknown) {
    // Surface the real push-service error (status + body), never swallow it.
    if (err instanceof WebPushError) {
      return NextResponse.json(
        { error: err.body || err.message, statusCode: err.statusCode },
        { status: err.statusCode >= 400 && err.statusCode <= 599 ? err.statusCode : 502 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push send failed" },
      { status: 500 },
    );
  }
}
