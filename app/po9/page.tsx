import type { Metadata, Viewport } from "next";
import PoV2Page from "../po2/po-v2-page";

// /po9 — THE SAME ORDER PAGE AS /po2, WITH SHIP-TO SWITCHED OFF.
//
// 🔴 A MOUNT, NOT A FORK. This file is the route entry and nothing else: the
// metadata a route has to declare for itself, and one render of the /po2
// component with `shipToEnabled={false}`. Every screen, every rule and every
// byte of the email comes from app/po2/. If you are about to copy a file from
// there into here, stop — add a prop instead.
//
// PUBLIC WITH NO MIDDLEWARE EDIT, exactly as /po and /po2 are: PUBLIC_PATHS
// carries "/po" and the gate is a startsWith() prefix match, so "/po9" passes.
//
// 🔴 SHARED PHONE STORAGE. /po2 and /po9 are one origin, so every po2_* key —
// the live draft, saved drafts, sent orders, stars, favourites — is the same
// data on both. A /po2 draft with a ship-to opens here and shows it read-only;
// see review-screen.tsx.
//
// Server wrapper so `force-dynamic` is honoured — route segment config is
// ignored inside a "use client" module. Same split as app/po2/page.tsx.
export const dynamic = "force-dynamic";

// The metadata is /po2's, value for value, EXCEPT the manifest, which is this
// route's own so /po9 installs as its own home-screen app and can never fold
// into /po2's. The reasoning behind every value (the title, the root apple
// icon, statusBarStyle "default", themeColor on the viewport export) is written
// down once, in app/po2/page.tsx.
export const metadata: Metadata = {
  title: "Orbit",
  manifest: "/po9/manifest.webmanifest",
  icons: {
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    title: "Orbit",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#F5F3FF",
};

export default function Page() {
  return <PoV2Page shipToEnabled={false} />;
}
