"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Base — No Tint · the Tinter Issue panel for ONE line of ONE bypassed bill.
//
// A bypass closes a bill so it can travel, leaving its Tinter Issue owed. This
// is where the manager pays that debt, one line at a time.
//
// ⚠ THIS IS A SMALL, SEPARATE COMPONENT — NOT A REFACTOR OF THE OPERATOR SCREEN.
// components/tint/tint-operator-content.tsx is untouched and stays the operator's
// own screen. What is reproduced here is only its TI-SAVING core, generalised to
// take a tintAssignmentId + one line as props instead of reading a personal job
// queue: the per-entry suggest fetch, the search-first browse/confirm/newshade
// flow, the pack-filter, the formula-match gate, and the POST payload.
//
// What is DELIBERATELY ABSENT, and must stay absent:
//   · Start / Pause / Resume / Skip / Mark Done — all operator-owned actions on
//     a LIVE job. Every one of them rejects a `tinting_done` assignment
//     server-side, which is what a bypassed assignment already is.
//   · The elapsed timer — a bypass has startedAt === completedAt, so it would
//     read 00:00:00 forever.
//   · The job queue, the CURRENT/PAUSED/UP NEXT dropdown, the History tab.
//   · The split branch — a bypass is whole-OBD only; splits carry no
//     tintAssignmentId.
//   · `andStart`. saveShadesThenSubmitTI's tail (tint-operator-content.tsx
//     :1264-1266) calls startJob when andStart is true; on a done assignment
//     that POSTs /api/tint/operator/start, which 409s on the stage and 403s on
//     the status. This panel never starts anything.
//
// The four helper components (FlatSuggestionList, FormulaMatchModal,
// SaveSamplingPopup, and the pigment grid's colour maps) are used AS-IS — none
// of them touches session, job status or operator identity.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Check, Plus, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { FlatSuggestionList } from "@/components/tint/operator/flat-suggestion-list";
import { FormulaMatchModal } from "@/components/tint/operator/formula-match-modal";
import { SaveSamplingPopup, type SaveSamplingResult } from "@/components/tint/operator/save-sampling-popup";
import type { SuggestResponse, SuggestFlatRow } from "@/app/api/sampling-library/_lib/suggest";
import type { PackCode } from "@prisma/client";
import { canScale, scalePigments, packDoseLitres } from "@/lib/sampling/pack-litres";
import { TINTER_SHADE_COLORS, ACOTONE_SHADE_COLORS } from "@/lib/tint/shade-colors";

// Pigment column order. Copied verbatim from tint-operator-content.tsx's SHADES
// / ACOTONE_SHADES so a value typed here lands in the same column the operator
// screen and the TI report read.
//
// 🔴 THE ACOTONE ORDER IS LOCKED TO THE OPERATOR'S PAPER REGISTER
// (CLAUDE_TINT.md §3.5) — WH1, NO1, NO2, YE1, YE2, XY1, RE1, RE2, XR1, MA1,
// OR1, GR1, BU1, BU2. Do not re-sort it to look tidier; the operator reads this
// grid against a physical page.
const TINTER_CODES = [
  "YOX", "LFY", "GRN", "TBL", "WHT", "MAG", "FFR", "BLK", "OXR", "HEY",
  "HER", "COB", "COG",
] as const;
const ACOTONE_CODES = [
  "WH1", "NO1", "NO2", "YE1", "YE2", "XY1", "RE1", "RE2", "XR1", "MA1",
  "OR1", "GR1", "BU1", "BU2",
] as const;

// Exact-match pack lookup, copied from tint-operator-content.tsx's PACK_CODES +
// derivePackCode. Tolerance 0.005 L — 5× smaller than the smallest adjacent gap
// (0.025 L, between 0.9 L and 0.925 L).
//
// ⚠ This returns the PackCode ENUM value ("L_20"), which is what the TI POST
// requires. It is NOT the human label the base-pending route computes for
// display ("20 L") — those are two different things and must not be swapped.
const PACK_CODES: ReadonlyArray<{ value: string; litres: number }> = [
  { value: "ml_500",  litres: 0.5   }, { value: "L_0_9",   litres: 0.9   },
  { value: "L_0_925", litres: 0.925 }, { value: "L_1",     litres: 1     },
  { value: "L_3_6",   litres: 3.6   }, { value: "L_3_7",   litres: 3.7   },
  { value: "L_4",     litres: 4     }, { value: "L_9",     litres: 9     },
  { value: "L_9_25",  litres: 9.25  }, { value: "L_10",    litres: 10    },
  { value: "L_15",    litres: 15    }, { value: "L_18",    litres: 18    },
  { value: "L_18_5",  litres: 18.5  }, { value: "L_20",    litres: 20    },
  { value: "L_22",    litres: 22    }, { value: "L_30",    litres: 30    },
  { value: "L_40",    litres: 40    },
];

function derivePackCode(volumeLine: number | null, unitQty: number): string | null {
  if (unitQty <= 0 || volumeLine == null) return null;
  const perUnit = volumeLine / unitQty;
  return PACK_CODES.find((p) => Math.abs(perUnit - p.litres) < 0.005)?.value ?? null;
}

export interface BaseTiLine {
  rawLineItemId:     number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  hasTiEntry:        boolean;
}

type ViewMode = "browse" | "confirm" | "newshade";

export function BaseTiPanel({
  tintAssignmentId, siteId, obdNumber, siteName, line, onSaved,
}: {
  tintAssignmentId: number;
  /** orders.customerId. Null → no this-site suggestions; search still works. */
  siteId:           number | null;
  obdNumber:        string;
  siteName:         string;
  line:             BaseTiLine;
  /** Called after a save lands. The parent advances to the next pending line. */
  onSaved:          () => void;
}) {
  const [tinterType, setTinterType] = useState<"TINTER" | "ACOTONE">("TINTER");
  const [mode,       setMode]       = useState<ViewMode>("browse");

  // The single entry. The operator screen carries an ARRAY (one per line typed
  // in a sitting); this panel is one line at a time, so it carries the fields
  // flat. Same shapes, same names, so the save payload is byte-identical.
  const [shadeValues, setShadeValues] = useState<Record<string, number>>({});
  const [samplingNo,  setSamplingNo]  = useState<string | null>(null);
  const [shadeName,   setShadeName]   = useState("");
  const [tinQty,      setTinQty]      = useState<number>(line.unitQty);

  const [suggestData,    setSuggestData]    = useState<SuggestResponse | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const suggestVersion = useRef(0);

  const [search,        setSearch]        = useState("");
  const [searchResults, setSearchResults] = useState<SuggestFlatRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchVersion  = useRef(0);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [packFilter, setPackFilter] = useState<number | "ALL" | undefined>(undefined);

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [popup,  setPopup]  = useState<SaveSamplingResult | null>(null);

  const [formulaOpen,    setFormulaOpen]    = useState(false);
  const [formulaMatches, setFormulaMatches] = useState<SuggestFlatRow[]>([]);
  const [formulaLoading, setFormulaLoading] = useState(false);

  const packCode = derivePackCode(line.volumeLine, line.unitQty);
  const linePack = packCode as PackCode | null;
  const codes    = tinterType === "TINTER" ? TINTER_CODES : ACOTONE_CODES;
  const colours  = tinterType === "TINTER" ? TINTER_SHADE_COLORS : ACOTONE_SHADE_COLORS;

  // ── Reset whenever the line changes ────────────────────────────────────────
  // The parent auto-advances to the next pending line after a save, so this is
  // the hot path, not an edge case: every field must clear or the next line
  // inherits the last one's formula.
  useEffect(() => {
    setMode("browse");
    setShadeValues({});
    setSamplingNo(null);
    setShadeName("");
    setTinQty(line.unitQty);
    setSearch("");
    setSearchResults(null);
    setPackFilter(undefined);
    setError(null);
    setSuggestData(null);
  }, [line.rawLineItemId, line.unitQty]);

  // ── This-site suggestions ─────────────────────────────────────────────────
  // Version-guarded exactly as fetchSuggestForEntry is: a response for a line
  // the manager has already moved past is discarded rather than applied.
  useEffect(() => {
    if (siteId == null || !packCode) { setSuggestData(null); return; }
    const my = ++suggestVersion.current;
    setSuggestLoading(true);
    setSuggestData(null);
    const url = `/api/sampling-library/suggest?siteId=${siteId}`
      + `&skuCode=${encodeURIComponent(line.skuCodeRaw)}`
      + `&packCode=${encodeURIComponent(packCode)}`;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<SuggestResponse>) : null))
      .then((d) => { if (suggestVersion.current === my) setSuggestData(d); })
      .catch(() => { /* render-nothing on failure, per the operator screen */ })
      .finally(() => { if (suggestVersion.current === my) setSuggestLoading(false); });
  }, [siteId, packCode, line.skuCodeRaw]);

  // ── Debounced cross-site search ───────────────────────────────────────────
  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = value.trim();
    if (q === "") {
      // Empty query → fall back to the this-site list. Bump the version so an
      // in-flight response cannot land on top of it.
      searchVersion.current += 1;
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    searchDebounce.current = setTimeout(() => {
      const my = ++searchVersion.current;
      setSearchLoading(true);
      fetch(`/api/sampling-library/operator-search?q=${encodeURIComponent(q)}&type=${tinterType}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ rows: SuggestFlatRow[] }>) : null))
        .then((d) => { if (searchVersion.current === my) setSearchResults(d?.rows ?? []); })
        .catch(() => { if (searchVersion.current === my) setSearchResults([]); })
        .finally(() => { if (searchVersion.current === my) setSearchLoading(false); });
    }, 300);
  }, [tinterType]);

  // ── Apply a picked row ────────────────────────────────────────────────────
  // Type-aware, copied from applySuggestionToEntry: pigment columns come from
  // the CARD's own tinterType, never the toggle — an ACOTONE card picked while
  // the toggle still reads TINTER must still copy its 14 columns. Scaling is
  // TINTER-only and happens ON USE.
  const applyRow = useCallback((card: SuggestFlatRow) => {
    const cardCodes = card.tinterType === "TINTER" ? TINTER_CODES : ACOTONE_CODES;
    const scaled = (card.tinterType === "TINTER" && canScale(card.packCode, linePack))
      ? scalePigments(card.pigments, card.packCode, linePack)
      : null;
    const src = scaled ?? card.pigments;
    const next: Record<string, number> = {};
    for (const c of cardCodes) next[c] = Number(src[c] ?? 0);
    // Bare setter, never a "change type" handler — the operator screen records
    // this as an ordering trap: a type-change resets the entry and would wipe
    // the values being applied.
    if (card.tinterType !== tinterType) setTinterType(card.tinterType);
    setShadeValues(next);
    setSamplingNo(card.samplingNo);
    setShadeName(card.shadeName);
    setMode("confirm");
  }, [linePack, tinterType]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const postTi = useCallback(async () => {
    const endpoint = tinterType === "TINTER"
      ? "/api/tint/operator/tinter-issue"
      : "/api/tint/operator/tinter-issue-b";
    // Payload shape is the operator screen's, minus the split branch: a bypass
    // is whole-OBD, so tintAssignmentId is always the discriminator. The routes
    // reject a body carrying both.
    const body = {
      tintAssignmentId,
      entries: [{
        rawLineItemId: line.rawLineItemId,
        baseSku:       line.skuCodeRaw,
        tinQty,
        packCode,
        samplingNo,
        shadeName:     shadeName.trim() || null,
        ...Object.fromEntries(codes.map((c) => [c, shadeValues[c] ?? 0])),
      }],
    };
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error ?? "Failed to save Tinter Issue");
    }
    const data = (await res.json().catch(() => null)) as {
      entries?: Array<{ allocatedSamplingNo: string; isNewSampling: boolean; isNewVariant: boolean }>;
    } | null;
    const r = data?.entries?.[0];
    if (r?.isNewSampling)      setPopup({ scenario: "new_sampling", samplingNo: r.allocatedSamplingNo, packCode: packCode ?? null });
    else if (r?.isNewVariant)  setPopup({ scenario: "new_variant",  samplingNo: r.allocatedSamplingNo, packCode: packCode ?? null });
  }, [tinterType, tintAssignmentId, line, tinQty, packCode, samplingNo, shadeName, codes, shadeValues]);

  const proceedSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await postTi();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save Tinter Issue");
    } finally {
      setSaving(false);
    }
  }, [postTi, onSaved]);

  // The formula-match gate, copied from handleSubmitTI: it runs ONLY for a
  // genuinely new shade (no samplingNo) carrying a real formula. A reused
  // sampling saves straight through, unchecked.
  const handleSave = useCallback(async () => {
    if (!line.skuCodeRaw) { setError("No SKU on this line"); return; }
    if (tinQty <= 0)      { setError("Tin Qty must be greater than 0"); return; }
    if (!samplingNo && !shadeName.trim()) {
      setError("Enter a shade name or pick a suggestion above");
      return;
    }
    if (saving || formulaLoading) return; // double-submit guard

    const active = codes.map((c) => ({ code: c as string, value: shadeValues[c] ?? 0 })).filter((p) => p.value > 0);
    if (samplingNo == null && active.length > 0) {
      setFormulaMatches([]);
      setFormulaLoading(true);
      setFormulaOpen(true);
      try {
        const res = await fetch("/api/sampling-library/formula-match", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tinterType, packCode,
            ...Object.fromEntries(codes.map((c) => [c, shadeValues[c] ?? 0])),
          }),
        });
        const data = res.ok ? ((await res.json()) as { matches?: SuggestFlatRow[] }) : { matches: [] };
        const matches = data.matches ?? [];
        if (matches.length > 0) {
          setFormulaMatches(matches);
          setFormulaLoading(false);
          return; // HOLD — the manager chooses reuse or create-new.
        }
      } catch {
        // Never block on a failed check — fall through and mint, as the
        // operator screen does.
      }
      setFormulaOpen(false);
      setFormulaLoading(false);
    }
    await proceedSave();
  }, [line.skuCodeRaw, tinQty, samplingNo, shadeName, saving, formulaLoading, codes, shadeValues, tinterType, packCode, proceedSave]);

  // ── The reuse list ────────────────────────────────────────────────────────
  const rows: SuggestFlatRow[] = searchResults ?? suggestData?.flatSuggestions ?? [];
  const lineBucket = packDoseLitres(linePack);
  const effectiveFilter = packFilter ?? (lineBucket ?? "ALL");
  const visibleRows = effectiveFilter === "ALL"
    ? rows
    : rows.filter((r) => packDoseLitres(r.packCode) === effectiveFilter);

  const activePigments = codes
    .map((c) => ({ code: c as string, value: shadeValues[c] ?? 0 }))
    .filter((p) => p.value > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      {/* Identity strip — the bill this line belongs to */}
      <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <p className="text-[12.5px] font-bold text-gray-900">{siteName}</p>
        <p className="text-[10.5px] text-gray-400 mt-0.5">
          {obdNumber} · {line.skuCodeRaw} · {line.unitQty} qty
          {packCode ? ` · ${packCode.replace(/^L_/, "").replace(/_/, ".")} L` : ""}
        </p>
        <p className="text-[12px] font-semibold text-gray-900 mt-1 truncate">
          {line.skuDescriptionRaw ?? "—"}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {/* Tinter type toggle — white-pill on a gray track, per CLAUDE_UI §34 */}
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-gray-100 rounded-[7px] p-[3px] gap-[2px]">
            {(["TINTER", "ACOTONE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  if (t === tinterType) return;
                  setTinterType(t);
                  setShadeValues({});
                  setSamplingNo(null);
                  setShadeName("");
                  setMode("browse");
                }}
                className={cn(
                  "px-2.5 py-1 rounded-[5px] text-[11px] font-semibold transition-colors",
                  t === tinterType ? "bg-white text-gray-900 shadow-sm" : "text-gray-500",
                )}
              >
                {t}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500">
            Tin Qty
            <input
              type="number"
              min={0}
              value={tinQty}
              onChange={(e) => setTinQty(Number(e.target.value))}
              className="w-16 h-7 px-2 text-[12px] border border-gray-200 rounded-md focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            />
          </label>
        </div>

        {/* Applied-shade bar */}
        {mode === "confirm" && (
          <div className="flex items-center gap-2 rounded-[8px] border border-gray-200 bg-gray-50 px-3 py-2">
            <Check size={13} className="text-green-600 flex-shrink-0" />
            <span className="text-[12px] font-semibold text-gray-900 truncate">{shadeName || "—"}</span>
            {samplingNo && <span className="font-mono text-[10.5px] text-gray-400">{samplingNo}</span>}
            <button
              type="button"
              onClick={() => { setMode("browse"); setSamplingNo(null); setShadeName(""); setShadeValues({}); }}
              className="ml-auto text-[10.5px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5"
            >
              <ChevronLeft size={11} /> Change
            </button>
          </div>
        )}

        {/* Reuse list — browse only */}
        {mode === "browse" && (
          <>
            <div className="flex items-center gap-2">
              <select
                value={String(effectiveFilter)}
                onChange={(e) => setPackFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                className="h-8 px-2 text-[11px] border border-gray-200 rounded-md text-gray-600"
              >
                <option value="ALL">All packs</option>
                {[1, 4, 10, 20].map((b) => (
                  <option key={b} value={b}>{b} LT{lineBucket === b ? " · LINE" : ""}</option>
                ))}
              </select>
              <input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search any site…"
                className="flex-1 h-8 px-2.5 text-[12px] border border-gray-200 rounded-md focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
              />
              <button
                type="button"
                onClick={() => { setMode("newshade"); setSamplingNo(null); setShadeName(""); setShadeValues({}); }}
                className="h-8 px-2.5 text-[11px] font-semibold text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 inline-flex items-center gap-1 flex-shrink-0"
              >
                <Plus size={12} /> Add shade
              </button>
            </div>
            <FlatSuggestionList
              rows={visibleRows}
              isLoading={suggestLoading}
              isSearching={searchLoading}
              linePack={linePack}
              onUse={applyRow}
            />
          </>
        )}

        {/* New-shade name */}
        {mode === "newshade" && (
          <div className="flex items-center gap-2">
            <input
              value={shadeName}
              onChange={(e) => setShadeName(e.target.value)}
              placeholder="New shade name"
              className="flex-1 h-8 px-2.5 text-[12px] border border-gray-200 rounded-md focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            />
            <button
              type="button"
              onClick={() => setMode("browse")}
              className="h-8 px-2.5 text-[11px] text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5"
            >
              <ChevronLeft size={11} /> Back to list
            </button>
          </div>
        )}

        {/* Pigment grid — tinted bg + 3px top border in the pigment colour,
            CLAUDE_UI.md §35. Shown for newshade and confirm; browse is the
            list's own space. */}
        {mode !== "browse" && (
          <div className="grid grid-cols-5 gap-1.5">
            {codes.map((code) => {
              // Tokens from lib/tint/shade-colors.ts — the SAME map the operator
              // grid and the Skip modal read, so a pigment is the same colour on
              // every surface. Filled cells take the deeper pair (bgFill/topFill),
              // which is CLAUDE_UI.md §35's "filled cells get deeper bg + darker
              // border".
              const c = colours[code];
              const v = shadeValues[code] ?? 0;
              const filled = v > 0;
              return (
                <div key={code} className="flex flex-col">
                  <div style={{ borderTop: `3px solid ${filled ? c?.topFill ?? "#6b7280" : c?.top ?? "#9ca3af"}` }} />
                  <div
                    style={{
                      backgroundColor: filled ? c?.bgFill ?? "#f3f4f6" : c?.bg ?? "#fff",
                      color:           c?.label ?? "#374151",
                      borderColor:     c?.border ?? "#e5e7eb",
                    }}
                    className="rounded-b-[6px] border border-t-0 px-1 py-1"
                  >
                    <div className="text-[9px] font-bold tracking-wide">{code}</div>
                    <input
                      type="number"
                      step="0.001"
                      min={0}
                      value={v === 0 ? "" : v}
                      onChange={(e) => {
                        const n = e.target.value === "" ? 0 : Number(e.target.value);
                        setShadeValues((p) => ({ ...p, [code]: n }));
                      }}
                      className="w-full bg-transparent text-[12px] font-semibold outline-none tabular-nums"
                      placeholder="0"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <p className="text-[11.5px] text-red-600 bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5">
            {error}
          </p>
        )}
      </div>

      {/* Save bar */}
      <div className="px-4 py-3 border-t border-gray-200 flex items-center gap-2 flex-shrink-0">
        <span className="text-[10.5px] text-gray-400">
          {activePigments.length} pigment{activePigments.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => { void handleSave(); }}
          className="ml-auto bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-[7px] text-[12px] font-semibold px-4 py-2 inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save Tinter Issue
        </button>
      </div>

      <FormulaMatchModal
        open={formulaOpen}
        enteredShadeName={shadeName}
        enteredTinterType={tinterType}
        enteredActivePigments={activePigments}
        matches={formulaMatches}
        loading={formulaLoading}
        linePack={linePack}
        scalingEnabled={tinterType === "TINTER"}
        onUse={(pickedSamplingNo) => {
          const row = formulaMatches.find((m) => m.samplingNo === pickedSamplingNo);
          setFormulaOpen(false);
          if (row) {
            applyRow(row);
            // The pick has landed in state; save on the next tick so postTi
            // reads the reused samplingNo rather than the pre-pick null.
            setTimeout(() => { void proceedSave(); }, 0);
          }
        }}
        onCreateNew={() => { setFormulaOpen(false); void proceedSave(); }}
        // Cancel / Esc / backdrop aborts with NO new sampling number
        // (CLAUDE_TINT.md §3.12) — only Use and Create new mint or save.
        onClose={() => { setFormulaOpen(false); setFormulaLoading(false); }}
      />

      {popup && <SaveSamplingPopup result={popup} onClose={() => setPopup(null)} />}
    </div>
  );
}
