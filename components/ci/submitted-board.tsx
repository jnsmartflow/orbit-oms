"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { CiBoardRow, CiSupervisorBoard } from "@/lib/ci/types";

// The supervisor's Submitted tab — frame 9 of docs/mockups/ci/supervisor.html.
//
// TWO SECTIONS IN ONE LIST: "With billing" (what billing still holds) then
// "Finished" (what it has closed). One scroll, not two tabs.
//
// 🔴 READ-ONLY. He never edits a CI after submitting — there is no tap target on
// a card, and none may be added without a product decision. Once a return has a
// number, billing is acting on it; a supervisor editing it underneath would
// change a document someone else has already read.
//
// 🔴 NO MARKER, NO POLLING. Billing polls; the supervisor does not (spec §10).
// He is the one CREATING the work, so he has nothing to wait for — the
// asymmetry is deliberate in both CI and MRN (MRN's marker is supervisor-only
// for the mirror-image reason). Do NOT add a poll here "to match" billing.
// This fetches once on mount, and again when the caller bumps `refreshKey`
// after a submit.
//
// 🔴 EVERY READ FILTERS `status <> 'draft'` — in lib/ci/queries.ts's
// buildCiSupervisorWhere, not here. An abandoned draft must never appear in this
// list; if a numberless card ever shows up, that filter is missing.
//
// ⚠ Refresh is a client fetch + setState. NEVER router.refresh(): a history pop
// discards it silently and the board shows stale data. Two attempts to fix that
// by re-ordering shipped green and stayed broken on production (CORE §3).

export function CiSubmittedBoard({
  userInitials,
  refreshKey,
  onCounts,
}: {
  userInitials: string;
  /** Bumped by the caller after a successful submit, to refetch. */
  refreshKey: number;
  /** Reports the real counts UP so the tab badge comes from THIS fetch and is
   *  never a guessed increment. */
  onCounts?: (withBilling: number, finished: number) => void;
}): React.JSX.Element {
  const { openMenu, openYou } = useMobileShell();
  const [board, setBoard] = useState<CiSupervisorBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ci/board?face=supervisor");
      if (!res.ok) {
        setError("Could not load your returns.");
        return;
      }
      const data = (await res.json()) as CiSupervisorBoard;
      setBoard(data);
      setError(null);
      // 🔴 THE COUNT COMES FROM THE PAYLOAD, never from an increment. A guessed
      // "+1" after a submit drifts the moment two phones submit at once, or a
      // submit fails after the optimistic bump.
      onCounts?.(data.withBilling.length, data.finished.length);
    } catch {
      setError("Could not load your returns — check the connection.");
    } finally {
      setLoading(false);
    }
  }, [onCounts]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className="min-h-full bg-[#F4F6F7]">
      <ModuleMobileHeader
        title="CI"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      <div className="px-3 pt-3" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
        {loading && board === null && (
          <p className="text-[13px] text-gray-400 text-center py-10">Loading…</p>
        )}
        {error !== null && (
          <p className="text-[13px] text-[#b42318] text-center py-10">{error}</p>
        )}

        {board !== null && board.withBilling.length === 0 && board.finished.length === 0 && (
          <p className="text-[13px] text-gray-400 text-center py-10">
            Nothing submitted yet.
          </p>
        )}

        {board !== null && board.withBilling.length > 0 && (
          <>
            <SectionHeading>With billing</SectionHeading>
            {board.withBilling.map((row) => (
              <CiCard key={row.id} row={row} />
            ))}
          </>
        )}

        {board !== null && board.finished.length > 0 && (
          <>
            <SectionHeading>Finished</SectionHeading>
            {board.finished.map((row) => (
              <CiCard key={row.id} row={row} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3] px-1 pt-3 pb-2">
      {children}
    </p>
  );
}

/**
 * ⚠ A <div>, NOT a <button>. Read-only means no tap affordance at all — a
 * pressable card that does nothing is worse than a flat one, because it invites
 * the tap and then ignores it.
 */
function CiCard({ row }: { row: CiBoardRow }): React.JSX.Element {
  const done = row.status === "closed";
  return (
    <div
      className="bg-white rounded-[14px] px-3.5 py-3 mb-2"
      style={{ boxShadow: "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[15px] font-bold text-gray-900 truncate">
          {row.ciNumber}
        </span>
        {/* The status word, not a colour-only signal — "With billing" and "Done"
            are what the mockup writes, and they say the same thing to someone
            who cannot distinguish the two greys. */}
        <span
          className={
            "text-[11px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap " +
            (done ? "bg-[#E7F6EE] text-[#0A7C4A]" : "bg-[#f1f4f5] text-[#6b7480]")
          }
        >
          {done ? "Done" : "With billing"}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-1">
        <span className="text-[13.5px] text-gray-700 truncate min-w-0">{row.customerName}</span>
        <span className="text-[11.5px] text-gray-500 shrink-0 tabular-nums">
          {row.returnType === "full"
            ? "Full bill"
            : `Part · ${row.lineCount} line${row.lineCount === 1 ? "" : "s"}`}
          {" · "}
          {row.totalLitres} L
        </span>
      </div>
    </div>
  );
}
