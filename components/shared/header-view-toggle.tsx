"use client";

// A small two-or-more-way view toggle for a board's UniversalHeader TITLE slot.
//
// The look is `CLAUDE_UI.md §21`'s, and the class strings are lifted verbatim
// from the FIRST implementation of it — the inline Table/Focus buttons in
// app/(mail-orders)/mail-orders/mail-orders-page.tsx. This component exists
// because Tint Operator's Jobs/History toggle would have been the SECOND
// hand-rolled copy, and two copies of a visual rule drift (the same reasoning
// that pulled HeaderFilter / HeaderDateStepper / HeaderShortcuts out of
// universal-header.tsx).
//
// ⚠ ACTIVE IS DARK (`bg-gray-800`), NOT TEAL — deliberately. A view toggle is
// NAVIGATION, not the surface's one brand action (UI §21, UI §1's one-teal
// rule). On Tint Operator the single teal is already spent on the job pill.
//
// ⚠ Mail Orders is NOT yet a consumer. Retrofitting it is safe but out of the
// scope it was extracted in — its copy carries `data-tutorial="view-toggle"`
// and a billing-flag branch. `dataTutorial` below exists so that retrofit is a
// prop, not a signature change.

export interface HeaderViewOption<T extends string> {
  value: T;
  label: string;
}

export function HeaderViewToggle<T extends string>({
  options,
  value,
  onChange,
  dataTutorial,
  ariaLabel,
}: {
  options: ReadonlyArray<HeaderViewOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Optional hook for the in-app tutorial overlay. */
  dataTutorial?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-tutorial={dataTutorial}
      className="flex border border-gray-300 rounded-[5px] overflow-hidden"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`text-[10px] px-2.5 py-[3px] font-medium transition-colors cursor-pointer ${
            value === opt.value
              ? "bg-gray-800 text-white"
              : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
