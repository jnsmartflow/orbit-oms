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
// Icons REFERENCE the existing files public/po.webmanifest already points at
// (/icon-192.png, /icon-512.png). Nothing was copied, moved or added.

export const dynamic = "force-dynamic";

// Mirrors public/po.webmanifest. Divergences are the six identity fields the
// v2 install needs, PLUS the two colours; description, display_override,
// orientation and icons are carried across verbatim.
//
// 🎨 background_color / theme_color are #FFFFFF, NOT po.webmanifest's #0d9488.
// The teal is /po's brand. v2 is white with violet accents, so a teal splash
// screen and a teal Android status bar would both be wrong on this app.
//
// NOTE: `id` is an ADDITION, not a change — public/po.webmanifest has no `id`
// key at all. Without one a browser derives the app id from start_url, which
// would still be distinct here; it is stated explicitly so the v2 install can
// never be folded into the /po install on a device that has both.
const MANIFEST = {
  name: "Orbit v2",
  short_name: "Orbit v2",
  description: "Place a depot order — JSW Dulux Surat Depot",
  id: "/po-v2-8f4kd2",
  start_url: "/po-v2-8f4kd2",
  scope: "/po-v2-8f4kd2",
  display: "standalone",
  display_override: ["standalone"],
  background_color: "#FFFFFF",
  theme_color: "#FFFFFF",
  orientation: "portrait",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
} as const;

export function GET(): NextResponse {
  // Built explicitly rather than via NextResponse.json(), which stamps
  // `application/json` — a manifest must be served as application/manifest+json.
  return new NextResponse(JSON.stringify(MANIFEST, null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
