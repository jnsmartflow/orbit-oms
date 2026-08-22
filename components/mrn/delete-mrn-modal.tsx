"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { ModalButton, ModalError, ModalShell, describeWriteError } from "./modal-shell";

// P5 — delete an MRN.
//
// ⚠ Only while `status === 'open'`, and like Edit the control that opens it is
// ABSENT otherwise, not disabled (the route 409s once the supervisor starts).
//
// The copy states TWO consequences, and both are load-bearing:
//
//   1. "It disappears from the supervisor's phone too." A soft-removed MRN is
//      filtered out of BOTH faces (design §11 OQ-8), so a truck he was about to
//      check simply vanishes from To check. Billing has to know that before
//      confirming, not after he asks about it.
//   2. "The number is not reused." This is not a nicety — it is the visible
//      half of the rule that keeps allocation correct. The two allocators in
//      lib/mrn/number.ts deliberately COUNT removed rows, because the row keeps
//      its mrnNumber and (mrnDate, srNo) under two live UNIQUE indexes. So the
//      day's Sr numbers will show a gap where this truck was, and that gap is
//      correct rather than a bug to report.
//
// Red confirm per UI §13 — the action cannot be undone from any screen.

interface DeleteMrnModalProps {
  detail: MrnDetail;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteMrnModal({
  detail,
  onClose,
  onDeleted,
}: DeleteMrnModalProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/delete`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // Verbatim — a 409 here reads "The supervisor is checking this truck —
        // it can no longer be removed", which tells billing exactly what
        // changed while the modal was open.
        setError(describeWriteError(res.status, json.error, "delete an MRN"));
        return;
      }
      onDeleted();
    } catch {
      setError("Could not reach the server. Nothing was deleted — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Delete this MRN?"
      subtitle={
        <>
          <span className="font-mono font-semibold">{detail.mrnNumber}</span> ·{" "}
          {detail.receivedFrom} · {detail.lineCount} line{detail.lineCount === 1 ? "" : "s"}
        </>
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            Cancel
          </ModalButton>
          <ModalButton tone="danger" onClick={submit} disabled={busy}>
            {busy ? "Deleting…" : "Delete MRN"}
          </ModalButton>
        </>
      }
    >
      {error && <ModalError message={error} />}

      <div className="flex gap-[9px] rounded-[9px] border border-red-200 bg-red-50 px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-[#b42318]">
        <Trash2 size={16} className="mt-px shrink-0" />
        <div>
          It disappears from the supervisor&apos;s phone too. The number{" "}
          <b className="font-mono">{detail.mrnNumber}</b> is not reused.
        </div>
      </div>
    </ModalShell>
  );
}
