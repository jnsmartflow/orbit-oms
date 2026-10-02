// lib/freight-trips/activity.ts — a freight trip's own history (freight_trip_activity).
//
// THE ONE WRITER, copied in shape from lib/trips/activity.ts (never imported —
// that module writes `trip_activity`, which freight must never touch).
//   - ONE row per press, never per bill.
//   - The summary is written HERE; callers pass facts, never wording.
//   - It SWALLOWS ITS OWN FAILURE: the real write (trip, bills) already landed,
//     and a missing history line must not turn a success into a 500. Logged to
//     the server console instead.
// The table is ON DELETE RESTRICT on freightTripId — a trip with history can
// never be deleted; trips are cancelled, never deleted.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FREIGHT_ACTIONS, type FreightAction } from "./status";

async function writeActivity(opts: {
  freightTripId: number;
  action: FreightAction;
  actorId: number;
  summary: string;
  detail?: Prisma.InputJsonValue;
}): Promise<void> {
  try {
    await prisma.freight_trip_activity.create({
      data: {
        freightTripId: opts.freightTripId,
        action: opts.action,
        actorId: opts.actorId,
        summary: opts.summary,
        ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
      },
    });
  } catch (err) {
    console.error(
      `[freight-activity] could not log ${opts.action} on freight trip ${opts.freightTripId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function bills(n: number): string {
  return `${n} bill${n === 1 ? "" : "s"}`;
}

/** A freight trip was built. */
export async function logFreightCreated(opts: {
  freightTripId: number;
  actorId: number;
  tripNumber: string;
  tripDate: string;
  vehicleLabel: string | null;
}): Promise<void> {
  await writeActivity({
    freightTripId: opts.freightTripId,
    action: FREIGHT_ACTIONS.created,
    actorId: opts.actorId,
    summary: `Created ${opts.tripNumber} for ${opts.tripDate}${opts.vehicleLabel ? ` · ${opts.vehicleLabel}` : " · no vehicle"}`,
    detail: { tripNumber: opts.tripNumber, tripDate: opts.tripDate, vehicle: opts.vehicleLabel },
  });
}

/** Bills added to or removed from a trip — only the ones that actually moved. */
export async function logFreightBills(opts: {
  freightTripId: number;
  actorId: number;
  direction: "added" | "removed";
  obdNumbers: string[];
}): Promise<void> {
  if (opts.obdNumbers.length === 0) return;
  await writeActivity({
    freightTripId: opts.freightTripId,
    action: opts.direction === "added" ? FREIGHT_ACTIONS.billsAdded : FREIGHT_ACTIONS.billsRemoved,
    actorId: opts.actorId,
    summary: `${opts.direction === "added" ? "Added" : "Removed"} ${bills(opts.obdNumbers.length)}`,
    detail: { obdNumbers: opts.obdNumbers },
  });
}

/** The vehicle (master or ad-hoc plate) changed, with the driver it carried. */
export async function logFreightVehicleChanged(opts: {
  freightTripId: number;
  actorId: number;
  from: string | null;
  to: string | null;
  driverName: string | null;
}): Promise<void> {
  await writeActivity({
    freightTripId: opts.freightTripId,
    action: FREIGHT_ACTIONS.vehicleChanged,
    actorId: opts.actorId,
    summary: `Vehicle ${opts.from ?? "none"} → ${opts.to ?? "none"}`,
    detail: { from: opts.from, to: opts.to, driverName: opts.driverName },
  });
}

/** Transporter / driver / note changed. `fields` names what changed, before → after. */
export async function logFreightDetailsChanged(opts: {
  freightTripId: number;
  actorId: number;
  changes: { field: string; from: unknown; to: unknown }[];
}): Promise<void> {
  if (opts.changes.length === 0) return;
  await writeActivity({
    freightTripId: opts.freightTripId,
    action: FREIGHT_ACTIONS.detailsChanged,
    actorId: opts.actorId,
    summary: `Changed ${opts.changes.map((c) => c.field).join(", ")}`,
    detail: { changes: opts.changes } as Prisma.InputJsonValue,
  });
}

/** The trip was cancelled. Written BEFORE the detach, with every OBD it held. */
export async function logFreightCancelled(opts: {
  freightTripId: number;
  actorId: number;
  tripNumber: string;
  obdNumbers: string[];
}): Promise<void> {
  await writeActivity({
    freightTripId: opts.freightTripId,
    action: FREIGHT_ACTIONS.cancelled,
    actorId: opts.actorId,
    summary: `Cancelled ${opts.tripNumber} · ${bills(opts.obdNumbers.length)} freed`,
    detail: { obdNumbers: opts.obdNumbers },
  });
}

export interface FreightActivityRow {
  id: number;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: string; // ISO
  detail: Prisma.JsonValue | null;
}

/** One trip's history, oldest first. */
export async function getFreightActivity(freightTripId: number): Promise<FreightActivityRow[]> {
  const rows = await prisma.freight_trip_activity.findMany({
    where: { freightTripId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      action: true,
      summary: true,
      createdAt: true,
      detail: true,
      actor: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    summary: r.summary,
    actorName: r.actor?.name ?? null,
    createdAt: r.createdAt.toISOString(),
    detail: r.detail ?? null,
  }));
}
