// All data lives in this browser's localStorage. Signing in (cloud.js) syncs a copy to your account.
const NS = "lockin.v1.";
// cloud.js listens so it knows when there's something new to sync.
const saveListeners = new Set();
export const onSave = fn => saveListeners.add(fn);
export const KEYS = ["settings", "sessions", "active", "goals", "calib", "onboarded", "coachNotes", "reportSeen", "lastPlace", "learn", "adapt", "feedback", "wallet"];

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(NS + key);
    else localStorage.setItem(NS + key, JSON.stringify(value));
    saveListeners.forEach(fn => { try { fn(key); } catch {} });
    return true;
  } catch (err) {
    window.dispatchEvent(new CustomEvent("lockin:storage-error", {detail: err}));
    return false;
  }
}

export function exportAll() {
  const data = {};
  for (const k of KEYS) data[k] = load(k, null);
  return {app: "lock-in-tracker", version: 1, exportedAt: new Date().toISOString(), data};
}

export function importAll(obj) {
  if (!obj || obj.app !== "lock-in-tracker" || typeof obj.data !== "object") throw new Error("This isn't a Lock In backup file.");
  if (!Array.isArray(obj.data.sessions ?? [])) throw new Error("The backup's sessions are damaged.");
  const cleanId = v => String(v ?? "").replace(/[^a-z0-9]/gi, "").slice(0, 40) || Math.random().toString(36).slice(2);
  for (const s of obj.data.sessions || []) { s.id = cleanId(s.id); s.seconds = +s.seconds || 0; s.pickups = +s.pickups || 0; }
  for (const day of Object.values(obj.data.goals || {})) for (const g of day?.goals || []) { g.id = cleanId(g.id); g.minutes = +g.minutes || 30; g.title = String(g.title ?? "").slice(0, 140); }
  for (const k of KEYS) if (k in obj.data) save(k, obj.data[k]);
}

export function clearAll() {
  for (const k of KEYS) save(k, null);
}
