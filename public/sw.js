/*
 * OrbitOMS — Web Push PROOF service worker.
 *
 * ⚠️ HARD RULE (do not change): this worker handles ONLY 'push' and
 * 'notificationclick'. It has NO 'fetch' handler and touches NO Cache API.
 *
 * Reason: lib/hooks/use-picking-marker.ts polls GET /api/picking/marker every
 * 15s and relies on `Cache-Control: no-store` freshness. A caching service
 * worker would serve stale marker responses and silently break live sync on all
 * three picking surfaces. Never add a fetch handler or caches.* call here.
 *
 * The install/activate handlers below only fast-track lifecycle (skipWaiting /
 * clients.claim) so a fresh worker takes over immediately — they cache nothing.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || "OrbitOMS";
  const body = data.body || "";
  // `tag` makes a repeat notification REPLACE the previous one (no stacking);
  // renotify:true still re-alerts the device when it does.
  const tag = data.tag || "orbit-test";
  const url = data.url || "/picking";

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      tag: tag,
      renotify: true,
      data: { url: url },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/picking";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        // Every window under this worker's scope IS an OrbitOMS window — focus
        // the first open one; otherwise open the target url.
        for (const client of clientList) {
          if ("focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
        return undefined;
      })
  );
});
