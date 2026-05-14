"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { formatDuration, formatIstShortDate } from "@/lib/attendance/format";
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

export function OtPendingTable({ initialRows }: OtPendingTableProps) {
  const [rows, setRows] = useState<PendingRow[]>(initialRows);
  const [active, setActive] = useState<ActiveModal>(null);
  const [banner, setBanner] = useState<Banner>(null);

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
    <>
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

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <PendingRowsTable rows={rows} onAction={(kind, row) => setActive({ kind, row })} />
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
    </>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-emerald-600" strokeWidth={2} />
      </div>
      <p className="text-[14px] font-semibold text-gray-900 mb-1">
        Nothing pending
      </p>
      <p className="text-[12px] text-gray-500">
        All caught up — no OT claims awaiting decision.
      </p>
    </div>
  );
}

function PendingRowsTable({
  rows,
  onAction,
}: {
  rows: PendingRow[];
  onAction(kind: "approve" | "reject", row: PendingRow): void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table
        style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
      >
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "27%" }} />
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
            <Th>Date</Th>
            <Th>Worked</Th>
            <Th>OT raw</Th>
            <Th>Reason</Th>
            <Th>Action</Th>
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
  const workedLabel = formatDuration(row.totalMinutesWorked);
  const otLabel = formatOtRaw(row.otMinutesRaw);
  return (
    <tr
      style={{
        height: 36,
        borderBottom: "1px solid #f0f0f0",
      }}
      className="hover:bg-gray-50/60 transition-colors"
    >
      <Td align="center">{index}</Td>
      <Td primary>{row.userName}</Td>
      <Td>{dateLabel}</Td>
      <Td>{workedLabel}</Td>
      <Td primary>{otLabel}</Td>
      <Td title={row.otClaimReason ?? undefined}>
        {row.otClaimReason ?? <span style={{ color: "#d1d5db" }}>—</span>}
      </Td>
      <Td>
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            onClick={() => onAction("approve", row)}
            className="bg-teal-600 hover:bg-teal-700 text-white text-[10px] font-semibold px-2 py-1 rounded"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onAction("reject", row)}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px] font-semibold px-2 py-1 rounded"
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
  align?: "center";
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

function Td({
  children,
  primary,
  align,
  title,
}: {
  children: React.ReactNode;
  primary?: boolean;
  align?: "center";
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
        textAlign: isFirst ? "center" : "left",
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

// Sub-hour values rendered as "47 min" to match the mockup; longer
// durations fall back to formatDuration's "1h 18m" shape.
function formatOtRaw(min: number): string {
  if (min < 60) return `${min} min`;
  return formatDuration(min);
}
