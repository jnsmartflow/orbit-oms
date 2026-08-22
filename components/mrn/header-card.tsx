"use client";

import { Pencil } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { formatDateOnly, formatIstDateTime } from "./format";

// The eight header facts, per mockup B1's .hcard.
//
// ⚠ TWO DATES THAT LOOK THE SAME AND ARE NOT (design §11 OQ-5). Only
// `truckReportingDate` is shown here, labelled "Truck reporting date" — the day
// the truck actually reported. `mrnDate` (the day the MRN was RAISED, which
// partners srNo in the unique key and drives the rail's date stepper) is
// deliberately NOT on this card: it is already expressed by which day's rail
// you are looking at, and printing both invites the operator to treat them as
// interchangeable. In normal operation they are the same day, which is exactly
// what makes confusing them easy. Both are immutable after create.

interface HeaderCardProps {
  detail: MrnDetail;
  onEdit: () => void;
  /** HIDDEN without it — see detail-pane.tsx on hidden vs disabled. */
  canEdit: boolean;
}

export function HeaderCard({ detail, onEdit, canEdit }: HeaderCardProps): React.JSX.Element {
  const start = formatIstDateTime(detail.unloadingStartAt);
  const end = formatIstDateTime(detail.unloadingEndAt);

  return (
    <div className="mb-3.5 rounded-[10px] border border-[#e6e9ec] bg-white px-[15px] py-[13px]">
      <div className="mb-[11px] flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400">
        Header
        {/* ⚠ ABSENT rather than disabled on anything but `open`. The PATCH route
            409s once the supervisor taps Start (design §5), so a greyed-out
            Edit would advertise an action the server has already refused — and
            UI §10's disabled treatment is for "not yet", not for "never here".
            An editable value gets a pencil, not a label (§10). */}
        {detail.status === "open" && canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="ml-auto inline-flex h-6 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-[9px] text-[11px] font-medium text-[#475467] hover:bg-gray-50"
          >
            <Pencil size={11} />
            Edit
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-x-[22px] gap-y-[13px]">
        <Field label="Truck reporting date" value={formatDateOnly(detail.truckReportingDate)} />
        <Field label="Received from" value={detail.receivedFrom} />
        <Field label="Receiving warehouse" value={detail.receivingWarehouse} />
        <Field label="STI / PO ref no." value={detail.stiRefNo} mono />
        <Field label="Delivery no" value={detail.deliveryNo} mono />
        <Field label="OTR no" value={detail.otrNo} mono />
        <Field
          label="Unloading start"
          value={start}
          // "not started" reads as a state; a bare dash reads as missing data.
          fallback={detail.status === "open" ? "not started" : "—"}
        />
        <Field
          label="Unloading end"
          value={end}
          fallback={detail.status === "checking" ? "in progress" : "—"}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  fallback = "—",
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  fallback?: string;
}): React.JSX.Element {
  const empty = value === null || value === "";
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
        {label}
      </div>
      <div
        className={
          "mt-[3px] text-[13px] " +
          (empty ? "font-normal text-[#c2c8d0]" : "font-medium text-[#1d2939] ") +
          (mono && !empty ? " font-mono" : "")
        }
      >
        {empty ? fallback : value}
      </div>
    </div>
  );
}
