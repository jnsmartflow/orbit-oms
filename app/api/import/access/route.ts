import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * GET /api/import/access → { canImport: boolean }
 *
 * "May this person import OBDs?" — asked by the Import BUTTON on every screen
 * that shows one (via lib/hooks/use-can-import-obds.ts). READ-ONLY.
 *
 * 🔴 ONE RULE (owner, 2026-09-16): the Import OBDs tick, import_obd canImport.
 * It is the SAME call POST /api/import/obd makes before it imports and the
 * /import layout makes before it renders, so the button can never be offered to
 * someone the route would refuse, nor hidden from someone it would accept.
 * No job-title list — do not add one back here or in any screen.
 *
 * checkAnyPermission over ALL held roles (never checkPermission on the primary
 * role alone). Admin / superuser bypass comes from the resolver.
 *
 * ⚠ This only decides what the screen DRAWS. The import route re-checks, and
 * the route is what actually refuses.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ canImport: false }, { status: 401 });
  }
  const canImport = await checkAnyPermission(
    session.user.roles ?? [session.user.role],
    "import_obd",
    "canImport",
  );
  return NextResponse.json({ canImport });
}
