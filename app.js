import * as store from "./store.js";
import {Vision} from "./vision.js";
import * as engine from "./engine.js";
import * as rewards from "./rewards.js";
import {getFile, putFile, shrinkImage} from "./files.js";
import * as clipper from "./clips.js";
import * as emoji from "./emoji.js";
import * as analytics from "./analytics.js";
import {GOOGLE_AUTH_ENABLED, GSC_VERIFICATION} from "./config.js";
const {DISTRACTED} = engine;
const {track} = analytics;
analytics.watchErrors();

/* ================= constants & state ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const STATES = ["focused", "phone", "away", "break", "chat", "down", "sleepy", "zoned"];
const IDX = Object.fromEntries(STATES.map((k, i) => [k, i]));
const LABEL = {focused: "Focused", phone: "On your phone", away: "Away", break: "On break", chat: "Chatting", down: "Head down",
  sleepy: "Eyes closed", zoned: "Zoned out", paused: "Paused", idle: "Ready"};
const COLOR_VAR = {focused: "--focused", phone: "--phone", away: "--away", break: "--break", chat: "--chat", down: "--down", sleepy: "--sleepy", zoned: "--zoned"};
// The Goals section is switched off for now (the code stays for later).
const GOALS_ENABLED = false;
const VIEWS = ["focus", ...(GOALS_ENABLED ? ["goals"] : []), "insights", "history"];
const ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>';

const DEFAULTS = {
  dailyGoalH: 3, weeklyGoalH: 15, weekStart: 1, focusBlockMin: 50, breakMin: 10,
  phoneAlertSec: 5, downSec: 12, downSound: true, phoneRepeat: true, sensitivity: 1, paperMode: false, autoCamera: true,
  chatDetect: true, chatSec: 20, chatAlertSec: 90, collabDefault: false,
  sound: true, volume: 0.5, notify: true, titleAlerts: true, theme: "system", shortcuts: true,
  places: "Library, Home, Café, Office", showPreview: false, drainKeys: true,
  clips: false, alertSound: "classic", alertText: "", pomodoro: false,
};
let settings = {...DEFAULTS, ...store.load("settings", {})};
if ((settings.v || 1) < 2) { if (settings.downSec < 12) settings.downSec = 12; settings.v = 2; store.save("settings", settings); }
if (settings.v < 3) { if (settings.phoneAlertSec === 10) settings.phoneAlertSec = 5; settings.v = 3; store.save("settings", settings); }
let sessions = store.load("sessions", []);
let active = store.load("active", null);
if (active) { active.tl = (active.tl || []).map(b => STATES.map((_, i) => b[i] || 0)); active.stats = {chat: 0, down: 0, sleepy: 0, zoned: 0, collab: 0, ...active.stats}; active.alerts ||= {}; }
let goalsByDate = store.load("goals", {});
let aiAvailable = false;
let passive = false;          // another tab owns tracking
let place = store.load("lastPlace", null);

const live = {state: "idle", stateSec: 0, downSec: 0, offSec: 0, talkSec: 0, focusRun: 0, lastAlertAt: 0, lastYawnTip: 0,
  lastSec: Date.now(), lastAnnounced: "", lastAnnounceAt: 0, reason: ""};
let collabNext = settings.collabDefault;   // group-work toggle before a session starts
const collabOn = () => (active ? !!active.collab : collabNext);
const vision = new Vision($("#video"), $("#overlay"), () => +settings.sensitivity || 1);
vision.restore(store.load("learn", null));

/* ================= helpers ================= */
const pad = n => String(n).padStart(2, "0");
const fmtClock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };
const fmtHM = sec => { const m = Math.round(sec / 60); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
const fmtH = sec => (sec / 3600).toFixed(1) + "h";
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dayKey(new Date());
const parseDay = k => new Date(k + "T12:00:00");
const fmtTime = ms => new Date(ms).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
const fmtDay = (d, opts = {weekday: "short", month: "short", day: "numeric"}) => d.toLocaleDateString([], opts);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const elapsedMs = () => !active ? 0 : active.baseMs + (active.runStartedAt ? Date.now() - active.runStartedAt : 0);
// Focus score: focused time vs. time lost to your phone or off-topic chatting. Away and breaks don't count against you.
const lost = st => DISTRACTED.reduce((a, k) => a + (st[k] || 0), 0);
const score = st => { const t = (st.focused || 0) + lost(st); return t >= 30 ? Math.round(st.focused / t * 100) : null; };
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const placesList = () => settings.places.split(",").map(s => s.trim()).filter(Boolean).slice(0, 8);
const today = () => goalsByDate[todayKey()];
const typing = el => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
function weekStartOf(d, offsetWeeks = 0) {
  const s = new Date(d); s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() - settings.weekStart + 7) % 7) + offsetWeeks * 7);
  return s;
}
function secondsByDay() {
  const m = {};
  for (const s of sessions) m[s.date] = (m[s.date] || 0) + s.seconds;
  if (active) { const k = dayKey(new Date(active.startedAt)); m[k] = (m[k] || 0) + elapsedMs() / 1000; }
  return m;
}
function announce(text, urgent = false) {
  const el = urgent ? $("#assertLive") : $("#politeLive");
  el.textContent = ""; setTimeout(() => (el.textContent = text), 50);
}

/* ================= persistence ================= */
let lastActiveSave = 0;
function saveActive(force = false) {
  if (passive) return;
  if (!force && Date.now() - lastActiveSave < 5000) return;
  lastActiveSave = Date.now();
  store.save("active", active);
}
const saveSessions = () => store.save("sessions", sessions);
const saveGoals = () => store.save("goals", goalsByDate);
const saveSettings = () => store.save("settings", settings);
window.addEventListener("lockin:storage-error", () => $("#storageWarn").classList.remove("hidden"));
window.addEventListener("pagehide", () => { saveActive(true); saveGoals(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { saveActive(true); saveGoals(); } });

/* ================= theme ================= */
const mql = matchMedia("(prefers-color-scheme: light)");
function applyTheme() {
  const t = settings.theme === "system" ? (mql.matches ? "light" : "dark") : settings.theme;
  document.documentElement.dataset.theme = t;
  if (pipWin) pipWin.document.documentElement.dataset.theme = t;
}
mql.addEventListener?.("change", applyTheme);

/* ================= routing ================= */
function currentView() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "focus"; }
function showView(v, moveFocus = false) {
  $$(".view").forEach(el => el.classList.toggle("on", el.id === "v-" + v));
  $$(".tabs a").forEach(a => a.dataset.view === v ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  if (v === "goals") renderGoals();
  if (v === "insights") { renderInsights(); markReportSeen(); }
  if (v === "history") renderHistory();
  if (moveFocus) $("#v-" + v + " h1")?.setAttribute("tabindex", "-1"), $("#v-" + v + " h1")?.focus();
}
window.addEventListener("hashchange", () => showView(currentView(), true));

/* ================= multi-tab coordination ================= */
const tabId = uid();
const tabBorn = Date.now();
const bc = "BroadcastChannel" in window ? new BroadcastChannel("lockin") : null;
function becomePassive() {
  if (passive) return;
  saveActive(true); saveGoals();
  passive = true;
  if (vision.on) vision.stop();
  $("#otherTab").classList.remove("hidden");
  closePip();
}
function claimTab() {
  passive = false;
  active = store.load("active", null); sessions = store.load("sessions", []); goalsByDate = store.load("goals", {});
  live.lastSec = Date.now();
  $("#otherTab").classList.add("hidden");
  bc?.postMessage({type: "claim", from: tabId});
  if (active && settings.autoCamera) vision.start();
  renderAll();
}
if (bc) {
  bc.onmessage = ({data: m}) => {
    if (!m || m.from === tabId) return;
    if (m.type === "hello" && !passive) bc.postMessage({type: "here", from: tabId, born: tabBorn});
    // Two tabs opening together: the older one (then the lower id) stays in charge.
    if (m.type === "here" && (m.born < tabBorn || (m.born === tabBorn && m.from < tabId))) becomePassive();
    if (m.type === "claim") becomePassive();
  };
}
$("#useHereBtn").onclick = claimTab;

/* ================= session control ================= */
function startSession() {
  if (passive) return;
  unlockAudio();
  if (settings.notify && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  const pre = Math.max(0, Math.min(720, +$("#preMin").value || 0)) * 60000;
  const now = Date.now();
  clipper.reset();
  active = {
    id: uid(), startedAt: now - pre, baseMs: pre, runStartedAt: now, addedMs: pre, place, goalId: null,
    stats: Object.fromEntries([...STATES, "collab"].map(k => [k, 0])), tl: [], worked: {}, collab: collabNext,
    pickups: 0, streak: 0, best: 0, blockSec: 0, blockAlerted: false, breakUntil: 0,
    alerts: {}, keys0: rewards.wallet.earned,
  };
  active.goalId = today()?.goals.find(g => !g.done)?.id || null;
  live.lastSec = now; live.state = "focused"; live.stateSec = 0;
  $("#preMin").value = 0; $("#preStart details").open = false;
  saveActive(true);
  if (settings.autoCamera && !vision.on) vision.start();
  announce("Session started.");
  track("session_start", {pomodoro: !!settings.pomodoro, collab: !!active.collab, camera: settings.autoCamera || vision.on, pre_min: Math.round(pre / 60000)});
  render();
  $("#pauseBtn").focus({preventScroll: true});
}
function togglePause() {
  if (passive) return;
  if (!active) return startSession();
  if (active.runStartedAt) { active.baseMs = elapsedMs(); active.runStartedAt = null; announce("Paused."); }
  else { active.runStartedAt = Date.now(); live.lastSec = Date.now(); announce("Resumed."); }
  saveActive(true); render();
}
function toggleBreak(min = settings.breakMin) {
  if (passive || !active) return;
  if (!active.runStartedAt) togglePause();
  active.breakUntil = active.breakUntil ? 0 : Date.now() + min * 60000;
  if (!active.breakUntil) { active.blockSec = 0; active.blockAlerted = false; }
  announce(active.breakUntil ? `Break started, ${settings.breakMin} minutes.` : "Break ended. Back to work.");
  saveActive(true); render();
}
async function endSession() {
  if (passive || !active || !confirm("End this session and save it?")) return;
  const goals = today()?.goals || [];
  const rec = {
    id: active.id, date: dayKey(new Date(active.startedAt)), start: active.startedAt, end: Date.now(),
    seconds: Math.round(elapsedMs() / 1000), addedSec: Math.round(active.addedMs / 1000),
    analyzedStart: active.startedAt + active.addedMs, place: active.place || null,
    stats: active.stats, score: score(active.stats), pickups: active.pickups, best: active.best,
    worked: Object.entries(active.worked).map(([id, sec]) => ({title: goals.find(g => g.id === id)?.title || "Other", sec})).sort((a, b) => b.sec - a.sec),
    tl: active.tl, alerts: active.alerts || {}, tomatoes: active.tomatoes || 0, collab: !!active.collab,
    keys: Math.max(0, rewards.wallet.earned - (active.keys0 ?? rewards.wallet.earned)),
  };
  sessions.push(rec); saveSessions();
  if (cloud?.user) cloud.queueSession(rec.id);
  const al = rec.alerts;
  track("session_end", {minutes: Math.round(rec.seconds / 6) / 10, focus_pct: rec.score, pickups: rec.pickups, pomodoros: rec.tomatoes, keys_earned: rec.keys,
    alerts_phone: al.phone || 0, alerts_chat: al.chat || 0, alerts_sleepy: al.sleepy || 0, camera: vision.on, collab: rec.collab});
  active = null; store.save("active", null);
  if (vision.on) vision.stop();
  live.state = "idle";
  showSummary(rec);
  renderClips();
  renderAll();
  $("#summaryDlg").addEventListener("close", () => $("#startBtn").focus({preventScroll: true}), {once: true});
}
function showSummary(r) {
  const st = r.stats, g = today();
  const total = st.focused + st.phone + (st.chat || 0) + (st.down || 0);
  const tip = !total ? "Turn on the camera next time to get a focus score."
    : st.phone / total > 0.15 ? "Your phone was the biggest leak. Try putting it in a bag or another room next time."
    : r.score >= 85 ? "Locked in. That's a great session." : "Solid work. Shorter blocks with real breaks can push your score higher.";
  $("#summaryBody").innerHTML = `
    <div class="sum-hero"><b>${fmtHM(r.seconds)}</b><span>${r.place ? `${esc(r.place)} · ` : ""}${fmtTime(r.start)} – ${fmtTime(r.end)}</span></div>
    <div class="sum-stats">
      <div><b>${r.score ?? "--"}${r.score != null ? "%" : ""}</b><span>Focus</span></div>
      <div><b>${r.pickups}</b><span>Pickups</span></div>
      <div><b>${fmtHM(r.best)}</b><span>Best streak</span></div>
    </div>
    ${r.worked.length ? `<p class="group-label">Time by goal</p><ul class="form-group plain-list" style="padding:0 16px">${r.worked.map(w => `<li><span>${esc(w.title)}</span><b>${fmtHM(w.sec)}</b></li>`).join("")}</ul>` : ""}
    ${g?.goals.length ? `<p class="sum-tip" style="margin-top:14px">Goals done today: <b>${g.goals.filter(x => x.done).length} of ${g.goals.length}</b></p>` : ""}
    <p class="sum-tip" style="margin-top:8px">${tip}</p>`;
  $("#summaryDlg").showModal();
}

$("#startBtn").onclick = startSession;
$("#pauseBtn").onclick = togglePause;
$("#breakBtn").onclick = () => requestBreak();
// Breaks: free when you've earned one by finishing a focus block, otherwise they cost keys.
function requestBreak() {
  if (passive || !active) return;
  if (active.breakUntil) return toggleBreak();
  if (active.blockAlerted || settings.focusBlockMin === 0 || (settings.pomodoro && (active.pomoSec || 0) >= 1500)) { toggleBreak(settings.breakMin); toast("Earned break 🎉"); track("break_taken", {paid: false, minutes: settings.breakMin}); return; }
  $("#breakOpts").innerHTML = rewards.BREAKS.map(b => `<button class="break-opt" data-break-min="${b.min}" ${rewards.wallet.keys < b.price ? "disabled" : ""}>
      <b>${b.min} min</b><span>🔑 ${b.price}</span></button>`).join("");
  const left = Math.max(0, settings.focusBlockMin * 60 - active.blockSec);
  $("#breakMsg").textContent = `You have 🔑 ${rewards.wallet.keys}. Free break in ${fmtHM(left)} of focus.`;
  $("#breakDlg").showModal();
}
$("#breakOpts").onclick = e => {
  const b = e.target.closest("[data-break-min]"); if (!b) return;
  const opt = rewards.BREAKS.find(x => x.min === +b.dataset.breakMin);
  if (!rewards.spend(opt.price, `${opt.min}-minute break`)) { $("#breakMsg").textContent = "Not enough keys yet. Keep locking in."; return; }
  $("#breakDlg").close(); toggleBreak(opt.min); toast(`−${opt.price} 🔑 break`, "spend");
  track("break_taken", {paid: true, minutes: opt.min, price: opt.price});
};
$("#endBtn").onclick = endSession;
$("#editBtn").onclick = () => {
  const m = Math.floor(elapsedMs() / 60000);
  $("#editH").value = Math.floor(m / 60); $("#editM").value = m % 60;
  $("#editRow").classList.remove("hidden"); $("#editBtn").setAttribute("aria-expanded", "true"); $("#editH").focus();
};
$("#editCancel").onclick = () => { $("#editRow").classList.add("hidden"); $("#editBtn").setAttribute("aria-expanded", "false"); };
$("#editSave").onclick = () => {
  if (passive || !active) return;
  const ms = (Math.max(0, +$("#editH").value || 0) * 60 + Math.max(0, +$("#editM").value || 0)) * 60000;
  active.addedMs += ms - elapsedMs();
  active.baseMs = ms;
  if (active.runStartedAt) active.runStartedAt = Date.now();
  active.startedAt = Date.now() - ms;
  $("#editCancel").click();
  announce(`Time set to ${fmtHM(ms / 1000)}.`);
  saveActive(true); render();
};

function secondTick() {
  if (!active || !active.runStartedAt || passive) return;
  const now = Date.now();
  engine.updateCounters(live, vision, !!active.breakUntil);

  let st;
  if (active.breakUntil) {
    st = "break";
    if (now >= active.breakUntil) {
      active.breakUntil = 0; active.blockSec = 0; active.blockAlerted = false;
      notify("Break's over", "Time to lock back in.", "soft");
    }
  } else st = engine.classify(live, vision, settings, collabOn());

  // Announce big changes for screen readers, but not more than every 10 seconds.
  if (st !== live.state && (DISTRACTED.includes(st) || DISTRACTED.includes(live.state)) && st !== "down" && now - live.lastAnnounceAt > 10000) {
    live.lastAnnounceAt = now; announce(LABEL[st]);
  }
  const prevState = live.state;
  if (engine.advance(live, st, now)) active.pickups++;
  if (st !== prevState && ["phone", "sleepy", "zoned", "chat"].includes(st)) clipper.moment(st, Math.round(elapsedMs() / 1000));
  if (vision.yawns.length > (live.yawnsSeen || 0)) { clipper.moment("yawn", Math.round(elapsedMs() / 1000)); }
  live.yawnsSeen = vision.yawns.length;
  for (const [k, at] of [["laugh", vision.laughAt], ["surprise", vision.surpriseAt], ["smile", vision.smileAt]]) {
    if (at && at !== live["seen_" + k]) { live["seen_" + k] = at; clipper.moment(k, Math.round(elapsedMs() / 1000)); }
  }
  active.stats[st] = (active.stats[st] || 0) + 1;

  let b = active.tl[active.tl.length - 1];
  if (!b || b.reduce((x, y) => x + y, 0) >= 60) { b = STATES.map(() => 0); active.tl.push(b); }
  b[IDX[st]] = (b[IDX[st]] || 0) + 1;

  if (st === "focused" && collabOn() && vision.talking) active.stats.collab = (active.stats.collab || 0) + 1;
  if (st === "focused") rewards.onFocusedSecond(active.streak + 1, streakInfo().count);
  // Consequences for being distracted: keys drain, and staying on your phone escalates.
  if (settings.drainKeys && rewards.wallet.keys > 0) {
    const every = st === "phone" ? 10 : st === "zoned" || st === "chat" ? 30 : 0;
    const after = st === "phone" ? settings.phoneAlertSec : 0;
    if (every && live.stateSec > after && (live.stateSec - after) % every === 0) { rewards.spend(1, `Distracted: ${LABEL[st]}`); toast("−1 🔑", "spend"); }
  }
  document.body.classList.toggle("escalate", st === "phone" && live.stateSec >= 30);
  if (st === "phone" && live.stateSec >= 30 && live.stateSec % 4 === 0) beep("alarm");
  if (now % 30000 < 1000 && (secondsByDay()[todayKey()] || 0) >= settings.dailyGoalH * 3600) rewards.onDailyGoal(todayKey());
  if (st === "focused") {
    active.streak++; active.blockSec++; active.best = Math.max(active.best, active.streak);
    const g = today()?.goals.find(x => x.id === active.goalId);
    if (g) { g.spentSec = (g.spentSec || 0) + 1; active.worked[g.id] = (active.worked[g.id] || 0) + 1; }
  } else if (["phone", "chat", "sleepy", "zoned"].includes(st)) active.streak = 0;

  // Sounds. Phone: alarm that keeps going. Head down: soft nudge. Eyes closed: wake-up alarm. Zoned out: nudge.
  const s = live.stateSec;
  if (st === "phone" && settings.phoneRepeat && s > settings.phoneAlertSec && (s - settings.phoneAlertSec) % 8 === 0) beep("alarm");
  if (st === "down" && settings.downSound && s >= 4 && (s - 4) % 15 === 0) beep("nudge");
  if (st === "sleepy" && settings.sound && (s === 2 || (s > 2 && s % 10 === 2))) beep("alarm");
  if (st === "zoned" && settings.downSound && (s === 1 || s % 20 === 1)) beep("nudge");

  const alertKind = engine.alertFor(live, st, settings, now);
  if (alertKind) { (active.alerts ||= {})[alertKind] = (active.alerts[alertKind] || 0) + 1; track("state_alert", {kind: alertKind}); }
  if (alertKind === "phone") showAlert(settings.alertText.trim() || "Phone down", `${live.reason || "On your phone"} · ${s}s. Put it away and get back to it.`);
  else if (alertKind === "chat") showAlert("Still chatting?", `${live.reason} for ${Math.round(s / 60) || 1} min. Wrap it up, or mark this as group work.`, "chat");
  else if (alertKind === "sleepy") showAlert("Wake up!", "Your eyes have been closed for a while. Stand up, stretch, or take a real break.", "sleepy");
  // Lots of yawning: suggest a break (at most every 20 minutes).
  if (vision.yawnsWithin(10 * 60000) >= 3 && now - live.lastYawnTip > 20 * 60000 && !active.breakUntil) {
    live.lastYawnTip = now;
    notify("You're yawning a lot", "Your brain might need a 5-minute break. Press B to take one.", "soft");
  }
  // The alert closes itself once you've been back at work for a few seconds.
  if ($("#alert").open && st === "focused" && s >= 3) hideAlert();
  if (settings.pomodoro) {
    if (!active.breakUntil) active.pomoSec = (active.pomoSec || 0) + 1;
    if (active.pomoSec >= 25 * 60 && !active.breakUntil) {
      active.tomatoes = (active.tomatoes || 0) + 1; active.pomoSec = 0;
      const long = active.tomatoes % 4 === 0;
      toggleBreak(long ? 15 : 5);
      rewards.award(10, "Finished a pomodoro 🍅");
      track("pomodoro_complete", {count: active.tomatoes});
      track("break_taken", {paid: false, minutes: long ? 15 : 5, pomodoro: true});
      notify(`🍅 Pomodoro #${active.tomatoes} done!`, long ? "Four in a row. Take a 15-minute break." : "Take a 5-minute break. Focus restarts automatically.", "soft");
    }
  } else if (settings.focusBlockMin > 0 && !active.blockAlerted && active.blockSec >= settings.focusBlockMin * 60) {
    active.blockAlerted = true;
    notify("Time for a break", `${settings.focusBlockMin} focused minutes done. Take ${settings.breakMin}. Press B or hit "Break".`, "soft");
  }
  saveActive();
  if (now % 30000 < 1000) saveGoals();
}

/* ================= alerts ================= */
let audioCtx;
function unlockAudio() { try { audioCtx ||= new AudioContext(); audioCtx.resume(); } catch {} }
// Browsers only allow sound after you interact with the page, so unlock it on the first click or key press.
for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, unlockAudio, {once: true, capture: true});
let customSound = null;
getFile("alertSound").then(b => { if (b) customSound = URL.createObjectURL(b); });
function tone(type, freqs, dur, gainMax, sweep) {
  const t0 = audioCtx.currentTime, g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gainMax * +settings.volume, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); g.connect(audioCtx.destination);
  for (const f of freqs) {
    const o = audioCtx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
    if (sweep) sweep(o.frequency, t0, dur);
    o.connect(g); o.start(t0); o.stop(t0 + dur);
  }
}
const ALARMS = {
  horn: () => tone("sawtooth", [440, 554, 659], 0.7, 0.18),
  siren: () => tone("sine", [700], 1.2, 0.3, (f, t, d) => { f.linearRampToValueAtTime(1300, t + d / 2); f.linearRampToValueAtTime(700, t + d); }),
  bruh: () => tone("sawtooth", [150], 0.6, 0.3, (f, t, d) => f.exponentialRampToValueAtTime(80, t + d)),
  chime: () => { tone("triangle", [880], 0.9, 0.3); setTimeout(() => tone("triangle", [1320], 1, 0.25), 180); },
  custom: () => { if (!customSound) return false; const a = new Audio(customSound); a.volume = Math.min(1, +settings.volume * 1.5); a.play().catch(() => {}); },
};
function beep(kind) {
  if (!settings.sound || !audioCtx || !(+settings.volume > 0)) return;
  if (kind === "alarm" && settings.alertSound !== "classic" && ALARMS[settings.alertSound]) { if (ALARMS[settings.alertSound]() !== false) return; }
  const notes = kind === "alarm" ? [880, 660, 880, 660] : kind === "nudge" ? [523, 392] : [660, 880];
  notes.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + i * 0.17;
    o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * +settings.volume, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.16);
  });
}
function notify(title, body, kind = "soft", speak = true) {
  beep(kind);
  if (speak) announce(`${title}. ${body}`, kind === "alarm");
  if (settings.notify && "Notification" in window && Notification.permission === "granted" && (document.hidden || !document.hasFocus())) {
    try {
      const n = new Notification(title, {body, tag: "lockin", renotify: true, icon: "icon-192.png"});
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }
}
let titleFlashUntil = 0;
let alertKind = "phone";
let alertReturnFocus = null;
function showAlert(title, msg, kind = "phone") {
  alertKind = kind;
  const dlg = $("#alert");
  dlg.dataset.kind = kind;
  $("#alertOk").textContent = kind === "chat" ? "Back to work" : kind === "sleepy" ? "I'm awake" : "I'm back";
  $("#alertWrong").textContent = kind === "chat" ? "We're working together" : kind === "sleepy" ? "Take a break" : "Not my phone";
  $("#alertGlyph").textContent = kind === "chat" ? "💬" : kind === "sleepy" ? "😴" : "📵";
  // The dialog itself is announced when it opens, so skip the extra live-region announcement.
  notify(title, msg, kind === "chat" ? "soft" : "alarm", false);
  titleFlashUntil = Date.now() + 10000;
  $("#alertTitle").textContent = title; $("#alertMsg").textContent = msg;
  if (!dlg.open) {
    alertReturnFocus = document.activeElement;
    document.querySelectorAll("dialog[open]").forEach(d => d !== dlg && d.close());
    dlg.showModal();
  }
  $("#alertOk").focus({preventScroll: true});
}
function hideAlert() {
  const dlg = $("#alert");
  titleFlashUntil = 0;
  if (!dlg.open) return;
  dlg.close();
  if (alertReturnFocus?.isConnected) alertReturnFocus.focus({preventScroll: true});
}
$("#alert").addEventListener("cancel", e => { e.preventDefault(); imBack(); }); // Escape
// Clears every piece of phone evidence and gives you 15 seconds before anything can count again.
function imBack() {
  hideAlert();
  vision.resetPhone(15000); vision.resetTalk();
  live.downSec = 0; live.offSec = 0; live.sideSec = 0; live.deskSec = 0; live.talkSec = 0; live.lastAlertAt = Date.now(); live.reason = "";
  live.offSec = 0; live.focusRun = 2;
  if (DISTRACTED.includes(live.state)) { live.state = "focused"; live.stateSec = 0; }
  render();
}
$("#alertOk").onclick = imBack;

// "Not right? I'm focused": every correction teaches lockedin about you, and the adjustments stick.
const adapt = store.load("adapt", {});
function applyAdapt() { for (const k of ["zoneSec", "sideSec", "awaySec", "sleepySec"]) if (adapt[k]) engine.TUNE[k] = adapt[k]; }
applyAdapt();
function correctMe() {
  const st = live.state;
  if (!DISTRACTED.includes(st) && st !== "away") return;
  const fb = store.load("feedback", {}); fb[st] = (fb[st] || 0) + 1; store.save("feedback", fb);
  let setting = null;
  if (st === "phone" || st === "down") { vision.teachWork(); setting = "teachWork"; }
  if (st === "zoned" && lookingAway()) { adapt.sideSec = engine.TUNE.sideSec = Math.min(20, engine.TUNE.sideSec + 2); setting = "sideSec"; }
  else if (st === "zoned") { adapt.zoneSec = engine.TUNE.zoneSec = Math.min(30, engine.TUNE.zoneSec + 3); setting = "zoneSec"; }
  if (st === "away") { adapt.awaySec = engine.TUNE.awaySec = Math.min(45, engine.TUNE.awaySec + 6); setting = "awaySec"; }
  if (st === "sleepy") { adapt.sleepySec = engine.TUNE.sleepySec = Math.min(12, engine.TUNE.sleepySec + 2); setting = "sleepySec"; }
  if (st === "chat") { settings.chatSec = Math.min(180, settings.chatSec + 15); saveSettings(); setting = "chatSec"; }
  track("not_right_feedback", {state: st, from: "button"}); analytics.feedback(st, setting);
  store.save("adapt", adapt);
  imBack();
  vision.resetPhone(20000);
  announce("Thanks. lockedin learned from that.");
}
$("#wrongBtn").onclick = correctMe;
$("#alertWrong").onclick = () => {
  const wasHeadDown = /^(Head down|Still on your phone)/.test(live.reason || "");
  const fix = alertKind === "chat" ? "collab" : alertKind === "sleepy" ? "break" : "teachWork";
  track("not_right_feedback", {state: alertKind, from: "alert"}); analytics.feedback(alertKind, fix);
  if (alertKind === "chat") { imBack(); setCollab(true); announce("Group work on. Talking counts as focus for this session."); return; }
  if (alertKind === "sleepy") { imBack(); if (active && !active.breakUntil) toggleBreak(); return; }
  // Not my phone: learn that this posture is work, so it won't be flagged again.
  imBack(); vision.teachWork(); vision.resetPhone(20000); announce("Got it. lockedin will count that as work.");
  // Head-down false alarms are almost always writing or reading: offer paper mode (once per visit).
  if (wasHeadDown && !settings.paperMode && !sessionStorage.getItem("paperTipShown")) {
    sessionStorage.setItem("paperTipShown", "1"); $("#paperTip").classList.remove("hidden");
  }
};
$("#paperOn").onclick = () => { settings.paperMode = true; saveSettings(); $("#paperTip").classList.add("hidden"); announce("Paper mode on."); render(); };
$("#paperNo").onclick = () => $("#paperTip").classList.add("hidden");
function setCollab(on) {
  if (active) { active.collab = on; saveActive(true); } else collabNext = on;
  live.talkSec = 0;
  render();
}
$("#collabBtn").onclick = () => setCollab(!collabOn());
function togglePomo() {
  settings.pomodoro = !settings.pomodoro; saveSettings();
  if (active && settings.pomodoro) active.pomoSec = active.pomoSec || 0;
  toast(settings.pomodoro ? "🍅 Pomodoro on: 25 min focus, 5 min break" : "Pomodoro off");
  track("settings_change", {key: "pomodoro"});
  render();
}
$("#pomoBtn").onclick = togglePomo;
$("#pomoBtnRun").onclick = togglePomo;
$("#collabBtnRun").onclick = () => setCollab(!collabOn());

/* ================= tab title & favicon ================= */
let lastIconState = "";
function updateChrome(st) {
  if (active) {
    const flash = settings.titleAlerts && Date.now() < titleFlashUntil && Math.floor(Date.now() / 1000) % 2 === 0;
    document.title = flash ? "📵 Phone down!" : `${fmtClock(elapsedMs())} · ${LABEL[st] || "Focused"} — lockedin`;
  } else document.title = "lockedin";
  if (st === lastIconState) return;
  lastIconState = st;
  if (!COLOR_VAR[st]) { $("#favicon").href = "icon.svg"; return; }
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#111113"; g.beginPath(); g.roundRect(0, 0, 64, 64, 15); g.fill();
  g.strokeStyle = cssVar(COLOR_VAR[st]) || "#30d158"; g.lineWidth = 9; g.lineCap = "round";
  g.beginPath(); g.arc(32, 32, 19, -Math.PI / 2 + 0.5, Math.PI * 1.5 - 0.1); g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(32, 29, 4.5, 0, Math.PI * 2); g.fill(); g.fillRect(30, 30, 4, 9);
  $("#favicon").href = c.toDataURL("image/png");
}

/* ================= pop-out mini timer ================= */
let pipWin = null, pipEls = null;
const pipSupported = "documentPictureInPicture" in window;
$("#pipBtn").hidden = !pipSupported;
async function openPip() {
  if (!pipSupported || passive) return;
  if (pipWin) { pipWin.focus(); return; }
  pipWin = await window.documentPictureInPicture.requestWindow({width: 300, height: 200});
  for (const sheet of document.styleSheets) {
    try {
      const style = pipWin.document.createElement("style");
      style.textContent = [...sheet.cssRules].map(r => r.cssText).join("\n");
      pipWin.document.head.append(style);
    } catch {
      if (sheet.href) { const l = pipWin.document.createElement("link"); l.rel = "stylesheet"; l.href = sheet.href; pipWin.document.head.append(l); }
    }
  }
  pipWin.document.title = "lockedin";
  pipWin.document.body.append($("#pipTpl").content.cloneNode(true));
  pipEls = {};
  pipWin.document.querySelectorAll("[data-pip]").forEach(el => (pipEls[el.dataset.pip] = el));
  pipEls.pause.onclick = togglePause;
  pipEls.break.onclick = () => requestBreak();
  applyTheme();
  pipWin.addEventListener("pagehide", () => { pipWin = null; pipEls = null; });
  render();
}
function closePip() { pipWin?.close(); pipWin = null; pipEls = null; }
$("#pipBtn").onclick = openPip;

/* ================= render: focus ================= */
function stateNow() { return !active ? "idle" : !active.runStartedAt ? "paused" : live.state; }

// "zoned" covers both a still stare ("Zoned out") and being turned sideways ("Looking away"); the reason tells them apart.
function lookingAway() { return /^Looking away/.test(live.reason || ""); }
function render() {
  const has = !!active, running = has && !!active.runStartedAt, st = stateNow();
  $("#preStart").classList.toggle("hidden", has);
  $("#running").classList.toggle("hidden", !has);
  const clock = fmtClock(elapsedMs());
  $("#timer").textContent = clock;
  $("#timer").classList.toggle("paused", !running);
  $("#timer").setAttribute("aria-label", `Session time ${clock}`);
  $("#statePill").className = "state s-" + st;
  $("#stateText").textContent = st === "zoned" && lookingAway() ? "Looking away" : LABEL[st] || "Focused";
  $("#timerSub").textContent = !has ? "Ready when you are"
    : !running ? "Paused. Your time isn't counting."
    : st === "focused" && settings.pomodoro ? `🍅 ×${active.tomatoes || 0} · ${fmtClock(Math.max(0, 1500 - (active.pomoSec || 0)) * 1000).replace(/^0:/, "")} left`
    : st === "phone" ? `${live.reason || "On your phone"} · ${live.stateSec}s`
    : st === "chat" ? `${live.reason} · ${fmtHM(live.stateSec)}`
    : st === "down" ? `${live.reason} · not counted as focus`
    : st === "sleepy" || st === "zoned" ? `${live.reason}`
    : st === "away" ? "Looks like you stepped away"
    : st === "break" ? "Enjoy your break"
    : `Since ${fmtTime(active.startedAt)}${vision.on ? "" : " · camera off"}`;
  if (has) {
    $("#pauseBtn .lbl").textContent = running ? "Pause" : "Resume";
    $("#pauseBtn .cta-ic").innerHTML = running ? ICON_PAUSE : ICON_PLAY;
    $("#pauseBtn").className = "cta" + (running ? " paused-state" : "");
    $("#breakBtn .lbl").textContent = active.breakUntil ? "End break" : "Break";
    $("#breakBtn").classList.toggle("on", !!active.breakUntil);
  }
  for (const m of ["phone", "break", "away", "chat", "sleepy", "zoned"]) document.body.classList.toggle("mood-" + m, st === m);
  $("#wrongBtn").classList.toggle("hidden", !(running && !active.breakUntil && (DISTRACTED.includes(st) || st === "away")));
  $(".dial").className = "dial " + (["phone", "break", "chat", "sleepy", "zoned"].includes(st) ? st : "");

  // focus block ring
  const ring = $("#blockRing");
  let frac = 0;
  if (has && active.breakUntil) frac = 1 - Math.max(0, active.breakUntil - Date.now()) / (settings.breakMin * 60000);
  else if (has && settings.pomodoro) frac = Math.min(1, (active.pomoSec || 0) / 1500);
  else if (has && settings.focusBlockMin > 0) frac = Math.min(1, active.blockSec / (settings.focusBlockMin * 60));
  else if (has) frac = (elapsedMs() / 3600000) % 1;
  ring.style.strokeDashoffset = String(628.32 * (1 - frac));
  $("#breakBanner").classList.toggle("hidden", !active?.breakUntil);
  if (active?.breakUntil) $("#breakLeft").textContent = fmtClock(Math.max(0, active.breakUntil - Date.now())).replace(/^0:/, "");

  // session stats
  const s = active?.stats || {focused: 0, phone: 0, away: 0, break: 0};
  const sc = score(s);
  $("#scoreTxt").textContent = sc == null ? "--" : sc + "%";
  const sr = $("#scoreRing");
  sr.style.setProperty("--p", sc ?? 0);
  sr.style.setProperty("--c", sc == null ? "var(--muted)" : sc >= 80 ? "var(--focused)" : sc >= 60 ? "var(--break)" : "var(--phone)");
  sr.setAttribute("aria-label", sc == null ? "Focus score not available yet" : `Focus score ${sc} percent`);
  $("#stFocused").textContent = fmtHM(s.focused); $("#stPhone").textContent = fmtHM(s.phone);
  $("#stAway").textContent = fmtHM(s.away); $("#stBreak").textContent = fmtHM(s.break);
  $("#stChat").textContent = fmtHM(s.chat || 0);
  for (const id of ["#pomoBtn", "#pomoBtnRun"]) $(id).setAttribute("aria-pressed", String(!!settings.pomodoro));
  for (const id of ["#collabBtn", "#collabBtnRun"]) {
    $(id).setAttribute("aria-pressed", String(collabOn()));
    $(id).querySelector(".lbl").textContent = "Group work";
  }
  $("#pickups").textContent = active?.pickups ?? 0;
  $("#streak").textContent = fmtHM(active?.streak ?? 0);
  $("#best").textContent = fmtHM(active?.best ?? 0);
  $("#placeTag").textContent = active?.place ? `at ${active.place}` : "";
  renderTimeline($("#timeline"), active?.tl || []);

  // camera chips
  const chips = [];
  if (vision.ready) {
    const q = vision.quality;
    if (vision.learning) chips.push(`<span class="chip status">Learning your setup</span>`);
    else if (vision.stalled) chips.push(`<span class="chip status">Reconnecting</span>`);
    else {
      if (q != null && q < 70) chips.push(`<span class="chip status bad" title="Your face is only found ${q}% of the time. Add light or angle the camera at your face.">Tracking ${q}%</span>`);
      chips.push(vision.faceVisible ? `<span class="chip status ok">You're here</span>` : `<span class="chip status bad">No one seen</span>`);
      if (vision.phoneInUse) chips.push(`<span class="chip status bad">Phone in use</span>`);
      else if (vision.phoneVisible) chips.push(`<span class="chip status">Phone nearby</span>`);
      else if (vision.faceVisible && vision.headDownEMA > 0.6 && !settings.paperMode) chips.push(`<span class="chip status bad">Head down ${live.downSec ? live.downSec + "s" : ""}</span>`);
      if (vision.talking && settings.chatDetect) chips.push(`<span class="chip status ${collabOn() ? "ok" : "bad"}">Talking${vision.withOthers ? " · 2+ people" : ""}</span>`);
    }
    if (settings.paperMode) chips.push(`<span class="chip status">Paper mode</span>`);
  } else chips.push(`<span class="chip status">${vision.on ? "Loading" : "Off"}</span>`);
  $("#camChips").innerHTML = chips.join("");
  $("#camWrap").dataset.state = vision.ready ? st : "";
  $("#orbText").textContent = !vision.ready ? "Starting…" : vision.learning ? "Getting to know your setup…"
    : st === "phone" ? "Phone spotted" : st === "down" ? "Head down" : st === "chat" ? "Chatting" : st === "away" ? "Nobody here"
    : st === "sleepy" ? (/desk/.test(live.reason) ? "Head on the desk" : "Eyes closed") : st === "zoned" ? (lookingAway() ? "Looking away" : "Zoned out")
    : live.confidence != null && live.confidence < 60 ? "Hmm, losing focus?"
    : vision.faceVisible ? "You're locked in" : "Looking for you…";

  renderMiniGoals();
  renderRings();
  renderWallet();
  syncClips();
  updateChrome(st);

  if (pipEls) {
    pipEls.timer.textContent = clock;
    pipEls.state.textContent = LABEL[st] || "Focused";
    pipEls.pill.className = "state s-" + st;
    pipEls.goal.textContent = today()?.goals.find(g => g.id === active?.goalId)?.title || "";
    pipEls.pause.textContent = !has ? "Start" : running ? "Pause" : "Resume";
    pipEls.pause.onclick = has ? togglePause : startSession;
    pipEls.break.hidden = !has;
    pipEls.break.textContent = active?.breakUntil ? "End break" : "Break";
    pipWin.document.body.classList.toggle("pip-phone", st === "phone");
  }
}

function setMeter(el, frac) { el.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + "%"; }
function todayFocus() {
  let f = 0, p = 0;
  for (const s of sessions) if (s.date === todayKey()) { f += s.stats.focused || 0; p += lost(s.stats); }
  if (active) { f += active.stats.focused || 0; p += lost(active.stats); }
  return f + p >= 30 ? Math.round(f / (f + p) * 100) : null;
}
let ringSig = "";
function renderRings() {
  const sec = secondsByDay()[todayKey()] || 0, foc = todayFocus(), goals = today()?.goals || [];
  const done = goals.filter(g => g.done).length;
  const sig = [Math.floor(sec / 30), foc, done, goals.length, settings.dailyGoalH].join();
  if (sig === ringSig) return;
  ringSig = sig;
  setMeter($("#rHours"), sec / (settings.dailyGoalH * 3600));
  setMeter($("#rFocus"), (foc ?? 0) / 100);
  setMeter($("#rGoals"), goals.length ? done / goals.length : 0);
  $("#lgHours").textContent = `${(sec / 3600).toFixed(1)}/${settings.dailyGoalH}h`;
  $("#lgFocus").textContent = foc == null ? "--" : foc + "%";
  $("#lgGoals").textContent = `${done}/${goals.length}`;
  $("#ringsSvg").setAttribute("aria-label", `Today: ${fmtHM(sec)} of ${settings.dailyGoalH} hour goal, focus ${foc == null ? "not measured" : foc + " percent"}, ${done} of ${goals.length} goals done`);
  const streak = dayStreak();
  $("#streakNum").textContent = streak;
  $("#streakBadge").classList.toggle("cold", streak === 0);
  const by = secondsByDay(), goal = settings.dailyGoalH * 3600, start = weekStartOf(new Date());
  $("#weekDots").innerHTML = [...Array(7)].map((_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = dayKey(d), v = by[k] || 0, pct = Math.min(100, v / goal * 100);
    const cls = v >= goal ? "hit" : v > 0 ? "part" : "";
    return `<div class="wd ${cls} ${k === todayKey() ? "today" : ""}" title="${fmtDay(d, {weekday: "long"})}: ${fmtHM(v)}"><i style="--p:${pct.toFixed(0)}"></i>${fmtDay(d, {weekday: "narrow"})}</div>`;
  }).join("");
}

function renderTimeline(el, tl) {
  if (!tl.length) { el.innerHTML = `<span class="empty">One bar per minute will appear here</span>`; return; }
  const max = Math.max(1, Math.floor(el.clientWidth / 5) || 90);
  el.innerHTML = tl.slice(-max).map(b => {
    const k = STATES[b.indexOf(Math.max(...b))];
    return `<i class="c-${k}" title="${b[0]}s focused, ${b[1]}s phone, ${b[2]}s away, ${b[3]}s break"></i>`;
  }).join("");
  const t = tl.reduce((a, b) => a.map((v, i) => v + (b[i] || 0)), STATES.map(() => 0));
  el.setAttribute("aria-label", `Session timeline: ${fmtHM(t[0])} focused, ${fmtHM(t[1])} on phone, ${fmtHM(t[2])} away, ${fmtHM(t[3])} on break`);
}

function renderPlaces() {
  const list = placesList();
  $("#placeChips").innerHTML = list.map(p => `<button type="button" class="chip" aria-pressed="${p === place}" data-place="${esc(p)}">${esc(p)}</button>`).join("")
    || `<span class="caption">Add places in Settings</span>`;
}
$("#placeChips").onclick = e => {
  const p = e.target.closest("[data-place]")?.dataset.place;
  if (!p) return;
  place = place === p ? null : p;
  store.save("lastPlace", place);
  renderPlaces();
};

function renderMiniGoals() {
  const g = today();
  $("#goalsCard").classList.toggle("hidden", !GOALS_ENABLED || !g?.goals.length);
  $("#planCta").classList.toggle("hidden", !!g?.goals.length);
  if (!g?.goals.length) {
    $("#curGoal").textContent = "No goals yet for today."; $("#curGoal").classList.add("empty"); $("#miniGoals").innerHTML = ""; $("#miniGoals").dataset.sig = "";
    return;
  }
  const cur = g.goals.find(x => x.id === active?.goalId);
  $("#curGoal").textContent = cur ? cur.title : g.goals.every(x => x.done) ? "Every goal done today. 🎉" : "Pick what you're working on below";
  $("#curGoal").classList.toggle("empty", !cur);
  const sig = JSON.stringify([g.goals.map(x => [x.id, x.done, x.title, Math.floor((x.spentSec || 0) / 60)]), active?.goalId, !!active]);
  if ($("#miniGoals").dataset.sig === sig) return;
  $("#miniGoals").dataset.sig = sig;
  $("#miniGoals").innerHTML = g.goals.map(x => `<li class="${x.done ? "done" : ""} ${x.id === active?.goalId ? "cur" : ""}">
    <input type="checkbox" class="check-circle" data-done="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Mark ${esc(x.title)} done">
    <span class="t">${esc(x.title)}</span>
    ${!x.done && active && x.id !== active.goalId ? `<button class="pill plain sm" data-work="${esc(x.id)}">Start</button>` : `<span class="caption">${fmtHM(x.spentSec || 0)}/${+x.minutes || 0}m</span>`}</li>`).join("");
}

/* ================= goals ================= */
function ensureToday() { return (goalsByDate[todayKey()] ||= {summary: "", tip: "", goals: [], createdAt: Date.now()}); }
function setDone(id, done) {
  if (passive) return;
  const g = today(), x = g?.goals.find(y => y.id === id);
  if (!x) return;
  x.done = done; x.doneAt = done ? Date.now() : null;
  if (done && active?.goalId === id) {
    const next = g.goals.find(y => !y.done);
    active.goalId = next?.id || null;
    saveActive(true);
    notify("Goal done ✓", next ? `Next up: ${next.title}` : "That's every goal for today. Huge.", "soft");
  } else if (done) announce(`${x.title} marked done.`);
  saveGoals(); render(); renderGoals();
}
function workOn(id) {
  if (passive) return;
  if (!active) startSession();
  if (!active) return;
  active.goalId = id; saveActive(true); render(); renderGoals();
  announce(`Now working on ${today()?.goals.find(x => x.id === id)?.title || "goal"}.`);
}
function moveGoal(id, dir) {
  const list = today()?.goals; if (!list) return;
  const i = list.findIndex(x => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveGoals(); renderGoals(); render();
  document.querySelector(`[data-move="${id}"][data-dir="${dir}"]`)?.focus();
}
document.addEventListener("change", e => { if (e.target.dataset.done) setDone(e.target.dataset.done, e.target.checked); });
document.addEventListener("click", e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.work) workOn(t.dataset.work);
  if (t.dataset.move) moveGoal(t.dataset.move, +t.dataset.dir);
  if (t.dataset.delgoal && confirm("Remove this goal?")) {
    today().goals = today().goals.filter(x => x.id !== t.dataset.delgoal);
    if (active?.goalId === t.dataset.delgoal) active.goalId = null;
    saveGoals(); renderGoals(); render();
  }
  if (t.dataset.delsession && confirm("Delete this session? This can't be undone.")) {
    sessions = sessions.filter(s => s.id !== t.dataset.delsession); saveSessions(); renderHistory(); render();
  }
  if (t.hasAttribute("data-close")) t.closest("dialog")?.close();
});

$("#addGoalForm").onsubmit = e => {
  e.preventDefault();
  const title = $("#newGoal").value.trim();
  if (!title) { $("#newGoal").focus(); return; }
  ensureToday().goals.push({id: uid(), title, area: "", minutes: Math.max(5, +$("#newGoalMin").value || 30), why: "", stretch: false, done: false, spentSec: 0});
  $("#newGoal").value = "";
  if (active && !active.goalId) active.goalId = today().goals.find(x => !x.done)?.id || null;
  saveGoals(); renderGoals(); render();
  announce(`Added ${title}.`);
};

function lastUnfinished() {
  const days = Object.keys(goalsByDate).filter(d => d < todayKey()).sort().reverse();
  for (const d of days) {
    const left = goalsByDate[d].goals.filter(x => !x.done);
    if (goalsByDate[d].goals.length) return {day: d, left};
  }
  return null;
}
$("#carryBtn").onclick = () => {
  const prev = lastUnfinished(); if (!prev) return;
  const g = ensureToday(), have = new Set(g.goals.map(x => x.title));
  prev.left.filter(x => !have.has(x.title)).forEach(x => g.goals.push({...x, id: uid(), done: false, doneAt: null, spentSec: 0, why: x.why || "Carried over"}));
  saveGoals(); renderGoals(); render();
};

function renderGoals() {
  const focused = document.activeElement, keep = focused?.closest?.("#goalList") ? [...focused.attributes].find(a => /^data-(done|work|move|delgoal)$/.test(a.name)) : null;
  renderGoalsInner();
  if (keep) {
    const again = document.querySelector(`#goalList [${keep.name}="${CSS.escape(keep.value)}"]`) || $("#newGoal");
    again?.focus({preventScroll: true});
  }
}
function renderGoalsInner() {
  $("#goalsDate").textContent = fmtDay(new Date(), {weekday: "long", month: "long", day: "numeric"});
  $("#aiCard").classList.toggle("hidden", !aiAvailable);
  if (!$("#planHours").value) {
    const left = settings.dailyGoalH - (secondsByDay()[todayKey()] || 0) / 3600;
    $("#planHours").value = Math.max(1, Math.round(left * 2) / 2);
  }
  const g = today(), goals = g?.goals || [];
  $("#planBtn").textContent = goals.length ? "Re-plan my day" : "Plan my day";
  const prev = lastUnfinished();
  const have = new Set(goals.map(x => x.title));
  const carry = prev ? prev.left.filter(x => !have.has(x.title)) : [];
  $("#carryBtn").classList.toggle("hidden", !carry.length);
  if (carry.length) $("#carryBtn").textContent = `Bring over ${carry.length} unfinished goal${carry.length > 1 ? "s" : ""} from ${fmtDay(parseDay(prev.day), {weekday: "long"})}`;

  const planned = goals.reduce((a, x) => a + (+x.minutes || 0), 0);
  $("#goalProg").textContent = goals.length ? `${goals.filter(x => x.done).length} of ${goals.length} done · ${fmtHM(goals.reduce((a, x) => a + (x.spentSec || 0), 0))} of ${fmtHM(planned * 60)}` : "";
  $("#planSummary").innerHTML = (g?.summary ? `<p class="plan-summary">${esc(g.summary)}</p>` : "")
    + (g?.tip ? `<p class="plan-tip">${esc(g.tip)}</p>` : "")
    + (!goals.length ? `<p class="secondary">${aiAvailable ? "Describe your day above, or add goals yourself below." : "Add what you want to finish today. lockedin tracks how long each one takes."}</p>` : "");
  $("#goalList").innerHTML = goals.map((x, i) => {
    const pct = Math.min(100, (x.spentSec || 0) / 60 / Math.max(1, x.minutes) * 100);
    const cur = x.id === active?.goalId;
    return `<li class="${x.done ? "done" : ""} ${cur ? "cur" : ""}">
      <input type="checkbox" class="check-circle" data-done="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Mark ${esc(x.title)} done">
      <div>
        <div class="gt">${esc(x.title)}</div>
        ${x.why ? `<div class="gw">${esc(x.why)}</div>` : ""}
        <div class="gm">
          ${x.area ? `<span class="tag">${esc(x.area)}</span>` : ""}${x.stretch ? `<span class="tag stretch">Stretch</span>` : ""}
          <span class="gbar" aria-hidden="true"><i style="width:${pct}%"></i></span>
          <span>${fmtHM(x.spentSec || 0)} of ${+x.minutes || 0}m</span>
          ${cur ? `<span class="working">Working on this</span>` : ""}
        </div>
      </div>
      <div class="ga">
        ${!x.done && !cur ? `<button class="pill tinted sm" data-work="${esc(x.id)}">Start</button>` : ""}
        <button class="icon-act" data-move="${esc(x.id)}" data-dir="-1" aria-label="Move ${esc(x.title)} up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-act" data-move="${esc(x.id)}" data-dir="1" aria-label="Move ${esc(x.title)} down" ${i === goals.length - 1 ? "disabled" : ""}>↓</button>
        <button class="icon-act danger" data-delgoal="${esc(x.id)}" aria-label="Remove ${esc(x.title)}">✕</button>
      </div></li>`;
  }).join("");
}

function historySummary(days = 14) {
  const cutoff = Date.now() - days * 86400000, by = {};
  for (const s of sessions.filter(x => x.start > cutoff)) {
    const d = (by[s.date] ||= {sec: 0, f: 0, p: 0}); d.sec += s.seconds; d.f += s.stats.focused || 0; d.p += lost(s.stats);
  }
  return Object.entries(by).sort().map(([date, d]) => {
    const g = goalsByDate[date];
    return {date, hours: +(d.sec / 3600).toFixed(1), focus: d.f + d.p ? Math.round(d.f / (d.f + d.p) * 100) : null,
      goalsDone: g ? g.goals.filter(x => x.done).length : null, goalsPlanned: g ? g.goals.length : null};
  });
}

$("#planBtn").onclick = async () => {
  const plate = $("#plate").value.trim();
  if (plate.length < 5) { $("#planMsg").innerHTML = `<div class="notice err">Write a sentence or two about what you need to get done.</div>`; $("#plate").focus(); return; }
  const g = today();
  if (g?.goals.some(x => !x.done) && !confirm("Re-planning replaces today's unfinished goals. Finished ones stay. Continue?")) return;
  const btn = $("#planBtn"); btn.disabled = true; $("#planMsg").innerHTML = "";
  $("#planStatus").innerHTML = `<span class="spin" aria-hidden="true"></span>Planning your day...`;
  try {
    const r = await fetch("/api/plan", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
      plate, hours: +$("#planHours").value || 2,
      localTime: new Date().toLocaleString([], {weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit"}),
      loggedToday: fmtHM(secondsByDay()[todayKey()] || 0),
      history: historySummary(),
      carryover: (lastUnfinished()?.left || []).map(x => x.title).slice(0, 10),
    })});
    const res = await r.json().catch(() => ({error: "The planner sent back something unexpected."}));
    if (!r.ok || res.error) throw new Error(res.error || `Planner error (${r.status})`);
    const kept = (g?.goals || []).filter(x => x.done);
    goalsByDate[todayKey()] = {summary: res.summary || "", tip: res.tip || "", createdAt: Date.now(),
      goals: kept.concat(res.goals.map(x => ({id: uid(), title: String(x.title).slice(0, 140), area: String(x.area || "").slice(0, 40),
        minutes: Math.max(5, Math.min(600, Math.round(+x.minutes || 30))), why: String(x.why || "").slice(0, 200), stretch: !!x.stretch, done: false, spentSec: 0})))};
    if (active) { active.goalId = today().goals.find(x => !x.done)?.id || null; saveActive(true); }
    saveGoals(); renderGoals(); render();
    announce(`Plan ready with ${res.goals.length} goals.`);
  } catch (err) {
    $("#planMsg").innerHTML = `<div class="notice err">${esc(err.message || "Couldn't reach the planner.")}</div>`;
  } finally {
    btn.disabled = false; $("#planStatus").textContent = "";
  }
};

/* ================= insights ================= */
let wkOffset = 0;
$("#wkPrev").onclick = () => { wkOffset--; renderInsights(); };
$("#wkNext").onclick = () => { if (wkOffset < 0) { wkOffset++; renderInsights(); } };

function weekStats(offset) {
  const start = weekStartOf(new Date(), offset);
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return dayKey(d); });
  const ss = sessions.filter(s => days.includes(s.date));
  const sum = k => ss.reduce((a, s) => a + (s.stats[k] || 0), 0);
  const f = sum("focused"), p = sum("phone") + sum("chat") + sum("down"), tracked = f + p + sum("away") + sum("break");
  const pickups = ss.reduce((a, s) => a + s.pickups, 0);
  const goals = days.flatMap(d => goalsByDate[d]?.goals || []);
  return {start, days, ss, sec: ss.reduce((a, s) => a + s.seconds, 0), focus: f + p >= 60 ? Math.round(f / (f + p) * 100) : null,
    pickups, perHour: tracked >= 600 ? pickups / (tracked / 3600) : null, phoneSec: p,
    goalsDone: goals.filter(g => g.done).length, goalsTotal: goals.length, daysIn: new Set(ss.map(s => s.date)).size,
    best: ss.reduce((a, s) => Math.max(a, s.best || 0), 0)};
}
function delta(cur, prev, unit, goodUp = true, digits = 1) {
  if (cur == null || prev == null) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return `<span class="delta flat">Same as last week</span>`;
  const good = goodUp ? d > 0 : d < 0;
  return `<span class="delta ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(digits)}${unit} vs last week</span>`;
}
function hourFocus(ss) {
  const hrs = {};
  for (const s of ss) (s.tl || []).forEach((b, i) => {
    const h = new Date((s.analyzedStart || s.start) + i * 60000).getHours();
    const x = (hrs[h] ||= {f: 0, p: 0}); x.f += b[0]; x.p += b[1];
  });
  return hrs;
}
function localCoach(w, prev) {
  if (!w.ss.length) return "No sessions this week yet. Start one and this fills in.";
  const lines = [];
  const goalH = settings.weeklyGoalH;
  lines.push(w.sec / 3600 >= goalH ? `You hit your ${goalH}h goal with ${fmtH(w.sec)}. 🎯` : `You're at ${fmtH(w.sec)} of your ${goalH}h goal.`);
  if (w.focus != null) lines.push(w.focus >= 85 ? `Focus was excellent at ${w.focus}%.` : w.focus >= 70 ? `Focus was decent at ${w.focus}%.` : `Focus was ${w.focus}%, so the phone took a real bite.`);
  if (w.perHour != null && w.perHour > 2) lines.push(`You picked up your phone about ${w.perHour.toFixed(1)} times an hour. Try leaving it out of reach.`);
  if (prev.ss.length && w.sec > prev.sec) lines.push(`That's ${fmtH(w.sec - prev.sec)} more than last week.`);
  if (w.goalsTotal) lines.push(`You finished ${w.goalsDone} of ${w.goalsTotal} goals.`);
  return lines.join(" ");
}
function renderInsights() {
  const w = weekStats(wkOffset), prev = weekStats(wkOffset - 1), hasPrev = prev.ss.length > 0;
  const end = new Date(w.start); end.setDate(end.getDate() + 6);
  $("#wkTitle").textContent = (wkOffset === 0 ? "This week · " : wkOffset === -1 ? "Last week · " : "") + `${fmtDay(w.start, {month: "short", day: "numeric"})} – ${fmtDay(end, {month: "short", day: "numeric"})}`;
  $("#wkNext").disabled = wkOffset >= 0;
  $("#wkKpis").innerHTML = `
    <div class="kpi"><span class="k-label" style="color:#ff375f">Hours</span><b>${(w.sec / 3600).toFixed(1)}<small> / ${settings.weeklyGoalH}h</small></b>${hasPrev ? delta(w.sec / 3600, prev.sec / 3600, "h") : ""}</div>
    <div class="kpi"><span class="k-label" style="color:var(--green)">Focus</span><b>${w.focus ?? "--"}${w.focus != null ? "<small>%</small>" : ""}</b>${hasPrev ? delta(w.focus, prev.focus, " pts", true, 0) : ""}</div>
    <div class="kpi"><span class="k-label" style="color:var(--red)">Pickups / hr</span><b>${w.perHour != null ? w.perHour.toFixed(1) : "--"}</b>${hasPrev ? delta(w.perHour, prev.perHour, "", false) : `<span class="sub">${w.pickups} total</span>`}</div>
    <div class="kpi"><span class="k-label" style="color:#5ac8fa">Goals</span><b>${w.goalsTotal ? `${w.goalsDone}<small> / ${w.goalsTotal}</small>` : "--"}</b><span class="sub">${w.daysIn} day${w.daysIn === 1 ? "" : "s"} tracked</span></div>`;

  // days
  const per = w.days.map(d => {
    const ss = w.ss.filter(s => s.date === d), sec = ss.reduce((a, s) => a + s.seconds, 0);
    const f = ss.reduce((a, s) => a + (s.stats.focused || 0), 0), p = ss.reduce((a, s) => a + lost(s.stats), 0);
    return {d, sec, sc: f + p >= 60 ? Math.round(f / (f + p) * 100) : null};
  });
  const max = Math.max(settings.dailyGoalH * 3600, ...per.map(x => x.sec), 1);
  $("#wkDays").innerHTML = per.map(x => `
    <div class="day ${x.d === todayKey() ? "today" : ""}" role="img" aria-label="${fmtDay(parseDay(x.d), {weekday: "long"})}: ${fmtHM(x.sec)}${x.sc != null ? `, focus ${x.sc}%` : ""}">
      <span class="val">${x.sec ? fmtH(x.sec) : ""}</span>
      <div class="bar" style="height:${Math.max(2, x.sec / max * 75)}%;${x.sc != null ? `background:${x.sc >= 80 ? "var(--green)" : x.sc >= 60 ? "var(--orange)" : "var(--red)"}` : x.sec ? "background:var(--tint)" : ""}"></div>
      <span class="lbl">${fmtDay(parseDay(x.d), {weekday: "short"})}</span><span>${x.sc != null ? x.sc + "%" : ""}</span>
    </div>`).join("");

  // hours of day
  const hrs = hourFocus(w.ss);
  let bestH = null;
  $("#wkHours").innerHTML = [...Array(18)].map((_, i) => {
    const h = i + 6, x = hrs[h], pct = x && x.f + x.p >= 300 ? Math.round(x.f / (x.f + x.p) * 100) : null;
    if (pct != null && (!bestH || pct > bestH.pct)) bestH = {h, pct};
    const label = new Date(2000, 0, 1, h).toLocaleTimeString([], {hour: "numeric"}).replace(/\s?([AP])M/i, (_, a) => a.toLowerCase());
    return `<div class="${pct != null ? "has" : ""}" title="${pct != null ? pct + "% focused" : "Not enough data"}" style="${pct != null ? `background:color-mix(in srgb, var(--focused) ${pct}%, var(--phone))` : ""}">${label}</div>`;
  }).join("");
  $("#wkHoursTxt").textContent = bestH
    ? `Your most focused hour is around ${new Date(2000, 0, 1, bestH.h).toLocaleTimeString([], {hour: "numeric"})} (${bestH.pct}%). Save your hardest work for then.`
    : "Track a few sessions with the camera on to see your best hours.";

  // places
  const pl = {};
  for (const s of w.ss) { const k = s.place || "Unlabeled"; const x = (pl[k] ||= {sec: 0, f: 0, p: 0}); x.sec += s.seconds; x.f += s.stats.focused || 0; x.p += lost(s.stats); }
  const plRows = Object.entries(pl).sort((a, b) => b[1].sec - a[1].sec);
  $("#wkPlaces").innerHTML = plRows.map(([k, x]) => `<li><span>${esc(k)}</span><span>${fmtH(x.sec)}${x.f + x.p >= 60 ? ` · <b>${Math.round(x.f / (x.f + x.p) * 100)}%</b> focus` : ""}</span></li>`).join("")
    || `<li class="secondary">Pick a place before you start to compare spots.</li>`;

  // goals
  $("#wkGoals").innerHTML = w.days.filter(d => goalsByDate[d]?.goals.length).map(d => {
    const gs = goalsByDate[d].goals;
    return `<div class="wk-day"><b>${fmtDay(parseDay(d), {weekday: "long", month: "short", day: "numeric"})}</b> <span class="caption">${gs.filter(x => x.done).length} of ${gs.length} done</span>
      <ul>${gs.map(x => `<li class="${x.done ? "done" : ""}">${esc(x.title)}</li>`).join("")}</ul></div>`;
  }).join("") || `<p class="secondary">No goals planned this week.</p>`;

  // coach
  const notes = store.load("coachNotes", {});
  const key = dayKey(w.start);
  $("#coachNote").textContent = notes[key] || localCoach(w, prev);
  $("#coachBtn").classList.toggle("hidden", !aiAvailable || !w.ss.length);
  $("#coachBtn").onclick = async () => {
    const btn = $("#coachBtn"); btn.disabled = true;
    $("#coachNote").innerHTML = `<span class="spin" aria-hidden="true"></span>Reviewing your week...`;
    try {
      const r = await fetch("/api/coach", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
        week: $("#wkTitle").textContent, hours: +(w.sec / 3600).toFixed(1), weeklyGoal: settings.weeklyGoalH, focusScore: w.focus,
        pickups: w.pickups, pickupsPerHour: w.perHour != null ? +w.perHour.toFixed(1) : null, phoneMinutes: Math.round(w.phoneSec / 60),
        goalsDone: w.goalsDone, goalsTotal: w.goalsTotal, daysTracked: w.daysIn, bestHour: bestH, places: plRows.slice(0, 5).map(([k, x]) => ({place: k, hours: +(x.sec / 3600).toFixed(1)})),
        lastWeek: hasPrev ? {hours: +(prev.sec / 3600).toFixed(1), focusScore: prev.focus, pickupsPerHour: prev.perHour != null ? +prev.perHour.toFixed(1) : null} : null,
        unfinished: w.days.flatMap(d => (goalsByDate[d]?.goals || []).filter(x => !x.done).map(x => x.title)).slice(0, 10),
      })});
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error || !res.note) throw new Error(res.error || "Couldn't get a review right now.");
      notes[key] = res.note; store.save("coachNotes", notes);
      $("#coachNote").textContent = res.note;
    } catch (err) {
      $("#coachNote").textContent = err.message;
    } finally { btn.disabled = false; }
  };
}
function markReportSeen() { store.save("reportSeen", dayKey(weekStartOf(new Date()))); $("#insightsBadge").classList.add("hidden"); }

/* ================= history ================= */
// Snapchat-style streak: days in a row with at least 25 minutes locked in (streak freezes cover a missed day).
let streakCache = {at: 0, v: {count: 0}};
function streakInfo() {
  if (Date.now() - streakCache.at > 20000) streakCache = {at: Date.now(), v: rewards.streak(secondsByDay())};
  return streakCache.v;
}
function dayStreak() { return streakInfo().count; }
function renderHistory() {
  const total = sessions.reduce((a, s) => a + s.seconds, 0);
  const f = sessions.reduce((a, s) => a + (s.stats.focused || 0), 0), p = sessions.reduce((a, s) => a + lost(s.stats), 0);
  const streak = dayStreak();
  $("#allKpis").innerHTML = `
    <div class="kpi"><span class="k-label" style="color:#ff375f">Total</span><b>${(total / 3600).toFixed(1)}<small>h</small></b><span class="sub">locked in</span></div>
    <div class="kpi"><span class="k-label" style="color:var(--tint)">Sessions</span><b>${sessions.length}</b><span class="sub">all time</span></div>
    <div class="kpi"><span class="k-label" style="color:var(--green)">Focus</span><b>${f + p >= 60 ? Math.round(f / (f + p) * 100) + "<small>%</small>" : "--"}</b><span class="sub">all time</span></div>
    <div class="kpi"><span class="k-label" style="color:var(--orange)">Streak</span><b>${streak}<small> day${streak === 1 ? "" : "s"}</small></b><span class="sub">hitting ${settings.dailyGoalH}h</span></div>`;
  const rows = [...sessions].sort((a, b) => b.start - a.start).slice(0, 200);
  $("#historyBody").innerHTML = rows.map(s => `<li>
      <div class="s-main"><b>${fmtHM(s.seconds)}${s.place ? ` · ${esc(s.place)}` : ""}</b>
        <span>${fmtDay(new Date(s.start))}, ${fmtTime(s.start)}${(s.worked || []).length ? " · " + s.worked.slice(0, 2).map(w => esc(w.title)).join(", ") : ""}</span></div>
      <div class="s-score">${s.score != null ? s.score + "%" : "--"}<small>${s.pickups} pickup${s.pickups === 1 ? "" : "s"}</small></div>
      <button class="icon-act danger" data-delsession="${esc(s.id)}" aria-label="Delete session from ${fmtDay(new Date(s.start))}">✕</button></li>`).join("")
    || `<li class="empty-row">No sessions yet. Finished sessions show up here.</li>`;
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#csvBtn").onclick = () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["date", "start", "end", "hours", "place", "focus_score", "focused_min", "phone_min", "away_min", "break_min", "chatting_min", "head_down_min", "eyes_closed_min", "zoned_out_min", "phone_pickups", "best_streak_min", "worked_on"];
  const lines = [...sessions].sort((a, b) => a.start - b.start).map(s => [s.date, q(fmtTime(s.start)), q(fmtTime(s.end)), (s.seconds / 3600).toFixed(2), q(s.place),
    s.score ?? "", ...STATES.map(k => Math.round((s.stats[k] || 0) / 60)), s.pickups, Math.round((s.best || 0) / 60), q((s.worked || []).map(w => w.title).join("; "))].join(","));
  download("lock-in-sessions.csv", [head.join(","), ...lines].join("\n"), "text/csv");
};
$("#backupBtn").onclick = () => { saveActive(true); saveGoals(); download(`lock-in-backup-${todayKey()}.json`, JSON.stringify(store.exportAll()), "application/json"); };
$("#restoreInput").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const obj = JSON.parse(await file.text());
    if (!confirm("Restoring replaces everything currently in this browser with the backup. Continue?")) return;
    store.importAll(obj);
    location.reload();
  } catch (err) { alert(err.message || "That file couldn't be read."); }
};

/* ================= settings ================= */
const SETTING_IDS = ["dailyGoalH", "weeklyGoalH", "weekStart", "focusBlockMin", "breakMin", "phoneAlertSec", "downSec", "sensitivity",
  "paperMode", "autoCamera", "chatDetect", "collabDefault", "chatSec", "downSound", "phoneRepeat", "drainKeys", "alertSound", "alertText", "sound", "volume", "notify", "titleAlerts", "theme", "places", "shortcuts"];
function fillSettings() {
  for (const k of SETTING_IDS) {
    const el = $("#s_" + k);
    if (el.type === "checkbox") el.checked = !!settings[k]; else el.value = settings[k];
  }
}
$("#settingsBtn").onclick = () => { fillSettings(); $("#settingsDlg").showModal(); };
$("#settingsForm").onsubmit = () => {
  const before = {...settings};
  const clamp = (v, lo, hi, d) => Number.isFinite(+v) && v !== "" ? Math.min(hi, Math.max(lo, +v)) : d;
  for (const k of SETTING_IDS) {
    const el = $("#s_" + k);
    settings[k] = el.type === "checkbox" ? el.checked : (el.type === "number" || el.type === "range") ? +el.value : el.value;
  }
  settings.dailyGoalH = clamp(settings.dailyGoalH, 0.5, 16, 3);
  settings.weeklyGoalH = clamp(settings.weeklyGoalH, 1, 100, 15);
  settings.weekStart = +settings.weekStart;
  settings.focusBlockMin = clamp(settings.focusBlockMin, 0, 240, 50);
  settings.breakMin = clamp(settings.breakMin, 1, 60, 10);
  settings.phoneAlertSec = clamp(settings.phoneAlertSec, 3, 300, 5);
  settings.downSec = clamp(settings.downSec, 2, 60, 12);
  settings.chatSec = clamp(settings.chatSec, 5, 300, 20);
  if (!active) collabNext = settings.collabDefault;
  settings.sensitivity = clamp(settings.sensitivity, 0.5, 2, 1);
  saveSettings(); applyTheme(); renderPlaces(); renderAll();
  for (const k of SETTING_IDS) if (before[k] !== settings[k]) track("settings_change", {key: k});
  if (settings.notify && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  announce("Settings saved.");
};
$("#forgetBtn").onclick = () => {
  vision.forget(); store.save("learn", null);
  announce("lockedin will re-learn your setup over the next few seconds.");
  $("#forgetBtn").textContent = "Re-learning…"; setTimeout(() => ($("#forgetBtn").textContent = "Re-learn my setup"), 3000);
};
$("#wipeBtn").onclick = () => {
  if (!confirm("Delete ALL your lockedin data in this browser? Sessions, goals and settings will be gone. Download a backup first if you want to keep them. (If you're signed in, your account keeps its copy. Delete the account in Account to erase that too.)")) return;
  if (vision.on) vision.stop();
  store.clearAll(); try { indexedDB.deleteDatabase("lockedin"); } catch {}
  location.hash = ""; location.reload();
};

/* ================= onboarding & help ================= */
function showStep(n) { $$("#onboardDlg .ob-step").forEach(s => s.classList.toggle("hidden", +s.dataset.step !== n)); $(`#onboardDlg [data-step="${n}"] h2`).focus?.(); }
let obStep = 0;
$("#onboardDlg").addEventListener("click", e => {
  if (e.target.matches("[data-next]")) showStep(++obStep);
  if (e.target.matches("[data-back]")) showStep(--obStep);
});
$("#obDone").onclick = () => {
  store.save("onboarded", true);
  $("#onboardDlg").close(); renderAll();
  if (!maybePromptAccount()) { maybeAskConsent(); $("#startBtn").focus(); }
};
function openOnboarding() {
  obStep = 0; showStep(0);
  $("#onboardDlg").showModal();
}
$("#onboardDlg").addEventListener("cancel", () => store.save("onboarded", true));
$("#onboardDlg").addEventListener("close", () => maybeAskConsent());
$("#helpBtn").onclick = () => $("#helpDlg").showModal();
$("#replayOnboard").onclick = () => { $("#helpDlg").close(); openOnboarding(); };

/* ================= camera wiring ================= */
vision.addEventListener("status", ({detail: d}) => {
  if (d.kind === "camera") track("camera_permission", {result: d.result, reason: d.reason || ""});
  else if (d.ok) track("model_loaded", {backend: d.backend, ms: d.ms});
  else track("model_failed", {reason: d.reason || ""});
});
vision.addEventListener("message", e => { const m = $("#camMsg"); m.textContent = e.detail; m.classList.toggle("hidden", !e.detail); });
// Learning happens in the background; save it now and then so the next visit starts warm.
vision.addEventListener("learned", () => store.save("learn", vision.saved));
window.addEventListener("pagehide", () => vision.workBuf.length && store.save("learn", vision.saved));

vision.addEventListener("change", () => {
  $("#camOff").classList.toggle("hidden", vision.on);
  $("#camBtn").textContent = vision.on ? "Turn off camera" : "Turn on camera";
  $("#camBtn").className = "pill sm " + (vision.on ? "tinted" : "filled");
  render();
});
$("#camBtn").onclick = () => { unlockAudio(); vision.on ? vision.stop() : vision.start(); };
// The camera preview is off by default (nobody wants to stare at themselves); the choice is remembered.
function applyPreview() {
  $("#camWrap").classList.toggle("no-preview", !settings.showPreview);
  $("#previewBtn").textContent = settings.showPreview ? "Hide preview" : "Show preview";
  $("#previewBtn").removeAttribute("aria-pressed");
}
applyPreview();
$("#previewBtn").onclick = () => {
  settings.showPreview = !settings.showPreview; saveSettings(); applyPreview();
  track("settings_change", {key: "showPreview"});
};

/* ================= keyboard ================= */
document.addEventListener("keydown", e => {
  if (e.repeat || passive || !settings.shortcuts || e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  if (e.key === " " && active && !e.target.closest?.("button, a, summary, input, label")) { e.preventDefault(); togglePause(); }
  else if (k === "b") requestBreak();
  else if (k === "p") openPip();
  else if (k === "c") { unlockAudio(); vision.on ? vision.stop() : vision.start(); }
  else if (e.key === "?") $("#helpDlg").showModal();
  else if (/^[1-9]$/.test(e.key) && VIEWS[+e.key - 1]) location.hash = VIEWS[+e.key - 1];
});

/* ================= main loop ================= */
function renderAll() {
  render();
  const v = currentView();
  if (v === "goals") renderGoals();
  if (v === "insights") renderInsights();
  if (v === "history") renderHistory();
}
// Worker timers keep firing when the tab is in the background; page timers get throttled.
const ticker = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 250)"], {type: "text/javascript"})));
ticker.onmessage = () => {
  if (passive) return;
  if (vision.stalled) vision.recover();
  vision.tick();
  const now = Date.now();
  if (now - live.lastSec >= 1000) {
    const n = Math.floor((now - live.lastSec) / 1000);
    if (n > 10) live.lastSec = now; // computer slept: the timer catches up from timestamps, analysis skips the gap
    else { live.lastSec += n * 1000; for (let i = 0; i < n; i++) secondTick(); }
    render();
    if (!document.hidden && currentView() === "goals" && active?.goalId && now % 15000 < 1000 && !document.activeElement?.closest?.("#goalList, #addGoalForm")) renderGoals();
  }
};

/* ================= account, sync, analytics choice ================= */
// Accounts are optional and load lazily. If the Supabase library can't be reached, the app just stays local.
let cloud = null, cloudLoading = null;
const hadAccount = () => { try { return !!localStorage.getItem("lockedin.auth"); } catch { return false; } };

// Another device's progress arrived: re-read everything the app keeps in memory.
function reloadFromStore() {
  if (passive) return;
  settings = {...DEFAULTS, ...store.load("settings", {})};
  sessions = store.load("sessions", []);
  goalsByDate = store.load("goals", {});
  place = store.load("lastPlace", place);
  Object.assign(adapt, store.load("adapt", {})); applyAdapt();
  if (!active) collabNext = settings.collabDefault;
  streakCache.at = 0;
  applyTheme(); applyPreview(); applyWallpaper(); renderPlaces(); renderAll();
}

function startCloud() {
  return cloudLoading ||= import("./cloud.js").then(m => {
    cloud = m;
    let lastUser = null;
    cloud.init({
      onUser(u, event, via) {
        const id = u?.id || null;
        // Google sign-ins come back through a redirect, so they're counted here instead of at the button.
        if (id && id !== lastUser && via === "google") track(Date.now() - Date.parse(u.created_at) < 120000 ? "signup" : "login", {method: "google"});
        lastUser = id;
        renderAccount();
        // Signed up from the welcome prompt: get out of the way so they can lock in.
        if (id && $("#accountDlg").open && !$("#acctLater").classList.contains("hidden")) { $("#accountDlg").close(); toast("You're in! Your progress now saves to your account ✨"); }
      },
      onStatus: renderSync,
      onRemote: reloadFromStore,
    });
    renderAccount();
  }).catch(err => { console.warn("Accounts unavailable", err); cloudLoading = null; });
}
async function ensureCloud() {
  await startCloud();
  if (!cloud) throw new Error("Accounts can't load right now. Check your connection and try again.");
  return cloud;
}

const note = (sel, text, ok = false) => { $(sel).innerHTML = text ? `<div class="notice ${ok ? "" : "err"}">${esc(text)}</div>` : ""; };
function renderAccount() {
  const u = cloud?.user || null, p = cloud?.profile;
  $("#acctOut").classList.toggle("hidden", !!u);
  $("#acctIn").classList.toggle("hidden", !u);
  $("#acctDot").classList.toggle("hidden", !u);
  $("#accountBtn").setAttribute("aria-label", u ? "Account: signed in" : "Account and sync");
  $("#settingsAcct").textContent = u ? "Manage" : "Sign in";
  $("#googleWrap").hidden = !GOOGLE_AUTH_ENABLED;
  const on = analytics.consent() === "granted";
  $("#analyticsToggle").checked = on; $("#s_analytics").checked = on;
  if (!u) return;
  $("#meName").textContent = p?.display_name || "You";
  $("#meEmail").textContent = u.email || "";
  $("#meAvatar").textContent = p?.avatar || "🔒";
  if (document.activeElement !== $("#meNameInput")) $("#meNameInput").value = p?.display_name || "";
  $("#meAvatarSel").value = p?.avatar || "🔒";
  renderSync();
}
function renderSync() {
  const s = cloud?.syncStatus();
  if (!s || !cloud?.user) return;
  const last = s.lastSync ? fmtTime(s.lastSync) : "";
  $("#syncLine").dataset.state = s.state;
  $("#syncLine").textContent = s.state === "syncing" ? "Syncing…"
    : s.state === "offline" ? `Offline. Your progress will sync when you're back online.${last ? ` Last synced ${last}.` : ""}`
    : s.state === "error" ? "Couldn't sync just now. lockedin will try again soon."
    : last ? `Synced ✓ ${last}` : "";
}
function openAccount(prompted = false) {
  if ($("#settingsDlg").open) $("#settingsDlg").close();
  note("#authMsg", ""); note("#acctMsg", "");
  renderAccount();
  $("#acctLater").classList.toggle("hidden", !prompted);
  if (prompted) setAuthMode("up");
  $("#accountDlg").showModal();
  startCloud();
}
// Signed-out visitors are asked to make an account each time they open the site. "Not now" lasts for this visit.
const LATER_KEY = "lockedin.acctLater";
function maybePromptAccount() {
  let later = false;
  try { later = !!sessionStorage.getItem(LATER_KEY); } catch {}
  if (passive || later || hadAccount() || cloud?.user || document.querySelector("dialog[open]")) return false;
  track("account_prompt");
  openAccount(true);
  return true;
}
$("#acctLater").onclick = () => {
  try { sessionStorage.setItem(LATER_KEY, "1"); } catch {}
  track("account_prompt_later");
  $("#accountDlg").close();
  maybeAskConsent();
  $("#startBtn").focus();
};
$("#accountDlg").addEventListener("close", () => maybeAskConsent());
$("#accountBtn").onclick = () => openAccount();
document.addEventListener("click", e => { if (e.target.closest("[data-open-account]")) openAccount(); });

let authMode = "up";
function setAuthMode(m) {
  authMode = m;
  for (const [id, mode] of [["#tabUp", "up"], ["#tabIn", "in"]]) { $(id).setAttribute("aria-selected", String(m === mode)); $(id).tabIndex = m === mode ? 0 : -1; }
  $("#authForm").setAttribute("aria-labelledby", m === "up" ? "tabUp" : "tabIn");
  $("#nameRow").classList.toggle("hidden", m !== "up");
  $("#passHint").classList.toggle("hidden", m !== "up");
  $("#authPass").autocomplete = m === "up" ? "new-password" : "current-password";
  $("#authSubmit").textContent = m === "up" ? "Create account" : "Sign in";
  note("#authMsg", "");
}
$("#tabUp").onclick = () => setAuthMode("up");
$("#tabIn").onclick = () => setAuthMode("in");
$(".seg").addEventListener("keydown", e => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  setAuthMode(authMode === "up" ? "in" : "up"); $(authMode === "up" ? "#tabUp" : "#tabIn").focus();
});
$("#authForm").onsubmit = async e => {
  e.preventDefault();
  const email = $("#authEmail").value.trim(), pass = $("#authPass").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) { note("#authMsg", "Enter your email address."); $("#authEmail").focus(); return; }
  if (pass.length < 8) { note("#authMsg", "Passwords are at least 8 characters."); $("#authPass").focus(); return; }
  const btn = $("#authSubmit"); btn.disabled = true; note("#authMsg", "");
  try {
    const c = await ensureCloud();
    if (authMode === "up") {
      const r = await c.signUp(email, pass, $("#authName").value);
      track("signup", {method: "email"});
      if (!r.signedIn) note("#authMsg", "Account created. Confirm your email, then sign in here.", true);
    } else {
      await c.signIn(email, pass);
      track("login", {method: "email"});
    }
    $("#authPass").value = "";
  } catch (err) { note("#authMsg", err.message); }
  finally { btn.disabled = false; }
};
$("#googleBtn").onclick = async () => {
  try { await (await ensureCloud()).signInGoogle(); } catch (err) { note("#authMsg", err.message); }
};
$("#meNameInput").onchange = () => cloud?.updateProfile({display_name: $("#meNameInput").value}).catch(err => note("#acctMsg", err.message));
$("#meAvatarSel").onchange = () => cloud?.updateProfile({avatar: $("#meAvatarSel").value}).catch(err => note("#acctMsg", err.message));
$("#syncNowBtn").onclick = () => { saveActive(true); saveGoals(); cloud?.syncNow(); };
$("#exportBtn").onclick = async () => {
  try {
    saveActive(true); saveGoals();
    const data = await (await ensureCloud()).exportMyData();
    download(`lockedin-my-data-${todayKey()}.json`, JSON.stringify(data, null, 2), "application/json");
  } catch (err) { note("#acctMsg", "Couldn't export: " + err.message); }
};
$("#signOutBtn").onclick = async () => {
  track("logout");
  await cloud?.signOut();
  announce("Signed out. Your data stays on this device.");
};
$("#deleteAcctBtn").onclick = async () => {
  if (!confirm("Delete your lockedin account?\n\nThis permanently erases your synced progress, session history and any analytics tied to your account, and clears lockedin on this device. It can't be undone.")) return;
  const btn = $("#deleteAcctBtn"); btn.disabled = true; btn.textContent = "Deleting…";
  try {
    await cloud.deleteAccount();
    if (vision.on) vision.stop();
    analytics.setAuth(null, null);       // counted anonymously, after the account is gone
    track("account_deleted");
    await analytics.flush();
    location.hash = ""; location.reload();
  } catch (err) { note("#acctMsg", err.message); btn.disabled = false; btn.textContent = "Delete account"; }
};

// Analytics: nothing is sent until the visitor picks "Allow". The choice can be changed any time.
function setAnalytics(on) {
  analytics.setConsent(on ? "granted" : "denied");
  $("#consent").classList.add("hidden");
  renderAccount();
}
$("#analyticsToggle").onchange = e => setAnalytics(e.target.checked);
$("#s_analytics").onchange = e => setAnalytics(e.target.checked);
$("#consentYes").onclick = () => setAnalytics(true);
$("#consentNo").onclick = () => setAnalytics(false);
function maybeAskConsent() { if (!analytics.consent() && !$("#onboardDlg").open && !$("#accountDlg").open) $("#consent").classList.remove("hidden"); }

// Diagnostics for troubleshooting detection: open the site with ?debug to expose numbers (no images).
if (new URLSearchParams(location.search).has("debug")) window.__lockedin = {vision, live, engine, settings, get active() { return active; }};

/* ================= lock-out clips ================= */
vision.onFrame = (src, w, h) => clipper.capture(src, w, h);
function syncClips() {
  clipper.setEnabled(settings.clips && !!active?.runStartedAt && !active?.breakUntil);
  $("#clipsBtn").setAttribute("aria-pressed", String(!!settings.clips));
}
$("#clipsBtn").onclick = () => {
  if (!settings.clips && !confirm("Save short clips of your funny lock-out moments (phone grabs, dozing off, yawns) to watch when the session ends?\n\nClips stay only in this browser tab. They're deleted when you close the tab unless you share or save them.")) return;
  settings.clips = !settings.clips; saveSettings(); syncClips();
  track("settings_change", {key: "clips"});
  toast(settings.clips ? "🎬 Clips on. Lock-outs will be caught on camera." : "Clips off");
};
function renderClips() {
  const list = clipper.clips;
  const box = $("#sumClips");
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<p class="group-label">🎬 Your lock-out moments</p><div class="clip-grid">${list.map((c, i) => `
    <figure class="clip"><canvas data-clip="${i}"></canvas><figcaption>${esc(c.caption)} · ${fmtHM(c.sessionSec)} in</figcaption>
    <button class="pill filled sm" data-share-clip="${i}">Share</button></figure>`).join("")}</div>`;
  const stops = [...box.querySelectorAll("canvas[data-clip]")].map(cv => clipper.play(list[+cv.dataset.clip], cv));
  $("#summaryDlg").addEventListener("close", () => { stops.forEach(s => s()); clipper.reset(); box.innerHTML = ""; }, {once: true});
}
$("#sumClips").onclick = async e => {
  const i = e.target.closest("[data-share-clip]")?.dataset.shareClip; if (i == null) return;
  const btn = e.target; btn.disabled = true; btn.textContent = "Making video…";
  try {
    const file = await clipper.toVideo(clipper.clips[+i]);
    if (navigator.canShare?.({files: [file]})) { try { await navigator.share({files: [file], title: "Caught locking out on lockedin"}); btn.textContent = "Shared"; track("clip_shared"); return; } catch {} }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000); btn.textContent = "Saved"; track("clip_saved");
  } catch (err) { btn.textContent = "Couldn't make video"; console.warn(err); }
  finally { btn.disabled = false; }
};

// Custom alarm sound: kept only in this browser.
$("#testSound").onclick = () => { unlockAudio(); const prev = settings.alertSound; settings.alertSound = $("#s_alertSound").value; beep("alarm"); settings.alertSound = prev; };
$("#uploadSound").onclick = () => $("#soundUpload").click();
$("#soundUpload").onchange = async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (!/^audio\//.test(f.type) || f.size > 3 * 1024 * 1024) { $("#soundName").textContent = "Use an audio file under 3 MB"; return; }
  await putFile("alertSound", f);
  if (customSound) URL.revokeObjectURL(customSound);
  customSound = URL.createObjectURL(f);
  $("#s_alertSound").value = "custom"; $("#soundName").textContent = f.name.slice(0, 28);
};

/* ================= keys, shop, wrapped ================= */
function toast(text, kind = "earn") {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 2600);
}
let customUrl = null;
async function loadCustom() {
  if (customUrl) return customUrl;
  const blob = await getFile("wallpaper");
  if (blob) customUrl = URL.createObjectURL(blob);
  return customUrl;
}
async function applyWallpaper() {
  let id = rewards.wallet.equipped || "midnight";
  const layer = $("#wallpaper");
  layer.style.backgroundImage = "";
  if (id === "custom") {
    const url = await loadCustom();
    if (url) layer.style.backgroundImage = `url("${url}")`; else id = "midnight";
  }
  document.documentElement.dataset.wallpaper = id;
}
const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 200, 365];
function renderWallet() {
  $("#keysNum").textContent = rewards.wallet.keys;
  const s = streakInfo();
  $("#streakTop").textContent = s.count;
  $("#streakBtn").classList.toggle("cold", !s.count);
  $("#streakBtn").classList.toggle("risk", !!s.atRisk);
  // Milestones are reported once each (remembered on this device only).
  try {
    if (STREAK_MILESTONES.includes(s.count) && +localStorage.getItem("lockedin.milestone") !== s.count) {
      localStorage.setItem("lockedin.milestone", s.count); track("streak_milestone", {days: s.count});
    }
  } catch {}
  $("#streakBtn").title = s.atRisk ? `⌛ Lock in ${fmtHM(rewards.STREAK_MIN - s.todaySec)} more today to keep your ${s.count}-day streak` : `${s.count}-day streak. Lock in 25 minutes a day to keep it.`;
}
rewards.onChange(ev => {
  if (ev.type === "earn") toast(`+${ev.amount} 🔑 ${ev.why}`);
  if (ev.type === "freeze") { toast("🧊 Streak freeze used. Your streak is safe."); track("streak_freeze_used"); }
  if (ev.type === "equip" || ev.type === "sync") applyWallpaper();
  renderWallet();
  if ($("#shopDlg").open) renderShop();
});

function renderShop() {
  const w = rewards.wallet;
  $("#shopKeys").textContent = w.keys;
  $("#shopWalls").innerHTML = rewards.WALLPAPERS.map(x => {
    const owned = w.owned.includes(x.id), on = w.equipped === x.id;
    if (x.custom) {
      const swatch = customUrl ? `url("${customUrl}") center / cover` : x.swatch;
      const action = !owned ? `<button class="pill filled sm" data-buy-wp="custom" ${w.keys < x.price ? "disabled" : ""}>🔑 ${x.price}</button>`
        : `<button class="pill ${on ? "tinted" : "filled"} sm" data-upload>${customUrl ? "Change" : "Upload"}</button>${customUrl && !on ? `<button class="pill tinted sm" data-equip="custom">Use</button>` : ""}`;
      return `<div class="wall custom ${on ? "on" : ""}">
        <div class="swatch" style="background:${swatch}">${customUrl ? "" : `<span class="upload-hint">${owned ? "Upload any photo" : "Unlock to upload any photo"}</span>`}</div>
        <div class="wall-meta"><b>${esc(x.name)}</b><span class="wall-actions">${on ? `<span class="caption">Equipped</span>` : ""}${action}</span></div></div>`;
    }
    return `<div class="wall ${on ? "on" : ""}">
      <div class="swatch ${x.animated ? "anim" : ""}" style="background:${x.swatch}"></div>
      <div class="wall-meta"><b>${esc(x.name)}</b>
      ${on ? `<span class="caption">Equipped</span>` : owned ? `<button class="pill tinted sm" data-equip="${x.id}">Use</button>`
        : `<button class="pill filled sm" data-buy-wp="${x.id}" ${w.keys < x.price ? "disabled" : ""}>🔑 ${x.price}</button>`}</div></div>`;
  }).join("");
  $("#freezeCount").textContent = `You have ${w.freezes} of ${rewards.MAX_FREEZES}.`;
  $("#buyFreeze").textContent = `🔑 ${rewards.FREEZE_PRICE}`;
  $("#buyFreeze").disabled = w.freezes >= rewards.MAX_FREEZES || w.keys < rewards.FREEZE_PRICE;
  $("#ledger").innerHTML = w.ledger.slice(-8).reverse().map(l => `<li><span>${esc(l.why)}</span><b class="${l.amt < 0 ? "down" : "up"}">${l.amt > 0 ? "+" : ""}${l.amt}</b></li>`).join("")
    || `<li class="secondary">Lock in to start earning.</li>`;
}
$("#keysBtn").onclick = async () => { await loadCustom(); renderShop(); $("#shopDlg").showModal(); };
$("#streakBtn").onclick = () => { const s = streakInfo(); toast(s.atRisk ? `⌛ ${fmtHM(rewards.STREAK_MIN - s.todaySec)} left today to keep your streak` : `🔥 ${s.count}-day streak`); };
$("#shopWalls").onclick = e => {
  const buy = e.target.closest("[data-buy-wp]")?.dataset.buyWp, use = e.target.closest("[data-equip]")?.dataset.equip;
  const price = rewards.WALLPAPERS.find(w => w.id === buy)?.price;
  if (buy === "custom") { if (rewards.buyWallpaper("custom")) { track("shop_purchase", {item: "custom", price}); toast("Unlocked! Now pick a photo ✨"); renderShop(); $("#wallUpload").click(); } return; }
  if (buy) { if (rewards.buyWallpaper(buy)) { rewards.equip(buy); toast("New background unlocked ✨"); track("shop_purchase", {item: buy, price}); track("wallpaper_equip", {id: buy}); } }
  if (use) { rewards.equip(use); track("wallpaper_equip", {id: use}); }
  if (e.target.closest("[data-upload]")) $("#wallUpload").click();
  renderShop();
};
// Custom background: shrunk and saved only in this browser (IndexedDB). Never uploaded anywhere.
$("#wallUpload").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast("That isn't an image", "spend"); return; }
  if (file.size > 25 * 1024 * 1024) { toast("That image is too big (25 MB max)", "spend"); return; }
  try {
    const blob = await shrinkImage(file);
    await putFile("wallpaper", blob);
    if (customUrl) URL.revokeObjectURL(customUrl);
    customUrl = URL.createObjectURL(blob);
    rewards.equip("custom");
    track("wallpaper_equip", {id: "custom"});
    await applyWallpaper();
    toast("Your background is set ✨");
  } catch (err) { console.warn(err); toast("Couldn't use that image. Try a JPG or PNG.", "spend"); }
  renderShop();
};
$("#buyFreeze").onclick = () => { if (rewards.buyFreeze()) { toast("🧊 Streak freeze ready"); track("shop_purchase", {item: "streak_freeze", price: rewards.FREEZE_PRICE}); } renderShop(); };

// "Your week, wrapped": Instagram-story style recap.
let story = {cards: [], i: 0, timer: 0, week: null};
function wrappedStats(offset) {
  const w = weekStats(offset), prev = weekStats(offset - 1);
  const hrs = hourFocus(w.ss);
  let bestH = null;
  for (const [h, x] of Object.entries(hrs)) { const t = x.f + x.p; if (t >= 300) { const pct = Math.round(x.f / t * 100); if (!bestH || pct > bestH.pct) bestH = {h: +h, pct}; } }
  const end = new Date(w.start); end.setDate(end.getDate() + 6);
  return {label: `${fmtDay(w.start, {month: "short", day: "numeric"})} – ${fmtDay(end, {month: "short", day: "numeric"})}`,
    sec: w.sec, prevSec: prev.ss.length ? prev.sec : null, focus: w.focus, pickups: w.pickups, perHour: w.perHour,
    bestHour: bestH?.h ?? null, bestHourPct: bestH?.pct, bestHourLabel: bestH ? new Date(2000, 0, 1, bestH.h).toLocaleTimeString([], {hour: "numeric"}) : "",
    bestRun: w.best, bestRunLabel: fmtHM(w.best), keys: w.days.reduce((a, d) => a + rewards.earnedOn(d), 0), streak: streakInfo().count};
}
function openWrapped(offset = wkOffset) {
  story.week = wrappedStats(offset);
  story.cards = rewards.wrapCards(story.week);
  story.i = 0;
  track("wrapped_open", {week_offset: offset});
  $("#storyBars").innerHTML = story.cards.map(() => `<i><b></b></i>`).join("");
  $("#wrappedDlg").showModal();
  showCard();
}
function showCard() {
  clearTimeout(story.timer);
  const c = story.cards[story.i];
  [...$("#storyBars").children].forEach((el, j) => el.className = j < story.i ? "done" : j === story.i ? "now" : "");
  $("#story").className = "story k-" + c.k;
  $("#story").innerHTML = `<div class="story-in"><b class="big">${esc(c.big)}</b><span class="sub">${esc(c.sub)}</span><p>${esc(c.note)}</p>
    ${c.share ? `<button class="pill filled lg" id="shareWeek">Share my week</button>` : ""}</div>`;
  if (c.share) $("#shareWeek").onclick = shareWeek;
  else story.timer = setTimeout(() => step(1), 5000);
}
function step(d) { const n = story.i + d; if (n < 0) return; if (n >= story.cards.length) { $("#wrappedDlg").close(); return; } story.i = n; showCard(); }
$("#storyNext").onclick = () => step(1);
$("#storyPrev").onclick = () => step(-1);
$("#wrappedDlg").addEventListener("close", () => clearTimeout(story.timer));
$("#wrappedDlg").addEventListener("keydown", e => { if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); });
async function shareWeek() {
  const blob = await rewards.shareImage(story.week);
  const file = new File([blob], "my-lockedin-week.png", {type: "image/png"});
  if (navigator.canShare?.({files: [file]})) { try { await navigator.share({files: [file], title: "My week on lockedin"}); track("wrapped_share", {method: "share"}); return; } catch {} }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Saved your story image");
  track("wrapped_share", {method: "download"});
}
$("#wrappedBtn").onclick = () => openWrapped();

/* ================= init ================= */
(async function init() {
  // Search Console token from config.js (the commented tag in index.html is the reliable route; see DEPLOY.md).
  if (GSC_VERIFICATION && !document.querySelector('meta[name="google-site-verification"]')) {
    const m = document.createElement("meta"); m.name = "google-site-verification"; m.content = GSC_VERIFICATION; document.head.append(m);
  }
  applyTheme();
  applyWallpaper();
  rewards.applyFreezes(secondsByDay());
  renderWallet();
  renderPlaces();
  showView(currentView());
  render();
  renderAccount();
  if (!store.load("onboarded", false)) openOnboarding();
  else if (!maybePromptAccount()) maybeAskConsent();
  track("app_open", {view: currentView(), returning: sessions.length > 0, onboarded: !!store.load("onboarded", false), had_account: hadAccount()});
  const seen = store.load("reportSeen", null), dow = new Date().getDay();
  if (sessions.length && seen !== dayKey(weekStartOf(new Date())) && (dow === settings.weekStart || dow === (settings.weekStart + 6) % 7)) $("#insightsBadge").classList.remove("hidden");

  bc?.postMessage({type: "hello", from: tabId});
  await new Promise(r => setTimeout(r, 400));
  if (!passive && active && settings.autoCamera) vision.start();

  try {
    const r = await fetch("/api/plan", {method: "GET"});
    aiAvailable = r.ok && (await r.json()).ai === true;
  } catch { aiAvailable = false; }
  renderAll();

  if (!GOALS_ENABLED) {
    document.querySelector('.tabs a[data-view="goals"]')?.remove(); $("#v-goals")?.remove();
    document.body.classList.add("no-goals");
  }
  emoji.start();
  // Only load the accounts library for people who have signed in before (or are coming back from Google).
  if (hadAccount() || new URLSearchParams(location.search).has("code")) startCloud();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
