"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import {
  X,
  Upload,
  FileText,
  Calendar,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Download as DownloadIcon,
  ExternalLink,
} from "lucide-react";
import { getTodayIST } from "@/lib/dates";
import type {
  ImportPreviewResponse,
  ImportConfirmResponse,
  SapPreviewResponse,
  SapConfirmResponse,
} from "@/lib/import-types";

// ── Types ────────────────────────────────────────────────────────────────────

type Stage =
  | "idle"
  | "parsing"
  | "preview"
  | "confirm-intent"
  | "submitting"
  | "result"
  | "error";

type Format = "sap" | "manual-template";

type UnifiedOutcome = "new" | "patch" | "skipped" | "error";

interface UnifiedSummary {
  total:    number;
  new:      number;
  patch:    number;
  skipped:  number;
  errored:  number;
  warnings: number;
}

interface UnifiedRow {
  key:       string;
  obdNumber: string;
  outcome:   UnifiedOutcome;
  lineCount: number;
  qty:       number | null;
  issues:    string[];
}

interface ResultCell {
  label: string;
  value: number;
  tone:  "neutral" | "amber";
}

const SAP_MAX_BYTES = 10 * 1024 * 1024;

export interface ImportModalProps {
  open:    boolean;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ImportModal({ open, onClose }: ImportModalProps): React.JSX.Element | null {
  const [stage,           setStage]           = useState<Stage>("idle");
  const [format,          setFormat]          = useState<Format>("sap");
  const [previewEnabled,  setPreviewEnabled]  = useState<boolean>(false);
  const [file,            setFile]            = useState<File | null>(null);
  // obdEmailDate stored as YYYY-MM-DD string, matching getTodayIST() return
  // and the server FormData contract. Prompt's `useState<Date>` was a typo.
  const [obdEmailDate,    setObdEmailDate]    = useState<string>(getTodayIST());
  const [previewData,     setPreviewData]     = useState<SapPreviewResponse | ImportPreviewResponse | null>(null);
  const [resultData,      setResultData]      = useState<SapConfirmResponse | ImportConfirmResponse | null>(null);
  const [errorMessage,    setErrorMessage]    = useState<string | null>(null);
  const [pickerError,     setPickerError]     = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Reset and close helpers ───────────────────────────────────────────────

  function resetAll(): void {
    setStage("idle");
    setFormat("sap");
    setPreviewEnabled(false);
    setFile(null);
    setObdEmailDate(getTodayIST());
    setPreviewData(null);
    setResultData(null);
    setErrorMessage(null);
    setPickerError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Used by error state's Try Again — preserves format and previewEnabled.
  function resetForRetry(): void {
    setStage("idle");
    setFile(null);
    setObdEmailDate(getTodayIST());
    setPreviewData(null);
    setResultData(null);
    setErrorMessage(null);
    setPickerError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeAndReset(): void {
    resetAll();
    onClose();
  }

  function attemptClose(reason: "backdrop" | "x" | "esc"): void {
    switch (stage) {
      case "idle":
      case "result":
      case "error":
        closeAndReset();
        return;
      case "parsing":
      case "submitting":
        // Backdrop and Esc blocked silently. X surfaces a confirm prompt.
        if (reason === "x") {
          if (window.confirm("Cancel this import? The request is in flight.")) {
            closeAndReset();
          }
        }
        return;
      case "preview":
        if (window.confirm("Discard this import? Your file will be cleared.")) {
          closeAndReset();
        }
        return;
      case "confirm-intent":
        // Esc reverts to preview without prompting; backdrop and X prompt.
        if (reason === "esc") {
          setStage("preview");
          return;
        }
        if (window.confirm("Discard this import? Your file will be cleared.")) {
          closeAndReset();
        }
        return;
    }
  }

  // ── Esc handler ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        attemptClose("esc");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage]);

  // ── File selection ───────────────────────────────────────────────────────

  function handleFileSelect(f: File): void {
    if (f.size > SAP_MAX_BYTES) {
      setPickerError("File too large (max 10 MB)");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".xlsx")) {
      setPickerError("Only .xlsx files accepted");
      return;
    }
    setPickerError(null);
    setFile(f);
  }

  function handleRemoveFile(): void {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFormatChange(f: Format): void {
    if (file !== null) return; // toggle locked once a file is loaded
    setFormat(f);
  }

  function handleDownloadTemplate(): void {
    // Static files served from /public/import-templates/. If a file isn't
    // present yet the browser will 404 — acceptable graceful failure; no
    // toast / error UI by design (operator can ask whoever curates blanks).
    const url = format === "sap"
      ? "/import-templates/sap-blank.xlsx"
      : "/import-templates/manual-template-blank.xlsx";
    const a = document.createElement("a");
    a.href     = url;
    a.download = url.split("/").pop()!;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // ── Primary CTA dispatch (idle stage) ────────────────────────────────────

  async function handlePrimaryFromIdle(): Promise<void> {
    if (!file) return;
    if (previewEnabled) {
      await runPreview();
    } else {
      await runDirectImport();
    }
  }

  async function runPreview(): Promise<void> {
    setStage("parsing");
    setErrorMessage(null);
    try {
      if (format === "sap") {
        const fd = new FormData();
        fd.append("file",         file!);
        fd.append("obdEmailDate", obdEmailDate);
        const res = await fetch("/api/import/obd?action=manual-sap-preview", {
          method: "POST",
          body:   fd,
        });
        const data = (await res.json()) as SapPreviewResponse & { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        setPreviewData(data);
      } else {
        const fd = new FormData();
        fd.append("templateId",   "combined_v2");
        fd.append("combinedFile", file!);
        const res = await fetch("/api/import/obd?action=preview", {
          method: "POST",
          body:   fd,
        });
        const data = (await res.json()) as ImportPreviewResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Preview failed");
        setPreviewData(data);
      }
      setStage("preview");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Preview failed");
      setStage("error");
    }
  }

  async function runDirectImport(): Promise<void> {
    setStage("submitting");
    setErrorMessage(null);
    try {
      if (format === "sap") {
        const fd = new FormData();
        fd.append("file",         file!);
        fd.append("obdEmailDate", obdEmailDate);
        const res = await fetch("/api/import/obd?action=manual-sap-confirm", {
          method: "POST",
          body:   fd,
        });
        const data = (await res.json()) as SapConfirmResponse & { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        setResultData(data);
      } else {
        // Manual template: preview internally to obtain batchId, then confirm.
        // User does not see the preview UI in this code path.
        const fd = new FormData();
        fd.append("templateId",   "combined_v2");
        fd.append("combinedFile", file!);
        const previewRes = await fetch("/api/import/obd?action=preview", {
          method: "POST",
          body:   fd,
        });
        const preview = (await previewRes.json()) as ImportPreviewResponse & { error?: string };
        if (!previewRes.ok) throw new Error(preview.error ?? "Import failed");

        const validIds = preview.obds
          .filter((o) => o.rowStatus === "valid" || o.rowStatus === "warning")
          .map((o) => o.rawSummaryId);
        if (validIds.length === 0) {
          throw new Error("No valid OBDs found — nothing was imported");
        }

        setPreviewData(preview);

        const confirmRes = await fetch("/api/import/obd?action=confirm", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ batchId: preview.batchId, confirmedObdIds: validIds }),
        });
        const confirmed = (await confirmRes.json()) as ImportConfirmResponse & { error?: string };
        if (!confirmRes.ok) throw new Error(confirmed.error ?? "Import failed");
        setResultData(confirmed);
      }
      setStage("result");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Import failed");
      setStage("error");
    }
  }

  // ── Confirm flow (preview ON path) ───────────────────────────────────────

  function handleConfirmFromPreview(): void {
    setStage("confirm-intent");
  }

  function handleConfirmCancel(): void {
    setStage("preview");
  }

  async function handleConfirmYes(): Promise<void> {
    if (!file) return;
    setStage("submitting");
    setErrorMessage(null);
    try {
      if (format === "sap") {
        const fd = new FormData();
        fd.append("file",         file);
        fd.append("obdEmailDate", obdEmailDate);
        const res = await fetch("/api/import/obd?action=manual-sap-confirm", {
          method: "POST",
          body:   fd,
        });
        const data = (await res.json()) as SapConfirmResponse & { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Confirm failed");
        setResultData(data);
      } else {
        const preview = previewData as ImportPreviewResponse;
        const validIds = preview.obds
          .filter((o) => o.rowStatus === "valid" || o.rowStatus === "warning")
          .map((o) => o.rawSummaryId);
        const res = await fetch("/api/import/obd?action=confirm", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ batchId: preview.batchId, confirmedObdIds: validIds }),
        });
        const data = (await res.json()) as ImportConfirmResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Confirm failed");
        setResultData(data);
      }
      setStage("result");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Confirm failed");
      setStage("error");
    }
  }

  function handlePreviewCancel(): void {
    if (window.confirm("Discard this import? Your file will be cleared.")) {
      closeAndReset();
    }
  }

  function handleResultDone(): void {
    closeAndReset();
  }

  function handleResultImportAnother(): void {
    resetAll();
  }

  function handleErrorTryAgain(): void {
    resetForRetry();
  }

  function handleErrorCancel(): void {
    closeAndReset();
  }

  // ── Render guard ─────────────────────────────────────────────────────────

  if (!open) return null;

  // ── Derive unified preview data (for preview/confirm-intent stages) ──────

  const summary = previewData ? toUnifiedSummary(previewData, format) : null;
  const rows    = previewData ? toUnifiedRows(previewData, format)    : [];
  const importableCount = summary ? summary.new + summary.patch : 0;

  // ── Body subtree by stage ────────────────────────────────────────────────

  const isInFlight = stage === "parsing" || stage === "submitting";
  const isLocked   = file !== null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => attemptClose("backdrop")}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-modal-title"
        className="w-[520px] bg-white rounded-lg shadow-xl flex flex-col"
        style={{ maxHeight: "calc(100vh - 80px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
          <div id="import-modal-title" className="text-[13px] font-semibold text-gray-900">
            Import OBDs
          </div>
          <button
            type="button"
            onClick={() => attemptClose("x")}
            className="text-gray-400 hover:text-gray-600 cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — branches by stage */}
        {(stage === "idle" || stage === "parsing" || stage === "submitting") && (
          <div className="flex-1 overflow-y-auto p-5 relative">
            {isInFlight && (
              <div className="absolute inset-0 bg-white/60 z-10 flex items-center justify-center pointer-events-none">
                <Loader2 className="animate-spin text-gray-500" size={28} />
              </div>
            )}

            {/* Format toggle row + Download blank template */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Source format</p>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="text-[10.5px] text-gray-500 hover:text-gray-900 cursor-pointer flex items-center gap-1 underline-offset-2 hover:underline"
                  title="Download a blank import template"
                >
                  <DownloadIcon size={11} />
                  Download blank template
                </button>
              </div>
              <div className={`inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px] ${isLocked ? "opacity-60" : ""}`}>
                <button
                  type="button"
                  disabled={isLocked || isInFlight}
                  onClick={() => handleFormatChange("sap")}
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] ${
                    format === "sap"
                      ? "bg-gray-900 text-white font-medium"
                      : "text-gray-500 hover:bg-white/60"
                  } ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  SAP file
                </button>
                <button
                  type="button"
                  disabled={isLocked || isInFlight}
                  onClick={() => handleFormatChange("manual-template")}
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] ${
                    format === "manual-template"
                      ? "bg-gray-900 text-white font-medium"
                      : "text-gray-500 hover:bg-white/60"
                  } ${isLocked ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  Manual template
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                {format === "sap"
                  ? "SAP OBT export. Single .xlsx file."
                  : "Manual template (combined_v2). Single .xlsx with two sheets."}
              </p>
            </div>

            {/* File area: drop zone OR file-loaded chip */}
            {file === null ? (
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-7 flex flex-col items-center justify-center text-center hover:border-gray-400 cursor-pointer transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) handleFileSelect(f);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />
                <Upload size={28} className="text-gray-400 mb-2" strokeWidth={1.6} />
                <p className="text-[12px] text-gray-700 font-medium">Drop file here or click to browse</p>
                <p className="text-[10px] text-gray-400 mt-1">.xlsx files only · max 10 MB</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg p-3 flex items-center gap-3 bg-gray-50">
                <div className="w-9 h-9 rounded bg-white border border-gray-200 flex items-center justify-center flex-shrink-0">
                  <FileText size={18} className="text-gray-500" strokeWidth={1.6} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11.5px] font-medium font-mono text-gray-900 truncate">{file.name}</p>
                  <p className="text-[10px] text-gray-400">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  disabled={isInFlight}
                  className="text-gray-400 hover:text-gray-600 cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Remove file"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* OBD Date picker — SAP only */}
            {format === "sap" && (
              <div className="mt-4">
                <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider block mb-1.5">
                  OBD Date
                </label>
                <input
                  type="date"
                  value={obdEmailDate}
                  onChange={(e) => setObdEmailDate(e.target.value)}
                  disabled={isInFlight}
                  className="w-full border border-gray-200 rounded-[5px] px-3 py-2 text-[11px] text-gray-900 hover:border-gray-300 focus:outline-none focus:border-gray-400 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Defaults to today. Set to actual file date if importing yesterday&apos;s data.
                </p>
              </div>
            )}

            {/* Preview toggle row */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-gray-900">Preview before import</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">Review changes per-OBD before writing to live tables.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewEnabled((v) => !v)}
                  disabled={isInFlight}
                  role="switch"
                  aria-checked={previewEnabled}
                  className={`relative inline-flex h-[18px] w-[32px] flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                    previewEnabled ? "bg-gray-900" : "bg-gray-300"
                  }`}
                  style={{ padding: 2 }}
                >
                  <span
                    className="inline-block h-[14px] w-[14px] rounded-full bg-white transition-transform duration-200"
                    style={{
                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                      transform: previewEnabled ? "translateX(14px)" : "translateX(0)",
                    }}
                  />
                </button>
              </div>
            </div>

            {/* Amber notice — preview OFF + file loaded */}
            {!previewEnabled && file !== null && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-[5px] px-3 py-2 flex items-start gap-2">
                <AlertTriangle size={13} className="text-amber-700 flex-shrink-0 mt-0.5" />
                <p className="text-[10.5px] text-amber-800 leading-snug">
                  Preview is off. Clicking <b>Import</b> will write to live tables immediately. Recommended for SAP imports — switch on to review changes first.
                </p>
              </div>
            )}

            {/* Picker error (file too large / wrong type) */}
            {pickerError && (
              <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded px-3 py-2">
                {pickerError}
              </div>
            )}
          </div>
        )}

        {/* PREVIEW stage body */}
        {stage === "preview" && (
          <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: "65vh" }}>
            {/* Format toggle disabled */}
            <div className="mb-3">
              <div className="inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px] opacity-60">
                <button
                  disabled
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] cursor-not-allowed ${
                    format === "sap" ? "bg-gray-900 text-white font-medium" : "text-gray-500"
                  }`}
                >
                  SAP file
                </button>
                <button
                  disabled
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] cursor-not-allowed ${
                    format === "manual-template" ? "bg-gray-900 text-white font-medium" : "text-gray-500"
                  }`}
                >
                  Manual template
                </button>
              </div>
            </div>

            {/* File chips */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 bg-gray-100 rounded-[5px] px-2 py-1 text-[10.5px] font-mono text-gray-700">
                <FileText size={11} className="text-gray-500" />
                {file?.name ?? "—"}
              </span>
              {format === "sap" && (
                <span className="inline-flex items-center gap-1 bg-gray-100 rounded-[5px] px-2 py-1 text-[10.5px] text-gray-700">
                  <Calendar size={10} className="text-gray-500" />
                  {formatHumanDate(obdEmailDate)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-[5px] px-2 py-1 text-[10px] text-gray-600">
                <Eye size={10} className="text-gray-500" />
                Preview ON
              </span>
            </div>

            {summary && <SummaryPills summary={summary} />}
            {rows.length > 0 && <ObdTable rows={rows} />}
            {rows.length > 12 && (
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Showing all {rows.length} OBDs · scroll within this pane
              </p>
            )}
          </div>
        )}

        {/* CONFIRM-INTENT stage body */}
        {stage === "confirm-intent" && (
          <div className="flex-1 overflow-y-auto p-5" style={{ maxHeight: "60vh" }}>
            {/* Format toggle disabled */}
            <div className="mb-4">
              <div className="inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px] opacity-60">
                <button
                  disabled
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] cursor-not-allowed ${
                    format === "sap" ? "bg-gray-900 text-white font-medium" : "text-gray-500"
                  }`}
                >
                  SAP file
                </button>
                <button
                  disabled
                  className={`px-[14px] py-[5px] text-[11px] rounded-[5px] cursor-not-allowed ${
                    format === "manual-template" ? "bg-gray-900 text-white font-medium" : "text-gray-500"
                  }`}
                >
                  Manual template
                </button>
              </div>
            </div>

            {/* File chips */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 bg-gray-100 rounded-[5px] px-2 py-1 text-[10.5px] font-mono text-gray-700">
                <FileText size={11} className="text-gray-500" />
                {file?.name ?? "—"}
              </span>
              {format === "sap" && (
                <span className="inline-flex items-center gap-1 bg-gray-100 rounded-[5px] px-2 py-1 text-[10.5px] text-gray-700">
                  <Calendar size={10} className="text-gray-500" />
                  {formatHumanDate(obdEmailDate)}
                </span>
              )}
            </div>

            {summary && <SummaryPills summary={summary} />}
            {/* Compact table — only importable rows */}
            {rows.length > 0 && (() => {
              const importable = rows.filter((r) => r.outcome === "new" || r.outcome === "patch");
              return importable.length > 0 ? <ObdTable rows={importable} /> : null;
            })()}
          </div>
        )}

        {/* RESULT stage body */}
        {stage === "result" && resultData && (() => {
          const cells    = toResultCells(resultData, previewData, format);
          const batchRef = resultData.batchRef;
          return (
            <div className="px-8 py-8 flex flex-col items-center text-center flex-shrink-0">
              <div className="w-12 h-12 rounded-full bg-green-50 border border-green-200 flex items-center justify-center mb-3">
                <CheckCircle2 size={24} className="text-green-600" strokeWidth={2.5} />
              </div>
              <h2 className="text-[14px] font-semibold text-gray-900 mb-1">Import Complete</h2>
              <span className="inline-flex items-center gap-1 bg-gray-100 rounded-[5px] px-2.5 py-1 text-[11px] font-mono text-gray-700 mb-5">
                {batchRef}
              </span>
              <div className="grid grid-cols-2 gap-2 w-full mb-5">
                {cells.map((c) => (
                  <div
                    key={c.label}
                    className={`rounded-[5px] px-3 py-2.5 border ${
                      c.tone === "amber"
                        ? "bg-amber-50 border-amber-200"
                        : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <div
                      className={`text-[10px] uppercase tracking-wider font-medium ${
                        c.tone === "amber" ? "text-amber-700" : "text-gray-400"
                      }`}
                    >
                      {c.label}
                    </div>
                    <div
                      className={`text-[18px] font-semibold tabular-nums ${
                        c.tone === "amber" ? "text-amber-700" : "text-gray-900"
                      }`}
                    >
                      {c.value}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {/* TODO Phase 4+ — point at a real audit destination. Per-OBD audit
                    lives in the order detail panel; there is no batch-level page yet. */}
                <button
                  type="button"
                  className="text-[11px] text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline cursor-pointer flex items-center gap-1"
                >
                  View Audit
                  <ExternalLink size={11} />
                </button>
                <span className="text-gray-300">·</span>
                <button
                  type="button"
                  onClick={handleResultImportAnother}
                  className="text-[11px] text-gray-600 hover:text-gray-900 underline-offset-2 hover:underline cursor-pointer"
                >
                  Import Another File
                </button>
              </div>
            </div>
          );
        })()}

        {/* ERROR stage body */}
        {stage === "error" && (
          <div className="px-8 py-8 flex flex-col items-center text-center flex-shrink-0">
            <div className="w-12 h-12 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mb-3">
              <AlertTriangle size={22} className="text-red-600" strokeWidth={2} />
            </div>
            <h2 className="text-[14px] font-semibold text-gray-900 mb-1">Import Failed</h2>
            <p className="text-[11px] text-gray-600 leading-relaxed max-w-[340px]">
              {errorMessage ?? "Something went wrong. Please try again."}
            </p>
          </div>
        )}

        {/* Inline amber strip — confirm-intent only, between body and footer */}
        {stage === "confirm-intent" && (
          <div className="bg-amber-50 border-t border-amber-200 px-5 py-2.5 flex items-start gap-2 flex-shrink-0">
            <AlertTriangle size={14} className="text-amber-700 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 leading-snug">
              This will write to live tables and cannot be undone. {importableCount} OBD{importableCount === 1 ? "" : "s"} will be patched.
            </p>
          </div>
        )}

        {/* Footer — switches by stage */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 flex-shrink-0">
          {(stage === "idle" || stage === "parsing" || stage === "submitting") && (
            <>
              <button
                type="button"
                onClick={() => attemptClose("x")}
                disabled={isInFlight}
                className="text-[11px] text-gray-600 hover:text-gray-900 px-3 py-1.5 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePrimaryFromIdle}
                disabled={!file || isInFlight}
                className={`text-[11px] font-medium rounded-[5px] px-3 py-1.5 inline-flex items-center gap-1.5 ${
                  !file
                    ? "bg-gray-300 text-white cursor-not-allowed"
                    : previewEnabled
                      ? "bg-gray-900 hover:bg-gray-800 text-white cursor-pointer"
                      : "bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                } disabled:cursor-not-allowed`}
              >
                {isInFlight && <Loader2 className="animate-spin" size={12} />}
                {isInFlight
                  ? (previewEnabled ? "Parsing…" : "Importing…")
                  : (previewEnabled ? "Preview" : "Import")}
              </button>
            </>
          )}

          {stage === "preview" && (
            <>
              <button
                type="button"
                onClick={handlePreviewCancel}
                className="text-[11px] text-gray-600 hover:text-gray-900 px-3 py-1.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmFromPreview}
                disabled={importableCount === 0}
                className={`text-[11px] font-medium rounded-[5px] px-3 py-1.5 ${
                  importableCount === 0
                    ? "bg-gray-300 text-white cursor-not-allowed"
                    : "bg-gray-900 hover:bg-gray-800 text-white cursor-pointer"
                }`}
              >
                Confirm Import ({importableCount} OBD{importableCount === 1 ? "" : "s"})
              </button>
            </>
          )}

          {stage === "confirm-intent" && (
            <>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="text-[11px] text-gray-600 hover:text-gray-900 px-3 py-1.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmYes}
                className="text-[11px] bg-red-600 hover:bg-red-700 text-white font-medium rounded-[5px] px-3 py-1.5 cursor-pointer"
              >
                Yes, Confirm
              </button>
            </>
          )}

          {stage === "result" && (
            <button
              type="button"
              onClick={handleResultDone}
              className="text-[11px] bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-[5px] px-4 py-1.5 cursor-pointer"
            >
              Done
            </button>
          )}

          {stage === "error" && (
            <>
              <button
                type="button"
                onClick={handleErrorCancel}
                className="text-[11px] text-gray-600 hover:text-gray-900 px-3 py-1.5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleErrorTryAgain}
                className="text-[11px] bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-[5px] px-3 py-1.5 cursor-pointer"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryPills({ summary }: { summary: UnifiedSummary }): React.JSX.Element {
  const pills: { label: string; value: number; tone: "neutral" | "amber" }[] = [
    { label: "Total",    value: summary.total,    tone: "neutral" },
    { label: "New",      value: summary.new,      tone: "neutral" },
    { label: "Patch",    value: summary.patch,    tone: summary.patch    > 0 ? "amber" : "neutral" },
    { label: "Skipped",  value: summary.skipped,  tone: "neutral" },
    { label: "Errored",  value: summary.errored,  tone: summary.errored  > 0 ? "amber" : "neutral" },
    { label: "Warnings", value: summary.warnings, tone: summary.warnings > 0 ? "amber" : "neutral" },
  ];
  return (
    <div className="grid grid-cols-6 gap-1.5 mb-4">
      {pills.map((p) => (
        <div
          key={p.label}
          className={`rounded-[5px] px-2 py-1.5 text-center border ${
            p.tone === "amber"
              ? "bg-amber-50 border-amber-200"
              : "bg-gray-50 border-gray-200"
          }`}
        >
          <div
            className={`text-[9px] uppercase tracking-wider font-medium ${
              p.tone === "amber" ? "text-amber-700" : "text-gray-400"
            }`}
          >
            {p.label}
          </div>
          <div
            className={`text-[13px] font-semibold tabular-nums ${
              p.tone === "amber" ? "text-amber-700" : "text-gray-900"
            }`}
          >
            {p.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ObdTable({ rows }: { rows: UnifiedRow[] }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "5%"  }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "10%" }} />
          <col style={{ width: "39%" }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-left px-3 py-2">#</th>
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-left px-3 py-2">OBD</th>
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-left px-3 py-2">Outcome</th>
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-right px-3 py-2">Lines</th>
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-right px-3 py-2">Qty</th>
            <th className="text-[9px] font-medium text-gray-400 uppercase tracking-wider text-left px-3 py-2">Issues</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => {
            const hasIssues = r.issues.length > 0;
            return (
              <Fragment key={r.key}>
                <tr
                  className={`border-b border-gray-100 hover:bg-gray-50/50 ${
                    hasIssues ? "bg-amber-50/30" : ""
                  }`}
                >
                  <td className="text-[11px] text-gray-400 px-3 py-2 tabular-nums">{idx + 1}</td>
                  <td className="text-[11px] font-mono text-gray-800 px-3 py-2 truncate">{r.obdNumber}</td>
                  <td className="px-3 py-2"><OutcomeBadge outcome={r.outcome} /></td>
                  <td className="text-[11px] text-gray-700 px-3 py-2 text-right tabular-nums">{r.lineCount}</td>
                  <td className="text-[11px] text-gray-700 px-3 py-2 text-right tabular-nums">{r.qty ?? "—"}</td>
                  <td
                    className={`text-[11px] px-3 py-2 truncate ${
                      !hasIssues
                        ? "text-gray-400"
                        : r.outcome === "error"
                          ? "text-red-700"
                          : "text-amber-700"
                    }`}
                  >
                    {r.outcome === "skipped" && !hasIssues
                      ? "No changes detected"
                      : !hasIssues
                        ? "—"
                        : `${r.issues.length} ${r.issues.length === 1 ? "warning" : "warnings"}`}
                  </td>
                </tr>
                {hasIssues && (
                  <tr className="border-b border-gray-100 bg-amber-50/30">
                    <td colSpan={6} className="px-3 pb-3 pt-0">
                      <ul className="list-disc pl-8 text-[10.5px] text-amber-800 space-y-0.5">
                        {r.issues.map((iss, i) => (
                          <li key={i}>{iss}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: UnifiedOutcome }): React.JSX.Element {
  const styles: Record<UnifiedOutcome, string> = {
    new:     "bg-blue-50 text-blue-700 border-blue-200",
    patch:   "bg-amber-50 text-amber-700 border-amber-200",
    skipped: "bg-gray-100 text-gray-500 border-gray-200",
    error:   "bg-red-50 text-red-700 border-red-200",
  };
  const labels: Record<UnifiedOutcome, string> = {
    new:     "NEW",
    patch:   "PATCH",
    skipped: "SKIPPED",
    error:   "ERROR",
  };
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${styles[outcome]}`}>
      {labels[outcome]}
    </span>
  );
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHumanDate(iso: string): string {
  // YYYY-MM-DD → "29 Apr 2026"
  const [yStr, mStr, dStr] = iso.split("-");
  const y = parseInt(yStr ?? "", 10);
  const m = parseInt(mStr ?? "", 10);
  const d = parseInt(dStr ?? "", 10);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isSapPreview(p: SapPreviewResponse | ImportPreviewResponse): p is SapPreviewResponse {
  return "fileStats" in p;
}

function isSapConfirm(r: SapConfirmResponse | ImportConfirmResponse): r is SapConfirmResponse {
  return "summary" in r;
}

function toUnifiedSummary(
  p:      SapPreviewResponse | ImportPreviewResponse,
  format: Format,
): UnifiedSummary {
  if (format === "sap" && isSapPreview(p)) {
    const total =
      p.summary.newOBDs +
      p.summary.patchOBDs +
      p.summary.skippedOBDs +
      p.summary.errorOBDs;
    const warnings = p.obds.filter((o) => o.issues.length > 0).length;
    return {
      total,
      new:      p.summary.newOBDs,
      patch:    p.summary.patchOBDs,
      skipped:  p.summary.skippedOBDs,
      errored:  p.summary.errorOBDs,
      warnings,
    };
  }
  if (!isSapPreview(p)) {
    // Both 'valid' and 'warning' OBDs are imported by the manual-template path.
    return {
      total:    p.summary.totalObds,
      new:      p.summary.validObds + p.summary.warningObds,
      patch:    0,
      skipped:  p.summary.duplicateObds,
      errored:  p.summary.errorObds,
      warnings: p.summary.warningObds,
    };
  }
  return { total: 0, new: 0, patch: 0, skipped: 0, errored: 0, warnings: 0 };
}

function toUnifiedRows(
  p:      SapPreviewResponse | ImportPreviewResponse,
  format: Format,
): UnifiedRow[] {
  if (format === "sap" && isSapPreview(p)) {
    return p.obds.map((o) => ({
      key:       o.obdNumber,
      obdNumber: o.obdNumber,
      outcome:   o.outcome,
      lineCount: o.lineCount,
      qty:       o.totalUnitQty,
      issues:    o.issues,
    }));
  }
  if (!isSapPreview(p)) {
    return p.obds.map((o) => {
      const outcome: UnifiedOutcome =
        o.rowStatus === "duplicate" ? "skipped" :
        o.rowStatus === "error"     ? "error"   :
        "new";
      const issues: string[] = [];
      if (o.rowError) issues.push(o.rowError);
      for (const line of o.lines) {
        if (line.rowError) issues.push(`Line ${line.lineId}: ${line.rowError}`);
      }
      return {
        key:       String(o.rawSummaryId),
        obdNumber: o.obdNumber,
        outcome,
        lineCount: o.lineCount,
        qty:       o.totalUnitQty,
        issues,
      };
    });
  }
  return [];
}

function toResultCells(
  result:  SapConfirmResponse | ImportConfirmResponse,
  preview: SapPreviewResponse | ImportPreviewResponse | null,
  format:  Format,
): ResultCell[] {
  if (format === "sap" && isSapConfirm(result)) {
    return [
      { label: "Created",   value: result.summary.created,   tone: "neutral" },
      { label: "Patched",   value: result.summary.patched,   tone: result.summary.patched > 0 ? "amber" : "neutral" },
      { label: "Unchanged", value: result.summary.unchanged, tone: "neutral" },
      { label: "Errored",   value: result.summary.errored,   tone: result.summary.errored > 0 ? "amber" : "neutral" },
    ];
  }
  // Manual-template confirm response shape is different — reuse the 2x2 grid
  // with adapted labels and pull duplicate/error counts from the preview pass.
  const r = result as ImportConfirmResponse;
  const dups = preview && !isSapPreview(preview) ? preview.summary.duplicateObds : 0;
  const errs = preview && !isSapPreview(preview) ? preview.summary.errorObds     : 0;
  return [
    { label: "Created",  value: r.ordersCreated, tone: "neutral" },
    { label: "Lines",    value: r.linesEnriched, tone: "neutral" },
    { label: "Skipped",  value: dups,            tone: "neutral" },
    { label: "Errored",  value: errs,            tone: errs > 0 ? "amber" : "neutral" },
  ];
}
