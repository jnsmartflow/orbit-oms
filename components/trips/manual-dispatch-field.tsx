"use client";

// The MANUAL DISPATCH TIME input — a date and a time side by side (2026-10-04).
// Shared by the Floor Edit trip drawer (components/floor/trip-fields.tsx) and
// the Freight trip drawer (components/freight-trips/trip-drawer.tsx), so both
// enter the time the same way. The IST logic lives in lib/trips/diesel-dispatch.ts
// (initialManualDispatch for the starting values, manualDispatchIso to send,
// parseManualDispatchAt on the server) — this file only draws the inputs.
//
// ⚠ THE DATE STARTS ON TODAY IN IST (the caller computes it with Asia/Kolkata,
// never the browser's UTC day); editable, so a late entry can be back-dated.
// The time starts EMPTY and steps by 5 minutes. No "Now" button.
//
// The default classes are the Floor drawer's own (CLAUDE_UI §9); the Freight
// drawer passes its own so the field matches the inputs around it.

const LABEL = "mb-1.5 block text-[12px] font-medium text-gray-500";
const INPUT =
  "w-full rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 h-[38px]";
/** CLAUDE_UI §9's error state, added over the input. */
const INPUT_ERROR = "!border-red-300 ring-2 ring-red-500/[0.06]";
const ERROR_TEXT = "mt-1 text-[12px] text-red-600";

export function ManualDispatchField({
  id,
  date,
  time,
  onChange,
  error,
  label = "Manual dispatch time",
  labelClassName = LABEL,
  inputClassName = INPUT,
}: {
  /** The date input's id — the label points at it. */
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM (24h), or "" until typed. */
  time: string;
  onChange: (next: { date: string; time: string }) => void;
  /** One short line under the inputs; each empty input is outlined red. */
  error?: string;
  label?: string;
  labelClassName?: string;
  inputClassName?: string;
}) {
  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="date"
          className={`${inputClassName} flex-1 ${error && date === "" ? INPUT_ERROR : ""}`}
          value={date}
          onChange={(e) => onChange({ date: e.target.value, time })}
        />
        <input
          type="time"
          step={300}
          aria-label={label}
          className={`${inputClassName} flex-1 ${error && time === "" ? INPUT_ERROR : ""}`}
          value={time}
          onChange={(e) => onChange({ date, time: e.target.value })}
        />
      </div>
      {error && <div className={ERROR_TEXT}>{error}</div>}
    </div>
  );
}
