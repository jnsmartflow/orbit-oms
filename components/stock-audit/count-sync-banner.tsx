"use client";

// components/stock-audit/count-sync-banner.tsx — the one line at the top of
// /stock-count that says how the phone's queue is doing (offline queue,
// Schema v27.80). Text and tone come from lib/stock-audit/queue-core.ts
// bannerFor(); nothing renders when every count is sent.
//
//   "No signal · N waiting"            warn
//   "Back online · sending N"          info
//   "Signed out · N waiting — Sign in" warn, with the link
//   "N not sent — audit closed"        danger
//
// Existing tokens only (warn / danger / ink).

import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Banner } from "@/lib/stock-audit/queue-core";

export function CountSyncBanner({ banner }: { banner: Banner | null }): React.JSX.Element | null {
  if (banner === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-4 mt-3 flex flex-none items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-[14px]",
        banner.tone === "warn" && "bg-warn-bg text-warn-text",
        banner.tone === "danger" && "bg-danger-bg text-danger-text",
        banner.tone === "info" && "bg-ink-50 text-ink-600",
      )}
    >
      <span className="min-w-0 tabular-nums">{banner.text}</span>
      {banner.signIn && (
        // The login page sends everyone to their role's home after sign-in;
        // the counts wait on this phone and send when Stock count reopens.
        <Link href="/login?callbackUrl=/stock-count" className="flex-none font-semibold underline">
          Sign in
        </Link>
      )}
    </div>
  );
}
