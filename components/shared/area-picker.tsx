"use client";

// AreaPicker — the type-to-search Area field of the shared ship-to modal
// (components/shared/ship-to-modal.tsx, Billing ✎ + Floor detail panel),
// 2026-10-31. Replaces a native <select> over ~400 active area_master rows.
// A thin wrapper over components/ui/search-select.tsx; filtering is client-side
// over the list GET /api/ship-to/areas already returned.
//
// Match: case-insensitive, EVERY space-separated word must appear somewhere in
// "name deliveryType route" — so "adajan local" and "vapi up" both work.
// The value is the area_master id, exactly what the <select> carried; the
// modal's save (form "areaId") is unchanged.
//
// No default: the caller passes the bill's own typed area or "" — never the
// customer's area (owner, 2026-10-20 — do not re-add).

import { SearchSelect, Highlight } from "@/components/ui/search-select";

export interface AreaOption {
  id: number;
  name: string;
  deliveryType: string | null;
  route: string | null;
}

function queryWords(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function areaMatches(a: AreaOption, q: string): boolean {
  const words = queryWords(q);
  if (words.length === 0) return true;
  const hay = `${a.name} ${a.deliveryType ?? ""} ${a.route ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The first query word found in the name — the part worth marking. */
function nameHit(name: string, q: string): string {
  const lower = name.toLowerCase();
  return queryWords(q).find((w) => lower.includes(w)) ?? "";
}

function TypeTag({ type }: { type: string | null }): React.JSX.Element | null {
  if (!type) return null;
  return (
    <span className="ml-auto shrink-0 rounded border border-ink-100 bg-ink-25 px-1.5 text-[11px] font-normal text-ink-600">
      {type}
    </span>
  );
}

export function AreaPicker({
  areas,
  value,
  onChange,
  disabled,
}: {
  /** null while loading. */
  areas: AreaOption[] | null;
  value: number | "";
  onChange: (next: number | "") => void;
  disabled?: boolean;
}): React.JSX.Element {
  const loading = areas === null;
  const list = areas ?? [];
  const selected = value === "" ? null : (list.find((a) => a.id === value) ?? null);

  // A saved area that is no longer active is not in the list — still show it,
  // so the field never looks empty while a value is set.
  const shown =
    value === "" ? null : selected ? (
      <>
        <span className="truncate text-ink-900">{selected.name}</span>
        <TypeTag type={selected.deliveryType} />
      </>
    ) : loading ? null : (
      <span className="truncate text-ink-600">Area #{value} (inactive)</span>
    );

  return (
    <SearchSelect<AreaOption>
      items={list}
      getKey={(a) => a.id}
      matches={areaMatches}
      renderItem={(a, q) => (
        <>
          <span className="truncate">
            <Highlight text={a.name} query={nameHit(a.name, q)} />
          </span>
          <TypeTag type={a.deliveryType} />
        </>
      )}
      selectedKey={value === "" ? null : value}
      value={shown}
      placeholder={loading ? "Loading areas…" : "Select area…"}
      searchPlaceholder="Search area or type (local, upcountry…)"
      onPick={(a) => onChange(a.id)}
      onClear={() => onChange("")}
      emptyText={(q) => `No area matches “${q}”`}
      disabled={disabled || loading}
      inputClassName="text-[16px] sm:text-[14px]"
      escOwner
      openAtSelected
    />
  );
}
