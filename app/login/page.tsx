import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ROLE_REDIRECTS } from "@/lib/rbac";
import { LoginForm } from "./login-form";
import { OrbitWordmark } from "@/components/shared/orbit-wordmark";

export const dynamic = 'force-dynamic';

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
            <div className="w-9 h-9 bg-brand-600 rounded-[9px] flex items-center justify-center flex-shrink-0">
              <OrbitWordmark height={12} className="text-white" />
            </div>
            <span className="text-[22px] font-semibold text-gray-900 tracking-[-0.5px]">
              Orbit
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
          Orbit · Internal Use Only
        </p>
      </div>
    </main>
  );
}
