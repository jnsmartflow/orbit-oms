// Floor Control — the dropdown option shapes the trip forms share.
//
// GET /api/floor/trips/options returns these four lists, and both the New trip
// form (trip-form.tsx) and the vehicle editor (trip-vehicle-editor.tsx) render
// them. They lived in build-trip-drawer.tsx until that component was deleted in
// slice 6 (2026-09-15) — it had not been rendered since trip-form.tsx replaced it
// on 2026-09-10, and these types were the only thing still imported from it.

export interface DeliveryTypeOption {
  id: number;
  name: string;
}

export interface VehicleOption {
  id: number;
  vehicleNo: string;
  driverName: string | null;
  /** vehicle_master.transporterId is NOT NULL (prisma/schema.prisma). */
  transporterId: number;
}

export interface TransporterOption {
  id: number;
  name: string;
}

export interface DispatchWindowOption {
  id: number;
  windowTime: string;
}
