"use client";

import { useState } from "react";
import { Clipboard, Download, Printer, Trash2 } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { CheckingPill } from "./rail-card";
import { HeaderCard } from "./header-card";
import { LinesTable } from "./lines-table";
import { formatDateOnly, formatDuration, formatIstTime } from "./format";
import type { MrnPerms } from "./mrn-shell";

// The right-hand working pane: identity, an action row, and two tabs.
//
// ⚠️ HIDDEN vs DISABLED — THE DISTINCTION IS THE WHOLE POINT (UI §10).
//
//   HIDDEN  = "not yours". A control the ROLE may never use is not rendered at
//             all. `operations` holds canEdit true but canDelete FALSE, and
//             before this it saw a Delete button, clicked it, and got a raw
//             "Forbidden" back. The route was right to refuse; offering the
//             button was the bug.
//   DISABLED = "not yet". A control that exists for this role but cannot act in
//             this state or this build step — Download XLS on a done MRN, which
//             waits on step 10's export route.
//
// Getting these the wrong way round teaches the operator to distrust the
// screen: a greyed control they can never earn reads as broken software.
//
// ⚠️ THE CLIENT IS NEVER THE AUTHORITY. Every route re-checks the same
// permission server-side; this only stops the screen offering what the server
// would refuse. Defence in depth — if the two disagree, the ROUTE is right.

interface DetailPaneProps {
  detail: MrnDetail | null;
  loading: boolean;
  error: string | null;
  /** No MRN picked — B2, the first thing billing sees each morning. */
  empty: boolean;
  onPasteLines: () => void;
  onEditHeader: () => void;
  onDelete: () => void;
  perms: MrnPerms;
  onLinesSaved: () => void;
}

export function DetailPane({
  detail,
  loading,
  error,
  empty,
  onPasteLines,
  onEditHeader,
  onDelete,
  perms,
  onLinesSaved,
}: DetailPaneProps): React.JSX.Element {
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

          {/* ── The action row, and where teal goes ────────────────────────
              Teal follows the state's REAL job (UI §10), so it MOVES:

                open     → Paste lines. Until an MRN has lines it has not
                           reached the supervisor at all, so pasting them is
                           unambiguously the job.
                checking → NOTHING IS TEAL, deliberately. §10 says "never
                           zero", but that assumes a state that HAS a job.
                           This one has none: the header, the lines and the
                           delete are all 409'd by the server, and the export
                           does not exist until step 10. Manufacturing a teal
                           button here would point the operator at something
                           that cannot help them. The absence IS the message —
                           the amber banner below carries it.
                done     → Download XLS, which is the whole reason this screen
                           replaces a sheet of paper. It stays DISABLED-GREY
                           until step 10 builds the export route: teal arrives
                           with the working button, never before it.

              The selected rail card's teal tint is SELECTION, not an action,
              and does not compete — the same way Delivery Challan's left panel
              does not. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {detail.status === "open" ? (
              <>
                {/* HIDDEN without canDelete — `operations` never sees it. */}
                {perms.canDelete && (
                  <PaneButton icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} />
                )}
                {/* HIDDEN without canEdit. Teal because on an open MRN this is
                    the job — and it stays teal even when Delete is hidden, so
                    the state still has exactly one. */}
                {perms.canEdit && (
                  <PaneButton
                    icon={<Clipboard size={13} />}
                    label="Paste lines"
                    tone="primary"
                    onClick={onPasteLines}
                  />
                )}
              </>
            ) : (
              // HIDDEN without canExport — `operations` and `floor_supervisor`
              // both hold it false: they can open and record, but the report
              // stays billing's (design §11 OQ-11). DISABLED rather than hidden
              // for those who DO have it, because the export route itself
              // arrives in step 10.
              perms.canExport && (
                <>
                  <DeadButton icon={<Printer size={13} />} label="Print / PDF" />
                  <DeadButton icon={<Download size={13} />} label="Download XLS" />
                </>
              )
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
            <HeaderCard detail={detail} onEdit={onEditHeader} canEdit={perms.canEdit} />
            {/* Keyed on the MRN id so switching trucks REMOUNTS the table and
                its draft, rather than leaving one MRN's unsaved carton qty
                sitting on another's rows. */}
            <LinesTable
              key={detail.id}
              detail={detail}
              canEdit={perms.canEdit}
              onSaved={onLinesSaved}
            />
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

/** A live action. `primary` is this surface's teal — exactly one per state, and
 *  which one it is changes with status (see the action row above). */
function PaneButton({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "primary";
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] transition-colors " +
        (tone === "primary"
          ? "border-teal-600 bg-teal-600 font-semibold text-white hover:bg-teal-700"
          : "border-gray-200 bg-white font-medium text-[#475467] hover:bg-gray-50")
      }
    >
      {icon}
      {label}
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
