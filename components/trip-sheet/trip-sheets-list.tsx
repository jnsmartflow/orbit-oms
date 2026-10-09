"use client";

// /trip-sheets — the phone list of a day's Orbit trips (2026-10-09). Spec
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §4; look = the live
// Picking screens (ModuleMobileHeader, WorkflowTabBar, the card shell).
//
// Owns the tab state AND the fetch, one level above the body, because both must
// reach RoleLayoutClient (the tab counts live in its bottom bar) — the Picking
// shell pattern (CLAUDE_UI §59.4). READ-ONLY: GET /api/trip-sheets only.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, PackageCheck, Search, Truck, X } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { NavItemConfig } from "@/lib/permissions";
import { getTodayIST } from "@/lib/dates";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { TripSheetListRow } from "@/lib/trip-sheet/types";
import { CardShell, CardShelf, HandChip, ReadyChip, fmtNum } from "./card-bits";

type Tab = "all" | "ready" | "picking";

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateLabel(dateStr: string): string {
  if (dateStr === getTodayIST()) return "Today";
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-IN", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

export function TripSheetsList({
  initialDate,
  role,
  userName,
  userInitials,
  navItems,
}: {
  initialDate: string;
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}) {
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<TripSheetListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");

  const load = useCallback(async (d: string) => {
    setRows(null);
    setError(null);
    try {
      const res = await fetch(`/api/trip-sheets?date=${d}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load trips");
      setRows(body.rows as TripSheetListRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load trips");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load(date);
    // Keep the date in the URL so Back from a trip lands on the same day. A
    // history REPLACE, not router.replace — no server round trip, no refresh.
    window.history.replaceState(null, "", `/trip-sheets?date=${date}`);
  }, [date, load]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return { all: r.length, ready: r.filter((x) => x.isReady).length, picking: r.filter((x) => !x.isReady).length };
  }, [rows]);

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={[
        { key: "all", label: "All", count: counts.all, icon: Truck },
        { key: "ready", label: "Ready", count: counts.ready, icon: CheckCircle2 },
        { key: "picking", label: "Picking", count: counts.picking, icon: PackageCheck },
      ]}
      activeTabKey={tab}
      onTabChange={(k) => setTab(k as Tab)}
    >
      <ListBody date={date} setDate={setDate} rows={rows} error={error} tab={tab} setTab={setTab} counts={counts} userInitials={userInitials} />
    </RoleLayoutClient>
  );
}

function ListBody({
  date,
  setDate,
  rows,
  error,
  tab,
  setTab,
  counts,
  userInitials,
}: {
  date: string;
  setDate: (d: string) => void;
  rows: TripSheetListRow[] | null;
  error: string | null;
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: Record<Tab, number>;
  userInitials: string;
}) {
  const { openMenu, openYou } = useMobileShell();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (tab === "ready" && !r.isReady) return false;
      if (tab === "picking" && r.isReady) return false;
      if (!term) return true;
      return [r.tripNumber, r.vehicleNo, r.driverFirstName, r.areaLabel].some((v) => (v ?? "").toLowerCase().includes(term));
    });
  }, [rows, tab, q]);

  return (
    <div className="fixed inset-0 md:left-[72px] flex flex-col overflow-hidden bg-[#f9fafb]">
      <div className="mx-auto w-full max-w-[480px] flex-shrink-0">
        <ModuleMobileHeader
          title="Trip Sheets"
          avatarInitials={userInitials}
          onAvatarClick={openYou}
          onMenuClick={openMenu}
          searchActive={searchOpen}
          onSearchToggle={() => setSearchOpen((v) => !v)}
        />
        {searchOpen && (
          <div className="bg-white border-b border-gray-200 px-3 py-2">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Trip, vehicle, driver, area…"
                className="flex-1 bg-transparent outline-none text-[16px] text-gray-900 placeholder:text-gray-400"
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="text-gray-400">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
        <div className="mx-auto w-full max-w-[480px] px-3 pt-3">
          {/* Date pill */}
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-white p-[3px]">
              <button
                type="button"
                onClick={() => setDate(shiftDate(date, -1))}
                aria-label="Previous day"
                className="w-8 h-8 rounded-full bg-[#f2f4f7] text-[#667085] flex items-center justify-center active:bg-gray-200"
              >
                <ChevronLeft size={16} />
              </button>
              <label className="relative px-2 text-[13px] font-semibold text-[#1d2939] tabular-nums cursor-pointer">
                {dateLabel(date)}
                {/* The native picker, invisible over the label. */}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  aria-label="Pick a date"
                />
              </label>
              <button
                type="button"
                onClick={() => setDate(shiftDate(date, 1))}
                aria-label="Next day"
                className="w-8 h-8 rounded-full bg-[#f2f4f7] text-[#667085] flex items-center justify-center active:bg-gray-200"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <span className="ml-auto text-[12px] font-medium text-[#98a2b3] tabular-nums">
              {rows === null ? "" : `${counts.all} ${counts.all === 1 ? "trip" : "trips"}`}
            </span>
          </div>

          {/* Desktop only — the WorkflowTabBar is phone-only (UI §59). */}
          <div className="hidden md:flex mb-3 gap-1.5">
            {(["all", "ready", "picking"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold border ${
                  tab === k ? "bg-data-slate text-white border-data-slate" : "bg-white text-[#667085] border-gray-200"
                }`}
              >
                {k === "all" ? "All" : k === "ready" ? "Ready" : "Picking"} · {counts[k]}
              </button>
            ))}
          </div>

          {rows === null ? (
            <div className="flex justify-center py-16 text-gray-400">
              <Loader2 className="animate-spin" size={20} />
            </div>
          ) : error ? (
            <p className="py-16 text-center text-[13px] text-[#98a2b3]">{error}</p>
          ) : shown.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-[#98a2b3]">No trips here</p>
          ) : (
            shown.map((r) => <TripCard key={r.id} row={r} date={date} />)
          )}
        </div>
      </div>
    </div>
  );
}

function TripCard({ row, date }: { row: TripSheetListRow; date: string }) {
  // areaLabel is "Pandesara +5" — the "+N" is greyed, as the Floor rail does.
  const m = row.areaLabel ? /^(.*?)( \+\d+)?$/.exec(row.areaLabel) : null;
  const driver = smartTitleCase(row.driverFirstName) || "No driver";
  return (
    <Link href={`/trip-sheets/${row.id}?date=${date}`} className="block active:opacity-70">
      <CardShell muted={row.isHand}>
        <div className="px-3.5 py-3">
          <div className="font-mono text-[11.5px] text-[#98a0aa]">{row.tripNumber}</div>
          <div className="mt-[3px] flex items-baseline justify-between gap-2.5">
            <span className="truncate text-[16.5px] font-semibold text-[#1d2939] font-mono">
              {row.vehicleNo ?? (row.isHand ? "Hand — dealer collects" : "No vehicle")}
            </span>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#667085]">{row.timeLabel ?? "—"}</span>
          </div>
          <div className="mt-1 truncate text-[12.5px] font-medium text-[#667085]">
            {driver}
            {m && (
              <>
                <span className="text-[#c3c9d0]">{" · "}</span>
                {smartTitleCase(m[1])}
                {m[2] && <span className="text-[#98a2b3]">{m[2]}</span>}
              </>
            )}
          </div>
        </div>
        <CardShelf
          muted={row.isHand}
          pills={[
            `${row.stops} ${row.stops === 1 ? "stop" : "stops"}`,
            `${row.bills} ${row.bills === 1 ? "bill" : "bills"}`,
            `${fmtNum(Math.round(row.litres))} L`,
          ]}
          right={row.isHand ? <HandChip /> : <ReadyChip ready={row.isReady} />}
        />
      </CardShell>
    </Link>
  );
}
