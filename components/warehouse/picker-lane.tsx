"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PickCard } from "./pick-card";
import { DoneChip } from "./done-chip";
import type { PickerLane as PickerLaneData, PickerInfo } from "./warehouse-page";

const AVATAR_COLORS = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-orange-100", text: "text-orange-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
  { bg: "bg-pink-100", text: "text-pink-700" },
];

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

interface PickerLanePickingProps {
  lane: PickerLaneData;
  index: number;
  onMarkPicked: (orderId: number) => Promise<void>;
  isHistoryView?: boolean;
}

export function PickerLanePicking({ lane, index, onMarkPicked, isHistoryView = false }: PickerLanePickingProps) {
  const [expanded, setExpanded] = useState(true);
  const color = getAvatarColor(index);

  const pendingGroups = lane.assignments.filter((g) =>
    g.orders.some((o) => !o.isPicked),
  );
  const doneGroups = lane.assignments.filter((g) =>
    g.orders.every((o) => o.isPicked),
  );

  const pct = lane.stats.total > 0 ? (lane.stats.picked / lane.stats.total) * 100 : 0;

  // Delivery type breakdown — pending orders only
  const dtCounts = new Map<string, number>();
  for (const g of lane.assignments) {
    const pendingCount = g.orders.filter((o) => !o.isPicked).length;
    if (pendingCount === 0) continue;
    const lower = g.deliveryType.toLowerCase();
    const key = lower.includes("local") ? "L"
      : lower.includes("upcountry") ? "U"
      : lower.includes("igt") ? "I"
      : lower.includes("cross") ? "C"
      : "L";
    dtCounts.set(key, (dtCounts.get(key) ?? 0) + pendingCount);
  }
  const dtChips = Array.from(dtCounts.entries())
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label}:${count}`)
    .join(" · ");

  // Build sequence map: pending groups get sequences 1, 2, 3...
  let seq = 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div
        className="px-3 py-2.5 flex items-center gap-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0", color.bg, color.text)}>
          {lane.picker.avatarInitial}
        </div>
        <span className="text-[11px] font-medium text-gray-800 w-20 truncate">
          {lane.picker.name}
        </span>
        <div className="flex-1 max-w-[140px] h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-400">
          {lane.stats.picked}/{lane.stats.total}
        </span>
        <span className="text-[10px] text-gray-400 ml-1">
          {lane.stats.totalKg.toFixed(0)} kg
        </span>
        {dtChips && (
          <span className="text-[9px] text-gray-400 ml-1">{dtChips}</span>
        )}
        <ChevronDown
          size={12}
          className={cn("text-gray-400 transition-transform ml-1", expanded && "rotate-180")}
        />
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="flex flex-wrap gap-3">
            {pendingGroups.map((group) => {
              seq++;
              return (
                <PickCard
                  key={group.customerId}
                  group={group}
                  sequence={seq}
                  onMarkPicked={onMarkPicked}
                  isHistoryView={isHistoryView}
                />
              );
            })}
          </div>
          {doneGroups.length > 0 && (
            <div className="mt-3">
              <DoneChip groups={doneGroups} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Available row ────────────────────────────────────────────────────────────

interface PickerLaneAvailableProps {
  picker: PickerInfo;
  index: number;
}

export function PickerLaneAvailable({ picker, index }: PickerLaneAvailableProps) {
  const color = getAvatarColor(index);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2">
      <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-gray-100 text-gray-500")}>
        {picker.avatarInitial}
      </div>
      <span className="text-[11px] text-gray-500">{picker.name}</span>
      {picker.pickedCount > 0 && (
        <span className="text-[9px] text-gray-400">{picker.pickedCount} done today</span>
      )}
      <div className="flex-1" />
      <span className="text-[9px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">
        Available
      </span>
    </div>
  );
}
