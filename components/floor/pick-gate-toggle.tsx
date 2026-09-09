"use client";

// Floor Control — the picking visibility gate switch (2026-09-09).
//
// Lives in the floor header's Row 1, which is hand-rolled and NOT UniversalHeader
// (FLOOR §10). Writes through POST /api/floor/pick-gate.
//
// ⚠ CONTROLLED, not self-fetching. floor-page.tsx owns `gateOn` because the same
// fact drives three things — this switch, the held-back pills on every row, and
// the Show strip — and a component holding its own copy would be a second state
// that can disagree with the board it is describing. This one renders and writes;
// the page reads and refetches.
//
// 🔴 THE ON STATE IS LOUD ON PURPOSE, AND MUST STAY LOUD. When this switch is on,
// three supervisors on the floor cannot see waiting work that is sitting on this
// operator's screen — the most consequential thing anyone can do from this board,
// and the failure it creates is SILENT on the floor's side (an empty Assign tab
// looks exactly like a quiet morning). A muted icon-with-a-dot would read as a
// display preference and get left on by accident. So: filled amber, white text,
// the state spelled out in words, and the held-back count beside it.
//
// AMBER, not red: the gate is a legitimate working mode, not an error or an
// outage. Not teal — that is reserved for the primary action (CLAUDE_UI §1), and
// this is a mode switch, not a job.
//
// OFF is deliberately quiet: a plain ghost button that reads as one more header
// control, so the screen is otherwise exactly what it has always been.

import { useCallback, useState } from "react";
import { toast } from "sonner";

export function PickGateToggle({
  enabled,
  heldBackCount,
  onChanged,
}: {
  /** null = the state is not known yet (the page's read has not landed, or it
   *  failed). The control renders NOTHING then, deliberately: showing "off" on a
   *  guess would tell the operator the floor can see work it cannot. */
  enabled: boolean | null;
  /**
   * Waiting bills currently held back, counted from the rows the board ALREADY
   * has (isHeldBack, status-pill.tsx). Deliberately not fetched: the picking
   * marker answers the same question for the picking board, and Floor calling it
   * would be a second source that can disagree with the pills on this screen.
   */
  heldBackCount: number;
  /** Fired after a successful flip so the page can update state and refetch. */
  onChanged: (enabled: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);

  const flip = useCallback(async () => {
    if (enabled === null || busy) return;
    const next = !enabled;
    setBusy(true);
    try {
      const res = await fetch("/api/floor/pick-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await res.json().catch(() => ({}))) as { enabled?: boolean; error?: string };
      if (!res.ok) {
        toast.error(body.error ? `Could not change the gate — ${body.error}` : "Could not change the gate.");
        return;
      }
      // Trust the SERVER's answer, never the optimistic one — a switch whose
      // displayed position does not match reality lies about what the floor sees.
      onChanged(typeof body.enabled === "boolean" ? body.enabled : next);
    } catch {
      toast.error("Could not change the gate — check your connection.");
    } finally {
      setBusy(false);
    }
  }, [enabled, busy, onChanged]);

  if (enabled === null) return null;

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy}
        title="Show the floor only the bills you hand over"
        className="inline-flex h-[26px] items-center gap-1.5 rounded-[5px] border border-gray-200 px-2.5 text-[11px] font-medium text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-50"
      >
        <span className="h-[7px] w-[7px] rounded-full bg-gray-300" />
        Desk control off
      </button>
    );
  }

  return (
    <div className="inline-flex h-[26px] items-center gap-2 rounded-[5px] bg-[#b45309] pl-2.5 pr-1 text-[11px] font-semibold text-white">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[7px] w-[7px] rounded-full bg-white" />
        Desk control ON &middot; floor sees only what you show
      </span>
      <span className="rounded-[3px] bg-white/20 px-1.5 py-px text-[10.5px] font-bold tabular-nums">
        {heldBackCount} not shown
      </span>
      <button
        type="button"
        onClick={() => void flip()}
        disabled={busy}
        className="rounded-[4px] px-1.5 py-px text-[10.5px] font-bold text-white/90 hover:bg-white/20 hover:text-white disabled:opacity-50"
      >
        Turn off
      </button>
    </div>
  );
}
