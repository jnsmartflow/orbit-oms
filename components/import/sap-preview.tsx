"use client";

// components/import/sap-preview.tsx
//
// Step 8 — SAP-specific preview rendering. Different shape from the
// existing manual-template preview (no batchId, no per-OBD selection,
// new/patch/skipped outcomes instead of valid/duplicate/error/warning).
// Kept as a separate component because the SAP response is sufficiently
// different that branching inline in import-page-content.tsx would tangle
// the JSX past the point of easy review.

import { useState, Fragment } from "react";
import { ChevronDown, ChevronRight, Calendar, Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SapPreviewObd, SapPreviewResponse } from "@/lib/import-types";

interface SapPreviewProps {
  preview:        SapPreviewResponse;
  obdEmailDate:   string;       // ISO YYYY-MM-DD
  isLoading:      boolean;
  error:          string | null;
  onCancel:       () => void;
  onConfirm:      () => void;
}

function OutcomeBadge({ outcome }: { outcome: SapPreviewObd["outcome"] }) {
  const styles: Record<SapPreviewObd["outcome"], string> = {
    new:     "bg-blue-50 text-blue-700 border-blue-200",
    patch:   "bg-amber-50 text-amber-700 border-amber-200",
    skipped: "bg-gray-50 text-gray-500 border-gray-200",
    error:   "bg-red-50 text-red-700 border-red-200",
  };
  const labels: Record<SapPreviewObd["outcome"], string> = {
    new:     "NEW",
    patch:   "PATCH",
    skipped: "SKIPPED",
    error:   "ERROR",
  };
  return (
    <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded border ${styles[outcome]}`}>
      {labels[outcome]}
    </span>
  );
}

function formatDateBanner(iso: string): string {
  // Reuse existing formatDate-style logic: render "01 May 2026". If the
  // input is already YYYY-MM-DD, new Date() handles it; otherwise return
  // as-is so the operator at least sees something readable.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function SapPreview({
  preview,
  obdEmailDate,
  isLoading,
  error,
  onCancel,
  onConfirm,
}: SapPreviewProps) {
  const [expandedRows, setExpandedRows]   = useState<Set<string>>(new Set());
  const [warningsOpen, setWarningsOpen]   = useState(false);
  const [confirmIntent, setConfirmIntent] = useState(false);

  const withWarnings = preview.obds.filter((o) => o.issues.length > 0).length;
  const importableCount = preview.summary.newOBDs + preview.summary.patchOBDs;

  function toggleExpand(obdNumber: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(obdNumber)) next.delete(obdNumber);
      else next.add(obdNumber);
      return next;
    });
  }

  return (
    <div>
      {/* Top banner — filename + obdEmailDate chip */}
      <div className="flex items-center gap-3 mb-6">
        <span className="bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-lg font-mono">
          {preview.filename}
        </span>
        <span className="bg-gray-100 text-gray-700 text-sm px-3 py-1.5 rounded-lg flex items-center gap-1.5">
          <Calendar size={14} className="text-gray-400" />
          OBD Date: {formatDateBanner(obdEmailDate)}
        </span>
      </div>

      {/* Stats card */}
      <div className="flex flex-row gap-3 mb-6 flex-wrap">
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
          Total deliveries: <strong>{preview.fileStats.uniqueDeliveries}</strong>
        </span>
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-blue-50 text-blue-700">
          To create: <strong>{preview.summary.newOBDs}</strong>
        </span>
        <span className="px-4 py-2 rounded-full text-sm font-medium bg-amber-50 text-amber-700">
          To patch: <strong>{preview.summary.patchOBDs}</strong>
        </span>
        {preview.summary.skippedOBDs > 0 && (
          <span className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-500">
            Skipped: <strong>{preview.summary.skippedOBDs}</strong>
          </span>
        )}
        {withWarnings > 0 && (
          <span className="px-4 py-2 rounded-full text-sm font-medium bg-amber-50 text-amber-700">
            With warnings: <strong>{withWarnings}</strong>
          </span>
        )}
      </div>

      {/* OBD table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <Table style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "52%" }} />
          </colgroup>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="text-center">#</TableHead>
              <TableHead>OBD Number</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead>Total Qty</TableHead>
              <TableHead>Issues</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.obds.map((o, idx) => {
              const expanded = expandedRows.has(o.obdNumber);
              return (
                <Fragment key={o.obdNumber}>
                  <TableRow
                    className={`cursor-pointer ${
                      o.outcome === "skipped" ? "bg-gray-50/40" :
                      o.outcome === "error"   ? "bg-red-50"     : ""
                    }`}
                    onClick={() => o.issues.length > 0 && toggleExpand(o.obdNumber)}
                  >
                    <TableCell className="text-center text-xs text-gray-400">{idx + 1}</TableCell>
                    <TableCell className="font-mono text-xs text-gray-800">
                      <div className="flex items-center gap-1">
                        {o.issues.length > 0 && (expanded
                          ? <ChevronDown  size={14} className="text-gray-400 shrink-0" />
                          : <ChevronRight size={14} className="text-gray-400 shrink-0" />)}
                        {o.obdNumber}
                      </div>
                    </TableCell>
                    <TableCell><OutcomeBadge outcome={o.outcome} /></TableCell>
                    <TableCell className="text-sm text-gray-600">{o.lineCount}</TableCell>
                    <TableCell className="text-sm text-gray-600">{o.totalUnitQty}</TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {o.issues.length === 0
                        ? <span className="text-gray-300">—</span>
                        : <span>{o.issues.length} issue{o.issues.length === 1 ? "" : "s"}</span>}
                    </TableCell>
                  </TableRow>
                  {expanded && o.issues.length > 0 && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-6 py-3">
                        <ul className="text-xs text-gray-600 space-y-1 list-disc list-inside">
                          {o.issues.map((iss, i) => (
                            <li key={i}>{iss}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Warnings panel — collapsible */}
      {preview.warnings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-hidden">
          <button
            onClick={() => setWarningsOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {warningsOpen
              ? <ChevronDown  size={16} className="text-gray-400" />
              : <ChevronRight size={16} className="text-gray-400" />}
            Parser warnings ({preview.warnings.length})
          </button>
          {warningsOpen && (
            <div className="border-t border-gray-100 px-4 py-3 max-h-64 overflow-y-auto">
              <ul className="text-xs text-gray-600 space-y-1.5">
                {preview.warnings.map((w, i) => (
                  <li key={i} className="font-mono">
                    <span className="text-gray-400">[{w.kind}]</span>{" "}
                    {w.delivery && <span className="text-gray-700">{w.delivery}: </span>}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      <div className="flex justify-between items-center">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="border border-gray-300 text-gray-700 rounded-lg px-6 py-2.5 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          ← Back
        </button>

        <div className="flex flex-col items-end gap-2">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">
              {error}
            </div>
          )}
          {!confirmIntent ? (
            <button
              onClick={() => setConfirmIntent(true)}
              disabled={importableCount === 0 || isLoading}
              className="bg-teal-600 text-white rounded-lg px-6 py-2.5 font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-teal-600/90 transition-colors"
            >
              Confirm Import ({importableCount} OBDs)
            </button>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
              <span className="text-sm text-amber-800">
                Import {importableCount} OBDs to depot? This will write to live tables and cannot be undone.
              </span>
              <button
                onClick={() => setConfirmIntent(false)}
                disabled={isLoading}
                className="border border-gray-300 text-gray-700 rounded px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isLoading}
                className="bg-teal-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-teal-600/90 flex items-center gap-1.5 disabled:opacity-50"
              >
                {isLoading && <Loader2 className="animate-spin" size={12} />}
                Yes, Confirm
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
