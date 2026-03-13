import { prisma } from "@/lib/prisma";
import { SystemConfigForm } from "@/components/admin/system-config-form";

export default async function SystemConfigPage() {
  const rows = await prisma.system_config.findMany({
    orderBy: { id: "asc" },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">System Configuration</h1>
        <p className="text-sm text-slate-500 mt-1">
          These values control depot-wide timing and planning behaviour. Changes take effect immediately.
        </p>
      </div>
      <SystemConfigForm initialRows={rows} />
    </div>
  );
}
