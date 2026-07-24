// Floor Control — detail panel Activity tab (design §10.4, mockup 02-detail-panel
// `trailHTML`). A timeline, newest first: what happened, when, and who.
//
// Rows come from order_status_logs. The ONE synthetic entry (auto-slot) has no
// log row — the dispatch engine deliberately writes none (a second orders.update
// would break the live-sync marker) — so it is DERIVED from dispatchSlotSource +
// dispatchSlotRuleId and labelled clearly as coming from enrichment, with an
// "enrichment" chip instead of a wall-clock time.
//
// Hold events are recognised by their log NOTE via the SHARED constant
// HOLD_LOG_NOTES (lib/floor/hold-log.ts) — never a loose string — so a hold from
// the floor OR from Support gets the amber marker.

import { HOLD_LOG_NOTES } from "@/lib/floor/hold-log";
import type { FloorActivityEntry, FloorDetail } from "@/lib/floor/types";

function fmtWhen(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", "");
}

// Human hint for the auto-slot ruleId. Falls back to the raw id so an unmapped
// rule still reads honestly rather than silently blank.
const RULE_HINT: Record<string, string> = {
  R1_LOCAL_1030: "Local · arrival before 10:30",
  R1_LOCAL_1230: "Local · arrival before 12:30",
  R1_LOCAL_1600: "Local · arrival before 16:00",
  R1_LOCAL_NEXT_1030: "Local · rolled to next working day",
  R1_UPC_1800: "Upcountry · same-day 18:00",
  R1_UPC_NEXT_1800: "Upcountry · next working day",
};

// The primary sentence for a real log row. Prefer the human note; fall back to a
// terse stage transition so a note-less row is never blank.
function lineFor(e: FloorActivityEntry): string {
  if (e.note && e.note.trim()) return e.note;
  if (e.toStage) return e.fromStage ? `${e.fromStage} → ${e.toStage}` : e.toStage;
  return "Updated";
}

export function DetailActivity({ d }: { d: FloorDetail }) {
  if (d.activity.length === 0) {
    return <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">No activity recorded yet.</div>;
  }

  return (
    <div className="py-1">
      {d.activity.map((e, i) => {
        const isHold = !e.synthetic && e.note !== null && HOLD_LOG_NOTES.includes(e.note);
        const dotCls = e.synthetic ? "bg-[#0d9488]" : isHold ? "bg-[#f59e0b]" : "bg-[#e5e7eb]";

        if (e.synthetic) {
          const hint = d.dispatchSlotRuleId ? RULE_HINT[d.dispatchSlotRuleId] ?? d.dispatchSlotRuleId : "";
          const win = d.dispatchWindowTime ? ` to ${d.dispatchWindowTime}` : "";
          return (
            <div key={`syn-${i}`} className="relative flex gap-[11px] px-5 py-[10px]">
              <span className={`z-10 mt-1 h-[9px] w-[9px] flex-shrink-0 rounded-full ${dotCls} shadow-[0_0_0_3px_#fff]`} />
              <div className="min-w-0">
                <div className="text-[12px] leading-[1.4] text-[#111827]">Dispatch slot set automatically{win}</div>
                <div className="mt-[3px] text-[10.5px] text-[#9ca3af]">
                  <span className="rounded-[3px] bg-[#f0fdfa] px-[5px] py-px font-semibold text-[#0f766e]">enrichment</span>
                  {hint && <span className="ml-1.5">{hint}</span>}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={i} className="relative flex gap-[11px] px-5 py-[10px]">
            <span className={`z-10 mt-1 h-[9px] w-[9px] flex-shrink-0 rounded-full ${dotCls} shadow-[0_0_0_3px_#fff]`} />
            <div className="min-w-0">
              <div className="text-[12px] leading-[1.4] text-[#111827]">{lineFor(e)}</div>
              <div className="mt-[3px] text-[10.5px] text-[#9ca3af]">
                {e.at ? fmtWhen(e.at) : ""}
                {e.actorName && (
                  <>
                    {e.at ? " · " : ""}
                    <span className="text-[#6b7280]">{e.actorName}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
