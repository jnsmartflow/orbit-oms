"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Loader2, Globe } from "lucide-react";
import { toast } from "sonner";
import { TAG_CATALOG, type TagCatalogEntry } from "@/lib/hide/tag-catalog";

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
                ? "text-brand-700 border-brand-600"
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
        {tab === "tags"   && <TagsTab />}
      </div>
    </div>
  );
}

// ── Tags tab — "Who sees it" ─────────────────────────────────────────────────
//
// One dropdown per tag instead of a bare on/off. The four modes below are the
// whole vocabulary; the stored rows are DERIVED from the chosen mode by the API
// (app/api/admin/tag-settings/route.ts), never edited one by one here.
//
//   Everyone         everyone row on,  no exceptions
//   Nobody           everyone row off, no exceptions
//   Everyone except… everyone row on  + exception rows off
//   Only…            everyone row off + exception rows on
//
// Changing mode drops the previous mode's exceptions — under the new mode they
// would mean the opposite thing. The screen says so before it happens.

type TagMode = "everyone" | "nobody" | "except" | "only";

const MODE_LABEL: Record<TagMode, string> = {
  everyone: "Everyone",
  nobody:   "Nobody",
  except:   "Everyone except…",
  only:     "Only…",
};

/** One chip: a role (stored by slug) or a person (stored by id). */
type Exception =
  | { kind: "role"; roleSlug: string; label: string }
  | { kind: "user"; userId: number;   label: string };

interface TagRow {
  id:        number;
  tagKey:    string;
  scope:     string;
  roleSlug:  string | null;
  userId:    number | null;
  isEnabled: boolean;
}

interface AudiencePerson { id: number; name: string; roleSlugs: string[]; roleLabel: string }
interface AudienceRole   { slug: string; label: string; count: number }

/** What one tag's stored rows mean, as the dropdown states it. */
function deriveAudience(
  rows: TagRow[],
  people: AudiencePerson[],
  roles: AudienceRole[],
): { mode: TagMode; exceptions: Exception[] } {
  // Default-ON: a tag with no row at all is seen by everyone.
  const everyoneRow = rows.find((r) => r.scope === "everyone");
  const everyoneOn  = everyoneRow ? everyoneRow.isEnabled : true;

  const exceptions: Exception[] = [];
  for (const r of rows) {
    if (r.scope === "role" && r.roleSlug) {
      exceptions.push({
        kind: "role",
        roleSlug: r.roleSlug,
        // A slug whose role has been renamed still shows — as the slug. Silently
        // dropping it would hide a row that is really there and really applies.
        label: roles.find((x) => x.slug === r.roleSlug)?.label ?? r.roleSlug,
      });
    } else if (r.scope === "user" && r.userId != null) {
      const uid = r.userId;
      exceptions.push({
        kind: "user",
        userId: uid,
        label: people.find((p) => p.id === uid)?.name ?? `User ${uid}`,
      });
    }
  }

  if (exceptions.length === 0) return { mode: everyoneOn ? "everyone" : "nobody", exceptions };
  return { mode: everyoneOn ? "except" : "only", exceptions };
}

/** The plain sentence under the chips. Never a restatement of the dropdown. */
function audienceSentence(mode: TagMode, exceptions: Exception[]): string {
  const names = exceptions.map((e) => e.label);
  const list =
    names.length === 0 ? "" :
    names.length === 1 ? names[0] :
    `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  switch (mode) {
    case "everyone": return "Everyone sees it.";
    case "nobody":   return "Nobody sees it.";
    case "except":   return list ? `Everyone sees it, except ${list}.` : "Everyone sees it.";
    case "only":     return list ? `Only ${list} sees it.` : "Nobody sees it.";
  }
}

/** Does this choice hide the badge from anybody? Drives the confirm on important tags. */
function hidesFromSomeone(mode: TagMode): boolean {
  return mode !== "everyone";
}

function TagsTab(): React.JSX.Element {
  const [rows, setRows]       = useState<TagRow[]>([]);
  const [people, setPeople]   = useState<AudiencePerson[]>([]);
  const [roles, setRoles]     = useState<AudienceRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Two independent reads, awaited in sequence. Not Promise.all: the audience
      // list is the smaller, cheaper call and a failure in it must not discard a
      // successful tag read.
      const res  = await fetch("/api/admin/tag-settings", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not load tags");
        return;
      }
      setRows(Array.isArray(json.rows) ? json.rows : []);

      const aRes  = await fetch("/api/admin/tag-audience", { credentials: "include" });
      const aJson = await aRes.json().catch(() => ({}));
      if (aRes.ok && aJson.ok !== false) {
        setPeople(Array.isArray(aJson.people) ? aJson.people : []);
        setRoles(Array.isArray(aJson.roles) ? aJson.roles : []);
      } else {
        // The screen still works: every tag can be set to Everyone or Nobody.
        // Only the exception picker is unavailable, and it says so.
        toast.error("Could not load the list of people — exceptions are unavailable.");
      }
    } catch (err) {
      console.error("[tags] load failed", err);
      toast.error("Network error loading tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rowsFor = useCallback(
    (tagKey: string) => rows.filter((r) => r.tagKey === tagKey),
    [rows],
  );

  /** Send one tag's whole audience. The server derives the rows. */
  async function save(
    entry: TagCatalogEntry,
    mode: TagMode,
    exceptions: Exception[],
  ): Promise<void> {
    // Important tags confirm whenever the choice hides the badge from anyone —
    // not only when it is switched off for everybody. "Only Bankim" hides it from
    // the other five people just as surely as "Nobody" does.
    if (entry.important && hidesFromSomeone(mode)) {
      const who = audienceSentence(mode, exceptions);
      if (!window.confirm(`${entry.label}\n\n${who}\n\nNothing is deleted — only what renders changes. Continue?`)) {
        return;
      }
    }

    setBusyKey(entry.tagKey);
    try {
      const res = await fetch("/api/admin/tag-settings", {
        method:      "PUT",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body: JSON.stringify({
          tagKey: entry.tagKey,
          mode,
          exceptions: exceptions.map((e) =>
            e.kind === "role"
              ? { kind: "role", roleSlug: e.roleSlug }
              : { kind: "user", userId: e.userId },
          ),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        toast.error(typeof json.error === "string" ? json.error : "Could not save this tag");
        // A 409 means somebody else moved first — reload rather than leave the
        // screen showing a state the database does not have.
        if (res.status === 409) await load();
        return;
      }
      // The server returns the recomputed rows, so the screen updates from the
      // answer rather than from a client guess.
      setRows(Array.isArray(json.rows) ? json.rows : []);
      toast.success(`${entry.label} — ${audienceSentence(mode, exceptions).replace(/\.$/, "")}`);
    } catch (err) {
      console.error("[tags] save failed", err);
      toast.error("Network error");
    } finally {
      setBusyKey(null);
      setPickerFor(null);
    }
  }

  // Group by `group`, first-seen order — so a new group appears in the catalog
  // alone, with no second list here to keep in step.
  const groups: { group: string; entries: TagCatalogEntry[] }[] = [];
  for (const entry of TAG_CATALOG) {
    let bucket = groups.find((g) => g.group === entry.group);
    if (!bucket) { bucket = { group: entry.group, entries: [] }; groups.push(bucket); }
    bucket.entries.push(entry);
  }

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-[10px] overflow-hidden">
        <div className="px-4 py-3.5 border-b border-gray-200">
          <h3 className="text-[13px] font-bold text-gray-900">Tags</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Choose who sees each badge. Data is never changed — only what renders. Saves automatically.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.group}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 pt-3.5 pb-1.5">
                {g.group}
              </div>
              {g.entries.map((entry) => {
                const { mode, exceptions } = deriveAudience(rowsFor(entry.tagKey), people, roles);
                return (
                  <TagAudienceRow
                    key={entry.tagKey}
                    entry={entry}
                    mode={mode}
                    exceptions={exceptions}
                    people={people}
                    roles={roles}
                    busy={busyKey === entry.tagKey}
                    pickerOpen={pickerFor === entry.tagKey}
                    onOpenPicker={() => setPickerFor(pickerFor === entry.tagKey ? null : entry.tagKey)}
                    onSave={(m, ex) => void save(entry, m, ex)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      <p className="text-[10.5px] text-gray-400 mt-3">
        A person with more than one job title keeps the badge if any of their roles still shows it.
        Important tags ask before hiding. Every change is recorded against your name.
      </p>
    </>
  );
}

// ── One tag row ──────────────────────────────────────────────────────────────

function TagAudienceRow({
  entry, mode, exceptions, people, roles, busy, pickerOpen, onOpenPicker, onSave,
}: {
  entry:        TagCatalogEntry;
  mode:         TagMode;
  exceptions:   Exception[];
  people:       AudiencePerson[];
  roles:        AudienceRole[];
  busy:         boolean;
  pickerOpen:   boolean;
  onOpenPicker: () => void;
  onSave:       (mode: TagMode, exceptions: Exception[]) => void;
}): React.JSX.Element {
  const needsExceptions = mode === "except" || mode === "only";

  function changeMode(next: TagMode): void {
    if (next === mode) return;
    if (next === "everyone" || next === "nobody") {
      // Moving to a mode that takes no exceptions drops the ones on screen. Said
      // out loud rather than done quietly — the chips are about to vanish.
      if (exceptions.length > 0 &&
          !window.confirm(`Switching to “${MODE_LABEL[next]}” removes the ${exceptions.length} exception${exceptions.length === 1 ? "" : "s"} on this tag. Continue?`)) {
        return;
      }
      onSave(next, []);
      return;
    }
    // except ↔ only keeps the chips: the same people, the opposite meaning. With
    // none yet, the mode is not saved until the first chip is added — the API
    // rejects an empty except/only, and rightly so: it would say nothing.
    if (exceptions.length === 0) { onOpenPicker(); return; }
    onSave(next, exceptions);
  }

  function addException(e: Exception): void {
    const dup = exceptions.some((x) =>
      x.kind === e.kind &&
      (x.kind === "role" ? x.roleSlug === (e as { roleSlug: string }).roleSlug
                         : x.userId  === (e as { userId: number }).userId));
    if (dup) return;
    // Adding the first chip from Everyone/Nobody implies the matching mode: from
    // Everyone you are carving somebody out; from Nobody you are letting somebody in.
    const nextMode: TagMode = needsExceptions ? mode : (mode === "everyone" ? "except" : "only");
    onSave(nextMode, [...exceptions, e]);
  }

  function removeException(e: Exception): void {
    const next = exceptions.filter((x) => x !== e);
    // The last chip removed collapses to the mode that means the same thing:
    // "everyone except nobody" is Everyone, "only nobody" is Nobody.
    if (next.length === 0) { onSave(mode === "except" ? "everyone" : "nobody", []); return; }
    onSave(mode, next);
  }

  return (
    <div className="px-4 py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3.5">
        {/* Badge preview */}
        <div className="w-[88px] flex-shrink-0 pt-0.5">
          <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 max-w-full truncate">
            {entry.label}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-bold text-gray-900 flex items-center gap-1.5">
            {entry.label}
            {entry.important && (
              <span className="text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-px rounded bg-amber-50 text-amber-700 border border-amber-200">
                Important
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5">{entry.description}</div>
        </div>

        {/* Who sees it */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {busy && <Loader2 className="animate-spin text-gray-400" size={13} />}
          <select
            value={mode}
            disabled={busy}
            onChange={(e) => changeMode(e.target.value as TagMode)}
            aria-label={`Who sees ${entry.label}`}
            className="h-[28px] rounded-md border border-gray-200 bg-white px-2 text-[11.5px] font-medium text-gray-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-50"
          >
            {(Object.keys(MODE_LABEL) as TagMode[]).map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Chips + sentence, under the dropdown */}
      <div className="ml-[102px] mt-2">
        {exceptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {exceptions.map((e) => (
              <span
                key={e.kind === "role" ? `r:${e.roleSlug}` : `u:${e.userId}`}
                className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-800 border border-brand-200"
              >
                <span className="text-[9px] font-extrabold uppercase tracking-wide text-brand-600/80">
                  {e.kind === "role" ? "Role" : "Person"}
                </span>
                {e.label}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeException(e)}
                  aria-label={`Remove ${e.label}`}
                  className="text-brand-600 hover:text-red-600 disabled:opacity-50"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          <p className="text-[11px] text-gray-500">{audienceSentence(mode, exceptions)}</p>
          <button
            type="button"
            disabled={busy || people.length === 0}
            onClick={onOpenPicker}
            className="text-[11px] font-semibold text-brand-700 border border-brand-200 rounded-md px-2 py-0.5 hover:bg-brand-50 disabled:opacity-40"
          >
            + Exception
          </button>
        </div>

        {pickerOpen && (
          <AudiencePicker
            people={people}
            roles={roles}
            taken={exceptions}
            onPick={addException}
            onClose={onOpenPicker}
          />
        )}
      </div>
    </div>
  );
}

// ── The picker: one search, two sections ─────────────────────────────────────
//
// People are the ACTIVE users who can open Mail Orders today, and Roles are the
// roles those people hold — both from /api/admin/tag-audience, which reads the
// LIVE access source. Offering anyone else would build a switch that can never fire.

function AudiencePicker({
  people, roles, taken, onPick, onClose,
}: {
  people: AudiencePerson[];
  roles:  AudienceRole[];
  taken:  Exception[];
  onPick: (e: Exception) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();

  const hasRole = (slug: string) => taken.some((t) => t.kind === "role" && t.roleSlug === slug);
  const hasUser = (id: number)   => taken.some((t) => t.kind === "user" && t.userId === id);

  const shownRoles  = roles.filter((r) => !hasRole(r.slug) && (!term || r.label.toLowerCase().includes(term) || r.slug.includes(term)));
  const shownPeople = people.filter((p) => !hasUser(p.id) && (!term || p.name.toLowerCase().includes(term) || p.roleLabel.toLowerCase().includes(term)));

  return (
    <div className="mt-2 w-[300px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      <div className="flex items-center gap-1.5 mb-1.5">
        <input
          type="text"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search roles or people…"
          className="h-[28px] flex-1 rounded-md border border-gray-200 px-2 text-[11px] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-[26px] h-[28px] rounded-md border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center"
        >
          <X size={12} />
        </button>
      </div>

      <div className="max-h-[260px] overflow-y-auto">
        {shownRoles.length > 0 && (
          <>
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-400 px-1 pt-1 pb-1">Roles</div>
            {shownRoles.map((r) => (
              <div
                key={r.slug}
                onClick={() => onPick({ kind: "role", roleSlug: r.slug, label: r.label })}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50"
              >
                <span className="text-[11px] text-gray-700 truncate">{r.label}</span>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {r.count} {r.count === 1 ? "person" : "people"}
                </span>
              </div>
            ))}
          </>
        )}

        {shownPeople.length > 0 && (
          <>
            <div className="text-[9.5px] font-bold uppercase tracking-widest text-gray-400 px-1 pt-2 pb-1">People</div>
            {shownPeople.map((p) => (
              <div
                key={p.id}
                onClick={() => onPick({ kind: "user", userId: p.id, label: p.name })}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50"
              >
                <span className="text-[11px] text-gray-700 truncate">{p.name}</span>
                <span className="text-[10px] text-gray-400 flex-shrink-0 truncate">{p.roleLabel}</span>
              </div>
            ))}
          </>
        )}

        {shownRoles.length === 0 && shownPeople.length === 0 && (
          <p className="px-2 py-3 text-[11px] text-gray-400">Nothing left to add.</p>
        )}
      </div>
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
    <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200 max-w-full truncate">
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
            className="bg-ink-900 hover:bg-ink-700 text-white text-[12px] font-semibold rounded-[7px] px-3.5 py-2 inline-flex items-center gap-1.5"
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
        on ? "bg-brand-600" : "bg-gray-300"
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
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-60"
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
                      kind === value ? "bg-brand-600 text-white" : "text-gray-500 hover:bg-white/60"
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
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-60"
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
                className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] text-gray-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 disabled:opacity-60"
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
            className="bg-brand-600 hover:bg-brand-700 text-white text-[12px] font-semibold rounded-[7px] px-3.5 py-2 inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {submitting && <Loader2 className="animate-spin" size={13} />}
            {editing ? "Save changes" : "Create rule"}
          </button>
        </div>
      </div>
    </div>
  );
}
