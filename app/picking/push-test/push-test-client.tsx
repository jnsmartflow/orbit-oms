"use client";

import { useCallback, useEffect, useState } from "react";

// VAPID applicationServerKey must be a Uint8Array view over a real ArrayBuffer
// (URL-safe base64 → bytes). Backing it with an explicit ArrayBuffer keeps the
// type as Uint8Array<ArrayBuffer>, which BufferSource requires.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

interface PushTestClientProps {
  /** Read server-side from process.env and passed down (works at runtime, no
   *  build-time inlining dependency). Null when the env var is unset. */
  vapidPublicKey: string | null;
}

export function PushTestClient({ vapidPublicKey }: PushTestClientProps) {
  const [supported, setSupported] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Environment probe + service-worker registration (this page only — the SW is
  // NOT registered app-wide yet).
  useEffect(() => {
    const supp =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(supp);
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true,
    );
    setIsIOS(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
    if (supp) setPermission(Notification.permission);

    if (supp) {
      navigator.serviceWorker.register("/sw.js").catch((e: unknown) => {
        setStatus("Service worker registration failed: " + (e instanceof Error ? e.message : String(e)));
      });
    }
  }, []);

  // Button A — MUST run from the user's tap (iOS requires a real gesture).
  const handleEnable = useCallback(async () => {
    setStatus(null);
    if (!vapidPublicKey) {
      setStatus("VAPID public key is not configured on the server.");
      return;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        setStatus(`Permission was "${perm}" — notifications not enabled.`);
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      setSubscription(sub);
      setEndpoint(sub.endpoint);
      setStatus("Subscribed ✓");
    } catch (e: unknown) {
      setStatus("Subscribe failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  // Button B — POST the full subscription; server sends one push.
  const handleSend = useCallback(async () => {
    if (!subscription) return;
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/picking/push-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; statusCode?: number };
      if (!res.ok) {
        setStatus(`Send failed (HTTP ${res.status}${json.statusCode ? `, push ${json.statusCode}` : ""}): ${json.error ?? "unknown error"}`);
        return;
      }
      setStatus("Sent ✓ — lock the phone and close the app; the buzz should arrive within a few seconds.");
    } catch (e: unknown) {
      setStatus("Send error: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  }, [subscription]);

  const yn = (b: boolean) => (b ? "Yes" : "No");

  return (
    <div className="max-w-[520px] mx-auto px-5 py-8">
      <h1 className="text-[18px] font-semibold text-gray-900">Push proof</h1>
      <p className="text-[12px] text-gray-400 mt-1">
        Throwaway test — verifies a Web Push can reach this device while the app is closed.
      </p>

      {/* Current state — plain, large */}
      <div className="mt-6 rounded-lg border border-gray-200 divide-y divide-gray-100">
        <StateRow label="Push supported" value={yn(supported)} ok={supported} />
        <StateRow label="Installed app (standalone)" value={yn(standalone)} ok={standalone} />
        <StateRow
          label="Notification permission"
          value={permission}
          ok={permission === "granted"}
          warn={permission === "default"}
        />
      </div>

      {/* iOS-not-installed warning */}
      {isIOS && !standalone && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-700">
          On iPhone, Web Push only works from the installed app. Tap the Share icon in
          Safari, choose <span className="font-semibold">Add to Home Screen</span>, then open
          OrbitOMS from the new home-screen icon (not Safari) and return here.
        </div>
      )}

      {/* Permission denied recovery */}
      {permission === "denied" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          Notifications are blocked for OrbitOMS. Re-enable them in your phone settings
          (iPhone: Settings → Notifications → OrbitOMS → Allow Notifications, or Settings →
          Apps → OrbitOMS), then reopen this page. The button below cannot re-prompt while
          permission is denied.
        </div>
      )}

      {/* Unsupported */}
      {!supported && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[13px] text-gray-600">
          This browser does not support the Push API. Use the installed OrbitOMS app.
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3">
        {/* THE one teal element on this page */}
        <button
          type="button"
          onClick={handleEnable}
          disabled={!supported || busy || permission === "denied"}
          className="h-[42px] rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-[14px] font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>

        <button
          type="button"
          onClick={handleSend}
          disabled={!subscription || sending}
          className="h-[42px] rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-[14px] font-semibold disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending…" : "Send test buzz"}
        </button>
      </div>

      {/* Confirmed subscription endpoint (truncated) */}
      {endpoint && (
        <div className="mt-5">
          <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Subscription endpoint</p>
          <p className="mt-1 font-mono text-[11px] text-gray-600 break-all">
            {endpoint.slice(0, 48)}
            <span className="text-gray-300">…</span>
            {endpoint.slice(-16)}
          </p>
        </div>
      )}

      {/* Status line */}
      {status && (
        <p className="mt-5 text-[13px] text-gray-700">{status}</p>
      )}
    </div>
  );
}

function StateRow({
  label,
  value,
  ok,
  warn,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
}) {
  const color = ok ? "text-green-700" : warn ? "text-amber-700" : "text-gray-500";
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-gray-600">{label}</span>
      <span className={"text-[16px] font-semibold " + color}>{value}</span>
    </div>
  );
}
