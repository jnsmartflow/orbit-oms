import { cn } from "@/lib/utils";

export type StatusBadgeVariant =
  | "hold"
  | "dispatch"
  | "waiting"
  | "tint"
  | "non-tint"
  | "urgent"
  | "normal"
  | "key"
  | "key-site"
  | "active"
  | "inactive"
  | "pending"
  | "in-progress"
  | "done";

interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  size?: "sm" | "md";
  showDot?: boolean;
}

const colorMap: Record<StatusBadgeVariant, string> = {
  hold:         "bg-red-50    text-red-700    border border-red-200",
  dispatch:     "bg-green-50  text-green-700  border border-green-200",
  waiting:      "bg-amber-50  text-amber-700  border border-amber-200",
  tint:         "bg-violet-50 text-violet-700 border border-violet-200",
  "non-tint":   "bg-gray-100  text-gray-500   border border-gray-200",
  urgent:       "bg-red-50    text-red-700    border border-red-200",
  normal:       "bg-blue-50   text-blue-700   border border-blue-200",
  key:          "bg-yellow-50 text-yellow-700 border border-yellow-200",
  "key-site":   "bg-blue-50   text-blue-700   border border-blue-200",
  active:       "bg-green-50  text-green-700  border border-green-200",
  inactive:     "bg-gray-100  text-gray-500   border border-gray-200",
  pending:      "bg-gray-100 text-gray-600 border border-gray-200",
  "in-progress":"bg-amber-50  text-amber-700  border border-amber-200",
  done:         "bg-green-50  text-green-700  border border-green-200",
};

const labelMap: Record<StatusBadgeVariant, string> = {
  hold:         "Hold",
  dispatch:     "Dispatch",
  waiting:      "Waiting",
  tint:         "Tint",
  "non-tint":   "Non-Tint",
  urgent:       "Urgent",
  normal:       "Normal",
  key:          "★ Key",
  "key-site":   "★ Key Site",
  active:       "Active",
  inactive:     "Inactive",
  pending:      "Pending",
  "in-progress":"In Progress",
  done:         "Done",
};

// Variants that show a dot by default
const dotDefaults = new Set<StatusBadgeVariant>([
  "hold", "dispatch", "waiting", "urgent", "normal", "active", "inactive",
]);

const dotColorMap: Record<StatusBadgeVariant, string> = {
  hold:         "bg-red-500",
  dispatch:     "bg-green-500",
  waiting:      "bg-amber-500",
  tint:         "bg-violet-500",
  "non-tint":   "bg-gray-400",
  urgent:       "bg-red-500",
  normal:       "bg-blue-500",
  key:          "bg-yellow-500",
  "key-site":   "bg-blue-500",
  active:       "bg-green-500",
  inactive:     "bg-gray-400",
  pending:      "bg-gray-400",
  "in-progress":"bg-amber-500",
  done:         "bg-green-500",
};

const sizeMap = {
  sm: "text-[10px] px-1.5 py-0.5 rounded font-semibold",
  md: "text-[11px] px-2 py-0.5 rounded-md font-semibold",
};

export function StatusBadge({
  variant,
  size = "md",
  showDot,
}: StatusBadgeProps) {
  const shouldShowDot = showDot !== undefined ? showDot : dotDefaults.has(variant);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        colorMap[variant],
        sizeMap[size],
      )}
    >
      {shouldShowDot && (
        <span
          className={cn("inline-block rounded-full flex-shrink-0", dotColorMap[variant])}
          style={{ width: 5, height: 5 }}
        />
      )}
      {labelMap[variant]}
    </span>
  );
}
