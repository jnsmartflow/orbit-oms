"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Smartphone, X } from "lucide-react";
import type { MrnDetail, MrnDetailLine } from "@/lib/mrn/types";
import { isMrnReceivedFrom } from "@/lib/mrn/types";
import { extraBatchCount, formatBatchNo, isLineOpenable, summariseMrn } from "@/lib/mrn/derive";
import { deliveryGroups, deliveryLabel } from "@/lib/mrn/delivery";
import { reportTotals } from "@/lib/mrn/report";
import { formatCount } from "./format";
import { ModalButton, ModalError, ModalShell, describeWriteError } from "./modal-shell";

// The line-items table.
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴 ONE COLUMN SET FOR ALL THREE STATES IS REVERSED (2026-08-26).
//
// From 2026-08-22 until today this file rendered the SAME 16 columns in
// open, checking and done, on the reasoning that the operator should learn
// one table and never re-find a column when a truck changes state. That
// traded the wrong thing away. Holding the shape steady meant `open` and
// `checking` rendered TEN empty dashed cells per row — Physical, Mfg and all
// eight condition counts — before anyone had touched the truck. A column of
// dashes does not teach where a number will appear; it just costs the width
// that Description and Qty STI needed, on the two states where the STI sheet
// is the only thing on screen. Eight empty condition columns tell the reader
// nothing.
//
// Each state now gets the columns it has data for:
//
//   open + checking → # · SKU · Description · Pack · Qty STI          (5)
//   done            → # · SKU · Description · Pack · Qty STI ·
//                     Physical · Batch No · chevron                   (8)
//
// A FUTURE SESSION MUST NOT "FIX" THIS BACK. The one-column-set rule is not
// lost knowledge to be rediscovered — it was tried, it shipped, and it was
// reversed deliberately on the date above.
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴 THE EIGHT CONDITION COLUMNS AND Ctn LEFT THE SCREEN ENTIRELY (same date).
// SND · Lky · Damage · Empty · QTD · REJ · Short · Excess now live in the LINE
// DRAWER (components/mrn/line-drawer.tsx) and in the report — the XLS keeps all
// eight in the source workbook's order, and the A4 sheet prints them. Nothing
// was dropped from the DATA; it moved off the row, where sixteen numbers
// competed for the two that matter. Ctn went with them: it is derived from the
// catalog at paste and nobody reads it on screen.
//
// ⚠️ ONE ROW PER LINE IN `done` — NO 6a/6b SUB-ROWS ANY MORE. A split line used
// to render one row per manufacturing batch. It now renders ONE row carrying a
// `+N` badge on Mfg, and the batches are listed inside the drawer, which is the
// whole reason a split line is openable. This is a deliberate divergence from
// the REPORT, which still emits sub-rows: buildRenderRows() lives in
// lib/mrn/report.ts and is still the single definition for the XLS and the A4
// sheet, where there is no drawer to open and the sub-row IS how a split line
// gets expressed on paper. The screen has somewhere better to put it.
//
// ⚠️ Batch No REPLACED the Mfg M/Y cell here — same 12%, same eight columns.
// "T20260801" already contains 08/2026, so the month and year are still on the
// row; they are just no longer a second thing to read. It is DERIVED at render
// by formatBatchNo() (lib/mrn/derive.ts) from mrn.receivedFrom plus the batch’s
// own mfgMonth/mfgYear — there is NO batch-number column and none may be added,
// exactly as with Short and Excess below.
//
// ⚠️ The XLS export keeps Manufacturing Month and Manufacturing Year as two
// integers ALONGSIDE Batch No, because a spreadsheet is the thing people sort
// and filter. That is a deliberate divergence from this table, not drift — see
// lib/mrn/workbook.ts.
//
// ⚠️ Short and Excess are DERIVED, never stored (design §11 OQ-2) — they arrive
// already computed on every line by lib/mrn/derive.ts, applied server-side in
// getMrnDetail(). Nothing here recomputes them, which is the whole reason the
// card, this table, the XLS and the print sheet cannot disagree about one truck.
//
// ⚠️ WHICH ROWS OPEN IS NOT DECIDED HERE. isLineOpenable() in lib/mrn/derive.ts
// is THE definition — an issue, or more than one manufacturing batch. The
// chevron, the pointer cursor and the click handler all read that one function
// and none of them re-derives it inline. The drawer's ‹ › steps the same list.
//
// ⚠️ FIXED-TABLE STANDARD (UI §27) — table-layout: fixed with a <colgroup> of
// percentages, one constant per state read by BOTH the colgroup and the header
// row, so a column can never be added to one and forgotten in the other. Never
// `auto`, never `fr`.

interface Column {
  key: string;
  label: string;
  /** Percent. Each set sums to 100. */
  width: number;
  left?: boolean;
}

/** `open` and `checking` — everything billing has before the truck is touched. */
const BILLING_COLUMNS: Column[] = [
  { key: "no", label: "#", width: 6 },
  { key: "sku", label: "SKU", width: 16, left: true },
  { key: "desc", label: "Description", width: 50, left: true },
  { key: "pack", label: "Pack", width: 10 },
  { key: "sti", label: "Qty STI", width: 18 },
];

/** `done` — what the supervisor brought back, plus the chevron column. */
const DONE_COLUMNS: Column[] = [
  { key: "no", label: "#", width: 6 },
  { key: "sku", label: "SKU", width: 14, left: true },
  { key: "desc", label: "Description", width: 34, left: true },
  { key: "pack", label: "Pack", width: 8 },
  { key: "sti", label: "Qty STI", width: 11 },
  { key: "phy", label: "Physical", width: 11 },
  { key: "batch", label: "Batch No", width: 12 },
  { key: "chev", label: "", width: 4 },
];

/**
 * A floor so the columns stay legible on a narrow window; the box scrolls past
 * it if the pane is ever smaller.
 *
 * ⚠ THIS USED TO BE 1400 AND THAT NUMBER CAUSED A REAL BUG (c16e59df). Sixteen
 * columns needed it, and it propagated up through three plain blocks into the
 * grid track, laying the whole pane out at 1438px inside an ~830px column. Five
 * and eight columns need nothing like it. Keep it well under any realistic pane
 * width — if a future column set needs more than this, the columns are the
 * problem, not the floor.
 */
const TABLE_MIN_WIDTH = 720;

// ── Delivery tabs ───────────────────────────────────────────────────────────
//
// 🔴 THE TAB SCOPES THE WHOLE TABLE, INCLUDING ITS TOTALS. One STI can carry
// several delivery numbers (2026-09-01), and billing reads one delivery at a
// time against one paper sheet.
//
// 🔴 A SINGLE-DELIVERY MRN STILL SHOWS ITS TAB. Owner ruling: the delivery
// number REPLACES the "Line items" heading, so every MRN reads the same way and
// there is no second layout to learn. Thirteen of the fourteen live MRNs have
// exactly one delivery — special-casing them would make the common screen the
// odd one out.
//
// ⚠ THE TABS SIT ABOVE THE STATUS MACHINERY, NOT INSIDE IT. LinesTable still
// switches on status and each arm still chooses its own column set; all the
// tabs do is hand that switch a NARROWER detail. The exhaustive switch and its
// `never` default are untouched — a fifth status is still a compile error.

/**
 * The same MRN, seen through one delivery.
 *
 * 🔴 SCOPING THE DETAIL RATHER THAN EACH ARM IS THE WHOLE TRICK. Every count,
 * total and filter downstream already reads off `detail` — lineCount,
 * totalQtySti, issueLineCount, reportTotals(), the All/Issues segment — so
 * narrowing the object makes all of them per-delivery with no change at any
 * call site, and none of them can be forgotten.
 *
 * ⚠ summariseMrn() IS CALLED, NOT RE-DERIVED. The issue roll-up is derive.ts's
 * rule and the server applies the identical function to the whole MRN; two
 * implementations of "what counts as an issue" is exactly the drift this module
 * avoids everywhere else.
 */
function scopeToDelivery(detail: MrnDetail, deliveryNo: string | null): MrnDetail {
  if (deliveryNo === null) return detail;
  const lines = detail.lines.filter((l) => l.deliveryNo === deliveryNo);
  return {
    ...detail,
    ...summariseMrn(lines),
    lines,
    lineCount: lines.length,
    checkedLineCount: lines.filter((l) => l.isChecked).length,
    totalQtySti: lines.reduce((sum, l) => sum + l.qtySti, 0),
    totalPhysicalQty: lines.reduce((sum, l) => sum + (l.physicalQty ?? 0), 0),
  };
}

function DeliveryTabs({
  groups,
  active,
  counts,
  onSelect,
}: {
  groups: string[];
  active: string;
  counts: Map<string, number>;
  onSelect: (d: string) => void;
}): React.JSX.Element {
  return (
    <div className="inline-flex min-w-0 gap-0.5 overflow-x-auto rounded-[7px] bg-gray-100 p-[3px]">
      {groups.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onSelect(g)}
          className={
            "shrink-0 rounded-[5px] px-3 py-[5px] text-[12px] " +
            (g === active
              ? "bg-gray-900 font-semibold text-white"
              : "font-medium text-gray-500 hover:bg-white/60")
          }
        >
          {/* The delivery number IS the label — it is what billing matches
              against the paper in front of them. Mono so a 10-digit number
              scans digit by digit. */}
          <span className={g === "" ? "" : "font-mono"}>{deliveryLabel(g)}</span>
          <span
            className={
              "ml-1.5 text-[11px] tabular-nums " +
              (g === active ? "text-white/70" : "text-gray-400")
            }
          >
            {counts.get(g) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

interface LinesTableProps {
  detail: MrnDetail;
  /** HIDDEN without it — see detail-pane.tsx on hidden vs disabled. */
  canEdit: boolean;
  /** After a successful save — the board refetches. */
  onSaved?: () => void;
  /** The line whose drawer is open, or null. Owned by detail-pane.tsx. */
  openLineId?: number | null;
  /** Called with a line id when an OPENABLE row is clicked. */
  onOpenLine?: (lineId: number) => void;
}

export function LinesTable({
  detail,
  canEdit,
  onSaved,
  openLineId = null,
  onOpenLine,
}: LinesTableProps): React.JSX.Element {
  // 🔴 HOOKS BEFORE THE SWITCH, ALWAYS. The switch below returns from every
  // arm, so a hook after it would run on some renders and not others.
  //
  // ⚠ NO RESET EFFECT IS NEEDED WHEN THE MRN CHANGES. detail-pane.tsx renders
  // <LinesTable key={detail.id}>, so switching trucks REMOUNTS this component
  // and the state starts fresh. If that key is ever removed, a stale
  // `selected` would point at the previous truck's delivery number — the
  // fallback below already survives it, but the key is the real guard.
  const groups = useMemo(() => deliveryGroups(detail.lines), [detail.lines]);
  const [selected, setSelected] = useState<string | null>(null);

  // Falls back to the first group whenever the selection is absent or no longer
  // exists — which happens the moment billing re-pastes and a delivery number
  // changes under an open pane.
  const active = selected !== null && groups.includes(selected) ? selected : (groups[0] ?? null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of detail.lines) m.set(l.deliveryNo, (m.get(l.deliveryNo) ?? 0) + 1);
    return m;
  }, [detail.lines]);

  const scoped = useMemo(() => scopeToDelivery(detail, active), [detail, active]);

  // Rendered by TableShell in place of the old "Line items" heading. Null on an
  // MRN with no lines at all — there is nothing to group.
  const tabs =
    groups.length > 0 && active !== null ? (
      <DeliveryTabs groups={groups} active={active} counts={counts} onSelect={setSelected} />
    ) : null;

  // 🔴 AN EXHAUSTIVE SWITCH, NOT AN if/else CHAIN ENDING IN OpenTable.
  //
  // This used to end `return <OpenTable …>` as a catch-all, and that shape was
  // a live bug the moment a fourth status existed: 'closed' fell through to
  // OpenTable — which is the EDITABLE table, rendering a per-row delete that
  // PUTs /api/mrn/[mrnId]/lines. Billing would have watched Physical, Mfg Date
  // and Batch No vanish off a signed document AND been offered a delete button
  // on it. (The server would have refused — that route 409s unless status is
  // 'open' — so nothing could actually be destroyed. An offered-then-refused
  // action on a finished receipt is still the wrong screen.)
  //
  // A switch with a `never` default makes the next status a BUILD failure here
  // instead. Same discipline as formatBatchNo()'s receivedFrom switch in
  // lib/mrn/derive.ts and asMrnStatus() in lib/mrn/types.ts: a widened
  // vocabulary must break loudly at every site that has to choose, not pick a
  // silent default. Do not "simplify" this back into `done || closed`.
  switch (detail.status) {
    case "open":
      return <OpenTable detail={scoped} canEdit={canEdit} onSaved={onSaved} tabs={tabs} />;
    case "checking":
      return <CheckingTable detail={scoped} tabs={tabs} />;
    case "done":
    // 'closed' shows exactly what 'done' shows. Closing records the OTR number
    // and finalises the document; it takes nothing off the table. If the two
    // ever need to differ, split the arms — do not add a condition inside
    // DoneTable.
    case "closed":
      return (
        <DoneTable
          detail={scoped}
          openLineId={openLineId}
          onOpenLine={onOpenLine}
          tabs={tabs}
        />
      );
    default: {
      const unreachable: never = detail.status;
      throw new Error(
        `Unknown mrn.status "${String(unreachable)}" — chk_mrn_status was widened without updating LinesTable`,
      );
    }
  }
}

// ── open ────────────────────────────────────────────────────────────────────

/**
 * Billing's working view — the STI sheet, and nothing the supervisor owns.
 *
 * Five columns, because five is all billing has at this point. The dashed
 * placeholder cells that used to stand in for the supervisor's ten columns are
 * gone; see this file's header for why that reversal happened.
 */
function OpenTable({
  detail,
  canEdit,
  onSaved,
  tabs,
}: {
  /** ⚠ ALREADY SCOPED to the selected delivery by LinesTable — every count and
   *  total below is that delivery's, not the truck's. */
  detail: MrnDetail;
  canEdit: boolean;
  onSaved?: () => void;
  tabs?: React.ReactNode;
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
      // The SAME replace route the paste uses — it sends the lines that REMAIN.
      // There is no per-line delete endpoint and none is needed: this route
      // already owns "these are the delivery's lines now".
      //
      // 🔴 SCOPED TO THE DELETED LINE'S OWN DELIVERY (2026-09-01), AND IT HAS
      // TO BE. The route's deleteMany is now { mrnId, deliveryNo }; this used to
      // send EVERY line on the MRN, so against the scoped route it would have
      // re-created the other deliveries' lines under THIS delivery's number —
      // silently, with the right row count and the wrong grouping, and nothing
      // anywhere reporting it. A scoped route with an unscoped caller is a
      // data-loss bug, and tsc cannot see it because the body is JSON.
      //
      // Both the filter and the deliveryNo come off the line being deleted, so
      // the request describes exactly one delivery.
      const res = await fetch(`/api/mrn/${detail.id}/lines`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveryNo: line.deliveryNo,
          lines: detail.lines
            .filter((l) => l.deliveryNo === line.deliveryNo && l.id !== line.id)
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
        columns={BILLING_COLUMNS}
        tabs={tabs}
        title={
          <>
            {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI
            {unmatched > 0 && ` · ${unmatched} SKU${unmatched === 1 ? "" : "s"} not in catalog`}
          </>
        }
        /* The row-delete column. HIDDEN entirely without canEdit — an action the
           role can never perform is not rendered (see detail-pane.tsx on hidden
           vs disabled). It is an ACTION, not data, so it lives outside the
           column set and cannot shift the data columns' widths. */
        extraColumn={canEdit}
      >
        {detail.lines.map((line) => (
          /* ⚠ NO ROW WASH FOR AN UNCATALOGUED SKU. This row carried
             `bg-amber-50/60` until 2026-08-26 and it is gone on purpose: an
             unknown SKU is a gap in OUR CATALOG, not a problem with the goods,
             and the `done` table now washes issue rows red. Two washes meaning
             two different things is how a screen stops communicating. The
             inline UNKNOWN SKU tag carries it, and carries it better — it says
             which fact is missing. */
          <tr key={line.id}>
            <Td muted center>{line.lineNo}</Td>
            <Td mono strong>{line.skuCode}</Td>
            <Td>
              <Description line={line} />
            </Td>
            <Td center>{line.pack ?? "—"}</Td>
            <Td center strong>{line.qtySti}</Td>
            {canEdit && (
              <Td center>
                <button
                  type="button"
                  /* stopPropagation so a delete can never also open a drawer.
                     Rows are not clickable in THIS state today — but the guard
                     belongs on the control, not on the assumption that the row
                     around it will stay inert. */
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(line);
                  }}
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
          <EmptyRow colSpan={BILLING_COLUMNS.length + (canEdit ? 1 : 0)} />
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
function CheckingTable({
  detail,
  tabs,
}: {
  /** ⚠ ALREADY SCOPED to the selected delivery — see OpenTable. */
  detail: MrnDetail;
  tabs?: React.ReactNode;
}): React.JSX.Element {
  // ⚠ THE "Locked — the supervisor is checking this truck" BANNER IS GONE
  // (2026-08-26, v9 mockup). The status pill one line above already reads
  // "Unloading" in amber, and the table below is visibly greyed to 55% — the
  // banner was a third telling of the same fact. What it said is NOT lost
  // knowledge: the locked behaviour is documented in this component's header
  // above, which is where a future session needs it. Do not restore it.
  return (
    <>
      <div className="opacity-55">
        <TableShell
          columns={BILLING_COLUMNS}
          tabs={tabs}
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
            </tr>
          ))}
          {detail.lines.length === 0 && <EmptyRow colSpan={BILLING_COLUMNS.length} />}
        </TableShell>
      </div>
    </>
  );
}

// ── done ────────────────────────────────────────────────────────────────────

function DoneTable({
  detail,
  openLineId,
  onOpenLine,
  tabs,
}: {
  /** ⚠ ALREADY SCOPED to the selected delivery — see OpenTable. The All/Issues
   *  segment below therefore filters WITHIN the tab, and its counts are that
   *  delivery's. */
  detail: MrnDetail;
  openLineId: number | null;
  onOpenLine?: (lineId: number) => void;
  tabs?: React.ReactNode;
}): React.JSX.Element {
  // Local, read-only view filter (mockup B4's .seg). Not teal — teal on this
  // board belongs to New MRN / the pane's action row (UI §1).
  const [onlyIssues, setOnlyIssues] = useState(false);

  const lines = useMemo(
    () => (onlyIssues ? detail.lines.filter((l) => l.hasIssue) : detail.lines),
    [detail.lines, onlyIssues],
  );

  // The TOTAL row, from the SAME function the XLS and the print sheet use — it
  // includes the SND sum that MrnIssueSummary deliberately has no field for
  // (SND is the SOUND count; folding it into an ISSUE summary would make that
  // type's name a lie). See lib/mrn/report.ts.
  const totals = useMemo(() => reportTotals(detail), [detail]);

  // Narrowed once for the table — `receivedFrom` arrives as a plain string
  // (lib/mrn/queries.ts:181). null is unreachable while chk_mrn_received_from
  // stands, and renders the existing "—" if it ever is.
  const receivedFrom = isMrnReceivedFrom(detail.receivedFrom) ? detail.receivedFrom : null;

  const issueParts: string[] = [];
  if (detail.totalShort > 0) issueParts.push(`${detail.totalShort} short`);
  if (detail.totalExcess > 0) issueParts.push(`${detail.totalExcess} excess`);
  if (detail.totalLeaky > 0) issueParts.push(`${detail.totalLeaky} leaky`);
  if (detail.totalDamage > 0) issueParts.push(`${detail.totalDamage} damaged`);
  if (detail.totalEmpty > 0) issueParts.push(`${detail.totalEmpty} empty`);

  return (
    <>
      {/* ⚠ THE "All clear" BANNER IS GONE (2026-08-26, v9 mockup). It said
          "All clear. Every line matched the STI exactly." one line under a
          status pill already reading "Done" in green — the same fact, twice,
          on the state where there is nothing to act on. Do not restore it.

          THIS ONE STAYS, and the asymmetry is the point: it carries numbers
          that appear nowhere else on the screen — how many lines need
          attention, and the short / excess / leaky / damaged / empty split.
          The pill can only say "Done · 4 issues"; this says which four. */}
      {detail.issueLineCount > 0 && (
        <Banner tone="amber" icon={<AlertTriangle size={16} />}>
          <b>
            {detail.issueLineCount} line{detail.issueLineCount === 1 ? "" : "s"} need
            {detail.issueLineCount === 1 ? "s" : ""} your attention
          </b>
          {issueParts.length > 0 && ` — ${issueParts.join(", ")}`}. Everything else
          matched the STI exactly.
        </Banner>
      )}

      <TableShell
        columns={DONE_COLUMNS}
        tabs={tabs}
        title={
          <>
            {detail.lineCount} lines · {formatCount(detail.totalQtySti)} nos as per STI ·{" "}
            {formatCount(detail.totalPhysicalQty)} received
          </>
        }
        /* The strip keeps ONLY the view segment. Activity was removed from this
           module entirely on 2026-08-26 — do not add a button here. */
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
        {lines.map((l) => {
          // 🔴 THE ONE DEFINITION. Never `l.hasIssue || l.batches.length > 1`
          // spelled out here — lib/mrn/derive.ts owns it, and the drawer's
          // ‹ › stepping reads the same function over the same lines.
          const openable = isLineOpenable(l);
          const isOpen = openLineId === l.id;
          const extra = extraBatchCount(l);

          return (
            <tr
              key={l.id}
              onClick={openable && onOpenLine ? () => onOpenLine(l.id) : undefined}
              className={
                (l.hasIssue ? "bg-[#fef2f2] " : "") + (openable ? "cursor-pointer" : "")
              }
            >
              {/* 🔴 THE SELECTED BAR IS AN INSET SHADOW ON THIS FIRST <td>, AND
                  IT MUST NEVER MOVE TO THE <tr>. A shadow on a row is painted
                  once per CELL, which draws a 3px stripe down every column
                  divider instead of one bar at the left edge. That exact bug
                  has already shipped once — do not rediscover it. */}
              <Td muted center issue={l.hasIssue} bar={isOpen ? (l.hasIssue ? "#dc2626" : "#111827") : undefined}>
                {l.lineNo}
              </Td>
              <Td mono strong issue={l.hasIssue} skuIssue={l.hasIssue}>
                {l.skuCode}
              </Td>
              <Td issue={l.hasIssue}>
                <Description line={l} />
              </Td>
              <Td center issue={l.hasIssue}>{l.pack ?? "—"}</Td>
              <Td center strong issue={l.hasIssue}>{l.qtySti}</Td>
              {/* Red under the STI, blue over it, plain when it matched. Blue
                  rather than red for excess on purpose: more than expected is a
                  discrepancy to reconcile, not damage. */}
              <Td center strong issue={l.hasIssue} tone={physicalTone(l)}>
                {l.physicalQty ?? "—"}
              </Td>
              {/* ONE cell, showing the FIRST batch’s number. `+N` when the
                  supervisor split the line across manufacturing months — a
                  split line has more than one batch number, and the rest are in
                  the drawer, which is exactly why a split line is openable. The
                  report keeps its 6a/6b sub-rows and prints all of them. */}
              <Td center mono issue={l.hasIssue}>
                {l.batches[0] && receivedFrom
                  ? formatBatchNo(receivedFrom, l.batches[0].mfgMonth, l.batches[0].mfgYear)
                  : "—"}
                {extra > 0 && (
                  <span className="ml-[5px] rounded-[4px] bg-[#f0fdfa] px-[4px] py-px text-[10px] font-bold text-[#0f766e]">
                    +{extra}
                  </span>
                )}
              </Td>
              {/* No chevron, no pointer, no click on a clean single-batch line —
                  everything it has is already on the row, and a row that looks
                  clickable but opens an empty panel is worse than one that never
                  invited the click. */}
              <Td center issue={l.hasIssue}>
                {openable && (
                  <ChevronRight size={13} className="inline text-[#b6bcc6]" aria-hidden="true" />
                )}
              </Td>
            </tr>
          );
        })}

        {/* TOTAL row. Sums come from reportTotals() — the same function the XLS
            and the A4 sheet total with.

            🔴 IT TOTALS THE SELECTED DELIVERY, AND STILL NOT THE All/Issues
            FILTER. Those are two different kinds of narrowing and the
            distinction is the whole rule:
              • the DELIVERY TAB is the SUBJECT — billing is reading one paper
                sheet, and a total spanning deliveries it cannot see would be
                unusable. reportTotals() receives an already-scoped detail
                (scopeToDelivery), so this follows the tab automatically.
              • All/Issues is a VIEW of that subject. A total that moved when
                you hid the clean rows would be a different number wearing the
                same label — it stays put, exactly as before.

            ⚠ The XLS and the A4 sheet are NOT scoped: they are the TRUCK's
            record and list every delivery in one document. So this row and the
            report's TOTAL legitimately differ on a multi-delivery MRN. That is
            not drift — see lib/mrn/report.ts. */}
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
            <Td center strong>{formatCount(totals.physical)}</Td>
            <Td center muted>—</Td>
            <Td center />
          </tr>
        )}

        {lines.length === 0 && (
          <EmptyRow
            colSpan={DONE_COLUMNS.length}
            text={onlyIssues ? "No lines with issues." : "No lines on this MRN."}
          />
        )}
      </TableShell>
    </>
  );
}

/** Physical against the STI. Equal is the clean case and gets no colour at all. */
function physicalTone(l: MrnDetailLine): CellTone {
  if (l.physicalQty === null) return "plain";
  if (l.physicalQty < l.qtySti) return "bad";
  if (l.physicalQty > l.qtySti) return "excess";
  return "plain";
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/**
 * The card, the header strip, the horizontal scroll box, the colgroup and the
 * header row. Callers supply the column set and only <tr>s.
 *
 * `extraColumn` appends one narrow action column (the open state's row delete).
 * It is deliberately NOT part of any column set: those are the DATA shape, and
 * an action that exists in one state must not shift another state's widths.
 */
function TableShell({
  columns,
  title,
  right,
  tabs,
  extraColumn,
  children,
}: {
  columns: Column[];
  title: React.ReactNode;
  right?: React.ReactNode;
  /**
   * The delivery tab strip. When present it REPLACES the "Line items" heading —
   * owner ruling, 2026-09-01: the delivery number is what billing reads the
   * table by, and a heading saying "Line items" above it only repeats what the
   * table plainly is.
   *
   * Null only on an MRN with no lines at all, where the old heading still shows
   * because there is nothing to group.
   */
  tabs?: React.ReactNode;
  extraColumn?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  // The action column takes its width ON TOP of the 100%, so the data columns
  // keep their exact proportions whether or not it is there.
  const minWidth = TABLE_MIN_WIDTH + (extraColumn ? 40 : 0);

  return (
    <div className="overflow-hidden rounded-[10px] border border-[#e6e9ec] bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-[#f0f2f4] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {tabs ?? <span className="text-[12px] font-semibold text-gray-900">Line items</span>}
          {/* The counts stay muted and to the right of whichever leads — they
              describe the SELECTED delivery, because the whole detail handed to
              this table is scoped to it (scopeToDelivery). */}
          <span className="truncate text-[12px] font-normal text-gray-400">{title}</span>
        </div>
        {right}
      </div>

      {/* The overflow is owned HERE and nowhere else, so the table scrolls and
          the page never does. Five and eight columns fit a real pane without
          scrolling at all; the box is the floor's safety net, not its purpose. */}
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse"
          style={{ minWidth: `${minWidth}px` }}
        >
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: `${c.width}%` }} />
            ))}
            {extraColumn && <col style={{ width: "40px" }} />}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
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
 *  identically in all three states. Since 2026-08-26 this tag is the ONLY signal
 *  for an uncatalogued line; the row wash that used to accompany it is gone. */
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

type CellTone = "plain" | "bad" | "excess";

function Td({
  children,
  center,
  muted,
  strong,
  mono,
  tone = "plain",
  issue,
  skuIssue,
  bar,
}: {
  children?: React.ReactNode;
  center?: boolean;
  muted?: boolean;
  strong?: boolean;
  mono?: boolean;
  /** Value colour — red under, blue over. */
  tone?: CellTone;
  /** The row has an issue: softens the bottom border to match the red wash. */
  issue?: boolean;
  /** The SKU cell on an issue row goes dark red. */
  skuIssue?: boolean;
  /** Hex for the 3px selected bar. FIRST CELL ONLY — see DoneTable. */
  bar?: string;
}): React.JSX.Element {
  const colour = skuIssue
    ? "text-[#7f1d1d] font-semibold"
    : tone === "bad"
      ? "text-[#b42318] font-semibold"
      : tone === "excess"
        ? "text-[#0369a1] font-semibold"
        : muted
          ? "text-gray-400"
          : strong
            ? "text-gray-900 font-medium"
            : "text-[#4b5563]";
  return (
    <td
      className={
        "h-9 overflow-hidden text-ellipsis whitespace-nowrap border-b px-2 text-[11px] " +
        (issue ? "border-[#f7e4e2] " : "border-[#f0f0f0] ") +
        (center ? "text-center " : "") +
        (mono ? "font-mono " : "") +
        colour
      }
      style={bar ? { boxShadow: `inset 3px 0 0 ${bar}` } : undefined}
    >
      {children}
    </td>
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
