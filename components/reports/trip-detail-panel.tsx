"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { PeriodPicker, istToday, type PeriodValue } from "@/components/reports/period-picker";

// The Trip Detail report panel: period, delivery type, Download Excel. No
// preview — the file is built on click by GET /api/reports/trip-detail.
//
// ⚠ WHY fetch + blob AND NOT CI's window.location.assign. CI's register export
// (components/ci/register-export.tsx) navigates straight to its route, which is
// right when the only answers are "here is the file" — but on a 403 or a 400
// (a range over 92 days) the browser then leaves the hub and shows raw JSON,
// and there is no way to know the request is still running. This panel must
// show a working state and the server's own message, so it fetches the file
// and saves it with an object-URL anchor — the save half is the same
// Blob → URL.createObjectURL → <a download> the admin CSV exports use
// (components/admin/customers-table.tsx). The SERVER still owns the filename:
// it is read back from Content-Disposition, never rebuilt here.

export function TripDetailPanel({
  deliveryTypes,
}: {
  deliveryTypes: { id: number; name: string }[];
}) {
  const [period, setPeriod] = useState<PeriodValue>(() => {
    const t = istToday();
    return { from: t, to: t };
  });
  const [typeId, setTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ from: period.from, to: period.to });
      if (typeId !== "") sp.set("deliveryTypeId", typeId);
      const res = await fetch(`/api/reports/trip-detail?${sp.toString()}`, { cache: "no-store" });

      if (res.status === 403) {
        setError("You do not have access to this report.");
        return;
      }
      if (!res.ok) {
        let msg = `The report could not be built (${res.status}).`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // Not JSON (e.g. a login redirect page) — keep the generic message.
        }
        setError(msg);
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `TripDetail-${period.from}-to-${period.to}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-[560px] flex-col px-6 py-[22px]">
      <h2 className="mb-1 text-[17px] font-bold text-gray-900">Trip Detail</h2>
      <p className="mb-5 text-[12px] leading-relaxed text-gray-400">
        Every bill loaded on a trip, one row per bill, as an Excel file. Held bills, removed bills and
        cancelled trips are not included.
      </p>

      <div className="mb-3.5 grid max-w-[420px] grid-cols-[96px_1fr] items-center gap-3.5">
        <label htmlFor="td-period" className="text-[12.5px] text-gray-600">
          Period
        </label>
        <PeriodPicker id="td-period" value={period} onChange={setPeriod} />
      </div>

      <div className="mb-3.5 grid max-w-[420px] grid-cols-[96px_1fr] items-center gap-3.5">
        <label htmlFor="td-type" className="text-[12.5px] text-gray-600">
          Delivery type
        </label>
        <select
          id="td-type"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          className="h-[38px] w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/10"
        >
          <option value="">All</option>
          {deliveryTypes.map((t) => (
            <option key={t.id} value={String(t.id)}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="pt-4">
        <button
          type="button"
          onClick={download}
          disabled={busy}
          className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand-600 px-[17px] text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-wait disabled:opacity-70"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {busy ? "Building…" : "Download Excel"}
        </button>
        {error !== null && (
          <p role="alert" className="mt-2.5 max-w-[420px] text-[12px] text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
