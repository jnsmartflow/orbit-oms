"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

export function LoginForm() {
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
        setError("Invalid email or password.");
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[13px] font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          placeholder="you@orbitoms.com"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[14px] text-gray-900 placeholder-gray-400 focus:border-teal-600 focus:outline-none disabled:opacity-50"
          style={{ WebkitBoxShadow: "0 0 0 1000px white inset" }}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[13px] font-medium text-gray-700">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 pr-10 text-[14px] text-gray-900 placeholder-gray-400 focus:border-teal-600 focus:outline-none disabled:opacity-50"
            style={{ WebkitBoxShadow: "0 0 0 1000px white inset" }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
          <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
          <p className="text-[13px] text-red-600">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
