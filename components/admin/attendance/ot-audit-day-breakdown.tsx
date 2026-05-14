import { formatIstClock, formatIstShortDate } from "@/lib/attendance/format";
import type { OutcomeKind, UserAuditSummary } from "./ot-audit-view";

interface OtAuditDayBreakdownProps {
  user: UserAuditSummary;
}

// Day-by-day breakdown for one user. Each row is one CHECK_OUT record.
//
// Columns intentionally OMIT "Worked" and "OT raw" — the audit endpoint
// doesn't return totalMinutesWorked (would need attendance_summary join)
// or otMinutesRaw (only the ot-pending route recomputes that on demand
// for PENDING rows). Faking either column would mislead admins.
export function OtAuditDayBreakdown({ user }: OtAuditDayBreakdownProps) {
  return (
    <div
      style={{
        background: "#f9fafb",
        borderLeft: "2px solid #0d9488",
        padding: "16px 20px",
      }}
    >
      <p className="text-[12px] font-semibold text-gray-900 mb-3">
        Day-by-day breakdown — {user.userName}
      </p>
      <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#ffffff", borderBottom: "1px solid #e5e7eb" }}>
              <Th width="14%">Date</Th>
              <Th width="14%">Check-out</Th>
              <Th width="14%" align="right">Credited</Th>
              <Th width="20%">Outcome</Th>
              <Th>Note</Th>
            </tr>
          </thead>
          <tbody>
            {user.days.map((day) => (
              <tr
                key={day.recordId}
                style={{ borderBottom: "1px solid #f3f4f6" }}
              >
                <Td primary>{formatDayDate(day.attendanceDate)}</Td>
                <Td>{formatIstClock(day.checkOutISO)}</Td>
                <Td align="right" primary={day.creditedMin > 0} muted={day.creditedMin === 0}>
                  {day.creditedMin > 0 ? `${day.creditedMin} min` : "0 min"}
                </Td>
                <Td>
                  <OutcomeChip outcome={day.outcome} />
                </Td>
                <Td muted={!day.note}>
                  {day.note ?? "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  width,
  align,
}: {
  children: React.ReactNode;
  width?: string;
  align?: "right";
}) {
  return (
    <th
      style={{
        width,
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#9ca3af",
        textAlign: align ?? "left",
        padding: "6px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  primary,
  muted,
  align,
}: {
  children: React.ReactNode;
  primary?: boolean;
  muted?: boolean;
  align?: "right";
}) {
  return (
    <td
      style={{
        fontSize: 11.5,
        fontWeight: primary ? 500 : 400,
        color: muted ? "#9ca3af" : primary ? "#111827" : "#374151",
        textAlign: align ?? "left",
        padding: "8px 10px",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </td>
  );
}

function OutcomeChip({ outcome }: { outcome: OutcomeKind }) {
  const palette = OUTCOME_PALETTE[outcome];
  return (
    <span
      className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${palette}`}
    >
      {outcome}
    </span>
  );
}

const OUTCOME_PALETTE: Record<OutcomeKind, string> = {
  AUTO: "bg-gray-100 text-gray-700",
  AUTO_GRACE: "bg-gray-100 text-gray-700 italic",
  ADMIN_APPROVE: "bg-gray-100 text-gray-700",
  ADMIN_REJECT: "bg-red-50 text-red-700",
  PENDING: "bg-amber-50 text-amber-700",
};

function formatDayDate(dateStr: string): string {
  // formatIstShortDate returns "Tue, May 12" — match the user-table style
  // already used elsewhere in admin attendance views.
  return formatIstShortDate(dateStr);
}
