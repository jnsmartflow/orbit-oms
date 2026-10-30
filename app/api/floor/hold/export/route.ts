import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getFloorHold } from "@/lib/floor/queries";
import { buildHoldWorkbook, holdExportFilename, type HoldExportView } from "@/lib/floor/hold-workbook";
import type { FloorScope } from "@/lib/floor/types";

export const dynamic = "force-dynamic";

// GET /api/floor/hold/export?view=all|today&scope=All|Local|Upcountry|IGT / Cross
//
// The On hold tab's Export XLS (2026-10-30). The SAME gate and the SAME feed as
// GET /api/floor/hold (floor canView; getFloorHold with floorExtras, the hide
// exclusion inside it), then lib/floor/hold-workbook.ts applies the tab's
// Today rule and dealer order. Read-only.
//
// ⚠ The scope chip IS applied; the search box and the floor filter are NOT —
// the file is the tab's list for that scope and view, not a search result.

const SCOPES: FloorScope[] = ["All", "Local", "Upcountry", "IGT / Cross"];
function parseScope(v: string | null): FloorScope {
  return (SCOPES as string[]).includes(v ?? "") ? (v as FloorScope) : "All";
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const roles = session.user.roles ?? [session.user.role];
  const allowed = await checkAnyPermission(roles, "floor", "canView");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const scope = parseScope(params.get("scope"));
  const view: HoldExportView = params.get("view") === "today" ? "today" : "all";

  const rows = await getFloorHold(scope, undefined, undefined, undefined, { floorExtras: true });
  const now = new Date();
  const body = buildHoldWorkbook(rows, view, now);
  const filename = holdExportFilename(view, now);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
