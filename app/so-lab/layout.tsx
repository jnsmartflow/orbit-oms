import type { Metadata, Viewport } from "next";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";
import { isSoPageOpen } from "@/lib/so-auth/lock";

export const dynamic = "force-dynamic";

// /so-lab — sales-officer OTP login + the /po2 order board fork (C.2a).
// LOCKED by default: while app_settings 'so.page.open' is absent / false /
// unreadable, a superuser STAFF session is required, exactly as
// app/(admin)/admin/layout.tsx (lib/so-auth/lock.ts). Linked from nowhere, and
// deliberately NOT in PAGE_NAV_MAP / PageKey / any sidebar.
// 🔴 The address must never start with a public prefix (/po, /order, /demo,
// /api/order — middleware.ts PUBLIC_PATHS is a startsWith match). /so-lab is
// clear of all of them (code-discovery-2026-09-29-po2-so-login.md §G).
export const metadata: Metadata = {
  title: "Orbit",
  robots: { index: false, follow: false },
  // TEST install only — id "/so-lab", separate from /po2 and /po9.
  manifest: "/so-lab/manifest.webmanifest",
  icons: {
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    title: "Orbit",
    statusBarStyle: "default",
  },
};

// Same status-bar wash as /po2 (app/po2/page.tsx).
export const viewport: Viewport = {
  themeColor: "#F5F3FF",
};

export default async function SoLabLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSoPageOpen())) {
    const session = await auth();
    requireSuperuser(session);
  }
  return <>{children}</>;
}
