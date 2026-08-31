"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UniversalHeader } from "@/components/universal-header";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { CiRail } from "./ci-rail";
import { CiDetailPane } from "./ci-detail-pane";
import type { CiBillingBoard, CiDetail } from "@/lib/ci/types";

// Billing's desk board — composition root for /ci's billing face.
// docs/mockups/ci/billing.html, all four frames.
//
// ⚠️ THE HEADER IS `<UniversalHeader />`, NOT A HAND-ROLLED ONE (CORE §10).
// `/floor` is the ONE named hand-rolled exception in CLAUDE_UI.md §6 and CI does
// not earn a second — MRN's billing board carries the same note for the same
// reason. Row 1 is the title and the search; Row 2 carries the counts where a
// segmented control would normally sit, with the date stepper on its right.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE COUNTS SIT IN `leftExtra`, NOT IN `segments`.
// ═══════════════════════════════════════════════════════════════════════════
//
// `segments` would render a SEGMENTED CONTROL — i.e. Pending/Closed tabs — and
// tabs are exactly what this screen removed. Both sections live in one rail so
// that closing a CI moves its card down the list IN FRONT OF the operator; a tab
// would make it vanish instead. `leftExtra` puts the same two numbers in the
// same place as plain text, with nothing to click.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE DATE STEPPER DRIVES THE CLOSED SECTION ONLY. PENDING IS THE WHOLE
//    BACKLOG AND IS NEVER DATE-FENCED.
// ═══════════════════════════════════════════════════════════════════════════
//
// The rule lives in lib/ci/queries.ts's buildCiBillingWhere (one OR, two arms)
// so the board and the marker cannot disagree about it. Repeated here because
// the stepper sitting in this header is what makes a reader assume it fences
// everything. The billing Picking tab shipped that assumption once and rendered
// an EMPTY TAB over a real backlog of older bills.
//
// 🔴 BILLING IS THE POLLING SIDE (spec §10). CI runs the opposite way to MRN:
// the floor supervisor CREATES the return on his phone, so he has nothing to
// wait for, and this desk is the side sitting with a screen open. That is why
// /api/ci/marker exists and is billing-only, and why the supervisor face has no
// marker at all. Both ends carry this note; they are a pair.

export function CiBillingBoardScreen(): React.JSX.Element {
  const [date, setDate] = useState<Date>(() => new Date());
  const [board, setBoard] = useState<CiBillingBoard | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  // 🔴 Set while the close form has anything typed in it, or a save is in
  // flight. Pauses the poll — a refetch mid-entry that reset the three fields
  // would be maddening. Same shape as MRN's `paused: detailOpen || overlayBusy`.
  const [formActive, setFormActive] = useState(false);

  // The IST calendar day the stepper is on, as "YYYY-MM-DD".
  // ⚠ NOT toISOString().slice(0,10) — that is the UTC day, and after 18:30 IST
  // it is yesterday, which is most of a depot evening shift.
  const dateParam = useMemo(
    () => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    [date],
  );

  /** "31 Aug" — for the rail's empty state. */
  const dateLabel = useMemo(
    () =>
      date.toLocaleDateString("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
      }),
    [date],
  );

  // ── Board fetch ───────────────────────────────────────────────────────────
  // 🔴 A CLIENT fetch + setState. NEVER router.refresh(): Next gives navigations
  // priority in its action queue, so a history pop discards a pending refresh
  // and its result is never applied. Two attempts to fix that by re-ordering
  // shipped green and stayed broken on production (CORE §3).
  const loadBoard = useCallback(async () => {
    setBoardLoading(true);
    try {
      const res = await fetch(`/api/ci/board?face=billing&date=${dateParam}`);
      if (!res.ok) return;
      setBoard((await res.json()) as CiBillingBoard);
    } catch {
      // Silent: the marker will try again in 15s, and a toast on every dropped
      // poll on depot wifi would be noise the operator cannot act on.
    } finally {
      setBoardLoading(false);
    }
  }, [dateParam]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  // ── Detail fetch ──────────────────────────────────────────────────────────
  const loadDetail = useCallback(async (ciId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/ci/${ciId}`);
      if (!res.ok) {
        setDetail(null);
        return;
      }
      setDetail((await res.json()) as CiDetail);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // ── Live sync ─────────────────────────────────────────────────────────────
  // 🔴 The marker's WHERE comes from the SAME buildCiBillingWhere the board
  // renders with (app/api/ci/marker/route.ts imports it). There is no second
  // predicate here and none may be added: a marker watching a narrower set than
  // the board silently misses updates on the desk.
  usePickingMarker({
    scope: "openPending",
    url: `/api/ci/marker?date=${dateParam}`,
    onChange: () => {
      void loadBoard();
      // The open CI may be the one that changed — a supervisor cannot edit a
      // submitted CI, but another billing tab can close it.
      if (selectedId !== null) void loadDetail(selectedId);
    },
    paused: formActive,
  });

  // ── Close ─────────────────────────────────────────────────────────────────
  const onClosed = useCallback(() => {
    // Both, in order: the rail so the card moves from Pending down to Closed in
    // front of him, and the pane so it re-renders read-only.
    void loadBoard();
    if (selectedId !== null) void loadDetail(selectedId);
  }, [loadBoard, selectedId, loadDetail]);

  // ── Search — client-side over the loaded rail ─────────────────────────────
  // A view filter, not a query: the rail is already in memory and the operator
  // is narrowing what he can see, not asking the server a new question.
  const q = search.trim().toLowerCase();
  const filterRows = useCallback(
    (rows: CiBillingBoard["pending"]) =>
      q === ""
        ? rows
        : rows.filter(
            (r) =>
              r.ciNumber.toLowerCase().includes(q) ||
              r.customerName.toLowerCase().includes(q) ||
              r.obdNumber.toLowerCase().includes(q),
          ),
    [q],
  );

  const pending = board ? filterRows(board.pending) : [];
  const closed = board ? filterRows(board.closed) : [];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <UniversalHeader
        title="CI"
        searchPlaceholder="Search CI, dealer, invoice"
        searchValue={search}
        onSearchChange={setSearch}
        // Row 2 left — the counts, as PLAIN TEXT. Deliberately not `segments`:
        // see this file's header. Unfiltered totals, so narrowing the search
        // never makes the backlog look smaller than it is.
        leftExtra={
          <div className="flex items-baseline gap-1.5 text-[12.5px]">
            <span className="font-bold tabular-nums text-gray-900">
              {board?.pendingCount ?? 0}
            </span>
            <span className="text-gray-500">pending</span>
            <span className="text-gray-300">·</span>
            <span className="font-bold tabular-nums text-gray-900">
              {board?.closedCount ?? 0}
            </span>
            <span className="text-gray-500">closed</span>
          </div>
        }
        // Row 2 right — the date stepper. CLOSED ONLY (see header).
        currentDate={date}
        onDateChange={setDate}
        showDatePicker
      />

      <div className="flex flex-1 min-h-0">
        <CiRail
          pending={pending}
          closed={closed}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={boardLoading}
          // Names what the CLOSED half is scoped to, so the empty state cannot
          // imply the pending half is date-scoped too. It is not.
          dateLabel={dateLabel}
          searching={q !== ""}
        />
        <CiDetailPane
          detail={detail}
          loading={detailLoading}
          onClosed={onClosed}
          onFormActive={setFormActive}
        />
      </div>
    </div>
  );
}
