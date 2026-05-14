"use client";

import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  formatDuration,
  formatIstShortDate,
  shiftCalendarDate,
} from "@/lib/attendance/format";
import { AttendancePageHeader } from "./attendance-page-header";
import { MonthPicker } from "./month-picker";
import { OtApproveModal } from "./ot-approve-modal";
import { OtRejectModal } from "./ot-reject-modal";

// Mirrors the API response shape from GET /api/admin/attendance/ot-pending.
// Exported because the modals also reference it.
export interface PendingRow {
  recordId: number;
  userId: number;
  userName: string;
  userRole: string;
  attendanceDate: string;
  checkInISO: string | null;
  checkOutISO: string;
  totalMinutesWorked: number;
  otMinutesRaw: number;
  otClaimReason: string | null;
  submittedAt: string;
}

interface OtPendingTableProps {
  initialRows: PendingRow[];
}

type Banner =
  | { kind: "refreshing"; text: string }
  | { kind: "error"; text: string }
  | null;

type ActiveModal =
  | { kind: "approve"; row: PendingRow }
  | { kind: "reject"; row: PendingRow }
  | null;

type RangeId = "today" | "week" | "older";

export function OtPendingTable({ initialRows }: OtPendingTableProps) {
  const [rows, setRows] = useState<PendingRow[]>(initialRows);
  const [active, setActive] = useState<ActiveModal>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [activeRange, setActiveRange] = useState<RangeId>("today");
  const [activeMonth, setActiveMonth] = useState<string>(getTodayIstMonth());

  const today = useMemo(() => getTodayIst(), []);
  const monday = useMemo(() => mondayOfWeek(today), [today]);
  const currentIstMonth = useMemo(() => today.slice(0, 7), [today]);

  // Bucket rows by recency, scoped to the selected month. Pills + visible
  // rows both derive from this so counts always match what the user sees.
  const buckets = useMemo(() => {
    const today_: PendingRow[] = [];
    const week_: PendingRow[] = [];
    const older_: PendingRow[] = [];
    for (const r of rows) {
      if (!r.attendanceDate.startsWith(activeMonth)) continue;
      if (r.attendanceDate === today) today_.push(r);
      else if (r.attendanceDate >= monday) week_.push(r);
      else older_.push(r);
    }
    return { today: today_, week: week_, older: older_ };
  }, [rows, activeMonth, today, monday]);

  const visibleRows = buckets[activeRange];

  function handleSuccess(recordId: number) {
    setRows((prev) => prev.filter((r) => r.recordId !== recordId));
    setActive(null);
  }

  async function handleStaleClose() {
    setActive(null);
    await refetch();
  }

  async function refetch() {
    setBanner({
      kind: "refreshing",
      text: "Already actioned by another admin. Refreshing list…",
    });
    try {
      const res = await fetch("/api/admin/attendance/ot-pending", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PendingRow[];
      setRows(data);
      setBanner(null);
    } catch {
      setBanner({ kind: "error", text: "Couldn't load. Tap to retry." });
    }
  }

  return (
    <div className="min-w-[1100px]">
      <AttendancePageHeader activeTab="ot-pending" otPendingCount={rows.length}>
        <RangePills
          activeRange={activeRange}
          onChange={setActiveRange}
          counts={{
            today: buckets.today.length,
            week: buckets.week.length,
            older: buckets.older.length,
          }}
        />
        <MonthPicker
          currentMonth={activeMonth}
          currentIstMonth={currentIstMonth}
          onChange={setActiveMonth}
        />
      </AttendancePageHeader>

      <div className="p-4">
        {banner && (
          <div className="mb-3">
            {banner.kind === "refreshing" ? (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-[12.5px] text-amber-800 flex items-center gap-2">
                <span
                  className="inline-block w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin"
                  aria-hidden
                />
                {banner.text}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-[12.5px] text-red-800">
                {banner.text}{" "}
                <button
                  type="button"
                  onClick={refetch}
                  className="underline font-medium hover:text-red-900"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {visibleRows.length === 0 ? (
          <EmptyState range={activeRange} month={activeMonth} />
        ) : (
          <PendingRowsTable
            rows={visibleRows}
            onAction={(kind, row) => setActive({ kind, row })}
          />
        )}

        {active?.kind === "approve" && (
          <OtApproveModal
            row={active.row}
            onClose={() => setActive(null)}
            onSuccess={handleSuccess}
            onStaleClose={handleStaleClose}
          />
        )}
        {active?.kind === "reject" && (
          <OtRejectModal
            row={active.row}
            onClose={() => setActive(null)}
            onSuccess={handleSuccess}
            onStaleClose={handleStaleClose}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Strip 2 — recency pills
// ────────────────────────────────────────────────────────────────────────

interface RangePillsProps {
  activeRange: RangeId;
  onChange(r: RangeId): void;
  counts: { today: number; week: number; older: number };
}

function RangePills({ activeRange, onChange, counts }: RangePillsProps) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <Pill
        active={activeRange === "today"}
        onClick={() => onChange("today")}
        count={counts.today}
      >
        Today
      </Pill>
      <Pill
        active={activeRange === "week"}
        onClick={() => onChange("week")}
        count={counts.week}
      >
        This week
      </Pill>
      <Pill
        active={activeRange === "older"}
        onClick={() => onChange("older")}
        count={counts.older}
      >
        Older
      </Pill>
    </div>
  );
}

function Pill({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick(): void;
  count: number;
  children: React.ReactNode;
}) {
  if (active) {
    // Single teal element on the page per UI §6.
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-white bg-teal-600 hover:bg-teal-700"
      >
        {children}
        <span className="opacity-80 ml-1 tabular-nums">· {count}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 rounded-md"
    >
      {children}
      <span className="text-gray-400 ml-1 tabular-nums">· {count}</span>
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Empty state — context-aware
// ────────────────────────────────────────────────────────────────────────

function EmptyState({ range, month }: { range: RangeId; month: string }) {
  const rangeLabel =
    range === "today" ? "today" : range === "week" ? "this week" : "older than this week";
  const monthLabel = formatMonthLabel(month);
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" strokeWidth={2} />
      </div>
      <p className="text-[14px] font-semibold text-gray-900 mb-1">
        Nothing pending {rangeLabel}
      </p>
      <p className="text-[12px] text-gray-500">
        No OT claims awaiting decision in {monthLabel}.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Table — added Role + Status columns per redesign mockup
// ────────────────────────────────────────────────────────────────────────

function PendingRowsTable({
  rows,
  onAction,
}: {
  rows: PendingRow[];
  onAction(kind: "approve" | "reject", row: PendingRow): void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "4%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "21%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "12%" }} />
        </colgroup>
        <thead>
          <tr style={{ height: 32, background: "#f9fafb", borderBottom: "1px solid #ebebeb" }}>
            <Th align="center">#</Th>
            <Th>User</Th>
            <Th>Role</Th>
            <Th>Date</Th>
            <Th align="right">OT raw</Th>
            <Th>Reason</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <Row key={row.recordId} index={idx + 1} row={row} onAction={onAction} />
          ))}
        </tbody>
      </table>
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid #f0f0f0",
          background: "#fafafa",
          fontSize: 11,
          color: "#9ca3af",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rows.length} pending claim{rows.length === 1 ? "" : "s"} · oldest first
      </div>
    </div>
  );
}

function Row({
  index,
  row,
  onAction,
}: {
  index: number;
  row: PendingRow;
  onAction(kind: "approve" | "reject", row: PendingRow): void;
}) {
  const dateLabel = formatIstShortDate(row.attendanceDate).replace(",", " ·");
  const otLabel = formatOtRaw(row.otMinutesRaw);
  return (
    <tr
      style={{ height: 36, borderBottom: "1px solid #f0f0f0" }}
      className="hover:bg-gray-50/60 transition-colors"
    >
      <Td align="center">{index}</Td>
      <Td primary>{row.userName}</Td>
      <Td>{formatRoleSlug(row.userRole)}</Td>
      <Td>{dateLabel}</Td>
      <Td align="right" primary>{otLabel}</Td>
      <Td title={row.otClaimReason ?? undefined}>
        {row.otClaimReason ?? <span style={{ color: "#d1d5db" }}>—</span>}
      </Td>
      <Td>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700">
          Pending
        </span>
      </Td>
      <Td>
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            onClick={() => onAction("approve", row)}
            className="border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 text-[10px] font-semibold px-2 py-0.5 rounded"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onAction("reject", row)}
            className="border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700 text-[10px] font-semibold px-2 py-0.5 rounded"
          >
            Reject
          </button>
        </span>
      </Td>
    </tr>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "center" | "right";
}) {
  const isFirst = align === "center";
  return (
    <th
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
  align,
  title,
}: {
  children: React.ReactNode;
  primary?: boolean;
  align?: "center" | "right";
  title?: string;
}) {
  const isFirst = align === "center";
  return (
    <td
      title={title}
      style={{
        fontSize: 11,
        fontWeight: primary ? 500 : 400,
        color: primary ? "#111827" : "#4b5563",
        textAlign: isFirst ? "center" : align ?? "left",
        padding: isFirst ? "0 4px 0 10px" : "0 14px",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </td>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function formatOtRaw(min: number): string {
  if (min < 60) return `${min} min`;
  return formatDuration(min);
}

function formatRoleSlug(slug: string): string {
  if (!slug) return "—";
  return slug
    .split(/[\s_]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function getTodayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getTodayIstMonth(): string {
  return getTodayIst().slice(0, 7);
}

function mondayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utc = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  const dayOfWeek = utc.getUTCDay();
  const daysFromMon = (dayOfWeek + 6) % 7;
  return shiftCalendarDate(dateStr, daysFromMon);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function formatMonthLabel(monthStr: string): string {
  const [yStr, mStr] = monthStr.split("-");
  const y = parseInt(yStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return monthStr;
  }
  return `${MONTH_NAMES[m - 1]} ${y}`;
}
