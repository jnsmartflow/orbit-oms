import { prisma } from "@/lib/prisma";
import { DispatchCutoffsForm } from "@/components/admin/dispatch-cutoffs-form";

export const dynamic = "force-dynamic";

export default async function DispatchCutoffsPage() {
  const slots = await prisma.dispatch_cutoff_master.findMany({
    orderBy: [{ deliveryTypeId: "asc" }, { slotNumber: "asc" }],
    include: { deliveryType: true },
  });
  const deliveryTypes = await prisma.delivery_type_master.findMany({ orderBy: { id: "asc" } });
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Dispatch Cutoff Slots</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure cutoff times for each delivery type. Disable a slot to stop order assignment to it.
        </p>
      </div>
      <DispatchCutoffsForm initialSlots={slots} deliveryTypes={deliveryTypes} />
    </div>
  );
}
