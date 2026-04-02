import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = 'force-dynamic';

const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/planning",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  operations: "/operations/support",
  floor_supervisor: "/warehouse",
  picker: "/warehouse",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.role) {
    redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f9fafb] px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2.5 mb-1.5">
            <div className="w-9 h-9 bg-teal-600 rounded-[9px] flex items-center justify-center flex-shrink-0">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="7" stroke="white" strokeWidth="1.6"/>
                <circle cx="11" cy="11" r="2.2" fill="white"/>
                <circle cx="18" cy="11" r="2" fill="white"/>
              </svg>
            </div>
            <span className="text-[22px] font-semibold text-gray-900 tracking-[-0.5px]">
              OrbitOMS
            </span>
          </div>
          <p className="text-[12.5px] text-gray-400 mt-1">One system. Zero chaos.</p>
        </div>

        {/* Form card */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-[11px] text-gray-400">
          OrbitOMS · Internal Use Only
        </p>
      </div>
    </main>
  );
}
