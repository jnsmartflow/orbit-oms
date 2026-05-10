"use client";

import { useEffect } from "react";

// Keyboard help modal — shows the §8 keymap. Triggered by `?` (Shift+/) and
// dismissed by `?` again, Esc, or `*`. While mounted, the page-level
// keyboard router bails out (helpOpen flag), so this component owns key
// dispatch.

interface KeyboardHelpOverlayProps {
  onClose: () => void;
}

type Row = { keys: string[]; desc: string };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: "Customer search",
    rows: [
      { keys: ["letters"],    desc: "Filter by name" },
      { keys: ["digits"],     desc: "Filter by SAP code" },
      { keys: ["↓", "↑"],     desc: "Move highlight" },
      { keys: ["Enter"],      desc: "Select customer · focus jumps to grid" },
      { keys: ["Esc"],        desc: "Clear input" },
    ],
  },
  {
    title: "Category grid (no panel open)",
    rows: [
      { keys: ["1", "2", "…", "9"], desc: "Open Nth top-9 category" },
      { keys: ["letters"],          desc: "Focus search · seed first char" },
      { keys: ["*"],                desc: "Focus search bar" },
      { keys: ["Esc"],              desc: "Close current panel" },
      { keys: ["?"],                desc: "This help" },
    ],
  },
  {
    title: "Product search",
    rows: [
      { keys: ["letters", "digits"], desc: "Filter products" },
      { keys: ["↓", "↑"],            desc: "Move highlight" },
      { keys: ["Enter"],             desc: "Open highlighted product · focus first base-row" },
      { keys: ["Esc", "*"],          desc: "Close search · return to grid" },
    ],
  },
  {
    title: "Variant grid (panel open · cell focused)",
    rows: [
      { keys: ["←", "→", "↑", "↓"], desc: "Move cell (skips NA)" },
      { keys: ["Tab", "Shift+Tab"], desc: "Next / prev cell (DOM order)" },
      { keys: ["Enter"],            desc: "Move down one row" },
      { keys: ["0", "…", "9"],      desc: "Type qty (boxes)" },
      { keys: ["+"],                desc: "Increment by 1 box" },
      { keys: ["−"],                desc: "Decrement by 1 box (floor 0)" },
      { keys: ["Backspace"],        desc: "Clear cell" },
      { keys: ["Esc", "*"],         desc: "Close panel · return to grid" },
    ],
  },
  {
    title: "Send",
    rows: [
      { keys: ["/"],          desc: "Open send-confirm overlay (cart not empty)" },
      { keys: ["Enter", "/"], desc: "Submit · opens mailto in default mail client" },
      { keys: ["Esc", "*"],   desc: "Cancel overlay" },
    ],
  },
];

export default function KeyboardHelpOverlay({ onClose }: KeyboardHelpOverlayProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "?" || e.key === "Escape" || e.key === "*") {
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
