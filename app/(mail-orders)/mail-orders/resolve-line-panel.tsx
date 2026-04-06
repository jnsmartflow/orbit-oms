"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, X } from "lucide-react";
import { searchSkus, resolveLine } from "@/lib/mail-orders/api";
import type { MoOrderLine } from "@/lib/mail-orders/types";

interface SkuResult {
  material: string;
  description: string;
  packCode: string;
  packMatch: boolean;
}

interface ResolveLinePanelProps {
  line: MoOrderLine;
  onResolved: (lineId: number, skuCode: string, skuDescription: string) => void;
  onCancel: () => void;
}

function extractSearchWords(rawText: string): string {
  return rawText
    .replace(/[*\u00d7x@/\-:.,;()]/gi, " ")  // strip separators
    .replace(/\b\d+\b/g, " ")                  // strip standalone numbers
    .replace(/\s+/g, " ")                       // collapse whitespace
    .trim()
    .split(" ")
    .filter(w => w.length > 1)                  // drop single chars
    .join(" ");
}

export function ResolveLinePanel({ line, onResolved, onCancel }: ResolveLinePanelProps) {
  const [searchQuery, setSearchQuery] = useState(
    () => extractSearchWords(line.rawText),
  );
  const [results, setResults] = useState<SkuResult[]>([]);
  const [selectedSku, setSelectedSku] = useState<SkuResult | null>(null);
  const [saveKeyword, setSaveKeyword] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [packFilter, setPackFilter] = useState(!!line.packCode);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleSearchChange = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchQuery(q);
    setSelectedSku(null);
    setError(false);

    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchSkus(
          q.trim(),
          packFilter && line.packCode ? line.packCode : undefined,
        );
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packFilter, line.packCode]);

  // Fire initial search on mount
  useEffect(() => {
    const initial = extractSearchWords(line.rawText);
    if (initial.length >= 2) {
      handleSearchChange(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-search when pack filter toggles
  useEffect(() => {
    if (searchQuery.trim().length >= 2 && !selectedSku) {
      handleSearchChange(searchQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packFilter]);

  async function handleSave() {
    if (!selectedSku) return;
    setLoading(true);
    setError(false);
    try {
      await resolveLine(line.id, selectedSku.material, saveKeyword);
      onResolved(line.id, selectedSku.material, selectedSku.description);
    } catch {
      setError(true);
      setLoading(false);
    }
  }

  const hasDetected = line.productName || line.baseColour;

  return (
    <tr>
      <td
        colSpan={6}
        className="bg-amber-50/30"
        style={{ borderBottom: "1px solid #fde68a", padding: "10px 14px" }}
      >
        <div className="flex gap-3 items-start">
          {/* Left — line info */}
          <div className="flex-shrink-0 w-[280px]">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">
              Raw Text
            </p>
            <p className="text-[12px] text-gray-700 font-medium">{line.rawText}</p>

            {hasDetected ? (
              <>
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 mb-1 mt-2">
                  Detected
                </p>
                <div className="text-[12px] text-gray-600 space-y-0.5">
                  {line.productName && (
                    <p><span className="text-gray-400 text-[10px]">Product</span>{" "}<span className="font-medium">{line.productName}</span></p>
                  )}
                  {line.baseColour && (
                    <p><span className="text-gray-400 text-[10px]">Base</span>{" "}<span className="font-medium">{line.baseColour}</span></p>
                  )}
                  <p>
                    <span className="text-gray-400 text-[10px]">Pack</span>{" "}{line.packCode ?? "\u2014"}
                    <span className="text-gray-400 text-[10px] ml-3">Qty</span>{" "}{line.quantity}
                  </p>
                </div>
              </>
            ) : (
              <>
                <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 mb-1 mt-2">
                  Pack Code
                </p>
                <p className="text-[12px] text-gray-600">
                  {line.packCode ?? "\u2014"}
                  <span className="text-gray-400 text-[10px] ml-3">Qty</span>{" "}{line.quantity}
                </p>
              </>
            )}
          </div>

          {/* Right — search + select */}
          <div className="flex-1 min-w-0">
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 mb-1">
              Select SKU
            </p>

            {/* Search input */}
            {!selectedSku && (
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search material code or description\u2026"
                  className="w-full h-[32px] border border-gray-200 rounded-md px-3 text-[12px] text-gray-900 placeholder:text-gray-400 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
                  autoFocus
                />
                {searching && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 animate-spin" />
                )}
              </div>
            )}

            {/* Pack filter chip */}
            {line.packCode && !selectedSku && (
              <div className="flex items-center gap-2 mt-1.5 mb-1">
                <button
                  type="button"
                  onClick={() => setPackFilter(prev => !prev)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                    packFilter
                      ? "bg-teal-50 border-teal-300 text-teal-700"
                      : "bg-gray-50 border-gray-200 text-gray-500"
                  }`}
                >
                  Pack: {line.packCode}
                  {packFilter ? " \u2715" : ""}
                </button>
                <span className="text-[10px] text-gray-400">
                  {packFilter ? "Showing matching pack first" : "Showing all packs"}
                </span>
              </div>
            )}

            {/* Results dropdown */}
            {results.length > 0 && !selectedSku && (
              <div className="bg-white border border-gray-200 rounded-md shadow-md mt-1 max-h-[200px] overflow-y-auto">
                {results.map((sku) => (
                  <button
                    key={sku.material}
                    type="button"
                    onClick={() => {
                      setSelectedSku(sku);
                      setResults([]);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 last:border-b-0 ${!sku.packMatch ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-gray-800">{sku.material}</span>
                      <span className={`text-[10px] rounded px-1.5 ${
                        sku.packMatch
                          ? "bg-teal-50 text-teal-700 border border-teal-200"
                          : "bg-gray-100 text-gray-500"
                      }`}>
                        {sku.packCode}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 truncate">{sku.description}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Selected SKU display */}
            {selectedSku && (
              <div className="bg-white border border-gray-200 rounded-md px-3 py-2 flex justify-between items-center">
                <div className="min-w-0">
                  <span className="font-mono text-[12px] text-gray-800">{selectedSku.material}</span>
                  <span className="text-[11px] text-gray-500 ml-2 truncate">
                    {selectedSku.description}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSku(null);
                    setSearchQuery("");
                    setResults([]);
                  }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Save keyword checkbox */}
            <label className="mt-2 flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveKeyword}
                onChange={(e) => setSaveKeyword(e.target.checked)}
                className="accent-teal-600"
              />
              <span className="text-[11px] text-gray-500">
                Remember this match for future auto-enrichment
              </span>
            </label>

            {/* Error message */}
            {error && (
              <p className="text-red-500 text-[11px] mt-1">Failed — try again</p>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="border border-gray-200 text-gray-500 hover:bg-gray-50 text-[11px] px-3 h-[28px] rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedSku || loading}
                onClick={handleSave}
                className={`text-[11px] px-3 h-[28px] rounded-md transition-colors ${
                  !selectedSku || loading
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-gray-900 text-white hover:bg-gray-800"
                }`}
              >
                {loading ? "Saving\u2026" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
