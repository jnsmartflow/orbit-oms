"use client";

import type {
  SuggestResponse,
  SuggestExactMatch,
  SuggestReferenceItem,
} from "@/app/api/sampling-library/_lib/suggest";

export interface SuggestionCardProps {
  data:          SuggestResponse | null;
  isLoading:     boolean;
  onApplyRecipe: (card: SuggestExactMatch | SuggestReferenceItem) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// "DD MMM" — year omitted; cards are dense and the year is rarely meaningful
// alongside a usage count.
function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function packCodeToLabel(code: string): string {
  if (code === "ml_500") return "500 ML";
  const m = code.match(/^L_(\d+)(?:_(\d+))?$/);
  if (!m) return code;
  const whole = m[1];
  const frac  = m[2];
  return `${frac !== undefined ? `${whole}.${frac}` : whole} LT`;
}

// ── Pigment chips (compact only — exact-match and reference cards share size)
function PigmentChips({
  pigments,
}: {
  pigments: Array<{ code: string; value: number }>;
}) {
  if (pigments.length === 0) {
    return <span className="text-[10px] text-gray-400 italic">No pigments</span>;
  }
  return (
    <div className="flex flex-wrap gap-[3px]">
      {pigments.map((p) => (
        <span
          key={p.code}
          className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 border border-gray-200 rounded font-mono text-[10px] px-[5px] py-[1px]"
        >
          <span>{p.code}</span>
          <span className="font-semibold text-gray-900">{p.value}</span>
        </span>
      ))}
    </div>
  );
}

// ── Unified card (3-col grid · 4-line layout) ───────────────────────────────
// showSkuPack toggles line 3 (reference-only). Section header carries the
// exact-vs-reference distinction; cards themselves are uniform in size.

function CompactSuggestionCard({
  card,
  showSkuPack,
  onClick,
}: {
  card:        SuggestExactMatch | SuggestReferenceItem;
  showSkuPack: boolean;
  onClick:     () => void;
}) {
  const usageLabel = card.usageCountAtThisSite === 1 ? "use" : "uses";
  const usageMeta = showSkuPack
    ? `${card.usageCountAtThisSite} ${usageLabel}`
    : `${card.usageCountAtThisSite} ${usageLabel} · ${formatDayMonth(card.lastUsedAt)}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full min-w-0 text-left flex flex-col gap-1 px-3 py-2.5 bg-white border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
    >
      {/* Line 1: samplingNo (left) + usage meta (right) */}
      <div className="flex items-baseline justify-between gap-2 min-w-0">
        <span className="font-mono font-medium text-[13px] text-gray-900 truncate">
          #{card.samplingNo}
        </span>
        <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">
          {usageMeta}
        </span>
      </div>
      {/* Line 2: shade name (truncate) */}
      <div className="text-[12px] text-gray-900 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
        {card.shadeName}
      </div>
      {/* Line 3 (reference only): SKU + pack code */}
      {showSkuPack && (
        <div className="text-[10px] text-gray-400 whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
          SKU {card.skuCode} · {packCodeToLabel(card.packCode)}
        </div>
      )}
      {/* Line 4: pigment chips */}
      <PigmentChips pigments={card.activePigments} />
    </button>
  );
}

// ── Skeleton (loading state) ────────────────────────────────────────────────

function SuggestionSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-md p-4 animate-pulse">
      <div className="h-16 bg-gray-100 rounded" />
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function SuggestionCard({
  data,
  isLoading,
  onApplyRecipe,
}: SuggestionCardProps) {
  if (isLoading || data === null) {
    return <SuggestionSkeleton />;
  }
  const { exactMatches, referenceList } = data;
  if (exactMatches.length === 0 && referenceList.length === 0) {
    // Spec §5.1B empty state — render nothing.
    return null;
  }
  return (
    <div className="flex flex-col">
      {exactMatches.length > 0 && (
        <section className="mb-5">
          <p className="text-[11px] font-medium tracking-wide text-gray-500 mb-2.5">
            Exact match · {exactMatches.length} found
          </p>
          <div className="grid grid-cols-3 gap-2">
            {exactMatches.map((card) => (
              <CompactSuggestionCard
                key={`exact-${card.samplingNo}-${card.recipeId}`}
                card={card}
                showSkuPack={false}
                onClick={() => onApplyRecipe(card)}
              />
            ))}
          </div>
        </section>
      )}
      {referenceList.length > 0 && (
        <section className="mb-5">
          <p className="text-[11px] font-medium tracking-wide text-gray-500 mb-2.5">
            Other shades at this site · {referenceList.length} found
          </p>
          <div className="grid grid-cols-3 gap-2">
            {referenceList.map((card) => (
              <CompactSuggestionCard
                key={`ref-${card.samplingNo}-${card.recipeId}`}
                card={card}
                showSkuPack
                onClick={() => onApplyRecipe(card)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
