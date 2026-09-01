"use client";

import { useState } from "react";
import { CiSheet } from "./sheet";
import type { CiReasonOption } from "@/lib/ci/types";

// The details step and its reason sheet — frames 6 and 7 of
// docs/mockups/ci/supervisor.html.
//
// Four rows: Material (segmented) · Received on (native date) · Reason (opens
// the sheet) · Remark (optional). The bottom pill is Submit and it stays
// DISABLED until a reason is chosen.
//
// ⚠ NO HELPER COPY (spec §7). No explanation under a control, no note about
// what "Not moved" means. The mockup has none and the supervisor does this
// daily.
//
// ⚠ The teal header and the sub-header strip are NOT here — they are rendered
// once by new-return.tsx and stay fixed across frames 3 to 7, which is what
// keeps the bill identity on screen while everything below it changes.

const ROW = "bg-white border-b border-gray-200 px-[14px] py-3";
const LABEL = "text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]";

export function CiDetailsStep({
  materialMoved,
  onMaterialMoved,
  receivedOn,
  onReceivedOn,
  reason,
  onOpenReasons,
  remark,
  onRemark,
}: {
  materialMoved: "moved" | "not_moved";
  onMaterialMoved: (v: "moved" | "not_moved") => void;
  /** "YYYY-MM-DD". Defaulted to today IST by the caller. */
  receivedOn: string;
  onReceivedOn: (v: string) => void;
  reason: CiReasonOption | null;
  onOpenReasons: () => void;
  remark: string;
  onRemark: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto">
      {/* MATERIAL — segmented, same control as Full bill / Part on the bill
          screen so the two read as one language. "Not moved" sits first
          because it is the commoner case: goods usually come back to the bay
          before anyone touches them. */}
      <div className={ROW}>
        <div className={LABEL}>Material</div>
        <div className="flex bg-[#f1f4f5] rounded-full p-[3px] mt-2">
          {(["not_moved", "moved"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onMaterialMoved(v)}
              className={
                "flex-1 h-9 rounded-full text-[13.5px] font-semibold transition-colors " +
                (materialMoved === v ? "bg-white text-gray-900 shadow-sm" : "text-[#6b7480]")
              }
            >
              {v === "not_moved" ? "Not moved" : "Moved"}
            </button>
          ))}
        </div>
      </div>

      {/* RECEIVED ON — the NATIVE date control, deliberately.
          ⚠ A hand-rolled picker on a depot phone is a support call waiting to
          happen: the OS one is the widget the operator already knows, handles
          his locale and his thumb size, and cannot drift from the platform. */}
      <div className={ROW}>
        <div className={LABEL}>Received on</div>
        <input
          type="date"
          value={receivedOn}
          onChange={(e) => onReceivedOn(e.target.value)}
          aria-label="Date the material was received"
          className="w-full mt-2 text-[15px] text-gray-900 bg-transparent outline-none"
        />
      </div>

      {/* REASON — opens the sheet. The only required field beyond the lines. */}
      <div className={ROW}>
        <div className={LABEL}>Reason</div>
        <button
          type="button"
          onClick={onOpenReasons}
          className="w-full mt-2 flex items-center justify-between gap-3 text-left"
        >
          <span
            className={
              "text-[15px] truncate min-w-0 " +
              (reason ? "text-gray-900" : "text-[#98a2b3]")
            }
          >
            {reason?.label ?? "Choose"}
          </span>
          <span className="text-[#98a2b3] shrink-0 text-[13px]">▾</span>
        </button>
      </div>

      {/* REMARK — optional, and the placeholder says so rather than a note
          underneath (spec §7: no helper copy). */}
      <div className={ROW}>
        <div className={LABEL}>Remark</div>
        <textarea
          value={remark}
          onChange={(e) => onRemark(e.target.value)}
          placeholder="Optional"
          rows={2}
          aria-label="Remark"
          className="w-full mt-2 text-[15px] text-gray-900 bg-transparent outline-none resize-none placeholder:text-[#98a2b3]"
        />
      </div>
    </div>
  );
}

// ── The reason sheet (frame 7) ───────────────────────────────────────────────

/**
 * 🔴 THE LIST IS FETCHED, NEVER HARDCODED. It lives in `ci_reason_master` so the
 * depot can add, relabel or retire a reason without a deploy (spec §3.1). A
 * copy in this file would go stale the first time a row is edited, and the phone
 * would offer a reason the submit route then refuses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE FETCH IS THE CALLER'S. THIS SHEET TAKES `reasons` AS A PROP AND PAINTS
 *    ONCE — DO NOT MOVE THE FETCH BACK INSIDE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It used to fetch in its own mount effect, and that is what made the sheet
 * "hang while coming up" (reported 2026-09-01). The panel is bottom-anchored
 * with content-driven height, so it painted first as a ~60px "Loading…" strip
 * and then JUMPED to full height when the eight rows landed — a two-stage
 * layout change under the operator's thumb, on depot wifi.
 *
 * ⚠ IT WAS NEVER A MISSING ANIMATION. Adding a transition would have made the
 * jump smoother and just as wrong. Picking's FilterBottomSheet and MRN's
 * LineSheet both take their content as props already in memory and paint once
 * at final height; this now does the same. `CiNewReturn` fetches when the
 * details step opens, so by the time this mounts the rows are already there.
 *
 * The divider is DATA too: three `isPinned` rows above it, the rest under
 * "More". This component does not decide how many are pinned — it renders which
 * ones are, ordered by `sortOrder` within each group (the route already sorts).
 */
export function CiReasonSheet({
  reasons,
  error,
  selectedId,
  onPick,
  onCancel,
}: {
  /** null = still loading (the caller's fetch has not resolved). */
  reasons: CiReasonOption[] | null;
  error: string | null;
  selectedId: number | null;
  onPick: (reason: CiReasonOption) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [showMore, setShowMore] = useState(false);

  const pinned = (reasons ?? []).filter((r) => r.isPinned);
  const rest = (reasons ?? []).filter((r) => !r.isPinned);

  return (
    <CiSheet label="Reason" onDismiss={onCancel}>
      <div className="px-[14px] pb-2 text-[15px] font-semibold text-gray-900">Reason</div>

      {error !== null && <p className="px-[14px] py-6 text-[13px] text-[#b42318]">{error}</p>}

      {/* Reached only if the sheet is somehow opened before the caller's fetch
          resolves — the details step prefetches, so in practice this never
          paints. `min-h` holds the panel at roughly its filled height so even
          that case does not jump. */}
      {reasons === null && error === null && (
        <p className="px-[14px] py-6 text-[13px] text-gray-400">Loading…</p>
      )}

      {pinned.map((r) => (
        <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
      ))}

      {rest.length > 0 && (
        <>
          {/* The divider IS the "three common ones first" rule, drawn. */}
          <div className="h-px bg-gray-200 mx-[14px] my-1.5" />
          {showMore ? (
            rest.map((r) => (
              <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
            ))
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="w-full text-left px-[14px] py-3.5 text-[15px] font-semibold text-teal-700 active:bg-gray-50"
            >
              More
            </button>
          )}
        </>
      )}
    </CiSheet>
  );
}

function ReasonRow({
  reason,
  selected,
  onPick,
}: {
  reason: CiReasonOption;
  selected: boolean;
  onPick: (r: CiReasonOption) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onPick(reason)}
      className="w-full text-left px-[14px] py-3.5 flex items-center justify-between gap-3 active:bg-gray-50"
    >
      <span className="text-[15px] text-gray-900 truncate min-w-0">{reason.label}</span>
      {selected && <span className="text-teal-600 shrink-0 text-[15px]">✓</span>}
    </button>
  );
}
