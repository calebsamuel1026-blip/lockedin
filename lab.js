// Detection check: a guided ~3 minute test that records what the camera measured during known poses, so detection
// can be tuned from real data instead of simulations. Nothing leaves the device unless you download/copy the results.
// Two detectors watch the same frames: one starting fresh, one with the learning saved by the app on this browser.
import {Vision} from "./vision.js";
import * as engine from "./engine.js";
import * as store from "./store.js";

const $ = s => document.querySelector(s);
const settings = {...{downSec: 12, chatSec: 20, chatDetect: true, paperMode: false, phoneAlertSec: 5, chatAlertSec: 90}, ...store.load("settings", {})};
settings.paperMode = false;   // the check measures plain head-down detection
const sens = () => +settings.sensitivity || 1;

const STEPS = [
  {id: "work", sec: 45, say: "Sit like you normally do and look at your screen. Read or scroll something for a bit.", show: "Look at your screen like you normally work"},
  {id: "down", sec: 12, say: "Now look all the way down at your desk, and hold it.", show: "Look ALL the way down at your desk"},
  {id: "back1", sec: 8, say: "Back to your screen.", show: "Back to your screen"},
  {id: "lap", sec: 12, say: "Look down at your phone in your lap, like you're scrolling.", show: "Phone in your lap, look down at it"},
  {id: "back2", sec: 8, say: "Back to your screen.", show: "Back to your screen"},
  {id: "chin", sec: 10, say: "Drop your head, chin to chest.", show: "Chin to chest"},
  {id: "back3", sec: 8, say: "Back to your screen.", show: "Back to your screen"},
  {id: "held", sec: 12, say: "Hold your phone up in front of you and scroll it.", show: "Hold your phone up and scroll"},
  {id: "back4", sec: 8, say: "Put the phone away. Back to your screen.", show: "Phone away, back to your screen"},
  {id: "keys", sec: 10, say: "Look down at your keyboard and type something.", show: "Look at your keyboard and type"},
  {id: "back5", sec: 6, say: "Back to your screen.", show: "Back to your screen"},
  {id: "side", sec: 10, say: "Turn your head and look away to the side.", show: "Look away to the side"},
  {id: "back6", sec: 8, say: "And back to your screen. Last one.", show: "Back to your screen"},
  {id: "down2", sec: 12, say: "Look all the way down at your desk again, and hold it.", show: "Look ALL the way down again"},
  {id: "end", sec: 3, say: "Done. Thank you.", show: "Done"},
];

const video = $("#video"), overlay = $("#overlay");
const fresh = new Vision(video, overlay, sens);
const saved = new Vision(document.createElement("video"), document.createElement("canvas"), sens);
const savedLearn = store.load("learn", null);
saved.restore(savedLearn);
const freshLive = newLive(), savedLive = newLive();
function newLive() { return {downSec: 0, offSec: 0, talkSec: 0, sideSec: 0, deskSec: 0, matchSec: 0, focusRun: 0, state: "focused", stateSec: 0, lastPhoneAt: 0, lastAlertAt: 0}; }

const frames = [], seconds = [];
let step = -1, stepStart = 0, t0 = 0, running = false;

const r1 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10;
const r3 = v => v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000;
function corr(d) {
  if (!d || d.n < 5) return null;
  const cov = d.spr / d.n - (d.sp / d.n) * (d.sr / d.n), vp = d.spp / d.n - (d.sp / d.n) ** 2, vr = d.srr / d.n - (d.sr / d.n) ** 2;
  return cov / Math.sqrt(Math.max(1e-9, vp * vr));
}
function snap(v, m) {
  const M = v.model, low = m ? v.downBy([m.pitch, m.yaw, (m.eyeDown - m.eyeUp) * 30]) : null;
  return {model: !!M, sign: M?.downSign ?? null, dir: v.downDir, corr: r3(corr(v.dirStats)), med: r1(M?.med?.[0]), min: r1(M?.min?.[0]), max: r1(M?.max?.[0]),
    edge: r1(low?.edge), mid: r1(low?.mid), fd: v.frameDown, trend: v.trendDown, hd: r3(v.headDownEMA), dn: r3(v.downEMA),
    atLoss: v.downAtLoss, headDown: v.headDown, inWork: v.inWorkNow, body: v.bodyDrop?.() ? {k: v.bodyDrop().kind, d: r3(v.bodyDrop().drop)} : null};
}

// Record every frame the fresh detector analyses, and feed the identical inputs to the saved-learning detector.
const ingest = fresh.ingest.bind(fresh);
fresh.ingest = (face, det, pose) => {
  ingest(face, det, pose);
  try { saved.ingest(face, det, pose); } catch (err) { console.warn(err); }
  if (!running) return;
  const m = face?.m;
  frames.push({t: Date.now() - t0, s: STEPS[step]?.id, face: !!m, n: face?.count || 0,
    m: m ? {p: r1(m.pitch), y: r1(m.yaw), r: r3(m.ratio), ed: r3(m.eyeDown), eu: r3(m.eyeUp), b: r3(m.blink), cy: r3(m.cy), sz: r3(m.size)} : null,
    det: det === undefined ? undefined : {person: det.person, top: r3(det.top), phone: det.phone ? r3(det.phone.cy) : null},
    pose: pose === undefined ? undefined : pose ? r3(pose.nose) : null,
    F: snap(fresh, m), S: snap(saved, m)});
};
// The engine, once a second, exactly as the app runs it.
saved.ready = true; Object.defineProperty(saved, "stalled", {get: () => false});
function second() {
  const out = {t: Date.now() - t0, s: STEPS[step]?.id};
  for (const [k, v, live] of [["F", fresh, freshLive], ["S", saved, savedLive]]) {
    engine.updateCounters(live, v, false);
    const st = engine.classify(live, v, settings, false);
    engine.advance(live, st, Date.now());
    out[k] = {st, why: live.reason, down: live.downSec};
  }
  seconds.push(out);
  $("#state").textContent = `${out.F.st}${out.F.why ? " · " + out.F.why : ""}`;
}

function say(text) { try { speechSynthesis.cancel(); speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), {rate: 1.05})); } catch {} }
function beep() {
  try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.15); } catch {}
}
function nextStep() {
  step++; stepStart = Date.now();
  if (step >= STEPS.length) return finish();
  beep(); say(STEPS[step].say);
  $("#instr").textContent = STEPS[step].show;
}
function loop() {
  if (!running) return;
  const left = Math.ceil(STEPS[step].sec - (Date.now() - stepStart) / 1000);
  $("#count").textContent = left > 0 ? `${left}s` : "";
  $("#progress").style.width = `${100 * (step + 1) / STEPS.length}%`;
  if (left <= 0) nextStep();
}

function summarize() {
  const by = {};
  for (const f of frames) {
    const b = by[f.s] ||= {frames: 0, face: 0, pitch: [], F: 0, S: 0};
    b.frames++; if (f.face) { b.face++; b.pitch.push(f.m.p); }
    if (f.F.headDown) b.F++; if (f.S.headDown) b.S++;
  }
  const states = {};
  for (const s of seconds) { const x = states[s.s] ||= {F: {}, S: {}}; x.F[s.F.st] = (x.F[s.F.st] || 0) + 1; x.S[s.S.st] = (x.S[s.S.st] || 0) + 1; }
  const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null;
  return STEPS.filter(s => by[s.id]).map(s => ({step: s.id, faceSeen: Math.round(100 * by[s.id].face / by[s.id].frames) + "%", medianPitch: med(by[s.id].pitch),
    headDownFresh: Math.round(100 * by[s.id].F / by[s.id].frames) + "%", headDownSaved: Math.round(100 * by[s.id].S / by[s.id].frames) + "%",
    statesFresh: states[s.id]?.F, statesSaved: states[s.id]?.S}));
}
function finish() {
  running = false; clearInterval(window.__labTimers?.[0]); clearInterval(window.__labTimers?.[1]); clearInterval(window.__labTimers?.[2]);
  const result = {app: "lockedin-lab", v: 1, at: new Date().toISOString(), ua: navigator.userAgent, video: fresh.diag?.size, backend: fresh.diag?.src,
    savedLearn: savedLearn ? {dir: savedLearn.dir, work: savedLearn.work?.length, phone: savedLearn.phone?.length, taught: savedLearn.taught?.length, taughtBody: savedLearn.taughtBody?.length,
      medPitch: savedLearn.work?.length ? [...savedLearn.work.map(w => w.f[0])].sort((a, b) => a - b)[savedLearn.work.length >> 1] : null} : null,
    settings: {sensitivity: settings.sensitivity, downSec: settings.downSec}, summary: summarize(), seconds, frames};
  window.__lab = result;
  try { localStorage.setItem("lockedin.lab", JSON.stringify(result)); } catch {}
  fresh.stop?.();
  $("#instr").textContent = "Done! Thanks.";
  $("#count").textContent = "";
  $("#results").hidden = false;
  $("#table").innerHTML = `<tr><th>Step</th><th>Face seen</th><th>Head down (fresh)</th><th>Head down (your saved learning)</th><th>App said (fresh)</th></tr>` +
    result.summary.map(r => `<tr><td>${r.step}</td><td>${r.faceSeen}</td><td>${r.headDownFresh}</td><td>${r.headDownSaved}</td><td>${Object.entries(r.statesFresh || {}).map(([k, v]) => `${k} ${v}s`).join(", ")}</td></tr>`).join("");
}

$("#start").onclick = async () => {
  $("#start").disabled = true; $("#intro").hidden = true;
  $("#instr").textContent = "Starting camera…";
  fresh.addEventListener("message", e => ($("#msg").textContent = e.detail));
  await fresh.start();
  if (!fresh.on) { $("#instr").textContent = "The camera didn't start. Allow it in the address bar and reload."; return; }
  for (let i = 0; i < 100 && !fresh.ready; i++) await new Promise(r => setTimeout(r, 200));
  $("#msg").textContent = "";
  saved.ready = true;
  running = true; t0 = Date.now();
  window.__labTimers = [setInterval(() => fresh.tick(), 100), setInterval(second, 1000), setInterval(loop, 250)];
  nextStep();
};
$("#download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(window.__lab)], {type: "application/json"}));
  a.download = `lockedin-detection-check-${Date.now()}.json`; a.click();
};
$("#copy").onclick = async () => {
  try { await navigator.clipboard.writeText(JSON.stringify({...window.__lab, frames: undefined})); $("#copy").textContent = "Copied"; } catch { $("#copy").textContent = "Couldn't copy"; }
};
// For inspecting a run from the console (or by the developer's tools).
window.__labDebug = {fresh, saved, frames, seconds, second, start: () => { running = true; t0 = Date.now(); step = 0; stepStart = Date.now(); }};
