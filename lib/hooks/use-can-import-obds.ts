"use client";

import { useEffect, useState } from "react";

/**
 * May the signed-in person import OBDs? Drives `showImport` on every screen
 * with an Import button — Billing / Mail Orders and the five tint screens.
 * ONE helper for all of them; never a per-screen role list (owner, 2026-09-16).
 *
 * Asks GET /api/import/access once per mount, which asks the Import OBDs tick
 * (import_obd canImport) exactly as the import route does.
 *
 * 🔴 DEFAULTS TO FALSE, and every failure stays false — signed out, a non-JSON
 * answer, a network error. The button appears once the answer is yes; it never
 * shows first and then disappears. Fail-closed, like every access provider here.
 *
 * ⚠ For drawing the screen only. POST /api/import/obd re-checks the same tick
 * and is what actually refuses an import.
 */
export function useCanImportObds(): boolean {
  const [canImport, setCanImport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/import/access", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { canImport?: unknown };
        if (!cancelled) setCanImport(data.canImport === true);
      } catch {
        // Stay false.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return canImport;
}
