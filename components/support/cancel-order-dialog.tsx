"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

const CANCEL_REASONS = [
  "Customer requested cancellation",
  "Duplicate order",
  "Material not available",
  "Address / route issue",
  "Credit hold",
  "Other",
] as const;

interface CancelOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
  obdNumber: string | null;
  onConfirm: (orderId: number, reason: string, note?: string) => Promise<void>;
}

export function CancelOrderDialog({
  open,
  onOpenChange,
  orderId,
  obdNumber,
  onConfirm,
}: CancelOrderDialogProps) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  function handleClose(v: boolean) {
    if (!v) {
      setReason("");
      setNote("");
    }
    onOpenChange(v);
  }

  async function handleConfirm() {
    if (!orderId || !reason) return;
    setLoading(true);
    try {
      await onConfirm(orderId, reason, note || undefined);
      handleClose(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Cancel Order</DialogTitle>
          <DialogDescription className="text-[12px]">
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* OBD chip */}
          {obdNumber && (
            <div>
              <span className="font-mono text-[12px] font-semibold text-[#312e81] bg-[#eef0ff] border border-[#c7cbf0] px-2.5 py-1 rounded-md">
                {obdNumber}
              </span>
            </div>
          )}

          {/* Reason select */}
          <div>
            <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
            >
              <option value="">Select a reason…</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Note */}
          <div>
            <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
              Notes (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for dispatcher or TM…"
              rows={3}
              className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="px-4 py-2 text-[12.5px] font-semibold text-[#5a5d74] border border-[#ededf3] rounded-lg hover:bg-gray-50 transition-colors"
          >
            Go back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!reason || loading}
            className="px-4 py-2 text-[12.5px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Confirm Cancellation
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
