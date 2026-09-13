// Floor Control — rail empty states (design §6.6 / 04-card-spec §3). Every empty
// state says WHY it is empty and what happens next — never a bare "no records".
// The scoped variant is critical: without it he sees "All clear" while sitting
// on IGT and believes the whole day is clean.

export type RailEmptyVariant = "all-clear" | "nothing-yet" | "scoped";

export function RailEmpty({
  variant,
  scope,
  onShowAll,
}: {
  variant: RailEmptyVariant;
  scope: string;
  onShowAll: () => void;
}) {
  if (variant === "scoped") {
    return (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">&#9675;</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing for {scope} right now</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">Other delivery types may still have work.</p>
        <button
          type="button"
          onClick={onShowAll}
          className="mt-3 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] text-gray-600 hover:border-gray-300"
        >
          Show all types
        </button>
      </div>
    );
  }

  if (variant === "nothing-yet") {
    return (
      <div className="px-5 py-14 text-center">
        <div className="text-[28px] leading-none text-gray-300">&#9675;</div>
        <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing yet today</h4>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">The first bills usually arrive around 8:00.</p>
      </div>
    );
  }

  return (
    <div className="px-5 py-14 text-center">
      <div className="text-[28px] leading-none text-[#22c55e]">&#10003;</div>
      <h4 className="mt-2 text-[13px] font-semibold text-gray-900">All clear</h4>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
        Every order that came in has a slot.
        <br />
        New ones appear here on their own.
      </p>
    </div>
  );
}
