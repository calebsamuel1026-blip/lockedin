// Pure merge rules for cloud sync (no DOM, no network) so tests/sync.test.mjs can run them in node.
//
// A "state" is {wallet, store: {sessions, settings, goals, ...}, version, updatedAt}. version is the cloud row's
// counter; updatedAt is milliseconds. The rule of thumb: never lose progress. When only one side changed since the
// last sync we take it whole; when both changed we keep the max of every counter and the union of all history.

export const earned = s => +s?.wallet?.earned || 0;
export const isEmpty = s => !s || (!(s.store?.sessions?.length) && !earned(s));

// What to do when we have both copies. meta = what this device remembers about its last sync.
// Returns {action: "none" | "push" | "pull" | "merge", state}.
export function decide(local, remote, {syncedVersion = null, dirty = true} = {}) {
  if (isEmpty(remote)) return {action: isEmpty(local) ? "none" : "push", state: local};
  if (isEmpty(local)) return {action: "pull", state: remote};
  if (syncedVersion != null && remote.version === syncedVersion) return {action: dirty ? "push" : "none", state: local};
  if (syncedVersion != null && !dirty) return {action: "pull", state: remote};
  // Both sides moved (or this device never synced with this account): combine them.
  return {action: "merge", state: mergeStates(local, remote)};
}

// The side with more total keys earned has seen more use, so its settings and choices win ties.
function primaryOf(a, b) {
  if (earned(a) !== earned(b)) return earned(a) > earned(b) ? [a, b] : [b, a];
  return (+a.updatedAt || 0) >= (+b.updatedAt || 0) ? [a, b] : [b, a];
}

const defined = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v != null));
const uniqSorted = (xs, keep) => [...new Set(xs)].sort().slice(-keep);
function maxMap(x = {}, y = {}) {
  const out = {...x};
  for (const [k, v] of Object.entries(y || {})) out[k] = Math.max(+out[k] || 0, +v || 0);
  return out;
}

// ---------- wallet ----------
// Balances can't just take the bigger of two copies: spend 50 keys on the phone and 30 on the laptop and "max"
// quietly gives one purchase back. So every device keeps its own ever-growing counters in wallet.dev[deviceId]
// (e = earned, s = spent, fb = freezes bought, d = keys earned per day). Merging takes each device's larger
// counter, and the balance is always computed: keys = base + earned + grants - spent.
// grants = one-off rewards keyed by what they were for ("invite", "ref:12", "goal:2026-10-05"), so two devices
// that both pay the same reward before syncing still count it once. fz = days a streak freeze was used.
// base = the balance from before counters existed (older app versions); bases merge with max, like they used to.
const num = v => (Number.isFinite(+v) ? +v : 0);
const DAYS_KEPT = 70;

export function walletTotals(w = {}) {
  let e = 0, s = 0, fb = 0;
  for (const d of Object.values(w.dev || {})) { e += num(d?.e); s += num(d?.s); fb += num(d?.fb); }
  const g = Object.values(w.grants || {}).reduce((a, x) => a + num(x), 0), b = w.base || {};
  const raw = num(b.keys) + e + g - s;
  // raw < 0 only when two offline devices spent the same keys; it's paid back by later earnings.
  return {keys: Math.max(0, raw), raw, earned: num(b.earned) + e + g, freezes: Math.max(0, num(b.freezes) + fb - (w.fz || []).length)};
}
const withTotals = w => { const t = walletTotals(w); w.keys = t.keys; w.earned = t.earned; w.freezes = t.freezes; return w; };

// Any stored wallet -> the current shape, with keys/earned/freezes recomputed.
export function normalizeWallet(w) {
  w = w && typeof w === "object" ? w : {};
  const out = {...w, dev: {...(w.dev || {})}, grants: {...(w.grants || {})}, fz: [...new Set(w.fz || [])].sort()};
  if (!w.base || typeof w.base !== "object") out.base = {keys: num(w.keys), earned: num(w.earned), freezes: num(w.freezes)};
  else {
    out.base = {...w.base};
    // An older app version (still open in some tab) changed the balance directly: keep its change.
    const t = walletTotals(out);
    for (const k of ["keys", "earned", "freezes"]) if (k in w && num(w[k]) !== t[k]) out.base[k] = num(out.base[k]) + num(w[k]) - t[k];
  }
  return withTotals(out);
}

const lastDays = m => Object.fromEntries(Object.entries(m || {}).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-DAYS_KEPT));
export function mergeWallets(p = {}, o = {}) {
  p = normalizeWallet(p); o = normalizeWallet(o);
  const max = (a, b, k) => Math.max(num(a?.[k]), num(b?.[k]));
  const dev = {...o.dev};
  for (const [id, d] of Object.entries(p.dev)) {
    const x = dev[id] || {};
    dev[id] = {e: max(d, x, "e"), s: max(d, x, "s"), fb: max(d, x, "fb"), d: lastDays(maxMap(x.d, d.d))};
  }
  const grants = {...o.grants};
  for (const [id, n] of Object.entries(p.grants)) grants[id] = Math.max(num(grants[id]), num(n));
  const owned = [...new Set([...(p.owned || ["midnight"]), ...(o.owned || [])])];
  const seen = new Set();
  const ledger = [...(p.ledger || []), ...(o.ledger || [])]
    .filter(l => { const id = `${l.t}|${l.amt}|${l.why}`; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => a.t - b.t).slice(-300);
  return withTotals({
    ...o, ...p,
    base: {keys: max(p.base, o.base, "keys"), earned: max(p.base, o.base, "earned"), freezes: max(p.base, o.base, "freezes")},
    dev, grants, fz: [...new Set([...p.fz, ...o.fz])].sort(),
    owned, equipped: owned.includes(p.equipped) ? p.equipped : "midnight",
    frozenDays: uniqSorted([...(p.frozenDays || []), ...(o.frozenDays || [])], 30),
    goalDays: uniqSorted([...(p.goalDays || []), ...(o.goalDays || [])], 60),
    byDay: maxMap(p.byDay, o.byDay), ledger,
  });
}

export function mergeSessions(p = [], o = []) {
  const byId = new Map();
  for (const s of [...o, ...p]) if (s?.id != null) byId.set(s.id, s);   // primary's copy wins on the same id
  return [...byId.values()].sort((a, b) => (a.start || 0) - (b.start || 0));
}

function mergeGoals(p = {}, o = {}) {
  const out = {...o};
  for (const [day, g] of Object.entries(p || {})) if (!out[day] || (g?.createdAt || 0) >= (out[day]?.createdAt || 0)) out[day] = g;
  return out;
}

export function mergeStates(a, b) {
  const [p, o] = primaryOf(a, b);
  const ps = p.store || {}, os = o.store || {};
  return {
    wallet: mergeWallets(p.wallet || {}, o.wallet || {}),
    store: {
      ...defined(os), ...defined(ps),
      sessions: mergeSessions(ps.sessions, os.sessions),
      goals: mergeGoals(ps.goals, os.goals),
      coachNotes: {...(os.coachNotes || {}), ...(ps.coachNotes || {})},
      feedback: maxMap(os.feedback, ps.feedback),
      onboarded: !!(ps.onboarded || os.onboarded),
    },
    version: Math.max(+a.version || 0, +b.version || 0),
    updatedAt: Math.max(+a.updatedAt || 0, +b.updatedAt || 0),
  };
}
