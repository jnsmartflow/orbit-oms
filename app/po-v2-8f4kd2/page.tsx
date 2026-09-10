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

// Per-route PWA metadata — installable as its OWN home-screen app, exactly the
// way /po is (app/po/page.tsx). Next resolves metadata per route and a child
// segment overrides the parent layout for the SAME fields, so this route links
// its own manifest and carries its own home-screen title, while every other
// route keeps the global /manifest.json and the "Orbit" apple title from
// app/layout.tsx (NOT edited).
//
// ⚠ THE COMMENTS HERE ONCE SAID "Orbit v2" WHILE THE CODE SAID "Orbit". The
// title shipped as "Orbit v2" in 20f244a5, was changed to "Orbit" in c02c549f,
// and these lines were not changed with it — so they described the code as it
// had been, for two commits, which is exactly how a reader gets misled. It is
// "Orbit v2" again today; see appleWebApp.title below for how long.
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
// 🔴 iOS IGNORES THE MANIFEST FOR HOME-SCREEN ICONS. It reads the
// apple-touch-icon <link> and nothing else, so declaring icons in the manifest
// route does not reach an iPhone at all — which is why this key is set here as
// well, and why the two must be kept pointing at the same artwork.
//
// 🔴 IT POINTS AT THE ROOT ICON, AND THAT IS A CORRECTION. It pointed at
// /brand/apple-touch-icon.png, believed to be v2's own mark against a root icon
// that was "the teal OrbitOMS ring". Neither belief survived looking at the
// pixels: the root icon is a violet tile carrying the SAME outlined wordmark
// the shared component draws, regenerated 2026-09-09, and public/brand/ carries
// the OLDER hand-built letterforms. v2 was showing the superseded drawing on
// the one surface a salesman sees every morning. See the manifest route's own
// note. app/layout.tsx is still untouched and every other route is unaffected.
export const metadata: Metadata = {
  title: "Orbit",
  manifest: "/po-v2-8f4kd2/manifest.webmanifest",
  icons: {
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    // 🔴 "Orbit v2" IS A TESTING LABEL WITH AN END DATE. Both apps are called
    // Orbit and both now carry the same artwork, so on a home screen holding
    // /po and /po-v2-8f4kd2 side by side there is nothing to tell them apart
    // — which is fine at cutover and useless while v2 is being tested against
    // the app it replaces.
    //
    // ⚠ REVERT THIS TO "Orbit" WHEN v2 REPLACES /po. At that point there is
    // one app, and a version number on a salesman's home screen is internal
    // noise he never asked to see.
    //
    // ⚠ NEITHER PLATFORM RE-READS THIS. iOS and Android both cache the name
    // and the icon at INSTALL time, so an existing shortcut keeps whatever it
    // was created with. Testing this means removing the app from the home
    // screen and adding it again.
    title: "Orbit v2",
    statusBarStyle: "default",
  },
};

// ⚠ themeColor lives on the VIEWPORT export, not on `metadata`.
//
// 🔴 #F5F3FF — THE BAND'S OWN COLOUR, so the status bar continues the header
// instead of arguing with it. It is NOT brand.600: a violet slab above a white
// page was the wrong answer and stays the wrong answer. This is the same wash
// the masthead is painted in, which is why it reads as one surface.
//
// The wash is light, so the status bar keeps DARK content. Nothing here forces
// light text: appleWebApp.statusBarStyle is "default" (dark on light), never
// "black-translucent", and Android derives its icon colour from theme_color's
// luminance — #F5F3FF is far above the threshold, so it picks dark.
//
// The task said to add it to the Metadata export. In Next 14 that field is
// DEPRECATED there: `metadata.themeColor` logs "Unsupported metadata
// themeColor is configured in metadata export. Please move it to viewport
// export instead." and is not honoured. Putting it here is the same one-line
// intent, in the one place that actually paints the status bar.
//
// The teal comes from app/layout.tsx:45 — `export const viewport: Viewport =
// { themeColor: "#0d9488", ... }`. That file is NOT edited (reported, per the
// task, for a separate decision). Next shallow-merges viewport per FIELD, the
// same way it merges metadata, so this overrides themeColor for THIS ROUTE
// ONLY and inherits the layout's viewportFit / width / initialScale /
// maximumScale / userScalable / interactiveWidget untouched. Every other
// route keeps the teal.
export const viewport: Viewport = {
  themeColor: "#F5F3FF",
};

export default function Page() {
  return <PoV2Page />;
}
