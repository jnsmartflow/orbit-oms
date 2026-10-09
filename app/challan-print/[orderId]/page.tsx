import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { loadChallanDetail } from "@/lib/tint/challan-detail";
import { ChallanPrintView } from "@/components/tint/challan-print-view";
import type { ChallanApiResponse } from "@/components/tint/challan-document";

export const dynamic = "force-dynamic";

// /challan-print/[orderId] — the delivery challan, print-only (2026-10-09).
//
// Floor's DC column loads this out of sight in a hidden iframe and opens the
// print box on it (components/floor/use-challan-print.ts). Nobody navigates
// here; it has no chrome, no sidebar and no actions.
//
// 🔴 ACCESS — Option B (owner, 2026-10-09): floor canView OR delivery_challans
// canView. Deliberately wider than the Challans screen (delivery_challans
// canView) and the challan save (delivery_challans canEdit), which are NOT
// widened — this page only reads, through the same loader as the screen's GET.
//
// 🔴 A REFUSAL NEVER REDIRECTS. redirect("/unauthorized") would load the Access
// Denied page into the iframe and Floor would print it. Every refusal renders
// a bare page with NO ready marker; the printer sees the marker missing, opens
// no print box and shows a message instead. Refused: not signed in, no tick,
// bad id, no challan, a voided challan (the Challans screen will not print one
// either), or a read error.

async function mayPrint(): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  const roles = session.user.roles ?? [session.user.role];
  return (
    (await checkAnyPermission(roles, "floor", "canView")) ||
    (await checkAnyPermission(roles, "delivery_challans", "canView"))
  );
}

function parseOrderId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// The tab title is the challan number — Chrome offers it as the "Save as PDF"
// file name. Behind the same gate; a refusal gets the plain app title.
export async function generateMetadata(
  { params }: { params: { orderId: string } },
): Promise<Metadata> {
  const orderId = parseOrderId(params.orderId);
  if (orderId === null || !(await mayPrint())) return {};
  const row = await prisma.delivery_challans.findUnique({
    where:  { orderId },
    select: { challanNumber: true },
  });
  return row ? { title: { absolute: row.challanNumber } } : {};
}

function Refused() {
  return <main />;
}

export default async function ChallanPrintPage(
  { params }: { params: { orderId: string } },
) {
  const orderId = parseOrderId(params.orderId);
  if (orderId === null) return <Refused />;
  if (!(await mayPrint())) return <Refused />;

  const result = await loadChallanDetail(orderId);
  if (!result.ok) return <Refused />;
  if (result.data.challan.isVoided) return <Refused />;

  // Through JSON once, so the view gets exactly what the Challans screen gets
  // from `await res.json()` on the GET — the same bytes, not a near-copy.
  const data = JSON.parse(JSON.stringify(result.data)) as ChallanApiResponse;

  return <ChallanPrintView data={data} />;
}
