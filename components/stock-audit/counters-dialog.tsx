"use client";

// components/stock-audit/counters-dialog.tsx — ONE dialog for "New audit"
// (POST /api/stock-audit/audits) and "Counters" (PUT …/[id]/counters).
//
// The list is GET /api/stock-audit/users: active people who would pass
// stock_audit_count canView through the app's own resolver. Following the
// mockup's userPicker(): a checkbox per person, "Who counts in this audit",
// at least one required. A search box appears once the list is long.
//
// On the Counters face a person already on the audit stays tickable even if
// they are no longer in the assignable list (their tick was taken away) — the
// PUT keeps people who are already there; only ADDED people must be assignable.

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AssignableUser } from "@/lib/stock-audit/types";
import { deskError, fetchAssignableUsers } from "./audit-api";
import type { CountError } from "./count-api";

const SEARCH_FROM = 8;

interface Props {
  open: boolean;
  mode: "new" | "edit";
  /** Edit: the audit number, for the title. */
  auditNumber?: string;
  /** Edit: who is on the audit now. */
  current: { userId: number; name: string }[];
  /** Resolves null on success, or the API error to show. */
  onSave: (counterIds: number[]) => Promise<CountError | null>;
  onClose: () => void;
}

export function CountersDialog({ open, mode, auditNumber, current, onSave, onClose }: Props): React.JSX.Element {
  const [users, setUsers] = useState<AssignableUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set(current.map((c) => c.userId)));
    setQ("");
    setError(null);
    setUsers(null);
    setLoadError(null);
    let live = true;
    void fetchAssignableUsers().then((r) => {
      if (!live) return;
      if (r.ok) setUsers(r.data.users);
      else setLoadError(deskError(r.error));
    });
    return () => {
      live = false;
    };
    // `current` is read once per open, on purpose — a live refresh behind the
    // dialog must not reset ticks the user is changing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Everyone assignable, plus anyone already on the audit who no longer is.
  const people = useMemo(() => {
    const list = [...(users ?? [])];
    const ids = new Set(list.map((u) => u.id));
    for (const c of current) if (!ids.has(c.userId)) list.push({ id: c.userId, name: c.name });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [users, current]);

  const needle = q.trim().toLowerCase();
  const shown = needle === "" ? people : people.filter((p) => p.name.toLowerCase().includes(needle));

  function toggle(id: number): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (picked.size === 0) {
      setError("Pick at least one counter");
      return;
    }
    setSaving(true);
    setError(null);
    const err = await onSave(Array.from(picked));
    setSaving(false);
    if (err) setError(deskError(err));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[16px] font-semibold text-ink-900">
            {mode === "new" ? "New audit" : `Counters for ${auditNumber ?? ""}`}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-ink-500">
            {mode === "new"
              ? "The audit number is assigned when you create it."
              : "Tick who may count. Only ticked people can add counts."}
          </DialogDescription>
        </DialogHeader>

        <div className="text-[12px] text-ink-500">Who counts in this audit</div>

        {people.length >= SEARCH_FROM && (
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a person"
            className="h-9 w-full rounded-md border border-ink-100 px-3 text-[13px] text-ink-900 outline-none focus:border-brand-600"
          />
        )}

        <div className="max-h-[300px] overflow-y-auto">
          {loadError && <p className="py-3 text-[13px] text-danger-text">{loadError}</p>}
          {!loadError && users === null && <p className="py-3 text-[13px] text-ink-400">Loading people…</p>}
          {!loadError && users !== null && people.length === 0 && (
            <p className="py-3 text-[13px] text-ink-500">
              Nobody can be a counter yet — tick “Stock count” for them on Access first.
            </p>
          )}
          {shown.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 border-b border-ink-100 py-2 text-[14px] text-ink-900">
              <input
                type="checkbox"
                checked={picked.has(p.id)}
                onChange={() => toggle(p.id)}
                className="h-4 w-4 accent-data-slate"
              />
              {p.name}
            </label>
          ))}
        </div>

        {mode === "edit" && (
          <p className="text-[12px] text-ink-500">Removing someone keeps the counts they already entered.</p>
        )}
        <p className="min-h-[18px] text-[13px] text-danger-text" role="alert">
          {error}
        </p>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="h-9 rounded-md border border-ink-100 px-4 text-[13px] text-ink-700 hover:bg-ink-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || users === null}
            className="h-9 rounded-md bg-brand-600 px-4 text-[13px] font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "new" ? "Create audit" : "Save"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
