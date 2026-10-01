import { NextResponse } from "next/server";
import { v2Manifest, v2ManifestResponse } from "../_board/v2-manifest";

// /so-lab/manifest.webmanifest (C.2a, 2026-10-01) — the TEST install only.
// id / start_url / scope = "/so-lab", so it never folds into /po, /po2 or /po9.
// The path has a dot, so middleware never sees it (middleware.ts matcher).
// ⚠ At go-live the SO page takes over /po2 and keeps /po2's own manifest id.

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return v2ManifestResponse(v2Manifest("/so-lab", "Orbit"));
}
