"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Search } from "lucide-react";
import { toast } from "sonner";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { CiLineRows, CiPackChips } from "./line-list";
import { CiQtySheet } from "./qty-sheet";
import type { CiBillLine, CiBillResult, CiSearchHit, CiSearchResult } from "@/lib/ci/types";

// The supervisor's New tab — frames 1-5 of docs/mockups/ci/supervisor.html:
// search → results → bill (Full bill / Part) → line list → quantity sheet →
// Next.
//
// ⚠ STEP 4a ENDS AT "NEXT". Tapping it creates a REAL draft with REAL lines, so
// the journey is hand-testable end to end; the details screen it lands on is a
// placeholder that step 4b replaces.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 TWO CORE §3 RULES THIS SCREEN IS SHAPED BY
// ═══════════════════════════════════════════════════════════════════════════
//
// 1. NEVER router.refresh(). Next gives navigations priority in its router
//    action queue: an ACTION_RESTORE (which is what a history pop becomes)
//    marks any pending action discarded, so its result is never applied. Only a
//    discarded SERVER ACTION gets the needsRefresh rescue; a plain refresh gets
//    nothing. Picking's picker face shipped exactly that bug and TWO attempts to
//    fix it by re-ordering shipped green and stayed broken on production —
//    the ordering belongs to React's and Next's schedulers, not to us. Every
//    data change here is a client fetch + setState. There is no router.refresh
//    in this file and none may be added.
//
// 2. NO SYNCHRONOUS HISTORY NAVIGATION IN THE SAME TICK as anything else that
//    navigates. The Next handler defers its screen change with
//    setTimeout(…, 0) for that reason.

type Step = "search" | "results" | "bill" | "details";

interface Props {
  /** For the module header's avatar. Passed down rather than re-derived. */
  userInitials: string;
  /** Placeholder hand-off for step 4b. Called once the draft + lines are saved. */
  onDraftReady?: (ciId: number, bill: CiBillResult) => void;
  /** Lets the shell hide the module tab bar while a bill is open. */
  onInsideBill?: (inside: boolean) => void;
}

export function CiNewReturn({ userInitials, onDraftReady, onInsideBill }: Props): React.JSX.Element {
  // The shared Menu / You sheets RoleLayoutClient mounts once for this subtree.
  const { openMenu, openYou } = useMobileShell();
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<CiSearchHit[]>([]);
  const [searchedTerm, setSearchedTerm] = useState<string | null>(null);

  const [bill, setBill] = useState<CiBillResult | null>(null);
  const [billLoading, setBillLoading] = useState(false);
  const [mode, setMode] = useState<"full" | "part">("full");
  const [activePackFilter, setActivePackFilter] = useState("ALL");
  /** rawLineItemId → tins coming back. Part only. */
  const [returned, setReturned] = useState<Map<number, number>>(new Map());
  const [sheetLine, setSheetLine] = useState<CiBillLine | null>(null);

  const [saving, setSaving] = useState(false);
  // 🔴 ONE ciId PER BILL, HELD FOR THE WHOLE FLOW. Going Back and changing the
  // lines re-PUTs onto this SAME id — /draft is never called twice for one bill.
  // A second draft is a second CI waiting to happen, and the whole
  // draft→lines→submit split exists to stop exactly that.
  const ciIdRef = useRef<number | null>(null);

  // The shell hides its two tabs while a bill is open (mockup: "Tab bar
  // disappears inside a bill"). Reported UP rather than owned here, because
  // RoleLayoutClient's hideBar slot lives above this component.
  useEffect(() => {
    onInsideBill?.(step === "bill" || step === "details");
  }, [step, onInsideBill]);

  // ── Search ────────────────────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 4) {
      toast.error("Type at least 4 characters of an invoice or OBD number.");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/ci/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Search failed.");
        return;
      }
      const data = (await res.json()) as CiSearchResult;
      setSearchedTerm(data.query);
      setHits(data.hits);

      if (data.hits.length === 0) {
        toast.error(`No bill found for ${data.query}.`);
        setStep("search");
        return;
      }
      // ⚠ A UI SHORTCUT, NOT A QUERY SHORTCUT. The route always returns a list
      // (11 live invoice numbers map to two OBDs each); with exactly one hit
      // there is simply no list worth showing, so we skip straight to the bill.
      if (data.hits.length === 1) {
        void openBill(data.hits[0].orderId);
        return;
      }
      setStep("results");
    } catch {
      toast.error("Search failed — check the connection and try again.");
    } finally {
      setSearching(false);
    }
    // openBill is stable enough for this handler; declaring it would need a
    // forward reference. Deliberately omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // ── Open one bill ─────────────────────────────────────────────────────────
  const openBill = useCallback(async (orderId: number) => {
    setBillLoading(true);
    try {
      const res = await fetch(`/api/ci/bill/${orderId}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Could not open that bill.");
        return;
      }
      const data = (await res.json()) as CiBillResult;
      setBill(data);
      // A fresh bill is a fresh decision — never inherit the previous one's
      // mode, ticks or pack filter.
      setMode("full");
      setReturned(new Map());
      setActivePackFilter("ALL");
      ciIdRef.current = null;
      setStep("bill");
    } catch {
      toast.error("Could not open that bill — check the connection.");
    } finally {
      setBillLoading(false);
    }
  }, []);

  // ── Next — the part that writes ───────────────────────────────────────────
  const lineCount = mode === "full" ? (bill?.lines.length ?? 0) : returned.size;
  const canProceed = bill !== null && lineCount > 0 && !saving;

  const onNext = useCallback(async () => {
    if (!bill || saving) return;
    if (lineCount === 0) {
      toast.error("Pick at least one line that came back.");
      return;
    }
    setSaving(true);
    try {
      // 1. The draft — ONCE per bill. Reuses the held id on a Back-and-change.
      if (ciIdRef.current === null) {
        const res = await fetch("/api/ci/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // ⚠ orderId + returnType ARE THE WHOLE BODY. The stage-1 answers
          // (material moved, received on, reason) belong to the details screen
          // and the draft stores NULL for them — owner ruling 2026-09-01, no
          // placeholders. An earlier version of this call sent invented
          // defaults to satisfy NOT NULL columns; those columns are nullable
          // now and the values are gone. Do not reintroduce them.
          body: JSON.stringify({ orderId: bill.orderId, returnType: mode }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(j.error ?? "Could not start the return.");
          return;
        }
        const j = (await res.json()) as { ciId: number };
        ciIdRef.current = j.ciId;
      }

      // 2. The lines. A REPLACE, so Back-and-change is safe to repeat.
      // ⚠ FULL BILL SENDS NO PAIRS AT ALL — the server computes them from the
      // bill's active lines. A stale phone must not be able to file a "full"
      // return that silently omits a line added by a re-import.
      const res2 = await fetch(`/api/ci/${ciIdRef.current}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "full"
            ? {}
            : {
                lines: Array.from(returned.entries()).map(
                  ([rawLineItemId, returnedQty]) => ({ rawLineItemId, returnedQty }),
                ),
              },
        ),
      });
      if (!res2.ok) {
        const j = (await res2.json().catch(() => ({}))) as { error?: string };
        toast.error(j.error ?? "Could not save the lines.");
        return;
      }

      // ⚠ DEFERRED (CORE §3). The screen change is a navigation; firing it in
      // the same tick as anything else that navigates is the mobile trap this
      // rule exists for.
      const ciId = ciIdRef.current;
      const savedBill = bill;
      setTimeout(() => {
        setStep("details");
        if (ciId !== null) onDraftReady?.(ciId, savedBill);
      }, 0);
    } catch {
      toast.error("Could not save — check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [bill, mode, returned, lineCount, saving, onDraftReady]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === "bill" || step === "details") {
    if (bill === null) return <div className="p-6 text-[13px] text-gray-400">Loading…</div>;
    return (
      <div className="fixed inset-0 z-30 bg-[#F4F6F7] flex flex-col">
        {/* TEAL HEADER — picking's exact geometry: bg-teal-600, pl-3.5 pr-1.5
            pb-3.5, safe-area top padding, 38px rounded-[10px] back square on
            white/[0.16]. Customer name at 18px/600 with the OBD beneath.
            NOTHING ELSE — no time, no dispatch window (mockup note). */}
        <div
          className="bg-teal-600 pl-3.5 pr-1.5 pb-3.5 flex flex-col shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                // Straight back to the list this bill came from. No history
                // pop: this screen was never pushed onto history, so popping
                // would leave /ci entirely.
                setStep(hits.length > 1 ? "results" : "search");
              }}
              aria-label="Back"
              className="w-[38px] h-[38px] rounded-[10px] bg-white/[0.16] flex items-center justify-center text-white shrink-0"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-semibold text-white truncate min-w-0">
                {bill.customerName}
              </div>
              <div className="text-[11.5px] text-white/70 truncate">{bill.obdNumber}</div>
            </div>
          </div>
        </div>

        {/* SUB-HEADER STRIP — identical on every screen of the flow:
            date · invoice · litres. A white band flush under the header, no
            rounding, one bottom border — picking's stat-band material. */}
        <div className="bg-white border-b border-gray-200 shrink-0 px-[14px] py-3 flex items-center gap-2 text-[12.5px]">
          <span className="text-gray-600 shrink-0">{formatDay(bill.invoiceDate ?? bill.obdDateTime)}</span>
          <span className="text-[#d8dce1]">·</span>
          {/* Blank invoice is NORMAL — 5% of dispatched bills have none yet and
              SAP sends it later. An em-dash, never an error. */}
          <span className="text-gray-600 truncate min-w-0">{bill.invoiceNo ?? "—"}</span>
          <span className="text-[#d8dce1]">·</span>
          <span className="font-semibold tabular-nums text-gray-700 shrink-0">
            {bill.totalLitres} L
          </span>
        </div>

        {step === "details" ? (
          <PlaceholderDetails ciId={ciIdRef.current} lineCount={lineCount} />
        ) : (
          <>
            {/* SEGMENTED CONTROL — its own strip. */}
            <div className="bg-white border-b border-gray-200 shrink-0 px-3.5 py-2.5">
              <div className="flex bg-[#f1f4f5] rounded-full p-[3px]">
                {(["full", "part"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m);
                      // Switching to Full discards the Part ticks — Full is
                      // "everything", so keeping them would be meaningless, and
                      // switching back should start clean rather than restore a
                      // half-finished selection the supervisor cannot see.
                      if (m === "full") {
                        setReturned(new Map());
                        setActivePackFilter("ALL");
                      }
                    }}
                    className={
                      "flex-1 h-9 rounded-full text-[13.5px] font-semibold transition-colors " +
                      (mode === m ? "bg-white text-gray-900 shadow-sm" : "text-[#6b7480]")
                    }
                  >
                    {m === "full" ? "Full bill" : "Part"}
                  </button>
                ))}
              </div>
            </div>

            {/* PACK CHIPS — Part only. CiPackChips self-guards at <2 packs. */}
            {mode === "part" && (
              <CiPackChips
                lines={bill.lines}
                activePackFilter={activePackFilter}
                onPackFilter={setActivePackFilter}
              />
            )}

            <div className="flex-1 overflow-y-auto px-3 pt-3">
              <CiLineRows
                lines={bill.lines}
                activePackFilter={activePackFilter}
                mode={mode}
                returned={returned}
                onOpenLine={setSheetLine}
              />
            </div>

            {/* BOTTOM PILL — picking's CTA verbatim: full width, h-12,
                rounded-full, teal-600 with its shadow, safe-area padding. The
                module tab bar is gone here; this is the whole bottom. */}
            <div
              className="shrink-0 px-3.5 pb-3.5 bg-[#F4F6F7]"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
            >
              <button
                type="button"
                onClick={() => void onNext()}
                disabled={!canProceed}
                className={
                  "w-full h-12 rounded-full text-[14.5px] font-bold " +
                  (canProceed
                    ? "bg-teal-600 active:bg-teal-700 text-white shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed")
                }
              >
                {saving ? "Saving…" : "Next"}
              </button>
            </div>
          </>
        )}

        {sheetLine !== null && (
          <CiQtySheet
            line={sheetLine}
            initialQty={returned.get(sheetLine.rawLineItemId) ?? null}
            onCancel={() => setSheetLine(null)}
            onSave={(qty) => {
              setReturned((prev) => {
                const next = new Map(prev);
                // 0 clears the line rather than storing a zero-tin row — the
                // server rejects returnedQty < 1, and "none came back" is the
                // same as "not returned".
                if (qty <= 0) next.delete(sheetLine.rawLineItemId);
                else next.set(sheetLine.rawLineItemId, qty);
                return next;
              });
              setSheetLine(null);
            }}
          />
        )}
      </div>
    );
  }

  // ── Search / results ──────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-[#F4F6F7]">
      <ModuleMobileHeader
        title="CI"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        // The body carries a full search FIELD; a header search ICON would be a
        // second control for the one action this screen exists to perform.
        showSearch={false}
      />

      <div className="px-3.5 pt-3.5">
        <div className="flex items-center gap-2 bg-white rounded-full border border-gray-200 px-4 h-12">
          <Search size={17} className="text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            inputMode="search"
            enterKeyHint="search"
            placeholder="Invoice or OBD number"
            aria-label="Invoice or OBD number"
            className="flex-1 min-w-0 text-[15px] outline-none bg-transparent"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setHits([]);
                setStep("search");
              }}
              aria-label="Clear"
              className="text-gray-400 text-[17px] leading-none shrink-0"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching || billLoading}
          className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold mt-2.5 disabled:bg-gray-100 disabled:text-gray-400 shadow-[0_8px_22px_rgba(13,148,136,0.42)] disabled:shadow-none"
        >
          {searching ? "Searching…" : billLoading ? "Opening…" : "Search the bill"}
        </button>
      </div>

      {step === "results" && (
        <div className="px-3 pt-4">
          <p className="text-[12.5px] text-gray-500 px-1 pb-2">
            {hits.length} bills for {searchedTerm}
          </p>
          {hits.map((h) => (
            <button
              key={h.orderId}
              type="button"
              onClick={() => void openBill(h.orderId)}
              className="w-full text-left bg-white rounded-[14px] px-3.5 py-3 mb-2 active:opacity-90"
              style={{ boxShadow: "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)" }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-[15px] font-bold text-gray-900 truncate">
                  {h.obdNumber}
                </span>
                <span className="text-[11.5px] text-gray-400 shrink-0">
                  {h.lineCount} line{h.lineCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 mt-1">
                <span className="text-[13.5px] text-gray-700 truncate min-w-0">
                  {h.customerName}
                </span>
                <span className="text-[11.5px] text-gray-500 shrink-0 tabular-nums">
                  {formatDay(h.invoiceDate ?? h.obdDateTime)} · {h.totalLitres} L
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Placeholder for step 4b ──────────────────────────────────────────────────

function PlaceholderDetails({
  ciId,
  lineCount,
}: {
  ciId: number | null;
  lineCount: number;
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-8">
      <p className="text-[15px] font-semibold text-gray-900">Draft saved</p>
      <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
        CI draft <span className="font-mono font-semibold">#{ciId ?? "?"}</span> now holds{" "}
        {lineCount} line{lineCount === 1 ? "" : "s"}.
      </p>
      <p className="text-[12.5px] text-gray-400 mt-4 leading-relaxed">
        The details step — Material moved, Received on, Reason, Remark — and Submit are step 4b.
        Nothing here is visible to billing yet: a draft is filtered out of every board, list,
        marker and search.
      </p>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** "22 Aug 2026" from an ISO date or instant. Blank input → em-dash. */
function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
