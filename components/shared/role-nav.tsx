"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLink {
  label: string;
  href:  string;
}

export function RoleNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <div className="bg-white border-b border-slate-200 px-6 flex items-center gap-1">
      {links.map((link) => {
        const isActive =
          pathname === link.href || pathname.startsWith(link.href + "/");
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "text-[#1a237e] border-b-2 border-[#1a237e]"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
