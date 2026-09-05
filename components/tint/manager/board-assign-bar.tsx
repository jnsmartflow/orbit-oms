"use client";

// Tint Manager — the bulk re-assign bar. Rises when 1+ rows are ticked.
//
// Shape and restraint copied from components/floor/assign-bar.tsx: a selection
// summary, a global clear, one target picker, one action, and Assign as the only
// teal element (CLAUDE_UI §10). Renders nothing when nothing is selected.
//
// ⚠ There is NO bulk API. The parent runs N SEQUENTIAL awaits over
// POST /api/tint/manager/assign — no Promise.all, no $transaction (CORE §3: the
// Supabase pooler is the reason) — and reports partial failure the way Floor's
// batch routes do (CLAUDE_FLOOR §4.1/§4.2).

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BoardRow, Operator } from "./types";

export function BoardAssignBar({
  selectedRows, operators, busy, onReassign, onClear,
}: {
  selectedRows: BoardRow[];
  operators:    Operator[];
  busy:         boolean;
  onReassign:   (operatorId: number) => void;
  onClear:      () => void;
}) {
  const [operatorId, setOperatorId] = useState<number | "">("");
  const count = selectedRows.length;
  if (count === 0) return null;

  const litres = selectedRows.reduce((s, r) => s + (r.volumeLitres ?? 0), 0);
  const summary = count === 1
    ? `${selectedRows[0].siteName}${selectedRows[0].volumeLitres != null ? ` · ${selectedRows[0].volumeLitres} L` : ""}`
    : `${litres} L · ${new Set(selectedRows.map((r) => r.operatorId)).size} operator(s)`;

  return (
    <div className="fixed left-1/2 bottom-[18px] -translate-x-1/2 z-40 flex items-center gap-3 bg-gray-900 text-white rounded-[12px] pl-4 pr-3 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,.25)]">
      <span className="bg-teal-600 rounded-full text-[11px] font-bold px-2.5 py-1">
        {count} selected
      </span>
      <button
        type="button"
        onClick={onClear}
        className="text-gray-400 hover:text-white text-[14px] px-0.5"
        title="Clear selection"
      >
        ×
      </button>
      <span className="text-[12px] text-gray-300 max-w-[280px] truncate">{summary}</span>
      <span className="w-px h-[22px] bg-gray-700" />
      <select
        value={operatorId}
        onChange={(e) => setOperatorId(e.target.value ? Number(e.target.value) : "")}
        disabled={busy}
        className="bg-gray-800 border border-gray-700 text-white text-[12px] rounded-[7px] px-2.5 py-[7px] disabled:opacity-50"
      >
        <option value="">Move to operator…</option>
        {operators.map((op) => (
          <option key={op.id} value={op.id}>{op.name ?? `Operator ${op.id}`}</option>
        ))}
      </select>
      <button
        type="button"
        disabled={!operatorId || busy}
        onClick={() => { if (operatorId) onReassign(Number(operatorId)); }}
        className={cn(
          "rounded-[7px] text-[12px] font-bold px-4 py-2 transition-colors inline-flex items-center gap-1.5",
          operatorId && !busy
            ? "bg-teal-600 hover:bg-teal-700 text-white"
            : "bg-gray-600 text-gray-300 cursor-not-allowed",
        )}
      >
        {busy && <Loader2 size={12} className="animate-spin" />}
        {busy ? "Re-assigning…" : `Reassign ${count === 1 ? "job" : "selected"}`}
      </button>
    </div>
  );
}
