"use client";

import { useState, useRef, useEffect } from "react";
import { X, Search, Check, Loader2 } from "lucide-react";
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
  // Initialize from existing lineStatus
  const ls = line.lineStatus;
  const [found, setFound] = useState(ls?.found ?? true);
  const [reason, setReason] = useState<string | null>(ls?.reason ?? null);
  const [altSkuCode, setAltSkuCode] = useState<string | null>(ls?.altSkuCode ?? null);
  const [altSkuDescription, setAltSkuDescription] = useState<string | null>(ls?.altSkuDescription ?? null);
  const [note, setNote] = useState(ls?.note ?? "");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SkuResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="absolute inset-x-0 bottom-0 bg-white border-t-2 border-teal-500 rounded-b-lg z-10">
      <div className="px-4 py-3 space-y-3">

        {/* 1. Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-gray-800 truncate">
              {line.rawText} {"\u00d7"} {line.quantity}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {line.skuCode && (
                <span className="font-mono text-[11px] text-gray-500">{line.skuCode}</span>
              )}
              {line.skuDescription && (
                <span className="text-[10px] text-gray-400 truncate">{line.skuDescription}</span>
              )}
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-[24px] h-[24px] rounded bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* 2. Found/Not Found Toggle */}
        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2.5">
          <span className={`text-[12px] font-semibold ${found ? "text-green-600" : "text-red-600"}`}>
            {found ? "Found in SAP" : "Not found in SAP"}
          </span>
          <button
            onClick={() => setFound(prev => !prev)}
            className={`relative w-[44px] h-[24px] rounded-full transition-colors ${
              found ? "bg-green-500" : "bg-red-500"
            }`}
          >
            <span
              className={`absolute top-[2px] w-[20px] h-[20px] rounded-full bg-white shadow transition-transform ${
                found ? "left-[22px]" : "left-[2px]"
              }`}
            />
          </button>
        </div>

        {/* 3-5. Not-found sections */}
        {!found && (
          <div className="space-y-3">

            {/* 3. Reason Chips */}
            <div>
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">Reason</p>
              <div className="flex flex-wrap gap-1.5">
                {LINE_STATUS_REASONS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setReason(reason === r.value ? null : r.value)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-md border transition-colors ${
                      reason === r.value
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Alternate SKU Search */}
            <div>
              <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1.5">
                Alternate material (optional)
              </p>

              {altSkuCode ? (
                /* Selected alt SKU */
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-teal-500 bg-teal-50">
                  <span className="text-[9px] font-semibold text-teal-700 bg-teal-100 rounded px-1 py-0.5 shrink-0">ALT</span>
                  <span className="font-mono text-[11px] text-gray-700 shrink-0">{altSkuCode}</span>
                  <span className="text-[10px] text-gray-500 truncate flex-1">{altSkuDescription}</span>
                  <button
                    onClick={clearAlt}
                    className="text-[10px] text-teal-600 hover:text-teal-800 font-medium shrink-0"
                  >
                    Change
                  </button>
                </div>
              ) : (
                /* Search input + results */
                <div className="relative">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search SKU or product name..."
                      className="w-full h-[36px] pl-8 pr-3 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20"
                      onClick={e => e.stopPropagation()}
                    />
                    {searching && (
                      <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-md overflow-hidden">
                      {searchResults.map(sku => (
                        <button
                          key={sku.material}
                          onClick={() => selectAlt(sku)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-teal-50 hover:border-l-2 hover:border-l-teal-500 border-b border-gray-100 last:border-b-0 transition-colors"
                        >
                          <span className="font-mono text-[11px] text-gray-700 shrink-0">{sku.material}</span>
                          <span className="text-[10px] text-gray-500 truncate flex-1">{sku.description}</span>
                          <span className="text-[10px] text-gray-400 shrink-0">{sku.packCode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 5. Note Input */}
            <div>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Add a note (optional)..."
                className="w-full h-[32px] px-3 text-[11px] border border-gray-200 rounded-md focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500/20"
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        {/* 6. Action Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-md text-[12px] font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2 rounded-md text-[12px] font-semibold bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
