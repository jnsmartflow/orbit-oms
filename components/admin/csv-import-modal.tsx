"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// ── Shared file parser (CSV / XLS / XLSX) ─────────────────────────────────────

export function parseFile(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data     = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        const rows     = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
          raw:    false,
          defval: "",
        });
        const cleaned  = rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), String(v ?? "").trim()])
          )
        );
        resolve(cleaned);
      } catch {
        reject(new Error("Failed to parse file. Please check the format."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsBinaryString(file);
  });
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CsvColumn {
  key:      string;
  label:    string;
  required: boolean;
}

const DUPLICATE_MSG = "Already exists — will be skipped";

interface ValidatedRow {
  raw:   Record<string, string>;
  error: string | null;
}

interface CsvImportModalProps {
  title:        string;
  columns:      CsvColumn[];
  rows:         Record<string, string>[];
  fileName:     string;
  validateRow:  (row: Record<string, string>) => string | null;
  onConfirm:    (validRows: Record<string, string>[]) => Promise<void>;
  isOpen:       boolean;
  onClose:      () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CsvImportModal({
  title,
  columns,
  rows,
  fileName,
  validateRow,
  onConfirm,
  isOpen,
  onClose,
}: CsvImportModalProps) {
  const [confirming, setConfirming] = useState(false);

  const validated: ValidatedRow[] = rows.map((row) => ({
    raw:   row,
    error: validateRow(row),
  }));

  const validCount     = validated.filter((r) => r.error === null).length;
  const duplicateCount = validated.filter((r) => r.error === DUPLICATE_MSG).length;
  const errorCount     = validated.filter((r) => r.error !== null && r.error !== DUPLICATE_MSG).length;

  async function handleConfirm() {
    const validRows = validated.filter((r) => r.error === null).map((r) => r.raw);
    if (validRows.length === 0) return;
    setConfirming(true);
    try {
      await onConfirm(validRows);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[#e5e7eb] shrink-0">
          <DialogTitle className="text-[15px] font-bold text-teal-700">
            {title} — Import Preview
          </DialogTitle>
          <p className="text-xs text-gray-500 mt-0.5">{fileName}</p>
        </DialogHeader>

        {/* Summary bar */}
        <div className="px-6 py-3 bg-[#f9fafb] border-b border-[#e5e7eb] shrink-0 flex items-center gap-4 text-sm">
          <span className="text-gray-700">
            <span className="font-semibold">{rows.length}</span> rows found
          </span>
          <span className="text-[#15803d] font-semibold">{validCount} valid</span>
          {duplicateCount > 0 && (
            <span className="text-[#92400e] font-semibold">{duplicateCount} duplicate{duplicateCount === 1 ? "" : "s"}</span>
          )}
          {errorCount > 0 && (
            <span className="text-[#dc2626] font-semibold">{errorCount} error{errorCount === 1 ? "" : "s"}</span>
          )}
        </div>

        {/* Preview table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-[#f9fafb] border-b border-[#e5e7eb]">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
                {columns.map((col) => (
                  <th key={col.key} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">
                    {col.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody>
              {validated.map((vrow, idx) => (
                <tr
                  key={idx}
                  className="border-b border-[#f0f1f4] last:border-0"
                  style={{
                    background:
                      vrow.error === null       ? undefined :
                      vrow.error === DUPLICATE_MSG ? "#fffbeb" : "#fff5f5",
                  }}
                >
                  <td className="px-3 py-2 text-[#9ca3af] font-mono">{idx + 2}</td>
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2 text-gray-700">
                      {vrow.raw[col.key] || <span className="text-[#d1d5db]">—</span>}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {vrow.error === null ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#f0fdf4] text-[#166534] font-medium text-[11px] border border-[#bbf7d0]">
                        ✓ Valid
                      </span>
                    ) : vrow.error === DUPLICATE_MSG ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fffbeb] text-[#92400e] font-medium text-[11px] border border-[#fde68a]">
                        ⊘ Duplicate
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fef2f2] text-[#991b1b] font-medium text-[11px] border border-[#fecaca]" title={vrow.error}>
                        ✗ {vrow.error.length > 40 ? vrow.error.slice(0, 40) + "…" : vrow.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e5e7eb] shrink-0 flex items-center justify-end gap-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="oa-btn-ghost"
              onClick={onClose}
              disabled={confirming}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="oa-btn-primary"
              onClick={handleConfirm}
              disabled={validCount === 0 || confirming}
            >
              {confirming ? "Importing…" : `Import ${validCount} valid row${validCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
