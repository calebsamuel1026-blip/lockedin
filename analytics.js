// One track(name, props) API for the whole app. Nothing is sent until the visitor taps "Allow analytics",
// and nothing at all if they say no. Destinations: our own Supabase events table (batched) and, when GA_ID
// is set, Google Analytics 4. Never sent: camera frames, images, clips, audio, face measurements, emails,
// or anything the visitor typed. No fingerprinting: just a random id kept in this browser.
import {SUPABASE_URL, SUPABASE_KEY, GA_ID, APP_VERSION} from "./config.js";

const CONSENT_KEY = "lockedin.consent", ANON_KEY = "lockedin.anon", QUEUE_KEY = "lockedin.events";
const MAX_BATCH = 20, FLUSH_MS = 15000, KEEPALIVE_MAX = 60000;   // keepalive request bodies are capped at 64 KB
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const uuid = () => crypto.randomUUID?.() || ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export const consent = () => get(CONSENT_KEY);            // "granted" | "denied" | null (not asked yet)
const granted = () => consent() === "granted";
let pre = [];                                             // events from before the choice: memory only, dropped on "no"
let queue = (() => { try { return JSON.parse(get(QUEUE_KEY)) || []; } catch { return []; } })();
const saveQueue = () => set(QUEUE_KEY, queue.length ? JSON.stringify(queue.slice(-200)) : null);
let auth = {token: null, userId: null};

// Per visit: a session id, the UTM tags and referring site from the landing URL (origin only, never the path).
const visit = (() => {
  try { const v = JSON.parse(sessionStorage.getItem("lockedin.visit")); if (v?.id) return v; } catch {}
  const q = new URLSearchParams(location.search), utm = {};
  for (const k of ["source", "medium", "campaign", "term", "content"]) { const v = q.get("utm_" + k); if (v) utm[k] = v.slice(0, 100); }
  let referrer = "";
  try { const r = new URL(document.referrer); if (r.origin !== location.origin) referrer = r.origin; } catch {}
  const v = {id: uuid(), utm, referrer};
  try { sessionStorage.setItem("lockedin.visit", JSON.stringify(v)); } catch {}
  return v;
})();

// Coarse buckets only, so this can't single anyone out.
function device() {
  const ua = navigator.userAgent, w = innerWidth;
  const platform = navigator.userAgentData?.platform || (/Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /CrOS/.test(ua) ? "Chrome OS" : /Mac/.test(ua) ? "macOS" : /Win/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other");
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "other";
  return {viewport: w < 480 ? "xs" : w < 768 ? "sm" : w < 1024 ? "md" : w < 1440 ? "lg" : "xl", platform, browser,
    mobile: navigator.userAgentData?.mobile ?? /Mobi/.test(ua),
    standalone: matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
    lang: (navigator.language || "").split("-")[0].slice(0, 8)};
}
// Only "#focus"-style view names, never a URL fragment carrying a login token.
const page = () => location.pathname.replace(/.*\//, "/") + (/^#[a-z]{1,20}$/.test(location.hash) ? location.hash : "");

// Flat, small props: numbers, booleans and short strings only.
function clean(props) {
  const out = {};
  for (const [k, v] of Object.entries(props || {}).slice(0, 25)) {
    const key = String(k).replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
    if (typeof v === "number") { if (Number.isFinite(v)) out[key] = Math.round(v * 100) / 100; }
    else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = v.slice(0, 100);
  }
  return out;
}

export function track(name, props = {}) {
  if (consent() === "denied") return;
  const ev = {name: String(name).slice(0, 64), props: clean(props), page: page()};
  if (!granted()) { if (pre.length < 50) pre.push(ev); return; }
  send(ev);
}
function send(ev) {
  let anon = get(ANON_KEY);
  if (!anon) { anon = uuid(); set(ANON_KEY, anon); }
  queue.push({anon_id: anon, session_id: visit.id, name: ev.name, props: ev.props, page: ev.page, referrer: visit.referrer || null,
    utm: visit.utm, device: device(), app_version: APP_VERSION});
  saveQueue();
  if (queue.length >= MAX_BATCH) flush();
  gaEvent(ev);
}

const headers = () => ({apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal",
  ...(auth.token ? {Authorization: `Bearer ${auth.token}`} : {})});
let flushing = false;
export async function flush(keepalive = false) {
  if (!granted() || !queue.length || flushing) return;
  let batch = queue.slice(0, 50), body = JSON.stringify(batch);
  while (keepalive && body.length > KEEPALIVE_MAX && batch.length > 1) { batch = batch.slice(0, Math.ceil(batch.length / 2)); body = JSON.stringify(batch); }
  flushing = true;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events`, {method: "POST", headers: headers(), body, keepalive});
    if (res.status === 401) auth.token = null;   // expired login: the next try goes out anonymously
    // Sent, or rejected for good (bad row): drop it either way so one bad event can't block the queue.
    else if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) { queue.splice(0, batch.length); saveQueue(); }
  } catch {} finally { flushing = false; }   // offline: stays queued in localStorage for next time
}
setInterval(() => flush(), FLUSH_MS);
addEventListener("online", () => flush());
addEventListener("pagehide", () => flush(true));
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });

// "Not right? I'm focused" corrections go to their own insert-only table so detection can be tuned.
export function feedback(state, setting) {
  if (!granted()) return;
  fetch(`${SUPABASE_URL}/rest/v1/feedback`, {method: "POST", headers: headers(), keepalive: true,
    body: JSON.stringify({anon_id: get(ANON_KEY), state: String(state).slice(0, 16), setting: setting ? String(setting).slice(0, 64) : null})}).catch(() => {});
}

// Called by cloud.js whenever the login changes or its token refreshes.
export function setAuth(token, userId) {
  const changed = userId !== auth.userId;
  auth = {token, userId};
  if (changed && window.gtag && granted()) window.gtag("set", {user_id: userId || null});
}

// ---------- Google Analytics 4 (only after consent, only if GA_ID is set) ----------
const GA_NAMES = {signup: "sign_up", session_start: "focus_session_start", session_end: "focus_session_end"};  // session_start is reserved by GA
function loadGA() {
  if (!GA_ID) return;
  window[`ga-disable-${GA_ID}`] = false;
  if (window.gtag) { window.gtag("consent", "update", {analytics_storage: "granted"}); return; }
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  // Consent mode v2: everything denied by default; analytics only after the visitor allowed it. Ads stay off.
  window.gtag("consent", "default", {ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied"});
  window.gtag("consent", "update", {analytics_storage: "granted"});
  window.gtag("js", new Date());
  // page_location without the query: the landing URL can carry a sign-in code (?code=) or a friend's name
  // (?invite=&from=). Campaign tags go in their own fields instead.
  const u = visit.utm, campaign = u.source ? {campaign_source: u.source, campaign_medium: u.medium, campaign_name: u.campaign, campaign_term: u.term, campaign_content: u.content} : {};
  window.gtag("config", GA_ID, {app_version: APP_VERSION, page_location: location.origin + location.pathname, page_referrer: visit.referrer || undefined,
    ...campaign, ...(auth.userId ? {user_id: auth.userId} : {})});
  const s = document.createElement("script");
  s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.append(s);
}
function gaEvent(ev) {
  if (!GA_ID || !window.gtag || !granted()) return;
  window.gtag("event", GA_NAMES[ev.name] || ev.name, ev.props);
}

export function setConsent(choice) {
  const yes = choice === "granted";
  set(CONSENT_KEY, yes ? "granted" : "denied");
  if (yes) {
    loadGA();
    const waiting = pre; pre = [];
    send({name: "consent_choice", props: {choice: "granted"}, page: page()});
    waiting.forEach(send);
    flush();
  } else {
    pre = []; queue = []; saveQueue(); set(ANON_KEY, null);   // forget the random id too
    if (GA_ID) { window[`ga-disable-${GA_ID}`] = true; window.gtag?.("consent", "update", {analytics_storage: "denied"}); }
  }
}
if (granted()) loadGA();

// ---------- errors: message only (no stack, no user text), at most 5 per page load ----------
const seen = new Set();
function onError(message, file, line) {
  if (seen.size >= 5) return;
  const msg = String(message || "error").replace(/https?:\/\/\S+/g, "<url>").replace(/\S+@\S+/g, "<email>").replace(/\d{4,}/g, "#").slice(0, 120);
  if (seen.has(msg)) return;
  seen.add(msg);
  track("js_error", {message: msg, file: String(file || "").split(/[/?#]/).filter(Boolean).pop()?.slice(0, 40) || "", line: +line || 0});
}
export function watchErrors() {
  addEventListener("error", e => onError(e.message, e.filename, e.lineno));
  addEventListener("unhandledrejection", e => onError(e.reason?.message || e.reason, "", 0));
}
