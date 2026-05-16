"use client";

// Minimal hover tooltip — pure React + Tailwind, no Radix dependency.
// Built for Phase 4d (disabled Resume button rationale on the paused-card
// shelf in tint-operator-content.tsx). Wrapper span owns the hover/focus
// listeners so that disabled buttons (which Chrome still bubbles pointer
// events through, but on which a click does nothing) trigger the tooltip
// via the wrapper region.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  /** Tooltip body. Plain text or small ReactNode. Wraps at 240px. */
  content: ReactNode;
  /** Trigger element — typically a (disabled) button. */
  children: ReactNode;
  /** "top" (default) places tooltip above; "bottom" places it below. */
  side?: "top" | "bottom";
  /** When true, the tooltip never opens (caller still gets the wrapper). */
  disabled?: boolean;
  /** Open delay in ms. Default 80 — short enough to feel responsive. */
  delay?: number;
  /** Optional extra classes for the tooltip body. */
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = "top",
  disabled = false,
  delay = 80,
  className,
}: TooltipProps): React.JSX.Element {
  const [open,       setOpen] = useState(false);
  const openTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId        = useId();

  function clearTimers(): void {
    if (openTimer.current)  { clearTimeout(openTimer.current);  openTimer.current  = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }

  function show(): void {
    if (disabled) return;
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), delay);
  }

  function hide(): void {
    clearTimers();
    // Brief close delay to avoid flicker on tiny pointer jitters at the edge.
    closeTimer.current = setTimeout(() => setOpen(false), 50);
  }

  useEffect(() => () => clearTimers(), []);

  const isOpen = open && !disabled;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={isOpen ? tipId : undefined} className="inline-flex">
        {children}
      </span>
      {isOpen && (
        <span
          id={tipId}
          role="tooltip"
          className={cn(
            "absolute z-50 px-2 py-1 bg-gray-900 text-white text-[11px] font-medium rounded leading-snug max-w-[240px] whitespace-normal text-center pointer-events-none shadow-md",
            side === "top"
              ? "bottom-full mb-1.5 left-1/2 -translate-x-1/2"
              : "top-full    mt-1.5 left-1/2 -translate-x-1/2",
            className,
          )}
        >
          {content}
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45",
              side === "top" ? "top-full    -mt-1" : "bottom-full -mb-1",
            )}
          />
        </span>
      )}
    </span>
  );
}
