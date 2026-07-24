// Floor Control — detail panel Details tab (design §10.4, mockup 02-detail-panel
// `detailsHTML`). Four groups: Parties · Reference · Classification · Planning.
// Read-only display; the raw workflowStage string is deliberately NOT shown
// (design §10.4 — the status pill says it in English, Activity shows how it got
// there). Slot editing lives on the fixed action row, not inside this tab.

import type { FloorDetail } from "@/lib/floor/types";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })
    .replace(",", " ·");
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
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
        <Cell k="Invoice date" v={fmtDate(d.invoiceDate)} />
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
    </div>
  );
}
