import { NextResponse } from "next/server";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import { deleteLiveDraft, parseSnapshot, putLiveDraft } from "@/lib/so-order/store";

export const dynamic = "force-dynamic";

// /api/so-lab/live-draft — the in-progress order, one row per SO.
// The board writes it ONLY on screen change, on page hide (fetch keepalive)
// and at most once per 60 s while editing, never when unchanged
// (app/so-lab/_board/so-storage.ts). SO id from the session only.

// PUT { snapshot, expectedRevision: number | null, deviceId?: string }
//   → 200 { revision } · 409 { conflict, revision } when another device wrote first.
export async function PUT(req: Request): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as { snapshot?: unknown; expectedRevision?: unknown; deviceId?: unknown };
  const snapshot = parseSnapshot(b.snapshot);
  const expected =
    b.expectedRevision === null ? null
    : Number.isInteger(b.expectedRevision) && (b.expectedRevision as number) >= 1 ? (b.expectedRevision as number)
    : undefined;
  const deviceId =
    typeof b.deviceId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.deviceId) ? b.deviceId : null;
  if (!snapshot || expected === undefined) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = await putLiveDraft(gate.so.salesOfficerId, snapshot, expected, deviceId);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "Changed on another device.", conflict: true, revision: result.revision },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, revision: result.revision });
}

// DELETE — the order was emptied (Send / Clear / Start over). Idempotent.
export async function DELETE(): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  await deleteLiveDraft(gate.so.salesOfficerId);
  return NextResponse.json({ ok: true });
}
