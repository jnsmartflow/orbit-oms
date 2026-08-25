"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Smartphone, X } from "lucide-react";
import type { MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { buildRenderRows, reportTotals } from "@/lib/mrn/report";
import { formatCount, formatMonthYear } from "./format";
import { ModalButton, ModalError, ModalShell, describeWriteError } from "./modal-shell";

// The line-items table.
//
// ⚠️ ONE COLUMN SET, ALL THREE STATES (2026-08-22). open / checking / done now
// render the SAME 16 columns in the same order, so the operator learns one
// table and never has to re-find a column when a truck changes state. What
// varies is only what is IN the cells: in `open` and `checking` every
// supervisor-owned column renders as an empty dashed cell.
//
//   # · SKU · Description · Pack · Qty STI · Ctn · Physical · Mfg m/y ·
//   SND · Lky · Damage · Empty · QTD · REJ · Short · Excess
//
// ⚠️ THE BB m/y COLUMN WAS REMOVED (2026-08-22, schema v27.17). Best before is
// no longer collected anywhere — the pickers are gone from the line sheet and
// the columns are nullable — so displaying it would have shown an empty column
// on every truck from that date. Its 5% went to Description. Do not restore it
// without restoring the input that feeds it.
//
// ⚠️ Mfg is ONE cell, rendered `06/26`. It is STORED as two integers and joined
// only for display; do NOT split it into two columns to mirror the schema.
//
// ⚠️ THAT IS A DEPARTURE FROM THE WORKBOOK, NOT A MATCH TO IT — this comment
// used to claim it matched. The `PRINT` sheet has `Manufacturing Month` and
// `Manufacturing Year` as TWO columns (it had two more for best before). The
// merge is a screen-width decision, and the A4 sheet copies it; the XLS export
// keeps the workbook's two columns, because a spreadsheet is the thing people
// sort and filter. See lib/mrn/report.ts.
//
// ⚠️ THE "Iss." COLUMN WAS REMOVED (2026-08-22). It was a yes/no restatement of
// the eight condition columns sitting immediately beside it, and the signal is
// already carried twice over — by the issues banner above the table and by the
// `N issues` chip on the rail card. Do not reinstate it.
//
// ⚠️ EIGHT condition columns, not the six the mockup drew — SND · Lky · Damage ·
// Empty · QTD · REJ · Short · Excess is row 17 of the source workbook's PRINT
// sheet (⚠ NOT row 16 — that row is empty; this comment and design §11 OQ-3
// both said 16, and both were off by one. lib/mrn/report.ts carries the
// verification) and what OQ-3 settled. QTD's meaning is still unknown (§4): it is
// carried through schema, UI and report because the workbook carries it, and
// must never be repurposed to mean something helpful.
//
// ⚠️ Short and Excess are DERIVED, never stored (§11 OQ-2) — they arrive already
// computed on every line by lib/mrn/derive.ts, applied server-side in
// getMrnDetail(). Nothing here recomputes them, which is the whole reason the
// card, this table, the XLS and the print sheet cannot disagree about one truck.
//
// ⚠️ 16 COLUMNS OVERFLOW, AND THAT IS HANDLED IN ONE PLACE. The table sits in
// its own `overflow-x-auto` box with a min-width, so IT scrolls sideways and the
// PAGE never does. The fixed-table standard still applies (UI §27): table-layout
// fixed with a <colgroup> of percentages — the percentages now resolve against
// TABLE_MIN_WIDTH rather than against the pane, which is what stops 16 columns
// collapsing into unreadable slivers on a narrow window.

/** Wide enough that every column stays legible; the box scrolls past it. */
const TABLE_MIN_WIDTH = 1400;

/** ONE definition, read by the colgroup and the header row alike, so a column
 *  can never be added to one and forgotten in the other. Percentages sum to 100. */
const COLUMNS: { key: string; label: string; width: number; left?: boolean }[] = [
  { key: "no", label: "#", width: 3 },
  { key: "sku", label: "SKU", width: 8, left: true },
  { key: "desc", label: "Description", width: 25, left: true },
  { key: "pack", label: "Pack", width: 5 },
  { key: "sti", label: "Qty STI", width: 5 },
  { key: "ctn", label: "Ctn", width: 4 },
  { key: "phy", label: "Physical", width: 5 },
  { key: "mfg", label: "Mfg m/y", width: 5 },
  { key: "snd", label: "SND", width: 5 },
  { key: "lky", label: "Lky", width: 5 },
  { key: "dmg", label: "Damage", width: 5 },
  { key: "emp", label: "Empty", width: 5 },
  { key: "qtd", label: "QTD", width: 5 },
  { key: "rej", label: "REJ", width: 5 },
  { key: "sht", label: "Short", width: 5 },
  { key: "exc", label: "Excess", width: 5 },
];

/** Physical · Mfg · the eight condition columns = 10 cells the supervisor owns,
 *  dashed in both billing-facing states. BB left this count on 2026-08-22. */
const SUPERVISOR_COLUMN_COUNT = 10;

interface LinesTableProps {
  detail: MrnDetail;
  /** HIDDEN without it — see detail-pane.tsx on hidden vs disabled. */
  canEdit: boolean;
  /** After a successful save — the board refetches. */
  onSaved?: () => void;
}

export function LinesTable({
  detail,
  canEdit,
  onSaved,
}: LinesTableProps): React.JSX.Element {
  if (detail.status === "checking") return <CheckingTable detail={detail} />;
  if (detail.status === "done") return <DoneTable detail={detail} />;
  return <OpenTable detail={detail} canEdit={canEdit} onSaved={onSaved} />;
}

// ── open ────────────────────────────────────────────────────────────────────

/**
 * Billing's working view. Every column the SUPERVISOR owns renders as an empty
 * dashed cell — visible, never fillable here. The screen itself is what says
 * whose job each column is, which is cheaper than training and does not decay.
 *
 * Carton qty is the ONE exception: it comes off the STI sheet, so billing types
 * it where the sheet has it.
 */
function OpenTable({
  detail,
  canEdit,
  onSaved,
}: {
  detail: MrnDetail;
  canEdit: boolean;
  onSaved?: () => void;
}): React.JSX.Element {
  // ── NO DRAFT, NO DIRTY STATE, NO "Save lines" (2026-08-22) ────────────────
  //
  // All three are gone, and their absence is the design. Carton qty is now
  // DERIVED from the catalog at paste (see the lines route), so billing types
  // nothing into this table — which left row delete as the only action, and a
  // draft-plus-save built for a whole table of edits was heavier than one
  // button needs. A delete now confirms and writes immediately.
  //
  // The payoff is that there is no unsaved work anywhere on this board: no
  // discard-changes guard on a card click, no guard on a date step, and no way
  // to lose typed input because there is none left to lose. Do not reintroduce
  // a draft for a single action.
  const [confirming, setConfirming] = useState<MrnDetailLine | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unmatched = detail.lines.filter((l) => !l.isCatalogued).length;

  async function removeLine(line: MrnDetailLine) {
    setBusy(true);
    setError(null);
    try {
      // The SAME replace-everything route the paste uses — it sends the lines
      // that REMAIN. There is no per-line delete endpoint and none is needed:
      // this route already owns "these are the MRN's lines now".
      const res = await fetch(`/api/mrn/${detail.id}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: detail.lines
            .filter((l) => l.id !== line.id)
            .map((l) => ({ lineNo: l.lineNo, skuCode: l.skuCode, qtySti: l.qtySti })),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          linesCleared?: boolean;
        };
        // The route's own sentence passes through — including linesCleared's
        // "this MRN now has no lines", and the 400 that refuses to save an MRN
        // down to zero lines. Only a bare 401/403 is translated.
        setError(describeWriteError(res.status, json.error, "change these lines"));
        // A 409 means the supervisor started while this pane was open; a
        // linesCleared means the table on screen is now wrong either way.
        if (res.status === 409 || json.linesCleared) onSaved?.();
        return;
      }
      setConfirming(null);
      onSaved?.();
    } catch {
      setError("Could not reach the server. Nothing was changed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The MRN is on the phone the moment header AND lines exist — which is
          also exactly what the toCheck feed enforces (lib/mrn/queries.ts). With
          no lines it has NOT reached anyone, and saying so is more useful than
          saying nothing. */}
      {detail.lineCount > 0 ? (
        <Banner tone="grey" icon={<Smartphone size={16} />}>
          <b>This MRN is already on the supervisor&apos;s phone.</b> It appeared there
          the moment the header and lines were filled. You can keep editing until he
          taps Start unloading.
        </Banner>
      ) : (
        <Banner tone="grey" icon={<Smartphone size={16} />}>
          <b>Not on the supervisor&apos;s phone yet.</b> An MRN reaches him once it has
          lines — paste them and it appears under To check straight away.
        </Banner>
      )}

      {error && (
        <div className="mb-3.5 rounded-[9px] border border-red-200 bg-red-50 px-[13px] py-[11px] text-[12.5px] leading-[1.55] text-[#b42318]">
          {error}
        </div>
      )}

      <TableShell
        title={
          <>
            {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI
            {unmatched > 0 && ` · ${unmatched} SKU${unmatched === 1 ? "" : "s"} not in catalog`}
          </>
        }
        /* The row-delete column. HIDDEN entirely without canEdit — an action the
           role can never perform is not rendered (see detail-pane.tsx on hidden
           vs disabled). It is an ACTION, not data, so it lives outside COLUMNS
           and cannot shift the shared column widths. */
        extraColumn={canEdit}
      >
        {detail.lines.map((line) => (
          <tr key={line.id} className={line.isCatalogued ? "" : "bg-amber-50/60"}>
            <Td muted center>{line.lineNo}</Td>
            <Td mono strong>{line.skuCode}</Td>
            <Td>
              <Description line={line} />
            </Td>
            <Td center>{line.pack ?? "—"}</Td>
            <Td center strong>{line.qtySti}</Td>
            {/* READ-ONLY. Derived from the catalog at paste — 4L packs only —
                never typed here. See the lines route for the rule. */}
            <Td center>{line.cartonQty ?? "—"}</Td>
            {Array.from({ length: SUPERVISOR_COLUMN_COUNT }).map((_, i) => (
              <Td key={i} center>
                <DashedCell />
              </Td>
            ))}
            {canEdit && (
              <Td center>
                <button
                  type="button"
                  onClick={() => setConfirming(line)}
                  aria-label={`Remove line ${line.lineNo}`}
                  className="text-[#c2c8d0] hover:text-[#b42318]"
                >
                  <X size={13} />
                </button>
              </Td>
            )}
          </tr>
        ))}
        {detail.lines.length === 0 && (
          <EmptyRow colSpan={COLUMNS.length + (canEdit ? 1 : 0)} />
        )}
      </TableShell>

      {confirming && (
        <ModalShell
          title={`Remove line ${confirming.lineNo}?`}
          subtitle={
            <>
              <span className="font-mono font-semibold">{confirming.skuCode}</span>
              {confirming.isCatalogued && ` · ${confirming.description}`} ·{" "}
              {confirming.qtySti} nos
            </>
          }
          busy={busy}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <ModalButton onClick={() => setConfirming(null)} disabled={busy}>
                Cancel
              </ModalButton>
              <ModalButton
                tone="danger"
                onClick={() => void removeLine(confirming)}
                disabled={busy}
              >
                {busy ? "Removing…" : "Remove line"}
              </ModalButton>
            </>
          }
        >
          {error && <ModalError message={error} />}
          <p className="text-[12.5px] leading-[1.55] text-[#475467]">
            It disappears from the supervisor&apos;s phone too. Paste the block again
            if you need it back.
          </p>
        </ModalShell>
      )}
    </>
  );
}

// ── checking ────────────────────────────────────────────────────────────────

/**
 * 🔴 THE LOCKED VIEW. NO partial data, NO progress bar, NO checked-line count.
 *
 * This is not an oversight and not a missing feature — it is the owner's
 * explicit decision (design §5, "No live sync into billing"). While the
 * supervisor holds the truck, billing sees the lines EXACTLY as billing left
 * them, greyed behind the amber banner, and everything lands in one write when
 * he taps End unloading. It is also why there is no billing marker route at all
 * (app/api/mrn/marker/route.ts carries the same reasoning at the other end).
 *
 * A future session will read this and see a screen that "should" show progress.
 * It should not. Adding it is a new product decision, not a bug fix.
 */
function CheckingTable({ detail }: { detail: MrnDetail }): React.JSX.Element {
  return (
    <>
      <Banner tone="amber" icon={<Smartphone size={16} />}>
        <b>Locked — the supervisor is checking this truck.</b> Everything he records
        arrives here in one go when he finishes. Nothing changes on this screen
        until then.
      </Banner>

      <div className="opacity-55">
        <TableShell
          title={
            <>
              {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI
            </>
          }
        >
          {detail.lines.map((line) => (
            <tr key={line.id}>
              <Td muted center>{line.lineNo}</Td>
              <Td mono strong>{line.skuCode}</Td>
              <Td>
                <Description line={line} />
              </Td>
              <Td center>{line.pack ?? "—"}</Td>
              <Td center strong>{line.qtySti}</Td>
              <Td center>{line.cartonQty ?? "—"}</Td>
              {/* Deliberately dashed even though the supervisor may already have
                  filled them server-side. See this component's header. */}
              {Array.from({ length: SUPERVISOR_COLUMN_COUNT }).map((_, i) => (
                <Td key={i} center>
                  <DashedCell />
                </Td>
              ))}
            </tr>
          ))}
          {detail.lines.length === 0 && <EmptyRow colSpan={COLUMNS.length} />}
        </TableShell>
      </div>
    </>
  );
}

// ── done ────────────────────────────────────────────────────────────────────
//
// 🔴 buildRenderRows() AND THE TOTAL ROW NOW LIVE IN lib/mrn/report.ts, and the
// copies that used to sit here are GONE ON PURPOSE (step 10, 2026-08-25). The
// XLS export and the A4 print sheet render the same truck from the same rows,
// and the sub-row rule — line-level values on the FIRST sub-row only — is the
// one piece of logic that silently doubles a total if any one of the three
// surfaces gets it wrong. Three copies could drift; one cannot. Do not re-inline
// either function here "to keep the table self-contained".

function DoneTable({ detail }: { detail: MrnDetail }): React.JSX.Element {
  // Local, read-only view filter (mockup B4's .seg). Not teal — teal on this
  // board belongs to New MRN / the pane's action row (UI §1).
  const [onlyIssues, setOnlyIssues] = useState(false);

  const lines = useMemo(
    () => (onlyIssues ? detail.lines.filter((l) => l.hasIssue) : detail.lines),
    [detail.lines, onlyIssues],
  );
  const rows = useMemo(() => buildRenderRows(lines), [lines]);

  // The TOTAL row, from the SAME function the XLS and the print sheet use — it
  // includes the SND sum that MrnIssueSummary deliberately has no field for
  // (SND is the SOUND count; folding it into an ISSUE summary would make that
  // type's name a lie). See lib/mrn/report.ts.
  const totals = useMemo(() => reportTotals(detail), [detail]);

  const issueParts: string[] = [];
  if (detail.totalShort > 0) issueParts.push(`${detail.totalShort} short`);
  if (detail.totalExcess > 0) issueParts.push(`${detail.totalExcess} excess`);
  if (detail.totalLeaky > 0) issueParts.push(`${detail.totalLeaky} leaky`);
  if (detail.totalDamage > 0) issueParts.push(`${detail.totalDamage} damaged`);
  if (detail.totalEmpty > 0) issueParts.push(`${detail.totalEmpty} empty`);

  return (
    <>
      {detail.issueLineCount > 0 ? (
        <Banner tone="amber" icon={<AlertTriangle size={16} />}>
          <b>
            {detail.issueLineCount} line{detail.issueLineCount === 1 ? "" : "s"} need
            {detail.issueLineCount === 1 ? "s" : ""} your attention
          </b>
          {issueParts.length > 0 && ` — ${issueParts.join(", ")}`}. Everything else
          matched the STI exactly.
        </Banner>
      ) : (
        <Banner tone="grey" icon={<AlertTriangle size={16} />}>
          <b>All clear.</b> Every line matched the STI exactly.
        </Banner>
      )}

      <TableShell
        title={
          <>
            {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI ·{" "}
            {formatCount(detail.totalPhysicalQty)} received
          </>
        }
        right={
          <div className="inline-flex gap-0.5 rounded-[7px] bg-gray-100 p-[3px]">
            <SegButton active={!onlyIssues} onClick={() => setOnlyIssues(false)}>
              All {detail.lineCount}
            </SegButton>
            <SegButton active={onlyIssues} onClick={() => setOnlyIssues(true)}>
              Issues {detail.issueLineCount}
            </SegButton>
          </div>
        }
      >
        {rows.map((r) => {
          const l = r.line;
          const cont = !r.carriesLineTotals;
          return (
            <tr key={r.key} className={l.hasIssue ? "bg-amber-50/60" : ""}>
              <Td muted center>{r.label}</Td>
              <Td mono strong={!cont} muted={cont}>{l.skuCode}</Td>
              <Td muted={cont}>
                {cont ? "↳ second mfg batch" : <Description line={l} />}
              </Td>
              <Td center muted={cont}>{l.pack ?? "—"}</Td>
              {/* First sub-row only — see buildRenderRows. */}
              <Td center strong={!cont}>{cont ? "—" : l.qtySti}</Td>
              <Td center>{cont ? "—" : (l.cartonQty ?? "—")}</Td>
              <Td center strong bad={!cont && l.shortQty > 0}>
                {r.qtyForRow ?? "—"}
              </Td>
              {/* Mfg — ONE cell, and it VARIES per sub-row. Best before had a
                  cell here until 2026-08-22; see the file header. */}
              <Td center>
                {r.batch ? formatMonthYear(r.batch.mfgMonth, r.batch.mfgYear) : "—"}
              </Td>
              <Cond value={cont ? null : l.sndQty} />
              <Cond value={cont ? null : l.leakyQty} bad />
              <Cond value={cont ? null : l.damageQty} bad />
              <Cond value={cont ? null : l.emptyQty} bad />
              <Cond value={cont ? null : l.qtdQty} />
              <Cond value={cont ? null : l.rejQty} bad />
              <Cond value={cont ? null : l.shortQty || null} bad />
              <Cond value={cont ? null : l.excessQty || null} bad />
            </tr>
          );
        })}

        {/* TOTAL row. Sums come from reportTotals() — the same function the XLS
            and the A4 sheet total with, so the three cannot disagree about one
            truck. It totals the WHOLE MRN, not the filtered view: a total that
            changed with a view filter would be a different number wearing the
            same label. */}
        {detail.lines.length > 0 && (
          <tr className="bg-[#f7f8fa] font-semibold">
            <Td center muted>{""}</Td>
            <td
              colSpan={3}
              className="h-9 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#f0f0f0] px-2 pl-2.5 text-[11px] font-semibold text-gray-900"
            >
              TOTAL
            </td>
            <Td center strong>{formatCount(totals.qtySti)}</Td>
            <Td center muted>—</Td>
            <Td center strong>{formatCount(totals.physical)}</Td>
            <Td center muted>—</Td>
            <Cond value={totals.snd || null} />
            <Cond value={totals.leaky || null} bad />
            <Cond value={totals.damage || null} bad />
            <Cond value={totals.empty || null} bad />
            <Cond value={totals.qtd || null} />
            <Cond value={totals.rej || null} bad />
            <Cond value={totals.short || null} bad />
            <Cond value={totals.excess || null} bad />
          </tr>
        )}

        {rows.length === 0 && (
          <EmptyRow
            colSpan={COLUMNS.length}
            text={onlyIssues ? "No lines with issues." : "No lines on this MRN."}
          />
        )}
      </TableShell>
    </>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/**
 * The card, the header strip, the horizontal scroll box, the colgroup and the
 * header row. Callers supply only <tr>s.
 *
 * `extraColumn` appends one narrow action column (the open state's row delete).
 * It is deliberately NOT part of COLUMNS: COLUMNS is the DATA shape, shared by
 * all three states, and an action that exists in only one state must not be
 * able to shift the others' widths.
 */
function TableShell({
  title,
  right,
  extraColumn,
  children,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  extraColumn?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  // The action column takes its width ON TOP of the 100%, so the data columns
  // keep the exact same proportions in every state.
  const minWidth = TABLE_MIN_WIDTH + (extraColumn ? 40 : 0);

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e6e9ec] bg-white">
      <div className="flex items-center justify-between border-b border-[#f0f2f4] px-3.5 py-2.5">
        <div className="text-[12px] font-semibold text-gray-900">
          Line items <span className="ml-[7px] font-normal text-gray-400">{title}</span>
        </div>
        {right}
      </div>

      {/* 🔴 THE TABLE SCROLLS, THE PAGE DOES NOT. 17 columns cannot fit a pane
          sitting beside a 344px rail at any realistic width, so the overflow is
          owned here and nowhere else. Without this box the whole board scrolls
          sideways and the rail slides off screen. */}
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse"
          style={{ minWidth: `${minWidth}px` }}
        >
          <colgroup>
            {COLUMNS.map((c) => (
              <col key={c.key} style={{ width: `${c.width}%` }} />
            ))}
            {extraColumn && <col style={{ width: "40px" }} />}
          </colgroup>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <Th key={c.key} center={!c.left}>
                  {c.label}
                </Th>
              ))}
              {extraColumn && <Th center />}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/** The product name, or the UNKNOWN SKU treatment. One definition — it renders
 *  identically in all three states. */
function Description({ line }: { line: MrnDetailLine }): React.JSX.Element {
  if (line.isCatalogued) return <>{line.description}</>;
  return (
    <span className="text-amber-800">
      Not in catalog
      <span className="ml-1.5 rounded border border-amber-200 bg-amber-100 px-[5px] py-px text-[9.5px] font-semibold text-amber-700">
        UNKNOWN SKU
      </span>
    </span>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text?: string }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3.5 py-4 text-[12px] leading-relaxed text-gray-400">
        {text ?? "No lines yet — paste them from the STI sheet."}
      </td>
    </tr>
  );
}

function Th({
  children,
  center,
}: {
  children?: React.ReactNode;
  center?: boolean;
}): React.JSX.Element {
  return (
    <th
      className={
        "h-8 overflow-hidden whitespace-nowrap border-b border-[#ebebeb] px-2 text-[10px] font-medium uppercase tracking-[0.05em] text-gray-400 " +
        (center ? "text-center" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  muted,
  strong,
  mono,
  bad,
}: {
  children?: React.ReactNode;
  center?: boolean;
  muted?: boolean;
  strong?: boolean;
  mono?: boolean;
  bad?: boolean;
}): React.JSX.Element {
  const colour = bad
    ? "text-[#b42318] font-semibold"
    : muted
      ? "text-gray-400"
      : strong
        ? "text-gray-900 font-medium"
        : "text-[#4b5563]";
  return (
    <td
      className={
        "h-9 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#f0f0f0] px-2 text-[11px] " +
        (center ? "text-center " : "") +
        (mono ? "font-mono " : "") +
        colour
      }
    >
      {children}
    </td>
  );
}

/** A condition count. Null renders as a dash — 0 and null mean the same thing
 *  to a reader here, and a grid of zeroes buries the numbers that matter. */
function Cond({ value, bad }: { value: number | null; bad?: boolean }): React.JSX.Element {
  return (
    <Td center bad={bad && value !== null && value > 0} muted={value === null}>
      {value === null || value === 0 ? "—" : value}
    </Td>
  );
}

/** A column the SUPERVISOR fills — visible to billing, never fillable here. */
function DashedCell(): React.JSX.Element {
  return (
    <span className="inline-flex h-[22px] min-w-[34px] items-center justify-center rounded-[5px] border border-dashed border-[#d8dce1] text-[11px] text-[#c2c8d0]">
      —
    </span>
  );
}

function SegButton({
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
        "rounded-[5px] px-3 py-[5px] text-[12px] " +
        (active
          ? "bg-gray-900 font-semibold text-white"
          : "font-medium text-gray-500 hover:bg-white/60")
      }
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "amber" | "grey";
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const toneClass =
    tone === "amber"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : "bg-[#f7f8fa] border-gray-200 text-[#475467]";
  return (
    <div
      className={`mb-3.5 flex gap-[9px] rounded-[9px] border px-[13px] py-[11px] text-[12.5px] leading-[1.55] ${toneClass}`}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <div>{children}</div>
    </div>
  );
}
