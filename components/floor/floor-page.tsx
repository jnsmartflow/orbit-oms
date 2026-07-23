"use client";

// Step 1 — Floor Control composition root. INERT SHELL ONLY: no data, no
// fetching, no wired board state or handlers. Proves the door (gated to admin +
// operations via app/(floor)/floor/layout.tsx) and the two-pane frame.
// Later steps mount real panes into this file. Layout/copy authority:
// docs/mockups/floor-control/01-board.html + design doc §3/§5/§6.
//
// HEADER: hand-rolled here, deliberately NOT <UniversalHeader/> — a Smart-Flow-
// approved divergence from CLAUDE_UI §6 (universal header on all boards). Floor
// Control's header carries different content (Row 1 is "Floor Control" + a plain
// date/time, nothing else; the live dot lives on the floor bar in a later step,
// not here). The exception is logged for the next CLAUDE_UI consolidation cycle;
// do not edit CLAUDE_UI in this session.

import { Search, Filter } from "lucide-react";
import { FloorSkeleton } from "@/components/floor/floor-skeleton";

// Delivery-type scope — "the whole desk", not a tab (design §5.1). White-pill
// active chips (mockup .scope) — the ONE teal element stays the active slot tab
// in the Floor pane (CLAUDE_UI §6). Inert this step.
const SCOPES = ["All", "Local", "Upcountry", "IGT"] as const;

// Top tabs — dark active (navigation, NOT teal — same convention as the Mail
// Orders view toggle, CLAUDE_UI §21). Inert placeholders this step.
const TABS = ["Floor", "On hold", "Cancelled"] as const;

export function FloorPage() {
  // Row 1 date + time, far right (design §5). Computed at render; no ticking
  // clock widget and no wired state this step. suppressHydrationWarning covers
  // a minute-rollover mismatch between SSR and hydration.
  const now = new Date();
  const dateStr = now
    .toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      timeZone: "Asia/Kolkata",
    })
    .replace(",", "");
  const timeStr = now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* ── Row 1 — title + date/time. Nothing else (design §5). ─────────── */}
      <div className="flex h-11 items-center gap-2.5 border-b border-[#f0f0f0] px-4">
        <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-gray-900">
          Floor Control
        </span>
        <span
          suppressHydrationWarning
          className="ml-auto text-[11px] text-gray-400"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {dateStr} &middot; {timeStr}
        </span>
      </div>

      {/* ── Row 2 — scope chips left; search + filter right (inert). ─────── */}
      <div className="flex h-[46px] items-center gap-3 border-b border-gray-200 bg-[#fcfcfd] px-4">
        <div className="inline-flex gap-[2px] rounded-[7px] bg-gray-100 p-[2px]">
          {SCOPES.map((s) => (
            <span
              key={s}
              className={`rounded-[5px] px-3 py-[5px] text-[11px] ${
                s === "All"
                  ? "bg-white font-semibold text-gray-900 shadow-sm"
                  : "text-gray-500"
              }`}
            >
              {s}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Search — inert placeholder (real box arrives in a later step). */}
          <div className="flex h-[30px] w-[260px] items-center gap-[7px] rounded-[7px] border border-gray-200 bg-white px-[9px] text-[11.5px] text-gray-400">
            <Search size={13} className="flex-shrink-0 text-gray-400" />
            <span>Search name, or paste numbers</span>
          </div>
          {/* Filter — inert placeholder. */}
          <button
            type="button"
            className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-gray-200 bg-white px-[11px] text-[11.5px] text-gray-500"
          >
            <Filter size={13} />
            Filter
          </button>
        </div>
      </div>

      {/* ── Body — left rail (344px) + right main (design §3 two-pane). ──── */}
      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: "344px 1fr" }}
      >
        {/* Left rail — decisions. */}
        <div className="flex min-h-0 flex-col border-r border-gray-200 bg-[#fbfbfc]">
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-3.5 py-2.5">
            <span className="text-[11.5px] font-bold text-gray-900">
              Needs your decision
            </span>
            <span className="ml-auto text-[10px] text-gray-400">oldest first</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FloorSkeleton variant="rail" />
          </div>
        </div>

        {/* Right main — floor / hold / cancelled. */}
        <div className="flex min-h-0 flex-col overflow-hidden">
          {/* Top tabs (inert this step). */}
          <div className="flex items-center gap-[18px] border-b border-gray-200 bg-white px-3.5">
            {TABS.map((t, i) => (
              <span
                key={t}
                className={`border-b-2 py-3 text-[12px] ${
                  i === 0
                    ? "border-gray-900 font-bold text-gray-900"
                    : "border-transparent text-gray-500"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FloorSkeleton variant="floor" />
          </div>
        </div>
      </div>
    </div>
  );
}
