// Optional accounts and cross-device sync (Supabase). The app works fully signed out and offline.
// What leaves the device when you're signed in: your progress (keys, streak days, settings, goals, session
// history numbers) and one summary row per finished session. Camera frames, images, clips, audio and face
// measurements never do (the "learn" face-pose samples and the in-progress session stay on this device).
// Everything fails soft: changes wait in localStorage and retry when the connection is back.
import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {SUPABASE_URL, SUPABASE_KEY, GOOGLE_AUTH_ENABLED, APP_VERSION} from "./config.js";
import * as store from "./store.js";
import * as rewards from "./rewards.js";
import * as analytics from "./analytics.js";
import {decide, isEmpty} from "./merge.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  // pkce returns ?code= instead of tokens in the #hash, which the app uses for its sections.
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "lockedin.auth"},
});
export const googleEnabled = GOOGLE_AUTH_ENABLED;

export const SYNC_KEYS = ["settings", "sessions", "goals", "coachNotes", "adapt", "feedback", "onboarded", "lastPlace"];
const META_KEY = "lockedin.sync", UPLOADS_KEY = "lockedin.uploads", PUSH_DELAY = 10000, RETRY_MS = 60000;
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export let user = null;
export let profile = null;
let token = null;
let hooks = {onUser() {}, onStatus() {}, onRemote() {}};
let status = {state: "idle", at: 0};
export const syncStatus = () => status;
function setStatus(state) { status = {state, at: Date.now(), lastSync: meta.syncedAt || 0}; try { hooks.onStatus(status); } catch (e) { console.error(e); } }

// What this device remembers about its last sync: which account, the cloud version it matched, and
// whether anything changed locally since then.
let meta = readJSON(META_KEY, {});
const saveMeta = () => writeJSON(META_KEY, meta);
let changeSeq = 0, applying = false, pushTimer = 0, retryTimer = 0;
store.onSave(key => {
  if (applying || !(SYNC_KEYS.includes(key) || key === "wallet")) return;
  changeSeq++; meta.dirty = true; meta.at = Date.now(); saveMeta();
  if (user) { clearTimeout(pushTimer); pushTimer = setTimeout(pushChanges, PUSH_DELAY); }
});

function snapshot() {
  const s = {};
  for (const k of SYNC_KEYS) { const v = store.load(k, null); if (v != null) s[k] = v; }
  return {wallet: rewards.wallet, store: s, version: meta.version ?? 0, updatedAt: meta.at || 0};
}
function apply(state) {
  applying = true;
  try {
    for (const k of SYNC_KEYS) if (state.store && k in state.store) store.save(k, state.store[k]);
    if (state.wallet && Object.keys(state.wallet).length) rewards.replaceWallet(state.wallet);
  } finally { applying = false; }
  try { hooks.onRemote(); } catch (e) { console.error(e); }
}

async function pull() {
  const {data, error} = await sb.from("user_state").select("wallet, store, version, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data && {wallet: data.wallet, store: data.store, version: data.version, updatedAt: Date.parse(data.updated_at) || 0};
}
// Returns the new cloud version, or null if another device saved first.
async function push(state, base) {
  const {data, error} = await sb.rpc("save_user_state", {p_wallet: state.wallet, p_store: state.store, p_base_version: base});
  if (error) throw error;
  return data;
}

// Everything goes through one queue so a pull and a push never overlap.
let chain = Promise.resolve();
const serial = fn => (chain = chain.then(() => fn(), () => fn()));

export const syncNow = () => user ? serial(fullSync) : Promise.resolve();
async function fullSync(attempt = 0) {
  if (!user) return;
  setStatus("syncing");
  try {
    const seq = changeSeq, remote = await pull(), local = snapshot();
    const mine = meta.userId === user.id;
    // Data here was last synced to a different account: start from this account's own copy instead of mixing.
    const plan = meta.userId && !mine && !isEmpty(remote) ? {action: "pull", state: remote}
      : decide(local, remote, {syncedVersion: mine ? meta.version ?? null : null, dirty: mine ? !!meta.dirty : true});
    if (plan.action === "pull" || plan.action === "merge") apply(plan.state);
    let version = remote?.version ?? null;
    if (plan.action === "push" || plan.action === "merge") {
      version = await push(plan.action === "merge" ? plan.state : local, remote ? remote.version : null);
      if (version == null) { if (attempt < 2) return fullSync(attempt + 1); throw new Error("sync conflict"); }
    }
    meta = {...meta, userId: user.id, version, dirty: changeSeq !== seq, syncedAt: Date.now()};
    saveMeta();
    setStatus("synced");
    await flushUploads();
  } catch (e) { fail(e, "sync"); }
}

// Quick path for local changes: one request, falling back to a full merge if another device saved first.
const pushChanges = () => serial(async () => {
  if (!user || !meta.dirty) return;
  if (meta.userId !== user.id || meta.version == null) return fullSync();
  setStatus("syncing");
  try {
    const seq = changeSeq, v = await push(snapshot(), meta.version);
    if (v == null) return fullSync();
    meta = {...meta, version: v, dirty: changeSeq !== seq, syncedAt: Date.now()};
    saveMeta();
    setStatus("synced");
  } catch (e) { fail(e, "push"); }
});

function fail(e, stage) {
  console.warn("lockedin sync", stage, e);
  const offline = !navigator.onLine || /fetch|network/i.test(String(e?.message));
  setStatus(offline ? "offline" : "error");
  if (!offline) analytics.track("sync_error", {stage, code: String(e?.code || "").slice(0, 12)});
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => user && (meta.dirty || readJSON(UPLOADS_KEY, []).length) && syncNow(), RETRY_MS);
}
addEventListener("online", () => { if (user) syncNow(); });

// A small save while the page closes. Keepalive bodies max out at 64 KB, so big histories send the wallet only.
addEventListener("pagehide", () => {
  if (!user || !token || !meta.dirty || meta.userId !== user.id || meta.version == null) return;
  const s = snapshot();
  let body = JSON.stringify({p_wallet: s.wallet, p_store: s.store, p_base_version: meta.version});
  if (body.length > 60000) body = JSON.stringify({p_wallet: s.wallet, p_store: null, p_base_version: meta.version});
  if (body.length > 60000) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/save_user_state`, {method: "POST", keepalive: true, body,
      headers: {apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json"}});
  } catch {}
});

// ---------- finished sessions -> focus_sessions (numbers only, safe to re-send) ----------
const n = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
function sessionRow(s) {
  const per = {};
  for (const [k, v] of Object.entries(s.stats || {})) if (Number.isFinite(+v)) per[k.slice(0, 16)] = n(v, 86400);
  const alerts = Object.fromEntries(Object.entries(s.alerts || {}).map(([k, v]) => [k.slice(0, 16), n(v, 10000)]));
  return {
    user_id: user.id, client_session_id: String(s.id).slice(0, 64),
    started_at: new Date(s.start).toISOString(), ended_at: new Date(s.end || s.start + s.seconds * 1000).toISOString(),
    seconds_total: n(s.seconds, 86400), seconds_focused: n(s.stats?.focused, 86400), per_state: per,
    pickups: n(s.pickups, 10000), alerts: Object.values(alerts).reduce((a, b) => a + b, 0), pomodoros: n(s.tomatoes, 1000),
    keys_earned: n(s.keys, 100000), client: {v: APP_VERSION, alerts, collab: !!s.collab, score: s.score ?? null},
  };
}
export function queueSession(id) {
  writeJSON(UPLOADS_KEY, [...new Set([...readJSON(UPLOADS_KEY, []), id])].slice(-2000));
  if (user) serial(flushUploads);
}
async function flushUploads() {
  if (!user) return;
  const want = new Set(readJSON(UPLOADS_KEY, []));
  const rows = store.load("sessions", []).filter(s => want.has(s.id) && s.start).map(sessionRow);
  writeJSON(UPLOADS_KEY, rows.map(r => r.client_session_id));   // ids of deleted sessions drop out
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const {error} = await sb.from("focus_sessions").upsert(chunk, {onConflict: "user_id,client_session_id", ignoreDuplicates: true});
    // A row the database refuses (out-of-range numbers) will never succeed: drop it instead of retrying forever.
    if (error && !/^2[23]/.test(error.code || "")) { fail(error, "sessions"); return; }
    const done = new Set(chunk.map(r => r.client_session_id));
    writeJSON(UPLOADS_KEY, readJSON(UPLOADS_KEY, []).filter(id => !done.has(id)));
  }
}

// ---------- accounts ----------
const here = () => location.origin + location.pathname;
function friendly(error) {
  const m = String(error?.message || error || "");
  if (/invalid login credentials/i.test(m)) return new Error("Wrong email or password.");
  if (/already registered|already exists/i.test(m)) return new Error("That email already has an account. Sign in instead.");
  if (/password.*(at least|short|weak)|weak password/i.test(m)) return new Error("Use a longer password (at least 8 characters).");
  if (/email not confirmed/i.test(m)) return new Error("This email isn't confirmed yet. Ask the site owner to turn off email confirmation, or check your inbox.");
  if (/rate limit|too many/i.test(m)) return new Error("Too many tries just now. Wait a minute and try again.");
  if (/signups? not allowed|signups are disabled/i.test(m)) return new Error("New accounts are paused right now. Try again later.");
  if (/valid email|invalid email/i.test(m)) return new Error("That email doesn't look right.");
  if (/fetch|network/i.test(m)) return new Error("Can't reach the server. Check your connection and try again.");
  return new Error(m || "Something went wrong. Try again.");
}
const cleanEmail = e => String(e || "").trim().toLowerCase();

export async function signUp(email, password, name) {
  const {data, error} = await sb.auth.signUp({email: cleanEmail(email), password,
    options: {data: {display_name: String(name || "").trim().slice(0, 30)}, emailRedirectTo: here()}});
  if (error) throw friendly(error);
  // With "Confirm email" switched off in Supabase you're signed in right away. If it's on, there's no session yet.
  return {signedIn: !!data.session};
}
export async function signIn(email, password) {
  const {error} = await sb.auth.signInWithPassword({email: cleanEmail(email), password});
  if (error) throw friendly(error);
}
export async function signInGoogle() {
  if (!GOOGLE_AUTH_ENABLED) throw new Error("Google sign-in isn't set up yet.");
  try { sessionStorage.setItem("lockedin.oauth", "google"); } catch {}
  const {error} = await sb.auth.signInWithOAuth({provider: "google", options: {redirectTo: here()}});
  if (error) throw friendly(error);
}
// Not shown in the app yet: reset emails need custom SMTP in Supabase (see DEPLOY.md).
export async function resetPassword(email) {
  const {error} = await sb.auth.resetPasswordForEmail(cleanEmail(email), {redirectTo: here()});
  if (error) throw friendly(error);
}
export async function signOut() {
  if (meta.dirty) await Promise.race([pushChanges(), new Promise(r => setTimeout(r, 4000))]);
  await sb.auth.signOut().catch(() => sb.auth.signOut({scope: "local"}));
}
// Deletes every row about you in the database and your login, then this device's copy.
export async function deleteAccount() {
  // Shared clip videos sit in storage, which the database function can't empty, so remove them first.
  const mine = await myClips().catch(() => []);
  if (mine.length) await sb.storage.from("clips").remove(mine.map(c => c.path)).catch(() => {});
  const {error} = await sb.rpc("delete_my_account");
  if (error) throw friendly(error);
  await sb.auth.signOut({scope: "local"}).catch(() => {});
  applying = true;
  try { store.clearAll(); } finally { applying = false; }
  writeJSON(META_KEY, null); writeJSON(UPLOADS_KEY, null);
  try { indexedDB.deleteDatabase("lockedin"); } catch {}
}

// ---------- clip links: the only time a camera clip leaves the device, and only when its owner taps Share ----------
const clipId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
export const clipLink = id => new URL(`c.html?id=${id}`, location.href.split(/[?#]/)[0].replace(/[^/]*$/, "")).href;
export async function shareClip(file, caption, kind) {
  if (!user) throw new Error("Sign in to share a link.");
  const id = clipId(), ext = file.type.includes("mp4") ? "mp4" : "webm", path = `${user.id}/${id}.${ext}`;
  const up = await sb.storage.from("clips").upload(path, file, {contentType: file.type, cacheControl: "31536000", upsert: false});
  if (up.error) throw friendly(up.error);
  const {error} = await sb.from("shared_clips").insert({id, path, caption: String(caption || "").slice(0, 80), kind});
  if (error) { sb.storage.from("clips").remove([path]).catch(() => {}); throw friendly(error); }
  return clipLink(id);
}
// Invites: a new account from a clip link claims it once; the sharer collects one reward per friend who joined.
export async function claimInvite(code) {
  const {data, error} = await sb.rpc("claim_invite", {code});
  if (error) throw friendly(error);
  return data === true;
}
export async function claimReferralRewards() {
  const {data, error} = await sb.rpc("claim_referral_rewards");
  if (error) throw friendly(error);
  return data || 0;
}
export async function myClips() {
  if (!user) return [];
  const {data, error} = await sb.from("shared_clips").select("id, path, caption, created_at, views").order("created_at", {ascending: false}).limit(100);
  if (error) throw friendly(error);
  return data || [];
}
export async function deleteClip(c) {
  await sb.storage.from("clips").remove([c.path]);
  const {error} = await sb.from("shared_clips").delete().eq("id", c.id);
  if (error) throw friendly(error);
}

export async function updateProfile(patch) {
  if (!user) return;
  const clean = {};
  if ("display_name" in patch) clean.display_name = String(patch.display_name).trim().slice(0, 30) || "Student";
  if ("avatar" in patch) clean.avatar = String(patch.avatar).slice(0, 16) || "🔒";
  const {error} = await sb.from("profiles").update(clean).eq("id", user.id);
  if (error) throw friendly(error);
  profile = {...profile, ...clean};
  hooks.onUser(user);
}
async function loadProfile() {
  const {data} = await sb.from("profiles").select("display_name, avatar, created_at").eq("id", user.id).maybeSingle();
  profile = data || {display_name: user.user_metadata?.display_name || "You", avatar: "🔒"};
  let timezone = null;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 64) || null; } catch {}
  sb.from("profiles").update({last_seen_at: new Date().toISOString(), timezone}).eq("id", user.id).then(() => {}, () => {});
}

// Everything the account holds, plus this device's data, as one JSON file.
export async function exportMyData() {
  const out = {app: "lockedin", exportedAt: new Date().toISOString(), thisDevice: store.exportAll()};
  if (user) {
    const [p, st, fs] = await Promise.all([
      sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      sb.from("user_state").select("*").eq("user_id", user.id).maybeSingle(),
      sb.from("focus_sessions").select("*").order("started_at", {ascending: true}).limit(10000),
    ]);
    out.account = {id: user.id, email: user.email, createdAt: user.created_at, profile: p.data, syncedProgress: st.data, sessions: fs.data || [],
      note: "Analytics events can't be read back by the app. They are deleted along with your account."};
  }
  return out;
}

async function onSession(event, session) {
  token = session?.access_token || null;
  const next = session?.user || null;
  analytics.setAuth(token, next?.id || null);
  if ((next?.id || null) === (user?.id || null)) { user = next; return; }   // token refresh, same person
  user = next;
  if (!user) { profile = null; hooks.onUser(null, event); setStatus("idle"); return; }
  let via = null;
  try { via = sessionStorage.getItem("lockedin.oauth"); sessionStorage.removeItem("lockedin.oauth"); } catch {}
  hooks.onUser(user, event, via);
  await loadProfile().catch(() => {});
  hooks.onUser(user, "PROFILE");
  // First time this account syncs from this device: send the whole local history to the session log.
  if (meta.userId !== user.id) writeJSON(UPLOADS_KEY, store.load("sessions", []).map(s => s.id).slice(-2000));
  await syncNow();
}

export function init(h) {
  hooks = {...hooks, ...h};
  // Supabase asks that the callback not await its own calls, so the work happens on the next tick.
  sb.auth.onAuthStateChange((event, session) => { setTimeout(() => onSession(event, session), 0); });
}
