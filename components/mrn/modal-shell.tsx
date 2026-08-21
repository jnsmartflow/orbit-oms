"use client";

import { useEffect } from "react";

// The shell every MRN modal sits in, per CLAUDE_UI.md §13: `bg-black/40`
// backdrop, `bg-white rounded-lg shadow-xl` panel. Escape and a backdrop click
// both close.
//
// ⚠ CLOSING IS SUPPRESSED WHILE A WRITE IS IN FLIGHT (`busy`). Escaping out of
// a modal whose POST is still travelling would leave the operator with no idea
// whether it landed — and on the paste modal specifically, mid-write is exactly
// the window in which the MRN has zero lines. The dismiss paths come back the
// moment the request settles.

interface ModalShellProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** "wide" is the paste modal's 820px; default is §13's 520px. */
  width?: "default" | "wide";
  busy?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** The footer's buttons, right-aligned. */
  footer: React.ReactNode;
}

export function ModalShell({
  title,
  subtitle,
  width = "default",
  busy = false,
  onClose,
  children,
  footer,
}: ModalShellProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => {
        // mouseDown, not click: a click that STARTED inside the panel and ended
        // on the backdrop (a drag while selecting text in the paste box) would
        // otherwise close the modal and throw the paste away.
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={
          "max-h-full overflow-hidden rounded-lg bg-white shadow-xl " +
          (width === "wide" ? "w-[820px]" : "w-[520px]")
        }
      >
        <div className="px-5 pt-4">
          <div className="text-[15px] font-bold text-gray-900">{title}</div>
          {subtitle && (
            <div className="mt-1 text-[12.5px] leading-[1.5] text-[#667085]">{subtitle}</div>
          )}
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

        <div className="flex justify-end gap-[9px] border-t border-[#f0f2f4] bg-[#fcfcfd] px-5 py-[13px]">
          {footer}
        </div>
      </div>
    </div>
  );
}

// ── Shared controls ─────────────────────────────────────────────────────────

export function ModalButton({
  tone = "secondary",
  disabled,
  onClick,
  children,
  type = "button",
}: {
  /** §13: a confirm is gray-900, a destructive confirm is red-600. Never teal —
   *  teal on this board belongs to the board's own action row. */
  tone?: "secondary" | "confirm" | "danger";
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  type?: "button" | "submit";
}): React.JSX.Element {
  const base =
    "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-colors";
  // Disabled is GREY in every tone (UI §10) — a faded confirm reads as broken
  // rather than as waiting, and the box model is identical either way so
  // nothing shifts when it enables.
  const cls = disabled
    ? "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-400"
    : tone === "confirm"
      ? "border border-gray-900 bg-gray-900 font-semibold text-white hover:bg-gray-800"
      : tone === "danger"
        ? "border border-red-600 bg-red-600 font-semibold text-white hover:bg-red-700"
        : "border border-gray-200 bg-white text-[#475467] hover:bg-gray-50";

  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
      {children}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: "text" | "date";
  autoFocus?: boolean;
}): React.JSX.Element {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={
        "mt-1 h-[34px] w-full rounded-lg border border-gray-200 px-2.5 text-[13px] text-[#1d2939] outline-none focus:border-gray-400 " +
        (mono ? "font-mono" : "")
      }
    />
  );
}

/** The TPW / CDC choice. Two values pinned by chk_mrn_received_from — a third
 *  source depot is a SQL ALTER first, never a new option added here. */
export function ReceivedFromToggle({
  value,
  onChange,
}: {
  value: "TPW" | "CDC";
  onChange: (v: "TPW" | "CDC") => void;
}): React.JSX.Element {
  return (
    <div className="mt-1 inline-flex gap-0.5 rounded-[7px] bg-gray-100 p-[3px]">
      {(["TPW", "CDC"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={
            "rounded-[5px] px-[13px] py-[5px] text-[12px] " +
            (value === opt
              ? "bg-gray-900 font-semibold text-white"
              : "font-medium text-[#667085] hover:bg-white/60")
          }
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/**
 * The one place a failed write speaks.
 *
 * 🔴 IT RENDERS THE SERVER'S OWN SENTENCE, VERBATIM. Every MRN write route
 * returns `{ error }` written in the operator's words — "The supervisor is
 * checking this truck — the lines are locked", "The previous lines were cleared
 * but the new ones could not be saved…". Replacing any of those with a generic
 * "Something went wrong" throws away the entire reason they were written that
 * way, and in the linesCleared case actively misleads: the operator would not
 * know their lines are now gone.
 */
export function ModalError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="mb-3.5 rounded-[9px] border border-red-200 bg-red-50 px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-[#b42318]">
      {message}
    </div>
  );
}
