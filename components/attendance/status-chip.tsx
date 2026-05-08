// Reusable status pill for attendance summaries.
// Q8 mapping (Prompt 5):
//   PRESENT     → emerald
//   LATE        → amber
//   HALF_DAY    → amber
//   INCOMPLETE  → red
//   ABSENT      → red
//   HOLIDAY     → blue
//   ON_LEAVE    → blue
// Will be reused in P8 (history) and P9 (admin dashboard).

interface StatusChipProps {
  status: string;
  size?: "xs" | "sm";
}

const STATUS_STYLES: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  PRESENT:     { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", label: "Present" },
  LATE:        { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-700",   label: "Late" },
  HALF_DAY:    { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-700",   label: "Half day" },
  INCOMPLETE:  { bg: "bg-red-50",     border: "border-red-200",     text: "text-red-700",     label: "Incomplete" },
  ABSENT:      { bg: "bg-red-50",     border: "border-red-200",     text: "text-red-700",     label: "Absent" },
  HOLIDAY:     { bg: "bg-blue-50",    border: "border-blue-200",    text: "text-blue-700",    label: "Holiday" },
  ON_LEAVE:    { bg: "bg-blue-50",    border: "border-blue-200",    text: "text-blue-700",    label: "Leave" },
  // Admin-roster-only states (P9 Group B)
  NOT_IN_YET:  { bg: "bg-gray-100",   border: "border-gray-200",    text: "text-gray-700",    label: "Not in yet" },
  EXEMPT:      { bg: "bg-gray-100",   border: "border-gray-200",    text: "text-gray-600",    label: "Exempt" },
};

const FALLBACK = {
  bg: "bg-gray-50",
  border: "border-gray-200",
  text: "text-gray-600",
  label: "—",
};

export function StatusChip({ status, size = "sm" }: StatusChipProps) {
  const style = STATUS_STYLES[status] ?? FALLBACK;
  const sizeClass =
    size === "xs" ? "text-[9px] px-1.5 py-0.5" : "text-[10.5px] px-2 py-0.5";
  return (
    <span
      className={`inline-block whitespace-nowrap font-semibold rounded border ${sizeClass} ${style.bg} ${style.border} ${style.text}`}
    >
      {style.label}
    </span>
  );
}
