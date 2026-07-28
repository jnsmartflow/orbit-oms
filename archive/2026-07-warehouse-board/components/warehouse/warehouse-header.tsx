"use client";

import { RefreshCw, Calendar } from "lucide-react";

interface WarehouseHeaderProps {
  date: string;
  onDateChange: (date: string) => void;
  onRefresh: () => void;
  stats: { unassigned: number; picking: number; picked: number; totalOBDs: number };
}

export function WarehouseHeader({ date, onDateChange, onRefresh, stats }: WarehouseHeaderProps) {
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const minDate = new Date(Date.now() - 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  return (
    <header className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center gap-4 sticky top-0 z-40">
      <h1 className="text-[14px] font-semibold text-gray-800">Warehouse Board</h1>

      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <Calendar size={14} className="text-gray-400" />
        <input
          type="date"
          value={date}
          onChange={(e) => onDateChange(e.target.value)}
          max={todayIST}
          min={minDate}
          className="bg-transparent text-[11px] text-gray-500 border-none outline-none cursor-pointer"
        />
      </div>

      <button
        type="button"
        onClick={onRefresh}
        className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
      >
        <RefreshCw size={14} />
      </button>

      <div className="flex-1" />

      <div className="flex items-center gap-4 text-[11px] text-gray-400">
        <span>
          <span className="text-gray-600">{stats.unassigned}</span> Unassigned
        </span>
        <span>
          <span className="text-gray-600">{stats.picking}</span> Picking
        </span>
        <span>
          <span className="text-gray-600">{stats.picked}</span> Picked
        </span>
        <span className="text-gray-200">|</span>
        <span>
          <span className="text-gray-600">{stats.totalOBDs}</span> OBDs
        </span>
      </div>
    </header>
  );
}
