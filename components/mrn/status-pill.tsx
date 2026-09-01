import type { MrnStatus } from "@/lib/mrn/types";

// 🔴 THE ONE OWNER OF "what state is this truck in, said as a pill".
//
// Both surfaces that show it — the rail card and the detail pane header —
// IMPORT this and neither restates it. Before 2026-08-26 they did not: the pill
// lived as `CheckingPill` inside rail-card.tsx, the pane imported that for its
// `checking` case, and the pane then hand-rolled its own Waiting and Done pills
// beside it. Three definitions of one idea, in two files, guaranteed to drift on
// the next colour change. If a third surface ever needs this, it imports this
// file too — it does not copy the markup.
//
// ⚠️ "CHECKING" BECAME "UNLOADING" IN THE SAME CHANGE. The status VALUE is still
// `checking` — it is CHECK-constrained in the database (`chk_mrn_status`,
// lib/mrn/types.ts) and renaming it would be a SQL migration, not a copy edit.
// Only the word on screen changed, because "unloading" is what the depot calls
// the thing the supervisor is doing while he holds the truck. Never rename the
// value to match the label.
//
// ⚠️ ONE REMAINING COPY OF THE OLD WORD, and it is deliberate for now: the
// SUPERVISOR's phone tab in mrn-shell.tsx still reads "Checking". That is a
// different face with its own three-tab vocabulary (To check · Checking · Done)
// where the tab names have to stay parallel, so changing one of the three is its
// own decision. Flagged, not forgotten.
//
// ⚠️ AND A HISTORY NOTE, so it is not "restored" by mistake: rail cards once had
// NO pill on open and NO pill on done, on the argument that a rail where three
// of four cards wear a pill is a rail where the pill means nothing. That was
// true when `done` also carried a separate All-clear / N-issues chip and a
// "done HH:MM" caption. Those are gone (2026-08-26) — the pill absorbed them,
// so it is now the ONLY status signal on the card and has to cover all four
// cases. Fewer things on the card, not more.

/** Everything the pill needs. Structurally satisfied by MrnBoardRow AND by
 *  MrnDetail, which is the point — one prop shape, both callers. */
export interface MrnStatusLike {
  status: MrnStatus;
  /** LINES needing attention, not units: a line 3 short and 2 leaky is one
   *  thing for the operator to look at, not five (lib/mrn/derive.ts). Already
   *  on both payloads — summariseMrn() puts it there server-side, so no caller
   *  counts anything and no query had to change to render this. */
  issueLineCount: number;
}

export function StatusPill({ row }: { row: MrnStatusLike }): React.JSX.Element {
  if (row.status === "open") {
    return (
      <Pill dot="bg-gray-400" className="bg-gray-100 text-gray-500">
        Waiting
      </Pill>
    );
  }

  if (row.status === "checking") {
    return (
      <Pill dot="bg-amber-500" className="bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        Unloading
      </Pill>
    );
  }

  // closed — billing has recorded the OTR number and filed the document.
  //
  // 🔴 THIS ARM EXISTS TO STOP 'closed' INHERITING DONE'S GREEN. Before it,
  // `closed` reached the fallthrough below and silently wore a green "Done"
  // pill — the one state where the pill would have been lying.
  //
  // NEUTRAL, NOT GREEN AND NOT AN ALARM. Closed is FILED, not a fresh result:
  // the green already fired when the supervisor finished, and repeating it for
  // a second event teaches the reader nothing. Token is CLAUDE_UI.md's neutral
  // pill, `bg-gray-100 text-gray-700 border-gray-200` (§ kanban column header
  // pills), with the border rendered as `ring-1` to match the `checking` arm's
  // idiom in this same file.
  //
  // ⚠ IT MUST NOT BE MISTAKEN FOR `Waiting`, which is also grey. They are
  // opposite ends of the ladder, so they are separated by WEIGHT: Waiting is
  // text-gray-500 on a gray-400 dot with no ring; Closed is text-gray-700 on a
  // gray-600 dot with a ring. Light and empty reads as not-started; darker and
  // outlined reads as settled. Do not flatten the two to the same greys.
  //
  // The issue count rides along exactly as it does on done — a closed MRN with
  // four issues still reads "Closed · 4 issues". Filing a document does not
  // resolve what was wrong with the truck, and the count is the only place
  // that fact is visible on the rail.
  if (row.status === "closed") {
    return (
      <Pill dot="bg-gray-600" className="bg-gray-100 text-gray-700 ring-1 ring-gray-200">
        {row.issueLineCount > 0
          ? `Closed · ${row.issueLineCount} issue${row.issueLineCount === 1 ? "" : "s"}`
          : "Closed"}
      </Pill>
    );
  }

  // done — green when the truck matched the STI, red when it did not. Red is
  // the only alarm colour on this rail; nothing else competes with it.
  return row.issueLineCount > 0 ? (
    <Pill dot="bg-red-500" className="bg-red-50 text-red-700">
      Done · {row.issueLineCount} issue{row.issueLineCount === 1 ? "" : "s"}
    </Pill>
  ) : (
    <Pill dot="bg-green-500" className="bg-green-50 text-green-700">
      Done
    </Pill>
  );
}

/** Shared shell — dot + label. `shrink-0` because this sits at the end of a
 *  flex row beside a truncating SKU or MRN number and must never be the thing
 *  that gives way. */
function Pill({
  dot,
  className,
  children,
}: {
  dot: string;
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[5px] px-[7px] py-[3px] text-[10.5px] font-semibold ${className}`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}
