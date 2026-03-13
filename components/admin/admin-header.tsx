"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface AdminHeaderProps {
  userName: string;
  userRole: string;
}

export function AdminHeader({ userName, userRole }: AdminHeaderProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b bg-white shrink-0">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-600">
          <span className="font-medium text-slate-900">{userName}</span>
          {" · "}
          <span className="text-slate-500">{userRole}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Sign out
        </Button>
      </div>
    </header>
  );
}
