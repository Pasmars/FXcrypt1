// FXcrypt service worker — network-first caching + FCM web push.
// Live market/trading data must never be served stale, so we always try the
// network and only fall back to cache when offline.
const CACHE = 'fxcrypt-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Only handle same-origin requests — never intercept Firebase/API calls.
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((m) => m || (req.mode === 'navigate' ? caches.match('/') : Response.error()))
      )
  );
});

// ── FCM web push ──
// Notification click → open/focus the app at the path carried in data.link
// (an app-relative path like '/?goto=portfolio' so the SAME payload deep-links
// correctly on both the mobile PWA and the webapp). Registered BEFORE the FCM
// compat handler so it wins the click.
self.addEventListener('notificationclick', (event) => {
  const msg = event.notification && event.notification.data && event.notification.data.FCM_MSG;
  const path = (msg && msg.data && msg.data.link) || '/';
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.focus(); if (w.navigate) w.navigate(path).catch(() => {}); return; }
      }
      return clients.openWindow(path);
    })
  );
});

try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyCpdVnFtB1dnlZmvfJ9srIBvgFl1ZqNLmQ',
    authDomain: 'pnl-calculator.firebaseapp.com',
    projectId: 'pnl-calculator',
    storageBucket: 'pnl-calculator.firebasestorage.app',
    messagingSenderId: '935070103115',
    appId: '1:935070103115:web:963a10b745483e2255bfce',
  });
  // Instantiating messaging registers the background push handler; notification
  // payloads are displayed automatically.
  firebase.messaging();
} catch (e) {
  // Offline install or blocked CDN — the SW still works for caching; push
  // resumes on the next successful activation.
}
