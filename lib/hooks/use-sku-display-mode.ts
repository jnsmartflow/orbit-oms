"use client";

import { useCallback, useEffect, useState } from "react";

export type SkuDisplayMode = "fini" | "generic";

const EVENT_NAME = "orbitoms:sku-display-mode";
const LEGACY_STORAGE_KEY = "orbitoms.displayMode.skuCode";

export function useSkuDisplayMode(): {
  mode:    SkuDisplayMode;
  toggle:  () => void;
  setMode: (mode: SkuDisplayMode) => void;
} {
  // In-memory only. Every page load resets to "fini". Generic is a peek
  // that dies on refresh / navigation / new tab.
  const [mode, setModeState] = useState<SkuDisplayMode>("fini");

  useEffect(() => {
    // One-time cleanup of the old persistent key. Idempotent; a no-op
    // once every browser has had it removed once.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    // Same-page sync only: TM header ↔ Split Builder Modal etc.
    // No cross-tab sync by design.
    function handler(e: Event) {
      const next = (e as CustomEvent<SkuDisplayMode>).detail;
      if (next === "fini" || next === "generic") setModeState(next);
    }
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  const setMode = useCallback((next: SkuDisplayMode) => {
    setModeState(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent<SkuDisplayMode>(EVENT_NAME, { detail: next }));
    }
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: SkuDisplayMode = prev === "fini" ? "generic" : "fini";
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<SkuDisplayMode>(EVENT_NAME, { detail: next }));
      }
      return next;
    });
  }, []);

  return { mode, toggle, setMode };
}
