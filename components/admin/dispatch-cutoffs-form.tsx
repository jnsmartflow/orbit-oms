"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SlotConfig {
  id: number;
  deliveryTypeId: number;
  deliveryType: { id: number; name: string };
  slotId: number;
  slot: { id: number; name: string; slotTime: string; isNextDay: boolean };
  slotRuleType: "time_based" | "default";
  windowStart: string | null;
  windowEnd: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

interface DeliveryType {
  id: number;
  name: string;
}

interface DispatchCutoffsFormProps {
  initialConfigs: SlotConfig[];
  deliveryTypes: DeliveryType[];
}

// ── Component ──────────────────────────────────────────────────────────────────

export function DispatchCutoffsForm({ initialConfigs, deliveryTypes }: DispatchCutoffsFormProps) {
  const [configs, setConfigs] = useState<SlotConfig[]>(initialConfigs);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const grouped = deliveryTypes.map((dt) => ({
    deliveryType: dt,
    configs: configs
      .filter((c) => c.deliveryTypeId === dt.id)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  async function patch(id: number, payload: object) {
    const res = await fetch(`/api/admin/dispatch-cutoffs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error ?? "Failed to update.");
      return null;
    }
    return res.json() as Promise<SlotConfig>;
  }

  async function handleToggleActive(config: SlotConfig) {
    setTogglingId(config.id);
    try {
      const updated = await patch(config.id, { isActive: !config.isActive });
      if (updated) {
        setConfigs((prev) => prev.map((c) => (c.id === config.id ? updated : c)));
        toast.success(updated.isActive ? "Slot enabled." : "Slot disabled.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSetDefault(config: SlotConfig) {
    setTogglingId(config.id);
    try {
      const updated = await patch(config.id, { isDefault: true });
      if (updated) {
        setConfigs((prev) =>
          prev.map((c) => ({
            ...c,
            isDefault: c.deliveryTypeId === config.deliveryTypeId ? c.id === config.id : c.isDefault,
          }))
        );
        toast.success(`${config.slot.name} set as default for ${config.deliveryType.name}.`);
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setTogglingId(null);
    }
  }

  function windowLabel(config: SlotConfig) {
    if (config.slotRuleType === "default") return <span className="text-slate-400">Any time</span>;
    if (config.windowStart && config.windowEnd)
      return <span className="font-mono text-xs">{config.windowStart} – {config.windowEnd}</span>;
    return <span className="text-slate-300">—</span>;
  }

  return (
    <div className="space-y-6">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-1 text-xs font-medium text-slate-400 uppercase tracking-wide">
        <span className="w-36">Slot</span>
        <span className="w-16">Time</span>
        <span className="w-14 text-center">Rule</span>
        <span className="flex-1">Window</span>
        <span className="w-24 text-center">Default</span>
        <span className="w-28 text-center">Status</span>
      </div>

      {grouped.map(({ deliveryType, configs: dtConfigs }) => (
        <Card key={deliveryType.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>{deliveryType.name} Delivery</span>
              <span className="text-xs font-normal text-slate-400">
                {dtConfigs.filter((c) => c.isActive).length} of {dtConfigs.length} slots active
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dtConfigs.length === 0 ? (
              <p className="text-sm text-slate-400 py-3">No slots configured.</p>
            ) : (
              dtConfigs.map((config) => (
                <div key={config.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                  <div className="w-36">
                    <p className="text-sm font-medium text-slate-800">{config.slot.name}</p>
                    {config.slot.isNextDay && (
                      <span className="text-xs text-amber-600">Next day</span>
                    )}
                  </div>

                  <div className="w-16 font-mono text-sm text-slate-600">{config.slot.slotTime}</div>

                  <div className="w-14 text-center">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        config.slotRuleType === "time_based"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-slate-50 text-slate-600 border-slate-200"
                      }`}
                    >
                      {config.slotRuleType === "time_based" ? "Time" : "Def"}
                    </Badge>
                  </div>

                  <div className="flex-1 text-sm text-slate-600">{windowLabel(config)}</div>

                  <div className="w-24 flex justify-center">
                    {config.isDefault ? (
                      <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-blue-300">
                        ★ Default
                      </Badge>
                    ) : (
                      <button
                        onClick={() => handleSetDefault(config)}
                        disabled={togglingId === config.id}
                        className="text-xs text-slate-400 hover:text-blue-600 underline underline-offset-2 disabled:opacity-40"
                      >
                        Set default
                      </button>
                    )}
                  </div>

                  <div className="w-28 flex justify-center">
                    <button
                      onClick={() => handleToggleActive(config)}
                      disabled={togglingId === config.id}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-40 ${
                        config.isActive
                          ? "bg-green-50 text-green-700 border-green-300 hover:bg-green-100"
                          : "bg-red-50 text-red-600 border-red-300 hover:bg-red-100"
                      }`}
                    >
                      {config.isActive ? "● Active" : "○ Inactive"}
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
