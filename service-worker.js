self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("fxcrypt-cache-v1").then((cache) => {
      return cache.addAll([
        "index.html",
        "prices.html",
        "profile.html",
        "style.css",
        "script.js",
        "logo.svg",
        "manifest.json",
      ]);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }),
  );
});
