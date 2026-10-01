const C = "studylens-v4";
const SHELL_URL = new URL("./", self.registration.scope).href;
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const request = new Request(SHELL_URL, { cache: "reload" });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Failed to cache app shell: ${response.status}`);
  await (await caches.open(C)).put(request, response);
  await self.skipWaiting();
})()));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("studylens-") && key !== C).map((key) => caches.delete(key)))).then(() => clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(C).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((response) => response || caches.match(SHELL_URL))));
});