"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UniversalHeader } from "@/components/universal-header";
import { getTodayIST } from "@/lib/dates";
import type { MrnBillingBoard, MrnDetail } from "@/lib/mrn/types";
import { MrnRail } from "./mrn-rail";
import { DetailPane } from "./detail-pane";
import { toDateParam } from "./format";

// Billing's desk board — composition root for /mrn's non-supervisor face.
//
// ⚠️ THE HEADER IS `<UniversalHeader />`, NOT A HAND-ROLLED ONE. The mockup's
// subtitle says "Floor-Control layout: hand-rolled header" and that was written
// in error — corrected in design §11 OQ-1. `/floor` is the ONE named
// hand-rolled exception in CLAUDE_UI.md §6 and MRN does not earn a second. The
// mockup draws the clock, the date stepper and the search on a single 52px row;
// UniversalHeader puts the stepper on Row 2, which costs 40px. That cost is
// accepted. Do NOT add a Row-1 stepper prop to the shared component to close
// the gap — that is a change to every board and belongs in its own session.
//
// 🔴 NO MARKER AND NO POLL ON THIS FACE, DELIBERATELY.
//
// This is the thing a future session will "fix". It is not broken. The owner
// ruled that billing gets NO live sync (design §5): while the supervisor holds
// an MRN, billing's screen shows the lines exactly as billing left them, and
// everything lands in one go when he taps End unloading. That is why
// /api/mrn/marker is supervisor-only and why no billing marker route exists —
// app/api/mrn/marker/route.ts carries the same reasoning at the other end, and
// the two comments are a pair. This is a KNOWN divergence from /picking and
// /floor, which both poll a 15s marker. Adding live sync here is a new product
// decision, not a bug report.
//
// Data refreshes on exactly two things: the operator picking a different MRN,
// and the operator changing the date.
//
// 🔴 BOTH REFRESHES ARE A CLIENT FETCH + setState. NEVER router.refresh()
// (CORE §3). Next gives navigations priority in its router action queue, so a
// refresh racing a history pop is marked discarded and its result never
// applied. Picking's picker face shipped exactly that bug and two timing fixes
// for it shipped green and stayed broken on production. Nothing in tsc or
// next build catches it.

/**
 * Today's IST calendar date as a LOCAL-midnight Date — the shape
 * HeaderDateStepper works in (its calendar builds local Dates, see
 * components/ui/date-picker-popover.tsx).
 *
 * ⚠ Built from getTodayIST() rather than a bare `new Date()`, and that matters
 * here in a way it does not on challan-content.tsx. This component renders on
 * the server too (Vercel: UTC) and then hydrates on a phone or desk in IST — a
 * bare `new Date()` resolves to two different CALENDAR DAYS on the two sides
 * for the 5½ hours after UTC midnight, which is a hydration mismatch AND the
 * wrong day. getTodayIST() pins the zone explicitly, so both sides agree.
 */
function istTodayLocal(): Date {
  const [y, m, d] = getTodayIST().split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function BillingBoard(): React.JSX.Element {
  const [date, setDate] = useState<Date>(istTodayLocal);
  const [search, setSearch] = useState("");

  const [board, setBoard] = useState<MrnBillingBoard | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MrnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const dateParam = toDateParam(date);

  // ── The rail ───────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBoardLoading(true);
      setBoardError(null);
      try {
        const res = await fetch(`/api/mrn/board?face=billing&date=${dateParam}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as MrnBillingBoard;
        if (!cancelled) setBoard(json);
      } catch (err) {
        if (!cancelled) {
          setBoardError(err instanceof Error ? err.message : "Failed to load the rail");
        }
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [dateParam]);

  // ── The detail ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    async function load() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(`/api/mrn/${selectedId}`);
        if (!res.ok) {
          // 404 covers "no such id" AND "soft-removed" — the route does not
          // distinguish them (design §11 OQ-8), so neither does this message.
          throw new Error(res.status === 404 ? "This MRN is no longer available." : `Request failed (${res.status})`);
        }
        const json = (await res.json()) as MrnDetail;
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Failed to load this MRN");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // Changing the date clears the selection: the pane must never keep showing
  // yesterday's truck beside today's rail.
  const handleDateChange = useCallback((next: Date) => {
    setDate(next);
    setSelectedId(null);
  }, []);

  const rows = board?.rows ?? [];

  // Client-side search over what the rail already holds — the three numbers an
  // operator has in front of them on paper. No server round trip: the day's
  // rail is a handful of rows, and a search endpoint would be a second
  // predicate to keep in step with buildMrnBillingWhere.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter((r) =>
      [r.mrnNumber, r.stiRefNo, r.deliveryNo, r.otrNo]
        .some((v) => v !== null && v.toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const checkingCount = useMemo(() => rows.filter((r) => r.status === "checking").length, [rows]);

  // "Trucks · 20 Aug" — the rail caption. Reads off the DATE THE SERVER
  // ANSWERED FOR (board.date), not the local stepper value, so a mismatch shows
  // rather than hides.
  const dateLabel = useMemo(() => {
    const src = board?.date ?? dateParam;
    const [y, m, d] = src.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
      timeZone: "UTC",
      day: "2-digit",
      month: "short",
    });
  }, [board?.date, dateParam]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <UniversalHeader
        title="Material Receipt Note"
        stats={[
          { label: rows.length === 1 ? "truck" : "trucks", value: rows.length },
          { label: "checking", value: checkingCount },
        ]}
        currentDate={date}
        onDateChange={handleDateChange}
        showDatePicker
        searchPlaceholder="Search MRN, STI, delivery no…"
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Body — 344px rail + working pane, the same two-track grid /floor uses
          (components/floor/floor-page.tsx). Only the geometry is borrowed; the
          header above is UniversalHeader, not floor's hand-rolled one. */}
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: "344px 1fr" }}
      >
        <MrnRail
          dateLabel={dateLabel}
          rows={filteredRows}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={boardLoading}
          error={boardError}
          filtered={search.trim() !== ""}
        />
        <DetailPane
          detail={detail}
          loading={detailLoading}
          error={detailError}
          empty={selectedId === null}
        />
      </div>
    </div>
  );
}
