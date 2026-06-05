"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Mic } from "lucide-react";

// /po — new public mobile order page. PHASE 1 (skeleton only): pick + lock a
// customer, then render the locked-customer header + a hero product search
// bar placeholder. NO results, NO cart bar, NO bill strip yet — those land
// in Phase 2+.
//
// Modelled on app/order/page.tsx (the frozen backup, NOT edited here):
//   - catalog hydrated from the existing public GET /api/order/data
//   - iOS keyboard plumbing carried over verbatim in behaviour: the
//     visualViewport --vvh effect (write to documentElement.style, never
//     React state) + <main> height var(--vvh, 100vh) + overflow-y-auto,
//     backed by the `html { --vvh: 100vh }` fallback already in globals.css
//   - customer search + selection logic reused (Bill To)
//
// Draft state uses its OWN localStorage key (orbitoms_po_draft) so /po and
// /order never clash while both pages run side by side.

type Customer = { name: string; code: string; area: string | null };

// ── Draft persistence — dedicated key, never /order's or desktop's ─────────
const PO_DRAFT_KEY    = "orbitoms_po_draft";
const PO_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;   // 24h, matches desktop convention

type PoDraft = { customer: Customer; updatedAt: number };

// Returns the locked customer from a non-stale draft, else null. Stale or
// malformed entries are evicted on read.
function loadPoDraft(): Customer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PO_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PoDraft;
    if (!parsed || !parsed.customer || typeof parsed.updatedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.updatedAt > PO_DRAFT_TTL_MS) {
      window.localStorage.removeItem(PO_DRAFT_KEY);
      return null;
    }
    return parsed.customer;
  } catch {
    return null;
  }
}

function savePoDraft(customer: Customer): void {
  if (typeof window === "undefined") return;
  try {
    const entry: PoDraft = { customer, updatedAt: Date.now() };
    window.localStorage.setItem(PO_DRAFT_KEY, JSON.stringify(entry));
  } catch {
    // Quota exceeded / private mode — silently drop. The email is the record
    // of truth; a missing draft just means the user re-picks after refresh.
  }
}

function clearPoDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PO_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export default function PoPage(): React.JSX.Element {
  const [customers,   setCustomers]   = useState<Customer[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [selectedCust, setSelectedCust] = useState<Customer | null>(null);
  const [custQuery,    setCustQuery]    = useState("");

  // Hero product search — Phase 1 placeholder only (no results wired yet).
  const [heroQuery, setHeroQuery] = useState("");

  const custInputRef = useRef<HTMLInputElement | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/order/data")
      .then((r) => r.json())
      .then((data: { customers?: Customer[] }) => {
        setCustomers(data.customers ?? []);
      })
      .catch(() => { /* silent — search just shows no customers */ })
      .finally(() => setDataLoading(false));
  }, []);

  // Restore a locked customer from a non-stale draft on mount.
  useEffect(() => {
    const saved = loadPoDraft();
    if (saved) setSelectedCust(saved);
  }, []);

  // Keyboard-aware viewport sizing — carried over from /order verbatim in
  // behaviour. Android Chrome overlays (not shrinks) the layout viewport when
  // the soft keyboard opens; we mirror iOS Safari by tracking
  // visualViewport.height into a --vvh CSS var that <main> consumes as its
  // explicit height. Written straight to documentElement.style (NOT React
  // state) to avoid a render storm on every resize tick.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    function update(): void {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty("--vvh", `${h}px`);
    }
    update();   // sync write so --vvh has a value before first paint
    if (!vv) return;
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Mount auto-focus the customer search — DESKTOP ONLY (matches /order). On
  // mobile we never pop the keyboard on load. matchMedia is read inside the
  // effect so SSR doesn't see `window`.
  useEffect(() => {
    if (dataLoading || selectedCust) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    custInputRef.current?.focus();
  }, [dataLoading, selectedCust]);

  // ── Customer handlers (modelled on /order) ────────────────────────────────
  const custSuggestions = useMemo<Customer[]>(() => {
    if (custQuery.length < 2) return [];
    const q = custQuery.toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 5);
  }, [custQuery, customers]);

  function selectCustomer(c: Customer): void {
    setSelectedCust(c);
    setCustQuery("");
    savePoDraft(c);
  }

  function clearCustomer(): void {
    setSelectedCust(null);
    setCustQuery("");
    setHeroQuery("");
    clearPoDraft();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <main
      className="bg-[#f9fafb] overflow-y-auto"
      style={{ height: "var(--vvh, 100vh)" }}
    >
      <div className="max-w-[480px] mx-auto flex flex-col min-h-full">

        {!selectedCust ? (
          /* ── Pick a customer ───────────────────────────────────────────── */
          <div className="px-4 pt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 pl-0.5">
              Customer
            </p>
            <div className="bg-white rounded-[14px] overflow-hidden shadow-sm border border-gray-100">
              <div className="flex items-center gap-2.5 px-4 py-3">
                <Search className="w-4 h-4 text-gray-300 shrink-0" />
                <input
                  ref={custInputRef}
                  type="text"
                  value={custQuery}
                  onChange={(e) => setCustQuery(e.target.value)}
                  placeholder={dataLoading ? "Loading customers…" : "Name or customer code…"}
                  disabled={dataLoading}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-300"
                />
                {custQuery && (
                  <button
                    type="button"
                    onClick={() => setCustQuery("")}
                    className="text-gray-300 text-lg leading-none px-1"
                    aria-label="Clear"
                  >
                    ×
                  </button>
                )}
              </div>
              {custSuggestions.length > 0 && (
                <div className="border-t border-gray-100">
                  {custSuggestions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left border-b border-gray-50 last:border-b-0 active:bg-gray-50"
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-teal-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] text-gray-900 truncate">{c.name}</p>
                        <p className="text-[12px] text-gray-400 font-mono mt-0.5 truncate">
                          {c.code}
                          {c.area && <span className="font-sans"> · {c.area}</span>}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── State 1 (mockup): customer locked — header + hero search ───── */
          <>
            <header className="sticky top-0 z-30 bg-white border-b border-gray-200">
              <div className="flex items-center justify-between px-4 py-[14px]">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-gray-900 leading-tight truncate">
                    {selectedCust.name}
                  </div>
                  {selectedCust.code && (
                    <div className="text-[12px] text-gray-500 leading-tight truncate mt-px">
                      {selectedCust.code}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearCustomer}
                  className="text-teal-700 text-[13px] font-medium px-[10px] py-[6px] -mr-[6px] shrink-0"
                >
                  Change
                </button>
              </div>
            </header>

            {/* Hero search bar — Phase 1 placeholder (pill, 16px, search left,
                mic right). 16px font prevents iOS focus-zoom. No results,
                no cart, no bill strip yet (Phase 2+). */}
            <div className="p-4">
              <div className="flex items-center gap-3 border border-gray-300 rounded-full px-[18px] py-[14px] transition-shadow focus-within:border-teal-600 focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.10)]">
                <Search className="w-[19px] h-[19px] text-gray-400 shrink-0" />
                <input
                  type="text"
                  value={heroQuery}
                  onChange={(e) => setHeroQuery(e.target.value)}
                  placeholder="Search products to add"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="flex-1 text-[16px] text-gray-900 bg-transparent border-none outline-none placeholder:text-gray-400"
                />
                <button
                  type="button"
                  aria-label="Voice search"
                  className="shrink-0 text-teal-600"
                >
                  <Mic className="w-[19px] h-[19px]" />
                </button>
              </div>
            </div>

            <div className="mt-auto px-[18px] py-[18px] text-center text-[13px] text-gray-400">
              Add products to start the order
            </div>
          </>
        )}
      </div>
    </main>
  );
}
