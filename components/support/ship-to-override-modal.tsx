"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type OverrideType = "none" | "customer" | "area-route" | "free-text";

interface ShipToOverrideModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
  obdNumber: string | null;
  currentOverride: string | null;
  onSave: (orderId: number, override: string) => Promise<void>;
}

export function ShipToOverrideModal({
  open,
  onOpenChange,
  orderId,
  obdNumber,
  currentOverride,
  onSave,
}: ShipToOverrideModalProps) {
  const [overrideType, setOverrideType] = useState<OverrideType>("none");
  const [customerName, setCustomerName] = useState("");
  const [areaName, setAreaName] = useState("");
  const [routeName, setRouteName] = useState("");
  const [freeAddress, setFreeAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setOverrideType(currentOverride ? "free-text" : "none");
      setCustomerName("");
      setAreaName("");
      setRouteName("");
      setFreeAddress(currentOverride ?? "");
      setContactName("");
      setContactPhone("");
      setReason("");
    }
  }, [open, currentOverride]);

  function handleClose(v: boolean) {
    onOpenChange(v);
  }

  function buildOverrideString(): string {
    switch (overrideType) {
      case "none":
        return "";
      case "customer":
        return `Customer: ${customerName}`;
      case "area-route":
        return `Area: ${areaName}, Route: ${routeName}`;
      case "free-text":
        return [freeAddress, contactName && `Contact: ${contactName}`, contactPhone && `Phone: ${contactPhone}`]
          .filter(Boolean)
          .join(" — ");
    }
  }

  const canSave =
    overrideType === "none" ||
    (overrideType === "customer" && customerName.trim()) ||
    (overrideType === "area-route" && areaName.trim()) ||
    (overrideType === "free-text" && freeAddress.trim());

  async function handleSave() {
    if (!orderId || !canSave) return;
    setLoading(true);
    try {
      await onSave(orderId, buildOverrideString());
      handleClose(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Ship-To Override</DialogTitle>
          <DialogDescription className="text-[12px]">
            Deliver to a different location
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

          {/* Override Type */}
          <div>
            <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
              Override Type
            </label>
            <select
              value={overrideType}
              onChange={(e) => setOverrideType(e.target.value as OverrideType)}
              className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
            >
              <option value="none">No override</option>
              <option value="customer">Different customer</option>
              <option value="area-route">Different area / route</option>
              <option value="free-text">Free-text address</option>
            </select>
          </div>

          {/* Conditional: Customer */}
          {overrideType === "customer" && (
            <div>
              <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                Customer Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Search customer…"
                className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
              />
            </div>
          )}

          {/* Conditional: Area + Route */}
          {overrideType === "area-route" && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                  Area
                </label>
                <input
                  type="text"
                  value={areaName}
                  onChange={(e) => setAreaName(e.target.value)}
                  placeholder="Area name…"
                  className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                  Route
                </label>
                <input
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="Route name…"
                  className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
                />
              </div>
            </div>
          )}

          {/* Conditional: Free-text */}
          {overrideType === "free-text" && (
            <>
              <div>
                <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                  Address
                </label>
                <textarea
                  value={freeAddress}
                  onChange={(e) => setFreeAddress(e.target.value)}
                  placeholder="Full delivery address…"
                  rows={2}
                  className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                    Contact Name
                  </label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Receiver name…"
                    className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    placeholder="Phone number…"
                    className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 bg-white"
                  />
                </div>
              </div>
            </>
          )}

          {/* Reason (always visible when not "none") */}
          {overrideType !== "none" && (
            <div>
              <label className="text-[11px] font-bold text-[#5a5d74] block mb-1.5">
                Reason
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this override needed…"
                rows={2}
                className="w-full border-[1.5px] border-[#ededf3] rounded-lg px-3 py-2 text-[12.5px] text-[#1c1e30] placeholder:text-[#c2c4d6] focus:border-[#6366f1] focus:outline-none focus:ring-2 focus:ring-[#6366f1]/10 resize-none"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="px-4 py-2 text-[12.5px] font-semibold text-[#5a5d74] border border-[#ededf3] rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || loading}
            className="px-4 py-2 text-[12.5px] font-semibold text-white bg-[#6366f1] hover:bg-[#5558e6] rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
