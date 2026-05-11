"use client";

import { useEffect } from "react";
import { ORDER_TO } from "@/lib/place-order/email";

// Send-confirm overlay (planning doc §8.6).
//
// Shows a preview of the email body the operator is about to send, plus the
// To: and Subject: lines. Modal-style: dark backdrop, centred white panel.
//
// Keyboard while open:
//   Enter or /  → submit (calls onSend → mailto:… opens in default client)
//   Esc or *    → cancel (calls onCancel → hide overlay)
//
// While the overlay is mounted, the page-level keyboard router bails out
// (see useKeyboardRouting's `confirmOpen` flag). All key dispatch happens
// here so we don't double-handle.

interface SendConfirmOverlayProps {
  subject:   string;
  body:      string;
  onSend:    () => void;
  onCancel:  () => void;
}

export default function SendConfirmOverlay({
  subject, body, onSend, onCancel,
}: SendConfirmOverlayProps): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Enter" || e.key === "/") {
        e.preventDefault();
        onSend();
      } else if (e.key === "Escape" || e.key === "*") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSend, onCancel]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6">
      <div className="w-[560px] max-w-full bg-white rounded-[12px] shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-[14px] font-semibold text-gray-900">Send order email</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            Opens your default mail client with the body below pre-filled.
          </div>
        </div>

        <div className="px-5 py-4 space-y-2.5">
          <div className="flex gap-2 text-[11px]">
            <span className="text-gray-400 uppercase tracking-wide w-[60px] shrink-0 pt-0.5">To</span>
            <span className="font-mono text-gray-900">{ORDER_TO}</span>
          </div>
          <div className="flex gap-2 text-[11px]">
            <span className="text-gray-400 uppercase tracking-wide w-[60px] shrink-0 pt-0.5">Subject</span>
            <span className="font-mono text-gray-900">{subject}</span>
          </div>
          <div className="flex gap-2 text-[11px]">
            <span className="text-gray-400 uppercase tracking-wide w-[60px] shrink-0 pt-0.5">Body</span>
            <pre className="font-mono text-[12px] text-gray-900 whitespace-pre-wrap break-words flex-1 max-h-[260px] overflow-y-auto bg-gray-50 border border-gray-100 rounded-[6px] p-3">
              {body}
            </pre>
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-[10px] text-gray-400">
            <span className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5">/</span>
            {" or "}
            <span className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5">Enter</span>
            {" send · "}
            <span className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5">Esc</span>
            {" cancel"}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-9 px-4 rounded-[8px] text-[13px] text-gray-600 border border-gray-200 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={onSend}
              className="h-9 px-4 rounded-[8px] text-[13px] font-medium bg-gray-900 text-white hover:bg-gray-800"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
