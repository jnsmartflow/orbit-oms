"use client";

import { useState } from "react";
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
import { getTodayIST } from "@/lib/dates";

// P1 — billing raises a new MRN.
//
// The MRN number and today's Sr no are NOT asked for and never shown as an
// input: they are allocated server-side on save (lib/mrn/number.ts, MAX+1 over
// rows INCLUDING soft-removed ones). Showing a predicted number here would be a
// promise this modal cannot keep — two operators creating at the same moment
// collide, and the route retries the allocation up to three times before giving
// up with a 409. The hint below therefore says the number is generated on save
// without naming one.
//
// `receivingWarehouse` is read-only Surat: the route hardcodes it, so an input
// would imply a choice that does not exist.

interface NewMrnModalProps {
  onClose: () => void;
  /** Called with the new MRN's id so the board can select it. */
  onCreated: (mrnId: number) => void;
}

export function NewMrnModal({ onClose, onCreated }: NewMrnModalProps): React.JSX.Element {
  // Defaults to today IST — the overwhelmingly common case is a truck that
  // reported today. Zone-pinned rather than a bare `new Date()`, for the same
  // reason billing-board.tsx pins its stepper.
  const [truckReportingDate, setTruckReportingDate] = useState(() => getTodayIST());
  const [receivedFrom, setReceivedFrom] = useState<"TPW" | "CDC">("TPW");
  const [stiRefNo, setStiRefNo] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mrn/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truckReportingDate: truckReportingDate.trim(),
          receivedFrom,
          stiRefNo: stiRefNo.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      if (!res.ok) {
        // The route's own sentence, verbatim — including the 409 that means two
        // people created at the same moment and this one lost. See ModalError.
        setError(describeWriteError(res.status, json.error, "create an MRN"));
        return;
      }
      if (typeof json.id !== "number") {
        setError("The MRN was created but the response was unreadable. Reload to see it.");
        return;
      }
      onCreated(json.id);
    } catch {
      setError("Could not reach the server. Nothing was created — try again.");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = truckReportingDate.trim() !== "" && !busy;

  return (
    <ModalShell
      title="New MRN"
      subtitle="Fill what you have off the LR and the STI. You can paste the lines next."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Cancel
          </ModalButton>
          <ModalButton tone="confirm" onClick={submit} disabled={!canSubmit}>
            {busy ? "Creating…" : "Create MRN"}
          </ModalButton>
        </>
      }
    >
      {error && <ModalError message={error} />}

      <div className="grid grid-cols-2 gap-x-4 gap-y-[13px]">
        <div>
          <FieldLabel>Truck reporting date</FieldLabel>
          <TextField type="date" value={truckReportingDate} onChange={setTruckReportingDate} autoFocus />
        </div>
        <div>
          <FieldLabel>Received from</FieldLabel>
          <ReceivedFromToggle value={receivedFrom} onChange={setReceivedFrom} />
        </div>
        <div>
          <FieldLabel>STI / PO ref no.</FieldLabel>
          <TextField value={stiRefNo} onChange={setStiRefNo} mono placeholder="e.g. I106571012" />
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
          {/* Read-only: the create route hardcodes "Surat". The disabled
              treatment is load-bearing — beside a grey placeholder, a
              near-white box read as an empty field a tester thought he had
              filled. */}
          <ReadOnlyField value="Surat" />
        </div>
      </div>

      <p className="mt-2 text-[11.5px] leading-[1.55] text-[#98a2b3]">
        The MRN number and today&apos;s Sr no are generated on save.
      </p>
    </ModalShell>
  );
}
