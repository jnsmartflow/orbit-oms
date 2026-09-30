"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

// /admin/so-access — which sales officers may log in to place orders
// (2026-09-30). Superuser-only; deliberately NOT a PageKey.
// Loads once, reloads after each action. NO polling (keep DB load tiny).
// Table follows CLAUDE_UI.md §27 (fixed layout, colgroup percentages).

type Row = {
  salesOfficerId: number;
  name: string;
  employeeCode: string;
  email: string | null;
  isActive: boolean;
  granted: boolean;
  grantedByName: string | null;
  grantedAt: string | null;
  pastGrants: number;
  lastLoginAt: string | null;
};

const COLS = ["17%", "9%", "22%", "7%", "10%", "14%", "11%", "10%"];

const TH =
  "h-8 px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af] " +
  "border-b border-[#ebebeb] whitespace-nowrap overflow-hidden text-ellipsis";
const TD =
  "h-9 px-3.5 text-[11px] text-[#4b5563] border-b border-[#f0f0f0] " +
  "whitespace-nowrap overflow-hidden text-ellipsis";

function fmtIst(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SoAccessTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmRow, setConfirmRow] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/so-access", { cache: "no-store" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.includes("application/json")) {
        setLoadError("Could not load order access. Reload the page.");
        return;
      }
      const data = (await res.json()) as { rows: Row[] };
      setRows(data.rows);
    } catch {
      setLoadError("Could not load order access. Check the connection.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(url: string, row: Row): Promise<Record<string, unknown> | null> {
    setBusyId(row.salesOfficerId);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salesOfficerId: row.salesOfficerId }),
      });
      const type = res.headers.get("content-type") ?? "";
      const data = type.includes("application/json") ? ((await res.json()) as Record<string, unknown>) : null;
      if (!res.ok || !data?.ok) {
        toast.error(typeof data?.error === "string" ? data.error : "Action failed.");
        return null;
      }
      return data;
    } catch {
      toast.error("Network error.");
      return null;
    } finally {
      setBusyId(null);
      await load();
    }
  }

  async function onGrant(row: Row) {
    const data = await post("/api/admin/so-access/grant", row);
    if (data) toast.success(`Order access granted to ${row.name}.`);
  }

  async function onRevokeConfirmed() {
    const row = confirmRow;
    setConfirmRow(null);
    if (!row) return;
    const data = await post("/api/admin/so-access/revoke", row);
    if (data) {
      const n = Number(data.sessionsEnded ?? 0);
      toast.success(`Access revoked for ${row.name} · ${n} session${n === 1 ? "" : "s"} ended.`);
    }
  }

  const grantedCount = rows?.filter((r) => r.granted).length ?? 0;

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-brand-700">Order access</h1>
          <p className="mt-0.5 text-[12px] text-gray-500">
            Which sales officers may log in with an email code to place orders. Superuser only.
          </p>
        </div>
        {rows && (
          <p className="text-[11px] text-gray-400 whitespace-nowrap">
            <span className="font-semibold text-gray-900">{grantedCount}</span> granted ·{" "}
            <span className="font-semibold text-gray-900">{rows.length}</span> sales officers
          </p>
        )}
      </div>

      {loadError && (
        <p role="alert" className="mb-3 rounded-lg border border-danger-bd bg-danger-bg px-3 py-2 text-[12px] text-danger-text">
          {loadError}
        </p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-x-auto">
        <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {COLS.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={TH}>Sales officer</th>
              <th className={TH}>Emp. code</th>
              <th className={TH}>Email</th>
              <th className={TH}>Active</th>
              <th className={TH}>Access</th>
              <th className={TH}>Granted by</th>
              <th className={TH}>Last login</th>
              <th className={`${TH} text-center pr-[12px]`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !loadError && (
              <tr><td colSpan={8} className={`${TD} text-[#9ca3af]`}>Loading…</td></tr>
            )}
            {rows?.length === 0 && (
              <tr><td colSpan={8} className={`${TD} text-[#9ca3af]`}>No sales officers.</td></tr>
            )}
            {rows?.map((r) => {
              const grantBlock = !r.email
                ? "No email — add it in Sales Officers first."
                : !r.isActive
                  ? "This sales officer is inactive."
                  : null;
              const busy = busyId === r.salesOfficerId;
              return (
                <tr key={r.salesOfficerId} className="hover:bg-gray-50/50">
                  <td className={`${TD} text-[#111827] font-medium`} title={r.name}>
                    {r.name}
                    {r.pastGrants > 0 && (
                      <span className="ml-1.5 font-normal text-[#9ca3af]">
                        · {r.pastGrants} past grant{r.pastGrants === 1 ? "" : "s"}/revoke{r.pastGrants === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                  <td className={`${TD} font-mono`}>{r.employeeCode || <span className="text-[#9ca3af]">—</span>}</td>
                  <td className={TD} title={r.email ?? undefined}>
                    {r.email ?? <span className="text-[#9ca3af]">No email — add it in Sales Officers</span>}
                  </td>
                  <td className={TD}>
                    {r.isActive ? "Yes" : <span className="text-[#9ca3af]">No</span>}
                  </td>
                  <td className={TD}>
                    {r.granted ? (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold bg-ok-bg text-ok-text">
                        Granted
                      </span>
                    ) : (
                      <span className="text-[#9ca3af]">Not granted</span>
                    )}
                  </td>
                  <td className={TD} title={r.granted ? `${r.grantedByName ?? ""} · ${fmtIst(r.grantedAt)}` : undefined}>
                    {r.granted ? (
                      <>
                        {r.grantedByName ?? "—"}
                        <span className="text-[#9ca3af]"> · {fmtIst(r.grantedAt)}</span>
                      </>
                    ) : (
                      <span className="text-[#9ca3af]">—</span>
                    )}
                  </td>
                  <td className={TD}>
                    {r.lastLoginAt ? fmtIst(r.lastLoginAt) : <span className="text-[#9ca3af]">Never</span>}
                  </td>
                  <td className={`${TD} text-center pr-[12px] overflow-visible`}>
                    {r.granted ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmRow(r)}
                        className="h-7 px-3 rounded-md border border-gray-200 bg-white text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                      >
                        {busy ? "…" : "Revoke"}
                      </button>
                    ) : (
                      <Tooltip content={grantBlock ?? ""} disabled={!grantBlock}>
                        <button
                          type="button"
                          disabled={busy || grantBlock !== null}
                          onClick={() => onGrant(r)}
                          className="h-7 px-3 rounded-md border border-transparent bg-brand-600 hover:bg-brand-700 text-[11px] font-medium text-white disabled:bg-gray-100 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          {busy ? "…" : "Grant"}
                        </button>
                      </Tooltip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={confirmRow !== null} onOpenChange={(o) => { if (!o) setConfirmRow(null); }}>
        <DialogContent className="max-w-[420px] p-0">
          <DialogHeader className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={18} />
              </div>
              <div className="flex-1 text-left">
                <DialogTitle className="text-[14px] font-semibold text-gray-900">
                  Revoke order access for {confirmRow?.name}?
                </DialogTitle>
                <p className="text-[12.5px] text-gray-600 mt-1.5 leading-relaxed">
                  They will be logged out now.
                </p>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="px-5 py-3.5 gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 px-4 text-[12.5px] font-medium border-gray-200 text-gray-700 hover:bg-gray-50"
              onClick={() => setConfirmRow(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 px-4 text-[12.5px] font-semibold bg-red-600 hover:bg-red-700 text-white"
              onClick={onRevokeConfirmed}
            >
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
