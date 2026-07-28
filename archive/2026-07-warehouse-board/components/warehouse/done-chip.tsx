"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CustomerGroup } from "./warehouse-page";

interface DoneChipProps {
  groups: CustomerGroup[];
}

export function DoneChip({ groups }: DoneChipProps) {
  const [expanded, setExpanded] = useState(false);

  if (groups.length === 0) return null;

  const totalKg = groups.reduce((s, g) => s + g.totalKg, 0);

  return (
    <div>
      {/* Collapsed chip */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 hover:bg-gray-100 transition-colors"
      >
        <Check size={10} className="text-green-500" />
        <span className="text-[9px] text-gray-400">
          {groups.length} done · {totalKg.toFixed(0)} kg
        </span>
        <ChevronDown
          size={8}
          className={cn("text-gray-400 transition-transform", expanded && "rotate-180")}
        />
      </button>

      {/* Expanded done cards */}
      {expanded && (
        <div className="mt-2 flex gap-2 flex-wrap">
          {groups.map((group) => (
            <div
              key={group.customerId}
              className="w-[180px] rounded-lg border border-gray-100 bg-gray-50 p-2.5 opacity-50"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Check size={10} className="text-green-500 flex-shrink-0" />
                <span className="text-[10px] font-medium text-gray-500 truncate">
                  {group.customerName}
                </span>
              </div>
              <span className="text-[9px] text-gray-400">
                {group.totalKg.toFixed(0)} kg · {group.orders.length} OBD{group.orders.length !== 1 ? "s" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
