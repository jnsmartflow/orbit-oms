import { HideSettingsContent } from "@/components/admin/hide-settings-content";

// Admin Settings › Hide.
// Auth: admin gate enforced by app/(admin)/admin/layout.tsx (requireRole ADMIN).
// No re-check needed in this page.

export const dynamic = "force-dynamic";

export default function HideSettingsPage(): React.JSX.Element {
  return <HideSettingsContent />;
}
