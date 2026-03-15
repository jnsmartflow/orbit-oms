"use client";

import { signOut } from "next-auth/react";

interface AdminHeaderProps {
  userName: string;
  userRole: string;
}

export function AdminHeader({ userName, userRole }: AdminHeaderProps) {
  return (
    <header
      className="shrink-0 flex items-center justify-end px-5"
      style={{
        height:       '48px',
        background:   'var(--white)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center gap-3">
        <span style={{ fontSize: '12px', color: 'var(--text-2)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text)' }}>{userName}</span>
          {" · "}
          <span style={{ color: 'var(--muted)' }}>{userRole}</span>
        </span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md transition-colors"
          style={{
            padding:     '4px 10px',
            fontSize:    '12px',
            fontWeight:  500,
            color:       'var(--text-2)',
            background:  'var(--white)',
            border:      '1px solid var(--border)',
            cursor:      'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--white)')}
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
