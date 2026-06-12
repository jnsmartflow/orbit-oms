"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Loader2, Globe } from "lucide-react";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// Admin Settings › Hide. Three tabs: Rules (built), Hidden Orders + Tags (next).
// Matches docs/mockups/settings/obd-hide-mockup.html (S1 Rules + S2 Add Rule).
// Admin-gated by the admin layout — no re-check here.
// ─────────────────────────────────────────────────────────────────────────────

type TabKey = "rules" | "hidden" | "tags";

interface HideRule {
  id:              number;
  ruleName:        string;
  conditionType:   string;
  conditionTag:    string | null;
  conditionDaysGt: number | null;
  isActive:        boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function useIstClock(): string {
  const [time, setTime] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
      });
      setTime(now);
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return time ? `${time} IST` : "";
}

// ── Root ─────────────────────────────────────────────────────────────────────

export function HideSettingsContent(): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>("rules");
  const [hiddenCount, setHiddenCount] = useState<number | null>(null);
  const clock = useIstClock();

  const tabs: { key: TabKey; label: string }[] = [
    { key: "rules",  label: "Rules" },
    { key: "hidden", label: "Hidden Orders" },
    { key: "tags",   label: "Tags" },
  ];

  return (
    <div className="min-w-0">
      {/* Page header */}
      <div className="h-[52px] border-b border-gray-200 bg-white flex items-center justify-between px-[18px] sticky top-0 z-20">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-gray-400">Settings ›</span>
          <span className="text-[14px] font-semibold text-gray-900">Hide</span>
        </div>
        <span className="text-[11px] text-gray-400 tabular-nums">{clock}</span>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-5 px-[18px] border-b border-gray-200 bg-white sticky top-[52px] z-[19]">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-[12.5px] font-semibold py-[11px] border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5 ${
              tab === t.key
                ? "text-teal-700 border-teal-600"
                : "text-gray-500 border-transparent hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.key === "hidden" && hiddenCount != null && hiddenCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200">
                {hiddenCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="p-[18px]">
        {tab === "rules"  && <RulesTab />}
        {tab === "hidden" && <HiddenOrdersTab onCount={setHiddenCount} />}
        {tab === "tags"   && <ComingNext label="Tags" />}
      </div>
    </div>
  );
}

// ── Placeholder for the not-yet-built tabs ───────────────────────────────────

function ComingNext({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24">
      <div className="text-[14px] font-semibold text-gray-900">{label}</div>
      <div className="text-[12px] text-gray-400 mt-1">Coming next.</div>
    </div>
  );
}

// ── Hidden Orders tab ────────────────────────────────────────────────────────

type HiddenReason =
  | { type: "manual"; text: string | null; by: string | null; at: string | null }
  | { type: "rule";   text: string; by: string }
  | null;

interface HiddenOrderRow {
  id:            number;
  obdNumber:     string;
  orderDateTime: string | null;
  siteName:      string | null;
  reason:        HiddenReason;
}

function formatDayMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
}

function formatHiddenAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "Asia/Kolkata",
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
  return `${date} ${time}`;
}

function HiddenOrdersTab({ onCount }: { onCount: (n: number) => void }): React.JSX.Element {
  const [rows, setRows]       = useState<HiddenOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/hide/hidden-orders", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not load hidden orders");
        return;
      }
      const list: HiddenOrderRow[] = Array.isArray(json.orders) ? json.orders : [];
      setRows(list);
      onCount(list.length);
    } catch (err) {
      console.error("[hidden-orders] load failed", err);
      toast.error("Network error loading hidden orders");
    } finally {
      setLoading(false);
    }
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);

  async function unhide(row: HiddenOrderRow): Promise<void> {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/hide/orders/${row.id}/unhide`, {
        method:      "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not un-hide order");
        return;
      }
      toast.success(`OBD ${row.obdNumber} un-hidden`);
      await load();
    } catch (err) {
      console.error("[hidden-orders] unhide failed", err);
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-[10px] overflow-hidden">
      {/* Card header */}
      <div className="px-4 py-3.5 border-b border-gray-200">
        <h3 className="text-[13px] font-bold text-gray-900">Hidden Orders</h3>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Every hidden order lives here. Nothing is deleted — un-hide any time.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-[13px] font-semibold text-gray-900">Nothing hidden right now</div>
          <div className="text-[12px] text-gray-400 mt-1">
            Orders hidden by a rule or manually will show up here.
          </div>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "16%" }} />
            <col style={{ width: "24%" }} />
            <col style={{ width: "27%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-3.5 py-2.5">OBD / Date</th>
              <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-3.5 py-2.5">Site Name</th>
              <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-3.5 py-2.5">Hidden because</th>
              <th className="text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider px-3.5 py-2.5">Hidden by</th>
              <th className="text-right text-[10px] font-medium text-gray-400 uppercase tracking-wider px-3.5 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50">
                <td className="px-3.5 py-3 align-middle">
                  <div className="font-mono text-[11px] text-gray-800">{row.obdNumber}</div>
                  <div className="text-[10.5px] text-gray-400 mt-0.5">{formatDayMonth(row.orderDateTime)}</div>
                </td>
                <td className="px-3.5 py-3 align-middle">
                  <span className="text-[12.5px] font-bold text-gray-900 truncate block">
                    {row.siteName ?? "—"}
                  </span>
                </td>
                <td className="px-3.5 py-3 align-middle">
                  <HiddenBecause reason={row.reason} />
                </td>
                <td className="px-3.5 py-3 align-middle text-[10.5px] text-gray-400 truncate">
                  <HiddenBy reason={row.reason} />
                </td>
                <td className="px-3.5 py-3 align-middle text-right">
                  {row.reason?.type === "manual" ? (
                    <button
                      type="button"
                      onClick={() => void unhide(row)}
                      disabled={busyId === row.id}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-semibold rounded-md px-2.5 py-1 disabled:opacity-50"
                    >
                      Un-hide
                    </button>
                  ) : row.reason?.type === "rule" ? (
                    // Rule-hidden rows can't be un-hidden individually — the rule
                    // governs them. Turn the rule off in the Rules tab instead.
                    <span className="text-[10.5px] text-gray-400 italic">Managed by rule</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HiddenBecause({ reason }: { reason: HiddenReason }): React.JSX.Element {
  if (!reason) return <span className="text-gray-300">—</span>;
  if (reason.type === "rule") {
    return (
      <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 max-w-full truncate">
        Rule: {reason.text}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 max-w-full truncate">
      Manual · &ldquo;{reason.text ?? "—"}&rdquo;
    </span>
  );
}

function HiddenBy({ reason }: { reason: HiddenReason }): React.JSX.Element {
  if (!reason) return <span>—</span>;
  if (reason.type === "rule") return <span>Auto</span>;
  const at = formatHiddenAt(reason.at);
  return <span>{reason.by ?? "—"}{at ? ` · ${at}` : ""}</span>;
}

// ── Rules tab ────────────────────────────────────────────────────────────────

function RulesTab(): React.JSX.Element {
  const [rules, setRules]     = useState<HideRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId]   = useState<number | null>(null);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editing, setEditing] = useState<HideRule | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/admin/hide/rules", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not load rules");
        return;
      }
      setRules(Array.isArray(json.rules) ? json.rules : []);
    } catch (err) {
      console.error("[hide-rules] load failed", err);
      toast.error("Network error loading rules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleActive(rule: HideRule): Promise<void> {
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/admin/hide/rules/${rule.id}`, {
        method:      "PATCH",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({ isActive: !rule.isActive }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not update rule");
        return;
      }
      toast.success(rule.isActive ? "Rule turned off" : "Rule turned on");
      await load();
    } catch (err) {
      console.error("[hide-rules] toggle failed", err);
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRule(rule: HideRule): Promise<void> {
    if (!window.confirm(`Delete rule "${rule.ruleName}"? Orders it hid will become visible again.`)) {
      return;
    }
    setBusyId(rule.id);
    try {
      const res = await fetch(`/api/admin/hide/rules/${rule.id}`, {
        method:      "DELETE",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not delete rule");
        return;
      }
      toast.success("Rule deleted");
      await load();
    } catch (err) {
      console.error("[hide-rules] delete failed", err);
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-[10px] overflow-hidden">
        {/* Card header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200">
          <div>
            <h3 className="text-[13px] font-bold text-gray-900">Hide Rules</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Rules hide matching orders on every screen. Default: no rules, nothing hidden.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setEditing(null); setModalOpen(true); }}
            className="bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-semibold rounded-[7px] px-3.5 py-2 inline-flex items-center gap-1.5"
          >
            + Add Rule
          </button>
        </div>

        {/* Rows */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-16 text-[12px] text-gray-400">
            No rules yet. Add one to start hiding orders by tag or age.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3.5 px-4 py-3 border-b border-gray-100 last:border-b-0"
            >
              <Toggle
                on={rule.isActive}
                busy={busyId === rule.id}
                onClick={() => void toggleActive(rule)}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-gray-900">{rule.ruleName}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                  <RuleCondition rule={rule} />
                  {!rule.isActive && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-200">
                      OFF
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setEditing(rule); setModalOpen(true); }}
                disabled={busyId === rule.id}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-semibold rounded-md px-2.5 py-1 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void deleteRule(rule)}
                disabled={busyId === rule.id}
                className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold rounded-md px-2.5 py-1 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <p className="text-[10.5px] text-gray-400 mt-3">
        Every change is logged — who turned a rule on/off and when.
      </p>

      {modalOpen && (
        <RuleModal
          editing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); void load(); }}
        />
      )}
    </>
  );
}

// ── Human-readable condition ─────────────────────────────────────────────────

function RuleCondition({ rule }: { rule: HideRule }): React.JSX.Element {
  if (rule.conditionType === "tag" && rule.conditionTag === "HOLD") {
    return (
      <span className="inline-flex items-center gap-1.5">
        Hide if order has
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
          HOLD
        </span>
      </span>
    );
  }
  if (rule.conditionType === "daysOld" && rule.conditionDaysGt != null) {
    return (
      <span>
        Hide if older than <b className="text-gray-700">{rule.conditionDaysGt}</b> days
      </span>
    );
  }
  return <span className="text-gray-400">Unsupported condition</span>;
}

// ── Toggle (matches mockup .tgl) ─────────────────────────────────────────────

function Toggle({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      role="switch"
      aria-checked={on}
      className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${
        on ? "bg-teal-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

// ── Add / Edit modal ─────────────────────────────────────────────────────────

type CondKind = "tag" | "daysOld";

function RuleModal({
  editing,
  onClose,
  onSaved,
}: {
  editing:  HideRule | null;
  onClose:  () => void;
  onSaved:  () => void;
}): React.JSX.Element {
  const [name, setName]       = useState(editing?.ruleName ?? "");
  const [kind, setKind]       = useState<CondKind>(
    editing?.conditionType === "daysOld" ? "daysOld" : "tag",
  );
  const [days, setDays]       = useState<string>(
    editing?.conditionDaysGt != null ? String(editing.conditionDaysGt) : "14",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Esc closes (blocked while submitting)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (submitting) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [submitting, onClose]);

  async function handleSubmit(): Promise<void> {
    if (submitting) return;
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) { setError("Rule name is required."); return; }

    let body: Record<string, unknown>;
    if (kind === "tag") {
      body = { ruleName: trimmedName, conditionType: "tag", conditionTag: "HOLD", conditionDaysGt: null };
    } else {
      const n = parseInt(days, 10);
      if (!Number.isInteger(n) || n < 1) { setError("Days must be a whole number ≥ 1."); return; }
      body = { ruleName: trimmedName, conditionType: "daysOld", conditionDaysGt: n, conditionTag: null };
    }

    setSubmitting(true);
    try {
      const url    = editing ? `/api/admin/hide/rules/${editing.id}` : "/api/admin/hide/rules";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setError(typeof json.error === "string" ? json.error : "Could not save rule.");
        return;
      }
      toast.success(editing ? "Rule updated" : "Rule created");
      onSaved();
    } catch (err) {
      console.error("[hide-rules] save failed", err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-modal-title"
        className="bg-white rounded-[14px] shadow-xl w-[440px] max-w-[92vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-[18px] py-4 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h3 id="rule-modal-title" className="text-[14px] font-bold text-gray-900">
              {editing ? "Edit Hide Rule" : "Add Hide Rule"}
            </h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Hidden orders always stay recoverable in the Hidden Orders tab.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="w-7 h-7 rounded-md text-gray-400 hover:text-gray-600 inline-flex items-center justify-center disabled:opacity-40"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-[18px] flex flex-col gap-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">Rule name</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
              placeholder="Hide HOLD orders"
              disabled={submitting}
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">Condition</label>
            <div className="inline-flex bg-gray-100 rounded-lg p-[3px] gap-0.5">
              {([["tag", "Has a tag"], ["daysOld", "Older than N days"]] as [CondKind, string][]).map(
                ([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setKind(value); if (error) setError(null); }}
                    disabled={submitting}
                    className={`text-[12px] font-semibold px-3 py-1.5 rounded-md ${
                      kind === value ? "bg-teal-600 text-white" : "text-gray-500 hover:bg-white/60"
                    }`}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>

          {kind === "tag" ? (
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">Which tag</label>
              <select
                value="HOLD"
                disabled={submitting}
                onChange={() => { /* HOLD only in v1 */ }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60"
              >
                <option value="HOLD">HOLD</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">Older than (days)</label>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => { setDays(e.target.value); if (error) setError(null); }}
                disabled={submitting}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10 disabled:opacity-60"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[11.5px] text-gray-600">
            <Globe size={14} className="text-gray-400 flex-shrink-0" />
            <span>Applies <b>everywhere</b> (all screens). Stays until you turn the rule off.</span>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-[18px] py-3.5 border-t border-gray-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-[12px] font-semibold rounded-[7px] px-3.5 py-2 disabled:opacity-50"
          >
            Cancel
          </button>
          {/* Modal CTA — teal here to match the approved mockup's "Create rule" button. */}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="bg-teal-600 hover:bg-teal-700 text-white text-[12px] font-semibold rounded-[7px] px-3.5 py-2 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {submitting && <Loader2 className="animate-spin" size={13} />}
            {editing ? "Save changes" : "Create rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
