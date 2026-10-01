"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RESEND_COOLDOWN_MS } from "@/lib/otp/constants";

// /so-lab — sales-officer OTP login, TEST page (2026-09-29). Mobile-first:
// 16px gutters, inputs at 16px so iOS never zooms (CLAUDE_UI.md §9), tap
// targets 48px (§60), one brand button per screen (§2.2, §10).
// All server logic lives in /api/so-lab/auth/*; this file only draws state.

type Screen = "loading" | "email" | "code" | "in";
type FailReason = "wrong" | "expired" | "too_many";

// The server answers with cooldownSeconds from the SAME constant; this is only
// the fallback if that field is missing (one constant, both places).
const RESEND_SECONDS_DEFAULT = Math.round(RESEND_COOLDOWN_MS / 1000);

const FAIL_TEXT: Record<FailReason, string> = {
  wrong: "That code is not right. Check it and try again.",
  expired: "This code has expired. Tap Resend to get a new one.",
  too_many: "Too many wrong tries. Tap Resend to get a new code.",
};

// A fetch the middleware bounced to /login arrives 200 with HTML — treat any
// non-JSON answer as "the admin login ran out", never as an empty success.
async function callJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; data: Record<string, unknown> | null }> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return { status: res.status, data: null };
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

const STAFF_LOST = "Your admin login has ended. Sign in again at /login, then reopen this page.";

export function SoLabLogin() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [testCode, setTestCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const warmedRef = useRef(false);

  // WARM-UP (2026-10-01): the first time the email screen shows, boot the
  // server function and its pooler connection so the salesman's first "Send
  // code" is not the cold start. ONCE per page open — never per keystroke,
  // never on a timer. Fire-and-forget: a failure changes nothing.
  useEffect(() => {
    if (screen !== "email" || warmedRef.current) return;
    warmedRef.current = true;
    fetch("/api/so-lab/auth/warm", { cache: "no-store" }).catch(() => {});
  }, [screen]);

  // On load: skip straight to the logged-in screen if an SO session exists.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { status, data } = await callJson("/api/so-lab/auth/me");
        if (!alive) return;
        if (status === 200 && data?.ok) {
          setWho({ name: String(data.name), email: String(data.email) });
          setScreen("in");
        } else {
          if (!data || data.reason !== "no_so_session") setError(STAFF_LOST);
          setScreen("email");
        }
      } catch {
        if (alive) { setError("Could not reach the server. Check the connection."); setScreen("email"); }
      }
    })();
    return () => { alive = false; };
  }, []);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = useCallback(async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await callJson("/api/so-lab/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      if (!data?.ok) { setError(STAFF_LOST); return; }
      setTestCode(typeof data.testCode === "string" ? data.testCode : null);
      setCooldown(typeof data.cooldownSeconds === "number" ? data.cooldownSeconds : RESEND_SECONDS_DEFAULT);
      setCode("");
      setScreen("code");
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch {
      setError("Could not reach the server. Check the connection.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError("Enter a valid email address.");
      return;
    }
    setEmail(target);
    await requestCode(target);
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Enter the 6-digit code."); return; }
    setBusy(true);
    setError(null);
    try {
      const { status, data } = await callJson("/api/so-lab/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (status === 200 && data?.ok) {
        setWho({ name: String(data.name), email: String(data.email) });
        setTestCode(null);
        setScreen("in");
        // C.2a: the server page decides login vs board — reload so it renders
        // the order board for the session just created.
        window.location.reload();
        return;
      }
      const reason = data?.reason as FailReason | undefined;
      setError(reason && FAIL_TEXT[reason] ? FAIL_TEXT[reason] : STAFF_LOST);
      setCode("");
    } catch {
      setError("Could not reach the server. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await callJson("/api/so-lab/auth/logout", { method: "POST" });
      if (!data?.ok) { setError(STAFF_LOST); return; }
      setWho(null);
      setCode("");
      setTestCode(null);
      setScreen("email");
    } catch {
      setError("Could not reach the server. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  function onChangeEmail() {
    setScreen("email");
    setCode("");
    setTestCode(null);
    setError(null);
  }

  const primary =
    "w-full h-12 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-[15px] font-semibold " +
    "disabled:bg-gray-100 disabled:text-gray-400 disabled:border disabled:border-gray-200 disabled:cursor-not-allowed";
  const secondary =
    "h-12 px-4 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-[14px] font-medium " +
    "disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed";
  const input =
    "w-full h-12 px-3 text-[16px] border border-gray-200 rounded-lg bg-white text-gray-900 " +
    "focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10";

  return (
    <div className="min-h-[100dvh] bg-brand-50 overflow-x-hidden">
      <div className="mx-auto w-full max-w-[440px] px-4 pt-10 pb-8">
        <div className="mb-6">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-brand-700">Orbit · Test page</p>
          <h1 className="mt-1 text-[22px] font-semibold text-gray-900">Sales Officer Login</h1>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {screen === "loading" && <p className="text-[14px] text-gray-500">Checking…</p>}

          {screen === "email" && (
            <form onSubmit={onSendCode} noValidate>
              <label htmlFor="so-email" className="block text-[13px] font-medium text-gray-600 mb-1.5">
                Email
              </label>
              <input
                id="so-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={input}
                placeholder="name@example.com"
              />
              <p className="mt-2 text-[12.5px] text-gray-500">We will send a 6-digit code to this email.</p>
              <button type="submit" disabled={busy || !email.trim()} className={`${primary} mt-4`}>
                {busy ? "Sending…" : "Send code"}
              </button>
            </form>
          )}

          {screen === "code" && (
            <form onSubmit={onVerify} noValidate>
              <p className="text-[14px] text-gray-700">
                We sent a 6-digit code to{" "}
                <span className="font-semibold text-gray-900 break-all">{email}</span>. Check your inbox and
                spam folder.
              </p>

              {/* Only drawn if the API returns testCode — it has not since
                  2026-09-30 (TEST_MODE_SHOW_CODE = false). */}
              {testCode && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[14px] text-amber-900">
                  TEST MODE — your code: <span className="font-mono font-semibold tracking-widest">{testCode}</span>
                </div>
              )}

              <label htmlFor="so-code" className="block text-[13px] font-medium text-gray-600 mt-4 mb-1.5">
                6-digit code
              </label>
              <input
                id="so-code"
                ref={codeRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className={`${input} font-mono tracking-[0.4em] text-center`}
                placeholder="••••••"
              />
              <button type="submit" disabled={busy || code.length !== 6} className={`${primary} mt-4`}>
                {busy ? "Checking…" : "Verify"}
              </button>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => requestCode(email)}
                  disabled={busy || cooldown > 0}
                  className={`${secondary} flex-1 tabular-nums`}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend"}
                </button>
                <button type="button" onClick={onChangeEmail} disabled={busy} className={`${secondary} flex-1`}>
                  Change email
                </button>
              </div>
              {cooldown > 0 && (
                <p className="mt-2 text-[12px] text-gray-400">Wait before asking for another code.</p>
              )}
            </form>
          )}

          {screen === "in" && who && (
            <div>
              <p className="text-[13px] text-gray-500">Logged in as</p>
              <p className="mt-0.5 text-[18px] font-semibold text-gray-900 break-words">{who.name}</p>
              <p className="text-[14px] text-gray-600 break-all">{who.email}</p>
              <button type="button" onClick={onLogout} disabled={busy} className={`${primary} mt-5`}>
                {busy ? "Logging out…" : "Log out"}
              </button>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-lg border border-danger-bd bg-danger-bg px-3 py-2 text-[13px] text-danger-text">
              {error}
            </p>
          )}
        </div>

        <p className="mt-4 text-[12px] text-gray-400">
          Test page — owner only. Nothing here places an order.
        </p>
      </div>
    </div>
  );
}
