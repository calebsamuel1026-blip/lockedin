// Offline support: app shell is network-first (so updates show up), vision models are cache-first (they're big and never change).
const SHELL = "lockedin-shell-v29";
const MODELS = "lockedin-models-v1";
const SHELL_FILES = ["./", "index.html", "styles.css", "app.js", "store.js", "vision.js", "engine.js", "cloud.js", "rewards.js", "files.js", "clips.js", "emoji.js",
  "config.js", "analytics.js", "merge.js", "privacy.html", "terms.html", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png"];
// Accounts, sync and analytics must always hit the network, never a cached copy.
const NEVER_CACHE = /(^|\.)(supabase\.co|google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net)$/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, MODELS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/") || NEVER_CACHE.test(url.hostname)) return;
  // The admin page always loads fresh (it isn't part of the offline app).
  if (url.origin === location.origin && /\/admin\.(html|js)$/.test(url.pathname)) return;
  const isModel = url.hostname === "storage.googleapis.com" || url.hostname === "cdn.jsdelivr.net";
  if (isModel) {
    e.respondWith(caches.open(MODELS).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
  } else if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(res => {
      // URLs with a query (sign-in codes, utm tags) are not stored: the plain page covers them offline.
      if (res.ok && !url.search) caches.open(SHELL).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
  }
});
