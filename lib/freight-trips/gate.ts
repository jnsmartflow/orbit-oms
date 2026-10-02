// lib/freight-trips/gate.ts — the one gate every /api/freight-trips route uses.
//
// Page key `freight_trips` ONLY — never `floor` (a freight user may hold no floor
// tick, and a floor user is not thereby a freight user). canView for reads,
// canEdit for writes. checkAnyPermission carries the admin / superuser arms and
// the per-user ticks (CORE §5). The user id comes from the session, never a body.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission, type ActionKey } from "@/lib/permissions";

export type FreightGate = { ok: true; userId: number } | { ok: false; response: NextResponse };

export async function freightGate(action: Extract<ActionKey, "canView" | "canEdit">): Promise<FreightGate> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const roles = session.user.roles ?? [session.user.role];
  if (!(await checkAnyPermission(roles, "freight_trips", action))) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const userId = Number(session.user.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { ok: false, response: NextResponse.json({ error: "Invalid session user id" }, { status: 500 }) };
  }
  return { ok: true, userId };
}

/** A positive integer id, or null for absent / null. */
export function optionalId(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

/** Trimmed text, null when blank or absent. */
export function optionalText(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const t = value.trim();
  return { ok: true, value: t === "" ? null : t };
}

/** A list of positive integer ids (absent → []). */
export function idList(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0)) return null;
  return value as number[];
}
