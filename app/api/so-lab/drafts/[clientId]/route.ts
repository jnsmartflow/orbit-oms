import { NextResponse } from "next/server";
import { requireSoApi } from "@/lib/so-auth/require-so-api";
import {
  deleteSavedDraft, parseClientId, parseSnapshot, parseText, renameSavedDraft, upsertSavedDraft,
} from "@/lib/so-order/store";

export const dynamic = "force-dynamic";

// /api/so-lab/drafts/{clientId} — one named draft. clientId is the draft's own
// id as the page mints it; the SO id comes from the session only. The server
// keeps the 20 newest per SO.

type Ctx = { params: { clientId: string } };

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

// PUT { name: string | null, label, snapshot, savedAt (ms) } — upsert.
export async function PUT(req: Request, { params }: Ctx): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const clientId = parseClientId(params.clientId);
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const b = (body ?? {}) as { name?: unknown; label?: unknown; snapshot?: unknown; savedAt?: unknown };
  const name = isBlank(b.name) ? null : parseText(b.name, 60);
  const label = parseText(b.label, 200);
  const snapshot = parseSnapshot(b.snapshot);
  const savedAtMs = typeof b.savedAt === "number" && Number.isFinite(b.savedAt) ? b.savedAt : NaN;
  if (!clientId || !label || !snapshot || (!isBlank(b.name) && name === null) || !(savedAtMs > 0)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }
  // A phone clock running ahead must not push a draft into the future.
  const savedAt = new Date(Math.min(savedAtMs, Date.now()));

  await upsertSavedDraft(gate.so.salesOfficerId, clientId, { name, label, snapshot, savedAt });
  return NextResponse.json({ ok: true });
}

// PATCH { name: string | null } — rename (null / blank removes the name).
export async function PATCH(req: Request, { params }: Ctx): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const clientId = parseClientId(params.clientId);
  let body: unknown = null;
  try { body = await req.json(); } catch { body = null; }
  const raw = (body as { name?: unknown } | null)?.name;
  const name = isBlank(raw) ? null : parseText(raw, 60);
  if (!clientId || (!isBlank(raw) && name === null)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const found = await renameSavedDraft(gate.so.salesOfficerId, clientId, name);
  if (!found) return NextResponse.json({ ok: false, error: "Draft not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE — idempotent.
export async function DELETE(_req: Request, { params }: Ctx): Promise<NextResponse> {
  const gate = await requireSoApi();
  if (!gate.ok) return gate.res;

  const clientId = parseClientId(params.clientId);
  if (!clientId) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });

  await deleteSavedDraft(gate.so.salesOfficerId, clientId);
  return NextResponse.json({ ok: true });
}
