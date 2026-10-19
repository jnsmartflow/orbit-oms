"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// A shared modal shell, lifted from components/mrn/modal-shell.tsx (2026-10-19,
// free-text ship-to P2). The MRN copy is left untouched — MRN's modals keep
// their own. Per CLAUDE_UI.md §13: `bg-black/40` backdrop, white rounded panel
// with shadow, gray-900 confirm (see ModalButton).
//
// Differences from the MRN shell, each on purpose:
//   - `size="lg"` = 720px, the ship-to modal's width (design §2). Below 640px
//     every size goes FULL WIDTH and full height — a phone has no room for a
//     floating card.
//   - z-[120] — above Floor's 472px detail panel, the same layer as Floor's own
//     dialogs (off-floor-dialog.tsx, add-invoices-dialog.tsx), so the modal can
//     open from inside that panel.
//   - PORTALLED to document.body: a launcher can sit inside a positioned or
//     transformed card, which would otherwise trap `position: fixed`.
//   - A ✕ in the header.
//
// ⚠ CLOSING IS SUPPRESSED WHILE A WRITE IS IN FLIGHT (`busy`): Esc, the
// backdrop and the ✕ all wait. Escaping a save mid-request leaves the operator
// not knowing whether it landed.

interface ModalShellProps {
  title: React.ReactNode;
  /** Small mono text beside the title (an SO or OBD number). */
  titleRef?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** md = 520px (§13), lg = 720px. Full width below 640px either way. */
  size?: "md" | "lg";
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** The footer's buttons, right-aligned. */
  footer: React.ReactNode;
}

export function ModalShell({
  title,
  titleRef,
  subtitle,
  size = "md",
  busy = false,
  onClose,
  children,
  footer,
}: ModalShellProps): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        // Stop the key here so a page-level Esc owner (floor-page.tsx) does not
        // also close the panel underneath.
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 sm:p-6"
      onMouseDown={(e) => {
        // mouseDown, not click: a drag that STARTED inside the panel (selecting
        // text in an input) and ended on the backdrop must not close it.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={
          "flex h-full w-full flex-col overflow-hidden bg-white shadow-xl sm:h-auto sm:max-h-full sm:rounded-2xl " +
          (size === "lg" ? "sm:w-[720px]" : "sm:w-[520px]")
        }
      >
        <div className="flex items-center gap-2.5 border-b border-ink-100 px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[17px] font-bold text-ink-900">{title}</span>
              {titleRef && <span className="truncate font-mono text-[12px] text-ink-600">{titleRef}</span>}
            </div>
            {subtitle && <div className="mt-1 text-[12.5px] leading-[1.5] text-ink-600">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 text-ink-400 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:max-h-[70vh]">{children}</div>

        <div className="flex justify-end gap-2.5 border-t border-ink-100 bg-ink-25 px-6 py-3.5">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** §13: a confirm is gray-900, never brand; disabled is grey in every tone
 *  (UI §10), with an identical box so nothing shifts when it enables. */
export function ModalButton({
  tone = "secondary",
  disabled,
  onClick,
  children,
  type = "button",
}: {
  tone?: "secondary" | "confirm" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: "button" | "submit";
}): React.JSX.Element {
  const base = "inline-flex h-[38px] items-center gap-1.5 rounded-[10px] px-[18px] text-[14px] font-semibold transition-colors";
  const cls = disabled
    ? "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400"
    : tone === "confirm"
      ? "border border-gray-900 bg-gray-900 text-white hover:bg-gray-800"
      : tone === "danger"
        ? "border border-red-600 bg-red-600 text-white hover:bg-red-700"
        : "border border-ink-100 bg-white text-ink-700 hover:bg-ink-25";
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}
