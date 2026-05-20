"use client";

import { Fragment } from "react";
import type { ReactNode } from "react";

interface MetaRibbonProps {
  soName: string | null;
  receivedAt: string;
  volume: string;
  matchedLines: number;
  totalLines: number;
  punchedByName: string | null;
  punchedAt: string | null;
  actionsSlot: ReactNode;
  soNumberSlot: ReactNode;
  punchButtonSlot: ReactNode;
}

function getMatchChip(
  matched: number,
  total: number,
): { label: string; classes: string } | null {
  if (total === 0) return null;
  if (matched === total) {
    return {
      label: `✓ ${matched}/${total}`,
      classes: "bg-green-50 border-green-200 text-green-700",
    };
  }
  if (matched === 0) {
    return {
      label: `✗ 0/${total}`,
      classes: "bg-red-50 border-red-200 text-red-700",
    };
  }
  return {
    label: `⚠ ${matched}/${total}`,
    classes: "bg-amber-50 border-amber-200 text-amber-700",
  };
}

export function MetaRibbon({
  soName,
  receivedAt,
  volume,
  matchedLines,
  totalLines,
  punchedByName,
  punchedAt,
  actionsSlot,
  soNumberSlot,
  punchButtonSlot,
}: MetaRibbonProps): JSX.Element {
  const matchChip = getMatchChip(matchedLines, totalLines);

  const segments: { key: string; node: ReactNode }[] = [];

  if (soName && soName.trim().length > 0) {
    segments.push({
      key: "so",
      node: <span className="text-gray-700 font-medium">{soName}</span>,
    });
  }
  if (receivedAt && receivedAt.trim().length > 0) {
    segments.push({
      key: "time",
      node: <span className="tabular-nums">{receivedAt}</span>,
    });
  }
  if (volume && volume.trim().length > 0) {
    segments.push({
      key: "vol",
      node: <span className="tabular-nums">{volume}</span>,
    });
  }
  if (matchChip) {
    segments.push({
      key: "match",
      node: (
        <span
          className={`inline-flex items-center h-4 px-[5px] text-[10px] font-semibold rounded border ${matchChip.classes}`}
        >
          {matchChip.label}
        </span>
      ),
    });
  }
  if (punchedByName && punchedAt) {
    segments.push({
      key: "punched",
      node: (
        <span className="text-gray-400">
          punched by {punchedByName} · {punchedAt}
        </span>
      ),
    });
  }

  const showDivider = !!actionsSlot && (!!soNumberSlot || !!punchButtonSlot);

  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-2.5 border-t border-gray-100">
      <div className="flex items-center gap-2 text-[11.5px] text-gray-500 flex-wrap min-w-0">
        {segments.map((s, i) => (
          <Fragment key={s.key}>
            {i > 0 && <span className="text-gray-300">·</span>}
            {s.node}
          </Fragment>
        ))}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {actionsSlot}
        {showDivider && (
          <span className="w-px h-5 bg-gray-200 mx-1" aria-hidden="true" />
        )}
        {soNumberSlot}
        {punchButtonSlot}
      </div>
    </div>
  );
}
