"use client";

// The delivery challan, read-only, for printing (2026-10-09).
//
// Rendered by app/challan-print/[orderId]/page.tsx, which Floor's DC column
// loads out of sight in a hidden iframe and prints. It is the SAME
// ChallanDocument the Challans screen draws — never a copy — so the two can
// never look different on paper. Nothing here edits: isEditing is false, the
// three change handlers do nothing, and formulaValues is empty so every line
// falls back to its saved formula (challan-document.tsx, `formulaValues[li.id]
// ?? li.formula`).
//
// 🔴 THE READY MARKER. A wrapper carrying `data-challan-ready`, around
// ChallanDocument's #challan-print-area, in the SERVER HTML — so the printer
// (components/floor/use-challan-print.ts) finds `[data-challan-ready]
// #challan-print-area` as soon as the iframe's `load` fires, without waiting
// for hydration. A page that refused (no access, voided, not found) never
// renders this view, so the marker's absence is how Floor knows not to open
// the print box.

import { ChallanDocument, type ChallanApiResponse } from "@/components/tint/challan-document";

const noop = () => {};

export function ChallanPrintView({ data }: { data: ChallanApiResponse }) {
  return (
    <div data-challan-ready="1">
      <ChallanDocument
        data={data}
        isEditing={false}
        transporterValue={data.challan.transporter ?? ""}
        vehicleNoValue={data.challan.vehicleNo ?? ""}
        formulaValues={{}}
        onFormulaChange={noop}
        onTransporterChange={noop}
        onVehicleNoChange={noop}
        isVoided={data.challan.isVoided}
      />
    </div>
  );
}
