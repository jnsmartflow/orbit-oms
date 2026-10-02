"use client";

// Tint Manager — the tab bar ABOVE the table pane (2026-10-01, tabs build step 5
// — plan §A, mockup docs/mockups/tint-manager/tint-manager-tabs-mockup.html).
// Tinting · TI · Hold · CI · Pick delete. The "Needs assignment" rail stays on
// the left whichever tab is open: assigning is the live job, the tabs are where
// everything else about a tint bill lives.
//
// The pill is FLOOR'S, copied — components/floor/floor-page.tsx tabPill():
// active = dark underline + bold ink, count badge dark on the active tab and
// grey otherwise. Copied rather than imported because Floor owns it as a local
// function (CLAUDE_FLOOR §1); if Floor's tab look changes, re-copy it here. The
// mockup draws the same pill.
//
// Visibility follows the ticks (TintManagerAccessProvider, plan §B): Hold needs
// tint_hold canView, CI needs tint_ci or tint_cancel canView, Pick delete needs
// tint_pick_delete canView. A tab without its tick is never drawn. Tinting and
// TI need nothing beyond the screen itself.
//
// Base (2026-10-01, Base tab 4B) is the LAST tab: every non-tint SMU 74/77 bill
// Floor's live board shows (GET /api/tint/manager/base). It needs no tick of its
// own (owner §I-4) — the screen's canView, which the page already requires.
//
// Counts: Tinting and TI only for now. Hold / CI / Pick delete get theirs in the
// steps that build their bodies (7, 8) — no number is better than a wrong one.

import { useTintManagerAccess } from "./tint-manager-access-provider";

export type BoardTab = "tinting" | "ti" | "hold" | "ci" | "pick" | "base";

export function BoardTabs({
  active,
  onChange,
  counts,
}: {
  active:   BoardTab;
  onChange: (tab: BoardTab) => void;
  /** A tab missing from this map shows no badge. */
  counts:   Partial<Record<BoardTab, number>>;
}) {
  const access = useTintManagerAccess();
  const tabs: { key: BoardTab; label: string; show: boolean }[] = [
    { key: "tinting", label: "Tinting",     show: true },
    { key: "ti",      label: "TI",          show: true },
    { key: "hold",    label: "Hold",        show: access.canViewHoldTab },
    { key: "ci",      label: "CI",          show: access.canViewCiTab },
    { key: "pick",    label: "Pick delete", show: access.canViewPickDelete },
    { key: "base",    label: "Base",        show: true },
  ];

  return (
    <div className="flex items-end gap-[18px] px-3.5 bg-white border-b border-gray-200 flex-shrink-0">
      {tabs.filter((t) => t.show).map((t) => {
        const on = active === t.key;
        const count = counts[t.key];
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-1.5 border-b-2 py-3 text-[12px] ${
              on ? "border-gray-900 font-bold text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}
          >
            {t.label}
            {count !== undefined && (
              <span className={`rounded px-1.5 py-px text-[10px] font-bold ${on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500"}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The body of a tab whose content lands in a later build step. */
export function BoardTabComingNext({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-white text-[11.5px] text-gray-400">
      {label} — coming next.
    </div>
  );
}
