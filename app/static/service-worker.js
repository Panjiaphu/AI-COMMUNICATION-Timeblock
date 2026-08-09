const CACHE_NAME = "timeblock-chat-shell-v7";
const STATIC_ASSETS = [
  "/static/communication.css?v=7",
  "/static/communication.js?v=7",
  "/static/manifest.webmanifest",
  "/static/icons/timeblock-chat.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Never cache authenticated HTML, handoff data, messages, media, or API
  // responses. The PWA shell is safe to cache; authorization always re-enters
  // through a fresh Timeblock handoff.
  const isStatic = url.pathname.startsWith("/static/");
  if (!isStatic) return;
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
