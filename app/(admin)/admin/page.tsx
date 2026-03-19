import Link from "next/link";
import { Users, MapPin, Package, Building2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { StatCard } from "@/components/shared/stat-card";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    activeUsers,
    activeRoutes,
    activeSkus,
    activeCustomers,
    activeTransporters,
    activeSoGroups,
    ordersToday,
    pendingSupport,
    recentUsers,
  ] = await Promise.all([
    prisma.users.count({ where: { isActive: true } }),
    prisma.route_master.count({ where: { isActive: true } }),
    prisma.sku_master.count({ where: { isActive: true } }),
    prisma.delivery_point_master.count({ where: { isActive: true } }),
    prisma.transporter_master.count({ where: { isActive: true } }),
    prisma.sales_officer_group.count({ where: { isActive: true } }),
    prisma.orders.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.orders.count({ where: { workflowStage: "pending_support" } }),
    prisma.users.findMany({
      take: 8,
      orderBy: { createdAt: "desc" },
      select: {
        id:        true,
        name:      true,
        role:      { select: { name: true } },
        createdAt: true,
      },
    }),
  ]);

  // Suppress unused-variable warnings — kept for future dashboard sections
  void activeTransporters;
  void activeSoGroups;
  void ordersToday;
  void pendingSupport;

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "short",
    day:     "numeric",
    month:   "short",
    year:    "numeric",
  });

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">Dashboard</h1>
        <p className="text-[12px] text-gray-400 mt-0.5">Depot overview — {today}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Active Users"
          value={activeUsers}
          icon={<Users size={18} />}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          valueColor="text-indigo-600"
        />
        <StatCard
          label="Active Routes"
          value={activeRoutes}
          icon={<MapPin size={18} />}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          valueColor="text-blue-600"
        />
        <StatCard
          label="Active SKUs"
          value={activeSkus}
          icon={<Package size={18} />}
          iconBg="bg-violet-50"
          iconColor="text-violet-600"
          valueColor="text-violet-600"
        />
        <StatCard
          label="Active Customers"
          value={activeCustomers}
          icon={<Building2 size={18} />}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-600"
          valueColor="text-emerald-600"
        />
      </div>

      {/* Recent users table */}
      <div className="bg-white rounded-xl border border-[#e2e5f1] shadow-sm overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e2e5f1]">
          <span className="text-[13px] font-bold text-gray-900">Recent Users</span>
          <Link
            href="/admin/users"
            className="text-[12px] text-[#1a237e] font-medium hover:underline"
          >
            View all →
          </Link>
        </div>

        {/* Table */}
        <table className="w-full border-collapse">
          <thead className="bg-[#f7f8fc]">
            <tr>
              {["Name", "Role", "Created"].map((col) => (
                <th
                  key={col}
                  className="py-2.5 px-5 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-400 border-b border-[#e2e5f1]"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recentUsers.length === 0 && (
              <tr>
                <td colSpan={3} className="py-6 px-5 text-[12px] text-gray-400 text-center">
                  No users yet.
                </td>
              </tr>
            )}
            {recentUsers.map((u) => (
              <tr
                key={u.id}
                className="border-b border-[#e2e5f1] last:border-0 hover:bg-[#f7f8fc] transition-colors"
              >
                <td className="py-3 px-5 font-semibold text-[13px] text-gray-900">
                  {u.name}
                </td>
                <td className="py-3 px-5">
                  <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-semibold">
                    {u.role.name}
                  </span>
                </td>
                <td className="py-3 px-5 font-mono text-[11.5px] text-gray-400">
                  {u.createdAt.toLocaleDateString("en-GB", {
                    day:   "2-digit",
                    month: "short",
                    year:  "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
