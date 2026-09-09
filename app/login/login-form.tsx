"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";

// The field is labelled "Username" per the rebrand spec, but it still accepts an
// email OR a 10-digit mobile, and its id/name stays `email` — that is the auth
// contract (CLAUDE_UI.md §12), not a display choice. type="text", never "email":
// a digit-only mobile fails the browser's email validator.
export function LoginForm({
  greeting,
  dateLabel,
}: {
  greeting: string;
  dateLabel: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Wrong username or password.");
        return;
      }

      // Navigate to root — server component reads session and redirects by role
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Focus ring is brand-500 + rgba(139,92,246,.13). The error border is the only
  // red on this page — the Sign in button never turns red.
  const fieldClass = (bad: boolean) =>
    `w-full rounded-[10px] border bg-white px-3.5 py-[11px] text-[14px] text-ink-700 placeholder-ink-400 outline-none transition-colors focus:border-brand-500 focus:ring-4 focus:ring-[rgba(139,92,246,0.13)] disabled:opacity-50 ${
      bad ? "border-danger" : "border-ink-100"
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 className="text-[20px] font-bold tracking-[-0.02em] text-ink-900">
        {greeting}
      </h1>
      <p className="mb-6 mt-1 text-[12.5px] text-ink-500">
        Sign in to continue · {dateLabel}
      </p>

      <div className="mb-3">
        <label
          htmlFor="email"
          className="mb-1.5 block text-[11px] font-semibold text-ink-600"
        >
          Username
        </label>
        <input
          id="email"
          name="email"
          type="text"
          placeholder="Email or 10-digit mobile"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          className={fieldClass(!!error)}
          style={{ WebkitBoxShadow: "0 0 0 1000px white inset" }}
        />
      </div>

      <div className="mb-3">
        <label
          htmlFor="password"
          className="mb-1.5 block text-[11px] font-semibold text-ink-600"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className={`${fieldClass(!!error)} pr-10`}
            style={{ WebkitBoxShadow: "0 0 0 1000px white inset" }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-1 text-[12px] font-medium text-danger-text">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-4 py-3 text-[13.5px] font-bold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {loading && <Loader2 size={15} className="animate-spin" />}
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="mt-4 text-center text-[11.5px] text-ink-400">
        Trouble signing in?{" "}
        <span className="font-semibold text-brand-700">Ask the admin</span>
      </p>
    </form>
  );
}
