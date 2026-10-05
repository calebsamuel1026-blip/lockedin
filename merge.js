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

export function mergeWallets(p = {}, o = {}) {
  const max = k => Math.max(+p[k] || 0, +o[k] || 0);
  const owned = [...new Set([...(p.owned || ["midnight"]), ...(o.owned || [])])];
  const seen = new Set();
  const ledger = [...(p.ledger || []), ...(o.ledger || [])]
    .filter(l => { const id = `${l.t}|${l.amt}|${l.why}`; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => a.t - b.t).slice(-300);
  return {
    ...o, ...p,
    keys: max("keys"), earned: max("earned"), freezes: max("freezes"),
    owned, equipped: owned.includes(p.equipped) ? p.equipped : "midnight",
    frozenDays: uniqSorted([...(p.frozenDays || []), ...(o.frozenDays || [])], 30),
    goalDays: uniqSorted([...(p.goalDays || []), ...(o.goalDays || [])], 60),
    byDay: maxMap(p.byDay, o.byDay), ledger,
  };
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
