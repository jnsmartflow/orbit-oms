"use client";

import type { CiBoardRow } from "@/lib/ci/types";

// Billing's left rail — frames 1-4 of docs/mockups/ci/billing.html.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE RAIL, TWO HEADINGS. THERE ARE NO PENDING/CLOSED TABS.
// ═══════════════════════════════════════════════════════════════════════════
//
// Both sections live in the SAME scrolling list, the way Mail Orders keeps
// pending and done together. Closing a CI moves its card from the top section
// down into the bottom one IN FRONT OF THE OPERATOR — that visible movement is
// the confirmation that the close landed, and it is the whole reason the tabs
// were dropped. A second tab would make the card vanish instead, which reads as
// "did that work?".
//
// 🔴 RAIL CARDS CARRY THE CI NUMBER AND THE CUSTOMER NAME. No return type, no
// litres, no value — in either section. The rail is for FINDING the CI;
// everything about it lives in the pane. (The time rides along because all four
// mockup frames draw it and it is how he tells two of a dealer's CIs apart —
// it is a timestamp, not a fact about the return.)
//
// 🔴 CLOSED CARDS ARE TOLD APART BY WEIGHT, NOT BY EXTRA DATA — grey ground,
// lighter name, under their own heading. No "Done" pill, no closed-at caption:
// the heading above them already says it once.
//
// ⚠ THE PENDING HEADING DISAPPEARS WHEN THERE IS NOTHING PENDING (mockup frame
// 4) rather than rendering an empty section, and the closed list stays exactly
// where it was. An "All caught up" line takes its place — that is a real state
// worth naming, not an empty container.

export function CiRail({
  pending,
  closed,
  selectedId,
  onSelect,
  loading,
  dateLabel,
  searching,
}: {
  pending: CiBoardRow[];
  closed: CiBoardRow[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  loading: boolean;
  /** The day the stepper is on, e.g. "31 Aug" — names what the CLOSED half is
   *  scoped to, so the empty state cannot imply the pending half is too. */
  dateLabel: string;
  /** True when a search term is narrowing the rail, so an empty result is
   *  reported as a search miss rather than as an empty backlog. */
  searching: boolean;
}): React.JSX.Element {
  const empty = pending.length === 0 && closed.length === 0;

  return (
    <div className="w-[300px] shrink-0 border-r border-gray-200 overflow-y-auto bg-[#fafbfb]">
      {loading && empty && (
        <p className="text-[12.5px] text-gray-400 text-center py-10">Loading…</p>
      )}

      {/* ⚠ THIS COPY USED TO READ "No CIs for this day." — WRONG, AND
          DANGEROUSLY SO. It described a rail that is entirely date-scoped, and
          this one is not: pending is the WHOLE BACKLOG and only closed takes the
          date (lib/ci/queries.ts buildCiBillingWhere). A billing operator
          reading "for this day" over an empty rail would reasonably conclude
          older pending work was hidden behind the stepper and go looking for it
          — or, worse, assume there was none. The billing Picking tab shipped
          exactly that misreading as a real bug.

          Three DIFFERENT facts, said separately, because they call for
          different actions:
            • a search that matched nothing  → change the search
            • no pending anywhere            → the backlog is genuinely clear
            • nothing closed on THIS day     → step the date */}
      {!loading && empty && (
        <div className="text-center py-10 px-4">
          {searching ? (
            <p className="text-[12.5px] text-gray-400">No CI matches that search.</p>
          ) : (
            <>
              <p className="text-[12.5px] font-semibold text-gray-600">Nothing pending</p>
              <p className="text-[11.5px] text-gray-400 mt-1 leading-snug">
                The backlog is clear, and nothing was closed on {dateLabel}.
              </p>
            </>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <>
          <RailHeading label="Pending" count={pending.length} />
          {pending.map((row) => (
            <CiRailCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}

      {/* ⚠ NOT an empty "Pending" section — the heading is simply absent, and
          this says the true thing instead. Only shown when there IS closed work,
          so it reads as "you finished it" rather than "there is nothing here".
          ⚠ Suppressed while searching: "all caught up" would be a lie about the
          backlog when it is really a statement about the filter. */}
      {!searching && pending.length === 0 && closed.length > 0 && (
        <div className="px-4 py-5 text-center">
          <div className="text-[15px] text-[#0A7C4A]">✓</div>
          <div className="text-[12.5px] font-semibold text-gray-700 mt-1">All caught up</div>
          <div className="text-[11.5px] text-gray-400 mt-0.5 leading-snug">
            {/* No date here on purpose — pending is not date-scoped, so this is
                a statement about the whole backlog. */}
            Nothing is waiting on you.
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <>
          <RailHeading label="Closed" count={closed.length} />
          {closed.map((row) => (
            <CiRailCard
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
}

function RailHeading({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 bg-[#fafbfb] px-3.5 pt-3 pb-1.5 flex items-baseline gap-2">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">
        {label}
      </span>
      <span className="text-[10.5px] font-semibold text-[#b7bfc5] tabular-nums">{count}</span>
    </div>
  );
}

function CiRailCard({
  row,
  selected,
  onSelect,
}: {
  row: CiBoardRow;
  selected: boolean;
  onSelect: (id: number) => void;
}): React.JSX.Element {
  const done = row.status === "closed";
  return (
    <button
      type="button"
      onClick={() => onSelect(row.id)}
      className={
        "w-full text-left px-3.5 py-2.5 border-b border-gray-100 transition-colors " +
        // Selection is the strongest state and wins over the closed treatment —
        // a selected closed card must still read as the one being looked at.
        (selected
          ? "bg-teal-50 border-l-[3px] border-l-teal-600 pl-[11px]"
          : done
            ? "bg-[#f4f6f7] hover:bg-[#eef1f2]"
            : "bg-white hover:bg-gray-50")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={
            "font-mono text-[12.5px] truncate " +
            (done ? "font-semibold text-[#8a929c]" : "font-bold text-gray-900")
          }
        >
          {row.ciNumber}
        </span>
        <span className="text-[11px] text-[#b7bfc5] shrink-0 tabular-nums">
          {formatIstTime(done ? row.closedAt : row.submittedAt)}
        </span>
      </div>
      {/* Weight, not data, is what separates a closed card. */}
      <div
        className={
          "text-[12.5px] truncate mt-0.5 " +
          (done ? "font-normal text-[#8a929c]" : "font-medium text-gray-700")
        }
      >
        {row.customerName}
      </div>
    </button>
  );
}

/** "12:20" in IST. Blank input → em-dash; never a fabricated clock. */
function formatIstTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}
