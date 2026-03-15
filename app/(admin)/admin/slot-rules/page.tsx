import { prisma } from "@/lib/prisma";
import { SlotRulesTable } from "@/components/admin/slot-rules-table";

export const dynamic = "force-dynamic";

export default async function SlotRulesPage() {
  const [rules, deliveryTypes, slots] = await Promise.all([
    prisma.delivery_type_slot_config.findMany({
      orderBy: [{ deliveryType: { name: "asc" } }, { sortOrder: "asc" }],
      include: {
        deliveryType: { select: { id: true, name: true } },
        slot:         { select: { id: true, name: true, slotTime: true, isNextDay: true } },
      },
    }),
    prisma.delivery_type_master.findMany({ orderBy: { name: "asc" } }),
    prisma.slot_master.findMany({
      where:   { isActive: true },
      orderBy: { sortOrder: "asc" },
      select:  { id: true, name: true, slotTime: true, isNextDay: true },
    }),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Slot Rules</h1>
        <p className="text-sm text-slate-500 mt-1">
          Define which slots are available per delivery type and the order cutoff windows that trigger them.
        </p>
      </div>
      <SlotRulesTable
        initialRules={rules.map((r) => ({
          id:             r.id,
          deliveryTypeId: r.deliveryTypeId,
          deliveryType:   r.deliveryType,
          slotId:         r.slotId,
          slot:           r.slot,
          slotRuleType:   r.slotRuleType as "time_based" | "default",
          windowStart:    r.windowStart,
          windowEnd:      r.windowEnd,
          isDefault:      r.isDefault,
          isActive:       r.isActive,
          sortOrder:      r.sortOrder,
        }))}
        deliveryTypes={deliveryTypes.map((d) => ({ id: d.id, name: d.name }))}
        slots={slots}
      />
    </div>
  );
}
