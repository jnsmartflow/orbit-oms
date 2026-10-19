"use client";

// The violet 📎 — a bill's dealer / SO challan copies (free-text ship-to,
// 2026-10-19; design §5 "violet 📎 if a copy exists"). One copy → opens it.
// Several → a small list to pick from. Renders NOTHING at count 0.
//
// Reads GET /api/ship-to/copies?orderId (the bill's own copies + the SO's
// Billing copies still visible on it — one rule, server-side) and opens each
// through lib/ship-to/view-copy.ts. Violet = an uploaded copy; the grey pin is
// the system tint DC's and is not this component.

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { openShipToCopy } from "@/lib/ship-to/view-copy";

interface CopyRow {
  id: number;
  owner: "billing" | "floor";
  contentType: string;
}

export function ShipToCopiesPin({ orderId, count }: { orderId: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<CopyRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (count <= 0) return null;

  async function load(): Promise<CopyRow[]> {
    const res = await fetch(`/api/ship-to/copies?orderId=${orderId}`, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { copies?: CopyRow[]; error?: string } | null;
    if (!res.ok) throw new Error(body?.error ?? "Could not load the copies");
    return body?.copies ?? [];
  }

  async function onClick() {
    setErr(null);
    if (count === 1) {
      // The tab opens NOW, inside the click, before the list read that gives
      // the id — a tab opened after an await is stopped by popup blockers.
      const w = window.open("", "_blank");
      try {
        const list = rows ?? (await load());
        setRows(list);
        if (list.length === 1) {
          const problem = await openShipToCopy(list[0].id, w);
          if (problem) setErr(problem);
          return;
        }
        w?.close();
        setOpen(true);
      } catch (e) {
        w?.close();
        setErr(e instanceof Error ? e.message : "Could not load the copies");
      }
      return;
    }
    setOpen((v) => !v);
    if (rows === null) {
      try {
        setRows(await load());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not load the copies");
      }
    }
  }

  return (
    <span ref={boxRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => void onClick()}
        title={count === 1 ? "Open the challan copy" : `${count} challan copies`}
        aria-label="Challan copies"
        className="inline-flex items-center gap-0.5 rounded px-1 text-brand-700 hover:bg-brand-50"
      >
        <Paperclip size={14} strokeWidth={2} />
        {count > 1 && <span className="text-[10.5px] font-semibold">{count}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-[22px] z-20 w-[200px] rounded-lg border border-ink-100 bg-white p-1 shadow-lg">
          {rows === null ? (
            <div className="px-2 py-1.5 text-[11px] text-ink-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-ink-400">No copies.</div>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  void openShipToCopy(r.id).then((p) => p && setErr(p));
                  setOpen(false);
                }}
                className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-900 hover:bg-brand-50"
              >
                📄 Copy {i + 1} · {r.contentType === "application/pdf" ? "PDF" : r.contentType === "image/png" ? "PNG" : "JPG"}
                {r.owner === "billing" && <span className="ml-1 text-[11px] text-ink-400">(Billing)</span>}
              </button>
            ))
          )}
        </div>
      )}
      {err && <span className="ml-1 text-[10.5px] text-danger-text">{err}</span>}
    </span>
  );
}
