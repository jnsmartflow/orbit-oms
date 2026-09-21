import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isSuperuser } from "@/lib/rbac";
import { loadDayCheck, loadWeekCheck } from "@/lib/floor/load-plan-check-data";
import { summariseWeek, type DayCheck } from "@/lib/trips/load-plan-check";

export const dynamic = "force-dynamic";

// GET /api/admin/load-plan-check?date=YYYY-MM-DD&view=day|week[&snapshot=id]
//
// The admin "Load plan check": the day's load plan snapshot compared BY BILL
// with the trips the planners made (lib/floor/load-plan-check-data.ts).
// SUPERUSER ONLY — it carries the plan-vs-actual cost as a PERCENTAGE (never
// a rupee amount). READ-ONLY.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(session)) return NextResponse.json({ error: "Permission denied" }, { status: 403 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date") ?? "";
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const view = url.searchParams.get("view") === "week" ? "week" : "day";
  const snap = url.searchParams.get("snapshot");
  const snapshotId = snap && /^\d+$/.test(snap) ? Number(snap) : undefined;

  try {
    if (view === "day") return NextResponse.json({ view, day: await loadDayCheck(date, snapshotId) });
    const days = await loadWeekCheck(date);
    const checks = days.map((d) => d.check).filter((c): c is DayCheck => c !== null);
    // The week's cost %: the mean of the days that have one.
    const pcts = days.map((d) => d.costPct).filter((p): p is number => p !== null);
    return NextResponse.json({
      view,
      days,
      week: summariseWeek(checks),
      costPct: pcts.length ? pcts.reduce((n, p) => n + p, 0) / pcts.length : null,
    });
  } catch (e) {
    // Most likely the snapshot table does not exist yet.
    console.warn("[load-plan-check]", e instanceof Error ? e.message.split("\n")[0] : e);
    return NextResponse.json({ error: "No snapshots yet — run sql/2026-09-21-load-plan-snapshot.sql" }, { status: 500 });
  }
}
