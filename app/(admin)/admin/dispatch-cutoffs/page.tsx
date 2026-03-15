import { prisma } from "@/lib/prisma";
import { DispatchCutoffsForm } from "@/components/admin/dispatch-cutoffs-form";

export const dynamic = "force-dynamic";

export default async function DispatchCutoffsPage() {
  const [configs, deliveryTypes] = await Promise.all([
    prisma.delivery_type_slot_config.findMany({
      orderBy: [{ deliveryTypeId: "asc" }, { sortOrder: "asc" }],
      include: {
        deliveryType: { select: { id: true, name: true } },
        slot: { select: { id: true, name: true, slotTime: true, isNextDay: true } },
      },
    }),
    prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dispatch Slot Config</h1>
        <p className="text-sm text-slate-500 mt-1">
          Per-delivery-type slot rules. Toggle active/default status. Slot windows are set at seed time.
        </p>
      </div>
      <DispatchCutoffsForm initialConfigs={configs} deliveryTypes={deliveryTypes} />
    </div>
  );
}
