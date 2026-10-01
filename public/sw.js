const C = "studylens-v3";
const A = ["./", "index.html"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(C).then((cache) => cache.addAll(A)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("studylens-") && key !== C).map((key) => caches.delete(key)))).then(() => clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(C).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((response) => response || caches.match("index.html"))));
});