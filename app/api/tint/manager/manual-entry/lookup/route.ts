import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { lookupManualPull } from "@/lib/tint/manual-pull";

export const dynamic = "force-dynamic";

/**
 * GET /api/tint/manager/manual-entry/lookup?obd=<OBD or invoice>
 *
 * "+ Add to Tint" step 1 — find the bill(s) and judge each (2026-10-24, the Add
 * to Tint server build). The reads and the rules are lib/tint/manual-pull.ts +
 * manual-pull-rules.ts; this route is the gate and the status codes.
 *
 * Returns `{ ok: true, term, matches: PullMatch[] }` — ALWAYS A LIST: one
 * invoice can be on two OBDs, and every bill found carries its own verdict
 * (ok / confirm / refused) and reason. `{ ok: false, errorCode, message }` only
 * when nothing could be looked up: BAD_REQUEST, NOT_FOUND, UNAUTHORIZED,
 * FORBIDDEN.
 *
 * The old single-bill `order` field and the old error shape for one refused
 * bill were transitional shims for the previous modal; both were removed with
 * the modal rebuild (2026-10-25) — components/tint/manual-tint-entry-modal.tsx
 * reads `matches` only.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, errorCode: "UNAUTHORIZED", message: "Unauthorized" }, { status: 401 });
  }

  // Per-user tick, not a job title (2026-09-06).
  //
  // 🔴 THIS GATE MUST NOT BE NARROWER THAN THE POST IT FEEDS. The manual-entry
  // modal calls THIS route first and only then POSTs to ../manual-entry. When
  // 64f897a9 widened the POST to tint_manager/canEdit it left this GET on
  // requireRole([TINT_MANAGER, ADMIN]), so Prakash (operation_manager) held the
  // write and was refused the read — and the failure was invisible: requireRole
  // redirects 307, fetch follows it to an HTML page, res.json() throws, and the
  // modal's own catch swallowed it into an empty box. canView rather than
  // canEdit because this route only reads; the holder sets are identical today
  // and the POST beside it is the thing that decides whether an entry may
  // actually be made. Both refusals are JSON with an errorCode (2026-10-24), so
  // the modal can say which.
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "tint_manager", "canView");
  if (!allowed) {
    return NextResponse.json({ ok: false, errorCode: "FORBIDDEN", message: "Permission denied" }, { status: 403 });
  }

  const result = await lookupManualPull(req.nextUrl.searchParams.get("obd") ?? "");
  if (!result.ok) {
    return NextResponse.json(result, { status: result.errorCode === "NOT_FOUND" ? 404 : 400 });
  }
  return NextResponse.json(result);
}
