"use client";

import { useEffect, useRef, useState } from "react";
import { NO_BILL_SWIPE_ATTR } from "./use-bill-pager";
import { parseArticleCountInput } from "@/lib/picking/article-count";

// ── Article no. popup (2026-10-06, Schema v27.58) ──────────────────────────
// The supervisor's Approve now asks for the article no. — the number he has
// written on the drum. Mockup docs/mockups/picking/approve-article-count.html
// (screens 2, 2b, 4); decisions docs/prompts/drafts/web-update-2026-10-06-approve-article-no.md.
//
// ⚠ ITS OWN COMPONENT, NOT FindingPopup. It copies finding-recorder.tsx's
// PATTERN (CLAUDE_PICKING.md §11.4) — always mounted, opacity/scale-toggled,
// fixed overlay at z-[65], NO_BILL_SWIPE_ATTR on itself — and nothing else.
// FindingPopup is typed on a line and must never learn about Approve.
//
// ⚠ IT KNOWS NOTHING ABOUT HISTORY. It never pushes or pops an entry; the
// board's popstate authority owns that (the `countOpen` branch). On an error
// the board keeps it open and passes `error` — this file just shows it.
//
// No SAP plan / article tag in here, by decision: the supervisor types what
// he wrote, not what SAP says should be there.

export type ArticleCountMode = "approve" | "edit";

export interface ArticleCountPopupProps {
  open: boolean;
  mode: ArticleCountMode;
  /** "edit" prefills with this; "approve" always opens EMPTY (no prefill — a
   *  number he did not type must not save). */
  current: number | null;
  saving: boolean;
  /** The route's message after a failed save; null when there is none. */
  error: string | null;
  onCancel: () => void;
  onSave: (count: number) => void;
}

export function ArticleCountPopup({
  open, mode, current, saving, error, onCancel, onSave,
}: ArticleCountPopupProps): React.JSX.Element {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset on every OPEN (not on close — the fade-out keeps what was typed).
  // Focus in the same effect so the number pad comes up by itself.
  useEffect(() => {
    if (!open) return;
    setValue(mode === "edit" && current !== null ? String(current) : "");
    const el = inputRef.current;
    if (el) {
      el.focus();
      if (mode === "edit") el.select();
    }
  }, [open, mode, current]);

  // When it closes, drop focus so the keyboard does not stay up behind it.
  useEffect(() => {
    if (!open) inputRef.current?.blur();
  }, [open]);

  const count = parseArticleCountInput(value);
  const canSave = count !== null && !saving;

  function submit(): void {
    if (count === null || saving) return;
    onSave(count);
  }

  return (
    <div
      // Same opt-out FindingPopup carries — the popup renders inside the
      // element holding pager.touchHandlers, so without it a horizontal drag
      // across the card pages to the next bill mid-entry (PICKING §5.3).
      {...{ [NO_BILL_SWIPE_ATTR]: "" }}
      // z-[65] — the same layer as FindingPopup / SHEET_GEOMETRY.scrimZ.
      className={
        "fixed inset-0 z-[65] bg-black/45 flex items-center justify-center px-6 transition-opacity duration-200 " +
        (open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")
      }
      onClick={() => {
        if (!saving) onCancel();
      }}
      aria-hidden={!open}
    >
      <form
        className={
          "w-full max-w-[320px] rounded-2xl bg-white p-5 transition-transform duration-200 ease-out " +
          (open ? "scale-100" : "scale-95")
        }
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="text-[17px] font-semibold text-gray-900">Article no.</div>
        <p className="text-[13px] text-gray-500 mt-1 mb-4">
          Enter the article number written on the drum.
        </p>

        {/* text-[34px] is far above the 16px iOS zoom guard (CLAUDE_UI §59.1).
            type="text" + inputMode/pattern, not type="number": a number input
            accepts "e", "-" and "1.5" and wheels its value on scroll. */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={3}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          disabled={saving}
          aria-label="Article no."
          className="w-full h-[64px] rounded-[12px] border-2 border-brand-600 text-center text-[34px] font-bold tabular-nums text-gray-900 outline-none tracking-[0.04em] disabled:opacity-60"
        />
        <div className="text-[12px] text-gray-400 text-center mt-2 mb-4">
          {mode === "approve" && value === "" ? "Type the number you wrote" : "Whole number, 1–999"}
        </div>

        {error !== null && (
          <div className="text-[12.5px] font-medium text-red-600 text-center -mt-2 mb-3" role="alert">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 h-11 rounded-[10px] border border-gray-300 bg-white text-[13px] font-semibold text-gray-600 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 h-11 rounded-[10px] bg-brand-600 active:bg-brand-700 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
