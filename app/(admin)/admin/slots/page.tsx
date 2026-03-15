import { prisma } from "@/lib/prisma";
import { SlotsTable } from "@/components/admin/slots-table";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const slots = await prisma.slot_master.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Slot Master</h1>
        <p className="text-sm text-slate-500 mt-1">
          Define dispatch slots and their display times. Slot assignment rules are configured in Slot Rules.
        </p>
      </div>
      <SlotsTable
        initialSlots={slots.map((s) => ({
          id:        s.id,
          name:      s.name,
          slotTime:  s.slotTime,
          isNextDay: s.isNextDay,
          isActive:  s.isActive,
          sortOrder: s.sortOrder,
        }))}
      />
    </div>
  );
}
