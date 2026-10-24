// lib/freight-trips/options.ts — the vehicle and transporter lists for a freight trip.
//
// The where-clauses are COPIED from app/api/floor/trips/options/route.ts (never
// called — that route is floor-gated and a freight user may hold no floor tick):
//   vehicles      vehicle_master     WHERE isActive
//   transporters  transporter_master WHERE isActive
// Until 2026-10-24 the transporter list also required isRealTransporter = true;
// removed by owner decision — every active transporter shows. Do not re-add.
// Read-only.

import { prisma } from "@/lib/prisma";

export interface FreightVehicleOption {
  id: number;
  vehicleNo: string;
  driverName: string | null;
  driverPhone: string | null;
  transporterId: number;
}

export interface FreightTransporterOption {
  id: number;
  name: string;
}

export interface FreightOptions {
  vehicles: FreightVehicleOption[];
  transporters: FreightTransporterOption[];
}

export async function getFreightOptions(): Promise<FreightOptions> {
  const vehicles = await prisma.vehicle_master.findMany({
    where: { isActive: true },
    select: { id: true, vehicleNo: true, driverName: true, driverPhone: true, transporterId: true },
    orderBy: { vehicleNo: "asc" },
  });

  const transporters = await prisma.transporter_master.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { vehicles, transporters };
}
