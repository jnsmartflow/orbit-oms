import type { Metadata } from "next";
import PoPage from "./po-page";

// New public mobile order page at /po. Server wrapper so `force-dynamic` is
// honoured — route segment config is ignored inside a "use client" module, so
// the interactive UI lives in po-page.tsx. Mirrors the desktop /place-order
// server/client split (CLAUDE_PLACE_ORDER §17).
//
// /order (app/order/page.tsx) is the FROZEN backup and is not touched.

export const dynamic = "force-dynamic";

// Per-route PWA metadata — installable as its OWN home-screen app ("Orbit PO").
// Next resolves metadata per route and a child segment overrides the parent
// layout for the SAME fields, so /po links /po.webmanifest (start_url "/po")
// and reads "Orbit PO" while every other route keeps the global /manifest.json
// + "OrbitOMS" apple title from app/layout.tsx (which is NOT edited).
//
// iOS A2HS uses the current page URL + these apple-mobile-web-app meta tags
// for the standalone shell / title / icon (the manifest start_url/scope mainly
// serve Android/Chrome) — so installing while on /po opens standalone as
// "Orbit PO" with the universal OrbitOMS icon.
export const metadata: Metadata = {
  manifest: "/po.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Orbit PO",
    // "default" (not the global "black-translucent") so iOS RESERVES the status
    // bar in standalone — content sits BELOW it instead of drawing underneath
    // and overlapping the brand bar. Per-route override; app/layout.tsx stays
    // "black-translucent" for every other route.
    statusBarStyle: "default",
  },
  icons: {
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function Page() {
  return <PoPage />;
}
