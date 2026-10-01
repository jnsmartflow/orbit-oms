import { NextResponse } from "next/server";
import { getSoSession } from "./session";
import { soLabStaffGate } from "./staff-gate";
import type { EligibleSo } from "./eligibility";

// The ONE gate for every /so-lab board API (C.2a, 2026-10-01):
//   1. the staff lock (lib/so-auth/lock.ts — superuser required while LOCKED),
//   2. getSoSession() — a live, eligible SO session, else
//      401 { reason: "no_so_session" }.
// 🔴 The SO id comes from the SESSION only — never from the request body or
// query string.

export async function requireSoApi(): Promise<
  { ok: true; so: EligibleSo } | { ok: false; res: NextResponse }
> {
  const denied = await soLabStaffGate();
  if (denied) return { ok: false, res: denied };

  const so = await getSoSession();
  if (!so) {
    return {
      ok: false,
      res: NextResponse.json({ ok: false, error: "Not logged in", reason: "no_so_session" }, { status: 401 }),
    };
  }
  return { ok: true, so };
}
