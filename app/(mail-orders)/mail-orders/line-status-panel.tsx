"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { searchSkus } from "@/lib/mail-orders/api";
import type { MoOrderLine } from "@/lib/mail-orders/types";
import { LINE_STATUS_REASONS } from "@/lib/mail-orders/types";

interface LineStatusPanelProps {
  line: MoOrderLine;
  onSave: (lineId: number, status: {
    found: boolean;
    reason?: string;
    altSkuCode?: string;
    altSkuDescription?: string;
    note?: string;
  }) => void;
  onCancel: () => void;
}

interface SkuResult {
  material: string;
  description: string;
  packCode: string;
  packMatch: boolean;
}

export function LineStatusPanel({ line, onSave, onCancel }: LineStatusPanelProps) {
  const ls = line.lineStatus;
  const initialFound = ls?.found ?? true;
  const [found, setFound] = useState(initialFound);
  const [reason, setReason] = useState<string | null>(ls?.reason ?? null);
  const [altSkuCode, setAltSkuCode] = useState<string | null>(ls?.altSkuCode ?? null);
  const [altSkuDescription, setAltSkuDescription] = useState<string | null>(ls?.altSkuDescription ?? null);
  const [note, setNote] = useState(ls?.note ?? "");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SkuResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  // Debounced SKU search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchSkus(searchQuery.trim(), line.packCode ?? undefined);
        setSearchResults(results.slice(0, 4));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, line.packCode]);

  const hasChanges = found !== initialFound
    || reason !== (ls?.reason ?? null)
    || altSkuCode !== (ls?.altSkuCode ?? null)
    || note !== (ls?.note ?? "");

  function handleSave() {
    onSave(line.id, {
      found,
      ...(found ? {} : {
        reason: reason ?? undefined,
        altSkuCode: altSkuCode ?? undefined,
        altSkuDescription: altSkuDescription ?? undefined,
        note: note.trim() || undefined,
      }),
    });
  }

  function selectAlt(sku: SkuResult) {
    setAltSkuCode(sku.material);
    setAltSkuDescription(sku.description);
    setSearchQuery("");
    setSearchResults([]);
  }

  function clearAlt() {
    setAltSkuCode(null);
    setAltSkuDescription(null);
  }

  const showSaveCancelButtons = !found || hasChanges;

  return (
    <div
      className="fixed inset-0 bg-black/25 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl border border-gray-200 w-full max-w-[380px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. TOP SECTION */}
        <div className="pt-3.5 px-4">
          {/* 1a. Header */}
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="min-w-0">
              <p className={`text-[15px] font-semibold truncate ${!found ? "line-through text-gray-400" : "text-gray-900"}`}>
                {line.rawText}
              </p>
              <div className="flex items-center gap-1 mt-0.5 text-gray-400">
                {line.skuCode && (
                  <span className={`font-mono text-[11px] ${!found ? "line-through" : ""}`}>{line.skuCode}</span>
                )}
                {line.skuCode && line.packCode && <span className="text-gray-300">{"\u00b7"}</span>}
                {line.packCode && <span className="text-[11px]">{line.packCode}</span>}
                {(line.skuCode || line.packCode) && <span className="text-gray-300">{"\u00b7"}</span>}
                <span className="text-[11px]">{"\u00d7"} {line.quantity}</span>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 transition-colors shrink-0 text-[14px]"
            >
              {"\u00d7"}
            </button>
          </div>

          {/* 1b. Status Toggle */}
          <button
            type="button"
            onClick={() => setFound(prev => !prev)}
            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 mb-3 border cursor-pointer transition-colors ${
              found
                ? "bg-green-50 border-green-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
              found ? "bg-green-100" : "bg-red-100"
            }`}>
              {found ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 8 6.5 11.5 13 5" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              )}
            </div>
            <div className="text-left">
              <p className={`text-[13px] font-semibold ${found ? "text-green-800" : "text-red-700"}`}>
                {found ? "Found in SAP" : "Not found in SAP"}
              </p>
              <p className="text-[9px] text-gray-400">
                {found ? "Tap to mark as not found" : "Tap to mark as found"}
              </p>
            </div>
          </button>
        </div>

        {/* 2. SECTIONS (only when not found) */}
        {!found && (
          <div className="px-4">
            {/* 2a. Reason */}
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Reason</p>
              <div className="grid grid-cols-2 gap-[5px]">
                {LINE_STATUS_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setReason(reason === r.value ? null : r.value)}
                    className={`py-[7px] rounded-md border text-[10.5px] text-center transition-colors ${
                      r.value === "other" ? "col-span-2" : ""
                    } ${
                      reason === r.value
                        ? "border-red-400 bg-red-50 text-red-700 font-medium"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2b. Alternate Material */}
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Alternate material</p>
              {altSkuCode ? (
                <div className="flex items-center gap-[5px] px-2.5 py-2 border-[1.5px] border-teal-500 rounded-md bg-teal-50">
                  <span className="text-[7px] font-bold text-teal-700 bg-teal-100 px-1 py-px rounded shrink-0">ALT</span>
                  <span className="font-mono text-[10px] font-medium text-teal-700 shrink-0">{altSkuCode}</span>
                  <span className="text-[10px] text-teal-600 truncate flex-1">{altSkuDescription}</span>
                  <button
                    onClick={clearAlt}
                    className="text-[10px] text-teal-600 font-medium shrink-0 cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search SKU or product name..."
                      className="w-full h-[34px] border-[1.5px] border-gray-200 rounded-md px-2.5 text-[11px] focus:outline-none focus:border-teal-500"
                    />
                    {searching && (
                      <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                    )}
                  </div>
                  {searchResults.length > 0 && (
                    <div className="space-y-1 mt-1.5">
                      {searchResults.map(sku => (
                        <button
                          key={sku.material}
                          onClick={() => selectAlt(sku)}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 border border-gray-200 rounded-md text-left hover:bg-teal-50 hover:border-teal-500 transition-colors"
                        >
                          <span className="font-mono text-[10px] font-medium text-gray-600 shrink-0">{sku.material}</span>
                          <span className="text-[10px] text-gray-500 truncate flex-1">{sku.description}</span>
                          <span className="text-[10px] text-gray-400 shrink-0">{sku.packCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2c. Note */}
            <div className="mb-3">
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Note</p>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Optional note..."
                className="w-full h-[30px] border border-gray-200 rounded-md px-2.5 text-[10px] focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>
        )}

        {/* 3. FOOTER */}
        <div className="border-t border-gray-100 flex gap-2 p-4">
          {showSaveCancelButtons ? (
            <>
              <button
                onClick={onCancel}
                className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 py-2.5 rounded-lg bg-teal-600 text-white text-[12px] font-semibold hover:bg-teal-700 transition-colors"
              >
                Save
              </button>
            </>
          ) : (
            <button
              onClick={onCancel}
              className="w-full py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] font-semibold hover:bg-gray-200 transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
