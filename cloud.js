// Accounts, sync, school leaderboard and live presence (Supabase).
// Everything here is optional: the app works fully signed out.
// Only finished-session totals and your profile leave the device. Camera data never does.
import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://fmtgteqakfdjmhvnzvtm.supabase.co";
// Publishable key: designed to be public. Access is controlled by row level security in the database.
const SUPABASE_KEY = "sb_publishable_CRhpFbHddZlwsjz_JrDkdw_OMrr90Zm";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "lockedin.auth"},
});

// Same rule the database enforces: .edu, .edu.xx, .ac.xx
export const isSchoolEmail = email => /@([a-z0-9-]+\.)+(edu|edu\.[a-z]{2}|ac\.[a-z]{2})$/i.test(String(email).trim());
export function schoolOf(email) {
  const parts = String(email).split("@")[1]?.toLowerCase().split(".") || [];
  const n = /\.(ac|edu)\.[a-z]{2}$/.test(parts.join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}
// "fsu.edu" -> "FSU", "ox.ac.uk" -> "OX"
export const schoolLabel = domain => (domain || "").split(".")[0].toUpperCase();

export let user = null;
export let profile = null;
const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

async function loadProfile() {
  if (!user) { profile = null; return; }
  const {data, error} = await sb.from("profiles").select("id, display_name, emoji, school, show_live, coins").eq("id", user.id).maybeSingle();
  if (error) console.warn(error);
  profile = data || null;
}

export async function init() {
  const {data} = await sb.auth.getSession();
  user = data.session?.user || null;
  await loadProfile();
  emit();
  sb.auth.onAuthStateChange(async (_event, session) => {
    const before = user?.id;
    user = session?.user || null;
    if (user?.id !== before) { await loadProfile(); emit(); }
  });
}

export async function sendCode(email) {
  email = String(email).trim().toLowerCase();
  if (!isSchoolEmail(email)) throw new Error("Use your school email. It should end in .edu (or .ac.uk, .edu.au and similar).");
  const {error} = await sb.auth.signInWithOtp({email, options: {emailRedirectTo: location.origin + location.pathname + "#school"}});
  if (error) {
    if (/rate limit|too many/i.test(error.message)) throw new Error("Too many sign-in emails just now. Wait a minute and try again.");
    if (/students|school email/i.test(error.message) || /database error saving new user/i.test(error.message)) throw new Error("That doesn't look like a school email. lockedin is for students.");
    throw new Error(error.message);
  }
}

export async function verifyCode(email, token) {
  const {error} = await sb.auth.verifyOtp({email: String(email).trim().toLowerCase(), token: String(token).trim(), type: "email"});
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? "That code is wrong or expired. Request a new one." : error.message);
}

export async function signOut() {
  await leaveSchool();
  await sb.auth.signOut();
}

export async function updateProfile(patch) {
  if (!user) return;
  const clean = {};
  if ("display_name" in patch) clean.display_name = String(patch.display_name).trim().slice(0, 30) || "Student";
  if ("emoji" in patch) clean.emoji = String(patch.emoji).slice(0, 8) || "🔒";
  if ("show_live" in patch) clean.show_live = !!patch.show_live;
  if ("coins" in patch) clean.coins = Math.max(0, Math.round(+patch.coins || 0));
  const {data, error} = await sb.from("profiles").update(clean).eq("id", user.id).select().maybeSingle();
  if (error) throw new Error(error.message);
  profile = data || {...profile, ...clean};
  emit();
}

// ---------- sync ----------
export async function pushSessions(list) {
  if (!user || !list.length) return;
  const rows = list.map(s => ({
    id: String(s.id).slice(0, 40), day: s.date, started_at: new Date(s.start).toISOString(),
    seconds: Math.max(0, Math.min(57600, Math.round(s.seconds || 0))),
    focus_score: s.score == null ? null : Math.max(0, Math.min(100, Math.round(s.score))),
    pickups: Math.max(0, Math.min(5000, s.pickups || 0)), data: s, updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const {error} = await sb.from("sessions").upsert(rows.slice(i, i + 200), {onConflict: "id"});
    if (error) throw new Error(error.message);
  }
}
export async function pullSessions() {
  if (!user) return [];
  const {data, error} = await sb.from("sessions").select("data").order("started_at", {ascending: true}).limit(5000);
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.data).filter(Boolean);
}
export async function pushState(settings, goals) {
  if (!user) return;
  const {error} = await sb.from("user_state").upsert({user_id: user.id, settings, goals, updated_at: new Date().toISOString()});
  if (error) console.warn(error);
}
export async function pullState() {
  if (!user) return null;
  const {data} = await sb.from("user_state").select("settings, goals, updated_at").eq("user_id", user.id).maybeSingle();
  return data || null;
}

// ---------- school ----------
export async function leaderboard(since) {
  const {data, error} = await sb.rpc("school_leaderboard", {since});
  if (error) throw new Error(error.message);
  return data || [];
}
export async function schoolStats() {
  const {data, error} = await sb.rpc("school_stats");
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

// Live presence on a private per-school channel. Only students from the same school can join it
// (enforced by realtime policies in the database).
let channel = null;
let livePeople = [];
export const live = () => livePeople;
export async function joinSchool() {
  if (!user || !profile || channel) return;
  channel = sb.channel(`school:${profile.school}`, {config: {private: true, presence: {key: user.id}}});
  channel.on("presence", {event: "sync"}, () => {
    const state = channel.presenceState();
    livePeople = Object.entries(state).map(([id, metas]) => ({id, ...metas[metas.length - 1]}))
      .filter(p => p.active).sort((a, b) => (a.since || 0) - (b.since || 0));
    emit();
  });
  await new Promise(resolve => channel.subscribe(status => { if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve(status); }));
}
export async function leaveSchool() {
  if (!channel) return;
  try { await channel.untrack(); await sb.removeChannel(channel); } catch {}
  channel = null; livePeople = []; emit();
}
// What classmates see: your name, emoji, whether you're in a session, your state and focus %. Nothing else.
let lastTrack = "";
export async function track(info) {
  if (!channel || !profile) return;
  const payload = profile.show_live && info.active
    ? {active: true, name: profile.display_name, emoji: profile.emoji, since: info.since, state: info.state, focus: info.focus ?? null}
    : {active: false};
  const sig = JSON.stringify(payload);
  if (sig === lastTrack) return;
  lastTrack = sig;
  try { await channel.track(payload); } catch (e) { console.warn(e); }
}
