import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sendToUser } from "@/lib/push/send";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test-saved — the REAL proof that storage works: sends to the
 * caller's SAVED devices with NO subscription in the request body. Auth
 * required; userId from the session only. sendToUser never throws — the result
 * summary is returned as-is (including per-endpoint outcomes).
 */
export async function POST(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.user.id);
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ error: "Invalid session user" }, { status: 400 });
  }

  const summary = await sendToUser(userId, {
    title: "OrbitOMS test",
    body: "Saved-phone push is working",
    tag: "orbit-test",
    url: "/picking",
  });

  return NextResponse.json(summary);
}
