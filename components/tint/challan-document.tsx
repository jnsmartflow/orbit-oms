"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ChallanDocument — pure presentational component.
// B&W print-optimized layout. No colored backgrounds.
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
          fontFamily:             "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          fontSize:               11,
          color:                  "#111827",
          background:             "#fff",
          display:                "flex",
          flexDirection:          "column",
          minHeight:              "100vh",
          border:                 "1px solid #d1d5db",
          overflow:               "hidden",
          WebkitPrintColorAdjust: "exact",
          printColorAdjust:       "exact",
        } as React.CSSProperties}
      >

        {/* ── S1 HEADER — 3-column: Logo | Title | Challan No. ──────────── */}
        <div style={{
          display: "flex",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "2px solid #111827",
          flexShrink: 0,
        }}>
          {/* Left — Logo */}
          <div style={{ width: 80, flexShrink: 0 }}>
            <img
              src="/akzonobel-logo.png"
              alt="AkzoNobel"
              style={{
                height: 56,
                width: "auto",
                display: "block",
                filter: "grayscale(100%) brightness(0)",
              }}
            />
          </div>

          {/* Center — Title */}
          <div style={{ flex: 1, textAlign: "center", padding: "0 16px" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", letterSpacing: 3, ...UP }}>
              Delivery Challan
            </div>
            <div style={{ fontSize: 9, fontWeight: 500, color: "#9ca3af", letterSpacing: 1, marginTop: 2, ...UP }}>
              Original Copy
            </div>
          </div>

          {/* Right — Challan Number */}
          <div style={{ flexShrink: 0, textAlign: "right" }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.5, ...UP }}>
              Challan No.
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "'SF Mono', ui-monospace, monospace", marginTop: 1 }}>
              {challan.challanNumber}
            </div>
          </div>
        </div>

        {/* ── S2 ADDRESS BAR ───────────────────────────────────────────────── */}
        <div style={{
          background: "#374151",
          padding: "5px 24px",
          fontSize: 10,
          color: "#d1d5db",
          textAlign: "center",
          letterSpacing: 0.2,
          flexShrink: 0,
          WebkitPrintColorAdjust: "exact",
          printColorAdjust: "exact",
        } as React.CSSProperties}>
          {[systemConfig.companySubtitle, systemConfig.depotAddress].filter(Boolean).join(" · ")}
        </div>

        {/* ── S3 FIELDS ROW — SMU | OBD | Warehouse ───────────────────────── */}
        <div style={{ display: "flex", borderBottom: "1px solid #d1d5db", flexShrink: 0 }}>
          {/* SMU Number */}
          <div style={{ flex: 1, padding: "8px 14px 8px 24px", borderRight: "1px solid #d1d5db" }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: "#9ca3af", ...UP, letterSpacing: 0.3 }}>SMU Number</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", marginTop: 1 }}>{order.smu ?? "—"}</div>
          </div>
          {/* OBD No. */}
          <div style={{ flex: 1, padding: "8px 14px", borderRight: "1px solid #d1d5db" }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: "#9ca3af", ...UP, letterSpacing: 0.3 }}>OBD No.</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", fontFamily: "'SF Mono', ui-monospace, monospace", marginTop: 1 }}>{order.obdNumber}</div>
          </div>
          {/* Warehouse */}
          <div style={{ flex: 1, padding: "8px 14px 8px 14px" }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: "#9ca3af", ...UP, letterSpacing: 0.3 }}>Warehouse</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#111827", marginTop: 1 }}>{order.warehouse ?? "Surat Depot"}</div>
          </div>
        </div>

        {/* ── S4 BILL TO / SHIP TO — 2 columns ────────────────────────────── */}
        <div style={{ display: "flex", borderBottom: "1px solid #d1d5db", flexShrink: 0 }}>

          {/* BILL TO */}
          <div style={{ flex: 1, borderRight: "1px solid #d1d5db" }}>
            <div style={{ padding: "5px 14px 5px 24px", background: "#f9fafb", borderBottom: "1px solid #d1d5db", fontSize: 9, fontWeight: 700, color: "#111827", letterSpacing: 0.5, ...UP }}>
              Bill To
            </div>
            <div style={{ padding: "10px 14px 10px 24px" }}>
              <div style={{ fontSize: 8, color: "#9ca3af", fontWeight: 600, ...UP }}>Customer Code</div>
              <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, fontFamily: "'SF Mono', ui-monospace, monospace", marginTop: 1 }}>{billTo.customerCode ?? ""}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginTop: 4 }}>{billTo.name}</div>
            </div>
          </div>

          {/* SHIP TO */}
          <div style={{ flex: 1 }}>
            <div style={{ padding: "5px 24px 5px 14px", background: "#f9fafb", borderBottom: "1px solid #d1d5db", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#111827", letterSpacing: 0.5, ...UP }}>Ship To</span>
              {(shipTo.area || shipTo.route) && (
                <span style={{ fontSize: 9, color: "#9ca3af", fontWeight: 500 }}>
                  {[shipTo.area, shipTo.route].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <div style={{ padding: "10px 24px 10px 14px" }}>
              <div style={{ fontSize: 8, color: "#9ca3af", fontWeight: 600, ...UP }}>Ship-to Code</div>
              <div style={{ fontSize: 11, color: "#374151", fontWeight: 600, fontFamily: "'SF Mono', ui-monospace, monospace", marginTop: 1 }}>{shipTo.shipToCode ?? ""}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", marginTop: 4 }}>{shipTo.name}</div>
              {formatAddress(shipTo.address).length > 0 && (
                <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2, lineHeight: 1.35 }}>
                  {formatAddress(shipTo.address).join(", ")}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── S5 CUSTOMER / SALES OFFICER / SITE RECEIVER — 3 columns ──────── */}
        <div style={{ display: "flex", borderBottom: "1px solid #d1d5db", flexShrink: 0 }}>
          {/* Customer */}
          <div style={{ flex: 1, padding: "8px 14px 8px 24px", borderRight: "1px solid #d1d5db" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#111827", ...UP, letterSpacing: 0.3 }}>Customer</div>
            {billTo.contact?.name ? (
              <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>{billTo.contact.name}</div>
            ) : (
              <div style={{ height: 20 }} />
            )}
          </div>
          {/* Sales Officer */}
          <div style={{ flex: 1, padding: "8px 14px", borderRight: "1px solid #d1d5db" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#111827", ...UP, letterSpacing: 0.3 }}>Sales Officer</div>
            {shipTo.salesOfficer?.name ? (
              <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>{shipTo.salesOfficer.name}</div>
            ) : (
              <div style={{ height: 20 }} />
            )}
          </div>
          {/* Site / Receiver */}
          <div style={{ flex: 1, padding: "8px 14px 8px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#111827", ...UP, letterSpacing: 0.3 }}>Site / Receiver</div>
            {shipTo.siteContact?.name ? (
              <div style={{ fontSize: 11, color: "#374151", marginTop: 3 }}>{shipTo.siteContact.name}</div>
            ) : (
              <div style={{ height: 20 }} />
            )}
          </div>
        </div>

        {/* ── S6 LINE ITEMS TABLE — flex:1 pushes footer to bottom ──────────── */}
        <div style={{ flex: 1 }}>
          <div style={{ padding: "10px 24px 4px", fontSize: 9, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.5, ...UP }}>
            Line Items
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "35%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>

            <thead>
              <tr>
                <th style={{ height: 28, padding: "0 10px 0 24px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "center", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#</th>
                <th style={{ height: 28, padding: "0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "left", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>SKU Code</th>
                <th style={{ height: 28, padding: "0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "left", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Material Description</th>
                <th style={{ height: 28, padding: "0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "left", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Formula <span className="print-hide" style={{ fontWeight: 400, color: "#9ca3af", textTransform: "none", fontSize: 7 }}>(editable)</span>
                </th>
                <th style={{ height: 28, padding: "0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "right", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Qty</th>
                <th style={{ height: 28, padding: "0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "right", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Volume (L)</th>
                <th style={{ height: 28, padding: "0 10px 0 10px", fontSize: 9, fontWeight: 600, color: "#111827", ...UP, letterSpacing: 0.4, textAlign: "center", borderTop: "2px solid #111827", borderBottom: "1px solid #374151", background: "#f9fafb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Tinting</th>
              </tr>
            </thead>

            <tbody>
              {lineItems.map((li, idx) => {
                const currentFormula = formulaValues[li.id] ?? li.formula ?? "";
                return (
                  <tr key={li.id}>
                    <td style={{ height: 32, padding: "0 10px 0 24px", borderBottom: "1px solid #e5e7eb", textAlign: "center", color: "#9ca3af", fontSize: 10, verticalAlign: "middle" }}>
                      {idx + 1}
                    </td>
                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", fontSize: 10, color: "#6b7280", fontFamily: "'SF Mono', ui-monospace, monospace", verticalAlign: "middle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {li.skuCodeRaw}
                    </td>
                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", color: "#374151", verticalAlign: "middle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {li.skuDescriptionRaw ?? ""}
                    </td>

                    {/* Formula cell */}
                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", verticalAlign: "middle", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={currentFormula}
                            placeholder="Enter formula…"
                            onChange={(e) => onFormulaChange(li.id, e.target.value)}
                            style={{
                              border: "none", borderBottom: "1px dashed #9ca3af",
                              background: "transparent", fontSize: 11, fontFamily: "inherit",
                              color: "#374151", padding: "2px 0", outline: "none", width: "100%",
                            }}
                          />
                          <span className="cp-formula-print" style={{ fontSize: 11, color: "#374151" }}>
                            {currentFormula}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: currentFormula ? "#374151" : "#d1d5db" }}>
                          {currentFormula || "—"}
                        </span>
                      )}
                    </td>

                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", textAlign: "right", fontWeight: 600, color: "#111827", verticalAlign: "middle" }}>
                      {li.unitQty}
                    </td>
                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", textAlign: "right", color: "#374151", verticalAlign: "middle" }}>
                      {li.volumeLine != null ? li.volumeLine.toFixed(2) : "—"}
                    </td>
                    <td style={{ height: 32, padding: "0 10px", borderBottom: "1px solid #e5e7eb", textAlign: "center", fontWeight: 500, color: li.isTinting ? "#111827" : "#d1d5db", verticalAlign: "middle" }}>
                      {li.isTinting ? "Tint" : "—"}
                    </td>
                  </tr>
                );
              })}

              {/* Blank rows to ensure minimum 8 body rows */}
              {Array.from({ length: blankRows }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  <td style={{ height: 32, padding: "0 10px 0 24px", borderBottom: "1px solid #f0f0f0", textAlign: "center", color: "#e5e7eb", fontSize: 10, verticalAlign: "middle" }}>
                    {lineItems.length + i + 1}
                  </td>
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                  <td style={{ height: 32, borderBottom: "1px solid #f0f0f0" }} />
                </tr>
              ))}
            </tbody>

            {/* Totals row */}
            {totals && (
              <tfoot>
                <tr>
                  <td style={{ height: 32, padding: "0 10px 0 24px", borderTop: "2px solid #111827", verticalAlign: "middle" }} />
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", verticalAlign: "middle" }} />
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", verticalAlign: "middle" }} />
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", fontSize: 9, fontWeight: 700, color: "#111827", ...UP, textAlign: "right", verticalAlign: "middle" }}>
                    Totals
                  </td>
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", textAlign: "right", fontWeight: 700, color: "#111827", verticalAlign: "middle" }}>
                    {totals.totalUnitQty}
                  </td>
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", textAlign: "right", fontWeight: 700, color: "#111827", verticalAlign: "middle" }}>
                    {totals.totalVolume.toFixed(2)} L
                  </td>
                  <td style={{ height: 32, padding: "0 10px", borderTop: "2px solid #111827", verticalAlign: "middle" }} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ── S7 FOOTER — Terms | Dispatched By | Receiver ─────────────────── */}
        <div style={{
          display: "flex",
          borderTop: "1px solid #d1d5db",
          marginTop: "auto",
          flexShrink: 0,
        }}>
          {/* Col 1 — Terms & Conditions */}
          <div style={{ flex: 1, padding: "10px 14px 10px 24px", borderRight: "1px solid #d1d5db" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "#111827", ...UP, marginBottom: 5 }}>
              Terms &amp; Conditions
            </div>
            <div style={{ fontSize: 9, color: "#6b7280", lineHeight: 1.45 }}>
              Goods once dispatched cannot be returned without prior written
              approval from the depot manager. Rejection or shortage must be
              reported within 3 days of delivery date.
            </div>

            {/* Transporter + Vehicle No. */}
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dotted #9ca3af", display: "flex", gap: 20 }}>
              {/* Transporter */}
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#111827", ...UP, letterSpacing: "0.1em" }}>Transporter</div>
                {isEditing ? (
                  <input
                    type="text"
                    value={transporterValue}
                    placeholder="Enter transporter…"
                    onChange={(e) => onTransporterChange(e.target.value)}
                    style={{
                      border: "none", background: "transparent",
                      fontSize: 11, fontFamily: "inherit", color: "#6b7280",
                      padding: "2px 0", outline: "none",
                      borderBottom: "1.5px dashed #9ca3af", minWidth: 90,
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: "#6b7280", borderBottom: "1px dotted #9ca3af", paddingBottom: 2, minWidth: 90, display: "block" }}>
                    {transporterValue || "\u00a0"}
                  </span>
                )}
              </div>

              {/* Vehicle No. */}
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: "#111827", ...UP, letterSpacing: "0.1em" }}>Vehicle No.</div>
                {isEditing ? (
                  <input
                    type="text"
                    value={vehicleNoValue}
                    placeholder="GJ-05-AB-1234"
                    onChange={(e) => onVehicleNoChange(e.target.value)}
                    style={{
                      border: "none", background: "transparent",
                      fontSize: 11, fontFamily: "inherit", color: "#6b7280",
                      padding: "2px 0", outline: "none",
                      borderBottom: "1.5px dashed #9ca3af", minWidth: 90,
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 11, color: "#6b7280", borderBottom: "1px dotted #9ca3af", paddingBottom: 2, minWidth: 90, display: "block" }}>
                    {vehicleNoValue || "\u00a0"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Col 2 — Dispatched By */}
          <div style={{ flex: 1, padding: "10px 14px", borderRight: "1px solid #d1d5db", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "#111827", ...UP, marginBottom: 5 }}>
              Dispatched By
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 130, borderBottom: "1px dotted #9ca3af" }} />
            <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 3 }}>
              Name, Designation &amp; Signature
            </div>
          </div>

          {/* Col 3 — Receiver's Acknowledgement */}
          <div style={{ flex: 1, padding: "10px 24px 10px 14px", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: "#111827", ...UP, marginBottom: 5 }}>
              Receiver&apos;s Acknowledgement
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ width: 150, borderBottom: "1px dotted #9ca3af" }} />
            <div style={{ fontSize: 8, color: "#9ca3af", marginTop: 3 }}>
              Sign, Stamp &amp; Date of Receipt
            </div>
          </div>
        </div>

        {/* ── S8 BOTTOM BAR ────────────────────────────────────────────────── */}
        <div style={{
          padding: "6px 24px",
          fontSize: 7.5,
          color: "#9ca3af",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid #d1d5db",
          flexShrink: 0,
        }}>
          <span>
            {[
              systemConfig.registeredOffice ? `Regd. Office: ${systemConfig.registeredOffice}` : "",
              systemConfig.website,
            ].filter(Boolean).join(" · ")}
          </span>
          <span style={{ fontWeight: 700, color: "#6b7280" }}>
            {systemConfig.gstin ? `GSTIN: ${systemConfig.gstin}` : ""}
          </span>
        </div>

      </div>{/* /challan-print-area */}
    </>
  );
}
