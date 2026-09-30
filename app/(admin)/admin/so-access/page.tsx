import { SoAccessTable } from "@/components/admin/so-access-table";

export const dynamic = "force-dynamic";

// Superuser-only by inheritance: app/(admin)/admin/layout.tsx calls
// requireSuperuser(session) for everything under /admin, and the three
// /api/admin/so-access routes check isSuperuser again (JSON 401/403).
// 🔴 2026-09-30: SO order-access grant is deliberately NOT a PageKey — do not add one.
export default function SoAccessPage() {
  return <SoAccessTable />;
}
