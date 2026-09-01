import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/permissions";
import { getMrnDetail } from "@/lib/mrn/queries";
import { PrintSheet } from "@/components/mrn/print-sheet";
import { PrintSheetButton } from "@/components/mrn/print-sheet-button";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /mrn/[mrnId]/sheet — the printable A4 landscape MRN (read-only).
//
// Standalone, like /trips/[tripNo]/sheet: it fetches its own MRN server-side
// and renders the shared, prop-driven <PrintSheet />. NO layout.tsx, no sidebar,
// no UniversalHeader — a document route renders a document.
//
// ⚠ SAME GATE AS THE XLS EXPORT, AND FOR THE SAME REASON. `canExport`, not
// `canView`: `floor_supervisor` and `operations` can open a truck and record
// what arrived, but the REPORT is billing's deliverable (design §11 OQ-11).
// This page and app/api/mrn/[mrnId]/export must never diverge on that — a
// screen that renders what the download refuses is the same leak either way.
//
// ⚠ AND THE SAME "done ONLY" RULE. The route handler answers 409; a PAGE cannot
// return a status code from a render without hacks, so the equivalent here is
// the explanatory screen below. It carries the SAME sentence the route sends,
// so the operator reads one message whichever door they came through. Do not
// "fix" this into a notFound() — a not-found tells billing the MRN is missing
// when it is simply not finished.
// ─────────────────────────────────────────────────────────────────────────────

export default async function MrnSheetPage({
  params,
}: {
  params: { mrnId: string };
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const roles = session.user.roles ?? [session.user.role];
  if (!roles.includes("admin")) {
    const allowed = await checkAnyPermission(roles, "mrn", "canExport");
    if (!allowed) redirect("/unauthorized");
  }

  // Validate, never coerce — the same digits-only check the API routes use.
  const raw = params.mrnId?.trim() ?? "";
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n <= 0 || n > 2147483647) {
    return <SheetMessage title="That is not a valid MRN." />;
  }

  const detail = await getMrnDetail(n);
  if (!detail) {
    return (
      <SheetMessage
        title="This MRN could not be found."
        body="It may have been deleted. Removed MRNs disappear from every screen."
      />
    );
  }

  // 🔴 done OR closed — the SAME rule as app/api/mrn/[mrnId]/export/route.ts,
  // and it must stay the same: detail-pane.tsx renders Print and Download side
  // by side from one condition, so a gate that diverges here gives billing one
  // working link and one dead one on a closed MRN.
  if (detail.status !== "done" && detail.status !== "closed") {
    return (
      <SheetMessage
        title={`${detail.mrnNumber} has not been checked yet.`}
        body={
          detail.status === "checking"
            ? "This truck is still being checked. The report is available once the supervisor taps End unloading."
            : "This MRN has not been checked yet. The report is available once unloading is finished."
        }
        backHref="/mrn"
      />
    );
  }

  // Rendered on the server, on a force-dynamic page, so this is the real print
  // moment and it cannot drift after hydration. IST because the floor reads IST
  // — the same convention components/mrn/format.ts enforces everywhere else.
  const printedAt = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="min-h-screen bg-[#e5e7eb] py-6">
      {/* Screen-only action bar. It sits OUTSIDE #mrn-print-area, so the global
          `body * { visibility: hidden }` print rule hides it with no help. */}
      <div className="mx-auto mb-3 flex max-w-[1120px] items-center gap-2 px-4">
        <a href="/mrn" className="text-[12px] text-teal-600 hover:text-teal-700">
          &larr; Back to MRN
        </a>
        <div className="flex-1" />
        <a
          href={`/api/mrn/${detail.id}/export`}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-[13px] font-medium text-[#475467] hover:bg-gray-50"
        >
          Download XLS
        </a>
        <PrintSheetButton />
      </div>

      <PrintSheet detail={detail} printedAt={`${printedAt} IST`} />
    </div>
  );
}

/** The three dead ends — bad id, no such MRN, not finished. Plain, no chrome:
 *  this route has no layout to fall back on. */
function SheetMessage({
  title,
  body,
  backHref,
}: {
  title: string;
  body?: string;
  backHref?: string;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
      <h1 className="text-[15px] font-semibold text-[#475467]">{title}</h1>
      {body && <p className="max-w-[420px] text-[12.5px] leading-relaxed text-gray-500">{body}</p>}
      <a
        href={backHref ?? "/mrn"}
        className="mt-2 text-[12.5px] text-teal-600 hover:text-teal-700"
      >
        &larr; Back to MRN
      </a>
    </div>
  );
}
