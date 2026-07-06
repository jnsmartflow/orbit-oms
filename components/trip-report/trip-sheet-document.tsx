import { smartTitleCase } from "@/lib/mail-orders/utils";
import { resolveDeliveryArea, resolveCustomerLabel } from "@/lib/trip-report/display";
import { JSW_DULUX_LOGO_DATA_URI } from "@/lib/trip-report/logo-data-uri";

// ─────────────────────────────────────────────────────────────────────────────
// TripSheetDocument — pure presentational component, NO data fetching.
// Renders the ENTIRE A4 trip sheet (logo, dark bar, meta strip, enclosed
// deliveries table with blank-row fill, totals, ack band, footer) from plain
// props. Used by TWO callers:
//   1. app/trips/[tripNo]/sheet/page.tsx — the print route (Prisma fetch,
//      passes printAreaId="trip-sheet-print-area" so globals.css's
//      #trip-sheet-print-area print-isolation/@page rules apply).
//   2. lib/trip-report/share-sheet-image.ts — mounts this into a hidden
//      SAME-DOCUMENT container (no printAreaId, so it can never be
//      accidentally revealed by a stray browser print) and captures it with
//      html-to-image for the "Share WhatsApp" image. Data comes from the
//      TripDetail already held in TripDetailsView's state — no extra fetch.
//
// Moved verbatim from the print route — pixel-identical output, not restyled.
// Border language copied from components/tint/challan-document.tsx: ONE outer
// `border:1px solid #d1d5db` frame around a flex column; every section is a
// full-width child connected via borderBottom/borderTop (never a margin gap);
// cells within a row separate via borderRight (never a gap). Heavy rules
// (#111827, 2px) mark the header bottom + table top/totals; #374151 is the
// address-bar fill + table header bottom rule; #e5e7eb is the table row rule.
// ─────────────────────────────────────────────────────────────────────────────

export interface TripSheetHeader {
  deliveryType: string | null;
  disTime: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  driverMobile: string | null;
}

export interface TripSheetDrop {
  deliveryNo: string | null;
  custName: string | null;
  siteName: string | null;
  siteArea: string | null;
  otherDelAreaName: string | null;
  custAreaName: string | null;
  noArticle: string | null;
  disQty: string | null;
  netWeight: string | null;
}

export interface TripSheetDocumentProps {
  tripNo: string;
  date: string; // YYYY-MM-DD
  header: TripSheetHeader;
  drops: TripSheetDrop[];
  dropCount: number;
  /** articles counts ALL rows; qty (LT) + weight (KG) are INV-only totals. */
  totals: { articles: number; qty: number; weight: number };
  /** Set ONLY by the print route — enables globals.css's print isolation
      (#trip-sheet-print-area). The hidden capture instance omits this. */
  printAreaId?: string;
}

function toNum(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function fmtNum(n: number): string {
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

// ── Shared style constants — copied verbatim from challan-document.tsx ─────

const UP: React.CSSProperties = { textTransform: "uppercase" };
const BORDER_LIGHT = "#d1d5db";
const BORDER_HEAVY = "#111827";
const BORDER_MED = "#374151";
const BORDER_ROW = "#e5e7eb";

function MetaCell({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div style={{ flex: 1, padding: "10px 14px", borderRight: last ? undefined : `1px solid ${BORDER_LIGHT}` }}>
      <div style={{ fontSize: 8, fontWeight: 600, color: "#4b5563", letterSpacing: 0.3, ...UP }}>{label}</div>
      <div
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          color: "#111827",
          marginTop: 2,
          fontFamily: mono ? "'SF Mono', ui-monospace, monospace" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
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
  textOverflow: "ellipsis",
  ...UP,
};
const thRight: React.CSSProperties = { ...thStyle, textAlign: "right" };

const tdStyle: React.CSSProperties = {
  height: 30,
  padding: "0 8px",
  fontSize: 10.5,
  borderBottom: `1px solid ${BORDER_ROW}`,
  verticalAlign: "middle",
};

// Blank-row padding — copied from challan-document.tsx's
// `Math.max(0, 8 - lineItems.length)` pattern (same faint/empty look, same
// challan-style border colour one shade fainter than real rows).
//
// The footer is in NORMAL FLOW (.trip-sheet-bottom, see globals.css),
// directly after the table, exactly like the challan's S7 footer. Its
// "no gap, near page bottom" look comes from row count, not a height/
// position trick: MIN_ROWS is tuned so header + dark bar + meta strip +
// "Deliveries" label + table header + MIN_ROWS rows + totals row + ack
// band + footer together land close to one printable page.
//
// @page trip-sheet uses an even 10mm margin on all sides (matching the
// challan), so the printable area is 277mm ≈ 1047px @ 96dpi.
//
// Fixed (non-row) sections at their actual coded sizes: header ~73px, dark
// address bar ~23px, meta strip ~49px, "Deliveries" label ~32px, gap after
// the table ~10px, table thead (explicit height:28) 28px, tfoot totals row
// (explicit height:32) 32px, ack band (tallest column: label + 3 lines at
// the coded lineHeight:1.6×10px + padding + border) ~88px, footer ~25px
// — total ~360px (~95mm). Remaining for rows: 277-95=182mm ≈688px at
// tdStyle's height:30 → ~22.9 rows raw capacity, rounded down to 22.
// Subtracting a 2-row safety buffer: 22 - 2 = 20.
const MIN_ROWS = 20;
const BLANK_BORDER = "#f0f0f0"; // fainter than BORDER_ROW — matches the challan's blank-row rule colour

export function TripSheetDocument({ tripNo, date, header, drops, dropCount, totals, printAreaId }: TripSheetDocumentProps) {
  return (
    <div id={printAreaId} style={{ width: "210mm", margin: "0 auto" }}>
      <div
        className="trip-sheet-inner"
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
        {/* ── HEADER — logo | centered title | trip no + date ─────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "18px 24px",
            borderBottom: `2px solid ${BORDER_HEAVY}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flexShrink: 0 }}>
            <img
              src={JSW_DULUX_LOGO_DATA_URI}
              alt="JSW Dulux"
              style={{ height: 34, width: "auto", display: "block" }}
            />
          </div>
          <div style={{ flex: 1, textAlign: "center", padding: "0 16px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#111827", letterSpacing: "0.34em" }}>
              TRIP SHEET
            </div>
          </div>
          <div style={{ flexShrink: 0, textAlign: "right", minWidth: 140 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "'SF Mono', ui-monospace, monospace" }}>
              {tripNo}
            </div>
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>
              {formatSheetDate(date)} &middot; {header.disTime ?? "—"}
            </div>
          </div>
        </div>

        {/* ── DARK ADDRESS BAR ─────────────────────────────────────────────── */}
        <div
          style={{
            background: BORDER_MED,
            color: BORDER_LIGHT,
            padding: "5px 24px",
            fontSize: 10,
            letterSpacing: 0.2,
            textAlign: "center",
            flexShrink: 0,
            WebkitPrintColorAdjust: "exact",
            printColorAdjust: "exact",
          } as React.CSSProperties}
        >
          {/* Matches the Delivery Challan dark address band (challan-document.tsx
              S2, sourced from system_config companySubtitle + depotAddress). */}
          Decorative Paints &middot; Shiv Logistics Park, Block No.244, Kosmada, Surat, Gujarat
          395006
        </div>

        {/* ── META STRIP — Type · Vehicle · Driver · Mobile ────────────────── */}
        <div style={{ display: "flex", borderBottom: `1px solid ${BORDER_LIGHT}`, flexShrink: 0 }}>
          <MetaCell label="Type" value={header.deliveryType ?? "—"} />
          <MetaCell label="Vehicle No" value={header.vehicleNo ?? "—"} mono />
          <MetaCell label="Driver" value={smartTitleCase(header.driverName) || "—"} />
          <MetaCell label="Driver Mobile" value={header.driverMobile ?? "—"} mono last />
        </div>

        {/* ── DELIVERIES ───────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", paddingBottom: 10 }}>
          <div style={{ padding: "14px 24px 6px", fontSize: 9, fontWeight: 600, color: "#4b5563", letterSpacing: 0.5, ...UP }}>
            Deliveries
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "29%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ ...thStyle, paddingLeft: 24, textAlign: "center" }}>#</th>
                <th style={thStyle}>Delivery No</th>
                <th style={thStyle}>Customer</th>
                <th style={thStyle}>Delivery Area</th>
                <th style={thRight}>Articles</th>
                <th style={thRight}>LT</th>
                <th style={{ ...thRight, paddingRight: 24 }}>KG</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((r, i) => (
                <tr key={r.deliveryNo ?? i}>
                  <td style={{ ...tdStyle, paddingLeft: 24, textAlign: "center", color: "#94a3b8" }}>{i + 1}</td>
                  <td style={{ ...tdStyle, color: "#374151", fontFamily: "'SF Mono', ui-monospace, monospace" }}>
                    {r.deliveryNo ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: "#111827", fontWeight: 600 }}>
                    {resolveCustomerLabel(r.siteName, r.custName)}
                  </td>
                  <td style={{ ...tdStyle, color: "#475569" }}>
                    {smartTitleCase(resolveDeliveryArea(r)) || "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#475569", fontVariantNumeric: "tabular-nums" }}>
                    {fmtNum(toNum(r.noArticle))}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#111827", fontVariantNumeric: "tabular-nums" }}>
                    {fmtNum(toNum(r.disQty))}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      paddingRight: 24,
                      textAlign: "right",
                      color: "#111827",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtNum(toNum(r.netWeight))}
                  </td>
                </tr>
              ))}

              {/* Blank filler rows — same technique + column structure as the
                  challan's blank rows, faint/empty so they read as intentional
                  ledger lines rather than a bug. */}
              {Array.from({ length: Math.max(0, MIN_ROWS - drops.length) }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  <td
                    style={{
                      ...tdStyle,
                      paddingLeft: 24,
                      textAlign: "center",
                      color: BORDER_ROW,
                      borderBottom: `1px solid ${BLANK_BORDER}`,
                    }}
                  >
                    {drops.length + i + 1}
                  </td>
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                  <td style={{ height: 30, borderBottom: `1px solid ${BLANK_BORDER}` }} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={4}
                  style={{
                    height: 32,
                    padding: "0 8px 0 24px",
                    borderTop: `2px solid ${BORDER_HEAVY}`,
                    textAlign: "right",
                    fontSize: 9,
                    fontWeight: 600,
                    color: "#4b5563",
                    letterSpacing: 0.4,
                    ...UP,
                  }}
                >
                  Total &middot; {dropCount} {dropCount === 1 ? "drop" : "drops"}
                </td>
                <td
                  style={{
                    height: 32,
                    padding: "0 8px",
                    borderTop: `2px solid ${BORDER_HEAVY}`,
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 11.5,
                    color: "#475569",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtNum(totals.articles)}
                </td>
                <td
                  style={{
                    height: 32,
                    padding: "0 8px",
                    borderTop: `2px solid ${BORDER_HEAVY}`,
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 11.5,
                    color: "#111827",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtNum(totals.qty)}
                </td>
                <td
                  style={{
                    height: 32,
                    padding: "0 24px 0 8px",
                    borderTop: `2px solid ${BORDER_HEAVY}`,
                    textAlign: "right",
                    fontWeight: 700,
                    fontSize: 11.5,
                    color: "#111827",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtNum(totals.weight)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── BOTTOM BLOCK — ack band + footer, normal flow (screen AND print) ──
            .trip-sheet-bottom sits directly after the deliveries table, same
            as the challan's S7 footer after its line-items table. MIN_ROWS
            (above) pads the table so total content ≈ one page, landing this
            block connected to the table with no gap, near the page bottom. */}
        <div className="trip-sheet-bottom" style={{ background: "#fff" }}>
        {/* ── ACK BAND — Transport Details | Dispatched By | Received By ──── */}
        <div
          className="trip-sheet-ack-band"
          style={{ display: "flex", borderTop: `1px solid ${BORDER_LIGHT}`, flexShrink: 0 }}
        >
          {/* Col 1 — Transport Details (info only, no signature) */}
          <div
            style={{
              flex: 1.4,
              padding: "10px 14px 10px 24px",
              borderRight: `1px solid ${BORDER_LIGHT}`,
              background: "#f9fafb",
            }}
          >
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#111827", letterSpacing: "0.08em", ...UP }}>
              Transport Details
            </div>
            <div style={{ marginTop: 7, fontSize: 10, color: "#111827", lineHeight: 1.6 }}>
              <div>
                <span style={{ color: "#94a3b8", fontSize: 8, letterSpacing: "0.06em", ...UP }}>Transporter </span>
                <span style={{ fontWeight: 600 }}>Nagadhiraj Transport Service</span>
              </div>
              <div>
                <span style={{ color: "#94a3b8", fontSize: 8, letterSpacing: "0.06em", ...UP }}>Vehicle </span>
                <span style={{ fontWeight: 600, fontFamily: "'SF Mono', ui-monospace, monospace" }}>
                  {header.vehicleNo ?? "—"}
                </span>
              </div>
              <div>
                <span style={{ color: "#94a3b8", fontSize: 8, letterSpacing: "0.06em", ...UP }}>Driver </span>
                <span style={{ fontWeight: 600 }}>
                  {smartTitleCase(header.driverName) || "—"}
                  {header.driverMobile ? ` (${header.driverMobile})` : ""}
                </span>
              </div>
            </div>
          </div>

          {/* Col 2 — Dispatched By */}
          <div
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRight: `1px solid ${BORDER_LIGHT}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#111827", letterSpacing: "0.08em", ...UP, alignSelf: "flex-start" }}>
              Dispatched By
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 140, borderBottom: "1px dotted #9ca3af" }} />
            <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 3 }}>Name, Designation &amp; Signature</div>
          </div>

          {/* Col 3 — Received By */}
          <div
            style={{
              flex: 1,
              padding: "10px 24px 10px 14px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#111827", letterSpacing: "0.08em", ...UP, alignSelf: "flex-start" }}>
              Received By
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 140, borderBottom: "1px dotted #9ca3af" }} />
            <div style={{ fontSize: 8, color: "#94a3b8", marginTop: 3 }}>Signature &amp; Date</div>
          </div>
        </div>

        {/* ── FOOTER ───────────────────────────────────────────────────────── */}
        <div
          className="trip-sheet-footer"
          style={{ padding: "6px 24px", borderTop: `1px solid ${BORDER_LIGHT}`, textAlign: "center", flexShrink: 0 }}
        >
          <div style={{ fontSize: 8.5, color: "#64748b" }}>
            Generated by OrbitOMS &middot; JSW Dulux Surat Depot &middot; This is a dispatch record, not a
            tax invoice.
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
