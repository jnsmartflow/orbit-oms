import { prisma } from "@/lib/prisma";
import { VehiclesTable } from "@/components/admin/vehicles-table";

export const dynamic = 'force-dynamic';

export default async function VehiclesPage() {
  const [vehicles, deliveryTypes] = await Promise.all([
    prisma.vehicle_master.findMany({
      orderBy: { vehicleNumber: "asc" },
      include: { deliveryType: { select: { id: true, name: true } } },
    }),
    prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } }),
  ]);

  return (
    <VehiclesTable
      initialVehicles={vehicles.map((v) => ({
        id: v.id,
        vehicleNumber: v.vehicleNumber,
        vehicleType: v.vehicleType,
        capacityKg: v.capacityKg,
        capacityCbm: v.capacityCbm,
        deliveryType: v.deliveryType,
        isActive: v.isActive,
      }))}
      deliveryTypes={deliveryTypes.map((dt) => ({ id: dt.id, name: dt.name }))}
    />
  );
}
