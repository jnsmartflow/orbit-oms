import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { addTelephonicTags, TELEPHONIC_TAGS } from "@/lib/billing/telephonic";
import { TELEPHONIC_MAX_PER_ADD } from "@/lib/billing/telephonic-so";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/telephonic/add — body { soNumbers: string[], tag: "hold" | "ci" }.
 *
 * 🔴 A BATCH ALWAYS ANSWERS 200 WHEN THE BODY IS WELL FORMED, even if every
 * number was a duplicate or unreadable. Each number's fate is a row in
 * `results` — "added" | "duplicate" | "invalid" — because one bad number in a
 * paste of twenty must not lose the other nineteen. A 400 means the REQUEST was
 * wrong: no list, an empty list, over the cap, or an unknown tag.
 *
 * `applied` is the applySoTagHolds summary when any added SO already had an OBD
 * (the late tag — it may have HELD a bill and raised a CI), else null.
 *
 * The user is ALWAYS the session user, never the body.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "billing_telephonic", "canEdit"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { soNumbers?: unknown; tag?: unknown };
  if (typeof body.tag !== "string" || !(TELEPHONIC_TAGS as readonly string[]).includes(body.tag)) {
    return NextResponse.json({ error: "Pick Hold or CI." }, { status: 400 });
  }
  if (!Array.isArray(body.soNumbers) || body.soNumbers.some((s) => typeof s !== "string")) {
    return NextResponse.json({ error: "soNumbers must be an array of strings." }, { status: 400 });
  }
  if (body.soNumbers.length === 0) {
    return NextResponse.json({ error: "No SO numbers to add." }, { status: 400 });
  }
  if (body.soNumbers.length > TELEPHONIC_MAX_PER_ADD) {
    return NextResponse.json(
      { error: `At most ${TELEPHONIC_MAX_PER_ADD} SO numbers per add.` },
      { status: 400 },
    );
  }

  const result = await addTelephonicTags({
    soNumbers: body.soNumbers as string[],
    tag: body.tag,
    userId,
    now: new Date(),
  });
  return NextResponse.json(result);
}
