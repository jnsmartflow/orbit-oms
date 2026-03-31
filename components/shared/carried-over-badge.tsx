"use client";

interface CarriedOverBadgeProps {
  daysOverdue: number;
}

export function CarriedOverBadge({ daysOverdue }: CarriedOverBadgeProps) {
  if (daysOverdue === 0) return null;

  const colorClass = daysOverdue >= 2 ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50";

  return (
    <span className={`text-[9px] ${colorClass} px-1.5 py-0.5 rounded inline-flex items-center gap-0.5`}>
      🕐 Overdue {daysOverdue}d
    </span>
  );
}
