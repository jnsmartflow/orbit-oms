"use client";

import { ChevronLeft } from "lucide-react";
import { CiLineRows, CiPackChips } from "./line-list";
import { CiDetailsStep } from "./details-step";
import type { CiBillResult, CiDetail, CiReasonOption, CiBillLine } from "@/lib/ci/types";

// One submitted CI, opened from the Submitted tab — step 7e.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 VIEWABLE ALWAYS. EDITABLE ONLY WHILE 'submitted', AND ONLY BY THE
//    SUPERVISOR WHO RAISED IT (owner ruling, 2026-09-01).
// ═══════════════════════════════════════════════════════════════════════════
//
// Once 'closed' it is read-only with NO exceptions — billing has punched it
// into SAP by then and the document is real. That ruling is also the answer to
// the long-open "return to floor" question (spec §11.1): billing does not send
// a CI back, they tell the floor and HE fixes it himself, which is what this
// screen is for.
//
// 🔴 THIS COMPONENT DECIDES NOTHING. `editable` is computed by the board from
// the server's own `status` and `supervisorId`, and the two write routes re-test
// both inside a guarded updateMany. A screen that worked it out for itself would
// be a fourth opinion about who may write.
//
// ⚠ PRESENTATION ONLY — NO STATE, NO FETCH, NO history.*. Every one of those
// lives in components/ci/submitted-board.tsx, which holds THE ONE POPSTATE
// AUTHORITY for this tab exactly as new-return.tsx does for the New tab. Two
// authorities on one screen is the bug 7b existed to fix; do not start a second
// one here by adding a sheet or a back handler to this file.
//
// ⚠ The teal header, the sub-strip and the line rows are the SAME components and
// the same tokens the New flow uses. Editing a return and raising one are the
// same job at two moments, and they must not become two dialects.

export function CiSubmittedDetail({
  detail,
  bill,
  editable,
  raced,
  materialMoved,
  onMaterialMoved,
  receivedOn,
  onReceivedOn,
  reason,
  onOpenReasons,
  remark,
  onRemark,
  returned,
  onOpenLine,
  activePackFilter,
  onPackFilter,
  dirty,
  saving,
  onSave,
}: {
  detail: CiDetail | null;
  /** The whole bill, fetched only when the CI is editable — he needs every
   *  active line to be able to ADD one back, not just the ones already on the
   *  return. Null while loading, and on a read-only CI where it is never
   *  fetched at all. */
  bill: CiBillResult | null;
  editable: boolean;
  /** Set when a write lost the race. Rendered as a band that does not go away —
   *  a toast would be gone before he looked up from the shelf. */
  raced: string | null;
  materialMoved: "moved" | "not_moved";
  onMaterialMoved: (v: "moved" | "not_moved") => void;
  receivedOn: string;
  onReceivedOn: (v: string) => void;
  reason: CiReasonOption | null;
  onOpenReasons: () => void;
  remark: string;
  onRemark: (v: string) => void;
  returned: Map<number, number>;
  onOpenLine: (line: CiBillLine) => void;
  activePackFilter: string;
  onPackFilter: (k: string) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}): React.JSX.Element {
  const closed = detail?.status === "closed";
  // 🔴 A FULL-BILL RETURN'S LINES ARE NOT EDITABLE HERE, and that is not an
  // omission. "Full bill" MEANS every active line at its delivered quantity, and
  // the lines route COMPUTES that set server-side precisely so a stale phone
  // cannot file a "full" return that quietly omits a line. Letting him tick
  // lines on a full return would be letting him make it a part return, which is
  // a different document — a decision nobody has asked for. He edits the
  // details; the lines follow the bill.
  const linesEditable = editable && detail?.returnType === "part" && bill !== null;

  return (
    <>
      {/* TEAL HEADER — the New flow's geometry exactly (new-return.tsx). The CI
          NUMBER is the title here, where the New flow puts the customer name:
          on this screen the CI is the subject and the dealer is context. */}
      <div
        className="bg-teal-600 pl-3.5 pr-1.5 pb-3.5 flex flex-col shrink-0"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            // 🔴 history.back(), NEVER a direct close. This chevron, Android's
            // hardware back and the iOS edge-swipe all run the SAME logic, and
            // that logic lives in the board's popstate handler.
            onClick={() => window.history.back()}
            aria-label="Back"
            className="w-[38px] h-[38px] rounded-[10px] bg-white/[0.16] flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[18px] font-semibold text-white truncate min-w-0">
                {detail?.ciNumber ?? "—"}
              </span>
              {/* 🔴 THE STATUS CHIP. Which state he is in must never be a guess:
                  the difference between "I can still fix this" and "billing has
                  it" is the whole point of this screen, and an editable CI and a
                  closed one otherwise look identical. */}
              {detail !== null && <StatusChip status={detail.status} />}
            </div>
            <div className="text-[11.5px] text-white/70 truncate">
              {detail?.customerName ?? ""}
            </div>
          </div>
        </div>
      </div>

      {/* SUB-HEADER STRIP — the New flow's band: date · invoice · litres. */}
      <div className="bg-white border-b border-gray-200 shrink-0 px-[14px] py-3 flex items-center gap-2 text-[12.5px]">
        <span className="text-gray-600 shrink-0">{formatDay(detail?.invoiceDate ?? null)}</span>
        <span className="text-[#d8dce1]">·</span>
        {/* A blank invoice is NORMAL — 5% of bills have none when the CI is
            raised and SAP sends it later. An em-dash, never an error. */}
        <span className="text-gray-600 truncate min-w-0">{detail?.invoiceNo ?? "—"}</span>
        <span className="text-[#d8dce1]">·</span>
        <span className="font-semibold tabular-nums text-gray-700 shrink-0">
          {detail?.totalLitres ?? 0} L
        </span>
        <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-[0.06em] text-[#8A9299]">
          {detail?.returnType === "full" ? "Full bill" : "Part"}
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          🔴 THE RACE BAND. Billing closed it while he had it open.
          ═══════════════════════════════════════════════════════════════════
          A BAND, not a toast: a toast is gone in four seconds, and he is
          standing at a shelf with stock in his hands. It stays until he leaves
          the screen, and the screen behind it has already flipped to read-only
          off a fresh fetch — so what he is being told and what he can do agree. */}
      {raced !== null && (
        <div className="shrink-0 bg-[#FDF4E3] border-b border-[#F0E0BE] px-[14px] py-2.5 flex gap-2.5">
          <span className="text-[#A8620A] text-[12px] leading-[1.5] shrink-0">▲</span>
          <p className="text-[12.5px] text-[#7A4708] leading-[1.45] min-w-0">{raced}</p>
        </div>
      )}

      {detail === null ? (
        /* The skeleton the New flow uses — the frame slides in immediately and
           fills, rather than a tap doing nothing visible on depot wifi. */
        <div className="flex-1 px-3 pt-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-stretch min-h-[64px] bg-white rounded-[14px] mb-2 animate-pulse"
              style={{ boxShadow: "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)" }}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ── The lines ─────────────────────────────────────────────────── */}
          <SectionLabel>
            {detail.lineCount} line{detail.lineCount === 1 ? "" : "s"} · {detail.totalTins} tins ·{" "}
            {detail.totalLitres} L
          </SectionLabel>

          {linesEditable && bill !== null ? (
            <>
              <CiPackChips
                lines={bill.lines}
                activePackFilter={activePackFilter}
                onPackFilter={onPackFilter}
              />
              {/* THE SAME ROW COMPONENT THE NEW FLOW USES, in `part` mode, seeded
                  from what is already on the CI. Tapping one opens the same
                  quantity sheet. Editing a return and raising one are the same
                  gesture. */}
              <CiLineRows
                lines={bill.lines}
                activePackFilter={activePackFilter}
                mode="part"
                returned={returned}
                onOpenLine={onOpenLine}
              />
            </>
          ) : (
            <ReadOnlyLines detail={detail} />
          )}

          {/* ── The four stage-1 answers ──────────────────────────────────── */}
          <SectionLabel>Details</SectionLabel>
          {editable ? (
            /* THE NEW FLOW'S OWN DETAILS STEP, unchanged. Four rows, no helper
               copy, the native date control. He already knows this screen. */
            <CiDetailsStep
              materialMoved={materialMoved}
              onMaterialMoved={onMaterialMoved}
              receivedOn={receivedOn}
              onReceivedOn={onReceivedOn}
              reason={reason}
              onOpenReasons={onOpenReasons}
              remark={remark}
              onRemark={onRemark}
            />
          ) : (
            <>
              <ReadRow
                label="Material"
                value={detail.materialMoved === "moved" ? "Moved" : "Not moved"}
              />
              <ReadRow label="Received on" value={formatDay(detail.materialReceivedDate)} />
              <ReadRow label="Reason" value={detail.reasonLabel} sub={detail.reasonRemark} />
            </>
          )}

          {/* ── What billing entered ──────────────────────────────────────────
              🔴 ONLY ONCE CLOSED. Before that these three columns are empty by
              definition, and rendering three em-dashes would suggest the floor
              was meant to fill them. */}
          {closed && (
            <>
              <SectionLabel>Billing</SectionLabel>
              <ReadRow label="CI date" value={formatDay(detail.ciDate)} />
              <ReadRow label="CI number" value={detail.sapCiNumber ?? "—"} mono />
              {/* 🔴 THE VALUE IS RENDERED AS THE STRING THE ROUTE STORED. Never
                  parsed to a number on the way to the eye: binary floating point
                  cannot hold 0.1, and this is money on a document someone
                  signed. */}
              <ReadRow label="Value" value={`₹ ${detail.ciValue ?? "—"}`} nums />
              <ReadRow label="Closed by" value={detail.billingOperatorName ?? "—"} />
            </>
          )}

          {/* Breathing room above the save pill, which is fixed over this. */}
          <div className="h-24" />
        </div>
      )}

      {/* ── SAVE ────────────────────────────────────────────────────────────
          Present only while editing, and DISABLED until something actually
          changed — a live Save on an untouched CI invites a pointless write
          that would bump `updatedAt` and shake billing's rail for nothing. */}
      {editable && detail !== null && (
        <div
          className="shrink-0 bg-white border-t border-gray-200 px-3.5 pt-2.5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 10px)" }}
        >
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className={
              "w-full h-12 rounded-full text-[15px] font-bold " +
              (dirty && !saving
                ? "bg-teal-600 active:bg-teal-700 text-white shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
                : "bg-gray-100 text-gray-400")
            }
          >
            {saving ? "Saving…" : dirty ? "Save changes" : "No changes"}
          </button>
        </div>
      )}
    </>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: CiDetail["status"] }): React.JSX.Element {
  const tone =
    status === "closed"
      ? "bg-[#E7F6EE] text-[#0A7C4A]"
      : status === "returned_to_floor"
        ? "bg-[#F5F1FE] text-[#6941C6]"
        : "bg-[#FDF4E3] text-[#A8620A]";
  const label =
    status === "closed"
      ? "Done"
      : status === "returned_to_floor"
        ? "Sent back"
        : "With billing";
  return (
    <span
      className={
        "shrink-0 rounded-full px-2 py-[2px] text-[10.5px] font-bold whitespace-nowrap " + tone
      }
    >
      {label}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="px-[14px] pt-4 pb-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">
      {children}
    </p>
  );
}

/** The lines as a record, for a closed CI or another supervisor's. Snapshot
 *  values straight off the CI — NOT re-derived from the bill, because the bill
 *  may have moved since and the return is what was agreed. */
function ReadOnlyLines({ detail }: { detail: CiDetail }): React.JSX.Element {
  return (
    <div className="px-3">
      {detail.lines.map((l) => (
        <div
          key={l.id}
          className="bg-white rounded-[12px] px-3.5 py-2.5 mb-2"
          style={{ boxShadow: "0 1px 2px rgba(16,25,29,0.04), 0 3px 12px rgba(16,25,29,0.05)" }}
        >
          <div className="flex items-center justify-between gap-2.5">
            <span className="font-mono text-[13.5px] font-bold text-gray-900 truncate">
              {l.skuCode}
            </span>
            <span className="shrink-0 text-[15px] font-extrabold tabular-nums text-gray-900">
              {l.returnedQty}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2.5 mt-0.5">
            {/* An unmastered code is NORMAL (~5.9% of active lines) — the bare
                code stands and the name is simply absent. */}
            <span className="text-[12px] text-gray-500 truncate min-w-0">
              {[l.packCode, l.skuDescription].filter(Boolean).join(" · ")}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-gray-500">
              {l.returnedQtyLitres === null ? "—" : `${l.returnedQtyLitres} L`}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadRow({
  label,
  value,
  sub,
  mono = false,
  nums = false,
}: {
  label: string;
  value: string;
  sub?: string | null;
  mono?: boolean;
  nums?: boolean;
}): React.JSX.Element {
  return (
    <div className="bg-white border-b border-gray-200 px-[14px] py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">
        {label}
      </div>
      <div
        className={
          "mt-1.5 text-[15px] text-gray-900 " +
          (mono ? "font-mono " : "") +
          (nums ? "tabular-nums" : "")
        }
      >
        {value}
      </div>
      {sub !== null && sub !== undefined && sub !== "" && (
        <div className="mt-0.5 text-[12.5px] text-gray-500">{sub}</div>
      )}
    </div>
  );
}

/** "22 Aug 2026" from an ISO date. Blank → em-dash. */
function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
