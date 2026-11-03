"use client";

// components/stock-audit/count-search.tsx — the Count tab: one big SKU box,
// catalog matches, and the not-in-catalog confirm.
//
// Follows docs/mockups/stock-audit/stock-audit-mobile.html search(): "Enter SKU
// code", the big centred box, and the green "Submitted …" message above the box
// after a save. Result rows are picking-style cards (2026-11-02): pack cell on
// the left, mono code with the typed part tinted, description below.
//
// INSTANT, LOCAL SEARCH (2026-11-02): the shell downloads the whole SKU list
// once (components/stock-audit/catalog-store.ts) and this box searches it on
// every keystroke with lib/stock-audit/sku-search.ts searchCatalog — from 4
// characters, the code CONTAINED anywhere in the material, isPrimary first,
// max 20. No server call per keystroke; the server still checks the code on save.
//
// BLIND: catalog data only — no quantity of any kind is shown here.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { SEARCH_MIN_CHARS, searchCatalog, type CatalogRow, type SkuHit } from "@/lib/stock-audit/sku-search";
import type { CalcSku } from "./count-calculator";

export type PickedSku = CalcSku;

interface Props {
  /** "Submitted 5233221 · 965 pcs" — shown above the box, cleared by the shell. */
  flash: string | null;
  readOnly: boolean;
  /** Bumped by the shell after a save, to clear + refocus the box. */
  resetKey: number;
  /** The downloaded SKU list; null until the first copy is in hand. */
  catalog: CatalogRow[] | null;
  /** Why the list could not be downloaded (shown only while there is no copy). */
  catalogError: string | null;
  onRetryCatalog: () => void;
  onPick: (sku: PickedSku) => void;
}

const MIN_CHARS = SEARCH_MIN_CHARS;

/** Drop the pack from the END of the description, but only on an exact
 *  trailing match ("… WHITE 1L" + pack "1L" → "… WHITE"). Nothing else. */
function descriptionWithoutPack(description: string, pack: string): string {
  if (!pack) return description;
  const tail = ` ${pack}`;
  return description.endsWith(tail) ? description.slice(0, -tail.length) : description;
}

/** The code with the typed part tinted (the search matches it anywhere). */
function HighlightedCode({ material, typed }: { material: string; typed: string }): React.JSX.Element {
  const at = typed ? material.toUpperCase().indexOf(typed) : -1;
  if (at < 0) return <>{material}</>;
  return (
    <>
      {material.slice(0, at)}
      <mark className="rounded-[3px] bg-warn-bg text-warn-text">{material.slice(at, at + typed.length)}</mark>
      {material.slice(at + typed.length)}
    </>
  );
}

export function CountSearch({
  flash,
  readOnly,
  resetKey,
  catalog,
  catalogError,
  onRetryCatalog,
  onPick,
}: Props): React.JSX.Element {
  const [q, setQ] = useState("");
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Clear + focus on mount and after every save (resetKey).
  useEffect(() => {
    setQ("");
    setConfirmCode(null);
    if (!readOnly) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [resetKey, readOnly]);

  const code = q.trim().toUpperCase();

  const hits: SkuHit[] = useMemo(() => (catalog ? searchCatalog(catalog, code) : []), [catalog, code]);
  const searched = catalog !== null && code.length >= MIN_CHARS;

  function pickHit(h: SkuHit): void {
    onPick({
      material: h.material,
      description: h.description,
      pack: h.pack,
      inCatalog: true,
    });
  }

  function pickUncatalogued(material: string): void {
    setConfirmCode(null);
    onPick({ material, description: null, pack: null, inCatalog: false });
  }

  const noMatch = searched && hits.length === 0;
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
      {catalog === null && !catalogError && code.length >= MIN_CHARS && (
        <p className="mt-3 text-[13px] text-ink-400">Loading the SKU list…</p>
      )}
      {catalog === null && catalogError && (
        <p className="mt-3 text-[13px] text-danger-text">
          {catalogError}{" "}
          <button type="button" onClick={onRetryCatalog} className="font-semibold text-brand-700">
            Try again
          </button>
        </p>
      )}

      {hits.length > 0 && (
        <ul className="mt-3 space-y-2">
          {hits.map((h) => (
            <li key={h.material}>
              {/* Picking-card look (picker-my-picks-board.tsx combined row):
                  pack cell on the left, mono code over the description. */}
              <button
                type="button"
                onClick={() => pickHit(h)}
                className="flex w-full items-stretch overflow-hidden rounded-[14px] border border-ink-100 bg-white text-left active:bg-ink-25"
              >
                <span className="flex w-[72px] flex-none items-center justify-center border-r border-ink-100 bg-ink-25 px-1 py-3">
                  <span className="text-center text-[17px] font-bold text-ink-700">{h.pack || "—"}</span>
                </span>
                <span className="min-w-0 flex-1 px-3 py-2.5">
                  <span className="block truncate font-mono text-[17px] font-bold text-ink-900">
                    <HighlightedCode material={h.material} typed={code} />
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-500">
                    {descriptionWithoutPack(h.description, h.pack)}
                  </span>
                </span>
                <span className="flex flex-none items-center pr-3">
                  <ChevronRight className="h-5 w-5 text-ink-400" aria-hidden="true" />
                </span>
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
