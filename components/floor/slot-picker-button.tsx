"use client";

// The slot-chip / Release launcher — a custom trigger that opens the shared
// DispatchSlotPicker (./dispatch-slot-picker) via forceOpenGen, with the
// picker's own trigger overlaid invisibly and stretched to this button's box
// only to anchor its portalled popover.
//
// 🔴 ONE COPY. Moved here from a private function in components/floor/
// detail-panel.tsx (2026-10-01, Tint Manager tabs build steps 6–7); Floor's
// detail panel and the Tint Manager's bar, Slot cell and panel all import it.
// The shared picker is NOT modified.

import { useState, type ReactNode } from "react";
import { DispatchSlotPicker, type DispatchWindow, type DispatchSlotValue } from "@/components/floor/dispatch-slot-picker";

export function SlotPickerButton({
  value,
  onPick,
  windows,
  className,
  disabled,
  popoverDir = "down",
  popoverAlign = "right",
  children,
}: {
  value: DispatchSlotValue | null;
  onPick: (v: DispatchSlotValue) => void;
  windows: DispatchWindow[];
  className: string;
  disabled?: boolean;
  popoverDir?: "down" | "up";
  popoverAlign?: "left" | "right";
  children: ReactNode;
}) {
  const [gen, setGen] = useState(0);
  return (
    <div className="relative inline-flex">
      <button type="button" disabled={disabled} onClick={() => setGen((g) => g + 1)} className={className}>
        {children}
      </button>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 [&>div]:!block [&>div]:h-full [&>div]:w-full [&>div>button]:!h-full [&>div>button]:!w-full"
      >
        <DispatchSlotPicker
          value={value}
          onChange={(v) => v && onPick(v)}
          windows={windows}
          popoverDir={popoverDir}
          popoverAlign={popoverAlign}
          disabled={disabled}
          forceOpenGen={gen || undefined}
        />
      </div>
    </div>
  );
}
