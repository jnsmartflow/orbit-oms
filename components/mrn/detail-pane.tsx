"use client";

import { useEffect, useMemo, useState } from "react";
import { Clipboard, Download, Pencil, Printer, Trash2 } from "lucide-react";
import type { MrnDetail } from "@/lib/mrn/types";
import { isLineOpenable } from "@/lib/mrn/derive";
import { StatusPill } from "./status-pill";
import { LineDrawer } from "./line-drawer";
import { LinesTable } from "./lines-table";
import { PhotosButton } from "./photos-button";
import { formatDateOnly, formatDuration, formatIstTime } from "./format";
import type { MrnPerms } from "./mrn-shell";

// The right-hand working pane: ONE header block, then the line-items table.
//
// ⚠️ NO TABS, AND NO ACTIVITY — BOTH DELETED 2026-08-26, DELIBERATELY.
// The Lines/Activity pair, the PaneTab component and ActivityTab are gone and
// none of them is coming back as a button, a drawer or a link. Activity was
// never a log: MRN has no audit table, writes nothing to `order_status_logs`
// (design §1) and never will, so that tab could only ever render the same three
// timestamps already sitting on this row — created, unloading start, unloading
// end. Two of the three now appear as FACTS in the header below, which is where
// a fact belongs. A tab strip that hides one panel behind another earns its
// keep only when the hidden panel has something the visible one does not.
//
// ⚠️ THE HEADER CARD IS GONE TOO — components/mrn/header-card.tsx was deleted in
// the same change and its eight fields became the facts row here. It was a
// bordered card floating inside the scroll area, so the identity of the truck
// scrolled away from the number naming it. Do not reintroduce a second header
// surface; this block is the only one.
//
// ⚠️ HIDDEN vs DISABLED — THE DISTINCTION IS THE WHOLE POINT (UI §10), and the
// action row below is built on it:
//
//   HIDDEN  = "not yours" — a ROLE thing. A control the role may never use is
//             not rendered at all. `operations` holds canEdit true but
//             canDelete FALSE, and before this it saw a Delete button, clicked
//             it, and got a raw "Forbidden" back. The route was right to
//             refuse; offering the button was the bug. Same for canExport,
//             which `operations` and `floor_supervisor` both hold false: the
//             report is billing's (design §11 OQ-11).
//   DISABLED = "not yet" — a STATE thing. The two report buttons on an `open`
//             or `checking` MRN: the role owns them, the truck is simply still
//             being counted and the routes 409.
//
// Getting these the wrong way round teaches the operator to distrust the
// screen: a greyed control they can never earn reads as broken software.
//
// 🔴 THE TWO REPORT BUTTONS HOLD THE SAME CORNER IN ALL THREE STATES so their
// position is learnable — grey on open and checking, live on done. What they
// never do is APPEAR AND DISAPPEAR with status. They still vanish entirely
// without canExport, because that is the role axis, not the state axis.
//
// ⚠️ THE CLIENT IS NEVER THE AUTHORITY. Every route re-checks the same
// permission server-side; this only stops the screen offering what the server
// would refuse. Defence in depth — if the two disagree, the ROUTE is right.

interface DetailPaneProps {
  detail: MrnDetail | null;
  loading: boolean;
  error: string | null;
  /** No MRN picked — B2, the first thing billing sees each morning. */
  empty: boolean;
  onPasteLines: () => void;
  onEditHeader: () => void;
  onDelete: () => void;
  perms: MrnPerms;
  onLinesSaved: () => void;
}

export function DetailPane({
  detail,
  loading,
  error,
  empty,
  onPasteLines,
  onEditHeader,
  onDelete,
  perms,
  onLinesSaved,
}: DetailPaneProps): React.JSX.Element {
  // ── The line drawer ───────────────────────────────────────────────────────
  //
  // 🔴 THESE HOOKS SIT ABOVE THE EARLY RETURNS AND MUST STAY THERE. React
  // requires the same hooks in the same order on every render, and the three
  // returns below are all reachable — a hook after them fires on some renders
  // and not others.
  //
  // ⚠ NO ESCAPE LISTENER, DELIBERATELY. components/mrn/modal-shell.tsx:36
  // already owns a window-level `keydown` for this tree, mounted whenever any
  // MRN modal is up — including the remove-line confirm, which opens from the
  // same table as this drawer. Two window-level Esc listeners fire in
  // registration order and one surface closes under the other; CLAUDE_FLOOR.md
  // §4.6 minted a rule against exactly that ("the SINGLE window-level Esc
  // owner … never add a second"). Closing is ✕. If Esc is ever wanted here it
  // belongs in ONE guarded owner for the whole billing tree.
  const [openLineId, setOpenLineId] = useState<number | null>(null);

  // A stale id would point at a line belonging to the PREVIOUS truck — same
  // lineNo, different MRN, wrong numbers in the drawer.
  useEffect(() => {
    setOpenLineId(null);
  }, [detail?.id]);

  // 🔴 BUILT ONCE, FROM isLineOpenable(), IN TABLE ORDER. This list is what
  // makes ‹ › step between the rows worth looking at and skip the clean ones —
  // the arrows walk THIS array, not detail.lines, so position/total read
  // "3 of 4" against the openable set and not against every line on the truck.
  // The table decides which rows get a chevron from the same function, so the
  // two can never disagree about what is clickable.
  const openableLines = useMemo(
    () => (detail ? detail.lines.filter(isLineOpenable) : []),
    [detail],
  );

  // -1 when nothing is open, and also when the open line stopped being openable
  // across a refetch — in which case the drawer simply unmounts rather than
  // showing a line the table no longer offers.
  const openIndex =
    openLineId === null ? -1 : openableLines.findIndex((l) => l.id === openLineId);
  const openLine = openIndex >= 0 ? openableLines[openIndex] : null;

  // 🔴 `min-w-0` ON EVERY ONE OF THESE EARLY RETURNS TOO, not just the real
  // pane below. Each is the GRID ITEM in billing-board's `344px minmax(0,1fr)`
  // track when it renders, and a grid item defaults to `min-width: auto`. They
  // hold small content today so none of them can blow the track out — but the
  // day one gains a long error string or a wide illustration it would, and the
  // failure mode (commit c16e59df) is silent: the pane lays out wider than the
  // track and is clipped, so nothing looks broken, things are just missing.
  if (empty) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2.5 bg-gray-50 text-gray-400">
        <Clipboard size={42} strokeWidth={1.5} className="text-[#cbd2da]" />
        <h3 className="text-[15px] font-semibold text-[#475467]">Pick a truck from the left</h3>
        <p className="text-[12.5px]">or start a new MRN when one reports</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-gray-50 text-[13px] text-gray-400">
        Loading…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-gray-50 text-[13px] text-red-600">
        {error ?? "This MRN could not be loaded."}
      </div>
    );
  }

  return (
    /* 🔴 `min-w-0` IS LOAD-BEARING — THIS ELEMENT IS THE GRID ITEM.
       A grid item defaults to `min-width: auto`, which resolves to its
       content-based minimum. The lines table's 1440px floor propagates up to
       here through three plain blocks, so without this the pane measured
       1438px wide inside an ~830px track: everything in it was laid out at
       1438px and then clipped by the grid's overflow-hidden. Clipping does not
       shrink layout geometry, which is why the symptom read as content cut off
       rather than as a scrollbar. billing-board.tsx's `minmax(0, 1fr)` is the
       other half — NEITHER WORKS ALONE, they are two separate floors.

       ⚠ `relative` WAS THE DRAWER'S MOUNT POINT and no longer needs to be —
       the drawer became a `fixed inset-0` overlay on 2026-08-26 to match Floor
       Control's panel, so it is positioned against the viewport and not against
       this box. The class is kept because it costs nothing and a positioned
       root is the correct default for a pane that may want an in-flow overlay
       again; nothing in this subtree is absolutely positioned today. */
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
      <div className="shrink-0 border-b border-[#eceff2] bg-white px-[18px] pb-4 pt-3">
        {/* ── Title row ─────────────────────────────────────────────────────
            srNo · MRN number · status pill · [ml-auto] the action row. */}
        <div className="flex items-center gap-[9px]">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-gray-900 text-[11px] font-bold tabular-nums text-white">
            {detail.srNo}
          </span>
          <span className="font-mono text-[16px] font-bold tracking-[0.02em] text-gray-900">
            {detail.mrnNumber}
          </span>
          {/* The SAME pill the rail card renders — components/mrn/status-pill.tsx
              owns all four states. The pane used to hand-roll Waiting and Done
              here and import rail-card's CheckingPill for the third; that was
              three definitions of one idea across two files. */}
          <StatusPill row={detail} />

          {/* ── The action row, and where teal goes ──────────────────────
              Teal follows the state's REAL job (UI §10), so it MOVES:

                open     → Paste lines. Until an MRN has lines it has not
                           reached the supervisor at all, so pasting them is
                           unambiguously the job.
                checking → NOTHING IS TEAL, deliberately. §10 says "never
                           zero", but that assumes a state that HAS a job.
                           This one has none: the header, the lines and the
                           delete are all 409'd by the server, and the report
                           routes 409 too — the truck is still being counted.
                           Manufacturing a teal button here would point the
                           operator at something that cannot help them. The
                           absence IS the message.
                done     → Download XLS, which is the whole reason this screen
                           replaces a sheet of paper.

              The selected rail card's teal tint is SELECTION, not an action,
              and does not compete — the same way Delivery Challan's left panel
              does not. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* ── Photos ───────────────────────────────────────────────────
                A PEER of the controls beside it, not a new kind of thing: same
                h-8 box model, same border, same weight, and it sits in the same
                right-aligned run.

                🔴 IT RENDERS NOTHING AT ZERO PHOTOS — the component returns
                null, so there is no greyed button and no "0" badge. That is the
                one case where absence is right rather than a disabled state:
                UI §10's "disabled means NOT YET" needs a state that will
                eventually have something, and a truck nobody photographed
                never will.

                ⚠ IT IS DELIBERATELY NOT GATED ON canExport. The two report
                controls are billing's alone (design §11 OQ-11), but a photo is
                evidence anyone who can see the MRN may need to look at —
                `operations` and `floor_supervisor` both hold canView. The
                viewer's DELETE is the only thing inside that is permissioned,
                on canDelete plus done/closed.

                ⚠ AND NOT GATED ON STATUS. Photos exist from 'checking' onward,
                so the control appears the moment the supervisor takes one and
                stays for the life of the MRN — unlike the report links beside
                it, which cannot work until the truck is finished. */}
            <PhotosButton detail={detail} canDelete={perms.canDelete} />

            {detail.status === "open" && (
              <>
                {/* 🔴 THE ONLY ENTRY POINT TO EditHeaderModal. It used to be a
                    pencil inside header-card.tsx, which was deleted in this
                    change; the gate travelled with it UNALTERED —
                    `status === "open" && canEdit`. The PATCH route 409s once
                    the supervisor taps Start (design §5), so this is ABSENT on
                    checking/done rather than disabled: UI §10's disabled
                    treatment means "not yet", not "never here". If this button
                    is ever removed, edit-header becomes unreachable. */}
                {perms.canEdit && (
                  <PaneButton
                    icon={<Pencil size={13} />}
                    label="Edit header"
                    onClick={onEditHeader}
                  />
                )}
                {/* HIDDEN without canEdit. Teal because on an open MRN this is
                    the job — and it stays teal even when the others are
                    hidden, so the state still has exactly one. */}
                {perms.canEdit && (
                  <PaneButton
                    icon={<Clipboard size={13} />}
                    label="Paste lines"
                    tone="primary"
                    onClick={onPasteLines}
                  />
                )}
                {/* HIDDEN without canDelete — `operations` never sees it. */}
                {perms.canDelete && (
                  <PaneButton icon={<Trash2 size={13} />} label="Delete" onClick={onDelete} />
                )}
              </>
            )}

            {/* HIDDEN without canExport — the ROLE axis. Present in all three
                states for a role that HAS it — the STATE axis — so the corner
                never changes shape under the operator's hand. */}
            {/* 🔴 done OR closed, and this condition is one third of a set.
                The other two are the routes these links point at —
                app/api/mrn/[mrnId]/export/route.ts and
                app/mrn/[mrnId]/sheet/page.tsx. All three carry the same rule
                and must be changed together: widen the pane alone and billing
                gets live links that 409; widen the routes alone and the links
                stay grey on a document that is finished. Closing a truck must
                never take its own report away. */}
            {perms.canExport &&
              (detail.status === "done" || detail.status === "closed" ? (
                <>
                  {/* Plain <a>, not fetch calls. Print opens the A4 document
                      route; Download hits the export route, whose
                      Content-Disposition makes the browser save the file. A
                      fetch would have to blob-and-revoke it by hand for no
                      gain. */}
                  <PaneLink
                    icon={<Printer size={13} />}
                    label="Print / PDF"
                    href={`/mrn/${detail.id}/sheet`}
                    newTab
                  />
                  <PaneLink
                    icon={<Download size={13} />}
                    label="Download XLS"
                    href={`/api/mrn/${detail.id}/export`}
                    tone="primary"
                  />
                </>
              ) : (
                <>
                  <DeadButton
                    icon={<Printer size={13} />}
                    label="Print / PDF"
                    title={DISABLED_REPORT_TITLE}
                  />
                  {/* `strong` matches the enabled version's font-semibold. The
                      box model must be IDENTICAL enabled vs disabled — same
                      height, padding, gap, icon and text size — or the whole
                      right-aligned row shifts a couple of pixels when a truck
                      finishes, which is exactly the twitch that stops a
                      position being learnable. */}
                  <DeadButton
                    icon={<Download size={13} />}
                    label="Download XLS"
                    title={DISABLED_REPORT_TITLE}
                    strong
                  />
                </>
              ))}
          </div>
        </div>

        {/* ── Facts row ─────────────────────────────────────────────────────
            ONE flex row, evenly divided, no group captions and no vertical
            dividers. Six facts always; Unloading and Checked by append once
            `unloadingStartAt` exists.

            🔴 THE RULE IS "a fact disappears only when it cannot exist yet",
            and it deliberately SUPERSEDES mockup 09's Waiting/Unloading frames,
            which dropped Delivery no and OTR no in some states and not others.
            A field that vanishes when empty teaches the operator to distrust
            the row: they cannot tell "no OTR number" from "OTR number not
            shown on this kind of truck". An empty fact renders a muted dash and
            holds its place.

            🔴 EVERY CELL IS `flex-1 basis-0 min-w-0` AND TRUNCATES — the same
            floor that bit this pane in c16e59df, one level down. `basis-0`
            stops content setting the base width and `min-w-0` removes the flex
            item's automatic minimum, so no fact — however long an STI ref gets
            — can widen the row past the pane. Without BOTH, one long value
            pushes a horizontal scrollbar onto the whole board. */}
        <div className="mt-3.5 flex">
          {/* ⚠ SOURCE ONLY — the "→ Surat" suffix was dropped 2026-08-26.
              `receivingWarehouse` defaults to 'Surat', is hardcoded by the
              create route and is read-only in the edit modal, so it read the
              same on every MRN the depot has ever raised. A fact that never
              varies is not information; it is width. `receivedFrom` is the half
              that actually changes (TPW / CDC).

              🔴 THE PRINTED DOCUMENTS STILL CARRY IT IN FULL, and must — the
              A4 sheet and the XLS both list "Receiving warehouse" as a header
              field (reportHeaderFields, lib/mrn/report.ts). Different audience:
              a sheet that gets signed and filed has to say where the goods
              landed, because the reader is not sitting in the depot. Do not
              "tidy" the report to match this screen. */}
          <Fact label="Received from">{detail.receivedFrom}</Fact>

          {/* "Reported" is truckReportingDate — the day the truck showed up.
              NOT mrnDate, the day the MRN was raised, which is already
              expressed by which day's rail you are looking at (design §11
              OQ-5). In normal operation they are the same day, which is
              exactly what makes confusing them easy. */}
          <Fact label="Reported">{formatDateOnly(detail.truckReportingDate)}</Fact>

          <Fact label="STI / PO ref no." mono>
            {detail.stiRefNo}
          </Fact>

          <Fact label="Delivery no" mono>
            {detail.deliveryNo}
          </Fact>

          <Fact label="OTR no">{detail.otrNo}</Fact>

          {/* 🔴 THE ONLY PLACE A CREATION TIME APPEARS IN THIS MODULE (design
              §11 OQ-5). The wall-clock at which billing typed the MRN in is a
              different fact from the reporting date, useful only here, and it
              is worded "Created by {name} {HH:MM}" so the two can never be
              mistaken for each other. Do not put a creation time on the rail
              card; that was the mockup's error and it was corrected. */}
          <Fact label="Created by">
            {detail.createdByName}
            {detail.createdByName && <Small> {formatIstTime(detail.createdAt)}</Small>}
          </Fact>

          {/* Appended only once the supervisor has actually started — before
              that these two CANNOT exist, which is the one condition under
              which a fact is allowed to be absent rather than dashed. */}
          {detail.unloadingStartAt && (
            <>
              <Fact label="Unloading">
                {/* done OR closed — an unloading that ENDED shows its window
                    and duration. Gated on 'done' alone, a closed MRN read
                    "10:12 → running" for ever, which is the one fact on this
                    row that cannot be true: the truck cannot still be
                    unloading after billing has filed the document. */}
                {detail.status === "done" || detail.status === "closed" ? (
                  <>
                    {formatIstTime(detail.unloadingStartAt)} →{" "}
                    {formatIstTime(detail.unloadingEndAt)}
                    <Small>
                      {" "}
                      {formatDuration(detail.unloadingStartAt, detail.unloadingEndAt)}
                    </Small>
                  </>
                ) : (
                  <>
                    {formatIstTime(detail.unloadingStartAt)}
                    <Small> → running</Small>
                  </>
                )}
              </Fact>

              {/* 🔴 THE SAME EXPRESSION reportSignatures() USES — end first,
                  falling back to start (lib/mrn/report.ts:215). This cell read
                  `unloadingStartByName` alone until 2026-08-26, so on a truck
                  one supervisor opened and another finished, the screen and the
                  PRINTED SHEET named different people for the same signature
                  line. Whoever ENDED the unloading is the one who counted it.
                  If report.ts's rule ever changes, change this with it — two
                  surfaces, one answer. */}
              <Fact label="Checked by">
                {detail.unloadingEndByName ?? detail.unloadingStartByName}
              </Fact>
            </>
          )}
        </div>
      </div>

      {/* The table starts immediately below the header block — no tab strip.
          Keyed on the MRN id so switching trucks REMOUNTS the table rather than
          leaving one MRN's view filter sitting on another's rows.

          ⚠ THE RIGHT PADDING THAT USED TO WIDEN FOR THE DRAWER IS GONE
          (2026-08-26). While the drawer was an in-pane slab it had to push the
          table aside so nothing sat underneath it; it is now a full-height
          overlay with a scrim, and an overlay does not move the page it covers.
          See line-drawer.tsx's header for the reversal. */}
      <div className="min-h-0 flex-1 overflow-auto px-[18px] py-4">
        <LinesTable
          key={detail.id}
          detail={detail}
          canEdit={perms.canEdit}
          onSaved={onLinesSaved}
          openLineId={openLineId}
          onOpenLine={setOpenLineId}
        />
      </div>

      {/* ⚠ PLACEMENT NO LONGER MATTERS — AND THAT IS THE CHANGE (2026-08-26).
          Through e71ecca7 and 5c91657d this had to be a sibling of the scroll
          box inside the pane's `relative` root, because an absolutely-positioned
          child of an `overflow-auto` container scrolls away with the content.
          The drawer is now a `fixed inset-0` overlay matching Floor Control's
          panel, so it escapes this subtree entirely and renders against the
          viewport. It stays here for readability — this is where the state that
          drives it lives — not because the DOM position is load-bearing.

          position/total/hasPrev/hasNext all come from the index within
          `openableLines`, never from detail.lines — see that memo above. */}
      {openLine && (
        <LineDrawer
          line={openLine}
          receivedFrom={detail.receivedFrom}
          position={openIndex + 1}
          total={openableLines.length}
          hasPrev={openIndex > 0}
          hasNext={openIndex < openableLines.length - 1}
          onPrev={() => setOpenLineId(openableLines[openIndex - 1].id)}
          onNext={() => setOpenLineId(openableLines[openIndex + 1].id)}
          onClose={() => setOpenLineId(null)}
        />
      )}
    </div>
  );
}

const DISABLED_REPORT_TITLE = "The report is ready once the supervisor finishes unloading";

// ── Header bits ─────────────────────────────────────────────────────────────

/**
 * One cell of the facts row.
 *
 * An EMPTY value renders a muted dash and keeps its slot — see the facts-row
 * comment on why a field must not vanish just because it is blank. `children`
 * is treated as empty only when it is null/undefined/"" so a value carrying a
 * <Small> suffix still counts as present.
 */
function Fact({
  label,
  mono,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="min-w-0 flex-1 basis-0 pr-[22px] last:pr-0">
      <div className="truncate text-[9.5px] font-semibold uppercase tracking-[0.06em] text-gray-400">
        {label}
      </div>
      <div
        className={
          "mt-1 truncate text-[13px] " +
          (empty ? "font-normal text-[#c8ced6]" : "font-semibold text-gray-900 ") +
          (mono && !empty ? " font-mono" : "")
        }
      >
        {empty ? "—" : children}
      </div>
    </div>
  );
}

/** The lighter half of a fact — a destination, a duration, a time. Always a
 *  qualifier on the value beside it, never a value of its own. */
function Small({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-[11.5px] font-normal text-gray-400">{children}</span>;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

/** A live action. `primary` is this surface's teal — exactly one per state, and
 *  which one it is changes with status (see the action row above). */
function PaneButton({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "primary";
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] transition-colors " +
        (tone === "primary"
          ? "border-teal-600 bg-teal-600 font-semibold text-white hover:bg-teal-700"
          : "border-gray-200 bg-white font-medium text-[#475467] hover:bg-gray-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * A live action that NAVIGATES rather than calling a handler — the two report
 * links. Visually identical to PaneButton so the action row reads as one set of
 * controls; it is an <a> because a download and a document both want real link
 * behaviour (middle-click, copy address, the browser's own save flow).
 */
function PaneLink({
  icon,
  label,
  href,
  tone,
  newTab,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  tone?: "primary";
  /** The A4 sheet opens in its own tab — billing prints it and comes straight
   *  back to a board that never lost its place. The XLS does NOT: a download
   *  navigation would leave an orphan blank tab behind. */
  newTab?: boolean;
}): React.JSX.Element {
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] transition-colors " +
        (tone === "primary"
          ? "border-teal-600 bg-teal-600 font-semibold text-white hover:bg-teal-700"
          : "border-gray-200 bg-white font-medium text-[#475467] hover:bg-gray-50")
      }
    >
      {icon}
      {label}
    </a>
  );
}

/**
 * An action that exists for this role but cannot act in THIS STATE — grey and
 * genuinely disabled, never a faded primary (UI §10).
 *
 * ⚠ Box model is deliberately identical to PaneButton / PaneLink: same h-8,
 * gap-1.5, rounded-lg, border, px-3, text-[12px]. `strong` matches the enabled
 * teal's font-semibold so the label occupies the same width in both states —
 * without it the right-aligned row shifts a couple of pixels the moment a truck
 * flips to done.
 */
function DeadButton({
  icon,
  label,
  title,
  strong,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled
      title={title}
      className={
        "inline-flex h-8 cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-100 px-3 text-[12px] text-gray-400 " +
        (strong ? "font-semibold" : "font-medium")
      }
    >
      {icon}
      {label}
    </button>
  );
}
