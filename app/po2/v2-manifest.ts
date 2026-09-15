import { NextResponse } from "next/server";

// The v2 PWA manifest, ONE builder behind TWO route handlers:
//   app/po2/manifest.webmanifest/route.ts   -> /po2/manifest.webmanifest
//   app/po9/manifest.webmanifest/route.ts   -> /po9/manifest.webmanifest
//
// 🔴 A BUILDER, NOT A COPY. /po9 is the same order page as /po2 with ship-to
// switched off (see PoV2Page's `shipToEnabled`), so its manifest is the same
// object with its own id / start_url / scope. Two literal copies would drift the
// first time an icon or a colour changed on one of them.
//
// ⚠ NOT A ROUTE FILE. A route.ts may export only the handlers and segment
// config, so the object lives here and each route calls it.
//
// ⚠ THE KEY ORDER IS THE WIRE. JSON.stringify writes keys in insertion order,
// so reordering the object below changes the bytes /po2 serves. It was moved
// here from the /po2 route unchanged, key for key.

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
// 🔴 id / start_url / scope ARE ALL THE MOUNT, AND ALL THREE MUST BE. The `id`
// is what keeps two installs apart: /po2 and /po9 are different home-screen
// apps, and neither may fold into the other or into /po's (public/po.webmanifest,
// which has no `id` at all). `scope` keeps each app's navigation inside its own
// address.

export function v2Manifest(mount: "/po2" | "/po9", name: string) {
  return {
    name,
    short_name: name,
    description: "Place a depot order — JSW Dulux Surat Depot",
    id: mount,
    start_url: mount,
    scope: mount,
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
}

/**
 * The response both routes return. Built explicitly rather than via
 * NextResponse.json(), which stamps `application/json` — a manifest must be
 * served as application/manifest+json.
 */
export function v2ManifestResponse(manifest: ReturnType<typeof v2Manifest>): NextResponse {
  return new NextResponse(JSON.stringify(manifest, null, 2), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
