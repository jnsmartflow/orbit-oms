import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STAT_ICONS: Record<string, string> = {
  "Active Users":        "👤",
  "Active Routes":       "🛣️",
  "Active SKUs":         "📦",
  "Active Customers":    "🏪",
  "Active Transporters": "🚚",
  "Active SO Groups":    "👥",
  "Orders Today":        "📋",
  "Pending Support":     "🔔",
};

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
    recentCustomers,
  ] = await Promise.all([
    prisma.users.count({ where: { isActive: true } }),
    prisma.route_master.count({ where: { isActive: true } }),
    prisma.sku_master.count({ where: { isActive: true } }),
    prisma.delivery_point_master.count({ where: { isActive: true } }),
    prisma.transporter_master.count({ where: { isActive: true } }),
    prisma.sales_officer_group.count({ where: { isActive: true } }),
    prisma.orders.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.orders.count({ where: { workflowStage: "pending_support" } }),
    prisma.delivery_point_master.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      select: {
        id:           true,
        customerName: true,
        createdAt:    true,
        area:         { select: { name: true } },
      },
    }),
  ]);

  const stats = [
    { title: "Active Users",        value: activeUsers },
    { title: "Active Routes",       value: activeRoutes },
    { title: "Active SKUs",         value: activeSkus },
    { title: "Active Customers",    value: activeCustomers },
    { title: "Active Transporters", value: activeTransporters },
    { title: "Active SO Groups",    value: activeSoGroups },
    { title: "Orders Today",        value: ordersToday },
    { title: "Pending Support",     value: pendingSupport },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--navy)' }}>Dashboard</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>Admin overview</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {stats.map((stat) => (
          <div
            key={stat.title}
            style={{
              background:   'var(--white)',
              border:       '1px solid var(--border)',
              borderRadius: '8px',
              padding:      '16px',
              boxShadow:    'var(--shadow-sm)',
            }}
          >
            <div className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: '20px' }}>{STAT_ICONS[stat.title]}</span>
              <p
                style={{
                  fontSize:   '24px',
                  fontWeight: 800,
                  color:      'var(--navy)',
                  lineHeight: 1,
                }}
              >
                {stat.value}
              </p>
            </div>
            <p
              style={{
                fontSize:      '10px',
                color:         'var(--muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginTop:     '4px',
              }}
            >
              {stat.title}
            </p>
          </div>
        ))}
      </div>

      {/* Recent customers */}
      <div
        style={{
          background:   'var(--white)',
          border:       '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow:    'var(--shadow-sm)',
          overflow:     'hidden',
        }}
      >
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-lt)' }}>
          <h2 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-2)' }}>
            Recently Added Customers
          </h2>
        </div>
        <ul>
          {recentCustomers.length === 0 && (
            <li style={{ padding: '16px', fontSize: '12px', color: 'var(--muted-lt)' }}>
              No customers yet.
            </li>
          )}
          {recentCustomers.map((c) => (
            <li
              key={c.id}
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'space-between',
                padding:        '10px 16px',
                borderBottom:   '1px solid var(--border-lt)',
              }}
            >
              <div>
                <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)' }}>
                  {c.customerName}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--muted)' }}>{c.area.name}</p>
              </div>
              <p style={{ fontSize: '11px', color: 'var(--muted-lt)' }}>
                {c.createdAt.toLocaleDateString("en-IN", {
                  day: "2-digit", month: "short", year: "numeric",
                })}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
