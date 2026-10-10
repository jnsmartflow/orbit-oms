"use client";

// /trip-sheets — the phone list of a day's Orbit trips (2026-10-09; tabs,
// date bar, SO line and search 2026-10-10). Spec
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §4; look = the live
// Picking screens (ModuleMobileHeader, WorkflowTabBar, the card shell).
//
// Owns the tab state AND the fetch, one level above the body, because both must
// reach RoleLayoutClient (the tab counts live in its bottom bar) — the Picking
// shell pattern (CLAUDE_UI §59.4). READ-ONLY: GET /api/trip-sheets(/search) only.
//
// TABS = Floor's own rule: a trip is on the tab of the type it was NUMBERED
// under (lib/floor/scope.ts tripInScope) — I- and C- trips share "IGT / Cross".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, MapPin, Search, Truck, Plane, UserRound, X } from "lucide-react";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { NavItemConfig } from "@/lib/permissions";
import { getTodayIST } from "@/lib/dates";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { tripInScope } from "@/lib/floor/scope";
import { TRIP_SHEET_TABS, parseTripSheetTab, scopeOfTab, type TripSheetTab } from "@/lib/trip-sheet/tabs";
import type { TripSheetListRow, TripSheetMatchField, TripSheetSearchHit } from "@/lib/trip-sheet/types";
import { CardShell, CardShelf, HandChip, ReadyChip, fmtNum } from "./card-bits";

const MATCH_LABEL: Record<TripSheetMatchField, string> = {
  trip: "trip",
  vehicle: "vehicle",
  driver: "driver",
  stop: "stop",
  dealer: "bill of",
  so: "SO",
  invoice: "invoice",
  obd: "OBD",
};

const SEARCH_DEBOUNCE_MS = 300;

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
  initialTab,
  role,
  userName,
  userInitials,
  navItems,
}: {
  initialDate: string;
  initialTab: TripSheetTab;
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}) {
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<TripSheetListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TripSheetTab>(initialTab);

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
  }, [date, load]);

  // Date + tab in the URL so Back from a trip lands on the same day and tab. A
  // history REPLACE, not router.replace — no server round trip, no refresh.
  useEffect(() => {
    window.history.replaceState(null, "", `/trip-sheets?date=${date}&type=${tab}`);
  }, [date, tab]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    const c = {} as Record<TripSheetTab, number>;
    for (const t of TRIP_SHEET_TABS) c[t.key] = r.filter((x) => tripInScope(x, t.scope)).length;
    return c;
  }, [rows]);

  return (
    <RoleLayoutClient
      role={role}
      userName={userName}
      userInitials={userInitials}
      navItems={navItems}
      workflowTabs={[
        { key: "local", label: "Local", count: counts.local, icon: MapPin },
        { key: "upc", label: "UPC", count: counts.upc, icon: Truck },
        { key: "igt", label: "IGT / Cross", count: counts.igt, icon: Plane },
      ]}
      activeTabKey={tab}
      onTabChange={(k) => setTab(parseTripSheetTab(k))}
    >
      <ListBody
        date={date}
        setDate={setDate}
        rows={rows}
        error={error}
        tab={tab}
        setTab={setTab}
        counts={counts}
        userInitials={userInitials}
      />
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
  tab: TripSheetTab;
  setTab: (t: TripSheetTab) => void;
  counts: Record<TripSheetTab, number>;
  userInitials: string;
}) {
  const { openMenu, openYou } = useMobileShell();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TripSheetSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const term = q.trim();
  const searchMode = searchOpen && term.length >= 2;

  // Debounced search; a stale answer (an earlier, slower request) is dropped.
  useEffect(() => {
    if (!searchMode) {
      setHits(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/trip-sheets/search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (seq !== searchSeq.current) return;
        setHits(res.ok ? ((body?.hits ?? []) as TripSheetSearchHit[]) : []);
      } catch {
        if (seq === searchSeq.current) setHits([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchMode, term]);

  const shown = useMemo(() => (rows ?? []).filter((r) => tripInScope(r, scopeOfTab(tab))), [rows, tab]);

  // Search results grouped by trip date, newest first (the API already sorts).
  const groups = useMemo(() => {
    const g: { date: string; hits: TripSheetSearchHit[] }[] = [];
    for (const h of hits ?? []) {
      const last = g[g.length - 1];
      if (last && last.date === h.tripDate) last.hits.push(h);
      else g.push({ date: h.tripDate, hits: [h] });
    }
    return g;
  }, [hits]);

  function closeSearch() {
    setSearchOpen(false);
    setQ("");
  }

  function openDatePicker() {
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  }

  const tabLabel = TRIP_SHEET_TABS.find((t) => t.key === tab)!.label;

  return (
    <div className="fixed inset-0 md:left-[72px] flex flex-col overflow-hidden bg-[#f9fafb]">
      <div className="flex-shrink-0">
        <div className="mx-auto w-full max-w-[480px]">
          <ModuleMobileHeader
            title="Trip Sheets"
            avatarInitials={userInitials}
            onAvatarClick={openYou}
            onMenuClick={openMenu}
            searchActive={searchOpen}
            onSearchToggle={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          />
        </div>

        {searchOpen ? (
          <div className="bg-white border-b border-gray-200">
            <div className="mx-auto w-full max-w-[480px] px-3 py-2">
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
                <Search size={17} className="text-gray-400 shrink-0" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Trip, vehicle, driver, dealer, SO, invoice, OBD…"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-gray-900 placeholder:text-gray-400"
                />
                <button type="button" onClick={closeSearch} aria-label="Close search" className="text-gray-400 shrink-0">
                  <X size={17} />
                </button>
              </div>
              <p className="mt-1.5 px-1 text-[11.5px] text-[#98a2b3]">Last 14 days · all types</p>
            </div>
          </div>
        ) : (
          /* STICKY DATE BAR — full width, under the masthead; never scrolls away. */
          <div className="bg-white border-b border-gray-200">
            <div className="mx-auto w-full max-w-[480px] flex items-center px-2 py-1.5">
              <button
                type="button"
                onClick={() => setDate(shiftDate(date, -1))}
                aria-label="Previous day"
                className="w-11 h-11 rounded-full flex items-center justify-center text-[#667085] active:bg-gray-100"
              >
                <ChevronLeft size={22} />
              </button>
              <button type="button" onClick={openDatePicker} className="relative flex-1 flex flex-col items-center py-0.5">
                <span className="text-[16px] font-bold text-[#1d2939] tabular-nums">{dateLabel(date)}</span>
                <span className="text-[11.5px] font-medium text-[#98a2b3] tabular-nums">
                  {rows === null ? "Loading…" : `${counts[tab]} ${counts[tab] === 1 ? "trip" : "trips"} · ${tabLabel}`}
                </span>
                <input
                  ref={dateInput}
                  type="date"
                  value={date}
                  onChange={(e) => e.target.value && setDate(e.target.value)}
                  className="absolute inset-0 opacity-0 pointer-events-none"
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => setDate(shiftDate(date, 1))}
                aria-label="Next day"
                className="w-11 h-11 rounded-full flex items-center justify-center text-[#667085] active:bg-gray-100"
              >
                <ChevronRight size={22} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
        <div className="mx-auto w-full max-w-[480px] px-3 pt-3">
          {searchOpen ? (
            !searchMode ? (
              <p className="py-16 text-center text-[13px] text-[#98a2b3]">Type at least 2 letters</p>
            ) : searching && hits === null ? (
              <Spinner />
            ) : groups.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-[#98a2b3]">{searching ? "Searching…" : "No trips match"}</p>
            ) : (
              groups.map((g) => (
                <section key={g.date}>
                  <h2 className="px-1 pt-1 pb-2 text-[11.5px] font-bold uppercase tracking-wider text-gray-500">{dateLabel(g.date)}</h2>
                  {g.hits.map((h) => (
                    <TripCard
                      key={h.id}
                      row={h}
                      href={`/trip-sheets/${h.id}?date=${h.tripDate}&type=${tab}`}
                      matched={`matched: ${MATCH_LABEL[h.match.field]} ${h.match.value}`}
                    />
                  ))}
                </section>
              ))
            )
          ) : (
            <>
              {/* Desktop only — the WorkflowTabBar is phone-only (UI §59). */}
              <div className="hidden md:flex mb-3 gap-1.5">
                {TRIP_SHEET_TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold border ${
                      tab === t.key ? "bg-data-slate text-white border-data-slate" : "bg-white text-[#667085] border-gray-200"
                    }`}
                  >
                    {t.label} · {counts[t.key]}
                  </button>
                ))}
              </div>
              {rows === null ? (
                <Spinner />
              ) : error ? (
                <p className="py-16 text-center text-[13px] text-[#98a2b3]">{error}</p>
              ) : shown.length === 0 ? (
                <p className="py-16 text-center text-[13px] text-[#98a2b3]">No {tabLabel} trips on this day</p>
              ) : (
                shown.map((r) => <TripCard key={r.id} row={r} href={`/trip-sheets/${r.id}?date=${date}&type=${tab}`} />)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16 text-gray-400">
      <Loader2 className="animate-spin" size={20} />
    </div>
  );
}

function TripCard({ row, href, matched }: { row: TripSheetListRow; href: string; matched?: string }) {
  // areaLabel is "Pandesara +5" — the "+N" is greyed, as the Floor rail does.
  const m = row.areaLabel ? /^(.*?)( \+\d+)?$/.exec(row.areaLabel) : null;
  const driver = smartTitleCase(row.driverFirstName) || "No driver";
  return (
    <Link href={href} className="block active:opacity-70">
      <CardShell muted={row.isHand}>
        <div className="px-4 pt-3.5 pb-3">
          <div className="font-mono text-[12px] text-[#98a0aa]">{row.tripNumber}</div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="truncate font-mono text-[21px] font-bold leading-tight text-[#1d2939]">
              {row.vehicleNo ?? (row.isHand ? "Hand" : "No vehicle")}
            </span>
            <span className="shrink-0 text-[16px] font-semibold tabular-nums text-[#475467]">{row.timeLabel ?? "—"}</span>
          </div>
          <div className="mt-1 truncate text-[13.5px] font-medium text-[#667085]">
            {driver}
            {m && (
              <>
                <span className="text-[#c3c9d0]">{" · "}</span>
                {smartTitleCase(m[1])}
                {m[2] && <span className="text-[#98a2b3]">{m[2]}</span>}
              </>
            )}
          </div>
          {row.soNames.length > 0 && (
            <div className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug text-[#475467]">
              <UserRound size={15} className="mt-[2px] shrink-0 text-brand-600" />
              <span className="min-w-0 break-words">{row.soNames.map((n) => smartTitleCase(n)).join(", ")}</span>
            </div>
          )}
          {matched && <div className="mt-1.5 truncate text-[12px] text-[#98a2b3]">{matched}</div>}
        </div>
        <CardShelf
          muted={row.isHand}
          pills={[
            `${row.stops} ${row.stops === 1 ? "stop" : "stops"}`,
            `${row.bills} ${row.bills === 1 ? "bill" : "bills"}`,
            `${fmtNum(Math.round(row.kg))} kg`,
          ]}
          right={row.isHand ? <HandChip /> : <ReadyChip ready={row.isReady} />}
        />
      </CardShell>
    </Link>
  );
}
