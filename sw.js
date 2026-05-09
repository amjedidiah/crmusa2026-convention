self.addEventListener("install", () => {
  globalThis.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(globalThis.clients.claim());
});
