"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Search, Printer, Edit2, Save, X, FileText } from "lucide-react";
import {
  ChallanDocument,
  type ChallanApiResponse,
} from "@/components/tint/challan-document";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChallanListItem {
  orderId:            number;
  obdNumber:          string;
  billToCustomerName: string | null;
  smu:                string | null;
  obdEmailDate:       string | null;
  route:              string | null;
  slot:               string | null;
  challanNumber:      string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function initFormulaValues(lineItems: ChallanApiResponse["order"]["lineItems"]): Record<number, string> {
  const fv: Record<number, string> = {};
  for (const li of lineItems) {
    if (li.formula != null) fv[li.id] = li.formula;
  }
  return fv;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChallanContent() {
  // ── List state ───────────────────────────────────────────────────────────────
  const [items,       setItems]       = useState<ChallanListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError,   setListError]   = useState<string | null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [searchValue, setSearchValue] = useState("");
  const [dateFilter,  setDateFilter]  = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [smuFilter,   setSmuFilter]   = useState("");

  // ── Detail state ─────────────────────────────────────────────────────────────
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [challanData,     setChallanData]     = useState<ChallanApiResponse | null>(null);
  const [detailLoading,   setDetailLoading]   = useState(false);
  const [detailError,     setDetailError]     = useState<string | null>(null);

  // ── Edit / save / print state ────────────────────────────────────────────────
  const [isEditing,        setIsEditing]        = useState(false);
  const [isSaving,         setIsSaving]         = useState(false);
  const [isPrinting,       setIsPrinting]       = useState(false);
  const [printNotice,      setPrintNotice]      = useState(false);
  const [isDirty,          setIsDirty]          = useState(false);
  const [transporterValue, setTransporterValue] = useState("");
  const [vehicleNoValue,   setVehicleNoValue]   = useState("");
  const [formulaValues,    setFormulaValues]    = useState<Record<number, string>>({});

  // ── Fetch list ───────────────────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (searchValue) params.set("search", searchValue);
      if (dateFilter)  params.set("date",   dateFilter);
      if (routeFilter) params.set("route",  routeFilter);
      if (smuFilter)   params.set("smu",    smuFilter);

      const res = await fetch(`/api/tint/manager/challans?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load orders");
      }
      setItems(await res.json() as ChallanListItem[]);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setListLoading(false);
    }
  }, [searchValue, dateFilter, routeFilter, smuFilter]);

  // Debounce: re-fetch when filters change (300 ms delay)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchList, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [fetchList]);

  // ── Fetch detail ─────────────────────────────────────────────────────────────
  const fetchDetail = useCallback(async (orderId: number) => {
    setDetailLoading(true);
    setDetailError(null);
    setChallanData(null);
    try {
      const res = await fetch(`/api/tint/manager/challans/${orderId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? "Failed to load challan");
      }
      const data = await res.json() as ChallanApiResponse;
      setChallanData(data);
      setTransporterValue(data.challan.transporter ?? "");
      setVehicleNoValue(data.challan.vehicleNo     ?? "");
      setFormulaValues(initFormulaValues(data.order.lineItems));
      setIsDirty(false);
      setIsEditing(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load challan");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectOrder = useCallback((orderId: number) => {
    setSelectedOrderId(orderId);
    void fetchDetail(orderId);
  }, [fetchDetail]);

  // ── Edit callbacks ────────────────────────────────────────────────────────────
  const handleFormulaChange = useCallback((rawLineItemId: number, value: string) => {
    setFormulaValues((prev) => ({ ...prev, [rawLineItemId]: value }));
    setIsDirty(true);
  }, []);

  const handleTransporterChange = useCallback((value: string) => {
    setTransporterValue(value);
    setIsDirty(true);
  }, []);

  const handleVehicleNoChange = useCallback((value: string) => {
    setVehicleNoValue(value);
    setIsDirty(true);
  }, []);

  // ── Cancel edit ───────────────────────────────────────────────────────────────
  const handleCancelEdit = useCallback(() => {
    if (!challanData) { setIsEditing(false); return; }
    setIsEditing(false);
    setIsDirty(false);
    setTransporterValue(challanData.challan.transporter ?? "");
    setVehicleNoValue(challanData.challan.vehicleNo     ?? "");
    setFormulaValues(initFormulaValues(challanData.order.lineItems));
  }, [challanData]);

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!selectedOrderId || !challanData) return false;
    setIsSaving(true);
    try {
      // Only send formulas with non-empty values
      const formulas = Object.entries(formulaValues)
        .filter(([, v]) => v.trim() !== "")
        .map(([id, formula]) => ({ rawLineItemId: Number(id), formula }));

      const body: Record<string, unknown> = {};
      if (transporterValue !== undefined) body.transporter = transporterValue || null;
      if (vehicleNoValue   !== undefined) body.vehicleNo   = vehicleNoValue   || null;
      if (formulas.length > 0)            body.formulas    = formulas;

      const res = await fetch(`/api/tint/manager/challans/${selectedOrderId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }

      // Refetch detail (resets edit state + formula values from server)
      await fetchDetail(selectedOrderId);
      // Refresh list (challan number badge may have appeared)
      void fetchList();
      return true;
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedOrderId, challanData, formulaValues,
    transporterValue, vehicleNoValue, fetchDetail, fetchList,
  ]);

  // ── Print ─────────────────────────────────────────────────────────────────────
  const handlePrint = useCallback(async () => {
    if (isPrinting) return;
    setIsPrinting(true);

    if (isDirty) {
      const saved = await handleSave();
      if (!saved) {
        setIsPrinting(false);
        return;
      }
    }

    // Show tip notice for 5 s; wait 500 ms to ensure React is fully rendered before print snapshot
    setPrintNotice(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      setTimeout(() => setPrintNotice(false), 5000);
    }, 500);
  }, [isPrinting, isDirty, handleSave]);

  // ── Derived: unique route options from loaded list ────────────────────────────
  const uniqueRoutes = Array.from(
    new Set(items.map((i) => i.route).filter((r): r is string => r !== null)),
  );

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>

      {/* ── PRINT NOTICE (screen-only, hidden during print) ──────────────── */}
      {printNotice && (
        <div
          className="print-hide"
          style={{
            position:     "fixed",
            bottom:       24,
            right:        24,
            zIndex:       9999,
            background:   "#1a237e",
            color:        "#fff",
            padding:      "12px 18px",
            borderRadius: 8,
            fontSize:     13,
            lineHeight:   1.5,
            boxShadow:    "0 4px 16px rgba(0,0,0,0.22)",
            maxWidth:     340,
          }}
        >
          <strong>Tip:</strong> In the print dialog → More settings → uncheck{" "}
          <em>Headers and footers</em> to remove browser decorations.
        </div>
      )}

      {/* ── TOPBAR ──────────────────────────────────────────────────────────── */}
      <header style={{
        background: "#fff",
        borderBottom: "1px solid #e2e5f1",
        height: 52,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        flexShrink: 0,
        gap: 10,
      }}>
        <FileText size={18} color="#1a237e" />
        <span style={{ fontSize: 17, fontWeight: 800, color: "#111827" }}>Delivery Challans</span>
      </header>

      {/* ── MAIN ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── LEFT PANEL — 35% — Order list ──────────────────────────────────── */}
        <div style={{
          width: "35%",
          display: "flex",
          flexDirection: "column",
          borderRight: "1px solid #e2e5f1",
          background: "#f7f8fc",
          flexShrink: 0,
          overflow: "hidden",
        }}>

          {/* Search + filter bar */}
          <div style={{
            background: "#fff",
            borderBottom: "1px solid #e2e5f1",
            padding: "10px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flexShrink: 0,
          }}>
            {/* Search input */}
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{
                  position: "absolute", left: 10,
                  top: "50%", transform: "translateY(-50%)",
                  color: "#94a3b8", pointerEvents: "none",
                }}
              />
              <input
                type="text"
                placeholder="Search OBD No. or customer name…"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                style={{
                  width: "100%", paddingLeft: 32, paddingRight: 10, height: 34,
                  border: "1px solid #e2e5f1", borderRadius: 7, fontSize: 13,
                  background: "#f7f8fc", outline: "none", color: "#1e293b",
                }}
              />
            </div>
            {/* Filters */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                style={{
                  height: 30, border: "1px solid #e2e5f1", borderRadius: 6,
                  fontSize: 12, padding: "0 8px", color: "#374151",
                  background: "#fff", outline: "none",
                }}
              />
              <select
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
                style={{
                  height: 30, border: "1px solid #e2e5f1", borderRadius: 6,
                  fontSize: 12, padding: "0 8px", color: "#374151",
                  background: "#fff", outline: "none", flex: 1,
                }}
              >
                <option value="">All Routes</option>
                {uniqueRoutes.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select
                value={smuFilter}
                onChange={(e) => setSmuFilter(e.target.value)}
                style={{
                  height: 30, border: "1px solid #e2e5f1", borderRadius: 6,
                  fontSize: 12, padding: "0 8px", color: "#374151",
                  background: "#fff", outline: "none", flex: 1,
                }}
              >
                <option value="">All SMU</option>
                <option value="Retail Offtake">Retail Offtake</option>
                <option value="Project">Project</option>
              </select>
              {(dateFilter || routeFilter || smuFilter) && (
                <button
                  type="button"
                  onClick={() => { setDateFilter(""); setRouteFilter(""); setSmuFilter(""); }}
                  style={{
                    height: 30, border: "1px solid #e2e5f1", borderRadius: 6,
                    fontSize: 11, padding: "0 10px", color: "#6b7280",
                    background: "#f7f8fc", cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
            {listLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 48, gap: 8, color: "#9ca3af" }}>
                <Loader2 size={18} className="animate-spin" />
                <span style={{ fontSize: 13 }}>Loading orders…</span>
              </div>
            ) : listError ? (
              <div style={{ padding: 24, textAlign: "center" }}>
                <p style={{ fontSize: 13, color: "#ef4444", marginBottom: 8 }}>{listError}</p>
                <button
                  type="button"
                  onClick={fetchList}
                  style={{ fontSize: 12, color: "#1a237e", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px", textAlign: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#f7f8fc", border: "1px solid #e2e5f1", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                  <FileText size={20} color="#9ca3af" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#6b7280" }}>No orders found</p>
                <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Try adjusting your search or filters.</p>
              </div>
            ) : (
              items.map((item) => {
                const isSelected         = item.orderId === selectedOrderId;
                const hasExistingChallan = item.challanNumber !== null;

                return (
                  <div
                    key={item.orderId}
                    onClick={() => handleSelectOrder(item.orderId)}
                    style={{
                      background:  isSelected ? "#eff6ff" : "#fff",
                      border:      `1px solid ${isSelected ? "#93c5fd" : "#e2e5f1"}`,
                      borderLeft:  `3px solid ${
                        isSelected          ? "#1a237e"
                        : hasExistingChallan ? "#16a34a"
                        : "#e2e5f1"
                      }`,
                      borderRadius: 8,
                      marginBottom: 6,
                      padding:      "10px 12px",
                      cursor:       "pointer",
                      transition:   "border-color 0.12s, background 0.12s",
                    }}
                  >
                    {/* Row 1: OBD code + challan badge */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 12, fontWeight: 700, color: "#1a237e" }}>
                        {item.obdNumber}
                      </span>
                      {item.challanNumber && (
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          background: "#dcfce7", border: "1px solid #86efac", color: "#15803d",
                          padding: "1px 7px", borderRadius: 8,
                        }}>
                          {item.challanNumber}
                        </span>
                      )}
                    </div>
                    {/* Row 2: Customer name */}
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: "#111827",
                      marginBottom: 5, whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      {item.billToCustomerName ?? "—"}
                    </div>
                    {/* Row 3: Meta chips */}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {item.obdEmailDate && (
                        <span style={{ fontSize: 10, color: "#6b7280", background: "#f7f8fc", border: "1px solid #e2e5f1", padding: "1px 6px", borderRadius: 4 }}>
                          {fmtDate(item.obdEmailDate)}
                        </span>
                      )}
                      {item.smu && (
                        <span style={{ fontSize: 10, fontWeight: 600, color: "#1a237e", background: "#e8eaf6", border: "1px solid #c5cae9", padding: "1px 6px", borderRadius: 4 }}>
                          {item.smu}
                        </span>
                      )}
                      {item.route && (
                        <span style={{ fontSize: 10, color: "#374151", background: "#f7f8fc", border: "1px solid #e2e5f1", padding: "1px 6px", borderRadius: 4 }}>
                          {item.route}
                        </span>
                      )}
                      {item.slot && (
                        <span style={{ fontSize: 10, color: "#374151", background: "#f7f8fc", border: "1px solid #e2e5f1", padding: "1px 6px", borderRadius: 4 }}>
                          {item.slot}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL — flex 1 (~65%) — Challan preview ──────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f0f2f8" }}>

          {!selectedOrderId ? (
            /* Empty state */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#f7f8fc", border: "1px solid #e2e5f1", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <FileText size={24} color="#9ca3af" />
              </div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#6b7280" }}>Select an order to preview challan</p>
            </div>

          ) : detailLoading ? (
            /* Loading state */
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "#9ca3af" }}>
              <Loader2 size={20} className="animate-spin" />
              <span style={{ fontSize: 13 }}>Loading challan…</span>
            </div>

          ) : detailError ? (
            /* Error state */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <p style={{ fontSize: 13, color: "#ef4444" }}>{detailError}</p>
              <button
                type="button"
                onClick={() => { if (selectedOrderId) void fetchDetail(selectedOrderId); }}
                style={{ fontSize: 12, color: "#1a237e", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
              >
                Retry
              </button>
            </div>

          ) : challanData ? (
            <>
              {/* Action bar */}
              <div style={{
                background: "#fff",
                borderBottom: "1px solid #e2e5f1",
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
              }}>
                {/* Challan number badge */}
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: "#1a237e", background: "#e8eaf6", border: "1px solid #c5cae9",
                  padding: "3px 10px", borderRadius: 6,
                }}>
                  {challanData.challan.challanNumber}
                </span>

                <div style={{ flex: 1 }} />

                {isEditing ? (
                  <>
                    {/* Cancel */}
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      style={{
                        height: 32, padding: "0 12px",
                        border: "1px solid #e2e5f1", borderRadius: 6,
                        fontSize: 12, fontWeight: 600, color: "#6b7280",
                        background: "#fff", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                        opacity: isSaving ? 0.5 : 1,
                      }}
                    >
                      <X size={13} /> Cancel
                    </button>
                    {/* Save */}
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving || !isDirty}
                      style={{
                        height: 32, padding: "0 14px",
                        border: "none", borderRadius: 6,
                        fontSize: 12, fontWeight: 700, color: "#fff",
                        background: "#1a237e",
                        cursor: isSaving || !isDirty ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 5,
                        opacity: (!isDirty && !isSaving) ? 0.45 : 1,
                      }}
                    >
                      {isSaving
                        ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                        : <><Save    size={13} /> Save</>
                      }
                    </button>
                  </>
                ) : (
                  /* Edit button */
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    style={{
                      height: 32, padding: "0 12px",
                      border: "1px solid #c5cae9", borderRadius: 6,
                      fontSize: 12, fontWeight: 600, color: "#1a237e",
                      background: "#e8eaf6", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                    }}
                  >
                    <Edit2 size={13} /> Edit
                  </button>
                )}

                {/* Print */}
                <button
                  type="button"
                  onClick={() => void handlePrint()}
                  disabled={isPrinting || detailLoading}
                  style={{
                    height: 32, padding: "0 12px",
                    border: "1px solid #e2e5f1", borderRadius: 6,
                    fontSize: 12, fontWeight: 600, color: "#374151",
                    background: "#f7f8fc", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 5,
                    opacity: isPrinting ? 0.6 : 1,
                  }}
                >
                  <Printer size={13} />
                  {isPrinting ? "Printing…" : "Print"}
                </button>
              </div>

              {/* Challan document — scrollable */}
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
                <ChallanDocument
                  data={challanData}
                  isEditing={isEditing}
                  transporterValue={transporterValue}
                  vehicleNoValue={vehicleNoValue}
                  formulaValues={formulaValues}
                  onFormulaChange={handleFormulaChange}
                  onTransporterChange={handleTransporterChange}
                  onVehicleNoChange={handleVehicleNoChange}
                />
              </div>
            </>
          ) : null}
        </div>

      </div>
    </div>
  );
}
