"use client";

import { createContext, useContext, useEffect, useState } from "react";

interface RoleSidebarContextValue {
  isCollapsed: boolean;
  toggle: () => void;
}

const RoleSidebarContext = createContext<RoleSidebarContextValue>({
  isCollapsed: false,
  toggle: () => {},
});

export function RoleSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("role-sidebar-collapsed");
      setIsCollapsed(stored === "true");
    } catch {}
  }, []);

  function toggle() {
    setIsCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("role-sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  }

  return (
    <RoleSidebarContext.Provider value={{ isCollapsed, toggle }}>
      {children}
    </RoleSidebarContext.Provider>
  );
}

export function useRoleSidebar() {
  return useContext(RoleSidebarContext);
}
