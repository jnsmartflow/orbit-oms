"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { CiResultCard } from "./result-card";
import { CiSubmittedDetail } from "./submitted-detail";
import { CiQtySheet } from "./qty-sheet";
import { CiReasonSheet } from "./details-step";
import type {
  CiBillLine,
  CiBillResult,
  CiBoardRow,
  CiDetail,
  CiReasonOption,
  CiSupervisorBoard,
} from "@/lib/ci/types";

// The supervisor's Submitted tab — frame 9 of docs/mockups/ci/supervisor.html.
//
// TWO SECTIONS IN ONE LIST: "With billing" (what billing still holds) then
// "Finished" (what it has closed). One scroll, not two tabs.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 TAP-TO-OPEN, AND EDITABLE WHILE STILL WITH BILLING (owner ruling 7e)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠ THIS REVERSES THE RULE THAT STOOD HERE, and the reversal is deliberate, not
// drift. The old note read "READ-ONLY … none may be added without a product
// decision". The product decision was made on 2026-09-01:
//
//   a submitted CI is VIEWABLE always,
//   and EDITABLE only while status = 'submitted', and only by the supervisor
//   who raised it. Once 'closed' it is read-only with NO exceptions.
//
// The old rule's reasoning — "billing is acting on it" — was the right worry and
// is answered rather than ignored: billing's marker watches `updatedAt`, so a
// floor correction makes their rail refresh UNDER them. That is the intended
// behaviour. A correction that lands visibly beats one that does not, and beats
// the alternative that actually existed before this, which was a supervisor with
// no way at all to fix a number he had just got wrong.
//
// This is also the answer to spec §11.1's open "return to floor" question:
// billing does not send it back, they tell the floor and he fixes it himself.
// No returned_to_floor flow, no extra button on the desk.
//
// 🔴 THE SCREEN IS NOT THE AUTHORITY. `editable` below is computed from the
// SERVER's status and supervisorId, and both write routes re-test both inside a
// guarded updateMany. If the two ever disagree, the ROUTE is right.
//
// 🔴 NO MARKER, NO POLLING. Billing polls; the supervisor does not (spec §10).
// He is the one CREATING the work, so he has nothing to wait for — the
// asymmetry is deliberate in both CI and MRN (MRN's marker is supervisor-only
// for the mirror-image reason). Do NOT add a poll here "to match" billing.
// This fetches once on mount, and again when the caller bumps `refreshKey`
// after a submit.
//
// 🔴 EVERY READ FILTERS `status <> 'draft'` — in lib/ci/queries.ts's
// buildCiSupervisorWhere, not here. An abandoned draft must never appear in this
// list; if a numberless card ever shows up, that filter is missing.
//
// ⚠ Refresh is a client fetch + setState. NEVER router.refresh(): a history pop
// discards it silently and the board shows stale data. Two attempts to fix that
// by re-ordering shipped green and stayed broken on production (CORE §3).

export function CiSubmittedBoard({
  userInitials,
  refreshKey,
  onCounts,
  onInsideCi,
}: {
  userInitials: string;
  /** Bumped by the caller after a successful submit, to refetch. */
  refreshKey: number;
  /** Reports the real counts UP so the tab badge comes from THIS fetch and is
   *  never a guessed increment. */
  onCounts?: (withBilling: number, finished: number) => void;
  /** Lets the shell hide the module tab bar while a CI is open — the same
   *  `hideBar` contract CiNewReturn uses for a bill. */
  onInsideCi?: (inside: boolean) => void;
}): React.JSX.Element {
  const { openMenu, openYou } = useMobileShell();
  const [board, setBoard] = useState<CiSupervisorBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ── The open CI ───────────────────────────────────────────────────────────
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CiDetail | null>(null);
  const [bill, setBill] = useState<CiBillResult | null>(null);
  const [raced, setRaced] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit state, seeded from the CI when it loads.
  const [materialMoved, setMaterialMoved] = useState<"moved" | "not_moved">("not_moved");
  const [receivedOn, setReceivedOn] = useState("");
  const [reason, setReason] = useState<CiReasonOption | null>(null);
  const [remark, setRemark] = useState("");
  const [returned, setReturned] = useState<Map<number, number>>(new Map());
  const [activePackFilter, setActivePackFilter] = useState("ALL");
  const [sheetLine, setSheetLine] = useState<CiBillLine | null>(null);
  const [reasonSheetOpen, setReasonSheetOpen] = useState(false);
  const [reasons, setReasons] = useState<CiReasonOption[] | null>(null);
  const [reasonsError, setReasonsError] = useState<string | null>(null);

  /** What the CI looked like when it loaded — the baseline `dirty` compares
   *  against. Held in a ref because it is not rendered; it only ever answers
   *  "has anything actually changed?". */
  const baselineRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ci/board?face=supervisor");
      if (!res.ok) {
        setError("Could not load your returns.");
        return;
      }
      const data = (await res.json()) as CiSupervisorBoard;
      setBoard(data);
      setError(null);
      // 🔴 THE COUNT COMES FROM THE PAYLOAD, never from an increment. A guessed
      // "+1" after a submit drifts the moment two phones submit at once, or a
      // submit fails after the optimistic bump.
      onCounts?.(data.withBilling.length, data.finished.length);
    } catch {
      setError("Could not load your returns — check the connection.");
    } finally {
      setLoading(false);
    }
  }, [onCounts]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // The shell hides its two tabs while a CI is open — same contract as a bill.
  const ciOpen = openId !== null;
  useEffect(() => {
    onInsideCi?.(ciOpen);
  }, [ciOpen, onInsideCi]);

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔴 THE ONE POPSTATE AUTHORITY FOR THIS TAB
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // The same model new-return.tsx uses, and for the same reason: without it
  // Android's hardware back and the iOS edge-swipe leave /ci entirely from the
  // middle of the screen. Opening a CI pushes exactly ONE entry, and EVERY close
  // routes through history.back() — the header chevron included, so all three
  // paths run identical code and cannot drift.
  //
  // ONE ENTRY FOR THE WHOLE SESSION: the two sheets close-and-RE-PUSH, so the
  // depth never desyncs and a second back does not fall out of the module.
  const navStateRef = useRef({ ciOpen, qtyOpen: false, reasonOpen: false });
  navStateRef.current = {
    ciOpen,
    qtyOpen: sheetLine !== null,
    reasonOpen: reasonSheetOpen,
  };

  function pushScreen(): void {
    window.history.pushState({ ciScreen: "detail" }, "");
  }

  useEffect(() => {
    function onPop(): void {
      const st = navStateRef.current;
      if (st.qtyOpen) {
        setSheetLine(null);
        pushScreen();
        return;
      }
      if (st.reasonOpen) {
        setReasonSheetOpen(false);
        pushScreen();
        return;
      }
      if (st.ciOpen) {
        setOpenId(null);
        return;
      }
      // Nothing tracked open — let the pop fall through to the real previous
      // entry, whatever that is.
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ── Open one CI ───────────────────────────────────────────────────────────
  //
  // ⚠ THE SCREEN OPENS FIRST, THEN THE DATA ARRIVES — the same stance the New
  // flow takes. A tap on depot wifi must not do nothing visible for a second.
  const openCi = useCallback(async (ciId: number) => {
    setDetail(null);
    setBill(null);
    setRaced(null);
    setReturned(new Map());
    setActivePackFilter("ALL");
    baselineRef.current = null;
    setOpenId(ciId);
    pushScreen();

    try {
      const res = await fetch(`/api/ci/${ciId}`);
      if (!res.ok) {
        toast.error("Could not open that CI.");
        window.history.back();
        return;
      }
      const d = (await res.json()) as CiDetail;
      setDetail(d);
      // Seed the form from the RECORD, never from whatever was on screen before.
      setMaterialMoved(d.materialMoved === "moved" ? "moved" : "not_moved");
      setReceivedOn(d.materialReceivedDate.slice(0, 10));
      // Seeded from the CI's own snapshot — id for writing, label for reading
      // (see CiDetail.reasonId). `code` is display-irrelevant here, and the
      // reason sheet replaces the whole object the moment he picks another.
      setReason({
        id: d.reasonId,
        code: "",
        label: d.reasonLabel,
        isPinned: false,
        sortOrder: 0,
      });
      setRemark(d.reasonRemark ?? "");
      const seeded = new Map<number, number>();
      for (const l of d.lines) {
        if (l.rawLineItemId !== null) seeded.set(l.rawLineItemId, l.returnedQty);
      }
      setReturned(seeded);
      baselineRef.current = snapshot(d, seeded);
    } catch {
      toast.error("Could not open that CI — check the connection.");
      window.history.back();
    }
  }, []);

  // ── May he change it? ─────────────────────────────────────────────────────
  //
  // 🔴 FROM THE SERVER'S OWN FIELDS, and ownership is already settled by the
  // query: every row on this tab was filtered by `supervisorId` in
  // buildCiSupervisorWhere, so anything he can open here he raised. The status
  // is the CI's. Both write routes re-test BOTH inside a guarded updateMany —
  // this only decides what to RENDER.
  const editable = detail !== null && detail.status === "submitted";

  // The whole bill, but ONLY when he can actually change the lines: he needs
  // every active line to be able to add one back, not just the ones already on
  // the return. A read-only CI never fetches it — the record is the snapshot on
  // the CI, not whatever the bill says today.
  useEffect(() => {
    if (!editable || detail === null || detail.returnType !== "part") return;
    let alive = true;
    fetch(`/api/ci/bill/${detail.orderId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((b: CiBillResult) => {
        if (alive) setBill(b);
      })
      .catch(() => {
        // Not fatal — the details stay editable, the lines simply are not.
        if (alive) toast.error("Could not load the bill's lines — details only.");
      });
    return () => {
      alive = false;
    };
  }, [editable, detail]);

  // Reasons, prefetched the moment an editable CI opens, so the sheet paints
  // ONCE at full height instead of as a "Loading…" strip that jumps. Same fix
  // and same reason as the New flow (7b).
  useEffect(() => {
    if (!editable || reasons !== null || reasonsError !== null) return;
    let alive = true;
    fetch("/api/ci/reasons")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((j: { reasons: CiReasonOption[] }) => {
        if (alive) setReasons(j.reasons);
      })
      .catch(() => {
        if (alive) setReasonsError("Could not load the reasons — check the connection.");
      });
    return () => {
      alive = false;
    };
  }, [editable, reasons, reasonsError]);

  /** Has anything ACTUALLY changed? Compared against the snapshot taken when the
   *  CI loaded, so tapping a line and putting the same number back leaves Save
   *  disabled — a no-op write would still bump `updatedAt` and shake billing's
   *  rail for nothing. */
  const dirty = useMemo(() => {
    if (detail === null || baselineRef.current === null) return false;
    return (
      snapshotOf(materialMoved, receivedOn, reason?.id ?? null, remark, returned) !==
      baselineRef.current
    );
  }, [detail, materialMoved, receivedOn, reason, remark, returned]);

  /** Re-read one CI into the open screen and re-seed the form from it. A client
   *  fetch + setState — NEVER router.refresh (CORE §3). */
  const refreshOpen = useCallback(async (ciId: number) => {
    const res = await fetch(`/api/ci/${ciId}`);
    if (!res.ok) return;
    const d = (await res.json()) as CiDetail;
    setDetail(d);
    const seeded = new Map<number, number>();
    for (const l of d.lines) {
      if (l.rawLineItemId !== null) seeded.set(l.rawLineItemId, l.returnedQty);
    }
    setReturned(seeded);
    setMaterialMoved(d.materialMoved === "moved" ? "moved" : "not_moved");
    setReceivedOn(d.materialReceivedDate.slice(0, 10));
    setReason({
      id: d.reasonId,
      code: "",
      label: d.reasonLabel,
      isPinned: false,
      sortOrder: 0,
    });
    setRemark(d.reasonRemark ?? "");
    baselineRef.current = snapshot(d, seeded);
  }, []);

  /**
   * 🔴 THE RACE, SURFACED. Billing closed it while he had it open.
   *
   * Refetch FIRST, so by the time he reads the message the screen behind it
   * already shows the closed CI read-only — what he is told and what he can do
   * agree, rather than a warning floating over a form that still looks live.
   *
   * Then a BAND, not a toast. A toast is gone in four seconds and he is standing
   * at a shelf with stock in his hands. His typed values are gone because the
   * form is gone, and the band says exactly that — the one thing that must never
   * happen here is letting him walk away believing it saved.
   */
  const handleRace = useCallback(
    async (ciId: number, message?: string) => {
      await refreshOpen(ciId);
      void load();
      setRaced(
        message ??
          "Billing closed this CI while you had it open, so your change was not saved.",
      );
    },
    [refreshOpen, load],
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  //
  // TWO ROUTES, IN THIS ORDER: lines first (part returns only), then details.
  //
  // ⚠ NOTHING SPANS THEM. prisma.$transaction is banned (CORE §3) and there is
  // no cross-route equivalent, so a failure between the two leaves the lines
  // saved and the details not. That is stated rather than hidden: the second
  // call's error names which half landed, instead of a flat "could not save"
  // that would leave him re-entering work already stored.
  //
  // 🔴 EITHER CALL CAN LOSE THE RACE, and both answer it the same way — 409 with
  // `raced`. Never a retry, never a success toast, never a silent discard.
  const onSave = useCallback(async () => {
    if (detail === null || saving) return;
    setSaving(true);
    let linesSaved = false;
    try {
      if (detail.returnType === "part") {
        const lines = Array.from(returned.entries())
          .filter(([, qty]) => qty > 0)
          .map(([rawLineItemId, returnedQty]) => ({ rawLineItemId, returnedQty }));
        if (lines.length === 0) {
          toast.error("A return needs at least one line.");
          return;
        }
        const res = await fetch(`/api/ci/${detail.id}/lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; raced?: boolean };
          if (j.raced === true) {
            await handleRace(detail.id, j.error);
            return;
          }
          toast.error(j.error ?? "Could not save the lines.");
          return;
        }
        linesSaved = true;
      }

      const res = await fetch(`/api/ci/${detail.id}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialMoved,
          materialReceivedDate: receivedOn,
          reasonId: reason?.id ?? null,
          reasonRemark: remark.trim() === "" ? null : remark.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; raced?: boolean };
        if (j.raced === true) {
          await handleRace(detail.id, j.error);
          return;
        }
        toast.error(
          linesSaved
            ? `The lines were saved but the details were not — ${j.error ?? "try again"}.`
            : (j.error ?? "Could not save the details."),
        );
        return;
      }

      toast.success("Saved.");
      // Re-read rather than trusting what we sent: the routes DERIVE litres and
      // SNAPSHOT the reason label, so the screen must show what was stored, not
      // what was posted.
      await refreshOpen(detail.id);
      void load();
    } catch {
      toast.error("Could not save — check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [
    detail,
    saving,
    returned,
    materialMoved,
    receivedOn,
    reason,
    remark,
    load,
    refreshOpen,
    handleRace,
  ]);

  return (
    <>
    {/* 🔴 ONE TREE, AND THE LIST STAYS MOUNTED — the structure 7b established
        on the New tab. The detail slides over the board rather than replacing
        it, which is what gives the transition AND scroll restoration: coming
        back from a CI lands him where he was in the list, not at the top. */}
    <div className="min-h-full bg-[#F4F6F7]">
      <ModuleMobileHeader
        title="CI"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        showSearch={false}
      />

      {/* px-4 = the mockup's 16px `.body` gutter, matching the New tab. The two
          tabs are one screen; a 4px step between them shows when he switches. */}
      <div className="px-4 pt-3" style={{ paddingBottom: MOBILE_NAV_CLEARANCE }}>
        {loading && board === null && (
          <p className="text-[13px] text-gray-400 text-center py-10">Loading…</p>
        )}
        {error !== null && (
          <p className="text-[13px] text-[#b42318] text-center py-10">{error}</p>
        )}

        {board !== null && board.withBilling.length === 0 && board.finished.length === 0 && (
          <p className="text-[13px] text-gray-400 text-center py-10">
            Nothing submitted yet.
          </p>
        )}

        {board !== null && board.withBilling.length > 0 && (
          <>
            <SectionHeading>With billing</SectionHeading>
            {board.withBilling.map((row) => (
              <CiCard key={row.id} row={row} onOpen={openCi} />
            ))}
          </>
        )}

        {board !== null && board.finished.length > 0 && (
          <>
            {/* ⚠ NAMES THE WINDOW. The finished band is the LAST SEVEN DAYS
                (buildCiSupervisorWhere), not everything he has ever raised, and
                he has no date stepper to discover that with — this phone face
                has none by design. A heading that just said "Finished" would let
                an older CI's absence read as a lost return. */}
            <SectionHeading>Finished · last 7 days</SectionHeading>
            {board.finished.map((row) => (
              <CiCard key={row.id} row={row} onOpen={openCi} />
            ))}
          </>
        )}
      </div>
    </div>

    {/* ── The open CI ──────────────────────────────────────────────────────
        Always mounted, parked off-screen with `translate-x-full`, sliding in
        on the New tab's exact tokens. */}
    <div
      className={
        "fixed inset-0 z-30 bg-[#F4F6F7] flex flex-col transition-transform duration-200 ease-out " +
        (ciOpen ? "translate-x-0" : "translate-x-full")
      }
      aria-hidden={!ciOpen}
      {...(ciOpen ? {} : { inert: "" as unknown as boolean })}
    >
      <CiSubmittedDetail
        detail={detail}
        bill={bill}
        editable={editable}
        raced={raced}
        materialMoved={materialMoved}
        onMaterialMoved={setMaterialMoved}
        receivedOn={receivedOn}
        onReceivedOn={setReceivedOn}
        reason={reason}
        onOpenReasons={() => {
          setReasonSheetOpen(true);
          pushScreen();
        }}
        remark={remark}
        onRemark={setRemark}
        returned={returned}
        onOpenLine={(line) => {
          setSheetLine(line);
          pushScreen();
        }}
        activePackFilter={activePackFilter}
        onPackFilter={setActivePackFilter}
        dirty={dirty}
        saving={saving}
        onSave={() => void onSave()}
      />
    </div>

    {/* ── The two sheets ───────────────────────────────────────────────────
        THE SAME COMPONENTS THE NEW FLOW USES, on the same shared geometry
        (components/ci/sheet.tsx). Editing a return and raising one are the same
        gesture and must not become two dialects.

        🔴 EVERY DISMISS GOES THROUGH history.back(), never a direct setState —
        that is what keeps the popstate handler above the ONE authority, so the
        hardware back button and a tap on the scrim do identical things. */}
    {sheetLine !== null && (
      <CiQtySheet
        line={sheetLine}
        initialQty={returned.get(sheetLine.rawLineItemId) ?? null}
        onCancel={() => window.history.back()}
        onSave={(qty) => {
          setReturned((prev) => {
            const next = new Map(prev);
            // qty 0 means "this line did not come back after all" — remove it
            // rather than storing a 0-tin row on a printed return.
            if (qty <= 0) next.delete(sheetLine.rawLineItemId);
            else next.set(sheetLine.rawLineItemId, qty);
            return next;
          });
          window.history.back();
        }}
      />
    )}

    {reasonSheetOpen && (
      <CiReasonSheet
        reasons={reasons}
        error={reasonsError}
        selectedId={reason?.id ?? null}
        onPick={(r) => {
          setReason(r);
          window.history.back();
        }}
        onCancel={() => window.history.back()}
      />
    )}
    </>
  );
}

// ── Change detection ─────────────────────────────────────────────────────────
//
// A stable string of everything he can edit. Comparing strings rather than
// diffing objects keeps `dirty` honest about ONE thing: is the form different
// from what was loaded? Line ids are SORTED so the map's insertion order — which
// changes when he re-taps a line — cannot register as a change on its own.

function snapshotOf(
  materialMoved: string,
  receivedOn: string,
  reasonId: number | null,
  remark: string,
  returned: Map<number, number>,
): string {
  const lines = Array.from(returned.entries())
    .filter(([, qty]) => qty > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([id, qty]) => `${id}:${qty}`)
    .join(",");
  return [materialMoved, receivedOn, reasonId ?? "", remark.trim(), lines].join("|");
}

/** The same snapshot, taken from a freshly loaded CI. */
function snapshot(d: CiDetail, returned: Map<number, number>): string {
  return snapshotOf(
    d.materialMoved === "moved" ? "moved" : "not_moved",
    d.materialReceivedDate.slice(0, 10),
    d.reasonId,
    d.reasonRemark ?? "",
    returned,
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#98a2b3] px-1 pt-3 pb-2">
      {children}
    </p>
  );
}

/**
 * Frame 9's card. The chrome, the 22px/750 dealer name and the `.rMeta` shape
 * all come from the SHARED components/ci/result-card.tsx, which the New tab's
 * search result uses too — the mockup draws them as one object and they had
 * already drifted apart (this face stayed at a 13.5px name through step 7c).
 * Only the three values differ, and they are all this function decides.
 *
 * ⚠ IT NOW TAKES AN onClick, so it renders a <button>. That product decision
 * was made on 2026-09-01 (step 7e) — the note that used to sit here said a tap
 * target "may not be added without a product decision", and this is it. EVERY
 * card opens, including a closed one: viewing is always allowed and only
 * EDITING is gated, so a card that refused to open would hide the record rather
 * than protect it.
 */
function CiCard({
  row,
  onOpen,
}: {
  row: CiBoardRow;
  onOpen: (id: number) => void;
}): React.JSX.Element {
  const done = row.status === "closed";
  return (
    <CiResultCard
      onClick={() => onOpen(row.id)}
      identifier={row.ciNumber}
      // The status WORD, never a colour-only signal — it says the same thing to
      // a reader who cannot tell amber from green. Tones are the mockup's:
      // `.chip.amber` while billing still holds it, `.chip.green` once closed.
      chipLabel={done ? "Done" : "With billing"}
      chipTone={done ? "green" : "amber"}
      name={row.customerName}
      leading={
        row.returnType === "full"
          ? "Full bill"
          : `Part · ${row.lineCount} line${row.lineCount === 1 ? "" : "s"}`
      }
      litres={row.totalLitres}
    />
  );
}
