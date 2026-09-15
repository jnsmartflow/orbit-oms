import { NextResponse } from "next/server";
import { v2Manifest, v2ManifestResponse } from "../v2-manifest";

// The v2 PWA manifest, served at /po2/manifest.webmanifest. LIVE 2026-09-10.
//
// 🔴 CONTAINMENT — this is a ROUTE HANDLER, not a file in public/, precisely so
// that v2 adds nothing outside app/po2/ and deleting that one folder
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
// and the gate at :36 is a startsWith() prefix match — "/po2" starts with "/po"
// — so this path would be
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

// 🔴 THE OBJECT LIVES IN ../v2-manifest.ts NOW, moved there key for key so that
// /po9 — the same order page with ship-to off — can serve its own manifest from
// the same builder instead of a second copy. The notes on the two colours, the
// maskable icons and the `id` moved with it. What this route serves is
// byte-identical to before the move.
//
// ⚠ CONTAINMENT, RESTATED: app/po9/ imports this folder, so deleting app/po2/
// alone now breaks the /po9 build. That failure is loud (a missing module at
// build time), which is the right way for it to fail.

export function GET(): NextResponse {
  return v2ManifestResponse(v2Manifest("/po2", "Orbit"));
}
