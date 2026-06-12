import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTagSettings } from "@/lib/hide/tag-settings";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Tag on/off switches (Feature B) — admin-only read + upsert for app_tag_settings.
// Tags default ON: a key with no row is treated as enabled (see getTagSettings).
// ─────────────────────────────────────────────────────────────────────────────

// GET — current persisted settings as a { tagKey: isEnabled } map.
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  const settings = await getTagSettings();
  return NextResponse.json({ ok: true, settings });
}

// PATCH — upsert one tag's enabled state.
export async function PATCH(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Permission denied" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tagKey, isEnabled } = (body ?? {}) as {
    tagKey?: unknown;
    isEnabled?: unknown;
  };

  if (typeof tagKey !== "string" || tagKey.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "tagKey is required" }, { status: 400 });
  }
  if (typeof isEnabled !== "boolean") {
    return NextResponse.json({ ok: false, error: "isEnabled must be boolean" }, { status: 400 });
  }

  const userId = parseInt(session.user.id, 10);
  const key = tagKey.trim();
  const now = new Date();

  const row = await prisma.app_tag_settings.upsert({
    where:  { tagKey: key },
    update: { isEnabled, updatedById: userId, updatedAt: now },
    create: { tagKey: key, isEnabled, updatedById: userId, updatedAt: now },
  });

  return NextResponse.json({ ok: true, row });
}
