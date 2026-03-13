import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminDashboard() {
  const [activeUsers, activeRoutes, activeSkus, activeCustomers, recentUsers] =
    await Promise.all([
      prisma.users.count({ where: { isActive: true } }),
      prisma.route_master.count({ where: { isActive: true } }),
      prisma.sku_master.count({ where: { isActive: true } }),
      prisma.delivery_point_master.count({ where: { isActive: true } }),
      prisma.users.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, createdAt: true, role: { select: { name: true } } },
      }),
    ]);

  const stats = [
    { title: "Active Users", value: activeUsers },
    { title: "Active Routes", value: activeRoutes },
    { title: "Active SKUs", value: activeSkus },
    { title: "Active Customers", value: activeCustomers },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">{stat.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-slate-900">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="rounded-md border bg-white">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-slate-700">Recent Users</h2>
        </div>
        <ul className="divide-y">
          {recentUsers.length === 0 && (
            <li className="px-4 py-4 text-sm text-slate-400">No users yet.</li>
          )}
          {recentUsers.map((u) => (
            <li key={u.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{u.name}</p>
                <p className="text-xs text-slate-400 capitalize">{u.role.name}</p>
              </div>
              <p className="text-xs text-slate-400">
                {u.createdAt.toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
