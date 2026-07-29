"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, Star } from "lucide-react";
import { toast } from "sonner";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { AgeBadge, FamilyChip, UnlistedChip } from "./card-atoms";
import { usePickerBoard } from "./picking-mobile-shell";
import type { PickingQueueRow } from "@/lib/picking/types";
import type { PickerRosterEntry } from "@/lib/picking/picker-roster";
import { usePickingMarker } from "@/lib/hooks/use-picking-marker";

// Card shell shadow — lifted verbatim from picking-board-mobile.tsx's
// SOFT_CARD_SHADOW, the fidelity source for this whole face
// (docs/mockups/picking/picker-my-bills.html is the approved design; the
// live component is the source of truth wherever the two would disagree).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

// Same sentinel/convention as picking-board-mobile.tsx's detail screen —
// kept out of the "ALL" bucket so a null-pack line stays isolable.
const NO_PACK_KEY = "__no_pack__";

// Real GET /api/picking/order/[orderId] response shape — see that route.
// Duplicated from picking-board-mobile.tsx rather than imported: that file
// is untouched this stage (per constraints), and this shape is small/stable.
interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  qty: number;
}

interface PickerMyPicksBoardProps {
  pending: PickingQueueRow[];
  done: PickingQueueRow[];
  isAdmin: boolean;
  pickers: PickerRosterEntry[];
  activePickerId: number | null;
}

// Same locale/timezone/format as picking-board-mobile.tsx's
// formatAssignedTime — duplicated (see file-top note), not imported.
// Returns null when pickedAt is missing (the "Done" tab card omits the
// time rather than fabricating one) — matches this file's own convention
// for every other nullable-timestamp display.
function formatPickedTime(pickedAt: Date | string | null): string | null {
  if (pickedAt === null) return null;
  const d = new Date(pickedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
}

// Same rounding/formatting rule as picking-board-mobile.tsx's formatLitres —
// duplicated (see file-top note), not imported.
function formatLitres(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const isWhole = Number.isInteger(rounded);
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

// The local TopBarTab copy that used to live here (a self-declared third
// copy of picking-board-mobile.tsx's original) was DELETED 2026-07-29: the
// Pending/Done strip moved to the shared bottom bar (WorkflowTabBar, driven
// by PickerPickingShell in picking-mobile-shell.tsx), the same Direction-A
// move the supervisor board made on 2026-07-19. CLAUDE_PICKING.md §5.4's
// note that this face "keeps a local TopBarTab copy" is now stale.

/**
 * The picker's own list. `pending`/`done` arrive already scoped server-side
 * (page.tsx filters lib/picking/queue.ts's rows by pickerId before this
 * component ever sees them) — this component does not widen that scope
 * itself, including for the Mark Done write below (POSTs the same
 * server-resolved `activePickerId`, never a client-invented identity).
 * Mark Done is fire-and-forget — toast, then back to the list via
 * router.refresh(); no confirm sheet (the Done tab is the safety net).
 */
export function PickerMyPicksBoard({
  pending, done, isAdmin, pickers, activePickerId,
}: PickerMyPicksBoardProps): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();

  // Menu/You handlers + the signed-in user's initials for the shared header.
  // The provider is already mounted globally by role-layout-client.tsx:46 —
  // this face reaches the SAME sheet instances the bottom bar used to open,
  // so no second copy of that markup is mounted.
  const { openMenu, openYou, userInitials } = useMobileShell();

  // Tab state now lives ONE level up, in PickerPickingShell — the bottom bar
  // that switches it is rendered by RoleLayoutClient, which sits ABOVE this
  // board in the tree (same reason the supervisor board's activeTab moved to
  // SupervisorPickingShell in Stage 3). `activeTab` is read-only here — this
  // face's only two writers were the TopBarTabs that came out with the strip.
  //
  // `detailOpen` moved up with it (2026-07-29) so the shell can pass hideBar:
  // the bar is z-40 and this face's detail overlay is z-[35], so it used to
  // float over an open bill and a tab tap swapped the list underneath it. Read
  // AND written here — every open/close call site is in this file — and it
  // still drives the marker pause below exactly as before.
  const { activeTab, detailOpen, setDetailOpen } = usePickerBoard();

  // Detail overlay — always-mounted, translateX slide, same pattern as
  // picking-board-mobile.tsx's detail screen (board.tsx:1083-1267) so the
  // list underneath is never torn down. NO tick boxes, NO Mark done CTA —
  // both are later stages.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);
  const [activePackFilter, setActivePackFilter] = useState<string>("ALL");
  // In-flight guard — disables the CTA so a double-tap can't fire two
  // overlapping POSTs (the server's own PICK_ASSIGNED guard would 409 the
  // second one anyway, but this avoids firing it at all).
  const [marking, setMarking] = useState(false);

  // Live sync (2026-07-22) — poll the cheap marker every 15s; on a real change,
  // router.refresh() re-runs the server page (app/picking/page.tsx) for fresh
  // pending/done props. The marker GATE is load-bearing here: router.refresh()
  // is materially heavier than the other two surfaces' client refetches (it
  // re-runs auth + permissions + getActivePickers + getPickingQueue), so it must
  // fire ONLY when the board actually moved, never on a bare timer.
  //
  // scope="openPending" — the SAME scope page.tsx derives this board from
  // (page.tsx:136 getPickingQueue({ scope: "openPending" }), then filters rows
  // by pickerId). pickerId=activePickerId NARROWS the marker to THIS picker's
  // rows (page.tsx:138 filters r.pickerId === viewerId; activePickerId is that
  // same server-resolved identity, already a prop — not a new one). So his phone
  // only refreshes when HIS bills change — assigned-to-him, his mark-done, a
  // supervisor approving his bill, or a bill leaving his set (unassign/reassign-
  // away drops the marker COUNT) — never on a board-wide edit that isn't his.
  // Falls back to board-wide (undefined) only when no picker is resolved, when
  // the board is empty anyway.
  //
  // paused = detailOpen || marking. detailOpen — NOT detailOrderId, which never
  // resets to null once a bill has been opened (closeDetail only flips
  // detailOpen), so it would pause forever after the first open — is the true
  // "detail visibly open" signal. A refresh while a bill is open could shift or
  // blank detailRow ([...pending,...done].find, below) if the bill left his
  // scope; deferring until he backs out avoids that. On unpause, if the marker
  // moved meanwhile, the hook fires router.refresh() once.
  usePickingMarker({
    scope: "openPending",
    pickerId: activePickerId ?? undefined,
    onChange: () => router.refresh(),
    paused: detailOpen || marking,
  });

  useEffect(() => {
    if (detailOrderId === null) return;
    let cancelled = false;
    setLineItemsLoading(true);
    setLineItemsError(null);
    setLineItems(null);
    async function load() {
      try {
        const res = await fetch(`/api/picking/order/${detailOrderId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { lines?: LineItem[] };
        if (!cancelled) setLineItems(json.lines ?? []);
      } catch (err) {
        if (!cancelled) setLineItemsError(err instanceof Error ? err.message : "Failed to load line items");
      } finally {
        if (!cancelled) setLineItemsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailOrderId]);

  function openDetail(orderId: number): void {
    setDetailOrderId(orderId);
    setDetailOpen(true);
    setActivePackFilter("ALL");
  }
  function closeDetail(): void {
    setDetailOpen(false);
  }

  const rows = activeTab === "pending" ? pending : done;

  const detailRow: PickingQueueRow | null = useMemo(() => {
    if (detailOrderId === null) return null;
    return [...pending, ...done].find((r) => r.orderId === detailOrderId) ?? null;
  }, [pending, done, detailOrderId]);

  // Fire-and-forget: toast, close, router.refresh() — no confirm sheet.
  // Sends the server-resolved activePickerId (never a client-invented
  // value); the API's own ownership check re-verifies it against the
  // order's real pick_assignments row regardless (see app/api/picking/
  // done/route.ts's file-top comment).
  const handleMarkDone = useCallback(async () => {
    if (detailRow === null || activePickerId === null || marking) return;
    setMarking(true);
    try {
      const res = await fetch("/api/picking/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: detailRow.orderId, pickerId: activePickerId }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast.error(json.error ?? `Request failed (${res.status})`);
        return;
      }
      toast.success(`${detailRow.dealerName} marked done`);
      closeDetail();
      // Re-runs page.tsx's server-side fetch+filter for this picker — the
      // bill moves from Pending to Done via fresh server props, never a
      // client-side patch of the arrays passed in.
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mark done failed");
    } finally {
      setMarking(false);
    }
  }, [detailRow, activePickerId, marking, router]);

  const distinctPackKeys = useMemo(() => {
    if (!lineItems) return [];
    const set = new Set<string>();
    for (const li of lineItems) set.add(li.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = keys.filter((k) => k !== NO_PACK_KEY).sort((a, b) => a.localeCompare(b));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lineItems]);

  const filteredLineItems = useMemo(() => {
    if (!lineItems) return [];
    if (activePackFilter === "ALL") return lineItems;
    return lineItems.filter((li) => (li.pack ?? NO_PACK_KEY) === activePackFilter);
  }, [lineItems, activePackFilter]);

  // Admin "view as" — re-runs the server component's scoped fetch for the
  // newly chosen picker via a query-param navigation. No client-side
  // fetch of another picker's data ever happens here.
  function handleViewAsChange(newPickerId: string): void {
    const params = new URLSearchParams();
    params.set("view", "picker");
    params.set("as", newPickerId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fafb]">
      {/* Admin-only debug strip — deliberately outside the app's visual
          language (dark, dashed amber border, monospace) so it never reads
          as something a real picker would see. Matches
          docs/mockups/picking/picker-my-bills.html's debugstrip. */}
      {isAdmin && (
        <div className="flex-shrink-0 bg-gray-900 border-b-2 border-dashed border-amber-500 px-3.5 py-2 flex items-center gap-2">
          <span className="font-mono text-[9.5px] font-bold text-amber-500 uppercase tracking-wide whitespace-nowrap">
            ⚙ Admin — view as
          </span>
          <select
            value={activePickerId ?? ""}
            onChange={(e) => handleViewAsChange(e.target.value)}
            className="flex-1 min-w-0 bg-gray-800 text-white border border-gray-600 rounded-[6px] px-2 py-1 text-[12px] font-semibold font-mono"
          >
            {pickers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Shared Direction-A header (2026-07-29) — the same component the
          supervisor board uses (components/shared/module-mobile-header.tsx),
          so the two picking faces stop drifting. showSearch={false}: this
          face has no search, and the header leaves no gap where the icon
          would be. Replaces the hand-rolled teal block that carried the
          title, the viewer's name and the Pending/Done TopBarTab strip; the
          tabs are now the bottom bar (PickerPickingShell) and identity lives
          in the avatar → You sheet. */}
      <ModuleMobileHeader
        title="My Picks"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      {/* Card list. Four rows (2026-07-29): caption + flags · name · where ·
          families. Still NO checkbox, NO elapsed pill, NO avatar, NO footer —
          those are supervisor concerns. Reserves 76px for the shell's fixed
          bottom bar (components/shared/mobile-shell.tsx), same convention as
          picking-board-mobile.tsx. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[76px] bg-white border-b border-gray-200 px-4 py-2.5">
        {rows.length === 0 ? (
          <p className="text-[13px] text-gray-400 text-center py-16">
            {activeTab === "pending" ? "Nothing pending." : "Nothing marked done yet today."}
          </p>
        ) : (
          rows.map((row) => (
            <button
              key={row.orderId}
              type="button"
              onClick={() => openDetail(row.orderId)}
              className="block w-full text-left bg-white rounded-[14px] p-[13px] mb-[9px] active:bg-gray-50"
              style={{ boxShadow: SOFT_CARD_SHADOW }}
            >
              {/* Row 1 — caption + signals. OBD truncates first (it is the
                  least-scanned item here; the picker matches on the dealer
                  name); the right cluster is shrink-0 so an age badge or star
                  is never the thing that gets clipped. AgeBadge and the star
                  are INFORMATION, not controls: they carry no border-radius
                  button language, no active: state, and no handler — the whole
                  card is the single tap target. */}
              <div className="flex items-center justify-between gap-2 mb-[5px]">
                <span className="font-mono text-[11px] text-gray-400 truncate min-w-0">{row.obdNumber}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {/* Same days→colour scale as the supervisor board — the ONE
                      copy lives in ./card-atoms.tsx. Renders nothing below 1
                      day, so a fresh bill stays clean. */}
                  <AgeBadge row={row} />
                  {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
                  {row.windowTime !== null && (
                    <span className="text-[12px] font-semibold tabular-nums text-gray-500 whitespace-nowrap">
                      {row.windowTime}
                    </span>
                  )}
                  {/* Done tab: muted done-time label, no accent — this is his
                      receipt, per the mockup, so the time IS the point.
                      pickedAt flows through lib/picking/queue.ts; omits the
                      time (never fabricates one) on the rare row with no
                      pickedAt. */}
                  {activeTab === "done" && formatPickedTime(row.pickedAt) !== null && (
                    <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">
                      done {formatPickedTime(row.pickedAt)}
                    </span>
                  )}
                </span>
              </div>

              {/* Row 2 — the hero. CLAUDE_UI.md §60 tokens: 16px / 600 /
                  #1d2939. Exactly ONE line on this card carries weight. */}
              <div
                className="text-[16px] font-semibold leading-[1.25] mb-[3px] truncate"
                style={{ color: "#1d2939" }}
              >
                {row.dealerName}
              </div>

              {/* Row 3 — where + how much. Area and articleTag truncate
                  together on the left; volume is shrink-0 so the number the
                  picker loads against is NEVER the part that gets clipped
                  (the supervisor card makes the same call). */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-gray-500 truncate min-w-0">
                  {row.area !== null ? (
                    <>
                      {row.area}
                      {row.articleTag !== null && (
                        <>
                          <span className="text-gray-300 mx-[5px]">&middot;</span>
                          {row.articleTag}
                        </>
                      )}
                    </>
                  ) : (
                    (row.articleTag ?? "—")
                  )}
                </span>
                {row.volumeLitres != null && (
                  <span className="flex items-baseline gap-[3px] shrink-0">
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#667085" }}>
                      {formatLitres(row.volumeLitres)}
                    </span>
                    <span className="text-[10.5px] font-medium" style={{ color: "#98a2b3" }}>
                      L
                    </span>
                  </span>
                )}
              </div>

              {/* Row 4 — family chips. ONE non-wrapping scroll line, so every
                  card keeps a uniform height however many families a bill has
                  (the supervisor shelf's rule). No arrow and no shelf
                  background here: this card has no competing action, so the
                  chips sit directly on it. Rendered only when there is
                  something to show. */}
              {(row.families.length > 0 || row.unresolvedLineCount > 0) && (
                <div
                  className="mt-2 flex flex-nowrap gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
                  style={{ scrollbarWidth: "none" }}
                >
                  {row.families.map((f) => (
                    <FamilyChip key={f} label={f} />
                  ))}
                  <UnlistedChip count={row.unresolvedLineCount} />
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {/* Detail screen — reuses the live board's detail-screen pattern
          (board.tsx:1083-1267): teal header, articleTag+volume stat strip,
          pack chips (only when ≥2 distinct packs), pack-tile/SKU-hero/qty
          line items, plus a Mark done CTA below (fire-and-forget, no
          confirm — see handleMarkDone). NO tick boxes — that's a
          supervisor-side, later stage. CTA only renders for pending
          (non-done) rows — a Done-tab bill's detail screen has no CTA. */}
      <div
        className={
          "fixed inset-0 z-[35] bg-[#f9fafb] flex flex-col transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
      >
        <div
          className="bg-teal-600 px-3.5 pb-3.5 flex items-center gap-2.5 shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          <button
            type="button"
            onClick={closeDetail}
            aria-label="Back"
            className="w-8 h-8 rounded-[9px] bg-white/15 flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-white truncate">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div className="text-[12px] text-white/75 truncate">
              {detailRow
                ? `${detailRow.obdNumber} · ${detailRow.area ?? "Unmatched"}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
          </div>
        </div>

        <div className="bg-white border-b border-gray-200 px-3.5 py-3 flex items-end justify-between gap-3 shrink-0">
          <div className="min-w-0 text-[16px] font-extrabold text-gray-900 leading-snug">
            {detailRow?.articleTag ?? "—"}
          </div>
          <div className="shrink-0 text-[13px] font-semibold text-gray-500">
            {detailRow?.volumeLitres != null ? formatLitres(detailRow.volumeLitres) : "—"} L
          </div>
        </div>

        {distinctPackKeys.length >= 2 && (
          <div className="bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
            <button
              type="button"
              onClick={() => setActivePackFilter("ALL")}
              className={
                "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                (activePackFilter === "ALL"
                  ? "bg-gray-900 border-gray-900 text-white font-semibold"
                  : "bg-white border-gray-200 text-gray-700")
              }
            >
              All
            </button>
            {distinctPackKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setActivePackFilter(key)}
                className={
                  "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
                  (activePackFilter === key
                    ? "bg-gray-900 border-gray-900 text-white font-semibold"
                    : "bg-white border-gray-200 text-gray-700")
                }
              >
                {key === NO_PACK_KEY ? "No pack" : key}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-8">
          {lineItemsLoading && (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading line items&hellip;</p>
          )}
          {!lineItemsLoading && lineItemsError && (
            <p className="text-[13px] text-red-600 text-center py-10">
              Couldn&apos;t load line items: {lineItemsError}
            </p>
          )}
          {!lineItemsLoading && !lineItemsError && lineItems !== null && (
            lineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No line items found for this bill.</p>
            ) : filteredLineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>
            ) : (
              filteredLineItems.map((li) => (
                <div
                  key={li.id}
                  className="flex bg-white rounded-[14px] overflow-hidden mb-2"
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  <div className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
                    <span
                      className={
                        "text-[13px] font-bold text-center " + (li.pack !== null ? "text-teal-700" : "text-gray-400")
                      }
                    >
                      {li.pack ?? "—"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 px-3 py-2.5">
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                  </div>
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900">{li.qty}</span>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* paddingBottom = the plain /po safe-area floor, NOT
            MOBILE_NAV_CLEARANCE (2026-07-29). It read MOBILE_NAV_CLEARANCE
            only because the shared bottom bar used to paint OVER this detail
            screen (bar z-40 above this screen's z-[35]); the shell now passes
            hideBar while a bill is open, so the bar is gone here and
            reserving its 76px left the button floating well above the true
            bottom edge. Same value, same reason, same commit-era as
            picking-board-mobile.tsx's four detail CTAs — CLAUDE_PICKING.md
            §5.3 is the owner of this rule.
            ⚠ This does NOT generalise to the LIST view: the bar IS visible
            there, so the list keeps pb-[76px], and MOBILE_NAV_CLEARANCE stays
            the single source for every bottom-pinned element that still sits
            under a live bar. */}
        {detailRow && !detailRow.isDone && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <button
              type="button"
              onClick={() => void handleMarkDone()}
              disabled={marking}
              className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)] disabled:opacity-60"
            >
              {marking ? "Marking done…" : "Mark done"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
