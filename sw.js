// Offline support.
//   * App shell (same origin): network-first with revalidation, so a normal load always gets the newest files
//     (no "refresh twice"). If the network is slow (lie-fi) the cached copy is served after a few seconds and the
//     download keeps going in the background to refresh the cache.
//   * Pinned CDN files (an exact version in the URL, like tasks-vision@1.0.1) and the MediaPipe models: cache-first,
//     they never change.
//   * Floating CDN URLs (like supabase-js@2): stale-while-revalidate, so fixes upstream still arrive.
//   * Supabase, analytics and admin: never touched.
const SHELL = "lockedin-shell-v32";
const MODELS = "lockedin-models-v1";
const CDN = "lockedin-cdn-v1";
const SHELL_FILES = ["./", "index.html", "styles.css", "app.js", "store.js", "vision.js", "engine.js", "cloud.js", "rewards.js", "files.js", "clips.js", "emoji.js", "icons.js",
  "config.js", "analytics.js", "merge.js", "privacy.html", "terms.html", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-192.png"];
// Accounts, sync and analytics must always hit the network, never a cached copy.
const NEVER_CACHE = /(^|\.)(supabase\.co|google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net)$/;
const PINNED = /@\d+\.\d+\.\d+/;          // npm package@x.y.z
const SLOW_MS = 4000;

self.addEventListener("install", e => {
  // cache: "reload" skips the browser's HTTP cache (GitHub Pages sends max-age=600), so a new worker never
  // installs ten-minute-old files.
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => ![SHELL, MODELS, CDN].includes(k)).map(k => caches.delete(k))))
    // Older workers kept floating CDN URLs (supabase-js@2) here forever; they now live in CDN and refresh.
    .then(() => caches.open(MODELS)).then(c => c.keys().then(reqs => Promise.all(reqs
      .filter(r => { const u = new URL(r.url); return u.hostname === "cdn.jsdelivr.net" && !PINNED.test(u.pathname); }).map(r => c.delete(r)))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}
async function staleWhileRevalidate(e, name) {
  const c = await caches.open(name), hit = await c.match(e.request);
  const fresh = fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}
async function shell(e, url) {
  const req = e.request, navigate = req.mode === "navigate";
  // "no-cache" = ask GitHub Pages whether the file changed (a cheap 304 when it didn't).
  const net = fetch(req, {cache: "no-cache"}).then(res => {
    // URLs with a query (sign-in codes, invite links, utm tags) are not stored: the plain page covers them offline.
    if (res.ok && !url.search) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const cached = () => caches.match(req, {ignoreSearch: navigate}).then(r => r || (navigate ? caches.match("index.html") : undefined));
  const slow = new Promise(r => setTimeout(r, SLOW_MS)).then(cached);
  try {
    const res = await Promise.race([net, slow.then(r => r || net)]);
    if (res) return res;
  } catch {}
  // Offline: the cached file, or for page loads the app itself. Never index.html in place of a script.
  return (await cached()) || Response.error();
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || NEVER_CACHE.test(url.hostname)) return;
  if (url.origin === location.origin) {
    // The admin page always loads fresh (it isn't part of the offline app); /api/ is a server, not files.
    if (url.pathname.includes("/api/") || /\/admin\.(html|js)$/.test(url.pathname)) return;
    e.respondWith(shell(e, url));
  } else if (url.hostname === "storage.googleapis.com") {
    e.respondWith(cacheFirst(e.request, MODELS));
  } else if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(PINNED.test(url.pathname) ? cacheFirst(e.request, MODELS) : staleWhileRevalidate(e, CDN));
  }
});
