import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { checkPermission, getPagePermissions } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { CustomersTable } from "@/components/admin/customers-table";

export const dynamic = "force-dynamic";

export default async function TintManagerCustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const canView = await checkPermission(session.user.role, "customers", "canView");
  if (!canView) redirect("/unauthorized");
  const perms = await getPagePermissions(session.user.role, "customers");

  const [customers, total, areas, subAreas, salesOfficers, routes, deliveryTypes, soGroups, contactRoles, customerTypes, premisesTypes] =
    await Promise.all([
      prisma.delivery_point_master.findMany({
        take:    25,
        orderBy: { customerName: "asc" },
        include: {
          area:              { select: { id: true, name: true } },
          subArea:           { select: { id: true, name: true } },
          salesOfficerGroup: { select: { id: true, name: true } },
        },
      }),
      prisma.delivery_point_master.count(),
      prisma.area_master.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.sub_area_master.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, areaId: true } }),
      prisma.sales_officer_master.findMany({
        where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
      }),
      prisma.route_master.findMany({
        where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
      }),
      prisma.delivery_type_master.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.sales_officer_group.findMany({
        where:   { isActive: true },
        orderBy: { name: "asc" },
        include: { salesOfficer: { select: { id: true, name: true } } },
      }),
      prisma.contact_role_master.findMany({
        where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
      }),
      prisma.customer_type_master.findMany({
        where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
      }),
      prisma.premises_type_master.findMany({
        where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
      }),
    ]);

  return (
    <CustomersTable
      initialCustomers={customers.map((c) => ({
        id:                c.id,
        customerCode:      c.customerCode,
        customerName:      c.customerName,
        address:           c.address ?? null,
        area:              c.area,
        subArea:           c.subArea,
        salesOfficerGroup: c.salesOfficerGroup,
        customerRating:    c.customerRating,
        isKeyCustomer:     c.isKeyCustomer,
        isKeySite:         c.isKeySite,
        isActive:          c.isActive,
      }))}
      initialTotal={total}
      areas={areas}
      subAreas={subAreas}
      salesOfficers={salesOfficers}
      routes={routes}
      deliveryTypes={deliveryTypes}
      soGroups={soGroups.map((g) => ({
        id:           g.id,
        name:         g.name,
        salesOfficer: g.salesOfficer,
      }))}
      contactRoles={contactRoles}
      customerTypes={customerTypes}
      premisesTypes={premisesTypes}
      canEdit={perms.canEdit}
      canImport={perms.canImport}
    />
  );
}
