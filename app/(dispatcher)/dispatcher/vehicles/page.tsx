import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission, getPagePermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { VehiclesTable } from "@/components/admin/vehicles-table";

export const dynamic = "force-dynamic";

export default async function DispatcherVehiclesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canView = await checkPermission(session.user.role, "vehicles", "canView");
  if (!canView) redirect("/unauthorized");
  const perms = await getPagePermissions(session.user.role, "vehicles");

  const [vehicles, transporters] = await Promise.all([
    prisma.vehicle_master.findMany({
      orderBy: { vehicleNo: "asc" },
      include: { transporter: { select: { id: true, name: true } } },
    }),
    prisma.transporter_master.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <VehiclesTable
      initialVehicles={vehicles.map((v) => ({
        id:                  v.id,
        vehicleNo:           v.vehicleNo,
        category:            v.category,
        capacityKg:          v.capacityKg,
        maxCustomers:        v.maxCustomers,
        deliveryTypeAllowed: v.deliveryTypeAllowed,
        transporter:         v.transporter,
        driverName:          v.driverName,
        driverPhone:         v.driverPhone,
        isActive:            v.isActive,
      }))}
      transporters={transporters.map((t) => ({ id: t.id, name: t.name }))}
      canEdit={perms.canEdit}
      canImport={perms.canImport}
    />
  );
}
