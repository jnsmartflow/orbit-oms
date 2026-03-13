import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";

export const dynamic = 'force-dynamic';

const ROLE_REDIRECTS: Record<string, string> = {
  admin: "/admin",
  dispatcher: "/dispatcher",
  support: "/support",
  tint_manager: "/tint/manager",
  tint_operator: "/tint/operator",
  floor_supervisor: "/warehouse/supervisor",
  picker: "/warehouse/picker",
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.role) {
    redirect(ROLE_REDIRECTS[session.user.role] ?? "/unauthorized");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Orbit OMS
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Depot Order Management System
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
