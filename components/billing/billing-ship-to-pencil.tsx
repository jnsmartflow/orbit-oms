"use client";

// Billing v2 — the ✎ pencil on the Ship-To card (mockup billing-final-mockup.html
// `.pencil`). Opens the SHARED ship-to modal (components/shared/ship-to-modal.tsx,
// free-text ship-to P2, 2026-10-19) — dealer search, a typed name / As per
// challan with an area and challan copies, or Reset. Was a small dealer-search
// popover until 2026-10-19.
//
// ⚠ RENDERS ONLY WHEN billingV2 IS ON AND THE billing_ship_to TICK IS HELD. It
// reaches ShipToCard through the OPTIONAL `actionSlot` prop, which the call site
// (review-view.tsx) leaves `undefined` otherwise — so the card renders nothing
// extra. The tick gates drawing only; the save route is the lock.
//
// ALWAYS ACTIVE — punched or not (2026-07-31). The server writes the mail order
// and every live bill on its SO (POST /api/billing/mail-order/ship-to), and
// enrichment carries it to bills that import later. Do not reintroduce a
// punch-based disable.
//
// Search hits /api/billing/ship-to-search (mail_orders/canView), NOT Floor's —
// billing_operator has no `floor` permission. See that route's header.

import { useState } from "react";
import { Pencil } from "lucide-react";
import { ShipToModal, type ShipToCurrent } from "@/components/shared/ship-to-modal";

export function BillingShipToPencil({
  moOrderId,
  soNumber,
  current,
  customerAreaId,
  onSaved,
}: {
  moOrderId: number;
  soNumber: string | null;
  current: ShipToCurrent;
  customerAreaId: number | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <span className="mo-print-hide relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Change ship-to"
        aria-label="Change ship-to"
        className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
      >
        <Pencil size={12} />
      </button>

      {open && (
        <ShipToModal
          desk="billing"
          ownerId={moOrderId}
          refLabel={soNumber?.trim() ? `SO ${soNumber.trim()}` : null}
          current={current}
          customerAreaId={customerAreaId}
          searchUrl="/api/billing/ship-to-search"
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </span>
  );
}
