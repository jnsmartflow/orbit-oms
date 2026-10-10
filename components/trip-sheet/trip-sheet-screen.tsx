"use client";

// /trip-sheets/[id] — one Orbit trip on the phone (2026-10-09). Spec
// docs/prompts/drafts/web-update-2026-10-09-trip-sheet.md §4: bill cards
// grouped by stop in the SHEET's order, no bottom tab bar, no sheet preview and
// no Print button on screen, a floating "Share on WhatsApp" that sends the A4
// sheet as an image + caption (lib/trip-sheet/share-image.ts).
//
// READ-ONLY. The sheet arrives from the server page; Share captures it from
// memory — no fetch, no write.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Building2, CheckCircle2, ChevronLeft, Loader2, PackageCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { RoleLayoutClient } from "@/components/shared/role-layout-client";
import type { RoleSidebarRole } from "@/components/shared/role-sidebar";
import type { NavItemConfig } from "@/lib/permissions";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { TripSheet, TripSheetBill } from "@/lib/trip-sheet/types";
import { CallButton, CardShell, CardShelf, fmtNum } from "./card-bits";

/** WhatsApp's own green — the share target's colour, not a brand or status token. */
const WHATSAPP_GREEN = "#25D366";

export function TripSheetScreen({
  sheet,
  backHref,
  role,
  userName,
  userInitials,
  navItems,
}: {
  sheet: TripSheet;
  /** The list this screen came from — date and tab kept. */
  backHref: string;
  role: RoleSidebarRole;
  userName: string;
  userInitials: string;
  navItems: NavItemConfig[];
}) {
  const h = sheet.header;
  const [sharing, setSharing] = useState(false);
  // The capture code + the inlined logo (~140 KB) are a separate chunk so the
  // screen paints without them — but they are fetched as soon as the screen
  // MOUNTS, not on the tap (2026-10-10): the logo string is in memory before the
  // hidden sheet renders, and the tap does not spend iOS's share gesture window
  // on a network fetch. The tap awaits the same promise.
  const shareModule = useRef<Promise<typeof import("@/lib/trip-sheet/share-image")> | null>(null);
  useEffect(() => {
    if (h.isHand) return;
    shareModule.current = import("@/lib/trip-sheet/share-image");
    shareModule.current.catch(() => {
      shareModule.current = null; // retried on the tap
    });
  }, [h.isHand]);

  async function onShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const { shareTripSheet } = await (shareModule.current ?? import("@/lib/trip-sheet/share-image"));
      const outcome = await shareTripSheet(sheet);
      if (outcome === "downloaded") toast("Image downloaded and caption copied — attach it in WhatsApp");
    } catch (err) {
      console.error("Trip sheet share failed:", err);
      toast.error(`Couldn't prepare the trip sheet image: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSharing(false);
    }
  }

  // "{Driver full name} · {vehicle} · {time}" — driver first (2026-10-10), the trip SNAPSHOT.
  const driverName = smartTitleCase(h.driverName);
  const subline = [driverName || "No driver", h.vehicleNo ?? (h.isHand ? "Hand" : "No vehicle"), h.timeLabel ?? "—"].join(" · ");

  return (
    <RoleLayoutClient role={role} userName={userName} userInitials={userInitials} navItems={navItems} hideBar>
      <div className="fixed inset-0 md:left-[72px] flex flex-col overflow-hidden bg-[#f9fafb]">
        {/* Detail masthead — the pale ground, white back button (UI §59.8). */}
        <div className="flex-shrink-0 bg-[#F5F3FF] border-b border-ink-100">
          <div
            className="mx-auto w-full max-w-[480px] flex items-center gap-2.5 px-3.5"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 11px)", paddingBottom: "10px" }}
          >
            <Link
              href={backHref}
              aria-label="Back to trip sheets"
              className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-white border border-ink-100 flex items-center justify-center text-ink-600 active:bg-ink-50 shrink-0"
            >
              <ChevronLeft size={20} />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="font-mono text-[17px] font-extrabold text-brand-600 tracking-tight truncate">{h.tripNumber}</h1>
              <div className="flex items-center gap-2 min-w-0">
                <p className="truncate text-[11.5px] font-medium text-ink-500 tabular-nums">{subline}</p>
              </div>
            </div>
            {!h.isHand && <CallButton phone={h.driverPhone} name={driverName || null} />}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: h.isHand ? 24 : "calc(100px + env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto w-full max-w-[480px] px-3 pt-3">
            {h.isHand ? (
              <p className="py-16 text-center text-[13px] text-[#98a2b3]">Hand trip — no trip sheet</p>
            ) : sheet.stops.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-[#98a2b3]">No bills on this trip</p>
            ) : (
              sheet.stops.map((s) => (
                <section key={s.dropId} className="mb-1">
                  <div className="flex items-center gap-2 px-0.5 pt-2 pb-2">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-[#eef1f5] text-[#667085] text-[11px] font-bold flex items-center justify-center tabular-nums">
                      {s.no}
                    </span>
                    {/* SITE — the effective delivery point is a site (loader isSite,
                        isSiteDelivery). Phone only; the A4 sheet does not show it. */}
                    {s.isSite && (
                      <Building2 size={15} className="shrink-0 text-[#98a2b3]" aria-label="Site" role="img" />
                    )}
                    <span className="min-w-0 truncate text-[14.5px] font-bold text-[#1d2939]">{smartTitleCase(s.name)}</span>
                    <span className="ml-auto shrink-0 pl-2 text-[12px] font-medium text-[#98a2b3]">{smartTitleCase(s.area) || "—"}</span>
                  </div>
                  {s.bills.map((b) => (
                    <BillCard key={`${s.dropId}-${b.orderId}`} bill={b} />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>

        {/* Floating Share — fixed at the bottom, safe-area aware. Hidden on a Hand trip. */}
        {!h.isHand && (
          <div
            className="fixed inset-x-0 bottom-0 md:left-[72px] z-30 px-3 pt-2"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
          >
            <button
              type="button"
              onClick={onShare}
              disabled={sharing}
              className="mx-auto flex h-[52px] w-full max-w-[456px] items-center justify-center gap-2 rounded-full text-[15.5px] font-bold text-white shadow-[0_8px_22px_rgba(37,211,102,0.38)] active:opacity-90 disabled:opacity-70"
              style={{ background: WHATSAPP_GREEN }}
            >
              {sharing ? <Loader2 className="animate-spin" size={20} /> : null}
              {sharing ? "Preparing…" : "Share on WhatsApp"}
            </button>
          </div>
        )}
      </div>
    </RoleLayoutClient>
  );
}

function BillCard({ bill }: { bill: TripSheetBill }) {
  const showBillTo = bill.shipToChanged && !!bill.billToName && bill.billToName.trim() !== "";
  return (
    <CardShell>
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2 font-mono text-[14.5px] font-semibold text-[#1d2939]">
          {bill.number}
          {bill.gift && (
            <span className="rounded-full bg-[#eef1f5] px-2 py-px font-sans text-[10.5px] font-bold text-[#667085]">Gift</span>
          )}
          {bill.redel && (
            <span className="rounded-full bg-warn-bg px-2 py-px font-sans text-[10.5px] font-bold text-warn-text">Re-del</span>
          )}
        </div>
        {showBillTo && (
          <div className="mt-1.5 flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-px text-[10.5px] font-bold text-brand-700">↪ Ship-to changed</span>
            <span className="truncate text-[12.5px] text-[#667085]">Bill of {smartTitleCase(bill.billToName)}</span>
          </div>
        )}
        {/* PHONE ONLY (2026-10-10) — never on the A4 sheet or in the caption. */}
        {bill.soName && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#475467]">
            <UserRound size={14} className="shrink-0 text-brand-600" />
            <span className="truncate">SO: {smartTitleCase(bill.soName)}</span>
          </div>
        )}
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12.5px] text-[#475467]">
          <PackageCheck size={14} className="shrink-0 text-[#98a2b3]" />
          <span className="truncate">
            {bill.directLoaded ? "Direct loading" : <>Picked: {bill.pickerName ? smartTitleCase(bill.pickerName) : "—"}</>}
            <span className="text-[#c3c9d0]">{" · "}</span>
            Checked:{" "}
            {bill.checkerName ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 size={13} className="text-ok" />
                {smartTitleCase(bill.checkerName)}
              </span>
            ) : (
              <span className="text-[#98a2b3]">—</span>
            )}
          </span>
        </div>
      </div>
      <CardShelf
        pills={[
          `${fmtNum(bill.articles)} Art`,
          `${fmtNum(bill.litres)} L`,
          `${bill.kg === null ? "—" : fmtNum(bill.kg)} kg`,
        ]}
      />
    </CardShell>
  );
}
