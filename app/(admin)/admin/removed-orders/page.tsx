import { RemovedOrdersContent } from "@/components/admin/removed-orders-content";

// Hidden admin page — no sidebar entry. Direct URL only.
// Auth: admin gate enforced by app/(admin)/admin/layout.tsx (requireRole ADMIN).
// No re-check needed in this page.

export const dynamic = "force-dynamic";

export default function RemovedOrdersPage(): React.JSX.Element {
  return <RemovedOrdersContent />;
}
