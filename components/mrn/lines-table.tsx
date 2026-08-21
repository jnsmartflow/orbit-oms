"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Smartphone, X } from "lucide-react";
import type { MrnBatchRow, MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { formatCount, formatMonthYear } from "./format";

// The line-items table — THREE different tables behind one component, chosen by
// `status`, drawn to mockup B1 / B3 / B4.
//
// Fixed-table standard throughout (UI §27): table-layout fixed, a <colgroup> of
// PERCENTAGES, 32px header rows, 36px data rows, 10px uppercase headers. Each
// state gets its own colgroup because each has a different column count —
// percentages must sum to 100 within a state, never be shared across states.
//
// ⚠️ THE MOCKUP IS NOT AUTHORITY ON THE COLUMN SET FOR `done`. It draws SIX
// condition columns; the real set is EIGHT — SND · Lky · Dmg · Emp · QTD · REJ
// · Sht · Exc — which is row 16 of the source workbook and what design §11 OQ-3
// settled. The mockup compressed them for drawing width. QTD's meaning is still
// unknown (design §4): it is carried through schema, UI and report because the
// workbook carries it, and must never be repurposed to mean something helpful.
//
// ⚠️ Short and Excess are DERIVED, never stored (§11 OQ-2) — they arrive
// already computed on every line by lib/mrn/derive.ts, applied server-side in
// getMrnDetail(). Nothing here recomputes them, which is the whole reason the
// card, this table, the XLS and the print sheet cannot disagree about one truck.

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
 * it where the sheet has it. It therefore renders as a real (solid-bordered)
 * value cell when present, not as a dashed one.
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
  // ── The local draft (2026-08-22, step 8b) ─────────────────────────────────
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
      >
        <table className="w-full table-fixed border-collapse">
          {/* Rebalanced for the delete column — Description gave up the 4%. */}
          <colgroup>
            <col style={{ width: "4%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "7%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "4%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>SKU</Th>
              <Th>Description</Th>
              <Th center>Pack</Th>
              <Th center>Qty STI</Th>
              <Th center>Ctn</Th>
              <Th center>Physical</Th>
              <Th center>Mfg m/y</Th>
              <Th center>Best before</Th>
              <Th center>Iss.</Th>
              <Th center />
            </tr>
          </thead>
          <tbody>
            {draft.map((line) => (
              <tr key={line.id} className={line.isCatalogued ? "" : "bg-amber-50/60"}>
                <Td muted center>{line.lineNo}</Td>
                <Td mono strong>{line.skuCode}</Td>
                <Td>
                  {line.isCatalogued ? (
                    line.description
                  ) : (
                    <span className="text-amber-800">
                      Not in catalog
                      <span className="ml-1.5 rounded border border-amber-200 bg-amber-100 px-[5px] py-px text-[9.5px] font-semibold text-amber-700">
                        UNKNOWN SKU
                      </span>
                    </span>
                  )}
                </Td>
                <Td center>{line.pack ?? "—"}</Td>
                <Td center strong>{line.qtySti}</Td>
                {/* BILLING'S ONE EDITABLE COLUMN. It comes off the STI sheet, so
                    billing types it where the sheet has it — everything else on
                    this row is either theirs already (SKU, qty) or the
                    supervisor's, and the supervisor's stay dashed. */}
                <Td center>
                  <input
                    value={line.cartonQty ?? ""}
                    onChange={(e) => setCarton(line.id, e.target.value)}
                    inputMode="numeric"
                    aria-label={`Carton qty for line ${line.lineNo}`}
                    className="h-[22px] w-[46px] rounded-[5px] border border-gray-200 bg-white text-center text-[11px] font-medium text-[#1d2939] outline-none focus:border-gray-400"
                  />
                </Td>
                <Td center><DashedCell /></Td>
                <Td center><DashedCell /></Td>
                <Td center><DashedCell /></Td>
                <Td center muted>—</Td>
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
          </tbody>
        </table>
        {draft.length === 0 && <EmptyLines />}
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

      {/* Greyed as a whole, per the mockup's .lockrow. The values below are the
          ones billing typed — never the supervisor's in-flight ones. */}
      <div className="opacity-55">
        <TableShell
          title={
            <>
              {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI
            </>
          }
        >
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "31%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead>
              <tr>
                <Th center>#</Th>
                <Th>SKU</Th>
                <Th>Description</Th>
                <Th center>Pack</Th>
                <Th center>Qty STI</Th>
                <Th center>Ctn</Th>
                <Th center>Physical</Th>
                <Th center>Mfg m/y</Th>
                <Th center>Best before</Th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => (
                <tr key={line.id}>
                  <Td muted center>{line.lineNo}</Td>
                  <Td mono strong>{line.skuCode}</Td>
                  <Td>{line.isCatalogued ? line.description : "Not in catalog"}</Td>
                  <Td center>{line.pack ?? "—"}</Td>
                  <Td center strong>{line.qtySti}</Td>
                  <Td center>{line.cartonQty ?? "—"}</Td>
                  {/* Deliberately dashed even if the supervisor has already
                      filled them server-side. See this component's header. */}
                  <Td center><DashedCell /></Td>
                  <Td center><DashedCell /></Td>
                  <Td center><DashedCell /></Td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.lines.length === 0 && <EmptyLines />}
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
   * True on the first (or only) row for a line. Everything that belongs to the
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
 * ⚠ THE SAME RULE EXTENDS TO THE SIX CONDITION COUNTS, and the mockup does not
 * settle this. It draws SND split across 6a/6b as 9 and 6, which reads as a
 * per-batch count — but the counts are stored on `mrn_lines`, not on
 * `mrn_line_batches`, so there is no per-batch value to render and inventing a
 * split would be fabricating data. They render on the first sub-row only, for
 * exactly the reason Qty STI does: otherwise the TOTAL row counts them twice.
 * Only the PHYSICAL quantity and the manufacturing pair vary per sub-row, which
 * is the entire reason a line splits.
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
  // Local, read-only view filter (mockup B4's .seg). Not teal — the selected
  // rail card is this surface's one teal element (UI §1) — so the active slot
  // takes the gray-900 treatment instead.
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
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: "3.5%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "24.5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5.5%" }} />
            <col style={{ width: "6%" }} />
            {/* The EIGHT condition columns — see this file's header. */}
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
            <col style={{ width: "4.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>SKU</Th>
              <Th>Description</Th>
              <Th center>Pack</Th>
              <Th center>STI</Th>
              <Th center>Ctn</Th>
              <Th center>Phy</Th>
              <Th center>Mfg</Th>
              <Th center>SND</Th>
              <Th center>Lky</Th>
              <Th center>Dmg</Th>
              <Th center>Emp</Th>
              <Th center>QTD</Th>
              <Th center>REJ</Th>
              <Th center>Sht</Th>
              <Th center>Exc</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = r.line;
              const cont = !r.carriesLineTotals;
              return (
                <tr key={r.key} className={l.hasIssue ? "bg-amber-50/60" : ""}>
                  <Td muted center>{r.label}</Td>
                  <Td mono strong={!cont} muted={cont}>{l.skuCode}</Td>
                  <Td muted={cont}>
                    {cont
                      ? "↳ second mfg batch"
                      : l.isCatalogued
                        ? l.description
                        : "Not in catalog"}
                  </Td>
                  <Td center muted={cont}>{l.pack ?? "—"}</Td>
                  {/* First sub-row only — see buildRenderRows. */}
                  <Td center strong={!cont}>{cont ? "—" : l.qtySti}</Td>
                  <Td center>{cont ? "—" : (l.cartonQty ?? "—")}</Td>
                  <Td center strong bad={!cont && l.shortQty > 0}>
                    {r.qtyForRow ?? "—"}
                  </Td>
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

            {/* TOTAL row. Sums come from the payload (computed once, server-side,
                by summariseMrn) except SND — see totalSnd above. It totals the
                WHOLE MRN, not the filtered view: a total that changed with a
                view filter would be a different number wearing the same label. */}
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
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="px-3.5 py-4 text-[12px] text-gray-400">
            {onlyIssues ? "No lines with issues." : "No lines on this MRN."}
          </p>
        )}
      </TableShell>
    </>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function TableShell({
  title,
  right,
  children,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e6e9ec] bg-white">
      <div className="flex items-center justify-between border-b border-[#f0f2f4] px-3.5 py-2.5">
        <div className="text-[12px] font-semibold text-gray-900">
          Line items <span className="ml-[7px] font-normal text-gray-400">{title}</span>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function EmptyLines(): React.JSX.Element {
  return (
    <p className="px-3.5 py-4 text-[12px] leading-relaxed text-gray-400">
      No lines yet — paste them from the STI sheet.
    </p>
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
    <span className="inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-[5px] border border-dashed border-[#d8dce1] text-[11px] text-[#c2c8d0]">
      —
    </span>
  );
}

/** A filled value in a bordered box — billing's own carton qty. */
function ValueCell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex h-[22px] min-w-[38px] items-center justify-center rounded-[5px] border border-gray-200 bg-white text-[11px] font-medium text-[#1d2939]">
      {children}
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
        (active ? "bg-gray-900 font-semibold text-white" : "font-medium text-gray-500 hover:bg-white/60")
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
