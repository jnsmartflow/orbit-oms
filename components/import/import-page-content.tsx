"use client";

import { useState, useRef, Fragment } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ImportPreviewResponse,
  ImportObdPreview,
  ImportLinePreview,
  ImportConfirmResponse,
} from "@/lib/import-types";

// ── Helpers ───────────────────────────────────────────────────────────────────

type Stage = "upload" | "preview" | "result";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface FileZoneProps {
  label: string;
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onFile: (file: File) => void;
  onClear: () => void;
}

function FileZone({ label, file, inputRef, onFile, onClear }: FileZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = "";
    onClear();
  }

  return (
    <div
      className={`flex-1 rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center gap-3 cursor-pointer min-h-[200px] transition-colors ${
        isDragOver
          ? "border-[#1a237e] bg-blue-50"
          : file
          ? "border-green-400 bg-green-50/30"
          : "border-slate-300 bg-white hover:border-[#1a237e] hover:bg-blue-50"
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />

      {file ? (
        <>
          <FileSpreadsheet size={32} className="text-green-500 shrink-0" />
          <div className="text-center w-full">
            <p className="font-medium text-sm text-slate-800 truncate max-w-full px-2">
              {file.name}
            </p>
            <p className="text-sm text-slate-400 mt-1">{formatBytes(file.size)}</p>
          </div>
          <button
            className="text-slate-400 hover:text-red-500 text-xs flex items-center gap-1 transition-colors"
            onClick={handleClear}
          >
            <X size={14} />
            Remove
          </button>
        </>
      ) : (
        <>
          <UploadCloud size={40} className="text-slate-300 shrink-0" />
          <div className="text-center">
            <p className="font-medium text-sm text-slate-700">{label}</p>
            <p className="text-sm text-slate-400">Drag &amp; drop or click to browse</p>
            <p className="text-xs text-slate-400 mt-1">.xlsx, .xls only</p>
          </div>
        </>
      )}
    </div>
  );
}

interface PillProps {
  label: string;
  count: number;
  className: string;
}

function Pill({ label, count, className }: PillProps) {
  return (
    <span className={`px-4 py-2 rounded-full text-sm font-medium ${className}`}>
      {label}: <strong>{count}</strong>
    </span>
  );
}

function OBDStatusBadge({ status }: { status: ImportObdPreview["rowStatus"] }) {
  if (status === "valid")
    return (
      <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">
        Valid
      </span>
    );
  if (status === "duplicate")
    return (
      <span className="bg-yellow-100 text-yellow-700 text-xs font-medium px-2 py-0.5 rounded">
        Duplicate
      </span>
    );
  return (
    <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">
      Error
    </span>
  );
}

function LineStatusBadge({ status }: { status: ImportLinePreview["rowStatus"] }) {
  if (status === "valid")
    return (
      <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">
        Valid
      </span>
    );
  return (
    <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">
      Error
    </span>
  );
}

// ── Page Content ──────────────────────────────────────────────────────────────

interface ImportPageContentProps {
  viewOrdersHref?: string;
}

export function ImportPageContent({ viewOrdersHref = "/support" }: ImportPageContentProps) {
  const [stage, setStage] = useState<Stage>("upload");
  const [headerFile, setHeaderFile] = useState<File | null>(null);
  const [lineFile, setLineFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmResult, setConfirmResult] = useState<ImportConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedObds, setExpandedObds] = useState<Set<number>>(new Set());

  const headerInputRef = useRef<HTMLInputElement>(null);
  const lineInputRef = useRef<HTMLInputElement>(null);

  function resetAll() {
    setStage("upload");
    setHeaderFile(null);
    setLineFile(null);
    setIsLoading(false);
    setPreviewData(null);
    setSelectedIds(new Set());
    setConfirmResult(null);
    setError(null);
    setExpandedObds(new Set());
  }

  function toggleObd(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: number) {
    setExpandedObds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handlePreviewSubmit() {
    if (!headerFile) return;
    setIsLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("headerFile", headerFile);
      if (lineFile) fd.append("lineFile", lineFile);
      const res = await fetch("/api/import/obd?action=preview", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as ImportPreviewResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Preview failed");
      setPreviewData(data);
      setSelectedIds(
        new Set(
          data.obds
            .filter((o) => o.rowStatus === "valid")
            .map((o) => o.rawSummaryId),
        ),
      );
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm() {
    if (!previewData || selectedIds.size === 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/obd?action=confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: previewData.batchId,
          confirmedObdIds: Array.from(selectedIds),
        }),
      });
      const data = (await res.json()) as ImportConfirmResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Confirm failed");
      setConfirmResult(data);
      setStage("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setIsLoading(false);
    }
  }

  // ── Stage 1: Upload ──────────────────────────────────────────────────────────
  if (stage === "upload") {
    return (
      <div>
        <div className="flex flex-row gap-6 mb-6">
          <FileZone
            label="OBD Header File"
            file={headerFile}
            inputRef={headerInputRef}
            onFile={setHeaderFile}
            onClear={() => setHeaderFile(null)}
          />
          <FileZone
            label="Line Items File (Optional)"
            file={lineFile}
            inputRef={lineInputRef}
            onFile={setLineFile}
            onClear={() => setLineFile(null)}
          />
        </div>

        <button
          onClick={handlePreviewSubmit}
          disabled={!headerFile || isLoading}
          className="w-full bg-[#1a237e] text-white rounded-lg py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a237e]/90 transition-colors"
        >
          {isLoading && <Loader2 className="animate-spin" size={18} />}
          {isLoading ? "Processing…" : "Preview Import"}
        </button>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── Stage 2: Preview ─────────────────────────────────────────────────────────
  if (stage === "preview" && previewData) {
    const { summary, obds } = previewData;

    return (
      <div>
        {/* Summary pills */}
        <div className="flex flex-row gap-3 mb-6 flex-wrap">
          <Pill label="Total OBDs" count={summary.totalObds} className="bg-slate-100 text-slate-700" />
          <Pill label="Valid" count={summary.validObds} className="bg-green-100 text-green-700" />
          <Pill label="Duplicates" count={summary.duplicateObds} className="bg-yellow-100 text-yellow-700" />
          <Pill label="Errors" count={summary.errorObds} className="bg-red-100 text-red-700" />
          <Pill label="Total Lines" count={summary.totalLines} className="bg-slate-100 text-slate-700" />
        </div>

        {/* Selection controls */}
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-600">
            {selectedIds.size} of {obds.length} OBDs selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() =>
                setSelectedIds(
                  new Set(
                    obds
                      .filter((o) => o.rowStatus === "valid")
                      .map((o) => o.rawSummaryId),
                  ),
                )
              }
              className="text-sm text-slate-700 border border-slate-300 rounded px-3 py-1 hover:bg-slate-50 transition-colors"
            >
              Select All Valid
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-slate-700 border border-slate-300 rounded px-3 py-1 hover:bg-slate-50 transition-colors"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Preview table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead className="w-10" />
                <TableHead>OBD Number</TableHead>
                <TableHead>Customer ID</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>OBD Date</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Weight (kg)</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {obds.map((obd) => (
                <Fragment key={obd.rawSummaryId}>
                  {/* Main row */}
                  <TableRow
                    className={
                      obd.rowStatus === "duplicate"
                        ? "bg-yellow-50"
                        : obd.rowStatus === "error"
                        ? "bg-red-50"
                        : "bg-white"
                    }
                  >
                    {/* Checkbox */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-[#1a237e]"
                        checked={selectedIds.has(obd.rawSummaryId)}
                        disabled={obd.rowStatus === "duplicate"}
                        onChange={() => toggleObd(obd.rawSummaryId)}
                      />
                    </TableCell>

                    {/* OBD Number — clicking expands row */}
                    <TableCell
                      className="cursor-pointer font-mono text-xs font-medium text-slate-800"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      <div className="flex items-center gap-1">
                        {expandedObds.has(obd.rawSummaryId) ? (
                          <ChevronDown size={14} className="text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight size={14} className="text-slate-400 shrink-0" />
                        )}
                        {obd.obdNumber}
                      </div>
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.shipToCustomerId ?? "—"}
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 max-w-[180px] truncate cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.shipToCustomerName ?? "—"}
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {formatDate(obd.obdEmailDate)}
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.totalUnitQty ?? "—"}
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.grossWeight != null ? obd.grossWeight.toFixed(1) : "—"}
                    </TableCell>

                    <TableCell
                      className="text-sm text-slate-600 cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.lineCount} lines
                      {obd.tintLineCount > 0 ? ` · ${obd.tintLineCount} tint` : ""}
                    </TableCell>

                    <TableCell
                      className="cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      {obd.orderType === "tint" ? (
                        <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">
                          TINT
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-600 text-xs font-medium px-2 py-0.5 rounded">
                          NON-TINT
                        </span>
                      )}
                    </TableCell>

                    <TableCell
                      className="cursor-pointer"
                      onClick={() => toggleExpand(obd.rawSummaryId)}
                    >
                      <div className="flex flex-col gap-1">
                        <OBDStatusBadge status={obd.rowStatus} />
                        {obd.rowError && (
                          <span className="text-red-500 text-xs">{obd.rowError}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded line items */}
                  {expandedObds.has(obd.rawSummaryId) && (
                    <tr>
                      <td colSpan={10} className="bg-slate-50 px-6 py-4">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="text-left text-xs font-medium text-slate-500 border-b border-slate-200">
                              <th className="pb-2 pr-4">Line ID</th>
                              <th className="pb-2 pr-4">SKU Code</th>
                              <th className="pb-2 pr-4">SKU Description</th>
                              <th className="pb-2 pr-4">Qty</th>
                              <th className="pb-2 pr-4">Tinting</th>
                              <th className="pb-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {obd.lines.map((line) => (
                              <tr
                                key={line.rawLineItemId}
                                className="border-b border-slate-100 last:border-0"
                              >
                                <td className="py-1.5 pr-4 text-slate-600">{line.lineId}</td>
                                <td className="py-1.5 pr-4 font-mono text-xs text-slate-800">
                                  {line.skuCodeRaw}
                                </td>
                                <td className="py-1.5 pr-4 text-slate-600 max-w-[220px] truncate">
                                  {line.skuDescriptionRaw ?? "—"}
                                </td>
                                <td className="py-1.5 pr-4 text-slate-600">{line.unitQty}</td>
                                <td className="py-1.5 pr-4">
                                  {line.isTinting ? (
                                    <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">
                                      TINT
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="py-1.5">
                                  <div className="flex flex-col gap-1">
                                    <LineStatusBadge status={line.rowStatus} />
                                    {line.rowError && (
                                      <span className="text-red-500 text-xs">
                                        {line.rowError}
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Action bar */}
        <div className="flex justify-between items-center">
          <button
            onClick={resetAll}
            className="border border-slate-300 text-slate-700 rounded-lg px-6 py-2.5 font-medium hover:bg-slate-50 transition-colors"
          >
            ← Back
          </button>

          <div className="flex flex-col items-end gap-2">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
                {error}
              </div>
            )}
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size === 0 || isLoading}
              className="bg-[#1a237e] text-white rounded-lg px-6 py-2.5 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#1a237e]/90 transition-colors"
            >
              {isLoading && <Loader2 className="animate-spin" size={18} />}
              Confirm Import ({selectedIds.size} OBDs)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Stage 3: Result ──────────────────────────────────────────────────────────
  if (stage === "result" && confirmResult) {
    return (
      <div className="max-w-md mx-auto mt-16 bg-white rounded-2xl p-10 shadow-sm text-center">
        <CheckCircle2 size={64} className="text-green-500 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-slate-800 mb-2">Import Complete</h1>
        <p className="font-mono text-sm text-slate-500 mb-8">{confirmResult.batchRef}</p>

        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-[#1a237e]">
              {confirmResult.ordersCreated}
            </div>
            <div className="text-sm text-slate-500 mt-1">Orders Created</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-slate-700">
              {confirmResult.linesEnriched}
            </div>
            <div className="text-sm text-slate-500 mt-1">Lines Enriched</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-slate-700">
              {previewData?.summary.duplicateObds ?? 0}
            </div>
            <div className="text-sm text-slate-500 mt-1">Skipped (duplicates)</div>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-slate-700">
              {previewData?.summary.errorObds ?? 0}
            </div>
            <div className="text-sm text-slate-500 mt-1">Errors</div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={resetAll}
            className="w-full border border-slate-300 text-slate-700 rounded-lg py-2.5 font-medium hover:bg-slate-50 transition-colors"
          >
            Import Another Batch
          </button>
          <button
            onClick={() => {
              window.location.href = viewOrdersHref;
            }}
            className="w-full bg-[#1a237e] text-white rounded-lg py-2.5 font-medium hover:bg-[#1a237e]/90 transition-colors"
          >
            View Orders
          </button>
        </div>
      </div>
    );
  }

  return null;
}
