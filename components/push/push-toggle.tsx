"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

// Lifted VERBATIM from app/picking/push-test/push-test-client.tsx — the proven
// subscribe path (URL-safe base64 → Uint8Array over a real ArrayBuffer, which
// BufferSource requires). Not rewritten.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type BlockedReason = null | "denied" | "not-standalone" | "unsupported" | "save-failed";

const BLOCKED_COPY: Record<Exclude<BlockedReason, null>, string> = {
  denied: "Blocked in your phone settings.",
  "not-standalone": "Add OrbitOMS to your home screen first.",
  unsupported: "Not available on this browser.",
  "save-failed": "Couldn't turn on. Try again.",
};

/**
 * "Notifications" row for the mobile You sheet. Reflects the TRUTH of this
 * device (permission granted AND a live browser push subscription exists), not
 * an optimistic guess. Turning off both POSTs unsubscribe AND removes this
 * device's browser subscription, so browser state and the DB stay in sync and
 * a reload reads the same truth — this device only, never the user's others.
 */
export function PushToggle() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null;

  const [ready, setReady] = useState(false); // environment probed
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<BlockedReason>(null);

  // ── Truth on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        if (!cancelled) { setBlocked("unsupported"); setReady(true); }
        return;
      }
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      if (isIOS && !standalone) {
        if (!cancelled) { setBlocked("not-standalone"); setReady(true); }
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) { setBlocked("denied"); setReady(true); }
        return;
      }
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch {
        /* registration is idempotent; ignore a transient failure here */
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!cancelled) {
        setOn(Notification.permission === "granted" && sub !== null);
        setBlocked(null);
        setReady(true);
      }
    }
    void probe();
    return () => { cancelled = true; };
  }, []);

  // ── Turn ON — must run from the user's real tap (iOS gesture requirement) ───
  const turnOn = useCallback(async () => {
    if (!vapidPublicKey) { setBlocked("save-failed"); return; }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") { setBlocked("denied"); return; }
      if (perm !== "granted") { return; } // dismissed — stay OFF, no error line
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub, userAgent: navigator.userAgent }),
      });
      if (!res.ok) { setBlocked("save-failed"); return; }
      setBlocked(null);
      setOn(true); // flip ON only after the save actually succeeds
    } catch {
      setBlocked("save-failed");
    } finally {
      setBusy(false);
    }
  }, [vapidPublicKey]);

  // ── Turn OFF — this device only ─────────────────────────────────────────────
  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {}); // keeps browser state == DB truth
      }
      setBlocked(null);
      setOn(false);
    } finally {
      setBusy(false);
    }
  }, []);

  const interactive = ready && blocked === null && !busy;
  const blockedLine = blocked !== null ? BLOCKED_COPY[blocked] : null;

  return (
    <>
      {/* Row shape copied from the Sign out button above it. */}
      <div className="flex w-full items-center gap-3.5 rounded-[11px] px-3 py-3.5">
        <Bell className="h-[21px] w-[21px] shrink-0 text-gray-400" />
        <span className="flex-1 text-[15px] font-medium text-gray-700">Notifications</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Notifications"
          disabled={!interactive}
          onClick={() => (on ? void turnOff() : void turnOn())}
          className={cn(
            "relative inline-flex h-[26px] w-[46px] shrink-0 items-center rounded-full transition-colors",
            !interactive
              ? "cursor-not-allowed bg-gray-200"
              : on
                ? "bg-teal-600" // the ONE teal element in this sheet
                : "bg-gray-300",
          )}
        >
          <span
            className={cn(
              "inline-block h-[20px] w-[20px] transform rounded-full bg-white shadow transition-transform",
              on ? "translate-x-[23px]" : "translate-x-[3px]",
            )}
          />
        </button>
      </div>
      {blockedLine && (
        <p className="px-3 pb-1.5 text-[12px] text-gray-400">{blockedLine}</p>
      )}
    </>
  );
}
