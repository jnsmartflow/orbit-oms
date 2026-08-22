"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Clock, Truck } from "lucide-react";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import type { MrnDetail, MrnDetailLine, MrnSupervisorTab } from "@/lib/mrn/types";
import { useMrnBoard } from "./mrn-shell";
import { SupervisorCard } from "./supervisor-card";
import { formatCount, formatDateOnly, formatIstDateTime } from "./format";
import { describeWriteError } from "./modal-shell";
import { LineList } from "./line-list";
import { LineSheet } from "./line-sheet";
import { EndSheet } from "./end-sheet";

// The supervisor's phone board + the detail screen behind it.
//
// Scope: the three tabs, the cards, the truck-facts screen, Start unloading,
// the line list, the line sheet and End unloading — the full supervisor flow.
// The only thing left for the module is the export (step 10).

const EMPTY_COPY: Record<MrnSupervisorTab, { title: string; hint: string }> = {
  toCheck: { title: "No trucks waiting", hint: "Billing will send them here" },
  checking: { title: "Nothing being unloaded", hint: "Start a truck from To check" },
  done: { title: "Nothing finished today", hint: "Trucks you finish today appear here" },
};

export function MrnSupervisorBoard(): React.JSX.Element {
  const { openMenu, openYou, userInitials } = useMobileShell();
  const {
    data,
    loading,
    error,
    activeTab,
    refetchBoard,
    detailOpen,
    setDetailOpen,
    setOverlayBusy,
    setActiveTab,
    viewerId,
  } = useMrnBoard();

  const rows = data ? data[activeTab] : [];

  // ── Detail screen state ───────────────────────────────────────────────────
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<MrnDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [startSheet, setStartSheet] = useState(false);
  const [endSheet, setEndSheet] = useState(false);
  /** The line whose sheet is open, plus its 1-based position for the subtitle. */
  const [lineTarget, setLineTarget] = useState<{ line: MrnDetailLine; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Report the sheet up so the shell's marker pauses while it is open — the
  // same lift the picking supervisor makes with overlayBusy.
  useEffect(() => {
    setOverlayBusy(startSheet || endSheet || lineTarget !== null);
    return () => setOverlayBusy(false);
  }, [startSheet, endSheet, lineTarget, setOverlayBusy]);

  // Toast auto-dismisses. Not a queue — one message at a time is all this
  // screen ever raises.
  useEffect(() => {
    if (toast === null) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (detailId === null) return;
    let cancelled = false;
    async function load() {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const res = await fetch(`/api/mrn/${detailId}`);
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "This MRN is no longer available."
              : `Could not load this MRN (${res.status}).`,
          );
        }
        const json = (await res.json()) as MrnDetail;
        if (!cancelled) setDetail(json);
      } catch (err) {
        if (!cancelled) {
          setDetailError(err instanceof Error ? err.message : "Could not load this MRN");
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  // ── ONE history entry, ONE close authority ────────────────────────────────
  //
  // 🔴 `closeDetail` IS REACHABLE ONLY FROM THE popstate HANDLER BELOW. The
  // header chevron, Android back, the iOS edge-swipe and the Start success path
  // ALL call window.history.back() and let the pop land here, so every close
  // runs identical logic. Two close paths that disagree is precisely the desync
  // documented at picking-board-mobile.tsx — never call setDetailOpen(false)
  // directly.
  //
  // 🔴 THE NESTED-SHEET BRANCH (added 9b). The line sheet floats OVER the detail
  // screen, so a back-press while it is open must close THE SHEET and RE-PUSH —
  // never the detail underneath. Without the re-push the single detail entry is
  // consumed and one more back would walk him out of /mrn entirely, losing the
  // truck he is halfway through counting. Guarded on `sheetOpen && detailOpen`,
  // byte-for-byte the shape picking-board-mobile.tsx uses for its picker sheet,
  // its cancel sheet and its finding popup.
  //
  // STILL ONE LISTENER. Every layer is a branch inside this handler; a second
  // addEventListener is how two close paths start disagreeing.
  const navStateRef = useRef({ detailOpen: false, sheetOpen: false });
  useEffect(() => {
    navStateRef.current = {
      detailOpen,
      sheetOpen: startSheet || endSheet || lineTarget !== null,
    };
  }, [detailOpen, startSheet, endSheet, lineTarget]);

  // pushState with no url arg navigates nowhere — a back from it is a pure
  // in-app state change, never a real page transition.
  const pushScreen = useCallback(() => {
    if (typeof window === "undefined") return;
    window.history.pushState({ mrnScreen: "detail" }, "");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop(): void {
      // TOPMOST LAYER FIRST. Close only the sheet, then re-push so the ONE
      // detail entry survives for the NEXT back-press.
      if (navStateRef.current.sheetOpen && navStateRef.current.detailOpen) {
        setStartSheet(false);
        setEndSheet(false);
        setLineTarget(null);
        pushScreen();
        return;
      }
      if (navStateRef.current.detailOpen) {
        // THE real close. See the block comment above.
        setDetailOpen(false);
      }
      // Nothing open — let the pop fall through to the browser's real previous
      // entry, whatever that is.
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // setDetailOpen is a plain useState setter threaded through context and
    // pushScreen is a stable useCallback — this registers once for the life of
    // the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-read the open MRN after a line confirm. Client fetch, never
   *  router.refresh() — see confirmStart's comment for why. */
  const refetchDetail = useCallback(async (): Promise<MrnDetail | null> => {
    if (detailId === null) return null;
    try {
      const res = await fetch(`/api/mrn/${detailId}`);
      if (!res.ok) return null;
      const json = (await res.json()) as MrnDetail;
      setDetail(json);
      return json;
    } catch {
      // Silent — keep the last good screen. He is mid-count; blanking the list
      // on a network blip would be worse than a stale tick.
      return null;
    }
  }, [detailId]);

  function openDetail(id: number): void {
    setDetailId(id);
    setDetail(null);
    setDetailError(null);
    setDetailOpen(true);
    pushScreen();
  }

  // ── Start unloading ───────────────────────────────────────────────────────
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // ── End unloading ─────────────────────────────────────────────────────────
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  async function confirmEnd(): Promise<void> {
    if (!detail) return;
    setEnding(true);
    setEndError(null);
    const number = detail.mrnNumber;
    try {
      const res = await fetch(`/api/mrn/${detail.id}/end`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // The route's own sentence, verbatim — it NAMES how many lines are
        // still unchecked ("3 of 18 lines are still unchecked."), which is the
        // only actionable thing a 409 here can say. It also covers someone else
        // having finished the truck first.
        setEndError(describeWriteError(res.status, json.error, "finish this MRN"));
        if (res.status === 409) {
          // The screen is stale either way — re-read so the CTA and the ticks
          // reflect what the server actually holds.
          void refetchDetail();
          void refetchBoard();
        }
        return;
      }

      // 🔴 CLOSE THROUGH HISTORY, then a CLIENT FETCH. NEVER router.refresh().
      // This is the exact screen shape that broke twice on the picker face — a
      // history pop paired with a router refresh, which Next's action queue
      // marks discarded so the result is never applied. Both fixes shipped
      // green and stayed broken in production because the ordering is the
      // scheduler's, not ours, and neither tsc nor next build catches it.
      // CORE §3 owns this.
      //
      // TWO backs: one for the End sheet (the nested branch re-pushes), one for
      // the detail screen itself.
      setEndSheet(false);
      window.history.back();
      window.history.back();
      // Land on Done — his receipt is there now, and it is the only tab this
      // truck still appears on.
      setActiveTab("done");
      setToast(`${number} finished · sent to billing`);
      await refetchBoard();
    } catch {
      setEndError("Could not reach the server. Nothing was finished — try again.");
    } finally {
      setEnding(false);
    }
  }

  async function confirmStart(): Promise<void> {
    if (!detail) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/mrn/${detail.id}/start`, { method: "POST" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        // The route's own sentence NAMES who has the truck — "Ramesh K. started
        // unloading this truck at 14:32 — it cannot be started again." That is
        // the whole point of a 409 here, so it passes through verbatim. It also
        // covers billing having cleared the lines since this screen loaded.
        setStartError(describeWriteError(res.status, json.error, "start this truck"));
        // Whatever happened, the screen is now stale — close and re-read so he
        // sees where the truck actually is.
        if (res.status === 409) {
          setStartSheet(false);
          window.history.back();
          await refetchBoard();
        }
        return;
      }

      setStartSheet(false);
      // 🔴 CLOSE THROUGH HISTORY, then a CLIENT FETCH + setState.
      //
      // NEVER router.refresh(). Next gives navigations priority in its router
      // action queue: an ACTION_RESTORE — which is what this history.back()
      // becomes — marks any pending action discarded so its result is never
      // applied, and only a discarded SERVER ACTION gets the needsRefresh
      // rescue. The picker face shipped exactly this bug, TWICE, and both
      // timing fixes shipped green and stayed broken on production because the
      // ordering is the scheduler's and not ours. Nothing in tsc or next build
      // catches it — only a phone does. CORE §3 owns this rule.
      window.history.back();
      await refetchBoard();
    } catch {
      setStartError("Could not reach the server. Nothing was started — try again.");
    } finally {
      setStarting(false);
    }
  }

  const empty = EMPTY_COPY[activeTab];

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f5f6f8]">
      <ModuleMobileHeader
        title="MRN"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      {/* Only this scrolls. MOBILE_NAV_CLEARANCE reserves the WorkflowTabBar —
          imported, never retyped as 76px (§59.6). */}
      <div
        className="flex-1 overflow-y-auto overscroll-contain px-3 pt-3"
        style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}
      >
        {loading ? (
          <p className="px-1 py-3 text-[13px] text-gray-400">Loading…</p>
        ) : error ? (
          <p className="px-1 py-3 text-[13px] text-red-600">{error}</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 pt-20 text-center">
            <Truck size={44} strokeWidth={1.5} className="text-[#cbd2da]" />
            <h3 className="text-[15px] font-semibold text-[#475467]">{empty.title}</h3>
            <p className="text-[12.5px] text-[#98a2b3]">{empty.hint}</p>
          </div>
        ) : (
          rows.map((row) => (
            <SupervisorCard
              key={row.id}
              row={row}
              tab={activeTab}
              viewerId={viewerId}
              onOpen={openDetail}
            />
          ))
        )}
      </div>

      {/* ── Detail screen — ALWAYS MOUNTED, slid in on translateX ─────────────
          Mounted rather than conditionally rendered so the transition has
          something to animate from, exactly as both picking faces do. */}
      <div
        className={
          "fixed inset-0 z-[35] flex flex-col bg-[#f5f6f8] transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
      >
        <div
          className="flex shrink-0 items-center gap-1.5 bg-teal-600 pb-3.5 pl-3.5 pr-1.5"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          {/* Routes through history so the chevron, a hardware back press, the
              iOS edge-swipe and the Start success path all close via the ONE
              popstate authority. 38px + the 44px tap target rule (§60). */}
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="flex h-[38px] w-[38px] min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[10px] bg-white/[0.16] text-white"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-bold text-white">
              {detail?.receivedFrom ?? "—"}
            </div>
            <div className="truncate font-mono text-[11px] text-white/75">
              {detail?.mrnNumber ?? ""}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {detailLoading ? (
            <p className="px-1 py-3 text-[13px] text-gray-400">Loading…</p>
          ) : detailError ? (
            <p className="px-1 py-3 text-[13px] text-red-600">{detailError}</p>
          ) : detail ? (
            <>
              <FactsCard detail={detail} />

              {detail.status === "open" && (
                <div className="mt-3 rounded-[13px] bg-white p-[15px] text-[13.5px] leading-[1.55] text-[#475467]">
                  Tap <b className="text-gray-900">Start unloading</b> when the truck door
                  opens. The clock starts then — you cannot change it later.
                </div>
              )}

              {/* The working screen — S5/S6. */}
              {detail.status === "checking" && (
                <div className="mt-3">
                  <LineList
                    detail={detail}
                    onOpenLine={(line, index) => setLineTarget({ line, index })}
                  />
                </div>
              )}

              {/* A finished truck is read-only. He can still open it from Done
                  to check what he recorded; the route 409s any change. */}
              {detail.status === "done" && (
                <div className="mt-3">
                  <LineList detail={detail} onOpenLine={() => undefined} />
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* CTA. ⚠ The bottom bar is HIDDEN while this screen is open (hideBar in
            the shell), so this reserves the SAFE AREA only — never
            MOBILE_NAV_CLEARANCE, which would leave 76px of dead space under it.
            No keyboardOpen gate here: nothing on THIS screen raises a keyboard —
            the inputs all live in the line sheet, which gates its own footer. */}
        {(detail?.status === "open" || detail?.status === "checking") && (
          <div
            className="shrink-0 px-3 pt-2"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            {detail.status === "open" ? (
              <button
                type="button"
                onClick={() => setStartSheet(true)}
                className="h-[52px] w-full rounded-[13px] bg-teal-600 text-[15px] font-bold text-white active:bg-teal-700"
              >
                Start unloading
              </button>
            ) : (
              // GREY until every line is ticked, then GREEN. Green rather than
              // teal because this is a COMPLETION, matching the picking board's
              // Approve — teal on this module means "the job", and finishing is
              // the end of it. The count on the grey label is the whole point:
              // "N lines left" tells him how much further, where a plain
              // disabled button tells him only that he cannot press it.
              (() => {
                const left = detail.lineCount - detail.checkedLineCount;
                const ready = detail.lineCount > 0 && left === 0;
                return (
                  <button
                    type="button"
                    disabled={!ready}
                    onClick={() => setEndSheet(true)}
                    className={
                      "h-[52px] w-full rounded-[13px] text-[15px] font-bold " +
                      (ready
                        ? "bg-green-600 text-white active:bg-green-700"
                        : "cursor-not-allowed bg-gray-100 text-gray-400")
                    }
                  >
                    {ready
                      ? "End unloading"
                      : `End unloading · ${left} line${left === 1 ? "" : "s"} left`}
                  </button>
                );
              })()
            )}
          </div>
        )}
      </div>

      {/* ── Start confirm (S9) ───────────────────────────────────────────────
          One tap of friction, because the timestamp is permanent and there is
          no un-start in v1 (design §11 OQ-7). */}
      {/* ── The line sheet (S7 / S7b / S8) ───────────────────────────────────
          Floats OVER the detail screen — which is why the popstate handler
          above grew its nested branch. */}
      {lineTarget && detail && (
        <LineSheet
          mrnId={detail.id}
          line={lineTarget.line}
          position={{ index: lineTarget.index, total: detail.lineCount }}
          onClose={() => {
            // Routed through history so the ONE popstate authority closes it,
            // exactly like the detail screen itself. The nested branch catches
            // this and re-pushes, so the detail entry survives.
            window.history.back();
          }}
          onConfirmed={() => {
            window.history.back();
            // 🔴 CLIENT FETCH, never router.refresh() — see confirmStart.
            void refetchDetail();
            // The board's own tab counts and the "N of M checked" chip move
            // too, so the list behind must re-read as well.
            void refetchBoard();
          }}
        />
      )}

      {/* ── End unloading (S10) ─────────────────────────────────────────────── */}
      {endSheet && detail && (
        <EndSheet
          detail={detail}
          busy={ending}
          error={endError}
          onCancel={() => {
            setEndError(null);
            window.history.back();
          }}
          onConfirm={() => void confirmEnd()}
        />
      )}

      {/* ── Toast (S11) ─────────────────────────────────────────────────────
          Sits above the tab bar, which is back by the time this shows — the
          detail screen has closed. */}
      {toast && (
        <div
          className="pointer-events-none fixed inset-x-3 z-[70] flex items-center gap-2 rounded-[12px] bg-gray-900 px-3.5 py-3 text-[13px] font-medium text-white shadow-lg"
          style={{ bottom: `calc(${MOBILE_NAV_CLEARANCE} + 10px)` }}
        >
          <Check size={17} strokeWidth={2.6} className="shrink-0 text-green-400" />
          {toast}
        </div>
      )}

      {startSheet && detail && (
        <StartSheet
          detail={detail}
          busy={starting}
          error={startError}
          onCancel={() => {
            setStartSheet(false);
            setStartError(null);
          }}
          onConfirm={() => void confirmStart()}
        />
      )}
    </div>
  );
}

function FactsCard({ detail }: { detail: MrnDetail }): React.JSX.Element {
  return (
    <div className="rounded-[13px] bg-white p-[15px]">
      <div className="grid grid-cols-2 gap-x-4 gap-y-[13px]">
        <Fact label="Truck reporting date" value={formatDateOnly(detail.truckReportingDate)} />
        <Fact label="Received from" value={detail.receivedFrom} />
        <Fact label="STI / PO ref" value={detail.stiRefNo} mono />
        <Fact label="Delivery no" value={detail.deliveryNo} mono />
        <Fact label="Lines" value={String(detail.lineCount)} />
        <Fact label="Qty as per STI" value={`${formatCount(detail.totalQtySti)} nos`} />
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-400">
        {label}
      </div>
      <div
        className={
          "mt-[3px] truncate text-[13.5px] font-medium " +
          (value ? "text-[#1d2939] " : "text-[#c2c8d0] ") +
          (mono && value ? "font-mono text-[12.5px]" : "")
        }
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function StartSheet({
  detail,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  detail: MrnDetail;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  // Read the clock ONCE, when the sheet opens, so the stamp he is shown does
  // not tick while he reads it. The server stamps its own `new Date()` — this
  // is the promise, not the value — so they can differ by the round trip, which
  // is why the copy says "will be stamped" rather than quoting a guarantee.
  const [now] = useState(() => new Date());

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={busy ? undefined : onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative rounded-t-[22px] bg-white px-4 pt-2.5"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-gray-200" />
        <div className="text-[17px] font-bold text-gray-900">Start unloading now?</div>
        <div className="mt-1 text-[13px] text-[#667085]">
          <span className="font-mono">{detail.mrnNumber}</span> · {detail.receivedFrom} ·{" "}
          {detail.lineCount} lines
        </div>

        <div className="mt-4 flex gap-2.5 rounded-[11px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] leading-[1.55] text-amber-900">
          <Clock size={15} className="mt-px shrink-0" />
          <div>
            Unloading start will be stamped{" "}
            <b>{formatIstDateTime(now)}</b>. It goes on the final report and cannot be
            edited.
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-[11px] border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-[1.55] text-[#b42318]">
            {error}
          </div>
        )}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-[50px] flex-1 rounded-[13px] bg-gray-100 text-[15px] font-semibold text-[#475467] disabled:opacity-60"
          >
            Not yet
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-[50px] flex-1 rounded-[13px] bg-teal-600 text-[15px] font-bold text-white active:bg-teal-700 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
