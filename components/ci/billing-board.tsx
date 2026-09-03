"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { UniversalHeader } from "@/components/universal-header";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";
import { CiRail } from "./ci-rail";
import { CiDetailPane } from "./ci-detail-pane";
import { CiRegisterExport } from "./register-export";
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
// 🔴 THE COUNTS SIT IN ROW-1 `stats`. NOT IN `segments`, AND NO LONGER IN
//    `leftExtra`.
// ═══════════════════════════════════════════════════════════════════════════
//
// NOT `segments`: that renders a SEGMENTED CONTROL — i.e. Pending/Closed tabs —
// and tabs are exactly what this screen removed. Both sections live in one rail
// so that closing a CI moves its card down the list IN FRONT OF the operator; a
// tab would make it vanish instead.
//
// NOT `leftExtra` either, which is where they shipped and which was wrong.
// `stats` is the app's count idiom and every other board uses it — MRN
// (billing-board.tsx:202), Sampling Library, Challan, Shade Master, TI Report,
// the attendance dashboard. It renders them beside the title in Row 1, which is
// where an operator glancing at any other screen in this product already looks.
// `leftExtra` is Row 2's LEFT slot, next to the date stepper — and putting a
// count there implies the count is scoped to the date, which THE PENDING ONE IS
// NOT. Same misreading the rail's empty-state copy had to be fixed for.
//
// ⚠ Row 2 still renders — it carries the date stepper — so `suppressFilterBar`
// must stay unset (UniversalHeader's own warning: suppressing Row 2 hides
// `rightExtra` and `leftExtra` with it).
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
      if (!res.ok) {
        toast.error("Could not load the CI list — it may be out of date.");
        return;
      }
      setBoard((await res.json()) as CiBillingBoard);
    } catch {
      // ⚠ THIS USED TO BE SILENT, and that was wrong in the one direction that
      // matters: a dead rail and an empty rail look identical, so a billing
      // operator whose connection had dropped would read "nothing pending" off
      // a screen that had simply failed to load, and stop working.
      //
      // Worded as "may be out of date" rather than "failed" because the marker
      // retries every 15s and the next poll usually fixes it — what he needs to
      // know is not to trust what is on screen, not that something is broken.
      toast.error("Could not reach the server — this list may be out of date.");
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
        // Row 1 — the counts, beside the title. See this file's header for why
        // here and not `leftExtra` or `segments`. UNFILTERED totals, straight
        // off the payload, so narrowing the search never makes the backlog look
        // smaller than it is and a guessed increment can never drift them.
        stats={[
          { label: "pending", value: board?.pendingCount ?? 0 },
          { label: "closed", value: board?.closedCount ?? 0 },
        ]}
        // Row 2 LEFT — the register download (components/ci/register-export.tsx).
        //
        // ⚠ `leftExtra`, WHICH WAS THE ONE EMPTY SLOT ON THIS HEADER, and the
        // choice is deliberate. Row 2's RIGHT holds the date stepper below, and
        // an export that asks for its own date range must not sit beside the
        // control that drives the rail — the filter and a divider keep the two
        // apart. 🔴 THE STEPPER DOES NOT DRIVE THE EXPORT and is untouched by
        // it: a rail is read by DAY, a register is asked for by MONTH.
        //
        // ⚠ AND `showDownload` STAYS UNWIRED. Row 1's teal Download button
        // fires instantly everywhere it exists (TI Report, its only other
        // caller); making it open a popover here would give one familiar
        // control two meanings. One entry point, and it is the trigger below.
        leftExtra={<CiRegisterExport />}
        // Row 2 right — the date stepper. CLOSED ONLY (see header).
        currentDate={date}
        onDateChange={setDate}
        showDatePicker
      />

      {/* Body — a 344px rail + the working pane, the same two-track grid MRN
          and /floor use. Only the geometry is borrowed; the header above is
          UniversalHeader, not floor's hand-rolled one.

          ═══════════════════════════════════════════════════════════════════
          🔴 `minmax(0, 1fr)`, NEVER PLAIN `1fr`.
          ═══════════════════════════════════════════════════════════════════
          Plain `1fr` is shorthand for `minmax(auto, 1fr)`, and that `auto`
          floor resolves to the grid ITEM's automatic minimum — its
          content-based minimum. In MRN the lines table carries a 1440px
          min-width, so the track inflated to ~1440 and the pane was laid out
          at 1438px inside a window half that wide, then clipped by the
          overflow-hidden on this very element (commit c16e59df). Clipping does
          not shrink layout geometry, which is why the symptom read as content
          cut off at the right edge rather than as a scrollbar — nothing looked
          broken, things were just missing.

          `min-w-0` on CiDetailPane's root is THE OTHER HALF. There are TWO
          floors here — the track's min sizing function and the item's own
          `min-width: auto` — and removing either one alone leaves the other in
          force. Do not "simplify" this back to `1fr`.

          ⚠ CI's lines table is percentage-width (UI §27) and so has no pixel
          floor to propagate TODAY. That is not a reason to drop either guard:
          the floors cost nothing, and the day a wide cell or a min-width lands
          in this pane the failure is silent. */}
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: "344px minmax(0, 1fr)" }}
      >
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
