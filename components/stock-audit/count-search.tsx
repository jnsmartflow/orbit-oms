"use client";

// components/stock-audit/count-search.tsx — the Count tab: one big SKU box,
// catalog matches, and the not-in-catalog confirm.
//
// Follows docs/mockups/stock-audit/stock-audit-mobile.html search(): "Enter SKU
// code", the big centred box, result rows "code / description · pack", and the
// green "Submitted …" message above the box after a save.
//
// Search rules are the server's (GET /api/stock-count/skus): from 4 characters,
// the code CONTAINED anywhere in the material, max 20. Debounced 250 ms, and
// only the newest answer is applied (an older, slower reply never overwrites it).
//
// BLIND: catalog data only — no quantity of any kind is shown here.

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import type { SkuHit } from "@/lib/stock-audit/types";
import { friendlyError, searchSkus } from "./count-api";
import type { CalcSku } from "./count-calculator";
import type { CountMode } from "@/lib/stock-audit/status";

export interface PickedSku extends CalcSku {
  defaultMode: CountMode;
}

interface Props {
  /** "Submitted 5233221 · 965 pcs" — shown above the box, cleared by the shell. */
  flash: string | null;
  readOnly: boolean;
  /** Bumped by the shell after a save, to clear + refocus the box. */
  resetKey: number;
  onPick: (sku: PickedSku) => void;
}

const MIN_CHARS = 4;
const DEBOUNCE_MS = 250;

export function CountSearch({ flash, readOnly, resetKey, onPick }: Props): React.JSX.Element {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SkuHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  // Clear + focus on mount and after every save (resetKey).
  useEffect(() => {
    setQ("");
    setHits([]);
    setState("idle");
    setConfirmCode(null);
    if (!readOnly) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [resetKey, readOnly]);

  const code = q.trim().toUpperCase();

  useEffect(() => {
    if (code.length < MIN_CHARS) {
      setHits([]);
      setState("idle");
      return;
    }
    const mine = ++seq.current;
    const ctrl = new AbortController();
    setState("loading");
    const t = setTimeout(async () => {
      const r = await searchSkus(code, ctrl.signal);
      if (mine !== seq.current) return; // a newer search is in flight
      if (r.ok) {
        setHits(r.data.skus);
        setState("done");
        setError(null);
      } else if (!ctrl.signal.aborted) {
        setHits([]);
        setState("error");
        setError(r.error.code === "NETWORK" ? "Search failed — check signal" : friendlyError(r.error));
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [code]);

  function pickHit(h: SkuHit): void {
    onPick({
      material: h.material,
      description: h.description,
      pack: h.pack,
      inCatalog: true,
      piecesPerCarton: h.piecesPerCarton,
      defaultMode: h.defaultMode,
    });
  }

  function pickUncatalogued(material: string): void {
    setConfirmCode(null);
    onPick({ material, description: null, pack: null, inCatalog: false, piecesPerCarton: null, defaultMode: "pieces" });
  }

  const noMatch = state === "done" && hits.length === 0;
  // A free-typed code must still be a code the server accepts.
  const codeOk = /^[A-Z0-9][A-Z0-9-]{0,39}$/.test(code);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
      {flash && (
        <div role="status" className="mb-3 rounded-[10px] bg-ok-bg px-3 py-2.5 text-[14px] text-ok-text">
          {flash}
        </div>
      )}

      <label htmlFor="sc-sku" className="mb-2 block text-[13px] text-ink-500">
        Enter SKU code
      </label>
      <input
        id="sc-sku"
        ref={inputRef}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoFocus={!readOnly}
        disabled={readOnly}
        placeholder="5233221"
        value={q}
        onChange={(e) => setQ(e.target.value.replace(/\s+/g, "").slice(0, 40))}
        className="h-14 w-full rounded-[10px] border border-ink-100 bg-white text-center text-[24px] tracking-[1px] tabular-nums text-ink-900 outline-none placeholder:text-ink-200 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 disabled:bg-ink-50"
      />

      {code.length > 0 && code.length < MIN_CHARS && (
        <p className="mt-2 text-[13px] text-ink-400">Type at least {MIN_CHARS} digits</p>
      )}
      {state === "loading" && <p className="mt-3 text-[13px] text-ink-400">Searching…</p>}
      {state === "error" && error && <p className="mt-3 text-[13px] text-danger-text">{error}</p>}

      {hits.length > 0 && (
        <ul className="mt-2">
          {hits.map((h) => (
            <li key={h.material}>
              <button
                type="button"
                onClick={() => pickHit(h)}
                className="flex w-full items-center justify-between gap-2.5 border-b border-ink-100 py-3.5 text-left active:bg-ink-25"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold tabular-nums text-ink-900">{h.material}</span>
                  <span className="block truncate text-[12.5px] text-ink-500">
                    {h.description} · {h.pack}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 flex-none text-ink-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {noMatch && codeOk && (
        <button
          type="button"
          onClick={() => setConfirmCode(code)}
          className="mt-3 w-full rounded-[10px] border border-ink-100 bg-white px-3 py-3.5 text-left text-[15px] text-ink-900 active:bg-ink-25"
        >
          Not in catalog — count <span className="font-semibold tabular-nums">{code}</span> anyway?
        </button>
      )}
      {noMatch && !codeOk && <p className="mt-3 text-[13px] text-danger-text">No SKU with that code</p>}

      {/* Confirm step — a code the catalog does not know is counted only on purpose. */}
      {confirmCode !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setConfirmCode(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-nic-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] rounded-t-[18px] bg-white p-5"
            style={{ paddingBottom: `calc(${MOBILE_NAV_CLEARANCE} + 12px)` }}
          >
            <h2 id="sc-nic-title" className="text-[17px] font-bold text-ink-900">
              Count {confirmCode} anyway?
            </h2>
            <p className="mt-1.5 text-[14px] text-ink-600">
              This code is not in the SKU catalog. Check it against the label before you count — it will be saved as
              “Not in catalog”.
            </p>
            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmCode(null)}
                className="h-12 flex-1 rounded-[12px] bg-ink-50 text-[15px] font-semibold text-ink-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => pickUncatalogued(confirmCode)}
                className="h-12 flex-1 rounded-[12px] bg-brand-600 text-[15px] font-semibold text-white active:bg-brand-700"
              >
                Count it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
