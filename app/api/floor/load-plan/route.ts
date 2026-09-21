import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { runLoadPlanV2 } from "@/lib/floor/load-plan-v2-run";
import { saveLoadPlanSnapshot } from "@/lib/floor/load-plan-snapshot";
import { VEHICLE_TYPES, type AvailableVehicle, type VehicleType } from "@/lib/trips/load-plan-v2";

export const dynamic = "force-dynamic";

// POST /api/floor/load-plan — the Upcountry load plan v2 for the Load plan tab
// (2026-09-21, owner).
//
// Body: { orderIds, available?, pinned?, waiting? }
//   orderIds  — the tab's DUE pool as the screen shows it. Re-read server-side
//               (lib/floor/load-plan-v2-run.ts): only bills still Upcountry,
//               not removed and on no trip are planned.
//   available — the vehicles on hand (Replan). Absent → suggest mode.
//   pinned    — card keys the planner keeps as they are (incl. moved stops).
//   waiting   — stop ids the planner moved to Waiting.
//   snapshot  — true on the request a Replan press makes: the plan is also
//               kept as a 'replan' snapshot for the admin Load plan check
//               (a failed save never fails the plan).
//
// 🔴 READ-ONLY except the Replan snapshot above (bill ids, kg, stops — no rates),
// and NO RUPEE VALUE in the response: kg, stops, places,
// reasons and the kg / stop limits only. Rates never leave the server.
// Gate: `floor` canView, the same as GET /api/floor/board.

const MAX_IDS = 5000;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const strList = (v: unknown, max: number): string[] | null =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length <= 20000) ? (v as string[]) : null;

function parseAvailable(v: unknown): AvailableVehicle[] | null {
  if (!Array.isArray(v) || v.length > 100) return null;
  const out: AvailableVehicle[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (!VEHICLE_TYPES.includes(o.type as VehicleType) || !isInt(o.count) || o.count < 0 || o.count > 200) return null;
    if (o.maxKg !== undefined && (typeof o.maxKg !== "number" || !(o.maxKg > 0) || o.maxKg > 100000)) return null;
    out.push({ type: o.type as VehicleType, count: o.count, ...(o.maxKg !== undefined ? { maxKg: o.maxKg as number } : {}) });
  }
  return out;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const orderIds = body.orderIds;
  if (!Array.isArray(orderIds) || orderIds.length > MAX_IDS || !orderIds.every(isInt)) {
    return NextResponse.json({ error: "orderIds must be a list of ids" }, { status: 400 });
  }
  const available = body.available === undefined || body.available === null ? undefined : parseAvailable(body.available);
  const pinned = body.pinned === undefined ? [] : strList(body.pinned, 500);
  const waiting = body.waiting === undefined ? [] : strList(body.waiting, 2000);
  if (available === null || pinned === null || waiting === null) {
    return NextResponse.json({ error: "Bad available / pinned / waiting" }, { status: 400 });
  }

  try {
    const res = await runLoadPlanV2({ orderIds: orderIds as number[], ...(available ? { available } : {}), pinned, waiting });
    if (body.snapshot === true && available && res.plan) await saveLoadPlanSnapshot(res.plan, "replan");
    return NextResponse.json(res);
  } catch (e) {
    // No rate is in this message — only that the plan could not be built.
    console.warn("[load-plan-v2] plan failed:", e instanceof Error ? e.message.split("\n")[0] : e);
    return NextResponse.json({ error: "Load plan failed" }, { status: 500 });
  }
}
