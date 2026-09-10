import type { Metadata, Viewport } from "next";
import PoV2Page from "./po-v2-page";

// The v2 salesman order page. LIVE at /po2 since 2026-09-10.
//
// Server wrapper so `force-dynamic` is honoured: route segment config is
// ignored inside a "use client" module, so the interactive UI lives in
// po-v2-page.tsx. Same server/client split as app/po/page.tsx.
//
// PUBLIC WITH NO MIDDLEWARE EDIT, exactly as /po is. middleware.ts:36 is
// `PUBLIC_PATHS.some((p) => pathname.startsWith(p))` — a PREFIX match — and
// PUBLIC_PATHS already carries "/po" (middleware.ts:26). "/po2" starts with
// "/po", so it is waved through. Nothing was added to that list.
//
// 🔴 THERE IS NO SESSION ON THIS PAGE AND THE CATALOGUE API IS UNGUARDED.
// It used to say the address was "unguessable, not protected", which was true
// of a hidden test route and is not true of a published one. State the fact
// plainly instead: anyone who opens /po2 gets the whole app, and
// /api/order/data — the one route this page calls — answers any request with
// every customer name, code and area the depot holds plus the full catalogue,
// with no session, no token, no rate limit and no origin check. That route is
// shared with /po and /place-order, which is why gating it is its own piece of
// work and not a line in this file. It is P0 on ROADMAP.md.
//
// 🔴 CONTAINMENT RULE — v2 must never modify anything outside this folder.
// STILL TRUE AND STILL WORTH KEEPING now that it has shipped: it is what makes
// the module readable in one place and removable in one command. If v2 needs a
// shared helper changed, COPY it in here rather than editing the original.
// app/po/ is off limits: no imports from it, no edits to it. The two
// documented exceptions are named in po-v2-page.tsx.

export const dynamic = "force-dynamic";

// Per-route PWA metadata — installable as its OWN home-screen app, exactly the
// way /po is (app/po/page.tsx). Next resolves metadata per route and a child
// segment overrides the parent layout for the SAME fields, so this route links
// its own manifest and carries its own home-screen title, while every other
// route keeps the global /manifest.json and the "Orbit" apple title from
// app/layout.tsx (NOT edited).
//
// ⚠ THIS TITLE HAS BEEN WRONG IN A COMMENT TWICE, so it is worth one line of
// history. It shipped as "Orbit v2" in 20f244a5, became "Orbit" in c02c549f
// while the comments still claimed "Orbit v2", went back to "Orbit v2" for the
// hidden-address testing period, and is "Orbit" from the /po2 launch onward —
// permanently, because a home-screen name is cached at install. Read the code,
// never this paragraph.
//
// The manifest is served by a ROUTE HANDLER inside this folder
// (./manifest.webmanifest/route.ts), not a file in public/ — containment: v2
// adds nothing outside app/po2/.
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
  manifest: "/po2/manifest.webmanifest",
  icons: {
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    // 🔴 "Orbit", NAMED FOR THE END STATE ON PURPOSE, SO NOBODY INSTALLS
    // TWICE. It read "Orbit v2" while this was a hidden test address, and the
    // note here said to revert it when v2 replaced /po. That was the wrong
    // moment to pick: NEITHER PLATFORM RE-READS THIS NAME. iOS and Android
    // both cache the title and the icon at INSTALL time, so a shortcut created
    // today keeps whatever it was created with — and every salesman installing
    // at /po2 would have had to delete and re-add later purely to lose a
    // version number. It is the final name from the first install.
    //
    // ⚠ THE ROLLOUT INSTRUCTION IS "DELETE THE OLD ORBIT APP FIRST", and that
    // is deliberate rather than a rough edge. /po2 is a DIFFERENT PWA — its
    // manifest `id` is "/po2" — so it installs alongside the old one rather
    // than replacing it, and two identical icons on one home screen is how an
    // order gets sent twice. One app, one icon, one name.
    title: "Orbit",
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
