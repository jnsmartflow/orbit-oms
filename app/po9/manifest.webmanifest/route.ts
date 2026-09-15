import { NextResponse } from "next/server";
import { v2Manifest, v2ManifestResponse } from "../../po2/v2-manifest";

// The /po9 PWA manifest, served at /po9/manifest.webmanifest.
//
// 🔴 THE SAME BUILDER AS /po2's (app/po2/v2-manifest.ts), with this mount's own
// id / start_url / scope. The separate `id` is what makes /po9 its own
// home-screen app — installing it can never replace, or be folded into, an
// installed /po2.
//
// Reachable without auth for the same two reasons /po2's is: the dot in the
// last segment keeps middleware from running at all (middleware.ts matcher),
// and "/po9" would pass the PUBLIC_PATHS "/po" prefix even if it did run.
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return v2ManifestResponse(v2Manifest("/po9", "Orbit"));
}
