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

//
// SHARE CHIPS (2026-10-17, Schema v27.71) replace the SO-names line: one chip
// per group (City 1 · City 2 · UPC · Project · Other — lib/trip-sheet/
// share-groups.ts). A tap shares THAT group's sheet from the row's in-memory
// sheet (no fetch after the tap — the iPhone gesture window), then logs it
// (POST /api/trip-sheets/[id]/share-log) and the chip turns green. Cancelled →
// no log. NotAllowedError → the captured file is kept and the chip offers
// "Tap to send". Tapping the card still opens the full trip.
// NEVER STALE (2026-10-17): the list refetches when visible again and every
// 60 s; a chip whose row is older than 60 s refetches ITS trip first, captures
// that, and stops at "Tap to send" (the fetch spent the tap). The caption has
// no group label — the file name carries it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Loader2, MapPin, Search, Send, Share2, Truck, Plane, X } from "lucide-react";
import { toast } from "sonner";
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
import type {
  TripShareChip,
  TripSheetListRow,
  TripSheetMatchField,
  TripSheetSearchHit,
} from "@/lib/trip-sheet/types";
import { filterSheet, groupOrderIds } from "@/lib/trip-sheet/share-groups";
import type { PreparedTripSheetShare } from "@/lib/trip-sheet/share-image";
import type { TripSheet } from "@/lib/trip-sheet/types";
import { CallButton, CardShell, CardShelf, HandChip, ReadyChip, fmtNum } from "./card-bits";

type ShareModule = typeof import("@/lib/trip-sheet/share-image");

/** A chip's in-flight state on THIS phone: capturing, or captured and waiting for a second tap. */
type ChipPhase = "busy" | "ready";

/** What a chip shows. */
type ChipView = "idle" | "busy" | "ready" | "shared";

const chipId = (tripId: number, key: string) => `${tripId}:${key}`;

/** The list refetches this often while visible, and a chip older than this refetches its trip first. */
const LIST_REFRESH_MS = 60_000;

/** When each row object (list or search hit) arrived from the server — a refetch makes new objects. */
const fetchedAt = new WeakMap<object, number>();

function stampFetched<T extends object>(rows: T[]): T[] {
  const now = Date.now();
  for (const r of rows) fetchedAt.set(r, now);
  return rows;
}

/** A captured file waiting for its second tap, with the bills it covers (what the log records). */
interface PreparedChip {
  share: PreparedTripSheetShare;
  orderIds: number[];
}

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

  // The date the newest request is for — a slower answer for another day is dropped.
  const dateRef = useRef(date);
  dateRef.current = date;

  /** `silent` = swap the rows in place (no spinner, keep the old rows on a failure). */
  const load = useCallback(async (d: string, silent = false) => {
    if (!silent) {
      setRows(null);
      setError(null);
    }
    try {
      const res = await fetch(`/api/trip-sheets?date=${d}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load trips");
      if (d !== dateRef.current) return;
      setRows(stampFetched(body.rows as TripSheetListRow[]));
      setError(null);
    } catch (err) {
      if (silent || d !== dateRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load trips");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  // NEVER STALE WHEN SHARED (2026-10-17): a chip shares the row's in-memory
  // sheet, so the list refetches in place when the page becomes visible again
  // and every 60 s while it is visible. No timer runs while hidden.
  const refresh = useCallback(() => load(dateRef.current, true), [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer === null) timer = setInterval(refresh, LIST_REFRESH_MS);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [refresh]);

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
        refresh={refresh}
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
  refresh,
}: {
  date: string;
  setDate: (d: string) => void;
  rows: TripSheetListRow[] | null;
  error: string | null;
  tab: TripSheetTab;
  setTab: (t: TripSheetTab) => void;
  counts: Record<TripSheetTab, number>;
  userInitials: string;
  /** Refetch the list in place (no spinner). */
  refresh: () => void;
}) {
  const { openMenu, openYou } = useMobileShell();
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TripSheetSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  // ── Share chips ──────────────────────────────────────────────────────────
  // The capture code + inlined logo are fetched when the LIST mounts, as the
  // detail page does, so a chip tap never spends iOS's gesture window on a
  // network fetch. The tap awaits the same promise.
  const shareModule = useRef<Promise<ShareModule> | null>(null);
  useEffect(() => {
    shareModule.current = import("@/lib/trip-sheet/share-image");
    shareModule.current.catch(() => {
      shareModule.current = null; // retried on the tap
    });
  }, []);
  const [phase, setPhase] = useState<Record<string, ChipPhase>>({});
  /** Files captured but not yet handed over — refused by navigator.share
   *  (NotAllowedError), or captured from a just-refetched trip — sent on the next tap. */
  const prepared = useRef(new Map<string, PreparedChip>());
  /** Shares logged on this phone since the rows loaded, with the bills they covered. */
  const [logged, setLogged] = useState<Record<string, number[]>>({});

  const setChipPhase = (id: string, p: ChipPhase | null) =>
    setPhase((prev) => {
      const next = { ...prev };
      if (p === null) delete next[id];
      else next[id] = p;
      return next;
    });

  function chipView(row: TripSheetListRow, chip: TripShareChip): ChipView {
    const id = chipId(row.id, chip.key);
    if (phase[id]) return phase[id];
    const mine = logged[id];
    if (mine && mine.length === chip.orderIds.length && mine.every((x, i) => x === chip.orderIds[i])) return "shared";
    return chip.shared !== null && !chip.stale ? "shared" : "idle";
  }

  /** This trip's sheet NOW (GET /api/trip-sheets/[id]); null = the trip is gone. Throws on a failure. */
  async function fetchFreshSheet(tripId: number): Promise<TripSheet | null> {
    const res = await fetch(`/api/trip-sheets/${tripId}`, { cache: "no-store" });
    if (res.status === 404) return null;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.sheet) throw new Error(body?.error ?? `HTTP ${res.status}`);
    return body.sheet as TripSheet;
  }

  async function onChip(row: TripSheetListRow, chip: TripShareChip) {
    const id = chipId(row.id, chip.key);
    if (phase[id] === "busy") return;
    let mod: ShareModule;
    let ready = prepared.current.get(id);
    try {
      mod = await (shareModule.current ?? import("@/lib/trip-sheet/share-image"));
      if (!ready) {
        setChipPhase(id, "busy");
        const age = Date.now() - (fetchedAt.get(row) ?? 0);
        if (age > LIST_REFRESH_MS) {
          // OLDER THAN 60 s: share what the trip is NOW, never the old copy.
          // The fetch spends iOS's gesture window, so capture the fresh sheet
          // and stop at "Tap to send" — the second tap shares it at once.
          const fresh = await fetchFreshSheet(row.id);
          refresh(); // the card's numbers and ticks follow
          const orderIds = fresh ? groupOrderIds(fresh, chip.key) : [];
          if (!fresh || orderIds.length === 0) {
            setChipPhase(id, null);
            toast(`No ${chip.label} bills on ${row.tripNumber} now — the list has been updated`);
            return;
          }
          const share = await mod.prepareTripSheetShare(filterSheet(fresh, chip.key), chip.label);
          prepared.current.set(id, { share, orderIds });
          setChipPhase(id, "ready");
          return;
        }
        ready = {
          share: await mod.prepareTripSheetShare(filterSheet(row.sheet, chip.key), chip.label),
          orderIds: chip.orderIds,
        };
      }
    } catch (err) {
      setChipPhase(id, null);
      console.error("Trip sheet share failed:", err);
      toast.error(`Couldn't prepare the ${chip.label} sheet: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let outcome: "shared" | "cancelled" | "downloaded";
    try {
      outcome = await mod.deliverTripSheetShare(ready.share);
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        // The capture outlived the tap's gesture window — keep the file; the
        // next tap hands it over at once.
        prepared.current.set(id, ready);
        setChipPhase(id, "ready");
        return;
      }
      prepared.current.delete(id);
      setChipPhase(id, null);
      console.error("Trip sheet share failed:", err);
      toast.error(`Couldn't share the ${chip.label} sheet: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    prepared.current.delete(id);
    setChipPhase(id, null);
    if (outcome === "cancelled") return; // closed the share sheet — no log, chip unchanged

    if (outcome === "downloaded") toast("Image downloaded and caption copied — attach it in WhatsApp");
    const orderIds = ready.orderIds;
    try {
      const res = await fetch(`/api/trip-sheets/${row.id}/share-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupKey: chip.key, orderIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setLogged((prev) => ({ ...prev, [id]: orderIds }));
      refresh(); // the tick comes back from the server's own log
    } catch (err) {
      toast.error(`Shared, but the tick was not saved: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
        setHits(res.ok ? stampFetched((body?.hits ?? []) as TripSheetSearchHit[]) : []);
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
                      chipView={chipView}
                      onChip={onChip}
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
                shown.map((r) => (
                  <TripCard
                    key={r.id}
                    row={r}
                    href={`/trip-sheets/${r.id}?date=${date}&type=${tab}`}
                    chipView={chipView}
                    onChip={onChip}
                  />
                ))
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

/**
 * One trip, DRIVER FIRST (2026-10-10). Rows, 8px apart, inside 18px padding:
 *   1  trip no (small mono, grey)                         time
 *   2  DRIVER FULL NAME (19px bold, wraps)                 [call]
 *   3  vehicle (mono, grey) · area label (+N muted)
 *   4  share chips (2026-10-17 — replaced the SO names line)
 *   shelf: stops · bills · kg · Ready/Picking
 *
 * ⚠ THE CARD LINK IS A STRETCHED OVERLAY, NOT A WRAPPER. The call button is an
 * <a href="tel:">, and an <a> inside an <a> is invalid HTML that browsers
 * repair unpredictably. So the card is a plain box, the trip link covers it
 * (absolute, z-1), and the call button and share chips sit ABOVE the link
 * (z-2) — a tap on them never reaches the link at all. No fixed heights: the
 * card grows with a long name or many chips.
 */
function TripCard({
  row,
  href,
  matched,
  chipView,
  onChip,
}: {
  row: TripSheetListRow;
  href: string;
  matched?: string;
  chipView: (row: TripSheetListRow, chip: TripShareChip) => ChipView;
  onChip: (row: TripSheetListRow, chip: TripShareChip) => void;
}) {
  // areaLabel is "Pandesara +5" — the "+N" is greyed, as the Floor rail does.
  const m = row.areaLabel ? /^(.*?)( \+\d+)?$/.exec(row.areaLabel) : null;
  const driver = smartTitleCase(row.driverName);
  return (
    <div className="relative mb-3">
      <CardShell muted={row.isHand} roomy>
        <div className="flex flex-col gap-2 px-5 pt-5 pb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[12px] text-[#98a0aa]">{row.tripNumber}</span>
            <span className="shrink-0 text-[15px] font-semibold tabular-nums text-[#475467]">{row.timeLabel ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span
              className={`min-w-0 break-words text-[19px] font-bold leading-snug ${driver ? "text-[#1d2939]" : "text-[#98a2b3]"}`}
            >
              {driver || "No driver"}
            </span>
            {!row.isHand && <CallButton phone={row.driverPhone} name={driver || null} />}
          </div>
          <div className="truncate text-[13.5px] font-medium text-[#667085]">
            <span className="font-mono">{row.vehicleNo ?? (row.isHand ? "Hand" : "No vehicle")}</span>
            {m && (
              <>
                <span className="text-[#c3c9d0]">{" · "}</span>
                {smartTitleCase(m[1])}
                {m[2] && <span className="text-[#98a2b3]">{m[2]}</span>}
              </>
            )}
          </div>
          {row.chips.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {row.chips.map((c) => (
                <ShareChipButton key={c.key} chip={c} view={chipView(row, c)} onTap={() => onChip(row, c)} />
              ))}
            </div>
          )}
          {matched && <div className="truncate text-[12px] text-[#98a2b3]">{matched}</div>}
        </div>
        <CardShelf
          roomy
          muted={row.isHand}
          pills={[
            `${row.stops} ${row.stops === 1 ? "stop" : "stops"}`,
            `${row.bills} ${row.bills === 1 ? "bill" : "bills"}`,
            `${fmtNum(Math.round(row.kg))} kg`,
          ]}
          right={row.isHand ? <HandChip /> : <ReadyChip ready={row.isReady} />}
        />
      </CardShell>
      <Link
        href={href}
        aria-label={`Open trip ${row.tripNumber}`}
        className="absolute inset-0 z-[1] rounded-[16px] active:bg-black/[0.04]"
      />
    </div>
  );
}

/**
 * One share chip (2026-10-17). Not shared: brand outline + share icon. Shared
 * (and not stale): ok-green fill + tick. Capturing: spinner. Captured but the
 * phone refused the share (NotAllowedError): brand fill, "Tap to send".
 * No bill counts. 40px tall; z-[2] so it sits ABOVE the card's stretched link.
 */
function ShareChipButton({ chip, view, onTap }: { chip: TripShareChip; view: ChipView; onTap: () => void }) {
  const base =
    "relative z-[2] inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold active:opacity-80 disabled:opacity-70";
  const look =
    view === "shared"
      ? "border-ok bg-ok text-white"
      : view === "ready"
        ? "border-brand-600 bg-brand-600 text-white"
        : "border-brand-600 bg-white text-brand-700";
  const label = view === "ready" ? `Tap to send · ${chip.label}` : chip.label;
  return (
    <button
      type="button"
      disabled={view === "busy"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      }}
      aria-label={view === "shared" ? `${chip.label} — shared, share again` : `Share ${chip.label} sheet`}
      className={`${base} ${look}`}
    >
      {view === "busy" ? (
        <Loader2 size={15} className="animate-spin" />
      ) : view === "shared" ? (
        <Check size={15} strokeWidth={2.6} />
      ) : view === "ready" ? (
        <Send size={15} />
      ) : (
        <Share2 size={15} />
      )}
      {label}
    </button>
  );
}
