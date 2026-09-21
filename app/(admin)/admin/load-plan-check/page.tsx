import { LoadPlanCheckContent } from "@/components/admin/load-plan-check-content";

// Admin — Load plan check (2026-09-21). The Upcountry load plan vs the trips
// planners made, by bill. Auth: superuser, enforced by app/(admin)/admin/layout.tsx
// and again by GET /api/admin/load-plan-check.

export const dynamic = "force-dynamic";

export default function LoadPlanCheckPage(): React.JSX.Element {
  return <LoadPlanCheckContent />;
}
