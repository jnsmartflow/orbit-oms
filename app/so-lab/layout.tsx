import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { requireSuperuser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

// /so-lab — the TEST page for sales-officer OTP login (2026-09-29).
// Owner-only while testing: a superuser STAFF session is required, exactly as
// app/(admin)/admin/layout.tsx. Linked from nowhere, and deliberately NOT in
// PAGE_NAV_MAP / PageKey / any sidebar.
// 🔴 The address must never start with a public prefix (/po, /order, /demo,
// /api/order — middleware.ts PUBLIC_PATHS is a startsWith match). /so-lab is
// clear of all of them (code-discovery-2026-09-29-po2-so-login.md §G).
export const metadata: Metadata = {
  title: "Orbit · SO login (test)",
  robots: { index: false, follow: false },
};

export default async function SoLabLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  requireSuperuser(session);
  return <>{children}</>;
}
