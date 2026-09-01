"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import {
  FieldLabel,
  ModalButton,
  ModalError,
  ModalShell,
  TextField,
  describeWriteError,
} from "./modal-shell";

// The OTR punch — billing's last act on a truck (design §3.3).
//
// ⚠ REACHABLE ONLY WHILE `status === 'done'`, AND ONLY FOR billing_operator OR
// admin. The [Close MRN] control that opens it is ABSENT — not greyed — for
// every other role and every other state, the same treatment Edit header gets
// on a non-open MRN. A greyed control the role can never earn reads as broken
// software (UI §10), and this one is doubly so: the route would 403 it.
//
// 🔴 THE WARNING BELOW IS NOT DECORATION. There is no reopen anywhere in this
// module — no route writes the status backwards, and there is no
// edit-OTR-after-close — so a mistyped OTR number is permanent. The one moment
// that fact is useful to the operator is BEFORE the click, which is why it sits
// above the button rather than in a toast afterwards.

interface CloseMrnModalProps {
  detail: MrnDetail;
  onClose: () => void;
  onClosed: () => void;
}

export function CloseMrnModal({
  detail,
  onClose,
  onClosed,
}: CloseMrnModalProps): React.JSX.Element {
  // Pre-filled from the row on the off-chance one was typed at create — in
  // practice always blank, because the OTR arrives after the header locks and
  // all ten live MRNs carry NULL.
  const [otrNo, setOtrNo] = useState(detail.otrNo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = otrNo.trim();
  const canSubmit = trimmed !== "" && !busy;

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otrNo: trimmed }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // The route's own sentence, verbatim — it distinguishes "already
        // closed", "still checking" and "closed by someone else a moment ago",
        // and each of those is something different for the operator to do.
        setError(describeWriteError(res.status, json.error, "close this MRN"));
        return;
      }
      onClosed();
    } catch {
      setError("Could not reach the server. Nothing was closed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title={
        <>
          Close · <span className="font-mono font-semibold">{detail.mrnNumber}</span>
        </>
      }
      subtitle="Record the OTR number and file this MRN."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Cancel
          </ModalButton>
          {/* `confirm` (gray-900), not `danger` — UI §13 reserves red for a
              destructive confirm, and closing destroys nothing. It is
              irreversible, which the amber warning above says in words; red
              here would read as "this deletes something". */}
          <ModalButton onClick={() => void submit()} disabled={!canSubmit} tone="confirm">
            {busy ? "Closing…" : "Close MRN"}
          </ModalButton>
        </>
      }
    >
      <div>
        <FieldLabel>OTR number</FieldLabel>
        <TextField
          value={otrNo}
          onChange={setOtrNo}
          mono
          autoFocus
          placeholder="e.g. OTR-4471"
        />
      </div>

      {/* 🔴 THE POINT OF NO RETURN, SAID BEFORE THE CLICK.
          Plain words, not a shrug: "cannot be undone" is true of a lot of
          software that quietly offers an edit later. This one genuinely has no
          way back — no reopen route, no edit-OTR-after-close — and the operator
          has to know that while the field is still editable. */}
      <div className="mt-3 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
        <AlertTriangle size={15} className="mt-px shrink-0" />
        <div>
          <b>This cannot be undone.</b> Once closed, the OTR number cannot be changed and the MRN
          cannot be reopened. Check the number before you close.
        </div>
      </div>

      {error && <ModalError message={error} />}
    </ModalShell>
  );
}
