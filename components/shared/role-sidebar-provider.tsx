"use client";

import { createContext, useContext, useState, useRef, useCallback } from "react";

interface RoleSidebarContextValue {
  isExpanded: boolean;
  expand: () => void;
  collapse: () => void;
}

const RoleSidebarContext = createContext<RoleSidebarContextValue>({
  isExpanded: false,
  expand: () => {},
  collapse: () => {},
});

export function RoleSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expand = useCallback(() => {
    // Cancel any pending collapse
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
    setIsExpanded(true);
  }, []);

  const collapse = useCallback(() => {
    // Small delay (150ms) to prevent flicker when mouse briefly leaves and re-enters
    collapseTimer.current = setTimeout(() => {
      setIsExpanded(false);
      collapseTimer.current = null;
    }, 150);
  }, []);

  return (
    <RoleSidebarContext.Provider value={{ isExpanded, expand, collapse }}>
      {children}
    </RoleSidebarContext.Provider>
  );
}

export function useRoleSidebar() {
  return useContext(RoleSidebarContext);
}
