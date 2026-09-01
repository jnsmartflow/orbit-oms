"use client";

import { useState } from "react";
import type { MrnDetail } from "@/lib/mrn/types";
import {
  FieldLabel,
  ModalButton,
  ModalError,
  ModalShell,
  ReadOnlyField,
  ReceivedFromToggle,
  TextField,
  describeWriteError,
} from "./modal-shell";
import { isMrnReceivedFrom } from "@/lib/mrn/types";

// P4 — edit the header.
//
// ⚠ REACHABLE ONLY WHILE `status === 'open'`, and the Edit control that opens it
// is ABSENT rather than disabled on anything else. That control is the
// [Edit header] button in the detail pane's action row
// (components/mrn/detail-pane.tsx), gated `status === "open" && canEdit` — it is
// the ONLY caller of this modal. It used to be a pencil inside
// components/mrn/header-card.tsx; that file was deleted on 2026-08-26 when its
// fields became the pane header's facts row, and the gate moved with it
// unchanged. That is
// deliberate: the PATCH route 409s the moment the supervisor taps Start, so a
// greyed-out Edit would advertise an action the server has already refused. A
// control that cannot ever work in this state should not be on the screen.
//
// ⚠ `mrnDate` AND `srNo` ARE NOT FIELDS HERE AND MUST NEVER BECOME ONE. They are
// immutable after create (design §11 OQ-5) and the route rejects any attempt to
// set them with a 400. Editing `truckReportingDate` — which IS offered — never
// renumbers anything: a truck that reported on the 17th and was entered on the
// 20th stays truck N of the 20th.

interface EditHeaderModalProps {
  detail: MrnDetail;
  onClose: () => void;
  onSaved: () => void;
}

/** A @db.Date to the "YYYY-MM-DD" an <input type="date"> wants. UTC getters —
 *  the value is UTC-midnight anchored, so its UTC parts ARE its calendar
 *  parts (see components/mrn/format.ts). */
function toDateInput(v: Date | string | null): string {
  if (v === null) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function EditHeaderModal({
  detail,
  onClose,
  onSaved,
}: EditHeaderModalProps): React.JSX.Element {
  const [truckReportingDate, setTruckReportingDate] = useState(() =>
    toDateInput(detail.truckReportingDate),
  );
  const [receivedFrom, setReceivedFrom] = useState<"TPW" | "CDC">(() =>
    // Narrowed, never cast: `receivedFrom` is a TEXT column with a CHECK Prisma
    // cannot see, so the payload types it as a bare string.
    isMrnReceivedFrom(detail.receivedFrom) ? detail.receivedFrom : "TPW",
  );
  const [stiRefNo, setStiRefNo] = useState(detail.stiRefNo ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/header`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truckReportingDate: truckReportingDate.trim(),
          receivedFrom,
          stiRefNo: stiRefNo.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // Verbatim. A 409 here means the supervisor started while this modal was
        // open — "The supervisor is checking this truck — the header is locked."
        setError(describeWriteError(res.status, json.error, "edit this MRN"));
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Nothing was saved — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={
        <>
          Edit header · <span className="font-mono font-semibold">{detail.mrnNumber}</span>
        </>
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Cancel
          </ModalButton>
          <ModalButton
            tone="confirm"
            onClick={submit}
            disabled={busy || truckReportingDate.trim() === ""}
          >
            {busy ? "Saving…" : "Save changes"}
          </ModalButton>
        </>
      }
    >
      {error && <ModalError message={error} />}

      <div className="grid grid-cols-2 gap-x-4 gap-y-[13px]">
        <div>
          <FieldLabel>Truck reporting date</FieldLabel>
          <TextField type="date" value={truckReportingDate} onChange={setTruckReportingDate} />
        </div>
        <div>
          <FieldLabel>Received from</FieldLabel>
          <ReceivedFromToggle value={receivedFrom} onChange={setReceivedFrom} />
        </div>
        <div>
          <FieldLabel>STI / PO ref no.</FieldLabel>
          <TextField value={stiRefNo} onChange={setStiRefNo} mono />
        </div>
        {/* 🔴 DELIVERY NO AND OTR NO WERE REMOVED FROM THIS MODAL ON
            2026-09-01, AND NEITHER MAY COME BACK.

              • The DELIVERY NUMBER now arrives with the LINES. One STI can
                carry several, so it lives on mrn_lines and is typed on the
                PASTE modal, once per delivery. mrn.deliveryNo is frozen
                history with no writer at all.
              • The OTR NUMBER arrives at CLOSING. Its only writer is
                POST /api/mrn/[mrnId]/close.

            Both were being asked for at the one moment nobody has them. The
            evidence is in the data: otrNo was NULL on ALL 13 MRNs raised while
            this modal offered it, while stiRefNo (7/10) and deliveryNo (8/10)
            were routinely filled. A field offered at the wrong moment does not
            get filled — it teaches the operator to tab past it. */}
        <div>
          <FieldLabel>Receiving warehouse</FieldLabel>
          <ReadOnlyField value={detail.receivingWarehouse} />
        </div>
      </div>
    </ModalShell>
  );
}
