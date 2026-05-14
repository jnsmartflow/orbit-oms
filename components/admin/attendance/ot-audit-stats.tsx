import { formatDuration } from "@/lib/attendance/format";

export interface DerivedStats {
  totalCreditedMin: number;
  autoCreditedMin: number;
  graceCreditedMin: number;
  adminApprovedMin: number;
  // PENDING and REJECTED records always carry 0 credited minutes by design
  // (PENDING hasn't been resolved, REJECTED stays at 0). Showing minutes
  // for these would always read "0 min" — a count is the meaningful signal.
  pendingCount: number;
  rejectedCount: number;
}

interface OtAuditStatsProps {
  stats: DerivedStats;
}

export function OtAuditStats({ stats }: OtAuditStatsProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 lg:gap-0">
        <Tile
          label="Total OT credited"
          primary
          value={`${formatNumber(stats.totalCreditedMin)} min`}
          subtext={
            stats.totalCreditedMin > 0
              ? `≈ ${formatDuration(stats.totalCreditedMin)}`
              : undefined
          }
        />
        <Tile
          label="Auto credited"
          value={`${formatNumber(stats.autoCreditedMin)} min`}
          subtext="straight credit"
          divide
        />
        <Tile
          label="Grace credited"
          value={`${formatNumber(stats.graceCreditedMin)} min`}
          subtext="under monthly grace"
          divide
        />
        <Tile
          label="Admin approved"
          value={`${formatNumber(stats.adminApprovedMin)} min`}
          subtext="explicit approval"
          divide
        />
        <Tile
          label="Pending"
          value={
            stats.pendingCount === 0
              ? "0 claims"
              : `${stats.pendingCount} claim${stats.pendingCount === 1 ? "" : "s"}`
          }
          subtext={stats.pendingCount > 0 ? "awaiting decision" : undefined}
          amber={stats.pendingCount > 0}
          divide
        />
        <Tile
          label="Rejected"
          value={
            stats.rejectedCount === 0
              ? "0 claims"
              : `${stats.rejectedCount} claim${stats.rejectedCount === 1 ? "" : "s"}`
          }
          subtext={stats.rejectedCount > 0 ? "this month" : undefined}
          divide
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  subtext,
  primary,
  amber,
  divide,
}: {
  label: string;
  value: string;
  subtext?: string;
  primary?: boolean;
  amber?: boolean;
  divide?: boolean;
}) {
  return (
    <div
      className={
        divide ? "lg:border-l lg:border-gray-100 lg:pl-4" : undefined
      }
    >
      <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1">
        {label}
      </p>
      <p
        className={`text-[20px] font-semibold tabular-nums leading-none ${
          amber
            ? "text-amber-600"
            : primary
              ? "text-gray-900"
              : "text-gray-900"
        }`}
      >
        {value}
      </p>
      {subtext && (
        <p
          className={`text-[10px] mt-1 tabular-nums ${
            amber ? "text-amber-700" : "text-gray-400"
          }`}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}
