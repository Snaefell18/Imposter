/* Imposter — Service Worker
   Aufgaben:
   1. Push entgegennehmen und nur dann als Systemmeldung zeigen,
      wenn kein Fenster der App gerade sichtbar ist.
   2. Beim Antippen die App öffnen bzw. nach vorne holen.
   Es wird bewusst nichts zwischengespeichert — die App soll immer
   die aktuelle Version vom Server laden. */

const VERSION = "imposter-sw-1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

/* Ist gerade ein Fenster der App offen und sichtbar? */
async function appIstSichtbar(){
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return clients.some(c => c.visibilityState === "visible");
}

self.addEventListener("push", event => {
  let payload = {};
  try {
    const raw = event.data ? event.data.json() : {};
    payload = raw.data || raw;            // FCM verpackt Datenfelder in "data"
  } catch(_){
    payload = { title: "Imposter", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Imposter";
  const body  = payload.body  || "";
  const tag   = payload.tag   || "imposter";
  const url   = payload.url   || "/";

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const sichtbar = clients.some(c => c.visibilityState === "visible");

    if (sichtbar){
      // App liegt vorn: kein Banner, stattdessen ein Hinweis in der Oberfläche.
      clients.forEach(c => c.postMessage({ type: "push", title, body, tag, url }));
      return;
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
      vibrate: [60, 40, 60]
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients){
      if ("focus" in c){ await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
