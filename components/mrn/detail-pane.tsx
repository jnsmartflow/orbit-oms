"use client";

import { useState } from "react";
import { Clipboard, Download, Printer, Trash2 } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { CheckingPill } from "./rail-card";
import { HeaderCard } from "./header-card";
import { LinesTable } from "./lines-table";
import { formatDateOnly, formatDuration, formatIstTime } from "./format";

// The right-hand working pane: identity, an action row, and two tabs.
//
// ⚠️ EVERY ACTION BUTTON HERE IS INERT IN 8a. They render because the action
// row is part of the screen's shape and tells the operator what this MRN
// affords, but every one of them is a WRITE and step 8b owns them. They wear
// the DISABLED treatment (UI §10: grey — `bg-gray-100 border-gray-200
// text-gray-400` — never faded teal, because a faded primary reads as broken
// rather than as waiting). Which button becomes teal in 8b is a real decision:
// this surface's one teal element (UI §1) is currently the selected rail card.

interface DetailPaneProps {
  detail: MrnDetail | null;
  loading: boolean;
  error: string | null;
  /** No MRN picked — B2, the first thing billing sees each morning. */
  empty: boolean;
}

export function DetailPane({ detail, loading, error, empty }: DetailPaneProps): React.JSX.Element {
  const [tab, setTab] = useState<"lines" | "activity">("lines");

  if (empty) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 bg-gray-50 text-gray-400">
        <Clipboard size={42} strokeWidth={1.5} className="text-[#cbd2da]" />
        <h3 className="text-[15px] font-semibold text-[#475467]">Pick a truck from the left</h3>
        <p className="text-[12.5px]">or start a new MRN when one reports</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 text-[13px] text-gray-400">
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-50 text-[13px] text-red-600">
        {error ?? "This MRN could not be loaded."}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="shrink-0 border-b border-[#eceff2] bg-white px-[18px] pt-3">
        <div className="flex items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-[9px]">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-gray-100 text-[11px] font-bold tabular-nums text-gray-500">
                {detail.srNo}
              </span>
              <span className="font-mono text-[15px] font-bold text-gray-900">
                {detail.mrnNumber}
              </span>
              {detail.status === "checking" && <CheckingPill />}
            </div>
            <p className="mt-[3px] text-[12px] text-[#667085]">{buildSubtitle(detail)}</p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {detail.status === "open" ? (
              <>
                <DeadButton icon={<Trash2 size={13} />} label="Delete" />
                <DeadButton icon={<Clipboard size={13} />} label="Paste lines" />
              </>
            ) : (
              <>
                <DeadButton icon={<Printer size={13} />} label="Print / PDF" />
                <DeadButton icon={<Download size={13} />} label="Download XLS" />
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-5">
          <PaneTab active={tab === "lines"} onClick={() => setTab("lines")}>
            Lines
          </PaneTab>
          <PaneTab active={tab === "activity"} onClick={() => setTab("activity")}>
            Activity
          </PaneTab>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-[18px] py-4">
        {tab === "lines" ? (
          <>
            <HeaderCard detail={detail} />
            <LinesTable detail={detail} />
          </>
        ) : (
          <ActivityTab detail={detail} />
        )}
      </div>
    </div>
  );
}

/**
 * 🔴 THE ONLY PLACE A CREATION TIME APPEARS IN THIS MODULE (design §11 OQ-5).
 *
 * "reported" everywhere else means `truckReportingDate` — the day the truck
 * showed up. The wall-clock at which billing typed the MRN into the system is a
 * different fact, useful only here, and it is worded "created by {name} {HH:MM}"
 * so it can never be mistaken for the reporting date. Do not put a creation
 * time on the rail card; that was the mockup's error and it was corrected.
 */
function buildSubtitle(detail: MrnDetail): string {
  const parts: string[] = [`${detail.receivedFrom} → ${detail.receivingWarehouse}`];

  if (detail.status === "checking") {
    const at = formatIstTime(detail.unloadingStartAt);
    const who = detail.unloadingStartByName ?? "A supervisor";
    parts.push(at ? `${who} started unloading ${at}` : `${who} is unloading`);
  } else if (detail.status === "done") {
    const who = detail.unloadingEndByName ?? detail.unloadingStartByName;
    if (who) parts.push(`checked by ${who}`);
    const from = formatIstTime(detail.unloadingStartAt);
    const to = formatIstTime(detail.unloadingEndAt);
    const dur = formatDuration(detail.unloadingStartAt, detail.unloadingEndAt);
    if (from && to) parts.push(dur ? `${from} → ${to} (${dur})` : `${from} → ${to}`);
  } else {
    const on = formatDateOnly(detail.truckReportingDate);
    if (on) parts.push(`reported ${on}`);
  }

  const createdAt = formatIstTime(detail.createdAt);
  if (detail.createdByName && createdAt) {
    parts.push(`created by ${detail.createdByName} ${createdAt}`);
  }

  return parts.join(" · ");
}

/**
 * 🔴 DERIVED ENTIRELY FROM TIMESTAMPS ALREADY ON THE ROW. There is no audit
 * table for MRN, none may be added, and MRN never writes to `order_status_logs`
 * — it is standalone and touches nothing in the orders pipeline (design §1).
 *
 * Everything this tab can ever show is here: created / createdBy,
 * unloadingStart + by, unloadingEnd + by. If a future session wants a richer
 * history it needs a new table and a new decision, not a quiet
 * `mrn_status_logs` bolted on the side.
 */
function ActivityTab({ detail }: { detail: MrnDetail }): React.JSX.Element {
  const events: { when: Date | string | null; what: string; who: string | null }[] = [
    { when: detail.createdAt, what: "MRN created", who: detail.createdByName },
    {
      when: detail.unloadingStartAt,
      what: "Unloading started",
      who: detail.unloadingStartByName,
    },
    {
      when: detail.unloadingEndAt,
      what: "Unloading finished",
      who: detail.unloadingEndByName,
    },
  ];

  const shown = events.filter((e) => e.when !== null);

  return (
    <div className="rounded-[10px] border border-[#e6e9ec] bg-white px-[15px] py-[13px]">
      <div className="mb-[11px] text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400">
        Activity
      </div>
      <ol className="space-y-3">
        {shown.map((e) => (
          <li key={e.what} className="flex gap-3">
            <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-gray-300" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#1d2939]">{e.what}</div>
              <div className="mt-px text-[11.5px] text-gray-400">
                {formatIstTime(e.when)}
                {e.who && ` · ${e.who}`}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {detail.status !== "done" && (
        <p className="mt-3.5 border-t border-gray-100 pt-3 text-[11.5px] leading-relaxed text-gray-400">
          {detail.status === "open"
            ? "Nothing else has happened yet — the next entry appears when the supervisor taps Start unloading."
            : "The supervisor is checking this truck. The final entry appears when he taps End unloading."}
        </p>
      )}
    </div>
  );
}

function PaneTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "border-b-2 pb-[9px] text-[12.5px] " +
        (active
          ? "border-gray-900 font-semibold text-gray-900"
          : "border-transparent font-medium text-gray-400 hover:text-gray-600")
      }
    >
      {children}
    </button>
  );
}

/** An action that exists on the screen but not yet in the code. See the file
 *  header — grey and genuinely disabled, never a faded primary. */
function DeadButton({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled
      title="This action arrives in the next step"
      className="inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 px-3 text-[12px] font-medium text-gray-400"
    >
      {icon}
      {label}
    </button>
  );
}
