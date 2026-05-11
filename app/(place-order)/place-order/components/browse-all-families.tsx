"use client";

import { Fragment, useMemo } from "react";
import type { Product } from "../types";
import { groupBySection, type FamilyInSection } from "@/lib/place-order/queries";

// Native <details>/<summary> disclosure at the bottom of the page.
// Renders all families grouped by 6 sections; each family clickable →
// page sets activeState to { kind: 'family', familyName, ... }.
//
// Section order is locked taxonomy (UTILITY → INTERIORS → EXTERIORS →
// ENAMELS → WOODCARE → MULTI-USE — matches the deleted category-grid's
// SECTION_ORDER). Within each section, families are alphabetical (sorted
// by groupBySection → filterBySection upstream).

const SECTION_ORDER = [
  "UTILITY",
  "INTERIORS",
  "EXTERIORS",
  "ENAMELS",
  "WOODCARE",
  "MULTI-USE",
] as const;

export interface BrowseAllFamiliesProps {
  productsAll:   Product[];
  onFamilyClick: (familyName: string) => void;
}

export default function BrowseAllFamilies({
  productsAll, onFamilyClick,
}: BrowseAllFamiliesProps): React.JSX.Element {
  const renderedSections = useMemo(() => {
    const bySection = groupBySection(productsAll);
    const out: { name: string; families: FamilyInSection[] }[] = [];
    for (const name of SECTION_ORDER) {
      const families = bySection[name];
      if (families && families.length > 0) out.push({ name, families });
    }
    return out;
  }, [productsAll]);

  return (
    <div className="mb-5">
      <details>
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-700 select-none list-none [&::-webkit-details-marker]:hidden">
          Browse all families ▾
        </summary>
        <div className="mt-3 bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-3 gap-x-4 gap-y-1.5">
          {renderedSections.map((s, idx) => {
            const headingClass = idx === 0
              ? "col-span-3 text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-1 mb-1"
              : "col-span-3 text-[10px] font-semibold text-gray-700 uppercase tracking-wider mt-3 mb-1";
            return (
              <Fragment key={s.name}>
                <div className={headingClass}>{s.name}</div>
                {s.families.map((f) => (
                  <button
                    key={`${s.name}-${f.family}`}
                    type="button"
                    onClick={() => onFamilyClick(f.family)}
                    className="text-[12px] text-gray-700 hover:text-teal-700 cursor-pointer text-left transition-colors duration-75"
                  >
                    {f.family}
                  </button>
                ))}
              </Fragment>
            );
          })}
        </div>
      </details>
    </div>
  );
}
