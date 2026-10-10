import type { CSSProperties } from "react";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { ORBIT_SHEET_LOGO_DATA_URI } from "@/lib/trip-sheet/logo-data-uri";
import type { TripSheet, TripSheetBill } from "@/lib/trip-sheet/types";

// ─────────────────────────────────────────────────────────────────────────────
// OrbitTripSheetDocument — the A4 ORBIT trip sheet (2026-10-09). PURE and
// prop-driven from a TripSheet (lib/trip-sheet/types.ts) — no fetching — so the
// print route and, later, the WhatsApp image capture render the same pixels.
//
// The approved look is panel 1 of docs/mockups/trip-sheet/trip-sheet-mockup.html
// (renderSheet). The visual language copies the retired NTS sheet and the
// Delivery Challan (one #d1d5db frame, sections joined by borders, #111827 heavy
// rules, #374151 address band, #e5e7eb row rules). Content rules: spec
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §3.
//
// 🔴 NO import from components/trip-report/* or lib/trip-report/* — that NTS code
// is due for archive and this sheet must outlive it.
// 🔴 The billed dealer's name never appears on this sheet (owner, 2026-10-09).
// 🔴 The logo is a data URI WITH an explicit 141×34 — both are required for the
//    html-to-image capture on mobile WebKit (CLAUDE_TRIP_REPORT.md §6).
// Print isolation: app/globals.css `#orbit-trip-sheet-print-area` + `@page
// orbit-trip-sheet`; set `printAreaId` only on the print route.
// ─────────────────────────────────────────────────────────────────────────────

export interface OrbitTripSheetDocumentProps {
  sheet: TripSheet;
  /** The print route passes "orbit-trip-sheet-print-area"; a hidden capture copy omits it. */
  printAreaId?: string;
  /**
   * The WhatsApp image (2026-10-10): NO blank filler rows — the table ends after
   * the last bill and the totals row sits directly under it. Everything else is
   * identical. The print route leaves this false (full A4 with filler rows).
   */
  compact?: boolean;
}

/** Rows are padded with blank ledger lines to this many — sized like the NTS sheet so header + table + bottom band ≈ one A4 page. */
const MIN_ROWS = 20;

const BORDER_LIGHT = "#d1d5db";
const BORDER_HEAVY = "#111827";
const BORDER_MED = "#374151";
const BORDER_ROW = "#e5e7eb";
const BLANK_BORDER = "#f0f0f0";
const MUTED = "#9ca3af";
const UP: CSSProperties = { textTransform: "uppercase" };
const MONO = "'SF Mono', ui-monospace, monospace";

function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatSheetDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00+05:30").toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

const thStyle: CSSProperties = {
  height: 28,
  padding: "0 8px",
  fontSize: 9,
  fontWeight: 600,
  color: "#111827",
  letterSpacing: 0.4,
  textAlign: "left",
  borderTop: `2px solid ${BORDER_HEAVY}`,
  borderBottom: `1px solid ${BORDER_MED}`,
  background: "#f9fafb",
  whiteSpace: "nowrap",
  overflow: "hidden",
  ...UP,
};
const thRight: CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 10.5,
  borderBottom: `1px solid ${BORDER_ROW}`,
  verticalAlign: "middle",
  overflow: "hidden",
};

const tfStyle: CSSProperties = {
  height: 32,
  padding: "0 8px",
  borderTop: `2px solid ${BORDER_HEAVY}`,
  textAlign: "right",
  fontWeight: 700,
  fontSize: 11.5,
  color: "#111827",
  fontVariantNumeric: "tabular-nums",
};

const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

function MetaCell({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <div style={{ flex: 1, padding: "10px 14px", borderRight: last ? undefined : `1px solid ${BORDER_LIGHT}` }}>
      <div style={{ fontSize: 8, fontWeight: 600, color: "#4b5563", letterSpacing: 0.3, ...UP }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#111827", marginTop: 2, fontFamily: mono ? MONO : undefined }}>
        {value}
      </div>
    </div>
  );
}

function Tag({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        marginLeft: 5,
        padding: "0 4px",
        border: `1px solid ${colour}`,
        borderRadius: 3,
        fontSize: 7.5,
        fontWeight: 700,
        lineHeight: "11px",
        color: colour,
        letterSpacing: 0.3,
        verticalAlign: 1,
        fontFamily: "inherit",
        ...UP,
      }}
    >
      {label}
    </span>
  );
}

function TransportLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span style={{ color: "#94a3b8", fontSize: 8, letterSpacing: "0.06em", ...UP }}>{label} </span>
      <span style={{ fontWeight: 600, fontFamily: mono ? MONO : undefined }}>{value}</span>
    </div>
  );
}

function SignCell({ title, hint, last }: { title: string; hint: string; last?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        padding: last ? "10px 24px 10px 14px" : "10px 14px",
        borderRight: last ? undefined : `1px solid ${BORDER_LIGHT}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", alignSelf: "flex-start", ...UP }}>{title}</div>
      <div style={{ flex: 1, minHeight: 40 }} />
      <div style={{ width: 140, borderBottom: "1px dotted #9ca3af" }} />
      <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 3 }}>{hint}</div>
    </div>
  );
}

function BillRow({ bill, stopNo, stopName, area, first }: {
  bill: TripSheetBill;
  stopNo: number;
  stopName: string;
  area: string | null;
  first: boolean;
}) {
  // A heavier rule above the first row of every stop after the first.
  const stopRule: CSSProperties = first && stopNo > 1 ? { borderTop: `1px solid ${BORDER_LIGHT}` } : {};
  const qtyColour = bill.gift ? MUTED : "#111827";
  return (
    <tr>
      <td style={{ ...tdStyle, ...stopRule, paddingLeft: 24, textAlign: "center", color: "#111827", fontWeight: 700 }}>
        {first ? stopNo : ""}
      </td>
      <td style={{ ...tdStyle, ...stopRule }}>
        <div style={{ fontWeight: 600, color: "#111827", ...ellipsis }}>{smartTitleCase(stopName) || "—"}</div>
      </td>
      <td style={{ ...tdStyle, ...stopRule, color: "#475569", ...ellipsis }}>{smartTitleCase(area) || "—"}</td>
      <td style={{ ...tdStyle, ...stopRule }}>
        <div style={{ fontFamily: MONO, color: "#374151", whiteSpace: "nowrap" }}>
          {bill.number}
          {bill.gift && <Tag label="Gift" colour="#6b7280" />}
          {bill.redel && <Tag label="Re-del" colour="#B45309" />}
        </div>
      </td>
      <td style={{ ...tdStyle, ...stopRule, textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
        {fmt(bill.articles)}
      </td>
      <td style={{ ...tdStyle, ...stopRule, textAlign: "right", color: qtyColour, fontVariantNumeric: "tabular-nums" }}>
        {fmt(bill.litres)}
      </td>
      <td style={{ ...tdStyle, ...stopRule, paddingRight: 24, textAlign: "right", color: qtyColour, fontVariantNumeric: "tabular-nums" }}>
        {fmt(bill.kg)}
      </td>
    </tr>
  );
}

export function OrbitTripSheetDocument({ sheet, printAreaId, compact = false }: OrbitTripSheetDocumentProps) {
  const { header: h, stops, totals } = sheet;
  const driver = smartTitleCase(h.driverName) || "—";
  const rowCount = totals.bills;

  return (
    <div id={printAreaId} style={{ width: "210mm", margin: "0 auto" }}>
      <div
        className="orbit-trip-sheet-inner"
        style={{
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          border: `1px solid ${BORDER_LIGHT}`,
          boxSizing: "border-box",
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
          color: "#111827",
        }}
      >
        {/* ── HEADER — logo | TRIP SHEET | trip no + date · time ── */}
        <div style={{ display: "flex", alignItems: "center", padding: "18px 24px", borderBottom: `2px solid ${BORDER_HEAVY}` }}>
          <div style={{ flexShrink: 0 }}>
            <img
              src={ORBIT_SHEET_LOGO_DATA_URI}
              alt="JSW Dulux"
              // Data URI AND explicit 141×34, both required (header comment).
              // eager + sync decode: the share capture clones this node right
              // after mount, so the bitmap must never be deferred.
              width={141}
              height={34}
              loading="eager"
              decoding="sync"
              style={{ height: 34, width: 141, display: "block" }}
            />
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "0 16px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "0.34em" }}>TRIP SHEET</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right", minWidth: 140 }}>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO }}>{h.tripNumber}</div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>
              {formatSheetDate(h.tripDate)} &middot; {h.timeLabel ?? "—"}
            </div>
          </div>
        </div>

        {/* ── ADDRESS BAND — hardcoded like the NTS sheet (CLAUDE_TRIP_REPORT §7 drift note applies here too) ── */}
        <div
          style={{
            background: BORDER_MED,
            color: BORDER_LIGHT,
            padding: "5px 24px",
            fontSize: 10,
            letterSpacing: 0.2,
            textAlign: "center",
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          } as CSSProperties}
        >
          Decorative Paints &middot; Shiv Logistics Park, Block No.244, Kosmada, Surat, Gujarat 395006
        </div>

        {/* ── META STRIP ── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER_LIGHT}` }}>
          <MetaCell label="Type" value={h.typeLabel} />
          <MetaCell label="Vehicle No" value={h.vehicleNo ?? "—"} mono />
          <MetaCell label="Driver" value={driver} />
          <MetaCell label="Driver Mobile" value={h.driverPhone ?? "—"} mono last />
        </div>

        {/* ── DELIVERIES ── */}
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: 10 }}>
          <div style={{ padding: "14px 24px 6px", fontSize: 9, fontWeight: 600, color: "#4b5563", letterSpacing: 0.5, ...UP }}>
            Deliveries
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "7%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 24, textAlign: "center" }}>Stop</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Area</th>
                <th style={thStyle}>Invoice No</th>
                <th style={thRight}>Articles</th>
                <th style={thRight}>LT</th>
                <th style={{ ...thRight, paddingRight: 24 }}>KG</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s) =>
                s.bills.map((b, i) => (
                  <BillRow key={`${s.dropId}-${b.orderId}`} bill={b} stopNo={s.no} stopName={s.name} area={s.area} first={i === 0} />
                )),
              )}
              {Array.from({ length: compact ? 0 : Math.max(0, MIN_ROWS - rowCount) }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  {Array.from({ length: 7 }).map((__, c) => (
                    <td key={c} style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  style={{ ...tfStyle, paddingLeft: 24, fontSize: 9, fontWeight: 600, color: "#4b5563", letterSpacing: 0.4, ...UP }}
                >
                  Total &middot; {totals.stops} {totals.stops === 1 ? "stop" : "stops"} &middot; {totals.bills}{" "}
                  {totals.bills === 1 ? "bill" : "bills"}
                </td>
                <td style={{ ...tfStyle, color: "#475569" }}>{fmt(totals.articles)}</td>
                <td style={tfStyle}>{fmt(totals.litres)}</td>
                <td style={{ ...tfStyle, paddingRight: 24 }}>
                  {fmt(totals.kg)}
                  {totals.kgUnknownCount > 0 ? "+" : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── BOTTOM BAND + FOOTER — normal flow, never split (globals.css) ── */}
        <div className="orbit-trip-sheet-bottom" style={{ background: "#fff" }}>
          <div style={{ display: "flex", borderTop: `1px solid ${BORDER_LIGHT}` }}>
            <div style={{ flex: 1.4, padding: "10px 14px 10px 24px", borderRight: `1px solid ${BORDER_LIGHT}`, background: "#f9fafb" }}>
              <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", ...UP }}>Transport Details</div>
              <div style={{ marginTop: 7, fontSize: 10, lineHeight: 1.6 }}>
                <TransportLine label="Transporter" value={h.transporterName ?? "—"} />
                <TransportLine label="Vehicle" value={h.vehicleNo ?? "—"} mono />
                <TransportLine label="Driver" value={h.driverPhone ? `${driver} (${h.driverPhone})` : driver} />
              </div>
            </div>
            <SignCell title="Dispatched By" hint="Name, Designation & Signature" />
            <SignCell title="Received By" hint="Signature & Date" last />
          </div>
          <div
            className="orbit-trip-sheet-footer"
            style={{ padding: "6px 24px", borderTop: `1px solid ${BORDER_LIGHT}`, textAlign: "center", fontSize: 8.5, color: "#64748b" }}
          >
            Generated by Orbit &middot; dispatch record, not a tax invoice
          </div>
        </div>
      </div>
    </div>
  );
}
