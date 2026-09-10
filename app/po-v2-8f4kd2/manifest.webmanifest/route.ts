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
// 🔴 THE ICONS ARE THE ROOT SET, AND THAT IS A CORRECTION.
//
// They pointed at public/brand/ for a while, on the belief that those were
// v2's own mark and the root ones were "the teal Orbit ring" belonging to the
// main app. Both halves turned out to be wrong. The root icons were
// regenerated on 2026-09-09 (67d734e2) from public/icon-source.svg, which
// carries the SAME outlined Plus Jakarta Sans paths the shared OrbitWordmark
// component uses — a violet tile with the real wordmark, no ring anywhere.
// public/brand/ dates from 2026-09-07 and carries the OLDER hand-built
// letterforms, the ones whose O read as a zero. So v2 was shipping the
// superseded drawing on its home screen while every other surface showed the
// good one. Verified by inspecting the pixels, not the filenames.
//
// ⚠ public/brand/ IS LEFT ON DISK, referenced by nothing. Clearing it is a
// cleanup pass of its own and is parked on ROADMAP.md.

export const dynamic = "force-dynamic";

// 🎨 THE TWO COLOURS DO DIFFERENT JOBS AND ARE DELIBERATELY NOT THE SAME.
//
// background_color is the LAUNCH background — Android paints it behind the app
// while it starts, and it must match whatever the page paints a moment later or
// the salesman sees a colour change on every single open.
//
// 🔴 IT IS #FFFFFF NOW, AND IT USED TO BE brand.600. That was correct when the
// React splash was a white wordmark on a full-bleed violet gradient. The splash
// is now WHITE with the mark in violet, so a violet launch background produced
// a violet flash followed by a white screen — the one artefact this key exists
// to prevent, pointing the wrong way.
//
// ⚠ IT IS THE LAUNCH GROUND, NOT AN ICON GROUND. The icons below are fully
// opaque violet tiles with zero transparent pixels, so none of them depends on
// this value and none of them disappears against white. Android will now draw
// a violet tile on a white field during launch.
//
// theme_color is the toolbar/status bar of the app IN USE, and it is #F5F3FF —
// the masthead's own wash, so the status bar continues the header rather than
// cutting a white strip above it. Light enough that Android picks DARK status
// icons from its luminance.
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
  background_color: "#FFFFFF",
  theme_color: "#F5F3FF",
  orientation: "portrait",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
} as const;

export function GET(): NextResponse {
  // Built explicitly rather than via NextResponse.json(), which stamps
  // `application/json` — a manifest must be served as application/manifest+json.
  return new NextResponse(JSON.stringify(MANIFEST, null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
