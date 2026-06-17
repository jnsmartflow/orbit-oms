"use client";

import { useEffect } from "react";

// "Print / Save PDF" trigger for the Tint Summary report. The button itself is
// inside a .print-hide container on the page, so it never lands on the printed
// sheet. `auto` lets a ?print=1 deep-link fire the dialog once on load — the
// short delay mirrors challan-content.tsx so React has fully painted the 4 pages
// before the print snapshot is taken.
export default function PrintButton({ auto = false }: { auto?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [auto]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        marginLeft: "auto",
        background: "#1c3f93",
        color: "#fff",
        border: 0,
        borderRadius: 6,
        padding: "7px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      Print / Save PDF
    </button>
  );
}
