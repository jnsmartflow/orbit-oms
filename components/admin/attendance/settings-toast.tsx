"use client";

import { useEffect } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type SettingsToastKind = "rollout" | "reconsent" | "success" | "error";

interface SettingsToastProps {
  kind: SettingsToastKind;
  message: string;
  onDismiss(): void;
  // Auto-dismiss delay (ms). Default 5000. Pass 0 to disable.
  autoDismissMs?: number;
}

const SPECS: Record<
  SettingsToastKind,
  { container: string; icon: LucideIcon; iconClass: string }
> = {
  rollout: {
    container: "bg-teal-50 border-teal-200 text-teal-900",
    icon: CheckCircle2,
    iconClass: "text-teal-700",
  },
  reconsent: {
    container: "bg-amber-50 border-amber-200 text-amber-900",
    icon: AlertTriangle,
    iconClass: "text-amber-700",
  },
  success: {
    container: "bg-gray-900 border-gray-900 text-white",
    icon: Check,
    iconClass: "text-white",
  },
  error: {
    container: "bg-red-50 border-red-200 text-red-900",
    icon: XCircle,
    iconClass: "text-red-700",
  },
};

export function SettingsToast({
  kind,
  message,
  onDismiss,
  autoDismissMs = 5000,
}: SettingsToastProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  const spec = SPECS[kind];
  const Icon = spec.icon;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-4 right-4 z-50 max-w-sm rounded-lg border p-3 shadow-md flex items-start gap-2 ${spec.container}`}
    >
      <Icon className={`w-[18px] h-[18px] shrink-0 mt-px ${spec.iconClass}`} />
      <p className="text-[13px] font-medium leading-snug">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`ml-2 -mr-1 -mt-0.5 px-1 text-[14px] leading-none opacity-60 hover:opacity-100 ${
          kind === "success" ? "text-white" : ""
        }`}
      >
        ×
      </button>
    </div>
  );
}
