import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { stampPickVisibility } from "@/lib/picking/visibility-gate";

export const dynamic = "force-dynamic";

/**
 * POST /api/floor/pick-visible — hand waiting bills over to the picking floor.
 *
 * Body: `{ orderIds: number[] }`. Single = an array of one; bulk = the operator's
 * whole selection. Writes `orders.pickVisibleAt` / `pickVisibleById`, which is
 * what the picking visibility gate filters on
 * (`lib/picking/visibility-gate.ts` + `buildPickingWhere`'s waiting branch).
 *
 * `visible` (2026-09-09) chooses the DIRECTION, and defaults to true so every
 * pre-existing caller is unchanged:
 *   true  → stamp both columns (hand the bill to the floor)
 *   false → clear both to null (pull it back to the desk)
 *
 * Same 422/partial contract as `/api/floor/release` and `/api/floor/actions`:
 * 422 when NOTHING was achieved, 200 otherwise, and the `failed` list always
 * rides along so a partial write can never be read as a clean success.
 *
 * ⚠ THE SUCCESS BUCKET IS `changed`, NOT `shown` (renamed 2026-09-09 with the
 * `visible` flag). On a pull-back, "shown" would name the opposite of what
 * happened — a status word that has drifted from its behaviour is the trap CORE
 * §3 spends a paragraph on, and it is cheapest to avoid on the day the second
 * direction lands. `skipped` and `failed` are direction-neutral and keep their
 * names.
 *
 * ═══ THE STAMPING RULE MOVED OUT OF THIS FILE — 2026-09-09 ═══
 *
 * 🔴 The per-bill loop, the stage refusal, the skip test and the single
 * `orders.update` now live in `stampPickVisibility()` in
 * `lib/picking/visibility-gate.ts`. They were extracted, not rewritten: every
 * guard is the original, moved verbatim, and this route's request/response
 * contract is byte-identical to what it was.
 *
 * WHY: `POST /api/trips/[id]/release` hands a whole trip's bills to the floor
 * and must do it by the SAME rule. A second copy would be two answers to "may
 * this bill be handed over" on the same column. ONE OWNER PER BEHAVIOUR — the
 * same discipline that keeps `buildPickingWhere` shared between the queue and
 * the marker, and `sortPickingQueue` shared between Picking and Floor.
 *
 * 🔒 In particular the LOCKED RULE — only a bill at `SUPPORT_DONE_OUTPUT` can
 * ever be stamped — did not move screens, it moved files. It is still the
 * server-side copy that holds when the button and the query are both wrong.
 *
 * What stays HERE is what belongs to an HTTP route and nothing else: the
 * session, the permission gate, body validation, and the status code.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // canEdit, not canView — handing work to the floor changes what three
  // supervisors see on their phones. The admin bypass lives inside
  // checkAnyPermission (lib/permissions.ts), so this is the standard shape.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canEdit");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Who actually did this — the real session, never a body claim. Number("") is
  // 0 and finite, so test for a real positive integer (the release routes' rule).
  const visibleById = Number(session.user.id);
  if (!Number.isInteger(visibleById) || visibleById <= 0) {
    return NextResponse.json({ error: "Invalid session user id" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderIds?: number[]; visible?: boolean };
  const orderIds = body.orderIds;
  // Direction. DEFAULTS TO TRUE when absent, so a caller that predates the flag
  // still hands bills to the floor. A strict boolean test on a value that IS
  // present, though — "false" or 0 from a sloppy client means the reverse
  // direction, and coercing either would send bills the wrong way.
  if (body.visible !== undefined && typeof body.visible !== "boolean") {
    return NextResponse.json({ error: "visible must be a boolean when supplied" }, { status: 400 });
  }
  const visible = body.visible ?? true;
  // Rejected BEFORE the loop, exactly as /api/floor/release rejects an empty
  // `releases`. This is what lets a 422 below mean "every bill was tried and
  // every bill failed" rather than "you sent nothing".
  if (
    !Array.isArray(orderIds) ||
    orderIds.length === 0 ||
    !orderIds.every((id) => typeof id === "number" && Number.isInteger(id))
  ) {
    return NextResponse.json(
      { error: "orderIds is required and must be a non-empty array of integers" },
      { status: 400 },
    );
  }

  // The whole per-bill rule, in the one place that owns it.
  const { changed, skipped, failed } = await stampPickVisibility({
    orderIds,
    visible,
    actorId: visibleById,
  });

  // Nothing achieved at all → 422, so a fully-rejected request cannot be read as
  // success. A SKIP counts as achieved: the bills are in the state the operator
  // asked for, which is the outcome he wanted.
  const status = changed.length === 0 && skipped.length === 0 && failed.length > 0 ? 422 : 200;
  return NextResponse.json({ changed, skipped, failed }, { status });
}
