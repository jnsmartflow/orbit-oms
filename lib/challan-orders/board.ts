// lib/challan-orders/board.ts
//
// THE SHARED CHALLAN ORDERS SCREEN — its reads (Challan orders slice 5,
// 2026-10-07; plan code-plan-2026-10-07-challan-slice5.md §1, §6). READ-ONLY.
// Callers: GET /api/challan-orders/list (loadChallanBoard),
//          GET /api/challan-orders/history (loadChallanHistory),
//          GET /api/challan-orders/marker (getChallanMarker).
//
// Every column tested here is NOT NULL (isChallanOrder, isRemoved, workflowStage,
// the link status), so plain equality needs no null arm (CORE §13). The optional
// relations (ship-to override, trip, snapshot, linked OBD) are null-checked in
// toRow(). Sequential awaits, never prisma.$transaction (CORE §3).
// Slice 7 (2026-10-08): billed rows also carry the live line match
// (line-match.ts attachLineMatches — one lines read per board load / History page).

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getISTDayRange } from "@/lib/dates";
import type { ChallanBoard, ChallanHistory, ChallanLinkRow, ChallanRow, ChallanStatus } from "./board-types";
import { attachLineMatches } from "./line-match";

const CANCELLED = "cancelled";
const CHALLAN_LINKED_STAGE = "challan_linked";
const DISPATCHED = "dispatched";
const TRIP_CANCELLED = "cancelled";
/** Billed tab: OBD linked within the last 7 IST days (today + 6). */
const BILLED_DAYS = 7;
export const HISTORY_PAGE_SIZE = 50;

const POINT = { select: { customerCode: true, customerName: true, area: { select: { name: true } } } } as const;
const LINK_SELECT = {
  id: true,
  soNumber: true,
  status: true,
  linkedAt: true,
  obdLinkedAt: true,
  unlinkedAt: true,
  linkedBy: { select: { name: true } },
  unlinkedBy: { select: { name: true } },
  linkedOrder: { select: { obdNumber: true, invoiceNo: true, totalUnitQty: true } },
} satisfies Prisma.challan_order_so_linksSelect;

function includeFor(linkWhere: Prisma.challan_order_so_linksWhereInput | undefined) {
  return {
    customer: POINT,
    shipToOverrideCustomer: POINT,
    querySnapshot: { select: { totalUnitQty: true, totalVolume: true } },
    tripDrop: { select: { trip: { select: { tripNumber: true, tripDate: true, status: true } } } },
    challanSoLinks: { where: linkWhere, orderBy: { linkedAt: "asc" as const }, select: LINK_SELECT },
    // Every SAP bill billed against this challan (slice 6) — part-billing lists them all.
    challanLinkedOrders: {
      where: { isRemoved: false, workflowStage: { in: [CHALLAN_LINKED_STAGE, CANCELLED] } },
      orderBy: { id: "asc" as const },
      select: { id: true, obdNumber: true, soNumber: true, invoiceNo: true, workflowStage: true, totalUnitQty: true },
    },
  } satisfies Prisma.ordersInclude;
}
type BoardOrder = Prisma.ordersGetPayload<{ include: ReturnType<typeof includeFor> }>;

/** IST calendar date "YYYY-MM-DD" of an instant. */
function istDate(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function daysBetween(fromYmd: string, toYmd: string): number {
  const ms = Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

function toRow(o: BoardOrder, today: string): ChallanRow {
  const trip = o.tripDrop?.trip && o.tripDrop.trip.status !== TRIP_CANCELLED ? o.tripDrop.trip : null;
  // tripDate is @db.Date — a UTC-midnight Date; slice, never shift it (lib/trips/number.ts).
  const tripDate = trip ? trip.tripDate.toISOString().slice(0, 10) : null;
  const anchor = tripDate ?? istDate(o.createdAt);
  const links: ChallanLinkRow[] = o.challanSoLinks.map((l) => ({
    id: l.id,
    soNumber: l.soNumber,
    status: l.status as ChallanLinkRow["status"],
    linkedAt: l.linkedAt.toISOString(),
    linkedByName: l.linkedBy?.name ?? null,
    obdLinkedAt: l.obdLinkedAt?.toISOString() ?? null,
    obdNumber: l.linkedOrder?.obdNumber ?? null,
    invoiceNo: l.linkedOrder?.invoiceNo ?? null,
    tins: l.linkedOrder?.totalUnitQty ?? null,
    unlinkedAt: l.unlinkedAt?.toISOString() ?? null,
    unlinkedByName: l.unlinkedBy?.name ?? null,
  }));
  const live = links.filter((l) => l.status !== "unlinked");
  const cancelled = o.workflowStage === CANCELLED;
  const status: ChallanStatus = cancelled
    ? "cancelled"
    : live.length > 0 && live.every((l) => l.status === "linked")
      ? "billed"
      : live.some((l) => l.status === "waiting")
        ? "waiting"
        : trip !== null || o.workflowStage === DISPATCHED
          ? "sent"
          : "in_picking";
  const ship = o.shipToOverrideCustomer;
  return {
    orderId: o.id,
    orbNumber: o.obdNumber,
    billToName: o.customer?.customerName ?? o.shipToCustomerName ?? "(Unmatched)",
    billToCode: o.customer?.customerCode ?? o.shipToCustomerId,
    billToArea: o.customer?.area?.name ?? null,
    shipToName: ship?.customerName ?? null,
    shipToCode: ship?.customerCode ?? null,
    shipToArea: ship?.area?.name ?? null,
    tins: o.querySnapshot?.totalUnitQty ?? o.totalUnitQty ?? null,
    litres: o.querySnapshot?.totalVolume ?? o.volume ?? null,
    workflowStage: o.workflowStage,
    tripNumber: trip?.tripNumber ?? null,
    tripDate,
    createdAt: o.createdAt.toISOString(),
    ageDays: daysBetween(anchor, today),
    ageAnchor: tripDate ? "trip" : "created",
    status,
    links,
    linkedObds: o.challanLinkedOrders.map((b) => ({
      orderId: b.id,
      obdNumber: b.obdNumber,
      soNumber: b.soNumber,
      invoiceNo: b.invoiceNo,
      workflowStage: b.workflowStage,
      tins: b.totalUnitQty,
    })),
    match: null, // set on billed rows by attachLineMatches (slice 7)
  };
}

/**
 * The three working tabs, from ONE read (plan §1.1). The set is small — the
 * challans of the last weeks — so the split is done in memory. Dark staging rows
 * a failed create left behind are isRemoved and never read.
 */
export async function loadChallanBoard(now: Date): Promise<ChallanBoard> {
  const today = istDate(now);
  const orders = await prisma.orders.findMany({
    where: { isChallanOrder: true, isRemoved: false, workflowStage: { not: CANCELLED } },
    include: includeFor({ status: { in: ["waiting", "linked"] } }),
    orderBy: { createdAt: "asc" },
  });
  const rows = orders.map((o) => toRow(o, today));
  const billedFrom = getISTDayRange(
    new Date(Date.parse(`${today}T00:00:00Z`) - (BILLED_DAYS - 1) * 86_400_000).toISOString().slice(0, 10),
  ).start.getTime();

  const notBilled = rows
    .filter((r) => r.links.length === 0)
    .sort((a, b) => b.ageDays - a.ageDays || a.orderId - b.orderId);
  // M6: part-billed (one SO linked, one waiting) stays in Waiting.
  const waiting = rows
    .filter((r) => r.links.some((l) => l.status === "waiting"))
    .sort((a, b) => firstPaste(a) - firstPaste(b) || a.orderId - b.orderId);
  const billed = rows
    .filter((r) => r.links.length > 0 && r.links.every((l) => l.status === "linked"))
    .filter((r) => lastObdLink(r) >= billedFrom)
    .sort((a, b) => lastObdLink(b) - lastObdLink(a) || b.orderId - a.orderId);
  // Slice 7 — the live line match, one lines read for every Billed row.
  await attachLineMatches(billed);

  return {
    notBilled,
    waiting,
    billed,
    counts: { notBilled: notBilled.length, waiting: waiting.length, billed: billed.length },
    oldestNotBilledDays: notBilled.length > 0 ? notBilled[0].ageDays : null,
  };
}

function firstPaste(r: ChallanRow): number {
  return Math.min(...r.links.map((l) => Date.parse(l.linkedAt)));
}
function lastObdLink(r: ChallanRow): number {
  return Math.max(...r.links.map((l) => (l.obdLinkedAt ? Date.parse(l.obdLinkedAt) : 0)));
}

/**
 * History (plan §1.2): every ORB order created in [from, to] (IST days),
 * cancelled ones included, newest first, 50 a page. `q` (≥ 3 chars) searches the
 * ORB number, the bill-to name / code and any pasted SO.
 */
export async function loadChallanHistory(args: {
  from: string;
  to: string;
  q: string;
  page: number;
  now: Date;
}): Promise<ChallanHistory> {
  const start = getISTDayRange(args.from).start;
  const end = getISTDayRange(args.to).end;
  const q = args.q.trim();
  const where: Prisma.ordersWhereInput = {
    isChallanOrder: true,
    isRemoved: false,
    createdAt: { gte: start, lt: end },
    ...(q.length >= 3
      ? {
          OR: [
            { obdNumber: { contains: q, mode: "insensitive" } },
            { customer: { customerName: { contains: q, mode: "insensitive" } } },
            { customer: { customerCode: q } },
            { challanSoLinks: { some: { soNumber: { contains: q } } } },
          ],
        }
      : {}),
  };
  const total = await prisma.orders.count({ where });
  const page = Math.max(1, args.page);
  const orders = await prisma.orders.findMany({
    where,
    include: includeFor(undefined),
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * HISTORY_PAGE_SIZE,
    take: HISTORY_PAGE_SIZE,
  });
  const today = istDate(args.now);
  const rows = orders.map((o) => toRow(o, today));
  // Slice 7 — the line match for the page's billed rows, one lines read per page.
  await attachLineMatches(rows);
  return { rows, total, page, pageSize: HISTORY_PAGE_SIZE };
}

/**
 * The screen's change key (plan §6) — ONE statement. Moves when an ORB order is
 * created or changes (stage, trip, cancel), when a link row is pasted / unlinked
 * / linked, or when an ORB order's trip changes. `signature` carries the counts so
 * a change that leaves every MAX equal (an unlink back to a prior state) still fires.
 *
 * `count` is the NOT BILLED number — the Billing / Floor / Place Order pills show
 * it (work outstanding, the tab-bar rule), read off this same poll (onResult).
 * Same set as loadChallanBoard's notBilled: not removed, not cancelled, no live link.
 */
export async function getChallanMarker(): Promise<{ count: number; latest: string | null; signature: string }> {
  const [r] = await prisma.$queryRaw<
    {
      notBilled: number;
      orders: number;
      links: number;
      orderMax: Date | null;
      linkMax: Date | null;
      tripMax: Date | null;
    }[]
  >`
    SELECT
      (SELECT count(*) FROM orders o
        WHERE o."isChallanOrder" = true AND o."isRemoved" = false AND o."workflowStage" <> 'cancelled'
          AND NOT EXISTS (SELECT 1 FROM challan_order_so_links l
                           WHERE l."orbOrderId" = o.id AND l.status <> 'unlinked'))::int          AS "notBilled",
      (SELECT count(*) FROM orders WHERE "isChallanOrder" = true AND "isRemoved" = false)::int AS orders,
      (SELECT count(*) FROM challan_order_so_links WHERE status <> 'unlinked')::int          AS links,
      (SELECT max("updatedAt") FROM orders WHERE "isChallanOrder" = true)                    AS "orderMax",
      (SELECT max("updatedAt") FROM challan_order_so_links)                                  AS "linkMax",
      (SELECT max(t."updatedAt") FROM trips t
         JOIN trip_drops d ON d."tripId" = t.id
         JOIN orders o ON o."tripDropId" = d.id
        WHERE o."isChallanOrder" = true)                                                     AS "tripMax"`;
  const stamps = [r.orderMax, r.linkMax, r.tripMax].filter((d): d is Date => d !== null).map((d) => d.getTime());
  return {
    count: r.notBilled,
    latest: stamps.length === 0 ? null : new Date(Math.max(...stamps)).toISOString(),
    signature: `${r.orders}:${r.links}`,
  };
}
