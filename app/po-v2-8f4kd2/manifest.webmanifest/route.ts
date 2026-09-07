import { NextResponse } from "next/server";

// Hidden v2 PWA manifest, served at /po-v2-8f4kd2/manifest.webmanifest.
//
// 🔴 CONTAINMENT — this is a ROUTE HANDLER, not a file in public/, precisely so
// that v2 adds nothing outside app/po-v2-8f4kd2/ and deleting that one folder
// removes v2 whole. public/po.webmanifest (which /po uses) is NOT touched.
//
// The segment directory is literally named `manifest.webmanifest`, which is a
// normal App Router route segment (same shape as the documented
// `app/sitemap.xml/route.ts` pattern). It is NOT Next's `app/manifest.ts`
// metadata-file convention — that convention is a FILE at the app root, and
// this is a nested directory containing a route handler.
//
// ⚠ REACHABILITY: the dot in the final segment means middleware NEVER RUNS for
// this URL. middleware.ts:86 is
//     matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"]
// and the `.*\..*` branch of that negative lookahead excludes any path
// containing a dot. Separately, PUBLIC_PATHS carries "/po" (middleware.ts:26)
// and the gate at :36 is a startsWith() prefix match, so this path would be
// waved through even if the matcher did run. Both permit it; only the matcher
// is actually operative. Nothing in middleware.ts was edited.
//
// Icons are v2's OWN, in public/brand/. They used to reference /icon-192.png
// and /icon-512.png, which are the teal Orbit ring — the main app's mark on a
// violet app, which was wrong on every home screen it ever landed on.

export const dynamic = "force-dynamic";

// 🎨 THE TWO COLOURS DO DIFFERENT JOBS AND ARE DELIBERATELY NOT THE SAME.
//
// background_color is the LAUNCH background — Android paints it behind the app
// while it starts, so it is brand.600 and matches the splash the page renders a
// moment later.
//
// theme_color is the toolbar/status bar of the app IN USE, and that is WHITE.
// The violet belongs to the home screen: the icon, the splash, the login. Every
// inner screen is white, and the board is an inner screen.
//
// 🔴 EVERY ICON IS "any maskable", and the PNGs behind them are FULL-BLEED with
// no baked corner radius. Both platforms apply their own mask — iOS a squircle,
// Android whatever the launcher uses, and "maskable" is an explicit promise
// that cropping to a circle is safe. A radius baked into the file shows up as a
// rounded square inside the platform's mask with its corners cut twice. The
// word sits at 62% of the tile, whose corners need a circle of 65.6% against
// the 80% the maskable contract guarantees.
//
// NOTE: `id` is an ADDITION, not a change — public/po.webmanifest has no `id`
// key at all. Without one a browser derives the app id from start_url, which
// would still be distinct here; it is stated explicitly so the v2 install can
// never be folded into the /po install on a device that has both.
const MANIFEST = {
  name: "Orbit",
  short_name: "Orbit",
  description: "Place a depot order — JSW Dulux Surat Depot",
  id: "/po-v2-8f4kd2",
  start_url: "/po-v2-8f4kd2",
  scope: "/po-v2-8f4kd2",
  display: "standalone",
  display_override: ["standalone"],
  background_color: "#7C3AED",
  theme_color: "#FFFFFF",
  orientation: "portrait",
  icons: [
    { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
} as const;

export function GET(): NextResponse {
  // Built explicitly rather than via NextResponse.json(), which stamps
  // `application/json` — a manifest must be served as application/manifest+json.
  return new NextResponse(JSON.stringify(MANIFEST, null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
