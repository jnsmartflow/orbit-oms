import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { loadChallanAlerts, type ChallanAlert } from "@/lib/challan-orders/alerts";
import { loadCheckFailedBatches, type CheckFailedBatch } from "@/lib/challan-orders/check-failed";

export const dynamic = "force-dynamic";

/**
 * GET /api/challan-orders/alerts — the red challan alerts (Challan orders slice 6,
 * 2026-10-07; S6-1 / S6-2 / S6-6): DOUBLE_DISPATCH, DEALER_MISMATCH, CATCH_FAILED — and
 * (slice 6c) every IMPORT whose challan check could not run, with its withheld bills.
 * READ-ONLY, computed live.
 *
 * The two sources are read SEPARATELY: the batch list (import_batches) never touches the
 * link table, so it still answers while the link table is down; if the link-based alerts
 * fail, `linkAlertsFailed` tells the strip to say "Challan check status unknown" instead
 * of going quiet.
 *
 * `canRetryBatches` = floor canEdit — the permission that releases bills on Floor and
 * gates POST /api/import/obd?action=challan-check-retry.
 *
 * Gate: challan_orders canView OR floor canView — the alerts must reach the Floor desk
 * (S6-2, S6-6) even when that person holds no challan tick.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const roles = session.user.roles ?? [session.user.role];
  const allowed =
    (await checkAnyPermission(roles, "challan_orders", "canView")) ||
    (await checkAnyPermission(roles, "floor", "canView"));
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let batches: CheckFailedBatch[] = [];
  let batchesFailed = false;
  try {
    batches = await loadCheckFailedBatches();
  } catch (err) {
    console.error("[challan-alerts] check-failed batches unreadable", err);
    batchesFailed = true;
  }
  let alerts: ChallanAlert[] = [];
  let linkAlertsFailed = false;
  try {
    alerts = await loadChallanAlerts();
  } catch (err) {
    console.error("[challan-alerts] link-based alerts unreadable", err);
    linkAlertsFailed = true;
  }
  const canRetryBatches = await checkAnyPermission(roles, "floor", "canEdit");
  return NextResponse.json(
    { alerts, batches, linkAlertsFailed: linkAlertsFailed || batchesFailed, canRetryBatches },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
