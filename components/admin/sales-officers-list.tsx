// components/admin/sales-officers-list.tsx
// Phase 3b — multi-SO picker (replaces the legacy single Sales Officer dropdown).
//
// Behaviour:
//   - Each row = one (salesOfficerId, role) link.
//   - Adding a new row appends with role='PRIMARY' if list is empty, else 'BACKUP'.
//   - Switching a row to 'PRIMARY' AUTO-DEMOTES any other Primary row to 'BACKUP'
//     (single onChange call, no race). The DB partial-unique index is the final
//     guardrail.
//   - Removing the Primary row leaves zero Primary (per user spec). Backend
//     allows zero PRIMARY; user picks the next Primary explicitly.
//   - SOs already in the list are filtered out of the Add picker
//     (no duplicate SO per customer).

"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type {
  SalesOfficerLink,
  SalesOfficerOption,
  SalesOfficerRole,
} from "@/components/admin/customer-sheet";

interface SalesOfficersListProps {
  value:    SalesOfficerLink[];
  onChange: (next: SalesOfficerLink[]) => void;
  options:  SalesOfficerOption[];
  disabled?: boolean;
}

const ROLES: SalesOfficerRole[] = ["PRIMARY", "BACKUP", "JUNIOR"];

const ROLE_PILL_ACTIVE: Record<SalesOfficerRole, string> = {
  PRIMARY: "border-teal-300 bg-teal-50 text-teal-700",
  BACKUP:  "border-blue-300 bg-blue-50 text-blue-700",
  JUNIOR:  "border-amber-300 bg-amber-50 text-amber-700",
};

const ROLE_PILL_INACTIVE = "border-gray-200 bg-white text-gray-400 hover:bg-gray-50";

export function SalesOfficersList({ value, onChange, options, disabled = false }: SalesOfficersListProps) {
  const [addOpen, setAddOpen] = useState(false);

  const byId = useMemo(() => {
    const m = new Map<number, SalesOfficerOption>();
    for (const o of options) m.set(o.id, o);
    return m;
  }, [options]);

  // SOs not yet in the picker — used to populate the Add dropdown.
  const availableOptions = useMemo(() => {
    const taken = new Set(value.map((v) => v.salesOfficerId));
    return options.filter((o) => !taken.has(o.id));
  }, [options, value]);

  function handleRoleChange(idx: number, nextRole: SalesOfficerRole) {
    const next = value.map((entry, i) => {
      if (i === idx) return { ...entry, role: nextRole };
      // Auto-flip: if user is setting PRIMARY on idx, demote any other PRIMARY to BACKUP.
      if (nextRole === "PRIMARY" && entry.role === "PRIMARY") {
        return { ...entry, role: "BACKUP" as SalesOfficerRole };
      }
      return entry;
    });
    onChange(next);
  }

  function handleRemove(idx: number) {
    // Per spec: no auto-promotion when Primary is removed. Leave zero Primary.
    onChange(value.filter((_, i) => i !== idx));
  }

  function handleAdd(soIdString: string | null) {
    if (!soIdString) return;
    const soId = parseInt(soIdString, 10);
    if (Number.isNaN(soId)) return;
    if (value.some((v) => v.salesOfficerId === soId)) return;
    const role: SalesOfficerRole = value.length === 0 ? "PRIMARY" : "BACKUP";
    onChange([...value, { salesOfficerId: soId, role }]);
    setAddOpen(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-gray-500 tracking-wider uppercase">Sales Officers</span>
        <span className="text-[10px] text-gray-400">Exactly one PRIMARY · 0–N total</span>
      </div>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
        {value.length === 0 ? (
          <div className="p-4 text-center text-[12px] text-gray-400 italic">
            No sales officers assigned
          </div>
        ) : (
          value.map((entry, idx) => {
            const master = byId.get(entry.salesOfficerId);
            const label  = master ? master.name : `(unknown SO #${entry.salesOfficerId})`;
            const phone  = master?.phone;
            return (
              <div key={`${entry.salesOfficerId}-${idx}`} className="p-3 flex items-center gap-2.5">
                {/* Picker — locked to the chosen SO. To swap, remove + re-add. */}
                <div className="flex-1 h-[34px] px-2.5 text-[13px] border border-gray-200 rounded-md bg-white text-gray-900 flex items-center justify-between min-w-0">
                  <span className="truncate">
                    {label}
                    {phone && <span className="text-gray-400 text-[11px] ml-1">· {phone}</span>}
                  </span>
                </div>

                {/* Role pill-group */}
                <div className="inline-flex flex-shrink-0">
                  {ROLES.map((r, ri) => {
                    const active = entry.role === r;
                    const radius = ri === 0 ? "rounded-l-md" : ri === ROLES.length - 1 ? "rounded-r-md" : "";
                    const overlap = ri > 0 ? "-ml-px" : "";
                    return (
                      <button
                        key={r}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleRoleChange(idx, r)}
                        className={`h-[28px] px-3 border text-[11px] font-medium ${radius} ${overlap} ${active ? `font-semibold ${ROLE_PILL_ACTIVE[r]}` : ROLE_PILL_INACTIVE} ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        {r === "PRIMARY" ? "Primary" : r === "BACKUP" ? "Backup" : "Junior"}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleRemove(idx)}
                  className="w-7 h-7 rounded-md flex items-center justify-center text-gray-300 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                  aria-label="Remove sales officer"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Add row */}
      {!disabled && (
        addOpen ? (
          <div className="flex items-center gap-2">
            <Select value="" onValueChange={handleAdd}>
              <SelectTrigger className="h-[36px] flex-1 text-[12.5px] border-gray-200">
                <SelectValue placeholder={availableOptions.length === 0 ? "All SOs already added" : "Choose a sales officer…"} />
              </SelectTrigger>
              <SelectContent>
                {availableOptions.length === 0 ? (
                  <div className="px-2 py-1.5 text-[12px] text-gray-400 italic">All available SOs are added</div>
                ) : (
                  availableOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id.toString()}>
                      {o.name}{o.phone ? ` · ${o.phone}` : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="h-[36px] px-3 text-[11px] font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full h-[36px] text-[12px] font-medium text-gray-500 hover:text-teal-700 hover:bg-teal-50 border border-dashed border-gray-300 hover:border-teal-300 rounded-lg flex items-center justify-center gap-2"
          >
            <Plus size={14} />
            Add Sales Officer
          </button>
        )
      )}

      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 leading-relaxed">
        <strong>Auto-flip:</strong> Setting a second row to Primary demotes the current Primary to Backup. The DB partial-unique index <code className="font-mono text-[10.5px]">(customerId) WHERE role=&apos;PRIMARY&apos;</code> guarantees only one Primary per customer.
      </p>
    </div>
  );
}
