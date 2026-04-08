"use client";

import { useState, useEffect, useRef } from "react";
import { X, Send, Check } from "lucide-react";
import type { MoOrder } from "@/lib/mail-orders/types";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { getOrderFlags } from "@/lib/mail-orders/utils";
import { buildSlotSummaryHTML } from "@/lib/mail-orders/email-template";

interface SoCard {
  soName: string;
  displayName: string;
  orders: MoOrder[];
  totalLines: number;
  matchedLines: number;
  unmatchedLines: number;
  flaggedCount: number;
}

interface SoEmailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  slotName: string;
  orders: MoOrder[];
  senderName: string;
}

const NOTABLE_REASONS = ["out_of_stock", "cross_delivery", "cross_material_available"];

function buildCards(orders: MoOrder[]): SoCard[] {
  const map = new Map<string, MoOrder[]>();
  for (const o of orders) {
    if (!o.soNumber) continue;
    const key = o.soName?.toLowerCase() ?? "";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(o);
  }

  const cards: SoCard[] = [];
  for (const [, groupOrders] of Array.from(map.entries())) {
    let totalLines = 0;
    let matchedLines = 0;
    let flaggedCount = 0;

    for (const o of groupOrders) {
      for (const line of o.lines) {
        totalLines++;
        if (line.matchStatus === "matched") matchedLines++;
        if (line.lineStatus?.reason && NOTABLE_REASONS.includes(line.lineStatus.reason)) {
          flaggedCount++;
        }
      }
    }

    cards.push({
      soName: groupOrders[0].soName ?? "",
      displayName: smartTitleCase(
        (groupOrders[0].soName ?? "").replace(/^\([^)]*\)\s*/, "").trim(),
      ),
      orders: groupOrders,
      totalLines,
      matchedLines,
      unmatchedLines: totalLines - matchedLines,
      flaggedCount,
    });
  }

  cards.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return cards;
}

function getDateStr(): string {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = ist.getUTCFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function SoEmailPanel({
  isOpen,
  onClose,
  slotName,
  orders,
  senderName,
}: SoEmailPanelProps) {
  const cards = buildCards(orders);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Set<string>>(new Set());
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Reset state when panel opens with new data
  useEffect(() => {
    if (isOpen) {
      // Pre-fill emails from soEmail on orders
      const prefill: Record<string, string> = {};
      for (const card of cards) {
        const soEmail = card.orders[0]?.soEmail;
        if (soEmail) prefill[card.soName] = soEmail;
      }
      setEmails(prefill);
      setSent(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Auto-focus first input
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => firstInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const date = getDateStr();
  const totalOrders = cards.reduce((s, c) => s + c.orders.length, 0);

  async function handleSend(card: SoCard) {
    const email = emails[card.soName]?.trim();
    if (!email) return;

    const htmlContent = buildSlotSummaryHTML(
      card.soName,
      card.orders,
      slotName,
      date,
      senderName,
    );

    // Copy HTML to clipboard
    try {
      const blob = new Blob([htmlContent], { type: "text/html" });
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": blob }),
      ]);
    } catch {
      // Fallback: copy as plain text
      await navigator.clipboard.writeText(htmlContent);
    }

    // Open mailto
    const subject = `[JSW Dulux Surat] ${slotName} Slot Summary — ${date}`;
    window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}`);

    setSent((prev) => new Set(prev).add(card.soName));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="w-[420px] h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-gray-800">
                SO Emails · {slotName}
              </h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {totalOrders} order{totalOrders !== 1 ? "s" : ""} · {cards.length} SO{cards.length !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Card list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {cards.length === 0 && (
            <p className="text-[12px] text-gray-400 text-center py-8">
              No orders with SO numbers.
            </p>
          )}
          {cards.map((card, idx) => {
            const isSent = sent.has(card.soName);
            const emailVal = emails[card.soName] ?? "";

            if (isSent) {
              return (
                <div
                  key={card.soName}
                  className="border border-green-200 bg-green-50 rounded-lg px-4 py-3 flex items-center gap-2"
                >
                  <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <Check size={12} className="text-green-600" />
                  </div>
                  <span className="text-[13px] font-medium text-green-700 truncate">
                    {card.displayName}
                  </span>
                  <span className="text-[11px] text-green-500 ml-auto shrink-0">
                    Sent
                  </span>
                </div>
              );
            }

            return (
              <div
                key={card.soName}
                className="border border-gray-200 rounded-lg px-4 py-3 space-y-2.5"
              >
                {/* SO name + order count */}
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">
                    {card.displayName}
                  </p>
                  <span className="text-[11px] text-gray-400 shrink-0 ml-2">
                    {card.orders.length} order{card.orders.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-green-600 font-medium">
                    ✓ {card.matchedLines} matched
                  </span>
                  {card.unmatchedLines > 0 && (
                    <span className="text-red-500 font-medium">
                      ✗ {card.unmatchedLines} unmatched
                    </span>
                  )}
                  {card.flaggedCount > 0 && (
                    <span className="text-amber-600 font-medium">
                      {card.flaggedCount} items to note
                    </span>
                  )}
                </div>

                {/* Email input + send */}
                <div className="flex items-center gap-2">
                  <input
                    ref={idx === 0 ? firstInputRef : undefined}
                    type="email"
                    placeholder="Enter SO email address"
                    value={emailVal}
                    onChange={(e) =>
                      setEmails((prev) => ({
                        ...prev,
                        [card.soName]: e.target.value,
                      }))
                    }
                    className="flex-1 min-w-0 text-[13px] px-3 py-1.5 border border-gray-200 rounded-md outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 placeholder:text-gray-300"
                  />
                  <button
                    onClick={() => handleSend(card)}
                    disabled={!emailVal.trim()}
                    className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send <Send size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
