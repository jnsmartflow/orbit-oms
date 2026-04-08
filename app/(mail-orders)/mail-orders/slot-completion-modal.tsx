"use client";

import { useState, useEffect } from "react";
import { X, Check } from "lucide-react";
import { useSession } from "next-auth/react";
import type { MoOrder } from "@/lib/mail-orders/types";
import { smartTitleCase, buildReplyTemplate, getOrderFlags, getOrderVolume } from "@/lib/mail-orders/utils";
import { SoEmailPanel } from "@/components/mail-orders/so-email-panel";

interface SoGroup {
  soName: string;
  displayName: string;
  orders: MoOrder[];
}

interface SlotCompletionModalProps {
  slot: string;
  orders: MoOrder[];
  onDismiss: () => void;
}

export function SlotCompletionModal({
  slot,
  orders,
  onDismiss,
}: SlotCompletionModalProps) {
  const { data: session } = useSession();
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [isSoEmailPanelOpen, setIsSoEmailPanelOpen] = useState(false);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  // Group punched orders by soName
  const soGroups: SoGroup[] = (() => {
    const map = new Map<string, MoOrder[]>();
    for (const o of orders) {
      if (o.status !== "punched" || !o.soNumber) continue;
      const key = o.soName?.toLowerCase() ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    const groups: SoGroup[] = [];
    for (const [, groupOrders] of Array.from(map.entries())) {
      groups.push({
        soName: groupOrders[0].soName ?? "",
        displayName: smartTitleCase(
          (groupOrders[0].soName ?? "").replace(/^\([^)]*\)\s*/, "").trim()
        ),
        orders: groupOrders,
      });
    }
    groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return groups;
  })();

  const totalVol = Math.round(orders.reduce((s, o) => s + getOrderVolume(o.lines), 0));

  function flash(key: string) {
    setCopiedAction(key);
    setTimeout(() => setCopiedAction(null), 1500);
  }

  function handleCopySap(group: SoGroup) {
    const soNos = group.orders.map(o => o.soNumber).filter(Boolean).join("\n");
    navigator.clipboard.writeText(soNos);
    flash(`${group.soName}-sap`);
  }

  function handleCopyReply(group: SoGroup) {
    const orderData = group.orders.map(o => ({
      customerName: smartTitleCase(o.customerName ?? o.subject),
      customerCode: o.customerCode,
      area: o.customerArea ?? null,
      soNumber: o.soNumber ?? "",
      flags: getOrderFlags(o),
    }));
    const template = buildReplyTemplate(group.soName, orderData);
    navigator.clipboard.writeText(template);
    flash(`${group.soName}-reply`);
  }

  function handleCopyAllSap() {
    const allSoNos = soGroups
      .flatMap(g => g.orders.map(o => o.soNumber))
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(allSoNos);
    flash("all-sap");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      onClick={onDismiss}
    >
      <div
        className="w-[520px] bg-white rounded-xl shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-[32px] h-[32px] rounded-full bg-green-50 flex items-center justify-center">
                <Check size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-[18px] font-bold text-gray-800">
                  {slot} Complete
                </h2>
                <p className="text-[12px] text-gray-500">
                  {orders.length} order{orders.length !== 1 ? "s" : ""}
                  {" \u00b7 "}
                  {soGroups.length} SO{soGroups.length !== 1 ? "s" : ""}
                  {totalVol > 0 && ` \u00b7 ${totalVol.toLocaleString()}L`}
                </p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-3 overflow-y-auto divide-y divide-gray-100" style={{ maxHeight: 400 }}>
          {soGroups.length === 0 && (
            <p className="text-[12px] text-gray-400 py-4 text-center">
              No orders with SO numbers in this slot.
            </p>
          )}
          {soGroups.map(group => (
            <div key={group.soName} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-gray-800 truncate">
                  {group.displayName}
                </p>
                <p className="text-[11px] text-gray-400">
                  {group.orders.length} order{group.orders.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleCopySap(group)}
                  className={`text-[11px] font-medium border rounded-md px-3 h-[28px] transition-colors ${
                    copiedAction === `${group.soName}-sap`
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {copiedAction === `${group.soName}-sap` ? "Copied \u2713" : "SAP"}
                </button>
                <button
                  onClick={() => handleCopyReply(group)}
                  className={`text-[11px] font-medium border rounded-md px-3 h-[28px] transition-colors ${
                    copiedAction === `${group.soName}-reply`
                      ? "bg-green-50 text-green-700 border-green-200"
                      : "bg-teal-600 text-white border-teal-600 hover:bg-teal-700"
                  }`}
                >
                  {copiedAction === `${group.soName}-reply` ? "Copied \u2713" : "Reply"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={handleCopyAllSap}
            className={`text-[12px] font-medium border rounded-md px-4 h-[32px] transition-colors ${
              copiedAction === "all-sap"
                ? "bg-green-50 text-green-700 border-green-200"
                : "text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            {copiedAction === "all-sap" ? "Copied \u2713" : "Copy All SAP"}
          </button>
          <button
            onClick={() => setIsSoEmailPanelOpen(true)}
            className="text-[12px] font-medium border border-gray-200 text-gray-600 rounded-md px-4 h-[32px] hover:bg-gray-50 transition-colors"
          >
            Send SO Emails
          </button>
          <button
            onClick={onDismiss}
            className="text-[12px] font-medium bg-teal-600 text-white border border-teal-600 rounded-md px-4 h-[32px] hover:bg-teal-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>

      <SoEmailPanel
        isOpen={isSoEmailPanelOpen}
        onClose={() => setIsSoEmailPanelOpen(false)}
        slotName={slot}
        orders={orders}
        senderName={session?.user?.name ?? "Billing Operator"}
      />
    </div>
  );
}
