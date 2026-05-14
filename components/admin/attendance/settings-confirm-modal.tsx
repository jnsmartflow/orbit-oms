"use client";

import { useEffect } from "react";

export type SettingsConfirmKind = "reconsent" | "killswitch";

interface SettingsConfirmModalProps {
  kind: SettingsConfirmKind;
  onConfirm(): void;
  onCancel(): void;
}

const COPY: Record<
  SettingsConfirmKind,
  { title: string; body: string; confirmLabel: string }
> = {
  reconsent: {
    title: "Force re-consent for all users?",
    body:
      "Bumping DPDP consent version will sign every user out on their next session and ask them to re-accept the data policy. This is irreversible.",
    confirmLabel: "Yes, force re-consent",
  },
  killswitch: {
    title: "Disable OT claim prompt?",
    body:
      "With this off, every check-out past trigger time will auto-credit OT minutes without asking the user. There is no audit trail of consent. Use as a kill switch only.",
    confirmLabel: "Yes, disable",
  },
};

export function SettingsConfirmModal({
  kind,
  onConfirm,
  onCancel,
}: SettingsConfirmModalProps) {
  // Esc to cancel — same dismissal contract as the OT modals.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const copy = COPY[kind];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={`settings-confirm-${kind}-title`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id={`settings-confirm-${kind}-title`}
          className="text-[16px] font-semibold text-gray-900 mb-3"
        >
          {copy.title}
        </h3>
        <p className="text-[13px] text-gray-600 leading-relaxed mb-5">
          {copy.body}
        </p>
        <div className="flex justify-end items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 text-[13px] text-gray-500 hover:text-gray-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="h-9 px-4 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-md"
          >
            {copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
