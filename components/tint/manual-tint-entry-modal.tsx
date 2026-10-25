"use client";

// components/tint/manual-tint-entry-modal.tsx — "+ Add to Tint" (Tint Manager
// pill, or M). Rebuilt 2026-10-25 to docs/mockups/tint-add-to-tint/add-to-tint-v1.html.
//
// The server is lib/tint/manual-pull.ts: the lookup answers a LIST of matches,
// each with its own verdict, and every sentence the popup shows about a bill —
// refusal, pick warning, trip / invoice warnings — is written in
// lib/tint/manual-pull-rules.ts (judgePull's `reason`, pullWarnings). This file
// keeps no message table of its own beyond the session / permission / network
// lines, which no server sentence can carry.

import { useEffect, useRef, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PullMatch } from "@/lib/tint/manual-pull";
import { pullWarnings } from "@/lib/tint/manual-pull-rules";
import type { Operator } from "@/components/tint/manager/types";
import { SampleBadge } from "@/components/shared/sample-badge";

// ── Types ────────────────────────────────────────────────────────────────────

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

interface PullOk {
  ok: true;
  order: { id: number; obdNumber: string; workflowStage: string };
  cancelledPickerName: string | null;
  tripsLeft: string[];
  operatorName: string | null;
  markedSample: boolean;
}

interface ApiFail {
  ok: false;
  errorCode: string;
  message: string;
}

/** A line the popup shows instead of a server sentence. `login` adds the link. */
interface PopupError {
  text: string;
  login?: boolean;
}

const SESSION_EXPIRED: PopupError = { text: "Your session has expired — please log in again", login: true };
const NO_PERMISSION: PopupError   = { text: "You don't have permission to add bills to tint" };
const NO_SERVER: PopupError       = { text: "Could not reach the server — check the connection and try again" };
const SERVER_ERROR: PopupError    = { text: "Server error — please try again" };

/**
 * Read an API answer. A 401 — or an HTML page / redirect where JSON was due
 * (an expired session lands on the login page) — is the session line; a 403
 * is the permission line. Everything else is the JSON body.
 */
async function readApi<T>(res: Response): Promise<{ status: number; body: T } | PopupError> {
  if (res.status === 401) return SESSION_EXPIRED;
  if (res.status === 403) return NO_PERMISSION;
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!json || res.redirected) return res.status >= 500 ? SERVER_ERROR : SESSION_EXPIRED;
  try {
    return { status: res.status, body: (await res.json()) as T };
  } catch {
    return SERVER_ERROR;
  }
}

function isPopupError(x: unknown): x is PopupError {
  return typeof x === "object" && x !== null && "text" in x && !("body" in x);
}

// ── Display helpers ─────────────────────────────────────────────────────────

const STAGE_LABEL: Record<string, string> = {
  pending_support:         "Pending support",
  pending_picking:         "Pending picking",
  pick_assigned:           "Picking",
  pick_done:               "Picked",
  pick_checked:            "Checked",
  pending_tint_assignment: "Pending assignment",
  tint_assigned:           "Tint assigned",
  tinting_in_progress:     "Tinting",
  dispatched:              "Dispatched",
  cancelled:               "Cancelled",
  closed:                  "Closed",
  challan_linked:          "Challan linked",
};

function stageLabel(m: PullMatch): string {
  return STAGE_LABEL[m.workflowStage] ?? m.workflowStage;
}

/** A picker's stage — the amber pill naming who holds it. */
function isHeld(m: PullMatch): boolean {
  return m.verdict === "confirm";
}

function formatOrderDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  const day   = ist.getUTCDate();
  const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][ist.getUTCMonth()];
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} · ${hh}:${mm}`;
}

function qtyText(unitQty: number, volumeLine: number | null): string {
  return `${unitQty} ${unitQty === 1 ? "tin" : "tins"}${volumeLine != null ? ` · ${volumeLine} L` : ""}`;
}

/** The bill opens as a form (states 2–5, 8) unless it is refused for a reason
 *  other than having no lines — NO_LINES is drawn as state 8, not a red line. */
function opensAsForm(m: PullMatch): boolean {
  return m.verdict !== "refused" || m.refusalCode === "NO_LINES";
}

// ── Shared classes (CLAUDE_UI §9 / §10) ─────────────────────────────────────

const INPUT_CLS =
  "w-full h-[38px] px-3 text-[16px] sm:text-[13px] border border-gray-200 rounded-lg outline-none bg-white " +
  "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed";
const LABEL_CLS = "block text-[11px] font-medium text-gray-500 mb-1";
// Disabled = grey, never a faded primary; the border is always there so nothing shifts.
const BTN_OFF = "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed";
const BTN_DARK = "bg-gray-900 hover:bg-gray-800 border-gray-900 text-white";
const BTN_AMBER = "bg-amber-600 hover:bg-amber-700 border-amber-600 text-white";

function Banner({ tone, strong, children }: { tone: "info" | "warn" | "error" | "plain"; strong?: boolean; children: React.ReactNode }) {
  const cls = {
    info:  "bg-tint-bg border-tint-bd text-tint-700",
    warn:  "bg-warn-bg border-amber-200 text-warn-text",
    error: "bg-red-50 border-red-200 text-red-700",
    plain: "bg-gray-50 border-gray-200 text-gray-600",
  }[tone];
  return (
    <div className={`border rounded px-3 py-2 text-[12px] mb-3 ${cls} ${strong ? "border-l-[3px] border-l-warn font-semibold" : ""}`}>
      {children}
    </div>
  );
}

function ErrorLine({ error }: { error: PopupError }) {
  return (
    <Banner tone="error">
      {error.text}
      {error.login && (
        <a href="/login" className="ml-1.5 font-semibold underline">Log in</a>
      )}
    </Banner>
  );
}

function BillCard({ m, faded }: { m: PullMatch; faded?: boolean }) {
  const held = isHeld(m);
  const stagePill = (
    <span
      className={`inline-block shrink-0 whitespace-nowrap rounded-full border px-2 py-[2px] text-[10.5px] font-semibold ${
        held ? "bg-warn-bg border-amber-200 text-warn-text" : "bg-white border-gray-200 text-gray-600"
      }`}
    >
      {stageLabel(m)}{held && m.pickerName ? ` · ${m.pickerName}` : ""}
    </span>
  );
  const invoice = m.matchedInvoice ?? m.invoiceNos[0] ?? null;
  const moreInvoices = m.invoiceNos.length - (invoice !== null ? 1 : 0);
  return (
    <div className={`bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 mb-3 ${faded ? "opacity-75" : ""}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 text-[13.5px] font-bold text-gray-900">
          {m.customerName ?? "Unknown customer"}
        </div>
        {m.isSample && <SampleBadge />}
        <span className="hidden sm:inline-block">{stagePill}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-gray-600">
        <span className="sm:hidden">{stagePill}</span>
        <span><span className="text-gray-400 mr-1">OBD</span><span className="font-mono text-gray-800">{m.obdNumber}</span></span>
        <span>
          <span className="text-gray-400 mr-1">Invoice</span>
          <span className="font-mono text-gray-800">{invoice ?? "—"}</span>
          {moreInvoices > 0 && <span className="text-gray-400"> +{moreInvoices}</span>}
        </span>
        {m.trips.length > 0 && (
          <span><span className="text-gray-400 mr-1">Trip</span><span className="font-mono text-gray-800">{m.trips.map((t) => t.tripNumber).join(", ")}</span></span>
        )}
        {m.smu && (
          <span className="inline-flex items-center gap-1.5"><span className="w-[5px] h-[5px] rounded-full bg-blue-600" />{m.smu}</span>
        )}
        {m.orderDateTime && <span className="text-gray-400">{formatOrderDateTime(m.orderDateTime)}</span>}
      </div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

type Phase = "search" | "choose" | "bill";

export interface ManualTintEntryModalProps {
  open:       boolean;
  onClose:    () => void;
  /** After a pull — the popup has already toasted; the board refreshes. */
  onSuccess?: (obdNumber: string) => void;
  /** The board's operator list (GET /api/tint/manager/operators). */
  operators:  Operator[];
}

export function ManualTintEntryModal({ open, onClose, onSuccess, operators }: ManualTintEntryModalProps) {
  const [phase,        setPhase]        = useState<Phase>("search");
  const [termInput,    setTermInput]    = useState("");
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError,   setFetchError]   = useState<PopupError | null>(null);

  const [matches,     setMatches]     = useState<PullMatch[]>([]);
  const [chosenId,    setChosenId]    = useState<number | null>(null);
  const [current,     setCurrent]     = useState<PullMatch | null>(null);

  const [selectedLineIds, setSelectedLineIds] = useState<Set<number>>(new Set());
  const [reasonCode,      setReasonCode]      = useState<ReasonCode>("sample");
  const [reasonNotes,     setReasonNotes]     = useState("");
  const [sampleOn,        setSampleOn]        = useState(true);
  const [sampleTouched,   setSampleTouched]   = useState(false);
  const [operatorId,      setOperatorId]      = useState<number | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError,   setSubmitError]   = useState<PopupError | null>(null);
  const [notice,        setNotice]        = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Reset all state on open
  useEffect(() => {
    if (!open) return;
    setPhase("search");
    setTermInput("");
    setFetchLoading(false);
    setFetchError(null);
    setMatches([]);
    setChosenId(null);
    setCurrent(null);
    setSubmitLoading(false);
    setSubmitError(null);
    setNotice(null);
  }, [open]);

  // Autofocus the input in the search phase
  useEffect(() => {
    if (!open || phase !== "search") return;
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

  const trimmedTerm  = termInput.trim();
  const fetchEnabled = trimmedTerm.length > 0 && !fetchLoading;

  /** GET the lookup. Returns the matches, or sets the error and returns null. */
  async function lookup(term: string): Promise<PullMatch[] | null> {
    try {
      const res = await fetch(
        `/api/tint/manager/manual-entry/lookup?obd=${encodeURIComponent(term)}`,
        { method: "GET", credentials: "include" },
      );
      const read = await readApi<{ ok: true; matches: PullMatch[] } | ApiFail>(res);
      if (isPopupError(read)) { setFetchError(read); return null; }
      if (!read.body.ok) { setFetchError({ text: read.body.message }); return null; }
      return read.body.matches;
    } catch (e) {
      console.error("[add-to-tint] lookup failed", e);
      setFetchError(NO_SERVER);
      return null;
    }
  }

  /** Open one bill as the form, every line ticked, the defaults reset. */
  function openMatch(m: PullMatch) {
    setCurrent(m);
    setSelectedLineIds(new Set(m.lines.map((l) => l.id)));
    setReasonCode("sample");
    setReasonNotes("");
    setSampleOn(true);
    setSampleTouched(false);
    setOperatorId(null);
    setSubmitError(null);
    setNotice(null);
    setPhase("bill");
  }

  async function handleFetch() {
    if (!fetchEnabled) return;
    setFetchLoading(true);
    setFetchError(null);
    setCurrent(null);
    setMatches([]);
    const found = await lookup(trimmedTerm);
    setFetchLoading(false);
    if (found === null || found.length === 0) {
      if (found !== null) setFetchError({ text: `No bill found for ${trimmedTerm}` });
      return;
    }
    setMatches(found);
    if (found.length === 1) {
      const only = found[0];
      if (opensAsForm(only)) openMatch(only);
      else setCurrent(only); // state 7 — the red line under the input
      return;
    }
    // Several: the chooser. Pre-select only when exactly one can be pulled.
    const pullable = found.filter((m) => m.verdict !== "refused");
    setChosenId(pullable.length === 1 ? pullable[0].orderId : null);
    setPhase("choose");
  }

  function backToSearch() {
    setPhase("search");
    setCurrent(null);
    setMatches([]);
    setSubmitError(null);
    setFetchError(null);
    setNotice(null);
  }

  function backToChooser() {
    setPhase("choose");
    setChosenId(current?.orderId ?? null);
    setCurrent(null);
    setSubmitError(null);
    setNotice(null);
  }

  function changeReason(next: ReasonCode) {
    setReasonCode(next);
    // Untouched, the SAMPLE toggle follows the reason; once touched it stays.
    if (!sampleTouched) setSampleOn(next === "sample");
    if (submitError) setSubmitError(null);
  }

  function toggleLine(id: number) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function successToast(m: PullMatch, r: PullOk) {
    // Toast 10 — the operator could not be chosen (customer missing).
    if (m.customerMissing && r.operatorName === null) {
      toast.warning("Pulled to tint. Operator not assigned — fix customer details first, then assign.", {
        description: `${r.order.obdNumber} · waiting in Pending assignment`,
      });
      return;
    }
    // Toast 11 — only the parts that happened.
    const parts = [`${r.order.obdNumber} pulled to tint`];
    if (r.cancelledPickerName) parts.push(`${r.cancelledPickerName}'s pick cancelled`);
    if (r.tripsLeft.length > 0) parts.push(`off trip ${r.tripsLeft.join(", ")}`);
    if (r.operatorName) parts.push(`assigned to ${r.operatorName}`);
    if (r.markedSample) parts.push("SAMPLE");
    toast.success(parts.join(" · "));
  }

  async function handleSubmit() {
    if (!current || !submitEnabled) return;
    const m = current;
    const trimmedNotes = reasonNotes.trim();
    setSubmitLoading(true);
    setSubmitError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/tint/manager/manual-entry", {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId:           m.orderId,
          lineIds:           Array.from(selectedLineIds),
          reasonCode,
          reasonNotes:       trimmedNotes.length > 0 ? trimmedNotes : undefined,
          confirmCancelPick: m.verdict === "confirm",
          operatorId:        m.customerMissing ? null : operatorId,
          markSample:        sampleOn && !m.isSample,
        }),
      });
      const read = await readApi<PullOk | ApiFail>(res);
      if (isPopupError(read)) { setSubmitError(read); return; }
      const body = read.body;

      if (!body.ok) {
        // A picker took the bill while the popup was open: re-read it and show
        // the pick warning (state 3). The ticks, reason and operator stay.
        if (body.errorCode === "PICK_CONFIRM_REQUIRED") {
          const fresh = await lookup(m.obdNumber);
          const again = fresh?.find((x) => x.orderId === m.orderId) ?? null;
          if (again) {
            setCurrent(again);
            setSelectedLineIds((prev) => new Set(again.lines.filter((l) => prev.has(l.id)).map((l) => l.id)));
            setNotice("This bill changed while the popup was open — read the warning, then pull again.");
          } else {
            setSubmitError({ text: body.message });
          }
          return;
        }
        setSubmitError({ text: body.message });
        return;
      }

      successToast(m, body);
      onSuccess?.(body.order.obdNumber);
      onClose();
    } catch (e) {
      console.error("[add-to-tint] pull failed", e);
      setSubmitError(NO_SERVER);
    } finally {
      setSubmitLoading(false);
    }
  }

  function handleEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleFetch();
    }
  }

  const noLines         = current !== null && (current.refusalCode === "NO_LINES" || current.lines.length === 0);
  const otherNeedsNotes = reasonCode === "other" && reasonNotes.trim().length === 0;
  const submitEnabled   =
    current !== null && current.verdict !== "refused" && !noLines &&
    !submitLoading && selectedLineIds.size > 0 && !otherNeedsNotes;
  const pullAnyway      = current?.verdict === "confirm";

  const chosen = matches.find((m) => m.orderId === chosenId) ?? null;
  const continueEnabled = chosen !== null && opensAsForm(chosen);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={() => { if (!submitLoading) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-tint-entry-title"
        className="bg-white rounded-lg shadow-xl w-[520px] max-w-full max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 id="manual-tint-entry-title" className="text-[13px] font-semibold text-gray-900">
            Add to Tint
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

        {/* ── Search (states 1, 7, 9) ─────────────────────────────────── */}
        {phase === "search" && (
          <>
            <div className="px-4 py-3 overflow-y-auto">
              {fetchError?.login || fetchError === NO_PERMISSION ? <ErrorLine error={fetchError} /> : null}
              <label htmlFor="manual-tint-entry-obd" className={LABEL_CLS}>
                OBD or invoice number
              </label>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  id="manual-tint-entry-obd"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  value={termInput}
                  onChange={(e) => {
                    setTermInput(e.target.value);
                    if (fetchError) setFetchError(null);
                  }}
                  onKeyDown={handleEnter}
                  placeholder="e.g. 9106674240 or I536229654"
                  className={`${INPUT_CLS} flex-1 font-mono ${
                    fetchError || current ? "border-red-300 ring-2 ring-red-500/10" : ""
                  }`}
                />
                <button
                  type="button"
                  onClick={() => void handleFetch()}
                  disabled={!fetchEnabled}
                  className={`h-[38px] px-4 text-[13px] font-medium border rounded-lg ${fetchEnabled ? BTN_DARK : BTN_OFF}`}
                >
                  {fetchLoading ? "Fetching…" : "Fetch"}
                </button>
              </div>
              {fetchError && !fetchError.login && fetchError !== NO_PERMISSION && (
                <div className="mt-3"><ErrorLine error={fetchError} /></div>
              )}
              {current && !fetchError && (
                <div className="mt-3">
                  <BillCard m={current} faded />
                  <Banner tone="error">{current.reason}</Banner>
                </div>
              )}
              {!fetchError && !current && (
                <p className="text-[10.5px] text-gray-400 mt-2">Press Enter to fetch</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg flex-shrink-0">
              <button type="button" onClick={onClose} className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900">
                {current || fetchError ? "Close" : "Cancel"}
              </button>
            </div>
          </>
        )}

        {/* ── Chooser (state 6) ───────────────────────────────────────── */}
        {phase === "choose" && (
          <>
            <div className="px-4 py-3 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[12px] font-semibold text-gray-900">
                  {matches[0]?.matchedInvoice
                    ? <>Invoice <span className="font-mono">{matches[0].matchedInvoice}</span> covers {matches.length} OBDs — pick one</>
                    : <><span className="font-mono">{trimmedTerm}</span> found {matches.length} bills — pick one</>}
                </span>
                <button type="button" onClick={backToSearch} className="text-[11px] text-gray-500 hover:text-gray-700 underline">
                  Change
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                {matches.map((m) => {
                  const selectable = opensAsForm(m);
                  const sel = chosenId === m.orderId;
                  return (
                    <button
                      key={m.orderId}
                      type="button"
                      disabled={!selectable}
                      onClick={() => setChosenId(m.orderId)}
                      onDoubleClick={() => { if (selectable) openMatch(m); }}
                      className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 ${
                        sel ? "bg-brand-50 shadow-[inset_3px_0_0_#7C3AED]" : selectable ? "hover:bg-gray-50/60" : "cursor-not-allowed"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full flex-none ${
                          sel ? "border-[5px] border-brand-600" : selectable ? "border-[1.5px] border-gray-300" : "border-[1.5px] border-gray-300 bg-gray-100"
                        }`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-[12px] font-semibold truncate ${selectable ? "text-gray-900" : "text-gray-400"}`}>
                          {m.customerName ?? "Unknown customer"}
                        </span>
                        <span className="block text-[11px] text-gray-500 mt-px">
                          <span className="font-mono">{m.obdNumber}</span> · {stageLabel(m)}
                          {m.verdict !== "refused" ? ` · ${m.lines.length} ${m.lines.length === 1 ? "line" : "lines"}` : ""}
                        </span>
                        {m.verdict === "refused" && m.reason && (
                          <span className={`block text-[11px] mt-0.5 ${m.refusalCode === "NO_LINES" ? "text-gray-600" : "text-red-700"}`}>{m.reason}</span>
                        )}
                        {m.verdict !== "refused" && m.invoiceNote && (
                          <span className="block text-[11px] mt-0.5 text-tint-700">{m.invoiceNote}</span>
                        )}
                      </span>
                      {m.verdict === "ok" && (
                        <span className="rounded-full border px-2 py-[2px] text-[10.5px] font-semibold whitespace-nowrap bg-ok-bg border-green-200 text-ok-text">Can pull</span>
                      )}
                      {m.verdict === "confirm" && (
                        <span className="rounded-full border px-2 py-[2px] text-[10.5px] font-semibold whitespace-nowrap bg-warn-bg border-amber-200 text-warn-text">
                          {m.pickerName ? `Picker: ${m.pickerName}` : "In picking"}
                        </span>
                      )}
                      {m.verdict === "refused" && (
                        <span className="rounded-full border px-2 py-[2px] text-[10.5px] font-semibold whitespace-nowrap bg-red-50 border-red-200 text-red-700">Refused</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg flex-shrink-0">
              <button type="button" onClick={onClose} className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900">
                Cancel
              </button>
              <button
                type="button"
                disabled={!continueEnabled}
                onClick={() => { if (chosen && continueEnabled) openMatch(chosen); }}
                className={`h-[34px] px-4 text-[12px] font-medium border rounded-lg ${continueEnabled ? BTN_DARK : BTN_OFF}`}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* ── One bill (states 2–5, 8) ────────────────────────────────── */}
        {phase === "bill" && current && (
          <>
            <div className="px-4 py-3 overflow-y-auto">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[10.5px] text-gray-400">
                  Searched <span className="font-mono text-gray-800">{trimmedTerm}</span>
                </span>
                {matches.length > 1 ? (
                  <button type="button" onClick={backToChooser} className="text-[11px] text-gray-500 hover:text-gray-700 underline">
                    Back to the {matches.length} OBDs
                  </button>
                ) : (
                  <button type="button" onClick={backToSearch} className="text-[11px] text-gray-500 hover:text-gray-700 underline">
                    Change
                  </button>
                )}
              </div>

              <BillCard m={current} />

              {notice && <Banner tone="plain">{notice}</Banner>}
              {pullWarnings(current).map((w, i) => (
                <Banner key={i} tone={w.tone} strong={w.strong}>{w.text}</Banner>
              ))}
              {submitError && <ErrorLine error={submitError} />}

              {noLines ? (
                <Banner tone="plain">{current.reason ?? "No active lines on this OBD"}</Banner>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                      <span className="hidden sm:inline">Lines that need tinting</span>
                      <span className="sm:hidden">Lines</span>
                    </span>
                    <span className="text-[10.5px] text-gray-400">
                      {selectedLineIds.size} of {current.lines.length}<span className="hidden sm:inline"> ticked</span>
                    </span>
                  </div>
                  <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3">
                    {current.lines.map((line) => (
                      <label key={line.id} className="flex items-start gap-3 px-3 py-2 hover:bg-gray-50/60 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLineIds.has(line.id)}
                          onChange={() => toggleLine(line.id)}
                          className="mt-0.5 h-4 w-4 accent-brand-600 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-gray-900 truncate">
                            {line.skuDescriptionRaw ?? line.skuCodeRaw}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-px">
                            <span className="font-mono">{line.skuCodeRaw}</span>
                            <span className="sm:hidden"> · {qtyText(line.unitQty, line.volumeLine)}</span>
                          </div>
                        </div>
                        <div className="hidden sm:block text-[11px] text-gray-600 text-right whitespace-nowrap tabular-nums">
                          {qtyText(line.unitQty, line.volumeLine)}
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${noLines ? "opacity-60" : ""}`}>
                <div>
                  <label htmlFor="manual-tint-reason" className={LABEL_CLS}>Reason</label>
                  <select
                    id="manual-tint-reason"
                    value={reasonCode}
                    disabled={noLines}
                    onChange={(e) => changeReason(e.target.value as ReasonCode)}
                    className={INPUT_CLS}
                  >
                    {REASON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="manual-tint-operator" className={LABEL_CLS}>
                    Tint operator <span className="font-normal text-gray-400">(optional)</span>
                  </label>
                  <select
                    id="manual-tint-operator"
                    value={current.customerMissing || operatorId === null ? "" : String(operatorId)}
                    disabled={noLines || current.customerMissing}
                    onChange={(e) => setOperatorId(e.target.value === "" ? null : Number(e.target.value))}
                    className={INPUT_CLS}
                  >
                    <option value="">Assign later</option>
                    {operators.map((op) => (
                      <option key={op.id} value={op.id}>{op.name ?? `Operator #${op.id}`}</option>
                    ))}
                  </select>
                  {current.customerMissing && (
                    <p className="text-[10.5px] text-warn-text mt-1">Add the customer first, then assign</p>
                  )}
                </div>
              </div>

              {!noLines && (
                <>
                  <div className="mt-3 flex items-center justify-between gap-2.5 border border-gray-200 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-gray-900 flex items-center gap-1.5">
                        Mark as <SampleBadge />
                      </div>
                      <div className="hidden sm:block text-[10.5px] text-gray-400">
                        {current.isSample
                          ? "Already a sample"
                          : sampleTouched
                            ? "Your choice — the reason no longer changes it"
                            : reasonCode === "sample"
                              ? "On because the reason is Sample — you can turn it off"
                              : "Off — reason is not Sample"}
                      </div>
                      {current.isSample && <div className="sm:hidden text-[10.5px] text-gray-400">Already a sample</div>}
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={current.isSample || sampleOn}
                      aria-label="Mark as SAMPLE"
                      disabled={current.isSample}
                      onClick={() => { setSampleOn((v) => !v); setSampleTouched(true); }}
                      className={`relative w-9 h-5 rounded-full flex-none transition-colors ${
                        current.isSample || sampleOn ? "bg-brand-600" : "bg-gray-200"
                      } ${current.isSample ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                          current.isSample || sampleOn ? "left-[18px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <label htmlFor="manual-tint-notes" className={`${LABEL_CLS} mt-3`}>
                    {reasonCode === "other" ? <>Notes <span className="text-red-600">*</span></> : "Notes (optional)"}
                  </label>
                  <textarea
                    id="manual-tint-notes"
                    value={reasonNotes}
                    onChange={(e) => setReasonNotes(e.target.value)}
                    rows={2}
                    placeholder={reasonCode === "other" ? "Required when reason is Other" : "Add context (optional)"}
                    className={`w-full px-3 py-2 text-[16px] sm:text-[13px] border rounded-lg outline-none ${
                      otherNeedsNotes
                        ? "border-red-300 ring-2 ring-red-500/10"
                        : "border-gray-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                    }`}
                  />
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/30 rounded-b-lg flex-shrink-0">
              <span className="hidden sm:inline text-[10.5px] text-gray-400">
                {noLines ? "Nothing to pull." : "Audit log will record this pull."}
              </span>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitLoading}
                  className="h-[34px] px-3 text-[12px] text-gray-600 hover:text-gray-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!submitEnabled}
                  className={`flex-1 sm:flex-none justify-center h-10 sm:h-[34px] px-4 text-[13px] sm:text-[12px] font-medium border rounded-lg inline-flex items-center gap-1.5 ${
                    !submitEnabled ? BTN_OFF : pullAnyway ? BTN_AMBER : BTN_DARK
                  }`}
                >
                  {submitLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Pulling…
                    </>
                  ) : pullAnyway ? (
                    "Pull anyway"
                  ) : (
                    "Pull to tint"
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
