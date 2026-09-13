// Floor Control — detail panel Details tab (design §10.4, mockup 02-detail-panel
// `detailsHTML`). Four groups: Parties · Reference · Classification · Planning.
// Read-only display; the raw workflowStage string is deliberately NOT shown
// (design §10.4 — the status pill says it in English, Activity shows how it got
// there). Slot editing lives on the fixed action row, not inside this tab.

// The date-only IST formatter used to be a private `fmtDate` right here. It
// moved to lib/floor/format.ts (verbatim — same options, same "" on null) when
// the floor TABLE grew an Invoice column, so this panel and that cell cannot
// render the same invoice date two different ways.
import { formatDateIST } from "@/lib/floor/format";
import type { FloorDetail } from "@/lib/floor/types";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", " ·");
}
// dispatchTargetDate is date-only — parse the Date.UTC way, never new Date(str).
function fmtDayOnly(dateOnly: string | null): string {
  if (!dateOnly) return "";
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WD[dt.getUTCDay()]} ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]}`;
}

function Section({ title }: { title: string }) {
  return <div className="px-5 pb-1 pt-3.5 text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[#9ca3af]">{title}</div>;
}

function Cell({ k, v, sub, mono }: { k: string; v: string | null; sub?: string | null; mono?: boolean }) {
  const has = Boolean(v);
  return (
    <div className="border-b border-[#f5f5f5] px-5 pb-2.5 pt-2 odd:border-r odd:border-r-[#f5f5f5]">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.04em] text-[#9ca3af]">{k}</div>
      <div className={`mt-[3px] break-words text-[12.5px] font-medium tabular-nums ${has ? "text-[#111827]" : "text-[#d1d5db]"} ${mono ? "font-mono text-[12px]" : ""}`}>
        {v || "—"}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-[#6b7280]">{sub}</div>}
    </div>
  );
}

export function DetailDetails({ d }: { d: FloorDetail }) {
  return (
    <div>
      <Section title="Parties" />
      <div className="grid grid-cols-2">
        <Cell k="Bill to" v={d.billToName} sub={d.billToCode} mono={false} />
        <Cell k="Ship to" v={d.shipToName} sub={d.shipToCode} mono={false} />
      </div>

      <Section title="Reference" />
      <div className="grid grid-cols-2">
        <Cell k="OBD date" v={fmtDateTime(d.obdDateTime)} />
        <Cell k="SO number" v={d.soNumber} mono />
        <Cell k="Invoice date" v={formatDateIST(d.invoiceDate)} />
        <Cell k="Invoice number" v={d.invoiceNo} mono />
      </div>

      <Section title="Classification" />
      <div className="grid grid-cols-2">
        <Cell k="Delivery type" v={d.deliveryType} />
        <Cell k="SMU" v={d.smu} />
        <Cell k="Route" v={d.route} sub={d.area} />
        <Cell k="Area" v={d.area} />
      </div>

      <Section title="Planning" />
      <div className="grid grid-cols-2">
        <Cell k="Dispatch date" v={fmtDayOnly(d.dispatchTargetDate)} />
        <Cell k="Slot" v={d.dispatchWindowTime} />
        <Cell k="Priority" v={d.priorityLevel === 1 ? "Urgent (P1)" : `P${d.priorityLevel}`} />
        <Cell k="Picker" v={d.pickerName} />
        <Cell k="Tinting" v={d.isTint ? "Yes" : "No"} />
        <Cell k="Material" v={d.materialType} />
      </div>

      {/* ── THE TINT ROOM (2026-09-14) ───────────────────────────────────────
          Everything the four pink pills have no room for: WHO has it, WHEN they
          started and finished, and how many shades are done.

          🔴 THIS IS THE ONLY FLOOR SURFACE THAT READS `tint_assignments`, and it
          reads it on CLICK. The board query does not touch that table and must
          not — the rail feed that used to was deleted on 2026-09-13 for costing
          772 ms and 25 statements on every board load and every 30-second poll.
          A pill per row would have spent that back; a panel spends it once, when
          somebody asks.

          🔴 "Machine status" IS THE ASSIGNMENT'S STATUS, AND IT IS THE ONLY
          PLACE A PAUSE IS VISIBLE. Pause and resume write the assignment row and
          never the order's stage (CLAUDE_TINT §5), so `workflowStage` — and
          therefore the pill — cannot tell a paused job from a running one. The
          pill says "With operator", which stays true either way; this cell says
          which.

          Rendered only on a tint bill. `d.tint` is null on a plain order, so the
          whole section is absent rather than a grid of dashes. */}
      {d.tint && (
        <>
          <Section title="Tint room" />
          <div className="grid grid-cols-2">
            <Cell k="Operator" v={d.tint.operatorName} />
            <Cell k="Machine status" v={tintStatusWord(d.tint.status)} />
            <Cell k="Assigned" v={fmtDateTime(d.tint.assignedAt)} />
            <Cell k="Started" v={fmtDateTime(d.tint.startedAt)} />
            <Cell k="Finished" v={fmtDateTime(d.tint.completedAt)} />
            <Cell k="Time on it" v={tintElapsed(d.tint)} />
            {/* Shades — the count the archived rail strip used to carry. A full
                (non-split) OBD has no shade rows at all, and "0 of 0" reads as
                broken, so it says so in words instead. `hasSplits` is counted
                BEFORE the cancelled filter for exactly this: an all-cancelled
                split order also reports 0 and would otherwise pass for a full
                OBD. */}
            <Cell
              k="Shades"
              v={d.tint.hasSplits ? `${d.tint.shadesDone} of ${d.tint.shadesTotal} done` : "Full OBD — no split"}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `tint_assignments.status` in the operator's words.
 *
 * ⚠ A PLAIN String COLUMN WITH NO CHECK (CORE §3's status-string rule), so an
 * unknown value is PRINTED RATHER THAN HIDDEN — a status this panel has not been
 * taught about should look unfamiliar on screen, not silently read as one of the
 * five it knows.
 */
function tintStatusWord(status: string | null): string | null {
  if (status === null) return null;
  const WORDS: Record<string, string> = {
    assigned: "Not started",
    tinting_in_progress: "Mixing",
    paused: "Paused",
    tinting_done: "Finished",
    skipped: "Skipped",
    cancelled: "Cancelled",
  };
  return WORDS[status] ?? status;
}

/**
 * How long the tint room has had it. Finished → start to finish; started →
 * start to now; neither → nothing.
 *
 * ⚠ NOT AN ACCUMULATED WORKING TIME. `tint_assignments` carries an
 * `accumulatedMinutes` for the pause maths, and this is deliberately NOT it:
 * this is wall clock, which is what a planner deciding whether to hold a truck
 * is actually asking. A paused job's wall clock keeps running, and that is the
 * honest answer to "how long has this been in the tint room".
 */
function tintElapsed(t: NonNullable<FloorDetail["tint"]>): string | null {
  if (!t.startedAt) return null;
  const from = new Date(t.startedAt).getTime();
  const to = t.completedAt ? new Date(t.completedAt).getTime() : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const mins = Math.max(0, Math.floor((to - from) / 60000));
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} min`;
}
