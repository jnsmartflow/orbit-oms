// lib/freight-trips/vehicle.ts — the vehicle SNAPSHOT for a freight trip.
//
// A master vehicle's driver is COPIED onto the trip at create / vehicle change
// (the floor trip rule, app/api/floor/trips/route.ts): the master's driver
// changes when a transporter swaps a man onto a van, and a freight record must
// keep saying who drove it. Never read the driver back through vehicleId.
// Freight differs in one way (owner, 2026-10-02): the user MAY type the driver —
// a typed value wins over the copy, and works for an ad-hoc plate too.

import { prisma } from "@/lib/prisma";

export interface VehicleSnapshot {
  vehicleNo: string;
  driverName: string | null;
  driverPhone: string | null;
  transporterId: number;
}

/** The master vehicle's snapshot, or null when the id does not exist. Read-only. */
export async function vehicleSnapshot(vehicleId: number): Promise<VehicleSnapshot | null> {
  return prisma.vehicle_master.findUnique({
    where: { id: vehicleId },
    select: { vehicleNo: true, driverName: true, driverPhone: true, transporterId: true },
  });
}

/** Does this transporter exist? */
export async function transporterExists(id: number): Promise<boolean> {
  return (await prisma.transporter_master.count({ where: { id } })) > 0;
}
