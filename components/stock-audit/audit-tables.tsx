"use client";

// components/stock-audit/audit-tables.tsx — the desk's three tables: SKU
// summary, one SKU's ledger, per-counter progress.
//
// CLAUDE_UI §27 fixed table standard: table-layout fixed, a <colgroup> of
// percentage widths, 32px header / 36px rows, 10px uppercase header, 11px data,
// SKU codes in mono, ellipsis on overflow. (CORE §3 cites this as "§40" — a
// stale section number; §27 is the standard.)
//
// PHASE 1 HAS NO BOOK STOCK: no Book / Variance columns, no status tags beyond
// "Not in catalog". The `working` string is the API's (calc.ts formatWorking) —
// never rebuilt here, so phone, ledger and export cannot disagree.

import { cn } from "@/lib/utils";
import type { CounterProgress, SkuLedger, SkuSummaryRow } from "@/lib/stock-audit/types";
import { fmtDateTime } from "./audit-api";
import { fmtPcs } from "./count-api";

const TH = "h-8 px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-ink-400 border-b border-ink-100 whitespace-nowrap overflow-hidden text-ellipsis";
const TD = "h-9 px-3.5 text-[11px] text-ink-600 border-b border-ink-50 whitespace-nowrap overflow-hidden text-ellipsis";
const NUM = "text-right tabular-nums";
const MONO = "font-mono";

function Table({ widths, head, children }: { widths: string[]; head: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-[10px] border border-ink-100 bg-white">
      <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead className="bg-ink-25">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function EmptyRow({ cols, text }: { cols: number; text: string }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={cols} className="px-3.5 py-6 text-center text-[12px] text-ink-400">
        {text}
      </td>
    </tr>
  );
}

export function NotInCatalogTag(): React.JSX.Element {
  return (
    <span className="ml-1.5 rounded-full bg-warn-bg px-1.5 py-px align-middle font-sans text-[10px] font-semibold text-warn-text">
      Not in catalog
    </span>
  );
}

export function SkuSummaryTable({
  rows,
  emptyText,
  onOpen,
}: {
  rows: SkuSummaryRow[];
  emptyText: string;
  onOpen: (material: string) => void;
}): React.JSX.Element {
  return (
    <Table
      widths={["20%", "44%", "10%", "14%", "12%"]}
      head={
        <tr>
          <th className={TH}>SKU</th>
          <th className={TH}>Description</th>
          <th className={TH}>Pack</th>
          <th className={cn(TH, "text-right")}>Total pcs</th>
          <th className={cn(TH, "text-right")}>Lines</th>
        </tr>
      }
    >
      {rows.length === 0 ? (
        <EmptyRow cols={5} text={emptyText} />
      ) : (
        rows.map((r) => (
          <tr key={r.material} onClick={() => onOpen(r.material)} className="cursor-pointer hover:bg-ink-25">
            <td className={cn(TD, MONO, "font-medium text-ink-900")}>
              {r.material}
              {!r.inCatalog && <NotInCatalogTag />}
            </td>
            <td className={cn(TD, "font-medium text-ink-900")}>{r.description ?? "—"}</td>
            <td className={TD}>{r.pack ?? "—"}</td>
            <td className={cn(TD, NUM, "font-semibold text-ink-900")}>{fmtPcs(r.totalPcs)}</td>
            <td className={cn(TD, NUM)}>{r.lines}</td>
          </tr>
        ))
      )}
    </Table>
  );
}

export function LedgerTable({ ledger }: { ledger: SkuLedger }): React.JSX.Element {
  return (
    <Table
      widths={["26%", "38%", "14%", "22%"]}
      head={
        <tr>
          <th className={TH}>Counted by</th>
          <th className={TH}>Working</th>
          <th className={cn(TH, "text-right")}>Qty</th>
          <th className={TH}>Time</th>
        </tr>
      }
    >
      {ledger.rows.length === 0 ? (
        <EmptyRow cols={4} text="Nobody has counted this SKU yet" />
      ) : (
        ledger.rows.map((r) => (
          <tr key={r.lineId}>
            <td className={cn(TD, "font-medium text-ink-900")}>{r.countedByName}</td>
            <td className={cn(TD, "tabular-nums")}>{r.working}</td>
            <td className={cn(TD, NUM, "text-ink-900")}>{fmtPcs(r.totalPcs)}</td>
            <td className={cn(TD, "text-ink-400")}>{fmtDateTime(r.updatedAt)}</td>
          </tr>
        ))
      )}
      <tr className="bg-ink-25">
        <td className={cn(TD, "font-semibold text-ink-900")} colSpan={2}>
          Total
        </td>
        <td className={cn(TD, NUM, "font-semibold text-ink-900")}>{fmtPcs(ledger.totalPcs)}</td>
        <td className={TD} />
      </tr>
    </Table>
  );
}

export function ProgressTable({ rows }: { rows: CounterProgress[] }): React.JSX.Element {
  return (
    <Table
      widths={["40%", "15%", "20%", "25%"]}
      head={
        <tr>
          <th className={TH}>Counter</th>
          <th className={cn(TH, "text-right")}>Lines</th>
          <th className={cn(TH, "text-right")}>Pieces</th>
          <th className={TH}>Last entry</th>
        </tr>
      }
    >
      {rows.length === 0 ? (
        <EmptyRow cols={4} text="No counters on this audit" />
      ) : (
        rows.map((r) => (
          <tr key={r.userId}>
            <td className={cn(TD, "font-medium text-ink-900")}>
              {r.name || `User ${r.userId}`}
              {!r.assigned && <span className="ml-1.5 text-[10px] text-ink-400">(removed)</span>}
            </td>
            <td className={cn(TD, NUM)}>{r.lines}</td>
            <td className={cn(TD, NUM, "text-ink-900")}>{fmtPcs(r.pieces)}</td>
            <td className={cn(TD, r.lastEntryAt ? "" : "text-ink-400")}>
              {r.lastEntryAt ? fmtDateTime(r.lastEntryAt) : "No entries yet"}
            </td>
          </tr>
        ))
      )}
    </Table>
  );
}
