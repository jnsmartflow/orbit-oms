"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { UniversalHeader } from "@/components/universal-header";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { getTodayIST } from "@/lib/dates";
import { shareTripSheetImage } from "@/lib/trip-report/share-sheet-image";
import { resolveDeliveryArea, resolveCustomerLabelParts, isPromoRow } from "@/lib/trip-report/display";

// ── Types (mirror /api/trips + /api/trips/[tripNo] JSON shapes) ────────────

interface TripSummary {
  tripNo: string;
  deliveryType: string | null;
  disDate: string;
  disTime: string | null;
  vehicleNo: string | null;
  vehType: string | null;
  vModal: string | null;
  driverName: string | null;
  driverMobile: string | null;
  transporter: string | null;
  dieselAmt: string | null;
  dropCount: number;
  totalQty: number;
  totalWeight: number;
  deliveryAreas: string;
}

interface TripsListResponse {
  date: string;
  tripCount: number;
  trips: TripSummary[];
}

interface TripDrop {
  deliveryNo: string | null;
  custName: string | null;
  custCode: string | null;
  custAreaName: string | null;
  dlRoute: string | null;
  siteName: string | null;
  siteArea: string | null;
  otherDelAreaName: string | null;
  remark: string | null;
  promoType: string | null;
  noArticle: string | null;
  disQty: string | null;
  netWeight: string | null;
}

interface TripDetail {
  tripNo: string;
  disDate: string;
  header: {
    deliveryType: string | null;
    disTime: string | null;
    vehicleNo: string | null;
    vehType: string | null;
    vModal: string | null;
    driverName: string | null;
    driverMobile: string | null;
    transporter: string | null;
    dieselAmt: string | null;
  };
  drops: TripDrop[];
  dropCount: number;
  totals: { articles: number; qty: number; weight: number };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateObj(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00+05:30");
}

function toDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function shiftDateStr(dateStr: string, days: number): string {
  const d = toDateObj(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function formatDayShort(dateStr: string): string {
  return toDateObj(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

function shortTypeLabel(type: string | null): string {
  if (!type) return "—";
  return type.toLowerCase().includes("up") ? "UPC" : type;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtRowNum(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "—";
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtMoney(raw: string | null | undefined): string {
  if (!raw) return "—";
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n === 0) return "—";
  return "₹" + n.toLocaleString("en-IN");
}

function normType(v: string): string {
  return v.toLowerCase().replace(/[\s-]/g, "");
}

// Map segment/pill labels → canonical DB deliveryType values (normTyped).
// Extend this if new delivery types appear in trip_report.
const SEGMENT_TO_DB_VALUES: Record<string, string[]> = {
  local: ["local"],
  upcountry: ["upc"],
};

function matchesTypeFilter(deliveryType: string | null, filterLabel: string): boolean {
  const dbNorm = normType(deliveryType ?? "");
  const filterNorm = normType(filterLabel);
  const allowed = SEGMENT_TO_DB_VALUES[filterNorm];
  if (allowed) return allowed.includes(dbNorm);
  // Fallback: direct comparison
  return dbNorm === filterNorm;
}

function typeDotColor(type: string | null): string {
  if (!type) return "bg-gray-400";
  const t = type.toLowerCase();
  if (t.includes("up")) return "bg-orange-600";
  if (t.includes("local")) return "bg-blue-600";
  return "bg-gray-400";
}

function dropTag(d: TripDrop): "INV" | "PROMO" {
  // promoType is the NTS "INV TYPE" column, values {"INV","PROMO"}, non-empty on
  // every row. Only a literal PROMO is a promo; anything else defaults to INV.
  return isPromoRow(d) ? "PROMO" : "INV";
}

// Customer name + a muted "(Remark)" — the remark shows only when Other
// Delivery Area is filled (see resolveCustomerLabelParts). Shared by the
// desktop table + mobile drop card so both style the remark identically.
function CustomerLabel({ d }: { d: TripDrop }) {
  const { main, remark } = resolveCustomerLabelParts(
    d.siteName,
    d.custName,
    d.otherDelAreaName,
    d.remark,
  );
  return (
    <>
      {main}
      {remark ? <span className="text-gray-400 font-normal"> ({remark})</span> : null}
    </>
  );
}

function formatCaptionDate(isoDate: string, time: string | null): string {
  const d = new Date(isoDate + "T00:00:00+05:30");
  const day = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
  if (!time || time.trim() === "") return day;
  // time is "HH:MM:SS" or "HH:MM" — parse to 12h
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const timeStr = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  return `${day} ${timeStr}`;
}

function buildShareCaption(tripNo: string, detail: TripDetail): string {
  const lines: string[] = [];

  // Line 1: trip + type
  const type = detail.header.deliveryType ?? "";
  lines.push(`🚚 Trip ${tripNo}${type ? ` · ${type}` : ""}`);

  // Line 2: date + time
  lines.push(`🕐 ${formatCaptionDate(detail.disDate, detail.header.disTime)}`);

  // Line 3: driver first name (skip if no name)
  const driverFull = smartTitleCase(detail.header.driverName) || "";
  const driverFirst = driverFull.split(" ")[0] || "";
  const driverMobile = (detail.header.driverMobile ?? "").trim();
  if (driverFirst) {
    lines.push(driverMobile ? `👤 ${driverFirst} · ${driverMobile}` : `👤 ${driverFirst}`);
  }

  // Line 4: drops (unique customers)
  const count = detail.dropCount;
  lines.push(`📦 ${count} ${count === 1 ? "drop" : "drops"}`);

  // Line 5: unique RULE A delivery areas. Dedup in deliveryNo order so the
  // caption reads identically to the list column (disTime is constant within a
  // trip, so deliveryNo is the deterministic shared order both surfaces use).
  const orderedDrops = [...detail.drops].sort((a, b) =>
    (a.deliveryNo ?? "").localeCompare(b.deliveryNo ?? ""),
  );
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const d of orderedDrops) {
    const area = resolveDeliveryArea(d);
    if (area && !seen.has(area)) {
      seen.add(area);
      areas.push(smartTitleCase(area));
    }
  }
  if (areas.length > 0) {
    lines.push(`📍 ${areas.join(", ")}`);
  }

  return lines.join("\n");
}

const th = "text-left px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400";
const thNum = "text-right px-3.5 text-[10px] font-medium uppercase tracking-wider text-gray-400";

// ── Main page ────────────────────────────────────────────────────────────────

export function TripReportPage() {
  const [dateStr, setDateStr] = useState(() => getTodayIST());
  const [typeFilter, setTypeFilter] = useState<string | number | null>(null);
  const [search, setSearch] = useState("");
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const [selectedTripNo, setSelectedTripNo] = useState<string | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async (d: string) => {
    setListLoading(true);
    try {
      const res = await fetch(`/api/trips?date=${d}`);
      if (!res.ok) throw new Error("Failed to fetch trips");
      const data = (await res.json()) as TripsListResponse;
      setTrips(data.trips);
    } catch {
      setTrips([]);
      toast.error("Failed to load trip report");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedTripNo(null);
    setDetail(null);
    fetchList(dateStr);
  }, [dateStr, fetchList]);

  const fetchDetail = useCallback(async (tripNo: string, d: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripNo)}?date=${d}`);
      if (!res.ok) {
        setDetail(null);
        toast.error("Trip not found");
        return;
      }
      const data = (await res.json()) as TripDetail;
      setDetail(data);
    } catch {
      setDetail(null);
      toast.error("Failed to load trip details");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedTripNo) fetchDetail(selectedTripNo, dateStr);
  }, [selectedTripNo, dateStr, fetchDetail]);

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (typeFilter && !matchesTypeFilter(t.deliveryType, String(typeFilter))) return false;
      if (!q) return true;
      return (
        t.tripNo.toLowerCase().includes(q) ||
        (t.vehicleNo ?? "").toLowerCase().includes(q) ||
        (t.driverName ?? "").toLowerCase().includes(q)
      );
    });
  }, [trips, typeFilter, search]);

  // Mobile search additionally matches on delivery areas (mockup requirement).
  // Kept as its own memo so the desktop table's `filteredTrips` above — and its
  // behaviour — is untouched.
  const mobileFilteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (typeFilter && !matchesTypeFilter(t.deliveryType, String(typeFilter))) return false;
      if (!q) return true;
      return (
        t.tripNo.toLowerCase().includes(q) ||
        (t.driverName ?? "").toLowerCase().includes(q) ||
        (t.vehicleNo ?? "").toLowerCase().includes(q) ||
        (t.deliveryAreas ?? "").toLowerCase().includes(q)
      );
    });
  }, [trips, typeFilter, search]);

  if (selectedTripNo) {
    return (
      <TripDetailsView
        tripNo={selectedTripNo}
        detail={detail}
        loading={detailLoading}
        onBack={() => setSelectedTripNo(null)}
      />
    );
  }

  const isToday = dateStr === getTodayIST();

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* ── Desktop header (md and up) — unchanged ──────────────────────── */}
      <div className="hidden md:block">
        <UniversalHeader
          title="Trip Report"
          stats={[{ label: "trips", value: filteredTrips.length }]}
          segments={[
            { id: "Local", label: "Local" },
            { id: "Up-Country", label: "Up-Country" },
          ]}
          activeSegment={typeFilter}
          onSegmentChange={setTypeFilter}
          currentDate={toDateObj(dateStr)}
          onDateChange={(d) => setDateStr(toDateStr(d))}
          searchPlaceholder="Search trip / vehicle / driver"
          searchValue={search}
          onSearchChange={setSearch}
        />
      </div>

      {/* ── Mobile app bar (below md) — sticky: brand row + search + day/type pills ── */}
      <div className="md:hidden sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="bg-teal-600 px-3.5 py-3 flex items-center gap-2.5">
          <svg viewBox="0 0 22 22" width="18" height="18">
            <circle cx="11" cy="11" r="7" fill="none" stroke="#fff" strokeWidth="1.5" />
            <circle cx="11" cy="11" r="2.3" fill="#fff" />
            <circle cx="18" cy="11" r="2" fill="#fff" />
          </svg>
          <span className="text-white font-semibold text-[15px]">Trip Report</span>
          <span className="text-white/75 text-[12px] ml-auto">{mobileFilteredTrips.length} trips</span>
        </div>

        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-center gap-2 bg-gray-100 rounded-[11px] px-3 h-[42px]">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search driver, trip, vehicle, area…"
              className="flex-1 bg-transparent border-none outline-none text-[16px] text-gray-900 placeholder:text-gray-400"
            />
          </div>
        </div>

        <div className="px-3 pb-2.5 pt-0.5 flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-full p-1">
            <button
              type="button"
              onClick={() => setDateStr(shiftDateStr(dateStr, -1))}
              className="w-[22px] h-[22px] rounded-full bg-gray-100 text-gray-500 text-[13px] flex items-center justify-center cursor-pointer"
              aria-label="Previous day"
            >
              &lsaquo;
            </button>
            <span className="text-[12px] font-semibold px-0.5">{formatDayShort(dateStr)}</span>
            <button
              type="button"
              onClick={() => !isToday && setDateStr(shiftDateStr(dateStr, 1))}
              disabled={isToday}
              className={`w-[22px] h-[22px] rounded-full bg-gray-100 text-[13px] flex items-center justify-center ${
                isToday ? "text-gray-300 cursor-not-allowed" : "text-gray-500 cursor-pointer"
              }`}
              aria-label="Next day"
            >
              &rsaquo;
            </button>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <MobileFilterPill label="All" active={typeFilter === null} onClick={() => setTypeFilter(null)} />
            <MobileFilterPill label="Local" active={typeFilter === "Local"} onClick={() => setTypeFilter("Local")} />
            <MobileFilterPill label="UPC" active={typeFilter === "Up-Country"} onClick={() => setTypeFilter("Up-Country")} />
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
        {/* ── Desktop table (md and up) — unchanged ─────────────────────── */}
        <div className="hidden md:block bg-white border border-gray-200 rounded-lg overflow-hidden">
          {listLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : filteredTrips.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-gray-400">No trips for this date.</div>
          ) : (
            <div className="overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 920 }}>
                <colgroup>
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "17%" }} />
                  <col style={{ width: "6%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "9%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#ebebeb] bg-gray-50">
                    <th className={th} style={{ height: 32 }}>Trip</th>
                    <th className={th}>Type</th>
                    <th className={th}>Time</th>
                    <th className={th}>Vehicle</th>
                    <th className={th}>Driver</th>
                    <th className={th}>Delivery Areas</th>
                    <th className={`${thNum} border-l border-gray-200`}>Drops</th>
                    <th className={thNum}>LT</th>
                    <th className={thNum}>KG</th>
                    <th className={thNum}>Diesel</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTrips.map((t) => (
                    <tr
                      key={t.tripNo}
                      onClick={() => setSelectedTripNo(t.tripNo)}
                      className="border-b border-[#f0f0f0] hover:bg-gray-50/50 cursor-pointer"
                      style={{ height: 36 }}
                    >
                      <td className="px-3.5 text-[11px] font-medium text-gray-900 truncate">{t.tripNo}</td>
                      <td className="px-3.5 text-[11px] text-gray-600">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`inline-block w-[5px] h-[5px] rounded-full flex-shrink-0 ${typeDotColor(t.deliveryType)}`} />
                          {t.deliveryType ?? "—"}
                        </span>
                      </td>
                      <td className="px-3.5 text-[11px] text-gray-600 font-mono">{t.disTime ?? "—"}</td>
                      <td className="px-3.5 text-[11px] font-medium text-gray-900 font-mono truncate">{t.vehicleNo ?? "—"}</td>
                      <td className="px-3.5 text-[11px] text-gray-600 truncate">{smartTitleCase(t.driverName) || "—"}</td>
                      <td className="px-3.5 text-[11px] text-gray-400 truncate">{t.deliveryAreas ? smartTitleCase(t.deliveryAreas) : "—"}</td>
                      <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right border-l border-gray-200">{t.dropCount}</td>
                      <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right">{fmtNum(t.totalQty)}</td>
                      <td className="px-3.5 text-[11px] text-gray-600 text-right">{fmtNum(t.totalWeight)}</td>
                      <td className="px-3.5 text-[11px] text-gray-600 text-right">{fmtMoney(t.dieselAmt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Mobile cards (below md) — matches trip-report-mobile-mock.html ── */}
        <div className="md:hidden -mx-4 -my-3 px-3 py-2.5">
          {listLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : mobileFilteredTrips.length === 0 ? (
            <div className="py-16 text-center text-[12px] text-gray-400">No trips for this date.</div>
          ) : (
            <div>
              {mobileFilteredTrips.map((t) => (
                <div
                  key={t.tripNo}
                  onClick={() => setSelectedTripNo(t.tripNo)}
                  className="bg-white border border-gray-200 rounded-[14px] p-[13px] mb-[9px] shadow-sm cursor-pointer active:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[16px] font-extrabold text-gray-900">{t.tripNo}</span>
                      <span className={`inline-block w-[6px] h-[6px] rounded-full flex-shrink-0 ${typeDotColor(t.deliveryType)}`} />
                      <span className="text-[11px] text-gray-500">{shortTypeLabel(t.deliveryType)}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 font-mono">{t.disTime ?? "—"}</span>
                  </div>
                  <div className="text-[13.5px] font-bold text-gray-900 mt-2">
                    {smartTitleCase(t.driverName) || "—"}
                  </div>
                  <div className="text-[11.5px] text-gray-400 truncate mt-0.5">
                    {t.deliveryAreas ? smartTitleCase(t.deliveryAreas) : "—"}
                  </div>
                  <div className="flex justify-between mt-[11px] pt-[10px] border-t border-gray-100">
                    <MobileStat label="Drops" value={String(t.dropCount)} />
                    <MobileStat label="LT" value={fmtNum(t.totalQty)} />
                    <MobileStat label="KG" value={fmtNum(t.totalWeight)} />
                    <MobileStat label="Diesel" value={fmtMoney(t.dieselAmt)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Details view ─────────────────────────────────────────────────────────────

function TripDetailsView({
  tripNo,
  detail,
  loading,
  onBack,
}: {
  tripNo: string;
  detail: TripDetail | null;
  loading: boolean;
  onBack: () => void;
}) {
  const [sharingImage, setSharingImage] = useState(false);

  async function handleShareWhatsApp() {
    if (!detail || sharingImage) return;
    setSharingImage(true);
    try {
      const caption = buildShareCaption(tripNo, detail);
      const result = await shareTripSheetImage({
        caption,
        sheet: {
          tripNo,
          date: detail.disDate,
          header: {
            deliveryType: detail.header.deliveryType,
            disTime: detail.header.disTime,
            vehicleNo: detail.header.vehicleNo,
            driverName: detail.header.driverName,
            driverMobile: detail.header.driverMobile,
          },
          drops: detail.drops.map((d) => ({
            deliveryNo: d.deliveryNo,
            custName: d.custName,
            siteName: d.siteName,
            siteArea: d.siteArea,
            otherDelAreaName: d.otherDelAreaName,
            custAreaName: d.custAreaName,
            remark: d.remark,
            noArticle: d.noArticle,
            disQty: d.disQty,
            netWeight: d.netWeight,
          })),
          dropCount: detail.dropCount,
          totals: { articles: detail.totals.articles, qty: detail.totals.qty, weight: detail.totals.weight },
        },
      });
      if (result === "downloaded") {
        toast("Image downloaded — attach it in WhatsApp");
      }
    } catch (err) {
      console.error("Trip sheet share failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't prepare the trip sheet image: ${reason}`);
    } finally {
      setSharingImage(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* ── Desktop (md and up) — unchanged ─────────────────────────────── */}
      <div className="hidden md:block px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="text-[12px] text-teal-600 hover:text-teal-700 mb-3 cursor-pointer"
        >
          &larr; Back to trip list
        </button>

        {loading || !detail ? (
          <div className="bg-white border border-gray-200 rounded-lg py-16 flex items-center justify-center text-gray-400">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Header block */}
            <div className="p-4 border-b border-gray-100 flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[18px] font-bold text-gray-900">{detail.tripNo}</span>
                  <span
                    className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                      normType(detail.header.deliveryType ?? "") === normType("Local")
                        ? "bg-blue-50 text-blue-700"
                        : "bg-orange-50 text-orange-700"
                    }`}
                  >
                    {detail.header.deliveryType ?? "—"}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  {detail.disDate} &middot; dispatch {detail.header.disTime ?? "—"}
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/trips/${encodeURIComponent(detail.tripNo)}/sheet?date=${detail.disDate}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-medium h-[38px] px-4 rounded-lg cursor-pointer"
                >
                  Trip sheet (PDF)
                </a>
                <button
                  type="button"
                  onClick={handleShareWhatsApp}
                  disabled={sharingImage}
                  className="bg-[#25D366] hover:opacity-90 text-white text-[13px] font-medium h-[38px] px-4 rounded-lg cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sharingImage ? "Preparing…" : "Share WhatsApp"}
                </button>
              </div>
            </div>

            {/* Info grid */}
            <div className="grid grid-cols-5 gap-px bg-gray-100 border-b border-gray-100">
              <InfoCell label="Vehicle" value={detail.header.vehicleNo ?? "—"} mono />
              <InfoCell label="Driver" value={smartTitleCase(detail.header.driverName) || "—"} />
              <InfoCell label="Driver Mobile" value={detail.header.driverMobile ?? "—"} mono />
              <InfoCell label="Transporter" value={detail.header.transporter ? smartTitleCase(detail.header.transporter) : "—"} />
              <InfoCell label="Diesel" value={fmtMoney(detail.header.dieselAmt)} />
            </div>

            {/* Drops table */}
            <div className="overflow-x-auto">
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", minWidth: 900 }}>
                <colgroup>
                  <col style={{ width: "4%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "26%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "22%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "5%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-[#ebebeb] bg-gray-50">
                    <th className={th} style={{ height: 32 }}>#</th>
                    <th className={th}>Delivery No</th>
                    <th className={th}>Customer</th>
                    <th className={th}>Cust Area</th>
                    <th className={th}>Delivery Area</th>
                    <th className={th}>Tag</th>
                    <th className={`${thNum} border-l border-gray-200`}>Articles</th>
                    <th className={thNum}>LT</th>
                    <th className={thNum}>KG</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.drops.map((d, i) => {
                    const tag = dropTag(d);
                    return (
                      <tr key={d.deliveryNo ?? i} className="border-b border-[#f0f0f0]" style={{ height: 36 }}>
                        <td className="px-3.5 text-[11px] text-gray-400">{i + 1}</td>
                        <td className="px-3.5 text-[11px] font-medium text-gray-900 font-mono truncate">{d.deliveryNo ?? "—"}</td>
                        <td className="px-3.5 text-[11px] font-medium text-gray-900 truncate"><CustomerLabel d={d} /></td>
                        <td className="px-3.5 text-[11px] text-gray-600 truncate">{smartTitleCase(d.custAreaName) || "—"}</td>
                        <td className="px-3.5 text-[11px] text-gray-600 truncate">{smartTitleCase(resolveDeliveryArea(d)) || "—"}</td>
                        <td className="px-3.5">
                          <span
                            className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                              tag === "INV" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"
                            }`}
                          >
                            {tag}
                          </span>
                        </td>
                        <td className="px-3.5 text-[11px] text-gray-600 text-right border-l border-gray-200">{fmtRowNum(d.noArticle)}</td>
                        <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right">{fmtRowNum(d.disQty)}</td>
                        <td className="px-3.5 text-[11px] text-gray-600 text-right">{fmtRowNum(d.netWeight)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50">
                    <td colSpan={6} className="px-3.5 text-[11px] font-medium text-gray-900 text-right" style={{ height: 36 }}>
                      Total
                    </td>
                    <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right border-l border-gray-200">
                      {fmtNum(detail.totals.articles)}
                    </td>
                    <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right">{fmtNum(detail.totals.qty)}</td>
                    <td className="px-3.5 text-[11px] font-medium text-gray-900 text-right">{fmtNum(detail.totals.weight)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Mobile (below md) — app-style, matches trip-report-mobile-mock.html ── */}
      <div className="md:hidden">
        <div className="sticky top-0 z-30 bg-teal-600 px-3.5 py-3 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="text-white text-[20px] leading-none cursor-pointer"
            aria-label="Back to trip list"
          >
            &lsaquo;
          </button>
          <span className="text-white font-semibold text-[15px]">{tripNo}</span>
          {detail && (
            <span className="text-white/80 text-[12px]">&middot; {detail.header.deliveryType ?? "—"}</span>
          )}
        </div>

        <div className="p-3">
          {loading || !detail ? (
            <div className="bg-white border border-gray-200 rounded-[14px] py-16 flex items-center justify-center text-gray-400">
              <Loader2 className="animate-spin" size={18} />
            </div>
          ) : (
            <>
              {/* Header card */}
              <div className="bg-white border border-gray-200 rounded-[14px] p-[13px] mb-[9px] shadow-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-[20px] font-extrabold text-gray-900">{detail.tripNo}</span>
                  <span className="text-[12px] text-gray-500">
                    {formatDayShort(detail.disDate)} &middot; {detail.header.disTime ?? "—"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-[9px] gap-y-[9px] mt-[11px]">
                  <MobileStat label="Driver" value={smartTitleCase(detail.header.driverName) || "—"} large />
                  <MobileStat label="Mobile" value={detail.header.driverMobile ?? "—"} mono large />
                  <MobileStat label="Vehicle" value={detail.header.vehicleNo ?? "—"} mono large />
                  <MobileStat label="Diesel" value={fmtMoney(detail.header.dieselAmt)} large />
                  <MobileStat
                    label="Transporter"
                    value={detail.header.transporter ? smartTitleCase(detail.header.transporter) : "—"}
                    large
                  />
                  <MobileStat label="Drops" value={String(detail.dropCount)} large />
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-[9px] mb-[11px]">
                <a
                  href={`/trips/${encodeURIComponent(detail.tripNo)}/sheet?date=${detail.disDate}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center bg-teal-600 hover:bg-teal-700 text-white text-[13px] font-semibold h-[44px] rounded-[12px] cursor-pointer"
                >
                  Trip sheet
                </a>
                <button
                  type="button"
                  onClick={handleShareWhatsApp}
                  disabled={sharingImage}
                  className="flex-1 bg-[#25D366] hover:opacity-90 text-white text-[13px] font-semibold h-[44px] rounded-[12px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {sharingImage ? "Preparing…" : "Share WhatsApp"}
                </button>
              </div>

              {/* Drop cards */}
              <div>
                {detail.drops.map((d, i) => {
                  const tag = dropTag(d);
                  return (
                    <div
                      key={d.deliveryNo ?? i}
                      className="bg-white border border-gray-200 rounded-[14px] p-[13px] mb-[9px] shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-bold text-gray-900">
                          {i + 1}. <CustomerLabel d={d} />
                        </span>
                        <span
                          className={`flex-shrink-0 text-[9.5px] font-semibold px-[7px] py-0.5 rounded-full ${
                            tag === "INV" ? "bg-blue-50 text-blue-700" : "bg-green-50 text-green-700"
                          }`}
                        >
                          {tag}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-600 font-mono mt-[3px]">{d.deliveryNo ?? "—"}</div>
                      <div className="text-[11.5px] text-gray-400 truncate mt-0.5">
                        {smartTitleCase(resolveDeliveryArea(d)) || "—"}
                      </div>
                      <div className="flex gap-5 mt-[9px] pt-2 border-t border-gray-100">
                        <MobileStat label="Art" value={fmtRowNum(d.noArticle)} />
                        <MobileStat label="LT" value={fmtRowNum(d.disQty)} />
                        <MobileStat label="KG" value={fmtRowNum(d.netWeight)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-50 px-3.5 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`text-[11px] font-medium text-gray-900 mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

// Compact label+value pair used in mobile card layouts (list + details).
// `large` bumps the value to the details header-card size (13px/semibold).
function MobileStat({
  label,
  value,
  mono,
  large,
}: {
  label: string;
  value: string;
  mono?: boolean;
  large?: boolean;
}) {
  return (
    <div>
      <div className="text-[9.5px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
      <div
        className={`mt-0.5 text-gray-900 ${large ? "text-[13px] font-semibold" : "text-[11px] font-medium"} ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// Pill used in the mobile app bar's All/Local/UPC type filter row.
function MobileFilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-3 py-[5px] rounded-full border cursor-pointer ${
        active
          ? "bg-teal-600 text-white border-teal-600 font-medium"
          : "bg-white text-gray-500 border-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
