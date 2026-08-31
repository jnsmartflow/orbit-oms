"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CiDetail } from "@/lib/ci/types";

// Billing's right-hand pane — frames 1-3 of docs/mockups/ci/billing.html.
//
// EVERYTHING THE FLOOR ENTERED IS READ-ONLY HERE. The only write on this whole
// screen is Close CI.

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
    <div className="flex-1 min-w-0 overflow-y-auto">
      {/* ── Identity ───────────────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-200">
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
          </div>
        </div>
      </div>

      {/* ── Header facts, IN BILL ORDER ─────────────────────────────────────
          invoice date → invoice no → received on → material → returned.
          Bill first, then the return, then the total. The sequence is the
          mockup's and is deliberate: he reads down it against the paper form. */}
      <div className="px-5 py-3 border-b border-gray-200 grid grid-cols-5 gap-4">
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

      {/* ── Reason — the app's violet note band ─────────────────────────────── */}
      <div className="px-5 py-3">
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

      {/* ── Returned lines ─────────────────────────────────────────────────── */}
      <div className="px-5 pb-3">
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
        <table
          style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
          className="border border-gray-200 rounded-[8px] overflow-hidden"
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

      {/* ── CI details — THE ONLY WRITE ON THIS SCREEN ──────────────────────── */}
      <div className="px-5 pb-6">
        <div className="border border-gray-200 rounded-[10px] overflow-hidden">
          <div className="bg-[#f9fafb] px-3.5 py-2.5 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-gray-900">CI details</h3>
            <span
              className={
                "text-[11px] font-semibold px-2 py-[3px] rounded-full " +
                (closed
                  ? "bg-[#E7F6EE] text-[#0A7C4A]"
                  : canClose
                    ? "bg-[#E7F4F2] text-teal-700"
                    : "bg-[#f1f4f5] text-[#6b7480]")
              }
            >
              {closed ? "Closed" : canClose ? "Ready" : "Waiting"}
            </span>
          </div>

          {/* Fields in the order they come off the SAP screen: date → number →
              value. Matches the header facts' bill-first sequencing. */}
          <div className="px-3.5 py-3 grid grid-cols-3 gap-3.5">
            <Field label="CI date">
              {closed ? (
                <ReadOnly>{formatDay(detail.ciDate)}</ReadOnly>
              ) : (
                // Native date control — a hand-rolled picker is a support call.
                <input
                  type="date"
                  value={ciDate}
                  onChange={(e) => setCiDate(e.target.value)}
                  aria-label="CI date"
                  className="w-full text-[13px] text-gray-900 border border-gray-200 rounded-[6px] px-2 py-1.5 outline-none focus:border-teal-600"
                />
              )}
            </Field>
            <Field label="CI number">
              {closed ? (
                <ReadOnly>{detail.sapCiNumber ?? "—"}</ReadOnly>
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  value={sapCiNumber}
                  onChange={(e) => setSapCiNumber(e.target.value)}
                  placeholder="85832091"
                  aria-label="SAP CI number"
                  className="w-full text-[13px] text-gray-900 border border-gray-200 rounded-[6px] px-2 py-1.5 outline-none focus:border-teal-600 placeholder:text-gray-300"
                />
              )}
            </Field>
            <Field label="Value">
              {closed ? (
                <ReadOnly>₹ {detail.ciValue ?? "—"}</ReadOnly>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-gray-400 shrink-0">₹</span>
                  {/* 🔴 type="text", NOT type="number". A number input hands back
                      a coerced JS float and would undo the string discipline at
                      the widget. inputMode gets the numeric keypad without it. */}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={ciValue}
                    onChange={(e) => setCiValue(e.target.value)}
                    placeholder="0.00"
                    aria-label="Value in rupees"
                    className="w-full text-[13px] text-gray-900 border border-gray-200 rounded-[6px] px-2 py-1.5 outline-none focus:border-teal-600 placeholder:text-gray-300 tabular-nums"
                  />
                </div>
              )}
            </Field>
          </div>

          {!closed && (
            <div className="px-3.5 pb-3.5">
              <button
                type="button"
                onClick={() => void onClose()}
                disabled={!canClose}
                className={
                  "h-9 px-5 rounded-[8px] text-[13px] font-bold " +
                  (canClose
                    ? "bg-teal-600 hover:bg-teal-700 text-white"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed")
                }
              >
                {saving ? "Closing…" : "Close CI"}
              </button>
            </div>
          )}
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

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#98a2b3] mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function ReadOnly({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-[13px] font-medium text-gray-900 py-1.5">{children}</div>;
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

function PaneMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center">
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
