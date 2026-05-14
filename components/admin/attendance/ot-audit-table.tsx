"use client";

import { OtAuditDayBreakdown } from "./ot-audit-day-breakdown";
import type { UserAuditSummary } from "./ot-audit-view";

interface OtAuditTableProps {
  userSummaries: UserAuditSummary[];
  expandedId: number | null;
  onToggle(userId: number): void;
}

export function OtAuditTable({
  userSummaries,
  expandedId,
  onToggle,
}: OtAuditTableProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table
        style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead>
          <tr
            style={{
              height: 32,
              background: "#f9fafb",
              borderBottom: "1px solid #ebebeb",
            }}
          >
            <Th align="center">#</Th>
            <Th>User</Th>
            <Th align="right">Days</Th>
            <Th align="right">Total OT</Th>
            <Th align="right">Auto</Th>
            <Th align="right">Grace</Th>
            <Th align="right">Approved</Th>
            <Th align="right" title="Pending claims awaiting decision">
              Pending
            </Th>
            <Th align="right" title="Rejected claims this month">
              Rejected
            </Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {userSummaries.map((user, idx) => (
            <UserRow
              key={user.userId}
              index={idx + 1}
              user={user}
              expanded={expandedId === user.userId}
              onToggle={() => onToggle(user.userId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UserRow({
  index,
  user,
  expanded,
  onToggle,
}: {
  index: number;
  user: UserAuditSummary;
  expanded: boolean;
  onToggle(): void;
}) {
  const hasPending = user.pendingCount > 0;
  // Pending highlight: subtle amber left-border + faint amber row tint.
  const rowStyle: React.CSSProperties = {
    height: 36,
    borderBottom: "1px solid #f0f0f0",
    cursor: "pointer",
    background: hasPending ? "rgba(251, 191, 36, 0.06)" : "transparent",
    boxShadow: hasPending ? "inset 3px 0 0 #f59e0b" : undefined,
  };

  return (
    <>
      <tr
        onClick={onToggle}
        style={rowStyle}
        className="hover:bg-gray-50/60 transition-colors"
      >
        <Td align="center" muted>{index}</Td>
        <Td primary>
          {user.userName}
        </Td>
        <Td align="right">{user.daysWithOt}</Td>
        <Td align="right" primary>{`${user.totalCreditedMin} min`}</Td>
        <Td align="right" muted={user.autoMin === 0}>
          {user.autoMin === 0 ? "0" : user.autoMin}
        </Td>
        <Td align="right" muted={user.graceMin === 0}>
          {user.graceMin === 0 ? "0" : user.graceMin}
        </Td>
        <Td align="right" muted={user.approvedMin === 0}>
          {user.approvedMin === 0 ? "0" : user.approvedMin}
        </Td>
        <Td
          align="right"
          style={
            hasPending
              ? { color: "#b45309", fontWeight: 500 }
              : undefined
          }
          muted={!hasPending}
        >
          {user.pendingCount === 0 ? "0" : user.pendingCount}
        </Td>
        <Td align="right" muted={user.rejectedCount === 0}>
          {user.rejectedCount === 0 ? "0" : user.rejectedCount}
        </Td>
        <Td align="right">
          <span
            className="text-gray-400 text-[12px]"
            aria-label={expanded ? "Collapse row" : "Expand row"}
          >
            {expanded ? "▾" : "▸"}
          </span>
        </Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} style={{ padding: 0 }}>
            <OtAuditDayBreakdown user={user} />
          </td>
        </tr>
      )}
    </>
  );
}

function Th({
  children,
  align,
  title,
}: {
  children?: React.ReactNode;
  align?: "center" | "right";
  title?: string;
}) {
  const isFirst = align === "center";
  return (
    <th
      title={title}
      style={{
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#9ca3af",
        textAlign: isFirst ? "center" : align ?? "left",
        padding: isFirst ? "0 4px 0 10px" : "0 14px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
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
  style,
}: {
  children: React.ReactNode;
  primary?: boolean;
  muted?: boolean;
  align?: "center" | "right";
  style?: React.CSSProperties;
}) {
  const isFirst = align === "center";
  return (
    <td
      style={{
        fontSize: 11,
        fontWeight: primary ? 500 : 400,
        color: muted ? "#9ca3af" : primary ? "#111827" : "#4b5563",
        textAlign: isFirst ? "center" : align ?? "left",
        padding: isFirst ? "0 4px 0 10px" : "0 14px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
