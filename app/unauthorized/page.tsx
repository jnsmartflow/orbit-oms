import Link from "next/link";
import { auth } from "@/lib/auth";

const ROLE_HOME: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatcher",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
};

export default async function UnauthorizedPage() {
  const session = await auth();
  const role = session?.user?.role;
  const homeHref = role ? (ROLE_HOME[role] ?? "/") : "/login";
  const homeLinkLabel = role ? "Go to my dashboard" : "Back to login";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 text-center px-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
        <p className="text-slate-500 max-w-sm">
          You do not have permission to view this page.
        </p>
        {role && (
          <p className="text-sm text-slate-400">
            Signed in as <span className="font-medium capitalize text-slate-600">{role.replace("_", " ")}</span>
          </p>
        )}
      </div>
      <Link
        href={homeHref}
        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
      >
        {homeLinkLabel}
      </Link>
    </main>
  );
}
