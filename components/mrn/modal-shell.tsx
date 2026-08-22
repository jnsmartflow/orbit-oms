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
        // ⚠ ENTERED text is #1d2939 (near-black); the PLACEHOLDER is gray-300.
        // They were previously close enough that a tester read an example STI
        // ref as a value he had typed. Tailwind does NOT style placeholders by
        // default — the text- colour applies to the VALUE only — so the
        // placeholder: variant below is what actually creates the contrast.
        "mt-1 h-[34px] w-full rounded-lg border border-gray-200 px-2.5 text-[13px] text-[#1d2939] placeholder:text-gray-300 placeholder:font-normal outline-none focus:border-gray-400 " +
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
 * A value the operator cannot change — Surat.
 *
 * ⚠ It reads as a FACT, not as an input waiting to be filled: gray-100 fill,
 * dashed-free solid border, muted text, and no focus affordance. It previously
 * used the same near-white box as a real field, which — beside a grey
 * placeholder — made two different things look identical.
 */
export function ReadOnlyField({ value }: { value: string }): React.JSX.Element {
  return (
    <div className="mt-1 flex h-[34px] cursor-not-allowed select-none items-center rounded-lg border border-gray-200 bg-gray-100 px-2.5 text-[13px] font-medium text-gray-400">
      {value}
    </div>
  );
}

/**
 * Turn a failed response into something an operator can read.
 *
 * 🔴 THE ROUTE'S OWN SENTENCE ALWAYS WINS. Every MRN write route returns
 * `{ error }` written in the operator's words — "The supervisor is checking
 * this truck — the lines are locked", "The previous lines were cleared but the
 * new ones could not be saved…". Those pass through UNTOUCHED. Do not wrap,
 * prefix or summarise them.
 *
 * ⚠ THE 401/403 BRANCH IS A BACKSTOP, NOT THE NORMAL PATH. Those routes answer
 * with the bare HTTP word "Forbidden", which is what leaked to a tester on the
 * `operations` account. The controls are now hidden for roles that cannot use
 * them (see detail-pane.tsx), so this should never fire — but if the client and
 * the server ever disagree, the operator gets a sentence rather than a status
 * code. `action` names what was refused, since "Forbidden" alone does not say
 * whether it was the delete, the edit or the paste.
 */
export function describeWriteError(
  status: number,
  serverMessage: string | undefined,
  action: string,
): string {
  if (status === 403 || serverMessage === "Forbidden") {
    return `Your role cannot ${action}.`;
  }
  if (status === 401 || serverMessage === "Unauthorized") {
    return "Your session has expired. Sign in again.";
  }
  if (serverMessage && serverMessage.trim() !== "") return serverMessage;
  return `Could not ${action} (${status}).`;
}

/**
 * The one place a failed write speaks. Feed it describeWriteError() above —
 * which passes the route's own operator-facing sentence through untouched and
 * only substitutes plain words for a bare HTTP status.
 */
export function ModalError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="mb-3.5 rounded-[9px] border border-red-200 bg-red-50 px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-[#b42318]">
      {message}
    </div>
  );
}
