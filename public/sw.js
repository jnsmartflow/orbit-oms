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
 *
 * SW_VERSION 2026-09-30.2 — live feed picking 4b: after showing a picking
 * notification, the worker also tells every open Orbit window which bill it was
 * about ({ type: "orbit-push", tag, kind, orderId }), so a Picking page on the
 * live feed can re-read that one bill at once (~1–2 s) instead of waiting for its
 * next 15 s check. A page that is not listening simply ignores the message — so
 * with the Picking feed OFF this changes nothing. Bumping this line is what makes
 * browsers install the new worker (byte-different file); skipWaiting + claim
 * above make it take over without a restart.
 */

// 🔴 Keep byte-identical to PUSH_TAG_PATTERN_SOURCE in lib/push/sw-message.ts (a unit test checks).
var PICKING_PUSH_TAG = /^pick-(assigned|done|cancelled)-(\d+)$/;

/** Tell every open Orbit window about a picking push. Never throws; never touches caches. */
function tellWindows(tag) {
  var m = PICKING_PUSH_TAG.exec(tag || "");
  if (!m) return Promise.resolve();
  var message = { type: "orbit-push", tag: tag, kind: m[1], orderId: Number(m[2]) };
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then(function (list) {
      list.forEach(function (client) {
        try {
          client.postMessage(message);
        } catch (e) {
          /* a closing window — ignore */
        }
      });
    })
    .catch(function () {
      /* never let a message failure affect the notification */
    });
}

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

  const title = data.title || "Orbit";
  const body = data.body || "";
  // `tag` makes a repeat notification REPLACE the previous one (no stacking);
  // renotify:true still re-alerts the device when it does.
  const tag = data.tag || "orbit-test";
  const url = data.url || "/picking";

  event.waitUntil(
    self.registration
      .showNotification(title, {
        body: body,
        tag: tag,
        renotify: true,
        data: { url: url },
        icon: "/icon-192.png",
        badge: "/icon-192.png",
      })
      .then(function () {
        return tellWindows(tag);
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
