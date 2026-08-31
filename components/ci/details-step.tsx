"use client";

import { useEffect, useState } from "react";
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
 * The divider is DATA too: three `isPinned` rows above it, the rest under
 * "More". This component does not decide how many are pinned — it renders which
 * ones are, ordered by `sortOrder` within each group (the route already sorts).
 */
export function CiReasonSheet({
  selectedId,
  onPick,
  onCancel,
}: {
  selectedId: number | null;
  onPick: (reason: CiReasonOption) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [reasons, setReasons] = useState<CiReasonOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    let alive = true;
    // A client fetch + setState. NEVER router.refresh() (CORE §3) — a history
    // pop discards it silently and the sheet would show a stale list.
    fetch("/api/ci/reasons")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((j: { reasons: CiReasonOption[] }) => {
        if (alive) setReasons(j.reasons);
      })
      .catch(() => {
        if (alive) setError("Could not load the reasons — check the connection.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const pinned = (reasons ?? []).filter((r) => r.isPinned);
  const rest = (reasons ?? []).filter((r) => !r.isPinned);

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onCancel} aria-hidden="true" />
      <div
        className="fixed left-0 right-0 bottom-0 bg-white rounded-t-[18px] z-[75] max-h-[70vh] overflow-y-auto shadow-[0_-8px_30px_rgba(16,25,29,0.18)]"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
        role="dialog"
        aria-label="Reason"
      >
        <div className="px-[14px] pt-4 pb-2 text-[15px] font-semibold text-gray-900">
          Reason
        </div>

        {error !== null && (
          <p className="px-[14px] py-6 text-[13px] text-[#b42318]">{error}</p>
        )}
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
      </div>
    </>
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
