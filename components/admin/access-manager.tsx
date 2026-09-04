"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Search, Info, ShieldAlert, ShieldCheck } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// /admin/access — per-user page access, by person.
//
// 🔴 WHETHER THIS SCREEN CHANGES WHAT ANYONE CAN DO DEPENDS ON A SWITCH.
// ACCESS_SOURCE (system_config, read via lib/access/source.ts) decides whether
// the app resolves permissions from role_permissions ("role", the default) or
// from the user_page_access rows this screen edits ("user"). The banner at the
// top states which is live, driven by the SAME cached value the resolvers read
// so the two cannot disagree. Being wrong in either direction is dangerous, so
// do not soften either wording into a single hedged sentence.
//
// All display metadata (labels, sections, which actions exist per page) is
// computed on the SERVER and passed in as plain props — lib/permissions.ts
// imports prisma at module scope, so this file must never import a value from
// it. Type-only imports are fine; values are not.
// ─────────────────────────────────────────────────────────────────────────────

export interface PagePerms {
  canView: boolean; canImport: boolean; canExport: boolean;
  canEdit: boolean; canDelete: boolean;
}

export type FlagKey = keyof PagePerms;

export interface AccessPerson {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  initials: string;
  roleLabel: string;
  extraRoles: number;
  landsOn: string;
  missingRows: number;
  stored: Record<string, PagePerms>;
  baseline: Record<string, PagePerms>;
  differs: string[];
}

export interface AccessRow {
  key: string;
  label: string;
  available: Record<FlagKey, boolean>;
}

export interface AccessSection {
  label: string;
  rows: AccessRow[];
}

interface Props {
  people: AccessPerson[];
  sections: AccessSection[];
  flags: FlagKey[];
  /** Where the app is reading permissions from RIGHT NOW — the live ACCESS_SOURCE. */
  accessSource: "role" | "user";
  /** How long a flip of that switch takes to reach every server, in seconds. */
  switchTtlSeconds: number;
  keyCountWarning: string | null;
}

const FLAG_LABEL: Record<FlagKey, string> = {
  canView:   "View",
  canEdit:   "Edit",
  canImport: "Import",
  canExport: "Export",
  canDelete: "Delete",
};

/** A pending toggle, keyed "<pageKey>::<flag>". */
type Pending = Record<string, boolean>;

function pendKey(pageKey: string, flag: FlagKey) { return `${pageKey}::${flag}`; }

export function AccessManager({
  people: initialPeople, sections, flags,
  accessSource, switchTtlSeconds, keyCountWarning,
}: Props) {
  const live = accessSource === "user";
  const [search, setSearch]         = useState("");
  const [people, setPeople]         = useState(initialPeople);
  const [selectedId, setSelectedId] = useState<number | null>(initialPeople[0]?.id ?? null);

  // Pending edits for the CURRENTLY selected person only. Switching person with
  // unsaved changes is blocked below rather than silently dropping them.
  const [pending, setPending] = useState<Pending>({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.roleLabel.toLowerCase().includes(q),
    );
  }, [people, search]);

  const selected   = people.find((p) => p.id === selectedId) ?? null;
  const differsAll = people.filter((p) => p.differs.length > 0).length;
  const pendingCount = Object.keys(pending).length;

  /** Stored value with any pending toggle applied — what the box should show. */
  function shown(person: AccessPerson, pageKey: string, flag: FlagKey): boolean {
    const p = pending[pendKey(pageKey, flag)];
    if (p !== undefined) return p;
    return person.stored[pageKey]?.[flag] ?? false;
  }

  function toggle(person: AccessPerson, pageKey: string, flag: FlagKey) {
    const stored = person.stored[pageKey]?.[flag] ?? false;
    const next   = !shown(person, pageKey, flag);
    const k      = pendKey(pageKey, flag);
    setError(null);
    setPending((prev) => {
      const copy = { ...prev };
      // Toggling back to the stored value REMOVES the pending entry, so the
      // save bar counts real changes and a there-and-back never reaches the API.
      if (next === stored) delete copy[k];
      else copy[k] = next;
      return copy;
    });
  }

  function selectPerson(id: number) {
    if (pendingCount > 0 && id !== selectedId) {
      const ok = window.confirm(
        `You have ${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}. Discard them and switch person?`,
      );
      if (!ok) return;
    }
    setPending({});
    setError(null);
    setSelectedId(id);
  }

  async function save() {
    if (!selected || pendingCount === 0 || saving) return;
    setSaving(true);
    setError(null);

    // Send ONLY the flags that moved, grouped by page key. Never a full grid.
    const changes: Record<string, Partial<Record<FlagKey, boolean>>> = {};
    for (const [k, value] of Object.entries(pending)) {
      const [pageKey, flag] = k.split("::") as [string, FlagKey];
      (changes[pageKey] ??= {})[flag] = value;
    }

    try {
      const res = await fetch(`/api/admin/access/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "Save failed.");
        return;
      }
      // The server recomputes `stored` and `differs` and hands them back — the
      // banner must never be a client-side estimate, since it is the owner's
      // preview of exactly what step 4 will change. A plain fetch + setState is
      // also the pattern CORE §3 mandates over router.refresh() here.
      setPeople((prev) =>
        prev.map((p) =>
          p.id === selected.id
            ? { ...p, stored: data.stored, differs: data.differs, missingRows: 0 }
            : p,
        ),
      );
      setPending({});
    } catch {
      setError("Save failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const labelByKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const r of s.rows) m.set(r.key, r.label);
    return m;
  }, [sections]);

  return (
    <div className="p-5">
      <h1 className="text-[14px] font-semibold text-gray-900">Access</h1>
      <p className="text-[11px] text-gray-400 mt-0.5">
        Who can see what — one person at a time
      </p>

      {/* ── WHICH SOURCE IS LIVE ─────────────────────────────────────────────
          Driven by the same cached ACCESS_SOURCE value every resolver reads,
          so this cannot disagree with what the app is actually enforcing.
          Being wrong in EITHER direction is dangerous — believing ticks are
          live when they are not, or the reverse — so both states are stated
          positively and neither is the quiet default. */}
      <div
        className={cn(
          "mt-3 flex items-start gap-2.5 rounded-[9px] border px-3.5 py-3 text-[11.5px] leading-relaxed",
          live
            ? "border-teal-200 bg-teal-50 text-teal-800"
            : "border-amber-200 bg-amber-50 text-amber-800",
        )}
      >
        {live
          ? <ShieldCheck className="h-4 w-4 shrink-0 mt-px" />
          : <ShieldAlert className="h-4 w-4 shrink-0 mt-px" />}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white",
                live ? "bg-teal-600" : "bg-amber-600",
              )}
            >
              {live ? "Live — per-person ticks" : "Not live — job titles"}
            </span>
            <span className="font-mono text-[10px] opacity-70">
              ACCESS_SOURCE = {accessSource}
            </span>
          </div>
          {live ? (
            <p className="mt-1.5">
              <b>The app is reading the ticks on this screen.</b> What you change here is what
              people can and cannot do — it takes effect within about {switchTtlSeconds} seconds,
              with no deploy. Job titles are now only a label and a starting point.
            </p>
          ) : (
            <p className="mt-1.5">
              <b>The app is still reading job titles.</b> Every menu and permission comes from the
              role table, so a tick on this screen changes nothing yet — it is set-up for the
              switch, and the amber dots are the preview of what flipping it will do. Set{" "}
              <span className="font-mono">ACCESS_SOURCE</span> to{" "}
              <span className="font-mono">user</span> in System Config to go live; it lands within
              about {switchTtlSeconds} seconds.
            </p>
          )}
        </div>
      </div>

      {keyCountWarning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span><b>Page list out of step.</b> {keyCountWarning}</span>
        </div>
      )}

      <div className="mt-4 flex min-h-[520px] overflow-hidden rounded-[10px] border border-gray-200">
        {/* ── Left: people ─────────────────────────────────────────────── */}
        <aside className="w-[212px] shrink-0 overflow-y-auto border-r border-gray-100 bg-[#fcfcfd]">
          <div className="relative m-3 mb-1.5">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a person…"
              className="h-[31px] w-full rounded-[7px] border border-gray-200 pl-7 pr-2 text-[12px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
            />
          </div>

          <p className="px-3.5 pb-1.5 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.09em] text-gray-400">
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
          </p>
          <p
            className={cn(
              "px-3.5 pb-2 text-[10px] font-medium",
              differsAll > 0 ? "text-amber-600" : "text-gray-400",
            )}
          >
            {differsAll} {differsAll === 1 ? "person differs" : "people differ"} from their role access
          </p>

          {filtered.map((p) => {
            const on = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPerson(p.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 border-l-2 px-3 py-2 text-left transition-colors",
                  on
                    ? "border-teal-600 bg-teal-50"
                    : "border-transparent hover:bg-gray-100/70",
                  !p.isActive && !on && "opacity-55",
                )}
              >
                <span
                  className={cn(
                    "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold",
                    on ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500",
                  )}
                >
                  {p.initials}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[12.5px] font-semibold leading-tight",
                      on ? "text-teal-700" : "text-gray-700",
                    )}
                  >
                    {p.name}
                  </span>
                  <span className="mt-px block truncate text-[10px] font-medium text-gray-400">
                    {p.roleLabel}
                    {p.extraRoles > 0 && ` · +${p.extraRoles}`}
                    {!p.isActive && " · inactive"}
                  </span>
                </span>
                {p.differs.length > 0 && (
                  <span
                    title={`${p.differs.length} page(s) differ from role access`}
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                  />
                )}
              </button>
            );
          })}

          {filtered.length === 0 && (
            <p className="px-3.5 py-6 text-center text-[11px] text-gray-400">
              No one matches “{search}”.
            </p>
          )}
        </aside>

        {/* ── Right: the selected person ───────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-gray-400">
              Pick a person on the left.
            </div>
          ) : (
            <>
              <div className="border-b border-gray-100 px-[18px] pb-3.5 pt-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-[16px] font-bold tracking-[-0.01em] text-gray-900">
                    {selected.name}
                  </h2>
                  {!selected.isActive && (
                    <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-gray-500">
                      Inactive
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                  <span>
                    Role <b className="font-semibold text-gray-900">{selected.roleLabel}</b>
                    {selected.extraRoles > 0 && (
                      <span className="text-gray-400"> +{selected.extraRoles} more</span>
                    )}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span>
                    lands on{" "}
                    <b className="font-mono font-semibold text-gray-900">{selected.landsOn}</b> at login
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className={selected.differs.length > 0 ? "text-amber-600" : "text-gray-500"}>
                    <b className="font-semibold">{selected.differs.length}</b>{" "}
                    {selected.differs.length === 1 ? "page" : "pages"} set differently from their role
                  </span>
                </div>

                {/* The "differs" report — the owner's running view of exactly
                    what step 4 will change. Today parity was just proven, so
                    this is the teal "matches" state for everyone. */}
                {selected.differs.length > 0 ? (
                  <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      <b>{selected.differs.length} page{selected.differs.length === 1 ? "" : "s"} differ</b> from what{" "}
                      {selected.roleLabel} grants right now:{" "}
                      {selected.differs.map((k) => labelByKey.get(k) ?? k).join(", ")}.
                      {" "}
                      {live
                        ? `These are live right now for ${selected.name} — the app is reading these ticks, not the role.`
                        : `When the switch is flipped to user, this is what changes for ${selected.name}.`}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-teal-100 bg-teal-50 px-3 py-2 text-[11.5px] text-teal-700">
                    <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      Matches their role exactly
                      {live
                        ? " — so switching source made no difference to them."
                        : " — nothing here changes for them when the switch is flipped."}{" "}
                      Their role sets the starting point; anything you change applies to{" "}
                      <b>them only</b>.
                    </span>
                  </div>
                )}

                {selected.missingRows > 0 && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] text-red-700">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      <b>{selected.missingRows} of the page rows are missing</b> for this person and
                      are shown as off. They were never back-filled — re-run
                      <span className="font-mono"> sql/2026-09-04-user-page-access.sql</span>.
                    </span>
                  </div>
                )}
              </div>

              {/* ── The table — CLAUDE_UI §27 fixed standard ─────────────── */}
              <div className="flex-1 overflow-y-auto">
                <table
                  style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
                >
                  <colgroup>
                    <col style={{ width: "40%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} />
                  </colgroup>
                  <thead>
                    <tr className="h-8 border-b border-[#ebebeb]">
                      <th className="pl-[14px] text-left text-[10px] font-medium uppercase tracking-[0.05em] text-gray-400">
                        Page
                      </th>
                      {flags.map((f) => (
                        <th
                          key={f}
                          className="text-center text-[10px] font-medium uppercase tracking-[0.05em] text-gray-400"
                        >
                          {FLAG_LABEL[f]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section) => (
                      <FragmentSection
                        key={section.label}
                        section={section}
                        flags={flags}
                        person={selected}
                        shown={shown}
                        onToggle={toggle}
                        pending={pending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Sticky save bar ──────────────────────────────────────── */}
              {(pendingCount > 0 || error) && (
                <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-gray-200 bg-white px-4 py-2.5">
                  {error ? (
                    <span className="text-[11.5px] font-medium text-red-600">{error}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setPending({}); setError(null); }}
                      disabled={saving}
                      className="text-[11.5px] font-medium text-gray-500 hover:text-gray-900 disabled:opacity-50"
                    >
                      Discard changes
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[11.5px] font-semibold text-amber-600">
                      {pendingCount} change{pendingCount === 1 ? "" : "s"}
                    </span>
                    <button
                      type="button"
                      onClick={save}
                      disabled={saving || pendingCount === 0}
                      className="h-[34px] rounded-lg bg-teal-600 px-4 text-[12.5px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save changes"}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Legend ───────────────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 bg-[#fcfcfd] px-[18px] py-2.5 text-[10.5px] text-gray-500">
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-[15px] w-[15px] rounded-[4px] border-[1.6px] border-teal-600 bg-teal-600" />
                  On
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-[15px] w-[15px] rounded-[4px] border-[1.6px] border-gray-300 bg-white" />
                  Off
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="not-italic text-gray-300">–</i>
                  The app has no such action on that page — nothing to switch
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Set differently from their role
                </span>
              </div>
            </>
          )}
        </main>
      </div>

      {/* ── Why the dashes, and the standing step-3 notice ──────────────── */}
      <div className="mt-3.5 rounded-[9px] border border-gray-200 bg-[#fafbfc] px-3.5 py-3 text-[11.5px] leading-relaxed text-gray-600">
        <b className="font-bold text-gray-900">Why so many dashes — and why that is the point.</b>
        <br />
        A dash means the app never asks that question for that page. Export is only ever asked on
        MRN. Delete is only ever asked on MRN. Import is only asked on Import OBDs, Sampling
        Library, and the CSV buttons on the master-data screens. Showing a live checkbox everywhere
        would let you switch on things that do nothing — which has already happened: eight Export
        grants are switched on in the database right now and none of them does anything.
      </div>

    </div>
  );
}

// ── One section of rows ───────────────────────────────────────────────────────

function FragmentSection({
  section, flags, person, shown, onToggle, pending,
}: {
  section: AccessSection;
  flags: FlagKey[];
  person: AccessPerson;
  shown: (p: AccessPerson, pageKey: string, flag: FlagKey) => boolean;
  onToggle: (p: AccessPerson, pageKey: string, flag: FlagKey) => void;
  pending: Record<string, boolean>;
}) {
  return (
    <>
      <tr className="bg-[#fbfbfc]">
        <td
          colSpan={flags.length + 1}
          className="h-7 border-b border-[#f0f0f0] pl-[14px] text-[10px] font-semibold uppercase tracking-[0.07em] text-gray-400"
        >
          {section.label}
        </td>
      </tr>

      {section.rows.map((row) => {
        const baseline = person.baseline[row.key];
        const rowDiffers = person.differs.includes(row.key);
        const rowPending = flags.some((f) => pending[`${row.key}::${f}`] !== undefined);

        return (
          <tr
            key={row.key}
            className={cn(
              "h-9 border-b border-[#f0f0f0]",
              rowPending && "bg-amber-50/60",
            )}
          >
            <td className="overflow-hidden pl-[14px] pr-2">
              <div className="flex items-center gap-1.5">
                {rowDiffers && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                )}
                <span className="truncate text-[12.5px] font-semibold leading-tight text-gray-900">
                  {row.label}
                </span>
              </div>
              <span className="block truncate font-mono text-[10px] leading-tight text-gray-400">
                {row.key}
              </span>
            </td>

            {flags.map((flag) => {
              // The dash is COSMETIC. The stored value is still whatever it is,
              // and is still saved and compared — see isActionAvailable()'s
              // header in lib/permissions.ts.
              if (!row.available[flag]) {
                return (
                  <td key={flag} className="text-center align-middle">
                    <span className="select-none text-[13px] text-gray-200">–</span>
                  </td>
                );
              }
              const on     = shown(person, row.key, flag);
              const base   = baseline?.[flag] ?? false;
              const isPend = pending[`${row.key}::${flag}`] !== undefined;
              return (
                <td key={flag} className="text-center align-middle">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    aria-label={`${FLAG_LABEL[flag]} on ${row.label}`}
                    onClick={() => onToggle(person, row.key, flag)}
                    title={
                      on === base
                        ? `${FLAG_LABEL[flag]} — same as their role`
                        : `${FLAG_LABEL[flag]} — their role says ${base ? "on" : "off"}`
                    }
                    className={cn(
                      "relative inline-block h-[17px] w-[17px] rounded-[5px] border-[1.6px] align-middle transition-colors",
                      on ? "border-teal-600 bg-teal-600" : "border-gray-300 bg-white",
                      !on && "hover:border-teal-500",
                      on !== base && "ring-2 ring-amber-300",
                      isPend && "ring-2 ring-amber-500",
                    )}
                  >
                    {on && (
                      <span
                        className="absolute block border-white"
                        style={{
                          left: 4, top: 1, width: 4.5, height: 8.5,
                          borderWidth: "0 2px 2px 0",
                          transform: "rotate(42deg)",
                        }}
                      />
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
