"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { RestoreObdModal } from "@/components/admin/RestoreObdModal";

// ── Types ────────────────────────────────────────────────────────────────────

interface RemovedOrderRow {
  id:                 number;
  obdNumber:          string;
  shipToCustomerId:   string | null;
  shipToCustomerName: string | null;
  removalReason:      string | null;
  removalRemark:      string | null;
  removedAt:          string;
  removedBy:          { id: number; name: string } | null;
  challan:            { challanNumber: string; isVoided: boolean } | null;
}

interface ListResponse {
  ok:       true;
  total:    number;
  page:     number;
  pageSize: number;
  rows:     RemovedOrderRow[];
}

const PAGE_SIZE = 25;

// ── Helpers ──────────────────────────────────────────────────────────────────

function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  if (reason === "CUSTOMER_CANCELLED") return "Customer cancelled";
  if (reason === "WRONG_ORDER")        return "Wrong order";
  return reason;
}

function formatIstDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dateStr = d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
  });
  const timeStr = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return `${dateStr} · ${timeStr}`;
}

// Light, Smart Title Case for customer-name display — mirrors the project's
// existing smartTitleCase rules without importing the mail-orders helper.
const KEEP_UPPER = new Set([
  "CO", "LLP", "PVT", "LTD", "HW", "H/W", "JSW", "SAP", "OBD", "IGT", "UPC",
]);
const KEEP_LOWER = new Set([
  "and", "of", "the", "for", "in", "at", "to", "by",
]);
function smartTitleCase(input: string): string {
  return input
    .split(/(\s+)/)
    .map((part, i) => {
      if (/^\s+$/.test(part)) return part;
      const upper = part.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      const lower = part.toLowerCase();
      if (i !== 0 && KEEP_LOWER.has(lower)) return lower;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

// ── Component ────────────────────────────────────────────────────────────────

export function RemovedOrdersContent(): React.JSX.Element {
  const [rows,    setRows]    = useState<RemovedOrderRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [search,  setSearch]  = useState("");
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Search debounce — keep typing fast, network slow.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1); // search change resets to page 1
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const [restoreModalRow, setRestoreModalRow] = useState<RemovedOrderRow | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(`/api/admin/removed-orders?${params.toString()}`, {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as
        | ListResponse
        | { ok: false; error?: string };

      if (!res.ok || ("ok" in json && json.ok === false)) {
        const errRaw = (json as { error?: unknown }).error;
        const errMsg = typeof errRaw === "string" ? errRaw : "Failed to load removed orders";
        setError(errMsg);
        setRows([]);
        setTotal(0);
        return;
      }
      const ok = json as ListResponse;
      setRows(ok.rows);
      setTotal(ok.total);
    } catch (err) {
      console.error("[removed-orders] fetch failed", err);
      setError("Network error. Please try again.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  // ── Pagination derived ────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-5">
        <h1 className="text-[18px] font-extrabold text-gray-900 tracking-tight">
          Removed OBDs
        </h1>
        <p className="text-[12px] text-gray-500 mt-0.5">
          Soft-removed orders. Restore returns the OBD to its previous workflow stage.
        </p>
      </div>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            size={14}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by OBD or customer…"
            className="w-[280px] h-[34px] pl-8 pr-3 text-[13px] border border-gray-200 rounded-lg bg-white outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
          />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-500">
          {loading && (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>Loading…</span>
              <span className="text-gray-300">·</span>
            </>
          )}
          <span>{total} removed</span>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-[12.5px] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {/* ── Table (§28 fixed layout: 4/12/18/11/12/14/19/10 = 100%) ──────── */}
      <div className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${loading ? "opacity-60" : ""}`}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
        >
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "19%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 border-b border-[#ebebeb]">
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center"
                style={{ height: 32, padding: "0 4px 0 10px" }}
              >#</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >OBD No</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >Customer</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >Removed At</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >Removed By</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >Reason</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-left"
                style={{ height: 32, padding: "0 14px" }}
              >Remark</th>
              <th
                className="text-[10px] font-medium uppercase tracking-wider text-gray-400 text-center"
                style={{ height: 32, padding: "0 12px 0 4px" }}
              >Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={8} style={{ height: 64 }}>
                  <p className="text-[14px] text-gray-400 italic text-center py-6">
                    No removed orders found.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const cellCls    = "whitespace-nowrap overflow-hidden text-ellipsis text-[11px]";
                const cellStyle: React.CSSProperties = {
                  height: 36, padding: "0 14px", borderBottom: "1px solid #f0f0f0",
                };
                const customerDisplay = row.shipToCustomerName
                  ? smartTitleCase(row.shipToCustomerName)
                  : "—";
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    {/* # — page-relative serial */}
                    <td
                      className="text-[11px] font-mono text-gray-400 text-center"
                      style={{ height: 36, padding: "0 4px 0 10px", borderBottom: "1px solid #f0f0f0" }}
                    >
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    {/* OBD No — mono primary */}
                    <td className={cellCls} style={cellStyle}>
                      <span className="font-mono text-[11px] text-gray-900 font-medium">
                        {row.obdNumber}
                      </span>
                    </td>
                    {/* Customer — primary, smartTitleCase */}
                    <td className={cellCls} style={cellStyle}>
                      <span className="text-[11px] text-gray-900 font-medium">
                        {customerDisplay}
                      </span>
                    </td>
                    {/* Removed At — secondary */}
                    <td className={cellCls} style={cellStyle}>
                      <span className="text-[11px] text-gray-600">
                        {formatIstDateTime(row.removedAt)}
                      </span>
                    </td>
                    {/* Removed By — secondary */}
                    <td className={cellCls} style={cellStyle}>
                      <span className="text-[11px] text-gray-600">
                        {row.removedBy?.name ?? "—"}
                      </span>
                    </td>
                    {/* Reason — human label */}
                    <td className={cellCls} style={cellStyle}>
                      <span className="text-[11px] text-gray-600">
                        {reasonLabel(row.removalReason)}
                      </span>
                    </td>
                    {/* Remark — ellipsis + hover title */}
                    <td className={cellCls} style={cellStyle} title={row.removalRemark ?? ""}>
                      <span className="text-[11px] text-gray-600">
                        {row.removalRemark ?? "—"}
                      </span>
                    </td>
                    {/* Actions */}
                    <td
                      className="text-center"
                      style={{ height: 36, padding: "0 12px 0 4px", borderBottom: "1px solid #f0f0f0" }}
                    >
                      <button
                        type="button"
                        onClick={() => setRestoreModalRow(row)}
                        className="h-[28px] px-3 text-[12px] font-medium text-gray-700 bg-white border border-gray-200 rounded-md hover:bg-gray-50"
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-3 mt-3 text-[12px] text-gray-500">
          <button
            type="button"
            onClick={() => canPrev && setPage((p) => p - 1)}
            disabled={!canPrev || loading}
            className="h-[28px] px-3 border border-gray-200 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          <span className="text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => canNext && setPage((p) => p + 1)}
            disabled={!canNext || loading}
            className="h-[28px] px-3 border border-gray-200 rounded-md bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}

      {/* ── Restore modal ────────────────────────────────────────────────── */}
      {restoreModalRow && (
        <RestoreObdModal
          open={true}
          onClose={() => setRestoreModalRow(null)}
          onRestored={() => {
            setRestoreModalRow(null);
            void fetchList();
          }}
          row={restoreModalRow}
        />
      )}
    </div>
  );
}
