"use client";

import { useCallback, useEffect, useState } from "react";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { CiResultCard } from "./result-card";
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

      {/* px-4 = the mockup's 16px `.body` gutter, matching the New tab. The two
          tabs are one screen; a 4px step between them shows when he switches. */}
      <div className="px-4 pt-3" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
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
 * Frame 9's card. The chrome, the 22px/750 dealer name and the `.rMeta` shape
 * all come from the SHARED components/ci/result-card.tsx, which the New tab's
 * search result uses too — the mockup draws them as one object and they had
 * already drifted apart (this face stayed at a 13.5px name through step 7c).
 * Only the three values differ, and they are all this function decides.
 *
 * ⚠ NO onClick — so it renders a <div>, not a <button>. Read-only means no tap
 * affordance at all: a pressable card that does nothing is worse than a flat
 * one, because it invites the tap and then ignores it. Making these open a CI
 * is a product decision (step 7e), not a styling one.
 */
function CiCard({ row }: { row: CiBoardRow }): React.JSX.Element {
  const done = row.status === "closed";
  return (
    <CiResultCard
      identifier={row.ciNumber}
      // The status WORD, never a colour-only signal — it says the same thing to
      // a reader who cannot tell amber from green. Tones are the mockup's:
      // `.chip.amber` while billing still holds it, `.chip.green` once closed.
      chipLabel={done ? "Done" : "With billing"}
      chipTone={done ? "green" : "amber"}
      name={row.customerName}
      leading={
        row.returnType === "full"
          ? "Full bill"
          : `Part · ${row.lineCount} line${row.lineCount === 1 ? "" : "s"}`
      }
      litres={row.totalLitres}
    />
  );
}
