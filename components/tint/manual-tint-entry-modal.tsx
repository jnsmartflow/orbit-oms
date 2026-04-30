"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface FetchedLine {
  id:                number;
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  isTinting:         boolean;
}

interface FetchedOrder {
  id:            number;
  obdNumber:     string;
  customerName:  string | null;
  smu:           string;
  orderDateTime: string;
  workflowStage: string;
  orderType:     "tint" | "non_tint";
  lines:         FetchedLine[];
}

type ReasonCode =
  | "sample"
  | "custom_shade"
  | "late_addition"
  | "classification_miss"
  | "other";

const REASON_OPTIONS: Array<{ value: ReasonCode; label: string }> = [
  { value: "sample",              label: "Sample" },
  { value: "custom_shade",        label: "Custom Shade" },
  { value: "late_addition",       label: "Late Addition" },
  { value: "classification_miss", label: "Auto-classification Miss" },
  { value: "other",               label: "Other" },
];

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:             "OBD not found in system.",
  ALREADY_TINT:          "OBD is already in tint workflow.",
  PAST_TINT:             "OBD has already moved past tinting. Cannot pull back.",
  TOO_OLD:               "OBD's date is outside the eligible window (must be within the last 7 days).",
  INVALID_SMU:           "Tinting is only allowed for SMU Retail Offtake or Decorative Projects.",
  INVALID_LINES:         "One or more selected lines are invalid. Reload the OBD and try again.",
  INVALID_REASON:        "Please select a valid reason.",
  REASON_NOTES_REQUIRED: "Notes are required when reason is \"Other\".",
  INACTIVE_ORDER:        "This order is no longer active.",
  BAD_REQUEST:           "Invalid request. Please reload and try again.",
  INTERNAL_ERROR:        "Server error. Please try again.",
};

function errorMessageFor(code?: string): string {
  if (!code) return "Could not complete request. Please try again.";
  return ERROR_MESSAGES[code] ?? "Could not complete request. Please try again.";
}

// ── IST date formatter ──────────────────────────────────────────────────────

function formatOrderDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const day   = ist.getUTCDate();
  const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][ist.getUTCMonth()];
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} · ${hh}:${mm}`;
}

// ── Component ───────────────────────────────────────────────────────────────

type Phase = "empty" | "loaded";

export interface ManualTintEntryModalProps {
  open:       boolean;
  onClose:    () => void;
  onSuccess?: (obdNumber: string) => void;
}

export function ManualTintEntryModal({ open, onClose, onSuccess }: ManualTintEntryModalProps) {
  const [phase,        setPhase]        = useState<Phase>("empty");
  const [obdInput,     setObdInput]     = useState("");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);

  const [order,           setOrder]           = useState<FetchedOrder | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set());
  const [reasonCode,      setReasonCode]      = useState<ReasonCode>("sample");
  const [reasonNotes,     setReasonNotes]     = useState("");

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError,   setSubmitError]   = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset all state on modal open
  useEffect(() => {
    if (!open) return;
    setPhase("empty");
    setObdInput("");
    setFetchLoading(false);
    setFetchError(null);
    setOrder(null);
    setSelectedLineIds(new Set());
    setReasonCode("sample");
    setReasonNotes("");
    setSubmitLoading(false);
    setSubmitError(null);
  }, [open]);

  // Autofocus OBD input when in empty phase
  useEffect(() => {
    if (!open) return;
    if (phase !== "empty") return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, phase]);

  // Esc closes (blocked while submitting)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (submitLoading) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitLoading, onClose]);

  if (!open) return null;

  const trimmedObd   = obdInput.trim();
  const fetchEnabled = trimmedObd.length >= 6 && !fetchLoading;

  async function handleFetch() {
    if (!fetchEnabled) return;
    setFetchLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(
        `/api/tint/manager/manual-entry/lookup?obd=${encodeURIComponent(trimmedObd)}`,
        { method: "GET", credentials: "include" },
      );
      const json = (await res.json()) as
        | { ok: true;  order: FetchedOrder }
        | { ok: false; errorCode: string; message?: string };

      if (!json.ok) {
        setFetchError(errorMessageFor(json.errorCode));
        return;
      }

      setOrder(json.order);
      setSelectedLineIds(new Set(json.order.lines.map((l) => l.id)));
      setReasonCode("sample");
      setReasonNotes("");
      setPhase("loaded");
    } catch (e) {
      console.error("[manual-entry] fetch failed", e);
      setFetchError("Network error. Please try again.");
    } finally {
      setFetchLoading(false);
    }
  }

  async function handleSubmit() {
    if (!order) return;
    if (selectedLineIds.size === 0) return;

    const trimmedNotes = reasonNotes.trim();
    if (reasonCode === "other" && trimmedNotes.length === 0) {
      setSubmitError(errorMessageFor("REASON_NOTES_REQUIRED"));
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/tint/manager/manual-entry", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId:     order.id,
          lineIds:     Array.from(selectedLineIds),
          reasonCode,
          reasonNotes: trimmedNotes.length > 0 ? trimmedNotes : undefined,
        }),
      });
      const json = (await res.json()) as
        | { ok: true;  order: { id: number; obdNumber: string; workflowStage: string } }
        | { ok: false; errorCode: string; message?: string };

      if (!json.ok) {
        setSubmitError(errorMessageFor(json.errorCode));
        return;
      }

      onSuccess?.(json.order.obdNumber);
      onClose();
    } catch (e) {
      console.error("[manual-entry] submit failed", e);
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitLoading(false);
    }
  }

  function toggleLine(id: number) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeObd() {
    setPhase("empty");
    setOrder(null);
    setSelectedLineIds(new Set());
    setReasonCode("sample");
    setReasonNotes("");
    setSubmitError(null);
    setFetchError(null);
  }

  function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleFetch();
    }
  }

  const otherNeedsNotes = reasonCode === "other" && reasonNotes.trim().length === 0;
  const submitEnabled   = !submitLoading && selectedLineIds.size > 0 && !otherNeedsNotes;
  const notesInvalid    = otherNeedsNotes;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitLoading) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-tint-entry-title"
        className="bg-white rounded-lg shadow-xl w-[520px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2
            id="manual-tint-entry-title"
            className="text-[13px] font-semibold text-gray-900"
          >
            Pull OBD into Tint Workflow
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {phase === "empty" && (
          <>
            <div className="p-4">
              {fetchError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
                  {fetchError}
                </div>
              )}
              <label
                htmlFor="manual-tint-entry-obd"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                OBD Number
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  id="manual-tint-entry-obd"
                  type="text"
                  value={obdInput}
                  onChange={(e) => {
                    setObdInput(e.target.value);
                    if (fetchError) setFetchError(null);
                  }}
                  onKeyDown={handleEnter}
                  placeholder="e.g. 9106674240"
                  className={`flex-1 h-[38px] px-3 text-[13px] border rounded-lg outline-none ${
                    fetchError
                      ? "border-red-300 ring-2 ring-red-500/10"
                      : "border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                  }`}
                />
                <button
                  type="button"
                  onClick={handleFetch}
                  disabled={!fetchEnabled}
                  className={`h-[38px] px-4 text-[13px] font-medium bg-gray-900 hover:bg-gray-800 text-white rounded-lg ${
                    fetchEnabled ? "" : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {fetchLoading ? "Fetching…" : "Fetch"}
                </button>
              </div>
              <p className="text-[10.5px] text-gray-400 mt-2">Press Enter to fetch.</p>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === "loaded" && order && (
          <>
            <div className="px-4 py-3 max-h-[600px] overflow-y-auto">
              {/* Locked OBD row */}
              <div className="flex items-center gap-2 mb-3">
                <span className="font-mono text-[12px] text-gray-800 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded">
                  {order.obdNumber}
                </span>
                <span className="text-[11px] text-gray-400">
                  {formatOrderDateTime(order.orderDateTime)}
                </span>
                <button
                  type="button"
                  onClick={changeObd}
                  className="ml-auto text-[11px] text-gray-500 hover:text-gray-700 underline"
                >
                  Change OBD
                </button>
              </div>

              {/* Order info card */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-4">
                <div className="text-[13.5px] font-bold text-gray-900">
                  {order.customerName ?? "Unknown customer"}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-[5px] h-[5px] rounded-full bg-blue-600" />
                  <span className="text-[11px] text-gray-600">{order.smu}</span>
                </div>
              </div>

              {/* Submit error banner */}
              {submitError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-[12px] px-3 py-2 rounded mb-3">
                  {submitError}
                </div>
              )}

              {/* Lines header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                  Select lines that need tinting
                </span>
                <span className="text-[10.5px] text-gray-400">
                  {selectedLineIds.size} of {order.lines.length} selected
                </span>
              </div>

              {/* Lines list */}
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-4">
                {order.lines.map((line) => (
                  <label
                    key={line.id}
                    className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedLineIds.has(line.id)}
                      onChange={() => toggleLine(line.id)}
                      className="mt-0.5 h-4 w-4 accent-teal-600 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-gray-900 truncate">
                        {line.skuDescriptionRaw ?? line.skuCodeRaw}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        <span className="font-mono">{line.skuCodeRaw}</span>
                        <span className="text-gray-300 mx-1">·</span>
                        <span>
                          {line.unitQty} units
                          {line.volumeLine != null ? ` · ${line.volumeLine} L` : ""}
                        </span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Reason */}
              <label
                htmlFor="manual-tint-reason"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                Reason
              </label>
              <select
                id="manual-tint-reason"
                value={reasonCode}
                onChange={(e) => {
                  setReasonCode(e.target.value as ReasonCode);
                  if (submitError) setSubmitError(null);
                }}
                className="w-full h-[38px] px-3 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 mb-3 bg-white"
              >
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              {/* Notes */}
              <label
                htmlFor="manual-tint-notes"
                className="block text-[11px] font-medium text-gray-500 mb-1"
              >
                {reasonCode === "other" ? (
                  <>Notes <span className="text-red-600">*</span></>
                ) : (
                  "Notes (optional)"
                )}
              </label>
              <textarea
                id="manual-tint-notes"
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                rows={3}
                placeholder={
                  reasonCode === "other"
                    ? "Required when reason is Other"
                    : "Add context (optional)"
                }
                className={`w-full px-3 py-2 text-[13px] border rounded-lg outline-none ${
                  notesInvalid
                    ? "border-red-300 ring-2 ring-red-500/10"
                    : "border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                }`}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg flex-shrink-0">
              <span className="text-[10.5px] text-gray-400">
                Audit log will record this pull-in.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitLoading}
                  className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!submitEnabled}
                  className={`h-[34px] px-4 text-[12px] font-medium bg-gray-900 hover:bg-gray-800 text-white rounded-lg inline-flex items-center gap-1.5 ${
                    submitEnabled ? "" : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {submitLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Pulling…
                    </>
                  ) : (
                    "Pull into Tint"
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
