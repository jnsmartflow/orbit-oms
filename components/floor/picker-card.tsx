"use client";

// Floor Control — one card per active picker (the By-picker view, 2026-08-11).
//
// PRESENTATIONAL ONLY. The caller (floor-board.tsx) does the grouping and all
// the arithmetic; this file owns exactly two things: the PICKER-level status
// derivation and its colour table — kept in one place for the same reason
// status-pill.tsx owns the four ROW statuses, so the looks can never drift.
//
// ⚠ The four WORK statuses are NOT redefined here. `counts` arrives straight
// from countByStatus() (status-pill.tsx) and the bar is the real <ProgressBar />
// every slot band and route row already renders. What this file adds is a
// FIFTH, person-level reading layered on top of those counts: is this picker
// free, holding work, holding it too long, or waiting on someone to check?

import { ProgressBar } from "./progress-bar";
import type { StatusCounts } from "./status-pill";

// Busy tiers in MINUTES, measured on the oldest bill the picker is still
// holding (pick_assignments.assignedAt). Same thresholds the picking
// supervisor board uses for its elapsed pill — grey <30m / amber 30m+ /
// red 60m+ (CLAUDE_PICKING §5.2) — so one number means one thing on both
// screens. Deliberately NOT ageDays: that is day-granular and anchored on
// dispatchTargetDate, i.e. "how overdue is the bill", not "how long has this
// person had it". A 4-minute-old assignment on a 2-day-late OBD is ageDays 2.
const AMBER_MINUTES = 30;
const RED_MINUTES = 60;

export type PickerCardStatus = "free" | "busy" | "busyWarn" | "busyLate" | "checking";

// Left accent + chip, per status. Nothing else on the card is coloured.
const STATUS_META: Record<PickerCardStatus, { accent: string; chip: string }> = {
  free: { accent: "border-l-green-600", chip: "bg-green-50 text-green-700 border-green-200" },
  busy: { accent: "border-l-gray-400", chip: "bg-gray-50 text-gray-500 border-gray-200" },
  busyWarn: { accent: "border-l-amber-500", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  busyLate: { accent: "border-l-red-600", chip: "bg-red-50 text-red-600 border-red-200" },
  checking: { accent: "border-l-purple-500", chip: "bg-purple-50 text-purple-700 border-purple-200" },
};

/**
 * Which of the five looks this picker wears.
 *
 * Order matters and is not arbitrary: material still IN HIS HANDS outranks
 * everything, because that is the only state where the clock is running on
 * him. "Checking" means he has handed everything back and is waiting on a
 * supervisor — his queue is empty even though his bills are not closed. A
 * picker whose rows are all `done` (pick_checked) is Free, which is correct:
 * that work is finished, not pending.
 *
 * Exported so the grouping side can order or count by status later without
 * re-deriving the rule.
 */
export function pickerCardStatus(counts: StatusCounts, oldestMinutes: number | null): PickerCardStatus {
  if (counts.withPicker > 0) {
    // A withPicker row with no assignedAt (shouldn't happen — the row only
    // exists because an assignment does) degrades to the calmest busy tier
    // rather than inventing an alarming duration.
    const mins = oldestMinutes ?? 0;
    if (mins >= RED_MINUTES) return "busyLate";
    if (mins >= AMBER_MINUTES) return "busyWarn";
    return "busy";
  }
  if (counts.needsCheck > 0) return "checking";
  return "free";
}

// Two-char elapsed — 16m / 17h / 2d. Same idiom as floor-table.tsx's
// shortElapsed (design §7.7); kept private here rather than exported from that
// live component, since this one takes minutes already computed by the caller
// off the shared render clock instead of doing its own Date math.
function elapsedLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hrs = Math.floor(minutes / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function PickerCard({
  name,
  counts,
  litres,
  articles,
  routes,
  oldestMinutes,
  onClick,
}: {
  name: string;
  counts: StatusCounts;
  litres: number;
  /** Summed totalArticle across this picker's rows; null = nothing known. */
  articles: number | null;
  /** Distinct routes among this picker's rows, already de-duped and sorted. */
  routes: string[];
  /** Minutes since the OLDEST still-with-picker assignment; null when none. */
  oldestMinutes: number | null;
  /** Drill into this picker — opens the assign context (floor-page owns it). */
  onClick?: () => void;
}) {
  const status = pickerCardStatus(counts, oldestMinutes);
  const meta = STATUS_META[status];

  const chipLabel =
    status === "free"
      ? "Free"
      : status === "checking"
        ? "Checking"
        : oldestMinutes === null
          ? "Picking"
          : `Picking · ${elapsedLabel(oldestMinutes)}`;

  const routeLine =
    routes.length === 0
      ? "Nothing on him right now"
      : routes.length === 1
        ? `On ${routes[0]}`
        : `On ${routes[0]} +${routes.length - 1} more`;

  return (
    // A <button>, not a div+onClick: the whole card is one target and it has to
    // be keyboard-reachable. A FREE picker's card is deliberately still
    // clickable — he is exactly who the operator wants to hand work to.
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border border-l-4 border-gray-200 bg-white px-3.5 py-3 text-left transition-colors hover:border-gray-300 hover:bg-[#fafafa] ${meta.accent}`}
    >
      {/* Identity line. font-semibold (600) is the heaviest weight anywhere on
          this card — CLAUDE_UI §60's card rule; no font-bold. */}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">{name}</span>
        <span className={`shrink-0 rounded-[4px] border px-2 py-[2px] text-[10px] font-semibold ${meta.chip}`}>
          {chipLabel}
        </span>
      </div>

      {/* The real shared bar — same four segments, same colours, same count
          basis as every slot band and route row on this screen. */}
      <ProgressBar counts={counts} className="mt-2.5" />

      {/* Metrics. "Articles" not "Drums": totalArticle folds drums, bags,
          cartons, loose tins and pieces into one count (lib/article-tag.ts). */}
      <div className="mt-2 flex items-center gap-3 text-[10.5px] text-gray-400">
        <span>
          <span className="font-semibold tabular-nums text-gray-700">{counts.total}</span>{" "}
          {counts.total === 1 ? "pick" : "picks"}
        </span>
        <span>
          <span className="font-semibold tabular-nums text-gray-700">{litres.toLocaleString("en-US")}</span> L
        </span>
        <span>
          <span className="font-semibold tabular-nums text-gray-700">
            {articles === null ? "—" : articles.toLocaleString("en-US")}
          </span>{" "}
          Articles
        </span>
      </div>

      <div className="mt-1.5 truncate text-[10.5px] text-gray-400">{routeLine}</div>
    </button>
  );
}
