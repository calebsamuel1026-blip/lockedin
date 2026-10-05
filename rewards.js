// Keys (currency), shop, streaks and "Your week, wrapped". Pure logic plus a share-image renderer.
import {image, lead} from "./icons.js";
import * as store from "./store.js";
import {normalizeWallet, mergeWallets, walletTotals} from "./merge.js";

export const STREAK_MIN = 25 * 60;     // seconds locked in per day to keep your streak alive
export const FREEZE_PRICE = 60;
export const MAX_FREEZES = 2;

// Backgrounds: CSS lives in styles.css under [data-wallpaper="id"].
export const WALLPAPERS = [
  {id: "midnight", name: "Midnight", price: 0, swatch: "linear-gradient(135deg,#0a0a0b,#1c1c1f)"},
  {id: "matcha", name: "Matcha", price: 80, swatch: "linear-gradient(135deg,#1f3a1a,#c6ff3d)"},
  {id: "sunset", name: "Sunset", price: 120, swatch: "linear-gradient(135deg,#ff6a3d,#9b2cff)"},
  {id: "ocean", name: "Ocean", price: 120, swatch: "linear-gradient(135deg,#0b3d91,#2dd4bf)"},
  {id: "aurora", name: "Aurora", price: 200, swatch: "linear-gradient(135deg,#00ffa3,#7c3aed,#06b6d4)", animated: true},
  {id: "stars", name: "Starfield", price: 220, swatch: "radial-gradient(circle at 30% 30%,#fff 1px,transparent 2px),#05060f"},
  {id: "grid", name: "Retro grid", price: 260, swatch: "linear-gradient(#ff2fd0 1px,transparent 1px) 0 0/12px 12px,linear-gradient(90deg,#ff2fd0 1px,#140021 1px) 0 0/12px 12px"},
  {id: "lava", name: "Lava lamp", price: 350, swatch: "radial-gradient(circle at 30% 40%,#ff5a5f,transparent 50%),radial-gradient(circle at 70% 60%,#fbbf24,transparent 50%),#1a0606", animated: true},
  {id: "chrome", name: "Y2K chrome", price: 450, swatch: "linear-gradient(135deg,#e5e7eb,#9ca3af,#f9fafb,#6b7280)"},
  {id: "custom", name: "Your photo", price: 150, swatch: "repeating-linear-gradient(45deg,#232327 0 10px,#1c1c1f 10px 20px)", custom: true},
];
export const BREAKS = [{min: 5, price: 15}, {min: 10, price: 30}, {min: 15, price: 40}];

const fresh = () => normalizeWallet({keys: 0, earned: 0, owned: ["midnight"], equipped: "midnight", freezes: 0, frozenDays: [], goalDays: [], ledger: [], secAcc: 0});
// This browser's id in wallet.dev (see merge.js). A new id whenever the wallet starts over (first run, "Delete all
// data", restoring a backup), so this device's counters never restart below a copy the account already has.
const DEVICE_KEY = "lockedin.device";
const stored = store.load("wallet", null);
const device = (() => {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !stored) { id = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(36).padStart(2, "0")).join(""); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return "m" + Math.random().toString(36).slice(2, 10); }   // no storage: a fresh id per visit is still correct
})();
export let wallet = stored ? normalizeWallet({...fresh(), ...stored}) : fresh();
let selfSave = false, unsaved = false;
// Merge with the copy on disk first: another tab may have earned or spent since this one last looked.
const save = () => {
  wallet = mergeWallets(wallet, store.load("wallet", null) || {});
  selfSave = true;
  try { store.save("wallet", wallet); } finally { selfSave = false; }
  unsaved = false;
};
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = ev => listeners.forEach(fn => fn(ev));
// Someone else rewrote the saved wallet (Delete all data, restore, account deleted): drop the in-memory copy.
store.onSave(key => {
  if (key !== "wallet" || selfSave) return;
  wallet = normalizeWallet({...fresh(), ...(store.load("wallet", null) || {})}); unsaved = false; emit({type: "sync"});
});
// Another tab saved: fold its counters in.
addEventListener("storage", e => {
  if (e.key !== "lockin.v1.wallet") return;
  try { wallet = e.newValue ? mergeWallets(wallet, JSON.parse(e.newValue)) : fresh(); emit({type: "sync"}); } catch {}
});
// Per-second earnings are only written every few minutes; don't lose them when the tab closes or hides.
addEventListener("pagehide", () => unsaved && save());
document.addEventListener("visibilitychange", () => document.hidden && unsaved && save());

const mine = () => (wallet.dev[device] ||= {e: 0, s: 0, fb: 0, d: {}});
function logDay(n) { const k = dk(new Date()), d = (mine().d ||= {}); d[k] = (d[k] || 0) + n; }
const recompute = () => Object.assign(wallet, (({keys, earned, freezes}) => ({keys, earned, freezes}))(walletTotals(wallet)));
const note = (amt, why) => { wallet.ledger.push({t: Date.now(), amt, why}); if (wallet.ledger.length > 300) wallet.ledger.shift(); };

// Keys earned per day, for the weekly recap: the old per-day map plus every device's counters.
export const earnedOn = day => (wallet.byDay?.[day] || 0) + Object.values(wallet.dev || {}).reduce((a, d) => a + (d?.d?.[day] || 0), 0);
// Cloud sync brought another copy. Same account: merge (keeps anything not saved yet). Different account: replace.
export function replaceWallet(w, {merge = false} = {}) {
  wallet = merge ? mergeWallets(wallet, w) : normalizeWallet({...fresh(), ...w});
  save(); emit({type: "sync"});
}

export function award(amount, why) {
  amount = Math.round(amount);
  if (amount <= 0) return;
  mine().e += amount; logDay(amount); recompute(); note(amount, why);
  save(); emit({type: "earn", amount, why});
}
// A one-off reward, paid at most once per id across all devices. Returns true if it was new.
export function grant(id, amount, why) {
  amount = Math.round(amount);
  if (amount <= 0 || wallet.grants[id] != null) return false;
  wallet.grants[id] = amount; logDay(amount); recompute(); note(amount, why);
  save(); emit({type: "earn", amount, why});
  return true;
}
export function spend(amount, why) {
  if (wallet.keys < amount) return false;
  mine().s += amount; recompute(); note(-amount, why);
  save(); emit({type: "spend", amount, why});
  return true;
}

// Streak multiplier rewards coming back every day.
export const multiplier = streak => (streak >= 14 ? 2 : streak >= 7 ? 1.5 : streak >= 3 ? 1.2 : 1);

// Called once per focused second. focusRun = seconds focused in a row this session.
export function onFocusedSecond(focusRun, streak) {
  wallet.secAcc = (wallet.secAcc || 0) + multiplier(streak) / 60;
  if (wallet.secAcc >= 1) { const whole = Math.floor(wallet.secAcc); wallet.secAcc -= whole; mine().e += whole; logDay(whole); recompute(); unsaved = true; emit({type: "tick"}); }
  if (unsaved && focusRun % 300 === 0) save();
  if (focusRun > 0 && focusRun % 1500 === 0) award(5, "25 phone-free minutes");
}
export function onDailyGoal(day) {
  if (wallet.goalDays.includes(day)) return;
  wallet.goalDays.push(day); if (wallet.goalDays.length > 60) wallet.goalDays.shift();
  if (!grant(`goal:${day}`, 20, "Hit your daily goal")) save();
}

export function buyWallpaper(id) {
  const w = WALLPAPERS.find(x => x.id === id);
  if (!w || wallet.owned.includes(id)) return true;
  if (!spend(w.price, `${w.name} background`)) return false;
  wallet.owned.push(id); save(); return true;
}
export function equip(id) { if (wallet.owned.includes(id)) { wallet.equipped = id; save(); emit({type: "equip"}); } }
export function buyFreeze() {
  if (wallet.freezes >= MAX_FREEZES) return false;
  if (!spend(FREEZE_PRICE, "Streak freeze")) return false;
  mine().fb = (mine().fb || 0) + 1; recompute(); save(); return true;
}

// ---------- streaks ----------
const dk = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Use a freeze automatically if yesterday was missed (only yesterday, so a freeze can't revive an old streak).
export function applyFreezes(byDay) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  const before = new Date(y); before.setDate(before.getDate() - 1);
  const yk = dk(y);
  const keptBefore = (byDay[dk(before)] || 0) >= STREAK_MIN || wallet.frozenDays.includes(dk(before));
  if ((byDay[yk] || 0) < STREAK_MIN && !wallet.frozenDays.includes(yk) && wallet.freezes > 0 && keptBefore) {
    wallet.fz = [...new Set([...(wallet.fz || []), yk])].sort(); recompute();
    wallet.frozenDays.push(yk); if (wallet.frozenDays.length > 30) wallet.frozenDays.shift();
    save(); emit({type: "freeze", day: yk});
    return true;
  }
  return false;
}
// {count, todayDone, atRisk}: atRisk = streak alive but today not done yet and it's evening.
export function streak(byDay) {
  const ok = k => (byDay[k] || 0) >= STREAK_MIN || wallet.frozenDays.includes(k);
  const d = new Date(); const today = dk(d);
  const todayDone = ok(today);
  let n = todayDone ? 1 : 0;
  d.setDate(d.getDate() - 1);
  while (ok(dk(d))) { n++; d.setDate(d.getDate() - 1); }
  return {count: n, todayDone, atRisk: n > 0 && !todayDone && new Date().getHours() >= 19, todaySec: byDay[today] || 0};
}

// ---------- wrapped ----------
// Build the story cards from a week's stats (computed by the app).
export function wrapCards(w) {
  const hrs = (w.sec / 3600);
  const cards = [
    {k: "intro", big: "Your week,", sub: "wrapped 🎁", note: w.label},
    {k: "hours", big: `${hrs.toFixed(1)}h`, sub: "locked in", note: w.prevSec != null ? (w.sec >= w.prevSec ? `That's ${((w.sec - w.prevSec) / 3600).toFixed(1)}h more than last week. Up only. 📈` : `${((w.prevSec - w.sec) / 3600).toFixed(1)}h less than last week. Next week's yours.`) : "Your first wrapped. Many more to come."},
  ];
  if (w.focus != null) cards.push({k: "focus", big: `${w.focus}%`, sub: "focus score", note: w.focus >= 90 ? "Elite. Your phone didn't stand a chance." : w.focus >= 75 ? "Solid. A few phone checks, but you stayed on it." : "Your phone won a few rounds. Rematch next week."});
  if (w.bestHour != null) cards.push({k: "hour", big: w.bestHourLabel, sub: "your power hour", note: `You were ${w.bestHourPct}% focused around then. Save your hardest work for it.`});
  cards.push({k: "phone", big: String(w.pickups), sub: `phone pickup${w.pickups === 1 ? "" : "s"}`, note: w.pickups === 0 ? "Zero. Are you even real?" : `That's about ${w.perHour?.toFixed(1) ?? "?"} an hour.`});
  if (w.bestRun) cards.push({k: "run", big: w.bestRunLabel, sub: "longest lock-in", note: "Your best stretch without a single distraction."});
  cards.push({k: "keys", big: `🔑 ${w.keys}`, sub: "keys earned", note: "Spend them in the shop on backgrounds and breaks."});
  cards.push({k: "streak", big: `🔥 ${w.streak}`, sub: `day streak`, note: w.streak >= 7 ? "A whole week. Legendary." : w.streak > 0 ? "Keep it alive tomorrow." : "Lock in 25 minutes tomorrow to start one."});
  cards.push({k: "share", big: `${hrs.toFixed(1)}h`, sub: "locked in this week", note: "Share your week", share: true});
  return cards;
}

// 1080x1920 image for stories.
export async function shareImage(w) {
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1920;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 1080, 1920); grad.addColorStop(0, "#0a0a0b"); grad.addColorStop(0.55, "#1b2a07"); grad.addColorStop(1, "#c6ff3d");
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1920);
  const font = (wgt, px) => `${wgt} ${px}px "Plus Jakarta Sans", Inter, system-ui, sans-serif`;
  g.fillStyle = "#c6ff3d"; g.font = font(800, 64); g.fillText("lockedin", 90, 170);
  g.fillStyle = "#fff"; g.font = font(700, 54); g.fillText("my week, wrapped", 90, 260);
  const rows = [
    [`${(w.sec / 3600).toFixed(1)}h`, "locked in"],
    [w.focus != null ? `${w.focus}%` : "--", "focus score"],
    [String(w.pickups), "phone pickups"],
    [`🔥 ${w.streak}`, "day streak"],
    [`🔑 ${w.keys}`, "keys earned"],
  ];
  let y = 520;
  for (const [big, small] of rows) {
    g.fillStyle = "#fff"; g.font = font(800, 150);
    const {icon, text} = lead(big), img = icon && await image(icon);
    if (img) { g.drawImage(img, 90, y - 120, 130, 130); g.fillText(text, 90 + 150, y); }
    else g.fillText(text, 90, y);
    g.fillStyle = "rgba(255,255,255,.7)"; g.font = font(600, 50); g.fillText(small, 90, y + 70);
    y += 270;
  }
  g.fillStyle = "#0b0d07"; g.font = font(700, 44); g.fillText("calebsamuel1026-blip.github.io/lockedin", 90, 1840);
  return new Promise(r => c.toBlob(r, "image/png"));
}
