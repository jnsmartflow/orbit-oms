import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TripReportPage } from "@/components/trip-report/trip-report-page";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <TripReportPage />;
}
