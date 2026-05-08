"use client";

import { StatusChip } from "@/components/attendance/status-chip";
import { formatDuration, formatIstClock } from "@/lib/attendance/format";
import type { RosterRow } from "./attendance-dashboard";

interface RosterTableProps {
  rows: RosterRow[];
  selectedUserId: number | null;
  onSelectUser(id: number): void;
}

export function RosterTable({ rows, selectedUserId, onSelectUser }: RosterTableProps) {
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-[13px] text-gray-500">
        No active users.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "13%" }} />
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
            <Th>Role</Th>
            <Th>In</Th>
            <Th>Out</Th>
            <Th>Worked</Th>
            <Th>OT</Th>
            <Th>Status</Th>
            <Th>Flags</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <RosterRowView
              key={row.user.id}
              index={idx + 1}
              row={row}
              isSelected={row.user.id === selectedUserId}
              onSelect={() => onSelectUser(row.user.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "center" }) {
  const isFirst = align === "center";
  return (
    <th
      style={{
        fontSize: 10,
        fontWeight: 500,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: "#9ca3af",
        textAlign: isFirst ? "center" : "left",
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

function RosterRowView({
  index,
  row,
  isSelected,
  onSelect,
}: {
  index: number;
  row: RosterRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const summary = row.summary;
  const checkInDisplay = summary?.firstCheckInISO ? formatIstClock(summary.firstCheckInISO) : "—";
  const checkOutDisplay = summary?.lastCheckOutISO ? formatIstClock(summary.lastCheckOutISO) : "—";
  const workedDisplay = summary && summary.totalMinutesWorked > 0
    ? formatDuration(summary.totalMinutesWorked)
    : "—";
  const otDisplay = summary && summary.overtimeMinutes > 0
    ? formatDuration(summary.overtimeMinutes)
    : "—";

  const rowBg = isSelected ? "#f0fdfa" : "transparent"; // teal-50 for selected
  const borderLeft = isSelected ? "3px solid #14b8a6" : "3px solid transparent"; // teal-500

  return (
    <tr
      onClick={onSelect}
      style={{
        height: 36,
        background: rowBg,
        borderBottom: "1px solid #f0f0f0",
        cursor: "pointer",
      }}
      className="hover:bg-gray-50/60 transition-colors"
    >
      <Td align="center" style={{ borderLeft }}>{index}</Td>
      <Td primary>{row.user.name}</Td>
      <Td>{formatRoleSlug(row.user.role)}</Td>
      <Td>{checkInDisplay}</Td>
      <Td>{checkOutDisplay}</Td>
      <Td>{workedDisplay}</Td>
      <Td>{otDisplay}</Td>
      <Td>
        <StatusChip status={row.status} />
      </Td>
      <Td>
        <FlagPills flags={row.flags} />
      </Td>
    </tr>
  );
}

function Td({
  children,
  primary,
  align,
  style,
}: {
  children: React.ReactNode;
  primary?: boolean;
  align?: "center";
  style?: React.CSSProperties;
}) {
  const isFirst = align === "center";
  return (
    <td
      style={{
        fontSize: 11,
        fontWeight: primary ? 500 : 400,
        color: primary ? "#111827" : "#4b5563",
        textAlign: isFirst ? "center" : "left",
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

function FlagPills({ flags }: { flags: { geo: boolean; manual: boolean; yesterday: boolean } }) {
  const items: React.ReactNode[] = [];
  if (flags.geo) {
    items.push(
      <FlagPill key="geo" tone="red">GEO</FlagPill>,
    );
  }
  if (flags.manual) {
    items.push(
      <FlagPill key="manual" tone="gray">MANUAL</FlagPill>,
    );
  }
  if (flags.yesterday) {
    items.push(
      <FlagPill key="yesterday" tone="red">Y&apos;DAY</FlagPill>,
    );
  }
  if (items.length === 0) return <span className="text-gray-300">—</span>;
  return <span className="inline-flex flex-wrap gap-0.5">{items}</span>;
}

function FlagPill({ tone, children }: { tone: "red" | "amber" | "gray"; children: React.ReactNode }) {
  const cls =
    tone === "red"
      ? "bg-red-50 text-red-700 border-red-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-gray-50 text-gray-600 border-gray-200";
  return (
    <span
      className={`inline-block whitespace-nowrap font-medium rounded border text-[9px] px-1.5 py-0.5 ${cls}`}
    >
      {children}
    </span>
  );
}

function formatRoleSlug(slug: string): string {
  if (!slug) return "—";
  return slug
    .split(/[\s_]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
