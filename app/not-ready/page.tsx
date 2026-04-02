"use client";

import Link from "next/link";
import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function NotReadyPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Orbit OMS
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Depot Order Management System
        </p>

        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-[15px] font-semibold text-gray-700">
            This section is not yet available.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Please contact your administrator.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
          >
            Back to Login
          </Link>
        </div>
      </div>
    </main>
  );
}
