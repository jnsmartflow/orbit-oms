import type { Metadata, Viewport } from "next";
import PoV2Page from "./po-v2-page";

// Hidden v2 salesman order page — placeholder shell.
//
// Server wrapper so `force-dynamic` is honoured: route segment config is
// ignored inside a "use client" module, so the interactive UI lives in
// po-v2-page.tsx. Same server/client split as app/po/page.tsx.
//
// PUBLIC WITH NO MIDDLEWARE EDIT. middleware.ts:36 is
// `PUBLIC_PATHS.some((p) => pathname.startsWith(p))` — a PREFIX match — and
// PUBLIC_PATHS already carries "/po" (middleware.ts:26). "/po-v2-8f4kd2"
// starts with "/po", so it is waved through. Nothing was added to that list.
// ⚠ The address is UNGUESSABLE, not protected: there is no session here.
//
// 🔴 CONTAINMENT RULE — v2 must never modify anything outside this folder.
// If v2 needs a shared helper changed, COPY it in here rather than editing the
// original, so the whole experiment stays deletable in one command. app/po/ is
// off limits: no imports from it, no edits to it.

export const dynamic = "force-dynamic";

// Per-route PWA metadata — installable as its OWN home-screen app ("Orbit v2"),
// exactly the way /po is (app/po/page.tsx). Next resolves metadata per route and
// a child segment overrides the parent layout for the SAME fields, so this route
// links its own manifest and reads "Orbit v2" while every other route keeps the
// global /manifest.json + "OrbitOMS" apple title from app/layout.tsx (NOT edited).
//
// The manifest is served by a ROUTE HANDLER inside this folder
// (./manifest.webmanifest/route.ts), not a file in public/ — containment: v2
// adds nothing outside app/po-v2-8f4kd2/.
//
// `statusBarStyle: "default"` matches app/po/page.tsx: iOS then RESERVES the
// status bar in standalone so content sits BELOW it instead of drawing
// underneath and overlapping the top bar. app/layout.tsx stays
// "black-translucent" for every other route.
//
// No `icons` key here, deliberately. Next merges metadata PER FIELD, and
// app/layout.tsx:40 already declares
// `icons.apple = { url: "/apple-touch-icon.png", sizes: "180x180" }`. Because
// this object does not set `icons`, that global value is inherited unchanged —
// so the iOS home-screen icon still resolves without v2 restating it or
// referencing any new asset.
export const metadata: Metadata = {
  title: "Orbit v2",
  manifest: "/po-v2-8f4kd2/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Orbit v2",
    statusBarStyle: "default",
  },
};

// ⚠ themeColor lives on the VIEWPORT export, not on `metadata`.
//
// The task said to add it to the Metadata export. In Next 14 that field is
// DEPRECATED there: `metadata.themeColor` logs "Unsupported metadata
// themeColor is configured in metadata export. Please move it to viewport
// export instead." and is not honoured. Putting it here is the same one-line
// intent, in the one place that actually paints the status bar white.
//
// The teal comes from app/layout.tsx:45 — `export const viewport: Viewport =
// { themeColor: "#0d9488", ... }`. That file is NOT edited (reported, per the
// task, for a separate decision). Next shallow-merges viewport per FIELD, the
// same way it merges metadata, so this overrides themeColor for THIS ROUTE
// ONLY and inherits the layout's viewportFit / width / initialScale /
// maximumScale / userScalable / interactiveWidget untouched. Every other
// route keeps the teal.
export const viewport: Viewport = {
  themeColor: "#FFFFFF",
};

export default function Page() {
  return <PoV2Page />;
}
