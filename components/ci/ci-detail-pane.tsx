"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CiDetail } from "@/lib/ci/types";

// Billing's right-hand pane — frames 1-3 of docs/mockups/ci/billing.html.
//
// EVERYTHING THE FLOOR ENTERED IS READ-ONLY HERE. The only write on this whole
// screen is Close CI.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THREE BANDS, AND ONLY THE MIDDLE ONE SCROLLS (2026-09-01, step 7d).
// ═══════════════════════════════════════════════════════════════════════════
//
//   shrink-0          header band — identity, the five facts, the reason
//   min-h-0 flex-1    the lines table, scrolling
//   shrink-0          the DOCKED BAR — CI date · CI number · Value · Close CI
//
// This pane used to be ONE `overflow-y-auto` column with the CI-details block
// last, so on a long return THE THREE FIELDS AND THE CLOSE BUTTON WERE BELOW
// THE FOLD. The operator's actual loop is: read the CI, walk to SAP, come back,
// type three fields — and he came back to a screen whose form he had to hunt
// for. The bar is now always visible whatever the table length; the TABLE gets
// shorter instead, which is the right thing to sacrifice because it is
// reference material and the form is the job.
//
// ⚠ OWNER RULING — THE FIELDS ARE A DOCKED BOTTOM BAR, NOT A HEADER BLOCK.
// Bottom, next to Close CI, is where his hand already is when he comes back
// from SAP, and it keeps the five-column facts grid intact — a header block
// would have squeezed those five facts to three. Do not move them up.
//
// ⚠ THE BAR HOLDS ITS GEOMETRY WHEN CLOSED. It swaps the three inputs for their
// read-only values and drops the button, but keeps the same height and the same
// three slots, so a close does not make the pane jump under the eye.

// ── Money ────────────────────────────────────────────────────────────────────
//
// 🔴 THE VALUE STAYS TEXT THROUGH THE ENTIRE CLIENT. It is money on a document
// someone signs, and binary floating point cannot hold 0.1 — parseFloat("57915.10")
// then re-serialising can and does produce 57915.099999999999. The string goes
// to the route verbatim, where a money regex validates its SHAPE and
// Prisma.Decimal carries it to a numeric(12,2) column.
//
// ⚠ NEVER `Number()`, never `parseFloat`, never `<input type="number">` — the
// last one hands back a coerced JS number and would undo this at the widget.
const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

export function CiDetailPane({
  detail,
  loading,
  onClosed,
  onFormActive,
}: {
  detail: CiDetail | null;
  loading: boolean;
  /** Fired after a successful close so the board refetches (fetch + setState —
   *  never router.refresh, CORE §3). */
  onClosed: () => void;
  /** Reported UP so the board can PAUSE polling while he is typing. A refetch
   *  mid-entry that reset these three fields would be maddening. */
  onFormActive: (active: boolean) => void;
}): React.JSX.Element {
  const [ciDate, setCiDate] = useState("");
  const [sapCiNumber, setSapCiNumber] = useState("");
  const [ciValue, setCiValue] = useState("");
  const [saving, setSaving] = useState(false);

  // A different CI means a different form. Without this, switching rail cards
  // would carry the previous CI's typed value onto the next one — and the
  // operator would close it with a number he never checked.
  useEffect(() => {
    setCiDate("");
    setSapCiNumber("");
    setCiValue("");
  }, [detail?.id]);

  const dirty = ciDate !== "" || sapCiNumber !== "" || ciValue !== "";
  useEffect(() => {
    onFormActive(dirty || saving);
  }, [dirty, saving, onFormActive]);

  const canClose =
    detail !== null &&
    detail.status === "submitted" &&
    ciDate !== "" &&
    sapCiNumber.trim() !== "" &&
    MONEY_RE.test(ciValue.trim()) &&
    !saving;

  const onClose = async (): Promise<void> => {
    if (detail === null || !canClose) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ci/${detail.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 🔴 ciValue goes as the STRING he typed. See the note at the top.
        body: JSON.stringify({ ciDate, sapCiNumber: sapCiNumber.trim(), ciValue: ciValue.trim() }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        alreadyClosed?: boolean;
      };
      if (!res.ok) {
        toast.error(j.error ?? "Could not close this CI.");
        return;
      }
      // ⚠ A DOUBLE-CLICK LANDS HERE TOO. The route answers a repeat close with
      // 200 + the CI as it stands (its guarded updateMany matched zero rows and
      // wrote nothing), so the pane simply refreshes into the closed state
      // rather than showing an error the operator cannot act on.
      toast.success(j.alreadyClosed ? "Already closed." : `${detail.ciNumber} closed.`);
      onClosed();
    } catch {
      toast.error("Could not close — check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && detail === null) {
    return <PaneMessage>Loading…</PaneMessage>;
  }
  if (detail === null) {
    return <PaneMessage>Pick a CI from the list.</PaneMessage>;
  }

  const isFull = detail.returnType === "full";
  const closed = detail.status === "closed";

  return (
    /* 🔴 `min-w-0` IS LOAD-BEARING — THIS ELEMENT IS THE GRID ITEM, and a grid
       item defaults to `min-width: auto` (its content-based minimum).
       billing-board.tsx's `minmax(0, 1fr)` is the other half; NEITHER WORKS
       ALONE, they are two separate floors.

       `bg-gray-50` is the WORKING GROUND, and the rail is the white surface —
       the two were the wrong way round until 2026-09-01. The white bands below
       are content sitting ON this ground. */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
      {/* ══ BAND 1 — shrink-0. Identity, the five facts, the reason. ══════════
          Never scrolls: this is WHO the return is for, and it has to stay
          readable while he works down the table. */}
      <div className="shrink-0 border-b border-gray-200 bg-white">
      {/* ── Identity ───────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold text-gray-900 truncate">
                {detail.customerName ?? "(Unmatched)"}
              </h2>
              {/* 🔴 FULL BILL IS SAID THREE TIMES — here, on the rail card, and
                  in the table header. Not redundancy: each one answers the
                  question at a different moment, and the whole-bill case is the
                  one where a wrong assumption costs most. */}
              <ReturnTypeTag full={isFull} />
            </div>
            {/* code · OBD · AREA. The area is read LIVE via customerId and is
                NOT a column — blank for an unmastered dealer, which is a normal
                state. No invented fallback: the parts that exist are joined and
                the rest is simply absent. */}
            <div className="text-[12px] text-gray-500 mt-1 truncate">
              {[detail.customerCode, `OBD ${detail.obdNumber}`, detail.area]
                .filter((p): p is string => Boolean(p))
                .join(" · ")}
            </div>
          </div>
          <div className="text-right shrink-0">
            {/* OrbitOMS's own reference — NOT SAP's. The two are separate columns
                and the CI-details block below collects the other one. */}
            <div className="font-mono text-[13px] font-bold text-gray-900">
              {detail.ciNumber ?? "—"}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Raised by {detail.supervisorName ?? "—"}
              {detail.submittedAt !== null && ` · ${formatIstDateTime(detail.submittedAt)}`}
            </div>
            {/* ══ THE AUTO LINE — auto CIs ONLY ═══════════════════════════════
                "Auto · Harish Padvi · Adajan" = raised automatically, checked by
                that supervisor, going out on that route. It tells billing in one
                line that the document was assembled by the system rather than
                stated by a person, and who to ask.

                ⚠ NOTHING CHANGES ON A MANUAL CI. The whole element is absent —
                no empty line, no reserved height — so a manual CI's header is
                byte-identical to what it was before this existed.

                🔴 A NULL ROUTE DROPS THE SEGMENT ENTIRELY. Never a dash, never a
                stranded separator: an unmastered dealer has no area and so no
                route, which is a normal state and not a missing value. The parts
                are joined, so the separator can only ever sit between two things
                that are actually there. */}
            {detail.source === "auto_finding" && (
              <div className="text-[11px] font-medium text-[#6b7480] mt-0.5">
                {["Auto", detail.supervisorName, detail.routeName]
                  .filter((p): p is string => Boolean(p))
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Header facts, IN BILL ORDER ─────────────────────────────────────
          invoice date → invoice no → received on → material → returned.
          Bill first, then the return, then the total. The sequence is the
          mockup's and is deliberate: he reads down it against the paper form. */}
      {/* ⚠ A LIGHT rule ABOVE, none below — mockup `.phFacts`. Band 1's own
          bottom border already closes the band; a second heavy line here would
          cut the identity off from the reason that explains it. */}
      <div className="px-5 py-3 border-t border-[#EFF2F3] grid grid-cols-5 gap-4">
        <Fact label="Invoice date" value={formatDay(detail.invoiceDate)} />
        <Fact label="Invoice no" value={detail.invoiceNo ?? "—"} />
        <Fact label="Received on" value={formatDay(detail.materialReceivedDate)} />
        <Fact label="Material" value={detail.materialMoved === "moved" ? "Moved" : "Not moved"} />
        {/* BOTH UNITS. Tins is what he counts, litres is what the form carries. */}
        <Fact
          label="Returned"
          value={`${detail.totalTins} tins · ${detail.totalLitres} L`}
          strong
        />
      </div>

      {/* ── Reason — the app's violet note band ───────────────────────────────
          Inside BAND 1 deliberately. The reason is why the goods came back at
          all; it belongs with the identity, not above a table it does not
          describe. */}
      <div className="px-5 pb-3.5">
        <div className="rounded-[10px] bg-[#f5f3ff] border border-[#ddd6fe] px-3.5 py-2.5 flex gap-2.5">
          <span className="text-[#7c3aed] text-[11px] leading-[1.5] shrink-0">◆</span>
          <p className="text-[12.5px] text-[#4c1d95] leading-[1.5] min-w-0">
            <span className="font-semibold">{detail.reasonLabel}</span>
            {detail.reasonRemark !== null && (
              <span className="text-[#6d28d9]"> — {detail.reasonRemark}</span>
            )}
          </p>
        </div>
      </div>

      </div>

      {/* ══ BAND 2 — min-h-0 flex-1. THE ONLY SCROLLING BAND. ════════════════
          `min-h-0` is what lets it actually shrink: a flex item's default
          `min-height: auto` would let the table's height push the docked bar
          off the bottom of the pane, which is the exact failure this
          restructure exists to prevent. */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      {/* ── Returned lines ─────────────────────────────────────────────────── */}
      <div className="px-5 py-3.5">
        <div className="flex items-baseline justify-between gap-3 pb-2">
          <div className="flex items-baseline gap-2.5">
            <h3 className="text-[13px] font-bold text-gray-900">Returned lines</h3>
            {/* 🔴 THE THIRD PLACE FULL BILL IS SAID. "WHOLE BILL · all N lines"
                against "3 of 12 on the bill" — the denominator is the BILL's
                live active line count, not a stored one. */}
            <span className="text-[11.5px] text-gray-500">
              {isFull ? (
                <>
                  <span className="font-semibold text-teal-700">WHOLE BILL</span> · all{" "}
                  {detail.lineCount} line{detail.lineCount === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  {detail.lineCount} of {detail.billLineCount} on the bill
                </>
              )}
            </span>
          </div>
          <span className="text-[12px] font-semibold tabular-nums text-gray-700">
            {detail.totalLitres} L
          </span>
        </div>

        {/* Fixed table standard — CLAUDE_UI.md §27: table-layout fixed, colgroup
            percentages, 32px header / 36px data rows, px-3.5 cells, truncating
            cells. FOUR COLUMNS: Pack · Material · Qty · Litres.
            🔴 THERE IS NO "SENT" COLUMN. Billing sees only what came back — the
            delivered quantity is the floor's context for deciding, not billing's
            for reconciling, and a second number here invites the wrong one being
            typed into SAP. */}
        {/* 🔴 `bg-white` IS NEW AND IS LOAD-BEARING. Band 2's ground went grey
            in this change, and the body rows carry no background of their own —
            without this the table read as grey rows with a white header and
            footer. Mockup `.tblWrap`: a white card on the ground.

            ⚠ NO STICKY `<thead>`, deliberately. It was tried and reverted: the
            `overflow-hidden` that gives this card its rounded corners makes the
            table its own scroll context, so sticky cells anchor to a box that
            never scrolls and simply stop working. Rounded corners and a sticky
            header cannot both live on this element — the mockup draws the
            corners, so the corners win. */}
        <table
          style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
          className="bg-white border border-gray-200 rounded-[8px] overflow-hidden"
        >
          <colgroup>
            <col style={{ width: "12%" }} />
            <col style={{ width: "58%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "16%" }} />
          </colgroup>
          <thead>
            <tr className="bg-[#f9fafb] border-b border-gray-200">
              <Th>Pack</Th>
              <Th>Material</Th>
              <Th align="right">Qty</Th>
              <Th align="right">Litres</Th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100" style={{ height: 36 }}>
                <Td>{l.packCode ?? "—"}</Td>
                <Td>
                  <span className="font-mono font-semibold text-gray-900">{l.skuCode}</span>
                  {/* An unmastered code is NORMAL (~5.9% of active lines) — the
                      bare code stands and the name is simply absent. */}
                  {l.skuDescription !== null && (
                    <span className="text-gray-500"> {l.skuDescription}</span>
                  )}
                </Td>
                <Td align="right" nums>
                  {l.returnedQty}
                </Td>
                {/* Null litres = genuinely unknown (unitQty was null or 0) and
                    renders blank. ZERO renders "0" — brushes and rollers have a
                    real volume of nothing, and blanking those would claim
                    "unknown" about a known thing. */}
                <Td align="right" nums>
                  {l.returnedQtyLitres === null ? "—" : l.returnedQtyLitres}
                </Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[#f9fafb] border-t-2 border-gray-300" style={{ height: 36 }}>
              <Td />
              <Td />
              <Td align="right" nums strong>
                {detail.totalTins} tins
              </Td>
              <Td align="right" nums strong>
                {detail.totalLitres} L
              </Td>
            </tr>
          </tfoot>
        </table>
      </div>

      </div>

      {/* ══ BAND 3 — shrink-0. THE DOCKED BAR, AND THE ONLY WRITE ON THIS ════
          ══ SCREEN. Always visible, whatever the table above it is doing. ═══

          Budget ~68px. Every piece of it is sized to that: a 9.5px label over a
          30px control, on py-2.5. If a fourth field is ever wanted here, the
          honest move is to make the bar taller and say so — NOT to shrink the
          controls until they stop being tappable.

          ⚠ The fields are in the order they come off the SAP screen — date →
          number → value — which is also the order he reads them back. */}
      <div className="shrink-0 border-t border-gray-200 bg-white px-5 py-2.5">
        <div className="flex items-end gap-3.5">
          {closed ? (
            <>
              <BarSlot label="CI date">
                <BarReadOnly>{formatDay(detail.ciDate)}</BarReadOnly>
              </BarSlot>
              <BarSlot label="CI number">
                <BarReadOnly mono>{detail.sapCiNumber ?? "—"}</BarReadOnly>
              </BarSlot>
              <BarSlot label="Value">
                {/* Straight back out as the STRING the route stored. Never
                    re-formatted through a JS number on the way to the eye. */}
                <BarReadOnly nums>₹ {detail.ciValue ?? "—"}</BarReadOnly>
              </BarSlot>
            </>
          ) : (
            <>
              <BarSlot label="CI date">
                {/* Native date control — a hand-rolled picker is a support
                    call, and this one is on a desk with a keyboard. */}
                <input
                  type="date"
                  value={ciDate}
                  onChange={(e) => setCiDate(e.target.value)}
                  aria-label="CI date"
                  className={BAR_INPUT}
                />
              </BarSlot>
              <BarSlot label="CI number">
                <input
                  type="text"
                  inputMode="numeric"
                  value={sapCiNumber}
                  onChange={(e) => setSapCiNumber(e.target.value)}
                  placeholder="85832091"
                  aria-label="SAP CI number"
                  className={BAR_INPUT + " font-mono placeholder:font-sans placeholder:text-gray-300"}
                />
              </BarSlot>
              <BarSlot label="Value">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[13px] text-gray-400">₹</span>
                  {/* 🔴 type="text", NOT type="number". A number input hands
                      back a coerced JS float and would undo the string
                      discipline at the widget. inputMode gets the numeric
                      keypad without it. */}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ciValue}
                    onChange={(e) => setCiValue(e.target.value)}
                    placeholder="0.00"
                    aria-label="Value in rupees"
                    className={BAR_INPUT + " tabular-nums placeholder:text-gray-300"}
                  />
                </div>
              </BarSlot>
            </>
          )}

          {/* The status tag sits IMMEDIATELY BEFORE the button, on purpose: when
              Close CI is grey this is the thing that says why, and it is the
              next place the eye goes. */}
          <div className="ml-auto flex shrink-0 items-center gap-3 pb-[5px]">
            <span
              className={
                "rounded-full px-2 py-[3px] text-[11px] font-semibold " +
                (closed
                  ? "bg-[#E7F6EE] text-[#0A7C4A]"
                  : canClose
                    ? "bg-[#E7F4F2] text-teal-700"
                    : "bg-[#f1f4f5] text-[#6b7480]")
              }
            >
              {closed ? "Closed" : canClose ? "Ready" : "Waiting"}
            </span>

            {/* ⚠ ABSENT once closed, not disabled — UI §10. A disabled control
                means "not yet"; there is no "yet" after a close. The slot does
                not collapse, because the tag beside it holds the corner. */}
            {!closed && (
              <button
                type="button"
                onClick={() => void onClose()}
                disabled={!canClose}
                className={
                  "h-[34px] shrink-0 rounded-[8px] px-5 text-[13px] font-bold transition-colors " +
                  (canClose
                    ? "bg-teal-600 text-white hover:bg-teal-700"
                    : "cursor-not-allowed bg-gray-100 text-gray-400")
                }
              >
                {saving ? "Closing…" : "Close CI"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function ReturnTypeTag({ full }: { full: boolean }): React.JSX.Element {
  return (
    <span
      className={
        "text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-[3px] rounded-full shrink-0 " +
        (full ? "bg-[#E7F4F2] text-teal-700" : "bg-[#f1f4f5] text-[#6b7480]")
      }
    >
      {full ? "Full bill" : "Part"}
    </span>
  );
}

function Fact({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#98a2b3]">
        {label}
      </div>
      <div
        className={
          "text-[12.5px] mt-1 truncate " +
          (strong ? "font-bold text-gray-900" : "font-medium text-gray-700")
        }
      >
        {value}
      </div>
    </div>
  );
}

// ── The docked bar's pieces ──────────────────────────────────────────────────
//
// 🔴 ONE HEIGHT, SHARED BY THE INPUT AND THE READ-ONLY VALUE (30px + the label).
// The bar must not change height when a CI closes, or the table above it
// reflows and the pane jumps under the operator's eye at the exact moment he is
// checking that the close landed.

const BAR_INPUT =
  "h-[30px] w-full min-w-0 rounded-[6px] border border-gray-200 px-2 text-[13px] " +
  "text-gray-900 outline-none focus:border-teal-600";

/** One field in the bar. `max-w` keeps three fields from stretching across a
 *  wide pane into inputs the size of a paragraph; `min-w-0` lets them shrink on
 *  a narrow one rather than pushing Close CI off the right edge. */
function BarSlot({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 max-w-[190px]">
      <div className="mb-1 truncate text-[9.5px] font-bold uppercase tracking-[0.09em] text-[#B7BFC5]">
        {label}
      </div>
      {children}
    </div>
  );
}

/** The closed-state twin of BAR_INPUT — same 30px box, no border, so the bar
 *  keeps its geometry. */
function BarReadOnly({
  children,
  mono = false,
  nums = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  nums?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={
        "flex h-[30px] min-w-0 items-center truncate text-[13px] font-semibold text-gray-900 " +
        (mono ? "font-mono " : "") +
        (nums ? "tabular-nums" : "")
      }
    >
      {children}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}): React.JSX.Element {
  return (
    <th
      className="px-3.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-[#98a2b3]"
      style={{ height: 32, textAlign: align }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  nums = false,
  strong = false,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  nums?: boolean;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <td
      className={
        "px-3.5 text-[12.5px] " +
        (nums ? "tabular-nums " : "") +
        (strong ? "font-bold text-gray-900 " : "text-gray-700 ")
      }
      style={{
        textAlign: align,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </td>
  );
}

/** 🔴 `min-w-0` HERE TOO, not just on the real pane below. Each of these IS the
 *  grid item in billing-board's `344px minmax(0, 1fr)` track when it renders,
 *  and a grid item defaults to `min-width: auto`. They hold short strings today
 *  so neither can blow the track out — but the day one gains a long error or a
 *  wide illustration it would, and the failure mode is silent (MRN's c16e59df:
 *  the pane lays out wider than the track and is clipped, so nothing looks
 *  broken, things are just missing). */
function PaneMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-gray-50">
      <p className="text-[13px] text-gray-400">{children}</p>
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

/** "today 12:20" / "22 Aug 12:20", IST. */
function formatIstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
  if (day === today) return `today ${time}`;
  return `${d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} ${time}`;
}
