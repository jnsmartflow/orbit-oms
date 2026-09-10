"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { FAINT, FOCUS, FOCUS_RING, INK, MUTED, RULE, SURFACE } from "./v2-data";

// The ONE search field in v2. Extracted from product-search.tsx when the two
// dealer pickers turned out to be carrying a second, different one.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.
//
// 🔴 THERE WERE TWO, AND THEY DID NOT MATCH. The board's was 52px tall on a
// WHITE ground with a 14px radius, an 18px stroked icon and a violet focus
// ring. The pickers' was a grey FILL block with a 12px radius, a 16px icon at a
// heavier stroke and no focus state at all — so the same control looked like
// two different controls depending on which screen you were standing on, and
// only one of them told you it had focus.
//
// THE BOARD'S IS THE ONE THAT SURVIVED, verbatim. It is the field a salesman
// uses forty times a day and the one that had been tuned; the pickers adopt it
// unchanged. Every value below was copied from that implementation, not
// re-derived — if this ever needs to change, change it here and all three move
// together, which is the entire reason this file exists.
//
// ⚠ WHAT IS NOT SHARED: the placeholder and the onChange. Those are the only
// things that differ between a product search, a dealer search and a ship-to
// search, and they stay at the call sites as props.

/**
 * @param placeholder the ONE thing each caller must supply for itself.
 * @param autoFocus off by default, and the pickers deliberately leave it off —
 *   see the note at their call site about the keyboard shrinking the viewport
 *   before the salesman has even looked at the screen.
 */
export default function V2SearchInput({
  value, onChange, placeholder, autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-3.5"
      style={{
        height: 52,
        borderRadius: 14,
        background: SURFACE,
        border: `1px solid ${focused ? FOCUS : RULE}`,
        boxShadow: focused
          ? `0 0 0 3px ${FOCUS_RING}`
          : "0 1px 2px rgba(27,24,38,.04)",
      }}
    >
      {/* Properly stroked, not a glyph: 18px at 1.8 so it reads as drawn at the
          same weight as the text beside it. */}
      <Search className="shrink-0" strokeWidth={1.8}
              style={{ width: 18, height: 18, color: MUTED }} />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        // 🔴 16px IS LOAD-BEARING, NOT A STYLE CHOICE. iOS Safari zooms the
        // whole page when a focused input's font-size is below 16px, and it
        // does not zoom back out. CLAUDE_UI.md §55 records the same trap on
        // /po, where the qty input was pushed to 16px for exactly this reason.
        // Do not "tidy" this down to match the 15px placeholder beside it —
        // the PLACEHOLDER may be 15, the input may not.
        className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[15px] placeholder:text-[#9C99AC]"
        style={{ color: INK }}
      />
      {value.length > 0 && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: FAINT }}
        >
          <X className="h-3 w-3 text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
