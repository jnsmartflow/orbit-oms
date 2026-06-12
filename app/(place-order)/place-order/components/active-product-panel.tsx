"use client";

import type { CartLine, Product } from "../types";
import type { RawPack } from "@/lib/place-order/pack-buckets";
import { filterBySection, groupProductsByFamily } from "@/lib/place-order/queries";
import SubProductDirect from "./sub-product-direct";
import FamilyNavWithTabs from "./family-nav-with-tabs";
import SectionLanding from "./section-landing";

// State machine that drives the centre panel below the speed dial. The
// page owns this as `activeState` and feeds the panel; the panel routes
// to one of three sub-components based on `kind`. `speedDialPosition`
// rides on each non-idle variant so the panel header shows the digit
// indicator only when entry was via the speed dial (undefined for
// search-driven entry).
export type ActivePanelState =
  | { kind: "idle" }
  | { kind: "sub-product"; subProductName: string; family: string; speedDialPosition?: number }
  | { kind: "family";      familyName: string; familyNames?: string[]; headerLabel?: string; activeSubProduct: string; speedDialPosition?: number }
  | { kind: "section";     sectionName: string; drilled: null | { familyName: string; activeSubProduct: string }; speedDialPosition?: number };

export interface ActiveProductPanelProps {
  state:              ActivePanelState;
  productsAll:        Product[];
  cartLines:          CartLine[];
  qtyAt:              (product: Product, pack: RawPack) => number;
  onSetQty:           (product: Product, pack: RawPack, qty: number) => void;
  onClose:            () => void;
  onEscape:           () => void;
  onSubProductChange: (subProduct: string) => void;
  onDrillTo:          (familyName: string, firstSubProduct: string) => void;
  onDrillBack:        () => void;
  focusHintBase?:     string | null;
  onFocused?:         () => void;
}

export default function ActiveProductPanel({
  state, productsAll, cartLines,
  qtyAt, onSetQty,
  onClose, onEscape,
  onSubProductChange, onDrillTo, onDrillBack,
  focusHintBase, onFocused,
}: ActiveProductPanelProps): React.JSX.Element | null {
  if (state.kind === "idle") return null;

  if (state.kind === "sub-product") {
    const filtered = productsAll.filter(
      (p) => p.subProduct === state.subProductName && p.family === state.family,
    );
    if (filtered.length === 0) {
      console.warn(
        `[ActiveProductPanel] sub-product not found in catalog: ${state.family} > ${state.subProductName}`,
      );
      return null;
    }
    const section   = filtered[0].section;
    const cartCount = cartLines.filter((l) => l.subProduct === state.subProductName).length;
    return (
      <SubProductDirect
        subProductName={state.subProductName}
        family={state.family}
        section={section}
        products={filtered}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        cartCount={cartCount}
        speedDialPosition={state.speedDialPosition}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
        onClose={onClose}
      />
    );
  }

  if (state.kind === "family") {
    // Single family → familyNames undefined → [familyName] (identical to before).
    // Multi-family group (e.g. Primer + Distemper) → filter in the family-list
    // ORDER so the first family's tabs lead (PRIMER's "Primers" before
    // DISTEMPER's "Distemper"). flatMap preserves each family's own row order.
    const families = state.familyNames ?? [state.familyName];
    const filtered = families.flatMap((f) => productsAll.filter((p) => p.family === f));
    if (filtered.length === 0) {
      console.warn(`[ActiveProductPanel] family not found in catalog: ${families.join(", ")}`);
      return null;
    }
    const section = filtered[0].section;
    return (
      <FamilyNavWithTabs
        familyName={state.familyName}
        headerLabel={state.headerLabel}
        section={section}
        products={filtered}
        activeSubProduct={state.activeSubProduct}
        onSubProductChange={onSubProductChange}
        qtyAt={qtyAt}
        onSetQty={onSetQty}
        cartLines={cartLines}
        speedDialPosition={state.speedDialPosition}
        focusHintBase={focusHintBase}
        onFocused={onFocused}
        onEscape={onEscape}
        onClose={onClose}
      />
    );
  }

  // state.kind === "section"
  const families         = filterBySection(productsAll, state.sectionName);
  const productsByFamily = groupProductsByFamily(productsAll, state.sectionName);
  if (families.length === 0) {
    console.warn(`[ActiveProductPanel] section has no families: ${state.sectionName}`);
    return null;
  }
  return (
    <SectionLanding
      sectionName={state.sectionName}
      families={families}
      productsByFamily={productsByFamily}
      cartLines={cartLines}
      drilled={state.drilled}
      qtyAt={qtyAt}
      onSetQty={onSetQty}
      speedDialPosition={state.speedDialPosition}
      focusHintBase={focusHintBase}
      onFocused={onFocused}
      onEscape={onEscape}
      onClose={onClose}
      onDrillTo={onDrillTo}
      onDrillBack={onDrillBack}
      onSubProductChange={onSubProductChange}
    />
  );
}
