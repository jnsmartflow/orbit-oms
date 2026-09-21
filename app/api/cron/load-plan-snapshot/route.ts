import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runLoadPlanV2 } from "@/lib/floor/load-plan-v2-run";
import { hasAutoSnapshotToday, istToday, saveLoadPlanSnapshot, upcountryPoolIds } from "@/lib/floor/load-plan-snapshot";

export const dynamic = "force-dynamic";

// GET /api/cron/load-plan-snapshot
//
// Vercel Cron schedule: "30 9 * * *" UTC = 15:00 IST daily.
//
// Plans the pending Upcountry pool (the Load plan tab's due pool) in SUGGEST
// mode and keeps it as today's 'auto' snapshot for the admin "Load plan
// check". At most one a day: a retry after a save is a no-op, and the
// partial unique index load_plan_snapshot_auto_key backs that up.
//
// 🔴 NO RATES in the snapshot or the response — counts only.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { iso } = istToday();
    if (await hasAutoSnapshotToday()) return NextResponse.json({ ok: true, date: iso, skipped: "already taken" });
    const ids = await upcountryPoolIds();
    const res = await runLoadPlanV2({ orderIds: ids });
    if (!res.plan) return NextResponse.json({ ok: false, date: iso, error: "load plan v2 not set up" });
    const id = await saveLoadPlanSnapshot(res.plan, "auto");
    return NextResponse.json({ ok: id !== null, date: iso, snapshotId: id, bills: ids.length, cards: res.plan.cards.length });
  } catch (e) {
    console.error("[cron/load-plan-snapshot]", e instanceof Error ? e.message.split("\n")[0] : e);
    return NextResponse.json({ ok: false, error: "snapshot failed" }, { status: 500 });
  }
}
