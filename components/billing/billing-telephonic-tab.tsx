"use client";

// Billing v2 — the "Telephonic" tab (2026-09-22; entry rail + multi-paste 2026-09-23).
//
// A telephonic order has no mail order, so nothing tells OrbitOMS to hold it or
// that it is a bill-only (CI) order. Billing pastes the SO numbers here straight
// after punching them in SAP — Hold or CI — and the import applies each tag when
// its OBD lands (lib/billing/telephonic-apply.ts). Design:
// docs/prompts/drafts/web-update-2026-09-21-billing-telephonic-tab.md §3.
//
// GEOMETRY — the `344px minmax(0, 1fr)` two-track grid MRN, CI and /floor use
// (components/ci/billing-board.tsx). 🔴 `minmax(0, 1fr)`, never plain `1fr`:
// plain `1fr` floors at the item's content-based minimum and a wide table
// inflates the track. The right pane also carries `min-w-0` — two floors, both
// needed.
//
// 🔴 THE RAIL IS FOR ADDING, NEVER A DETAIL PANE. An entry has too few facts to
// fill one, so nothing is selectable and nothing opens. Without canEdit the rail
// is not rendered at all (hide, never disable — CLAUDE_UI §10) and the lists
// take the full width.
//
// TWO LISTS, DIFFERENT COLUMNS. Waiting has no bill yet, so every bill column
// would be a dash — it gets its own narrow table. The month's table carries the
// bill, and its CI number, state and SAP number are ONE column stacked, not
// three that are empty on every Hold row.
//
// 🔴 EVERYTHING ON A BILL IS READ LIVE — dispatchStatus, invoiceNo, the CI — so
// a bill Floor released, or one whose hold failed, reads as what it is now.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import {
  useBillingTelephonicMarkerSubscription,
  useBillingTelephonicMarkerPause,
} from "@/components/billing/billing-marker-provider";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import {
  currentIstMonth,
  normaliseSoNumber,
  parseSoBlock,
  TELEPHONIC_MAX_PER_ADD,
} from "@/lib/billing/telephonic-so";
import type { TelephonicBill, TelephonicList, TelephonicRow } from "@/lib/billing/telephonic";
import {
  CI_CANCEL_FAILED_REASONS,
  CI_CANCEL_INCOMPLETE,
  HOLD_FAILED,
  isRecordOnlyReason,
} from "@/lib/billing/tag-reasons";

const LIST_URL = "/api/billing/telephonic/list";
const ADD_URL = "/api/billing/telephonic/add";
const REMOVE_URL = "/api/billing/telephonic/remove";

type TagKind = "hold" | "ci";

// Fixed table standard (CLAUDE_UI §27): 32px header, 36px rows, 10px uppercase
// header, 11px data.
const HEAD_TH = "h-[32px] border-b border-[#ebebeb] px-3.5 text-left text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af] whitespace-nowrap overflow-hidden text-ellipsis";
const HEAD_TH_C = "h-[32px] border-b border-[#ebebeb] px-1 text-center text-[10px] font-medium uppercase tracking-[0.05em] text-[#9ca3af]";
const TD = "h-[36px] border-b border-[#f0f0f0] px-3.5 text-[11px] text-[#4b5563] whitespace-nowrap overflow-hidden text-ellipsis";
const TD_C = "h-[36px] border-b border-[#f0f0f0] px-1 text-center text-[11px] text-[#9ca3af]";

/** Waiting: # · SO Number · Tag · Added by · Added · ×. Nothing else — a tag
 *  with no OBD has no bill facts, and a dash column is a column that lies. */
const WAITING_WIDTHS = [6, 24, 16, 26, 18, 10];
/** The month: the full set, CI as ONE stacked column, plus the × an expired row
 *  needs (the design's suggested widths total 100 without it, so Customer/OBD
 *  gives up 2% and Added by 1%). */
const MONTH_WIDTHS = [3, 10, 6, 22, 11, 12, 16, 9, 8, 3];

// 🔴 TAG COLOURS.
// data.* are IDENTITIES, never states (UI §2.1). Hold and CI are two KINDS of
// telephonic order, not two statuses, so an identity colour is right here. Hold
// keeps danger because Hold is red everywhere else in the app. The status pills
// (Waiting / Held / Released / Not held) are unchanged and keep their warn / ok
// / grey / danger state colours.
//
// CI is SOLID ink-900 (`bg-ink-900 text-white`) since 2026-09-24 — ONE colour
// for CI across billing (design web-update-2026-09-24-billing-mo-actions.md §7).
// It was `data.blue` for two days (2026-09-23), which is the Local delivery
// type's identity; blue now belongs to Local only.
// 🔴 SOLID, never the pale ink chip: the pale ink tag was dropped on 2026-09-23
// because it READ AS DISABLED. Do not "soften" it back.
const TAG_CHIP: Record<TagKind, string> = {
  hold: "border border-danger-bd bg-danger-bg text-danger-text",
  ci: "border border-ink-900 bg-ink-900 text-white",
};

const PILL = "inline-block rounded px-1.5 py-px text-[10px] font-semibold";

/** Shown beside the tag of a mail-order CI tag (so_tags.fromMailOrder): the tag
 *  belongs to the mail order's CI mark and is read-only here — no ×, and the
 *  server refuses a remove with 'locked'. */
function FromMailOrder() {
  return (
    <span className="ml-1 text-[10px] text-gray-400" title="Remove it from the mail order">
      from mail order
    </span>
  );
}

function tagLabel(tag: string): string {
  return tag === "ci" ? "CI" : "Hold";
}

function firstName(name: string | null): string {
  return name ? name.split(" ")[0] : "—";
}

function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00+05:30`).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "Asia/Kolkata",
  });
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ── The month picker (tab row, replaces the date stepper on this tab) ───────

/**
 * ‹ September 2026 › — the same chrome as HeaderDateStepper, stepping whole IST
 * months. The right arrow is disabled at the current IST month.
 */
export function TelephonicMonthPicker({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const atCurrent = month >= currentIstMonth(new Date());
  return (
    <div className="inline-flex items-center gap-0">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="cursor-pointer rounded-l-[4px] border border-gray-200 px-[6px] py-[3px] text-[10px] text-gray-400 hover:bg-gray-50"
      >
        <ChevronLeft size={12} />
      </button>
      <span className="inline-flex items-center border-b border-t border-gray-200 px-[10px] py-[3px] text-[10px] font-medium text-gray-900">
        {monthLabel(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        onClick={() => !atCurrent && onChange(shiftMonth(month, 1))}
        className={`rounded-r-[4px] border border-gray-200 px-[6px] py-[3px] text-[10px] text-gray-400 ${
          atCurrent ? "pointer-events-none cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-gray-50"
        }`}
      >
        <ChevronRight size={12} />
      </button>
    </div>
  );
}

// ── Status, per bill, from LIVE data — first match wins ─────────────────────

function BillStatus({ row, bill }: { row: TelephonicRow; bill: TelephonicBill | null }) {
  // No bill yet: the tag's own state is the whole story.
  if (bill === null) {
    return row.state === "expired" ? (
      <span className={`${PILL} bg-gray-100 text-gray-400`}>Expired</span>
    ) : (
      <span className={`${PILL} bg-warn-bg text-warn-text`}>Waiting</span>
    );
  }
  if (bill.ciSkipReason === HOLD_FAILED) {
    return <span className={`${PILL} bg-danger text-white`}>Not held</span>;
  }
  // The CI was raised but the cancel did not land (path c). The detail — held
  // instead, or not even held — is in the tooltip.
  if (bill.ciSkipReason !== null && CI_CANCEL_FAILED_REASONS.includes(bill.ciSkipReason)) {
    return (
      <span className={`${PILL} bg-danger text-white`} title={bill.ciSkipReason}>
        Cancel failed
      </span>
    );
  }
  if (isRecordOnlyReason(bill.ciSkipReason)) {
    return (
      <span className={`${PILL} bg-gray-100 text-gray-500`} title={bill.ciSkipReason ?? undefined}>
        {bill.ciSkipReason}
      </span>
    );
  }
  // CI raised and the bill taken off the floor (path a). "cancel incomplete"
  // lands here too — the bill IS cancelled; the tooltip says what was missed.
  if (bill.workflowStage === "cancelled" && bill.ci !== null) {
    return (
      <span
        className={`${PILL} bg-ink-100 text-ink-700`}
        title={bill.ciSkipReason === CI_CANCEL_INCOMPLETE ? "Cancelled — the assignment clear or the log was not written" : undefined}
      >
        Cancelled
      </span>
    );
  }
  if (bill.dispatchStatus === "hold") {
    return <span className={`${PILL} bg-ok-bg text-ok-text`}>Held</span>;
  }
  // Held on import, then a person released it on Floor.
  return <span className={`${PILL} border border-gray-200 bg-white text-gray-600`}>Released</span>;
}

/** The ONE CI cell: number on top, state under it, SAP's number under that once
 *  closed. Hold rows and bill-less rows show a dash. */
function CiCell({ row, bill }: { row: TelephonicRow; bill: TelephonicBill | null }) {
  if (row.tag !== "ci" || bill === null) return <span className="text-gray-300">—</span>;

  if (bill.ci !== null) {
    const closed = bill.ci.status === "closed";
    return (
      <div className="leading-tight">
        {/* Plain link: /ci cannot open one CI by URL today. */}
        <a href="/ci" className="font-mono text-gray-800 hover:underline">
          {bill.ci.ciNumber ?? "—"}
        </a>
        <div className="mt-px">
          {closed ? (
            <span className={`${PILL} bg-ok-bg text-ok-text`}>Closed</span>
          ) : bill.ci.status === "submitted" ? (
            <span className={`${PILL} bg-warn-bg text-warn-text`}>Submitted</span>
          ) : (
            <span className={`${PILL} bg-gray-100 text-gray-500`}>{bill.ci.status}</span>
          )}
          {closed && bill.ci.sapCiNumber && (
            <span className="ml-1.5 font-mono text-[10px] text-gray-400">{bill.ci.sapCiNumber}</span>
          )}
        </div>
      </div>
    );
  }
  const reason = bill.ciSkipReason;
  if (
    reason !== null &&
    reason !== HOLD_FAILED &&
    reason !== CI_CANCEL_INCOMPLETE &&
    !CI_CANCEL_FAILED_REASONS.includes(reason) &&
    !isRecordOnlyReason(reason)
  ) {
    return (
      <span className="font-semibold text-danger-text" title={reason}>
        Couldn&apos;t raise — do by hand
      </span>
    );
  }
  return <span className="text-gray-300">—</span>;
}

// ── The entry rail's chips ───────────────────────────────────────────────────

type ChipState = "valid" | "already" | "invalid" | "pending";

interface Chip {
  key: string;
  text: string;
  state: ChipState;
  reason?: string;
}

/**
 * 🔴 THE "STILL BEING TYPED" RULE. A token is judged only once it is FINISHED —
 * a separator has been typed after it, or Add was pressed. While the caret sits
 * at the end of the box and the text ends in a digit, that last token is
 * PENDING: no colour, no reason, and it counts as neither valid nor skipped. So
 * "10467" shows nothing; "10467 " (or Enter, or Add) shows "not 10 digits".
 *
 * `caretAtEnd` is false when the operator has clicked back into the middle of
 * the block — then every token is finished, including the last one.
 */
function buildChips(text: string, caretAtEnd: boolean, alreadyOnList: Set<string>): Chip[] {
  const tokens = text.match(/\d+/g) ?? [];
  // Pending only when the text ENDS in a digit (nothing separates it yet) and
  // the caret is still at the end.
  const lastIsUnfinished = caretAtEnd && /\d$/.test(text) && tokens.length > 0;
  const chips: Chip[] = [];
  const seen = new Set<string>();
  let validCount = 0;

  tokens.forEach((token, i) => {
    const isLast = i === tokens.length - 1;
    if (isLast && lastIsUnfinished) {
      chips.push({ key: `${i}-${token}`, text: token, state: "pending" });
      return;
    }
    const so = normaliseSoNumber(token);
    if (so === null) {
      chips.push({ key: `${i}-${token}`, text: token, state: "invalid", reason: "not 10 digits" });
      return;
    }
    if (seen.has(so)) return; // the same number twice in one paste — keep the first
    seen.add(so);
    if (validCount >= TELEPHONIC_MAX_PER_ADD) {
      chips.push({ key: `${i}-${so}`, text: so, state: "invalid", reason: "over 50" });
      return;
    }
    if (alreadyOnList.has(so)) {
      chips.push({ key: `${i}-${so}`, text: so, state: "already", reason: "already on the list" });
      return;
    }
    validCount += 1;
    chips.push({ key: `${i}-${so}`, text: so, state: "valid" });
  });

  return chips;
}

const CHIP_CLASS: Record<ChipState, string> = {
  valid: "border border-gray-200 bg-gray-50 text-gray-700",
  already: "border border-warn/30 bg-warn-bg text-warn-text",
  invalid: "border border-danger-bd bg-danger-bg text-danger-text",
  // Still being typed: no verdict, so no colour.
  pending: "border border-dashed border-gray-200 bg-white text-gray-400",
};

// ── The tab body ─────────────────────────────────────────────────────────────

interface AddOutcome {
  soNumber: string;
  status: "added" | "duplicate" | "invalid";
  existingTag?: string;
  /** The tag on that SO belongs to a mail order's CI mark. */
  existingFromMailOrder?: boolean;
  addedByName?: string | null;
  addedAt?: string;
  reason?: string;
}

export function BillingTelephonicTab({ month, canEdit = false }: { month: string; canEdit?: boolean }) {
  const [data, setData] = useState<TelephonicList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  // No tag preselected on first load; after an add it STAYS selected.
  const [tag, setTag] = useState<TagKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const reqRef = useRef(0);

  const load = useCallback(async (): Promise<TelephonicList | null> => {
    const seq = ++reqRef.current;
    try {
      const res = await fetch(`${LIST_URL}?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      if (!res.ok) {
        if (seq === reqRef.current) setError(`HTTP ${res.status}`);
        return null;
      }
      const body = (await res.json()) as TelephonicList;
      if (seq !== reqRef.current) return null;
      setData(body);
      setError(null);
      return body;
    } catch {
      if (seq === reqRef.current) setError("Could not reach the server.");
      return null;
    } finally {
      if (seq === reqRef.current) setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  useBillingTelephonicMarkerSubscription(load);
  // No refetch while numbers are in the box or a write is in flight — the lists
  // must not move under the operator.
  useBillingTelephonicMarkerPause("telephonic-entry", text.trim() !== "" || busy);

  const waiting = useMemo(() => data?.waiting ?? [], [data]);
  const monthRows = useMemo(() => data?.month ?? [], [data]);
  const expiredCount = useMemo(() => monthRows.filter((r) => r.state === "expired").length, [monthRows]);

  /** Every SO already carrying a live tag, for the warn chip. The server is the
   *  real check — this only saves the operator a round trip. */
  const alreadyOnList = useMemo(
    () => new Set([...waiting, ...monthRows].filter((r) => r.state !== "expired").map((r) => r.soNumber)),
    [waiting, monthRows],
  );

  const chips = useMemo(() => buildChips(text, caretAtEnd, alreadyOnList), [text, caretAtEnd, alreadyOnList]);
  const validChips = chips.filter((c) => c.state === "valid");
  const skippedCount = chips.filter((c) => c.state === "already" || c.state === "invalid").length;
  const canAdd = canEdit && validChips.length > 0 && tag !== null && !busy;

  /** Drop one chip from the box — the text is rebuilt from the tokens that stay. */
  const dropChip = useCallback((key: string) => {
    setText((prev) => {
      const tokens = prev.match(/\d+/g) ?? [];
      const kept = tokens.filter((t, i) => `${i}-${t}` !== key && `${i}-${normaliseSoNumber(t) ?? t}` !== key);
      return kept.length > 0 ? `${kept.join("\n")}\n` : "";
    });
    boxRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    if (!canEdit || tag === null || busy) return;
    // Pressing Add FINISHES every token, including the one under the caret.
    const parsed = parseSoBlock(text);
    if (parsed.valid.length === 0) return;
    setBusy(true);
    setFailure(null);
    setOutcome(null);
    try {
      const res = await fetch(ADD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soNumbers: parsed.valid, tag }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: AddOutcome[];
        applied?: { held: number; ciRaised: number; ciSkipped: number; recordOnly: number; errors: number } | null;
      };
      if (!res.ok) {
        setFailure(body.error ?? `Could not add (HTTP ${res.status}).`);
        return;
      }
      const results = body.results ?? [];
      const added = results.filter((r) => r.status === "added");
      const dupes = results.filter((r) => r.status === "duplicate");
      const bad = results.filter((r) => r.status === "invalid");

      // Anything the server took goes out of the box; everything it refused
      // stays behind with its chip, plus whatever never passed the parse.
      const rejected = [
        ...dupes.map((d) => d.soNumber),
        ...bad.map((b) => b.soNumber),
        ...parsed.invalid.map((i) => i.raw),
      ];
      setText(rejected.length > 0 ? `${rejected.join("\n")}\n` : "");

      const lines: string[] = [];
      if (added.length > 0) lines.push(`${plural(added.length, "SO")} added`);
      for (const d of dupes) {
        lines.push(
          `${d.soNumber} already on the list (${tagLabel(d.existingTag ?? "")}` +
            `${d.existingFromMailOrder ? " from mail order" : ""}` +
            `${d.addedByName ? `, by ${firstName(d.addedByName)}` : ""}` +
            `${d.addedAt ? ` ${istTime(d.addedAt)}` : ""})`,
        );
      }
      for (const b of bad) lines.push(`${b.soNumber} — ${b.reason ?? "could not be added"}`);
      for (const i of parsed.invalid) lines.push(`${i.raw} — ${i.reason}`);

      const fresh = await load();
      if (body.applied) {
        // Bills that were already here — say what happened to each.
        const addedSet = new Set(added.map((a) => a.soNumber));
        for (const row of [...(fresh?.waiting ?? []), ...(fresh?.month ?? [])]) {
          if (!addedSet.has(row.soNumber)) continue;
          for (const bill of row.bills) {
            if (bill.ciSkipReason) lines.push(`${bill.obdNumber}: ${bill.ciSkipReason}`);
            else if (bill.ci) lines.push(`${bill.obdNumber}: held, ${bill.ci.ciNumber ?? "CI"} raised`);
            else lines.push(`${bill.obdNumber}: held`);
          }
        }
        if (body.applied.errors > 0) lines.push("A bill already here could not be tagged — check the row.");
      }
      setOutcome(lines);
    } catch {
      setFailure("Could not reach the server.");
    } finally {
      setBusy(false);
      boxRef.current?.focus();
    }
  }, [canEdit, tag, busy, text, load]);

  const remove = useCallback(
    async (id: number) => {
      setBusy(true);
      try {
        const res = await fetch(REMOVE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setFailure(body.error ?? `Could not remove (HTTP ${res.status}).`);
        }
        await load();
      } catch {
        setFailure("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const empty = !loading && !error && waiting.length === 0 && monthRows.length === 0;

  // ── The rail ───────────────────────────────────────────────────────────────
  const rail = (
    <div className="flex min-h-0 flex-col overflow-y-auto border-r border-gray-200 bg-white px-[14px] py-3">
      <h3 className="text-[12px] font-bold text-gray-900">Add</h3>

      <textarea
        ref={boxRef}
        value={text}
        rows={4}
        placeholder="Paste SO numbers — one per line"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          setCaretAtEnd(e.target.selectionStart === e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          setCaretAtEnd(el.selectionStart === el.value.length);
        }}
        onBlur={() => setCaretAtEnd(false)}
        onKeyDown={(e) => {
          // Enter submits; Shift+Enter is a new line.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        className="mt-2 max-h-[240px] min-h-[88px] w-full resize-y rounded-md border border-gray-200 px-3 py-2 font-mono text-[13px] leading-[1.5] text-gray-900 outline-none placeholder:font-sans placeholder:text-gray-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
      />

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c.key}
              title={c.reason}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-[2px] font-mono text-[11px] ${CHIP_CLASS[c.state]}`}
            >
              {c.text}
              <button
                type="button"
                aria-label={`Remove ${c.text}`}
                onClick={() => dropChip(c.key)}
                className="text-current opacity-50 hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {(validChips.length > 0 || skippedCount > 0) && (
        <p className="mt-2 text-[11px] text-gray-500">
          {validChips.length} will be added
          {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""}
        </p>
      )}

      <div className="mt-3 inline-flex h-[32px] w-full overflow-hidden rounded-md border border-gray-200" role="radiogroup">
        {(["hold", "ci"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={tag === k}
            onClick={() => setTag(k)}
            className={`flex flex-1 items-center justify-center gap-1.5 text-[12px] font-semibold transition-colors ${
              tag === k
                ? k === "hold"
                  ? "bg-danger-bg text-danger-text"
                  : // ring-inset, not a border: the group already has one, and a
                    // second would shift the box on selection.
                    "bg-ink-900 text-white ring-1 ring-inset ring-ink-900"
                : "bg-white text-gray-500 hover:bg-gray-50"
            }`}
          >
            {tag === k && k === "ci" && (
              <span aria-hidden className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-white" />
            )}
            {tagLabel(k)}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!canAdd}
        onClick={() => void submit()}
        className={`mt-2 inline-flex h-[32px] w-full items-center justify-center rounded-md border text-[12px] font-semibold transition-colors ${
          canAdd
            ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700"
            : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
        }`}
      >
        {validChips.length > 0 ? `Add ${validChips.length}` : "Add"}
      </button>

      {/* Always there, directly under the button — the three things the box does
          that are not visible from looking at it. */}
      <p className="mt-1.5 text-[10.5px] text-gray-400">
        Enter adds · Shift+Enter new line · max 50 at a time
      </p>

      {failure && <p className="mt-2 text-[11px] leading-snug text-danger-text">{failure}</p>}

      {/* The outcome lives HERE, not in a toast: a paste of twenty has more to
          say than a toast can hold, and it must stay readable while the
          operator fixes what was refused. */}
      {outcome && outcome.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2">
          {outcome.map((line, i) => (
            <li key={i} className="text-[11px] leading-snug text-gray-600">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // ── The lists ──────────────────────────────────────────────────────────────
  const lists = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <div className="flex-shrink-0 border-b border-gray-200 px-[18px] py-2 text-[11px] text-gray-500">
        {waiting.length} waiting · {monthRows.length} this month
        {expiredCount > 0 ? ` · ${expiredCount} expired` : ""}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && !data ? (
          <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">Could not load the list ({error}).</div>
        ) : empty ? (
          <div className="px-5 py-14 text-center">
            <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center rounded-full bg-gray-100">
              <Clock size={20} className="text-gray-400" />
            </div>
            <h4 className="mt-2 text-[13px] font-semibold text-gray-900">Nothing recorded yet</h4>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-gray-400">
              Type an SO number as soon as you punch a phone order in SAP. It is matched when its delivery arrives.
            </p>
          </div>
        ) : (
          <>
            {waiting.length > 0 && (
              <>
                <div className="border-b border-[#ebebeb] bg-gray-50 px-[18px] py-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500">
                  Waiting for OBD — all dates
                </div>
                {/* Capped, not stretched: six short columns across a wide screen
                    would be mostly whitespace. */}
                <div className="max-w-[720px]">
                  <table className="w-full table-fixed border-collapse">
                    <colgroup>
                      {WAITING_WIDTHS.map((w, i) => (
                        <col key={i} style={{ width: `${w}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th className={HEAD_TH_C}>#</th>
                        <th className={HEAD_TH}>SO Number</th>
                        <th className={HEAD_TH}>Tag</th>
                        <th className={HEAD_TH}>Added by</th>
                        <th className={HEAD_TH}>Added</th>
                        <th className={HEAD_TH_C} aria-label="Remove" />
                      </tr>
                    </thead>
                    <tbody>
                      {waiting.map((row, i) => (
                        <tr key={row.id}>
                          <td className={`${TD_C} border-l-[3px] border-l-warn`}>{i + 1}</td>
                          <td className={`${TD} font-mono text-gray-800`}>{row.soNumber}</td>
                          <td className={TD}>
                            <span className={`${PILL} ${TAG_CHIP[row.tag === "ci" ? "ci" : "hold"]}`}>
                              {tagLabel(row.tag)}
                            </span>
                            {row.fromMailOrder && <FromMailOrder />}
                          </td>
                          <td className={TD}>{firstName(row.addedByName)}</td>
                          <td className={`${TD} !text-gray-400`} title={`${istDay(row.addedAt)} ${istTime(row.addedAt)}`}>
                            {istDay(row.addedAt)}
                          </td>
                          <td className={TD_C}>
                            {canEdit && !row.fromMailOrder && (
                              <button
                                type="button"
                                aria-label={`Remove SO ${row.soNumber}`}
                                disabled={busy}
                                onClick={() => void remove(row.id)}
                                className="inline-flex h-[20px] w-[20px] items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {monthRows.length > 0 && (
              <>
                <div className="border-b border-t border-[#ebebeb] bg-gray-50 px-[18px] py-1.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-gray-500">
                  {monthLabel(month)}
                </div>
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    {MONTH_WIDTHS.map((w, i) => (
                      <col key={i} style={{ width: `${w}%` }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className={HEAD_TH_C}>#</th>
                      <th className={HEAD_TH}>SO Number</th>
                      <th className={HEAD_TH}>Tag</th>
                      <th className={HEAD_TH}>Customer / OBD</th>
                      <th className={HEAD_TH}>Invoice No</th>
                      <th className={HEAD_TH}>Status</th>
                      <th className={HEAD_TH}>CI</th>
                      <th className={HEAD_TH}>Added by</th>
                      <th className={HEAD_TH}>Added</th>
                      <th className={HEAD_TH_C} aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {monthRows.flatMap((row, ri) => {
                      const bills: (TelephonicBill | null)[] = row.bills.length > 0 ? row.bills : [null];
                      const muted = row.state === "expired" ? " !text-gray-400" : "";
                      const showX = canEdit && row.state === "expired" && !row.fromMailOrder;
                      return bills.map((bill, bi) => {
                        const first = bi === 0;
                        return (
                          <tr key={`${row.id}-${bill?.orderId ?? "none"}`}>
                            <td className={TD_C}>{first ? ri + 1 : ""}</td>
                            <td className={`${TD} font-mono text-gray-800${muted}`}>{first ? row.soNumber : ""}</td>
                            <td className={TD}>
                              {first ? (
                                <>
                                  <span className={`${PILL} ${TAG_CHIP[row.tag === "ci" ? "ci" : "hold"]}`}>
                                    {tagLabel(row.tag)}
                                  </span>
                                  {row.fromMailOrder && <FromMailOrder />}
                                </>
                              ) : (
                                /* A second bill on the same SO. */
                                <span className="text-gray-300">↳</span>
                              )}
                            </td>
                            <td className={`${TD} leading-tight${muted}`}>
                              {bill === null ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <>
                                  <div className="overflow-hidden text-ellipsis font-medium text-[#111827]">
                                    {bill.customerName ? smartTitleCase(bill.customerName) : "—"}
                                  </div>
                                  <div className="font-mono text-[10px] text-gray-400">{bill.obdNumber}</div>
                                </>
                              )}
                            </td>
                            <td className={`${TD}${muted}`}>
                              {bill?.invoiceNo ? (
                                <span className="font-mono">{bill.invoiceNo}</span>
                              ) : bill !== null && row.tag === "ci" ? (
                                <span className="text-gray-400">awaiting SAP</span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className={TD}>
                              <BillStatus row={row} bill={bill} />
                            </td>
                            <td className={`${TD}${muted}`}>
                              <CiCell row={row} bill={bill} />
                            </td>
                            <td className={`${TD}${muted}`}>{first ? firstName(row.addedByName) : ""}</td>
                            <td
                              className={`${TD} !text-gray-400`}
                              title={first ? `${istDay(row.addedAt)} ${istTime(row.addedAt)}` : undefined}
                            >
                              {first ? istDay(row.addedAt) : ""}
                            </td>
                            <td className={TD_C}>
                              {first && showX && (
                                <button
                                  type="button"
                                  aria-label={`Remove SO ${row.soNumber}`}
                                  disabled={busy}
                                  onClick={() => void remove(row.id)}
                                  className="inline-flex h-[20px] w-[20px] items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <div
      className="grid min-h-0 flex-1 overflow-hidden"
      // 🔴 minmax(0, 1fr), never plain 1fr — see this file's header.
      style={{ gridTemplateColumns: canEdit ? "344px minmax(0, 1fr)" : "minmax(0, 1fr)" }}
    >
      {canEdit && rail}
      {lists}
    </div>
  );
}
