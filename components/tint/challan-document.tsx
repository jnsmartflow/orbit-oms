"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ChallanDocument — pure presentational component.
// Design reference: challan-mock-v5-final.html
// All print styles live in globals.css @media print.
//
// NOTE: Browser print headers/footers ("localhost:3000/challan", date, page
// number) are controlled by the browser, not CSS. To suppress them in
// Chrome/Edge: Print dialog → More settings → uncheck "Headers and footers".
// ─────────────────────────────────────────────────────────────────────────────

// ── Types matching GET /api/tint/manager/challans/[orderId] response ──────────

interface ChallanRow {
  id:            number;
  orderId:       number;
  challanNumber: string;
  transporter:   string | null;
  vehicleNo:     string | null;
  printedAt:     string | null;
  printedBy:     number | null;
  createdAt:     string;
  updatedAt:     string;
}

interface SystemConfig {
  companyName:      string;
  companySubtitle:  string;
  depotAddress:     string;
  depotMobile:      string;
  gstin:            string;
  tejasContact:     string;
  registeredOffice: string;
  website:          string;
}

interface ContactInfo {
  name:  string;
  phone: string | null;
}

interface BillTo {
  name:         string;
  address:      string | null;
  customerCode: string | null;
  contact:      ContactInfo | null;
}

interface ShipTo {
  name:         string;
  address:      string | null;
  shipToCode:   string | null;
  route:        string | null;
  area:         string | null;
  salesOfficer: ContactInfo | null;
  siteContact:  ContactInfo | null;
}

interface LineItem {
  id:                number;
  lineId:            number;
  skuCodeRaw:        string;
  skuDescriptionRaw: string | null;
  unitQty:           number;
  volumeLine:        number | null;
  isTinting:         boolean;
  articleTag:        string | null;
  formula:           string | null;
}

interface Totals {
  totalUnitQty: number;
  totalVolume:  number;
  totalWeight:  number;
}

interface OrderData {
  obdNumber:    string;
  smu:          string | null;
  smuNumber:    string | null;
  obdEmailDate: string | null;
  warehouse:    string | null;
  grossWeight:  number | null;
  billTo:       BillTo;
  shipTo:       ShipTo;
  lineItems:    LineItem[];
  totals:       Totals | null;
}

export interface ChallanApiResponse {
  challan:      ChallanRow;
  systemConfig: SystemConfig;
  order:        OrderData;
}

export interface ChallanDocumentProps {
  data:                ChallanApiResponse;
  isEditing:           boolean;
  transporterValue:    string;
  vehicleNoValue:      string;
  formulaValues:       Record<number, string>; // rawLineItemId → formula
  onFormulaChange:     (rawLineItemId: number, value: string) => void;
  onTransporterChange: (value: string) => void;
  onVehicleNoChange:   (value: string) => void;
}

// ── Shared style constant ──────────────────────────────────────────────────────

const UP: React.CSSProperties = { textTransform: "uppercase" };

// ── Address formatter ─────────────────────────────────────────────────────────

function formatAddress(address: string | null): string[] {
  if (!address) return [];
  return address
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChallanDocument({
  data,
  isEditing,
  transporterValue,
  vehicleNoValue,
  formulaValues,
  onFormulaChange,
  onTransporterChange,
  onVehicleNoChange,
}: ChallanDocumentProps) {
  const { challan, systemConfig, order } = data;
  const { billTo, shipTo, lineItems, totals } = order;

  // Blank rows: always show at least 8 data rows so footer is pushed down
  const blankRows = Math.max(0, 8 - lineItems.length);

  return (
    <>
      {/* Screen-only: hide print-only formula spans */}
      <style>{`.cp-formula-print { display: none; }`}</style>

      {/* ── Challan wrapper ─────────────────────────────────────────────────── */}
      <div
        id="challan-print-area"
        style={{
          fontFamily:             "'Inter', Arial, sans-serif",
          fontSize:               11,
          color:                  "#111",
          background:             "#fff",
          display:                "flex",
          flexDirection:          "column",
          minHeight:              "100vh",
          border:                 "1.5px solid #333",
          overflow:               "hidden",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust:       "exact",
        } as React.CSSProperties}
      >

        {/* ── S1 HEADER ────────────────────────────────────────────────────── */}
        <div
          className="ch-header"
          style={{ background: "#0d47a1", flexShrink: 0 }}
        >
          {/* Row 1 — logo · title · challan number */}
          <div style={{ display: "flex", alignItems: "center", padding: "14px 24px" }}>

            {/* Left — logo */}
            <div style={{
              flex:         "0 0 auto",
              paddingRight: "20px",
              borderRight:  "1px solid rgba(255,255,255,0.15)",
            }}>
              <img
                src="/akzonobel-logo.png"
                alt="AkzoNobel"
                style={{
                  height:    "64px",
                  width:     "auto",
                  display:   "block",
                  filter:    "brightness(0) invert(1)",
                }}
              />
            </div>

            {/* Center — title */}
            <div style={{ flex: 1, textAlign: "center", padding: "0 24px" }}>
              <div
                className="ch-hdr-title"
                style={{ fontSize: 16, fontWeight: 400, color: "rgba(255,255,255,0.85)", letterSpacing: "0.35em", ...UP, lineHeight: 1 }}
              >
                Delivery Challan
              </div>
              <div
                className="ch-hdr-copy"
                style={{ fontSize: 7, color: "rgba(255,255,255,0.35)", letterSpacing: "0.18em", ...UP, marginTop: 6 }}
              >
                Original Copy
              </div>
            </div>

            {/* Right — challan number */}
            <div style={{
              flex:          "0 0 auto",
              paddingLeft:   "20px",
              borderLeft:    "1px solid rgba(255,255,255,0.15)",
              textAlign:     "right",
              display:       "flex",
              flexDirection: "column",
              alignItems:    "flex-end",
              gap:           4,
            }}>
              <div
                className="ch-hdr-no-lbl"
                style={{ fontSize: 7.5, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", ...UP, fontWeight: 600 }}
              >
                Challan No.
              </div>
              <div
                className="ch-hdr-no-val"
                style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}
              >
                {challan.challanNumber}
              </div>
            </div>

          </div>

          {/* Row 2 — address strip */}
          <div
            className="ch-hdr-tagline"
            style={{
              background:    "rgba(0,0,0,0.2)",
              borderTop:     "1px solid rgba(255,255,255,0.1)",
              padding:       "5px 24px",
              textAlign:     "center",
              fontSize:      "8px",
              color:         "rgba(255,255,255,0.5)",
              letterSpacing: "0.02em",
            }}
          >
            {[systemConfig.companySubtitle, systemConfig.depotAddress].filter(Boolean).join("  ·  ")}
          </div>
        </div>

        {/* ── S2 REFERENCE STRIP — 3 equal columns ─────────────────────────── */}
        <div
          className="ch-ref"
          style={{
            background:          "#f5f5f5",
            borderBottom:        "2px solid #0d47a1",
            display:             "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            flexShrink:          0,
          }}
        >
          {/* SMU Number */}
          <div style={{ padding: "8px 20px", display: "flex", flexDirection: "column", gap: 3 }}>
            <div className="ch-ref-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#666", letterSpacing: "0.1em", ...UP }}>
              SMU Number
            </div>
            {order.smuNumber ? (
              <div className="ch-ref-val" style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
                {order.smuNumber}
              </div>
            ) : (
              <div className="ch-ref-val muted" style={{ fontSize: 11, color: "#999", fontStyle: "italic", fontWeight: 400 }}>
                — pending import update
              </div>
            )}
          </div>

          {/* OBD No. */}
          <div style={{ padding: "8px 20px", borderLeft: "1px solid #ccc", display: "flex", flexDirection: "column", gap: 3 }}>
            <div className="ch-ref-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#666", letterSpacing: "0.1em", ...UP }}>
              OBD No.
            </div>
            <div className="ch-ref-val" style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
              {order.obdNumber}
            </div>
          </div>

          {/* Warehouse */}
          <div style={{ padding: "8px 20px", borderLeft: "1px solid #ccc", display: "flex", flexDirection: "column", gap: 3 }}>
            <div className="ch-ref-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#666", letterSpacing: "0.1em", ...UP }}>
              Warehouse
            </div>
            <div className="ch-ref-val" style={{ fontSize: 12, fontWeight: 600, color: "#111" }}>
              {order.warehouse ?? ""}
            </div>
          </div>
        </div>

        {/* ── S3 PARTY SECTION ─────────────────────────────────────────────── */}
        <div
          className="ch-party"
          style={{
            display:             "grid",
            gridTemplateColumns: "1fr 1fr",
            flexShrink:          0,
            borderBottom:        "1px solid #dde3f0",
          }}
        >

          {/* BILL TO ─────────────────────────────────────────────────────── */}
          <div
            className="ch-party-box"
            style={{ background: "#f8faff", display: "flex", flexDirection: "column", minHeight: 180 }}
          >
            <div
              className="ch-party-hdr"
              style={{
                background:     "#eef1fb",
                borderBottom:   "1px solid #dde3f0",
                padding:        "5px 16px",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
              }}
            >
              <span className="ch-party-hdr-lbl" style={{ fontSize: 8, fontWeight: 800, color: "#0d9488", letterSpacing: "0.14em", ...UP }}>
                Bill To
              </span>
            </div>

            {/* Body — Code → Name → Address */}
            <div style={{ padding: "10px 16px 0", flex: 1, display: "flex", flexDirection: "column" }}>
              {/* 1. Customer Code */}
              <div className="ch-party-code-block" style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 8 }}>
                <div className="ch-code-lbl" style={{ fontSize: 7, fontWeight: 700, color: "#94a3b8", ...UP, letterSpacing: "0.08em" }}>
                  Customer Code
                </div>
                <div className="ch-code-val" style={{ fontSize: 11, fontWeight: 600, color: "#0d9488", fontFamily: "'Courier New', monospace" }}>
                  {billTo.customerCode ?? ""}
                </div>
              </div>
              {/* 2. Customer name */}
              <div className="ch-party-name" style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", lineHeight: 1.3, marginBottom: 4 }}>
                {billTo.name}
              </div>
              {/* 3. Address */}
              {formatAddress(billTo.address).length > 0 && (
                <div className="ch-party-addr" style={{ fontSize: 10, color: "#475569", lineHeight: 1.65, paddingBottom: 10 }}>
                  {formatAddress(billTo.address).map((line, i) => (
                    <span key={i} style={{ display: "block" }}>{line}</span>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Contact strip — always rendered */}
            <div
              className="ch-contact-strip"
              style={{
                borderTop:  "1px solid #dde3f0",
                background: "#eef1fb",
                display:    "grid",
                gridTemplateColumns: "1fr",
                marginTop:  "auto",
              }}
            >
              <div className="ch-contact-cell" style={{ padding: "6px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="ch-contact-role role-cust" style={{ fontSize: 7, fontWeight: 700, ...UP, letterSpacing: "0.1em", color: "#1565c0" }}>
                  Customer
                </div>
                {billTo.contact ? (
                  <>
                    <div className="ch-contact-name" style={{ fontSize: 10.5, fontWeight: 600, color: "#1e293b" }}>
                      {billTo.contact.name}
                    </div>
                    {billTo.contact.phone && (
                      <div className="ch-contact-phone" style={{ fontSize: 10, color: "#475569", fontFamily: "'Courier New', monospace" }}>
                        {billTo.contact.phone}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="ch-contact-empty" style={{ height: 13, borderBottom: "1px solid #e2e8f0", display: "inline-block", minWidth: 80 }} />
                    <div style={{ height: 13 }} />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* SHIP TO ─────────────────────────────────────────────────────── */}
          <div
            className="ch-party-box"
            style={{ background: "#f8faff", display: "flex", flexDirection: "column", borderLeft: "1px solid #dde3f0", minHeight: 180 }}
          >
            <div
              className="ch-party-hdr"
              style={{
                background:     "#eef1fb",
                borderBottom:   "1px solid #dde3f0",
                padding:        "5px 16px",
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
              }}
            >
              <span className="ch-party-hdr-lbl" style={{ fontSize: 8, fontWeight: 800, color: "#0d9488", letterSpacing: "0.14em", ...UP }}>
                Ship To
              </span>
              {(shipTo.area || shipTo.route) && (
                <span className="ch-party-hdr-meta" style={{ fontSize: 8, color: "#7c8db5" }}>
                  {[shipTo.area, shipTo.route].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>

            {/* Body — Code → Name → Address */}
            <div style={{ padding: "10px 16px 0", flex: 1, display: "flex", flexDirection: "column" }}>
              {/* 1. Ship-to Code */}
              <div className="ch-party-code-block" style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 8 }}>
                <div className="ch-code-lbl" style={{ fontSize: 7, fontWeight: 700, color: "#94a3b8", ...UP, letterSpacing: "0.08em" }}>
                  Ship-to Code
                </div>
                <div className="ch-code-val" style={{ fontSize: 11, fontWeight: 600, color: "#0d9488", fontFamily: "'Courier New', monospace" }}>
                  {shipTo.shipToCode ?? ""}
                </div>
              </div>
              {/* 2. Ship-to name */}
              <div className="ch-party-name" style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", lineHeight: 1.3, marginBottom: 4 }}>
                {shipTo.name}
              </div>
              {/* 3. Address */}
              {formatAddress(shipTo.address).length > 0 && (
                <div className="ch-party-addr" style={{ fontSize: 10, color: "#475569", lineHeight: 1.65, paddingBottom: 10 }}>
                  {formatAddress(shipTo.address).map((line, i) => (
                    <span key={i} style={{ display: "block" }}>{line}</span>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Contact strip — always 2 cells: SO | Site/Receiver */}
            <div
              className="ch-contact-strip"
              style={{
                borderTop:           "1px solid #dde3f0",
                background:          "#eef1fb",
                display:             "grid",
                gridTemplateColumns: "1fr 1fr",
                marginTop:           "auto",
              }}
            >
              {/* Sales Officer */}
              <div className="ch-contact-cell" style={{ padding: "6px 16px", display: "flex", flexDirection: "column", gap: 2 }}>
                <div className="ch-contact-role role-so" style={{ fontSize: 7, fontWeight: 700, ...UP, letterSpacing: "0.1em", color: "#2e7d32" }}>
                  Sales Officer
                </div>
                {shipTo.salesOfficer ? (
                  <>
                    <div className="ch-contact-name" style={{ fontSize: 10.5, fontWeight: 600, color: "#1e293b" }}>
                      {shipTo.salesOfficer.name}
                    </div>
                    {shipTo.salesOfficer.phone && (
                      <div className="ch-contact-phone" style={{ fontSize: 10, color: "#475569", fontFamily: "'Courier New', monospace" }}>
                        {shipTo.salesOfficer.phone}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="ch-contact-empty" style={{ height: 13, borderBottom: "1px solid #e2e8f0", display: "inline-block", minWidth: 80 }} />
                    <div style={{ height: 13 }} />
                  </>
                )}
              </div>

              {/* Site / Receiver */}
              <div className="ch-contact-cell" style={{ padding: "6px 16px", display: "flex", flexDirection: "column", gap: 2, borderLeft: "1px dashed #dde3f0" }}>
                <div className="ch-contact-role role-site" style={{ fontSize: 7, fontWeight: 700, ...UP, letterSpacing: "0.1em", color: "#6a1b9a" }}>
                  Site / Receiver
                </div>
                {shipTo.siteContact ? (
                  <>
                    <div className="ch-contact-name" style={{ fontSize: 10.5, fontWeight: 600, color: "#1e293b" }}>
                      {shipTo.siteContact.name}
                    </div>
                    {shipTo.siteContact.phone && (
                      <div className="ch-contact-phone" style={{ fontSize: 10, color: "#475569", fontFamily: "'Courier New', monospace" }}>
                        {shipTo.siteContact.phone}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="ch-contact-empty" style={{ height: 13, borderBottom: "1px solid #e2e8f0", display: "inline-block", minWidth: 80 }} />
                    <div style={{ height: 13 }} />
                  </>
                )}
              </div>
            </div>
          </div>

        </div>{/* /ch-party */}

        {/* ── S4 LINE ITEMS TABLE — flex:1 pushes footer to bottom ──────────── */}
        <div style={{ padding: "10px 0 0", flex: 1 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.12em", ...UP, marginBottom: 5, padding: "0 16px" }}>
            Line Items
          </div>

          <table
            className="ch-table"
            style={{ width: "100%", borderCollapse: "collapse", borderTop: "1px solid #546e7a", borderBottom: "1px solid #546e7a" }}
          >
            <thead>
              <tr
                style={{
                  background:             "#37474f",
                  WebkitPrintColorAdjust: "exact",
                  printColorAdjust:       "exact",
                } as React.CSSProperties}
              >
                <th style={{ padding: "8px 10px 8px 16px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "center", width: 32, whiteSpace: "nowrap" }}>#</th>
                <th style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "left", width: 90, whiteSpace: "nowrap" }}>SKU Code</th>
                <th style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "left", whiteSpace: "nowrap" }}>Material Description</th>
                <th style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "left", width: 110, whiteSpace: "nowrap" }}>
                  Formula{" "}
                  <span className="print-hide" style={{ fontWeight: 400, fontSize: 8, opacity: 0.6, textTransform: "none", letterSpacing: "normal" }}>(editable)</span>
                </th>
                <th style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "right", width: 40, whiteSpace: "nowrap" }}>Qty</th>
                <th style={{ padding: "8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "right", width: 68, whiteSpace: "nowrap" }}>Volume (L)</th>
                <th style={{ padding: "8px 10px 8px 10px", fontSize: 9, fontWeight: 700, color: "#fff", ...UP, letterSpacing: "0.08em", textAlign: "center", width: 52, whiteSpace: "nowrap" }}>Tinting</th>
              </tr>
            </thead>

            <tbody>
              {/* Actual line items */}
              {lineItems.map((li, idx) => {
                const rowBg          = idx % 2 === 0 ? "#fff" : "#f8f9fc";
                const currentFormula = formulaValues[li.id] ?? li.formula ?? "";
                return (
                  <tr key={li.id} style={{ background: rowBg }}>
                    <td style={{ padding: "9px 10px 9px 16px", borderBottom: "1px solid #bdbdbd", textAlign: "center", color: "#94a3b8", fontSize: 10, verticalAlign: "middle" }}>
                      {idx + 1}
                    </td>
                    <td className="sku" style={{ padding: "9px 10px", borderBottom: "1px solid #bdbdbd", fontSize: 10, color: "#334155", verticalAlign: "middle" }}>
                      {li.skuCodeRaw}
                    </td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #bdbdbd", fontWeight: 500, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200, verticalAlign: "middle" }}>
                      {li.skuDescriptionRaw ?? ""}
                    </td>

                    {/* Formula cell */}
                    {li.isTinting ? (
                      <td className="formula" style={{ padding: "4px 10px", borderBottom: "1px solid #bdbdbd", fontSize: 10.5, color: "#0d9488", fontWeight: 500, verticalAlign: "middle", width: 110 }}>
                        {isEditing ? (
                          <>
                            <input
                              type="text"
                              value={currentFormula}
                              placeholder="Enter formula…"
                              onChange={(e) => onFormulaChange(li.id, e.target.value)}
                              style={{
                                border: "none", background: "transparent",
                                fontSize: 10.5, fontFamily: "inherit",
                                color: "#0d9488", padding: "2px 0",
                                outline: "none", width: "100%",
                                borderBottom: "1px dashed #94a3b8",
                              }}
                            />
                            <span className="cp-formula-print" style={{ fontSize: 10.5, color: "#0d9488", fontWeight: 500 }}>
                              {currentFormula}
                            </span>
                          </>
                        ) : (
                          <span style={{
                            fontSize: 10.5, color: currentFormula ? "#0f766e" : "#cbd5e1",
                            fontWeight: currentFormula ? 500 : 400,
                            borderBottom: "1px solid #e2e8f0",
                            display: "inline-block", minWidth: 60, paddingBottom: 1,
                          }}>
                            {currentFormula || "—"}
                          </span>
                        )}
                      </td>
                    ) : (
                      <td className="formula-empty" style={{ padding: "9px 10px", borderBottom: "1px solid #bdbdbd", textAlign: "center", color: "#cbd5e1", verticalAlign: "middle" }}>
                        —
                      </td>
                    )}

                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #bdbdbd", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#334155", verticalAlign: "middle" }}>
                      {li.unitQty}
                    </td>
                    <td style={{ padding: "9px 10px", borderBottom: "1px solid #bdbdbd", textAlign: "right", fontSize: 11, color: "#334155", verticalAlign: "middle" }}>
                      {li.volumeLine != null ? li.volumeLine.toFixed(2) : "—"}
                    </td>
                    <td
                      className={li.isTinting ? "tint-yes" : "tint-no"}
                      style={{
                        padding: "9px 10px", borderBottom: "1px solid #bdbdbd",
                        textAlign: "center", fontSize: 10,
                        fontWeight: li.isTinting ? 600 : 400,
                        color: li.isTinting ? "#78350f" : "#cbd5e1",
                        verticalAlign: "middle",
                      }}
                    >
                      {li.isTinting ? "Tint" : "—"}
                    </td>
                  </tr>
                );
              })}

              {/* Blank rows to ensure minimum 8 body rows */}
              {Array.from({ length: blankRows }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  <td colSpan={7} style={{ height: 28, borderBottom: "1px solid #f5f7fb" }}>&nbsp;</td>
                </tr>
              ))}
            </tbody>

            {/* Totals row */}
            {totals && (
              <tfoot>
                <tr
                  style={{
                    background:             "#eef1f9",
                    WebkitPrintColorAdjust: "exact",
                    printColorAdjust:       "exact",
                  } as React.CSSProperties}
                >
                  <td style={{ padding: "9px 10px 9px 16px", borderTop: "2px solid #0d9488" }} />
                  <td
                    colSpan={3}
                    className="totals-lbl"
                    style={{
                      padding: "9px 10px", borderTop: "2px solid #0d9488",
                      fontSize: 8.5, fontWeight: 700, ...UP,
                      letterSpacing: "0.1em", color: "#64748b", textAlign: "right",
                    }}
                  >
                    Totals
                  </td>
                  <td style={{ padding: "9px 10px", borderTop: "2px solid #0d9488", textAlign: "right", fontSize: 12, fontWeight: 700, color: "#1e293b" }}>
                    {totals.totalUnitQty}
                  </td>
                  <td style={{ padding: "9px 10px", borderTop: "2px solid #0d9488", textAlign: "right", fontSize: 12, fontWeight: 800, color: "#1e293b" }}>
                    {totals.totalVolume.toFixed(2)} L
                  </td>
                  <td style={{ padding: "9px 10px", borderTop: "2px solid #0d9488" }} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>{/* /table-wrap */}

        {/* ── S5 FOOTER — flex-shrink:0 keeps it pinned at bottom ───────────── */}
        <div
          className="ch-footer"
          style={{
            background:          "#f8f9fb",
            borderTop:           "1px solid #546e7a",
            padding:             "14px 24px",
            display:             "grid",
            gridTemplateColumns: "1.4fr 1fr 1fr",
            gap:                 20,
            flexShrink:          0,
          }}
        >
          {/* Col 1 — Terms + dispatch fields */}
          <div className="ch-footer-col" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <div className="ch-footer-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#7c8db5", letterSpacing: "0.12em", ...UP }}>
              Terms &amp; Conditions
            </div>
            <div className="ch-footer-terms" style={{ fontSize: 9, color: "#64748b", lineHeight: 1.65 }}>
              Goods once dispatched cannot be returned without prior written
              approval from the depot manager. Rejection or shortage must be
              reported within 3 days of delivery date.
            </div>
            <div className="ch-footer-spacer" style={{ flex: 1, minHeight: 20 }} />
            <div className="ch-dispatch-row" style={{ display: "flex", gap: 20, marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e2e8f0" }}>

              {/* Transporter */}
              <div className="ch-dispatch-field" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div className="ch-dispatch-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", ...UP }}>
                  Transporter
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={transporterValue}
                    placeholder="Enter transporter…"
                    onChange={(e) => onTransporterChange(e.target.value)}
                    style={{
                      border: "none", background: "transparent",
                      fontSize: 11, fontFamily: "inherit", color: "#64748b",
                      padding: "2px 0", outline: "none",
                      borderBottom: "1.5px dashed #94a3b8", minWidth: 90,
                    }}
                  />
                ) : (
                  <span className="ch-dispatch-val" style={{ fontSize: 11, color: "#64748b", borderBottom: "1.5px dashed #94a3b8", paddingBottom: 2, minWidth: 90, display: "block" }}>
                    {transporterValue || "\u00a0"}
                  </span>
                )}
              </div>

              {/* Vehicle No. */}
              <div className="ch-dispatch-field" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div className="ch-dispatch-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", ...UP }}>
                  Vehicle No.
                </div>
                {isEditing ? (
                  <input
                    type="text"
                    value={vehicleNoValue}
                    placeholder="GJ-05-AB-1234"
                    onChange={(e) => onVehicleNoChange(e.target.value)}
                    style={{
                      border: "none", background: "transparent",
                      fontSize: 11, fontFamily: "inherit", color: "#64748b",
                      padding: "2px 0", outline: "none",
                      borderBottom: "1.5px dashed #94a3b8", minWidth: 90,
                    }}
                  />
                ) : (
                  <span className="ch-dispatch-val" style={{ fontSize: 11, color: "#64748b", borderBottom: "1.5px dashed #94a3b8", paddingBottom: 2, minWidth: 90, display: "block" }}>
                    {vehicleNoValue || "\u00a0"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Col 2 — Dispatched By */}
          <div className="ch-footer-col center" style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "center" }}>
            <div className="ch-footer-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#7c8db5", letterSpacing: "0.12em", ...UP }}>
              Dispatched By
            </div>
            <div className="ch-footer-spacer" style={{ flex: 1 }} />
            <div className="ch-sig-line" style={{ width: 130, height: 1, background: "#334155" }} />
            <div className="ch-sig-sub" style={{ fontSize: 7.5, color: "#94a3b8", marginTop: 3 }}>
              Name, Designation &amp; Signature
            </div>
          </div>

          {/* Col 3 — Receiver */}
          <div className="ch-footer-col right" style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
            <div className="ch-footer-lbl" style={{ fontSize: 7.5, fontWeight: 700, color: "#7c8db5", letterSpacing: "0.12em", ...UP }}>
              Receiver&apos;s Acknowledgement
            </div>
            <div className="ch-footer-spacer" style={{ flex: 1 }} />
            <div className="ch-sig-line" style={{ width: 150, height: 1, background: "#334155" }} />
            <div className="ch-sig-sub" style={{ fontSize: 7.5, color: "#94a3b8", marginTop: 3 }}>
              Sign, Stamp &amp; Date of Receipt
            </div>
          </div>
        </div>{/* /ch-footer */}

        {/* ── S6 BOTTOM BAR — flex-shrink:0 ────────────────────────────────── */}
        <div
          className="ch-btm"
          style={{
            background:     "#0d9488",
            padding:        "5px 24px",
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "center",
            flexShrink:     0,
          }}
        >
          <div className="ch-btm-txt" style={{ fontSize: 7, color: "rgba(255,255,255,0.45)", letterSpacing: "0.03em" }}>
            {[
              systemConfig.registeredOffice ? `Regd. Office: ${systemConfig.registeredOffice}` : "",
              systemConfig.website,
            ].filter(Boolean).join("  ·  ")}
          </div>
          <div className="ch-btm-gstin" style={{ fontSize: 7, color: "rgba(255,255,255,0.65)", fontWeight: 600, letterSpacing: "0.06em" }}>
            {systemConfig.gstin ? `GSTIN: ${systemConfig.gstin}` : ""}
          </div>
        </div>

      </div>{/* /challan-print-area */}
    </>
  );
}
