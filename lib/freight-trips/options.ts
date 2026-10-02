// lib/freight-trips/options.ts — the vehicle and transporter lists for a freight trip.
//
// The where-clauses are COPIED from app/api/floor/trips/options/route.ts (never
// called — that route is floor-gated and a freight user may hold no floor tick):
//   vehicles      vehicle_master  WHERE isActive
//   transporters  transporter_master WHERE isRealTransporter AND isActive
// `isRealTransporter` keeps SAP status codes that arrived as transporter names
// (DELETE, CANCEL, HAND, PORTER …) out of the picker. It defaults FALSE, so the
// list is EMPTY until someone marks the real carriers. Freight then FALLS BACK
// to every active transporter and says so (`transportersFallback: true`) rather
// than shipping an empty dropdown. Read-only.

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
  /** True when no transporter is marked isRealTransporter and ALL active ones are listed. */
  transportersFallback: boolean;
}

export async function getFreightOptions(): Promise<FreightOptions> {
  const vehicles = await prisma.vehicle_master.findMany({
    where: { isActive: true },
    select: { id: true, vehicleNo: true, driverName: true, driverPhone: true, transporterId: true },
    orderBy: { vehicleNo: "asc" },
  });

  const real = await prisma.transporter_master.findMany({
    where: { isRealTransporter: true, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (real.length > 0) return { vehicles, transporters: real, transportersFallback: false };

  const all = await prisma.transporter_master.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return { vehicles, transporters: all, transportersFallback: true };
}
