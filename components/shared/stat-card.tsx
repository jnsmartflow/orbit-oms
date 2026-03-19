import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  iconBg?: string;
  iconColor?: string;
  icon: React.ReactNode;
  valueColor?: string;
}

export function StatCard({
  label,
  value,
  sub,
  iconBg = "bg-gray-50",
  iconColor = "text-gray-600",
  icon,
  valueColor = "text-gray-900",
}: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e5f1] shadow-sm p-4 flex items-center gap-3">
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
          iconBg,
          iconColor,
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400 leading-none mb-1">
          {label}
        </p>
        <p className={cn("text-[20px] font-extrabold leading-tight", valueColor)}>
          {value}
        </p>
        {sub && (
          <p className="text-[10.5px] text-gray-400 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}
