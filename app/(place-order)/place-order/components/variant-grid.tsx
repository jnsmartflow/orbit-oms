"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Product } from "../types";
import { formatPack, packStep, sortPacks } from "@/lib/place-order/pack";
import VariantCell, { type CellNavDirection, type VariantCellHandle } from "./variant-cell";

// Base × pack qty matrix. `products` is one row per baseColour for the
// active sub-product. Pack columns are the union of all packs across
// those rows, sorted ascending by ML.
//
// Composes existing variant-cell.tsx (decision D Stage 2) — keyboard
// semantics + ref-driven focus management already proven in production.

export interface VariantGridProps {
  products:          Product[];
  qtyAt:             (subProduct: string, baseColour: string | null, pack: string) => number;
  onSetQty:          (product: Product, pack: string, qty: number) => void;
  focusHintBase?:    string | null;
  onFocused?:        () => void;
  onEscape:          () => void;
  onNextSubProduct?: () => void;    // PageDown from cell → next tab (family/drilled-section only)
  onPrevSubProduct?: () => void;    // PageUp  from cell → previous tab
}

const BASE_COL_PERCENT = 32;

export default function VariantGrid({
  products, qtyAt, onSetQty, focusHintBase, onFocused, onEscape,
  onNextSubProduct, onPrevSubProduct,
}: VariantGridProps): React.JSX.Element {
  const packs = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const p of products) for (const pack of p.packs) set.add(pack);
    return sortPacks(Array.from(set));
  }, [products]);

  const cellMatrix = useMemo(() => {
    return products.map((product) =>
      packs.map((pack) => ({
        product,
        pack,
        available: product.packs.includes(pack),
      })),
    );
  }, [products, packs]);

  // 2D ref grid populated via ref callbacks below.
  const cellRefs = useRef<Array<Array<VariantCellHandle | null>>>([]);

  // Tracks the previous focusHintBase across renders. Used to detect the
  // "consumed → null" transition triggered by onFocused?.() inside the
  // effect — without this guard, the post-consumption re-render fires
  // the effect again with focusHintBase=null, defaulting targetRow to 0
  // and stealing focus from whichever base row we just landed on.
  const prevFocusHintRef = useRef<string | null | undefined>(undefined);

  // Auto-focus first available cell on mount / sub-product change. When
  // focusHintBase is set (search hand-off), target that base-row.
  //
  // Deps key on `viewKey` (string fingerprint of the active sub-product)
  // rather than the `products` array directly — the dispatcher rebuilds
  // `filtered` on every parent render, so a reference-keyed dep would
  // re-fire (and steal focus) on every keystroke / qty edit. viewKey
  // is by-value-stable across re-renders of the same view.
  const viewKey = `${products[0]?.family ?? ""}|${products[0]?.subProduct ?? ""}`;

  useEffect(() => {
    // Always update the ref so future transitions are detected correctly,
    // including the no-op-skip case below.
    const prevHint = prevFocusHintRef.current;
    prevFocusHintRef.current = focusHintBase;

    // Post-consumption clear: the previous run focused the hinted base
    // and called onFocused?.(), which set focusHintBase back to null and
    // triggered this re-fire. Skip — otherwise we'd default targetRow
    // to 0 and override the row we just focused.
    if (prevHint != null && focusHintBase == null) return;

    if (products.length === 0 || packs.length === 0) return;

    let targetRow = 0;
    if (focusHintBase != null) {
      // Normalize comparison — trim + lowercase — defensive against
      // whitespace / casing drift between search emission and catalog row.
      const normalize = (s: string): string => s.trim().toLowerCase();
      const target = normalize(focusHintBase);
      const idx    = products.findIndex((p) => normalize(p.baseColour ?? "") === target);
      if (idx >= 0) targetRow = idx;
    }

    let targetCol = -1;
    for (let c = 0; c < packs.length; c++) {
      if (cellMatrix[targetRow]?.[c]?.available) { targetCol = c; break; }
    }
    if (targetCol < 0) {
      outer: for (let r = 0; r < products.length; r++) {
        for (let c = 0; c < packs.length; c++) {
          if (cellMatrix[r]?.[c]?.available) { targetRow = r; targetCol = c; break outer; }
        }
      }
    }
    if (targetCol >= 0) {
      cellRefs.current[targetRow]?.[targetCol]?.focus();
    }
    onFocused?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, focusHintBase]);

  // Walk to next available cell in `direction`, skipping NA cells.
  function navigate(direction: CellNavDirection, fromRow: number, fromCol: number): void {
    const rows = products.length;
    const cols = packs.length;
    if (rows === 0 || cols === 0) return;

    if (direction === "left") {
      for (let c = fromCol - 1; c >= 0; c--) {
        if (cellMatrix[fromRow][c].available) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "right") {
      for (let c = fromCol + 1; c < cols; c++) {
        if (cellMatrix[fromRow][c].available) {
          cellRefs.current[fromRow]?.[c]?.focus();
          return;
        }
      }
    } else if (direction === "up") {
      for (let r = fromRow - 1; r >= 0; r--) {
        if (cellMatrix[r][fromCol].available) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    } else if (direction === "down" || direction === "enter") {
      for (let r = fromRow + 1; r < rows; r++) {
        if (cellMatrix[r][fromCol].available) {
          cellRefs.current[r]?.[fromCol]?.focus();
          return;
        }
      }
    }
  }

  if (products.length === 0 || packs.length === 0) {
    return (
      <div className="px-5 py-6 text-center text-[11px] text-gray-400 italic">
        No SKUs available for this sub-product.
      </div>
    );
  }

  const packColPercent = (100 - BASE_COL_PERCENT) / packs.length;

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: `${BASE_COL_PERCENT}%` }} />
        {packs.map((p) => (
          <col key={p} style={{ width: `${packColPercent}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-gray-50 border-b border-gray-200">
          <th className="text-left px-5 py-2.5 text-[10px] font-medium uppercase tracking-wider text-gray-400">
            Base · Colour
          </th>
          {packs.map((pack) => {
            const label = formatPack(pack);
            const step  = packStep(label);
            return (
              <th key={pack} className="text-center px-2 py-2.5">
                <div className="text-[12px] font-semibold text-gray-700">{label}</div>
                <div className="text-[9.5px] font-mono text-gray-400">box of {step}</div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {products.map((product, rowIdx) => {
          const baseLabel = product.baseColour ?? "Plain";
          const isLastRow = rowIdx === products.length - 1;
          return (
            <tr
              key={`${product.subProduct}|||${product.baseColour ?? ""}`}
              className={`${isLastRow ? "" : "border-b border-gray-50"} hover:bg-gray-50/40`}
            >
              <td className="px-5 py-3">
                <div className="text-[13px] font-semibold text-gray-900">{baseLabel}</div>
              </td>
              {packs.map((pack, colIdx) => {
                const cell = cellMatrix[rowIdx][colIdx];
                const qty  = cell.available
                  ? qtyAt(product.subProduct, product.baseColour ?? null, pack)
                  : 0;
                return (
                  <td key={pack} className="text-center">
                    <VariantCell
                      ref={(handle) => {
                        if (!cellRefs.current[rowIdx]) cellRefs.current[rowIdx] = [];
                        cellRefs.current[rowIdx][colIdx] = handle;
                      }}
                      qty={qty}
                      isAvailable={cell.available}
                      rowIdx={rowIdx}
                      colIdx={colIdx}
                      onSetQty={(q) => onSetQty(product, pack, q)}
                      onCellNav={navigate}
                      onClose={onEscape}
                      onNextSubProduct={onNextSubProduct}
                      onPrevSubProduct={onPrevSubProduct}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
