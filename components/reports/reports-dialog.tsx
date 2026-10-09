"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import ReportsTopBar from "@/components/reports/reports-top-bar";
import { TripDetailPanel } from "@/components/reports/trip-detail-panel";
import { istToday } from "@/components/reports/period-picker";
import type { ReportParams } from "@/components/reports/report-params";
import type { ReportCatalogItem, ReportId } from "@/components/reports/report-catalog";

// The Reports popup — an overlay over whatever screen the person is on
// (shape: docs/mockups/reports/reports-popup.html). Opened from the sidebar's
// Reports row (components/shared/role-sidebar.tsx) and rendered, always open,
// by the /reports page for saved links. ONE component for both, and the report
// list comes from one place: GET /api/reports/options, which filters
// REPORT_CATALOG by the person's ticks.
//
// 🔴 THE SCREEN BEHIND IS NEVER TOUCHED. Nothing here navigates or writes to
// the URL: the Tint Summary date and Customise options are held in this
// component's state (ReportsTopBar / CustomiseDrawer take an onParamsChange /
// onApply callback for exactly this). The dialog is portalled to <body>, and
// its owner (the sidebar) belongs to the layout, so the host screen's
// re-renders, polls and live sync neither unmount nor reach it.
//
// Portal host + `inert` on the rest of <body> while open: the mechanism
// components/billing/billing-pick-delete-popup.tsx uses. Unlike that popup,
// this one closes on the X, on Escape and on a click on the backdrop.

const DEFAULT_TINT_PARAMS = (): ReportParams => ({
  date: istToday(),
  hide: [],
  operators: [],
  includeHold: true,
  smu: [],
  area: [],
  trendDays: 7,
});

interface Options {
  userName: string;
  reports: ReportCatalogItem[];
  deliveryTypes: { id: number; name: string }[];
  roster: { id: number; name: string | null }[];
}

export function ReportsDialog({
  open,
  onClose,
  initialReport,
  initialTintParams,
}: {
  open: boolean;
  onClose: () => void;
  /** Report to select first (a saved /reports?r=… link). Ignored if not held. */
  initialReport?: ReportId | null;
  initialTintParams?: ReportParams;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportId | null>(initialReport ?? null);
  const [tintParams, setTintParams] = useState<ReportParams>(() => initialTintParams ?? DEFAULT_TINT_PARAMS());
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Own host node on <body>, made once.
  useEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-reports-dialog", "");
    document.body.appendChild(el);
    setHost(el);
    return () => {
      el.remove();
    };
  }, []);

  // Fresh options on every open — a tick granted since the last open shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadError(null);
    fetch("/api/reports/options", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Could not load reports (${res.status}).`);
        return (await res.json()) as Options;
      })
      .then((o) => {
        if (cancelled) return;
        setOptions(o);
        setSelected((cur) => (cur && o.reports.some((r) => r.id === cur) ? cur : (o.reports[0]?.id ?? null)));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load reports.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Inert page + focus save/restore, for exactly as long as open.
  useEffect(() => {
    if (!open || host === null) return;
    const hadFocus = document.activeElement as HTMLElement | null;
    const madeInert: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === host || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      madeInert.push(child);
    }
    dialogRef.current?.focus();
    return () => {
      for (const el of madeInert) el.removeAttribute("inert");
      if (hadFocus && document.contains(hadFocus)) hadFocus.focus();
    };
  }, [open, host]);

  // Escape closes — unless something inside (the period picker) already used
  // this Escape to close itself and marked it with preventDefault.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || host === null) return null;

  const reports = options?.reports ?? [];
  const modules = Array.from(new Set(reports.map((r) => r.module)));
  const current = reports.find((r) => r.id === selected) ?? null;
  const currentModule = current?.module ?? modules[0] ?? null;
  const inModule = reports.filter((r) => r.module === currentModule);

  const itemClass = (on: boolean) =>
    cn(
      "mb-0.5 block w-full rounded-md px-2.5 py-[9px] text-left text-[13px] transition-colors",
      on ? "bg-brand-50 font-semibold text-brand-700" : "text-gray-700 hover:bg-gray-50",
    );

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-900/45 p-6"
      // mousedown on the backdrop itself only — a click that starts inside the
      // window (or inside the Customise drawer's own overlay) never closes it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-dialog-title"
        tabIndex={-1}
        className="flex h-[min(500px,calc(100vh-48px))] w-[min(900px,100%)] flex-col overflow-hidden rounded-[10px] bg-white shadow-2xl outline-none"
      >
        {/* Top strip */}
        <div className="flex flex-none items-stretch border-b border-gray-200">
          <div className="flex items-center border-r border-gray-200 px-[18px] py-[13px]">
            <h2 id="reports-dialog-title" className="m-0 text-[12.5px] font-semibold text-gray-900">
              Orbit Reports
            </h2>
          </div>
          {options?.userName ? (
            <div className="flex items-center whitespace-nowrap border-r border-gray-200 px-[18px] text-[12.5px] text-gray-500">
              Signed in:&nbsp;<span className="font-semibold text-gray-900">{options.userName}</span>
            </div>
          ) : null}
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reports"
            title="Close"
            className="grid w-[50px] place-items-center bg-brand-700 text-white transition-colors hover:bg-brand-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        {options === null ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-gray-400">
            {loadError ?? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading reports…
              </span>
            )}
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="text-[13px] text-gray-400">You do not have access to any reports yet.</p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[150px_200px_1fr]">
            {/* Module */}
            <div className="min-h-0 overflow-auto border-r border-gray-200 px-2 py-2.5">
              <div className="px-2.5 pb-2 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400">
                Module
              </div>
              {modules.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelected(reports.find((r) => r.module === m)?.id ?? null)}
                  className={itemClass(m === currentModule)}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Reports in the module */}
            <div className="min-h-0 overflow-auto border-r border-gray-200 px-2 py-2.5">
              <div className="px-2.5 pb-2 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400">
                {currentModule} reports
              </div>
              {inModule.map((r) => (
                <button key={r.id} type="button" onClick={() => setSelected(r.id)} className={itemClass(r.id === current?.id)}>
                  {r.label}
                </button>
              ))}
            </div>

            {/* Selected report — the existing panels, unchanged. The first two
                columns are 150 + 200 (the mockup's 170 + 210 less 30) so this
                column is ~550px: the period picker's 392px popover, anchored
                134px in, then fits without a horizontal scroll. */}
            <div className="min-h-0 overflow-auto">
              {current?.id === "trip-detail" && (
                <TripDetailPanel key="trip-detail" deliveryTypes={options.deliveryTypes} />
              )}
              {current?.id === "freight-report" && (
                // Same panel, the Freight Report route. Keyed for its own period and type.
                <TripDetailPanel
                  key="freight-report"
                  deliveryTypes={options.deliveryTypes}
                  endpoint="/api/reports/freight-report"
                  title="Freight Report"
                  description="One row per bill, NTS layout — for MIS"
                  filePrefix="FreightReport"
                />
              )}
              {current?.id === "trip-detail-old" && (
                // Same panel, the old-layout route. Keyed so switching between
                // the two starts each with its own period and type.
                <TripDetailPanel
                  key="trip-detail-old"
                  deliveryTypes={options.deliveryTypes}
                  endpoint="/api/reports/trip-detail-old"
                  title="Trip Detail — Old Format"
                  description="The old NTS layout, for sheets that still expect it."
                  filePrefix="TripDetailOld"
                />
              )}
              {current?.id === "nts-trips" && (
                // Same panel, the NTS Trips route — one row per trip, not per bill.
                <TripDetailPanel
                  key="nts-trips"
                  deliveryTypes={options.deliveryTypes}
                  endpoint="/api/reports/nts-trips"
                  title="NTS Trips"
                  description="One row per Nagadhiraj trip — Tempo Report layout"
                  filePrefix="NTSTrips"
                />
              )}
              {current?.id === "tint-summary" && (
                <ReportsTopBar params={tintParams} roster={options.roster} onParamsChange={setTintParams} />
              )}
              {current?.id === "ti-report" && (
                // TI Report is an on-screen table with its own header and
                // filters; it does not fit a panel, so it stays a full screen.
                <div className="flex max-w-[560px] flex-col px-6 py-[22px]">
                  <h2 className="mb-1 text-[17px] font-bold text-gray-900">TI Report</h2>
                  <p className="mb-5 text-[12px] leading-relaxed text-gray-400">
                    Tinter issue entries by date range, with operator and tinter filters. Opens as a full
                    screen, where it can also be downloaded as Excel.
                  </p>
                  <div className="pt-4">
                    <a
                      href="/reports?r=ti-report"
                      className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-brand-600 px-[17px] text-[13px] font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      <ExternalLink size={14} />
                      Open TI Report
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
