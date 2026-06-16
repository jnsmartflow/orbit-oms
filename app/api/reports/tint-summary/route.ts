import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRole, ROLES } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { checkPermission } from "@/lib/permissions";
import { getHideExclusion } from "@/lib/hide/visibility";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/tint-summary — read-only daily "Tint Summary" report.
//
// Query params (all optional):
//   date=YYYY-MM-DD   IST OBD-date the report is built for (default = today IST)
//   operators=1,2,3   comma operator ids — scopes operator-centric outputs only
//   includeHold=true  when "false", drops lower(dispatchStatus)="hold" OBDs
//   smu=A,B           comma SMU names — filters all order-based sections
//   area=Local,IGT    comma delivery-type names — filters all order-based sections
//   trendDays=7       length of the intake-vs-completed trend window
//
// "Today" axes (locked):
//   intake / aging / open-age / top-customers  → orders.orderDateTime  (OBD date)
//   completed / pace / operator-output         → completedAt           (work done)
// All timestamps are UTC; every day/hour boundary is converted to IST (UTC+5:30).
//
// Respects hide rules: every base query AND-merges getHideExclusion() — the
// report never bypasses it. The operators filter applies ONLY to operator-centric
// outputs (operators[], completedRegister, openRegister); aggregate balances
// (summary/movement/pace/trend) ignore it so the opening-balance arithmetic
// stays internally consistent. smu/area/includeHold apply to every order-based
// section.
// ─────────────────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** IST wall-clock date string (YYYY-MM-DD) for a UTC instant. */
function istDateStr(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST wall-clock hour (0-23) for a UTC instant. */
function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** UTC [start, end) instants bounding one IST calendar day. */
function istDayBounds(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00.000+05:30`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function GET(req: Request): Promise<NextResponse> {
  const session = await auth();
  requireRole(session, [ROLES.TINT_MANAGER, ROLES.ADMIN, ROLES.OPERATIONS, ROLES.OPERATION_MANAGER]);
  if (session!.user.role !== "admin" && session!.user.role !== ROLES.OPERATIONS) {
    const allowed = await checkPermission(session!.user.role, "tint_manager", "canView");
    if (!allowed) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const url = new URL(req.url, "http://localhost");
    const dateParam = url.searchParams.get("date");
    const reportDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : istDateStr(new Date());

    const operators = (url.searchParams.get("operators") ?? "")
      .split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
    const smuFilterArr = (url.searchParams.get("smu") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const areaFilterArr = (url.searchParams.get("area") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const includeHold = (url.searchParams.get("includeHold") ?? "true").toLowerCase() !== "false";
    const trendDaysRaw = parseInt(url.searchParams.get("trendDays") ?? "7", 10);
    const trendDays = Number.isFinite(trendDaysRaw) && trendDaysRaw > 0 ? Math.min(trendDaysRaw, 60) : 7;

    const opFilter = operators.length ? new Set(operators) : null;
    const smuFilter = smuFilterArr.length ? new Set(smuFilterArr) : null;
    const areaFilter = areaFilterArr.length ? new Set(areaFilterArr) : null;

    const { start, end } = istDayBounds(reportDate);
    const trendStart = new Date(start.getTime() - (trendDays - 1) * DAY_MS);
    const now = new Date();

    const hideExclusion = await getHideExclusion();

    // Shared customer include — resolves the site name + area→deliveryType chain.
    const customerInclude = {
      select: {
        customerName: true,
        area: { select: { deliveryType: { select: { name: true } } } },
      },
    } as const;

    const [
      intakeOrders,
      pendingOrders,
      doneAssignments,
      doneSplits,
      trendIntake,
      trendDoneAssignments,
      trendDoneSplits,
      pausedToday,
      skippedToday,
      removedToday,
    ] = await Promise.all([
      // Set 1 — today's intake (OBD date axis)
      prisma.orders.findMany({
        where: {
          AND: [
            { orderType: "tint", isRemoved: false, orderDateTime: { gte: start, lt: end } },
            hideExclusion,
          ],
        },
        include: {
          querySnapshot: { select: { totalVolume: true } },
          customer: customerInclude,
        },
      }),

      // Set 2 — live pending (whole-OBD; closing balance + open register + aging)
      prisma.orders.findMany({
        where: {
          AND: [
            {
              orderType: "tint",
              workflowStage: { in: ["pending_tint_assignment", "tint_assigned", "tinting_in_progress"] },
              isRemoved: false,
            },
            hideExclusion,
          ],
        },
        include: {
          querySnapshot: { select: { totalVolume: true } },
          customer: customerInclude,
          tintAssignments: {
            where: { status: { notIn: ["done", "cancelled"] } },
            select: { status: true, assignedTo: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
          },
        },
      }),

      // Set 3 — completed whole-OBD assignments today (completion axis)
      prisma.tint_assignments.findMany({
        where: {
          status: "tinting_done",
          completedAt: { gte: start, lt: end },
          order: { is: { AND: [{ isRemoved: false }, hideExclusion] } },
        },
        select: {
          completedAt: true,
          assignedTo: { select: { id: true, name: true } },
          order: {
            select: {
              id: true, obdNumber: true, shipToCustomerName: true, customerId: true,
              smu: true, dispatchStatus: true,
              querySnapshot: { select: { totalVolume: true } },
              customer: customerInclude,
            },
          },
        },
      }),

      // Set 4 — completed splits today (litres = Σ active line volumeLine)
      prisma.order_splits.findMany({
        where: {
          status: "tinting_done",
          completedAt: { gte: start, lt: end },
          order: { is: { AND: [{ isRemoved: false }, hideExclusion] } },
        },
        select: {
          completedAt: true,
          assignedTo: { select: { id: true, name: true } },
          lineItems: {
            where: { lineStatus: "active" },
            select: { rawLineItem: { select: { volumeLine: true } } },
          },
          order: {
            select: {
              id: true, obdNumber: true, shipToCustomerName: true, customerId: true,
              smu: true, dispatchStatus: true,
              customer: customerInclude,
            },
          },
        },
      }),

      // Trend — intake counts by IST day across the window
      prisma.orders.findMany({
        where: {
          AND: [
            { orderType: "tint", isRemoved: false, orderDateTime: { gte: trendStart, lt: end } },
            hideExclusion,
          ],
        },
        select: { orderDateTime: true },
      }),

      // Trend — completed assignments by IST day (distinct order per day)
      prisma.tint_assignments.findMany({
        where: {
          status: "tinting_done",
          completedAt: { gte: trendStart, lt: end },
          order: { is: { AND: [{ isRemoved: false }, hideExclusion] } },
        },
        select: { orderId: true, completedAt: true },
      }),

      // Trend — completed splits by IST day (distinct order per day)
      prisma.order_splits.findMany({
        where: {
          status: "tinting_done",
          completedAt: { gte: trendStart, lt: end },
          order: { is: { AND: [{ isRemoved: false }, hideExclusion] } },
        },
        select: { orderId: true, completedAt: true },
      }),

      // Flags — pause / skip / remove events stamped today
      prisma.tint_pause_events.count({ where: { pausedAt: { gte: start, lt: end } } }),
      prisma.tint_skip_events.count({ where: { skippedAt: { gte: start, lt: end } } }),
      prisma.orders.count({ where: { isRemoved: true, removedAt: { gte: start, lt: end } } }),
    ]);

    // ── SMU + dealer lookup (orders.smu can be null → fall back to raw summary) ──
    const allObds = Array.from(new Set<string>([
      ...intakeOrders.map((o) => o.obdNumber),
      ...pendingOrders.map((o) => o.obdNumber),
      ...doneAssignments.map((a) => a.order.obdNumber),
      ...doneSplits.map((s) => s.order.obdNumber),
    ]));
    const rawSummaries = allObds.length
      ? await prisma.import_raw_summary.findMany({
          where: { obdNumber: { in: allObds } },
          select: { obdNumber: true, smu: true, billToCustomerName: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const smuMap = new Map<string, string | null>();
    const dealerMap = new Map<string, string | null>();
    for (const s of rawSummaries) {            // later rows (newer) win
      smuMap.set(s.obdNumber, s.smu);
      dealerMap.set(s.obdNumber, s.billToCustomerName);
    }

    // ── Normalised row helpers ───────────────────────────────────────────────
    type Customer = { customerName: string | null; area: { deliveryType: { name: string } | null } | null } | null;
    const resolveSmu = (obd: string, smu: string | null) => smu ?? smuMap.get(obd) ?? null;
    const resolveArea = (c: Customer) => c?.area?.deliveryType?.name ?? "Unknown";
    const isHoldOf = (s: string | null) => (s ?? "").toLowerCase() === "hold";
    const ageDaysOf = (dt: Date | null) =>
      dt ? Math.max(0, Math.floor((now.getTime() - dt.getTime()) / DAY_MS)) : 0;

    // smu/area/includeHold predicate (order-based sections).
    const passSmuArea = (smu: string | null, area: string) =>
      (!smuFilter || smuFilter.has(smu ?? "")) && (!areaFilter || areaFilter.has(area));
    const passOrder = (smu: string | null, area: string, hold: boolean) =>
      passSmuArea(smu, area) && (includeHold || !hold);

    // ── INTAKE rows (Set 1) ──────────────────────────────────────────────────
    const intakeRows = intakeOrders.map((o) => {
      const smu = resolveSmu(o.obdNumber, o.smu);
      const area = resolveArea(o.customer as Customer);
      return {
        orderId: o.id,
        obd: o.obdNumber,
        customerId: o.customerId,
        site: o.shipToCustomerName ?? (o.customer as Customer)?.customerName ?? "—",
        dealer: dealerMap.get(o.obdNumber) ?? null,
        litres: o.querySnapshot?.totalVolume ?? 0,
        smu, area,
        isHold: isHoldOf(o.dispatchStatus),
      };
    }).filter((r) => passOrder(r.smu, r.area, r.isHold));

    const intakeCount = intakeRows.length;
    const intakeLitres = r2(intakeRows.reduce((s, r) => s + r.litres, 0));

    // ── PENDING rows (Set 2) — closing balance + open register + aging ───────
    const pendingRows = pendingOrders.map((o) => {
      const smu = resolveSmu(o.obdNumber, o.smu);
      const area = resolveArea(o.customer as Customer);
      const assignments = o.tintAssignments ?? [];
      const paused = assignments.some((a) => a.status === "paused");
      const status =
        paused ? "Paused"
        : o.workflowStage === "tinting_in_progress" ? "In Progress"
        : o.workflowStage === "tint_assigned" ? "Assigned"
        : "Pending";
      const op = assignments[0]?.assignedTo ?? null;
      return {
        orderId: o.id,
        obd: o.obdNumber,
        site: o.shipToCustomerName ?? (o.customer as Customer)?.customerName ?? "—",
        litres: o.querySnapshot?.totalVolume ?? 0,
        status,
        operatorId: op?.id ?? null,
        operator: op?.name ?? null,
        ageDays: ageDaysOf(o.orderDateTime),
        isHold: isHoldOf(o.dispatchStatus),
        smu, area,
      };
    });

    // Closing = live pending passing smu/area/includeHold (NOT operator-scoped).
    const closingRows = pendingRows.filter((r) => passOrder(r.smu, r.area, r.isHold));
    const closingCount = closingRows.length;
    const closingLitres = r2(closingRows.reduce((s, r) => s + r.litres, 0));

    // ── COMPLETED set — one row per OBD, MAX(completedAt) across splits ───────
    type CompletedObd = {
      orderId: number; obd: string; site: string; litres: number;
      completedAt: Date; operator: string | null; operatorId: number | null;
      smu: string | null; area: string; isHold: boolean;
    };
    const completedByOrder = new Map<number, CompletedObd>();
    // Per-job rows feed the operators[] breakdown (a split OBD is many jobs).
    type Job = { operatorId: number | null; operator: string | null; litres: number; smu: string | null; area: string; isHold: boolean };
    const jobs: Job[] = [];

    for (const a of doneAssignments) {
      const o = a.order;
      const smu = resolveSmu(o.obdNumber, o.smu);
      const area = resolveArea(o.customer as Customer);
      const isHold = isHoldOf(o.dispatchStatus);
      const litres = o.querySnapshot?.totalVolume ?? 0;
      completedByOrder.set(o.id, {
        orderId: o.id, obd: o.obdNumber,
        site: o.shipToCustomerName ?? (o.customer as Customer)?.customerName ?? "—",
        litres, completedAt: a.completedAt!,
        operator: a.assignedTo?.name ?? null, operatorId: a.assignedTo?.id ?? null,
        smu, area, isHold,
      });
      jobs.push({ operatorId: a.assignedTo?.id ?? null, operator: a.assignedTo?.name ?? null, litres, smu, area, isHold });
    }

    for (const s of doneSplits) {
      const o = s.order;
      const smu = resolveSmu(o.obdNumber, o.smu);
      const area = resolveArea(o.customer as Customer);
      const isHold = isHoldOf(o.dispatchStatus);
      const splitLitres = s.lineItems.reduce((sum, li) => sum + (li.rawLineItem.volumeLine ?? 0), 0);
      jobs.push({ operatorId: s.assignedTo?.id ?? null, operator: s.assignedTo?.name ?? null, litres: splitLitres, smu, area, isHold });

      // OBD-level: aggregate split litres, keep MAX completedAt + that split's operator.
      const existing = completedByOrder.get(o.id);
      if (!existing) {
        completedByOrder.set(o.id, {
          orderId: o.id, obd: o.obdNumber,
          site: o.shipToCustomerName ?? (o.customer as Customer)?.customerName ?? "—",
          litres: splitLitres, completedAt: s.completedAt!,
          operator: s.assignedTo?.name ?? null, operatorId: s.assignedTo?.id ?? null,
          smu, area, isHold,
        });
      } else {
        existing.litres += splitLitres;
        if (s.completedAt! > existing.completedAt) {
          existing.completedAt = s.completedAt!;
          existing.operator = s.assignedTo?.name ?? null;
          existing.operatorId = s.assignedTo?.id ?? null;
        }
      }
    }

    const completedObds = Array.from(completedByOrder.values())
      .filter((c) => passOrder(c.smu, c.area, c.isHold));
    const completedCount = completedObds.length;
    const completedLitres = r2(completedObds.reduce((s, c) => s + c.litres, 0));

    // ── SUMMARY + MOVEMENT ───────────────────────────────────────────────────
    const workTotal = completedCount + closingCount;
    const summary = {
      remaining: { count: closingCount, litres: closingLitres },
      completed: { count: completedCount, litres: completedLitres },
      intake: { count: intakeCount, litres: intakeLitres },
      workloadCleared: {
        pct: workTotal > 0 ? Math.round((completedCount / workTotal) * 100) : 0,
        done: completedCount,
        total: workTotal,
      },
    };

    // Opening = Closing + Completed − Intake. Best-effort reconstruction: removals,
    // reassignments and same-day arrive-and-complete OBDs can skew it (no EOD snapshot exists).
    const movement = {
      opening: {
        count: closingCount + completedCount - intakeCount,
        litres: r2(closingLitres + completedLitres - intakeLitres),
      },
      intake: { count: intakeCount, litres: intakeLitres },
      completed: { count: completedCount, litres: completedLitres },
      closing: { count: closingCount, litres: closingLitres },
    };

    // ── PACE — cumulative litres by IST hour (span covers 9..18 + any outliers) ─
    const litresByHour = new Map<number, number>();
    for (const c of completedObds) {
      const h = istHour(c.completedAt);
      litresByHour.set(h, (litresByHour.get(h) ?? 0) + c.litres);
    }
    const completedHours = Array.from(litresByHour.keys());
    const loHour = Math.min(9, ...(completedHours.length ? completedHours : [9]));
    const hiHour = Math.max(18, ...(completedHours.length ? completedHours : [18]));
    const pace: Array<{ hourIST: number; cumulativeLitres: number }> = [];
    let cumulative = 0;
    for (let h = loHour; h <= hiHour; h++) {
      cumulative += litresByHour.get(h) ?? 0;
      pace.push({ hourIST: h, cumulativeLitres: r2(cumulative) });
    }

    // ── TREND — intake vs completed counts per IST day over trendDays ─────────
    const intakeByDay = new Map<string, number>();
    for (const o of trendIntake) {
      if (!o.orderDateTime) continue;
      const d = istDateStr(o.orderDateTime);
      intakeByDay.set(d, (intakeByDay.get(d) ?? 0) + 1);
    }
    const completedOrdersByDay = new Map<string, Set<number>>();
    for (const a of [...trendDoneAssignments, ...trendDoneSplits]) {
      if (!a.completedAt) continue;
      const d = istDateStr(a.completedAt);
      if (!completedOrdersByDay.has(d)) completedOrdersByDay.set(d, new Set());
      completedOrdersByDay.get(d)!.add(a.orderId);
    }
    const trend: Array<{ date: string; intakeCount: number; completedCount: number }> = [];
    for (let i = 0; i < trendDays; i++) {
      const dayStart = new Date(start.getTime() - (trendDays - 1 - i) * DAY_MS);
      const d = istDateStr(dayStart);
      trend.push({
        date: d,
        intakeCount: intakeByDay.get(d) ?? 0,
        completedCount: completedOrdersByDay.get(d)?.size ?? 0,
      });
    }

    // ── OPERATORS — jobs + litres per operator (operator filter applies here) ─
    const opAgg = new Map<number, { name: string | null; jobs: number; litres: number }>();
    for (const j of jobs) {
      if (j.operatorId == null) continue;
      if (!passOrder(j.smu, j.area, j.isHold)) continue;
      if (opFilter && !opFilter.has(j.operatorId)) continue;
      const cur = opAgg.get(j.operatorId) ?? { name: j.operator, jobs: 0, litres: 0 };
      cur.jobs += 1;
      cur.litres += j.litres;
      opAgg.set(j.operatorId, cur);
    }
    const operatorsOut = Array.from(opAgg.entries())
      .map(([operatorId, v]) => ({ operatorId, name: v.name, jobs: v.jobs, litres: r2(v.litres) }))
      .sort((a, b) => b.litres - a.litres);

    // ── AGING — pending OBDs bucketed by OBD-date age ─────────────────────────
    const buckets = [
      { bucket: "<1d", count: 0, litres: 0 },
      { bucket: "1d", count: 0, litres: 0 },
      { bucket: "2-3d", count: 0, litres: 0 },
      { bucket: "4-7d", count: 0, litres: 0 },
      { bucket: "8+", count: 0, litres: 0 },
    ];
    const bucketIdx = (d: number) => (d <= 0 ? 0 : d === 1 ? 1 : d <= 3 ? 2 : d <= 7 ? 3 : 4);
    for (const r of closingRows) {
      const b = buckets[bucketIdx(r.ageDays)];
      b.count += 1;
      b.litres += r.litres;
    }
    const aging = buckets.map((b) => ({ ...b, litres: r2(b.litres) }));

    // ── SMU + AREA split (over today's intake) ───────────────────────────────
    const smuAgg = new Map<string, { count: number; litres: number }>();
    const areaAgg = new Map<string, { count: number; litres: number }>();
    for (const r of intakeRows) {
      const sk = r.smu ?? "Unknown";
      const sc = smuAgg.get(sk) ?? { count: 0, litres: 0 };
      sc.count += 1; sc.litres += r.litres; smuAgg.set(sk, sc);
      const ac = areaAgg.get(r.area) ?? { count: 0, litres: 0 };
      ac.count += 1; ac.litres += r.litres; areaAgg.set(r.area, ac);
    }
    const smuOut = Array.from(smuAgg.entries())
      .map(([name, v]) => ({ name, count: v.count, litres: r2(v.litres) }))
      .sort((a, b) => b.litres - a.litres);
    const areaOut = Array.from(areaAgg.entries())
      .map(([name, v]) => ({ name, count: v.count, litres: r2(v.litres) }))
      .sort((a, b) => b.litres - a.litres);

    // ── TOP CUSTOMERS — all today's OBDs grouped by customerId (top 5) ────────
    const custAgg = new Map<number, { name: string; dealer: string | null; obdCount: number; litres: number }>();
    for (const r of intakeRows) {
      if (r.customerId == null) continue;
      const cur = custAgg.get(r.customerId) ?? { name: r.site, dealer: r.dealer, obdCount: 0, litres: 0 };
      cur.obdCount += 1; cur.litres += r.litres;
      custAgg.set(r.customerId, cur);
    }
    const topCustomers = Array.from(custAgg.entries())
      .map(([customerId, v]) => ({ customerId, name: v.name, dealer: v.dealer, obdCount: v.obdCount, litres: r2(v.litres) }))
      .sort((a, b) => b.litres - a.litres)
      .slice(0, 5);

    // ── OPEN REGISTER — live pending (operator filter applies) ────────────────
    const openRegister = closingRows
      .filter((r) => !opFilter || (r.operatorId != null && opFilter.has(r.operatorId)))
      .map((r) => ({
        obd: r.obd, site: r.site, litres: r2(r.litres),
        status: r.status, operator: r.operator, ageDays: r.ageDays, isHold: r.isHold,
      }))
      .sort((a, b) => b.ageDays - a.ageDays);

    // ── COMPLETED REGISTER — one row per completed OBD (operator filter applies) ─
    const completedRegister = completedObds
      .filter((c) => !opFilter || (c.operatorId != null && opFilter.has(c.operatorId)))
      .map((c) => ({
        obd: c.obd, site: c.site, litres: r2(c.litres),
        operator: c.operator, doneAtIST: new Date(c.completedAt.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19),
      }))
      .sort((a, b) => (a.doneAtIST < b.doneAtIST ? 1 : -1));

    // ── FLAGS — hold counts ignore includeHold so holds always surface ────────
    const heldPending = pendingRows.filter((r) => r.isHold && passSmuArea(r.smu, r.area));
    const flags = {
      holdCount: heldPending.length,
      oldestHoldDays: heldPending.reduce((m, r) => Math.max(m, r.ageDays), 0),
      pausedToday,
      skippedToday,
      removedToday,
    };

    return NextResponse.json({
      reportDate,
      generatedAt: now.toISOString(),
      summary,
      movement,
      pace,
      trend,
      operators: operatorsOut,
      aging,
      smu: smuOut,
      area: areaOut,
      topCustomers,
      openRegister,
      completedRegister,
      flags,
    });
  } catch (err) {
    console.error("[reports/tint-summary] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
