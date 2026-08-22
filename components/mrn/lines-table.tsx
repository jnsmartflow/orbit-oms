"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Smartphone, X } from "lucide-react";
import type { MrnBatchRow, MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { formatCount, formatMonthYear } from "./format";

// The line-items table.
//
// ⚠️ ONE COLUMN SET, ALL THREE STATES (2026-08-22). open / checking / done now
// render the SAME 17 columns in the same order, so the operator learns one
// table and never has to re-find a column when a truck changes state. What
// varies is only what is IN the cells: in `open` and `checking` every
// supervisor-owned column renders as an empty dashed cell.
//
//   # · SKU · Description · Pack · Qty STI · Ctn · Physical · Mfg m/y ·
//   BB m/y · SND · Lky · Damage · Empty · QTD · REJ · Short · Excess
//
// ⚠️ Mfg and Best Before are ONE cell each, rendered `06/26` — matching the
// source workbook's PRINT sheet, which is what the depot already reads. They
// are STORED as four integers (month + year, twice) and joined only here; do
// NOT split them into four columns to mirror the schema.
//
// ⚠️ THE "Iss." COLUMN WAS REMOVED (2026-08-22). It was a yes/no restatement of
// the eight condition columns sitting immediately beside it, and the signal is
// already carried twice over — by the issues banner above the table and by the
// `N issues` chip on the rail card. Do not reinstate it.
//
// ⚠️ EIGHT condition columns, not the six the mockup drew — SND · Lky · Damage ·
// Empty · QTD · REJ · Short · Excess is row 16 of the source workbook and what
// design §11 OQ-3 settled. QTD's meaning is still unknown (design §4): it is
// carried through schema, UI and report because the workbook carries it, and
// must never be repurposed to mean something helpful.
//
// ⚠️ Short and Excess are DERIVED, never stored (§11 OQ-2) — they arrive already
// computed on every line by lib/mrn/derive.ts, applied server-side in
// getMrnDetail(). Nothing here recomputes them, which is the whole reason the
// card, this table, the XLS and the print sheet cannot disagree about one truck.
//
// ⚠️ 17 COLUMNS OVERFLOW, AND THAT IS HANDLED IN ONE PLACE. The table sits in
// its own `overflow-x-auto` box with a min-width, so IT scrolls sideways and the
// PAGE never does. The fixed-table standard still applies (UI §27): table-layout
// fixed with a <colgroup> of percentages — the percentages now resolve against
// TABLE_MIN_WIDTH rather than against the pane, which is what stops 17 columns
// collapsing into unreadable slivers on a narrow window.

/** Wide enough that every column stays legible; the box scrolls past it. */
const TABLE_MIN_WIDTH = 1480;

/** ONE definition, read by the colgroup and the header row alike, so a column
 *  can never be added to one and forgotten in the other. Percentages sum to 100. */
const COLUMNS: { key: string; label: string; width: number; left?: boolean }[] = [
  { key: "no", label: "#", width: 3 },
  { key: "sku", label: "SKU", width: 8, left: true },
  { key: "desc", label: "Description", width: 20, left: true },
  { key: "pack", label: "Pack", width: 5 },
  { key: "sti", label: "Qty STI", width: 5 },
  { key: "ctn", label: "Ctn", width: 4 },
  { key: "phy", label: "Physical", width: 5 },
  { key: "mfg", label: "Mfg m/y", width: 5 },
  { key: "bb", label: "BB m/y", width: 5 },
  { key: "snd", label: "SND", width: 5 },
  { key: "lky", label: "Lky", width: 5 },
  { key: "dmg", label: "Damage", width: 5 },
  { key: "emp", label: "Empty", width: 5 },
  { key: "qtd", label: "QTD", width: 5 },
  { key: "rej", label: "REJ", width: 5 },
  { key: "sht", label: "Short", width: 5 },
  { key: "exc", label: "Excess", width: 5 },
];

/** Physical · Mfg · BB · the eight condition columns = 11 cells the supervisor
 *  owns, dashed in both billing-facing states. */
const SUPERVISOR_COLUMN_COUNT = 11;

interface LinesTableProps {
  detail: MrnDetail;
  /** Reported up so the board can warn before a dirty draft is discarded. */
  onDirtyChange?: (dirty: boolean) => void;
  /** After a successful save — the board refetches. */
  onSaved?: () => void;
}

export function LinesTable({
  detail,
  onDirtyChange,
  onSaved,
}: LinesTableProps): React.JSX.Element {
  if (detail.status === "checking") return <CheckingTable detail={detail} />;
  if (detail.status === "done") return <DoneTable detail={detail} />;
  return <OpenTable detail={detail} onDirtyChange={onDirtyChange} onSaved={onSaved} />;
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
  onDirtyChange,
  onSaved,
}: {
  detail: MrnDetail;
  onDirtyChange?: (dirty: boolean) => void;
  onSaved?: () => void;
}): React.JSX.Element {
  // ── The local draft ───────────────────────────────────────────────────────
  //
  // Carton-qty edits and row deletes change LOCAL state and mark the table
  // dirty; an explicit "Save lines" writes the whole set. It is deliberately
  // NOT a write per keystroke, for a reason specific to this route: the lines
  // endpoint REPLACES everything (deleteMany then createMany), so every save is
  // a moment where the MRN briefly has zero lines. Doing that on each character
  // typed into a carton-qty box would be absurd — and would also fire the
  // linesCleared failure mode mid-typing, which no operator could act on.
  //
  // Paste is the exception and writes immediately from its own modal: its
  // confirm button IS the save, and the board re-reads afterwards.
  //
  // Seeded from `detail.lines`. Reset happens by REMOUNT — detail-pane keys
  // this component on detail.id — rather than through an effect that would race
  // the fetch and could silently discard an in-progress edit.
  const [draft, setDraft] = useState<MrnDetailLine[]>(detail.lines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (draft.length !== detail.lines.length) return true;
    return draft.some((d, i) => {
      const o = detail.lines[i];
      return o === undefined || o.id !== d.id || o.cartonQty !== d.cartonQty;
    });
  }, [draft, detail.lines]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    // Clear the flag when this table unmounts, or the board keeps warning about
    // a draft that no longer exists.
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const unmatched = draft.filter((l) => !l.isCatalogued).length;
  const draftQtySti = draft.reduce((s, l) => s + l.qtySti, 0);

  function setCarton(id: number, raw: string) {
    const trimmed = raw.trim();
    // Blank clears it back to NULL — a carton qty the STI does not state is
    // genuinely absent, not zero.
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 0)) return;
    setDraft((rows) => rows.map((r) => (r.id === id ? { ...r, cartonQty: next } : r)));
  }

  function removeRow(id: number) {
    setDraft((rows) => rows.filter((r) => r.id !== id));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // The STRUCTURED shape, not a re-serialised block — a block has no
        // carton-qty column and would wipe every value typed above. The route's
        // own header explains why it takes two shapes.
        body: JSON.stringify({
          lines: draft.map((l) => ({
            lineNo: l.lineNo,
            skuCode: l.skuCode,
            qtySti: l.qtySti,
            cartonQty: l.cartonQty,
          })),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          linesCleared?: boolean;
        };
        // Verbatim, including linesCleared's "this MRN now has no lines" — see
        // components/mrn/modal-shell.tsx's ModalError for why that one in
        // particular must never be generalised.
        setError(json.error ?? `Could not save the lines (${res.status}).`);
        // A 409 means the supervisor started while this draft was open. Refetch
        // so the pane stops offering an edit the server has already refused.
        if (res.status === 409 || json.linesCleared) onSaved?.();
        return;
      }
      onSaved?.();
    } catch {
      setError("Could not reach the server. Nothing was saved — try again.");
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
            {draft.length} lines · {formatCount(draftQtySti)} nos as per STI
            {unmatched > 0 && ` · ${unmatched} SKU${unmatched === 1 ? "" : "s"} not in catalog`}
            {dirty && <span className="ml-2 text-[#b45309]">unsaved changes</span>}
          </>
        }
        right={
          // Appears ONLY when dirty. A permanently visible Save would invite a
          // pointless full replace of every line on a table nobody touched.
          dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className={
                "inline-flex h-7 items-center rounded-md border px-3 text-[11.5px] font-semibold " +
                (busy
                  ? "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                  : "border-gray-900 bg-gray-900 text-white hover:bg-gray-800")
              }
            >
              {busy ? "Saving…" : "Save lines"}
            </button>
          ) : undefined
        }
        /* The one extra column billing gets on an open MRN — row delete. It is
           an ACTION, not data, so it lives outside COLUMNS and is appended by
           the frame rather than folded into the shared 17. */
        extraColumn
      >
        {draft.map((line) => (
          <tr key={line.id} className={line.isCatalogued ? "" : "bg-amber-50/60"}>
            <Td muted center>{line.lineNo}</Td>
            <Td mono strong>{line.skuCode}</Td>
            <Td>
              <Description line={line} />
            </Td>
            <Td center>{line.pack ?? "—"}</Td>
            <Td center strong>{line.qtySti}</Td>
            {/* BILLING'S ONE EDITABLE COLUMN. It comes off the STI sheet, so
                billing types it where the sheet has it — everything else on this
                row is either theirs already (SKU, qty) or the supervisor's, and
                the supervisor's stay dashed. */}
            <Td center>
              <input
                value={line.cartonQty ?? ""}
                onChange={(e) => setCarton(line.id, e.target.value)}
                inputMode="numeric"
                aria-label={`Carton qty for line ${line.lineNo}`}
                className="h-[22px] w-[42px] rounded-[5px] border border-gray-200 bg-white text-center text-[11px] font-medium text-[#1d2939] outline-none focus:border-gray-400"
              />
            </Td>
            {Array.from({ length: SUPERVISOR_COLUMN_COUNT }).map((_, i) => (
              <Td key={i} center>
                <DashedCell />
              </Td>
            ))}
            <Td center>
              <button
                type="button"
                onClick={() => removeRow(line.id)}
                aria-label={`Remove line ${line.lineNo}`}
                className="text-[#c2c8d0] hover:text-[#b42318]"
              >
                <X size={13} />
              </button>
            </Td>
          </tr>
        ))}
        {draft.length === 0 && <EmptyRow colSpan={COLUMNS.length + 1} />}
      </TableShell>
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

/** One rendered row. A multi-batch line becomes several of these. */
interface RenderRow {
  key: string;
  /** "6" for a single-batch line, "6a" / "6b" for a split one. */
  label: string;
  line: MrnDetailLine;
  batch: MrnBatchRow | null;
  /**
   * True on the first (or only) row for a line. Everything belonging to the
   * LINE rather than to a batch renders here and nowhere else — see below.
   */
  carriesLineTotals: boolean;
  /** The quantity this row accounts for: the batch's, or the whole line's. */
  qtyForRow: number | null;
}

/**
 * Flatten lines into render rows, splitting a multi-batch line into sub-rows.
 *
 * 🔴 `Qty STI` SITS ON THE FIRST SUB-ROW ONLY. Repeating it on 6b would
 * double-count the column and break the TOTAL row — design §6 says so about the
 * report, and the same arithmetic applies to this table.
 *
 * ⚠ THE SAME RULE EXTENDS TO THE EIGHT CONDITION COLUMNS, and the mockup does
 * not settle this. It draws SND split across 6a/6b as 9 and 6, which reads as a
 * per-batch count — but the counts are stored on `mrn_lines`, not on
 * `mrn_line_batches`, so there is no per-batch value to render and inventing a
 * split would be fabricating data. They render on the first sub-row only, for
 * exactly the reason Qty STI does. Only PHYSICAL, MFG and BEST BEFORE vary per
 * sub-row, which is the entire reason a line splits.
 */
function buildRenderRows(lines: readonly MrnDetailLine[]): RenderRow[] {
  const out: RenderRow[] = [];
  for (const line of lines) {
    if (line.batches.length > 1) {
      line.batches.forEach((batch, i) => {
        out.push({
          key: `${line.id}-${batch.id}`,
          label: `${line.lineNo}${String.fromCharCode(97 + i)}`,
          line,
          batch,
          carriesLineTotals: i === 0,
          qtyForRow: batch.qty,
        });
      });
    } else {
      out.push({
        key: String(line.id),
        label: String(line.lineNo),
        line,
        batch: line.batches[0] ?? null,
        carriesLineTotals: true,
        qtyForRow: line.physicalQty,
      });
    }
  }
  return out;
}

function DoneTable({ detail }: { detail: MrnDetail }): React.JSX.Element {
  // Local, read-only view filter (mockup B4's .seg). Not teal — teal on this
  // board belongs to New MRN / the pane's action row (UI §1).
  const [onlyIssues, setOnlyIssues] = useState(false);

  const lines = useMemo(
    () => (onlyIssues ? detail.lines.filter((l) => l.hasIssue) : detail.lines),
    [detail.lines, onlyIssues],
  );
  const rows = useMemo(() => buildRenderRows(lines), [lines]);

  // SND is summed here rather than read off the payload because
  // MrnIssueSummary deliberately has no `totalSnd`: SND is the SOUND count, the
  // clean case, and folding it into an ISSUE summary would have made that
  // type's name a lie. It is still a real column with a real total.
  const totalSnd = useMemo(
    () => detail.lines.reduce((s, l) => s + (l.sndQty ?? 0), 0),
    [detail.lines],
  );

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
              {/* Mfg and Best Before — ONE cell each, and they VARY per sub-row. */}
              <Td center>
                {r.batch ? formatMonthYear(r.batch.mfgMonth, r.batch.mfgYear) : "—"}
              </Td>
              <Td center>
                {r.batch
                  ? formatMonthYear(r.batch.bestBeforeMonth, r.batch.bestBeforeYear)
                  : "—"}
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

        {/* TOTAL row. Sums come from the payload (computed once, server-side, by
            summariseMrn) except SND — see totalSnd above. It totals the WHOLE
            MRN, not the filtered view: a total that changed with a view filter
            would be a different number wearing the same label. */}
        {detail.lines.length > 0 && (
          <tr className="bg-[#f7f8fa] font-semibold">
            <Td center muted>{""}</Td>
            <td
              colSpan={3}
              className="h-9 overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#f0f0f0] px-2 pl-2.5 text-[11px] font-semibold text-gray-900"
            >
              TOTAL
            </td>
            <Td center strong>{formatCount(detail.totalQtySti)}</Td>
            <Td center muted>—</Td>
            <Td center strong>{formatCount(detail.totalPhysicalQty)}</Td>
            <Td center muted>—</Td>
            <Td center muted>—</Td>
            <Cond value={totalSnd || null} />
            <Cond value={detail.totalLeaky || null} bad />
            <Cond value={detail.totalDamage || null} bad />
            <Cond value={detail.totalEmpty || null} bad />
            <Cond value={detail.totalQtd || null} />
            <Cond value={detail.totalRej || null} bad />
            <Cond value={detail.totalShort || null} bad />
            <Cond value={detail.totalExcess || null} bad />
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
