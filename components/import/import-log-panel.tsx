"use client";

// components/import/import-log-panel.tsx
//
// The Import window's "Today's log" tab — TODAY's (IST) MANUAL imports (SAP
// paste, SAP file, manual template), newest first. Read-only. Data from
// GET /api/import/log; mockup docs/mockups/import/import-window-v2.html.
//
// ⚠ NO SKIP REASON. The mockup showed "IN41" under the skipped count; nothing
// per-batch records why a bill was skipped, so it is not shown (owner D4).
// ⚠ "Skipped" counts skipped ROWS as well as bills on the SAP paths (non-LF
// rows, rule P) — a column with a hint, never a top tile (owner D1).
//
// Refetches whenever `refreshKey` changes; the modal bumps it on open, on
// selecting this tab, and when a template import reaches its result. No
// polling. Plain fetch + setState, never router.refresh() (CORE §3).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ImportLogHow, ImportLogResponse, ImportLogRow } from "@/lib/import-types";

export interface ImportLogPanelProps {
  refreshKey: number;
  /** Today's import count once loaded; null while loading or on error. */
  onCount:    (count: number | null) => void;
}

const HOW_LABEL: Record<ImportLogHow, string> = {
  "sap-paste": "SAP paste",
  "sap-file":  "SAP file",
  "template":  "Template",
};

const TH = "h-10 px-3.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-400 border-b border-ink-100 bg-ink-25 whitespace-nowrap overflow-hidden text-ellipsis";
const TD = "h-12 px-3.5 text-[14px] border-b border-ink-50 whitespace-nowrap overflow-hidden text-ellipsis";

export function ImportLogPanel({ refreshKey, onCount }: ImportLogPanelProps): React.JSX.Element {
  const [data,    setData]    = useState<ImportLogResponse | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [retry,   setRetry]   = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    onCount(null);
    (async () => {
      try {
        const res = await fetch("/api/import/log", { cache: "no-store" });
        const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
        if (!isJson) throw new Error(`Could not load the log (server returned ${res.status}).`);
        const body = (await res.json()) as ImportLogResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? `Could not load the log (${res.status}).`);
        if (cancelled) return;
        setData(body);
        onCount(body.rows.length);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the log.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // onCount is a setter passed by the modal; refetch only on the two keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, retry]);

  const today = new Date().toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short",
  });

  return (
    <div className="p-6">
      <div className="mb-4">
        <p className="text-[16px] font-bold text-ink-900">
          Today <span className="ml-1.5 text-[14px] font-medium text-ink-500">{today}</span>
        </p>
      </div>

      {error !== null ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger-bd bg-danger-bg px-3.5 py-2.5">
          <p className="text-[12px] text-danger-text">{error}</p>
          <button
            type="button"
            onClick={() => setRetry((n) => n + 1)}
            className="rounded-md border border-ink-200 bg-white px-3 py-1 text-[12px] font-semibold text-ink-700 hover:bg-ink-25 cursor-pointer"
          >
            Retry
          </button>
        </div>
      ) : data === null ? (
        <div className="flex h-[160px] items-center justify-center">
          <Loader2 className="animate-spin text-ink-400" size={22} />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Tile value={data.totals.imports} label={data.totals.imports === 1 ? "import" : "imports"} />
            <Tile value={data.totals.new}     label="new bills" />
          </div>

          {data.rows.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center rounded-lg border border-ink-100 text-[14px] text-ink-500">
              No manual imports yet today.
            </div>
          ) : (
            <div className={`overflow-hidden rounded-lg border border-ink-100 ${loading ? "opacity-60" : ""}`}>
              <table className="w-full" style={{ tableLayout: "fixed", borderCollapse: "collapse" }}>
                <colgroup>
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "11%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={`${TH} text-left`}>Time</th>
                    <th className={`${TH} text-left`}>Who</th>
                    <th className={`${TH} text-left`}>How</th>
                    <th className={`${TH} text-right`}>New</th>
                    <th className={`${TH} text-right`}>Existing</th>
                    <th className={`${TH} text-right`} title="Includes skipped rows (e.g. non-LF rows), not only whole bills">
                      Skipped
                    </th>
                    <th className={`${TH} text-right`}>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => <LogRow key={r.id} row={r} />)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ value, label }: { value: number; label: string }): React.JSX.Element {
  return (
    <div className="rounded-[10px] border border-ink-100 px-4 py-3">
      <b className="block text-[28px] font-bold leading-tight tabular-nums text-ink-900">{value.toLocaleString("en-IN")}</b>
      <span className="text-[13px] text-ink-500">{label}</span>
    </div>
  );
}

function LogRow({ row }: { row: ImportLogRow }): React.JSX.Element {
  const time = new Date(row.at).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit",
  });
  const n = (v: number, tone: string): React.JSX.Element => (
    <span className={v === 0 ? "text-ink-400" : tone}>{v.toLocaleString("en-IN")}</span>
  );
  return (
    <tr className="hover:bg-ink-25">
      <td className={`${TD} font-mono tabular-nums text-ink-500`} title={row.batchRef}>{time}</td>
      <td className={TD}>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-ink-50 text-[11px] font-bold text-ink-700">
            {initials(row.who)}
          </span>
          <span className="truncate font-medium text-ink-900">{row.who}</span>
          {row.status === "failed" && (
            <span className="flex-none rounded border border-danger-bd bg-danger-bg px-1.5 py-px text-[11px] font-semibold text-danger-text">
              Failed
            </span>
          )}
        </div>
      </td>
      <td className={TD}>
        <span className="rounded-md bg-ink-50 px-2 py-0.5 text-[12.5px] font-semibold text-ink-700">{HOW_LABEL[row.how]}</span>
      </td>
      <td className={`${TD} text-right tabular-nums`}>{n(row.new, "text-ink-700")}</td>
      <td className={`${TD} text-right tabular-nums`}>{n(row.existing, "text-ink-700")}</td>
      <td className={`${TD} text-right tabular-nums`}>{n(row.skipped, "font-semibold text-warn-text")}</td>
      <td className={`${TD} text-right tabular-nums`}>{n(row.failed, "font-semibold text-danger")}</td>
    </tr>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last  = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
