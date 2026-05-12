"use client";

import { useEffect } from "react";

// Keyboard help modal — shows the v4 keymap. Triggered by `?` (Shift+/)
// and dismissed by `?` again or Esc. While mounted, the page-level
// keyboard router bails out (helpOpen flag), so this component owns key
// dispatch.

interface KeyboardHelpOverlayProps {
  onClose: () => void;
}

type Row = { keys: string[]; desc: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Customer search (top bar)",
    rows: [
      { keys: ["letters"], desc: "Filter by name" },
      { keys: ["digits"],  desc: "Filter by SAP code" },
      { keys: ["↓", "↑"],  desc: "Move highlight" },
      { keys: ["Enter"],   desc: "Select customer" },
      { keys: ["Esc"],     desc: "Clear input" },
    ],
  },
  {
    title: "Page (no input / cell focused)",
    rows: [
      { keys: ["1", "…", "9"], desc: "Open speed dial tile" },
      { keys: ["/"],           desc: "Focus search bar" },
      { keys: ["?"],           desc: "Toggle this help" },
      { keys: ["Esc"],         desc: "Close active panel" },
    ],
  },
  {
    title: "Search bar (empty)",
    rows: [
      { keys: ["letters", "digits"], desc: "Start typing query" },
      { keys: ["Tab"],               desc: "Focus next page element (browser default)" },
      { keys: ["Esc"],               desc: "Blur search (focus to body, then 1-9 fires speed dial)" },
    ],
  },
  {
    title: "Search bar (with query)",
    rows: [
      { keys: ["letters", "digits"], desc: "Filter query" },
      { keys: ["↓", "↑"],            desc: "Navigate results" },
      { keys: ["Tab", "Shift+Tab"],  desc: "Navigate results (alternate)" },
      { keys: ["Enter"],             desc: "Select highlighted result" },
      { keys: ["Esc"],               desc: "Clear query (focus stays in search bar)" },
    ],
  },
  {
    title: "Section mini-dial (e.g. WOODCARE)",
    rows: [
      { keys: ["click"],              desc: "Pick a family from the mini-dial" },
      { keys: ["1", "…", "9"],        desc: "Still opens the top-level speed-dial tile at that position" },
      { keys: ["PageDown", "PageUp"], desc: "After a family opens, switch sub-product tabs from inside a cell" },
    ],
  },
  {
    title: "Variant cell (focused)",
    rows: [
      { keys: ["0", "…", "9"],      desc: "Type qty (units)" },
      { keys: ["←", "→", "↑", "↓"], desc: "Navigate cells (skips NA)" },
      { keys: ["Tab", "Shift+Tab"], desc: "Next / previous cell" },
      { keys: ["PageDown", "PageUp"], desc: "Next / previous sub-product tab (no need to leave the grid)" },
      { keys: ["Enter"],            desc: "Move down one row, same pack" },
      { keys: ["+", "="],           desc: "Add one box (12 / 6 / 4 / 1 units, per pack)" },
      { keys: ["−", "_"],           desc: "Subtract one box (floor 0)" },
      { keys: ["Backspace"],        desc: "Clear cell" },
      { keys: ["Esc"],              desc: "Back to page body (then 1-9 for speed dial · / for search)" },
    ],
  },
  {
    title: "Send confirm overlay",
    rows: [
      { keys: ["Enter", "/"], desc: "Submit — opens mailto in default mail client" },
      { keys: ["Esc"],        desc: "Cancel" },
    ],
  },
];

export default function KeyboardHelpOverlay({ onClose }: KeyboardHelpOverlayProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "?" || e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-full max-h-[82vh] overflow-y-auto bg-white rounded-[12px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center">
          <div>
            <div className="text-[14px] font-semibold text-gray-900">Keyboard shortcuts</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Press <span className="font-mono bg-gray-100 border border-gray-200 rounded px-1.5">?</span> any time to toggle.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-gray-700 text-[20px] leading-none px-2"
            aria-label="Close help"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-[10px] uppercase tracking-[0.08em] text-gray-400 font-medium mb-2">
                {group.title}
              </div>
              <div className="space-y-1.5">
                {group.rows.map((row, i) => (
                  <div key={i} className="flex items-start gap-3 text-[12px]">
                    <div className="flex flex-wrap gap-1 shrink-0 min-w-[140px]">
                      {row.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="font-mono text-[11px] bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5 text-gray-700"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                    <div className="text-gray-600 leading-relaxed">{row.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
